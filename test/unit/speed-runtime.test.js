import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("speed runtime", () => {
  let activityState;
  let runtimeModule;

  beforeEach(async () => {
    vi.resetModules();
    activityState = await import("../../src/shared/activity-state.js");
    runtimeModule = await import("../../src/speed/runtime.js");
    activityState.clearAllActivities();
  });

  afterEach(() => {
    activityState?.clearAllActivities();
    vi.useRealTimers();
  });

  it("publishes recording activity with recording keep-alive detail", () => {
    runtimeModule.speedRuntime.sync({
      recordingState: "recording",
      watchActive: true,
      trackingRetained: true,
      sampleCount: 4,
      startedAtMs: 1000,
      lastFixAt: Date.now(),
      recordingKeepAliveIntended: true,
      recordingKeepAliveArmed: true,
    });

    const activities = activityState.getActivities();
    expect(activities.map((activity) => activity.id)).toEqual(["speed.recording"]);
    expect(activities[0]).toMatchObject({
      state: "recording",
      labelKey: "activitySpeedRecording",
      detailKey: "activitySpeedRecordingKeepAliveActive",
      sampleCount: 4,
      route: "/",
    });
  });

  it("publishes speed alert audio activity beside active recording only when intended", () => {
    runtimeModule.speedRuntime.sync({
      recordingState: "recording",
      watchActive: true,
      trackingRetained: true,
      sampleCount: 4,
      startedAtMs: 1000,
      lastFixAt: Date.now(),
      recordingKeepAliveIntended: true,
      recordingKeepAliveArmed: true,
      speedAlertAudioIntended: true,
      backgroundAudioArmed: true,
    });

    const activities = activityState.getActivities();
    expect(activities.map((activity) => activity.id)).toEqual([
      "speed.recording",
      "speed.alerts",
    ]);
    expect(activities[1]).toMatchObject({
      state: "armed",
      labelKey: "activitySpeedAlertsArmed",
      detailKey: "activitySpeedAlertsReady",
      route: "/",
    });
  });

  it("keeps suppressed and blocked alert audio visible for rearm", () => {
    runtimeModule.speedRuntime.sync({
      speedAlertAudioIntended: true,
      backgroundAudioSuppressed: true,
      lastFixAt: Date.now(),
    });

    expect(activityState.getActivities()[0]).toMatchObject({
      id: "speed.alerts",
      state: "suppressed",
      detailKey: "activitySpeedAlertsTapToRearm",
    });

    runtimeModule.speedRuntime.sync({
      speedAlertAudioIntended: true,
      alertSoundBlocked: true,
      lastFixAt: Date.now(),
    });

    expect(activityState.getActivities()[0]).toMatchObject({
      id: "speed.alerts",
      state: "blocked",
      detailKey: "activitySpeedAlertsUserAction",
    });
  });

  it("reports armed alert keep-alive separately from an individual sound retry", () => {
    runtimeModule.speedRuntime.sync({
      speedAlertAudioIntended: true,
      backgroundAudioArmed: true,
      alertSoundBlocked: true,
      lastFixAt: Date.now(),
    });

    expect(activityState.getActivities()[0]).toMatchObject({
      id: "speed.alerts",
      state: "armed",
      labelKey: "activitySpeedAlertsArmed",
      detailKey: "activitySpeedAlertsSoundMayNeedTap",
    });

    const recovery = runtimeModule.speedRuntime.runRecoveryCheck({ force: true });
    expect(recovery.alerts).toBe(false);
    expect(recovery.reasons).not.toContain("audio-blocked");
  });

  it("does not show alert activity when alerts are disabled and audio is muted", () => {
    runtimeModule.speedRuntime.sync({
      speedAlertAudioIntended: false,
      audioMuted: true,
      backgroundAudioArmed: false,
      backgroundAudioArmPending: false,
      backgroundAudioSuppressed: false,
    });

    expect(activityState.getActivities()).toEqual([]);
  });

  it("marks active recording keep-alive loss as non-critical when GPS is fresh", () => {
    runtimeModule.speedRuntime.sync({
      recordingState: "recording",
      watchActive: true,
      trackingRetained: true,
      sampleCount: 2,
      lastFixAt: Date.now(),
      recordingKeepAliveIntended: true,
      recordingKeepAliveArmed: false,
      recordingKeepAlivePending: false,
    }, { persist: true });

    expect(activityState.getActivities()[0]).toMatchObject({
      id: "speed.recording",
      state: "suppressed",
      detailKey: "activitySpeedRecordingKeepAliveNeedsRearm",
    });

    const recovery = runtimeModule.speedRuntime.runRecoveryCheck({ force: true });

    expect(recovery).toMatchObject({
      needed: true,
      severity: "keep-alive",
      recording: false,
      recordingKeepAlive: true,
      keepAliveOnly: true,
      alerts: false,
      recordingKeepAliveMissing: true,
    });
    expect(recovery.reasons).toContain("recording-keep-alive-missing");
  });

  it("keeps alert recovery separate from healthy recording keep-alive", () => {
    runtimeModule.speedRuntime.sync({
      recordingState: "recording",
      watchActive: true,
      trackingRetained: true,
      lastFixAt: Date.now(),
      recordingKeepAliveIntended: true,
      recordingKeepAliveArmed: true,
      speedAlertAudioIntended: true,
      backgroundAudioSuppressed: true,
    }, { persist: true });

    const recovery = runtimeModule.speedRuntime.runRecoveryCheck({ force: true });

    expect(recovery).toMatchObject({
      needed: true,
      recording: false,
      alerts: true,
      audioSuppressed: true,
    });
  });

  it("combines stale recording and suppressed alert recovery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);

    runtimeModule.speedRuntime.sync({
      recordingState: "recording",
      watchActive: true,
      trackingRetained: true,
      sampleCount: 5,
      lastFixAt: 100000 - runtimeModule.SPEED_GPS_STALE_MS - 1,
      recordingKeepAliveIntended: true,
      recordingKeepAliveSuppressed: true,
      speedAlertAudioIntended: true,
      backgroundAudioSuppressed: true,
    }, { persist: true });

    const recovery = runtimeModule.speedRuntime.runRecoveryCheck({ force: true });

    expect(recovery).toMatchObject({
      needed: true,
      severity: "recording",
      recording: true,
      recordingKeepAlive: true,
      keepAliveOnly: false,
      alerts: true,
      gpsStale: true,
      recordingKeepAliveSuppressed: true,
      audioSuppressed: true,
    });
    expect(recovery.reasons).toEqual(
      expect.arrayContaining([
        "gps-stale",
        "recording-keep-alive-suppressed",
        "audio-suppressed",
      ])
    );
  });

  it("waits for the recovery grace window before reporting stale GPS or suppressed audio", async () => {
    vi.useFakeTimers();
    const recoveryHandler = vi.fn();
    runtimeModule.speedRuntime.installLifecycleListeners({
      recoveryHandler,
    });
    runtimeModule.speedRuntime.sync({
      recordingState: "recording",
      watchActive: true,
      trackingRetained: true,
      sampleCount: 10,
      lastFixAt: Date.now(),
      speedAlertAudioIntended: true,
      backgroundAudioSuppressed: true,
    }, { persist: true });

    Object.defineProperty(document, "hidden", {
      configurable: true,
      writable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(runtimeModule.SPEED_GPS_STALE_MS + 1);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      writable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(recoveryHandler).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(runtimeModule.SPEED_RECOVERY_GRACE_MS);

    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(recoveryHandler.mock.calls[0][0]).toMatchObject({
      needed: true,
      recording: true,
      alerts: true,
      audioSuppressed: true,
      gpsStale: true,
    });
  });

  it("does not prompt recovery after an intentional stop", () => {
    runtimeModule.speedRuntime.sync({
      recordingState: "stopped",
      watchActive: false,
      trackingRetained: false,
      speedAlertAudioIntended: false,
      backgroundAudioArmed: false,
    }, { persist: true });

    const recovery = runtimeModule.speedRuntime.runRecoveryCheck({ force: true });

    expect(recovery.needed).toBe(false);
  });
});
