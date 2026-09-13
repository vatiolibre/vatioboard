import { beforeEach, describe, expect, it, vi } from "vitest";

describe("audio-system background leases", () => {
  let audioSystem;

  beforeEach(async () => {
    vi.resetModules();
    audioSystem = await import("../../src/shared/audio-system.js");
  });

  it("shares one keep-alive audio element across independent leases", async () => {
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();

    await audioSystem.acquireBackgroundAudioLease("speed", {
      shouldContinue: () => true,
    });

    expect(audioSystem.getBackgroundKeepAliveAudio()).toBe(keepAliveAudio);
    expect(keepAliveAudio.paused).toBe(false);
    expect(audioSystem.isBackgroundAudioLeaseActive("speed")).toBe(true);

    await audioSystem.acquireBackgroundAudioLease("player", {
      shouldContinue: () => true,
    });
    audioSystem.releaseBackgroundAudioLease("speed");

    expect(keepAliveAudio.paused).toBe(false);
    expect(audioSystem.isBackgroundAudioLeaseActive("player")).toBe(true);

    audioSystem.releaseBackgroundAudioLease("player");

    expect(keepAliveAudio.paused).toBe(true);
  });

  it("drops stale leases before arming the keep-alive", async () => {
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();

    const armed = await audioSystem.acquireBackgroundAudioLease("stale", {
      shouldContinue: () => false,
    });

    expect(armed).toBe(false);
    expect(audioSystem.hasBackgroundAudioLease("stale")).toBe(false);
    expect(keepAliveAudio.paused).toBe(true);
  });

  it("retains lease intent after a rejected play and rearms every owner", async () => {
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();
    const originalPlay = keepAliveAudio.play.bind(keepAliveAudio);
    keepAliveAudio.play = vi.fn().mockRejectedValue(new DOMException("blocked", "NotAllowedError"));

    const armed = await audioSystem.acquireBackgroundAudioLease("player-runtime", {
      shouldContinue: () => true,
    });
    await audioSystem.acquireBackgroundAudioLease("drive-recording", {
      shouldContinue: () => true,
    });

    expect(armed).toBe(false);
    expect(audioSystem.getBackgroundAudioState()).toMatchObject({
      status: "blocked",
      activeLeaseIds: ["player-runtime", "drive-recording"],
      lastInterruption: "play-rejected",
    });

    keepAliveAudio.play = originalPlay;
    expect(await audioSystem.rearmBackgroundAudio()).toBe(true);
    expect(audioSystem.getBackgroundAudioState()).toMatchObject({
      status: "armed",
      activeLeaseIds: ["player-runtime", "drive-recording"],
      lastInterruption: null,
    });
  });

  it("distinguishes unexpected interruptions from an intentional last-lease release", async () => {
    const states = [];
    const unsubscribe = audioSystem.subscribeBackgroundAudioState((state) => states.push(state));
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();

    await audioSystem.acquireBackgroundAudioLease("player-runtime", { shouldContinue: () => true });
    keepAliveAudio.pause();

    expect(audioSystem.getBackgroundAudioState()).toMatchObject({
      status: "interrupted",
      activeLeaseIds: ["player-runtime"],
      lastInterruption: "pause",
    });

    await audioSystem.rearmBackgroundAudio();
    audioSystem.releaseBackgroundAudioLease("player-runtime");

    expect(audioSystem.getBackgroundAudioState()).toMatchObject({
      status: "idle",
      activeLeaseIds: [],
      lastInterruption: null,
    });
    expect(states.some((state) => state.status === "interrupted")).toBe(true);
    unsubscribe();
  });

  it("keeps arming when one owner releases but another retained lease remains", async () => {
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();
    let finishPlay;
    keepAliveAudio.play = vi.fn(() => {
      keepAliveAudio.paused = false;
      keepAliveAudio.dispatchEvent(new Event("play"));
      return new Promise((resolve) => { finishPlay = resolve; });
    });

    const playerArm = audioSystem.acquireBackgroundAudioLease("player-runtime", {
      shouldContinue: () => true,
    });
    const recordingArm = audioSystem.acquireBackgroundAudioLease("drive-recording", {
      shouldContinue: () => true,
    });
    audioSystem.releaseBackgroundAudioLease("player-runtime");
    finishPlay();

    expect(await playerArm).toBe(true);
    expect(await recordingArm).toBe(true);
    expect(audioSystem.getBackgroundAudioState()).toMatchObject({
      status: "armed",
      activeLeaseIds: ["drive-recording"],
    });
    expect(keepAliveAudio.paused).toBe(false);
  });

  it("keeps recording and armed camera alerts alive when the Player radio lease stops", async () => {
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();
    await audioSystem.acquireBackgroundAudioLease("player-runtime", { shouldContinue: () => true });
    await audioSystem.acquireBackgroundAudioLease("drive-recording", { shouldContinue: () => true });
    await audioSystem.acquireBackgroundAudioLease("speed-alerts", { shouldContinue: () => true });

    audioSystem.releaseBackgroundAudioLease("player-runtime");

    expect(audioSystem.getBackgroundAudioState()).toMatchObject({
      status: "armed",
      activeLeaseIds: ["drive-recording", "speed-alerts"],
    });
    expect(keepAliveAudio.paused).toBe(false);
    expect(audioSystem.isBackgroundAudioLeaseActive("drive-recording")).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive("speed-alerts")).toBe(true);
  });
});

describe("media-session-adapter clients", () => {
  let adapter;

  beforeEach(async () => {
    vi.resetModules();
    adapter = await import("../../src/shared/media-session-adapter.js");
  });

  it("applies the highest-priority media session client and restores the previous one", () => {
    adapter.updateMediaSessionClient("player", {
      active: true,
      priority: 10,
      playbackState: "playing",
      metadata: {
        title: "Player Track",
        artist: "Player",
        album: "VatioBoard",
      },
    });

    expect(navigator.mediaSession.playbackState).toBe("playing");
    expect(navigator.mediaSession.metadata.title).toBe("Player Track");

    adapter.updateMediaSessionClient("speed", {
      active: true,
      priority: 50,
      playbackState: "paused",
      metadata: {
        title: "88 km/h",
        artist: "GPS live",
        album: "Vatio Speed",
      },
    });

    expect(navigator.mediaSession.playbackState).toBe("paused");
    expect(navigator.mediaSession.metadata.title).toBe("88 km/h");

    adapter.clearMediaSessionClient("speed");

    expect(navigator.mediaSession.playbackState).toBe("playing");
    expect(navigator.mediaSession.metadata.title).toBe("Player Track");
  });

  it("keeps player transport handlers above Speed keep-alive metadata", () => {
    const playerPause = vi.fn();
    const speedPause = vi.fn();

    adapter.updateMediaSessionClient("speed", {
      active: true,
      priority: 5,
      playbackState: "playing",
      metadata: {
        title: "88 km/h",
        artist: "GPS live",
        album: "Vatio Speed",
      },
      handlers: {
        pause: speedPause,
      },
    });

    adapter.updateMediaSessionClient("player", {
      active: true,
      priority: 10,
      playbackState: "playing",
      metadata: {
        title: "Player Track",
        artist: "Player",
        album: "VatioBoard",
      },
      handlers: {
        pause: playerPause,
      },
    });

    const pauseHandler = navigator.mediaSession.setActionHandler.mock.calls
      .filter(([action]) => action === "pause")
      .at(-1)?.[1];

    expect(navigator.mediaSession.metadata.title).toBe("Player Track");
    pauseHandler();
    expect(playerPause).toHaveBeenCalledTimes(1);
    expect(speedPause).not.toHaveBeenCalled();
  });
});
