import "../styles/speed.less";

const STORAGE_UNIT_KEY = "vatio_speed_unit";
const STORAGE_ALTITUDE_UNIT_KEY = "vatio_speed_altitude_unit";
const STORAGE_ALERT_ENABLED_KEY = "vatio_speed_alert_enabled";
const STORAGE_ALERT_LIMIT_KEY = "vatio_speed_alert_limit_ms";
const UNIT_CONFIG = {
  mph: { label: "mph", baseMax: 120, tickStep: 20, factor: 2.2369362920544 },
  kmh: { label: "km/h", baseMax: 200, tickStep: 40, factor: 3.6 },
};
const ALTITUDE_UNIT_CONFIG = {
  ft: { label: "ft", factor: 3.2808398950131 },
  m: { label: "m", factor: 1 },
};
const ALERT_CONFIG = {
  mph: { step: 5, min: 10, max: 180, presets: [25, 35, 45, 55, 65, 75] },
  kmh: { step: 10, min: 20, max: 280, presets: [40, 60, 80, 100, 120, 140] },
};
const DEFAULT_ALERT_LIMIT_MS = 55 / UNIT_CONFIG.mph.factor;

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
  unitButtons: Array.from(document.querySelectorAll(".unit-btn")),
  altitudeUnitButtons: Array.from(document.querySelectorAll(".altitude-unit-btn")),
};

const dialContext = elements.dialCanvas.getContext("2d");
const needleContext = elements.needleCanvas.getContext("2d");

