import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UUID = "11111111-1111-4111-8111-111111111111";
const relay = `https://radio-media.vatioboard.com/v1/stations/${UUID}/stream`;
const triggerBackgroundCache = vi.fn();
const registerStationClick = vi.fn().mockResolvedValue(true);
const resumeVisualizerGraphForElement = vi.fn().mockResolvedValue(true);
let preparedGraphs = new WeakMap();
const destroyVisualizerGraphForElement = vi.fn((element) => preparedGraphs.delete(element));
const getVisualizerGraph = vi.fn((element) => preparedGraphs.get(element) || null);
const primeAudioContext = vi.fn(() => true);
const prepareGraphForElement = vi.fn(async (element) => {
  if (!preparedGraphs.has(element)) {
    preparedGraphs.set(element, { audioContext: { state: "running" } });
  }
  return true;
});
const activeBackgroundLeaseIds = new Set();
const acquireBackgroundAudioLease = vi.fn(async (leaseId) => {
  activeBackgroundLeaseIds.add(leaseId);
  return true;
});
const releaseBackgroundAudioLease = vi.fn((leaseId) => activeBackgroundLeaseIds.delete(leaseId));


vi.mock("../../src/shared/audio-source-resolver.js", () => ({
  triggerBackgroundCache,
  resolveRadioSource: vi.fn((track) => track?.media_kind === "radio" && Number(track?.hls) === 1
    ? null
    : track?.media_kind === "radio" ? ({
      src: track.url_resolved || relay,
      sourceType: "live",
      sourceTransport: track.url_resolved ? "radio-direct" : "radio-relay",
      isLive: true,
      type: "live",
      transport: "radio-relay",
      live: true,
      seekable: false,
      cacheable: false,
      analysisEligible: false,
      stationUuid: UUID,
      revokeUrl() {},
    }) : null),
  resolveAudioSource: vi.fn(async (_name, track) => track?.media_kind === "radio" ? null : ({
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
vi.mock("../../src/shared/audio-channel-retainer.js", () => ({
  primeAudioElement: vi.fn().mockResolvedValue(true),
  createSilentLoopAudioUrl: () => "blob:primary-prime",
  resetAudioElementPlaybackRate: vi.fn(),
}));
vi.mock("../../src/shared/audio-system.js", () => {
  const background = new EventTarget();
  background.paused = true;
  return {
    acquireBackgroundAudioLease,
    setBackgroundAudioCarrier: vi.fn(),
    getBackgroundAudioState: () => ({
      status: activeBackgroundLeaseIds.size > 0 ? "armed" : "idle",
      activeLeaseIds: Array.from(activeBackgroundLeaseIds),
      lastInterruption: null,
      revision: 0,
    }),
    getBackgroundKeepAliveAudio: () => background,
    isBackgroundAudioLeaseActive: (leaseId) => activeBackgroundLeaseIds.has(leaseId),
    rearmBackgroundAudio: vi.fn().mockResolvedValue(true),
    activateBackgroundAudioFromGesture: vi.fn().mockResolvedValue(true),
    registerBackgroundAudioGestureHandler: () => () => {},
    recoverBackgroundAudioAutomatically: vi.fn(),
    releaseBackgroundAudioLease,
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
  prepareGraphForElement,
  primeAudioContext,
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
  getRadioRelayHealth: vi.fn().mockResolvedValue({
    ok: true, status: "ready", environment: "development", version: "test",
  }),
  probeRadioStation: vi.fn().mockResolvedValue({
    ok: true, outcome: "ready", stage: "content", version: "test",
  }),
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
    destroyVisualizerGraphForElement.mockClear();
    resumeVisualizerGraphForElement.mockReset().mockResolvedValue(true);
    preparedGraphs = new WeakMap();
    getVisualizerGraph.mockReset().mockImplementation((element) => preparedGraphs.get(element) || null);
    prepareGraphForElement.mockReset().mockImplementation(async (element) => {
      if (!preparedGraphs.has(element)) {
        preparedGraphs.set(element, { audioContext: { state: "running" } });
      }
      return true;
    });
    primeAudioContext.mockReset().mockReturnValue(true);
    activeBackgroundLeaseIds.clear();
    acquireBackgroundAudioLease.mockReset().mockImplementation(async (leaseId) => {
      activeBackgroundLeaseIds.add(leaseId);
      return true;
    });
    releaseBackgroundAudioLease.mockReset().mockImplementation((leaseId) => activeBackgroundLeaseIds.delete(leaseId));
    const audioSession = new EventTarget();
    Object.assign(audioSession, { type: "auto", state: "inactive" });
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      value: audioSession,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class { state = "running"; },
    });
    localStorage.clear();
  });

  afterEach(() => vi.useRealTimers());

  it("plays direct radio without CORS and never primes or visualizes it on rearm", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    const { primeAudioElement } = await import("../../src/shared/audio-channel-retainer.js");
    primeAudioElement.mockClear();
    const beforePlay = vi.fn();
    const track = { name: `radio:${UUID}`, title: "Direct", media_kind: "radio",
      station_uuid: UUID, hls: 0, url_resolved: "https://stream.example/live" };
    await runtime.playTrackNow(track, { fromUserGesture: true, beforePlay });
    const element = runtime.getAudioElement();
    expect(element.src).toBe(track.url_resolved);
    expect(element.crossOrigin).toBeNull();
    expect(runtime.getState()).toMatchObject({ analysisEligible: false, sourceTransport: "radio-direct" });
    expect(beforePlay).not.toHaveBeenCalled();
    runtime.pause();
    await runtime.primeAudio();
    await runtime.rearmBackgroundPlayback();
    expect(primeAudioElement).not.toHaveBeenCalled();
    expect(element.paused).toBe(true);
    expect(element.src).toBe(track.url_resolved);
    await runtime.playTrackNow({ ...track, name: "radio:next" }, { fromUserGesture: true });
    expect(runtime.getAudioElement()).toBe(element);
    expect(preparedGraphs.has(element)).toBe(false);
  });

  it("keeps bounded radio retries on the native relay channel and never caches", async () => {
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
      sourceTransport: "radio-relay",
      isLive: true,
      seekable: false,
      cacheable: false,
      analysisEligible: false,
      connectionState: "connecting",
    });
    expect(element.preload).toBe("none");

    element.dispatchEvent(new Event("error"));
    await flushMicrotasks();
    expect(runtime.getAudioElement()).toBe(element);
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(element.src).toBe(relay);
    expect(element.crossOrigin).toBe("anonymous");

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
      error: "radio-relay-failed",
      paused: false,
      recoveryRequired: true,
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

  it("marks a 12-second connection as slow without resetting the source, then cancels stale work", async () => {
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
    const initialSrc = element.src;
    element.play = vi.fn(element.play.bind(element));
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    vi.advanceTimersByTime(11_999);
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    vi.advanceTimersByTime(1);
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(runtime.getState().connectionState).toBe("slow");
    expect(element.src).toBe(initialSrc);
    expect(element.play).not.toHaveBeenCalled();

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

  it("rejects HLS without advancing or installing platform handlers", async () => {
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
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    expect(navigator.mediaSession.setActionHandler).not.toHaveBeenCalled();

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
      paused: false,
      recoveryRequired: true,
    });
  });

  it("starts the real radio synchronously before retention and skips visualization", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    const order = [];
    acquireBackgroundAudioLease.mockImplementationOnce(() => {
      order.push("lease");
      return Promise.resolve(true);
    });
    const nativePlay = HTMLMediaElement.prototype.play;
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () {
      expect(navigator.audioSession.type).toBe("auto");
      order.push("play");
      return nativePlay.call(this);
    });

    const selection = runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, {
      fromUserGesture: true,
      beforePlay: (audioElement) => {
        expect(audioElement.src).toBe(relay);
        order.push("visualizer");
      },
    });

    const element = runtime.getAudioElement();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(element.src).toBe(relay);
    expect(order).toEqual(["play", "lease"]);
    expect(acquireBackgroundAudioLease).toHaveBeenCalledTimes(1);
    expect(registerStationClick).not.toHaveBeenCalled();
    expect(navigator.mediaSession.setActionHandler).not.toHaveBeenCalled();
    expect(runtime.getState().connectionState).toBe("connecting");
    element.dispatchEvent(new Event("playing"));
    expect(order).toEqual(["play", "lease"]);
    await selection;
    playSpy.mockRestore();
  });

  it("retains Player ownership but replaces an incompatible graph across station changes", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });
    runtime.getAudioElement().dispatchEvent(new Event("playing"));
    releaseBackgroundAudioLease.mockClear();
    const visualElement = runtime.getAudioElement();
    preparedGraphs.set(visualElement, { audioContext: { state: "running" } });
    expect(runtime.getState()).toMatchObject({
      analysisEligible: false,
      sourceTransport: "radio-relay",
    });
    expect(prepareGraphForElement).not.toHaveBeenCalled();

    await runtime.playTrackNow({
      name: "radio:second",
      title: "Second Radio",
      media_kind: "radio",
      station_uuid: "22222222-2222-4222-8222-222222222222",
      hls: 0,
    }, { fromUserGesture: true });

    expect(runtime.getAudioElement()).not.toBe(visualElement);
    expect(runtime.getState()).toMatchObject({
      analysisEligible: false,
      sourceTransport: "radio-relay",
    });
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    expect(runtime.getAudioElement()).not.toBe(visualElement);
    expect(preparedGraphs.has(visualElement)).toBe(false);
    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(visualElement);
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    runtime.pause();
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();
    runtime.stopPlayback();
    expect(releaseBackgroundAudioLease).toHaveBeenCalledWith("player-runtime");
  });

  it("leaves Audio Session type unchanged through Play, Pause and Stop", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });
    expect(navigator.audioSession.type).toBe("auto");
    runtime.pause();
    expect(navigator.audioSession.type).toBe("auto");
    runtime.stopPlayback();
    expect(navigator.audioSession.type).toBe("auto");
  });

  it("keeps Radio audible on the shared element when Web Audio is unsupported", async () => {
    Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Native Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });

    expect(runtime.getState()).toMatchObject({
      sourceTransport: "radio-relay",
      analysisEligible: false,
      connectionState: "connecting",
    });
    expect(runtime.getAudioElement().src).toBe(relay);
    expect(runtime.getAudioElement().crossOrigin).toBe("anonymous");
  });

  it("respects a native pause and resumes only through Player Play", async () => {
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

    await vi.advanceTimersByTimeAsync(1500);
    element.pause();
    expect(element.play).not.toHaveBeenCalled();

    expect(runtime.getState().paused).toBe(true);
    expect(element.src).toBe(relay);

    await runtime.reconcileBackgroundPlayback("visibility-visible");
    expect(element.play).not.toHaveBeenCalled();
    await runtime.play();
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it("retains the same source, graph, and leases through Audio Session interruption", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });
    await flushMicrotasks();
    const element = runtime.getAudioElement();
    const graph = preparedGraphs.get(element);
    element.dispatchEvent(new Event("playing"));
    releaseBackgroundAudioLease.mockClear();

    navigator.audioSession.state = "interrupted";
    navigator.audioSession.dispatchEvent(new Event("statechange"));
    element.pause();
    element.dispatchEvent(new Event("error"));

    expect(runtime.getAudioElement()).toBe(element);
    expect(element.src).toBe(relay);
    expect(preparedGraphs.get(element)).toBe(graph);
    expect(runtime.getState().connectionState).toBe("reconnecting");
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    const nativePlay = element.play.bind(element);
    element.play = vi.fn(nativePlay);
    navigator.audioSession.state = "active";
    navigator.audioSession.dispatchEvent(new Event("statechange"));
    await flushMicrotasks();
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(runtime.getAudioElement()).toBe(element);
  });

  it("does not reset or retry a live source while the document is hidden", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });
    await flushMicrotasks();
    const element = runtime.getAudioElement();
    const graph = preparedGraphs.get(element);
    element.dispatchEvent(new Event("playing"));
    const nativePlay = element.play.bind(element);
    element.play = vi.fn(nativePlay);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    element.pause();
    element.dispatchEvent(new Event("error"));
    await runtime.reconcileBackgroundPlayback("visibility-hidden");
    expect(element.play).not.toHaveBeenCalled();
    expect(element.src).toBe(relay);
    expect(preparedGraphs.get(element)).toBe(graph);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await runtime.reconcileBackgroundPlayback("visibility-visible");
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(runtime.getAudioElement()).toBe(element);
  });

  it("retries an established relay stream without migrating to native playback", async () => {
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
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(runtime.getState().connectionState).toBe("reconnecting");

    element.dispatchEvent(new Event("error"));
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(element.src).toBe(relay);

    vi.advanceTimersByTime(5_000);
    element.dispatchEvent(new Event("playing"));
    expect(runtime.getState().connectionState).toBe("playing");
  });

  it("replaces the graph-backed MP3 channel for native radio without disturbing shared owners", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    const audioSystem = await import("../../src/shared/audio-system.js");
    runtime.setQueue([{
      name: "demo.mp3",
      title: "Demo MP3",
      media_kind: "audio",
    }], { autoplay: true });
    await flushMicrotasks();
    const musicElement = runtime.getAudioElement();
    const musicGraph = { audioContext: { state: "running", close: vi.fn() } };
    preparedGraphs.set(musicElement, musicGraph);
    musicElement.dispatchEvent(new Event("playing"));
    runtime.pause();

    const keepAliveElement = audioSystem.getBackgroundKeepAliveAudio();
    await audioSystem.acquireBackgroundAudioLease("speed-alerts");
    releaseBackgroundAudioLease.mockClear();
    const order = [];
    acquireBackgroundAudioLease.mockImplementation((leaseId) => {
      activeBackgroundLeaseIds.add(leaseId);
      if (leaseId === "player-runtime") order.push("player-lease");
      return Promise.resolve(true);
    });
    const nativePlay = HTMLMediaElement.prototype.play;
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () {
      order.push("radio-play");
      return nativePlay.call(this);
    });

    const selection = runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });

    const radioElement = runtime.getAudioElement();
    expect(radioElement).not.toBe(musicElement);
    expect(radioElement.src).toBe(relay);
    expect(preparedGraphs.has(musicElement)).toBe(false);
    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(musicElement);
    expect(audioSystem.getBackgroundKeepAliveAudio()).toBe(keepAliveElement);
    expect(audioSystem.getBackgroundAudioState().activeLeaseIds).toEqual([
      "player-runtime",
      "speed-alerts",
    ]);
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();
    expect(order).toEqual(["radio-play"]);
    expect(runtime.getState()).toMatchObject({
      sourceTransport: "radio-relay",
      analysisEligible: false,
    });
    await selection;

    radioElement.dispatchEvent(new Event("playing"));
    releaseBackgroundAudioLease.mockClear();
    await runtime.playTrackNow({
      name: "demo-return.mp3",
      title: "Demo Return",
      media_kind: "audio",
    }, { fromUserGesture: true });
    expect(runtime.getAudioElement()).toBe(radioElement);
    expect(preparedGraphs.has(musicElement)).toBe(false);
    expect(radioElement.src).toContain("blob:demo-return.mp3");
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    musicElement.dispatchEvent(new Event("playing"));
    expect(preparedGraphs.has(musicElement)).toBe(false);
    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(musicElement);

    runtime.stopPlayback();
    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(musicElement);
    expect(runtime.getAudioElement()).toBe(radioElement);
    playSpy.mockRestore();
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
      sourceTransport: "radio-relay",
      recoveryRequired: true,
      error: "background-playback-blocked",
      paused: false,
    });
    expect(navigator.mediaSession.setActionHandler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(runtime.getState().connectionState).not.toBe("unavailable");
  });

  it("rearms interrupted radio on the same shared element", async () => {
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

    expect(await runtime.rearmBackgroundPlayback()).toBe(true);
    expect(runtime.getAudioElement()).toBe(previousElement);
    expect(runtime.getAudioElement().src).toBe(relay);
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

  it("keeps graph recovery on the same radio element without changing transport state", async () => {
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
    const visualizerElement = element;
    preparedGraphs.set(visualizerElement, { audioContext: { state: "suspended" } });
    visualizerElement.dispatchEvent(new Event("playing"));
    visualizerElement.paused = true;
    getVisualizerGraph.mockReturnValue({ audioContext: { state: "suspended" } });
    resumeVisualizerGraphForElement.mockImplementation(() => new Promise(() => {}));

    const reconciliation = runtime.reconcileBackgroundPlayback("resume", Date.now());
    expect(visualizerElement.paused).toBe(false);
    vi.advanceTimersByTime(1_000);
    await reconciliation;

    expect(runtime.getState()).toMatchObject({
      recoveryRequired: false,
      error: null,
      connectionState: "connecting",
    });
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(runtime.getAudioElement()).toBe(visualizerElement);
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    resumeVisualizerGraphForElement.mockResolvedValue(true);
    expect(await runtime.rearmBackgroundPlayback()).toBe(true);
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(runtime.getAudioElement()).toBe(visualizerElement);
  });

  it("Player Play reconciles a paused element even when runtime state said playing", async () => {
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
    await runtime.play();
    await flushMicrotasks();

    expect(element.play).toHaveBeenCalledTimes(1);
    expect(element.paused).toBe(false);
  });
});
