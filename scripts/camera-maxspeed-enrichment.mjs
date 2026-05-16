const EARTH_RADIUS_M = 6371000;
const DEFAULT_MAX_DISTANCE_M = 50;
const DEFAULT_HIGH_CONFIDENCE_DISTANCE_M = 20;
const DEFAULT_MEDIUM_CONFIDENCE_DISTANCE_M = 35;
const DEFAULT_AMBIGUOUS_DISTANCE_M = 15;
const DEFAULT_BBOX_PADDING_DEGREES = 0.002;
const DEFAULT_SEGMENT_INDEX_CELL_DEGREES = 0.01;
const DEFAULT_SEGMENT_INDEX_MAX_CELLS_PER_SEGMENT = 512;
const DEFAULT_APPROACH_AMBIGUOUS_BEARING_DEG = 25;
const DEFAULT_MAX_APPROACH_CORRIDORS = 4;
const DEFAULT_APPROACH_DISTANCE_BAND_M = 12;
const DEFAULT_APPROACH_BEARING_CLUSTER_DEG = 25;
const DEFAULT_APPROACH_SIMILAR_BEARING_DEG = 15;
const DEFAULT_APPROACH_INTERSECTION_DISTANCE_M = 18;
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
  "busway",
  "construction",
  "proposed",
  "raceway",
  "escape",
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

const CONSTRUCTION_HIGHWAYS = new Set(["construction", "proposed"]);

const ALWAYS_REJECTED_SERVICE_VALUES = new Set([
  "driveway",
  "parking_aisle",
  "emergency_access",
  "drive-through",
  "drive_through",
  "bus",
  "private",
]);

const ACCESS_TAG_INFOS = [
  { key: "access", specificity: 0, restrictedReason: "access-private" },
  { key: "vehicle", specificity: 1, restrictedReason: "motor-vehicle-restricted" },
  { key: "motor_vehicle", specificity: 2, restrictedReason: "motor-vehicle-restricted" },
  { key: "motorcar", specificity: 3, restrictedReason: "motor-vehicle-restricted" },
];

const LANE_ACCESS_TAG_INFOS = [
  { key: "access:lanes", specificity: 0 },
  { key: "vehicle:lanes", specificity: 1 },
  { key: "motor_vehicle:lanes", specificity: 2 },
  { key: "motorcar:lanes", specificity: 3 },
];

const ACCESS_ALLOWED_VALUES = new Set([
  "yes",
  "designated",
  "permissive",
  "destination",
  "customers",
]);

const ACCESS_RESTRICTED_VALUES = new Set([
  "no",
  "private",
  "agricultural",
  "forestry",
  "delivery",
  "delivery_only",
  "emergency",
  "emergency_only",
  "emergency-only",
]);

const LANE_RESTRICTED_VALUES = new Set([
  ...ACCESS_RESTRICTED_VALUES,
  "psv",
  "bus",
  "taxi",
]);

const LANE_TRANSIT_ONLY_VALUES = new Set([
  "psv",
  "bus",
  "taxi",
]);

const TRANSIT_DESIGNATED_VALUES = new Set(["yes", "designated"]);
const ROAD_INDEX_EARLY_SKIP_REASONS = new Set([
  "access-private",
  "motor-vehicle-restricted",
  "bus-only",
  "service-private",
  "construction",
  "unknown-highway",
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

function roundCoordinate(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) ? Number(number.toFixed(6)) : null;
}

function normalizeHeadingDeg(value) {
  const number = finiteNumber(value);
  if (!Number.isFinite(number)) return null;
  return ((number % 360) + 360) % 360;
}

function bearingDegrees(start, end) {
  const a = normalizePoint(start);
  const b = normalizePoint(end);
  if (!isFiniteCoordinate(a) || !isFiniteCoordinate(b)) return null;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeHeadingDeg(Math.atan2(y, x) * 180 / Math.PI);
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

function normalizeOsmTagValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, "_");
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
  return normalizeOsmTagValue(
    tags["camera:highway"]
      ?? tags["road:highway"]
      ?? tags.highway_class
      ?? tags.road
      ?? "",
  );
}

function collectionHasNormalizedValue(collection, value) {
  const normalized = normalizeOsmTagValue(value);
  if (!collection || !normalized) return false;
  if (typeof collection.has === "function") {
    if (collection.has(normalized) || collection.has(value)) return true;
  }
  if (typeof collection[Symbol.iterator] === "function") {
    for (const entry of collection) {
      if (normalizeOsmTagValue(entry) === normalized) return true;
    }
  }
  return false;
}

