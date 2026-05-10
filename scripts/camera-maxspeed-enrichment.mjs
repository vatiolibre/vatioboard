const EARTH_RADIUS_M = 6371000;
const DEFAULT_MAX_DISTANCE_M = 50;
const DEFAULT_HIGH_CONFIDENCE_DISTANCE_M = 20;
const DEFAULT_MEDIUM_CONFIDENCE_DISTANCE_M = 35;
const DEFAULT_AMBIGUOUS_DISTANCE_M = 15;
const DEFAULT_BBOX_PADDING_DEGREES = 0.002;
const DEFAULT_SEGMENT_INDEX_CELL_DEGREES = 0.01;
const DEFAULT_SEGMENT_INDEX_MAX_CELLS_PER_SEGMENT = 512;
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_OVERPASS_MAX_RETRIES = 4;
const DEFAULT_OVERPASS_RETRY_INITIAL_DELAY_MS = 5000;
const DEFAULT_OVERPASS_RETRY_MAX_DELAY_MS = 120000;
const RETRYABLE_OVERPASS_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const METERS_PER_DEGREE_LAT = 111320;

const DRIVABLE_HIGHWAYS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
]);

const IGNORED_HIGHWAYS = new Set([
  "service",
  "footway",
  "path",
  "cycleway",
  "pedestrian",
  "steps",
  "bridleway",
  "corridor",
  "track",
]);

const UNPARSEABLE_MAXSPEED_VALUES = new Set([
  "none",
  "signals",
  "signal",
  "variable",
  "walk",
  "walking",
  "implicit",
  "default",
  "national",
  "urban",
  "rural",
]);

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWayId(id) {
  return Number.isFinite(Number(id)) ? Math.round(Number(id)) : id;
}

function readPointCoordinate(point, primary, alternate) {
  return finiteNumber(point?.[primary] ?? point?.[alternate]);
}

function normalizePoint(point) {
  if (Array.isArray(point)) {
    const lon = finiteNumber(point[0]);
    const lat = finiteNumber(point[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
  }

  const lat = readPointCoordinate(point, "lat", "latitude");
  const lon = readPointCoordinate(point, "lon", "longitude");
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function readCameraPoint(camera) {
  return normalizePoint({
    lat: camera?.lat ?? camera?.latitude,
    lon: camera?.lon ?? camera?.lng ?? camera?.longitude,
  });
}

function isFiniteCoordinate(point) {
  return point
    && Number.isFinite(point.lon)
    && Number.isFinite(point.lat)
    && point.lon >= -180
    && point.lon <= 180
    && point.lat >= -90
    && point.lat <= 90;
}

function normalizeMaxspeedText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export class OverpassRequestError extends Error {
  constructor(message, { status = 0, retryAfterMs = null, cause = null } = {}) {
    super(message);
    this.name = "OverpassRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    if (cause) this.cause = cause;
  }
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined || value === "") return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAtMs = Date.parse(String(value));
  if (!Number.isFinite(retryAtMs)) return null;
  return Math.max(0, retryAtMs - nowMs);
}

function readRetryAfterMs(headers) {
  return parseRetryAfterMs(headers?.get?.("retry-after"));
}

function getRetryDelayMs(error, retryIndex, options = {}) {
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0) {
    return Math.min(error.retryAfterMs, options.retryMaxDelayMs ?? DEFAULT_OVERPASS_RETRY_MAX_DELAY_MS);
  }

  const initialDelayMs = options.retryInitialDelayMs ?? DEFAULT_OVERPASS_RETRY_INITIAL_DELAY_MS;
  const maxDelayMs = options.retryMaxDelayMs ?? DEFAULT_OVERPASS_RETRY_MAX_DELAY_MS;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const exponentialDelayMs = initialDelayMs * (2 ** retryIndex);
  const jitterMultiplier = 0.75 + random() * 0.5;
  return Math.min(maxDelayMs, Math.round(exponentialDelayMs * jitterMultiplier));
}

function shouldRetryOverpassError(error) {
  if (error instanceof OverpassRequestError && error.status > 0) {
    return RETRYABLE_OVERPASS_STATUS_CODES.has(error.status);
  }
  return true;
}

export async function fetchOverpassJsonWithRetry({
  overpassUrl = DEFAULT_OVERPASS_URL,
  query,
  fetchImpl = globalThis.fetch,
  userAgent = "VatioBoard camera artifact builder",
  label = "Overpass request",
  maxRetries = DEFAULT_OVERPASS_MAX_RETRIES,
  retryInitialDelayMs = DEFAULT_OVERPASS_RETRY_INITIAL_DELAY_MS,
  retryMaxDelayMs = DEFAULT_OVERPASS_RETRY_MAX_DELAY_MS,
  sleepImpl = sleep,
  random = Math.random,
  onRetry = null,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this Node runtime.");
  }
  if (!query) {
    throw new Error("An Overpass query is required.");
  }

  const retries = Math.max(0, Math.round(Number(maxRetries) || 0));
  const body = new URLSearchParams({ data: query });
  let lastError = null;

  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    try {
      const response = await fetchImpl(overpassUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": userAgent,
        },
        body,
      });

      if (!response.ok) {
        throw new OverpassRequestError(`${label} failed with ${response.status}`, {
          status: response.status,
          retryAfterMs: readRetryAfterMs(response.headers),
        });
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof OverpassRequestError
        ? error
        : new OverpassRequestError(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });

      if (attemptIndex >= retries || !shouldRetryOverpassError(lastError)) {
        throw lastError;
      }

      const delayMs = getRetryDelayMs(lastError, attemptIndex, {
        retryInitialDelayMs,
        retryMaxDelayMs,
        random,
      });
      if (typeof onRetry === "function") {
        onRetry({
          label,
          error: lastError,
          attempt: attemptIndex + 1,
          maxRetries: retries,
          delayMs,
        });
      }
      await sleepImpl(delayMs);
    }
  }

  throw lastError;
}

