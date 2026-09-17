import { beforeEach, describe, expect, it, vi } from "vitest";

describe("audio-system background leases", () => {
  let audioSystem;

  beforeEach(async () => {
    vi.resetModules();
    audioSystem = await import("../../src/shared/audio-system.js");
  });

  it("delegates to the primary without releasing independent leases, then rearms silence", async () => {
    const silent = audioSystem.getBackgroundKeepAliveAudio();
    const play = vi.spyOn(silent, "play");
    audioSystem.setBackgroundAudioCarrier("player-runtime", true);
    await audioSystem.acquireBackgroundAudioLease("player-runtime");
    await audioSystem.acquireBackgroundAudioLease("recording");
    await audioSystem.rearmBackgroundAudio();
    audioSystem.recoverBackgroundAudioAutomatically();
    expect(play).not.toHaveBeenCalled();
    expect(audioSystem.getBackgroundAudioState().status).toBe("delegated");
    expect(audioSystem.isBackgroundAudioLeaseActive("recording")).toBe(true);
    audioSystem.releaseBackgroundAudioLease("player-runtime");
    expect(audioSystem.getBackgroundAudioState().activeLeaseIds).toEqual(["recording"]);
    audioSystem.setBackgroundAudioCarrier("player-runtime", false);
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
    expect(silent.paused).toBe(false);
    audioSystem.releaseBackgroundAudioLease("recording");
    expect(silent.paused).toBe(true);
  });

  it("does not let late silent playback overlap a newly delegated primary", async () => {
    const silent = audioSystem.getBackgroundKeepAliveAudio();
    let finishPlay;
    vi.spyOn(silent, "play").mockImplementationOnce(() => new Promise((resolve) => {
      finishPlay = () => { silent.paused = false; resolve(); };
    }));
    const pending = audioSystem.acquireBackgroundAudioLease("recording");
    audioSystem.setBackgroundAudioCarrier("player-runtime", true);
    await audioSystem.acquireBackgroundAudioLease("player-runtime");
    finishPlay();
    await pending;
    expect(silent.paused).toBe(true);
    expect(audioSystem.getBackgroundAudioState()).toMatchObject({
      status: "delegated", activeLeaseIds: ["recording", "player-runtime"],
    });
    audioSystem.disposeAudioSystemForTests();
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
  it("an old arm completion cannot stop or clear a newer arm after release/reacquire", async () => {
    const audio = audioSystem.getBackgroundKeepAliveAudio();
    const completions = [];
    audio.play = vi.fn(() => new Promise((resolve) => { completions.push(resolve); }));
    const oldArm = audioSystem.acquireBackgroundAudioLease("player-runtime");
    audioSystem.releaseBackgroundAudioLease("player-runtime");
    const newArm = audioSystem.acquireBackgroundAudioLease("drive-recording");
    completions[0]();
    expect(await oldArm).toBe(false);
    expect(audioSystem.isBackgroundAudioArmPending()).toBe(true);
    audio.paused = false;
    completions[1]();
    expect(await newArm).toBe(true);
    expect(audio.paused).toBe(false);
    expect(audioSystem.getBackgroundAudioState().activeLeaseIds).toEqual(["drive-recording"]);
  });

  it("makes one automatic recovery attempt and waits for a gesture after rejection", async () => {
    const audio = audioSystem.getBackgroundKeepAliveAudio();
    await audioSystem.acquireBackgroundAudioLease("player-runtime");
    const originalPlay = audio.play.bind(audio);
    audio.play = vi.fn().mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    audio.pause();
    await vi.waitFor(() => expect(audioSystem.getBackgroundAudioState().status).toBe("blocked"));
    for (let i = 0; i < 5; i++) {
      audio.dispatchEvent(new Event("pause"));
      window.dispatchEvent(new Event("pageshow"));
      await audioSystem.acquireBackgroundAudioLease("player-runtime");
    }
    expect(audio.play).toHaveBeenCalledTimes(1);
    audio.play = originalPlay;
    expect(await audioSystem.activateBackgroundAudioFromGesture()).toBe(true);
    expect(audio.paused).toBe(false);
  });

  it("initiates every registered activation before any pending promise settles", async () => {
    const primary = vi.fn(() => new Promise(() => {}));
    const alerts = vi.fn(() => new Promise(() => {}));
    const removePrimary = audioSystem.registerBackgroundAudioGestureHandler(primary);
    const removeAlerts = audioSystem.registerBackgroundAudioGestureHandler(alerts);
    void audioSystem.activateBackgroundAudioFromGesture();
    expect(primary).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveBeenCalledTimes(1);
    removePrimary(); removeAlerts();
  });

});
