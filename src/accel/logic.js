import {
  CLOCK_DELTA_DISAGREEMENT_MS,
  CLOCK_DELTA_DISAGREEMENT_RATIO,
  FT_TO_M,
  MAX_ACCURACY_INFLUENCE_M,
  MAX_DEBUG_SAMPLE_ROWS,
  MAX_PLAUSIBLE_SPEED_MS,
  MIN_DISTANCE_NOISE_FLOOR_M,
  MIN_VALID_RUN_DURATION_MS,
  MIN_VALID_RUN_SAMPLES,
  MOVING_SPEED_THRESHOLD_MS,
  SPARSE_INTERVAL_MS,
  STALE_INTERVAL_MS,
  STATIONARY_SPEED_THRESHOLD_MS,
  TRACE_DUPLICATE_EPSILON_MS,
} from "./constants.js";

export function toFiniteNumber(value, fallback) {
  return isFiniteNumber(Number(value)) ? Number(value) : fallback;
}

export function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createRunState({ preset, settings, partials, nowMs, perfMs }) {
  return {
    id: `run-${nowMs}-${String(Math.floor(Math.random() * 100000))}`,
    preset,
    stage: "armed",
    createdAtMs: nowMs,
    armedAtPerfMs: perfMs,
    speedUnit: settings.speedUnit,
    distanceUnit: settings.distanceUnit,
    launchThresholdMs: settings.launchThresholdMs,
    rolloutApplied: Boolean(settings.rolloutEnabled && preset.standingStart),
    rolloutDistanceM: settings.rolloutEnabled && preset.standingStart ? FT_TO_M : 0,
    partials,
    speedTrace: [],
    sampleLog: [],
    sampleCount: 0,
    intervalValues: [],
    accuracyValues: [],
    sparseCount: 0,
    staleCount: 0,
    nullSpeedCount: 0,
    derivedSpeedCount: 0,
    distanceSinceArmM: 0,
    prevDistanceSinceArmM: 0,
    launchCrossPerfMs: null,
    launchCrossDistanceM: null,
    launchCrossAltitudeM: null,
    startPerfMs: null,
    startDistanceM: null,
    startAltitudeM: null,
    startAccuracyM: null,
    startTraceSpeedMs: null,
    startSpeedSource: null,
    finishPerfMs: null,
    finishDistanceM: null,
    finishSpeedMs: null,
    finishAltitudeM: null,
    lastSample: null,
    result: null,
  };
}

export function averageArray(values) {
  if (!values || !values.length) return null;
  let total = 0;
  let count = 0;

  for (let index = 0; index < values.length; index += 1) {
    if (!isFiniteNumber(values[index])) continue;
    total += values[index];
    count += 1;
  }

  return count ? total / count : null;
}

export function averageFinite(left, right) {
  const values = [];
  if (isFiniteNumber(left)) values.push(left);
  if (isFiniteNumber(right)) values.push(right);
  return values.length ? averageArray(values) : null;
}

export function dedupeList(values) {
  const deduped = [];
  for (let index = 0; index < values.length; index += 1) {
    if (deduped.indexOf(values[index]) === -1) deduped.push(values[index]);
  }
  return deduped;
}

export function computeIntervalStats(intervals) {
  if (!intervals || !intervals.length) {
    return {
      averageMs: null,
      jitterMs: null,
      hz: null,
      maxMs: null,
    };
  }

  let total = 0;
  let maxMs = 0;
  for (let index = 0; index < intervals.length; index += 1) {
    total += intervals[index];
    if (intervals[index] > maxMs) maxMs = intervals[index];
  }

  const averageMs = total / intervals.length;
  let variance = 0;
  for (let varianceIndex = 0; varianceIndex < intervals.length; varianceIndex += 1) {
    variance += Math.pow(intervals[varianceIndex] - averageMs, 2);
  }

  variance = variance / intervals.length;

  return {
    averageMs,
    jitterMs: Math.sqrt(variance),
    hz: averageMs > 0 ? 1000 / averageMs : null,
    maxMs,
  };
}

export function evaluateQuality(input) {
  let score = 100;
  const warningKeys = [];

  if (!isFiniteNumber(input.sampleCount) || input.sampleCount < (input.isLive ? 2 : MIN_VALID_RUN_SAMPLES)) {
    return { grade: "invalid", score: 0, warningKeys };
  }

  if (!input.isLive && (!isFiniteNumber(input.durationMs) || input.durationMs < MIN_VALID_RUN_DURATION_MS)) {
    return { grade: "invalid", score: 0, warningKeys };
  }

  if (!isFiniteNumber(input.averageAccuracyM)) score -= 15;
  else if (input.averageAccuracyM > 35) {
    score -= 60;
    warningKeys.push("accelWarningAccuracy");
  } else if (input.averageAccuracyM > 20) {
    score -= 35;
    warningKeys.push("accelWarningAccuracy");
  } else if (input.averageAccuracyM > 12) {
    score -= 15;
  }

  if (!isFiniteNumber(input.averageHz) || input.averageHz <= 0) {
    score -= 35;
  } else if (input.averageHz < 0.6) {
    score -= 55;
    warningKeys.push("accelWarningSparse");
  } else if (input.averageHz < 1.0) {
    score -= 30;
    warningKeys.push("accelWarningSparse");
  } else if (input.averageHz < 1.5) {
    score -= 15;
  }

  if (isFiniteNumber(input.averageIntervalMs) && input.averageIntervalMs >= SPARSE_INTERVAL_MS) {
    score -= 15;
    if (warningKeys.indexOf("accelWarningSparse") === -1) warningKeys.push("accelWarningSparse");
  }

  if (isFiniteNumber(input.jitterMs) && input.jitterMs > 900) score -= 18;
  else if (isFiniteNumber(input.jitterMs) && input.jitterMs > 450) score -= 8;

  if (input.staleCount > 0) {
    score -= Math.min(30, input.staleCount * 8);
    warningKeys.push("accelWarningStale");
  }

  if (input.sparseCount > 0) {
    score -= Math.min(25, input.sparseCount * 6);
    if (warningKeys.indexOf("accelWarningSparse") === -1) warningKeys.push("accelWarningSparse");
  }

  if (input.derivedShare > 0.4) {
    score -= input.derivedShare > 0.8 ? 18 : 8;
    warningKeys.push("accelWarningDerived");
  }

  if (input.nullSpeedShare > 0.8) score -= 10;

  score = clamp(score, 0, 100);

  if (score <= 25) return { grade: "invalid", score, warningKeys: dedupeList(warningKeys) };
  if (score >= 80) return { grade: "good", score, warningKeys: dedupeList(warningKeys) };
  if (score >= 55) return { grade: "fair", score, warningKeys: dedupeList(warningKeys) };
  return { grade: "poor", score, warningKeys: dedupeList(warningKeys) };
}