export function parseMaxspeed(value) {
  const raw = normalizeMaxspeedText(value);
  if (!raw) {
    return { speedKph: null, raw: null, parsed: false, reason: "missing" };
  }

  const text = raw.toLowerCase();
  if (UNPARSEABLE_MAXSPEED_VALUES.has(text)) {
    return { speedKph: null, raw, parsed: false, reason: "non_numeric" };
  }

  if (text.includes(";")) {
    return { speedKph: null, raw, parsed: false, reason: "ambiguous" };
  }

  if (/@|\(|\)|\bconditional\b/.test(text)) {
    return { speedKph: null, raw, parsed: false, reason: "conditional" };
  }

  if (/^[a-z]{2,3}[-_:]/i.test(text) || /^[a-z]+:[a-z0-9_:-]+$/i.test(text)) {
    return { speedKph: null, raw, parsed: false, reason: "implicit_code" };
  }

  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(km\/h|kmh|kph|mph)?$/i);
  if (!match) {
    return { speedKph: null, raw, parsed: false, reason: "unsupported" };
  }

  const numeric = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { speedKph: null, raw, parsed: false, reason: "invalid_number" };
  }

  const unit = match[2]?.toLowerCase() || "km/h";
  const speedKph = Math.round(unit === "mph" ? numeric * 1.609344 : numeric);
  if (!Number.isFinite(speedKph) || speedKph <= 0 || speedKph > 400) {
    return { speedKph: null, raw, parsed: false, reason: "out_of_range" };
  }

  return { speedKph, raw, parsed: true, reason: "explicit_numeric" };
}

