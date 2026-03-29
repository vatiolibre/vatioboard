import { createSample, summarizeSession } from "./summary.js";
import {
  getElapsedActiveMs,
  hasSessionActivity,
  setRawStatus,
  setStatus,
} from "./session-state.js";

export function createGpsRateController({
  appName,
  geoOptions,
  geoErrorCode,
  storageKeys,
  elements,
  state,
  renderer,
  toolsMenu,
  t,
  getLang,
  toggleLang,
  applyTranslations,
  saveJson,
  saveText,
}) {
  function buildCurrentSummary({ source = "current", savedAtMs = null } = {}) {
    const summary = summarizeSession({
      samples: state.samples.slice(),
      durationMs: getElapsedActiveMs(state, performance.now()),
      source,
      savedAtMs,
      notes: state.notes,
      statusText: renderer.getStatusText(),
    });

    return renderer.decorateSummary(summary);
  }

  function refreshView() {
    state.currentSummary = buildCurrentSummary({ source: "current" });
    renderer.renderSession();
  }

  function setActionNotice(keyOrText, params = null, isRaw = false) {
    state.actionNotice = isRaw
      ? { rawText: keyOrText, key: null, params: null }
      : { rawText: null, key: keyOrText, params };

    if (state.actionNoticeTimerId !== null) {
      window.clearTimeout(state.actionNoticeTimerId);
    }

    state.actionNoticeTimerId = window.setTimeout(() => {
      state.actionNotice = null;
      state.actionNoticeTimerId = null;
      renderer.renderActionNotice();
    }, 3600);

    renderer.renderActionNotice();
  }

  function persistCurrentSummary() {
    if (!state.samples.length) return;
    const summary = buildCurrentSummary({ source: "saved", savedAtMs: Date.now() });
    state.lastSavedSummary = summary;
    saveJson(storageKeys.lastSummary, summary);
  }

  function bindMenuNavigation(element, href) {
    if (!element) return;
    element.addEventListener("click", () => {
      toolsMenu.close();
      window.location.href = href;
    });
  }

  function stopWatchOnly() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  function finishRunningClock() {
    if (state.isRunning && Number.isFinite(state.runStartedPerfMs)) {
      state.accumulatedRunDurationMs += performance.now() - state.runStartedPerfMs;
    }
    state.runStartedPerfMs = null;
    state.isRunning = false;
  }

  function handlePosition(position) {
    const sample = createSample({
      position,
      previousSample: state.samples.length ? state.samples[state.samples.length - 1] : null,
      sampleIndex: state.samples.length + 1,
      callbackPerfMs: performance.now(),
      callbackWallClockMs: Date.now(),
      hiddenNow: document.hidden,
    });

    state.samples.push(sample);
    setStatus(state, "gpsRateRunning");
    renderer.appendLogRow(sample);
    refreshView();
  }

  function handlePositionError(error) {
    if (error.code === geoErrorCode.PERMISSION_DENIED) {
      stopWatchOnly();
      finishRunningClock();
      setStatus(state, "gpsRatePermissionBlocked");
      refreshView();
      return;
    }

    if (error.code === geoErrorCode.POSITION_UNAVAILABLE) {
      setStatus(state, "gpsRateUnavailable");
      refreshView();
      return;
    }

    if (error.code === geoErrorCode.TIMEOUT) {
      setStatus(state, "gpsRateTimeout");
      refreshView();
      return;
    }

    setRawStatus(state, error && error.message ? error.message : t("gpsRateError"));
    refreshView();
  }

  function startTest() {
    if (state.isRunning) return;

    if (!("geolocation" in navigator)) {
      setStatus(state, "gpsRateUnsupported");
      refreshView();
      return;
    }

    state.isRunning = true;
    state.runStartedPerfMs = performance.now();
    setStatus(state, "gpsRateWaitingFix");
    stopWatchOnly();

    state.watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handlePositionError,
      geoOptions,
    );

    if (state.keepAwakeRequested) {
      requestWakeLock({ silent: true });
    }

    refreshView();
  }

  function stopTest({ persist = true } = {}) {
    if (!state.isRunning && state.watchId === null) return;

    stopWatchOnly();
    finishRunningClock();
    setStatus(state, "gpsRateStopped");
    if (persist) persistCurrentSummary();
    refreshView();
  }

  function resetTest() {
    if (state.samples.length) {
      persistCurrentSummary();
    }

    stopWatchOnly();
    finishRunningClock();
    state.accumulatedRunDurationMs = 0;
    state.samples = [];
    state.hiddenCount = 0;
    setStatus(state, "gpsRateResetDone");
    renderer.clearVisibleLog();
    refreshView();
  }

  function getExportFilename(extension) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const notes = state.notes.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);

    return notes ? `gps-rate-${notes}-${timestamp}.${extension}` : `gps-rate-${timestamp}.${extension}`;
  }

  function downloadTextFile(filename, contents, mimeType) {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function getCurrentOrLiveSummary() {
    return state.currentSummary || buildCurrentSummary({ source: "current" });
  }

  function buildExportPayload() {
    return {
      app: appName,
      exportedAt: new Date().toISOString(),
      notes: state.notes.trim(),
      config: geoOptions,
      observedRateOnly: true,
      summary: getCurrentOrLiveSummary(),
      samples: state.samples,
    };
  }

  function exportJson() {
    if (!state.samples.length) {
      setActionNotice("gpsRateExportUnavailable");
      return;
    }

    const payload = JSON.stringify(buildExportPayload(), null, 2);
    downloadTextFile(getExportFilename("json"), payload, "application/json");
    setActionNotice("gpsRateJsonExported");
  }

  function csvCell(value) {
    if (value === null || value === undefined) return "";
    const stringValue = String(value);
    if (/[",\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, "\"\"")}"`;
    }
    return stringValue;
  }

  function buildCsv() {
    const summary = getCurrentOrLiveSummary();
    const lines = [
      `# ${appName}`,
      `# ${t("gpsRateObservedOnlyNote")}`,
      `# Exported: ${new Date().toISOString()}`,
      `# Notes: ${state.notes.trim() || "-"}`,
      `# Samples: ${summary.sampleCount}`,
      `# Duration Ms: ${Math.round(summary.durationMs)}`,
      `# Average Interval Ms: ${summary.averageIntervalMs ?? ""}`,
      `# Median Interval Ms: ${summary.medianIntervalMs ?? ""}`,
      `# Best Interval Ms: ${summary.minIntervalMs ?? ""}`,
      `# Best Observed Hz: ${summary.bestObservedHz ?? ""}`,
      `# Whole Session Hz: ${summary.wholeSessionHz ?? ""}`,
      "index,callback_wall_clock_iso,callback_wall_clock_ms,performance_now_ms,position_timestamp_iso,position_timestamp_ms,interval_ms,effective_hz,geo_timestamp_delta_ms,sample_age_ms,latitude,longitude,speed_mps,heading_deg,accuracy_m,altitude_m,altitude_accuracy_m,movement_state,movement_source,derived_speed_mps,distance_from_previous_m,visibility_state,is_stale",
    ];

    for (let index = 0; index < state.samples.length; index += 1) {
      const sample = state.samples[index];
      lines.push([
        sample.index,
        Number.isFinite(sample.callbackWallClockMs) ? new Date(sample.callbackWallClockMs).toISOString() : "",
        sample.callbackWallClockMs,
        sample.performanceNowMs,
        Number.isFinite(sample.positionTimestampMs) ? new Date(sample.positionTimestampMs).toISOString() : "",
        sample.positionTimestampMs,
        sample.intervalMs,
        sample.effectiveHz,
        sample.geoTimestampDeltaMs,
        sample.sampleAgeMs,
        sample.latitude,
        sample.longitude,
        sample.speedMps,
        sample.headingDeg,
        sample.accuracyM,
        sample.altitudeM,
        sample.altitudeAccuracyM,
        sample.movementState,
        sample.movementSource,
        sample.derivedSpeedMps,
        sample.distanceFromPreviousM,
        sample.visibilityState,
        sample.isStale,
      ].map(csvCell).join(","));
    }

    return lines.join("\n");
  }

  function exportCsv() {
    if (!state.samples.length) {
      setActionNotice("gpsRateExportUnavailable");
      return;
    }

    downloadTextFile(getExportFilename("csv"), buildCsv(), "text/csv;charset=utf-8");
    setActionNotice("gpsRateCsvExported");
  }

  async function copySummary() {
    const summary = hasSessionActivity(state) ? state.currentSummary : state.lastSavedSummary;

    if (!summary) {
      setActionNotice("gpsRateExportUnavailable");
      return;
    }

    const lines = [
      appName,
      t("gpsRateObservedOnlyNote"),
      `${t("gpsRateStatus")}: ${summary.statusText || "—"}`,
      `${t("gpsRateElapsed")}: ${renderer.formatDuration(summary.durationMs)}`,
      `${t("gpsRateSamples")}: ${renderer.formatInteger(summary.sampleCount)}`,
      `${t("gpsRateMinimumInterval")}: ${renderer.formatMs(summary.minIntervalMs)}`,
      `${t("gpsRateAverageInterval")}: ${renderer.formatMs(summary.averageIntervalMs)}`,
      `${t("gpsRateMedianInterval")}: ${renderer.formatMs(summary.medianIntervalMs)}`,
      `${t("gpsRateWholeAverageHz")}: ${renderer.formatHz(summary.effectiveAverageHz)}`,
      `${t("gpsRateBestHz")}: ${renderer.formatHz(summary.bestObservedHz)}`,
      `${t("gpsRateAverageAccuracy")}: ${renderer.formatMeters(summary.averageAccuracyM)}`,
      `${t("gpsRateSpeedField")}: ${summary.fieldAvailability.speed ? t("gpsRateAvailable") : t("gpsRateNotSeen")}`,
      `${t("gpsRateHeadingField")}: ${summary.fieldAvailability.heading ? t("gpsRateAvailable") : t("gpsRateNotSeen")}`,
      `${t("gpsRateAltitudeField")}: ${summary.fieldAvailability.altitude ? t("gpsRateAvailable") : t("gpsRateNotSeen")}`,
      `${t("gpsRateFiveSecondHz")}: ${renderer.formatHz(summary.fiveSecondHz)}`,
      `${t("gpsRateWholeSessionHz")}: ${renderer.formatHz(summary.wholeSessionHz)}`,
      `${t("gpsRateSessionNotes")}: ${summary.notes || "-"}`,
    ];

    const text = lines.join("\n");

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "readonly");
        area.style.position = "absolute";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setActionNotice("gpsRateSummaryCopied");
    } catch {
      setActionNotice("gpsRateCopyUnavailable");
    }
  }

  async function requestWakeLock({ silent = false } = {}) {
    if (!state.wakeLockSupported || document.hidden) return;

    try {
      const sentinel = await navigator.wakeLock.request("screen");
      state.wakeLockSentinel = sentinel;
      sentinel.addEventListener("release", () => {
        state.wakeLockSentinel = null;
        refreshView();
      });
      refreshView();
      if (!silent) setActionNotice("gpsRateWakeEnabled");
    } catch {
      if (!silent) setActionNotice("gpsRateWakeFailed");
      refreshView();
    }
  }

  async function releaseWakeLock({ silent = false } = {}) {
    if (!state.wakeLockSentinel) return;
    try {
      await state.wakeLockSentinel.release();
    } catch {
      // Ignore stale release errors.
    }
    state.wakeLockSentinel = null;
    if (!silent) setActionNotice("gpsRateWakeDisabled");
    refreshView();
  }

  async function toggleWakeLock() {
    state.keepAwakeRequested = !state.keepAwakeRequested;
    saveText(storageKeys.keepAwake, String(state.keepAwakeRequested));

    if (!state.keepAwakeRequested) {
      await releaseWakeLock({ silent: false });
      return;
    }

    await requestWakeLock({ silent: false });
  }

  async function refreshPermissionState() {
    if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
      state.permissionState = "unsupported";
      refreshView();
      return;
    }

    try {
      if (state.permissionStatus && typeof state.permissionStatus.removeEventListener === "function") {
        state.permissionStatus.removeEventListener("change", handlePermissionChange);
      }

      state.permissionStatus = await navigator.permissions.query({ name: "geolocation" });
      state.permissionState = state.permissionStatus.state;

      if (typeof state.permissionStatus.addEventListener === "function") {
        state.permissionStatus.addEventListener("change", handlePermissionChange);
      } else {
        state.permissionStatus.onchange = handlePermissionChange;
      }
    } catch {
      state.permissionState = "unknown";
    }

    refreshView();
  }

  function handlePermissionChange() {
    state.permissionState = state.permissionStatus ? state.permissionStatus.state : "unknown";
    refreshView();
  }

  function handleVisibilityChange() {
    state.hiddenNow = document.hidden;
    if (document.hidden) {
      if (hasSessionActivity(state)) {
        state.hiddenCount += 1;
      }
      releaseWakeLock({ silent: true });
    } else if (state.keepAwakeRequested) {
      requestWakeLock({ silent: true });
    }
    refreshView();
  }

  function handleNotesInput() {
    state.notes = elements.sessionNotes.value;
    saveText(storageKeys.notes, state.notes);
    refreshView();
  }

  function syncLanguage() {
    applyTranslations();
    renderer.updatePageMeta();
    if (elements.langToggle) {
      elements.langToggle.textContent = getLang().toUpperCase();
    }
    renderer.renderActionNotice();
    refreshView();
  }

  function bindEvents() {
    elements.langToggle.addEventListener("click", () => {
      toggleLang();
    });
    bindMenuNavigation(elements.openSpeedMenu, "/speed");
    bindMenuNavigation(elements.openAccelMenu, "/accel");
    bindMenuNavigation(elements.openCalculatorMenu, "/calculator");
    bindMenuNavigation(elements.openBoardMenu, "/");

    document.addEventListener("i18n:change", syncLanguage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    elements.startTest.addEventListener("click", startTest);
    elements.stopTest.addEventListener("click", () => stopTest({ persist: true }));
    elements.resetTest.addEventListener("click", resetTest);
    elements.startQuickTest?.addEventListener("click", startTest);
    elements.stopQuickTest?.addEventListener("click", () => stopTest({ persist: true }));
    elements.resetQuickTest?.addEventListener("click", resetTest);
    elements.exportJson.addEventListener("click", exportJson);
    elements.exportCsv.addEventListener("click", exportCsv);
    elements.copySummary.addEventListener("click", copySummary);
    elements.wakeLockToggle.addEventListener("click", toggleWakeLock);
    elements.clearLog.addEventListener("click", () => {
      renderer.clearVisibleLog();
      setActionNotice("gpsRateLogCleared");
      refreshView();
    });
    elements.sessionNotes.addEventListener("input", handleNotesInput);

    window.addEventListener("beforeunload", () => {
      persistCurrentSummary();
      releaseWakeLock({ silent: true });
    });
  }

  function init() {
    renderer.updatePageMeta();
    elements.langToggle.textContent = getLang().toUpperCase();
    elements.sessionNotes.value = state.notes;
    renderer.renderActionNotice();
    refreshView();
    bindEvents();
    refreshPermissionState();

    state.uiTimerId = window.setInterval(() => {
      refreshView();
    }, 1000);
  }

  return {
    init,
  };
}
