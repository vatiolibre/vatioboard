import "../styles/gps-rate.less";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import { IconAccel, IconBoard, IconCalculator, IconSpeed } from "../icons.js";

applyTranslations();

const APP_NAME = "Vatio GPS Rate Lab";
const GEO_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
};
const GEO_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
};
const STORAGE_KEYS = {
  notes: "vatio_gps_rate_notes",
  keepAwake: "vatio_gps_rate_keep_awake",
  lastSummary: "vatio_gps_rate_last_summary",
};
const MAX_LOG_ROWS = 200;
const SPARKLINE_WINDOW = 48;
const ACCURACY_WARNING_M = 25;
const SPARSE_INTERVAL_WARNING_MS = 2500;
const SPARSE_HZ_WARNING = 0.66;
const STALE_SAMPLE_AGE_MS = 1500;
const MIN_VALID_EPOCH_MS = Date.UTC(2000, 0, 1);
const MOVING_SPEED_THRESHOLD_MS = 1;
const STATIONARY_SPEED_THRESHOLD_MS = 0.3;
const MIN_DISTANCE_NOISE_FLOOR_M = 4;
const MAX_ACCURACY_INFLUENCE_M = 18;
const HISTOGRAM_BUCKETS = [
  { label: "<100", min: 0, max: 100 },
  { label: "100-249", min: 100, max: 250 },
  { label: "250-499", min: 250, max: 500 },
  { label: "500-999", min: 500, max: 1000 },
  { label: "1000-1499", min: 1000, max: 1500 },
  { label: "1500-2999", min: 1500, max: 3000 },
  { label: "3000+", min: 3000, max: Number.POSITIVE_INFINITY },
];

const elements = {
  langToggle: document.getElementById("langToggle"),
  pageDescriptionMeta: document.querySelector('meta[name="description"]'),
  toolsMenuBtn: document.getElementById("gpsRateToolsMenuBtn"),
  toolsMenuList: document.getElementById("gpsRateToolsMenuList"),
  openSpeedMenu: document.getElementById("openGpsRateSpeedMenu"),
  openAccelMenu: document.getElementById("openGpsRateAccelMenu"),
  openCalculatorMenu: document.getElementById("openGpsRateCalculatorMenu"),
  openBoardMenu: document.getElementById("openGpsRateBoardMenu"),
  permissionChipValue: document.getElementById("permissionChipValue"),
  visibilityChipValue: document.getElementById("visibilityChipValue"),
  headerStatusText: document.getElementById("headerStatusText"),
  statusBadge: document.getElementById("statusBadge"),
  startTest: document.getElementById("startTest"),
  stopTest: document.getElementById("stopTest"),
  resetTest: document.getElementById("resetTest"),
  exportJson: document.getElementById("exportJson"),
  exportCsv: document.getElementById("exportCsv"),
  copySummary: document.getElementById("copySummary"),
  wakeLockToggle: document.getElementById("wakeLockToggle"),
  wakeLockStateText: document.getElementById("wakeLockStateText"),
  permissionSummaryText: document.getElementById("permissionSummaryText"),
  visibilitySummaryText: document.getElementById("visibilitySummaryText"),
  sessionNotes: document.getElementById("sessionNotes"),
  actionNotice: document.getElementById("actionNotice"),
  currentIntervalValue: document.getElementById("currentIntervalValue"),
  effectiveHzValue: document.getElementById("effectiveHzValue"),
  sampleCountValue: document.getElementById("sampleCountValue"),
  elapsedValue: document.getElementById("elapsedValue"),
  liveAccuracyValue: document.getElementById("liveAccuracyValue"),
  movementValue: document.getElementById("movementValue"),
  summarySourcePill: document.getElementById("summarySourcePill"),
  summarySavedAt: document.getElementById("summarySavedAt"),
  summaryGrid: document.getElementById("summaryGrid"),
  summaryDurationValue: document.getElementById("summaryDurationValue"),
  summarySampleCountValue: document.getElementById("summarySampleCountValue"),
  summaryBestIntervalValue: document.getElementById("summaryBestIntervalValue"),
  summaryAverageIntervalValue: document.getElementById("summaryAverageIntervalValue"),
  summaryMedianIntervalValue: document.getElementById("summaryMedianIntervalValue"),
  summaryAverageHzValue: document.getElementById("summaryAverageHzValue"),
  summaryBestHzValue: document.getElementById("summaryBestHzValue"),
  summarySpeedFieldValue: document.getElementById("summarySpeedFieldValue"),
  summaryHeadingFieldValue: document.getElementById("summaryHeadingFieldValue"),
  summaryAltitudeFieldValue: document.getElementById("summaryAltitudeFieldValue"),
  summaryAccuracyValue: document.getElementById("summaryAccuracyValue"),
  summaryStatusNotesValue: document.getElementById("summaryStatusNotesValue"),
  summaryEmptyState: document.getElementById("summaryEmptyState"),
  warningBadges: document.getElementById("warningBadges"),
  jitterValue: document.getElementById("jitterValue"),
  staleCountValue: document.getElementById("staleCountValue"),
  nullSpeedValue: document.getElementById("nullSpeedValue"),
  nullHeadingValue: document.getElementById("nullHeadingValue"),
  missingAltitudeValue: document.getElementById("missingAltitudeValue"),
  bestObservedHzValue: document.getElementById("bestObservedHzValue"),
  fiveSecondHzValue: document.getElementById("fiveSecondHzValue"),
  wholeSessionHzValue: document.getElementById("wholeSessionHzValue"),
  sparklineRangeLabel: document.getElementById("sparklineRangeLabel"),
  intervalSparklineLine: document.getElementById("intervalSparklineLine"),
  histogramList: document.getElementById("histogramList"),
  availabilitySpeedValue: document.getElementById("availabilitySpeedValue"),
  availabilityHeadingValue: document.getElementById("availabilityHeadingValue"),
  availabilityAltitudeValue: document.getElementById("availabilityAltitudeValue"),
  availabilityAltitudeAccuracyValue: document.getElementById("availabilityAltitudeAccuracyValue"),
  availabilityAccuracyValue: document.getElementById("availabilityAccuracyValue"),
  latestLatitudeValue: document.getElementById("latestLatitudeValue"),
  latestLongitudeValue: document.getElementById("latestLongitudeValue"),
  latestSpeedValue: document.getElementById("latestSpeedValue"),
  latestHeadingValue: document.getElementById("latestHeadingValue"),
  latestAccuracyValue: document.getElementById("latestAccuracyValue"),
  latestAltitudeValue: document.getElementById("latestAltitudeValue"),
  latestAltitudeAccuracyValue: document.getElementById("latestAltitudeAccuracyValue"),
  latestGeoTimestampValue: document.getElementById("latestGeoTimestampValue"),
  latestPerfTimestampValue: document.getElementById("latestPerfTimestampValue"),
  latestSampleAgeValue: document.getElementById("latestSampleAgeValue"),
  latestCallbackDeltaValue: document.getElementById("latestCallbackDeltaValue"),
  latestGeoDeltaValue: document.getElementById("latestGeoDeltaValue"),
  motionStateValue: document.getElementById("motionStateValue"),
  motionSourceValue: document.getElementById("motionSourceValue"),
  movingHzValue: document.getElementById("movingHzValue"),
  stationaryHzValue: document.getElementById("stationaryHzValue"),
  movingSamplesValue: document.getElementById("movingSamplesValue"),
  stationarySamplesValue: document.getElementById("stationarySamplesValue"),
  clearLog: document.getElementById("clearLog"),
  logEmptyState: document.getElementById("logEmptyState"),
  logTableWrap: document.getElementById("logTableWrap"),
  eventLogBody: document.getElementById("eventLogBody"),
};