export function haversineDistanceMeters(a, b) {
  const start = normalizePoint(a);
  const end = normalizePoint(b);
  if (!isFiniteCoordinate(start) || !isFiniteCoordinate(end)) {
    return Number.POSITIVE_INFINITY;
  }

  const lat1 = toRadians(start.lat);
  const lat2 = toRadians(end.lat);
  const dLat = toRadians(end.lat - start.lat);
  const dLon = toRadians(end.lon - start.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function distancePointToSegmentMeters(point, segmentStart, segmentEnd) {
  const p = normalizePoint(point);
  const a = normalizePoint(segmentStart);
  const b = normalizePoint(segmentEnd);
  if (!isFiniteCoordinate(p) || !isFiniteCoordinate(a) || !isFiniteCoordinate(b)) {
    return Number.POSITIVE_INFINITY;
  }

  if (a.lat === b.lat && a.lon === b.lon) {
    return haversineDistanceMeters(p, a);
  }

  const referenceLat = toRadians(p.lat);
  const metersPerDegreeLon = Math.max(1, Math.cos(referenceLat) * METERS_PER_DEGREE_LAT);
  const ax = (a.lon - p.lon) * metersPerDegreeLon;
  const ay = (a.lat - p.lat) * METERS_PER_DEGREE_LAT;
  const bx = (b.lon - p.lon) * metersPerDegreeLon;
  const by = (b.lat - p.lat) * METERS_PER_DEGREE_LAT;
  const vx = bx - ax;
  const vy = by - ay;
  const denominator = vx * vx + vy * vy;

  if (denominator <= 0) {
    return Math.sqrt(ax * ax + ay * ay);
  }

  const t = Math.min(1, Math.max(0, -(ax * vx + ay * vy) / denominator));
  const closestX = ax + vx * t;
  const closestY = ay + vy * t;
  return Math.sqrt(closestX * closestX + closestY * closestY);
}

function getCameraTaggedHighway(camera) {
  const tags = camera?.tags || camera?.properties || {};
  return String(
    tags["camera:highway"]
      ?? tags["road:highway"]
      ?? tags.highway_class
      ?? tags.road
      ?? "",
  ).trim();
}

function isAllowedHighway(way, camera, options = {}) {
  const tags = way?.tags || {};
  const highway = String(tags.highway || "").trim();
  if (!highway) return false;

  const drivableHighways = options.drivableHighways || DRIVABLE_HIGHWAYS;
  const ignoredHighways = options.ignoredHighways || IGNORED_HIGHWAYS;
  if (drivableHighways.has(highway)) return true;

  if (ignoredHighways.has(highway)) {
    return getCameraTaggedHighway(camera) === highway;
  }

  return options.includeUnknownHighwayClasses === true;
}

function chooseWayMaxspeed(tags = {}) {
  const plain = parseMaxspeed(tags.maxspeed);
  if (plain.parsed) {
    return {
      speedKph: plain.speedKph,
      source: "nearest_road:maxspeed",
      raw: plain.raw,
    };
  }

  if (tags.maxspeed !== null && tags.maxspeed !== undefined && String(tags.maxspeed).trim() !== "") {
    return null;
  }

  const forwardPresent = tags["maxspeed:forward"] !== null
    && tags["maxspeed:forward"] !== undefined
    && String(tags["maxspeed:forward"]).trim() !== "";
  const backwardPresent = tags["maxspeed:backward"] !== null
    && tags["maxspeed:backward"] !== undefined
    && String(tags["maxspeed:backward"]).trim() !== "";
  const forward = parseMaxspeed(tags["maxspeed:forward"]);
  const backward = parseMaxspeed(tags["maxspeed:backward"]);

  // TODO: Once camera bearing/direction tags are normalized, match them to way direction
  // before using differing forward/backward limits.
  if (forwardPresent && backwardPresent) {
    if (forward.parsed && backward.parsed && forward.speedKph === backward.speedKph) {
      return {
        speedKph: forward.speedKph,
        source: "nearest_road:maxspeed:forward",
        raw: forward.raw,
      };
    }
    return null;
  }

  if (forwardPresent && forward.parsed) {
    return {
      speedKph: forward.speedKph,
      source: "nearest_road:maxspeed:forward",
      raw: forward.raw,
    };
  }

  if (backwardPresent && backward.parsed) {
    return {
      speedKph: backward.speedKph,
      source: "nearest_road:maxspeed:backward",
      raw: backward.raw,
    };
  }

  return null;
}

function confidenceForDistance(distanceM, options = {}) {
  const highDistanceM = options.highConfidenceDistanceM ?? DEFAULT_HIGH_CONFIDENCE_DISTANCE_M;
  const mediumDistanceM = options.mediumConfidenceDistanceM ?? DEFAULT_MEDIUM_CONFIDENCE_DISTANCE_M;
  if (distanceM <= highDistanceM) return "high";
  if (distanceM <= mediumDistanceM) return "medium";
  return "low";
}

function getClosestSegmentDistance(point, geometry) {
  let bestDistanceM = Number.POSITIVE_INFINITY;
  for (let index = 1; index < geometry.length; index += 1) {
    bestDistanceM = Math.min(
      bestDistanceM,
      distancePointToSegmentMeters(point, geometry[index - 1], geometry[index]),
    );
  }
  return bestDistanceM;
}

function getSegmentIndexCellSize(options = {}) {
  const configured = Number(options.segmentIndexCellDegrees);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SEGMENT_INDEX_CELL_DEGREES;
}

function getSegmentIndexKey(x, y) {
  return `${y}:${x}`;
}

function getSegmentIndexRange(west, south, east, north, cellSizeDegrees) {
  return {
    minX: Math.floor((west + 180) / cellSizeDegrees),
    maxX: Math.floor((east + 180) / cellSizeDegrees),
    minY: Math.floor((south + 90) / cellSizeDegrees),
    maxY: Math.floor((north + 90) / cellSizeDegrees),
  };
}

function addSegmentToIndexCell(cells, x, y, segment) {
  const key = getSegmentIndexKey(x, y);
  const bucket = cells.get(key);
  if (bucket) {
    bucket.push(segment);
  } else {
    cells.set(key, [segment]);
  }
}

function insertSegmentIntoIndex(index, segment, options = {}) {
  const cellSizeDegrees = index.cellSizeDegrees;
  const range = getSegmentIndexRange(
    segment.minLon,
    segment.minLat,
    segment.maxLon,
    segment.maxLat,
    cellSizeDegrees,
  );
  const cellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
  const maxCellsPerSegment = options.segmentIndexMaxCellsPerSegment
    ?? DEFAULT_SEGMENT_INDEX_MAX_CELLS_PER_SEGMENT;

  if (cellCount > maxCellsPerSegment) {
    // Long, low-detail segments are rare but expensive to duplicate into many cells.
    // Keep them in a small overflow list that is checked for every nearby-camera query.
    index.overflowSegments.push(segment);
    return;
  }

  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      addSegmentToIndexCell(index.cells, x, y, segment);
    }
  }
}

