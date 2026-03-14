import "../styles/speed.less";
import KDBush from "kdbush";
import { around as geoAround, distance as geoDistanceKm } from "geokdbush";

const STORAGE_UNIT_KEY = "vatio_speed_unit";
const STORAGE_DISTANCE_UNIT_KEY = "vatio_speed_distance_unit";
const LEGACY_STORAGE_ALTITUDE_UNIT_KEY = "vatio_speed_altitude_unit";
const STORAGE_ALERT_ENABLED_KEY = "vatio_speed_alert_enabled";
const STORAGE_ALERT_LIMIT_KEY = "vatio_speed_alert_limit_ms";
const STORAGE_ALERT_SOUND_ENABLED_KEY = "vatio_speed_alert_sound_enabled";
const STORAGE_TRAP_ALERT_ENABLED_KEY = "vatio_speed_trap_alert_enabled";
const STORAGE_TRAP_ALERT_DISTANCE_KEY = "vatio_speed_trap_alert_distance_m";
const STORAGE_TRAP_SOUND_ENABLED_KEY = "vatio_speed_trap_sound_enabled";
const OVERSPEED_SOUND_URL = "/audio/overspeed_notification.m4a";
const TRAP_SOUND_URL = "/audio/near_camera_notification.m4a";
const TRAP_DATA_URL = "/geo/ansv_cameras_compact.min.json";
const TRAP_INDEX_URL = "/geo/ansv_cameras_compact.kdbush";
const UNIT_CONFIG = {
  mph: { label: "mph", baseMax: 120, tickStep: 20, factor: 2.2369362920544 },
  kmh: { label: "km/h", baseMax: 200, tickStep: 40, factor: 3.6 },
};
const DISTANCE_UNIT_CONFIG = {
  ft: { label: "ft", factor: 3.2808398950131 },
  m: { label: "m", factor: 1 },
};
const ALERT_CONFIG = {
  mph: { step: 5, min: 10, max: 180, presets: [25, 35, 45, 55, 65, 75] },
  kmh: { step: 10, min: 20, max: 280, presets: [40, 60, 80, 100, 120, 140] },
};
const DEFAULT_ALERT_LIMIT_MS = 55 / UNIT_CONFIG.mph.factor;
const TRAP_ALERT_PRESETS = {
  ft: [
    { meters: 304.8, label: "1000 ft" },
    { meters: 609.6, label: "2000 ft" },
    { meters: 804.672, label: "0.5 mi" },
    { meters: 1609.344, label: "1 mi" },
  ],
  m: [
    { meters: 200, label: "200 m" },
    { meters: 500, label: "500 m" },
    { meters: 1000, label: "1 km" },
    { meters: 2000, label: "2 km" },
  ],
};

const SPEED_SMOOTHING_SAMPLES = 5;
const MAX_PLAUSIBLE_SPEED_MS = 120;
const GEO_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
};

const elements = {
  gaugeCard: document.querySelector(".gauge-card"),
  dialCanvas: document.getElementById("speedDial"),
  needleCanvas: document.getElementById("speedNeedle"),
  speedValue: document.getElementById("speedValue"),
  speedUnit: document.getElementById("speedUnit"),
  status: document.getElementById("status"),
  subStatus: document.getElementById("subStatus"),
  maxSpeed: document.getElementById("maxSpeed"),
  maxSpeedUnit: document.getElementById("maxSpeedUnit"),
  avgSpeed: document.getElementById("avgSpeed"),
  avgSpeedUnit: document.getElementById("avgSpeedUnit"),
  distanceValue: document.getElementById("distanceValue"),
  distanceUnit: document.getElementById("distanceUnit"),
  nearestTrapDistance: document.getElementById("nearestTrapDistance"),
  nearestTrapUnit: document.getElementById("nearestTrapUnit"),
  durationValue: document.getElementById("durationValue"),
  altitudeValue: document.getElementById("altitudeValue"),
  altitudeUnit: document.getElementById("altitudeUnit"),
  maxAltitude: document.getElementById("maxAltitude"),
  maxAltitudeUnit: document.getElementById("maxAltitudeUnit"),
  minAltitude: document.getElementById("minAltitude"),
  minAltitudeUnit: document.getElementById("minAltitudeUnit"),
  notice: document.getElementById("notice"),
  noticeText: document.getElementById("noticeText"),
  retryGps: document.getElementById("retryGps"),
  resetTrip: document.getElementById("resetTrip"),
  alertTrigger: document.getElementById("alertTrigger"),
  alertTriggerValue: document.getElementById("alertTriggerValue"),
  alertPanel: document.getElementById("speedAlertPanel"),
  alertPanelStatus: document.getElementById("alertPanelStatus"),
  closeAlertPanel: document.getElementById("closeAlertPanel"),
  alertToggle: document.getElementById("alertToggle"),
  alertUseCurrent: document.getElementById("alertUseCurrent"),
  alertDecrease: document.getElementById("alertDecrease"),
  alertIncrease: document.getElementById("alertIncrease"),
  alertValue: document.getElementById("alertValue"),
  alertUnit: document.getElementById("alertUnit"),
  alertPresets: document.getElementById("alertPresets"),
  alertSoundButtons: Array.from(document.querySelectorAll(".alert-sound-btn")),
  trapAlertButtons: Array.from(document.querySelectorAll(".trap-alert-btn")),
  trapDistancePresets: document.getElementById("trapDistancePresets"),
  trapSoundButtons: Array.from(document.querySelectorAll(".trap-sound-btn")),
  unitButtons: Array.from(document.querySelectorAll(".unit-btn")),
  distanceUnitButtons: Array.from(document.querySelectorAll(".distance-unit-btn")),
};

const dialContext = elements.dialCanvas.getContext("2d");
const needleContext = elements.needleCanvas.getContext("2d");
const overspeedAudio = new Audio(OVERSPEED_SOUND_URL);
overspeedAudio.loop = true;
overspeedAudio.preload = "auto";
overspeedAudio.playsInline = true;
const trapAlertAudio = new Audio(TRAP_SOUND_URL);
trapAlertAudio.loop = false;
trapAlertAudio.preload = "auto";
trapAlertAudio.playsInline = true;

const initialUnit = loadUnitPreference();
const initialDistanceUnit = loadDistanceUnitPreference();

