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
