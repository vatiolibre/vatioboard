import { beforeEach, describe, expect, it, vi } from "vitest";

async function flushMicrotasks(iterations = 12) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function createState(overrides = {}) {
  return {
    unit: "kmh",
    distanceUnit: "m",
    currentSpeedMs: 0,
    totalDistanceM: 0,
    statusKind: "accuracy",
    statusText: "GPS live",
    lastFixAt: Date.now(),
    backgroundMode: true,
    alertAudioControlActive: false,
    backgroundAudioSuppressed: false,
    backgroundAudioArmed: false,
    backgroundAudioArmPending: false,
    backgroundAudioRevision: 1,
    recordingKeepAliveIntended: false,
    recordingKeepAliveArmed: false,
    recordingKeepAlivePending: false,
    recordingKeepAliveRevision: 1,
    recordingKeepAliveSuppressed: false,
    recordingKeepAliveBlocked: false,
    audioPrimed: false,
    audioPrimePending: false,
    audioMuted: false,
    alertSoundEnabled: true,
    alertSoundBlocked: false,
    alertSoundPending: false,
    overspeedAudible: false,
    overspeedSoundRequestId: 0,
    trapAlertEnabled: true,
    trapSoundEnabled: true,
    trapSoundBlocked: false,
    trapSoundPending: false,
    trapAudible: false,
    trapSoundRequestId: 0,
    trapSoundDeadlineAt: 0,
    trapMuteTimeoutId: null,
    nearestTrapId: null,
    ...overrides,
  };
}

function createController(controllerModule, state, onStateChange = vi.fn()) {
  return controllerModule.createSpeedAudioController({
    state,
    t: (key) => key,
    getAlertUiState: () => ({
      manualEnabled: false,
      over: false,
      trapActive: false,
      source: "none",
    }),
    convertSpeed: (speedMs) => speedMs * 3.6,
    getConfiguredTrapAlertDistanceLabel: () => "500 m",
    getAlertLimitDisplayValue: () => 100,
    getSubStatusText: () => "GPS live",
    getCriticalAlertText: () => "",
    onStateChange,
  });
}

function getLatestMediaSessionActionHandler(action) {
  const calls = navigator.mediaSession.setActionHandler.mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const [registeredAction, handler] = calls[index];
    if (registeredAction === action) return handler;
  }
  return null;
}

function installSelectiveAudio({ rejectSource = () => false } = {}) {
  const OriginalAudio = globalThis.Audio;
  const audioInstances = [];

  class SelectiveAudio extends EventTarget {
    constructor(src = "") {
      super();
      this.src = src;
      this.loop = false;
      this.preload = "auto";
      this.playsInline = true;
      this.currentTime = 0;
      this.duration = 0.5;
      this.paused = true;
      this.muted = false;
      this.volume = 1;
      this.playCalls = 0;
      audioInstances.push(this);
    }

    play() {
      this.playCalls += 1;
      if (rejectSource(this.src)) {
        return Promise.reject(new DOMException("Audio requires user interaction", "NotAllowedError"));
      }
      this.paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    }

    load() {}
  }

  Object.defineProperty(window, "Audio", {
    configurable: true,
    writable: true,
    value: SelectiveAudio,
  });
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    writable: true,
    value: SelectiveAudio,
  });

  return {
    audioInstances,
    restore() {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        writable: true,
        value: OriginalAudio,
      });
      Object.defineProperty(globalThis, "Audio", {
        configurable: true,
        writable: true,
        value: OriginalAudio,
      });
    },
  };
}

