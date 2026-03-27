import {
  HISTOGRAM_BUCKETS,
  MAX_ACCURACY_INFLUENCE_M,
  MIN_DISTANCE_NOISE_FLOOR_M,
  MIN_VALID_EPOCH_MS,
  MOVING_SPEED_THRESHOLD_MS,
  STALE_SAMPLE_AGE_MS,
  STATIONARY_SPEED_THRESHOLD_MS,
} from "./constants.js";

export function normalizeStoredSummary(summary, fallbackNow = Date.now()) {
  if (!summary || typeof summary !== "object") return null;

  return {
    source: "saved",
    savedAtMs: Number.isFinite(summary.savedAtMs) ? summary.savedAtMs : fallbackNow,
    durationMs: Number.isFinite(summary.durationMs) ? summary.durationMs : 0,
    sampleCount: Number.isFinite(summary.sampleCount) ? summary.sampleCount : 0,
    currentIntervalMs: Number.isFinite(summary.currentIntervalMs) ? summary.currentIntervalMs : null,
    averageIntervalMs: Number.isFinite(summary.averageIntervalMs) ? summary.averageIntervalMs : null,
    medianIntervalMs: Number.isFinite(summary.medianIntervalMs) ? summary.medianIntervalMs : null,
    minIntervalMs: Number.isFinite(summary.minIntervalMs) ? summary.minIntervalMs : null,
    maxIntervalMs: Number.isFinite(summary.maxIntervalMs) ? summary.maxIntervalMs : null,
    effectiveAverageHz: Number.isFinite(summary.effectiveAverageHz) ? summary.effectiveAverageHz : null,
    bestObservedHz: Number.isFinite(summary.bestObservedHz) ? summary.bestObservedHz : null,
    fiveSecondHz: Number.isFinite(summary.fiveSecondHz) ? summary.fiveSecondHz : null,
    wholeSessionHz: Number.isFinite(summary.wholeSessionHz) ? summary.wholeSessionHz : null,
    averageAccuracyM: Number.isFinite(summary.averageAccuracyM) ? summary.averageAccuracyM : null,
    latestAccuracyM: Number.isFinite(summary.latestAccuracyM) ? summary.latestAccuracyM : null,
    nullSpeedCount: Number.isFinite(summary.nullSpeedCount) ? summary.nullSpeedCount : 0,
    nullHeadingCount: Number.isFinite(summary.nullHeadingCount) ? summary.nullHeadingCount : 0,
    missingAltitudeCount: Number.isFinite(summary.missingAltitudeCount) ? summary.missingAltitudeCount : 0,
    staleSampleCount: Number.isFinite(summary.staleSampleCount) ? summary.staleSampleCount : 0,
    jitterMs: Number.isFinite(summary.jitterMs) ? summary.jitterMs : null,
    fieldAvailability: summary.fieldAvailability || {
      speed: false,
      heading: false,
      altitude: false,
      altitudeAccuracy: false,
      accuracy: false,
    },
    unsupportedFields: Array.isArray(summary.unsupportedFields) ? summary.unsupportedFields : [],
    motion: summary.motion || {},
    histogram: Array.isArray(summary.histogram) ? summary.histogram : [],
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
    statusText: typeof summary.statusText === "string" ? summary.statusText : "",
    notes: typeof summary.notes === "string" ? summary.notes : "",
  };
}

export function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function normalizePositionTimestamp(timestamp, fallbackMs = Date.now()) {
  if (!isFiniteNumber(timestamp)) return fallbackMs;

  const safeFallbackMs = isFiniteNumber(fallbackMs) ? fallbackMs : Date.now();
  const maxReasonableMs = safeFallbackMs + (60 * 1000);

  if (timestamp < MIN_VALID_EPOCH_MS || timestamp > maxReasonableMs) {
    return safeFallbackMs;
  }

  return timestamp;
}

export function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function standardDeviation(values) {
  if (values.length < 2) return null;
  const meanValue = average(values);
  const variance = values.reduce((sum, value) => {
    const delta = value - meanValue;
    return sum + (delta * delta);
  }, 0) / values.length;
  return Math.sqrt(variance);
}

