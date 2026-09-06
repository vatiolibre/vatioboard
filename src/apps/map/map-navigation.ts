import {
  angularDifferenceDegrees,
  bearingDegrees,
  deriveHeadingFromPositions,
  distanceMeters,
  isUsableLatLon,
  normalizeHeading,
} from "../../shared/geo-heading.js";

type AnyRecord = Record<string, any>;

const MIN_DERIVED_HEADING_DISTANCE_M = 8;
const MIN_MOVING_SPEED_MS = 1.5;
const HEADING_TTL_MS = 5000;
const POSITION_STALE_MS = 10000;
const NAVIGATION_HEADING_MIN_DELTA_DEGREES = 3;
const NAVIGATION_ANCHOR_Y_RATIO = 0.22;
const NAVIGATION_MIN_COMMAND_INTERVAL_MS = 180;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export {
  angularDifferenceDegrees,
  bearingDegrees,
  deriveHeadingFromPositions,
  distanceMeters,
  normalizeHeading,
};

export function createNavigationCameraState() {
  return {
    latestBearingApplied: null,
    latestHeading: null,
    headingAvailable: false,
    headingSource: "none",
    lastCameraCommandReason: "none",
    lastCommandAtMs: 0,
    lastCameraKey: null,
    lastCameraDistance: null,
  };
}

export function normalizeNavigationOptions(options: AnyRecord = {}) {
  const navigationMode = options.navigationMode === "browse" ? "browse" : "drive";
  const anchorRatio = finiteNumber(options.vehicleAnchorYRatio) ?? NAVIGATION_ANCHOR_Y_RATIO;
  return {
    navigationMode,
    vehicleAnchorYRatio: Math.min(0.34, Math.max(0, anchorRatio)),
    minCommandIntervalMs: finiteNumber(options.minCommandIntervalMs) ?? NAVIGATION_MIN_COMMAND_INTERVAL_MS,
    durationMs: finiteNumber(options.durationMs) ?? 420,
    minHeadingDeltaDegrees: finiteNumber(options.minHeadingDeltaDegrees) ?? NAVIGATION_HEADING_MIN_DELTA_DEGREES,
  };
}

export function shouldUseNavigationCamera({
  followEnabled = false,
  followPaused = false,
  panelVisible = true,
  mapReady = true,
  position = null,
  navigationMode = "drive",
}: AnyRecord = {}) {
  return followEnabled === true
    && followPaused !== true
    && panelVisible === true
    && mapReady === true
    && navigationMode === "drive"
    && isUsableLivePosition(position);
}

export function smoothHeading(previousHeading, nextHeading, options: AnyRecord = {}) {
  const previous = normalizeHeading(previousHeading);
  const next = normalizeHeading(nextHeading);
  if (next === null) return previous;
  if (previous === null) return next;

  const minDelta = finiteNumber(options.minDeltaDegrees) ?? NAVIGATION_HEADING_MIN_DELTA_DEGREES;
  const signedDelta = ((next - previous + 540) % 360) - 180;
  const delta = Math.abs(signedDelta);
  if (delta < minDelta) return previous;

  const factor = delta >= 90 ? 0.62 : delta >= 35 ? 0.46 : 0.28;
  return normalizeHeading(previous + signedDelta * factor);
}

export function shouldUpdateBearing(previousBearing, nextBearing, speedMs = null, options: AnyRecord = {}) {
  const previous = normalizeHeading(previousBearing);
  const next = normalizeHeading(nextBearing);
  if (next === null) return false;
  const speed = finiteNumber(speedMs) ?? 0;
  if (speed < 1) return false;
  if (previous === null) return true;
  const threshold = finiteNumber(options.minDeltaDegrees)
    ?? (speed >= 7 ? 2.5 : NAVIGATION_HEADING_MIN_DELTA_DEGREES);
  return angularDifferenceDegrees(previous, next) >= threshold;
}

function getNavigationZoom(speedMs, currentZoom, relevantCamera) {
  const speed = finiteNumber(speedMs) ?? 0;
  let targetZoom = speed >= 25 ? 14.7 : speed >= 13 ? 15.1 : speed >= 4 ? 16 : 15.5;
  if (relevantCamera?.ahead && Number.isFinite(relevantCamera.distance)) {
    if (relevantCamera.distance > 900) targetZoom = Math.min(targetZoom, 14.5);
    else if (relevantCamera.distance > 450) targetZoom = Math.min(targetZoom, 15);
  }
  const zoom = finiteNumber(currentZoom);
  if (zoom === null || zoom < 10) return targetZoom;
  if (Math.abs(zoom - targetZoom) <= 0.35) return zoom;
  return targetZoom;
}

