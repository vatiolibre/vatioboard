import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/audio-source-resolver.js", () => ({
  resolveRadioSource: vi.fn((track) =>
    track.hls
      ? null
      : {
          src: track.url_resolved || "https://relay.example/stream",
          type: "live",
          transport: track.url_resolved ? "radio-direct" : "radio-relay",
          cacheable: false,
        },
  ),
  resolveAudioSource: vi.fn(async () => ({ src: "blob:music", type: "blob", transport: "local" })),
  triggerBackgroundCache: vi.fn(),
}));
vi.mock("../../src/shared/audio-mini-visualizer.js", () => ({
  destroyVisualizerGraphForElement: vi.fn(() => false),
  resumeVisualizerGraphForElement: vi.fn(async () => true),
}));
const station = (name = "one") => ({
  name: `radio:${name}`,
  media_kind: "radio",
  title: name,
  station_uuid: "11111111-1111-4111-8111-111111111111",
  url_resolved: `https://station.example/${name}`,
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
let runtime, system;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  runtime = await import("../../src/shared/audio-runtime.js");
  system = await import("../../src/shared/audio-system.js");
});
afterEach(async () => {
  runtime.stopPlayback();
  system.disposeAudioSystemForTests();
  (await import("../../src/shared/audio-lifecycle-diagnostics.js")).stopAudioLifecycleDiagnostics();
  document.getElementById("vatio-native-radio-host")?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native radio extension of main audio", () => {
  it("starts connected radio synchronously, without CORS, priming, or a Web Audio graph", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const silence = vi.spyOn(system.getBackgroundKeepAliveAudio(), "play");
    const pending = runtime.playTrackNow(station());
    expect(play).toHaveBeenCalledTimes(1);
    const element = runtime.getAudioElement();
    expect(element.isConnected).toBe(true);
    expect(element.controls).toBe(false);
    expect(element.parentElement.hidden).toBe(true);
    expect(element.crossOrigin).toBeNull();
    expect(silence).not.toHaveBeenCalled();
    expect(
      await (await import("../../src/shared/audio-graph-registry.js")).acquireGraph(element),
    ).toBeNull();
    await pending;
    expect(runtime.getState()).toMatchObject({
      isLive: true,
      seekable: false,
      analysisEligible: false,
      sourceTransport: "radio-direct",
    });
    expect(navigator.mediaSession.setActionHandler).not.toHaveBeenCalled();
  });

  it("uses anonymous CORS on relay and never caches live audio", async () => {
    await runtime.playTrackNow({ ...station(), url_resolved: "" });
    expect(runtime.getAudioElement().crossOrigin).toBe("anonymous");
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    const resolver = await import("../../src/shared/audio-source-resolver.js");
    expect(resolver.resolveAudioSource).not.toHaveBeenCalled();
    expect(resolver.triggerBackgroundCache).not.toHaveBeenCalled();
    runtime.seekTo(42);
    expect(runtime.getAudioElement().currentTime).toBe(0);
  });

  it("never suppresses recording and alert silence across stations, pause, or Stop", async () => {
    await system.acquireBackgroundAudioLease("drive-recording");
    await system.acquireBackgroundAudioLease("speed-alerts");
    const silent = system.getBackgroundKeepAliveAudio();
    const pause = vi.spyOn(silent, "pause");
    await runtime.playTrackNow(station());
    const native = runtime.getAudioElement();
    await runtime.playTrackNow(station("two"));
    expect(runtime.getAudioElement()).toBe(native);
    runtime.pause();
    await runtime.rearmBackgroundPlayback();
    expect(native.paused).toBe(true);
    runtime.stopPlayback();
    expect(system.getBackgroundAudioState().activeLeaseIds).toEqual([
      "drive-recording",
      "speed-alerts",
    ]);
    expect(pause).not.toHaveBeenCalled();
    expect(silent.paused).toBe(false);
    system.releaseBackgroundAudioLease("drive-recording");
    expect(silent.paused).toBe(false);
    system.releaseBackgroundAudioLease("speed-alerts");
    expect(silent.paused).toBe(true);
  });

  it("keeps MP3 and native elements separate and returns to the original MP3 element", async () => {
    runtime.setQueue([{ name: "music", src: "blob:music" }]);
    await flush();
    const music = runtime.getAudioElement();
    await runtime.playTrackNow(station());
    const radio = runtime.getAudioElement();
    expect(radio).not.toBe(music);
    expect(music.paused).toBe(true);
    await runtime.playTrackNow({ name: "music-two", src: "blob:music" });
    await flush();
    expect(runtime.getAudioElement()).toBe(music);
    expect(radio.paused).toBe(true);
    expect(radio.getAttribute("src")).toBeNull();
  });

  it("ignores delayed MP3 resolution after selecting native radio", async () => {
    const resolver = await import("../../src/shared/audio-source-resolver.js");
    let resolve;
    resolver.resolveAudioSource.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    runtime.setQueue([{ name: "pending" }]);
    const music = runtime.getAudioElement();
    const play = vi.spyOn(music, "play");
    await runtime.playTrackNow(station());
    resolve({ src: "blob:late", type: "blob" });
    await flush();
    expect(play).not.toHaveBeenCalled();
    expect(runtime.getState().isLive).toBe(true);
  });

  it("ignores stale radio rejection after a newer station starts", async () => {
    let reject;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    await runtime.playTrackNow(station());
    await runtime.playTrackNow(station("two"));
    runtime.getAudioElement().dispatchEvent(new Event("playing"));
    reject(new DOMException("blocked", "NotAllowedError"));
    await flush();
    expect(runtime.getState()).toMatchObject({
      paused: false,
      connectionState: "playing",
      error: null,
    });
  });

  it("bounds recovery of established radio and cancels it on Stop", async () => {
    await runtime.playTrackNow(station());
    const radio = runtime.getAudioElement();
    const play = vi.spyOn(radio, "play");
    radio.dispatchEvent(new Event("playing"));
    for (let i = 0; i < 2; i++) {
      radio.dispatchEvent(new Event("error"));
      await vi.advanceTimersByTimeAsync(5000);
      radio.dispatchEvent(new Event("playing"));
    }
    radio.dispatchEvent(new Event("error"));
    expect(runtime.getState().connectionState).toBe("unavailable");
    expect(play).toHaveBeenCalledTimes(2);
    await runtime.playTrackNow(station("two"));
    radio.dispatchEvent(new Event("playing"));
    radio.dispatchEvent(new Event("error"));
    runtime.stopPlayback();
    const count = play.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(play).toHaveBeenCalledTimes(count);
  });

  it("does not retry autoplay rejection and respects native Pause", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(
      new DOMException("blocked", "NotAllowedError"),
    );
    await runtime.playTrackNow(station());
    await flush();
    expect(runtime.getState()).toMatchObject({ paused: true, error: "playback-blocked" });
    await runtime.play();
    runtime.getAudioElement().dispatchEvent(new Event("playing"));
    runtime.getAudioElement().pause();
    expect(runtime.getState().paused).toBe(true);
    await runtime.rearmBackgroundPlayback();
    expect(runtime.getAudioElement().paused).toBe(true);
  });

  it("restores service platform ownership after native radio stops", async () => {
    const adapter = await import("../../src/shared/media-session-adapter.js");
    const pause = vi.fn();
    adapter.updateMediaSessionClient("recording", {
      active: true,
      priority: 5,
      playbackState: "playing",
      metadata: { title: "Drive recording" },
      handlers: { pause },
    });
    await runtime.playTrackNow(station());
    expect(navigator.mediaSession.metadata).toBeNull();
    runtime.stopPlayback();
    expect(navigator.mediaSession.metadata.title).toBe("Drive recording");
    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith("pause", pause);
    adapter.clearMediaSessionClient("recording");
  });
});

