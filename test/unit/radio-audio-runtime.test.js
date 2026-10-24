import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/audio-source-resolver.js", () => ({
  resolveRadioSource: vi.fn((track) =>
    track.hls
      ? null
      : {
          src: track.url_resolved || "https://relay.example/stream",
          type: "live",
      transport: "radio-relay",
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
  const sources = await import("../../src/shared/audio-source-resolver.js");
  sources.resolveAudioSource.mockReset().mockResolvedValue({ src: "blob:music", type: "blob", transport: "local" });
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
  it("primes the shared Web Audio context for a gesture-started radio selection", async () => {
    const registry = await import("../../src/shared/audio-graph-registry.js");
    const prime = vi.spyOn(registry, "primeAudioContext").mockReturnValue(true);

    await runtime.playTrackNow(station(), { fromUserGesture: true });

    expect(prime).toHaveBeenCalledTimes(1);
    expect(runtime.getVisualizationAudioElement()).toBe(runtime.getAudioElement());
  });

  it("starts the canonical relay radio synchronously on the shared playback element", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const silence = vi.spyOn(system.getBackgroundKeepAliveAudio(), "play");
    const pending = runtime.playTrackNow(station());
    expect(play).toHaveBeenCalledTimes(1);
    const element = runtime.getAudioElement();
    expect(element.isConnected).toBe(true);
    expect(element.controls).toBe(false);
    expect(element.parentElement.hidden).toBe(true);
    expect(element.crossOrigin).toBe("anonymous");
    expect(runtime.getVisualizationAudioElement()).toBe(element);
    expect(silence).not.toHaveBeenCalled();
    await pending;
    expect(runtime.getState()).toMatchObject({
      isLive: true,
      seekable: false,
      analysisEligible: true,
      sourceTransport: "radio-relay",
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
  vi.spyOn(registry, "getGraph").mockReturnValue({ audioContext: context });
  const analysis = runtime.getVisualizationAudioElement();
  await runtime.requestRadioVisualization(milkdrop);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(analysis).toBe(native);
  runtime.releaseRadioVisualization(scope);
  expect(analysis.paused).toBe(false);
  runtime.releaseRadioVisualization(milkdrop);
  expect(analysis.paused).toBe(false); expect(native.paused).toBe(false);
  await runtime.requestRadioVisualization(scope);
  runtime.pause(); expect(runtime.getVisualizationAudioElement()).toBe(native);
  await runtime.play(); await flush();
  await runtime.requestRadioVisualization(scope);
  expect(runtime.getRadioVisualizationStatus()).toBe("ready");
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(runtime.getVisualizationAudioElement()).toBe(native); expect(native.paused).toBe(false);
  hidden.mockReturnValue(false); document.dispatchEvent(new Event("visibilitychange"));
  expect(runtime.getVisualizationAudioElement()).toBe(native);
  runtime.releaseRadioVisualization(scope);
});

async function saveAndRestoreRadio({ autoplay = true, paused = false } = {}) {
  await runtime.playTrackNow(station());
  const sessions = await import("../../src/shared/player-session.js");
  const saved = sessions.loadPlayerSession();
  runtime.stopPlayback();
  sessions.savePlayerSession({ ...saved, paused, playbackIntent: paused ? "paused" : "playing" });
  await runtime.restoreSession([], { autoplay });
  await flush();
}

it("restores radio paused when autoplay is explicitly disabled", async () => {
  await saveAndRestoreRadio({ autoplay: false });
  const native = runtime.getAudioElement();
  expect(runtime.getState()).toMatchObject({ restoredRadioSession: true, radioVisualizationAutoStart: false, paused: true });
  expect(native.isConnected).toBe(true);
  expect(native.paused).toBe(true);
  expect(system.getBackgroundAudioState().activeLeaseIds).not.toContain("player-runtime");
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(true);
  expect(navigator.mediaSession.setActionHandler).not.toHaveBeenCalled();
  expect(await (await import("../../src/shared/audio-graph-registry.js")).acquireGraph(native)).toBeNull();
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

it("runs the real restored-demo lifecycle before restored radio resumes", async () => {
  await runtime.playTrackNow(station());
  const sessions = await import("../../src/shared/player-session.js");
  const saved = sessions.loadPlayerSession();
  runtime.stopPlayback();
  sessions.savePlayerSession({ ...saved, paused: true, playbackIntent: "paused" });

  await runtime.restoreSession([{
    name: "demo:focus",
    title: "Focus clip",
    media_kind: "audio",
    src: "/audio/demo/focus.mp3",
    _demo: true,
  }], { autoplay: false });

  const sourceResolver = await import("../../src/shared/audio-source-resolver.js");
  expect(sourceResolver.resolveAudioSource).toHaveBeenCalledWith("demo:focus", expect.objectContaining({ _demo: true }));
  const preparedResolveCount = sourceResolver.resolveAudioSource.mock.calls
    .filter(([name]) => name === "demo:focus").length;
  expect(runtime.getState().currentTrack?.media_kind).toBe("radio");
  expect(document.querySelector("#vatio-radio-focus-host audio")).toBeNull();
  expect(runtime.getState()).toMatchObject({
    restoredRadioSession: true,
    radioFocusPrepared: true,
    paused: true,
  });

  const native = runtime.getAudioElement();
  const nativePlay = vi.spyOn(native, "play");
  const handoff = runtime.play();
  await flush();
  const demo = runtime.getAudioElement();
  expect(demo).not.toBe(native);
  expect(demo.src).toBe("blob:music");
  expect(demo.paused).toBe(false);
  expect(nativePlay).not.toHaveBeenCalled();
  demo.currentTime = 0.1;
  demo.dispatchEvent(new Event("playing"));
  demo.dispatchEvent(new Event("timeupdate"));
  await flush();
  native.dispatchEvent(new Event("playing"));
  await handoff;
  expect(nativePlay).toHaveBeenCalledTimes(1);
  await flush();
  expect(runtime.getState()).toMatchObject({ paused: false, isLive: true, radioFocusHandoffPending: false });
  expect(runtime.getState().currentTrack?.media_kind).toBe("radio");
  expect(runtime.getState().queue.some((track) => track.name === "demo:focus")).toBe(false);
  expect(sourceResolver.resolveAudioSource.mock.calls.filter(([name]) => name === "demo:focus").length)
    .toBe(preparedResolveCount);
  expect(system.getBackgroundAudioState().activeLeaseIds).toContain("player-runtime");
});

it("releases restored retention on blocked native autoplay and allows a Play retry", async () => {
  const nativePlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
  // Seed a saved session without starting playback through the spy.
  const sessions = await import("../../src/shared/player-session.js");
  sessions.savePlayerSession({ queueEntries: [{ ...station(), entryId: "radio" }], currentEntryId: "radio", currentIndex: 0, paused: false });
  await runtime.restoreSession([], { autoplay: true });
  await flush();
  expect(runtime.getState()).toMatchObject({ paused: true, error: "playback-blocked", playbackIntent: "playing", restorationStatus: "blocked" });
  expect(sessions.loadPlayerSession().playbackIntent).toBe("playing");
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual([]);
  nativePlay.mockRestore();
  await runtime.play({ fromUserGesture: true });
  await flush();
  expect(runtime.getAudioElement().paused).toBe(false);
  expect(system.getBackgroundAudioState().activeLeaseIds).toContain("player-runtime");
});

it("does not arm the background carrier for a deliberately paused station", async () => {
  await saveAndRestoreRadio({ paused: true });
  expect(runtime.getAudioElement().paused).toBe(true);
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(true);
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
  await runtime.play();
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

const focusTrack = { name: "demo:focus", title: "Focus clip", media_kind: "audio", src: "/audio/demo/focus.mp3", _demo: true };

async function seedRadioSession() {
  const sessions = await import("../../src/shared/player-session.js");
  sessions.savePlayerSession({ queueEntries: [{ ...station(), entryId: "saved-radio" }], currentEntryId: "saved-radio", currentIndex: 0, paused: false });
  return sessions;
}

async function advanceDemoAndRadio() {
  await flush();
  const demo = runtime.getAudioElement();
  demo.currentTime = 0.2;
  demo.dispatchEvent(new Event("playing"));
  demo.dispatchEvent(new Event("timeupdate"));
  await flush();
  runtime.getAudioElement().dispatchEvent(new Event("playing"));
  await flush();
}

it("automatically runs the tested demo handoff while persisting only the station", async () => {
  const sessions = await seedRadioSession();
  const recovery = runtime.restoreSession([focusTrack], { autoplay: true });
  await flush();
  expect(runtime.getAudioElement().src).toBe("blob:music");
  expect(sessions.loadPlayerSession()).toMatchObject({ currentEntryId: "saved-radio", playbackIntent: "playing", queueEntries: [expect.objectContaining({ media_kind: "radio" })] });
  window.dispatchEvent(new Event("pagehide"));
  expect(sessions.loadPlayerSession().queueEntries).toHaveLength(1);
  await advanceDemoAndRadio();
  await recovery;
  expect(runtime.getState()).toMatchObject({ isLive: true, paused: false, playbackIntent: "playing", restorationStatus: "restored" });
  expect(runtime.getState().queue.map((track) => track.name)).toEqual([station().name]);
});

it("rolls back a blocked demo and retries from the existing Play action", async () => {
  const sessions = await seedRadioSession();
  const play = vi.spyOn(window.Audio.prototype, "play").mockRejectedValue(new DOMException("Blocked", "NotAllowedError"));
  const recovery = runtime.restoreSession([focusTrack], { autoplay: true });
  await flush();
  await vi.advanceTimersByTimeAsync(5300);
  await recovery;
  expect(runtime.getState()).toMatchObject({ isLive: true, paused: true, playbackIntent: "playing", restorationStatus: "blocked", currentTrack: expect.objectContaining({ name: station().name }) });
  expect(sessions.loadPlayerSession().currentEntryId).toBe("saved-radio");
  expect(system.getBackgroundAudioState().activeLeaseIds).not.toContain("player-runtime");
  play.mockRestore();
  const retry = runtime.play({ fromUserGesture: true });
  await flush();
  expect(runtime.getAudioElement().src).toBe("blob:music");
  await advanceDemoAndRadio();
  await retry;
  expect(runtime.getState()).toMatchObject({ isLive: true, paused: false });
});

it("explicit Pause during takeover restores the station and cancels all late handoff work", async () => {
  const sessions = await seedRadioSession();
  const recovery = runtime.restoreSession([focusTrack], { autoplay: true });
  await flush();
  const demo = runtime.getAudioElement();
  runtime.pause();
  demo.currentTime = 1;
  demo.dispatchEvent(new Event("timeupdate"));
  await vi.advanceTimersByTimeAsync(5300);
  await recovery;
  expect(runtime.getState()).toMatchObject({ isLive: true, paused: true, playbackIntent: "paused", currentTrack: expect.objectContaining({ name: station().name }) });
  expect(runtime.getState().queue).toHaveLength(1);
  expect(sessions.loadPlayerSession()).toMatchObject({ playbackIntent: "paused", currentEntryId: "saved-radio" });
});

it("Stop while boot preparation is pending prevents late autoplay", async () => {
  await seedRadioSession();
  let ready;
  const recovery = runtime.restoreSession([], { autoplay: true, prepareTracks: new Promise((resolve) => { ready = resolve; }) });
  expect(runtime.getState().currentTrack?.name).toBe(station().name);
  runtime.stopPlayback();
  ready([focusTrack]);
  await recovery;
  expect(runtime.getState()).toMatchObject({ currentTrack: null, paused: true, playbackIntent: "stopped" });
  expect(system.getBackgroundAudioState().activeLeaseIds).not.toContain("player-runtime");
});

it("page return does not restart an element that is still playing", async () => {
  await runtime.playTrackNow(station());
  const play = vi.spyOn(runtime.getAudioElement(), "play");
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  document.dispatchEvent(new Event("resume"));
  await flush();
  expect(play).not.toHaveBeenCalled();
});

it("freeze flushes finite playback position and resume coalesces with pageshow", async () => {
  runtime.setQueue([focusTrack], { autoplay: true });
  await flush();
  const el = runtime.getAudioElement();
  el.currentTime = 24.5;
  document.dispatchEvent(new Event("freeze"));
  const sessions = await import("../../src/shared/player-session.js");
  expect(sessions.loadPlayerSession()).toMatchObject({ currentTime: 24.5, playbackIntent: "playing" });
  el.pause();
  const play = vi.spyOn(el, "play");
  document.dispatchEvent(new Event("resume"));
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await flush();
  expect(play).toHaveBeenCalledTimes(1);
  expect(runtime.getState().currentTime).toBe(24.5);
});

it("a stopped session retains its queue without selecting or starting a track", async () => {
  const sessions = await seedRadioSession();
  sessions.savePlayerSession({ playbackIntent: "stopped" });
  await runtime.restoreSession([focusTrack], { autoplay: true });
  expect(runtime.getState()).toMatchObject({ currentIndex: -1, currentTrack: null, playbackIntent: "stopped", paused: true });
  expect(runtime.getState().queue).toHaveLength(1);
});

it("restores library continuation and its shuffle history", async () => {
  const sessions = await import("../../src/shared/player-session.js");
  const second = { ...focusTrack, name: "demo:second", src: "/audio/demo/second.mp3" };
  await runtime.playLibraryTrackNow(focusTrack, [focusTrack, second]);
  runtime.pause();
  const saved = sessions.loadPlayerSession();
  expect(saved.libraryContinuation).toMatchObject({ lastTrackName: focusTrack.name, shuffleCycle: [focusTrack.name] });
  runtime.stopPlayback();
  sessions.savePlayerSession(saved);
  await runtime.restoreSession([focusTrack, second], { autoplay: false });
  await runtime.nextTrack();
  await flush();
  expect(runtime.getState().currentTrack?.name).toBe(second.name);
});

it("reports a suspended AudioContext as blocked and the Play action can resume it", async () => {
  runtime.setQueue([focusTrack], { autoplay: false });
  await flush();
  const registry = await import("../../src/shared/audio-graph-registry.js");
  const graph = { audioContext: { state: "suspended" } };
  vi.spyOn(registry, "getGraph").mockReturnValue(graph);
  await runtime.play();
  expect(runtime.getState()).toMatchObject({ paused: true, playbackIntent: "playing", restorationStatus: "blocked" });
  expect(system.getBackgroundAudioState().activeLeaseIds).not.toContain("player-runtime");
  graph.audioContext.state = "running";
  await runtime.play({ fromUserGesture: true });
  expect(runtime.getState()).toMatchObject({ paused: false, playing: true });
});

it("ownership loss cancels playback without clearing saved playing intent or service leases", async () => {
  await system.acquireBackgroundAudioLease("recording");
  await runtime.playTrackNow(station());
  window.__vatioboardSpa = true;
  window.dispatchEvent(new CustomEvent("vatioboard:single-tab-ownership", { detail: { owned: false } }));
  expect(runtime.getAudioElement().paused).toBe(true);
  const sessions = await import("../../src/shared/player-session.js");
  expect(sessions.loadPlayerSession().playbackIntent).toBe("playing");
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual(["recording"]);
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await flush();
  expect(runtime.getAudioElement().paused).toBe(true);
  delete window.__vatioboardSpa;
});

it("a blocked tab cannot overwrite the owning tab's newer session on pagehide", async () => {
  await runtime.playTrackNow(station());
  window.__vatioboardSpa = true;
  const sessions = await import("../../src/shared/player-session.js");
  sessions.savePlayerSession({ queueEntries: [{ ...station("newer"), entryId: "newer" }], currentEntryId: "newer", currentIndex: 0, paused: false });
  window.dispatchEvent(new Event("pagehide"));
  expect(sessions.loadPlayerSession().currentEntryId).toBe("newer");
  delete window.__vatioboardSpa;
});

it("an unavailable restored source is attempted once and preserves its position", async () => {
  const sources = await import("../../src/shared/audio-source-resolver.js");
  sources.resolveAudioSource.mockResolvedValue(null);
  const sessions = await import("../../src/shared/player-session.js");
  sessions.savePlayerSession({ queueEntries: [{ ...focusTrack, entryId: "missing" }], currentEntryId: "missing", currentIndex: 0, currentTime: 19, paused: false });
  await runtime.restoreSession([], { autoplay: true });
  expect(sources.resolveAudioSource).toHaveBeenCalledTimes(1);
  expect(runtime.getState()).toMatchObject({ currentTime: 19, playbackIntent: "playing", restorationStatus: "failed", currentTrack: { name: focusTrack.name } });
});

it("preserves queue edits made while the automatic demo handoff is running", async () => {
  const sessions = await seedRadioSession();
  const recovery = runtime.restoreSession([focusTrack], { autoplay: true });
  await flush();
  runtime.enqueue([{ ...focusTrack, name: "demo:later" }]);
  runtime.playNext([{ ...focusTrack, name: "demo:next" }]);
  runtime.removeFromQueue("demo:later");
  window.dispatchEvent(new Event("pagehide"));
  expect(sessions.loadPlayerSession().queueEntries.map((entry) => entry.name)).toEqual([station().name, "demo:next"]);
  await advanceDemoAndRadio();
  await recovery;
  expect(runtime.getState().queue.map((track) => track.name)).toEqual([station().name, "demo:next"]);
});

it("a Play tap before demo metadata arrives still uses the tested radio handoff", async () => {
  await seedRadioSession();
  let prepare;
  const recovery = runtime.restoreSession([], { autoplay: true, prepareTracks: new Promise((resolve) => { prepare = resolve; }) });
  const manual = runtime.play({ fromUserGesture: true });
  prepare([focusTrack]);
  await flush();
  expect(runtime.getAudioElement().src).toBe("blob:music");
  await advanceDemoAndRadio();
  await Promise.all([manual, recovery]);
  expect(runtime.getState()).toMatchObject({ isLive: true, playing: true });
});

it("Play after cancelling a track load resolves the selected track rather than playing the previous source", async () => {
  runtime.setQueue([focusTrack], { autoplay: true });
  await flush();
  runtime.getAudioElement().currentTime = 42;
  const sources = await import("../../src/shared/audio-source-resolver.js");
  let resolve;
  sources.resolveAudioSource.mockImplementationOnce(() => new Promise((ready) => { resolve = ready; }));
  const selected = { ...focusTrack, name: "demo:selected" };
  const loading = runtime.playLibraryTrackNow(selected, [selected]);
  await flush();
  runtime.getAudioElement().dispatchEvent(new Event("timeupdate"));
  runtime.getAudioElement().dispatchEvent(new Event("loadedmetadata"));
  runtime.pause();
  expect(runtime.getState().currentTime).toBe(0);
  resolve({ src: "blob:stale", type: "blob", transport: "local" });
  await loading;
  sources.resolveAudioSource.mockResolvedValue({ src: "blob:selected", type: "blob", transport: "local" });
  await runtime.play({ fromUserGesture: true });
  expect(runtime.getAudioElement().src).toBe("blob:selected");
  expect(runtime.getState().currentTrack.name).toBe("demo:selected");
});


it("bounds stalled visual preparation and leaves native audio and independent leases intact", async () => {
  await system.acquireBackgroundAudioLease("recording");
  await runtime.playTrackNow(station());
  const native = runtime.getAudioElement();
  const registry = await import("../../src/shared/audio-graph-registry.js");
  let finish;
  vi.spyOn(registry, "acquireGraph").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const owner = Symbol("scope");
  const attempt = runtime.requestRadioVisualization(owner);
  await vi.advanceTimersByTimeAsync(8000);
  await expect(attempt).resolves.toBe(false);
  expect(runtime.getRadioVisualizationStatus()).toBe("unavailable");
  runtime.releaseRadioVisualization(owner);
  finish({ audioContext: { state: "running" } }); await flush();
  expect(runtime.getRadioVisualizationStatus()).toBe("unavailable");
  expect(native.paused).toBe(false);
  expect(runtime.getState().currentTrack.name).toBe("radio:one");
  expect(system.getBackgroundAudioState().activeLeaseIds).toContain("recording");
});

it.each(["release", "pause", "stop", "station"])("ignores visual preparation after %s", async (action) => {
  await runtime.playTrackNow(station());
  const registry = await import("../../src/shared/audio-graph-registry.js");
  let finish;
  vi.spyOn(registry, "acquireGraph").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const diagnostics = await import("../../src/shared/background-diagnostics.js");
  const record = vi.spyOn(diagnostics, "recordBackgroundDiagnostic");
  const owner = Symbol("scope");
  const attempt = runtime.requestRadioVisualization(owner);
  if (action === "release") runtime.releaseRadioVisualization(owner);
  if (action === "pause") runtime.pause();
  if (action === "stop") runtime.stopPlayback();
  if (action === "station") await runtime.playTrackNow(station("two"));
  await expect(attempt).resolves.toBe(false);
  expect(record).toHaveBeenCalledWith("radio-visualization", expect.objectContaining({ outcome: "cancelled", sourceReady: expect.any(Boolean) }));
  finish({ audioContext: { state: "running" } }); await flush();
  expect(runtime.getRadioVisualizationStatus()).not.toBe("ready");
});

it("rejects a graph whose context remains suspended without changing playback", async () => {
  await runtime.playTrackNow(station());
  const registry = await import("../../src/shared/audio-graph-registry.js");
  vi.spyOn(registry, "acquireGraph").mockResolvedValue({ audioContext: { state: "suspended" } });
  expect(await runtime.requestRadioVisualization(Symbol("scope"))).toBe(false);
  expect(runtime.getAudioElement().paused).toBe(false);
});


it("does not dispose shared Safari PCM when one pending viewer is cancelled", async () => {
  await runtime.playTrackNow(station());
  const pcm = await import("../../src/shared/radio-pcm-analysis.js");
  vi.spyOn(pcm, "requiresRadioPcmAnalysis").mockReturnValue(true);
  vi.spyOn(pcm, "primeRadioPcmAnalysisContext").mockReturnValue(true);
  let finish;
  const graph = { audioContext: { state: "running" }, dispose: vi.fn() };
  const shared = new Promise(resolve => { finish = resolve; });
  vi.spyOn(pcm, "acquireRadioPcmAnalysis").mockReturnValue(shared);
  const scopeOwner = Symbol("scope"), milkdropOwner = Symbol("milkdrop");
  const scope = runtime.requestRadioVisualization(scopeOwner);
  const milkdrop = runtime.requestRadioVisualization(milkdropOwner);
  runtime.releaseRadioVisualization(scopeOwner);
  finish(graph);
  await expect(scope).resolves.toBe(false);
  await expect(milkdrop).resolves.toBe(true);
  expect(graph.dispose).not.toHaveBeenCalled();
  expect(runtime.getRadioAnalysisGraph()).toBe(graph);
});

it("disposes Safari PCM that finishes after a playback cancellation", async () => {
  await runtime.playTrackNow(station());
  const pcm = await import("../../src/shared/radio-pcm-analysis.js");
  vi.spyOn(pcm, "requiresRadioPcmAnalysis").mockReturnValue(true);
  vi.spyOn(pcm, "primeRadioPcmAnalysisContext").mockReturnValue(true);
  let finish;
  const graph = { audioContext: { state: "running" }, dispose: vi.fn() };
  vi.spyOn(pcm, "acquireRadioPcmAnalysis").mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const attempt = runtime.requestRadioVisualization(Symbol("scope"));
  runtime.pause(); await expect(attempt).resolves.toBe(false);
  finish(graph); await flush();
  expect(graph.dispose).toHaveBeenCalledTimes(1);
  expect(runtime.getRadioAnalysisGraph()).toBeNull();
});