export function normalizeReportedSpeedMs(value) {
  if (!isFiniteNumber(value) || value < 0) return null;
  return clamp(value, 0, MAX_PLAUSIBLE_SPEED_MS);
}

export function getMovementThresholdM(currentAccuracyM, previousAccuracyM) {
  const accuracies = [];
  if (isFiniteNumber(currentAccuracyM)) accuracies.push(currentAccuracyM);
  if (isFiniteNumber(previousAccuracyM)) accuracies.push(previousAccuracyM);

  const accuracyFloorM = accuracies.length
    ? Math.min(Math.max.apply(null, accuracies), MAX_ACCURACY_INFLUENCE_M)
    : 0;

  return Math.max(MIN_DISTANCE_NOISE_FLOOR_M, accuracyFloorM * 0.5);
}

export function buildDerivedSpeedMs(previousSample, deltaMs, segmentDistanceM, accuracyM) {
  if (!previousSample || !isFiniteNumber(deltaMs) || deltaMs <= 0 || !isFiniteNumber(segmentDistanceM)) return null;

  let derivedSpeedMs = segmentDistanceM / (deltaMs / 1000);
  if (!isFiniteNumber(derivedSpeedMs) || derivedSpeedMs < 0) return null;

  const movementThresholdM = getMovementThresholdM(accuracyM, previousSample.accuracyM);
  if (segmentDistanceM <= Math.max(2, movementThresholdM * 0.5) && derivedSpeedMs <= STATIONARY_SPEED_THRESHOLD_MS) {
    derivedSpeedMs = 0;
  }

  return clamp(derivedSpeedMs, 0, MAX_PLAUSIBLE_SPEED_MS);
}

export function resolveSampleSpeed(rawSpeedMs, previousSample, deltaMs, segmentDistanceM, accuracyM) {
  const reportedSpeedMs = normalizeReportedSpeedMs(rawSpeedMs);
  const derivedSpeedMs = buildDerivedSpeedMs(previousSample, deltaMs, segmentDistanceM, accuracyM);

  if (reportedSpeedMs === null) {
    return {
      reportedSpeedMs: null,
      derivedSpeedMs,
      speedMs: derivedSpeedMs !== null ? derivedSpeedMs : 0,
      speedSource: "derived",
    };
  }

  if (derivedSpeedMs !== null) {
    const movementThresholdM = getMovementThresholdM(accuracyM, previousSample ? previousSample.accuracyM : null);
    const reportedLooksStationary = reportedSpeedMs <= STATIONARY_SPEED_THRESHOLD_MS;
    const derivedLooksMoving = segmentDistanceM >= movementThresholdM && derivedSpeedMs >= MOVING_SPEED_THRESHOLD_MS;
    const derivedClearlyHigher = derivedSpeedMs >= Math.max(MOVING_SPEED_THRESHOLD_MS + 0.5, reportedSpeedMs * 2.5)
      && (derivedSpeedMs - reportedSpeedMs) >= 1.5;

    if (reportedLooksStationary && derivedLooksMoving && derivedClearlyHigher) {
      return {
        reportedSpeedMs,
        derivedSpeedMs,
        speedMs: derivedSpeedMs,
        speedSource: "derived",
      };
    }
  }

  return {
    reportedSpeedMs,
    derivedSpeedMs,
    speedMs: reportedSpeedMs,
    speedSource: "reported",
  };
}