function shouldEmphasizeRelevantCamera(relevantCamera, previousCameraState: AnyRecord = {}) {
  if (!relevantCamera?.ahead) return false;
  if (relevantCamera.key !== previousCameraState.lastCameraKey) return true;
  if (!Number.isFinite(relevantCamera.distance) || !Number.isFinite(previousCameraState.lastCameraDistance)) {
    return false;
  }
  return Math.abs(relevantCamera.distance - previousCameraState.lastCameraDistance)
    > previousCameraState.lastCameraDistance * 0.15;
}

export function computeNavigationCameraUpdate({
  position,
  headingState,
  previousCameraState = createNavigationCameraState(),
  orientationMode = "north-up",
  navigationMode = "drive",
  relevantCamera = null,
  mapSize = {},
  currentZoom = null,
  currentBearing = 0,
  currentPitch: _currentPitch = 0,
  now = Date.now(),
  options = {},
}: AnyRecord = {}) {
  const normalizedOptions = normalizeNavigationOptions({ ...options, navigationMode });
  if (!isUsableLivePosition(position) || normalizedOptions.navigationMode !== "drive") {
    return {
      method: "none",
      reason: "navigation-disabled",
      shouldRefreshViewport: false,
    };
  }

  const headingAvailable = headingState?.headingAvailable === true && headingState?.headingStale !== true;
  const previousBearing = normalizeHeading(previousCameraState.latestBearingApplied ?? currentBearing);
  const rawHeading = headingAvailable ? normalizeHeading(headingState.heading) : null;
  const smoothedHeading = rawHeading === null
    ? null
    : smoothHeading(previousCameraState.latestHeading, rawHeading, {
      minDeltaDegrees: normalizedOptions.minHeadingDeltaDegrees,
    });
  const speedMs = finiteNumber(position.speedMs) ?? 0;
  let bearing = 0;
  let reason = "following";

  if (orientationMode === "heading-up") {
    if (headingAvailable && shouldUpdateBearing(previousBearing, smoothedHeading, speedMs, {
      minDeltaDegrees: normalizedOptions.minHeadingDeltaDegrees,
    })) {
      bearing = smoothedHeading;
    } else if (headingAvailable && previousBearing === null) {
      bearing = smoothedHeading;
    } else if (headingAvailable) {
      bearing = previousBearing ?? smoothedHeading;
    } else {
      bearing = previousBearing ?? normalizeHeading(currentBearing) ?? 0;
      reason = "heading-unavailable";
    }
  }

  const width = finiteNumber(mapSize.width) ?? 0;
  const height = finiteNumber(mapSize.height) ?? 0;
  const offset = [0, Math.round(height * normalizedOptions.vehicleAnchorYRatio)];
  const cameraAhead = shouldEmphasizeRelevantCamera(relevantCamera, previousCameraState);
  if (cameraAhead) reason = "camera-ahead";
  const duration = now - Number(previousCameraState.lastCommandAtMs || 0) < normalizedOptions.minCommandIntervalMs
    ? 220
    : normalizedOptions.durationMs;

  return {
    method: "easeTo",
    center: [position.longitude, position.latitude],
    zoom: getNavigationZoom(speedMs, currentZoom, relevantCamera),
    bearing,
    pitch: 0,
    offset,
    padding: cameraAhead ? { top: 72, right: 64, bottom: Math.max(160, Math.round(height * 0.32)), left: 64 } : null,
    duration,
    reason,
    shouldRefreshViewport: cameraAhead,
    headingAvailable,
    latestHeading: smoothedHeading,
    headingSource: headingState?.source || "none",
    relevantCameraKey: relevantCamera?.key || null,
    relevantCameraDistance: Number.isFinite(relevantCamera?.distance) ? relevantCamera.distance : null,
    mapSize: { width, height },
  };
}

function getHeadingCandidate(input, coords) {
  return coords.heading
    ?? input?.heading
    ?? coords.headingDeg
    ?? input?.headingDeg
    ?? coords.course
    ?? input?.course;
}

