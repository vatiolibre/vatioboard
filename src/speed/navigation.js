import maplibregl from "maplibre-gl";
import {
  GEO_ERROR_CODE,
  GLOBE_DEFAULT_CENTER,
  GLOBE_DEFAULT_ZOOM,
  GLOBE_FOLLOW_RESUME_DELAY_MS,
  GLOBE_FOLLOW_ZOOM,
  GLOBE_HORIZON_COLOR,
  GLOBE_NIGHT_CAPS,
  GLOBE_NIGHT_POLYGON_STEPS,
  GLOBE_NIGHT_SOURCE_ID,
  GLOBE_RASTER_BRIGHTNESS_MIN,
  GLOBE_RASTER_CONTRAST,
  GLOBE_SATELLITE_ATTRIBUTION,
  GLOBE_SKY_COLOR,
  GLOBE_SKY_HORIZON_BLEND,
  GLOBE_SOLAR_UPDATE_INTERVAL_MS,
  GLOBE_SOURCE_ID,
  GLOBE_TERMINATOR_SOURCE_ID,
  MAX_ACCURACY_INFLUENCE_M,
  MIN_DISTANCE_NOISE_FLOOR_M,
  MIN_VALID_EPOCH_MS,
  UNIT_CONFIG,
  WAZE_EMBED_BASE_URL,
  WAZE_REFRESH_MIN_DISTANCE_M,
  WAZE_REFRESH_MIN_INTERVAL_MS,
} from "./constants.js";

export function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

export function toDegrees(radians) {
  return radians * (180 / Math.PI);
}

export function normalizeDegrees360(value) {
  return ((value % 360) + 360) % 360;
}

export function normalizeDegrees180(value) {
  const normalized = normalizeDegrees360(value);
  return normalized > 180 ? normalized - 360 : normalized;
}

export function normalizeDegreesNear(value, reference) {
  return reference + normalizeDegrees180(value - reference);
}

export function crossVector3(a, b) {
  return [
    (a[1] * b[2]) - (a[2] * b[1]),
    (a[2] * b[0]) - (a[0] * b[2]),
    (a[0] * b[1]) - (a[1] * b[0]),
  ];
}

