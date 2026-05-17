import { around as geoAround, distance as geoDistanceKm } from "geokdbush";

const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE_LAT = 111320;
const DEFAULT_ALERT_DISTANCE_M = 500;
const DEFAULT_MAX_CANDIDATE_COUNT = 8;
const DEFAULT_HEADING_TOLERANCE_DEG = 45;
const DEFAULT_MINIMUM_SPEED_MS = 1.5;
const DEFAULT_MIN_MOVEMENT_DISTANCE_M = 8;
const DEFAULT_MIN_DISTANCE_DECREASE_M = 1;
const DEFAULT_ROAD_CORRIDOR_M = 28;
const DEFAULT_GPS_ACCURACY_CAP_M = 80;

const EMPTY_APPROACH_RESULT = {
  nearestTrapId: null,
  nearestTrapDistanceM: null,
  nearestTrapSpeedKph: null,
  nearestTrapSpeedMeta: null,
  nearestTrapDataset: null,
  cameraApproachState: "none",
  cameraApproachConfidence: "none",
  cameraApproachReason: "no-candidate",
  cameraApproachCandidateCount: 0,
  cameraApproachDetails: null,
};

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

function normalizePoint(input) {
  if (!input) return null;
  if (Array.isArray(input)) {
    const longitude = finiteNumber(input[0]);
    const latitude = finiteNumber(input[1]);
    return isFiniteLatLon({ latitude, longitude }) ? { latitude, longitude } : null;
  }
  const latitude = finiteNumber(input.latitude ?? input.lat);
  const longitude = finiteNumber(input.longitude ?? input.lon ?? input.lng);
  return isFiniteLatLon({ latitude, longitude }) ? { latitude, longitude } : null;
}