function splitAccessValues(value) {
  const normalized = normalizeOsmTagValue(value);
  if (!normalized) return [];
  return normalized
    .split(/[;,]/)
    .map((part) => normalizeOsmTagValue(part))
    .filter(Boolean);
}

function classifyAccessValue(value) {
  const values = splitAccessValues(value);
  if (values.length === 0) return null;

  const restricted = values.find((part) => ACCESS_RESTRICTED_VALUES.has(part));
  if (restricted) return { kind: "reject", value: restricted };

  if (values.every((part) => ACCESS_ALLOWED_VALUES.has(part))) {
    return { kind: "allow", value: values[0] };
  }

  return { kind: "unknown", value: normalizeOsmTagValue(value) };
}

function classifyConditionalAccessValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  for (const clause of raw.split(";")) {
    const [accessPart] = clause.split("@");
    const classification = classifyAccessValue(accessPart);
    if (classification?.kind === "reject") return classification;
  }

  return null;
}

function analyzePrivateCarAccess(tags = {}) {
  let strongestDirect = null;

  for (let index = ACCESS_TAG_INFOS.length - 1; index >= 0; index -= 1) {
    const info = ACCESS_TAG_INFOS[index];
    const classification = classifyAccessValue(tags[info.key]);
    if (!classification || classification.kind === "unknown") continue;
    strongestDirect = { ...info, ...classification };
    break;
  }

  if (strongestDirect?.kind === "reject") {
    return {
      eligible: false,
      reason: strongestDirect.restrictedReason,
      explicitPrivateCarAllowed: false,
      allowSpecificity: -1,
    };
  }

  const minimumConditionalSpecificity = strongestDirect?.kind === "allow"
    ? strongestDirect.specificity
    : 0;
  for (let index = ACCESS_TAG_INFOS.length - 1; index >= 0; index -= 1) {
    const info = ACCESS_TAG_INFOS[index];
    if (info.specificity < minimumConditionalSpecificity) continue;
    const classification = classifyConditionalAccessValue(tags[`${info.key}:conditional`]);
    if (classification?.kind === "reject") {
      return {
        eligible: false,
        reason: info.restrictedReason,
        explicitPrivateCarAllowed: false,
        allowSpecificity: -1,
      };
    }
  }

  return {
    eligible: true,
    reason: "allowed",
    explicitPrivateCarAllowed: strongestDirect?.kind === "allow",
    allowSpecificity: strongestDirect?.kind === "allow" ? strongestDirect.specificity : -1,
  };
}

function tagHasValueIn(tags = {}, key, acceptedValues) {
  return splitAccessValues(tags[key]).some((value) => acceptedValues.has(value));
}

function hasBusOnlyRestriction(tags = {}, highway, accessEligibility) {
  if (highway === "busway") return true;

  const busway = normalizeOsmTagValue(tags.busway);
  if (busway && busway !== "no" && accessEligibility.explicitPrivateCarAllowed !== true) {
    return true;
  }

  const transitDesignated = tagHasValueIn(tags, "bus", TRANSIT_DESIGNATED_VALUES)
    || tagHasValueIn(tags, "psv", TRANSIT_DESIGNATED_VALUES);
  return transitDesignated && accessEligibility.eligible === false;
}

function classifyLaneValue(value) {
  const values = splitAccessValues(value);
  if (values.length === 0) return { kind: "unknown", values };
  if (values.some((part) => ACCESS_ALLOWED_VALUES.has(part))) return { kind: "allow", values };
  if (values.every((part) => LANE_RESTRICTED_VALUES.has(part))) return { kind: "reject", values };
  return { kind: "unknown", values };
}

function analyzeLaneTagValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { kind: "unknown", reason: "" };
  const laneClassifications = raw.split("|").map((laneValue) => classifyLaneValue(laneValue));
  if (laneClassifications.some((classification) => classification.kind === "allow")) {
    return { kind: "allow", reason: "" };
  }
  if (
    laneClassifications.length > 0
    && laneClassifications.every((classification) => classification.kind === "reject")
  ) {
    const restrictedValues = laneClassifications.flatMap((classification) => classification.values);
    const reason = restrictedValues.length > 0
      && restrictedValues.every((part) => LANE_TRANSIT_ONLY_VALUES.has(part))
      ? "bus-only"
      : "motor-vehicle-restricted";
    return { kind: "reject", reason };
  }
  return { kind: "unknown", reason: "" };
}