export function normalizeLivePosition(input: any, now = Date.now()) {
  const coords: AnyRecord = input?.coords || input || {};
  const latitude = finiteNumber(coords.latitude);
  const longitude = finiteNumber(coords.longitude);
  if (
    latitude === null
    || longitude === null
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  const timestampMs = finiteNumber(input?.timestampMs ?? input?.timestamp ?? coords.timestampMs ?? coords.timestamp) ?? now;
  const receivedAtMs = finiteNumber(input?.receivedAtMs ?? coords.receivedAtMs);
  const lastCallbackAtMs = finiteNumber(input?.lastCallbackAtMs ?? coords.lastCallbackAtMs);
  const freshnessTimestampMs = finiteNumber(input?.freshnessTimestampMs ?? coords.freshnessTimestampMs);
  const speedMs = finiteNumber(coords.speedMs ?? coords.speed ?? input?.speedMs ?? input?.speed);
  const accuracy = finiteNumber(coords.accuracy ?? input?.accuracy);
  return {
    sampleSequence: finiteNumber(input?.sampleSequence ?? coords.sampleSequence),
    latitude,
    longitude,
    accuracy: accuracy !== null && accuracy >= 0 ? accuracy : null,
    heading: normalizeHeading(getHeadingCandidate(input, coords)),
    speedMs: speedMs !== null && speedMs >= 0 ? speedMs : null,
    timestampMs,
    receivedAtMs,
    lastCallbackAtMs,
    freshnessTimestampMs,
  };
}

export function isUsableLivePosition(position): boolean {
  return isUsableLatLon(position);
}

export function shouldShowHeading(position: any, previousPosition: any, lastHeadingState: any = null, now = Date.now()) {
  if (!isUsableLivePosition(position)) {
    return {
      heading: null,
      headingAvailable: false,
      headingStale: true,
      source: "none",
      timestampMs: now,
    };
  }

  const gpsHeading = normalizeHeading(position.heading);
  if (gpsHeading !== null) {
    return {
      heading: gpsHeading,
      headingAvailable: true,
      headingStale: false,
      source: "gps",
      timestampMs: now,
    };
  }

  const movedMeters = distanceMeters(previousPosition, position);
  const elapsedMs = Math.max(0, Number(position.timestampMs) - Number(previousPosition?.timestampMs || 0));
  const derivedSpeed = elapsedMs > 0 ? movedMeters / (elapsedMs / 1000) : null;
  const movingFastEnough = (position.speedMs ?? derivedSpeed ?? 0) >= MIN_MOVING_SPEED_MS;
  if (movedMeters >= MIN_DERIVED_HEADING_DISTANCE_M && movingFastEnough) {
    const derivedHeading = deriveHeadingFromPositions(previousPosition, position);
    if (derivedHeading !== null) {
      return {
        heading: derivedHeading,
        headingAvailable: true,
        headingStale: false,
        source: "movement",
        timestampMs: now,
      };
    }
  }

  if (
    lastHeadingState?.headingAvailable
    && normalizeHeading(lastHeadingState.heading) !== null
    && now - Number(lastHeadingState.timestampMs || 0) <= HEADING_TTL_MS
  ) {
    return {
      ...lastHeadingState,
      heading: normalizeHeading(lastHeadingState.heading),
      headingAvailable: true,
      headingStale: false,
      source: "last-known",
    };
  }

  return {
    heading: null,
    headingAvailable: false,
    headingStale: true,
    source: "none",
    timestampMs: now,
  };
}

export function buildUserPositionFeature(position: any, headingState: AnyRecord = {}, now = Date.now()) {
  if (!isUsableLivePosition(position)) return null;
  const freshnessMs = finiteNumber(
    position.receivedAtMs
      ?? position.lastCallbackAtMs
      ?? position.freshnessTimestampMs
      ?? position.timestampMs
  );
  const stale = freshnessMs === null || now - freshnessMs > POSITION_STALE_MS;
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [position.longitude, position.latitude],
    },
    properties: {
      type: "position",
      heading: headingState.headingAvailable ? normalizeHeading(headingState.heading) : 0,
      headingAvailable: headingState.headingAvailable === true && !headingState.headingStale && !stale,
      headingStale: headingState.headingStale === true,
      headingSource: headingState.source || "none",
      stale,
      accuracy: position.accuracy,
      speedMs: position.speedMs,
      timestampMs: position.timestampMs,
      receivedAtMs: position.receivedAtMs,
      lastCallbackAtMs: position.lastCallbackAtMs,
      freshnessTimestampMs: position.freshnessTimestampMs,
    },
  };
}