const state = {
  unit: initialUnit,
  distanceUnit: initialDistanceUnit,
  alertEnabled: loadAlertEnabledPreference(),
  alertLimitMs: loadAlertLimitPreference(),
  alertSoundEnabled: loadAlertSoundEnabledPreference(),
  alertSoundBlocked: false,
  alertSoundPending: false,
  trapAlertEnabled: loadTrapAlertEnabledPreference(),
  trapAlertDistanceM: loadTrapAlertDistancePreference(initialDistanceUnit),
  trapSoundEnabled: loadTrapSoundEnabledPreference(),
  trapSoundBlocked: false,
  trapSoundPending: false,
  watchId: null,
  startTime: Date.now(),
  statusText: "Requesting GPS...",
  currentSpeedMs: 0,
  displayedSpeedMs: 0,
  maxSpeedMs: 0,
  speedSumMs: 0,
  speedSamples: 0,
  totalDistanceM: 0,
  currentAltitudeM: null,
  maxAltitudeM: null,
  minAltitudeM: null,
  lastPoint: null,
  trapRecords: [],
  trapIndex: null,
  nearestTrapId: null,
  nearestTrapDistanceM: null,
  nearestTrapSpeedKph: null,
  trapLoadError: null,
  lastTrapSoundedId: null,
  recentSpeeds: [],
  lastAccuracyM: null,
  lastFixAt: 0,
  renderFrameId: null,
  lastTextUpdateAt: 0,
  canvasSize: 0,
};

function loadUnitPreference() {
  try {
    const unit = window.localStorage.getItem(STORAGE_UNIT_KEY);
    return unit && UNIT_CONFIG[unit] ? unit : "mph";
  } catch {
    return "mph";
  }
}