export function getDistanceM(latA, lonA, latB, lonB) {
  if (!isFiniteNumber(latA) || !isFiniteNumber(lonA) || !isFiniteNumber(latB) || !isFiniteNumber(lonB)) return 0;

  const rad = Math.PI / 180;
  const phi1 = latA * rad;
  const phi2 = latB * rad;
  const deltaPhi = (latB - latA) * rad;
  const deltaLambda = (lonB - lonA) * rad;
  const sinPhi = Math.sin(deltaPhi / 2);
  const sinLambda = Math.sin(deltaLambda / 2);
  const a = (sinPhi * sinPhi) + (Math.cos(phi1) * Math.cos(phi2) * sinLambda * sinLambda);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

export function normalizeNonNegativeDurationMs(value) {
  if (!isFiniteNumber(value) || value < 0) return null;
  return value;
}

export function resolveClockDeltaMs(perfDeltaMs, receivedDeltaMs) {
  const normalizedPerfMs = normalizeNonNegativeDurationMs(perfDeltaMs);
  const normalizedReceivedMs = normalizeNonNegativeDurationMs(receivedDeltaMs);

  if (normalizedPerfMs === null) return normalizedReceivedMs;
  if (normalizedReceivedMs === null) return normalizedPerfMs;

  if (normalizedPerfMs === 0 || normalizedReceivedMs === 0) {
    if (Math.max(normalizedPerfMs, normalizedReceivedMs) >= CLOCK_DELTA_DISAGREEMENT_MS) {
      return Math.min(normalizedPerfMs, normalizedReceivedMs);
    }
    return Math.max(normalizedPerfMs, normalizedReceivedMs);
  }

  const disagreementRatio = Math.max(normalizedPerfMs, normalizedReceivedMs) / Math.max(1, Math.min(normalizedPerfMs, normalizedReceivedMs));
  const disagreementMs = Math.abs(normalizedPerfMs - normalizedReceivedMs);
  if (disagreementRatio >= CLOCK_DELTA_DISAGREEMENT_RATIO && disagreementMs >= CLOCK_DELTA_DISAGREEMENT_MS) {
    return normalizedReceivedMs;
  }

  return normalizedPerfMs;
}

export function createLiveSample({ position, previousSample, rawPerfMs, receivedAtMs }) {
  const geoMs = isFiniteNumber(Number(position.timestamp)) ? Number(position.timestamp) : receivedAtMs;
  const coords = position && position.coords ? position.coords : {};
  const latitude = isFiniteNumber(coords.latitude) ? coords.latitude : null;
  const longitude = isFiniteNumber(coords.longitude) ? coords.longitude : null;
  const accuracyM = isFiniteNumber(coords.accuracy) ? Math.max(0, coords.accuracy) : null;
  const altitudeM = isFiniteNumber(coords.altitude) ? coords.altitude : null;
  const headingDeg = isFiniteNumber(coords.heading) && coords.heading >= 0 ? coords.heading : null;
  const rawSpeedMs = normalizeReportedSpeedMs(coords.speed);

  const rawPerfDeltaMs = previousSample ? rawPerfMs - previousSample.rawPerfMs : null;
  const receivedDeltaMs = previousSample ? receivedAtMs - previousSample.receivedAtMs : null;
  const deltaMs = previousSample ? resolveClockDeltaMs(rawPerfDeltaMs, receivedDeltaMs) : null;
  const perfMs = previousSample && isFiniteNumber(deltaMs) ? previousSample.perfMs + deltaMs : rawPerfMs;
  const segmentDistanceM = previousSample ? getDistanceM(previousSample.latitude, previousSample.longitude, latitude, longitude) : 0;
  const resolvedSpeed = resolveSampleSpeed(rawSpeedMs, previousSample, deltaMs, segmentDistanceM, accuracyM);

  return {
    rawPerfMs,
    perfMs,
    receivedAtMs,
    geoMs,
    latitude,
    longitude,
    accuracyM,
    altitudeM,
    headingDeg,
    rawSpeedMs: resolvedSpeed.reportedSpeedMs,
    derivedSpeedMs: resolvedSpeed.derivedSpeedMs,
    speedMs: resolvedSpeed.speedMs,
    speedSource: resolvedSpeed.speedSource,
    deltaMs,
    segmentDistanceM,
    stale: isFiniteNumber(deltaMs) && deltaMs >= STALE_INTERVAL_MS,
    sparse: isFiniteNumber(deltaMs) && deltaMs >= SPARSE_INTERVAL_MS,
  };
}

export function interpolateSpeedCrossing(previousSample, currentSample, targetSpeedMs) {
  if (!previousSample || !currentSample) return null;
  if (!isFiniteNumber(previousSample.speedMs) || !isFiniteNumber(currentSample.speedMs)) return null;
  if (previousSample.speedMs >= targetSpeedMs || currentSample.speedMs < targetSpeedMs) return null;

  const speedDelta = currentSample.speedMs - previousSample.speedMs;
  if (!isFiniteNumber(speedDelta) || speedDelta <= 0) return null;

  let ratio = (targetSpeedMs - previousSample.speedMs) / speedDelta;
  ratio = clamp(ratio, 0, 1);

  return {
    ratio,
    perfMs: interpolateValue(previousSample.perfMs, currentSample.perfMs, ratio),
  };
}

export function interpolateRangeCrossing(previousValue, currentValue, targetValue, previousPerfMs, currentPerfMs) {
  if (!isFiniteNumber(previousValue) || !isFiniteNumber(currentValue) || !isFiniteNumber(targetValue)) return null;
  if (previousValue >= targetValue || currentValue < targetValue) return null;

  const delta = currentValue - previousValue;
  if (!isFiniteNumber(delta) || delta <= 0) return null;

  let ratio = (targetValue - previousValue) / delta;
  ratio = clamp(ratio, 0, 1);

  return {
    ratio,
    perfMs: interpolateValue(previousPerfMs, currentPerfMs, ratio),
  };
}

export function interpolateValue(start, end, ratio) {
  return start + ((end - start) * ratio);
}

export function interpolateMeasurement(previousValue, currentValue, ratio) {
  if (isFiniteNumber(previousValue) && isFiniteNumber(currentValue)) {
    return interpolateValue(previousValue, currentValue, ratio);
  }
  if (isFiniteNumber(currentValue)) return currentValue;
  if (isFiniteNumber(previousValue)) return previousValue;
  return null;
}

export function ensureSpeedTraceStarted(run) {
  if (!run || !run.speedTrace) return;
  if (run.startPerfMs === null) return;
  if (run.speedTrace.length) return;
  appendSpeedTracePoint(run, 0, run.startTraceSpeedMs, {
    distanceM: 0,
    altitudeM: run.startAltitudeM,
    accuracyM: run.startAccuracyM,
    speedSource: run.startSpeedSource,
  });
}

export function appendSpeedTracePoint(run, elapsedMs, speedMs, details) {
  if (!run || !run.speedTrace) return;
  if (!isFiniteNumber(elapsedMs) || !isFiniteNumber(speedMs)) return;

  const normalizedElapsedMs = Math.max(0, elapsedMs);
  const normalizedSpeedMs = Math.max(0, speedMs);
  const trace = run.speedTrace;
  const lastPoint = trace.length ? trace[trace.length - 1] : null;
  const nextPoint = {
    elapsedMs: normalizedElapsedMs,
    speedMs: normalizedSpeedMs,
  };

  if (details && isFiniteNumber(details.distanceM)) nextPoint.distanceM = Math.max(0, details.distanceM);
  if (details && isFiniteNumber(details.altitudeM)) nextPoint.altitudeM = details.altitudeM;
  if (details && isFiniteNumber(details.accuracyM)) nextPoint.accuracyM = Math.max(0, details.accuracyM);
  if (details && typeof details.speedSource === "string") nextPoint.speedSource = details.speedSource;

  if (lastPoint && Math.abs(lastPoint.elapsedMs - normalizedElapsedMs) <= TRACE_DUPLICATE_EPSILON_MS) {
    lastPoint.elapsedMs = nextPoint.elapsedMs;
    lastPoint.speedMs = nextPoint.speedMs;
    if (Object.prototype.hasOwnProperty.call(nextPoint, "distanceM")) lastPoint.distanceM = nextPoint.distanceM;
    if (Object.prototype.hasOwnProperty.call(nextPoint, "altitudeM")) lastPoint.altitudeM = nextPoint.altitudeM;
    if (Object.prototype.hasOwnProperty.call(nextPoint, "accuracyM")) lastPoint.accuracyM = nextPoint.accuracyM;
    if (Object.prototype.hasOwnProperty.call(nextPoint, "speedSource")) lastPoint.speedSource = nextPoint.speedSource;
    return;
  }

  if (lastPoint && normalizedElapsedMs < lastPoint.elapsedMs) return;

  trace.push(nextPoint);
}

export function appendRunSampleLog(run, sample) {
  if (!run || !sample) return;
  if (!Array.isArray(run.sampleLog)) run.sampleLog = [];

  run.sampleLog.push({
    index: run.sampleLog.length + 1,
    stage: run.stage,
    deltaMs: isFiniteNumber(sample.deltaMs) && sample.deltaMs > 0 ? sample.deltaMs : null,
    effectiveHz: isFiniteNumber(sample.deltaMs) && sample.deltaMs > 0 ? 1000 / sample.deltaMs : null,
    latitude: sample.latitude,
    longitude: sample.longitude,
    rawSpeedMs: sample.rawSpeedMs,
    derivedSpeedMs: sample.derivedSpeedMs,
    speedMs: sample.speedMs,
    speedSource: sample.speedSource,
    headingDeg: sample.headingDeg,
    accuracyM: sample.accuracyM,
    altitudeM: sample.altitudeM,
    distanceFromStartM: isFiniteNumber(run.startDistanceM) ? Math.max(0, run.distanceSinceArmM - run.startDistanceM) : null,
    elapsedFromStartMs: isFiniteNumber(run.startPerfMs) && sample.perfMs >= run.startPerfMs ? sample.perfMs - run.startPerfMs : null,
    stale: Boolean(sample.stale),
    sparse: Boolean(sample.sparse),
  });

  if (run.sampleLog.length > MAX_DEBUG_SAMPLE_ROWS) {
    run.sampleLog = run.sampleLog.slice(-MAX_DEBUG_SAMPLE_ROWS);
    for (let index = 0; index < run.sampleLog.length; index += 1) {
      run.sampleLog[index].index = index + 1;
    }
  }
}

export function normalizeStoredSpeedTrace(trace, expectedElapsedMs) {
  if (!Array.isArray(trace) || !trace.length) return [];

  let normalized = [];
  for (let index = 0; index < trace.length; index += 1) {
    const point = trace[index];
    if (!point || typeof point !== "object") continue;
    if (!isFiniteNumber(point.elapsedMs) || !isFiniteNumber(point.speedMs)) continue;
    const normalizedPoint = {
      elapsedMs: Math.max(0, point.elapsedMs),
      speedMs: Math.max(0, point.speedMs),
    };
    if (isFiniteNumber(point.distanceM)) normalizedPoint.distanceM = Math.max(0, point.distanceM);
    if (isFiniteNumber(point.altitudeM)) normalizedPoint.altitudeM = point.altitudeM;
    if (isFiniteNumber(point.accuracyM)) normalizedPoint.accuracyM = Math.max(0, point.accuracyM);
    if (typeof point.speedSource === "string") normalizedPoint.speedSource = point.speedSource;
    normalized.push(normalizedPoint);
  }

  if (!normalized.length) return [];
  normalized.sort((left, right) => left.elapsedMs - right.elapsedMs);
  normalized = repairStoredSpeedTrace(normalized, expectedElapsedMs);
  return compactSpeedTrace(normalized);
}

export function normalizeStoredSampleLog(sampleLog) {
  if (!Array.isArray(sampleLog) || !sampleLog.length) return [];

  const normalized = [];
  for (let index = 0; index < sampleLog.length; index += 1) {
    const sample = sampleLog[index];
    if (!sample || typeof sample !== "object") continue;

    normalized.push({
      index: normalized.length + 1,
      stage: typeof sample.stage === "string" ? sample.stage : "armed",
      deltaMs: isFiniteNumber(sample.deltaMs) ? Math.max(0, sample.deltaMs) : null,
      effectiveHz: isFiniteNumber(sample.effectiveHz) ? Math.max(0, sample.effectiveHz) : null,
      latitude: isFiniteNumber(sample.latitude) ? sample.latitude : null,
      longitude: isFiniteNumber(sample.longitude) ? sample.longitude : null,
      rawSpeedMs: isFiniteNumber(sample.rawSpeedMs) ? Math.max(0, sample.rawSpeedMs) : null,
      derivedSpeedMs: isFiniteNumber(sample.derivedSpeedMs) ? Math.max(0, sample.derivedSpeedMs) : null,
      speedMs: isFiniteNumber(sample.speedMs) ? Math.max(0, sample.speedMs) : null,
      speedSource: typeof sample.speedSource === "string" ? sample.speedSource : "reported",
      headingDeg: isFiniteNumber(sample.headingDeg) ? sample.headingDeg : null,
      accuracyM: isFiniteNumber(sample.accuracyM) ? Math.max(0, sample.accuracyM) : null,
      altitudeM: isFiniteNumber(sample.altitudeM) ? sample.altitudeM : null,
      distanceFromStartM: isFiniteNumber(sample.distanceFromStartM) ? Math.max(0, sample.distanceFromStartM) : null,
      elapsedFromStartMs: isFiniteNumber(sample.elapsedFromStartMs) ? Math.max(0, sample.elapsedFromStartMs) : null,
      stale: Boolean(sample.stale),
      sparse: Boolean(sample.sparse),
    });
  }

  return normalized.slice(-MAX_DEBUG_SAMPLE_ROWS);
}

export function repairStoredSpeedTrace(trace, expectedElapsedMs) {
  if (!Array.isArray(trace) || !trace.length) return [];
  if (!isFiniteNumber(expectedElapsedMs) || expectedElapsedMs <= 0) return trace.slice();

  const normalizedExpectedMs = Math.max(1, expectedElapsedMs);
  const maxAllowedElapsedMs = normalizedExpectedMs * 1.25;
  const maxElapsedMs = trace[trace.length - 1].elapsedMs;
  if (!isFiniteNumber(maxElapsedMs) || maxElapsedMs <= 0) return trace.slice();

  let inRangeCount = 0;
  for (let index = 0; index < trace.length; index += 1) {
    if (trace[index].elapsedMs <= maxAllowedElapsedMs) inRangeCount += 1;
  }

  if (maxElapsedMs > maxAllowedElapsedMs && inRangeCount >= 2) {
    return trace.filter((point) => point.elapsedMs <= maxAllowedElapsedMs);
  }

  if (maxElapsedMs <= normalizedExpectedMs * CLOCK_DELTA_DISAGREEMENT_RATIO) return trace.slice();

  const scale = normalizedExpectedMs / maxElapsedMs;
  const scaled = [];
  for (let scaleIndex = 0; scaleIndex < trace.length; scaleIndex += 1) {
    const sourcePoint = trace[scaleIndex];
    const scaledPoint = {
      elapsedMs: sourcePoint.elapsedMs * scale,
      speedMs: sourcePoint.speedMs,
    };
    if (isFiniteNumber(sourcePoint.distanceM)) scaledPoint.distanceM = sourcePoint.distanceM;
    if (isFiniteNumber(sourcePoint.altitudeM)) scaledPoint.altitudeM = sourcePoint.altitudeM;
    if (isFiniteNumber(sourcePoint.accuracyM)) scaledPoint.accuracyM = sourcePoint.accuracyM;
    if (typeof sourcePoint.speedSource === "string") scaledPoint.speedSource = sourcePoint.speedSource;
    scaled.push(scaledPoint);
  }

  return scaled;
}

export function normalizeStoredPartials(partials) {
  if (!Array.isArray(partials) || !partials.length) return [];

  const normalized = [];
  for (let index = 0; index < partials.length; index += 1) {
    const partial = partials[index];
    if (!partial || typeof partial !== "object" || typeof partial.kind !== "string") continue;

    if (partial.kind === "distance") {
      if (!isFiniteNumber(partial.distanceM)) continue;
      normalized.push({
        id: typeof partial.id === "string" ? partial.id : `distance-${String(index)}`,
        kind: "distance",
        labelKey: typeof partial.labelKey === "string" ? partial.labelKey : "accelUnavailable",
        distanceM: Math.max(0, partial.distanceM),
        showTrapSpeed: Boolean(partial.showTrapSpeed),
        elapsedMs: isFiniteNumber(partial.elapsedMs) ? Math.max(0, partial.elapsedMs) : null,
        trapSpeedMs: isFiniteNumber(partial.trapSpeedMs) ? Math.max(0, partial.trapSpeedMs) : null,
      });
      continue;
    }

    if (partial.kind === "speed") {
      if (!isFiniteNumber(partial.startSpeedMs) || !isFiniteNumber(partial.targetSpeedMs)) continue;
      normalized.push({
        id: typeof partial.id === "string" ? partial.id : `speed-${String(index)}`,
        kind: "speed",
        labelKey: typeof partial.labelKey === "string" ? partial.labelKey : "accelUnavailable",
        startSpeedMs: Math.max(0, partial.startSpeedMs),
        targetSpeedMs: Math.max(0, partial.targetSpeedMs),
        elapsedMs: isFiniteNumber(partial.elapsedMs) ? Math.max(0, partial.elapsedMs) : null,
      });
    }
  }

  return normalized;
}

export function serializeRunPartials(partials) {
  if (!Array.isArray(partials) || !partials.length) return [];

  const serialized = [];
  for (let index = 0; index < partials.length; index += 1) {
    const partial = partials[index];
    if (!partial || typeof partial !== "object" || typeof partial.kind !== "string") continue;

    if (partial.kind === "distance") {
      if (!isFiniteNumber(partial.distanceM)) continue;
      serialized.push({
        id: partial.id,
        kind: "distance",
        labelKey: partial.labelKey,
        distanceM: partial.distanceM,
        showTrapSpeed: Boolean(partial.showTrapSpeed),
        elapsedMs: isFiniteNumber(partial.elapsedMs) ? partial.elapsedMs : null,
        trapSpeedMs: isFiniteNumber(partial.trapSpeedMs) ? partial.trapSpeedMs : null,
      });
      continue;
    }

    if (partial.kind === "speed") {
      if (!isFiniteNumber(partial.startSpeedMs) || !isFiniteNumber(partial.targetSpeedMs)) continue;
      serialized.push({
        id: partial.id,
        kind: "speed",
        labelKey: partial.labelKey,
        startSpeedMs: partial.startSpeedMs,
        targetSpeedMs: partial.targetSpeedMs,
        elapsedMs: isFiniteNumber(partial.elapsedMs) ? partial.elapsedMs : null,
      });
    }
  }

  return serialized;
}

export function buildResultSpeedTrace(run, expectedElapsedMs) {
  const postProcessedTrace = buildSpeedTraceFromSampleLog(run, expectedElapsedMs);
  if (postProcessedTrace.length >= 2) {
    return normalizeStoredSpeedTrace(postProcessedTrace, expectedElapsedMs);
  }
  return normalizeStoredSpeedTrace(run && run.speedTrace ? run.speedTrace : [], expectedElapsedMs);
}

export function buildSpeedTraceFromSampleLog(run, expectedElapsedMs) {
  if (!run || !Array.isArray(run.sampleLog) || !run.sampleLog.length) return [];

  const startedSamples = [];
  const hasExpectedElapsedMs = isFiniteNumber(expectedElapsedMs) && expectedElapsedMs > 0;
  for (let index = 0; index < run.sampleLog.length; index += 1) {
    const sample = run.sampleLog[index];
    if (!sample || !isFiniteNumber(sample.speedMs) || !isFiniteNumber(sample.elapsedFromStartMs)) continue;
    if (hasExpectedElapsedMs && sample.elapsedFromStartMs > (expectedElapsedMs + TRACE_DUPLICATE_EPSILON_MS)) continue;
    startedSamples.push(sample);
  }

  const trace = [];
  if (isFiniteNumber(run.startTraceSpeedMs)) {
    trace.push({
      elapsedMs: 0,
      speedMs: Math.max(0, run.startTraceSpeedMs),
      distanceM: 0,
      altitudeM: run.startAltitudeM,
      accuracyM: run.startAccuracyM,
      speedSource: run.startSpeedSource,
    });
  }

  for (let sampleIndex = 0; sampleIndex < startedSamples.length; sampleIndex += 1) {
    const currentSample = startedSamples[sampleIndex];
    let sampleElapsedMs = Math.max(0, currentSample.elapsedFromStartMs);
    if (hasExpectedElapsedMs) sampleElapsedMs = Math.min(sampleElapsedMs, expectedElapsedMs);
    if (trace.length && sampleElapsedMs < (trace[trace.length - 1].elapsedMs - TRACE_DUPLICATE_EPSILON_MS)) continue;

    const nextPoint = {
      elapsedMs: sampleElapsedMs,
      speedMs: Math.max(0, currentSample.speedMs),
      distanceM: isFiniteNumber(currentSample.distanceFromStartM) ? Math.max(0, currentSample.distanceFromStartM) : null,
      altitudeM: isFiniteNumber(currentSample.altitudeM) ? currentSample.altitudeM : null,
      accuracyM: isFiniteNumber(currentSample.accuracyM) ? Math.max(0, currentSample.accuracyM) : null,
      speedSource: typeof currentSample.speedSource === "string" ? currentSample.speedSource : null,
    };

    const lastPoint = trace.length ? trace[trace.length - 1] : null;
    if (lastPoint && Math.abs(lastPoint.elapsedMs - sampleElapsedMs) <= TRACE_DUPLICATE_EPSILON_MS) {
      lastPoint.elapsedMs = nextPoint.elapsedMs;
      lastPoint.speedMs = nextPoint.speedMs;
      lastPoint.distanceM = nextPoint.distanceM;
      lastPoint.altitudeM = nextPoint.altitudeM;
      lastPoint.accuracyM = nextPoint.accuracyM;
      lastPoint.speedSource = nextPoint.speedSource;
    } else {
      trace.push(nextPoint);
    }
  }

  if (isFiniteNumber(expectedElapsedMs) && isFiniteNumber(run.finishSpeedMs)) {
    const finishContext = getSpeedTraceFinishContext(run.sampleLog, expectedElapsedMs);
    const lastPoint = trace.length ? trace[trace.length - 1] : null;
    if (!lastPoint || Math.abs(lastPoint.elapsedMs - expectedElapsedMs) > TRACE_DUPLICATE_EPSILON_MS) {
      trace.push({
        elapsedMs: expectedElapsedMs,
        speedMs: Math.max(0, run.finishSpeedMs),
        distanceM: isFiniteNumber(run.finishDistanceM) && isFiniteNumber(run.startDistanceM)
          ? Math.max(0, run.finishDistanceM - run.startDistanceM)
          : (isFiniteNumber(run.distanceTargetM) ? run.distanceTargetM : (isFiniteNumber(run.preset && run.preset.distanceTargetM) ? run.preset.distanceTargetM : null)),
        altitudeM: isFiniteNumber(run.finishAltitudeM) ? run.finishAltitudeM : null,
        accuracyM: finishContext.accuracyM,
        speedSource: finishContext.speedSource,
      });
    } else {
      lastPoint.elapsedMs = expectedElapsedMs;
      lastPoint.speedMs = Math.max(0, run.finishSpeedMs);
      if (isFiniteNumber(run.finishDistanceM) && isFiniteNumber(run.startDistanceM)) {
        lastPoint.distanceM = Math.max(0, run.finishDistanceM - run.startDistanceM);
      } else if (isFiniteNumber(run.distanceTargetM)) {
        lastPoint.distanceM = run.distanceTargetM;
      } else if (isFiniteNumber(run.preset && run.preset.distanceTargetM)) {
        lastPoint.distanceM = run.preset.distanceTargetM;
      }
      if (isFiniteNumber(run.finishAltitudeM)) lastPoint.altitudeM = run.finishAltitudeM;
      if (isFiniteNumber(finishContext.accuracyM)) lastPoint.accuracyM = finishContext.accuracyM;
      if (typeof finishContext.speedSource === "string") lastPoint.speedSource = finishContext.speedSource;
    }
  }

  return trace;
}

export function getSpeedTraceFinishContext(sampleLog, expectedElapsedMs) {
  if (!Array.isArray(sampleLog) || !sampleLog.length) {
    return {
      accuracyM: null,
      speedSource: null,
    };
  }

  let fallbackSample = null;
  for (let index = 0; index < sampleLog.length; index += 1) {
    const sample = sampleLog[index];
    if (!sample || !isFiniteNumber(sample.elapsedFromStartMs)) continue;
    fallbackSample = sample;
    if (isFiniteNumber(expectedElapsedMs) && sample.elapsedFromStartMs + TRACE_DUPLICATE_EPSILON_MS >= expectedElapsedMs) {
      return {
        accuracyM: isFiniteNumber(sample.accuracyM) ? Math.max(0, sample.accuracyM) : null,
        speedSource: typeof sample.speedSource === "string" ? sample.speedSource : null,
      };
    }
  }

  return {
    accuracyM: fallbackSample && isFiniteNumber(fallbackSample.accuracyM) ? Math.max(0, fallbackSample.accuracyM) : null,
    speedSource: fallbackSample && typeof fallbackSample.speedSource === "string" ? fallbackSample.speedSource : null,
  };
}

export function compactSpeedTrace(trace) {
  const maxPoints = 120;
  if (!Array.isArray(trace) || trace.length <= maxPoints) return trace ? trace.slice() : [];

  const compacted = [];
  const lastIndex = trace.length - 1;
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
    const point = trace[sourceIndex];
    const compactedPoint = {
      elapsedMs: point.elapsedMs,
      speedMs: point.speedMs,
    };
    if (isFiniteNumber(point.distanceM)) compactedPoint.distanceM = point.distanceM;
    if (isFiniteNumber(point.altitudeM)) compactedPoint.altitudeM = point.altitudeM;
    if (isFiniteNumber(point.accuracyM)) compactedPoint.accuracyM = point.accuracyM;
    if (typeof point.speedSource === "string") compactedPoint.speedSource = point.speedSource;
    compacted.push(compactedPoint);
  }
  return compacted;
}