const toolsMenu = initToolsMenu({
  button: elements.toolsMenuBtn,
  list: elements.toolsMenuList,
});

applyButtonIcon(elements.openSpeedMenu, IconSpeed);
applyButtonIcon(elements.openAccelMenu, IconAccel);
applyButtonIcon(elements.openCalculatorMenu, IconCalculator);
applyButtonIcon(elements.openBoardMenu, IconBoard);

function bindMenuNavigation(element, href) {
  if (!element) return;
  element.addEventListener("click", () => {
    toolsMenu.close();
    window.location.href = href;
  });
}

const state = {
  permissionState: "unknown",
  permissionStatus: null,
  isRunning: false,
  watchId: null,
  runStartedPerfMs: null,
  accumulatedRunDurationMs: 0,
  samples: [],
  hiddenCount: 0,
  hiddenNow: document.hidden,
  keepAwakeRequested: loadBoolean(STORAGE_KEYS.keepAwake, false),
  wakeLockSentinel: null,
  wakeLockSupported: Boolean(navigator.wakeLock && typeof navigator.wakeLock.request === "function"),
  notes: loadText(STORAGE_KEYS.notes, ""),
  lastSavedSummary: normalizeStoredSummary(loadJson(STORAGE_KEYS.lastSummary)),
  status: { key: "gpsRateIdle", params: null, rawText: null },
  actionNotice: null,
  actionNoticeTimerId: null,
  uiTimerId: null,
  currentSummary: null,
};

function tf(key, params = {}) {
  return t(key).replace(/\{(\w+)\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(params, token)) {
      return String(params[token]);
    }
    return match;
  });
}

function loadText(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function loadBoolean(key, fallback = false) {
  const value = loadText(key, fallback ? "true" : "false");
  return value === "true";
}

function loadJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function saveText(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private or constrained browsers.
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in private or constrained browsers.
  }
}

function normalizeStoredSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    source: "saved",
    savedAtMs: Number.isFinite(summary.savedAtMs) ? summary.savedAtMs : Date.now(),
    durationMs: Number.isFinite(summary.durationMs) ? summary.durationMs : 0,
    sampleCount: Number.isFinite(summary.sampleCount) ? summary.sampleCount : 0,
    currentIntervalMs: Number.isFinite(summary.currentIntervalMs) ? summary.currentIntervalMs : null,
    averageIntervalMs: Number.isFinite(summary.averageIntervalMs) ? summary.averageIntervalMs : null,
    medianIntervalMs: Number.isFinite(summary.medianIntervalMs) ? summary.medianIntervalMs : null,
    minIntervalMs: Number.isFinite(summary.minIntervalMs) ? summary.minIntervalMs : null,
    maxIntervalMs: Number.isFinite(summary.maxIntervalMs) ? summary.maxIntervalMs : null,
    effectiveAverageHz: Number.isFinite(summary.effectiveAverageHz) ? summary.effectiveAverageHz : null,
    bestObservedHz: Number.isFinite(summary.bestObservedHz) ? summary.bestObservedHz : null,
    fiveSecondHz: Number.isFinite(summary.fiveSecondHz) ? summary.fiveSecondHz : null,
    wholeSessionHz: Number.isFinite(summary.wholeSessionHz) ? summary.wholeSessionHz : null,
    averageAccuracyM: Number.isFinite(summary.averageAccuracyM) ? summary.averageAccuracyM : null,
    latestAccuracyM: Number.isFinite(summary.latestAccuracyM) ? summary.latestAccuracyM : null,
    nullSpeedCount: Number.isFinite(summary.nullSpeedCount) ? summary.nullSpeedCount : 0,
    nullHeadingCount: Number.isFinite(summary.nullHeadingCount) ? summary.nullHeadingCount : 0,
    missingAltitudeCount: Number.isFinite(summary.missingAltitudeCount) ? summary.missingAltitudeCount : 0,
    staleSampleCount: Number.isFinite(summary.staleSampleCount) ? summary.staleSampleCount : 0,
    jitterMs: Number.isFinite(summary.jitterMs) ? summary.jitterMs : null,
    fieldAvailability: summary.fieldAvailability || {
      speed: false,
      heading: false,
      altitude: false,
      altitudeAccuracy: false,
      accuracy: false,
    },
    unsupportedFields: Array.isArray(summary.unsupportedFields) ? summary.unsupportedFields : [],
    motion: summary.motion || {},
    histogram: Array.isArray(summary.histogram) ? summary.histogram : [],
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
    statusText: typeof summary.statusText === "string" ? summary.statusText : "",
    notes: typeof summary.notes === "string" ? summary.notes : "",
  };
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizePositionTimestamp(timestamp, fallbackMs = Date.now()) {
  if (!isFiniteNumber(timestamp)) return fallbackMs;

  const safeFallbackMs = isFiniteNumber(fallbackMs) ? fallbackMs : Date.now();
  const maxReasonableMs = safeFallbackMs + (60 * 1000);

  if (timestamp < MIN_VALID_EPOCH_MS || timestamp > maxReasonableMs) {
    return safeFallbackMs;
  }

  return timestamp;
}

function getElapsedActiveMs() {
  let elapsedMs = state.accumulatedRunDurationMs;
  if (state.isRunning && isFiniteNumber(state.runStartedPerfMs)) {
    elapsedMs += performance.now() - state.runStartedPerfMs;
  }
  return Math.max(0, elapsedMs);
}

