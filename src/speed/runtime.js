import { clearActivity, setActivity } from "../shared/activity-state.js";

export const SPEED_RECORDING_ACTIVITY_ID = "speed.recording";
export const SPEED_ALERTS_ACTIVITY_ID = "speed.alerts";
export const SPEED_RUNTIME_INTENT_STORAGE_KEY = "vatioboard.speed.runtime_intent.v1";
export const SPEED_RECOVERY_GRACE_MS = 2500;
export const SPEED_GPS_STALE_MS = 12000;

const LIFECYCLE_CLEANUP_KEY = "__vatioboardSpeedRuntimeLifecycleCleanup";

function nowMs() {
  return Date.now();
}

function readStoredIntent() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SPEED_RUNTIME_INTENT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      !Object.prototype.hasOwnProperty.call(parsed, "recordingKeepAliveShouldBeArmed")
    ) {
      parsed.recordingKeepAliveShouldBeArmed = Boolean(parsed.recordingShouldBeActive);
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredIntent(intent) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SPEED_RUNTIME_INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Best-effort recovery hint only.
  }
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function bool(value) {
  return Boolean(value);
}

function getActivitySampleCount(snapshot) {
  return Math.max(0, Math.round(finiteNumber(snapshot.sampleCount, 0)));
}

function normalizeSnapshot(snapshot = {}) {
  const recordingActive = snapshot.recordingState === "recording" || snapshot.recordingActive === true;
  const watchActive = snapshot.watchActive === true;
  const trackingRetained = snapshot.trackingRetained === true || watchActive;
  const recordingKeepAliveIntended = Object.prototype.hasOwnProperty.call(
    snapshot,
    "recordingKeepAliveIntended",
  )
    ? bool(snapshot.recordingKeepAliveIntended)
    : recordingActive;
  const speedAlertAudioIntended = bool(snapshot.speedAlertAudioIntended);

  return {
    recordingActive,
    recordingState: snapshot.recordingState || (recordingActive ? "recording" : "stopped"),
    watchActive,
    trackingRetained,
    viewMounted: snapshot.viewMounted !== false,
    isSpaRuntime: bool(snapshot.isSpaRuntime),
    sampleCount: getActivitySampleCount(snapshot),
    startedAtMs: Number.isFinite(snapshot.startedAtMs) ? snapshot.startedAtMs : null,
    lastFixAt: finiteNumber(snapshot.lastFixAt, 0),
    lastPositionTimestamp: Number.isFinite(snapshot.lastPositionTimestamp)
      ? snapshot.lastPositionTimestamp
      : null,
    recordingKeepAliveIntended,
    recordingKeepAliveArmed: bool(snapshot.recordingKeepAliveArmed),
    recordingKeepAlivePending: bool(snapshot.recordingKeepAlivePending),
    recordingKeepAliveSuppressed: bool(snapshot.recordingKeepAliveSuppressed),
    recordingKeepAliveBlocked: bool(snapshot.recordingKeepAliveBlocked),
    manualAlertActive: bool(snapshot.manualAlertActive),
    trapAlertActive: bool(snapshot.trapAlertActive),
    speedAlertAudioIntended,
    backgroundAudioArmed: bool(snapshot.backgroundAudioArmed),
    backgroundAudioArmPending: bool(snapshot.backgroundAudioArmPending),
    backgroundAudioSuppressed: bool(snapshot.backgroundAudioSuppressed),
    alertSoundBlocked: bool(snapshot.alertSoundBlocked),
    trapSoundBlocked: bool(snapshot.trapSoundBlocked),
    audioMuted: bool(snapshot.audioMuted),
  };
}

function createIntentFromSnapshot(snapshot, reason = "sync") {
  return {
    recordingShouldBeActive: snapshot.recordingActive,
    recordingKeepAliveShouldBeArmed: snapshot.recordingKeepAliveIntended,
    manualAlertShouldBeActive: snapshot.manualAlertActive,
    trapAlertShouldBeActive: snapshot.trapAlertActive,
    speedAlertAudioShouldBeArmed: snapshot.speedAlertAudioIntended,
    sampleCount: snapshot.sampleCount,
    lastFixAt: snapshot.lastFixAt,
    updatedAtMs: nowMs(),
    reason,
  };
}

