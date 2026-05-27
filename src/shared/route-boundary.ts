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

export type RouteBoundaryStrategy = 'movement' | 'fallback' | 'empty';

export type GeoSample = {
  latitude: number;
  longitude: number;
  speedMs?: number | null;
  timestampMs?: number | null;
  [key: string]: unknown;
};

type IndexedGeoSample = {
  sample: GeoSample;
  originalIndex: number;
};

export type RouteBoundaryOptions = {
  mode?: string;
  movementThresholdM?: number;
  speedThresholdMs?: number;
  lookaheadWindow?: number;
};

type MovementSearchOptions = {
  movementThresholdM: number;
  speedThresholdMs: number;
  windowSize: number;
};

export type RouteBoundaryResult = {
  startSample: GeoSample | null;
  endSample: GeoSample | null;
  startIndex: number;
  endIndex: number;
  strategy: RouteBoundaryStrategy;
  sameBoundaryCoordinates?: boolean;
  sameBoundarySample?: boolean;
  canReuseBoundaryPlace?: boolean;
};

export type BoundaryPoint = {
  latitude: number;
  longitude: number;
  timestampMs: number | null;
  sampleIndex: number | null;
};

export type RouteBoundaryPlaceDisplay = {
  label: string;
  detail: string;
  raw: unknown;
};

type BoundaryDisplayOptions = {
  fallback?: string;
};

type PlaceResolverLike = {
  reversePlace(params: {
    latitude: number;
    longitude: number;
    zoom: number;
  }): Promise<{
    place?: (Record<string, unknown> & {
      countryCode?: string;
    }) | null;
    data?: unknown;
    meta?: unknown;
  }>;
};

type ReverseGeocodeOptions = BoundaryDisplayOptions & {
  zoom?: number;
};

type RouteBoundaryEnrichmentOptions = RouteBoundaryOptions &
  ReverseGeocodeOptions & {
    sessionId?: string;
    getCurrentSessionId?: () => string | null | undefined;
    onCountryCode?: (countryCode: string) => void;
  };

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

/**
 * Returns true when a sample has valid, non-zero coordinates.
 */
