import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UUID = "11111111-1111-4111-8111-111111111111";
const relay = `https://radio-media.vatioboard.com/v1/stations/${UUID}/stream`;
const triggerBackgroundCache = vi.fn();
const registerStationClick = vi.fn().mockResolvedValue(true);
const updateMediaSessionClient = vi.fn();
const resumeVisualizerGraphForElement = vi.fn().mockResolvedValue(true);
const destroyVisualizerGraphForElement = vi.fn(() => false);
const getVisualizerGraph = vi.fn(() => null);

vi.mock("../../src/shared/audio-source-resolver.js", () => ({
  triggerBackgroundCache,
  resolveAudioSource: vi.fn(async (_name, track) => track?.media_kind === "radio" && Number(track?.hls) === 1
    ? null
    : track?.media_kind === "radio" ? ({
      src: "https://direct.example.com/live.mp3",
      sourceType: "live",
      sourceTransport: "radio-direct-cors",
      isLive: true,
      type: "live",
      transport: "radio-direct-cors",
      live: true,
      seekable: false,
      cacheable: false,
      analysisEligible: true,
      fallbackSrc: relay,
      stationUuid: UUID,
      revokeUrl() {},
    }) : ({
      src: `blob:${track?.name || "finite"}`,
      sourceType: "blob",
      sourceTransport: "local",
      isLive: false,
      type: "blob",
      transport: "local",
      live: false,
      seekable: true,
      cacheable: false,
      analysisEligible: true,
      revokeUrl() {},
    })),
}));
vi.mock("../../src/shared/media-session-adapter.js", () => ({
  clearMediaSessionClient: vi.fn(),
  updateMediaSessionClient,
}));
vi.mock("../../src/shared/audio-channel-retainer.js", () => ({
  primeAudioElement: vi.fn().mockResolvedValue(true),
  resetAudioElementPlaybackRate: vi.fn(),
}));
vi.mock("../../src/shared/audio-system.js", () => {
  const background = new EventTarget();
  background.paused = true;
  return {
    acquireBackgroundAudioLease: vi.fn().mockResolvedValue(true),
    getBackgroundAudioState: () => ({ status: "idle", activeLeaseIds: [], lastInterruption: null, revision: 0 }),
    getBackgroundKeepAliveAudio: () => background,
    isBackgroundAudioLeaseActive: () => false,
    rearmBackgroundAudio: vi.fn().mockResolvedValue(true),
    releaseBackgroundAudioLease: vi.fn(),
    subscribeBackgroundAudioState: (listener) => {
      listener({ status: "idle", activeLeaseIds: [], lastInterruption: null, revision: 0 });
      return () => {};
    },
  };
});
vi.mock("../../src/shared/audio-cue.js", () => ({ setMainAudioElement: vi.fn() }));
vi.mock("../../src/shared/audio-mini-visualizer.js", () => ({
  destroyVisualizerGraphForElement,
  resumeVisualizerGraphForElement,
}));
vi.mock("../../src/shared/audio-graph-registry.js", () => ({
  getGraph: getVisualizerGraph,
}));
vi.mock("../../src/shared/player-session.js", () => ({
  loadPlayerSession: () => ({
    queueEntries: [], playedEntries: [], currentEntryId: "", currentIndex: -1,
    currentTrackName: "", currentTime: 0, paused: true, volume: 0.88, muted: false,
    repeat: "off", shuffle: false, backgroundMode: false,
  }),
  savePlayerSession: vi.fn(),
}));
vi.mock("../../src/shared/radio-browser.js", () => ({
  getRadioLogoUrl: (uuid) => `https://radio-media.vatioboard.com/v1/stations/${uuid}/logo`,
  radioBrowser: { registerStationClick, getStationByUuid: vi.fn() },
  radioStationToTrack: vi.fn(),
}));

async function flushMicrotasks() {
  for (let count = 0; count < 12; count += 1) await Promise.resolve();
}