export function haversineDistance(a, b) {
  if (!isFiniteNumber(a.latitude) || !isFiniteNumber(a.longitude) || !isFiniteNumber(b.latitude) || !isFiniteNumber(b.longitude)) {
    return null;
  }

  const radius = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const calc = (
    sinLat * sinLat
    + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  );

  return radius * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

export function getMovementThresholdM(currentAccuracyM, previousAccuracyM) {
  const accuracies = [currentAccuracyM, previousAccuracyM].filter(isFiniteNumber);
  const accuracyFloorM = accuracies.length
    ? Math.min(Math.max.apply(null, accuracies), MAX_ACCURACY_INFLUENCE_M)
    : 0;

  return Math.max(MIN_DISTANCE_NOISE_FLOOR_M, accuracyFloorM * 0.5);
}

export function normalizeSpeed(value) {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

export function normalizeHeading(value) {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

export function normalizeMetric(value) {
  return isFiniteNumber(value) ? value : null;
}

export function classifyMotion(coords, previousSample, callbackPerfMs) {
  const reportedSpeed = normalizeSpeed(coords.speed);

  if (reportedSpeed !== null) {
    if (reportedSpeed >= MOVING_SPEED_THRESHOLD_MS) {
      return { state: "moving", source: "reported", derivedSpeedMps: null, distanceM: null };
    }
    if (reportedSpeed <= STATIONARY_SPEED_THRESHOLD_MS) {
      return { state: "stationary", source: "reported", derivedSpeedMps: null, distanceM: null };
    }
  }

  if (!previousSample) {
    return { state: "uncertain", source: "unknown", derivedSpeedMps: null, distanceM: null };
  }

  const intervalMs = callbackPerfMs - previousSample.performanceNowMs;
  const distanceM = haversineDistance(
    { latitude: previousSample.latitude, longitude: previousSample.longitude },
    { latitude: coords.latitude, longitude: coords.longitude },
  );

  if (!isFiniteNumber(intervalMs) || intervalMs <= 0 || !isFiniteNumber(distanceM)) {
    return { state: "uncertain", source: "unknown", derivedSpeedMps: null, distanceM: null };
  }

  const derivedSpeedMps = distanceM / (intervalMs / 1000);
  const movementThresholdM = getMovementThresholdM(coords.accuracy, previousSample.accuracyM);

  if (distanceM >= movementThresholdM && derivedSpeedMps >= MOVING_SPEED_THRESHOLD_MS) {
    return { state: "moving", source: "derived", derivedSpeedMps, distanceM };
  }

  if (distanceM <= Math.max(2, movementThresholdM * 0.5) && derivedSpeedMps <= STATIONARY_SPEED_THRESHOLD_MS) {
    return { state: "stationary", source: "derived", derivedSpeedMps, distanceM };
  }

  return { state: "uncertain", source: "unknown", derivedSpeedMps, distanceM };
}

export function isStaleSample(positionTimestampMs, previousSample, sampleAgeMs) {
  if (isFiniteNumber(positionTimestampMs) && previousSample && isFiniteNumber(previousSample.positionTimestampMs)) {
    if (positionTimestampMs <= previousSample.positionTimestampMs) {
      return true;
    }
  }

  return isFiniteNumber(sampleAgeMs) && sampleAgeMs > STALE_SAMPLE_AGE_MS;
}

export function computeSessionHz(samples, windowMs = null) {
  if (samples.length < 2) return null;

  let windowSamples = samples;
  if (isFiniteNumber(windowMs)) {
    const latestPerfMs = samples[samples.length - 1].performanceNowMs;
    const startPerfMs = latestPerfMs - windowMs;
    windowSamples = samples.filter((sample) => sample.performanceNowMs >= startPerfMs);
  }

  if (windowSamples.length < 2) return null;

  const first = windowSamples[0];
  const last = windowSamples[windowSamples.length - 1];
  const spanMs = last.performanceNowMs - first.performanceNowMs;

  if (!isFiniteNumber(spanMs) || spanMs <= 0) return null;
  return ((windowSamples.length - 1) * 1000) / spanMs;
}

export function computeMotionHz(samples, motionState) {
  const intervals = [];
  let sampleCount = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.movementState === motionState) {
      sampleCount += 1;
      if (isFiniteNumber(sample.intervalMs) && sample.intervalMs > 0) {
        intervals.push(sample.intervalMs);
      }
    }
  }

  return {
    sampleCount,
    hz: intervals.length ? 1000 / average(intervals) : null,
  };
}

export function buildHistogram(intervals, histogramBuckets = HISTOGRAM_BUCKETS) {
  return histogramBuckets.map((bucket) => {
    const count = intervals.filter((value) => value >= bucket.min && value < bucket.max).length;
    return { label: bucket.label, count };
  });
}

export function summarizeSession({
  samples,
  durationMs,
  source = "current",
  savedAtMs = null,
  notes = "",
  statusText = "",
}) {
  const latestSample = samples.length ? samples[samples.length - 1] : null;
  const intervals = samples
    .map((sample) => sample.intervalMs)
    .filter((value) => isFiniteNumber(value) && value > 0);
  const accuracyValues = samples
    .map((sample) => sample.accuracyM)
    .filter(isFiniteNumber);
  const fieldAvailability = {
    speed: samples.some((sample) => isFiniteNumber(sample.speedMps)),
    heading: samples.some((sample) => isFiniteNumber(sample.headingDeg)),
    altitude: samples.some((sample) => isFiniteNumber(sample.altitudeM)),
    altitudeAccuracy: samples.some((sample) => isFiniteNumber(sample.altitudeAccuracyM)),
    accuracy: samples.some((sample) => isFiniteNumber(sample.accuracyM)),
  };
  const unsupportedFields = Object.keys(fieldAvailability).filter((field) => !fieldAvailability[field]);
  const movingSummary = computeMotionHz(samples, "moving");
  const stationarySummary = computeMotionHz(samples, "stationary");

  return {
    source,
    savedAtMs,
    durationMs,
    sampleCount: samples.length,
    currentIntervalMs: latestSample ? latestSample.intervalMs : null,
    averageIntervalMs: average(intervals),
    medianIntervalMs: median(intervals),
    minIntervalMs: intervals.length ? Math.min.apply(null, intervals) : null,
    maxIntervalMs: intervals.length ? Math.max.apply(null, intervals) : null,
    effectiveAverageHz: intervals.length ? 1000 / average(intervals) : null,
    bestObservedHz: intervals.length ? 1000 / Math.min.apply(null, intervals) : null,
    fiveSecondHz: computeSessionHz(samples, 5000),
    wholeSessionHz: computeSessionHz(samples),
    averageAccuracyM: average(accuracyValues),
    latestAccuracyM: latestSample ? latestSample.accuracyM : null,
    nullSpeedCount: samples.filter((sample) => !isFiniteNumber(sample.speedMps)).length,
    nullHeadingCount: samples.filter((sample) => !isFiniteNumber(sample.headingDeg)).length,
    missingAltitudeCount: samples.filter((sample) => !isFiniteNumber(sample.altitudeM)).length,
    staleSampleCount: samples.filter((sample) => sample.isStale).length,
    jitterMs: standardDeviation(intervals),
    fieldAvailability,
    unsupportedFields,
    histogram: buildHistogram(intervals),
    motion: {
      latestState: latestSample ? latestSample.movementState : "uncertain",
      latestSource: latestSample ? latestSample.movementSource : "unknown",
      movingHz: movingSummary.hz,
      stationaryHz: stationarySummary.hz,
      movingSamples: movingSummary.sampleCount,
      stationarySamples: stationarySummary.sampleCount,
    },
    warnings: [],
    statusText,
    notes: typeof notes === "string" ? notes.trim() : "",
  };
}

export function createSample({
  position,
  previousSample,
  sampleIndex,
  callbackPerfMs,
  callbackWallClockMs,
  hiddenNow,
}) {
  const coords = position.coords || {};
  const positionTimestampMs = normalizePositionTimestamp(position.timestamp, callbackWallClockMs);
  const intervalMs = previousSample ? callbackPerfMs - previousSample.performanceNowMs : null;
  const effectiveHz = isFiniteNumber(intervalMs) && intervalMs > 0 ? 1000 / intervalMs : null;
  const geoTimestampDeltaMs = previousSample && isFiniteNumber(positionTimestampMs) && isFiniteNumber(previousSample.positionTimestampMs)
    ? positionTimestampMs - previousSample.positionTimestampMs
    : null;
  const sampleAgeMs = isFiniteNumber(positionTimestampMs)
    ? Math.max(0, callbackWallClockMs - positionTimestampMs)
    : null;
  const motion = classifyMotion(coords, previousSample, callbackPerfMs);

  return {
    index: sampleIndex,
    callbackWallClockMs,
    performanceNowMs: callbackPerfMs,
    positionTimestampMs,
    latitude: normalizeMetric(coords.latitude),
    longitude: normalizeMetric(coords.longitude),
    speedMps: normalizeSpeed(coords.speed),
    headingDeg: normalizeHeading(coords.heading),
    accuracyM: normalizeMetric(coords.accuracy),
    altitudeM: normalizeMetric(coords.altitude),
    altitudeAccuracyM: normalizeMetric(coords.altitudeAccuracy),
    intervalMs,
    effectiveHz,
    geoTimestampDeltaMs,
    sampleAgeMs,
    movementState: motion.state,
    movementSource: motion.source,
    derivedSpeedMps: motion.derivedSpeedMps,
    distanceFromPreviousM: motion.distanceM,
    visibilityState: hiddenNow ? "hidden" : "visible",
    isStale: isStaleSample(positionTimestampMs, previousSample, sampleAgeMs),
  };
}