function analyzeLaneAccess(tags = {}) {
  for (let index = LANE_ACCESS_TAG_INFOS.length - 1; index >= 0; index -= 1) {
    const info = LANE_ACCESS_TAG_INFOS[index];
    const classification = analyzeLaneTagValue(tags[info.key]);
    if (classification.kind === "allow") return { eligible: true, reason: "allowed" };
    if (classification.kind === "reject") {
      return { eligible: false, reason: classification.reason };
    }
  }

  return { eligible: true, reason: "allowed" };
}

function hasConstructionRestriction(tags = {}, highway) {
  if (CONSTRUCTION_HIGHWAYS.has(highway)) return true;
  const construction = normalizeOsmTagValue(tags.construction);
  return Boolean(construction && construction !== "no");
}

export function getPrivateCarRoadEligibility(way, camera, options = {}) {
  const tags = way?.tags || {};
  const highway = normalizeOsmTagValue(tags.highway);
  if (!highway) return { eligible: false, reason: "unknown-highway" };

  if (hasConstructionRestriction(tags, highway)) {
    return { eligible: false, reason: "construction" };
  }

  const accessEligibility = analyzePrivateCarAccess(tags);
  if (hasBusOnlyRestriction(tags, highway, accessEligibility)) {
    return { eligible: false, reason: "bus-only" };
  }
  if (!accessEligibility.eligible) {
    return { eligible: false, reason: accessEligibility.reason };
  }

  const laneEligibility = analyzeLaneAccess(tags);
  if (!laneEligibility.eligible) {
    return { eligible: false, reason: laneEligibility.reason };
  }

  if (highway === "service") {
    const service = normalizeOsmTagValue(tags.service);
    if (
      ALWAYS_REJECTED_SERVICE_VALUES.has(service)
      || options.includePublicServiceRoads !== true
    ) {
      return { eligible: false, reason: "service-private" };
    }
    return { eligible: true, reason: "allowed" };
  }

  const drivableHighways = options.drivableHighways || DRIVABLE_HIGHWAYS;
  if (collectionHasNormalizedValue(drivableHighways, highway)) {
    return { eligible: true, reason: "allowed" };
  }

  const ignoredHighways = options.ignoredHighways || IGNORED_HIGHWAYS;
  if (collectionHasNormalizedValue(ignoredHighways, highway)) {
    if (getCameraTaggedHighway(camera) === highway) {
      return { eligible: true, reason: "camera-tagged-ignored-highway" };
    }
    return { eligible: false, reason: "ignored-highway" };
  }

  if (options.includeUnknownHighwayClasses === true) {
    return { eligible: true, reason: "allowed" };
  }

  return { eligible: false, reason: "unknown-highway" };
}

function isAllowedHighway(way, camera, options = {}) {
  return getPrivateCarRoadEligibility(way, camera, options).eligible;
}

function incrementReasonCount(counts, reason, amount = 1) {
  if (!reason) return;
  counts[reason] = (counts[reason] || 0) + amount;
}

function recordRoadSkipReason(stats, reason, amount = 1) {
  if (!stats || !reason) return;
  if (!stats.skippedRoadReasons) stats.skippedRoadReasons = {};
  incrementReasonCount(stats.skippedRoadReasons, reason, amount);
}

