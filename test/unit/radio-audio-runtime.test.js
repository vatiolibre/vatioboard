import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UUID = "11111111-1111-4111-8111-111111111111";
const relay = `https://radio-media.vatioboard.com/v1/stations/${UUID}/stream`;
const triggerBackgroundCache = vi.fn();
const registerStationClick = vi.fn().mockResolvedValue(true);
const updateMediaSessionClient = vi.fn();
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
const clearMediaSessionClient = vi.fn();
const getNormalizedMediaSessionArtwork = vi.fn().mockResolvedValue([
  { src: "blob:station-artwork", sizes: "512x512", type: "image/png" },
]);

vi.mock("../../src/shared/audio-source-resolver.js", () => ({
  triggerBackgroundCache,
  resolveRadioSource: vi.fn((track) => track?.media_kind === "radio" && Number(track?.hls) === 1
    ? null
    : track?.media_kind === "radio" ? ({
      src: relay,
      sourceType: "live",
      sourceTransport: "radio-relay",
      isLive: true,
      type: "live",
      transport: "radio-relay",
      live: true,
      seekable: false,
      cacheable: false,
      analysisEligible: true,
      candidates: [
        {
          src: relay,
          transport: "radio-relay",
          crossOrigin: "anonymous",
          analysisEligible: true,
          outputMode: "web-audio",
          automaticRecovery: true,
        },
        {
          src: "https://direct.example.com/live.mp3",
          transport: "radio-direct-native",
          crossOrigin: null,
          analysisEligible: false,
          outputMode: "native-background",
          automaticRecovery: false,
        },
        {
          src: relay,
          transport: "radio-relay",
          crossOrigin: "anonymous",
          analysisEligible: false,
          outputMode: "native-background",
          automaticRecovery: false,
        },
      ],
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
vi.mock("../../src/shared/media-session-adapter.js", () => ({
  clearMediaSessionClient,
  updateMediaSessionClient,
}));
vi.mock("../../src/shared/media-session-artwork.js", () => ({
  clearMediaSessionArtworkCache: vi.fn(),
  DEFAULT_PLAYER_ARTWORK: [
    { src: "/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png" },
  ],
  getNormalizedMediaSessionArtwork,
}));
vi.mock("../../src/shared/audio-channel-retainer.js", () => ({
  primeAudioElement: vi.fn().mockResolvedValue(true),
  resetAudioElementPlaybackRate: vi.fn(),
}));
vi.mock("../../src/shared/audio-system.js", () => {
  const background = new EventTarget();
  background.paused = true;
  return {
    acquireBackgroundAudioLease,
    getBackgroundAudioState: () => ({
      status: activeBackgroundLeaseIds.size > 0 ? "armed" : "idle",
      activeLeaseIds: Array.from(activeBackgroundLeaseIds),
      lastInterruption: null,
      revision: 0,
    }),
    getBackgroundKeepAliveAudio: () => background,
    isBackgroundAudioLeaseActive: (leaseId) => activeBackgroundLeaseIds.has(leaseId),
    rearmBackgroundAudio: vi.fn().mockResolvedValue(true),
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
    updateMediaSessionClient.mockClear();
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
    clearMediaSessionClient.mockClear();
    getNormalizedMediaSessionArtwork.mockClear();
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

  it("keeps bounded radio retries on the relay analysis channel and never caches", async () => {
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
      analysisEligible: true,
      outputMode: "web-audio",
      connectionState: "connecting",
    });
    expect(element.preload).toBe("metadata");

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
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

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
    expect(liveUpdates).toContainEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        artwork: [{ src: "blob:station-artwork", sizes: "512x512", type: "image/png" }],
      }),
    }));

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

  it("arms the Player lease before synchronously playing relay radio", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    const order = [];
    acquireBackgroundAudioLease.mockImplementationOnce(() => {
      order.push("lease");
      return Promise.resolve(true);
    });
    const nativePlay = Audio.prototype.play;
    const playSpy = vi.spyOn(Audio.prototype, "play").mockImplementation(function () {
      expect(navigator.audioSession.type).toBe("playback");
      order.push("play");
      return nativePlay.call(this);
    });

    const selection = runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });

    const element = runtime.getAudioElement();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(element.src).toBe(relay);
    expect(order).toEqual(["lease", "play"]);
    expect(acquireBackgroundAudioLease).toHaveBeenCalledTimes(1);
    expect(clearMediaSessionClient).not.toHaveBeenCalled();
    expect(registerStationClick).not.toHaveBeenCalled();
    expect(getNormalizedMediaSessionArtwork).not.toHaveBeenCalled();
    expect(updateMediaSessionClient.mock.calls.some((call) => call[1]?.metadata)).toBe(true);
    expect(runtime.getState().connectionState).toBe("connecting");
    element.dispatchEvent(new Event("playing"));
    expect(order).toEqual(["lease", "play"]);
    await selection;
    playSpy.mockRestore();
  });

  it("retains Player ownership and reuses the relay graph across visual station changes", async () => {
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

    const gestureOrder = [];
    primeAudioContext.mockImplementationOnce(() => {
      gestureOrder.push("prime-context");
      return true;
    });
    prepareGraphForElement.mockImplementationOnce((element) => {
      expect(element.crossOrigin).toBe("anonymous");
      expect(element.src).toBe(relay);
      gestureOrder.push("prepare-graph");
      preparedGraphs.set(element, { audioContext: { state: "running" } });
      return Promise.resolve(true);
    });
    const nativePlay = Audio.prototype.play;
    const visualPlaySpy = vi.spyOn(Audio.prototype, "play").mockImplementation(function () {
      gestureOrder.push("play-relay");
      return nativePlay.call(this);
    });

    await runtime.setRadioVisualizerEnabled(true, { fromUserGesture: true });
    visualPlaySpy.mockRestore();
    const visualElement = runtime.getAudioElement();
    expect(runtime.getState()).toMatchObject({
      outputMode: "web-audio",
      analysisEligible: true,
      sourceTransport: "radio-relay",
    });
    expect(prepareGraphForElement).toHaveBeenCalledWith(visualElement);
    expect(gestureOrder).toEqual(["prime-context", "prepare-graph"]);

    await runtime.playTrackNow({
      name: "radio:second",
      title: "Second Radio",
      media_kind: "radio",
      station_uuid: "22222222-2222-4222-8222-222222222222",
      hls: 0,
    }, { fromUserGesture: true });

    expect(runtime.getAudioElement()).toBe(visualElement);
    expect(runtime.getState()).toMatchObject({
      outputMode: "web-audio",
      analysisEligible: true,
      sourceTransport: "radio-relay",
    });
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    await runtime.setRadioVisualizerEnabled(false, { fromUserGesture: true });
    expect(runtime.getState().outputMode).toBe("web-audio");
    expect(runtime.getAudioElement()).toBe(visualElement);
    expect(preparedGraphs.has(visualElement)).toBe(true);
    expect(destroyVisualizerGraphForElement).not.toHaveBeenCalledWith(visualElement);
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    await runtime.setRadioVisualizerEnabled(true, { fromUserGesture: true });
    expect(runtime.getAudioElement()).toBe(visualElement);
    expect(destroyVisualizerGraphForElement).not.toHaveBeenCalledWith(visualElement);
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    runtime.pause();
    expect(releaseBackgroundAudioLease).toHaveBeenCalledWith("player-runtime");
  });

  it("restores Audio Session auto only when the Player is stopped", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    await runtime.playTrackNow({
      name: `radio:${UUID}`,
      title: "Test Radio",
      media_kind: "radio",
      station_uuid: UUID,
      hls: 0,
    }, { fromUserGesture: true });
    expect(navigator.audioSession.type).toBe("playback");
    runtime.pause();
    expect(navigator.audioSession.type).toBe("playback");
    runtime.stopPlayback();
    expect(navigator.audioSession.type).toBe("auto");
  });

  it("keeps Radio available through relay-native mode when Web Audio is unsupported", async () => {
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
      outputMode: "native-background",
      analysisEligible: false,
      connectionState: "connecting",
    });
    expect(runtime.getAudioElement().src).toBe(relay);
    expect(runtime.getAudioElement().crossOrigin).toBe("anonymous");
  });

  it("retains an unexpectedly paused live source until lifecycle reconciliation", async () => {
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
    expect(element.play).not.toHaveBeenCalled();
    expect(runtime.getState().connectionState).toBe("reconnecting");
    expect(element.src).toBe(relay);

    await runtime.reconcileBackgroundPlayback("visibility-visible");
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

  it("reuses the graph-backed MP3 channel for radio without disturbing shared keep-alive owners", async () => {
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
    const nativePlay = Audio.prototype.play;
    const playSpy = vi.spyOn(Audio.prototype, "play").mockImplementation(function () {
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
    expect(radioElement).toBe(musicElement);
    expect(radioElement.src).toBe(relay);
    expect(preparedGraphs.get(musicElement)).toBe(musicGraph);
    expect(destroyVisualizerGraphForElement).not.toHaveBeenCalledWith(musicElement);
    expect(musicGraph.audioContext.close).not.toHaveBeenCalled();
    expect(audioSystem.getBackgroundKeepAliveAudio()).toBe(keepAliveElement);
    expect(audioSystem.getBackgroundAudioState().activeLeaseIds).toEqual([
      "speed-alerts",
      "player-runtime",
    ]);
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();
    expect(order).toEqual(["player-lease", "radio-play"]);
    expect(runtime.getState()).toMatchObject({
      sourceTransport: "radio-relay",
      outputMode: "web-audio",
      analysisEligible: true,
    });
    await selection;

    radioElement.dispatchEvent(new Event("playing"));
    releaseBackgroundAudioLease.mockClear();
    await runtime.playTrackNow({
      name: "demo-return.mp3",
      title: "Demo Return",
      media_kind: "audio",
    }, { fromUserGesture: true });
    expect(runtime.getAudioElement()).toBe(musicElement);
    expect(preparedGraphs.get(musicElement)).toBe(musicGraph);
    expect(radioElement.src).toContain("blob:demo-return.mp3");
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    musicElement.dispatchEvent(new Event("playing"));
    expect(preparedGraphs.get(musicElement)).toBe(musicGraph);
    expect(destroyVisualizerGraphForElement).not.toHaveBeenCalledWith(musicElement);

    runtime.stopPlayback();
    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(musicElement);
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
    expect(updateMediaSessionClient.mock.calls.at(-1)?.[1]?.playbackState).toBe("playing");
    vi.advanceTimersByTime(60_000);
    expect(runtime.getState().connectionState).not.toBe("unavailable");
  });

  it("uses the native slot only when compatibility playback is explicitly requested", async () => {
    localStorage.setItem("vatioboard.player.radio.native-background.v1", "1");
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
    expect(runtime.getState()).toMatchObject({
      outputMode: "native-background",
      analysisActive: false,
      connectionState: "connecting",
    });
    replacement.dispatchEvent(new Event("playing"));
    expect(localStorage.getItem("vatioboard.player.radio.native-background.v1")).toBeNull();
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

  it("exposes explicit native recovery if the shared radio graph cannot resume", async () => {
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
    await runtime.retryRadioWithVisualizer();
    const visualizerElement = runtime.getAudioElement();
    visualizerElement.dispatchEvent(new Event("playing"));
    visualizerElement.paused = true;
    getVisualizerGraph.mockReturnValue({ audioContext: { state: "suspended" } });
    resumeVisualizerGraphForElement.mockImplementation(() => new Promise(() => {}));

    const reconciliation = runtime.reconcileBackgroundPlayback("resume", Date.now());
    expect(visualizerElement.paused).toBe(false);
    vi.advanceTimersByTime(1_000);
    await reconciliation;

    expect(runtime.getState()).toMatchObject({
      outputMode: "web-audio",
      recoveryRequired: true,
    });
    expect(runtime.getState().sourceTransport).toBe("radio-relay");
    expect(runtime.getAudioElement()).toBe(visualizerElement);
    expect(releaseBackgroundAudioLease).not.toHaveBeenCalled();

    resumeVisualizerGraphForElement.mockResolvedValue(true);
    expect(await runtime.rearmBackgroundPlayback({ preferNative: true })).toBe(true);
    expect(runtime.getState().sourceTransport).toBe("radio-direct-native");
    expect(runtime.getAudioElement()).not.toBe(visualizerElement);
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