export function createRoadSegmentIndex(roadWays, options = {}) {
  const ways = Array.isArray(roadWays) ? roadWays : [];
  const cellSizeDegrees = getSegmentIndexCellSize(options);
  const index = {
    cells: new Map(),
    overflowSegments: [],
    cellSizeDegrees,
    segmentCount: 0,
    indexedWayCount: 0,
    skippedWayCount: 0,
  };

  for (const way of ways) {
    const speed = chooseWayMaxspeed(way?.tags || {});
    const geometry = Array.isArray(way?.geometry) ? way.geometry : [];
    if (!speed || geometry.length < 2) {
      index.skippedWayCount += 1;
      continue;
    }

    let indexedWay = false;
    for (let geometryIndex = 1; geometryIndex < geometry.length; geometryIndex += 1) {
      const start = normalizePoint(geometry[geometryIndex - 1]);
      const end = normalizePoint(geometry[geometryIndex]);
      if (!isFiniteCoordinate(start) || !isFiniteCoordinate(end)) continue;

      const segment = {
        way,
        wayId: normalizeWayId(way.id),
        speedKph: speed.speedKph,
        source: speed.source,
        raw: speed.raw,
        start,
        end,
        minLon: Math.min(start.lon, end.lon),
        maxLon: Math.max(start.lon, end.lon),
        minLat: Math.min(start.lat, end.lat),
        maxLat: Math.max(start.lat, end.lat),
      };
      insertSegmentIntoIndex(index, segment, options);
      index.segmentCount += 1;
      indexedWay = true;
    }

    if (indexedWay) index.indexedWayCount += 1;
    else index.skippedWayCount += 1;
  }

  return index;
}

function getRoadSegmentsNearPoint(segmentIndex, point, options = {}) {
  const cellSizeDegrees = segmentIndex?.cellSizeDegrees || getSegmentIndexCellSize(options);
  const maxDistanceM = options.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
  const latPaddingDegrees = maxDistanceM / METERS_PER_DEGREE_LAT;
  const metersPerDegreeLon = Math.max(1, Math.cos(toRadians(point.lat)) * METERS_PER_DEGREE_LAT);
  const lonPaddingDegrees = maxDistanceM / metersPerDegreeLon;
  const range = getSegmentIndexRange(
    point.lon - lonPaddingDegrees,
    point.lat - latPaddingDegrees,
    point.lon + lonPaddingDegrees,
    point.lat + latPaddingDegrees,
    cellSizeDegrees,
  );
  const segments = new Set(segmentIndex.overflowSegments || []);

  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      const bucket = segmentIndex.cells.get(getSegmentIndexKey(x, y));
      if (!bucket) continue;
      for (const segment of bucket) segments.add(segment);
    }
  }

  return segments;
}