it("restores a saved radio queue without claiming native ownership before Play", async () => {
  await runtime.playTrackNow(station());
  const sessions = await import("../../src/shared/player-session.js");
  const saved = sessions.loadPlayerSession();
  expect(saved.queueEntries[0].station_uuid).toBe(station().station_uuid);
  runtime.stopPlayback();
  sessions.savePlayerSession(saved);
  const adapter = await import("../../src/shared/media-session-adapter.js");
  adapter.updateMediaSessionClient("recording", { active: true, priority: 5,
    playbackState: "playing", metadata: { title: "Drive recording" } });
  await runtime.restoreSession([], { autoplay: false });
  expect(runtime.getState()).toMatchObject({ isLive: true, paused: true });
  expect(runtime.getAudioElement().paused).toBe(true);
  expect(navigator.mediaSession.metadata.title).toBe("Drive recording");
  adapter.clearMediaSessionClient("recording");
});

it("keeps native playback and feature leases untouched when optional analysis fails", async () => {
  await system.acquireBackgroundAudioLease("recording");
  await runtime.playTrackNow(station());
  const native = runtime.getAudioElement();
  const pause = vi.spyOn(native, "pause");
  const source = native.src;
  const writes = navigator.mediaSession.setActionHandler.mock.calls.length;
  const registry = await import("../../src/shared/audio-graph-registry.js");
  vi.spyOn(registry, "acquireGraph").mockResolvedValue(null);
  const owner = Symbol("scope");
  expect(await runtime.requestRadioVisualization(owner)).toBe(false);
  expect(runtime.getAudioElement()).toBe(native);
  expect(native.src).toBe(source); expect(native.paused).toBe(false);
  expect(pause).not.toHaveBeenCalled();
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual(["recording"]);
  expect(navigator.mediaSession.setActionHandler.mock.calls.length).toBe(writes);
  runtime.releaseRadioVisualization(owner);
});

