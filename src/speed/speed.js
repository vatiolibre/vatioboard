import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/speed.less";
import maplibregl from "maplibre-gl";
import KDBush from "kdbush";
import { around as geoAround, distance as geoDistanceKm } from "geokdbush";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";

applyTranslations();

const STORAGE_UNIT_KEY = "vatio_speed_unit";
const STORAGE_DISTANCE_UNIT_KEY = "vatio_speed_distance_unit";
const LEGACY_STORAGE_ALTITUDE_UNIT_KEY = "vatio_speed_altitude_unit";
const STORAGE_ALERT_ENABLED_KEY = "vatio_speed_alert_enabled";
const STORAGE_ALERT_LIMIT_KEY = "vatio_speed_alert_limit_ms";
const STORAGE_ALERT_SOUND_ENABLED_KEY = "vatio_speed_alert_sound_enabled";
const STORAGE_TRAP_ALERT_ENABLED_KEY = "vatio_speed_trap_alert_enabled";
const STORAGE_TRAP_ALERT_DISTANCE_KEY = "vatio_speed_trap_alert_distance_m";
const STORAGE_TRAP_SOUND_ENABLED_KEY = "vatio_speed_trap_sound_enabled";
const STORAGE_AUDIO_MUTED_KEY = "vatio_speed_audio_muted";
const STORAGE_BACKGROUND_AUDIO_ENABLED_KEY = "vatio_speed_background_audio_enabled";
const STORAGE_ALERT_TRIGGER_DISCOVERED_KEY = "vatio_speed_alert_trigger_discovered";
const OVERSPEED_SOUND_URL = "/audio/overspeed_notification.m4a";
const TRAP_SOUND_URL = "/audio/near_camera_notification.m4a";
const TRAP_DATA_URL = "/geo/ansv_cameras_compact.min.json";
const TRAP_INDEX_URL = "/geo/ansv_cameras_compact.kdbush";
const BACKGROUND_KEEPALIVE_SAMPLE_RATE = 22050;
const BACKGROUND_KEEPALIVE_DURATION_SECONDS = 2;
const GLOBE_DEFAULT_CENTER = [137.9150899566626, 36.25956997955441];
const GLOBE_DEFAULT_ZOOM = 0.15;
const GLOBE_FOLLOW_ZOOM = 0.8;
const GLOBE_SOURCE_ID = "live-position";
const GLOBE_SATELLITE_ATTRIBUTION = [
  '<a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless</a>',
  'by',
  '<a href="https://eox.at" target="_blank" rel="noopener noreferrer">EOX IT Services GmbH</a>',
  '(Contains modified Copernicus Sentinel data 2020)',
].join(" ");
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
const DEFAULT_ALERT_LIMIT_MS = 100 / UNIT_CONFIG.kmh.factor;
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
const MIN_MOVING_SPEED_MS = 0.8;
const MIN_DISTANCE_NOISE_FLOOR_M = 4;
const MAX_ACCURACY_INFLUENCE_M = 18;
const MAX_PLAUSIBLE_SPEED_MS = 120;
const MIN_VALID_EPOCH_MS = Date.UTC(2000, 0, 1);
const GEO_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
};

const elements = {
  gaugeCard: document.querySelector(".gauge-card"),
  langToggle: document.getElementById("langToggle"),
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
  alertTriggerHint: document.getElementById("alertTriggerHint"),
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
  quickAudioToggle: document.getElementById("quickAudioToggle"),
  quickBackgroundAudioToggle: document.getElementById("quickBackgroundAudioToggle"),
  backgroundAudioButtons: Array.from(document.querySelectorAll(".background-audio-btn")),
  unitButtons: Array.from(document.querySelectorAll(".unit-btn")),
  distanceUnitButtons: Array.from(document.querySelectorAll(".distance-unit-btn")),
  globeMount: document.getElementById("speedGlobe"),
  globeStatus: document.getElementById("globeStatus"),
};

function writeAsciiString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

// Use a real silent loop so background mode claims the media session immediately.
function createSilentLoopAudioUrl() {
  const sampleCount = BACKGROUND_KEEPALIVE_SAMPLE_RATE * BACKGROUND_KEEPALIVE_DURATION_SECONDS;
  const buffer = new ArrayBuffer(44 + (sampleCount * 2));
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + (sampleCount * 2), true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, BACKGROUND_KEEPALIVE_SAMPLE_RATE, true);
  view.setUint32(28, BACKGROUND_KEEPALIVE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

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
let backgroundKeepAliveAudioUrl = createSilentLoopAudioUrl();
const backgroundKeepAliveAudio = new Audio(backgroundKeepAliveAudioUrl);
backgroundKeepAliveAudio.loop = true;
backgroundKeepAliveAudio.preload = "auto";
backgroundKeepAliveAudio.playsInline = true;
let trapLoadPromise = null;
const pageDescriptionMeta = document.querySelector('meta[name="description"]');

const initialUnit = loadUnitPreference();
const initialDistanceUnit = loadDistanceUnitPreference();

const state = {
  unit: initialUnit,
  distanceUnit: initialDistanceUnit,
  alertEnabled: loadAlertEnabledPreference(),
  alertLimitMs: loadAlertLimitPreference(),
  alertSoundEnabled: loadAlertSoundEnabledPreference(),
  audioMuted: loadAudioMutedPreference(),
  backgroundAudioEnabled: loadBackgroundAudioEnabledPreference(),
  audioPrimed: false,
  audioPrimePending: false,
  backgroundAudioArmed: false,
  backgroundAudioArmPending: false,
  backgroundAudioRevision: 0,
  alertSoundBlocked: false,
  alertSoundPending: false,
  overspeedAudible: false,
  trapAlertEnabled: loadTrapAlertEnabledPreference(),
  trapAlertDistanceM: loadTrapAlertDistancePreference(initialDistanceUnit),
  trapSoundEnabled: loadTrapSoundEnabledPreference(),
  alertTriggerDiscovered: loadAlertTriggerDiscoveredPreference(),
  trapSoundBlocked: false,
  trapSoundPending: false,
  trapAudible: false,
  trapMuteTimeoutId: null,
  watchId: null,
  startTime: null,
  trackingStartedAt: Date.now(),
  statusKind: "requesting",
  statusParams: null,
  statusText: t("requestingGps"),
  noticeKey: null,
  noticeParams: null,
  currentSpeedMs: 0,
  displayedSpeedMs: 0,
  maxSpeedMs: 0,
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
  trapLoadPending: true,
  trapLoadError: null,
  lastTrapSoundedId: null,
  recentSpeeds: [],
  lastAccuracyM: null,
  lastFixAt: 0,
  lastPositionTimestamp: null,
  renderFrameId: null,
  lastTextUpdateAt: 0,
  canvasSize: 0,
  globeMap: null,
  globeReady: false,
  globeError: null,
  globeResizeObserver: null,
  globeCenter: null,
};

function tf(key, values = {}) {
  return t(key).replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? ""));
}