function saveUnitPreference(unit) {
  try {
    window.localStorage.setItem(STORAGE_UNIT_KEY, unit);
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function loadDistanceUnitPreference() {
  try {
    const storedUnit = window.localStorage.getItem(STORAGE_DISTANCE_UNIT_KEY);
    if (storedUnit && DISTANCE_UNIT_CONFIG[storedUnit]) {
      return storedUnit;
    }

    const legacyUnit = window.localStorage.getItem(LEGACY_STORAGE_ALTITUDE_UNIT_KEY);
    return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit] ? legacyUnit : "ft";
  } catch {
    return "ft";
  }
}

function saveDistanceUnitPreference(unit) {
  try {
    window.localStorage.setItem(STORAGE_DISTANCE_UNIT_KEY, unit);
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function loadAlertEnabledPreference() {
  try {
    return window.localStorage.getItem(STORAGE_ALERT_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveAlertEnabledPreference(enabled) {
  try {
    window.localStorage.setItem(STORAGE_ALERT_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function loadAlertLimitPreference() {
  try {
    const value = Number.parseFloat(window.localStorage.getItem(STORAGE_ALERT_LIMIT_KEY) || "");
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_ALERT_LIMIT_MS;
  } catch {
    return DEFAULT_ALERT_LIMIT_MS;
  }
}

function saveAlertLimitPreference(limitMs) {
  try {
    window.localStorage.setItem(STORAGE_ALERT_LIMIT_KEY, String(limitMs));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function loadAlertSoundEnabledPreference() {
  try {
    const value = window.localStorage.getItem(STORAGE_ALERT_SOUND_ENABLED_KEY);
    return value === null ? true : value === "true";
  } catch {
    return true;
  }
}

function saveAlertSoundEnabledPreference(enabled) {
  try {
    window.localStorage.setItem(STORAGE_ALERT_SOUND_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function getTrapAlertPresets(unit = state.distanceUnit) {
  return TRAP_ALERT_PRESETS[unit];
}

function getDefaultTrapAlertDistanceM(unit = initialDistanceUnit) {
  const presets = getTrapAlertPresets(unit);
  return presets[Math.min(1, presets.length - 1)]?.meters ?? 500;
}

function normalizeTrapAlertDistance(distanceM, unit = state.distanceUnit) {
  const presets = getTrapAlertPresets(unit);
  let closestDistance = presets[0]?.meters ?? getDefaultTrapAlertDistanceM(unit);
  let smallestDifference = Number.POSITIVE_INFINITY;

  for (const preset of presets) {
    const difference = Math.abs(preset.meters - distanceM);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      closestDistance = preset.meters;
    }
  }

  return closestDistance;
}

function loadTrapAlertEnabledPreference() {
  try {
    const value = window.localStorage.getItem(STORAGE_TRAP_ALERT_ENABLED_KEY);
    return value === null ? true : value === "true";
  } catch {
    return true;
  }
}

function saveTrapAlertEnabledPreference(enabled) {
  try {
    window.localStorage.setItem(STORAGE_TRAP_ALERT_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function loadTrapAlertDistancePreference(unit = initialDistanceUnit) {
  try {
    const value = Number.parseFloat(window.localStorage.getItem(STORAGE_TRAP_ALERT_DISTANCE_KEY) || "");
    if (!Number.isFinite(value) || value <= 0) {
      return getDefaultTrapAlertDistanceM(unit);
    }
    return normalizeTrapAlertDistance(value, unit);
  } catch {
    return getDefaultTrapAlertDistanceM(unit);
  }
}

function saveTrapAlertDistancePreference(distanceM) {
  try {
    window.localStorage.setItem(STORAGE_TRAP_ALERT_DISTANCE_KEY, String(distanceM));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function loadTrapSoundEnabledPreference() {
  try {
    const value = window.localStorage.getItem(STORAGE_TRAP_SOUND_ENABLED_KEY);
    return value === null ? true : value === "true";
  } catch {
    return true;
  }
}

function saveTrapSoundEnabledPreference(enabled) {
  try {
    window.localStorage.setItem(STORAGE_TRAP_SOUND_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function setStatus(text) {
  state.statusText = text;
  elements.status.textContent = text;
  renderSubStatus();
}

function showNotice(message) {
  elements.notice.hidden = false;
  elements.noticeText.textContent = message;
}

function hideNotice() {
  elements.notice.hidden = true;
}

function convertSpeed(speedMs, unit = state.unit) {
  return speedMs * UNIT_CONFIG[unit].factor;
}

function convertDisplaySpeedToMs(value, unit = state.unit) {
  return value / UNIT_CONFIG[unit].factor;
}

function convertDistanceMeasurement(valueM, unit = state.distanceUnit) {
  return valueM * DISTANCE_UNIT_CONFIG[unit].factor;
}

function getAlertConfig(unit = state.unit) {
  return ALERT_CONFIG[unit];
}

function normalizeAlertDisplayValue(value, unit = state.unit) {
  const { step, min, max } = getAlertConfig(unit);
  const roundedValue = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, roundedValue));
}

function getAlertLimitDisplayValue(unit = state.unit) {
  return Math.max(0, Math.round(convertSpeed(state.alertLimitMs, unit)));
}

function isManualAlertActive() {
  return state.alertEnabled && Number.isFinite(state.alertLimitMs) && state.alertLimitMs > 0;
}

function getTrapAlertDistanceLabel(distanceM = state.trapAlertDistanceM) {
  const formatted = formatTrapDistance(distanceM);
  if (formatted.value === "—") return "—";
  return `${formatted.value} ${formatted.unit.replace(" away", "")}`;
}

function getConfiguredTrapAlertDistanceLabel(distanceM = state.trapAlertDistanceM, unit = state.distanceUnit) {
  const matchingPreset = getTrapAlertPresets(unit).find((preset) => Math.abs(preset.meters - distanceM) < 1);
  return matchingPreset?.label ?? getTrapAlertDistanceLabel(distanceM);
}

function getActiveTrapAlert() {
  if (!state.trapAlertEnabled) return null;
  if (!Number.isFinite(state.nearestTrapDistanceM) || !Number.isFinite(state.trapAlertDistanceM)) return null;
  if (state.nearestTrapDistanceM > state.trapAlertDistanceM) return null;

  return {
    id: state.nearestTrapId,
    distanceM: state.nearestTrapDistanceM,
    speedKph: state.nearestTrapSpeedKph,
    speedMs: Number.isFinite(state.nearestTrapSpeedKph) && state.nearestTrapSpeedKph > 0
      ? state.nearestTrapSpeedKph / 3.6
      : null,
  };
}

function getAlertUiState() {
  const manualEnabled = isManualAlertActive();
  const trapAlert = getActiveTrapAlert();
  const unitLabel = UNIT_CONFIG[state.unit].label;
  const source = trapAlert?.speedMs
    ? "trap"
    : (manualEnabled ? "manual" : null);
  const limitMs = source === "trap"
    ? trapAlert.speedMs
    : (source === "manual" ? state.alertLimitMs : null);
  const enabled = Number.isFinite(limitMs) && limitMs > 0;
  const limitDisplayValue = enabled
    ? Math.max(0, Math.round(convertSpeed(limitMs, state.unit)))
    : getAlertLimitDisplayValue();
  const over = enabled && state.currentSpeedMs > limitMs;
  const deltaDisplayValue = over
    ? Math.max(1, Math.round(convertSpeed(state.currentSpeedMs - limitMs, state.unit)))
    : 0;
  const near = enabled && !over && state.currentSpeedMs >= limitMs * 0.92;

  return {
    source,
    enabled,
    manualEnabled,
    trapEnabled: state.trapAlertEnabled,
    trapActive: Boolean(trapAlert),
    trapDistanceM: trapAlert?.distanceM ?? null,
    trapDistanceLabel: trapAlert ? getTrapAlertDistanceLabel(trapAlert.distanceM) : null,
    trapSpeedKph: trapAlert?.speedKph ?? null,
    trapSpeedLabel: trapAlert && Number.isFinite(trapAlert.speedKph)
      ? formatTrapSpeed(trapAlert.speedKph)
      : null,
    limitMs,
    over,
    near,
    unitLabel,
    limitDisplayValue,
    deltaDisplayValue,
  };
}

function shouldPlayOverspeedSound() {
  return getAlertUiState().over && state.alertSoundEnabled && !document.hidden;
}

function stopOverspeedSound() {
  state.alertSoundPending = false;
  overspeedAudio.pause();
  overspeedAudio.currentTime = 0;
}

function syncOverspeedSound({ fromUserGesture = false } = {}) {
  if (!shouldPlayOverspeedSound()) {
    state.alertSoundBlocked = false;
    stopOverspeedSound();
    return;
  }

  if (!overspeedAudio.paused) {
    return;
  }

  if (state.alertSoundPending) {
    return;
  }

  if (state.alertSoundBlocked && !fromUserGesture) {
    return;
  }

  overspeedAudio.currentTime = 0;
  const playPromise = overspeedAudio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    state.alertSoundBlocked = false;
    return;
  }

  state.alertSoundPending = true;
  playPromise
    .then(() => {
      state.alertSoundPending = false;
      state.alertSoundBlocked = false;
    })
    .catch(() => {
      state.alertSoundPending = false;
      state.alertSoundBlocked = true;
      stopOverspeedSound();
    });
}

function stopTrapSound() {
  state.trapSoundPending = false;
  trapAlertAudio.pause();
  trapAlertAudio.currentTime = 0;
}

function syncTrapSound({ fromUserGesture = false } = {}) {
  const activeTrap = getActiveTrapAlert();

  if (!activeTrap) {
    state.lastTrapSoundedId = null;
    state.trapSoundBlocked = false;
    stopTrapSound();
    return;
  }

  if (!state.trapSoundEnabled || document.hidden) {
    state.trapSoundBlocked = false;
    stopTrapSound();
    return;
  }

  if (activeTrap.id === state.lastTrapSoundedId) {
    return;
  }

  if (state.trapSoundPending) {
    return;
  }

  if (state.trapSoundBlocked && !fromUserGesture) {
    return;
  }

  trapAlertAudio.currentTime = 0;
  const playPromise = trapAlertAudio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    state.trapSoundBlocked = false;
    state.lastTrapSoundedId = activeTrap.id;
    return;
  }

  state.trapSoundPending = true;
  playPromise
    .then(() => {
      state.trapSoundPending = false;
      state.trapSoundBlocked = false;
      state.lastTrapSoundedId = activeTrap.id;
    })
    .catch(() => {
      state.trapSoundPending = false;
      state.trapSoundBlocked = true;
      stopTrapSound();
    });
}

function buildTrapIndex(traps) {
  const index = new KDBush(traps.length);
  for (const [lon, lat] of traps) {
    index.add(lon, lat);
  }
  index.finish();
  return index;
}

async function loadTrapArtifacts() {
  try {
    const [dataResponse, indexResponse] = await Promise.all([
      fetch(TRAP_DATA_URL, { cache: "no-cache" }),
      fetch(TRAP_INDEX_URL, { cache: "no-cache" }),
    ]);

    if (!dataResponse.ok) {
      throw new Error(`Trap dataset request failed with ${dataResponse.status}`);
    }

    const compact = await dataResponse.json();
    const traps = Array.isArray(compact?.traps) ? compact.traps : [];

    state.trapRecords = traps.filter((trap) =>
      Array.isArray(trap)
      && trap.length >= 2
      && Number.isFinite(trap[0])
      && Number.isFinite(trap[1]));

    if (indexResponse.ok) {
      state.trapIndex = KDBush.from(await indexResponse.arrayBuffer());
    } else {
      state.trapIndex = buildTrapIndex(state.trapRecords);
    }

    state.trapLoadError = null;
  } catch (error) {
    state.trapRecords = [];
    state.trapIndex = null;
    state.nearestTrapId = null;
    state.nearestTrapDistanceM = null;
    state.nearestTrapSpeedKph = null;
    state.trapLoadError = error;
  }

  if (state.lastPoint) {
    updateNearestTrap(state.lastPoint.longitude, state.lastPoint.latitude);
  }

  renderMetrics();
}

function updateNearestTrap(longitude, latitude) {
  if (!state.trapIndex || state.trapRecords.length === 0) {
    state.nearestTrapId = null;
    state.nearestTrapDistanceM = null;
    state.nearestTrapSpeedKph = null;
    return;
  }

  const nearestIds = geoAround(state.trapIndex, longitude, latitude, 1);
  if (nearestIds.length === 0) {
    state.nearestTrapId = null;
    state.nearestTrapDistanceM = null;
    state.nearestTrapSpeedKph = null;
    return;
  }

  state.nearestTrapId = nearestIds[0];
  const nearestTrap = state.trapRecords[state.nearestTrapId];
  state.nearestTrapDistanceM = geoDistanceKm(longitude, latitude, nearestTrap[0], nearestTrap[1]) * 1000;
  state.nearestTrapSpeedKph = Number.isFinite(nearestTrap[2]) ? nearestTrap[2] : null;
}

function formatTrapDistance(distanceM, unit = state.distanceUnit) {
  if (!Number.isFinite(distanceM)) {
    return { value: "—", unit: "away" };
  }

  if (unit === "m") {
    if (distanceM < 1000) {
      return { value: Math.round(distanceM).toString(), unit: "m away" };
    }

    const kilometers = distanceM / 1000;
    return {
      value: kilometers < 10 ? kilometers.toFixed(1) : Math.round(kilometers).toString(),
      unit: "km away",
    };
  }

  const feet = distanceM * 3.2808398950131;
  if (feet < 5280) {
    return { value: Math.round(feet).toString(), unit: "ft away" };
  }

  const miles = distanceM / 1609.344;
  return {
    value: miles < 10 ? miles.toFixed(1) : Math.round(miles).toString(),
    unit: "mi away",
  };
}

function formatTrapSpeed(speedKph) {
  if (!Number.isFinite(speedKph)) return null;
  if (state.unit === "kmh") return `${Math.round(speedKph)} km/h`;
  return `${Math.round(speedKph / 1.609344)} mph`;
}

function getAverageSpeedMs() {
  return state.speedSamples > 0 ? state.speedSumMs / state.speedSamples : 0;
}

function getDistanceDisplay(distanceM, unit = state.distanceUnit) {
  if (unit === "m") {
    const kilometers = distanceM / 1000;
    if (kilometers < 10) return { value: kilometers.toFixed(1), unit: "km" };
    return { value: Math.round(kilometers).toString(), unit: "km" };
  }

  const miles = distanceM / 1609.344;
  if (miles < 10) return { value: miles.toFixed(1), unit: "mi" };
  return { value: Math.round(miles).toString(), unit: "mi" };
}

function formatAltitude(altitudeM, unit = state.distanceUnit) {
  if (!Number.isFinite(altitudeM)) return "—";
  return Math.round(convertDistanceMeasurement(altitudeM, unit)).toString();
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

function haversineDistance(a, b) {
  const radius = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const calc =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return radius * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

function describeAccuracy(accuracyM) {
  if (!Number.isFinite(accuracyM)) return "GPS live";
  const accuracyValue = Math.round(convertDistanceMeasurement(accuracyM));
  const accuracyUnit = DISTANCE_UNIT_CONFIG[state.distanceUnit].label;
  const rounded = Math.round(accuracyM);
  if (rounded <= 12) return `GPS locked · +/-${accuracyValue} ${accuracyUnit}`;
  if (rounded <= 40) return `GPS live · +/-${accuracyValue} ${accuracyUnit}`;
  return `Weak GPS · +/-${accuracyValue} ${accuracyUnit}`;
}

function renderAlertPresets() {
  const unit = state.unit;
  if (elements.alertPresets.dataset.unit === unit) return;

  const fragment = document.createDocumentFragment();
  const currentValue = getAlertLimitDisplayValue(unit);

  for (const preset of getAlertConfig(unit).presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "speed-alert-preset";
    button.dataset.alertPreset = String(preset);
    button.textContent = `${preset} ${UNIT_CONFIG[unit].label}`;
    button.setAttribute("aria-pressed", String(preset === currentValue));
    fragment.append(button);
  }

  elements.alertPresets.replaceChildren(fragment);
  elements.alertPresets.dataset.unit = unit;
}

function renderTrapDistancePresets() {
  const unit = state.distanceUnit;
  if (elements.trapDistancePresets.dataset.unit === unit) return;

  const fragment = document.createDocumentFragment();

  for (const preset of getTrapAlertPresets(unit)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "speed-alert-preset";
    button.dataset.trapDistance = String(preset.meters);
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", String(Math.abs(preset.meters - state.trapAlertDistanceM) < 1));
    fragment.append(button);
  }

  elements.trapDistancePresets.replaceChildren(fragment);
  elements.trapDistancePresets.dataset.unit = unit;
}

function getAlertTriggerText(alertState) {
  if (alertState.over) {
    return `+${alertState.deltaDisplayValue} over`;
  }

  if (alertState.trapActive) {
    return `Trap ${alertState.trapDistanceLabel}`;
  }

  if (alertState.manualEnabled) {
    return `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
  }

  if (state.trapAlertEnabled) {
    return "Trap on";
  }

  return "Off";
}

function getAlertTriggerLabel(alertState) {
  if (alertState.over) {
    return alertState.source === "trap"
      ? `Over the trap speed limit by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`
      : `Over the manual speed alert by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`;
  }

  if (alertState.trapActive) {
    return alertState.trapSpeedLabel
      ? `Trap alert active ${alertState.trapDistanceLabel} ahead, limit ${alertState.trapSpeedLabel}`
      : `Trap alert active ${alertState.trapDistanceLabel} ahead`;
  }

  if (alertState.manualEnabled) {
    return `Manual speed alert set to ${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
  }

  if (state.trapAlertEnabled) {
    return "Trap alerts on";
  }

  return "All alerts off";
}

function getAlertPanelStatusText(alertState) {
  if (alertState.over) {
    return alertState.source === "trap"
      ? `Over trap by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`
      : `Over by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`;
  }

  if (alertState.trapActive) {
    return alertState.trapSpeedLabel
      ? `Trap ${alertState.trapDistanceLabel} · ${alertState.trapSpeedLabel}`
      : `Trap ${alertState.trapDistanceLabel}`;
  }

  if (alertState.manualEnabled) {
    return `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
  }

  if (state.trapAlertEnabled) {
    return `Trap alerts · ${getConfiguredTrapAlertDistanceLabel()}`;
  }

  return "Off";
}

function renderSubStatus() {
  const alertState = getAlertUiState();
  const isLiveStatus = state.lastFixAt > 0
    && !/^(Requesting GPS|Waiting for GPS|GPS blocked|GPS unavailable|GPS error)/.test(state.statusText);

  if (!isLiveStatus) {
    elements.subStatus.textContent = state.statusText;
    return;
  }

  if (alertState.over) {
    elements.subStatus.textContent = alertState.source === "trap"
      ? `Over trap limit by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`
      : `Over by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`;
    return;
  }

  if (alertState.trapActive) {
    elements.subStatus.textContent = alertState.trapSpeedLabel
      ? `Trap ahead ${alertState.trapDistanceLabel} · Limit ${alertState.trapSpeedLabel}`
      : `Trap ahead ${alertState.trapDistanceLabel}`;
    return;
  }

  if (alertState.manualEnabled) {
    elements.subStatus.textContent = `Manual alert at ${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
    return;
  }

  elements.subStatus.textContent = state.statusText;
}

function renderAlertUi(options = {}) {
  const alertState = getAlertUiState();
  const currentLimitDisplay = getAlertLimitDisplayValue();
  const canUseCurrentSpeed = state.lastFixAt > 0
    && Math.round(convertSpeed(state.currentSpeedMs)) >= getAlertConfig().min;

  renderAlertPresets();
  renderTrapDistancePresets();

  elements.alertTriggerValue.textContent = getAlertTriggerText(alertState);
  elements.alertTrigger.setAttribute("aria-label", getAlertTriggerLabel(alertState));
  elements.alertPanelStatus.textContent = getAlertPanelStatusText(alertState);
  elements.alertToggle.textContent = isManualAlertActive() ? "Turn off" : "Turn on";
  elements.alertToggle.setAttribute("aria-pressed", String(isManualAlertActive()));
  elements.alertUseCurrent.disabled = !canUseCurrentSpeed;
  elements.alertValue.textContent = String(currentLimitDisplay);
  elements.alertUnit.textContent = UNIT_CONFIG[state.unit].label;
  elements.alertDecrease.disabled = currentLimitDisplay <= getAlertConfig().min;
  elements.alertIncrease.disabled = currentLimitDisplay >= getAlertConfig().max;

  for (const button of elements.alertPresets.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.alertPreset) === currentLimitDisplay));
  }

  for (const button of elements.alertSoundButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.alertSound === "on") === state.alertSoundEnabled,
    ));
  }

  for (const button of elements.trapAlertButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapAlert === "on") === state.trapAlertEnabled,
    ));
  }

  for (const button of elements.trapDistancePresets.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(
      Math.abs(Number(button.dataset.trapDistance) - state.trapAlertDistanceM) < 1,
    ));
  }

  for (const button of elements.trapSoundButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapSound === "on") === state.trapSoundEnabled,
    ));
  }

  elements.gaugeCard.classList.toggle("is-alert-enabled", isManualAlertActive() || state.trapAlertEnabled);
  elements.gaugeCard.classList.toggle("is-alert-near", alertState.near);
  elements.gaugeCard.classList.toggle("is-alert-over", alertState.over);
  elements.gaugeCard.classList.toggle("is-trap-active", alertState.trapActive);

  renderSubStatus();
  syncOverspeedSound(options);
  syncTrapSound(options);
}

function setAlertEnabled(enabled, options = {}) {
  state.alertEnabled = enabled;
  if (!Number.isFinite(state.alertLimitMs) || state.alertLimitMs <= 0) {
    state.alertLimitMs = DEFAULT_ALERT_LIMIT_MS;
  }

  saveAlertEnabledPreference(enabled);
  renderAlertUi(options);
  drawGauge();
}

function setAlertSoundEnabled(enabled, options = {}) {
  state.alertSoundEnabled = enabled;
  saveAlertSoundEnabledPreference(enabled);
  renderAlertUi(options);
}

function setAlertLimitDisplay(value, { enable = true, fromUserGesture = false } = {}) {
  const normalizedValue = normalizeAlertDisplayValue(value, state.unit);
  state.alertLimitMs = convertDisplaySpeedToMs(normalizedValue, state.unit);
  saveAlertLimitPreference(state.alertLimitMs);

  if (enable) {
    state.alertEnabled = true;
    saveAlertEnabledPreference(true);
  }

  renderAlertUi({ fromUserGesture });
  drawGauge();
}

function adjustAlertLimit(stepDirection, options = {}) {
  const { step } = getAlertConfig();
  const currentDisplayValue = normalizeAlertDisplayValue(getAlertLimitDisplayValue(), state.unit);
  setAlertLimitDisplay(currentDisplayValue + stepDirection * step, options);
}

function setAlertLimitToCurrentSpeed() {
  if (state.lastFixAt === 0) return;
  setAlertLimitDisplay(Math.round(convertSpeed(state.currentSpeedMs)), { fromUserGesture: true });
}

function setTrapAlertEnabled(enabled, options = {}) {
  state.trapAlertEnabled = enabled;
  if (!Number.isFinite(state.trapAlertDistanceM) || state.trapAlertDistanceM <= 0) {
    state.trapAlertDistanceM = getDefaultTrapAlertDistanceM(state.unit);
  }

  if (!enabled) {
    state.lastTrapSoundedId = null;
  }

  saveTrapAlertEnabledPreference(enabled);
  renderAlertUi(options);
  drawGauge();
}

function setTrapAlertDistance(distanceM, { enable = true, fromUserGesture = false } = {}) {
  state.trapAlertDistanceM = normalizeTrapAlertDistance(distanceM, state.unit);
  saveTrapAlertDistancePreference(state.trapAlertDistanceM);

  if (enable) {
    state.trapAlertEnabled = true;
    saveTrapAlertEnabledPreference(true);
  }

  state.lastTrapSoundedId = null;
  renderAlertUi({ fromUserGesture });
  drawGauge();
}

function setTrapSoundEnabled(enabled, options = {}) {
  state.trapSoundEnabled = enabled;
  if (!enabled) {
    state.lastTrapSoundedId = null;
  }
  saveTrapSoundEnabledPreference(enabled);
  renderAlertUi(options);
}

function openAlertPanel() {
  renderAlertUi();
  document.body.classList.add("alert-panel-open");
  elements.alertPanel.hidden = false;
  elements.alertPanel.scrollTop = 0;
  elements.alertTrigger.setAttribute("aria-expanded", "true");
}

function closeAlertPanel() {
  document.body.classList.remove("alert-panel-open");
  elements.alertPanel.hidden = true;
  elements.alertTrigger.setAttribute("aria-expanded", "false");
}

function toggleAlertPanel() {
  if (elements.alertPanel.hidden) {
    openAlertPanel();
  } else {
    closeAlertPanel();
  }
}

function setUnit(unit) {
  if (!UNIT_CONFIG[unit] || unit === state.unit) return;

  state.unit = unit;
  saveUnitPreference(unit);

  for (const button of elements.unitButtons) {
    button.setAttribute("aria-pressed", button.dataset.unit === unit ? "true" : "false");
  }

  delete elements.alertPresets.dataset.unit;
  renderMetrics();
  drawGauge();
}

function setDistanceUnit(unit) {
  if (!DISTANCE_UNIT_CONFIG[unit] || unit === state.distanceUnit) return;

  state.distanceUnit = unit;
  state.trapAlertDistanceM = normalizeTrapAlertDistance(state.trapAlertDistanceM, unit);
  saveDistanceUnitPreference(unit);
  saveTrapAlertDistancePreference(state.trapAlertDistanceM);

  for (const button of elements.distanceUnitButtons) {
    button.setAttribute("aria-pressed", button.dataset.distanceUnit === unit ? "true" : "false");
  }

  delete elements.trapDistancePresets.dataset.unit;
  renderMetrics();
}

function resetTripData() {
  state.startTime = Date.now();
  state.currentSpeedMs = 0;
  state.displayedSpeedMs = 0;
  state.maxSpeedMs = 0;
  state.speedSumMs = 0;
  state.speedSamples = 0;
  state.totalDistanceM = 0;
  state.currentAltitudeM = null;
  state.maxAltitudeM = null;
  state.minAltitudeM = null;
  state.lastPoint = null;
  state.nearestTrapId = null;
  state.nearestTrapDistanceM = null;
  state.nearestTrapSpeedKph = null;
  state.lastTrapSoundedId = null;
  state.recentSpeeds = [];
  state.lastAccuracyM = null;
  state.lastFixAt = 0;

  hideNotice();
  closeAlertPanel();
  setStatus("Requesting GPS...");
  renderMetrics();
  drawGauge();
}

function stopTracking() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  stopOverspeedSound();
  stopTrapSound();
}

function startTracking() {
  if (!("geolocation" in navigator)) {
    setStatus("GPS not supported");
    showNotice("This browser does not expose geolocation, so live speed cannot start here.");
    return;
  }

  stopTracking();
  setStatus("Requesting GPS...");

  state.watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handlePositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    },
  );
}

function restartTrip() {
  resetTripData();
  startTracking();
}

function handlePosition(position) {
  hideNotice();

  const coords = position.coords;
  const nextPoint = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    timestamp: position.timestamp,
  };

  let speedMs = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null;

  if (state.lastPoint) {
    const elapsedSeconds = Math.max((nextPoint.timestamp - state.lastPoint.timestamp) / 1000, 0.25);
    const distanceM = haversineDistance(state.lastPoint, nextPoint);
    const plausibleDistanceM = elapsedSeconds * MAX_PLAUSIBLE_SPEED_MS;

    if (distanceM <= plausibleDistanceM) {
      state.totalDistanceM += distanceM;
      if (speedMs === null) {
        speedMs = distanceM / elapsedSeconds;
      }
    }
  }

  if (!Number.isFinite(speedMs) || speedMs < 0) speedMs = 0;

  state.recentSpeeds.push(speedMs);
  if (state.recentSpeeds.length > SPEED_SMOOTHING_SAMPLES) {
    state.recentSpeeds.shift();
  }

  state.currentSpeedMs =
    state.recentSpeeds.reduce((sum, sample) => sum + sample, 0) / state.recentSpeeds.length;
  state.maxSpeedMs = Math.max(state.maxSpeedMs, state.currentSpeedMs);
  state.speedSumMs += state.currentSpeedMs;
  state.speedSamples += 1;
  state.lastPoint = nextPoint;
  state.lastAccuracyM = coords.accuracy;
  state.lastFixAt = Date.now();

  updateNearestTrap(coords.longitude, coords.latitude);

  if (Number.isFinite(coords.altitude)) {
    state.currentAltitudeM = coords.altitude;
    state.maxAltitudeM = state.maxAltitudeM === null
      ? coords.altitude
      : Math.max(state.maxAltitudeM, coords.altitude);
    state.minAltitudeM = state.minAltitudeM === null
      ? coords.altitude
      : Math.min(state.minAltitudeM, coords.altitude);
  }

  setStatus(describeAccuracy(coords.accuracy));
  renderMetrics();
}

function handlePositionError(error) {
  if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) {
    stopTracking();
    setStatus("GPS blocked");
    showNotice("Location access is required. Allow GPS for this site and press Retry GPS.");
    return;
  }

  if (error.code === GEO_ERROR_CODE.POSITION_UNAVAILABLE) {
    setStatus("GPS unavailable");
    showNotice("GPS signal is unavailable right now. Move to a clearer area and retry.");
    return;
  }

  if (error.code === GEO_ERROR_CODE.TIMEOUT) {
    setStatus("Waiting for GPS...");
    showNotice("Still waiting for a GPS lock. Make sure location access is enabled and try again.");
    return;
  }

  setStatus("GPS error");
  showNotice(error.message || "An unexpected geolocation error interrupted tracking.");
}

function resizeCanvas() {
  const rect = elements.dialCanvas.getBoundingClientRect();
  const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
  const dpr = window.devicePixelRatio || 1;

  if (size === state.canvasSize && elements.dialCanvas.width === Math.floor(size * dpr)) {
    return;
  }

  state.canvasSize = size;
  for (const canvas of [elements.dialCanvas, elements.needleCanvas]) {
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
  }
  dialContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  needleContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGauge();
}

function getCssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getGaugeMaximum(displaySpeed) {
  const config = UNIT_CONFIG[state.unit];
  const paddedValue = Math.max(config.baseMax, Math.ceil(displaySpeed / config.tickStep) * config.tickStep);
  return Math.max(config.baseMax, paddedValue);
}

function drawGauge() {
  if (state.canvasSize === 0) return;

  const alertState = getAlertUiState();
  const size = state.canvasSize;
  const center = size / 2;
  const radius = size * 0.42;
  const ringRadius = radius * 0.84;
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const angleRange = endAngle - startAngle;
  const displaySpeed = convertSpeed(state.displayedSpeedMs);
  const gaugeMax = getGaugeMaximum(
    Math.max(
      displaySpeed,
      convertSpeed(state.maxSpeedMs),
      alertState.enabled ? alertState.limitDisplayValue : 0,
    ),
  );

  const bgColor = getCssColor("--speed-surface", "rgba(255,255,255,0.7)");
  const mutedColor = getCssColor("--speed-tick", "rgba(17,24,39,0.4)");
  const trackColor = getCssColor("--speed-track", "rgba(17,24,39,0.12)");
  const trapAccentColor = getCssColor("--speed-trap", "#f59e0b");
  const accentColor = alertState.over
    ? getCssColor("--speed-alert", "#ef4444")
    : (alertState.trapActive ? trapAccentColor : getCssColor("--speed-accent", "#10b981"));
  const alertMarkerColor = alertState.source === "trap"
    ? trapAccentColor
    : getCssColor("--speed-alert-marker", "#ff7a5c");
  const needleBaseColor = getCssColor("--speed-needle-base", "#8f1622");
  const needleTipColor = getCssColor("--speed-needle-tip", "#ff5a36");
  const pivotOuterColor = getCssColor("--speed-pivot-outer", "#202633");
  const pivotInnerColor = getCssColor("--speed-pivot-inner", accentColor);
  const dialCoreColor = getCssColor("--speed-dial-core", "#ffffff");
  const dialMidColor = getCssColor("--speed-dial-mid", bgColor);
  const dialEdgeColor = getCssColor("--speed-dial-edge", "#e7f0fb");
  const dialRimColor = getCssColor("--speed-dial-rim", trackColor);
  const dialHighlightColor = getCssColor("--speed-dial-highlight", "rgba(255,255,255,0.92)");

  dialContext.clearRect(0, 0, size, size);
  needleContext.clearRect(0, 0, size, size);

  const backdrop = dialContext.createRadialGradient(
    center,
    center,
    radius * 0.06,
    center,
    center,
    radius,
  );
  backdrop.addColorStop(0, dialCoreColor);
  backdrop.addColorStop(0.62, dialMidColor);
  backdrop.addColorStop(1, dialEdgeColor);
  dialContext.fillStyle = backdrop;
  dialContext.beginPath();
  dialContext.arc(center, center, radius, 0, Math.PI * 2);
  dialContext.fill();

  const gloss = dialContext.createRadialGradient(
    center,
    center,
    radius * 0.14,
    center,
    center,
    radius * 0.92,
  );
  gloss.addColorStop(0, dialHighlightColor);
  gloss.addColorStop(0.28, "rgba(255, 255, 255, 0.18)");
  gloss.addColorStop(0.64, "rgba(255, 255, 255, 0.05)");
  gloss.addColorStop(1, "transparent");
  dialContext.fillStyle = gloss;
  dialContext.beginPath();
  dialContext.arc(center, center, radius, 0, Math.PI * 2);
  dialContext.fill();

  dialContext.strokeStyle = dialRimColor;
  dialContext.lineWidth = Math.max(2, size * 0.004);
  dialContext.beginPath();
  dialContext.arc(center, center, radius - dialContext.lineWidth, 0, Math.PI * 2);
  dialContext.stroke();

  dialContext.strokeStyle = trackColor;
  dialContext.lineWidth = Math.max(8, size * 0.03);
  dialContext.beginPath();
  dialContext.arc(center, center, ringRadius, startAngle, endAngle);
  dialContext.stroke();

  const progress = Math.min(displaySpeed / gaugeMax, 1);

  if (alertState.enabled) {
    const alertAngle = startAngle + Math.min(alertState.limitDisplayValue / gaugeMax, 1) * angleRange;
    const markerInnerRadius = ringRadius - Math.max(16, size * 0.032);
    const markerOuterRadius = ringRadius + Math.max(10, size * 0.02);

    dialContext.strokeStyle = alertMarkerColor;
    dialContext.lineWidth = Math.max(4, size * 0.007);
    dialContext.lineCap = "round";
    dialContext.beginPath();
    dialContext.moveTo(
      center + markerInnerRadius * Math.cos(alertAngle),
      center + markerInnerRadius * Math.sin(alertAngle),
    );
    dialContext.lineTo(
      center + markerOuterRadius * Math.cos(alertAngle),
      center + markerOuterRadius * Math.sin(alertAngle),
    );
    dialContext.stroke();
    dialContext.lineCap = "butt";
  }

  dialContext.strokeStyle = accentColor;
  dialContext.lineCap = "round";
  dialContext.beginPath();
  dialContext.arc(center, center, ringRadius, startAngle, startAngle + progress * angleRange);
  dialContext.stroke();
  dialContext.lineCap = "butt";

  const tickCount = gaugeMax / UNIT_CONFIG[state.unit].tickStep;
  const fontSize = Math.max(13, size * 0.024);

  dialContext.fillStyle = mutedColor;
  dialContext.strokeStyle = mutedColor;
  dialContext.font = `700 ${fontSize}px system-ui`;
  dialContext.textAlign = "center";
  dialContext.textBaseline = "middle";

  for (let index = 0; index <= tickCount; index += 1) {
    const tickValue = index * UNIT_CONFIG[state.unit].tickStep;
    const tickAngle = startAngle + (tickValue / gaugeMax) * angleRange;
    const innerRadius = radius * 0.78;
    const outerRadius = radius * 0.9;
    const labelRadius = radius * 0.64;

    dialContext.lineWidth = index % 2 === 0 ? 3 : 2;
    dialContext.beginPath();
    dialContext.moveTo(
      center + innerRadius * Math.cos(tickAngle),
      center + innerRadius * Math.sin(tickAngle),
    );
    dialContext.lineTo(
      center + outerRadius * Math.cos(tickAngle),
      center + outerRadius * Math.sin(tickAngle),
    );
    dialContext.stroke();

    dialContext.fillText(
      String(tickValue),
      center + labelRadius * Math.cos(tickAngle),
      center + labelRadius * Math.sin(tickAngle),
    );
  }

  const needleLength = radius * 0.86;
  const needleBack = radius * 0.16;
  const needleTailWidth = Math.max(6, size * 0.012);
  const needleTipWidth = Math.max(2.5, size * 0.0048);
  // The needle shape is authored pointing straight up (-Y), while the gauge
  // angles are expressed in canvas space from +X. Align the long end of the
  // needle with the gauge angle instead of the short counterweight.
  const needleAngle = startAngle + progress * angleRange + Math.PI / 2;

  needleContext.save();
  needleContext.translate(center, center);
  needleContext.rotate(needleAngle);
  const needleGradient = needleContext.createLinearGradient(0, needleBack, 0, -needleLength);
  needleGradient.addColorStop(0, needleBaseColor);
  needleGradient.addColorStop(1, needleTipColor);
  needleContext.shadowColor = "rgba(0, 0, 0, 0.24)";
  needleContext.shadowBlur = Math.max(8, size * 0.016);
  needleContext.shadowOffsetY = 2;
  needleContext.fillStyle = needleGradient;
  needleContext.beginPath();
  needleContext.moveTo(-needleTailWidth, needleBack);
  needleContext.lineTo(-needleTipWidth, -needleLength);
  needleContext.lineTo(needleTipWidth, -needleLength);
  needleContext.lineTo(needleTailWidth, needleBack);
  needleContext.closePath();
  needleContext.fill();

  needleContext.shadowColor = "transparent";
  needleContext.fillStyle = "rgba(255, 255, 255, 0.32)";
  needleContext.fillRect(-needleTipWidth * 0.4, -needleLength * 0.92, needleTipWidth * 0.8, needleLength * 0.95);
  needleContext.restore();

  needleContext.fillStyle = pivotOuterColor;
  needleContext.beginPath();
  needleContext.arc(center, center, Math.max(10, size * 0.018), 0, Math.PI * 2);
  needleContext.fill();

  needleContext.fillStyle = pivotInnerColor;
  needleContext.beginPath();
  needleContext.arc(center, center, Math.max(4, size * 0.008), 0, Math.PI * 2);
  needleContext.fill();
}

function renderMetrics() {
  const currentSpeed = Math.round(convertSpeed(state.currentSpeedMs));
  const maxSpeed = Math.round(convertSpeed(state.maxSpeedMs));
  const averageSpeed = Math.round(convertSpeed(getAverageSpeedMs()));
  const distance = getDistanceDisplay(state.totalDistanceM);
  const nearestTrap = formatTrapDistance(state.nearestTrapDistanceM);
  const unitLabel = UNIT_CONFIG[state.unit].label;
  const distanceUnitLabel = DISTANCE_UNIT_CONFIG[state.distanceUnit].label;

  elements.speedValue.textContent = String(currentSpeed);
  elements.speedUnit.textContent = unitLabel;
  elements.maxSpeed.textContent = String(maxSpeed);
  elements.maxSpeedUnit.textContent = unitLabel;
  elements.avgSpeed.textContent = String(averageSpeed);
  elements.avgSpeedUnit.textContent = unitLabel;
  elements.distanceValue.textContent = distance.value;
  elements.distanceUnit.textContent = distance.unit;
  elements.nearestTrapDistance.textContent = nearestTrap.value;
  elements.nearestTrapUnit.textContent = nearestTrap.unit;
  elements.durationValue.textContent = formatDuration(Date.now() - state.startTime);
  elements.altitudeValue.textContent = formatAltitude(state.currentAltitudeM);
  elements.altitudeUnit.textContent = distanceUnitLabel;
  elements.maxAltitude.textContent = formatAltitude(state.maxAltitudeM);
  elements.maxAltitudeUnit.textContent = distanceUnitLabel;
  elements.minAltitude.textContent = formatAltitude(state.minAltitudeM);
  elements.minAltitudeUnit.textContent = distanceUnitLabel;
  renderAlertUi();
}

function renderFrame(now) {
  state.renderFrameId = window.requestAnimationFrame(renderFrame);

  const delta = state.currentSpeedMs - state.displayedSpeedMs;
  if (Math.abs(delta) > 0.001) {
    state.displayedSpeedMs += delta * 0.16;
  } else {
    state.displayedSpeedMs = state.currentSpeedMs;
  }

  drawGauge();

  if (now - state.lastTextUpdateAt > 200) {
    renderMetrics();
    state.lastTextUpdateAt = now;
  }

  if (!state.lastFixAt && Date.now() - state.startTime > 9000 && elements.notice.hidden) {
    showNotice("Still looking for the first GPS fix. Keep location enabled and give the browser a moment.");
  }
}

function startRenderLoop() {
  if (state.renderFrameId !== null) return;
  state.renderFrameId = window.requestAnimationFrame(renderFrame);
}

function stopRenderLoop() {
  if (state.renderFrameId === null) return;
  window.cancelAnimationFrame(state.renderFrameId);
  state.renderFrameId = null;
}

function bindEvents() {
  elements.retryGps.addEventListener("click", restartTrip);
  elements.resetTrip.addEventListener("click", restartTrip);
  elements.alertTrigger.addEventListener("click", toggleAlertPanel);
  elements.closeAlertPanel.addEventListener("click", closeAlertPanel);
  elements.alertToggle.addEventListener("click", () => {
    if (isManualAlertActive()) {
      setAlertEnabled(false, { fromUserGesture: true });
      return;
    }
    setAlertEnabled(true, { fromUserGesture: true });
  });
  elements.alertUseCurrent.addEventListener("click", setAlertLimitToCurrentSpeed);
  elements.alertDecrease.addEventListener("click", () => adjustAlertLimit(-1, { fromUserGesture: true }));
  elements.alertIncrease.addEventListener("click", () => adjustAlertLimit(1, { fromUserGesture: true }));
  elements.alertPresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-alert-preset]");
    if (!button) return;
    setAlertLimitDisplay(Number(button.dataset.alertPreset), { fromUserGesture: true });
  });
  for (const button of elements.alertSoundButtons) {
    button.addEventListener("click", () => {
      setAlertSoundEnabled(button.dataset.alertSound === "on", { fromUserGesture: true });
    });
  }

  for (const button of elements.trapAlertButtons) {
    button.addEventListener("click", () => {
      setTrapAlertEnabled(button.dataset.trapAlert === "on", { fromUserGesture: true });
    });
  }

  elements.trapDistancePresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-trap-distance]");
    if (!button) return;
    setTrapAlertDistance(Number(button.dataset.trapDistance), { fromUserGesture: true });
  });

  for (const button of elements.trapSoundButtons) {
    button.addEventListener("click", () => {
      setTrapSoundEnabled(button.dataset.trapSound === "on", { fromUserGesture: true });
    });
  }

  for (const button of elements.unitButtons) {
    button.addEventListener("click", () => setUnit(button.dataset.unit));
  }

  for (const button of elements.distanceUnitButtons) {
    button.addEventListener("click", () => setDistanceUnit(button.dataset.distanceUnit));
  }

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  window.addEventListener("pageshow", () => {
    resizeCanvas();
    if (state.watchId === null) startTracking();
    startRenderLoop();
    syncOverspeedSound();
    syncTrapSound();
  });
  document.addEventListener("pointerdown", (event) => {
    const insideAlertUi = elements.alertPanel.contains(event.target) || elements.alertTrigger.contains(event.target);
    if (!insideAlertUi) {
      syncOverspeedSound({ fromUserGesture: true });
      syncTrapSound({ fromUserGesture: true });
    }
    if (elements.alertPanel.hidden) return;
    if (insideAlertUi) return;
    closeAlertPanel();
  });
  document.addEventListener("keydown", (event) => {
    syncOverspeedSound({ fromUserGesture: true });
    syncTrapSound({ fromUserGesture: true });
    if (event.key === "Escape") closeAlertPanel();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopOverspeedSound();
      stopTrapSound();
      stopRenderLoop();
      return;
    }

    resizeCanvas();
    startRenderLoop();
    syncOverspeedSound();
    syncTrapSound();
  });
}

function init() {
  document.body.classList.remove("alert-panel-open");

  for (const button of elements.unitButtons) {
    button.setAttribute("aria-pressed", button.dataset.unit === state.unit ? "true" : "false");
  }

  for (const button of elements.distanceUnitButtons) {
    button.setAttribute("aria-pressed", button.dataset.distanceUnit === state.distanceUnit ? "true" : "false");
  }

  for (const button of elements.trapAlertButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapAlert === "on") === state.trapAlertEnabled,
    ));
  }

  for (const button of elements.trapSoundButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapSound === "on") === state.trapSoundEnabled,
    ));
  }

  renderMetrics();
  resizeCanvas();
  bindEvents();
  loadTrapArtifacts();
  startTracking();
  startRenderLoop();
}

init();
