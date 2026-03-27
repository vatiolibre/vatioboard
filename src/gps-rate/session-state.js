export function createGpsRateState({
  hiddenNow,
  wakeLockSupported,
  keepAwakeRequested,
  notes,
  lastSavedSummary,
}) {
  return {
    permissionState: "unknown",
    permissionStatus: null,
    isRunning: false,
    watchId: null,
    runStartedPerfMs: null,
    accumulatedRunDurationMs: 0,
    samples: [],
    hiddenCount: 0,
    hiddenNow: Boolean(hiddenNow),
    keepAwakeRequested: Boolean(keepAwakeRequested),
    wakeLockSentinel: null,
    wakeLockSupported: Boolean(wakeLockSupported),
    notes: typeof notes === "string" ? notes : "",
    lastSavedSummary,
    status: { key: "gpsRateIdle", params: null, rawText: null },
    actionNotice: null,
    actionNoticeTimerId: null,
    uiTimerId: null,
    currentSummary: null,
  };
}

export function getElapsedActiveMs(state, perfNow) {
  let elapsedMs = state.accumulatedRunDurationMs;
  if (state.isRunning && Number.isFinite(state.runStartedPerfMs) && Number.isFinite(perfNow)) {
    elapsedMs += perfNow - state.runStartedPerfMs;
  }
  return Math.max(0, elapsedMs);
}

export function hasSessionActivity(state) {
  return state.isRunning || state.accumulatedRunDurationMs > 0 || state.samples.length > 0;
}

export function setStatus(state, key, params = null) {
  state.status = { key, params, rawText: null };
}

export function setRawStatus(state, text) {
  state.status = { key: "gpsRateError", params: null, rawText: text };
}