function indexedSegmentToCandidate(segment, camera, cameraPoint, options = {}) {
  if (!isAllowedHighway(segment.way, camera, options)) return null;

  const distanceM = distancePointToSegmentMeters(cameraPoint, segment.start, segment.end);
  const maxDistanceM = options.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
  if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) return null;

  return {
    speedKph: segment.speedKph,
    speedMeta: {
      source: segment.source,
      confidence: confidenceForDistance(distanceM, options),
      wayId: segment.wayId,
      distanceM: Math.round(distanceM),
      raw: segment.raw,
    },
    sourceWayId: segment.wayId,
    distanceM,
    raw: segment.raw,
    source: segment.source,
  };
}

export function getWayCandidateSpeed(way, camera, options = {}) {
  const cameraPoint = readCameraPoint(camera);
  if (!isFiniteCoordinate(cameraPoint)) return null;
  if (!isAllowedHighway(way, camera, options)) return null;

  const speed = chooseWayMaxspeed(way?.tags || {});
  if (!speed) return null;

  const geometry = Array.isArray(way?.geometry) ? way.geometry : [];
  if (geometry.length < 2) return null;

  const distanceM = getClosestSegmentDistance(cameraPoint, geometry);
  const maxDistanceM = options.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
  if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) return null;

  return {
    speedKph: speed.speedKph,
    speedMeta: {
      source: speed.source,
      confidence: confidenceForDistance(distanceM, options),
      wayId: normalizeWayId(way.id),
      distanceM: Math.round(distanceM),
      raw: speed.raw,
    },
    sourceWayId: normalizeWayId(way.id),
    distanceM,
    raw: speed.raw,
    source: speed.source,
  };
}

function readCameraExplicitSpeed(camera) {
  const tags = camera?.tags || camera?.properties || camera || {};
  const candidates = [
    tags.maxspeed,
    tags.speed,
    tags.limit,
    tags["maxspeed:forward"],
    tags["maxspeed:backward"],
  ];

  for (const candidate of candidates) {
    const parsed = parseMaxspeed(candidate);
    if (parsed.parsed) return parsed;
  }

  return { speedKph: null, raw: null, parsed: false, reason: "missing" };
}

function getCameraKey(camera) {
  const id = camera?.id ?? camera?.osmId ?? camera?.osm_id;
  if (Number.isFinite(Number(id))) return `osm:${Math.round(Number(id))}`;
  const point = readCameraPoint(camera);
  return isFiniteCoordinate(point) ? `coord:${point.lon},${point.lat}` : "";
}

function isAmbiguousCandidate(best, candidate, options = {}) {
  if (!best || !candidate) return false;
  if (best.speedKph === candidate.speedKph) return false;
  const clearDistanceM = options.ambiguityClearDistanceM ?? DEFAULT_AMBIGUOUS_DISTANCE_M;
  return candidate.distanceM - best.distanceM < clearDistanceM;
}

function findBestRoadCandidate(camera, roadWays, options = {}) {
  const candidates = [];
  for (const way of roadWays) {
    const candidate = getWayCandidateSpeed(way, camera, options);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0) return { candidate: null, ambiguous: false };
  candidates.sort((a, b) => a.distanceM - b.distanceM);
  const best = candidates[0];
  const ambiguous = candidates.slice(1).some((candidate) =>
    isAmbiguousCandidate(best, candidate, options)
  );
  return {
    candidate: ambiguous ? null : best,
    ambiguous,
  };
}

function findBestRoadCandidateFromIndex(camera, segmentIndex, options = {}) {
  const cameraPoint = readCameraPoint(camera);
  if (!isFiniteCoordinate(cameraPoint) || !segmentIndex) {
    return { candidate: null, ambiguous: false };
  }

  const candidates = [];
  for (const segment of getRoadSegmentsNearPoint(segmentIndex, cameraPoint, options)) {
    const candidate = indexedSegmentToCandidate(segment, camera, cameraPoint, options);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0) return { candidate: null, ambiguous: false };
  candidates.sort((a, b) => a.distanceM - b.distanceM);
  const best = candidates[0];
  const ambiguous = candidates.slice(1).some((candidate) =>
    isAmbiguousCandidate(best, candidate, options)
  );
  return {
    candidate: ambiguous ? null : best,
    ambiguous,
  };
}

