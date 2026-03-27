import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/speed.less";
import maplibregl from "maplibre-gl";
import KDBush from "kdbush";
import { around as geoAround, distance as geoDistanceKm } from "geokdbush";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import { createAnalogSpeedometer } from "../shared/analog-speedometer.js";
import { initSupportPanel } from "../shared/support-panel.js";
import { loadBoolean, loadNumber, loadText, saveBoolean, saveNumber, saveText } from "../shared/storage.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import { IconAccel, IconBoard, IconGpsLab } from "../icons.js";

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
const STORAGE_PRIMARY_VIEW_KEY = "vatio_speed_primary_view";
const OVERSPEED_SOUND_URL = "/audio/overspeed_notification.m4a";
const TRAP_SOUND_URL = "/audio/near_camera_notification.m4a";
const TRAP_DATA_URL = "/geo/ansv_cameras_compact.min.json";
const TRAP_INDEX_URL = "/geo/ansv_cameras_compact.kdbush";
const SPEED_APP_NAME = "Vatio Speed";
const RUNTIME_ARTWORK_SIZE = 512;
const MEDIA_METADATA_MIN_UPDATE_INTERVAL_MS = 1000;
const BACKGROUND_KEEPALIVE_SAMPLE_RATE = 22050;
const BACKGROUND_KEEPALIVE_DURATION_SECONDS = 2;
const GLOBE_DEFAULT_CENTER = [137.9150899566626, 36.25956997955441];
const GLOBE_DEFAULT_ZOOM = 0.15;
const GLOBE_FOLLOW_ZOOM = 0.8;
const GLOBE_FOLLOW_RESUME_DELAY_MS = 12000;
const GLOBE_SOURCE_ID = "live-position";
const GLOBE_TERMINATOR_SOURCE_ID = "solar-terminator";
const GLOBE_NIGHT_SOURCE_ID = "solar-night";
const GLOBE_SOLAR_UPDATE_INTERVAL_MS = 60000;
const GLOBE_RASTER_BRIGHTNESS_MIN = 0.2;
const GLOBE_RASTER_CONTRAST = 0.14;
const GLOBE_SKY_COLOR = "#e6f2ff";
const GLOBE_HORIZON_COLOR = "#ffffff";
const GLOBE_SKY_HORIZON_BLEND = 0.28;
const GLOBE_NIGHT_POLYGON_STEPS = 180;
const GLOBE_NIGHT_CAPS = [
  { altitude: -1, opacity: 0.08, color: "#10233a" },
  { altitude: -6, opacity: 0.12, color: "#0a1525" },
  { altitude: -12, opacity: 0.18, color: "#050d18" },
  { altitude: -18, opacity: 0.24, color: "#020711" },
];
const GLOBE_SATELLITE_ATTRIBUTION = [
  '<a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless</a>',
  'by',
  '<a href="https://eox.at" target="_blank" rel="noopener noreferrer">EOX IT Services GmbH</a>',
  '(Contains modified Copernicus Sentinel data 2020)',
].join(" ");
const WAZE_EMBED_BASE_URL = "https://embed.waze.com/iframe";
const WAZE_REFRESH_MIN_INTERVAL_MS = 300000;
const WAZE_REFRESH_MIN_DISTANCE_M = 300;
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
  toolsMenuBtn: document.getElementById("speedToolsMenuBtn"),
  toolsMenuList: document.getElementById("speedToolsMenuList"),
  openAccelMenu: document.getElementById("openSpeedAccelMenu"),
  openGpsLabMenu: document.getElementById("openSpeedGpsLabMenu"),
  openBoardMenu: document.getElementById("openSpeedBoardMenu"),
  primaryViewButtons: Array.from(document.querySelectorAll(".speed-view-btn")),
  speedPrimaryStage: document.getElementById("speedPrimaryStage"),
  gaugeStage: document.getElementById("gaugeStage"),
  gaugeStageInner: document.querySelector(".gauge-stage-inner"),
  wazeStage: document.getElementById("wazeStage"),
  wazeFrame: document.getElementById("wazeFrame"),
  wazePlaceholder: document.getElementById("wazePlaceholder"),
  wazePlaceholderText: document.getElementById("wazePlaceholderText"),
  wazeSpeedPill: document.getElementById("wazeSpeedPill"),
  wazeSpeedValue: document.getElementById("wazeSpeedValue"),
  wazeSpeedUnit: document.getElementById("wazeSpeedUnit"),
  wazeSpeedLimitLabel: document.getElementById("wazeSpeedLimitLabel"),
  wazeSpeedLimitValue: document.getElementById("wazeSpeedLimitValue"),
  wazeSpeedNote: document.getElementById("wazeSpeedNote"),
  wazeLocationPrompt: document.getElementById("wazeLocationPrompt"),
  wazeRecenter: document.getElementById("wazeRecenter"),
  alertBackdrop: document.getElementById("speedAlertBackdrop"),
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

const toolsMenu = initToolsMenu({
  button: elements.toolsMenuBtn,
  list: elements.toolsMenuList,
});
initSupportPanel();

applyButtonIcon(elements.openAccelMenu, IconAccel);
applyButtonIcon(elements.openGpsLabMenu, IconGpsLab);
applyButtonIcon(elements.openBoardMenu, IconBoard);

function bindMenuNavigation(element, href) {
  if (!element) return;
  element.addEventListener("click", () => {
    toolsMenu.close();
    window.location.href = href;
  });
}

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