const state = {
  unit: loadUnitPreference(),
  altitudeUnit: loadAltitudeUnitPreference(),
  alertEnabled: loadAlertEnabledPreference(),
  alertLimitMs: loadAlertLimitPreference(),
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

function loadAltitudeUnitPreference() {
  try {
    const unit = window.localStorage.getItem(STORAGE_ALTITUDE_UNIT_KEY);
    return unit && ALTITUDE_UNIT_CONFIG[unit] ? unit : "ft";
  } catch {
    return "ft";
  }
}

function saveAltitudeUnitPreference(unit) {
  try {
    window.localStorage.setItem(STORAGE_ALTITUDE_UNIT_KEY, unit);
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

function convertAltitude(altitudeM, unit = state.altitudeUnit) {
  return altitudeM * ALTITUDE_UNIT_CONFIG[unit].factor;
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

function isAlertActive() {
  return state.alertEnabled && Number.isFinite(state.alertLimitMs) && state.alertLimitMs > 0;
}

function getAlertUiState() {
  const enabled = isAlertActive();
  const unitLabel = UNIT_CONFIG[state.unit].label;
  const limitDisplayValue = getAlertLimitDisplayValue();
  const over = enabled && state.currentSpeedMs > state.alertLimitMs;
  const deltaDisplayValue = over
    ? Math.max(1, Math.round(convertSpeed(state.currentSpeedMs - state.alertLimitMs)))
    : 0;
  const near = enabled && !over && state.currentSpeedMs >= state.alertLimitMs * 0.92;

  return {
    enabled,
    over,
    near,
    unitLabel,
    limitDisplayValue,
    deltaDisplayValue,
  };
}

function getAverageSpeedMs() {
  return state.speedSamples > 0 ? state.speedSumMs / state.speedSamples : 0;
}

function getDistanceDisplay(distanceM, unit = state.unit) {
  if (unit === "kmh") {
    const kilometers = distanceM / 1000;
    if (kilometers < 10) return { value: kilometers.toFixed(1), unit: "km" };
    return { value: Math.round(kilometers).toString(), unit: "km" };
  }

  const miles = distanceM / 1609.344;
  if (miles < 10) return { value: miles.toFixed(1), unit: "mi" };
  return { value: Math.round(miles).toString(), unit: "mi" };
}

function formatAltitude(altitudeM, unit = state.altitudeUnit) {
  if (!Number.isFinite(altitudeM)) return "—";
  return Math.round(convertAltitude(altitudeM, unit)).toString();
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
  const rounded = Math.round(accuracyM);
  if (rounded <= 12) return `GPS locked · +/-${rounded} m`;
  if (rounded <= 40) return `GPS live · +/-${rounded} m`;
  return `Weak GPS · +/-${rounded} m`;
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

function renderSubStatus() {
  const alertState = getAlertUiState();
  const isLiveStatus = state.lastFixAt > 0
    && !/^(Requesting GPS|Waiting for GPS|GPS blocked|GPS unavailable|GPS error)/.test(state.statusText);

  if (alertState.over && isLiveStatus) {
    elements.subStatus.textContent = `Over by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`;
    return;
  }

  if (alertState.enabled && isLiveStatus) {
    elements.subStatus.textContent = `Alert at ${alertState.limitDisplayValue} ${alertState.unitLabel}`;
    return;
  }

  elements.subStatus.textContent = state.statusText;
}

function renderAlertUi() {
  const alertState = getAlertUiState();
  const currentLimitDisplay = getAlertLimitDisplayValue();
  const canUseCurrentSpeed = state.lastFixAt > 0
    && Math.round(convertSpeed(state.currentSpeedMs)) >= getAlertConfig().min;

  renderAlertPresets();

  elements.alertTriggerValue.textContent = alertState.enabled
    ? (alertState.over
      ? `+${alertState.deltaDisplayValue} over`
      : `${alertState.limitDisplayValue} ${alertState.unitLabel}`)
    : "Off";
  elements.alertTrigger.setAttribute(
    "aria-label",
    alertState.enabled
      ? `Speed alert set to ${alertState.limitDisplayValue} ${alertState.unitLabel}`
      : "Speed alert off",
  );
  elements.alertPanelStatus.textContent = alertState.enabled
    ? (alertState.over
      ? `Over by ${alertState.deltaDisplayValue} ${alertState.unitLabel}`
      : `${alertState.limitDisplayValue} ${alertState.unitLabel}`)
    : "Off";
  elements.alertToggle.textContent = alertState.enabled ? "Turn off" : "Turn on";
  elements.alertToggle.setAttribute("aria-pressed", String(alertState.enabled));
  elements.alertUseCurrent.disabled = !canUseCurrentSpeed;
  elements.alertValue.textContent = String(currentLimitDisplay);
  elements.alertUnit.textContent = alertState.unitLabel;
  elements.alertDecrease.disabled = currentLimitDisplay <= getAlertConfig().min;
  elements.alertIncrease.disabled = currentLimitDisplay >= getAlertConfig().max;

  for (const button of elements.alertPresets.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.alertPreset) === currentLimitDisplay));
  }

  elements.gaugeCard.classList.toggle("is-alert-enabled", alertState.enabled);
  elements.gaugeCard.classList.toggle("is-alert-near", alertState.near);
  elements.gaugeCard.classList.toggle("is-alert-over", alertState.over);

  renderSubStatus();
}

function setAlertEnabled(enabled) {
  state.alertEnabled = enabled;
  if (!Number.isFinite(state.alertLimitMs) || state.alertLimitMs <= 0) {
    state.alertLimitMs = DEFAULT_ALERT_LIMIT_MS;
  }

  saveAlertEnabledPreference(enabled);
  renderAlertUi();
  drawGauge();
}

function setAlertLimitDisplay(value, { enable = true } = {}) {
  const normalizedValue = normalizeAlertDisplayValue(value, state.unit);
  state.alertLimitMs = convertDisplaySpeedToMs(normalizedValue, state.unit);
  saveAlertLimitPreference(state.alertLimitMs);

  if (enable) {
    state.alertEnabled = true;
    saveAlertEnabledPreference(true);
  }

  renderAlertUi();
  drawGauge();
}

function adjustAlertLimit(stepDirection) {
  const { step } = getAlertConfig();
  const currentDisplayValue = normalizeAlertDisplayValue(getAlertLimitDisplayValue(), state.unit);
  setAlertLimitDisplay(currentDisplayValue + stepDirection * step);
}

function setAlertLimitToCurrentSpeed() {
  if (state.lastFixAt === 0) return;
  setAlertLimitDisplay(Math.round(convertSpeed(state.currentSpeedMs)));
}

function openAlertPanel() {
  renderAlertUi();
  document.body.classList.add("alert-panel-open");
  elements.alertPanel.hidden = false;
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

function setAltitudeUnit(unit) {
  if (!ALTITUDE_UNIT_CONFIG[unit] || unit === state.altitudeUnit) return;

  state.altitudeUnit = unit;
  saveAltitudeUnitPreference(unit);

  for (const button of elements.altitudeUnitButtons) {
    button.setAttribute("aria-pressed", button.dataset.altitudeUnit === unit ? "true" : "false");
  }

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
  const accentColor = alertState.over
    ? getCssColor("--speed-alert", "#ef4444")
    : getCssColor("--speed-accent", "#10b981");
  const alertMarkerColor = getCssColor("--speed-alert-marker", "#ff7a5c");
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
  const unitLabel = UNIT_CONFIG[state.unit].label;
  const altitudeUnitLabel = ALTITUDE_UNIT_CONFIG[state.altitudeUnit].label;

  elements.speedValue.textContent = String(currentSpeed);
  elements.speedUnit.textContent = unitLabel;
  elements.maxSpeed.textContent = String(maxSpeed);
  elements.maxSpeedUnit.textContent = unitLabel;
  elements.avgSpeed.textContent = String(averageSpeed);
  elements.avgSpeedUnit.textContent = unitLabel;
  elements.distanceValue.textContent = distance.value;
  elements.distanceUnit.textContent = distance.unit;
  elements.durationValue.textContent = formatDuration(Date.now() - state.startTime);
  elements.altitudeValue.textContent = formatAltitude(state.currentAltitudeM);
  elements.altitudeUnit.textContent = altitudeUnitLabel;
  elements.maxAltitude.textContent = formatAltitude(state.maxAltitudeM);
  elements.maxAltitudeUnit.textContent = altitudeUnitLabel;
  elements.minAltitude.textContent = formatAltitude(state.minAltitudeM);
  elements.minAltitudeUnit.textContent = altitudeUnitLabel;
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
    if (isAlertActive()) {
      setAlertEnabled(false);
      return;
    }
    setAlertEnabled(true);
  });
  elements.alertUseCurrent.addEventListener("click", setAlertLimitToCurrentSpeed);
  elements.alertDecrease.addEventListener("click", () => adjustAlertLimit(-1));
  elements.alertIncrease.addEventListener("click", () => adjustAlertLimit(1));
  elements.alertPresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-alert-preset]");
    if (!button) return;
    setAlertLimitDisplay(Number(button.dataset.alertPreset));
  });

  for (const button of elements.unitButtons) {
    button.addEventListener("click", () => setUnit(button.dataset.unit));
  }

  for (const button of elements.altitudeUnitButtons) {
    button.addEventListener("click", () => setAltitudeUnit(button.dataset.altitudeUnit));
  }

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  window.addEventListener("pageshow", () => {
    resizeCanvas();
    if (state.watchId === null) startTracking();
    startRenderLoop();
  });
  document.addEventListener("pointerdown", (event) => {
    if (elements.alertPanel.hidden) return;
    if (elements.alertPanel.contains(event.target) || elements.alertTrigger.contains(event.target)) return;
    closeAlertPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAlertPanel();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRenderLoop();
      return;
    }

    resizeCanvas();
    startRenderLoop();
  });
}

function init() {
  document.body.classList.remove("alert-panel-open");

  for (const button of elements.unitButtons) {
    button.setAttribute("aria-pressed", button.dataset.unit === state.unit ? "true" : "false");
  }

  for (const button of elements.altitudeUnitButtons) {
    button.setAttribute("aria-pressed", button.dataset.altitudeUnit === state.altitudeUnit ? "true" : "false");
  }

  renderMetrics();
  resizeCanvas();
  bindEvents();
  startTracking();
  startRenderLoop();
}

init();