export function seedRunPartialStarts(run) {
  if (!run || run.startPerfMs === null || !run.partials || !run.partials.length) return;

  const runStartSpeedMs = run.preset && isFiniteNumber(run.preset.startSpeedMs) ? run.preset.startSpeedMs : 0;
  for (let index = 0; index < run.partials.length; index += 1) {
    const partial = run.partials[index];
    if (partial.kind !== "speed" || partial.startCrossPerfMs !== null) continue;
    if (partial.startSpeedMs <= (runStartSpeedMs + 0.01)) partial.startCrossPerfMs = run.startPerfMs;
  }
}

export function updateRunPartials(run, previousSample, sample) {
  if (!run || !run.partials || !run.partials.length) return;
  if (!previousSample || !sample || run.startPerfMs === null || run.startDistanceM === null) return;

  const previousSpeed = previousSample.speedMs;
  const currentSpeed = sample.speedMs;
  const previousDistanceFromStartM = Math.max(0, run.prevDistanceSinceArmM - run.startDistanceM);
  const currentDistanceFromStartM = Math.max(0, run.distanceSinceArmM - run.startDistanceM);

  for (let index = 0; index < run.partials.length; index += 1) {
    const partial = run.partials[index];
    if (partial.elapsedMs !== null) continue;

    if (partial.kind === "distance") {
      const distanceCross = interpolateRangeCrossing(
        previousDistanceFromStartM,
        currentDistanceFromStartM,
        partial.distanceM,
        previousSample.perfMs,
        sample.perfMs,
      );

      if (!distanceCross) continue;
      partial.elapsedMs = distanceCross.perfMs - run.startPerfMs;
      partial.trapSpeedMs = interpolateValue(previousSpeed, currentSpeed, distanceCross.ratio);
      continue;
    }

    if (partial.startCrossPerfMs === null) {
      const partialStartCross = interpolateSpeedCrossing(previousSample, sample, partial.startSpeedMs);
      if (partialStartCross && partialStartCross.perfMs >= run.startPerfMs) {
        partial.startCrossPerfMs = partialStartCross.perfMs;
      }
    }

    if (partial.startCrossPerfMs === null) continue;

    const partialTargetCross = interpolateSpeedCrossing(previousSample, sample, partial.targetSpeedMs);
    if (!partialTargetCross || partialTargetCross.perfMs < partial.startCrossPerfMs) continue;
    partial.elapsedMs = partialTargetCross.perfMs - partial.startCrossPerfMs;
  }
}