const analogSpeedometer = createAnalogSpeedometer({
  stageElement: elements.gaugeStage,
  stageInnerElement: elements.gaugeStageInner,
  dialCanvas: elements.dialCanvas,
  needleCanvas: elements.needleCanvas,
  valueElement: elements.speedValue,
  unitElement: elements.speedUnit,
  substatusElement: elements.subStatus,
  resizeTarget: elements.speedPrimaryStage,
  styleSourceElement: elements.gaugeStage,
});
const overspeedAudio = new Audio(OVERSPEED_SOUND_URL);
overspeedAudio.loop = true;
overspeedAudio.preload = "auto";
overspeedAudio.playsInline = true;
const trapAlertAudio = new Audio(TRAP_SOUND_URL);
trapAlertAudio.loop = false;
trapAlertAudio.preload = "auto";
trapAlertAudio.playsInline = true;
trapAlertAudio.addEventListener("ended", () => {
  state.trapSoundPending = false;
  state.trapAudible = false;
  state.trapSoundDeadlineAt = 0;
});
let backgroundKeepAliveAudioUrl = createSilentLoopAudioUrl();
const backgroundKeepAliveAudio = new Audio(backgroundKeepAliveAudioUrl);
backgroundKeepAliveAudio.loop = true;
backgroundKeepAliveAudio.preload = "auto";
backgroundKeepAliveAudio.playsInline = true;
let trapLoadPromise = null;
let audioPrimePromise = null;
const pageDescriptionMeta = document.querySelector('meta[name="description"]');
const MEDIA_SESSION_FALLBACK_ARTWORK = [
  { src: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
  { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  { src: "/img/vatio-board-speed-og-1200x630.jpg", sizes: "1200x630", type: "image/jpeg" },
];

const initialUnit = loadUnitPreference();
const initialDistanceUnit = loadDistanceUnitPreference();
const initialPrimaryView = loadPrimaryViewPreference();

const state = {
  unit: initialUnit,
  distanceUnit: initialDistanceUnit,
  primaryView: initialPrimaryView,
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
  backgroundAudioSuppressed: false,
  overspeedSoundRequestId: 0,
  alertSoundBlocked: false,
  alertSoundPending: false,
  overspeedAudible: false,
  trapAlertEnabled: loadTrapAlertEnabledPreference(),
  trapAlertDistanceM: loadTrapAlertDistancePreference(initialDistanceUnit),
  trapSoundEnabled: loadTrapSoundEnabledPreference(),
  alertTriggerDiscovered: loadAlertTriggerDiscoveredPreference(),
  trapSoundRequestId: 0,
  trapSoundBlocked: false,
  trapSoundPending: false,
  trapAudible: false,
  trapSoundDeadlineAt: 0,
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
  lastKnownLatitude: null,
  lastKnownLongitude: null,
  renderFrameId: null,
  lastTextUpdateAt: 0,
  canvasSize: 0,
  gaugeStageSize: 0,
  wazeLoaded: false,
  wazeLoadPending: false,
  wazeCenteredAt: null,
  wazeCenterLatitude: null,
  wazeCenterLongitude: null,
  globeMap: null,
  globeReady: false,
  globeError: null,
  gaugeResizeObserver: null,
  globeResizeObserver: null,
  globeCenter: null,
  globeFollowPausedUntil: 0,
  globeFollowResumeTimeoutId: null,
  globeSolarUpdateIntervalId: null,
  globeSolarSyncFrameId: null,
  globeSolarGeometryDirty: false,
  runtimePageTitle: "",
  runtimeArtworkSignature: "",
  runtimeArtworkDataUrl: "",
  runtimeDynamicArtworkBlocked: false,
  runtimeMediaMetadataSignature: "",
  runtimeMediaMetadataUrgencySignature: "",
  runtimeMediaMetadataUpdatedAt: 0,
  runtimeMediaPlaybackState: "",
};

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function toDegrees(radians) {
  return radians * (180 / Math.PI);
}

function normalizeDegrees360(value) {
  return ((value % 360) + 360) % 360;
}

function normalizeDegrees180(value) {
  const normalized = normalizeDegrees360(value);
  return normalized > 180 ? normalized - 360 : normalized;
}

function normalizeDegreesNear(value, reference) {
  return reference + normalizeDegrees180(value - reference);
}

function dotVector3(a, b) {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function crossVector3(a, b) {
  return [
    (a[1] * b[2]) - (a[2] * b[1]),
    (a[2] * b[0]) - (a[0] * b[2]),
    (a[0] * b[1]) - (a[1] * b[0]),
  ];
}

function normalizeVector3(vector) {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return null;
  }

  return [
    vector[0] / magnitude,
    vector[1] / magnitude,
    vector[2] / magnitude,
  ];
}

function lngLatToUnitVector(longitude, latitude) {
  const longitudeRad = toRadians(longitude);
  const latitudeRad = toRadians(latitude);
  const cosLatitude = Math.cos(latitudeRad);

  return [
    Math.sin(longitudeRad) * cosLatitude,
    Math.sin(latitudeRad),
    Math.cos(longitudeRad) * cosLatitude,
  ];
}

function unitVectorToLngLat(vector) {
  const normalized = normalizeVector3(vector);
  if (!normalized) {
    return [0, 0];
  }

  return [
    normalizeDegrees180(toDegrees(Math.atan2(normalized[0], normalized[2]))),
    toDegrees(Math.asin(clampNumber(normalized[1], -1, 1))),
  ];
}

function getSunVectorAtTime(timestamp = Date.now()) {
  const julianDay = (timestamp / 86400000) + 2440587.5;
  const julianCentury = (julianDay - 2451545) / 36525;
  const meanLongitude = normalizeDegrees360(
    280.46646 + (julianCentury * (36000.76983 + (julianCentury * 0.0003032))),
  );
  const meanAnomaly = normalizeDegrees360(
    357.52911 + (julianCentury * (35999.05029 - (0.0001537 * julianCentury))),
  );
  const equationOfCenter =
    (Math.sin(toRadians(meanAnomaly)) * (1.914602 - (julianCentury * (0.004817 + (0.000014 * julianCentury)))))
    + (Math.sin(toRadians(2 * meanAnomaly)) * (0.019993 - (0.000101 * julianCentury)))
    + (Math.sin(toRadians(3 * meanAnomaly)) * 0.000289);
  const trueLongitude = meanLongitude + equationOfCenter;
  const omega = 125.04 - (1934.136 * julianCentury);
  const apparentLongitude = trueLongitude - 0.00569 - (0.00478 * Math.sin(toRadians(omega)));
  const meanObliquity =
    23
    + ((26 + ((21.448 - (julianCentury * (46.815 + (julianCentury * (0.00059 - (0.001813 * julianCentury)))))) / 60)) / 60);
  const trueObliquity = meanObliquity + (0.00256 * Math.cos(toRadians(omega)));
  const apparentLongitudeRad = toRadians(apparentLongitude);
  const trueObliquityRad = toRadians(trueObliquity);
  const rightAscension = normalizeDegrees360(toDegrees(
    Math.atan2(
      Math.cos(trueObliquityRad) * Math.sin(apparentLongitudeRad),
      Math.cos(apparentLongitudeRad),
    ),
  ));
  const declination = toDegrees(Math.asin(
    Math.sin(trueObliquityRad) * Math.sin(apparentLongitudeRad),
  ));
  const greenwichSiderealTime = normalizeDegrees360(
    280.46061837
    + (360.98564736629 * (julianDay - 2451545))
    + (0.000387933 * (julianCentury ** 2))
    - ((julianCentury ** 3) / 38710000),
  );
  const subsolarLongitude = normalizeDegrees180(rightAscension - greenwichSiderealTime);

  return {
    declination,
    subsolarLongitude,
    vector: lngLatToUnitVector(subsolarLongitude, declination),
  };
}

function getEmptyGlobeFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function getSolarReferenceFrame(sunVector) {
  const referenceVector = Math.abs(sunVector[1]) < 0.99
    ? [0, 1, 0]
    : [1, 0, 0];
  const axisA = normalizeVector3(crossVector3(sunVector, referenceVector));
  const axisB = axisA ? normalizeVector3(crossVector3(sunVector, axisA)) : null;

  if (!axisA || !axisB) {
    return null;
  }

  return { axisA, axisB };
}

function getSolarTerminatorData(sunVector) {
  const solarReferenceFrame = getSolarReferenceFrame(sunVector);

  if (!solarReferenceFrame) {
    return getEmptyGlobeFeatureCollection();
  }

  const { axisA, axisB } = solarReferenceFrame;
  const coordinates = [];
  let segment = [];
  let previousLongitude = null;

  for (let step = 0; step <= 360; step += 1) {
    const angle = (step / 360) * (Math.PI * 2);
    const point = [
      (axisA[0] * Math.cos(angle)) + (axisB[0] * Math.sin(angle)),
      (axisA[1] * Math.cos(angle)) + (axisB[1] * Math.sin(angle)),
      (axisA[2] * Math.cos(angle)) + (axisB[2] * Math.sin(angle)),
    ];
    const [pointLongitude, pointLatitude] = unitVectorToLngLat(point);

    if (
      segment.length > 0
      && previousLongitude !== null
      && Math.abs(pointLongitude - previousLongitude) > 180
    ) {
      if (segment.length > 1) {
        coordinates.push(segment);
      }
      segment = [];
    }

    segment.push([pointLongitude, pointLatitude]);
    previousLongitude = pointLongitude;
  }

  if (segment.length > 1) {
    coordinates.push(segment);
  }

  return {
    type: "FeatureCollection",
    features: coordinates.length > 0
      ? [
        {
          type: "Feature",
          geometry: {
            type: "MultiLineString",
            coordinates,
          },
        },
      ]
      : [],
  };
}

function getSolarNightCapRing(sunVector, altitude) {
  const solarReferenceFrame = getSolarReferenceFrame(sunVector);
  if (!solarReferenceFrame) {
    return null;
  }

  const antiSolarVector = [-sunVector[0], -sunVector[1], -sunVector[2]];
  const [antiSolarLongitude] = unitVectorToLngLat(antiSolarVector);
  const level = clampNumber(Math.sin(toRadians(altitude)), -0.999999, 0.999999);
  const circleRadius = Math.sqrt(Math.max(0, 1 - (level * level)));
  const circleCenter = [
    sunVector[0] * level,
    sunVector[1] * level,
    sunVector[2] * level,
  ];
  const { axisA, axisB } = solarReferenceFrame;
  const ring = [];

  for (let step = 0; step <= GLOBE_NIGHT_POLYGON_STEPS; step += 1) {
    const angle = (step / GLOBE_NIGHT_POLYGON_STEPS) * (Math.PI * 2);
    const point = [
      circleCenter[0] + (circleRadius * ((axisA[0] * Math.cos(angle)) + (axisB[0] * Math.sin(angle)))),
      circleCenter[1] + (circleRadius * ((axisA[1] * Math.cos(angle)) + (axisB[1] * Math.sin(angle)))),
      circleCenter[2] + (circleRadius * ((axisA[2] * Math.cos(angle)) + (axisB[2] * Math.sin(angle)))),
    ];
    const [pointLongitude, pointLatitude] = unitVectorToLngLat(point);
    ring.push([normalizeDegreesNear(pointLongitude, antiSolarLongitude), pointLatitude]);
  }

  return ring;
}

function getSolarNightData(sunVector) {
  const features = [];

  for (let index = 0; index < GLOBE_NIGHT_CAPS.length; index += 1) {
    const nightCap = GLOBE_NIGHT_CAPS[index];
    const ring = getSolarNightCapRing(sunVector, nightCap.altitude);

    if (!ring || ring.length < 4) {
      continue;
    }

    features.push({
      type: "Feature",
      properties: {
        color: nightCap.color,
        opacity: nightCap.opacity,
        sortKey: index,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function tf(key, values = {}) {
  return t(key).replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? ""));
}

function capitalizeText(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function truncateText(value, maxLength = 32) {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;
}

function escapeSvgText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function supportsMediaSession() {
  return "mediaSession" in navigator;
}

function supportsMediaMetadata() {
  return supportsMediaSession() && typeof window.MediaMetadata === "function";
}

function getRuntimeSpeedLabel() {
  return `${Math.round(convertSpeed(state.currentSpeedMs))} ${UNIT_CONFIG[state.unit].label}`;
}

function getRuntimeTripLabel() {
  const distance = getDistanceDisplay(state.totalDistanceM);
  return `${capitalizeText(t("trip"))} ${distance.value} ${distance.unit}`;
}

function getRuntimeBackgroundAudioLabel() {
  return `${t("backgroundAudio")}: ${state.backgroundAudioEnabled ? t("on") : t("off")}`;
}

function getRuntimeArtworkStatusBadgeText() {
  return state.statusKind === "accuracy" && state.lastFixAt > 0
    ? t("gpsLive")
    : state.statusText;
}

function getRuntimeArtworkAlertValue(alertState = getAlertUiState()) {
  if (alertState.trapActive) {
    return alertState.trapSpeedLabel
      ? `${alertState.trapDistanceLabel} / ${alertState.trapSpeedLabel}`
      : alertState.trapDistanceLabel;
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
    return getConfiguredTrapAlertDistanceLabel();
  }

  return t("off");
}

function getCriticalAlertText(alertState = getAlertUiState()) {
  if (alertState.over) {
    return alertState.source === "trap"
      ? tf("overTrapLimitBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
      : tf("overSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
  }

  if (alertState.trapActive) {
    return alertState.trapSpeedLabel
      ? tf("trapAheadWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
      : tf("trapAhead", { distance: alertState.trapDistanceLabel });
  }

  return "";
}

function getSubStatusText(alertState = getAlertUiState()) {
  const isLiveStatus = state.lastFixAt > 0 && state.statusKind === "accuracy";

  if (!isLiveStatus) {
    return state.statusText;
  }

  if (alertState.over) {
    return alertState.source === "trap"
      ? tf("overTrapLimitBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
      : tf("overSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
  }

  if (alertState.trapActive) {
    return alertState.trapSpeedLabel
      ? tf("trapAheadWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
      : tf("trapAhead", { distance: alertState.trapDistanceLabel });
  }

  if (alertState.manualEnabled) {
    return tf("manualAlertAt", {
      limit: `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`,
    });
  }

  if (state.trapAlertEnabled && state.trapLoadPending) {
    return t("loadingTrapData");
  }

  if (state.trapAlertEnabled && state.trapLoadError) {
    return t("trapDataUnavailable");
  }

  return state.statusText;
}

function getRuntimeMediaTitle(alertState = getAlertUiState()) {
  if (state.lastFixAt <= 0) {
    return state.statusText;
  }

  const speedLabel = getRuntimeSpeedLabel();
  const criticalAlertText = getCriticalAlertText(alertState);
  return criticalAlertText ? `${speedLabel} · ${criticalAlertText}` : speedLabel;
}

function getRuntimeMediaArtist(alertState = getAlertUiState()) {
  if (state.lastFixAt <= 0) {
    return getRuntimeBackgroundAudioLabel();
  }

  if (alertState.over || alertState.trapActive) {
    return state.statusText;
  }

  return getSubStatusText(alertState);
}

function getRuntimeMediaAlbum() {
  if (state.lastFixAt <= 0) {
    return SPEED_APP_NAME;
  }

  return `${SPEED_APP_NAME} · ${getRuntimeTripLabel()}`;
}

function getRuntimePageTitle(alertState = getAlertUiState()) {
  const title = getRuntimeMediaTitle(alertState);
  return title ? `${title} | ${SPEED_APP_NAME}` : t("speedPageTitle");
}

function getRuntimeMediaPlaybackState() {
  if (!backgroundKeepAliveAudio.paused || !overspeedAudio.paused || !trapAlertAudio.paused) {
    return "playing";
  }

  if (
    state.backgroundAudioEnabled
    || state.backgroundAudioArmPending
    || state.alertSoundPending
    || state.trapSoundPending
  ) {
    return "paused";
  }

  return "none";
}

function getRuntimeArtworkPalette(alertState = getAlertUiState()) {
  if (alertState.over) {
    return {
      bgStart: "#21080d",
      bgEnd: "#4a1017",
      accent: "#ff7b63",
      accentSoft: "#ffb39f",
      panel: "rgba(26, 10, 13, 0.78)",
      panelBorder: "rgba(255, 176, 158, 0.22)",
      text: "#fff4f1",
      muted: "#f8c8be",
      chip: "rgba(255, 123, 99, 0.16)",
      chipBorder: "rgba(255, 123, 99, 0.34)",
    };
  }

  if (alertState.trapActive) {
    return {
      bgStart: "#1c1406",
      bgEnd: "#4f3108",
      accent: "#f6c453",
      accentSoft: "#ffe29e",
      panel: "rgba(24, 18, 8, 0.78)",
      panelBorder: "rgba(246, 196, 83, 0.22)",
      text: "#fff9eb",
      muted: "#f5dfad",
      chip: "rgba(246, 196, 83, 0.14)",
      chipBorder: "rgba(246, 196, 83, 0.28)",
    };
  }

  return {
    bgStart: "#081421",
    bgEnd: "#163854",
    accent: "#63e6be",
    accentSoft: "#93c5fd",
    panel: "rgba(8, 19, 33, 0.72)",
    panelBorder: "rgba(147, 197, 253, 0.16)",
    text: "#f8fbff",
    muted: "#bfd5ea",
    chip: "rgba(99, 230, 190, 0.12)",
    chipBorder: "rgba(147, 197, 253, 0.24)",
  };
}

function buildRuntimeArtworkModel(alertState = getAlertUiState()) {
  const speedValue = String(Math.round(convertSpeed(state.currentSpeedMs)));
  const criticalAlertText = getCriticalAlertText(alertState);
  const sectionLabel = criticalAlertText ? t("alerts") : getRuntimeArtworkStatusBadgeText();
  const primaryLine = criticalAlertText || getSubStatusText(alertState);
  const tripDistance = getDistanceDisplay(state.totalDistanceM);

  return {
    speedValue,
    unitLabel: UNIT_CONFIG[state.unit].label,
    statusBadge: truncateText(getRuntimeArtworkStatusBadgeText(), 24),
    sectionLabel: truncateText(sectionLabel, 24),
    primaryLine: truncateText(primaryLine || state.statusText, 42),
    tripLabel: capitalizeText(t("trip")),
    tripValue: truncateText(`${tripDistance.value} ${tripDistance.unit}`, 16),
    alertLabel: t("alerts"),
    alertValue: truncateText(getRuntimeArtworkAlertValue(alertState), 22),
    backgroundLabel: t("backgroundCompact"),
    backgroundValue: truncateText(state.backgroundAudioEnabled ? t("on") : t("off"), 12),
    palette: getRuntimeArtworkPalette(alertState),
  };
}

function createRuntimeArtworkDataUrl(alertState = getAlertUiState()) {
  const model = buildRuntimeArtworkModel(alertState);
  const {
    speedValue,
    unitLabel,
    statusBadge,
    sectionLabel,
    primaryLine,
    tripLabel,
    tripValue,
    alertLabel,
    alertValue,
    backgroundLabel,
    backgroundValue,
    palette,
  } = model;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${RUNTIME_ARTWORK_SIZE}" height="${RUNTIME_ARTWORK_SIZE}" viewBox="0 0 512 512" role="img" aria-label="${escapeSvgText(SPEED_APP_NAME)}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bgStart}" />
      <stop offset="100%" stop-color="${palette.bgEnd}" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.accent}" />
      <stop offset="100%" stop-color="${palette.accentSoft}" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="rgba(0,0,0,0.22)" />
    </filter>
  </defs>
  <rect width="512" height="512" rx="44" fill="url(#bg)" />
  <circle cx="420" cy="96" r="94" fill="${palette.accent}" opacity="0.12" />
  <circle cx="458" cy="66" r="54" fill="${palette.accentSoft}" opacity="0.12" />
  <rect x="28" y="28" width="456" height="456" rx="34" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />

  <text x="48" y="62" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" letter-spacing="2">VATIO SPEED</text>
  <g filter="url(#shadow)">
    <rect x="356" y="38" width="108" height="34" rx="17" fill="${palette.chip}" stroke="${palette.chipBorder}" />
  </g>
  <text x="410" y="60" text-anchor="middle" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700">${escapeSvgText(statusBadge)}</text>

  <text x="48" y="116" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" letter-spacing="2">${escapeSvgText(t("speed"))}</text>
  <text x="48" y="248" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="170" font-weight="700">${escapeSvgText(speedValue)}</text>
  <text x="344" y="248" fill="${palette.accentSoft}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700">${escapeSvgText(unitLabel)}</text>

  <g filter="url(#shadow)">
    <rect x="40" y="284" width="432" height="100" rx="28" fill="${palette.panel}" stroke="${palette.panelBorder}" />
  </g>
  <text x="64" y="318" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" letter-spacing="1.5">${escapeSvgText(sectionLabel)}</text>
  <text x="64" y="356" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700">${escapeSvgText(primaryLine)}</text>

  <g filter="url(#shadow)">
    <rect x="40" y="404" width="132" height="72" rx="22" fill="${palette.chip}" stroke="${palette.chipBorder}" />
    <rect x="190" y="404" width="132" height="72" rx="22" fill="${palette.chip}" stroke="${palette.chipBorder}" />
    <rect x="340" y="404" width="132" height="72" rx="22" fill="${palette.chip}" stroke="${palette.chipBorder}" />
  </g>

  <text x="58" y="430" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">${escapeSvgText(tripLabel)}</text>
  <text x="58" y="460" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeSvgText(tripValue)}</text>

  <text x="208" y="430" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">${escapeSvgText(alertLabel)}</text>
  <text x="208" y="460" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">${escapeSvgText(alertValue)}</text>

  <text x="358" y="430" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">${escapeSvgText(backgroundLabel)}</text>
  <text x="358" y="460" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeSvgText(backgroundValue)}</text>
</svg>`.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getRuntimeArtworkSignature(alertState = getAlertUiState()) {
  const model = buildRuntimeArtworkModel(alertState);
  return JSON.stringify([
    model.speedValue,
    model.unitLabel,
    model.statusBadge,
    model.sectionLabel,
    model.primaryLine,
    model.tripValue,
    model.alertValue,
    model.backgroundValue,
    model.palette.bgStart,
    model.palette.bgEnd,
    model.palette.accent,
  ]);
}

function getRuntimeMediaArtwork(alertState = getAlertUiState()) {
  const artworkSignature = getRuntimeArtworkSignature(alertState);

  if (state.runtimeArtworkSignature !== artworkSignature || !state.runtimeArtworkDataUrl) {
    state.runtimeArtworkDataUrl = createRuntimeArtworkDataUrl(alertState);
    state.runtimeArtworkSignature = artworkSignature;
  }

  return [
    {
      src: state.runtimeArtworkDataUrl,
      sizes: `${RUNTIME_ARTWORK_SIZE}x${RUNTIME_ARTWORK_SIZE}`,
      type: "image/svg+xml",
    },
    ...MEDIA_SESSION_FALLBACK_ARTWORK,
  ];
}

function syncRuntimePagePresentation() {
  const alertState = getAlertUiState();
  const nextPageTitle = getRuntimePageTitle(alertState);

  if (state.runtimePageTitle !== nextPageTitle) {
    document.title = nextPageTitle;
    state.runtimePageTitle = nextPageTitle;
  }

  if (!supportsMediaSession()) {
    return;
  }

  const nextPlaybackState = getRuntimeMediaPlaybackState();
  if (state.runtimeMediaPlaybackState !== nextPlaybackState) {
    try {
      navigator.mediaSession.playbackState = nextPlaybackState;
    } catch {
      // Some embedded browsers expose mediaSession but reject playback state updates.
    }
    state.runtimeMediaPlaybackState = nextPlaybackState;
  }

  if (!supportsMediaMetadata()) {
    return;
  }

  const artworkSignature = state.runtimeDynamicArtworkBlocked
    ? "fallback-artwork"
    : getRuntimeArtworkSignature(alertState);
  const metadataTitle = getRuntimeMediaTitle(alertState);
  const metadataArtist = getRuntimeMediaArtist(alertState);
  const metadataAlbum = getRuntimeMediaAlbum();
  const metadataSignature = JSON.stringify([
    metadataTitle,
    metadataArtist,
    metadataAlbum,
    artworkSignature,
  ]);
  const metadataUrgencySignature = JSON.stringify([
    state.statusKind,
    state.audioMuted,
    state.backgroundAudioEnabled,
    state.lastFixAt > 0,
    alertState.source,
    alertState.over,
    alertState.trapActive,
  ]);
  const now = Date.now();

  if (state.runtimeMediaMetadataSignature === metadataSignature) {
    return;
  }

  if (
    state.runtimeMediaMetadataUpdatedAt > 0
    && (now - state.runtimeMediaMetadataUpdatedAt) < MEDIA_METADATA_MIN_UPDATE_INTERVAL_MS
    && state.runtimeMediaMetadataUrgencySignature === metadataUrgencySignature
  ) {
    return;
  }

  const metadataInit = {
    title: metadataTitle,
    artist: metadataArtist,
    album: metadataAlbum,
    artwork: state.runtimeDynamicArtworkBlocked
      ? MEDIA_SESSION_FALLBACK_ARTWORK
      : getRuntimeMediaArtwork(alertState),
  };

  try {
    navigator.mediaSession.metadata = new window.MediaMetadata(metadataInit);
  } catch {
    if (!state.runtimeDynamicArtworkBlocked) {
      state.runtimeDynamicArtworkBlocked = true;
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          ...metadataInit,
          artwork: MEDIA_SESSION_FALLBACK_ARTWORK,
        });
      } catch {
        // Ignore browsers that reject metadata construction.
      }
    }
  }
  state.runtimeMediaMetadataSignature = metadataSignature;
  state.runtimeMediaMetadataUrgencySignature = metadataUrgencySignature;
  state.runtimeMediaMetadataUpdatedAt = now;
}

function setMediaSessionActionHandler(action, handler) {
  if (!supportsMediaSession() || typeof navigator.mediaSession.setActionHandler !== "function") {
    return;
  }

  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Ignore unsupported actions on partial Media Session implementations.
  }
}

function installMediaSessionActionHandlers() {
  setMediaSessionActionHandler("play", () => {
    setBackgroundAudioEnabled(true, { fromUserGesture: true });
  });
  setMediaSessionActionHandler("pause", () => {
    setBackgroundAudioEnabled(false, { fromUserGesture: true });
  });
  setMediaSessionActionHandler("stop", () => {
    setBackgroundAudioEnabled(false, { fromUserGesture: true });
    setAudioMuted(true, { fromUserGesture: true });
  });
}

function updatePageMeta() {
  document.documentElement.lang = getLang();
  if (pageDescriptionMeta) {
    pageDescriptionMeta.setAttribute("content", t("speedPageDescription"));
  }
  syncRuntimePagePresentation();
}

function loadUnitPreference() {
  const unit = loadText(STORAGE_UNIT_KEY, "");
  return unit && UNIT_CONFIG[unit] ? unit : "kmh";
}

function saveUnitPreference(unit) {
  saveText(STORAGE_UNIT_KEY, unit);
}

function loadDistanceUnitPreference() {
  const storedUnit = loadText(STORAGE_DISTANCE_UNIT_KEY, "");
  if (storedUnit && DISTANCE_UNIT_CONFIG[storedUnit]) {
    return storedUnit;
  }

  const legacyUnit = loadText(LEGACY_STORAGE_ALTITUDE_UNIT_KEY, "");
  return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit] ? legacyUnit : "m";
}

function saveDistanceUnitPreference(unit) {
  saveText(STORAGE_DISTANCE_UNIT_KEY, unit);
}

function loadPrimaryViewPreference() {
  return loadText(STORAGE_PRIMARY_VIEW_KEY, "") === "waze" ? "waze" : "gauge";
}

function savePrimaryViewPreference(view) {
  saveText(STORAGE_PRIMARY_VIEW_KEY, view);
}

function loadAlertEnabledPreference() {
  return loadBoolean(STORAGE_ALERT_ENABLED_KEY, false);
}

function saveAlertEnabledPreference(enabled) {
  saveBoolean(STORAGE_ALERT_ENABLED_KEY, enabled);
}

function loadAlertLimitPreference() {
  return loadNumber(STORAGE_ALERT_LIMIT_KEY, DEFAULT_ALERT_LIMIT_MS, {
    validate: (value) => value > 0,
  });
}

function saveAlertLimitPreference(limitMs) {
  saveNumber(STORAGE_ALERT_LIMIT_KEY, limitMs);
}

function loadAlertSoundEnabledPreference() {
  return loadBoolean(STORAGE_ALERT_SOUND_ENABLED_KEY, true);
}

function saveAlertSoundEnabledPreference(enabled) {
  saveBoolean(STORAGE_ALERT_SOUND_ENABLED_KEY, enabled);
}

function loadAudioMutedPreference() {
  return loadBoolean(STORAGE_AUDIO_MUTED_KEY, false);
}

function saveAudioMutedPreference(muted) {
  saveBoolean(STORAGE_AUDIO_MUTED_KEY, muted);
}

function loadBackgroundAudioEnabledPreference() {
  return loadBoolean(STORAGE_BACKGROUND_AUDIO_ENABLED_KEY, false);
}

function saveBackgroundAudioEnabledPreference(enabled) {
  saveBoolean(STORAGE_BACKGROUND_AUDIO_ENABLED_KEY, enabled);
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
  return loadBoolean(STORAGE_TRAP_ALERT_ENABLED_KEY, true);
}

function saveTrapAlertEnabledPreference(enabled) {
  saveBoolean(STORAGE_TRAP_ALERT_ENABLED_KEY, enabled);
}

function loadTrapAlertDistancePreference(unit = initialDistanceUnit) {
  const value = loadNumber(STORAGE_TRAP_ALERT_DISTANCE_KEY, getDefaultTrapAlertDistanceM(unit), {
    validate: (distance) => distance > 0,
  });
  return normalizeTrapAlertDistance(value, unit);
}

function saveTrapAlertDistancePreference(distanceM) {
  saveNumber(STORAGE_TRAP_ALERT_DISTANCE_KEY, distanceM);
}

function loadTrapSoundEnabledPreference() {
  return loadBoolean(STORAGE_TRAP_SOUND_ENABLED_KEY, true);
}

function saveTrapSoundEnabledPreference(enabled) {
  saveBoolean(STORAGE_TRAP_SOUND_ENABLED_KEY, enabled);
}

function loadAlertTriggerDiscoveredPreference() {
  return loadBoolean(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY, false);
}

function saveAlertTriggerDiscoveredPreference(discovered) {
  saveBoolean(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY, discovered);
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
  renderWazeUi();
  syncRuntimePagePresentation();
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

function clearGlobePosition() {
  clearGlobeFollowResumeTimeout();
  state.globeFollowPausedUntil = 0;
  state.globeCenter = null;

  if (!state.globeMap || !state.globeReady) {
    return;
  }

  const source = state.globeMap.getSource(GLOBE_SOURCE_ID);
  if (source && typeof source.setData === "function") {
    source.setData(getEmptyGlobeSourceData());
  }
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

function hasLiveCoordinateFix() {
  return Number.isFinite(state.lastKnownLatitude) && Number.isFinite(state.lastKnownLongitude);
}

function getCurrentCoordinates() {
  if (hasLiveCoordinateFix()) {
    return {
      latitude: state.lastKnownLatitude,
      longitude: state.lastKnownLongitude,
    };
  }

  if (!state.lastPoint) {
    return null;
  }

  return {
    latitude: state.lastPoint.latitude,
    longitude: state.lastPoint.longitude,
  };
}

function getWazeZoomLevel(speedMs = state.currentSpeedMs) {
  const speedKmh = speedMs * UNIT_CONFIG.kmh.factor;
  if (speedKmh < 15) return 15;
  if (speedKmh < 45) return 14;
  if (speedKmh < 90) return 13;
  return 12;
}

function getWazeEmbedUrl(latitude, longitude) {
  const params = new URLSearchParams({
    zoom: String(getWazeZoomLevel()),
    lat: latitude.toFixed(6),
    lon: longitude.toFixed(6),
    ct: "livemap",
  });
  return `${WAZE_EMBED_BASE_URL}?${params.toString()}`;
}

function getWazePermissionUrl() {
  const existingSrc = elements.wazeFrame?.getAttribute("src");
  if (existingSrc) {
    return existingSrc;
  }

  const coordinates = getCurrentCoordinates();
  if (coordinates) {
    return getWazeEmbedUrl(coordinates.latitude, coordinates.longitude);
  }

  return `${WAZE_EMBED_BASE_URL}?zoom=13&lat=40.7484&lon=-73.9857&ct=livemap`;
}

function shouldRefreshWazeEmbed() {
  if (
    !hasLiveCoordinateFix()
    || !Number.isFinite(state.wazeCenterLatitude)
    || !Number.isFinite(state.wazeCenterLongitude)
    || !Number.isFinite(state.lastPositionTimestamp)
    || !Number.isFinite(state.wazeCenteredAt)
  ) {
    return false;
  }

  const elapsedMs = state.lastPositionTimestamp - state.wazeCenteredAt;
  if (elapsedMs < WAZE_REFRESH_MIN_INTERVAL_MS) {
    return false;
  }

  const distanceM = haversineDistance(
    {
      latitude: state.wazeCenterLatitude,
      longitude: state.wazeCenterLongitude,
    },
    {
      latitude: state.lastKnownLatitude,
      longitude: state.lastKnownLongitude,
    },
  );

  return distanceM >= WAZE_REFRESH_MIN_DISTANCE_M;
}

function resetWazeEmbed({ clearFrame = false } = {}) {
  state.wazeLoadPending = false;
  state.wazeLoaded = false;
  state.wazeCenteredAt = null;
  state.wazeCenterLatitude = null;
  state.wazeCenterLongitude = null;

  if (clearFrame) {
    elements.wazeFrame?.removeAttribute("src");
  }

  renderWazeUi();
}

function renderWazeUi() {
  if (!elements.wazeStage) return;

  const currentSpeed = Math.round(convertSpeed(state.currentSpeedMs));
  const unitLabel = UNIT_CONFIG[state.unit].label;
  const alertState = getAlertUiState();
  const hasFrameSrc = Boolean(elements.wazeFrame?.getAttribute("src"));
  const isReady = hasFrameSrc && state.wazeLoaded && !state.wazeLoadPending;
  const waitingText = state.statusKind === "requesting" ? t("liveMapWaitingGps") : state.statusText;
  const limitLabel = alertState.enabled ? t("speedLimit") : t("alerts");
  const limitValue = alertState.enabled ? `${alertState.limitDisplayValue} ${unitLabel}` : t("off");
  let speedNote = "";

  if (alertState.over) {
    speedNote = tf("alertOverShort", { delta: `${alertState.deltaDisplayValue} ${unitLabel}` });
  } else if (alertState.near) {
    speedNote = t("nearLimit");
  } else if (alertState.source === "trap") {
    speedNote = t("trapCompact");
  } else if (alertState.source === "manual") {
    speedNote = t("manualCompact");
  }

  elements.wazeSpeedValue.textContent = String(currentSpeed);
  elements.wazeSpeedUnit.textContent = unitLabel;
  elements.wazeSpeedLimitLabel.textContent = limitLabel;
  elements.wazeSpeedLimitValue.textContent = limitValue;
  elements.wazeSpeedNote.hidden = !speedNote;
  elements.wazeSpeedNote.textContent = speedNote;
  elements.wazePlaceholderText.textContent = state.wazeLoadPending
    ? t("loadingWazeMap")
    : (hasFrameSrc ? t("enableWazeLocation") : waitingText);
  if (elements.wazeLocationPrompt) {
    elements.wazeLocationPrompt.textContent = t("enableWazeLocation");
    elements.wazeLocationPrompt.title = hasFrameSrc ? t("enableWazeLocation") : waitingText;
    elements.wazeLocationPrompt.disabled = state.wazeLoadPending;
  }
  elements.wazeRecenter.hidden = false;
  elements.wazeRecenter.disabled = state.wazeLoadPending || !hasLiveCoordinateFix();
  elements.wazeRecenter.classList.toggle("is-stale", shouldRefreshWazeEmbed());
  elements.wazeSpeedPill.classList.toggle("has-limit", alertState.enabled);
  elements.wazeSpeedPill.classList.toggle("is-alert-near", alertState.near);
  elements.wazeSpeedPill.classList.toggle("is-alert-over", alertState.over);
  elements.wazeSpeedPill.classList.toggle("is-trap-active", alertState.trapActive);
  elements.wazePlaceholder.classList.toggle("is-hidden", isReady);
  elements.wazeStage.classList.toggle("is-loading", state.wazeLoadPending);
  elements.wazeStage.classList.toggle("is-ready", isReady);

  if (elements.wazeFrame) {
    elements.wazeFrame.title = t("wazeMap");
  }
}

function syncWazeEmbed({ force = false } = {}) {
  if (!elements.wazeFrame) return;

  if (state.wazeLoadPending) {
    renderWazeUi();
    return;
  }

  const coordinates = getCurrentCoordinates();
  if (!coordinates) {
    renderWazeUi();
    return;
  }

  const hasFrameSrc = Boolean(elements.wazeFrame.getAttribute("src"));
  if (hasFrameSrc && !force && !shouldRefreshWazeEmbed()) {
    renderWazeUi();
    return;
  }

  state.wazeLoadPending = true;
  state.wazeLoaded = false;
  state.wazeCenterLatitude = coordinates.latitude;
  state.wazeCenterLongitude = coordinates.longitude;
  state.wazeCenteredAt = Number.isFinite(state.lastPositionTimestamp)
    ? state.lastPositionTimestamp
    : Date.now();
  elements.wazeFrame.src = getWazeEmbedUrl(coordinates.latitude, coordinates.longitude);
  renderWazeUi();
}

function renderPrimaryView() {
  if (!elements.gaugeCard) return;

  elements.gaugeCard.dataset.primaryView = state.primaryView;
  elements.gaugeStage?.setAttribute("aria-hidden", String(state.primaryView !== "gauge"));
  elements.wazeStage?.setAttribute("aria-hidden", String(state.primaryView !== "waze"));
  elements.gaugeStage?.toggleAttribute("inert", state.primaryView !== "gauge");
  elements.wazeStage?.toggleAttribute("inert", state.primaryView !== "waze");

  if (elements.wazeFrame) {
    elements.wazeFrame.tabIndex = state.primaryView === "waze" ? 0 : -1;
  }

  if (elements.wazeRecenter) {
    elements.wazeRecenter.tabIndex = state.primaryView === "waze" ? 0 : -1;
  }

  if (elements.wazeLocationPrompt) {
    elements.wazeLocationPrompt.tabIndex = state.primaryView === "waze" ? 0 : -1;
  }

  for (const button of elements.primaryViewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.primaryView === state.primaryView));
  }

  renderWazeUi();
}

function setPrimaryView(view) {
  if (view !== "gauge" && view !== "waze") return;

  const viewChanged = state.primaryView !== view;
  state.primaryView = view;
  savePrimaryViewPreference(view);
  renderPrimaryView();

  // Reload the embed only when it does not exist yet. Once Waze is already live,
  // keep the current iframe stable and surface "Recenter" instead of forcing a refresh,
  // because cross-origin Waze layers sometimes appear only after a user-driven map move.
  if (view === "waze" && (!state.wazeLoaded || !elements.wazeFrame?.getAttribute("src"))) {
    syncWazeEmbed();
  }

  if (viewChanged) {
    resizeCanvas();
  }
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

function clearGlobeSolarSyncFrame() {
  if (state.globeSolarSyncFrameId === null) return;
  window.cancelAnimationFrame(state.globeSolarSyncFrameId);
  state.globeSolarSyncFrameId = null;
  state.globeSolarGeometryDirty = false;
}

function stopGlobeSolarUpdates() {
  clearGlobeSolarSyncFrame();

  if (state.globeSolarUpdateIntervalId === null) return;
  window.clearInterval(state.globeSolarUpdateIntervalId);
  state.globeSolarUpdateIntervalId = null;
}

function syncGlobeSolarState({ updateGeometry = false } = {}) {
  if (!state.globeMap || !state.globeReady) return;
  const { vector: sunVector } = getSunVectorAtTime();

  if (!updateGeometry) {
    return;
  }

  const terminatorSource = state.globeMap.getSource(GLOBE_TERMINATOR_SOURCE_ID);
  if (terminatorSource && typeof terminatorSource.setData === "function") {
    terminatorSource.setData(getSolarTerminatorData(sunVector));
  }

  const nightSource = state.globeMap.getSource(GLOBE_NIGHT_SOURCE_ID);
  if (nightSource && typeof nightSource.setData === "function") {
    nightSource.setData(getSolarNightData(sunVector));
  }
}

function queueGlobeSolarSync(updateGeometry = false) {
  if (!state.globeMap || !state.globeReady) return;
  if (updateGeometry) {
    state.globeSolarGeometryDirty = true;
  }
  if (state.globeSolarSyncFrameId !== null) return;

  state.globeSolarSyncFrameId = window.requestAnimationFrame(() => {
    state.globeSolarSyncFrameId = null;
    const shouldUpdateGeometry = state.globeSolarGeometryDirty;
    state.globeSolarGeometryDirty = false;
    syncGlobeSolarState({ updateGeometry: shouldUpdateGeometry });
  });
}

function startGlobeSolarUpdates() {
  if (!state.globeMap || !state.globeReady) return;
  if (state.globeSolarUpdateIntervalId !== null) return;

  syncGlobeSolarState({ updateGeometry: true });
  state.globeSolarUpdateIntervalId = window.setInterval(() => {
    queueGlobeSolarSync(true);
  }, GLOBE_SOLAR_UPDATE_INTERVAL_MS);
}

function clearGlobeFollowResumeTimeout() {
  if (state.globeFollowResumeTimeoutId === null) return;
  window.clearTimeout(state.globeFollowResumeTimeoutId);
  state.globeFollowResumeTimeoutId = null;
}

function syncStoredGlobeCenter() {
  if (!state.globeMap) return;

  const center = state.globeMap.getCenter();
  if (!center) return;

  state.globeCenter = [normalizeDegrees180(center.lng), center.lat];
}

function isGlobeFollowPaused() {
  return state.globeFollowPausedUntil > Date.now();
}

function resumeGlobeFollow() {
  clearGlobeFollowResumeTimeout();
  state.globeFollowPausedUntil = 0;

  if (!state.lastPoint) return;

  syncGlobePosition(state.lastPoint.longitude, state.lastPoint.latitude, { force: true });
}

function pauseGlobeFollow() {
  if (!state.globeMap || !state.globeReady) return;

  state.globeFollowPausedUntil = Date.now() + GLOBE_FOLLOW_RESUME_DELAY_MS;
  clearGlobeFollowResumeTimeout();
  state.globeFollowResumeTimeoutId = window.setTimeout(() => {
    state.globeFollowResumeTimeoutId = null;
    resumeGlobeFollow();
  }, GLOBE_FOLLOW_RESUME_DELAY_MS);
}

function updateGlobeSource(longitude, latitude) {
  if (!state.globeMap || !state.globeReady) return;

  const source = state.globeMap.getSource(GLOBE_SOURCE_ID);
  if (source && typeof source.setData === "function") {
    source.setData(getGlobePointData(longitude, latitude));
  }
}

function syncGlobePosition(longitude, latitude, { immediate = false, force = false } = {}) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
  if (!state.globeMap || !state.globeReady) return;

  updateGlobeSource(longitude, latitude);

  if (!force && isGlobeFollowPaused()) {
    return;
  }

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

  if (isAlreadyCentered && !force) return;

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
  clearGlobePosition();

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

function clearLiveFixState({ preserveContinuity = false } = {}) {
  state.currentSpeedMs = 0;
  state.displayedSpeedMs = 0;
  state.currentAltitudeM = null;
  state.nearestTrapId = null;
  state.nearestTrapDistanceM = null;
  state.nearestTrapSpeedKph = null;
  state.recentSpeeds = [];
  state.lastFixAt = 0;
  state.lastPositionTimestamp = null;
  if (!preserveContinuity) {
    state.lastKnownLatitude = null;
    state.lastKnownLongitude = null;
    state.lastPoint = null;
    state.lastTrapSoundedId = null;
    state.lastAccuracyM = null;
    resetWazeEmbed({ clearFrame: true });
  }
  clearGlobePosition();
  renderWazeUi();
}

function initGlobe() {
  if (!elements.globeMount || state.globeMap) return;

  try {
    const initialSunVector = getSunVectorAtTime().vector;
    const globeMap = new maplibregl.Map({
      container: elements.globeMount,
      antialias: true,
      attributionControl: false,
      interactive: true,
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
          [GLOBE_TERMINATOR_SOURCE_ID]: {
            type: "geojson",
            data: getSolarTerminatorData(initialSunVector),
          },
          [GLOBE_NIGHT_SOURCE_ID]: {
            type: "geojson",
            data: getSolarNightData(initialSunVector),
          },
        },
        layers: [
          {
            id: "Satellite",
            type: "raster",
            source: "satellite",
            paint: {
              "raster-brightness-min": GLOBE_RASTER_BRIGHTNESS_MIN,
              "raster-brightness-max": 1,
              "raster-contrast": GLOBE_RASTER_CONTRAST,
            },
          },
          {
            id: "globe-night-fill",
            type: "fill",
            source: GLOBE_NIGHT_SOURCE_ID,
            layout: {
              "fill-sort-key": ["coalesce", ["get", "sortKey"], 0],
            },
            paint: {
              "fill-antialias": false,
              "fill-color": ["coalesce", ["get", "color"], "#050d18"],
              "fill-opacity": ["coalesce", ["get", "opacity"], 0],
            },
          },
          {
            id: "globe-terminator-glow",
            type: "line",
            source: GLOBE_TERMINATOR_SOURCE_ID,
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": "#f8fafc",
              "line-opacity": 0.2,
              "line-width": 4,
              "line-blur": 0.8,
            },
          },
          {
            id: "globe-terminator-core",
            type: "line",
            source: GLOBE_TERMINATOR_SOURCE_ID,
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": "#fef3c7",
              "line-opacity": 0.7,
              "line-width": 1.5,
            },
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
          "sky-color": GLOBE_SKY_COLOR,
          "horizon-color": GLOBE_HORIZON_COLOR,
          "sky-horizon-blend": GLOBE_SKY_HORIZON_BLEND,
          "atmosphere-blend": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 1,
            5, 1,
            7, 0,
          ],
        },
      },
    });

    globeMap.scrollZoom.disable();
    globeMap.boxZoom.disable();
    globeMap.doubleClickZoom.disable();
    globeMap.keyboard.disable();
    globeMap.addControl(new maplibregl.AttributionControl({ compact: true }));

    state.globeMap = globeMap;
    state.globeError = null;
    state.globeCenter = [...GLOBE_DEFAULT_CENTER];
    renderGlobeStatus();

    globeMap.on("load", () => {
      state.globeReady = true;
      syncStoredGlobeCenter();
      startGlobeSolarUpdates();
      collapseGlobeAttributionControl();
      resizeGlobe();

      if (state.lastPoint) {
        syncGlobePosition(state.lastPoint.longitude, state.lastPoint.latitude, { immediate: true });
      } else {
        queueGlobeSolarSync(true);
      }
    });

    globeMap.on("move", () => {
      syncStoredGlobeCenter();
      queueGlobeSolarSync();
    });

    globeMap.on("moveend", () => {
      syncStoredGlobeCenter();
      queueGlobeSolarSync();
      collapseGlobeAttributionControl();
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
  return state.backgroundAudioEnabled && !state.audioMuted && !state.backgroundAudioSuppressed;
}

function canRecoverSuppressedBackgroundAudio() {
  return state.backgroundAudioSuppressed
    && state.backgroundAudioEnabled
    && !state.audioMuted
    && state.lastFixAt > 0;
}

function queueSuppressedBackgroundAudioRecoveryAfterPrime() {
  if (!audioPrimePromise) {
    return false;
  }

  audioPrimePromise
    .then((audioPrimed) => {
      if (!audioPrimed || !canRecoverSuppressedBackgroundAudio()) {
        return;
      }
      state.backgroundAudioSuppressed = false;
      void armBackgroundAlertAudio();
    })
    .catch(() => {});

  return true;
}

function maybeRecoverSuppressedBackgroundAudio({ fromUserGesture = false } = {}) {
  if (!canRecoverSuppressedBackgroundAudio()) {
    return false;
  }

  if (!fromUserGesture && !state.audioPrimed) {
    queueSuppressedBackgroundAudioRecoveryAfterPrime();
    return false;
  }

  state.backgroundAudioSuppressed = false;
  void armBackgroundAlertAudio();
  return true;
}

function handleUserGestureAudioActivation() {
  if (maybeRecoverSuppressedBackgroundAudio({ fromUserGesture: true })) {
    return;
  }

  if (wantsBackgroundAudio()) {
    void armBackgroundAlertAudio();
  } else if (!state.audioMuted) {
    void primeAlertAudio();
  }
}

function suppressBackgroundAudioRuntime() {
  state.backgroundAudioRevision += 1;
  state.backgroundAudioSuppressed = true;
  state.backgroundAudioArmed = false;
  state.backgroundAudioArmPending = false;
  clearTrapMuteTimeout();
  stopBackgroundKeepAliveAudio();
}

function isStaleBackgroundAudioArm(revision) {
  return revision !== state.backgroundAudioRevision || !wantsBackgroundAudio();
}

function stopAudioElementPlayback(audio) {
  audio.pause();
  audio.currentTime = 0;
}

async function ensureBackgroundKeepAliveAudio(revision = state.backgroundAudioRevision) {
  backgroundKeepAliveAudio.loop = true;
  backgroundKeepAliveAudio.muted = false;
  backgroundKeepAliveAudio.volume = 1;

  if (!backgroundKeepAliveAudio.paused) {
    return !isStaleBackgroundAudioArm(revision);
  }

  backgroundKeepAliveAudio.currentTime = 0;
  const playPromise = backgroundKeepAliveAudio.play();
  if (playPromise && typeof playPromise.then === "function") {
    await playPromise;
  }

  if (isStaleBackgroundAudioArm(revision)) {
    if (!wantsBackgroundAudio()) {
      stopBackgroundKeepAliveAudio();
    }
    return false;
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
    clearGlobeFollowResumeTimeout();
  });
}

async function ensureAudioElementLooping(audio, revision = state.backgroundAudioRevision) {
  audio.loop = true;

  if (!audio.paused) {
    return !isStaleBackgroundAudioArm(revision);
  }

  silenceAudioElement(audio);
  audio.currentTime = 0;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === "function") {
    await playPromise;
  }

  if (isStaleBackgroundAudioArm(revision)) {
    if (!wantsBackgroundAudio()) {
      stopAudioElementPlayback(audio);
    }
    return false;
  }

  return true;
}

function invalidateOverspeedSoundRequest() {
  state.overspeedSoundRequestId += 1;
  return state.overspeedSoundRequestId;
}

function invalidateTrapSoundRequest() {
  state.trapSoundRequestId += 1;
  return state.trapSoundRequestId;
}

function stopOverspeedSound() {
  invalidateOverspeedSoundRequest();
  state.alertSoundPending = false;
  state.overspeedAudible = false;
  overspeedAudio.pause();
  overspeedAudio.currentTime = 0;
}

function keepOverspeedAudioAlive() {
  invalidateOverspeedSoundRequest();
  state.alertSoundPending = false;
  state.overspeedAudible = false;
  overspeedAudio.loop = true;
  silenceAudioElement(overspeedAudio);
  if (!overspeedAudio.paused) {
    overspeedAudio.currentTime = 0;
    return;
  }

  if (state.backgroundAudioArmed) {
    void ensureAudioElementLooping(overspeedAudio, state.backgroundAudioRevision).catch(() => {});
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
  const overspeedSoundRequestId = invalidateOverspeedSoundRequest();
  const playPromise = overspeedAudio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    state.alertSoundBlocked = false;
    state.overspeedAudible = true;
    return;
  }

  state.alertSoundPending = true;
  playPromise
    .then(() => {
      if (overspeedSoundRequestId !== state.overspeedSoundRequestId) return;
      state.alertSoundPending = false;
      state.alertSoundBlocked = false;
      state.overspeedAudible = true;
    })
    .catch(() => {
      if (overspeedSoundRequestId !== state.overspeedSoundRequestId) return;
      state.alertSoundPending = false;
      state.alertSoundBlocked = true;
      stopOverspeedSound();
    });
}

function stopTrapSound() {
  invalidateTrapSoundRequest();
  state.trapSoundPending = false;
  state.trapAudible = false;
  state.trapSoundDeadlineAt = 0;
  clearTrapMuteTimeout();
  trapAlertAudio.pause();
  trapAlertAudio.currentTime = 0;
}

function keepTrapAudioAlive() {
  invalidateTrapSoundRequest();
  clearTrapMuteTimeout();
  state.trapSoundPending = false;
  state.trapAudible = false;
  state.trapSoundDeadlineAt = 0;
  trapAlertAudio.loop = true;
  silenceAudioElement(trapAlertAudio);
  if (!trapAlertAudio.paused) {
    trapAlertAudio.currentTime = 0;
    return;
  }

  if (state.backgroundAudioArmed) {
    void ensureAudioElementLooping(trapAlertAudio, state.backgroundAudioRevision).catch(() => {});
  }
}

function getRemainingTrapSoundDurationMs() {
  if (Number.isFinite(trapAlertAudio.duration) && trapAlertAudio.duration > 0) {
    return Math.max(0, Math.round((trapAlertAudio.duration - trapAlertAudio.currentTime) * 1000));
  }

  return getTrapSoundDurationMs();
}

function shouldRecoverInterruptedTrapSound() {
  return state.trapSoundDeadlineAt > Date.now();
}

function scheduleTrapAudioMute(delayMs = getTrapSoundDurationMs()) {
  clearTrapMuteTimeout();
  state.trapMuteTimeoutId = window.setTimeout(() => {
    keepTrapAudioAlive();
  }, Math.max(0, delayMs));
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

function primeAlertAudio() {
  if (state.audioPrimed) {
    return Promise.resolve(true);
  }

  if (audioPrimePromise) {
    return audioPrimePromise;
  }

  state.audioPrimePending = true;
  audioPrimePromise = (async () => {
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

      return state.audioPrimed;
    } finally {
      state.audioPrimePending = false;
      audioPrimePromise = null;
    }
  })();

  return audioPrimePromise;
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
    const audioPrimed = await primeAlertAudio();
    if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
      shouldRetry = wantsBackgroundAudio();
      return;
    }
    if (!audioPrimed) {
      return;
    }

    await ensureBackgroundKeepAliveAudio(backgroundAudioRevision);
    if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
      shouldRetry = wantsBackgroundAudio();
      return;
    }
    await Promise.all([
      overspeedAudio.paused
        ? ensureAudioElementLooping(overspeedAudio, backgroundAudioRevision)
        : Promise.resolve(true),
      trapAlertAudio.paused
        ? ensureAudioElementLooping(trapAlertAudio, backgroundAudioRevision)
        : Promise.resolve(true),
    ]);
    if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
      shouldRetry = wantsBackgroundAudio();
      return;
    }

    state.backgroundAudioArmed = true;
    state.alertSoundBlocked = false;
    state.trapSoundBlocked = false;
    if (trapAlertAudio.paused) {
      keepTrapAudioAlive();
    } else if (state.trapAudible || state.trapSoundPending) {
      scheduleTrapAudioMute(getRemainingTrapSoundDurationMs());
    }
  } catch {
    if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
      shouldRetry = wantsBackgroundAudio();
    } else {
      disarmBackgroundAlertAudio();
    }
  } finally {
    state.backgroundAudioArmPending = false;
    if (shouldRetry && !state.backgroundAudioArmed && !state.backgroundAudioArmPending) {
      void armBackgroundAlertAudio();
    }
  }
}

function disarmBackgroundAlertAudio({ fromUserGesture = false } = {}) {
  state.backgroundAudioArmed = false;
  state.backgroundAudioArmPending = false;
  clearTrapMuteTimeout();
  stopBackgroundKeepAliveAudio();

  if (shouldPlayOverspeedSound()) {
    overspeedAudio.loop = true;
    activateAudioElement(overspeedAudio);
    if (overspeedAudio.paused) {
      invalidateOverspeedSoundRequest();
      state.alertSoundPending = false;
      state.overspeedAudible = false;
      syncOverspeedSound({ fromUserGesture });
    } else if (!state.alertSoundPending) {
      state.overspeedAudible = true;
    }
  } else {
    stopOverspeedSound();
  }

  const activeTrap = getActiveTrapAlert();
  if (activeTrap && state.trapSoundEnabled && (state.trapAudible || state.trapSoundPending || shouldRecoverInterruptedTrapSound())) {
    trapAlertAudio.loop = false;
    activateAudioElement(trapAlertAudio);
    if (trapAlertAudio.paused && shouldRecoverInterruptedTrapSound()) {
      invalidateTrapSoundRequest();
      state.trapSoundPending = false;
      state.trapAudible = false;
      state.lastTrapSoundedId = null;
      syncTrapSound({ fromUserGesture });
      return;
    }
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
    if (state.trapSoundPending || !trapAlertAudio.paused) {
      return;
    }
    if (!shouldRecoverInterruptedTrapSound()) {
      return;
    }
    state.lastTrapSoundedId = null;
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
  state.trapSoundDeadlineAt = Date.now() + getTrapSoundDurationMs();
  const trapSoundRequestId = invalidateTrapSoundRequest();
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
      if (trapSoundRequestId !== state.trapSoundRequestId) return;
      state.trapSoundPending = false;
      state.trapSoundBlocked = false;
      state.trapAudible = true;
      state.lastTrapSoundedId = activeTrap.id;
      if (state.backgroundAudioArmed) {
        scheduleTrapAudioMute();
      }
    })
    .catch(() => {
      if (trapSoundRequestId !== state.trapSoundRequestId) return;
      state.trapSoundPending = false;
      state.trapSoundBlocked = true;
      stopTrapSound();
    });
}

function normalizeInitialAudioPreferences() {
  if (!state.audioMuted || !state.backgroundAudioEnabled) {
    return;
  }

  state.backgroundAudioEnabled = false;
  saveBackgroundAudioEnabledPreference(false);
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
  elements.subStatus.textContent = getSubStatusText();
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
    handleUserGestureAudioActivation();
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
      handleUserGestureAudioActivation();
    }
  } else {
    disarmBackgroundAlertAudio({ fromUserGesture });
  }

  renderAlertUi({ fromUserGesture });
}

function openAlertPanel() {
  if (elements.alertBackdrop) {
    elements.alertBackdrop.hidden = false;
  }
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
  if (elements.alertBackdrop) {
    elements.alertBackdrop.hidden = true;
  }
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

function stopTracking({ disarmBackgroundAudio = false } = {}) {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  clearLiveFixState();
  if (disarmBackgroundAudio) {
    suppressBackgroundAudioRuntime();
  }
  stopOverspeedSound();
  stopTrapSound();
}

function startTracking({ fromUserGesture = false } = {}) {
  if (!("geolocation" in navigator)) {
    clearLiveFixState();
    suppressBackgroundAudioRuntime();
    stopOverspeedSound();
    stopTrapSound();
    setStatus("notSupported");
    showTranslatedNotice("noticeNoGeolocation");
    renderMetrics();
    drawGauge();
    return;
  }

  stopTracking();
  state.trackingStartedAt = Date.now();
  setStatus("requesting");
  renderMetrics();
  drawGauge();

  if (fromUserGesture) {
    handleUserGestureAudioActivation();
  }

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

function restartTrip({ fromUserGesture = false } = {}) {
  resetTripData();
  startTracking({ fromUserGesture });
}

function handlePosition(position) {
  hideNotice();
  const normalizedTimestamp = normalizePositionTimestamp(position.timestamp);

  if (!Number.isFinite(state.startTime)) {
    state.startTime = normalizedTimestamp;
  }

  const coords = position.coords;
  const currentAccuracyM = Number.isFinite(coords.accuracy) ? coords.accuracy : null;
  state.lastKnownLatitude = coords.latitude;
  state.lastKnownLongitude = coords.longitude;
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
  if (state.primaryView === "waze" && (!state.wazeLoaded || !elements.wazeFrame?.getAttribute("src"))) {
    syncWazeEmbed();
  } else {
    renderWazeUi();
  }

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
  maybeRecoverSuppressedBackgroundAudio();
}

function handlePositionError(error) {
  if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) {
    stopTracking({ disarmBackgroundAudio: true });
    setStatus("blocked");
    showTranslatedNotice("noticeLocationRequired");
    renderMetrics();
    drawGauge();
    return;
  }

  if (error.code === GEO_ERROR_CODE.POSITION_UNAVAILABLE) {
    clearLiveFixState({ preserveContinuity: true });
    setStatus("unavailable");
    showTranslatedNotice("noticeSignalUnavailable");
    renderMetrics();
    drawGauge();
    return;
  }

  if (error.code === GEO_ERROR_CODE.TIMEOUT) {
    clearLiveFixState({ preserveContinuity: true });
    setStatus("waiting");
    showTranslatedNotice("noticeStillWaiting");
    renderMetrics();
    drawGauge();
    return;
  }

  clearLiveFixState({ preserveContinuity: true });
  setStatus("error");
  showNotice(error.message || t("gpsError"));
  renderMetrics();
  drawGauge();
}

function resizeCanvas() {
  analogSpeedometer.resize();
  resizeGlobe();
}

function initGaugeLayoutObserver() {
  // Shared component owns its own resize observer.
}

function getCssColor(name, fallback) {
  const styleTarget = elements.gaugeStage || document.documentElement;
  const value = getComputedStyle(styleTarget).getPropertyValue(name).trim();
  return value || fallback;
}

function getGaugeMaximum(displaySpeed) {
  const config = UNIT_CONFIG[state.unit];
  const paddedValue = Math.max(config.baseMax, Math.ceil(displaySpeed / config.tickStep) * config.tickStep);
  return Math.max(config.baseMax, paddedValue);
}

function drawGauge() {
  const alertState = getAlertUiState();
  const displaySpeed = convertSpeed(state.displayedSpeedMs);
  const currentSpeed = Math.round(convertSpeed(state.currentSpeedMs));
  const unitLabel = UNIT_CONFIG[state.unit].label;
  const gaugeMax = getGaugeMaximum(
    Math.max(
      displaySpeed,
      convertSpeed(state.maxSpeedMs),
      alertState.enabled ? alertState.limitDisplayValue : 0,
    ),
  );

  const trapAccentColor = getCssColor("--speed-trap", "#f59e0b");
  const accentColor = alertState.over
    ? getCssColor("--speed-alert", "#ef4444")
    : (alertState.trapActive ? trapAccentColor : getCssColor("--speed-accent", "#10b981"));
  const alertMarkerColor = alertState.source === "trap"
    ? trapAccentColor
    : getCssColor("--speed-alert-marker", "#ff7a5c");
  analogSpeedometer.render({
    value: displaySpeed,
    valueText: String(currentSpeed),
    unitText: unitLabel,
    substatusText: getSubStatusText(),
    maxValue: gaugeMax,
    tickStep: UNIT_CONFIG[state.unit].tickStep,
    markerValue: alertState.enabled ? alertState.limitDisplayValue : null,
    accentColor,
    markerColor: alertMarkerColor,
    pivotInnerColor: accentColor,
  });
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
  renderWazeUi();
  syncRuntimePagePresentation();
}

function syncLanguage() {
  applyTranslations();
  state.statusText = getStatusText(state.statusKind, state.statusParams);
  updatePageMeta();
  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }

  elements.status.textContent = state.statusText;

  if (!elements.notice.hidden && state.noticeKey) {
    elements.noticeText.textContent = tf(state.noticeKey, state.noticeParams ?? {});
  }

  renderGlobeStatus();
  renderPrimaryView();
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
  bindMenuNavigation(elements.openAccelMenu, "/accel");
  bindMenuNavigation(elements.openGpsLabMenu, "/gps-rate");
  bindMenuNavigation(elements.openBoardMenu, "/");
  elements.retryGps.addEventListener("click", () => restartTrip({ fromUserGesture: true }));
  elements.resetTrip.addEventListener("click", () => restartTrip({ fromUserGesture: true }));
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

  for (const button of elements.primaryViewButtons) {
    button.addEventListener("click", () => {
      setPrimaryView(button.dataset.primaryView);
    });
  }

  elements.wazeLocationPrompt?.addEventListener("click", () => {
    window.open(getWazePermissionUrl(), "_blank", "noopener,noreferrer");
  });

  elements.wazeRecenter?.addEventListener("click", () => {
    syncWazeEmbed({ force: true });
  });

  elements.wazeFrame?.addEventListener("load", () => {
    state.wazeLoadPending = false;
    state.wazeLoaded = Boolean(elements.wazeFrame?.getAttribute("src"));
    renderWazeUi();
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

  elements.globeMount?.addEventListener("pointerdown", () => {
    pauseGlobeFollow();
  }, { passive: true });

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  window.addEventListener("pageshow", () => {
    ensureTrapArtifactsLoaded();
    resizeCanvas();
    startGlobeSolarUpdates();
    queueGlobeSolarSync();
    if (state.watchId === null) startTracking();
    startRenderLoop();
    if (wantsBackgroundAudio()) {
      void armBackgroundAlertAudio();
    }
    syncOverspeedSound();
    syncTrapSound();
  });
  document.addEventListener("pointerdown", (event) => {
    handleUserGestureAudioActivation();
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
    handleUserGestureAudioActivation();
    syncOverspeedSound({ fromUserGesture: true });
    syncTrapSound({ fromUserGesture: true });
    if (event.key === "Escape") closeAlertPanel();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopGlobeSolarUpdates();
      stopRenderLoop();
      syncRuntimePagePresentation();
      return;
    }

    resizeCanvas();
    ensureTrapArtifactsLoaded();
    startGlobeSolarUpdates();
    queueGlobeSolarSync();
    startRenderLoop();
    if (wantsBackgroundAudio()) {
      void armBackgroundAlertAudio();
    }
    syncOverspeedSound();
    syncTrapSound();
    syncRuntimePagePresentation();
  });
  document.addEventListener("i18n:change", syncLanguage);
}

function init() {
  document.body.classList.remove("alert-panel-open");
  normalizeInitialAudioPreferences();
  updatePageMeta();

  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }

  for (const button of elements.primaryViewButtons) {
    button.setAttribute("aria-pressed", button.dataset.primaryView === state.primaryView ? "true" : "false");
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

  for (const audio of [overspeedAudio, trapAlertAudio, backgroundKeepAliveAudio]) {
    audio.addEventListener("play", syncRuntimePagePresentation);
    audio.addEventListener("pause", syncRuntimePagePresentation);
    audio.addEventListener("ended", syncRuntimePagePresentation);
  }

  installMediaSessionActionHandlers();
  renderPrimaryView();
  renderMetrics();
  initGlobe();
  initGaugeLayoutObserver();
  resizeCanvas();
  bindEvents();
  loadTrapArtifacts();
  startTracking();
  startRenderLoop();
}

init();