function getRecoverySignature(recovery) {
  if (!recovery?.needed) return "";
  return JSON.stringify([
    recovery.severity,
    recovery.recording,
    recovery.recordingKeepAlive,
    recovery.keepAliveOnly,
    recovery.alerts,
    recovery.recordingInactive,
    recovery.trackingNotRetained,
    recovery.recordingKeepAliveSuppressed,
    recovery.recordingKeepAliveBlocked,
    recovery.recordingKeepAliveMissing,
    recovery.audioSuppressed,
    recovery.audioBlocked,
    recovery.audioMissing,
    recovery.gpsStale,
    recovery.watchInactive,
  ]);
}

function createEmptyRecovery() {
  return {
    needed: false,
    severity: "none",
    recording: false,
    recordingKeepAlive: false,
    keepAliveOnly: false,
    alerts: false,
    recordingInactive: false,
    trackingNotRetained: false,
    recordingKeepAliveSuppressed: false,
    recordingKeepAliveBlocked: false,
    recordingKeepAliveMissing: false,
    audioSuppressed: false,
    audioBlocked: false,
    audioMissing: false,
    reasons: [],
  };
}

function createSpeedRuntime() {
  let actual = normalizeSnapshot();
  let intent = readStoredIntent() || createIntentFromSnapshot(actual, "initial");
  let recovery = createEmptyRecovery();
  let recoveryTimerId = null;
  let recoveryBaseline = null;
  let onRecoveryNeeded = null;
  let onPersistIntent = null;
  let dismissedRecoverySignature = "";

  function getIntent() {
    return { ...intent };
  }

  function getActualSnapshot() {
    return { ...actual };
  }

  function getRecoveryState() {
    return {
      ...recovery,
      reasons: [...(recovery.reasons || [])],
    };
  }

  function persistIntent(reason = "lifecycle") {
    intent = {
      ...intent,
      ...createIntentFromSnapshot(actual, reason),
    };
    writeStoredIntent(intent);
    try {
      onPersistIntent?.(intent);
    } catch {
      // Runtime persistence must not break route teardown.
    }
    return getIntent();
  }

  function clearRecoveryTimer() {
    if (recoveryTimerId === null) return;
    window.clearTimeout(recoveryTimerId);
    recoveryTimerId = null;
  }

  function clearRecoveryNeeded() {
    recovery = createEmptyRecovery();
    dismissedRecoverySignature = "";
  }

  function getRecordingActivityModel() {
    const intended =
      actual.recordingKeepAliveIntended ||
      intent.recordingKeepAliveShouldBeArmed ||
      actual.recordingActive ||
      intent.recordingShouldBeActive;
    const staleFix =
      actual.lastFixAt > 0 &&
      nowMs() - actual.lastFixAt > SPEED_GPS_STALE_MS;
    const recordingInactive = intended && intent.recordingShouldBeActive && !actual.recordingActive;
    const trackingNotRetained =
      intended && intent.recordingShouldBeActive && !actual.trackingRetained;
    const watchInactive =
      intended && intent.recordingShouldBeActive && !actual.watchActive && !actual.trackingRetained;
    const keepAliveNeedsRearm =
      intended &&
      (
        actual.recordingKeepAliveSuppressed ||
        actual.recordingKeepAliveBlocked ||
        (!actual.recordingKeepAliveArmed && !actual.recordingKeepAlivePending)
      );

    if (recordingInactive || trackingNotRetained || watchInactive || staleFix) {
      return {
        state: "blocked",
        detailKey: "activitySpeedRecordingMayNeedResume",
      };
    }

    if (keepAliveNeedsRearm) {
      return {
        state: actual.recordingKeepAliveBlocked ? "blocked" : "suppressed",
        detailKey: "activitySpeedRecordingKeepAliveNeedsRearm",
      };
    }

    if (actual.recordingKeepAlivePending) {
      return {
        state: "arming",
        detailKey: "activitySpeedRecordingKeepAliveArming",
      };
    }

    if (actual.recordingKeepAliveArmed) {
      return {
        state: "recording",
        detailKey: "activitySpeedRecordingKeepAliveActive",
      };
    }

    return {
      state: "recording",
      fallbackDetailKey: "activityGpsActive",
    };
  }

  function publishRecordingActivity() {
    const shouldShow =
      actual.recordingActive ||
      intent.recordingShouldBeActive ||
      actual.recordingKeepAliveIntended ||
      intent.recordingKeepAliveShouldBeArmed;

    if (!shouldShow) {
      clearActivity(SPEED_RECORDING_ACTIVITY_ID);
      return;
    }

    const model = getRecordingActivityModel();
    setActivity(SPEED_RECORDING_ACTIVITY_ID, {
      kind: "speed",
      order: 10,
      route: "#/speed",
      labelKey: "activitySpeedRecording",
      sampleCount: actual.sampleCount,
      startedAtMs: actual.startedAtMs,
      ...model,
    });
  }

  function getAlertActivityModel() {
    const intended = actual.speedAlertAudioIntended || intent.speedAlertAudioShouldBeArmed;
    const blocked = actual.alertSoundBlocked || actual.trapSoundBlocked;
    const shouldShow =
      intended ||
      actual.backgroundAudioArmed ||
      actual.backgroundAudioArmPending ||
      actual.backgroundAudioSuppressed ||
      blocked;

    if (!shouldShow) return null;

    if (actual.backgroundAudioSuppressed) {
      return {
        state: "suppressed",
        labelKey: "activitySpeedAlertsSuppressed",
        detailKey: "activitySpeedAlertsTapToRearm",
      };
    }

    if (
      blocked ||
      (intended && !actual.backgroundAudioArmed && !actual.backgroundAudioArmPending)
    ) {
      if (blocked && actual.backgroundAudioArmed) {
        return {
          state: "armed",
          labelKey: "activitySpeedAlertsArmed",
          detailKey: "activitySpeedAlertsSoundMayNeedTap",
        };
      }

      return {
        state: "blocked",
        labelKey: "activitySpeedAlertsBlocked",
        detailKey: actual.lastFixAt > 0
          ? "activitySpeedAlertsUserAction"
          : "activitySpeedAlertsGpsRequired",
      };
    }

    if (actual.backgroundAudioArmPending) {
      return {
        state: "arming",
        labelKey: "activitySpeedAlertsArming",
        detailKey: "activitySpeedAlertsReady",
      };
    }

    return {
      state: "armed",
      labelKey: "activitySpeedAlertsArmed",
      detailKey: "activitySpeedAlertsReady",
    };
  }

  function publishAlertActivity() {
    const model = getAlertActivityModel();
    if (!model) {
      clearActivity(SPEED_ALERTS_ACTIVITY_ID);
      return;
    }

    setActivity(SPEED_ALERTS_ACTIVITY_ID, {
      kind: "speed",
      order: 11,
      route: "#/speed",
      openLabelKey: "activityOpenSpeedAlerts",
      ...model,
    });
  }

  function publishActivities() {
    publishRecordingActivity();
    publishAlertActivity();
  }

  function sync(snapshot = {}, { persist = false, reason = "sync" } = {}) {
    const previousIntent = intent;
    actual = normalizeSnapshot(snapshot);
    intent = createIntentFromSnapshot(actual, reason);

    if (
      previousIntent.recordingShouldBeActive !== intent.recordingShouldBeActive ||
      previousIntent.recordingKeepAliveShouldBeArmed !== intent.recordingKeepAliveShouldBeArmed ||
      previousIntent.speedAlertAudioShouldBeArmed !== intent.speedAlertAudioShouldBeArmed
    ) {
      dismissedRecoverySignature = "";
    }

    if (persist) {
      writeStoredIntent(intent);
    }

    if (recovery.needed) {
      const healthyRecording =
        !intent.recordingShouldBeActive ||
        (
          actual.recordingActive &&
          (actual.watchActive || actual.trackingRetained) &&
          actual.lastFixAt > 0 &&
          nowMs() - actual.lastFixAt <= SPEED_GPS_STALE_MS
        );
      const healthyRecordingKeepAlive =
        !intent.recordingKeepAliveShouldBeArmed ||
        (
          actual.recordingKeepAliveArmed &&
          !actual.recordingKeepAliveSuppressed &&
          !actual.recordingKeepAliveBlocked
        );
      const healthyAlerts =
        !intent.speedAlertAudioShouldBeArmed ||
        (actual.backgroundAudioArmed && !actual.backgroundAudioSuppressed);
      if (healthyRecording && healthyRecordingKeepAlive && healthyAlerts) {
        clearRecoveryNeeded();
      }
    }

    publishActivities();
    return {
      actual: getActualSnapshot(),
      intent: getIntent(),
      recovery: getRecoveryState(),
    };
  }

  function notifyRecoveryNeeded() {
    const signature = getRecoverySignature(recovery);
    if (!signature || signature === dismissedRecoverySignature) return;
    try {
      onRecoveryNeeded?.(getRecoveryState());
    } catch {
      // Recovery UI is advisory. Keep runtime state intact if UI fails.
    }
  }

  function runRecoveryCheck({ force = false } = {}) {
    clearRecoveryTimer();
    const persistedIntent = readStoredIntent();
    if (persistedIntent?.updatedAtMs > intent.updatedAtMs) {
      intent = persistedIntent;
    }

    const currentTime = nowMs();
    const graceElapsed =
      force ||
      !recoveryBaseline ||
      currentTime - recoveryBaseline.checkedAtMs >= SPEED_RECOVERY_GRACE_MS;
    const reasons = [];
    const recordingInactive = intent.recordingShouldBeActive && !actual.recordingActive;
    const trackingNotRetained =
      intent.recordingShouldBeActive && !actual.trackingRetained;
    const watchInactive =
      intent.recordingShouldBeActive && !actual.watchActive && !actual.trackingRetained;
    const gpsStale =
      intent.recordingShouldBeActive &&
      (!actual.lastFixAt || currentTime - actual.lastFixAt > SPEED_GPS_STALE_MS);
    const sampleCountStalled = Boolean(
      intent.recordingShouldBeActive &&
      graceElapsed &&
      recoveryBaseline &&
      actual.sampleCount <= recoveryBaseline.sampleCount &&
      actual.lastFixAt <= recoveryBaseline.lastFixAt
    );
    const recordingKeepAliveSuppressed =
      intent.recordingKeepAliveShouldBeArmed && actual.recordingKeepAliveSuppressed;
    const recordingKeepAliveBlocked =
      intent.recordingKeepAliveShouldBeArmed && actual.recordingKeepAliveBlocked;
    const recordingKeepAliveMissing =
      intent.recordingKeepAliveShouldBeArmed &&
      graceElapsed &&
      !actual.recordingKeepAliveArmed &&
      !actual.recordingKeepAlivePending;
    const recordingKeepAliveNeedsRecovery =
      recordingKeepAliveSuppressed ||
      recordingKeepAliveBlocked ||
      recordingKeepAliveMissing;
    const recordingNeedsRecovery =
      recordingInactive ||
      trackingNotRetained ||
      watchInactive ||
      gpsStale ||
      sampleCountStalled;

    if (recordingInactive) reasons.push("recording-inactive");
    if (trackingNotRetained) reasons.push("tracking-not-retained");
    if (watchInactive) reasons.push("gps-watch-inactive");
    if (gpsStale) reasons.push("gps-stale");
    if (sampleCountStalled) reasons.push("samples-stalled");
    if (recordingKeepAliveSuppressed) reasons.push("recording-keep-alive-suppressed");
    if (recordingKeepAliveBlocked) reasons.push("recording-keep-alive-blocked");
    if (recordingKeepAliveMissing) reasons.push("recording-keep-alive-missing");

    const audioSuppressed =
      intent.speedAlertAudioShouldBeArmed && actual.backgroundAudioSuppressed;
    const audioBlocked =
      intent.speedAlertAudioShouldBeArmed &&
      !actual.backgroundAudioArmed &&
      (actual.alertSoundBlocked || actual.trapSoundBlocked);
    const audioMissing =
      intent.speedAlertAudioShouldBeArmed &&
      graceElapsed &&
      !actual.backgroundAudioArmed &&
      !actual.backgroundAudioArmPending;
    const alertsNeedRecovery = audioSuppressed || audioBlocked || audioMissing;

    if (audioSuppressed) reasons.push("audio-suppressed");
    if (audioBlocked) reasons.push("audio-blocked");
    if (audioMissing) reasons.push("audio-not-armed");

    const keepAliveOnly =
      recordingKeepAliveNeedsRecovery && !recordingNeedsRecovery;
    const severity = recordingNeedsRecovery
      ? "recording"
      : keepAliveOnly
        ? "keep-alive"
        : alertsNeedRecovery
          ? "alerts"
          : "none";

    recovery = {
      needed: recordingNeedsRecovery || recordingKeepAliveNeedsRecovery || alertsNeedRecovery,
      severity,
      recording: recordingNeedsRecovery,
      recordingKeepAlive: recordingKeepAliveNeedsRecovery,
      keepAliveOnly,
      alerts: alertsNeedRecovery,
      reasons,
      recordingInactive,
      trackingNotRetained,
      watchInactive,
      gpsStale,
      sampleCountStalled,
      recordingKeepAliveSuppressed,
      recordingKeepAliveBlocked,
      recordingKeepAliveMissing,
      audioSuppressed,
      audioBlocked,
      audioMissing,
      checkedAtMs: currentTime,
    };

    if (recovery.needed) {
      notifyRecoveryNeeded();
    } else {
      dismissedRecoverySignature = "";
    }

    return getRecoveryState();
  }

  function scheduleRecoveryCheck({ graceMs = SPEED_RECOVERY_GRACE_MS, force = false } = {}) {
    clearRecoveryTimer();
    if (
      !intent.recordingShouldBeActive &&
      !intent.recordingKeepAliveShouldBeArmed &&
      !intent.speedAlertAudioShouldBeArmed
    ) {
      recoveryBaseline = null;
      clearRecoveryNeeded();
      return getRecoveryState();
    }

    recoveryBaseline = {
      sampleCount: actual.sampleCount,
      lastFixAt: actual.lastFixAt,
      checkedAtMs: nowMs(),
    };

    if (force || graceMs <= 0) {
      return runRecoveryCheck({ force });
    }

    recoveryTimerId = window.setTimeout(() => {
      recoveryTimerId = null;
      runRecoveryCheck();
    }, graceMs);
    return getRecoveryState();
  }

  function handleAppReturn(options = {}) {
    return scheduleRecoveryCheck(options);
  }

  function dismissRecoveryPrompt() {
    dismissedRecoverySignature = getRecoverySignature(recovery);
  }

  function installLifecycleListeners({
    recoveryHandler = null,
    persistHandler = null,
  } = {}) {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return () => {};
    }

    window[LIFECYCLE_CLEANUP_KEY]?.();
    onRecoveryNeeded = typeof recoveryHandler === "function" ? recoveryHandler : null;
    onPersistIntent = typeof persistHandler === "function" ? persistHandler : null;

    const cleanups = [];
    const add = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    };
    const persistLifecycleIntent = (reason) => {
      persistIntent(reason);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        persistLifecycleIntent("visibility-hidden");
        return;
      }
      handleAppReturn();
    };
    const onPageHide = () => persistLifecycleIntent("pagehide");
    const onBeforeUnload = () => persistLifecycleIntent("beforeunload");
    const onPageShow = () => {
      if (!document.hidden) handleAppReturn();
    };

    add(document, "visibilitychange", onVisibilityChange);
    add(window, "pagehide", onPageHide);
    add(window, "beforeunload", onBeforeUnload);
    add(window, "pageshow", onPageShow);

    const cleanup = () => {
      clearRecoveryTimer();
      while (cleanups.length) {
        cleanups.pop()?.();
      }
      if (window[LIFECYCLE_CLEANUP_KEY] === cleanup) {
        delete window[LIFECYCLE_CLEANUP_KEY];
      }
    };
    window[LIFECYCLE_CLEANUP_KEY] = cleanup;
    return cleanup;
  }

  return {
    clearRecoveryNeeded,
    dismissRecoveryPrompt,
    getActualSnapshot,
    getIntent,
    getRecoveryState,
    handleAppReturn,
    installLifecycleListeners,
    persistIntent,
    publishActivities,
    runRecoveryCheck,
    scheduleRecoveryCheck,
    sync,
  };
}

export const speedRuntime = createSpeedRuntime();