function isFiniteLatLon(point) {
  return Number.isFinite(point?.latitude)
    && Number.isFinite(point?.longitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && point.longitude >= -180
    && point.longitude <= 180;
}

export function normalizeHeadingDeg(value) {
  const heading = finiteNumber(value);
  if (heading === null) return null;
  return ((heading % 360) + 360) % 360;
}

export function angularDifferenceDeg(left, right) {
  const a = normalizeHeadingDeg(left);
  const b = normalizeHeadingDeg(right);
  if (a === null || b === null) return null;
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function haversineDistanceMeters(a, b) {
  const start = normalizePoint(a);
  const end = normalizePoint(b);
  if (!start || !end) return Number.POSITIVE_INFINITY;

  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const dLat = toRadians(end.latitude - start.latitude);
  const dLon = toRadians(end.longitude - start.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function bearingFromVehicleToCamera(position, camera) {
  const start = normalizePoint(position);
  const end = normalizePoint(camera);
  if (!start || !end) return null;

  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const dLon = toRadians(end.longitude - start.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeHeadingDeg(toDegrees(Math.atan2(y, x)));
}

export function isHeadingTowardCamera(headingDeg, bearingDeg, toleranceDeg = DEFAULT_HEADING_TOLERANCE_DEG) {
  const difference = angularDifferenceDeg(headingDeg, bearingDeg);
  return difference !== null && difference <= toleranceDeg;
}

export function distancePointToSegmentMeters(point, segmentStart, segmentEnd) {
  const p = normalizePoint(point);
  const a = normalizePoint(segmentStart);
  const b = normalizePoint(segmentEnd);
  if (!p || !a || !b) return Number.POSITIVE_INFINITY;
  if (a.latitude === b.latitude && a.longitude === b.longitude) return haversineDistanceMeters(p, a);

  const referenceLat = toRadians(p.latitude);
  const metersPerDegreeLon = Math.max(1, Math.cos(referenceLat) * METERS_PER_DEGREE_LAT);
  const ax = (a.longitude - p.longitude) * metersPerDegreeLon;
  const ay = (a.latitude - p.latitude) * METERS_PER_DEGREE_LAT;
  const bx = (b.longitude - p.longitude) * metersPerDegreeLon;
  const by = (b.latitude - p.latitude) * METERS_PER_DEGREE_LAT;
  const vx = bx - ax;
  const vy = by - ay;
  const denominator = vx * vx + vy * vy;

  if (denominator <= 0) return Math.sqrt(ax * ax + ay * ay);

  const t = Math.min(1, Math.max(0, -(ax * vx + ay * vy) / denominator));
  const closestX = ax + vx * t;
  const closestY = ay + vy * t;
  return Math.sqrt(closestX * closestX + closestY * closestY);
}

function getPreviousPosition(position = {}) {
  const explicit = normalizePoint(position.previousPosition);
  if (explicit) {
    return {
      ...explicit,
      timestampMs: finiteNumber(position.previousPosition.timestampMs ?? position.previousPosition.timestamp),
    };
  }

  const previous = normalizePoint({
    latitude: position.previousLatitude ?? position.prevLatitude,
    longitude: position.previousLongitude ?? position.prevLongitude,
  });
  if (!previous) return null;
  return {
    ...previous,
    timestampMs: finiteNumber(position.previousTimestampMs ?? position.prevTimestampMs),
  };
}

function deriveMovement(position, options = {}) {
  const current = normalizePoint(position);
  const previous = getPreviousPosition(position);
  if (!current || !previous) {
    return {
      headingDeg: null,
      distanceM: null,
      speedMs: null,
      distanceDecreasing: null,
    };
  }

  const distanceM = haversineDistanceMeters(previous, current);
  const minDistanceM = finiteNumber(options.minMovementDistanceM) ?? DEFAULT_MIN_MOVEMENT_DISTANCE_M;
  const headingDeg = distanceM >= minDistanceM
    ? bearingFromVehicleToCamera(previous, current)
    : null;
  const currentTimestampMs = finiteNumber(position.timestampMs ?? position.timestamp);
  const previousTimestampMs = finiteNumber(previous.timestampMs);
  const elapsedSeconds = currentTimestampMs !== null && previousTimestampMs !== null
    ? Math.max(0, (currentTimestampMs - previousTimestampMs) / 1000)
    : 0;

  return {
    headingDeg,
    distanceM,
    speedMs: elapsedSeconds > 0 ? distanceM / elapsedSeconds : null,
    previous,
  };
}

function getEffectiveHeading(position, options = {}) {
  const movement = deriveMovement(position, options);
  const gpsHeading = normalizeHeadingDeg(position?.headingDeg ?? position?.heading ?? position?.course);
  const speedMs = finiteNumber(position?.speedMs ?? position?.speed);
  const minSpeedMs = finiteNumber(options.minimumSpeedMs) ?? DEFAULT_MINIMUM_SPEED_MS;
  const movementSpeedMs = movement.speedMs;
  const movingFastEnough = speedMs === null
    ? (movementSpeedMs === null || movementSpeedMs >= minSpeedMs)
    : speedMs >= minSpeedMs;

  if (gpsHeading !== null && movingFastEnough) {
    return {
      headingDeg: gpsHeading,
      source: "gps",
      movement,
      movingFastEnough,
      speedMs,
    };
  }

  if (movement.headingDeg !== null && (movementSpeedMs === null || movementSpeedMs >= minSpeedMs)) {
    return {
      headingDeg: movement.headingDeg,
      source: "movement",
      movement,
      movingFastEnough: true,
      speedMs: movementSpeedMs ?? speedMs,
    };
  }

  return {
    headingDeg: null,
    source: "none",
    movement,
    movingFastEnough,
    speedMs,
  };
}

export function isDistanceDecreasing(position, camera, options = {}) {
  const current = normalizePoint(position);
  const previous = getPreviousPosition(position);
  const target = normalizePoint(camera);
  if (!current || !previous || !target) return null;

  const currentDistanceM = haversineDistanceMeters(current, target);
  const previousDistanceM = haversineDistanceMeters(previous, target);
  const minDecreaseM = finiteNumber(options.minDistanceDecreaseM) ?? DEFAULT_MIN_DISTANCE_DECREASE_M;
  return previousDistanceM - currentDistanceM >= minDecreaseM;
}

function normalizeConfidence(value) {
  const confidence = String(value || "").trim().toLowerCase();
  if (confidence === "high" || confidence === "medium" || confidence === "low") return confidence;
  return "none";
}

function getConfidenceWeight(confidence) {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  if (confidence === "low") return 1;
  return 0;
}

function getRoleWeight(role) {
  if (role === "primary") return 3;
  if (role === "intersection" || role === "secondary") return 2;
  if (role === "ambiguous") return 1;
  return 0;
}

function normalizeSegment(segment) {
  if (!Array.isArray(segment) || segment.length < 2) return null;
  const start = normalizePoint(segment[0]);
  const end = normalizePoint(segment[1]);
  return start && end ? [start, end] : null;
}

function normalizeApproachEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;
  const bearingDeg = normalizeHeadingDeg(entry.bearingDeg ?? entry.bearing ?? entry.b);
  const reverseBearingDeg = normalizeHeadingDeg(
    entry.reverseBearingDeg
      ?? entry.reverseBearing
      ?? entry.rb
      ?? (bearingDeg === null ? null : bearingDeg + 180),
  );
  if (bearingDeg === null && reverseBearingDeg === null) return null;

  const direction = String(entry.direction ?? entry.dir ?? "both").trim().toLowerCase();
  const confidence = normalizeConfidence(entry.confidence ?? entry.c);
  const roadDistanceM = finiteNumber(entry.roadDistanceM ?? entry.distanceM ?? entry.d);
  const nearbyCandidateCount = finiteNumber(entry.nearbyCandidateCount ?? entry.n);
  const bearingSpreadDeg = finiteNumber(entry.bearingSpreadDeg ?? entry.bs);
  const ambiguityReason = String(entry.ambiguityReason ?? entry.ar ?? "").trim();
  const wayId = entry.wayId ?? entry.sourceWayId ?? entry.way ?? entry.w;
  const role = String(entry.role ?? "").trim().toLowerCase();
  const source = String(entry.source ?? entry.s ?? "").trim();
  const clusterIndex = finiteNumber(entry.clusterIndex ?? entry.cluster);
  const candidateRank = finiteNumber(entry.candidateRank ?? entry.rank);
  return {
    bearingDeg,
    reverseBearingDeg,
    direction: ["forward", "backward", "both", "unknown"].includes(direction) ? direction : "both",
    confidence,
    role: ["primary", "secondary", "intersection", "ambiguous"].includes(role) ? role : "primary",
    source: source || null,
    roadDistanceM,
    wayId: wayId === null || wayId === undefined || wayId === "" ? null : wayId,
    clusterIndex,
    candidateRank,
    ambiguous: entry.ambiguous === true || entry.a === true,
    ambiguityReason: ambiguityReason || null,
    nearbyCandidateCount,
    bearingSpreadDeg,
    segment: normalizeSegment(entry.segment ?? entry.seg),
  };
}

function getTrapMeta(trap) {
  return trap?.[4] && typeof trap[4] === "object" ? trap[4] : null;
}

function getTrapSourceMeta(trap) {
  return trap?.[5] && typeof trap[5] === "object" ? trap[5] : null;
}

export function getTrapApproachMetadata(trap) {
  const speedMeta = getTrapMeta(trap);
  const sourceMeta = getTrapSourceMeta(trap);
  const rawApproaches = [
    ...(Array.isArray(speedMeta?.approach) ? speedMeta.approach : []),
    ...(Array.isArray(speedMeta?.approaches) ? speedMeta.approaches : []),
    ...(Array.isArray(sourceMeta?.approach) ? sourceMeta.approach : []),
    ...(Array.isArray(sourceMeta?.approaches) ? sourceMeta.approaches : []),
  ];
  return rawApproaches
    .map(normalizeApproachEntry)
    .filter(Boolean);
}

function getAllowedApproachBearings(approach) {
  if (!approach) return [];
  if (approach.direction === "forward") return [approach.bearingDeg].filter((value) => value !== null);
  if (approach.direction === "backward") return [approach.reverseBearingDeg].filter((value) => value !== null);
  return [approach.bearingDeg, approach.reverseBearingDeg].filter((value) => value !== null);
}

function getBestMetadataMatch({ approaches, position, headingDeg, toleranceDeg, accuracyM, options = {} }) {
  if (!Array.isArray(approaches) || approaches.length === 0 || headingDeg === null) {
    return {
      matched: false,
      bestDifferenceDeg: null,
      confidence: "none",
      corridorMatched: false,
      reason: "metadata-heading-unavailable",
    };
  }

  let best = {
    matched: false,
    bestDifferenceDeg: Number.POSITIVE_INFINITY,
    confidence: "none",
    corridorMatched: false,
    reason: "metadata-no-match",
    approach: null,
    approachIndex: null,
  };

  for (let approachIndex = 0; approachIndex < approaches.length; approachIndex += 1) {
    const approach = approaches[approachIndex];
    const bearings = getAllowedApproachBearings(approach);
    const differenceDeg = bearings.reduce((min, bearing) => {
      const difference = angularDifferenceDeg(headingDeg, bearing);
      return difference === null ? min : Math.min(min, difference);
    }, Number.POSITIVE_INFINITY);
    const headingMatched = differenceDeg <= toleranceDeg;
    const corridorMatched = isWithinRoadCorridor(position, approach, accuracyM, options);
    const matched = headingMatched && corridorMatched;
    const confidence = approach.confidence === "none" ? "low" : approach.confidence;

    if (
      matched && !best.matched
      || matched === best.matched && getConfidenceWeight(confidence) > getConfidenceWeight(best.confidence)
      || matched === best.matched
        && getConfidenceWeight(confidence) === getConfidenceWeight(best.confidence)
        && differenceDeg < best.bestDifferenceDeg
      || matched === best.matched
        && getConfidenceWeight(confidence) === getConfidenceWeight(best.confidence)
        && differenceDeg === best.bestDifferenceDeg
        && (approach.roadDistanceM ?? Number.POSITIVE_INFINITY) < (best.approach?.roadDistanceM ?? Number.POSITIVE_INFINITY)
      || matched === best.matched
        && getConfidenceWeight(confidence) === getConfidenceWeight(best.confidence)
        && differenceDeg === best.bestDifferenceDeg
        && (approach.roadDistanceM ?? Number.POSITIVE_INFINITY) === (best.approach?.roadDistanceM ?? Number.POSITIVE_INFINITY)
        && getRoleWeight(approach.role) > getRoleWeight(best.approach?.role)
    ) {
      best = {
        matched,
        bestDifferenceDeg: Number.isFinite(differenceDeg) ? differenceDeg : null,
        confidence,
        corridorMatched,
        reason: matched ? "metadata-approach-match" : (headingMatched ? "metadata-corridor-mismatch" : "metadata-heading-mismatch"),
        approach,
        approachIndex,
      };
    }
  }

  return best;
}

function isWithinRoadCorridor(position, approach, accuracyM, options = {}) {
  if (!approach?.segment) return true;
  const distanceM = distancePointToSegmentMeters(position, approach.segment[0], approach.segment[1]);
  const baseCorridorM = finiteNumber(options.roadCorridorM) ?? DEFAULT_ROAD_CORRIDOR_M;
  const accuracyAllowanceM = Math.min(
    finiteNumber(accuracyM) ?? 0,
    finiteNumber(options.gpsAccuracyCapM) ?? DEFAULT_GPS_ACCURACY_CAP_M,
  );
  return distanceM <= baseCorridorM + accuracyAllowanceM;
}

function getFallbackMode(options = {}) {
  const fallback = String(options.fallbackMode || "legacy-radius");
  if (fallback === "heading-only" || fallback === "silent") return fallback;
  return "legacy-radius";
}

function emptyResult(patch = {}) {
  return {
    ...EMPTY_APPROACH_RESULT,
    ...patch,
  };
}

function trapToPoint(trap) {
  if (!Array.isArray(trap)) return null;
  return normalizePoint([trap[0], trap[1]]);
}

export function scoreApproachCandidate(candidate, position, options = {}) {
  const trap = candidate?.trap;
  const camera = trapToPoint(trap);
  const current = normalizePoint(position);
  if (!camera || !current) {
    return {
      accepted: false,
      score: Number.NEGATIVE_INFINITY,
      state: "none",
      confidence: "none",
      reason: "invalid-position",
    };
  }

  const alertDistanceM = finiteNumber(options.alertDistanceM) ?? DEFAULT_ALERT_DISTANCE_M;
  const distanceM = finiteNumber(candidate.distanceM) ?? haversineDistanceMeters(current, camera);
  if (!Number.isFinite(distanceM) || distanceM > alertDistanceM) {
    return {
      accepted: false,
      score: Number.NEGATIVE_INFINITY,
      state: "none",
      confidence: "none",
      distanceM,
      reason: "outside-alert-distance",
    };
  }

  const minSpeedMs = finiteNumber(options.minimumSpeedMs) ?? DEFAULT_MINIMUM_SPEED_MS;
  const heading = getEffectiveHeading(position, { ...options, minimumSpeedMs: minSpeedMs });
  const accuracyM = finiteNumber(position?.accuracyM ?? position?.accuracy);
  const fallbackMode = getFallbackMode(options);
  const approaches = getTrapApproachMetadata(trap);
  const metadataConfidence = approaches.reduce((best, approach) => (
    getConfidenceWeight(approach.confidence) > getConfidenceWeight(best) ? approach.confidence : best
  ), "none");
  const highOrMediumMetadata = metadataConfidence === "high" || metadataConfidence === "medium";
  const bearingToCameraDeg = bearingFromVehicleToCamera(current, camera);
  const headingDifferenceDeg = heading.headingDeg === null || bearingToCameraDeg === null
    ? null
    : angularDifferenceDeg(heading.headingDeg, bearingToCameraDeg);
  const headingTowardCamera = heading.headingDeg !== null
    && isHeadingTowardCamera(
      heading.headingDeg,
      bearingToCameraDeg,
      finiteNumber(options.headingToleranceDeg) ?? DEFAULT_HEADING_TOLERANCE_DEG,
    );
  const distanceDecreasing = isDistanceDecreasing(position, camera, options);
  const metadataMatch = getBestMetadataMatch({
    approaches,
    position,
    headingDeg: heading.headingDeg,
    toleranceDeg: finiteNumber(options.headingToleranceDeg) ?? DEFAULT_HEADING_TOLERANCE_DEG,
    accuracyM,
    options,
  });

  const parked = finiteNumber(heading.speedMs) !== null
    && heading.speedMs < minSpeedMs
    && heading.movement.headingDeg === null;
  if (parked) {
    return {
      accepted: false,
      score: Number.NEGATIVE_INFINITY,
      state: "near-not-approaching",
      confidence: metadataConfidence,
      distanceM,
      reason: "below-minimum-speed",
      bearingToCameraDeg,
      headingDeg: heading.headingDeg,
      headingSource: heading.source,
      headingDifferenceDeg,
      distanceDecreasing,
      metadataConfidence,
    };
  }

  let accepted = false;
  let state = "near-not-approaching";
  let confidence = metadataConfidence;
  let reason;

  if (highOrMediumMetadata) {
    if (metadataMatch.matched) {
      accepted = true;
      state = "approaching";
      reason = metadataMatch.reason;
      confidence = metadataMatch.confidence;
    } else if (metadataConfidence === "medium" && heading.headingDeg === null && fallbackMode === "legacy-radius") {
      accepted = true;
      state = "legacy-radius";
      reason = "medium-metadata-heading-unavailable";
      confidence = "low";
    } else if (heading.headingDeg === null) {
      state = "unknown-heading";
      reason = "metadata-requires-heading";
    } else {
      reason = metadataMatch.reason;
    }
  } else if (heading.headingDeg !== null) {
    if (approaches.length > 0 && metadataMatch.matched) {
      accepted = true;
      state = "approaching";
      reason = metadataMatch.reason;
      confidence = metadataMatch.confidence;
    } else if (approaches.length > 0 && fallbackMode !== "legacy-radius") {
      reason = metadataMatch.reason;
    } else if (headingTowardCamera) {
      accepted = true;
      state = approaches.length > 0 ? "approaching" : "missing-metadata";
      reason = approaches.length > 0 ? "low-metadata-heading-to-camera" : "heading-to-camera";
      confidence = approaches.length > 0 ? "low" : "none";
    } else {
      reason = "heading-away-from-camera";
    }
  } else if (fallbackMode === "legacy-radius" && options.requireApproachMetadata !== true) {
    accepted = true;
    state = approaches.length > 0 ? "legacy-radius" : "legacy-radius";
    reason = approaches.length > 0 ? "low-metadata-heading-unavailable" : "missing-metadata-heading-unavailable";
    confidence = approaches.length > 0 ? "low" : "none";
  } else {
    state = "unknown-heading";
    reason = approaches.length > 0 ? "metadata-heading-unavailable" : "heading-unavailable";
  }

  if (options.requireApproachMetadata === true && approaches.length === 0) {
    accepted = false;
    state = "missing-metadata";
    reason = "approach-metadata-required";
  }

  const score = (accepted ? 10000 : 0)
    + getConfidenceWeight(confidence) * 1000
    + (headingTowardCamera ? 220 : 0)
    + (metadataMatch.matched ? 420 : 0)
    + (distanceDecreasing === true ? 120 : 0)
    - distanceM;

  return {
    accepted,
    score,
    state,
    confidence,
    reason,
    distanceM,
    bearingToCameraDeg,
    headingDeg: heading.headingDeg,
    headingSource: heading.source,
    headingDifferenceDeg,
    distanceDecreasing,
    metadataConfidence,
    metadataMatched: metadataMatch.matched,
    metadataHeadingDifferenceDeg: metadataMatch.bestDifferenceDeg,
    corridorMatched: metadataMatch.corridorMatched,
    matchedApproachIndex: metadataMatch.matched ? metadataMatch.approachIndex : null,
    matchedWayId: metadataMatch.matched ? metadataMatch.approach?.wayId ?? null : null,
    matchedRole: metadataMatch.matched ? metadataMatch.approach?.role ?? null : null,
    matchedConfidence: metadataMatch.matched ? metadataMatch.confidence : null,
    matchedBearingDeg: metadataMatch.matched ? metadataMatch.approach?.bearingDeg ?? null : null,
    matchedDirection: metadataMatch.matched ? metadataMatch.approach?.direction ?? null : null,
    corridorCount: approaches.length,
    fallbackMode,
    candidate,
  };
}

function buildCandidateResult(evaluation, dataset, trapId) {
  const trap = evaluation.candidate?.trap;
  const datasetId = dataset?.key || dataset?.id || dataset?.country || "dataset";
  const details = {
    state: evaluation.state,
    reason: evaluation.reason,
    distanceM: evaluation.distanceM,
    headingDeg: evaluation.headingDeg,
    headingSource: evaluation.headingSource,
    bearingToCameraDeg: evaluation.bearingToCameraDeg,
    headingDifferenceDeg: evaluation.headingDifferenceDeg,
    matchedApproachIndex: evaluation.matchedApproachIndex,
    matchedWayId: evaluation.matchedWayId,
    matchedRole: evaluation.matchedRole,
    matchedConfidence: evaluation.matchedConfidence,
    matchedBearingDeg: evaluation.matchedBearingDeg,
    matchedDirection: evaluation.matchedDirection,
    corridorCount: evaluation.corridorCount,
    fallbackMode: evaluation.fallbackMode,
  };
  return {
    nearestTrapId: `${datasetId}:${trapId}`,
    nearestTrapDistanceM: evaluation.distanceM,
    nearestTrapSpeedKph: Number.isFinite(trap?.[2]) ? trap[2] : null,
    nearestTrapSpeedMeta: getTrapMeta(trap),
    nearestTrapDataset: dataset,
    cameraApproachState: evaluation.state,
    cameraApproachConfidence: evaluation.confidence,
    cameraApproachReason: evaluation.reason,
    cameraApproachBearingToCameraDeg: evaluation.bearingToCameraDeg,
    cameraApproachHeadingDeg: evaluation.headingDeg,
    cameraApproachHeadingSource: evaluation.headingSource,
    cameraApproachHeadingDifferenceDeg: evaluation.headingDifferenceDeg,
    cameraApproachDistanceDecreasing: evaluation.distanceDecreasing,
    cameraApproachMetadataConfidence: evaluation.metadataConfidence,
    cameraApproachMetadataMatched: evaluation.metadataMatched,
    cameraApproachMatchedApproachIndex: evaluation.matchedApproachIndex,
    cameraApproachMatchedWayId: evaluation.matchedWayId,
    cameraApproachMatchedRole: evaluation.matchedRole,
    cameraApproachMatchedConfidence: evaluation.matchedConfidence,
    cameraApproachMatchedBearingDeg: evaluation.matchedBearingDeg,
    cameraApproachMatchedDirection: evaluation.matchedDirection,
    cameraApproachCorridorCount: evaluation.corridorCount,
    cameraApproachDetails: details,
    cameraApproachCandidateCount: null,
  };
}

function getCandidateIds(dataset, position, options = {}) {
  const index = dataset?.index ?? dataset?.trapIndex;
  const traps = dataset?.traps ?? dataset?.trapRecords;
  if (!index || !Array.isArray(traps) || traps.length === 0) return [];

  const around = options.around || geoAround;
  const maxCandidateCount = finiteNumber(options.maxCandidateCount) ?? DEFAULT_MAX_CANDIDATE_COUNT;
  const alertDistanceM = finiteNumber(options.alertDistanceM) ?? DEFAULT_ALERT_DISTANCE_M;
  return around(index, position.longitude, position.latitude, maxCandidateCount, alertDistanceM / 1000);
}

function getNearestDisplayCandidate(datasets, position, options = {}) {
  const around = options.around || geoAround;
  const distanceKm = options.distanceKm || geoDistanceKm;
  let best = null;

  for (const dataset of datasets) {
    const index = dataset?.index ?? dataset?.trapIndex;
    const traps = dataset?.traps ?? dataset?.trapRecords;
    if (!index || !Array.isArray(traps) || traps.length === 0) continue;
    const ids = around(index, position.longitude, position.latitude, 1);
    const trapId = ids[0];
    const trap = traps[trapId];
    if (!Array.isArray(trap)) continue;
    const distanceM = distanceKm(position.longitude, position.latitude, trap[0], trap[1]) * 1000;
    if (!best || distanceM < best.distanceM) {
      best = { dataset, trap, trapId, distanceM };
    }
  }

  return best;
}

export function findApproachingTrapAcrossDatasets(datasets, position, options = {}) {
  const current = normalizePoint(position);
  if (!current || !Array.isArray(datasets) || datasets.length === 0) {
    return emptyResult({
      cameraApproachReason: current ? "no-datasets" : "invalid-position",
    });
  }

  const distanceKm = options.distanceKm || geoDistanceKm;
  const evaluations = [];
  for (const dataset of datasets) {
    const traps = dataset?.traps ?? dataset?.trapRecords;
    for (const trapId of getCandidateIds(dataset, current, options)) {
      const trap = traps?.[trapId];
      if (!Array.isArray(trap)) continue;
      const distanceM = distanceKm(current.longitude, current.latitude, trap[0], trap[1]) * 1000;
      const evaluation = scoreApproachCandidate({
        trap,
        trapId,
        distanceM,
      }, {
        ...position,
        latitude: current.latitude,
        longitude: current.longitude,
      }, options);
      evaluations.push({ ...evaluation, dataset, trapId });
    }
  }

  if (evaluations.length === 0) {
    const nearest = getNearestDisplayCandidate(datasets, current, options);
    if (!nearest) return emptyResult();
    const datasetId = nearest.dataset?.key || nearest.dataset?.id || nearest.dataset?.country || "dataset";
    return emptyResult({
      nearestTrapId: `${datasetId}:${nearest.trapId}`,
      nearestTrapDistanceM: nearest.distanceM,
      nearestTrapSpeedKph: Number.isFinite(nearest.trap?.[2]) ? nearest.trap[2] : null,
      nearestTrapSpeedMeta: getTrapMeta(nearest.trap),
      nearestTrapDataset: nearest.dataset,
      cameraApproachReason: "no-candidate-within-alert-distance",
    });
  }

  const accepted = evaluations
    .filter((evaluation) => evaluation.accepted)
    .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
  if (accepted.length > 0) {
    const result = buildCandidateResult(accepted[0], accepted[0].dataset, accepted[0].trapId);
    return {
      ...result,
      cameraApproachCandidateCount: evaluations.length,
      cameraApproachDetails: result.cameraApproachDetails
        ? { ...result.cameraApproachDetails, candidateCount: evaluations.length }
        : null,
    };
  }

  const nearest = evaluations
    .slice()
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  return emptyResult({
    nearestTrapDistanceM: nearest?.distanceM ?? null,
    cameraApproachState: nearest?.state || "near-not-approaching",
    cameraApproachConfidence: nearest?.confidence || "none",
    cameraApproachReason: nearest?.reason || "no-approaching-candidate",
    cameraApproachCandidateCount: evaluations.length,
  });
}