function updatePageMeta() {
  document.documentElement.lang = getLang();
  document.title = t("speedPageTitle");
  if (pageDescriptionMeta) {
    pageDescriptionMeta.setAttribute("content", t("speedPageDescription"));
  }
}

function loadUnitPreference() {
  try {
    const unit = window.localStorage.getItem(STORAGE_UNIT_KEY);
    return unit && UNIT_CONFIG[unit] ? unit : "kmh";
  } catch {
    return "kmh";
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
    return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit] ? legacyUnit : "m";
  } catch {
    return "m";
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

function loadAudioMutedPreference() {
  try {
    return window.localStorage.getItem(STORAGE_AUDIO_MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveAudioMutedPreference(muted) {
  try {
    window.localStorage.setItem(STORAGE_AUDIO_MUTED_KEY, String(muted));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function loadBackgroundAudioEnabledPreference() {
  try {
    return window.localStorage.getItem(STORAGE_BACKGROUND_AUDIO_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveBackgroundAudioEnabledPreference(enabled) {
  try {
    window.localStorage.setItem(STORAGE_BACKGROUND_AUDIO_ENABLED_KEY, String(enabled));
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

function loadAlertTriggerDiscoveredPreference() {
  try {
    return window.localStorage.getItem(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveAlertTriggerDiscoveredPreference(discovered) {
  try {
    window.localStorage.setItem(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY, String(discovered));
  } catch {
    // Ignore storage restrictions. The page still works without persistence.
  }
}

function getStatusText(kind = state.statusKind, params = state.statusParams) {
  switch (kind) {
    case "accuracy":
      return describeAccuracy(params?.accuracyM);
    case "notSupported":
      return t("gpsNotSupported");
    case "blocked":
      return t("gpsBlocked");
    case "unavailable":
      return t("gpsUnavailable");
    case "waiting":
      return t("waitingForGps");
    case "error":
      return params?.text || t("gpsError");
    case "requesting":
    default:
      return t("requestingGps");
  }
}

function setStatus(kind, params = null) {
  state.statusKind = kind;
  state.statusParams = params;
  state.statusText = getStatusText(kind, params);
  elements.status.textContent = state.statusText;
  renderSubStatus();
  renderGlobeStatus();
}

function showNotice(message) {
  state.noticeKey = null;
  state.noticeParams = null;
  elements.notice.hidden = false;
  elements.noticeText.textContent = message;
}

function showTranslatedNotice(key, params = null) {
  state.noticeKey = key;
  state.noticeParams = params;
  elements.notice.hidden = false;
  elements.noticeText.textContent = tf(key, params ?? {});
}

function hideNotice() {
  state.noticeKey = null;
  state.noticeParams = null;
  elements.notice.hidden = true;
}

function getEmptyGlobeSourceData() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function getGlobePointData(longitude, latitude) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
      },
    ],
  };
}

function renderGlobeStatus() {
  if (!elements.globeStatus) return;
  if (state.globeError) {
    elements.globeStatus.textContent = t("globeUnavailable");
    return;
  }

  if (Number.isFinite(state.lastPositionTimestamp)) {
    elements.globeStatus.textContent = formatGlobeTimestamp(state.lastPositionTimestamp);
    return;
  }

  elements.globeStatus.textContent = state.statusText;
}

function formatGlobeTimestamp(timestamp) {
  try {
    return new Intl.DateTimeFormat(getLang(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function collapseGlobeAttributionControl() {
  const attributionControl = elements.globeMount?.querySelector(".maplibregl-ctrl-attrib");
  if (!attributionControl) return;

  attributionControl.classList.remove("maplibregl-compact-show");
  attributionControl.removeAttribute("open");
}

function resizeGlobe() {
  if (!state.globeMap || !elements.globeMount) return;

  const rect = elements.globeMount.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  state.globeMap.resize();
}

function updateGlobeSource(longitude, latitude) {
  if (!state.globeMap || !state.globeReady) return;

  const source = state.globeMap.getSource(GLOBE_SOURCE_ID);
  if (source && typeof source.setData === "function") {
    source.setData(getGlobePointData(longitude, latitude));
  }
}

function syncGlobePosition(longitude, latitude, { immediate = false } = {}) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
  if (!state.globeMap || !state.globeReady) return;

  updateGlobeSource(longitude, latitude);

  const nextCenter = [longitude, latitude];
  const centerDistanceM = Array.isArray(state.globeCenter)
    ? haversineDistance(
      {
        longitude: state.globeCenter[0],
        latitude: state.globeCenter[1],
      },
      {
        longitude,
        latitude,
      },
    )
    : Number.POSITIVE_INFINITY;
  const isAlreadyCentered = centerDistanceM < 120;

  if (isAlreadyCentered) return;

  state.globeCenter = nextCenter;

  if (immediate) {
    state.globeMap.jumpTo({ center: nextCenter, zoom: GLOBE_FOLLOW_ZOOM });
    return;
  }

  state.globeMap.easeTo({
    center: nextCenter,
    zoom: GLOBE_FOLLOW_ZOOM,
    duration: 1400,
    essential: true,
  });
}

function resetGlobe() {
  state.globeCenter = null;

  if (!state.globeMap || !state.globeReady) {
    renderGlobeStatus();
    return;
  }

  const source = state.globeMap.getSource(GLOBE_SOURCE_ID);
  if (source && typeof source.setData === "function") {
    source.setData(getEmptyGlobeSourceData());
  }

  state.globeMap.easeTo({
    center: GLOBE_DEFAULT_CENTER,
    zoom: GLOBE_DEFAULT_ZOOM,
    duration: 900,
    essential: true,
  });
}

function initGlobe() {
  if (!elements.globeMount || state.globeMap) return;

  try {
    const globeMap = new maplibregl.Map({
      container: elements.globeMount,
      antialias: true,
      attributionControl: false,
      interactive: false,
      center: GLOBE_DEFAULT_CENTER,
      zoom: GLOBE_DEFAULT_ZOOM,
      style: {
        version: 8,
        projection: {
          type: "globe",
        },
        sources: {
          satellite: {
            type: "raster",
            tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
            attribution: GLOBE_SATELLITE_ATTRIBUTION,
          },
          [GLOBE_SOURCE_ID]: {
            type: "geojson",
            data: getEmptyGlobeSourceData(),
          },
        },
        layers: [
          {
            id: "Satellite",
            type: "raster",
            source: "satellite",
          },
          {
            id: "globe-position-glow",
            type: "circle",
            source: GLOBE_SOURCE_ID,
            paint: {
              "circle-radius": 14,
              "circle-color": "#10b981",
              "circle-opacity": 0.22,
              "circle-blur": 0.55,
            },
          },
          {
            id: "globe-position-core",
            type: "circle",
            source: GLOBE_SOURCE_ID,
            paint: {
              "circle-radius": 5,
              "circle-color": "#10b981",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          },
        ],
        sky: {
          "atmosphere-blend": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 1,
            5, 1,
            7, 0,
          ],
        },
        light: {
          anchor: "map",
          position: [1.5, 90, 80],
        },
      },
    });

    globeMap.addControl(new maplibregl.AttributionControl({ compact: true }));

    state.globeMap = globeMap;
    state.globeError = null;
    renderGlobeStatus();

    globeMap.on("load", () => {
      state.globeReady = true;
      collapseGlobeAttributionControl();
      resizeGlobe();

      if (state.lastPoint) {
        syncGlobePosition(state.lastPoint.longitude, state.lastPoint.latitude, { immediate: true });
      }
    });

    globeMap.on("resize", () => {
      collapseGlobeAttributionControl();
    });

    if (typeof ResizeObserver === "function") {
      state.globeResizeObserver = new ResizeObserver(() => {
        resizeGlobe();
      });
      state.globeResizeObserver.observe(elements.globeMount);
    }
  } catch (error) {
    state.globeError = error;
    state.globeReady = false;
    renderGlobeStatus();
  }
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

function getElapsedTripSeconds() {
  if (!Number.isFinite(state.startTime)) return 0;
  return Math.max(0, (Date.now() - state.startTime) / 1000);
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
  return `${formatted.value} ${formatted.unit}`;
}

function getConfiguredTrapAlertDistanceLabel(distanceM = state.trapAlertDistanceM, unit = state.distanceUnit) {
  const matchingPreset = getTrapAlertPresets(unit).find((preset) => Math.abs(preset.meters - distanceM) < 1);
  return matchingPreset?.label ?? getTrapAlertDistanceLabel(distanceM);
}

function isTrapDataReady() {
  return !state.trapLoadPending && !state.trapLoadError;
}

function getActiveTrapAlert() {
  if (!isTrapDataReady()) return null;
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
  return getAlertUiState().over && state.alertSoundEnabled && !state.audioMuted;
}

function clearTrapMuteTimeout() {
  if (state.trapMuteTimeoutId !== null) {
    window.clearTimeout(state.trapMuteTimeoutId);
    state.trapMuteTimeoutId = null;
  }
}

function getTrapSoundDurationMs() {
  return Number.isFinite(trapAlertAudio.duration) && trapAlertAudio.duration > 0
    ? Math.round(trapAlertAudio.duration * 1000)
    : 1800;
}

function silenceAudioElement(audio) {
  audio.muted = true;
  audio.volume = 0;
}

function activateAudioElement(audio) {
  audio.muted = false;
  audio.volume = 1;
}

function wantsBackgroundAudio() {
  return state.backgroundAudioEnabled && !state.audioMuted;
}

function isStaleBackgroundAudioArm(revision) {
  return revision !== state.backgroundAudioRevision || !wantsBackgroundAudio();
}

async function ensureBackgroundKeepAliveAudio() {
  backgroundKeepAliveAudio.loop = true;
  backgroundKeepAliveAudio.muted = false;
  backgroundKeepAliveAudio.volume = 1;

  if (!backgroundKeepAliveAudio.paused) {
    return true;
  }

  backgroundKeepAliveAudio.currentTime = 0;
  const playPromise = backgroundKeepAliveAudio.play();
  if (playPromise && typeof playPromise.then === "function") {
    await playPromise;
  }

  return true;
}

function stopBackgroundKeepAliveAudio() {
  backgroundKeepAliveAudio.pause();
  backgroundKeepAliveAudio.currentTime = 0;
}

function revokeBackgroundKeepAliveAudioUrl() {
  if (!backgroundKeepAliveAudioUrl) return;
  URL.revokeObjectURL(backgroundKeepAliveAudioUrl);
  backgroundKeepAliveAudioUrl = "";
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopBackgroundKeepAliveAudio();
    revokeBackgroundKeepAliveAudioUrl();
  });
}

async function ensureAudioElementLooping(audio) {
  audio.loop = true;
  silenceAudioElement(audio);

  if (!audio.paused) {
    return true;
  }

  audio.currentTime = 0;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === "function") {
    await playPromise;
  }

  return true;
}

function stopOverspeedSound() {
  state.alertSoundPending = false;
  state.overspeedAudible = false;
  overspeedAudio.pause();
  overspeedAudio.currentTime = 0;
}

function keepOverspeedAudioAlive() {
  state.overspeedAudible = false;
  overspeedAudio.loop = true;
  silenceAudioElement(overspeedAudio);
  if (!overspeedAudio.paused) {
    overspeedAudio.currentTime = 0;
    return;
  }

  if (state.backgroundAudioArmed) {
    void ensureAudioElementLooping(overspeedAudio).catch(() => {});
  }
}

function syncOverspeedSound({ fromUserGesture = false } = {}) {
  if (!shouldPlayOverspeedSound()) {
    state.alertSoundBlocked = false;
    if (state.backgroundAudioArmed) {
      keepOverspeedAudioAlive();
      return;
    }
    stopOverspeedSound();
    return;
  }

  if (state.overspeedAudible && !overspeedAudio.paused) {
    return;
  }

  if (state.alertSoundPending) {
    return;
  }

  if (state.alertSoundBlocked && !fromUserGesture) {
    return;
  }

  overspeedAudio.loop = true;
  overspeedAudio.currentTime = 0;
  activateAudioElement(overspeedAudio);
  const playPromise = overspeedAudio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    state.alertSoundBlocked = false;
    state.overspeedAudible = true;
    return;
  }

  state.alertSoundPending = true;
  playPromise
    .then(() => {
      state.alertSoundPending = false;
      state.alertSoundBlocked = false;
      state.overspeedAudible = true;
    })
    .catch(() => {
      state.alertSoundPending = false;
      state.alertSoundBlocked = true;
      stopOverspeedSound();
    });
}

function stopTrapSound() {
  state.trapSoundPending = false;
  state.trapAudible = false;
  clearTrapMuteTimeout();
  trapAlertAudio.pause();
  trapAlertAudio.currentTime = 0;
}

function keepTrapAudioAlive() {
  clearTrapMuteTimeout();
  state.trapAudible = false;
  trapAlertAudio.loop = true;
  silenceAudioElement(trapAlertAudio);
  if (!trapAlertAudio.paused) {
    trapAlertAudio.currentTime = 0;
    return;
  }

  if (state.backgroundAudioArmed) {
    void ensureAudioElementLooping(trapAlertAudio).catch(() => {});
  }
}

function scheduleTrapAudioMute() {
  clearTrapMuteTimeout();
  state.trapMuteTimeoutId = window.setTimeout(() => {
    keepTrapAudioAlive();
  }, getTrapSoundDurationMs());
}

async function primeAudioElement(audio) {
  if (!audio.paused) {
    return true;
  }

  const previousMuted = audio.muted;
  const previousVolume = audio.volume;
  const previousLoop = audio.loop;

  audio.muted = true;
  audio.volume = 0;
  audio.currentTime = 0;

  try {
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }
    audio.pause();
    audio.currentTime = 0;
    return true;
  } catch {
    audio.pause();
    audio.currentTime = 0;
    return false;
  } finally {
    audio.muted = previousMuted;
    audio.volume = previousVolume;
    audio.loop = previousLoop;
  }
}

async function primeAlertAudio() {
  if (state.audioPrimed || state.audioPrimePending) return;

  state.audioPrimePending = true;

  try {
    const [overspeedPrimed, trapPrimed] = await Promise.all([
      primeAudioElement(overspeedAudio),
      primeAudioElement(trapAlertAudio),
    ]);

    state.audioPrimed = overspeedPrimed && trapPrimed;
    if (state.audioPrimed) {
      state.alertSoundBlocked = false;
      state.trapSoundBlocked = false;
    }
  } finally {
    state.audioPrimePending = false;
  }
}

async function armBackgroundAlertAudio() {
  if (!wantsBackgroundAudio()) return;
  if (
    state.backgroundAudioArmed
    && !state.backgroundAudioArmPending
    && !backgroundKeepAliveAudio.paused
    && !overspeedAudio.paused
    && !trapAlertAudio.paused
  ) {
    return;
  }
  if (state.backgroundAudioArmPending) return;

  const backgroundAudioRevision = state.backgroundAudioRevision;
  let shouldRetry = false;
  state.backgroundAudioArmPending = true;

  try {
    await primeAlertAudio();
    if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
      shouldRetry = wantsBackgroundAudio();
      return;
    }
    if (!state.audioPrimed) {
      return;
    }

    await ensureBackgroundKeepAliveAudio();
    if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
      shouldRetry = wantsBackgroundAudio();
      disarmBackgroundAlertAudio();
      return;
    }
    await Promise.all([
      ensureAudioElementLooping(overspeedAudio),
      ensureAudioElementLooping(trapAlertAudio),
    ]);
    if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
      shouldRetry = wantsBackgroundAudio();
      disarmBackgroundAlertAudio();
      return;
    }

    state.backgroundAudioArmed = true;
    state.alertSoundBlocked = false;
    state.trapSoundBlocked = false;
    keepOverspeedAudioAlive();
    keepTrapAudioAlive();
  } catch {
    disarmBackgroundAlertAudio();
  } finally {
    state.backgroundAudioArmPending = false;
    if (shouldRetry && !state.backgroundAudioArmed && !state.backgroundAudioArmPending) {
      void armBackgroundAlertAudio();
    }
  }
}

function disarmBackgroundAlertAudio() {
  state.backgroundAudioArmed = false;
  state.backgroundAudioArmPending = false;
  clearTrapMuteTimeout();
  stopBackgroundKeepAliveAudio();

  if (shouldPlayOverspeedSound()) {
    overspeedAudio.loop = true;
    activateAudioElement(overspeedAudio);
  } else {
    stopOverspeedSound();
  }

  const activeTrap = getActiveTrapAlert();
  if (activeTrap && state.trapSoundEnabled && state.trapAudible) {
    trapAlertAudio.loop = false;
    activateAudioElement(trapAlertAudio);
  } else {
    stopTrapSound();
  }
}

function renderQuickAudioControls() {
  if (elements.quickAudioToggle) {
    elements.quickAudioToggle.setAttribute("aria-pressed", String(!state.audioMuted));
    elements.quickAudioToggle.classList.toggle("is-muted", state.audioMuted);
    const audioToggleLabel = state.audioMuted ? t("unmuteAlertAudio") : t("muteAlertAudio");
    elements.quickAudioToggle.setAttribute("aria-label", audioToggleLabel);
    elements.quickAudioToggle.title = audioToggleLabel;
  }

  if (elements.quickBackgroundAudioToggle) {
    elements.quickBackgroundAudioToggle.setAttribute("aria-pressed", String(state.backgroundAudioEnabled));
    const backgroundAudioLabel = state.backgroundAudioEnabled
      ? t("disableBackgroundAudio")
      : t("enableBackgroundAudio");
    elements.quickBackgroundAudioToggle.setAttribute("aria-label", backgroundAudioLabel);
    elements.quickBackgroundAudioToggle.title = backgroundAudioLabel;
  }
}

function syncTrapSound({ fromUserGesture = false } = {}) {
  const activeTrap = getActiveTrapAlert();

  if (!activeTrap) {
    state.lastTrapSoundedId = null;
    state.trapSoundBlocked = false;
    if (state.backgroundAudioArmed) {
      keepTrapAudioAlive();
      return;
    }
    stopTrapSound();
    return;
  }

  if (!state.trapSoundEnabled || state.audioMuted) {
    state.trapSoundBlocked = false;
    if (state.backgroundAudioArmed) {
      keepTrapAudioAlive();
      return;
    }
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

  clearTrapMuteTimeout();
  trapAlertAudio.loop = state.backgroundAudioArmed;
  trapAlertAudio.currentTime = 0;
  activateAudioElement(trapAlertAudio);
  const playPromise = trapAlertAudio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    state.trapSoundBlocked = false;
    state.trapAudible = true;
    state.lastTrapSoundedId = activeTrap.id;
    if (state.backgroundAudioArmed) {
      scheduleTrapAudioMute();
    }
    return;
  }

  state.trapSoundPending = true;
  playPromise
    .then(() => {
      state.trapSoundPending = false;
      state.trapSoundBlocked = false;
      state.trapAudible = true;
      state.lastTrapSoundedId = activeTrap.id;
      if (state.backgroundAudioArmed) {
        scheduleTrapAudioMute();
      }
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
  if (trapLoadPromise) {
    return trapLoadPromise;
  }

  if (isTrapDataReady()) {
    return state.trapIndex;
  }

  state.trapLoadPending = true;
  state.trapLoadError = null;
  renderMetrics();

  trapLoadPromise = (async () => {
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
    } finally {
      state.trapLoadPending = false;
      trapLoadPromise = null;
    }

    if (state.lastPoint) {
      updateNearestTrap(state.lastPoint.longitude, state.lastPoint.latitude);
    }

    renderMetrics();
    return state.trapIndex;
  })();

  return trapLoadPromise;
}

function ensureTrapArtifactsLoaded() {
  if (!state.trapAlertEnabled) return;
  if (state.trapLoadPending || isTrapDataReady()) return;
  void loadTrapArtifacts();
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
    return { value: "—", unit: t("away") };
  }

  if (unit === "m") {
    if (distanceM < 1000) {
      return { value: Math.round(distanceM).toString(), unit: "m" };
    }

    const kilometers = distanceM / 1000;
    return {
      value: kilometers < 10 ? kilometers.toFixed(1) : Math.round(kilometers).toString(),
      unit: "km",
    };
  }

  const feet = distanceM * 3.2808398950131;
  if (feet < 5280) {
    return { value: Math.round(feet).toString(), unit: "ft" };
  }

  const miles = distanceM / 1609.344;
  return {
    value: miles < 10 ? miles.toFixed(1) : Math.round(miles).toString(),
    unit: "mi",
  };
}

function formatTrapSpeed(speedKph) {
  if (!Number.isFinite(speedKph)) return null;
  if (state.unit === "kmh") return `${Math.round(speedKph)} km/h`;
  return `${Math.round(speedKph / 1.609344)} mph`;
}

function getAverageSpeedMs() {
  const elapsedSeconds = getElapsedTripSeconds();
  return elapsedSeconds > 0 ? state.totalDistanceM / elapsedSeconds : 0;
}

function getDistanceDisplay(distanceM, unit = state.distanceUnit) {
  if (unit === "m") {
    if (distanceM < 1000) return { value: Math.round(distanceM).toString(), unit: "m" };
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

function normalizePositionTimestamp(timestamp, fallbackMs = Date.now()) {
  if (!Number.isFinite(timestamp)) return fallbackMs;

  const safeFallbackMs = Number.isFinite(fallbackMs) ? fallbackMs : Date.now();
  const maxReasonableMs = safeFallbackMs + (60 * 1000);

  if (timestamp < MIN_VALID_EPOCH_MS || timestamp > maxReasonableMs) {
    return safeFallbackMs;
  }

  return timestamp;
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
  if (!Number.isFinite(accuracyM)) return t("gpsLive");
  const accuracyValue = Math.round(convertDistanceMeasurement(accuracyM));
  const accuracyUnit = DISTANCE_UNIT_CONFIG[state.distanceUnit].label;
  const rounded = Math.round(accuracyM);
  if (rounded <= 12) return tf("gpsLockedAccuracy", { value: accuracyValue, unit: accuracyUnit });
  if (rounded <= 40) return tf("gpsLiveAccuracy", { value: accuracyValue, unit: accuracyUnit });
  return tf("weakGpsAccuracy", { value: accuracyValue, unit: accuracyUnit });
}

function getMovementThresholdM(currentAccuracyM, previousAccuracyM) {
  const accuracies = [currentAccuracyM, previousAccuracyM].filter(Number.isFinite);
  const accuracyFloorM = accuracies.length > 0
    ? Math.min(Math.max(...accuracies), MAX_ACCURACY_INFLUENCE_M)
    : 0;

  return Math.max(MIN_DISTANCE_NOISE_FLOOR_M, accuracyFloorM * 0.5);
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
    return tf("alertOverShort", { delta: alertState.deltaDisplayValue });
  }

  if (alertState.trapActive) {
    return tf("trapLabel", { distance: alertState.trapDistanceLabel });
  }

  if (alertState.manualEnabled) {
    return `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
  }

  if (state.trapAlertEnabled && state.trapLoadPending) {
    return t("loadingTraps");
  }

  if (state.trapAlertEnabled && state.trapLoadError) {
    return t("trapUnavailable");
  }

  if (state.trapAlertEnabled) {
    return tf("trapLabel", { distance: getConfiguredTrapAlertDistanceLabel() });
  }

  return t("tapToConfigure");
}

function getAlertTriggerLabel(alertState) {
  if (alertState.over) {
    return alertState.source === "trap"
      ? tf("overTrapSpeedLimitBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
      : tf("overManualSpeedAlertBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
  }

  if (alertState.trapActive) {
    return alertState.trapSpeedLabel
      ? tf("trapAlertActiveWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
      : tf("trapAlertActive", { distance: alertState.trapDistanceLabel });
  }

  if (alertState.manualEnabled) {
    return tf("manualSpeedAlertSetTo", { limit: `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}` });
  }

  if (state.trapAlertEnabled && state.trapLoadPending) {
    return t("loadingSpeedTrapData");
  }

  if (state.trapAlertEnabled && state.trapLoadError) {
    return t("trapAlertsEnabledUnavailable");
  }

  if (state.trapAlertEnabled) {
    return tf("configureTrapAlertsAt", { distance: getConfiguredTrapAlertDistanceLabel() });
  }

  return t("tapToConfigureAlerts");
}

function syncAlertTriggerDiscovery() {
  const shouldHighlightTrigger = !state.alertTriggerDiscovered && elements.alertPanel.hidden;
  elements.alertTriggerHint.hidden = !shouldHighlightTrigger;
  elements.gaugeCard.classList.toggle("is-alert-discoverable", shouldHighlightTrigger);
}

function getAlertPanelStatusText(alertState) {
  if (alertState.over) {
    return alertState.source === "trap"
      ? tf("overTrapSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
      : tf("overSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
  }

  if (alertState.trapActive) {
    return alertState.trapSpeedLabel
      ? tf("trapAheadWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
      : tf("trapLabel", { distance: alertState.trapDistanceLabel });
  }

  if (alertState.manualEnabled) {
    return `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
  }

  if (state.trapAlertEnabled && state.trapLoadPending) {
    return t("loadingTrapData");
  }

  if (state.trapAlertEnabled && state.trapLoadError) {
    return t("trapDataUnavailable");
  }

  if (state.trapAlertEnabled) {
    return tf("trapAlertsSummary", { distance: getConfiguredTrapAlertDistanceLabel() });
  }

  return t("off");
}

function renderSubStatus() {
  const alertState = getAlertUiState();
  const isLiveStatus = state.lastFixAt > 0 && state.statusKind === "accuracy";

  if (!isLiveStatus) {
    elements.subStatus.textContent = state.statusText;
    return;
  }

  if (alertState.over) {
    elements.subStatus.textContent = alertState.source === "trap"
      ? tf("overTrapLimitBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
      : tf("overSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
    return;
  }

  if (alertState.trapActive) {
    elements.subStatus.textContent = alertState.trapSpeedLabel
      ? tf("trapAheadWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
      : tf("trapAhead", { distance: alertState.trapDistanceLabel });
    return;
  }

  if (alertState.manualEnabled) {
    elements.subStatus.textContent = tf("manualAlertAt", {
      limit: `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`,
    });
    return;
  }

  if (state.trapAlertEnabled && state.trapLoadPending) {
    elements.subStatus.textContent = t("loadingTrapData");
    return;
  }

  if (state.trapAlertEnabled && state.trapLoadError) {
    elements.subStatus.textContent = t("trapDataUnavailable");
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
  elements.alertToggle.textContent = isManualAlertActive() ? t("turnOff") : t("turnOn");
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

  for (const button of elements.backgroundAudioButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.backgroundAudio === "on") === state.backgroundAudioEnabled,
    ));
  }

  elements.gaugeCard.classList.toggle("is-alert-enabled", isManualAlertActive() || (state.trapAlertEnabled && isTrapDataReady()));
  elements.gaugeCard.classList.toggle("is-alert-near", alertState.near);
  elements.gaugeCard.classList.toggle("is-alert-over", alertState.over);
  elements.gaugeCard.classList.toggle("is-trap-active", alertState.trapActive);

  renderQuickAudioControls();
  syncAlertTriggerDiscovery();
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

function setAudioMuted(muted, { fromUserGesture = false } = {}) {
  state.audioMuted = muted;
  state.backgroundAudioRevision += 1;
  saveAudioMutedPreference(muted);

  if (muted) {
    state.backgroundAudioEnabled = false;
    saveBackgroundAudioEnabledPreference(false);
    disarmBackgroundAlertAudio();
    stopOverspeedSound();
    stopTrapSound();
  } else if (fromUserGesture) {
    if (state.backgroundAudioEnabled) {
      void armBackgroundAlertAudio();
    } else {
      void primeAlertAudio();
    }
  }

  renderAlertUi({ fromUserGesture });
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
    state.trapAlertDistanceM = getDefaultTrapAlertDistanceM(state.distanceUnit);
  }

  if (!enabled) {
    state.lastTrapSoundedId = null;
  }

  saveTrapAlertEnabledPreference(enabled);
  if (enabled) {
    ensureTrapArtifactsLoaded();
  }
  renderAlertUi(options);
  drawGauge();
}

function setTrapAlertDistance(distanceM, { enable = true, fromUserGesture = false } = {}) {
  state.trapAlertDistanceM = normalizeTrapAlertDistance(distanceM, state.distanceUnit);
  saveTrapAlertDistancePreference(state.trapAlertDistanceM);

  if (enable) {
    state.trapAlertEnabled = true;
    saveTrapAlertEnabledPreference(true);
    ensureTrapArtifactsLoaded();
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

function setBackgroundAudioEnabled(enabled, { fromUserGesture = false } = {}) {
  if (enabled && state.audioMuted) {
    state.audioMuted = false;
    saveAudioMutedPreference(false);
  }

  state.backgroundAudioEnabled = enabled;
  state.backgroundAudioRevision += 1;
  saveBackgroundAudioEnabledPreference(enabled);

  if (enabled) {
    if (fromUserGesture) {
      void armBackgroundAlertAudio();
    }
  } else {
    disarmBackgroundAlertAudio();
  }

  renderAlertUi({ fromUserGesture });
}

function openAlertPanel() {
  elements.alertPanel.hidden = false;
  if (!state.alertTriggerDiscovered) {
    state.alertTriggerDiscovered = true;
    saveAlertTriggerDiscoveredPreference(true);
  }
  renderAlertUi();
  document.body.classList.add("alert-panel-open");
  elements.alertPanel.scrollTop = 0;
  elements.alertTrigger.setAttribute("aria-expanded", "true");
}

function closeAlertPanel() {
  document.body.classList.remove("alert-panel-open");
  elements.alertPanel.hidden = true;
  elements.alertTrigger.setAttribute("aria-expanded", "false");
  syncAlertTriggerDiscovery();
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
  state.startTime = null;
  state.currentSpeedMs = 0;
  state.displayedSpeedMs = 0;
  state.maxSpeedMs = 0;
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
  state.lastPositionTimestamp = null;

  resetGlobe();
  hideNotice();
  closeAlertPanel();
  setStatus("requesting");
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
    setStatus("notSupported");
    showTranslatedNotice("noticeNoGeolocation");
    return;
  }

  stopTracking();
  state.trackingStartedAt = Date.now();
  setStatus("requesting");

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
  const normalizedTimestamp = normalizePositionTimestamp(position.timestamp);

  if (!Number.isFinite(state.startTime)) {
    state.startTime = normalizedTimestamp;
  }

  const coords = position.coords;
  const currentAccuracyM = Number.isFinite(coords.accuracy) ? coords.accuracy : null;
  const nextPoint = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    timestamp: normalizedTimestamp,
  };

  let speedMs = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null;

  if (state.lastPoint) {
    const elapsedSeconds = Math.max((nextPoint.timestamp - state.lastPoint.timestamp) / 1000, 0.25);
    const distanceM = haversineDistance(state.lastPoint, nextPoint);
    const fallbackSpeedMs = distanceM / elapsedSeconds;
    const plausibleDistanceM = elapsedSeconds * MAX_PLAUSIBLE_SPEED_MS;
    const movementThresholdM = getMovementThresholdM(currentAccuracyM, state.lastAccuracyM);
    const hasReportedMotion = Number.isFinite(speedMs) && speedMs >= MIN_MOVING_SPEED_MS;
    const hasMeaningfulMovement =
      distanceM >= movementThresholdM
      && fallbackSpeedMs >= MIN_MOVING_SPEED_MS;

    // Keep tiny GPS wander from counting as travel unless it also looks like real motion.
    if (distanceM <= plausibleDistanceM && (hasReportedMotion || hasMeaningfulMovement)) {
      state.totalDistanceM += distanceM;
      if (speedMs === null) {
        speedMs = fallbackSpeedMs;
      }
      state.lastPoint = nextPoint;
    }
  } else {
    state.lastPoint = nextPoint;
  }

  if (!Number.isFinite(speedMs) || speedMs < 0) speedMs = 0;

  state.recentSpeeds.push(speedMs);
  if (state.recentSpeeds.length > SPEED_SMOOTHING_SAMPLES) {
    state.recentSpeeds.shift();
  }

  state.currentSpeedMs =
    state.recentSpeeds.reduce((sum, sample) => sum + sample, 0) / state.recentSpeeds.length;
  state.maxSpeedMs = Math.max(state.maxSpeedMs, state.currentSpeedMs);
  state.lastAccuracyM = currentAccuracyM;
  state.lastFixAt = Date.now();
  state.lastPositionTimestamp = normalizedTimestamp;

  updateNearestTrap(coords.longitude, coords.latitude);
  syncGlobePosition(coords.longitude, coords.latitude);

  if (Number.isFinite(coords.altitude)) {
    state.currentAltitudeM = coords.altitude;
    state.maxAltitudeM = state.maxAltitudeM === null
      ? coords.altitude
      : Math.max(state.maxAltitudeM, coords.altitude);
    state.minAltitudeM = state.minAltitudeM === null
      ? coords.altitude
      : Math.min(state.minAltitudeM, coords.altitude);
  }

  setStatus("accuracy", { accuracyM: coords.accuracy });
  renderMetrics();
}

function handlePositionError(error) {
  if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) {
    stopTracking();
    setStatus("blocked");
    showTranslatedNotice("noticeLocationRequired");
    return;
  }

  if (error.code === GEO_ERROR_CODE.POSITION_UNAVAILABLE) {
    setStatus("unavailable");
    showTranslatedNotice("noticeSignalUnavailable");
    return;
  }

  if (error.code === GEO_ERROR_CODE.TIMEOUT) {
    setStatus("waiting");
    showTranslatedNotice("noticeStillWaiting");
    return;
  }

  setStatus("error");
  showNotice(error.message || t("gpsError"));
}

function resizeCanvas() {
  const rect = elements.dialCanvas.getBoundingClientRect();
  const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
  const dpr = window.devicePixelRatio || 1;

  if (size === state.canvasSize && elements.dialCanvas.width === Math.floor(size * dpr)) {
    resizeGlobe();
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
  resizeGlobe();
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
  elements.durationValue.textContent = formatDuration(
    Number.isFinite(state.startTime) ? Date.now() - state.startTime : 0,
  );
  elements.altitudeValue.textContent = formatAltitude(state.currentAltitudeM);
  elements.altitudeUnit.textContent = distanceUnitLabel;
  elements.maxAltitude.textContent = formatAltitude(state.maxAltitudeM);
  elements.maxAltitudeUnit.textContent = distanceUnitLabel;
  elements.minAltitude.textContent = formatAltitude(state.minAltitudeM);
  elements.minAltitudeUnit.textContent = distanceUnitLabel;
  renderAlertUi();
}

function syncLanguage() {
  applyTranslations();
  updatePageMeta();
  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }

  state.statusText = getStatusText(state.statusKind, state.statusParams);
  elements.status.textContent = state.statusText;

  if (!elements.notice.hidden && state.noticeKey) {
    elements.noticeText.textContent = tf(state.noticeKey, state.noticeParams ?? {});
  }

  renderGlobeStatus();
  renderMetrics();
  drawGauge();
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

  if (!state.lastFixAt && Date.now() - state.trackingStartedAt > 9000 && elements.notice.hidden) {
    showTranslatedNotice("noticeStillLookingFirstFix");
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
  elements.langToggle?.addEventListener("click", () => {
    toggleLang();
  });
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

  elements.quickAudioToggle?.addEventListener("click", () => {
    setAudioMuted(!state.audioMuted, { fromUserGesture: true });
  });

  elements.quickBackgroundAudioToggle?.addEventListener("click", () => {
    setBackgroundAudioEnabled(!state.backgroundAudioEnabled, { fromUserGesture: true });
  });

  for (const button of elements.backgroundAudioButtons) {
    button.addEventListener("click", () => {
      setBackgroundAudioEnabled(button.dataset.backgroundAudio === "on", { fromUserGesture: true });
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
    ensureTrapArtifactsLoaded();
    resizeCanvas();
    if (state.watchId === null) startTracking();
    startRenderLoop();
    if (state.backgroundAudioEnabled && !state.audioMuted) {
      void armBackgroundAlertAudio();
    }
    syncOverspeedSound();
    syncTrapSound();
  });
  document.addEventListener("pointerdown", (event) => {
    if (state.backgroundAudioEnabled && !state.audioMuted) {
      void armBackgroundAlertAudio();
    } else if (!state.audioMuted) {
      void primeAlertAudio();
    }
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
    if (state.backgroundAudioEnabled && !state.audioMuted) {
      void armBackgroundAlertAudio();
    } else if (!state.audioMuted) {
      void primeAlertAudio();
    }
    syncOverspeedSound({ fromUserGesture: true });
    syncTrapSound({ fromUserGesture: true });
    if (event.key === "Escape") closeAlertPanel();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRenderLoop();
      return;
    }

    resizeCanvas();
    ensureTrapArtifactsLoaded();
    startRenderLoop();
    if (state.backgroundAudioEnabled && !state.audioMuted) {
      void armBackgroundAlertAudio();
    }
    syncOverspeedSound();
    syncTrapSound();
  });
  document.addEventListener("i18n:change", syncLanguage);
}

function init() {
  document.body.classList.remove("alert-panel-open");
  updatePageMeta();

  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }

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

  for (const button of elements.backgroundAudioButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.backgroundAudio === "on") === state.backgroundAudioEnabled,
    ));
  }

  renderMetrics();
  initGlobe();
  resizeCanvas();
  bindEvents();
  loadTrapArtifacts();
  startTracking();
  startRenderLoop();
}

init();