it("shares optional analysis across viewers and cleans up on last release, Pause, and hidden", async () => {
  const registry = await import("../../src/shared/audio-graph-registry.js");
  const context = Object.assign(new EventTarget(), { state: "running" });
  const acquire = vi.spyOn(registry, "acquireGraph").mockResolvedValue({ audioContext: context });
  await runtime.playTrackNow(station());
  const native = runtime.getAudioElement();
  const scope = Symbol("scope"), milkdrop = Symbol("milkdrop");
  await runtime.requestRadioVisualization(scope);
  const analysis = runtime.getVisualizationAudioElement();
  await runtime.requestRadioVisualization(milkdrop);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(analysis).not.toBe(native);
  runtime.releaseRadioVisualization(scope);
  expect(analysis.paused).toBe(false);
  runtime.releaseRadioVisualization(milkdrop);
  expect(analysis.paused).toBe(true); expect(native.paused).toBe(false);
  await runtime.requestRadioVisualization(scope);
  runtime.pause(); expect(runtime.getVisualizationAudioElement()).toBeNull();
  await runtime.play(); await flush();
  expect(runtime.getRadioVisualizationStatus()).toBe("ready");
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(runtime.getVisualizationAudioElement()).toBeNull(); expect(native.paused).toBe(false);
  hidden.mockReturnValue(false); document.dispatchEvent(new Event("visibilitychange"));
  expect(runtime.getVisualizationAudioElement()).toBeNull();
  runtime.releaseRadioVisualization(scope);
});

async function saveAndRestoreRadio({ autoplay = true, paused = false } = {}) {
  await runtime.playTrackNow(station());
  const sessions = await import("../../src/shared/player-session.js");
  const saved = sessions.loadPlayerSession();
  runtime.stopPlayback();
  sessions.savePlayerSession({ ...saved, paused });
  await runtime.restoreSession([], { autoplay });
  await flush();
}

it("restores radio with MP3's Player retainer while preserving native playback and presentation", async () => {
  await saveAndRestoreRadio();
  const native = runtime.getAudioElement();
  expect(runtime.getState()).toMatchObject({ restoredRadioSession: true, radioVisualizationAutoStart: false, paused: false });
  expect(native.isConnected).toBe(true);
  expect(native.paused).toBe(false);
  expect(system.getBackgroundAudioState().activeLeaseIds).toContain("player-runtime");
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(false);
  expect(navigator.mediaSession.setActionHandler).not.toHaveBeenCalled();
  expect(await (await import("../../src/shared/audio-graph-registry.js")).acquireGraph(native)).toBeNull();
  runtime.pause();
  expect(system.getBackgroundAudioState().activeLeaseIds).not.toContain("player-runtime");
  const primaryPlay = vi.spyOn(native, "play");
  const silentPlay = vi.spyOn(system.getBackgroundKeepAliveAudio(), "play");
  const resume = runtime.play();
  expect(primaryPlay).toHaveBeenCalled();
  expect(silentPlay).toHaveBeenCalled();
  await resume;
  await flush();
  expect(system.getBackgroundAudioState().activeLeaseIds).toContain("player-runtime");
});