export function normalizeVector3(vector) {
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

export function lngLatToUnitVector(longitude, latitude) {
  const longitudeRad = toRadians(longitude);
  const latitudeRad = toRadians(latitude);
  const cosLatitude = Math.cos(latitudeRad);

  return [
    Math.sin(longitudeRad) * cosLatitude,
    Math.sin(latitudeRad),
    Math.cos(longitudeRad) * cosLatitude,
  ];
}

export function unitVectorToLngLat(vector) {
  const normalized = normalizeVector3(vector);
  if (!normalized) {
    return [0, 0];
  }

  return [
    normalizeDegrees180(toDegrees(Math.atan2(normalized[0], normalized[2]))),
    toDegrees(Math.asin(clampNumber(normalized[1], -1, 1))),
  ];
}

export function getSunVectorAtTime(timestamp = Date.now()) {
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

export function getEmptyGlobeFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function getSolarReferenceFrame(sunVector) {
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

export function getSolarTerminatorData(sunVector) {
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

export function getSolarNightCapRing(sunVector, altitude) {
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

export function getSolarNightData(sunVector) {
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

export function getEmptyGlobeSourceData() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function getGlobePointData(longitude, latitude) {
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

export function normalizePositionTimestamp(timestamp, fallbackMs = Date.now()) {
  if (!Number.isFinite(timestamp)) return fallbackMs;

  const safeFallbackMs = Number.isFinite(fallbackMs) ? fallbackMs : Date.now();
  const maxReasonableMs = safeFallbackMs + (60 * 1000);

  if (timestamp < MIN_VALID_EPOCH_MS || timestamp > maxReasonableMs) {
    return safeFallbackMs;
  }

  return timestamp;
}

export function haversineDistance(a, b) {
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

export function getMovementThresholdM(currentAccuracyM, previousAccuracyM) {
  const accuracies = [currentAccuracyM, previousAccuracyM].filter(Number.isFinite);
  const accuracyFloorM = accuracies.length > 0
    ? Math.min(Math.max(...accuracies), MAX_ACCURACY_INFLUENCE_M)
    : 0;

  return Math.max(MIN_DISTANCE_NOISE_FLOOR_M, accuracyFloorM * 0.5);
}

export function getWazeZoomLevel(speedMs) {
  const speedKmh = speedMs * UNIT_CONFIG.kmh.factor;
  if (speedKmh < 15) return 15;
  if (speedKmh < 45) return 14;
  if (speedKmh < 90) return 13;
  return 12;
}

export function getWazeEmbedUrl(latitude, longitude, speedMs = 0) {
  const params = new URLSearchParams({
    zoom: String(getWazeZoomLevel(speedMs)),
    lat: latitude.toFixed(6),
    lon: longitude.toFixed(6),
    ct: "livemap",
  });
  return `${WAZE_EMBED_BASE_URL}?${params.toString()}`;
}

export function createWazeController({
  state,
  elements,
  t,
  getAlertUiState,
  convertSpeed,
  hasLiveCoordinateFix,
  getCurrentCoordinates,
}) {
  function getWazePermissionUrl() {
    const existingSrc = elements.wazeFrame?.getAttribute("src");
    if (existingSrc) {
      return existingSrc;
    }

    const coordinates = getCurrentCoordinates();
    if (coordinates) {
      return getWazeEmbedUrl(coordinates.latitude, coordinates.longitude, state.currentSpeedMs);
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

    const currentSpeed = Math.round(convertSpeed(state.currentSpeedMs, state.unit));
    const unitLabel = UNIT_CONFIG[state.unit].label;
    const alertState = getAlertUiState();
    const hasFrameSrc = Boolean(elements.wazeFrame?.getAttribute("src"));
    const isReady = hasFrameSrc && state.wazeLoaded && !state.wazeLoadPending;
    const waitingText = state.statusKind === "requesting" ? t("liveMapWaitingGps") : state.statusText;
    const limitLabel = alertState.enabled ? t("speedLimit") : t("alerts");
    const limitValue = alertState.enabled ? `${alertState.limitDisplayValue} ${unitLabel}` : t("off");
    let speedNote = "";

    if (alertState.over) {
      speedNote = tf(t, "alertOverShort", { delta: `${alertState.deltaDisplayValue} ${unitLabel}` });
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
    elements.wazeFrame.src = getWazeEmbedUrl(coordinates.latitude, coordinates.longitude, state.currentSpeedMs);
    renderWazeUi();
  }

  return {
    getWazePermissionUrl,
    renderWazeUi,
    resetWazeEmbed,
    shouldRefreshWazeEmbed,
    syncWazeEmbed,
  };
}

export function createGlobeController({
  state,
  elements,
  t,
  renderStatusText,
}) {
  function renderGlobeStatus() {
    if (!elements.globeStatus) return;
    if (state.globeError) {
      elements.globeStatus.textContent = t("globeUnavailable");
      return;
    }

    if (Number.isFinite(state.lastPositionTimestamp)) {
      elements.globeStatus.textContent = renderStatusText(state.lastPositionTimestamp);
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

  return {
    clearGlobeFollowResumeTimeout,
    clearGlobePosition,
    getCurrentCoordinates,
    hasLiveCoordinateFix,
    initGlobe,
    pauseGlobeFollow,
    queueGlobeSolarSync,
    renderGlobeStatus,
    resetGlobe,
    resizeGlobe,
    startGlobeSolarUpdates,
    stopGlobeSolarUpdates,
    syncGlobePosition,
  };
}

function tf(translate, key, values = {}) {
  return translate(key).replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? ""));
}