function recordIndexSkipReason(index, reason, options = {}) {
  incrementReasonCount(index.skippedReasonCounts, reason);
  recordRoadSkipReason(options.stats, reason);
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

function getWayDirection(tags = {}) {
  const oneway = String(tags.oneway ?? tags["oneway:vehicle"] ?? tags["oneway:motor_vehicle"] ?? "")
    .trim()
    .toLowerCase();
  const junction = String(tags.junction || "").trim().toLowerCase();
  if (oneway === "-1" || oneway === "reverse") return "backward";
  if (oneway === "yes" || oneway === "true" || oneway === "1" || junction === "roundabout") return "forward";
  if (oneway === "no" || oneway === "false" || oneway === "0") return "both";
  return "both";
}

function createApproachMetadata(segment, distanceM, options = {}) {
  const bearingDeg = bearingDegrees(segment.start, segment.end);
  if (bearingDeg === null) return null;
  const confidence = options.confidence || confidenceForDistance(distanceM, options);
  const approach = {
    bearingDeg: Math.round(bearingDeg),
    reverseBearingDeg: Math.round(normalizeHeadingDeg(bearingDeg + 180)),
    direction: getWayDirection(segment.way?.tags || {}),
    roadDistanceM: Math.round(distanceM),
    confidence,
    role: options.role || "primary",
    source: "osm-road-segment",
    wayId: segment.wayId ?? normalizeWayId(segment.way?.id),
    segment: [
      [roundCoordinate(segment.start.lon), roundCoordinate(segment.start.lat)],
      [roundCoordinate(segment.end.lon), roundCoordinate(segment.end.lat)],
    ],
  };

  if (options.ambiguous === true) approach.ambiguous = true;
  if (options.ambiguityReason) approach.ambiguityReason = String(options.ambiguityReason);
  if (Number.isFinite(Number(options.nearbyCandidateCount)) && Number(options.nearbyCandidateCount) > 0) {
    approach.nearbyCandidateCount = Math.round(Number(options.nearbyCandidateCount));
  }
  if (Number.isFinite(Number(options.bearingSpreadDeg)) && Number(options.bearingSpreadDeg) > 0) {
    approach.bearingSpreadDeg = Math.round(Number(options.bearingSpreadDeg));
  }
  if (Number.isFinite(Number(options.clusterIndex))) approach.clusterIndex = Math.round(Number(options.clusterIndex));
  if (Number.isFinite(Number(options.candidateRank))) approach.candidateRank = Math.round(Number(options.candidateRank));
  if (approach.wayId === null || approach.wayId === undefined || approach.wayId === "") delete approach.wayId;
  if (!approach.segment.flat().every(Number.isFinite)) delete approach.segment;
  return approach;
}

function confidenceForDistance(distanceM, options = {}) {
  const highDistanceM = options.highConfidenceDistanceM ?? DEFAULT_HIGH_CONFIDENCE_DISTANCE_M;
  const mediumDistanceM = options.mediumConfidenceDistanceM ?? DEFAULT_MEDIUM_CONFIDENCE_DISTANCE_M;
  if (distanceM <= highDistanceM) return "high";
  if (distanceM <= mediumDistanceM) return "medium";
  return "low";
}

function mergeDefined(base, patch) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  return merged;
}