it("keeps independent feature leases when restored radio stops or a fresh station is selected", async () => {
  await system.acquireBackgroundAudioLease("recording");
  await saveAndRestoreRadio();
  await runtime.playTrackNow(station("two"));
  expect(runtime.getState()).toMatchObject({ restoredRadioSession: false, radioVisualizationAutoStart: true });
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual(["recording"]);
  runtime.stopPlayback();
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(false);
});

it("does not autoplay or acquire a Player lease for a saved paused station", async () => {
  await saveAndRestoreRadio({ paused: true });
  expect(runtime.getAudioElement().paused).toBe(true);
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual([]);
});

it("releases restored retention on blocked native autoplay and allows a Play retry", async () => {
  await runtime.playTrackNow(station());
  const native = runtime.getAudioElement();
  const sessions = await import("../../src/shared/player-session.js");
  const saved = sessions.loadPlayerSession();
  runtime.stopPlayback();
  sessions.savePlayerSession(saved);
  vi.spyOn(native, "play").mockRejectedValueOnce(new DOMException("Gesture required", "NotAllowedError"));
  await runtime.restoreSession([], { autoplay: true });
  await flush();
  expect(runtime.getState()).toMatchObject({ paused: true, error: "playback-blocked" });
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual([]);
  await runtime.play();
  await flush();
  expect(native.paused).toBe(false);
  expect(system.getBackgroundAudioState().activeLeaseIds).toContain("player-runtime");
});

it("keeps restored native radio playing if the silent carrier is rejected", async () => {
  vi.spyOn(system.getBackgroundKeepAliveAudio(), "play").mockRejectedValue(new DOMException("Gesture required", "NotAllowedError"));
  await saveAndRestoreRadio();
  expect(runtime.getAudioElement().paused).toBe(false);
  expect(runtime.getState().error).toBeNull();
  expect(runtime.getState().restoredRadioSession).toBe(true);
});

it("recovers an active radio on cached-page return only once and never after explicit Pause", async () => {
  await runtime.playTrackNow(station());
  const native = runtime.getAudioElement();
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  native.pause(); // Browser interruption, not a user Pause.
  const play = vi.spyOn(native, "play");
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await flush();
  expect(play).toHaveBeenCalledTimes(1);
  expect(runtime.getState().restoredRadioSession).toBe(true);
  expect(system.getBackgroundAudioState().activeLeaseIds).toContain("player-runtime");
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  runtime.pause();
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  expect(play).toHaveBeenCalledTimes(1);
  expect(native.paused).toBe(true);
});

it("retains silence during restored radio retries and releases it after terminal failure", async () => {
  await saveAndRestoreRadio();
  const native = runtime.getAudioElement();
  const silent = system.getBackgroundKeepAliveAudio();
  native.dispatchEvent(new Event("playing"));
  const pause = vi.spyOn(silent, "pause");
  for (let retry = 0; retry < 2; retry++) {
    native.dispatchEvent(new Event("error"));
    expect(silent.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    native.dispatchEvent(new Event("playing"));
  }
  expect(pause).not.toHaveBeenCalled();
  native.dispatchEvent(new Event("error"));
  expect(runtime.getState().connectionState).toBe("unavailable");
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual([]);
  expect(silent.paused).toBe(true);
});

it.each(["stop", "station change"])("does not restore a cached station after %s", async (action) => {
  await runtime.playTrackNow(station());
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  if (action === "stop") runtime.stopPlayback();
  else await runtime.playTrackNow(station("new"));
  const play = vi.spyOn(runtime.getAudioElement(), "play");
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  expect(play).not.toHaveBeenCalled();
  expect(runtime.getState().restoredRadioSession).toBe(false);
});