describe("live radio audio runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    triggerBackgroundCache.mockClear();
    registerStationClick.mockClear();
    updateMediaSessionClient.mockClear();
    destroyVisualizerGraphForElement.mockClear();
    resumeVisualizerGraphForElement.mockReset().mockResolvedValue(true);
    getVisualizerGraph.mockReset().mockReturnValue(null);
    localStorage.clear();
  });

  afterEach(() => vi.useRealTimers());

  it("falls back on the same element, stays non-seekable, reconnects, and never caches", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    runtime.setQueue([
      { name: "finite-a", title: "A", media_kind: "audio" },
      { name: "finite-b", title: "B", media_kind: "audio" },
    ], { autoplay: false });
    await flushMicrotasks();
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();

    expect(runtime.getState().queue.map((track) => track.name)).toEqual([`radio:${UUID}`, "finite-b"]);
    expect(runtime.getState().playedHistory.map((track) => track.name)).toEqual(["finite-a"]);

    const element = runtime.getAudioElement();
    expect(runtime.getState()).toMatchObject({
      sourceType: "live",
      sourceTransport: "radio-direct-cors",
      isLive: true,
      seekable: false,
      cacheable: false,
      analysisEligible: true,
      connectionState: "connecting",
    });
    expect(element.preload).toBe("none");

    element.dispatchEvent(new Event("error"));
    await flushMicrotasks();
    expect(runtime.getAudioElement()).toBe(element);
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(element.src).toBe(relay);

    element.dispatchEvent(new Event("playing"));
    expect(runtime.getState().connectionState).toBe("playing");
    expect(registerStationClick).toHaveBeenCalledTimes(1);
    runtime.seekTo(25);
    expect(element.currentTime).toBe(0);
    expect(triggerBackgroundCache).not.toHaveBeenCalled();

    element.dispatchEvent(new Event("ended"));
    expect(runtime.getState().connectionState).toBe("reconnecting");
    element.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(5_000);
    await flushMicrotasks();
    element.dispatchEvent(new Event("error"));
    expect(runtime.getState()).toMatchObject({
      currentTrack: { station_uuid: UUID },
      connectionState: "unavailable",
      error: "station-unavailable",
      paused: true,
    });

    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
  });

  it("uses the 12-second timeout once, then cancels stale fallback work on track change", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();

    const element = runtime.getAudioElement();
    expect(runtime.getState().sourceTransport).toBe("radio-direct-cors");
    vi.advanceTimersByTime(11_999);
    expect(runtime.getState().sourceTransport).toBe("radio-direct-cors");
    vi.advanceTimersByTime(1);
    expect(runtime.getState().sourceTransport).toBe("radio-relay");

    runtime.setQueue([{ name: "finite-next", title: "Next", media_kind: "audio" }], { autoplay: false });
    await flushMicrotasks();
    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(runtime.getState()).toMatchObject({
      currentTrack: { name: "finite-next" },
      isLive: false,
      sourceTransport: "local",
    });
    expect(element.src).toContain("blob:finite-next");
  });

  it("rejects HLS without advancing and clears Media Session seek/position support for live", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      artwork_ref: `https://radio-media.vatioboard.com/v1/stations/${UUID}/logo`,
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();
    runtime.getAudioElement().dispatchEvent(new Event("playing"));

    const liveUpdates = updateMediaSessionClient.mock.calls.map((call) => call[1]);
    const handlers = liveUpdates.find((update) => update?.handlers)?.handlers;
    expect(handlers).toEqual(expect.objectContaining({
      play: expect.any(Function),
      pause: expect.any(Function),
      stop: expect.any(Function),
      previoustrack: expect.any(Function),
      nexttrack: expect.any(Function),
    }));
    expect(handlers).not.toHaveProperty("seekto");
    expect(liveUpdates).toContainEqual(expect.objectContaining({ positionState: null }));

    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Unsupported Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 1,
    });
    await flushMicrotasks();
    expect(runtime.getState()).toMatchObject({
      currentTrack: { title: "Unsupported Radio" },
      connectionState: "unavailable",
      error: "unsupported-hls",
      paused: true,
    });
  });

  it("requests native playback without waiting for Web Audio to resume", async () => {
    let releaseGraphResume;
    resumeVisualizerGraphForElement.mockImplementation(() => new Promise((resolve) => {
      releaseGraphResume = resolve;
    }));
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.primeAudio();
    const element = runtime.getAudioElement();
    const nativePlay = element.play.bind(element);
    element.play = vi.fn(nativePlay);

    const selection = runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();

    expect(element.play).toHaveBeenCalledTimes(1);
    expect(runtime.getState().connectionState).toBe("connecting");
    await selection;
    releaseGraphResume?.(true);
  });

  it("recovers an unexpected live pause but ignores a pause caused by source setup", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();
    const element = runtime.getAudioElement();
    const nativePlay = element.play.bind(element);
    element.play = vi.fn(nativePlay);
    element.dispatchEvent(new Event("playing"));

    element.pause();
    expect(element.play).not.toHaveBeenCalled();

    vi.advanceTimersByTime(251);
    element.pause();
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(runtime.getState().connectionState).toBe("reconnecting");
  });

  it("moves an established direct stream to relay after its immediate direct retry fails", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();
    const element = runtime.getAudioElement();
    element.dispatchEvent(new Event("playing"));

    element.dispatchEvent(new Event("error"));
    expect(runtime.getState().sourceTransport).toBe("radio-direct-cors");
    expect(runtime.getState().connectionState).toBe("reconnecting");

    element.dispatchEvent(new Event("error"));
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(element.src).toBe(relay);

    element.dispatchEvent(new Event("error"));
    expect(runtime.getState().connectionState).toBe("reconnecting");
    element.dispatchEvent(new Event("playing"));
    vi.advanceTimersByTime(5_000);
    expect(runtime.getState().connectionState).toBe("playing");
  });

  it("turns autoplay blocking into recoverable state without consuming network retries", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    runtime.setQueue([{
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }], { autoplay: false });
    await flushMicrotasks();
    const element = runtime.getAudioElement();
    element.play = vi.fn().mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));

    await runtime.play();
    await flushMicrotasks();

    expect(runtime.getState()).toMatchObject({
      currentTrack: { station_uuid: UUID },
      sourceTransport: "radio-direct-cors",
      recoveryRequired: true,
      error: "background-playback-blocked",
      paused: false,
    });
    expect(updateMediaSessionClient.mock.calls.at(-1)?.[1]?.playbackState).toBe("playing");
    vi.advanceTimersByTime(60_000);
    expect(runtime.getState().connectionState).not.toBe("unavailable");
  });

  it("replaces the managed element once for native-background compatibility", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();
    const previousElement = runtime.getAudioElement();

    expect(await runtime.rearmBackgroundPlayback({ preferNative: true })).toBe(true);
    const replacement = runtime.getAudioElement();

    expect(replacement).not.toBe(previousElement);
    expect(previousElement.src).toBe("");
    expect(runtime.getState()).toMatchObject({
      outputMode: "native-background",
      analysisActive: false,
      connectionState: "connecting",
    });
    replacement.dispatchEvent(new Event("playing"));
    expect(localStorage.getItem("vatioboard.player.radio.native-background.v1")).toBe("1");
  });

  it("uses absolute connection deadlines when lifecycle timers were throttled", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();

    await runtime.reconcileBackgroundPlayback("resume", Date.now() + 12_000);

    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(runtime.getAudioElement().src).toBe(relay);
  });

  it("offers native recovery if an interrupted radio graph cannot resume within one second", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();
    const element = runtime.getAudioElement();
    element.dispatchEvent(new Event("playing"));
    element.paused = true;
    getVisualizerGraph.mockReturnValue({ audioContext: { state: "suspended" } });
    resumeVisualizerGraphForElement.mockImplementation(() => new Promise(() => {}));

    const reconciliation = runtime.reconcileBackgroundPlayback("resume", Date.now());
    expect(element.paused).toBe(false);
    vi.advanceTimersByTime(1_000);
    await reconciliation;

    expect(runtime.getState()).toMatchObject({
      outputMode: "web-audio",
      recoveryRequired: true,
      backgroundPlaybackState: "blocked",
      error: "background-playback-blocked",
    });
    expect(runtime.getState().sourceTransport).toBe("radio-direct-cors");
  });

  it("Media Session Play reconciles a paused element even when runtime state said playing", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    });
    await flushMicrotasks();
    const element = runtime.getAudioElement();
    element.dispatchEvent(new Event("playing"));
    element.paused = true;
    const nativePlay = element.play.bind(element);
    element.play = vi.fn(nativePlay);
    const mediaSessionPlay = updateMediaSessionClient.mock.calls
      .map((call) => call[1]?.handlers?.play)
      .filter(Boolean)
      .at(-1);

    mediaSessionPlay();
    await flushMicrotasks();

    expect(element.play).toHaveBeenCalledTimes(1);
    expect(element.paused).toBe(false);
  });
});