function hasSessionActivity() {
  return state.isRunning || state.accumulatedRunDurationMs > 0 || state.samples.length > 0;
}

function formatDecimal(value, decimals = 1) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat(getLang(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatSvgNumber(value) {
  if (!isFiniteNumber(value)) return "0";
  return String(Math.round(value * 10) / 10);
}

function formatInteger(value) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat(getLang(), {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCoordinate(value) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat(getLang(), {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatMs(value) {
  if (!isFiniteNumber(value)) return "—";
  if (Math.abs(value) >= 1000) return `${formatInteger(value)} ms`;
  return `${formatDecimal(value, 1)} ms`;
}

function formatHz(value) {
  if (!isFiniteNumber(value) || value <= 0) return "—";
  const decimals = value >= 10 ? 1 : 2;
  return `${formatDecimal(value, decimals)} Hz`;
}

function formatMeters(value) {
  if (!isFiniteNumber(value)) return "—";
  return `${formatDecimal(value, value >= 100 ? 0 : 1)} m`;
}

function formatSpeed(value) {
  if (!isFiniteNumber(value)) return "—";
  return `${formatDecimal(value, 2)} m/s`;
}

function formatHeading(value) {
  if (!isFiniteNumber(value)) return "—";
  return `${formatDecimal(value, 1)}°`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatLocalTimestamp(ms) {
  if (!isFiniteNumber(ms)) return "—";

  const date = new Date(ms);
  const formatted = new Intl.DateTimeFormat(getLang(), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);

  return `${formatted}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function formatPerfTimestamp(ms) {
  if (!isFiniteNumber(ms)) return "—";
  return `${formatDecimal(ms, 1)} ms`;
}

function getPermissionLabel(stateValue) {
  switch (stateValue) {
    case "granted":
      return t("gpsRatePermissionGranted");
    case "prompt":
      return t("gpsRatePermissionPrompt");
    case "denied":
      return t("gpsRatePermissionDenied");
    case "unsupported":
      return t("gpsRatePermissionUnavailable");
    default:
      return t("gpsRatePermissionUnknown");
  }
}

function getVisibilityLabel() {
  return document.hidden ? t("gpsRateVisibilityHidden") : t("gpsRateVisibilityVisible");
}

function getMotionStateLabel(value) {
  switch (value) {
    case "moving":
      return t("gpsRateMoving");
    case "stationary":
      return t("gpsRateStationary");
    default:
      return t("gpsRateUncertain");
  }
}

function getMotionSourceLabel(value) {
  switch (value) {
    case "reported":
      return t("gpsRateMotionReported");
    case "derived":
      return t("gpsRateMotionDerived");
    default:
      return t("gpsRateMotionUnknown");
  }
}

function getWakeLockStateLabel() {
  if (!state.wakeLockSupported) return t("gpsRateWakeUnsupported");
  return state.wakeLockSentinel ? t("gpsRateWakeActive") : t("gpsRateWakeInactive");
}

function getFieldLabel(field) {
  switch (field) {
    case "speed":
      return t("gpsRateSpeedField");
    case "heading":
      return t("gpsRateHeadingField");
    case "altitude":
      return t("gpsRateAltitudeField");
    case "altitudeAccuracy":
      return t("gpsRateAltitudeAccuracyField");
    case "accuracy":
      return t("gpsRateAccuracyField");
    default:
      return field;
  }
}

function getStatusText() {
  if (state.status.rawText) return state.status.rawText;
  return tf(state.status.key, state.status.params || {});
}

function getStatusTone() {
  switch (state.status.key) {
    case "gpsRateRunning":
      return "running";
    case "gpsRatePermissionBlocked":
    case "gpsRateUnsupported":
    case "gpsRateError":
      return "error";
    case "gpsRateWaitingFix":
    case "gpsRateUnavailable":
    case "gpsRateTimeout":
      return "warning";
    default:
      return "neutral";
  }
}

function setStatus(key, params = null) {
  state.status = { key, params, rawText: null };
}

function setRawStatus(text) {
  state.status = { key: "gpsRateError", params: null, rawText: text };
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
    renderActionNotice();
  }, 3600);

  renderActionNotice();
}

function renderActionNotice() {
  if (!elements.actionNotice) return;
  if (!state.actionNotice) {
    elements.actionNotice.textContent = "";
    return;
  }

  elements.actionNotice.textContent = state.actionNotice.rawText
    ? state.actionNotice.rawText
    : tf(state.actionNotice.key, state.actionNotice.params || {});
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const meanValue = average(values);
  const variance = values.reduce((sum, value) => {
    const delta = value - meanValue;
    return sum + (delta * delta);
  }, 0) / values.length;
  return Math.sqrt(variance);
}

function haversineDistance(a, b) {
  if (!isFiniteNumber(a.latitude) || !isFiniteNumber(a.longitude) || !isFiniteNumber(b.latitude) || !isFiniteNumber(b.longitude)) {
    return null;
  }

  const radius = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const calc = (
    sinLat * sinLat
    + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  );

  return radius * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

function getMovementThresholdM(currentAccuracyM, previousAccuracyM) {
  const accuracies = [currentAccuracyM, previousAccuracyM].filter(isFiniteNumber);
  const accuracyFloorM = accuracies.length
    ? Math.min(Math.max.apply(null, accuracies), MAX_ACCURACY_INFLUENCE_M)
    : 0;

  return Math.max(MIN_DISTANCE_NOISE_FLOOR_M, accuracyFloorM * 0.5);
}

function normalizeSpeed(value) {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function normalizeHeading(value) {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function normalizeMetric(value) {
  return isFiniteNumber(value) ? value : null;
}

function classifyMotion(coords, previousSample, callbackPerfMs) {
  const reportedSpeed = normalizeSpeed(coords.speed);

  if (reportedSpeed !== null) {
    if (reportedSpeed >= MOVING_SPEED_THRESHOLD_MS) {
      return { state: "moving", source: "reported", derivedSpeedMps: null, distanceM: null };
    }
    if (reportedSpeed <= STATIONARY_SPEED_THRESHOLD_MS) {
      return { state: "stationary", source: "reported", derivedSpeedMps: null, distanceM: null };
    }
  }

  if (!previousSample) {
    return { state: "uncertain", source: "unknown", derivedSpeedMps: null, distanceM: null };
  }

  const intervalMs = callbackPerfMs - previousSample.performanceNowMs;
  const distanceM = haversineDistance(
    { latitude: previousSample.latitude, longitude: previousSample.longitude },
    { latitude: coords.latitude, longitude: coords.longitude },
  );

  if (!isFiniteNumber(intervalMs) || intervalMs <= 0 || !isFiniteNumber(distanceM)) {
    return { state: "uncertain", source: "unknown", derivedSpeedMps: null, distanceM: null };
  }

  const derivedSpeedMps = distanceM / (intervalMs / 1000);
  const movementThresholdM = getMovementThresholdM(coords.accuracy, previousSample.accuracyM);

  if (distanceM >= movementThresholdM && derivedSpeedMps >= MOVING_SPEED_THRESHOLD_MS) {
    return { state: "moving", source: "derived", derivedSpeedMps, distanceM };
  }

  if (distanceM <= Math.max(2, movementThresholdM * 0.5) && derivedSpeedMps <= STATIONARY_SPEED_THRESHOLD_MS) {
    return { state: "stationary", source: "derived", derivedSpeedMps, distanceM };
  }

  return { state: "uncertain", source: "unknown", derivedSpeedMps, distanceM };
}

function isStaleSample(positionTimestampMs, previousSample, sampleAgeMs) {
  if (isFiniteNumber(positionTimestampMs) && previousSample && isFiniteNumber(previousSample.positionTimestampMs)) {
    if (positionTimestampMs <= previousSample.positionTimestampMs) {
      return true;
    }
  }

  return isFiniteNumber(sampleAgeMs) && sampleAgeMs > STALE_SAMPLE_AGE_MS;
}

function computeSessionHz(samples, windowMs = null) {
  if (samples.length < 2) return null;

  let windowSamples = samples;
  if (isFiniteNumber(windowMs)) {
    const latestPerfMs = samples[samples.length - 1].performanceNowMs;
    const startPerfMs = latestPerfMs - windowMs;
    windowSamples = samples.filter((sample) => sample.performanceNowMs >= startPerfMs);
  }

  if (windowSamples.length < 2) return null;

  const first = windowSamples[0];
  const last = windowSamples[windowSamples.length - 1];
  const spanMs = last.performanceNowMs - first.performanceNowMs;

  if (!isFiniteNumber(spanMs) || spanMs <= 0) return null;
  return ((windowSamples.length - 1) * 1000) / spanMs;
}

function computeMotionHz(samples, motionState) {
  const intervals = [];
  let sampleCount = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.movementState === motionState) {
      sampleCount += 1;
      if (isFiniteNumber(sample.intervalMs) && sample.intervalMs > 0) {
        intervals.push(sample.intervalMs);
      }
    }
  }

  return {
    sampleCount,
    hz: intervals.length ? 1000 / average(intervals) : null,
  };
}

function buildHistogram(intervals) {
  return HISTOGRAM_BUCKETS.map((bucket) => {
    const count = intervals.filter((value) => value >= bucket.min && value < bucket.max).length;
    return { label: bucket.label, count };
  });
}

function getJitterLabel(jitterMs) {
  if (!isFiniteNumber(jitterMs)) return "—";
  if (jitterMs < 75) return t("gpsRateJitterLow");
  if (jitterMs < 200) return t("gpsRateJitterModerate");
  return t("gpsRateJitterHigh");
}

function buildWarnings(summary) {
  const warnings = [];

  if (
    isFiniteNumber(summary.latestAccuracyM) && summary.latestAccuracyM > ACCURACY_WARNING_M
    || isFiniteNumber(summary.averageAccuracyM) && summary.averageAccuracyM > ACCURACY_WARNING_M
  ) {
    warnings.push({
      kind: "accuracy",
      label: t("gpsRatePoorAccuracy"),
      detail: tf("gpsRatePoorAccuracyDetail", {
        value: formatDecimal(summary.averageAccuracyM || summary.latestAccuracyM, 1),
      }),
    });
  }

  if (
    isFiniteNumber(summary.maxIntervalMs) && summary.maxIntervalMs >= SPARSE_INTERVAL_WARNING_MS
    || isFiniteNumber(summary.wholeSessionHz) && summary.wholeSessionHz < SPARSE_HZ_WARNING
    || isFiniteNumber(summary.fiveSecondHz) && summary.fiveSecondHz < SPARSE_HZ_WARNING
  ) {
    warnings.push({
      kind: "sparse",
      label: t("gpsRateSparseUpdates"),
      detail: tf("gpsRateSparseUpdatesDetail", {
        value: formatInteger(summary.maxIntervalMs || 0),
      }),
    });
  }

  if (state.hiddenNow) {
    warnings.push({
      kind: "hidden",
      label: t("gpsRateHiddenBehavior"),
      detail: t("gpsRateHiddenNow"),
    });
  } else if (state.hiddenCount > 0) {
    warnings.push({
      kind: "hidden",
      label: t("gpsRateHiddenBehavior"),
      detail: t("gpsRateHiddenSeen"),
    });
  }

  if (summary.unsupportedFields.length) {
    warnings.push({
      kind: "unsupported",
      label: t("gpsRateUnsupportedFields"),
      detail: tf("gpsRateUnsupportedFieldList", {
        fields: summary.unsupportedFields.map(getFieldLabel).join(", "),
      }),
    });
  }

  if (summary.staleSampleCount > 0) {
    warnings.push({
      kind: "stale",
      label: t("gpsRateStaleWarning"),
      detail: tf("gpsRateStaleDetail", { count: summary.staleSampleCount }),
    });
  }

  if (!warnings.length) {
    warnings.push({
      kind: "ok",
      label: t("gpsRateNoWarnings"),
      detail: "",
    });
  }

  return warnings;
}

function buildSummary({ source = "current", savedAtMs = null } = {}) {
  const samples = state.samples.slice();
  const latestSample = samples.length ? samples[samples.length - 1] : null;
  const intervals = samples
    .map((sample) => sample.intervalMs)
    .filter((value) => isFiniteNumber(value) && value > 0);
  const accuracyValues = samples
    .map((sample) => sample.accuracyM)
    .filter(isFiniteNumber);
  const fieldAvailability = {
    speed: samples.some((sample) => isFiniteNumber(sample.speedMps)),
    heading: samples.some((sample) => isFiniteNumber(sample.headingDeg)),
    altitude: samples.some((sample) => isFiniteNumber(sample.altitudeM)),
    altitudeAccuracy: samples.some((sample) => isFiniteNumber(sample.altitudeAccuracyM)),
    accuracy: samples.some((sample) => isFiniteNumber(sample.accuracyM)),
  };
  const unsupportedFields = Object.keys(fieldAvailability).filter((field) => !fieldAvailability[field]);
  const movingSummary = computeMotionHz(samples, "moving");
  const stationarySummary = computeMotionHz(samples, "stationary");
  const summary = {
    source,
    savedAtMs,
    durationMs: getElapsedActiveMs(),
    sampleCount: samples.length,
    currentIntervalMs: latestSample ? latestSample.intervalMs : null,
    averageIntervalMs: average(intervals),
    medianIntervalMs: median(intervals),
    minIntervalMs: intervals.length ? Math.min.apply(null, intervals) : null,
    maxIntervalMs: intervals.length ? Math.max.apply(null, intervals) : null,
    effectiveAverageHz: intervals.length ? 1000 / average(intervals) : null,
    bestObservedHz: intervals.length ? 1000 / Math.min.apply(null, intervals) : null,
    fiveSecondHz: computeSessionHz(samples, 5000),
    wholeSessionHz: computeSessionHz(samples),
    averageAccuracyM: average(accuracyValues),
    latestAccuracyM: latestSample ? latestSample.accuracyM : null,
    nullSpeedCount: samples.filter((sample) => !isFiniteNumber(sample.speedMps)).length,
    nullHeadingCount: samples.filter((sample) => !isFiniteNumber(sample.headingDeg)).length,
    missingAltitudeCount: samples.filter((sample) => !isFiniteNumber(sample.altitudeM)).length,
    staleSampleCount: samples.filter((sample) => sample.isStale).length,
    jitterMs: standardDeviation(intervals),
    fieldAvailability,
    unsupportedFields,
    histogram: buildHistogram(intervals),
    motion: {
      latestState: latestSample ? latestSample.movementState : "uncertain",
      latestSource: latestSample ? latestSample.movementSource : "unknown",
      movingHz: movingSummary.hz,
      stationaryHz: stationarySummary.hz,
      movingSamples: movingSummary.sampleCount,
      stationarySamples: stationarySummary.sampleCount,
    },
    statusText: getStatusText(),
    notes: state.notes.trim(),
  };

  summary.warnings = buildWarnings(summary);
  return summary;
}

function persistCurrentSummary() {
  if (!state.samples.length) return;
  const summary = buildSummary({ source: "saved", savedAtMs: Date.now() });
  state.lastSavedSummary = summary;
  saveJson(STORAGE_KEYS.lastSummary, summary);
}

function updatePageMeta() {
  document.documentElement.lang = getLang();
  document.title = t("gpsRatePageTitle");
  if (elements.pageDescriptionMeta) {
    elements.pageDescriptionMeta.setAttribute("content", t("gpsRatePageDescription"));
  }
}

function renderStatus(summaryForCard) {
  const statusText = getStatusText();
  const tone = getStatusTone();

  elements.headerStatusText.textContent = statusText;
  elements.statusBadge.textContent = statusText;
  elements.statusBadge.dataset.state = tone;

  elements.permissionChipValue.textContent = getPermissionLabel(state.permissionState);
  elements.permissionSummaryText.textContent = getPermissionLabel(state.permissionState);
  elements.visibilityChipValue.textContent = getVisibilityLabel();
  elements.visibilitySummaryText.textContent = getVisibilityLabel();

  if (!summaryForCard) {
    elements.summarySourcePill.textContent = t("gpsRateSourceCurrent");
    elements.summarySourcePill.dataset.state = tone;
  }
}

function renderControls(summaryForCard) {
  const hasCurrentSamples = state.samples.length > 0;
  const canCopy = Boolean(summaryForCard);

  elements.startTest.disabled = state.isRunning || !("geolocation" in navigator);
  elements.stopTest.disabled = !state.isRunning;
  elements.resetTest.disabled = !state.isRunning && !hasCurrentSamples;
  elements.exportJson.disabled = !hasCurrentSamples;
  elements.exportCsv.disabled = !hasCurrentSamples;
  elements.copySummary.disabled = !canCopy;
  elements.clearLog.disabled = elements.eventLogBody.children.length === 0;
  elements.wakeLockToggle.disabled = !state.wakeLockSupported;
  elements.wakeLockToggle.setAttribute("aria-pressed", String(Boolean(state.wakeLockSentinel)));
  elements.wakeLockStateText.textContent = getWakeLockStateLabel();

  if (state.notes !== elements.sessionNotes.value) {
    elements.sessionNotes.value = state.notes;
  }
}

function renderKpis(summary) {
  const latestSample = state.samples.length ? state.samples[state.samples.length - 1] : null;
  elements.currentIntervalValue.textContent = formatMs(summary.currentIntervalMs);
  elements.effectiveHzValue.textContent = formatHz(latestSample ? latestSample.effectiveHz : null);
  elements.sampleCountValue.textContent = formatInteger(summary.sampleCount);
  elements.elapsedValue.textContent = formatDuration(summary.durationMs);
  elements.liveAccuracyValue.textContent = formatMeters(summary.latestAccuracyM);
  elements.movementValue.textContent = latestSample ? getMotionStateLabel(summary.motion.latestState) : "—";
}

function renderSummaryCard(summary) {
  const hasSummary = Boolean(summary);
  const showEmptyState = !hasSummary || (!summary.sampleCount && summary.source === "current" && !state.isRunning && summary.durationMs === 0);

  elements.summaryGrid.hidden = showEmptyState;
  elements.summaryEmptyState.hidden = !showEmptyState;

  if (!hasSummary) {
    elements.summarySourcePill.textContent = t("gpsRateSourceCurrent");
    elements.summarySavedAt.textContent = "";
    return;
  }

  elements.summarySourcePill.textContent = summary.source === "saved" ? t("gpsRateSourceSaved") : t("gpsRateSourceCurrent");
  elements.summarySourcePill.dataset.state = summary.source === "saved" ? "warning" : getStatusTone();
  elements.summarySavedAt.textContent = summary.source === "saved"
    ? tf("gpsRateSummarySavedAt", { time: formatLocalTimestamp(summary.savedAtMs) })
    : "";

  elements.summaryDurationValue.textContent = formatDuration(summary.durationMs);
  elements.summarySampleCountValue.textContent = formatInteger(summary.sampleCount);
  elements.summaryBestIntervalValue.textContent = formatMs(summary.minIntervalMs);
  elements.summaryAverageIntervalValue.textContent = formatMs(summary.averageIntervalMs);
  elements.summaryMedianIntervalValue.textContent = formatMs(summary.medianIntervalMs);
  elements.summaryAverageHzValue.textContent = formatHz(summary.effectiveAverageHz);
  elements.summaryBestHzValue.textContent = formatHz(summary.bestObservedHz);
  elements.summarySpeedFieldValue.textContent = summary.fieldAvailability.speed ? t("gpsRateAvailable") : t("gpsRateNotSeen");
  elements.summaryHeadingFieldValue.textContent = summary.fieldAvailability.heading ? t("gpsRateAvailable") : t("gpsRateNotSeen");
  elements.summaryAltitudeFieldValue.textContent = summary.fieldAvailability.altitude ? t("gpsRateAvailable") : t("gpsRateNotSeen");
  elements.summaryAccuracyValue.textContent = formatMeters(summary.averageAccuracyM);
  elements.summaryStatusNotesValue.textContent = buildStatusNotes(summary);
}

function buildStatusNotes(summary) {
  const parts = [];
  if (summary.statusText) parts.push(summary.statusText);
  if (summary.notes) parts.push(summary.notes);
  return parts.length ? parts.join(" · ") : "—";
}

function renderWarningBadges(summary) {
  elements.warningBadges.replaceChildren();
  const warnings = summary ? summary.warnings : [{ kind: "ok", label: t("gpsRateNoWarnings"), detail: "" }];

  for (let index = 0; index < warnings.length; index += 1) {
    const warning = warnings[index];
    const badge = document.createElement("span");
    badge.className = "gps-rate-warning-badge";
    badge.dataset.kind = warning.kind;
    badge.textContent = warning.detail ? `${warning.label} · ${warning.detail}` : warning.label;
    elements.warningBadges.appendChild(badge);
  }
}

function renderHistogram(summary) {
  elements.histogramList.replaceChildren();

  const histogram = summary ? summary.histogram : buildHistogram([]);
  const maxCount = histogram.reduce((largest, bucket) => Math.max(largest, bucket.count), 0);

  for (let index = 0; index < histogram.length; index += 1) {
    const bucket = histogram[index];
    const row = document.createElement("div");
    row.className = "gps-rate-histogram-row";

    const label = document.createElement("span");
    label.className = "gps-rate-histogram-label";
    label.textContent = `${bucket.label} ms`;

    const bar = document.createElement("div");
    bar.className = "gps-rate-histogram-bar";

    const fill = document.createElement("div");
    fill.className = "gps-rate-histogram-fill";
    fill.style.width = maxCount > 0 ? `${Math.max(2, (bucket.count / maxCount) * 100)}%` : "0%";
    bar.appendChild(fill);

    const value = document.createElement("span");
    value.className = "gps-rate-histogram-value";
    value.textContent = formatInteger(bucket.count);

    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(value);
    elements.histogramList.appendChild(row);
  }
}

function renderSparkline() {
  const intervals = state.samples
    .map((sample) => sample.intervalMs)
    .filter((value) => isFiniteNumber(value) && value > 0)
    .slice(-SPARKLINE_WINDOW);

  elements.sparklineRangeLabel.textContent = tf("gpsRateLastIntervals", { count: SPARKLINE_WINDOW });

  if (!intervals.length) {
    elements.intervalSparklineLine.setAttribute("points", "");
    return;
  }

  const minValue = Math.min.apply(null, intervals);
  const maxValue = Math.max.apply(null, intervals);
  const range = Math.max(1, maxValue - minValue);
  const width = 240;
  const height = 80;
  const step = intervals.length > 1 ? width / (intervals.length - 1) : width;

  const points = intervals.map((value, index) => {
    const x = step * index;
    const normalized = (value - minValue) / range;
    const y = height - (normalized * (height - 12)) - 6;
    return `${formatSvgNumber(x)},${formatSvgNumber(y)}`;
  }).join(" ");

  elements.intervalSparklineLine.setAttribute("points", points);
}

function renderAvailability(summary) {
  const availability = summary ? summary.fieldAvailability : {
    speed: false,
    heading: false,
    altitude: false,
    altitudeAccuracy: false,
    accuracy: false,
  };

  elements.availabilitySpeedValue.textContent = availabilityText("speed", availability.speed);
  elements.availabilityHeadingValue.textContent = availabilityText("heading", availability.heading);
  elements.availabilityAltitudeValue.textContent = availabilityText("altitude", availability.altitude);
  elements.availabilityAltitudeAccuracyValue.textContent = availabilityText("altitudeAccuracy", availability.altitudeAccuracy);
  elements.availabilityAccuracyValue.textContent = availabilityText("accuracy", availability.accuracy);
}

function availabilityText(field, available) {
  if (!available) return t("gpsRateNotSeen");

  const count = state.samples.filter((sample) => {
    switch (field) {
      case "speed":
        return isFiniteNumber(sample.speedMps);
      case "heading":
        return isFiniteNumber(sample.headingDeg);
      case "altitude":
        return isFiniteNumber(sample.altitudeM);
      case "altitudeAccuracy":
        return isFiniteNumber(sample.altitudeAccuracyM);
      case "accuracy":
        return isFiniteNumber(sample.accuracyM);
      default:
        return false;
    }
  }).length;

  return `${t("gpsRateAvailable")} · ${formatInteger(count)}/${formatInteger(Math.max(state.samples.length, 1))}`;
}

function renderDiagnostics(summary) {
  renderWarningBadges(summary);
  renderHistogram(summary);
  renderSparkline();
  renderAvailability(summary);

  elements.jitterValue.textContent = summary && isFiniteNumber(summary.jitterMs)
    ? `${getJitterLabel(summary.jitterMs)} · ${formatMs(summary.jitterMs)}`
    : "—";
  elements.staleCountValue.textContent = summary ? formatInteger(summary.staleSampleCount) : "—";
  elements.nullSpeedValue.textContent = summary ? formatInteger(summary.nullSpeedCount) : "—";
  elements.nullHeadingValue.textContent = summary ? formatInteger(summary.nullHeadingCount) : "—";
  elements.missingAltitudeValue.textContent = summary ? formatInteger(summary.missingAltitudeCount) : "—";
  elements.bestObservedHzValue.textContent = summary ? formatHz(summary.bestObservedHz) : "—";
  elements.fiveSecondHzValue.textContent = summary ? formatHz(summary.fiveSecondHz) : "—";
  elements.wholeSessionHzValue.textContent = summary ? formatHz(summary.wholeSessionHz) : "—";
}

function renderLatestSample() {
  const latestSample = state.samples.length ? state.samples[state.samples.length - 1] : null;

  elements.latestLatitudeValue.textContent = latestSample ? formatCoordinate(latestSample.latitude) : "—";
  elements.latestLongitudeValue.textContent = latestSample ? formatCoordinate(latestSample.longitude) : "—";
  elements.latestSpeedValue.textContent = latestSample ? formatSpeed(latestSample.speedMps) : "—";
  elements.latestHeadingValue.textContent = latestSample ? formatHeading(latestSample.headingDeg) : "—";
  elements.latestAccuracyValue.textContent = latestSample ? formatMeters(latestSample.accuracyM) : "—";
  elements.latestAltitudeValue.textContent = latestSample ? formatMeters(latestSample.altitudeM) : "—";
  elements.latestAltitudeAccuracyValue.textContent = latestSample ? formatMeters(latestSample.altitudeAccuracyM) : "—";
  elements.latestGeoTimestampValue.textContent = latestSample ? formatLocalTimestamp(latestSample.positionTimestampMs) : "—";
  elements.latestPerfTimestampValue.textContent = latestSample ? formatPerfTimestamp(latestSample.performanceNowMs) : "—";
  elements.latestSampleAgeValue.textContent = latestSample
    ? formatMs(latestSample.sampleAgeMs)
    : "—";
  elements.latestCallbackDeltaValue.textContent = latestSample ? formatMs(latestSample.intervalMs) : "—";
  elements.latestGeoDeltaValue.textContent = latestSample ? formatMs(latestSample.geoTimestampDeltaMs) : "—";
}

function renderMotion(summary) {
  const motion = summary ? summary.motion : null;
  elements.motionStateValue.textContent = motion ? getMotionStateLabel(motion.latestState) : "—";
  elements.motionSourceValue.textContent = motion ? getMotionSourceLabel(motion.latestSource) : "—";
  elements.movingHzValue.textContent = motion ? formatHz(motion.movingHz) : "—";
  elements.stationaryHzValue.textContent = motion ? formatHz(motion.stationaryHz) : "—";
  elements.movingSamplesValue.textContent = motion ? formatInteger(motion.movingSamples) : "—";
  elements.stationarySamplesValue.textContent = motion ? formatInteger(motion.stationarySamples) : "—";
}

function renderLogVisibility() {
  const hasRows = elements.eventLogBody.children.length > 0;
  elements.logTableWrap.hidden = !hasRows;
  elements.logEmptyState.hidden = hasRows;
}

function renderSession() {
  state.currentSummary = buildSummary({ source: "current" });
  const hasCurrentActivity = hasSessionActivity();
  const summaryForCard = hasCurrentActivity ? state.currentSummary : state.lastSavedSummary;

  renderStatus(summaryForCard);
  renderControls(summaryForCard);
  renderKpis(state.currentSummary);
  renderSummaryCard(summaryForCard);
  renderDiagnostics(state.samples.length ? state.currentSummary : null);
  renderLatestSample();
  renderMotion(state.samples.length ? state.currentSummary : null);
  renderLogVisibility();
}

function appendLogRow(sample) {
  const row = document.createElement("tr");
  const stateLabel = sample.isStale
    ? `${getMotionStateLabel(sample.movementState)} · ${t("gpsRateStaleWarning")}`
    : getMotionStateLabel(sample.movementState);

  row.innerHTML = [
    `<td>${formatInteger(sample.index)}</td>`,
    `<td>${formatMs(sample.intervalMs)}</td>`,
    `<td>${formatHz(sample.effectiveHz)}</td>`,
    `<td class="gps-rate-log-mono">${formatCoordinate(sample.latitude)}, ${formatCoordinate(sample.longitude)}</td>`,
    `<td>${formatSpeed(sample.speedMps)}</td>`,
    `<td>${formatHeading(sample.headingDeg)}</td>`,
    `<td>${formatMeters(sample.accuracyM)}</td>`,
    `<td class="gps-rate-log-state">${stateLabel}</td>`,
  ].join("");

  elements.eventLogBody.insertBefore(row, elements.eventLogBody.firstChild);

  while (elements.eventLogBody.children.length > MAX_LOG_ROWS) {
    elements.eventLogBody.removeChild(elements.eventLogBody.lastChild);
  }
}

function clearVisibleLog() {
  elements.eventLogBody.replaceChildren();
  renderLogVisibility();
}

function buildSample(position) {
  const callbackPerfMs = performance.now();
  const callbackWallClockMs = Date.now();
  const previousSample = state.samples.length ? state.samples[state.samples.length - 1] : null;
  const coords = position.coords || {};
  const positionTimestampMs = normalizePositionTimestamp(position.timestamp, callbackWallClockMs);
  const intervalMs = previousSample ? callbackPerfMs - previousSample.performanceNowMs : null;
  const effectiveHz = isFiniteNumber(intervalMs) && intervalMs > 0 ? 1000 / intervalMs : null;
  const geoTimestampDeltaMs = previousSample && isFiniteNumber(positionTimestampMs) && isFiniteNumber(previousSample.positionTimestampMs)
    ? positionTimestampMs - previousSample.positionTimestampMs
    : null;
  const sampleAgeMs = isFiniteNumber(positionTimestampMs)
    ? Math.max(0, callbackWallClockMs - positionTimestampMs)
    : null;
  const motion = classifyMotion(coords, previousSample, callbackPerfMs);
  const sample = {
    index: state.samples.length + 1,
    callbackWallClockMs,
    performanceNowMs: callbackPerfMs,
    positionTimestampMs,
    latitude: normalizeMetric(coords.latitude),
    longitude: normalizeMetric(coords.longitude),
    speedMps: normalizeSpeed(coords.speed),
    headingDeg: normalizeHeading(coords.heading),
    accuracyM: normalizeMetric(coords.accuracy),
    altitudeM: normalizeMetric(coords.altitude),
    altitudeAccuracyM: normalizeMetric(coords.altitudeAccuracy),
    intervalMs,
    effectiveHz,
    geoTimestampDeltaMs,
    sampleAgeMs,
    movementState: motion.state,
    movementSource: motion.source,
    derivedSpeedMps: motion.derivedSpeedMps,
    distanceFromPreviousM: motion.distanceM,
    visibilityState: document.hidden ? "hidden" : "visible",
    isStale: isStaleSample(positionTimestampMs, previousSample, sampleAgeMs),
  };

  return sample;
}

function handlePosition(position) {
  const sample = buildSample(position);
  state.samples.push(sample);
  setStatus("gpsRateRunning");
  appendLogRow(sample);
  renderSession();
}

function stopWatchOnly() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

function finishRunningClock() {
  if (state.isRunning && isFiniteNumber(state.runStartedPerfMs)) {
    state.accumulatedRunDurationMs += performance.now() - state.runStartedPerfMs;
  }
  state.runStartedPerfMs = null;
  state.isRunning = false;
}

function handlePositionError(error) {
  if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) {
    stopWatchOnly();
    finishRunningClock();
    setStatus("gpsRatePermissionBlocked");
    renderSession();
    return;
  }

  if (error.code === GEO_ERROR_CODE.POSITION_UNAVAILABLE) {
    setStatus("gpsRateUnavailable");
    renderSession();
    return;
  }

  if (error.code === GEO_ERROR_CODE.TIMEOUT) {
    setStatus("gpsRateTimeout");
    renderSession();
    return;
  }

  setRawStatus(error && error.message ? error.message : t("gpsRateError"));
  renderSession();
}

function startTest() {
  if (state.isRunning) return;

  if (!("geolocation" in navigator)) {
    setStatus("gpsRateUnsupported");
    renderSession();
    return;
  }

  state.isRunning = true;
  state.runStartedPerfMs = performance.now();
  setStatus("gpsRateWaitingFix");
  stopWatchOnly();

  state.watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handlePositionError,
    GEO_OPTIONS,
  );

  if (state.keepAwakeRequested) {
    requestWakeLock({ silent: true });
  }

  renderSession();
}

function stopTest({ persist = true } = {}) {
  if (!state.isRunning && state.watchId === null) return;

  stopWatchOnly();
  finishRunningClock();
  setStatus("gpsRateStopped");
  if (persist) persistCurrentSummary();
  renderSession();
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
  setStatus("gpsRateResetDone");
  clearVisibleLog();
  renderSession();
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

function buildExportPayload() {
  return {
    app: APP_NAME,
    exportedAt: new Date().toISOString(),
    notes: state.notes.trim(),
    config: GEO_OPTIONS,
    observedRateOnly: true,
    summary: state.currentSummary || buildSummary({ source: "current" }),
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
  const summary = state.currentSummary || buildSummary({ source: "current" });
  const lines = [
    `# ${APP_NAME}`,
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
      isFiniteNumber(sample.callbackWallClockMs) ? new Date(sample.callbackWallClockMs).toISOString() : "",
      sample.callbackWallClockMs,
      sample.performanceNowMs,
      isFiniteNumber(sample.positionTimestampMs) ? new Date(sample.positionTimestampMs).toISOString() : "",
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
  const summary = (
    state.isRunning
    || state.accumulatedRunDurationMs > 0
    || state.samples.length > 0
  ) ? state.currentSummary : state.lastSavedSummary;

  if (!summary) {
    setActionNotice("gpsRateExportUnavailable");
    return;
  }

  const lines = [
    APP_NAME,
    t("gpsRateObservedOnlyNote"),
    `${t("gpsRateStatus")}: ${summary.statusText || "—"}`,
    `${t("gpsRateElapsed")}: ${formatDuration(summary.durationMs)}`,
    `${t("gpsRateSamples")}: ${formatInteger(summary.sampleCount)}`,
    `${t("gpsRateMinimumInterval")}: ${formatMs(summary.minIntervalMs)}`,
    `${t("gpsRateAverageInterval")}: ${formatMs(summary.averageIntervalMs)}`,
    `${t("gpsRateMedianInterval")}: ${formatMs(summary.medianIntervalMs)}`,
    `${t("gpsRateWholeAverageHz")}: ${formatHz(summary.effectiveAverageHz)}`,
    `${t("gpsRateBestHz")}: ${formatHz(summary.bestObservedHz)}`,
    `${t("gpsRateAverageAccuracy")}: ${formatMeters(summary.averageAccuracyM)}`,
    `${t("gpsRateSpeedField")}: ${summary.fieldAvailability.speed ? t("gpsRateAvailable") : t("gpsRateNotSeen")}`,
    `${t("gpsRateHeadingField")}: ${summary.fieldAvailability.heading ? t("gpsRateAvailable") : t("gpsRateNotSeen")}`,
    `${t("gpsRateAltitudeField")}: ${summary.fieldAvailability.altitude ? t("gpsRateAvailable") : t("gpsRateNotSeen")}`,
    `${t("gpsRateFiveSecondHz")}: ${formatHz(summary.fiveSecondHz)}`,
    `${t("gpsRateWholeSessionHz")}: ${formatHz(summary.wholeSessionHz)}`,
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
      renderSession();
    });
    renderSession();
    if (!silent) setActionNotice("gpsRateWakeEnabled");
  } catch {
    if (!silent) setActionNotice("gpsRateWakeFailed");
    renderSession();
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
  renderSession();
}

async function toggleWakeLock() {
  state.keepAwakeRequested = !state.keepAwakeRequested;
  saveText(STORAGE_KEYS.keepAwake, String(state.keepAwakeRequested));

  if (!state.keepAwakeRequested) {
    await releaseWakeLock({ silent: false });
    return;
  }

  await requestWakeLock({ silent: false });
}

async function refreshPermissionState() {
  if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
    state.permissionState = "unsupported";
    renderSession();
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

  renderSession();
}

function handlePermissionChange() {
  state.permissionState = state.permissionStatus ? state.permissionStatus.state : "unknown";
  renderSession();
}

function handleVisibilityChange() {
  state.hiddenNow = document.hidden;
  if (document.hidden) {
    if (hasSessionActivity()) {
      state.hiddenCount += 1;
    }
    releaseWakeLock({ silent: true });
  } else if (state.keepAwakeRequested) {
    requestWakeLock({ silent: true });
  }
  renderSession();
}

function handleNotesInput() {
  state.notes = elements.sessionNotes.value;
  saveText(STORAGE_KEYS.notes, state.notes);
  renderSession();
}

function syncLanguage() {
  applyTranslations();
  updatePageMeta();
  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }
  renderActionNotice();
  renderSession();
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
  elements.exportJson.addEventListener("click", exportJson);
  elements.exportCsv.addEventListener("click", exportCsv);
  elements.copySummary.addEventListener("click", copySummary);
  elements.wakeLockToggle.addEventListener("click", toggleWakeLock);
  elements.clearLog.addEventListener("click", () => {
    clearVisibleLog();
    setActionNotice("gpsRateLogCleared");
    renderSession();
  });
  elements.sessionNotes.addEventListener("input", handleNotesInput);

  window.addEventListener("beforeunload", () => {
    persistCurrentSummary();
    releaseWakeLock({ silent: true });
  });
}

function init() {
  updatePageMeta();
  elements.langToggle.textContent = getLang().toUpperCase();
  elements.sessionNotes.value = state.notes;
  renderActionNotice();
  renderSession();
  bindEvents();
  refreshPermissionState();

  state.uiTimerId = window.setInterval(() => {
    renderSession();
  }, 1000);
}

init();