export function getCompletedRunDistance(run) {
  if (!run) return null;
  if (isFiniteNumber(run.finishDistanceM) && isFiniteNumber(run.startDistanceM)) {
    return Math.max(0, run.finishDistanceM - run.startDistanceM);
  }
  if (run.preset && run.preset.type === "distance" && isFiniteNumber(run.preset.distanceTargetM)) {
    return run.preset.distanceTargetM;
  }
  if (isFiniteNumber(run.distanceSinceArmM) && isFiniteNumber(run.startDistanceM)) {
    return Math.max(0, run.distanceSinceArmM - run.startDistanceM);
  }
  return null;
}

export function buildSlopeAnalysis(startAltitudeM, finishAltitudeM, runDistanceM) {
  if (!isFiniteNumber(startAltitudeM) || !isFiniteNumber(finishAltitudeM)) {
    return { elevationDeltaM: null, slopePercent: null };
  }
  if (!isFiniteNumber(runDistanceM) || runDistanceM <= 0) {
    return { elevationDeltaM: null, slopePercent: null };
  }

  const elevationDeltaM = finishAltitudeM - startAltitudeM;
  return {
    elevationDeltaM,
    slopePercent: (elevationDeltaM / runDistanceM) * 100,
  };
}

export function buildResult(run, settings, helpers) {
  const intervalStats = computeIntervalStats(run.intervalValues);
  const averageAccuracyM = averageArray(run.accuracyValues);
  const nullSpeedShare = run.sampleCount > 0 ? run.nullSpeedCount / run.sampleCount : 1;
  const derivedShare = run.sampleCount > 0 ? run.derivedSpeedCount / run.sampleCount : 1;
  const runDistanceM = getCompletedRunDistance(run);
  const elapsedMs = run.finishPerfMs - run.startPerfMs;
  const slopeAnalysis = buildSlopeAnalysis(run.startAltitudeM, run.finishAltitudeM, runDistanceM);
  const quality = evaluateQuality({
    sampleCount: run.sampleCount,
    durationMs: elapsedMs,
    averageAccuracyM,
    averageHz: intervalStats.hz,
    averageIntervalMs: intervalStats.averageMs,
    jitterMs: intervalStats.jitterMs,
    staleCount: run.staleCount,
    sparseCount: run.sparseCount,
    nullSpeedShare,
    derivedShare,
  });

  return {
    id: run.id,
    savedAtMs: Date.now(),
    presetId: run.preset.id,
    presetSignature: helpers.getPresetSignature(run.preset),
    comparisonSignature: helpers.buildComparisonSignature(run.preset),
    presetKind: run.preset.type,
    standingStart: run.preset.standingStart,
    customStart: run.preset.customStart,
    customEnd: run.preset.customEnd,
    customUnit: run.preset.customUnit,
    startSpeedMs: run.preset.startSpeedMs,
    targetSpeedMs: run.preset.targetSpeedMs,
    distanceTargetM: run.preset.distanceTargetM,
    displayUnit: settings.speedUnit,
    distanceDisplay: settings.distanceUnit,
    elapsedMs,
    speedTrace: buildResultSpeedTrace(run, elapsedMs),
    sampleLog: normalizeStoredSampleLog(run.sampleLog),
    partials: serializeRunPartials(run.partials),
    finishSpeedMs: run.finishSpeedMs,
    trapSpeedMs: run.preset.type === "distance" ? run.finishSpeedMs : null,
    rolloutApplied: run.rolloutApplied,
    launchThresholdMs: run.launchThresholdMs,
    rolloutDistanceM: run.rolloutDistanceM,
    averageAccuracyM,
    runDistanceM,
    finishDistanceM: run.finishDistanceM,
    startAccuracyM: run.startAccuracyM,
    startAltitudeM: run.startAltitudeM,
    finishAltitudeM: run.finishAltitudeM,
    elevationDeltaM: slopeAnalysis.elevationDeltaM,
    slopePercent: slopeAnalysis.slopePercent,
    averageHz: intervalStats.hz,
    averageIntervalMs: intervalStats.averageMs,
    jitterMs: intervalStats.jitterMs,
    qualityGrade: quality.grade,
    qualityScore: quality.score,
    warningKeys: quality.warningKeys,
    sampleCount: run.sampleCount,
    sparseCount: run.sparseCount,
    staleCount: run.staleCount,
    nullSpeedCount: run.nullSpeedCount,
    derivedSpeedCount: run.derivedSpeedCount,
    speedSource: derivedShare > 0.5 ? "derived" : "reported",
    startSpeedSource: run.startSpeedSource,
    notes: settings.notes || "",
  };
}

