import "../styles/speed.less";

const STORAGE_UNIT_KEY = "vatio_speed_unit";
const UNIT_CONFIG = {
  mph: { label: "mph", baseMax: 120, tickStep: 20, factor: 2.2369362920544 },
  kmh: { label: "km/h", baseMax: 200, tickStep: 40, factor: 3.6 },
};

const SPEED_SMOOTHING_SAMPLES = 5;
const MAX_PLAUSIBLE_SPEED_MS = 120;
const GEO_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
};

const elements = {
  canvas: document.getElementById("speedGauge"),
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
  notice: document.getElementById("notice"),
  noticeText: document.getElementById("noticeText"),
  retryGps: document.getElementById("retryGps"),
  resetTrip: document.getElementById("resetTrip"),
  unitButtons: Array.from(document.querySelectorAll(".unit-btn")),
};

const canvasContext = elements.canvas.getContext("2d");

const state = {
  unit: loadUnitPreference(),
  watchId: null,
  startTime: Date.now(),
  currentSpeedMs: 0,
  displayedSpeedMs: 0,
  maxSpeedMs: 0,
  speedSumMs: 0,
  speedSamples: 0,
  totalDistanceM: 0,
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

function setStatus(text) {
  elements.status.textContent = text;
  elements.subStatus.textContent = text;
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

function setUnit(unit) {
  if (!UNIT_CONFIG[unit] || unit === state.unit) return;

  state.unit = unit;
  saveUnitPreference(unit);

  for (const button of elements.unitButtons) {
    button.setAttribute("aria-pressed", button.dataset.unit === unit ? "true" : "false");
  }

  renderMetrics();
  drawGauge();
}

function resetTripData() {
  state.startTime = Date.now();
  state.currentSpeedMs = 0;
  state.displayedSpeedMs = 0;
  state.maxSpeedMs = 0;
  state.speedSumMs = 0;
  state.speedSamples = 0;
  state.totalDistanceM = 0;
  state.lastPoint = null;
  state.recentSpeeds = [];
  state.lastAccuracyM = null;
  state.lastFixAt = 0;

  hideNotice();
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
  const rect = elements.canvas.getBoundingClientRect();
  const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
  const dpr = window.devicePixelRatio || 1;

  if (size === state.canvasSize && elements.canvas.width === Math.floor(size * dpr)) {
    return;
  }

  state.canvasSize = size;
  elements.canvas.width = Math.floor(size * dpr);
  elements.canvas.height = Math.floor(size * dpr);
  canvasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  const size = state.canvasSize;
  const center = size / 2;
  const radius = size * 0.42;
  const ringRadius = radius * 0.84;
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const angleRange = endAngle - startAngle;
  const displaySpeed = convertSpeed(state.displayedSpeedMs);
  const gaugeMax = getGaugeMaximum(
    Math.max(displaySpeed, convertSpeed(state.maxSpeedMs)),
  );

  const bgColor = getCssColor("--speed-surface", "rgba(255,255,255,0.7)");
  const textColor = getCssColor("--btn-fg", "#111827");
  const mutedColor = getCssColor("--speed-tick", "rgba(17,24,39,0.4)");
  const trackColor = getCssColor("--speed-track", "rgba(17,24,39,0.12)");
  const accentColor = getCssColor("--speed-accent", "#10b981");
  const needleColor = getCssColor("--speed-needle", "#111827");

  canvasContext.clearRect(0, 0, size, size);

  const backdrop = canvasContext.createRadialGradient(center, center, radius * 0.2, center, center, radius);
  backdrop.addColorStop(0, bgColor);
  backdrop.addColorStop(1, "transparent");
  canvasContext.fillStyle = backdrop;
  canvasContext.beginPath();
  canvasContext.arc(center, center, radius, 0, Math.PI * 2);
  canvasContext.fill();

  canvasContext.strokeStyle = trackColor;
  canvasContext.lineWidth = Math.max(8, size * 0.03);
  canvasContext.beginPath();
  canvasContext.arc(center, center, ringRadius, startAngle, endAngle);
  canvasContext.stroke();

  const progress = Math.min(displaySpeed / gaugeMax, 1);
  canvasContext.strokeStyle = accentColor;
  canvasContext.lineCap = "round";
  canvasContext.beginPath();
  canvasContext.arc(center, center, ringRadius, startAngle, startAngle + progress * angleRange);
  canvasContext.stroke();
  canvasContext.lineCap = "butt";

  const tickCount = gaugeMax / UNIT_CONFIG[state.unit].tickStep;
  const fontSize = Math.max(13, size * 0.024);

  canvasContext.fillStyle = mutedColor;
  canvasContext.strokeStyle = mutedColor;
  canvasContext.font = `700 ${fontSize}px system-ui`;
  canvasContext.textAlign = "center";
  canvasContext.textBaseline = "middle";

  for (let index = 0; index <= tickCount; index += 1) {
    const tickValue = index * UNIT_CONFIG[state.unit].tickStep;
    const tickAngle = startAngle + (tickValue / gaugeMax) * angleRange;
    const innerRadius = radius * 0.78;
    const outerRadius = radius * 0.9;
    const labelRadius = radius * 0.64;

    canvasContext.lineWidth = index % 2 === 0 ? 3 : 2;
    canvasContext.beginPath();
    canvasContext.moveTo(
      center + innerRadius * Math.cos(tickAngle),
      center + innerRadius * Math.sin(tickAngle),
    );
    canvasContext.lineTo(
      center + outerRadius * Math.cos(tickAngle),
      center + outerRadius * Math.sin(tickAngle),
    );
    canvasContext.stroke();

    canvasContext.fillText(
      String(tickValue),
      center + labelRadius * Math.cos(tickAngle),
      center + labelRadius * Math.sin(tickAngle),
    );
  }

  const needleLength = radius * 0.72;
  const needleBack = radius * 0.12;
  // The needle shape is authored pointing straight up (-Y), while the gauge
  // angles are expressed in canvas space from +X. Align the long end of the
  // needle with the gauge angle instead of the short counterweight.
  const needleAngle = startAngle + progress * angleRange + Math.PI / 2;

  canvasContext.save();
  canvasContext.translate(center, center);
  canvasContext.rotate(needleAngle);
  canvasContext.fillStyle = needleColor;
  canvasContext.beginPath();
  canvasContext.moveTo(-4, needleBack);
  canvasContext.lineTo(-2, -needleLength);
  canvasContext.lineTo(2, -needleLength);
  canvasContext.lineTo(4, needleBack);
  canvasContext.closePath();
  canvasContext.fill();
  canvasContext.restore();

  canvasContext.fillStyle = textColor;
  canvasContext.beginPath();
  canvasContext.arc(center, center, Math.max(10, size * 0.018), 0, Math.PI * 2);
  canvasContext.fill();

  canvasContext.fillStyle = accentColor;
  canvasContext.beginPath();
  canvasContext.arc(center, center, Math.max(4, size * 0.008), 0, Math.PI * 2);
  canvasContext.fill();
}

function renderMetrics() {
  const currentSpeed = Math.round(convertSpeed(state.currentSpeedMs));
  const maxSpeed = Math.round(convertSpeed(state.maxSpeedMs));
  const averageSpeed = Math.round(convertSpeed(getAverageSpeedMs()));
  const distance = getDistanceDisplay(state.totalDistanceM);
  const unitLabel = UNIT_CONFIG[state.unit].label;

  elements.speedValue.textContent = String(currentSpeed);
  elements.speedUnit.textContent = unitLabel;
  elements.maxSpeed.textContent = String(maxSpeed);
  elements.maxSpeedUnit.textContent = unitLabel;
  elements.avgSpeed.textContent = String(averageSpeed);
  elements.avgSpeedUnit.textContent = unitLabel;
  elements.distanceValue.textContent = distance.value;
  elements.distanceUnit.textContent = distance.unit;
  elements.durationValue.textContent = formatDuration(Date.now() - state.startTime);
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

  for (const button of elements.unitButtons) {
    button.addEventListener("click", () => setUnit(button.dataset.unit));
  }

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  window.addEventListener("pageshow", () => {
    resizeCanvas();
    if (state.watchId === null) startTracking();
    startRenderLoop();
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
  for (const button of elements.unitButtons) {
    button.setAttribute("aria-pressed", button.dataset.unit === state.unit ? "true" : "false");
  }

  renderMetrics();
  resizeCanvas();
  bindEvents();
  startTracking();
  startRenderLoop();
}

init();