function getClosestSegmentMatch(point, geometry) {
  let bestDistanceM = Number.POSITIVE_INFINITY;
  let bestSegment = null;
  for (let index = 1; index < geometry.length; index += 1) {
    const start = normalizePoint(geometry[index - 1]);
    const end = normalizePoint(geometry[index]);
    if (!isFiniteCoordinate(start) || !isFiniteCoordinate(end)) continue;
    const distanceM = distancePointToSegmentMeters(point, start, end);
    if (distanceM < bestDistanceM) {
      bestDistanceM = distanceM;
      bestSegment = { start, end };
    }
  }
  return {
    distanceM: bestDistanceM,
    segment: bestSegment,
  };
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
    skippedReasonCounts: {},
  };

  for (const way of ways) {
    const geometry = Array.isArray(way?.geometry) ? way.geometry : [];
    if (geometry.length < 2) {
      index.skippedWayCount += 1;
      recordIndexSkipReason(index, "malformed-geometry", options);
      continue;
    }

    const eligibility = getPrivateCarRoadEligibility(way, null, options);
    if (!eligibility.eligible && ROAD_INDEX_EARLY_SKIP_REASONS.has(eligibility.reason)) {
      index.skippedWayCount += 1;
      recordIndexSkipReason(index, eligibility.reason, options);
      continue;
    }

    const speed = chooseWayMaxspeed(way?.tags || {});
    let indexedWay = false;
    for (let geometryIndex = 1; geometryIndex < geometry.length; geometryIndex += 1) {
      const start = normalizePoint(geometry[geometryIndex - 1]);
      const end = normalizePoint(geometry[geometryIndex]);
      if (!isFiniteCoordinate(start) || !isFiniteCoordinate(end)) continue;

      const segment = {
        way,
        wayId: normalizeWayId(way.id),
        speedKph: speed?.speedKph ?? null,
        source: speed?.source ?? "nearest_road:approach",
        raw: speed?.raw ?? null,
        hasSpeed: Boolean(speed),
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
    else {
      index.skippedWayCount += 1;
      recordIndexSkipReason(index, "malformed-geometry", options);
    }
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

function segmentToApproachCandidate(segment, camera, cameraPoint, options = {}) {
  if (!isAllowedHighway(segment.way, camera, options)) return null;

  const distanceM = distancePointToSegmentMeters(cameraPoint, segment.start, segment.end);
  const maxDistanceM = options.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
  if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) return null;
  const approach = createApproachMetadata(segment, distanceM, options);
  if (!approach) return null;
  const speedKph = segment.speedKph === null || segment.speedKph === undefined
    ? null
    : finiteNumber(segment.speedKph);

  return {
    speedKph,
    speedMeta: {
      source: segment.source,
      confidence: confidenceForDistance(distanceM, options),
      wayId: segment.wayId,
      distanceM: Math.round(distanceM),
      raw: segment.raw,
      approach: [approach],
    },
    sourceWayId: segment.wayId,
    distanceM,
    raw: segment.raw,
    source: segment.source,
    hasSpeed: speedKph !== null,
    highway: String(segment.way?.tags?.highway || ""),
  };
}

function indexedSegmentToCandidate(segment, camera, cameraPoint, options = {}) {
  return segmentToApproachCandidate(segment, camera, cameraPoint, options);
}

export function getWayCandidateSpeed(way, camera, options = {}) {
  const cameraPoint = readCameraPoint(camera);
  if (!isFiniteCoordinate(cameraPoint)) return null;
  if (!isAllowedHighway(way, camera, options)) return null;

  const speed = chooseWayMaxspeed(way?.tags || {});
  if (!speed) return null;

  const geometry = Array.isArray(way?.geometry) ? way.geometry : [];
  if (geometry.length < 2) return null;

  const closest = getClosestSegmentMatch(cameraPoint, geometry);
  const distanceM = closest.distanceM;
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
      approach: [createApproachMetadata({
        way,
        wayId: normalizeWayId(way.id),
        start: closest.segment?.start,
        end: closest.segment?.end,
      }, distanceM, options)].filter(Boolean),
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

function getPrimaryApproach(candidate) {
  return candidate?.speedMeta?.approach?.[0] || null;
}

function angularDifferenceDeg(left, right) {
  const a = normalizeHeadingDeg(left);
  const b = normalizeHeadingDeg(right);
  if (a === null || b === null) return null;
  return Math.abs(((a - b + 540) % 360) - 180);
}

function getCandidateBearingDeg(candidate) {
  const approach = getPrimaryApproach(candidate);
  const bearing = Number(candidate?.bearingDeg ?? approach?.bearingDeg);
  return Number.isFinite(bearing) ? normalizeHeadingDeg(bearing) : null;
}

function getCandidateDistanceM(candidate) {
  const approach = getPrimaryApproach(candidate);
  const distanceM = Number(candidate?.distanceM ?? approach?.roadDistanceM);
  return Number.isFinite(distanceM) ? distanceM : Number.POSITIVE_INFINITY;
}

function getCandidateWayId(candidate) {
  const approach = getPrimaryApproach(candidate);
  const wayId = candidate?.sourceWayId ?? candidate?.speedMeta?.wayId ?? approach?.wayId;
  return wayId === null || wayId === undefined ? "" : String(wayId);
}

function bearingAxisDifferenceDeg(left, right) {
  const direct = angularDifferenceDeg(left, right);
  const reverse = angularDifferenceDeg(left, Number(right) + 180);
  if (direct === null && reverse === null) return null;
  if (direct === null) return reverse;
  if (reverse === null) return direct;
  return Math.min(direct, reverse);
}

function compareRoadCandidate(left, right) {
  const distanceDelta = getCandidateDistanceM(left) - getCandidateDistanceM(right);
  if (Math.abs(distanceDelta) > 0.01) return distanceDelta;
  if (left?.hasSpeed !== right?.hasSpeed) return left?.hasSpeed ? -1 : 1;
  return getCandidateWayId(left).localeCompare(getCandidateWayId(right));
}

function speedsAreCompatible(left, right) {
  const leftSpeed = Number(left?.speedKph);
  const rightSpeed = Number(right?.speedKph);
  return !Number.isFinite(leftSpeed) || !Number.isFinite(rightSpeed) || leftSpeed === rightSpeed;
}

function getBearingSpreadDeg(candidates = []) {
  const bearings = candidates
    .map(getCandidateBearingDeg)
    .filter(Number.isFinite);
  if (bearings.length < 2) return 0;
  let largestGap = 0;
  const sorted = bearings
    .map((bearing) => normalizeHeadingDeg(bearing))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = sorted[(index + 1) % sorted.length] + (index === sorted.length - 1 ? 360 : 0);
    largestGap = Math.max(largestGap, next - current);
  }
  return Math.round(360 - largestGap);
}

export function clusterApproachCandidatesByBearing(candidates = [], options = {}) {
  const clusterToleranceDeg = options.approachBearingClusterDeg ?? DEFAULT_APPROACH_BEARING_CLUSTER_DEG;
  const sameWayToleranceDeg = options.approachSimilarBearingDeg ?? DEFAULT_APPROACH_SIMILAR_BEARING_DEG;
  const clusters = [];

  for (const candidate of [...candidates].sort(compareRoadCandidate)) {
    const bearingDeg = getCandidateBearingDeg(candidate);
    if (bearingDeg === null) continue;
    const wayId = getCandidateWayId(candidate);
    const sameWayCluster = clusters.find((cluster) =>
      wayId
      && cluster.wayId === wayId
      && speedsAreCompatible(candidate, cluster.representative)
      && bearingAxisDifferenceDeg(bearingDeg, cluster.bearingDeg) <= sameWayToleranceDeg
    );
    const cluster = sameWayCluster || clusters.find((entry) =>
      speedsAreCompatible(candidate, entry.representative)
      &&
      bearingAxisDifferenceDeg(bearingDeg, entry.bearingDeg) <= clusterToleranceDeg
    );

    if (cluster) {
      cluster.members.push(candidate);
      if (compareRoadCandidate(candidate, cluster.representative) < 0) {
        cluster.representative = candidate;
        cluster.bearingDeg = bearingDeg;
        cluster.wayId = wayId;
      }
    } else {
      clusters.push({
        bearingDeg,
        wayId,
        representative: candidate,
        members: [candidate],
      });
    }
  }

  return clusters
    .map((cluster, clusterIndex) => ({
      ...cluster.representative,
      clusterIndex,
      clusteredCandidateCount: cluster.members.length,
    }))
    .sort(compareRoadCandidate);
}

function collectWayApproachCandidates(camera, roadWays, options = {}) {
  const cameraPoint = readCameraPoint(camera);
  if (!isFiniteCoordinate(cameraPoint)) return [];
  const candidates = [];

  for (const way of roadWays) {
    if (!isAllowedHighway(way, camera, options)) continue;
    const speed = chooseWayMaxspeed(way?.tags || {});
    const geometry = Array.isArray(way?.geometry) ? way.geometry : [];
    for (let geometryIndex = 1; geometryIndex < geometry.length; geometryIndex += 1) {
      const start = normalizePoint(geometry[geometryIndex - 1]);
      const end = normalizePoint(geometry[geometryIndex]);
      if (!isFiniteCoordinate(start) || !isFiniteCoordinate(end)) continue;
      const candidate = segmentToApproachCandidate({
        way,
        wayId: normalizeWayId(way.id),
        speedKph: speed?.speedKph ?? null,
        source: speed?.source ?? "nearest_road:approach",
        raw: speed?.raw ?? null,
        hasSpeed: Boolean(speed),
        start,
        end,
      }, camera, cameraPoint, options);
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates;
}

function getPlausibleApproachCandidates(candidates = [], options = {}) {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort(compareRoadCandidate);
  const closestDistanceM = getCandidateDistanceM(sorted[0]);
  const distanceBandM = options.approachDistanceBandM ?? DEFAULT_APPROACH_DISTANCE_BAND_M;
  const intersectionDistanceM = options.approachIntersectionDistanceM ?? DEFAULT_APPROACH_INTERSECTION_DISTANCE_M;
  return sorted.filter((candidate) => {
    const distanceM = getCandidateDistanceM(candidate);
    return distanceM <= closestDistanceM + distanceBandM || distanceM <= intersectionDistanceM;
  });
}

function getUniqueSpeeds(candidates = []) {
  return Array.from(new Set(
    candidates
      .map((candidate) => candidate.speedKph)
      .filter(Number.isFinite)
  ));
}

function isLowerPriorityRoad(candidate) {
  const highway = String(candidate?.highway || "").toLowerCase();
  return highway === "service" || highway.endsWith("_link");
}

function getCorridorRole(candidate, index, { ambiguous = false, corridorCount = 1 } = {}) {
  if (ambiguous && index > 0) return "ambiguous";
  if (index === 0) return "primary";
  if (corridorCount > 1) return "intersection";
  return "secondary";
}

function getCorridorConfidence(candidate, index, { ambiguous = false, corridorCount = 1 } = {}, options = {}) {
  if (ambiguous) return "low";
  let confidence = confidenceForDistance(getCandidateDistanceM(candidate), options);
  if (corridorCount > 1 && confidence === "high") confidence = "medium";
  if (index > 0 && confidence === "high") confidence = "medium";
  if (isLowerPriorityRoad(candidate)) {
    if (index > 0) confidence = "low";
    else if (confidence === "high") confidence = "medium";
  }
  return confidence;
}

function annotateApproachCandidate(candidate, index, context, options = {}) {
  const confidence = getCorridorConfidence(candidate, index, context, options);
  const role = getCorridorRole(candidate, index, context);
  const approach = getPrimaryApproach(candidate);
  const annotatedApproach = mergeDefined(approach, {
    confidence,
    role,
    source: "osm-road-segment",
    ambiguous: context.ambiguous ? true : undefined,
    ambiguityReason: context.ambiguityReason,
    nearbyCandidateCount: context.nearbyCandidateCount,
    bearingSpreadDeg: context.bearingSpreadDeg > 0 ? context.bearingSpreadDeg : undefined,
    clusterIndex: candidate.clusterIndex ?? index,
    candidateRank: index + 1,
  });
  return {
    ...candidate,
    speedMeta: {
      ...candidate.speedMeta,
      confidence,
      approach: [annotatedApproach],
      nearbyCandidateCount: context.nearbyCandidateCount,
      ...(context.bearingSpreadDeg > 0 ? { bearingSpreadDeg: context.bearingSpreadDeg } : {}),
      ...(context.ambiguous ? {
        ambiguous: true,
        ambiguityReason: context.ambiguityReason,
      } : {}),
    },
  };
}

function createSpeedCandidateFromCorridors(approachCandidates, context) {
  const speeds = getUniqueSpeeds(approachCandidates);
  if (speeds.length !== 1) return null;
  const speedKph = speeds[0];
  const sourceCandidate = approachCandidates.find((candidate) => candidate.speedKph === speedKph) || approachCandidates[0];
  return {
    ...sourceCandidate,
    speedKph,
    speedMeta: {
      ...sourceCandidate.speedMeta,
      source: sourceCandidate.source,
      confidence: sourceCandidate.speedMeta?.confidence || "low",
      wayId: sourceCandidate.sourceWayId,
      distanceM: Math.round(sourceCandidate.distanceM),
      raw: sourceCandidate.raw,
      approach: approachCandidates.flatMap((candidate) => candidate.speedMeta?.approach || []),
      nearbyCandidateCount: context.nearbyCandidateCount,
      ...(context.bearingSpreadDeg > 0 ? { bearingSpreadDeg: context.bearingSpreadDeg } : {}),
      ...(context.ambiguous ? {
        ambiguous: true,
        ambiguityReason: context.ambiguityReason,
      } : {}),
    },
  };
}

function buildApproachRoadResult(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { candidate: null, primaryCandidate: null, approachCandidates: [], approaches: [], ambiguous: false };
  }

  const plausibleCandidates = getPlausibleApproachCandidates(candidates, options);
  const clusteredCandidates = clusterApproachCandidatesByBearing(plausibleCandidates, options);
  const maxCorridors = Math.max(
    1,
    Math.round(Number(options.maxApproachCorridors ?? DEFAULT_MAX_APPROACH_CORRIDORS) || DEFAULT_MAX_APPROACH_CORRIDORS),
  );
  const selectedCandidates = clusteredCandidates.slice(0, maxCorridors);
  const speedValues = getUniqueSpeeds(selectedCandidates);
  const speedAmbiguous = speedValues.length > 1;
  const cappedAmbiguous = clusteredCandidates.length > selectedCandidates.length;
  const ambiguous = speedAmbiguous || cappedAmbiguous;
  const ambiguityReason = speedAmbiguous
    ? "nearby-different-speed"
    : (cappedAmbiguous ? "too-many-plausible-corridors" : "");
  const bearingSpreadDeg = getBearingSpreadDeg(selectedCandidates);
  const context = {
    ambiguous,
    ambiguityReason,
    nearbyCandidateCount: plausibleCandidates.length,
    bearingSpreadDeg,
    corridorCount: selectedCandidates.length,
  };
  const approachCandidates = selectedCandidates.map((candidate, index) =>
    annotateApproachCandidate(candidate, index, context, options)
  );
  const candidate = ambiguous ? null : createSpeedCandidateFromCorridors(approachCandidates, context);

  return {
    candidate,
    primaryCandidate: approachCandidates[0] || null,
    approachCandidates,
    approaches: approachCandidates.flatMap((candidateEntry) => candidateEntry.speedMeta?.approach || []),
    ambiguous,
    ambiguityReason,
    speedAmbiguous,
    nearbyCandidateCount: plausibleCandidates.length,
    bearingSpreadDeg,
  };
}

function findBestRoadCandidate(camera, roadWays, options = {}) {
  return buildApproachRoadResult(collectWayApproachCandidates(camera, roadWays, options), options);
}

export function findApproachRoadCandidates(camera, segmentIndex, options = {}) {
  const cameraPoint = readCameraPoint(camera);
  if (!isFiniteCoordinate(cameraPoint) || !segmentIndex) {
    return { candidate: null, primaryCandidate: null, approachCandidates: [], approaches: [], ambiguous: false };
  }

  const candidates = [];
  for (const segment of getRoadSegmentsNearPoint(segmentIndex, cameraPoint, options)) {
    const candidate = indexedSegmentToCandidate(segment, camera, cameraPoint, options);
    if (candidate) candidates.push(candidate);
  }

  return buildApproachRoadResult(candidates, options);
}

function findBestRoadCandidateFromIndex(camera, segmentIndex, options = {}) {
  return findApproachRoadCandidates(camera, segmentIndex, options);
}

export function enrichCameraRecordsWithRoadSpeeds(records, roadWays, options = {}) {
  const cameras = Array.isArray(records) ? records : [];
  const ways = Array.isArray(roadWays) ? roadWays : [];
  const segmentIndex = options.roadSegmentIndex
    || (options.useSegmentIndex === false ? null : createRoadSegmentIndex(ways, options));

  return cameras.map((camera) => {
    const key = getCameraKey(camera);
    const roadResult = segmentIndex
      ? findBestRoadCandidateFromIndex(camera, segmentIndex, options)
      : findBestRoadCandidate(camera, ways, options);
    const approach = roadResult.approaches || roadResult.candidate?.speedMeta?.approach || [];
    const explicit = readCameraExplicitSpeed(camera);
    if (explicit.parsed) {
      return {
        ...camera,
        key,
        speedKph: explicit.speedKph,
        speedMeta: {
          source: "camera:maxspeed",
          confidence: "high",
          raw: explicit.raw,
          ...(approach.length ? { approach } : {}),
          ...(roadResult.ambiguous ? {
            ambiguous: true,
            ambiguityReason: roadResult.ambiguityReason,
          } : {}),
          ...(Number.isFinite(roadResult.nearbyCandidateCount) ? { nearbyCandidateCount: roadResult.nearbyCandidateCount } : {}),
          ...(Number.isFinite(roadResult.bearingSpreadDeg) && roadResult.bearingSpreadDeg > 0
            ? { bearingSpreadDeg: roadResult.bearingSpreadDeg }
            : {}),
        },
        approachMeta: approach,
        speedEnrichmentStatus: "explicit",
      };
    }

    const { candidate, ambiguous } = roadResult;
    if (!candidate) {
      return {
        ...camera,
        key,
        speedKph: null,
        speedMeta: approach.length
          ? {
            source: "nearest_road:approach",
            confidence: roadResult.ambiguous ? "low" : (approach[0]?.confidence || "low"),
            approach,
            ambiguous: ambiguous || undefined,
            ambiguityReason: roadResult.ambiguityReason || undefined,
            nearbyCandidateCount: roadResult.nearbyCandidateCount || undefined,
            bearingSpreadDeg: roadResult.bearingSpreadDeg || undefined,
          }
          : null,
        approachMeta: approach,
        speedEnrichmentStatus: ambiguous ? "ambiguous" : "unknown",
      };
    }

    return {
      ...camera,
      key,
      speedKph: candidate.speedKph,
      speedMeta: candidate.speedMeta,
      approachMeta: candidate.speedMeta?.approach || [],
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