export function enrichCameraRecordsWithRoadSpeeds(records, roadWays, options = {}) {
  const cameras = Array.isArray(records) ? records : [];
  const ways = Array.isArray(roadWays) ? roadWays : [];
  const segmentIndex = options.roadSegmentIndex
    || (options.useSegmentIndex === false ? null : createRoadSegmentIndex(ways, options));

  return cameras.map((camera) => {
    const explicit = readCameraExplicitSpeed(camera);
    const key = getCameraKey(camera);
    if (explicit.parsed) {
      return {
        ...camera,
        key,
        speedKph: explicit.speedKph,
        speedMeta: {
          source: "camera:maxspeed",
          confidence: "high",
          raw: explicit.raw,
        },
        speedEnrichmentStatus: "explicit",
      };
    }

    const { candidate, ambiguous } = segmentIndex
      ? findBestRoadCandidateFromIndex(camera, segmentIndex, options)
      : findBestRoadCandidate(camera, ways, options);
    if (!candidate) {
      return {
        ...camera,
        key,
        speedKph: null,
        speedMeta: null,
        speedEnrichmentStatus: ambiguous ? "ambiguous" : "unknown",
      };
    }

    return {
      ...camera,
      key,
      speedKph: candidate.speedKph,
      speedMeta: candidate.speedMeta,
      speedEnrichmentStatus: "inferred",
    };
  });
}

function getBBoxForCameras(cameras, paddingDegrees = DEFAULT_BBOX_PADDING_DEGREES) {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;

  for (const camera of cameras) {
    const point = readCameraPoint(camera);
    if (!isFiniteCoordinate(point)) continue;
    west = Math.min(west, point.lon);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lon);
    north = Math.max(north, point.lat);
  }

  if (west > east || south > north) return null;

  return [
    Math.max(-180, west - paddingDegrees),
    Math.max(-90, south - paddingDegrees),
    Math.min(180, east + paddingDegrees),
    Math.min(90, north + paddingDegrees),
  ];
}

function normalizeBBox(bbox) {
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const west = finiteNumber(bbox[0]);
    const south = finiteNumber(bbox[1]);
    const east = finiteNumber(bbox[2]);
    const north = finiteNumber(bbox[3]);
    if ([west, south, east, north].every(Number.isFinite)) {
      return { west, south, east, north };
    }
  }

  const west = finiteNumber(bbox?.west ?? bbox?.minLon);
  const south = finiteNumber(bbox?.south ?? bbox?.minLat);
  const east = finiteNumber(bbox?.east ?? bbox?.maxLon);
  const north = finiteNumber(bbox?.north ?? bbox?.maxLat);
  if ([west, south, east, north].every(Number.isFinite)) {
    return { west, south, east, north };
  }

  return null;
}

export function buildOverpassRoadQueryForBBox(bbox, options = {}) {
  const normalized = normalizeBBox(bbox);
  if (!normalized) {
    throw new Error("A valid [west, south, east, north] bbox is required.");
  }

  const timeout = Number.isFinite(Number(options.timeoutSeconds))
    ? Math.max(1, Math.round(Number(options.timeoutSeconds)))
    : 180;
  const { west, south, east, north } = normalized;
  const overpassBbox = `${south},${west},${north},${east}`;

  return `[out:json][timeout:${timeout}];
(
  way(${overpassBbox})["highway"]["maxspeed"];
  way(${overpassBbox})["highway"]["maxspeed:forward"];
  way(${overpassBbox})["highway"]["maxspeed:backward"];
);
out tags geom;`;
}

export async function fetchRoadWaysForCameraBatch(cameras, options = {}) {
  const bbox = options.bbox || getBBoxForCameras(
    cameras,
    options.bboxPaddingDegrees ?? DEFAULT_BBOX_PADDING_DEGREES,
  );
  if (!bbox) {
    return {
      bbox: null,
      query: "",
      ways: [],
    };
  }

  const query = buildOverpassRoadQueryForBBox(bbox, options);
  const payload = await fetchOverpassJsonWithRetry({
    overpassUrl: options.overpassUrl || DEFAULT_OVERPASS_URL,
    query,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    userAgent: options.userAgent || "VatioBoard camera maxspeed enrichment",
    label: options.label || "Overpass road request",
    maxRetries: options.maxRetries,
    retryInitialDelayMs: options.retryInitialDelayMs,
    retryMaxDelayMs: options.retryMaxDelayMs,
    sleepImpl: options.sleepImpl,
    random: options.random,
    onRetry: options.onRetry,
  });
  if (!Array.isArray(payload?.elements)) {
    throw new Error("Overpass road response did not include an elements array.");
  }

  return {
    bbox,
    query,
    ways: payload.elements.filter((element) =>
      element?.type === "way" && Array.isArray(element.geometry)
    ),
  };
}