export function buildLiveQuality({ sessionSampleCount, recentIntervals, latestSample, latestSampleStale, latestSampleSparse }) {
  const intervalStats = computeIntervalStats(recentIntervals);
  const accuracyM = latestSample ? latestSample.accuracyM : null;
  const quality = evaluateQuality({
    sampleCount: sessionSampleCount,
    durationMs: intervalStats.averageMs ? intervalStats.averageMs * Math.max(0, recentIntervals.length) : 0,
    averageAccuracyM: accuracyM,
    averageHz: intervalStats.hz,
    averageIntervalMs: intervalStats.averageMs,
    jitterMs: intervalStats.jitterMs,
    staleCount: latestSampleStale ? 1 : 0,
    sparseCount: latestSampleSparse ? 1 : 0,
    nullSpeedShare: latestSample && latestSample.rawSpeedMs === null ? 1 : 0,
    derivedShare: latestSample && latestSample.speedSource === "derived" ? 1 : 0,
    isLive: true,
  });

  quality.averageIntervalMs = intervalStats.averageMs;
  quality.jitterMs = intervalStats.jitterMs;
  quality.averageHz = intervalStats.hz;
  quality.samples = sessionSampleCount;
  return quality;
}

export function buildCurrentRunQuality(run, currentDurationMs) {
  const stats = computeIntervalStats(run.intervalValues);
  const averageAccuracyM = averageArray(run.accuracyValues);
  const quality = evaluateQuality({
    sampleCount: run.sampleCount,
    durationMs: currentDurationMs,
    averageAccuracyM,
    averageHz: stats.hz,
    averageIntervalMs: stats.averageMs,
    jitterMs: stats.jitterMs,
    staleCount: run.staleCount,
    sparseCount: run.sparseCount,
    nullSpeedShare: run.sampleCount ? run.nullSpeedCount / run.sampleCount : 1,
    derivedShare: run.sampleCount ? run.derivedSpeedCount / run.sampleCount : 1,
    isLive: true,
  });

  quality.averageIntervalMs = stats.averageMs;
  quality.jitterMs = stats.jitterMs;
  return quality;
}
