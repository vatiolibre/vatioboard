/**
 * Route boundary selection and place display for route endpoints.
 *
 * This module is the single source of truth for deciding which samples
 * represent the real start and end of a route or run. It replaces the
 * naive first/last sample approach with movement-aware heuristics.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum distance (m) from the first valid sample before we consider
 *  that meaningful movement has started. Keeps parked lead-in points out. */
const DEFAULT_MOVEMENT_THRESHOLD_M = 15;

/** Minimum speed (m/s) to treat a sample as "moving" when speed data
 *  is available (~3.6 km/h / ~2.2 mph). */
const DEFAULT_SPEED_THRESHOLD_MS = 1.0;

/** How many consecutive samples to look ahead/back when confirming
 *  movement is sustained (avoids single-sample GPS jitter). */
const DEFAULT_LOOKAHEAD_WINDOW = 3;

/** Earth radius in meters for haversine. */
const EARTH_RADIUS_M = 6371000;

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

/**
 * Returns true when a sample has valid, non-zero coordinates.
 */
export function isValidGeoSample(sample) {
  if (!sample || typeof sample !== 'object') return false;
  const { latitude, longitude } = sample;
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return false;
  // Reject (0, 0) – Null Island / uninitialized
  if (latitude === 0 && longitude === 0) return false;
  // Reject out-of-range
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

/**
 * Haversine distance between two {latitude, longitude} objects in meters.
 */
function haversineDistance(a, b) {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Returns true when the sample meets the minimum speed threshold (if
 * speed data is present). Samples without speed are considered neutral
 * so speed alone won't exclude them.
 */
function hasMinimumSpeed(sample, thresholdMs) {
  if (!isFiniteNumber(sample.speedMs)) return true; // no speed info → neutral
  return sample.speedMs >= thresholdMs;
}

function haveSameCoordinates(left, right) {
  return Boolean(
    left &&
    right &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

function haveSameRecordedPoint(left, right) {
  if (!haveSameCoordinates(left, right)) return false;
  const leftTimestamp = left.timestampMs;
  const rightTimestamp = right.timestampMs;
  if (isFiniteNumber(leftTimestamp) || isFiniteNumber(rightTimestamp)) {
    return leftTimestamp === rightTimestamp;
  }
  return true;
}

function sampleDedupeKey(sample) {
  const timestamp = isFiniteNumber(sample.timestampMs) ? sample.timestampMs : '';
  return `${sample.latitude}:${sample.longitude}:${timestamp}`;
}

function buildBoundaryResult(indexed, startValidIndex, endValidIndex, strategy) {
  const start = indexed[startValidIndex];
  const end = indexed[endValidIndex];
  const sameBoundaryCoordinates = haveSameCoordinates(start.sample, end.sample);
  const sameBoundarySample =
    startValidIndex === endValidIndex || haveSameRecordedPoint(start.sample, end.sample);

  return {
    startSample: start.sample,
    endSample: end.sample,
    startIndex: start.originalIndex,
    endIndex: end.originalIndex,
    strategy,
    sameBoundaryCoordinates,
    sameBoundarySample,
    canReuseBoundaryPlace: sameBoundaryCoordinates,
  };
}

function buildFallbackBoundary(indexed) {
  return buildBoundaryResult(indexed, 0, indexed.length - 1, 'fallback');
}

// ---------------------------------------------------------------------------
// Boundary selection
// ---------------------------------------------------------------------------

/**
 * Scans forward from `startIndex` until `windowSize` consecutive samples
 * show movement (speed ≥ threshold or distance from anchor ≥ threshold).
 * Returns the index of the first sample in that window, or -1.
 */
function findForwardMovementStart(validSamples, anchor, {
  movementThresholdM,
  speedThresholdMs,
  windowSize,
}) {
  let consecutiveMoving = 0;
  let windowStartIndex = -1;

  for (let i = 0; i < validSamples.length; i++) {
    const sample = validSamples[i];
    const distanceFromAnchor = haversineDistance(anchor, sample);
    const isMoving = distanceFromAnchor >= movementThresholdM || hasMinimumSpeed(sample, speedThresholdMs);

    if (isMoving) {
      if (consecutiveMoving === 0) windowStartIndex = i;
      consecutiveMoving++;
      if (consecutiveMoving >= windowSize) return windowStartIndex;
    } else {
      consecutiveMoving = 0;
      windowStartIndex = -1;
    }
  }

  return -1;
}

/**
 * Scans backward from the end until `windowSize` consecutive samples
 * show movement. Returns the index of the last sample in that window,
 * or -1.
 */
function findBackwardMovementEnd(validSamples, anchor, {
  movementThresholdM,
  speedThresholdMs,
  windowSize,
}) {
  let consecutiveMoving = 0;
  let windowEndIndex = -1;

  for (let i = validSamples.length - 1; i >= 0; i--) {
    const sample = validSamples[i];
    const distanceFromAnchor = haversineDistance(anchor, sample);
    const isMoving = distanceFromAnchor >= movementThresholdM || hasMinimumSpeed(sample, speedThresholdMs);

    if (isMoving) {
      if (consecutiveMoving === 0) windowEndIndex = i;
      consecutiveMoving++;
      if (consecutiveMoving >= windowSize) return windowEndIndex;
    } else {
      consecutiveMoving = 0;
      windowEndIndex = -1;
    }
  }

  return -1;
}

/**
 * Build a boundary-selection input from a recording/session object that may
 * carry full samples, firstSample/lastSample metadata, or a tail-only buffer.
 */
export function getRouteBoundaryInputSamples(recording) {
  if (Array.isArray(recording)) return recording.slice();
  if (!recording || typeof recording !== 'object') return [];

  const embeddedSamples = Array.isArray(recording.samples)
    ? recording.samples
    : Array.isArray(recording.sampleLog)
      ? recording.sampleLog
      : [];
  const candidates = [];

  if (isValidGeoSample(recording.firstSample)) {
    candidates.push(recording.firstSample);
  }

  for (const sample of embeddedSamples) {
    if (isValidGeoSample(sample)) candidates.push(sample);
  }

  if (isValidGeoSample(recording.lastSample)) {
    candidates.push(recording.lastSample);
  }

  if (
    candidates.length > 1 &&
    candidates.every((sample) => isFiniteNumber(sample.timestampMs))
  ) {
    candidates.sort((left, right) => left.timestampMs - right.timestampMs);
  }

  const seen = new Set();
  const deduped = [];
  for (const sample of candidates) {
    const key = sampleDedupeKey(sample);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(sample);
  }

  return deduped;
}

/**
 * Select the real start and end samples from an ordered array of geo
 * samples, skipping parked lead-in/tail points.
 *
 * Options:
 *   mode – "speed" (default) or "accel"
 *   movementThresholdM – minimum haversine distance for movement
 *   speedThresholdMs – minimum speed (m/s) to treat sample as moving
 *   lookaheadWindow – consecutive-sample confirmation window size
 *
 * Returns:
 *   { startSample, endSample, startIndex, endIndex, strategy }
 *
 * strategy describes which path was taken:
 *   "movement"   – meaningful boundaries found
 *   "fallback"   – could not find movement; using first/last valid sample
 *   "empty"      – no valid samples at all
 */
export function getRouteBoundarySamples(samples, options = {}) {
  const empty = { startSample: null, endSample: null, startIndex: -1, endIndex: -1, strategy: 'empty' };

  if (!Array.isArray(samples) || samples.length === 0) return empty;

  // 1. Filter to valid geo samples, keeping original indices
  const indexed = [];
  for (let i = 0; i < samples.length; i++) {
    if (isValidGeoSample(samples[i])) {
      indexed.push({ sample: samples[i], originalIndex: i });
    }
  }
  if (indexed.length === 0) return empty;

  const validSamples = indexed.map((entry) => entry.sample);

  const movementThresholdM = isFiniteNumber(options.movementThresholdM)
    ? options.movementThresholdM
    : DEFAULT_MOVEMENT_THRESHOLD_M;
  const speedThresholdMs = isFiniteNumber(options.speedThresholdMs)
    ? options.speedThresholdMs
    : DEFAULT_SPEED_THRESHOLD_MS;
  const lookaheadWindow = isFiniteNumber(options.lookaheadWindow)
    ? Math.max(1, options.lookaheadWindow)
    : DEFAULT_LOOKAHEAD_WINDOW;

  if (indexed.length < lookaheadWindow) {
    return buildFallbackBoundary(indexed);
  }

  // 2. Find start boundary – first sample where sustained movement begins
  //    Anchor = first valid sample (the parked position to measure displacement from)
  const anchor = validSamples[0];
  const startValidIndex = findForwardMovementStart(validSamples, anchor, {
    movementThresholdM,
    speedThresholdMs,
    windowSize: lookaheadWindow,
  });

  // 3. Find end boundary – last sample before movement meaningfully ends
  //    Anchor = last valid sample (the parked tail position)
  const tailAnchor = validSamples[validSamples.length - 1];
  const endValidIndex = findBackwardMovementEnd(validSamples, tailAnchor, {
    movementThresholdM,
    speedThresholdMs,
    windowSize: lookaheadWindow,
  });

  // 4. Validate boundaries
  if (startValidIndex >= 0 && endValidIndex >= 0 && startValidIndex <= endValidIndex) {
    const collapsedDistinctRoute = Boolean(
      startValidIndex === endValidIndex &&
      indexed.length > 1 &&
      !haveSameCoordinates(indexed[0].sample, indexed[indexed.length - 1].sample)
    );

    if (!collapsedDistinctRoute) {
      return buildBoundaryResult(indexed, startValidIndex, endValidIndex, 'movement');
    }
  }

  // 5. Fallback – movement heuristics didn't converge; use first/last valid
  return buildFallbackBoundary(indexed);
}

// ---------------------------------------------------------------------------
// Boundary point serialization
// ---------------------------------------------------------------------------

/**
 * Build the persisted boundary-point object from a sample and its
 * original index in the samples array.
 */
export function buildBoundaryPoint(sample, sampleIndex) {
  if (!sample || !isValidGeoSample(sample)) return null;
  return {
    latitude: sample.latitude,
    longitude: sample.longitude,
    timestampMs: isFiniteNumber(sample.timestampMs) ? sample.timestampMs : null,
    sampleIndex: isFiniteNumber(sampleIndex) ? sampleIndex : null,
  };
}

// ---------------------------------------------------------------------------
// Route-boundary place display
// ---------------------------------------------------------------------------

/** Keys to prefer for the main label (city/locality > suburb/neighborhood). */
const BOUNDARY_LABEL_KEYS = [
  'city',
  'town',
  'village',
  'municipality',
  'county',
];

/** Keys to fall back to when no city-level name is available. */
const BOUNDARY_LABEL_FALLBACK_KEYS = [
  'suburb',
  'city_district',
  'borough',
  'quarter',
  'neighbourhood',
  'hamlet',
];

/** Keys that provide broader geographic context (state, country). */
const BOUNDARY_DETAIL_KEYS = [
  'state',
  'state_district',
  'region',
  'province',
  'country',
];

const BOUNDARY_ROAD_KEYS = ['road', 'pedestrian', 'footway', 'street', 'residential', 'path'];

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstValue(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (let i = 0; i < keys.length; i++) {
    const v = normalizeText(obj[keys[i]]);
    if (v) return v;
  }
  return '';
}

function dedupe(parts) {
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    const trimmed = normalizeText(part);
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(trimmed);
  }
  return result;
}

/**
 * Build a user-friendly display object for a route-boundary place.
 *
 * Prioritises city/locality over suburb/neighborhood so that route
 * endpoint names are stable and intuitive.
 *
 * place – a Nominatim-normalized place object (from normalizePlace or
 *         raw address response).
 *
 * Returns: { label, detail, raw }
 *   label  – primary endpoint name (city or road + city)
 *   detail – broader context (state, country)
 *   raw    – the original place object reference
 */
export function buildRouteBoundaryPlaceDisplay(place, options = {}) {
  const fallback = normalizeText(options.fallback) || '—';

  if (!place || typeof place !== 'object') {
    return { label: fallback, detail: '', raw: null };
  }

  const address = (place.address && typeof place.address === 'object') ? place.address : {};

  // Merge top-level normalised fields and embedded address for lookup
  const merged = { ...address, ...place };

  // 1. Derive meaningful label: prefer city-level, include road if useful
  const cityLevel = firstValue(merged, BOUNDARY_LABEL_KEYS);
  const suburbLevel = firstValue(merged, BOUNDARY_LABEL_FALLBACK_KEYS);
  const road = firstValue(merged, BOUNDARY_ROAD_KEYS);

  let label = '';
  if (cityLevel) {
    // Include road when it's present and differs from city name
    if (road && road.toLowerCase() !== cityLevel.toLowerCase()) {
      label = `${road}, ${cityLevel}`;
    } else {
      label = cityLevel;
    }
  } else if (suburbLevel) {
    // No city available – suburb is the best we have
    if (road && road.toLowerCase() !== suburbLevel.toLowerCase()) {
      label = `${road}, ${suburbLevel}`;
    } else {
      label = suburbLevel;
    }
  } else if (road) {
    label = road;
  } else {
    // Last resort: use whatever normalizePlace stored as label
    label = normalizeText(place.label) || normalizeText(place.displayName) || fallback;
  }

  // 2. Derive detail: state / country, avoiding duplication with label
  const detailParts = dedupe(
    BOUNDARY_DETAIL_KEYS.map((key) => normalizeText(merged[key]))
  ).filter((part) => part.toLowerCase() !== label.toLowerCase());
  const detail = detailParts.join(', ');

  return { label, detail, raw: place };
}

// ---------------------------------------------------------------------------
// Async reverse geocoding helper
// ---------------------------------------------------------------------------

/**
 * Reverse geocode a boundary sample using a placeResolver.
 *
 * Returns { place, boundaryDisplay } or null on failure.
 */
export async function reverseGeocodeBoundarySample(sample, placeResolver, options = {}) {
  if (!sample || !isValidGeoSample(sample)) return null;
  if (!placeResolver || typeof placeResolver.reversePlace !== 'function') return null;

  try {
    const response = await placeResolver.reversePlace({
      latitude: sample.latitude,
      longitude: sample.longitude,
      zoom: isFiniteNumber(options.zoom) ? options.zoom : 18,
    });

    if (!response.place) return null;

    return {
      place: response.place,
      boundaryDisplay: buildRouteBoundaryPlaceDisplay(response.place, options),
      countryCode: response.place.countryCode || '',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Full enrichment pipeline
// ---------------------------------------------------------------------------

/**
 * Given an ordered samples array and a placeResolver, computes boundary
 * points and reverse-geocodes them. Returns the full boundary payload
 * ready to merge into a session/run.
 *
 * Options:
 *   mode – "speed" | "accel"
 *   sessionId – optional; used for stale-enrichment guard
 *   getCurrentSessionId – optional fn; if provided and the return value
 *       no longer matches sessionId, enrichment is aborted (stale guard)
 *   onCountryCode – optional callback(countryCode) for unit bootstrap
 *   zoom – Nominatim zoom level (default 18)
 *   ...boundary options (movementThresholdM, speedThresholdMs, etc.)
 *
 * Returns:
 *   {
 *     startBoundaryPoint, endBoundaryPoint,
 *     startPlace, endPlace,
 *     boundaryStrategy
 *   }
 *   or null if enrichment was stale or fully failed.
 */
export async function enrichRouteBoundaryPlaces(samples, placeResolver, options = {}) {
  const { sessionId, getCurrentSessionId, onCountryCode } = options;

  function isStale() {
    if (!sessionId || typeof getCurrentSessionId !== 'function') return false;
    return getCurrentSessionId() !== sessionId;
  }

  const boundary = getRouteBoundarySamples(samples, options);
  if (!boundary.startSample && !boundary.endSample) return null;

  const startBoundaryPoint = buildBoundaryPoint(boundary.startSample, boundary.startIndex);
  const endBoundaryPoint = buildBoundaryPoint(boundary.endSample, boundary.endIndex);

  let startPlace = null;
  let endPlace = null;

  // Reverse geocode start
  if (boundary.startSample) {
    if (isStale()) return null;
    const startResult = await reverseGeocodeBoundarySample(boundary.startSample, placeResolver, options);
    if (isStale()) return null;
    if (startResult) {
      if (startResult.countryCode && typeof onCountryCode === 'function') {
        onCountryCode(startResult.countryCode);
      }
      startPlace = {
        label: startResult.boundaryDisplay.label,
        detail: startResult.boundaryDisplay.detail,
        raw: startResult.place,
      };
    }
  }

  // Reverse geocode end – reuse start if coordinates are identical
  if (boundary.endSample) {
    if (boundary.canReuseBoundaryPlace && startPlace) {
      endPlace = { ...startPlace };
    } else {
      if (isStale()) return null;
      const endResult = await reverseGeocodeBoundarySample(boundary.endSample, placeResolver, options);
      if (isStale()) return null;
      if (endResult) {
        if (endResult.countryCode && typeof onCountryCode === 'function') {
          onCountryCode(endResult.countryCode);
        }
        endPlace = {
          label: endResult.boundaryDisplay.label,
          detail: endResult.boundaryDisplay.detail,
          raw: endResult.place,
        };
      }
    }
  }

  return {
    startBoundaryPoint,
    endBoundaryPoint,
    startPlace,
    endPlace,
    boundaryStrategy: boundary.strategy,
    boundaryStartIndex: boundary.startIndex,
    boundaryEndIndex: boundary.endIndex,
    sameBoundaryCoordinates: boundary.sameBoundaryCoordinates,
    sameBoundarySample: boundary.sameBoundarySample,
    canReuseBoundaryPlace: boundary.canReuseBoundaryPlace,
  };
}