describe("speed audio recovery", () => {
  let audioSystem;
  let audioModule;

  beforeEach(async () => {
    vi.resetModules();
    audioSystem = await import("../../src/shared/audio-system.js");
    audioModule = await import("../../src/speed/audio.js");
  });

  it("makes suppressed background audio rearmable from a user gesture", async () => {
    const onStateChange = vi.fn();
    const state = createState({
      backgroundAudioSuppressed: true,
      backgroundAudioArmed: false,
    });
    const controller = createController(audioModule, state, onStateChange);

    const recovered = controller.maybeRecoverSuppressedBackgroundAudio({
      fromUserGesture: true,
    });
    await flushMicrotasks();

    expect(recovered).toBe(true);
    expect(state.backgroundAudioSuppressed).toBe(false);
    expect(state.backgroundAudioArmed).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
    expect(onStateChange).toHaveBeenCalled();
  });

  it("uses the recovery path from user gesture activation", async () => {
    const state = createState({
      backgroundMode: false,
      alertAudioControlActive: true,
      backgroundAudioSuppressed: true,
      backgroundAudioArmed: false,
    });
    const controller = createController(audioModule, state);

    controller.handleUserGestureAudioActivation();
    await flushMicrotasks();

    expect(state.backgroundAudioSuppressed).toBe(false);
    expect(state.backgroundAudioArmed).toBe(true);
  });

  it("does not create duplicate background leases when arming repeatedly", async () => {
    const state = createState();
    const controller = createController(audioModule, state);

    await controller.armBackgroundAlertAudio();
    await controller.armBackgroundAlertAudio();

    expect(audioSystem.getBackgroundAudioLeaseCount()).toBe(1);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
  });

  it("ignores media-session pause and stop for silent keep-alive leases", async () => {
    const state = createState({
      alertAudioControlActive: true,
      recordingKeepAliveIntended: true,
    });
    const controller = createController(audioModule, state);
    const setRecordingActive = vi.fn();
    const handleRecordingAudioInterrupted = vi.fn();
    const handleRecordingMediaSessionPlay = vi.fn();
    const handleSpeedMediaSessionPause = vi.fn();
    const handleSpeedMediaSessionStop = vi.fn();

    await controller.armRecordingKeepAliveAudio({ fromUserGesture: true });
    await controller.armBackgroundAlertAudio({ fromUserGesture: true });

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);

    controller.installMediaSessionActionHandlers({
      setRecordingActive,
      handleRecordingAudioInterrupted,
      handleRecordingMediaSessionPlay,
      handleSpeedMediaSessionPause,
      handleSpeedMediaSessionStop,
    });

    getLatestMediaSessionActionHandler("pause")();
    getLatestMediaSessionActionHandler("stop")();
    getLatestMediaSessionActionHandler("play")();

    expect(setRecordingActive).not.toHaveBeenCalled();
    expect(handleRecordingAudioInterrupted).not.toHaveBeenCalled();
    expect(handleSpeedMediaSessionPause).toHaveBeenCalledWith(
      expect.objectContaining({ source: "media-session-pause" })
    );
    expect(handleSpeedMediaSessionStop).toHaveBeenCalledWith(
      expect.objectContaining({ source: "media-session-stop" })
    );
    expect(handleRecordingMediaSessionPlay).toHaveBeenCalledWith(
      expect.objectContaining({ source: "media-session-play" })
    );
    expect(state.recordingKeepAliveSuppressed).toBe(false);
    expect(state.backgroundAudioSuppressed).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
  });

  it("guards silent keep-alive disarm paths from media-session sources", async () => {
    const state = createState({
      alertAudioControlActive: true,
      recordingKeepAliveIntended: true,
    });
    const controller = createController(audioModule, state);

    await controller.armRecordingKeepAliveAudio({ fromUserGesture: true });
    await controller.armBackgroundAlertAudio({ fromUserGesture: true });

    expect(controller.suppressRecordingKeepAliveAudio({ source: "media-session-pause" })).toBe(false);
    expect(controller.disarmBackgroundAlertAudio({ source: "media-session-stop" })).toBe(false);
    expect(controller.suppressBackgroundAudioRuntime({ reason: "external-media-session-stop" })).toBe(false);
    expect(state.recordingKeepAliveSuppressed).toBe(false);
    expect(state.backgroundAudioSuppressed).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
  });

  it("keeps the silent alert lease armed when an alert loop fails", async () => {
    vi.resetModules();
    const selectiveAudio = installSelectiveAudio({
      rejectSource: (src) => String(src).includes("near_camera_notification"),
    });

    try {
      const freshAudioSystem = await import("../../src/shared/audio-system.js");
      const freshAudioModule = await import("../../src/speed/audio.js");
      const state = createState();
      const controller = createController(freshAudioModule, state);

      await controller.armBackgroundAlertAudio({ fromUserGesture: true });
      await flushMicrotasks();

      expect(
        freshAudioSystem.isBackgroundAudioLeaseActive(
          freshAudioModule.SPEED_BACKGROUND_AUDIO_LEASE
        )
      ).toBe(true);
      expect(controller.isBackgroundAlertAudioArmed()).toBe(true);
      expect(state.backgroundAudioArmed).toBe(true);
      expect(state.audioPrimed).toBe(false);
      expect(state.alertSoundBlocked).toBe(false);
      expect(state.trapSoundBlocked).toBe(true);
    } finally {
      selectiveAudio.restore();
    }
  });

  it("arms recording keep-alive independently from alert audio", async () => {
    const state = createState({
      backgroundMode: false,
      recordingKeepAliveIntended: true,
    });
    const controller = createController(audioModule, state);

    const armed = await controller.armRecordingKeepAliveAudio({ fromUserGesture: true });

    expect(armed).toBe(true);
    expect(state.recordingKeepAliveArmed).toBe(true);
    expect(state.backgroundAudioArmed).toBe(false);
    expect(state.audioPrimed).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(false);
  });

  it("keeps the shared silent audio alive until both recording and alert leases release", async () => {
    const state = createState({
      backgroundMode: false,
      alertAudioControlActive: true,
      recordingKeepAliveIntended: true,
    });
    const controller = createController(audioModule, state);
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();

    await controller.armRecordingKeepAliveAudio({ fromUserGesture: true });
    await controller.armBackgroundAlertAudio();

    expect(audioSystem.getBackgroundAudioLeaseCount()).toBe(2);
    expect(keepAliveAudio.paused).toBe(false);

    controller.disarmBackgroundAlertAudio();

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(false);
    expect(keepAliveAudio.paused).toBe(false);

    await controller.armBackgroundAlertAudio();
    controller.disarmRecordingKeepAliveAudio();

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(false);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
    expect(keepAliveAudio.paused).toBe(false);

    controller.disarmBackgroundAlertAudio();

    expect(audioSystem.getBackgroundAudioLeaseCount()).toBe(0);
    expect(keepAliveAudio.paused).toBe(true);
  });
});