export function isValidGeoSample(sample: unknown): sample is GeoSample {
  if (!sample || typeof sample !== 'object') return false;
  const { latitude, longitude } = sample as Record<string, unknown>;
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
function haversineDistance(a: GeoSample, b: GeoSample): number {
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
function hasMinimumSpeed(sample: GeoSample, thresholdMs: number): boolean {
  if (!isFiniteNumber(sample.speedMs)) return true; // no speed info → neutral
  return sample.speedMs >= thresholdMs;
}

function haveSameCoordinates(left: GeoSample | null | undefined, right: GeoSample | null | undefined): boolean {
  return Boolean(
    left &&
    right &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

function haveSameRecordedPoint(left: GeoSample | null | undefined, right: GeoSample | null | undefined): boolean {
  if (!haveSameCoordinates(left, right)) return false;
  const leftTimestamp = left.timestampMs;
  const rightTimestamp = right.timestampMs;
  if (isFiniteNumber(leftTimestamp) || isFiniteNumber(rightTimestamp)) {
    return leftTimestamp === rightTimestamp;
  }
  return true;
}

function sampleDedupeKey(sample: GeoSample): string {
  const timestamp = isFiniteNumber(sample.timestampMs) ? sample.timestampMs : '';
  return `${sample.latitude}:${sample.longitude}:${timestamp}`;
}

function buildBoundaryResult(
  indexed: IndexedGeoSample[],
  startValidIndex: number,
  endValidIndex: number,
  strategy: RouteBoundaryStrategy
): RouteBoundaryResult {
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

function buildFallbackBoundary(indexed: IndexedGeoSample[]): RouteBoundaryResult {
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
function findForwardMovementStart(validSamples: GeoSample[], anchor: GeoSample, {
  movementThresholdM,
  speedThresholdMs,
  windowSize,
}: MovementSearchOptions): number {
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
function findBackwardMovementEnd(validSamples: GeoSample[], anchor: GeoSample, {
  movementThresholdM,
  speedThresholdMs,
  windowSize,
}: MovementSearchOptions): number {
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
export function getRouteBoundaryInputSamples(recording: unknown): GeoSample[] {
  if (Array.isArray(recording)) return recording.slice() as GeoSample[];
  if (!recording || typeof recording !== 'object') return [];

  const record = recording as {
    samples?: unknown;
    sampleLog?: unknown;
    firstSample?: unknown;
    lastSample?: unknown;
  };

  const embeddedSamples = Array.isArray(record.samples)
    ? record.samples
    : Array.isArray(record.sampleLog)
      ? record.sampleLog
      : [];
  const candidates: GeoSample[] = [];

  if (isValidGeoSample(record.firstSample)) {
    candidates.push(record.firstSample);
  }

  for (const sample of embeddedSamples) {
    if (isValidGeoSample(sample)) candidates.push(sample);
  }

  if (isValidGeoSample(record.lastSample)) {
    candidates.push(record.lastSample);
  }

  if (
    candidates.length > 1 &&
    candidates.every((sample) => isFiniteNumber(sample.timestampMs))
  ) {
    candidates.sort((left, right) => Number(left.timestampMs) - Number(right.timestampMs));
  }

  const seen = new Set<string>();
  const deduped: GeoSample[] = [];
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
export function getRouteBoundarySamples(samples: unknown, options: RouteBoundaryOptions = {}): RouteBoundaryResult {
  const empty: RouteBoundaryResult = {
    startSample: null,
    endSample: null,
    startIndex: -1,
    endIndex: -1,
    strategy: 'empty',
  };

  if (!Array.isArray(samples) || samples.length === 0) return empty;

  // 1. Filter to valid geo samples, keeping original indices
  const indexed: IndexedGeoSample[] = [];
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
export function buildBoundaryPoint(sample: unknown, sampleIndex: unknown): BoundaryPoint | null {
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstValue(obj: Record<string, unknown> | null | undefined, keys: readonly string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (let i = 0; i < keys.length; i++) {
    const v = normalizeText(obj[keys[i]]);
    if (v) return v;
  }
  return '';
}

function dedupe(parts: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
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
export function buildRouteBoundaryPlaceDisplay(
  place: unknown,
  options: BoundaryDisplayOptions = {}
): RouteBoundaryPlaceDisplay {
  const fallback = normalizeText(options.fallback) || '—';

  if (!place || typeof place !== 'object') {
    return { label: fallback, detail: '', raw: null };
  }

  const placeRecord = place as Record<string, unknown>;
  const address =
    placeRecord.address && typeof placeRecord.address === 'object'
      ? (placeRecord.address as Record<string, unknown>)
      : {};

  // Merge top-level normalised fields and embedded address for lookup
  const merged = { ...address, ...placeRecord };

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
    label = normalizeText(placeRecord.label) || normalizeText(placeRecord.displayName) || fallback;
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
export async function reverseGeocodeBoundarySample(
  sample: unknown,
  placeResolver: PlaceResolverLike | null | undefined,
  options: ReverseGeocodeOptions = {}
) {
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
export async function enrichRouteBoundaryPlaces(
  samples: unknown,
  placeResolver: PlaceResolverLike,
  options: RouteBoundaryEnrichmentOptions = {}
) {
  const { sessionId, getCurrentSessionId, onCountryCode } = options;

  function isStale() {
    if (!sessionId || typeof getCurrentSessionId !== 'function') return false;
    return getCurrentSessionId() !== sessionId;
  }

  const boundary = getRouteBoundarySamples(samples, options);
  if (!boundary.startSample && !boundary.endSample) return null;

  const startBoundaryPoint = buildBoundaryPoint(boundary.startSample, boundary.startIndex);
  const endBoundaryPoint = buildBoundaryPoint(boundary.endSample, boundary.endIndex);

  let startPlace: { label: string; detail: string; raw: unknown } | null = null;
  let endPlace: { label: string; detail: string; raw: unknown } | null = null;

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
