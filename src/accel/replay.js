import { interpolateValue, isFiniteNumber } from "./logic.js";

const REPLAY_EPSILON_MS = 0.01;

function getReplayPointKey(elapsedMs) {
  return String(Math.round(Math.max(0, elapsedMs) * 100));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hasGeoPoint(frame) {
  return isFiniteNumber(frame?.latitude) && isFiniteNumber(frame?.longitude);
}

function getCoordinatePair(frame) {
  if (!hasGeoPoint(frame)) return null;
  return [frame.longitude, frame.latitude];
}

function areCoordinatesEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return left[0] === right[0] && left[1] === right[1];
}

function normalizeHeadingDegrees(value) {
  if (!isFiniteNumber(value)) return null;
  return ((value % 360) + 360) % 360;
}

function getHeadingDeltaDegrees(leftHeadingDeg, rightHeadingDeg) {
  const left = normalizeHeadingDegrees(leftHeadingDeg);
  const right = normalizeHeadingDegrees(rightHeadingDeg);

  if (!isFiniteNumber(left) || !isFiniteNumber(right)) return null;

  let delta = right - left;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function interpolateHeadingDegrees(leftHeadingDeg, rightHeadingDeg, ratio) {
  const left = normalizeHeadingDegrees(leftHeadingDeg);
  const right = normalizeHeadingDegrees(rightHeadingDeg);

  if (!isFiniteNumber(left) && !isFiniteNumber(right)) return null;
  if (!isFiniteNumber(left)) return right;
  if (!isFiniteNumber(right)) return left;

  const delta = getHeadingDeltaDegrees(left, right);
  return normalizeHeadingDegrees(left + ((delta ?? 0) * ratio));
}

function sortAndMergeReplayFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) return [];

  const sortedFrames = frames
    .filter(Boolean)
    .sort((left, right) => left.elapsedMs - right.elapsedMs);
  const mergedFrames = [];

  for (let index = 0; index < sortedFrames.length; index += 1) {
    const frame = sortedFrames[index];
    const previousFrame = mergedFrames[mergedFrames.length - 1];

    if (previousFrame && Math.abs(previousFrame.elapsedMs - frame.elapsedMs) <= REPLAY_EPSILON_MS) {
      mergedFrames[mergedFrames.length - 1] = {
        ...previousFrame,
        ...frame,
        elapsedMs: Math.max(previousFrame.elapsedMs, frame.elapsedMs),
      };
      continue;
    }

    mergedFrames.push(frame);
  }

  return mergedFrames;
}

function normalizeReplayFrames(frames, startAltitudeM) {
  if (!Array.isArray(frames) || !frames.length) return [];

  let lastDistanceM = 0;
  const normalizedFrames = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (!frame || !isFiniteNumber(frame.elapsedMs) || !isFiniteNumber(frame.speedMs)) continue;

    const distanceM = isFiniteNumber(frame.distanceM)
      ? Math.max(lastDistanceM, Math.max(0, frame.distanceM))
      : lastDistanceM;
    const altitudeM = isFiniteNumber(frame.altitudeM) ? frame.altitudeM : null;
    const slopePercent = isFiniteNumber(startAltitudeM) && isFiniteNumber(altitudeM) && distanceM > 0
      ? ((altitudeM - startAltitudeM) / distanceM) * 100
      : null;

    lastDistanceM = distanceM;
    normalizedFrames.push({
      key: typeof frame.key === "string" ? frame.key : `frame-${getReplayPointKey(frame.elapsedMs)}`,
      source: typeof frame.source === "string" ? frame.source : "trace",
      elapsedMs: Math.max(0, frame.elapsedMs),
      speedMs: Math.max(0, frame.speedMs),
      distanceM,
      latitude: hasGeoPoint(frame) ? frame.latitude : null,
      longitude: hasGeoPoint(frame) ? frame.longitude : null,
      altitudeM,
      accuracyM: isFiniteNumber(frame.accuracyM) ? Math.max(0, frame.accuracyM) : null,
      headingDeg: isFiniteNumber(frame.headingDeg) ? frame.headingDeg : null,
      speedSource: typeof frame.speedSource === "string" ? frame.speedSource : null,
      slopePercent,
    });
  }

  return normalizedFrames;
}

function appendFinishReplayFrame(result, frames) {
  if (!result || !Array.isArray(frames) || !frames.length) return frames ? frames.slice() : [];

  const normalizedFrames = frames.slice();
  const lastFrame = normalizedFrames[normalizedFrames.length - 1];
  const expectedElapsedMs = isFiniteNumber(result.elapsedMs) ? Math.max(0, result.elapsedMs) : lastFrame.elapsedMs;
  const expectedDistanceM = isFiniteNumber(result.runDistanceM)
    ? Math.max(0, result.runDistanceM)
    : (isFiniteNumber(result.finishDistanceM) ? Math.max(0, result.finishDistanceM) : lastFrame.distanceM);
  const expectedSpeedMs = isFiniteNumber(result.finishSpeedMs) ? Math.max(0, result.finishSpeedMs) : lastFrame.speedMs;
  const expectedAltitudeM = isFiniteNumber(result.finishAltitudeM) ? result.finishAltitudeM : lastFrame.altitudeM;
  const expectedAccuracyM = isFiniteNumber(result.averageAccuracyM)
    ? Math.max(0, result.averageAccuracyM)
    : lastFrame.accuracyM;
  const finishSource = typeof result.speedSource === "string"
    ? result.speedSource
    : (typeof lastFrame.speedSource === "string" ? lastFrame.speedSource : null);
  const elapsedMatches = Math.abs(lastFrame.elapsedMs - expectedElapsedMs) <= REPLAY_EPSILON_MS;
  const distanceMatches = !isFiniteNumber(expectedDistanceM)
    || Math.abs((lastFrame.distanceM ?? 0) - expectedDistanceM) <= 0.01;
  const needsFinishFrame = !elapsedMatches;

  if (needsFinishFrame) {
    normalizedFrames.push({
      key: `finish-${getReplayPointKey(expectedElapsedMs)}`,
      source: "resultFinish",
      elapsedMs: expectedElapsedMs,
      speedMs: expectedSpeedMs,
      distanceM: expectedDistanceM,
      latitude: lastFrame.latitude ?? null,
      longitude: lastFrame.longitude ?? null,
      altitudeM: expectedAltitudeM,
      accuracyM: expectedAccuracyM,
      headingDeg: lastFrame.headingDeg,
      speedSource: finishSource,
      slopePercent: lastFrame.slopePercent,
    });
    return normalizedFrames;
  }

  if (!distanceMatches || lastFrame.speedMs !== expectedSpeedMs || lastFrame.altitudeM !== expectedAltitudeM) {
    normalizedFrames[normalizedFrames.length - 1] = {
      ...lastFrame,
      elapsedMs: expectedElapsedMs,
      speedMs: expectedSpeedMs,
      distanceM: expectedDistanceM,
      altitudeM: expectedAltitudeM,
      accuracyM: expectedAccuracyM,
      speedSource: finishSource,
    };
  }

  return normalizedFrames;
}

function buildFramesFromSpeedTrace(speedTrace) {
  if (!Array.isArray(speedTrace) || !speedTrace.length) return [];

  return speedTrace.map((point, index) => ({
    key: `trace-${index}-${getReplayPointKey(point.elapsedMs)}`,
    source: "speedTrace",
    elapsedMs: Math.max(0, point.elapsedMs),
    speedMs: Math.max(0, point.speedMs),
    distanceM: isFiniteNumber(point.distanceM) ? Math.max(0, point.distanceM) : null,
    latitude: hasGeoPoint(point) ? point.latitude : null,
    longitude: hasGeoPoint(point) ? point.longitude : null,
    altitudeM: isFiniteNumber(point.altitudeM) ? point.altitudeM : null,
    accuracyM: isFiniteNumber(point.accuracyM) ? Math.max(0, point.accuracyM) : null,
    speedSource: typeof point.speedSource === "string" ? point.speedSource : null,
  }));
}

function buildFramesFromSampleLog(sampleLog) {
  if (!Array.isArray(sampleLog) || !sampleLog.length) return [];

  const frames = [];

  for (let index = 0; index < sampleLog.length; index += 1) {
    const sample = sampleLog[index];
    if (!sample || !isFiniteNumber(sample.elapsedFromStartMs) || !isFiniteNumber(sample.speedMs)) continue;

    frames.push({
      key: `sample-${index + 1}-${getReplayPointKey(sample.elapsedFromStartMs)}`,
      source: "sampleLog",
      elapsedMs: Math.max(0, sample.elapsedFromStartMs),
      speedMs: Math.max(0, sample.speedMs),
      distanceM: isFiniteNumber(sample.distanceFromStartM) ? Math.max(0, sample.distanceFromStartM) : null,
      latitude: hasGeoPoint(sample) ? sample.latitude : null,
      longitude: hasGeoPoint(sample) ? sample.longitude : null,
      altitudeM: isFiniteNumber(sample.altitudeM) ? sample.altitudeM : null,
      accuracyM: isFiniteNumber(sample.accuracyM) ? Math.max(0, sample.accuracyM) : null,
      headingDeg: isFiniteNumber(sample.headingDeg) ? sample.headingDeg : null,
      speedSource: typeof sample.speedSource === "string" ? sample.speedSource : null,
    });
  }

  return frames;
}

function interpolateReplayMetric(left, right, ratio, key) {
  const leftValue = left && isFiniteNumber(left[key]) ? left[key] : null;
  const rightValue = right && isFiniteNumber(right[key]) ? right[key] : null;

  if (leftValue === null && rightValue === null) return null;
  if (leftValue === null) return rightValue;
  if (rightValue === null) return leftValue;

  return interpolateValue(leftValue, rightValue, ratio);
}

function interpolateReplayCoordinate(left, right, ratio, key) {
  const leftValue = left && isFiniteNumber(left[key]) ? left[key] : null;
  const rightValue = right && isFiniteNumber(right[key]) ? right[key] : null;

  if (leftValue === null && rightValue === null) return null;
  if (leftValue === null) return ratio >= 1 ? rightValue : null;
  if (rightValue === null) return leftValue;

  return interpolateValue(leftValue, rightValue, ratio);
}

function interpolateReplayFrame(left, right, ratio, elapsedMs, distanceM) {
  return {
    key: "",
    source: "interpolated",
    elapsedMs,
    speedMs: interpolateReplayMetric(left, right, ratio, "speedMs") ?? 0,
    distanceM,
    latitude: interpolateReplayCoordinate(left, right, ratio, "latitude"),
    longitude: interpolateReplayCoordinate(left, right, ratio, "longitude"),
    altitudeM: interpolateReplayMetric(left, right, ratio, "altitudeM"),
    accuracyM: interpolateReplayMetric(left, right, ratio, "accuracyM"),
    headingDeg: interpolateHeadingDegrees(left?.headingDeg, right?.headingDeg, ratio),
    speedSource: typeof right?.speedSource === "string"
      ? right.speedSource
      : (typeof left?.speedSource === "string" ? left.speedSource : null),
    slopePercent: interpolateReplayMetric(left, right, ratio, "slopePercent"),
  };
}

export function buildAccelReplaySource(result) {
  if (!result || typeof result !== "object") return null;

  const replayFrames = sortAndMergeReplayFrames([
    ...buildFramesFromSpeedTrace(result.speedTrace),
    ...buildFramesFromSampleLog(result.sampleLog),
  ]);
  const normalizedFrames = appendFinishReplayFrame(
    result,
    normalizeReplayFrames(replayFrames, result.startAltitudeM),
  );

  if (normalizedFrames.length < 2) return null;

  const durationMs = Math.max(0, normalizedFrames[normalizedFrames.length - 1].elapsedMs);
  const totalDistanceM = Math.max(
    isFiniteNumber(result.runDistanceM) ? result.runDistanceM : 0,
    normalizedFrames[normalizedFrames.length - 1].distanceM,
  );
  const hasGeoPath = countGeoFrames(normalizedFrames) >= 1;

  return {
    resultId: result.id,
    sourceType: Array.isArray(result.sampleLog) && result.sampleLog.length ? "sampleLog" : "speedTrace",
    frames: normalizedFrames,
    durationMs,
    totalDistanceM,
    hasDistanceAxis: totalDistanceM > 0,
    hasGeoPath,
  };
}

export function buildAccelReplayMapSession(source) {
  if (!source || !Array.isArray(source.frames) || !source.frames.length) return null;

  const samples = [];
  let minAltitudeM = null;
  let maxAltitudeM = null;

  for (let index = 0; index < source.frames.length; index += 1) {
    const frame = source.frames[index];
    if (!hasGeoPoint(frame)) continue;

    const altitudeM = isFiniteNumber(frame.altitudeM) ? frame.altitudeM : null;
    if (isFiniteNumber(altitudeM)) {
      minAltitudeM = minAltitudeM === null ? altitudeM : Math.min(minAltitudeM, altitudeM);
      maxAltitudeM = maxAltitudeM === null ? altitudeM : Math.max(maxAltitudeM, altitudeM);
    }

    samples.push({
      timestampMs: Math.max(0, frame.elapsedMs || 0),
      latitude: frame.latitude,
      longitude: frame.longitude,
      speedMs: Math.max(0, frame.speedMs || 0),
      altitudeM,
      accuracyM: isFiniteNumber(frame.accuracyM) ? Math.max(0, frame.accuracyM) : null,
      headingDeg: isFiniteNumber(frame.headingDeg) ? frame.headingDeg : null,
      totalDistanceM: isFiniteNumber(frame.distanceM) ? Math.max(0, frame.distanceM) : 0,
    });
  }

  if (!samples.length) return null;

  return {
    startedAtMs: 0,
    endedAtMs: Math.max(0, source.durationMs || samples[samples.length - 1].timestampMs),
    totalDistanceM: Math.max(0, source.totalDistanceM || samples[samples.length - 1].totalDistanceM || 0),
    minAltitudeM,
    maxAltitudeM,
    samples,
  };
}

export function isAccelReplayableResult(result) {
  return Boolean(buildAccelReplaySource(result));
}

export function getAccelReplayFrameAtElapsedMs(source, elapsedMs) {
  if (!source || !Array.isArray(source.frames) || !source.frames.length) return null;

  const frames = source.frames;
  const clampedElapsedMs = clamp(elapsedMs, 0, source.durationMs);

  if (frames.length === 1) {
    return {
      ...frames[0],
      elapsedMs: clampedElapsedMs,
      distanceM: frames[0].distanceM ?? 0,
    };
  }

  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    const left = frames[index - 1];

    if (clampedElapsedMs > right.elapsedMs) continue;

    const spanMs = Math.max(REPLAY_EPSILON_MS, right.elapsedMs - left.elapsedMs);
    const ratio = clamp((clampedElapsedMs - left.elapsedMs) / spanMs, 0, 1);
    const distanceM = interpolateReplayMetric(left, right, ratio, "distanceM") ?? left.distanceM;
    return interpolateReplayFrame(left, right, ratio, clampedElapsedMs, distanceM);
  }

  return {
    ...frames[frames.length - 1],
    elapsedMs: source.durationMs,
    distanceM: source.totalDistanceM,
  };
}

export function getAccelReplayFrameAtDistanceM(source, distanceM) {
  if (!source || !Array.isArray(source.frames) || !source.frames.length) return null;

  const frames = source.frames;
  const clampedDistanceM = clamp(distanceM, 0, source.totalDistanceM);

  if (frames.length === 1) {
    return {
      ...frames[0],
      elapsedMs: 0,
      distanceM: clampedDistanceM,
    };
  }

  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    const left = frames[index - 1];

    if (clampedDistanceM > right.distanceM) continue;

    const spanDistanceM = Math.max(REPLAY_EPSILON_MS, right.distanceM - left.distanceM);
    const ratio = spanDistanceM > 0 ? clamp((clampedDistanceM - left.distanceM) / spanDistanceM, 0, 1) : 0;
    const elapsedMs = interpolateReplayMetric(left, right, ratio, "elapsedMs") ?? left.elapsedMs;
    return interpolateReplayFrame(left, right, ratio, elapsedMs, clampedDistanceM);
  }

  return {
    ...frames[frames.length - 1],
    elapsedMs: source.durationMs,
    distanceM: source.totalDistanceM,
  };
}

function getReplayPathCoordinatesFromFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) return [];

  const coordinates = [];
  for (let index = 0; index < frames.length; index += 1) {
    const coordinate = getCoordinatePair(frames[index]);
    if (!coordinate) continue;
    if (!coordinates.length || !areCoordinatesEqual(coordinate, coordinates[coordinates.length - 1])) {
      coordinates.push(coordinate);
    }
  }

  return coordinates;
}

function countGeoFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) return 0;

  let count = 0;
  for (let index = 0; index < frames.length; index += 1) {
    if (hasGeoPoint(frames[index])) count += 1;
  }

  return count;
}

export function getAccelReplayPathCoordinates(source) {
  if (!source || !Array.isArray(source.frames)) return [];
  return getReplayPathCoordinatesFromFrames(source.frames);
}

export function getAccelReplayBounds(source) {
  const coordinates = getAccelReplayPathCoordinates(source);
  if (!coordinates.length) return null;

  let minLongitude = coordinates[0][0];
  let maxLongitude = coordinates[0][0];
  let minLatitude = coordinates[0][1];
  let maxLatitude = coordinates[0][1];

  for (let index = 1; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index];
    minLongitude = Math.min(minLongitude, coordinate[0]);
    maxLongitude = Math.max(maxLongitude, coordinate[0]);
    minLatitude = Math.min(minLatitude, coordinate[1]);
    maxLatitude = Math.max(maxLatitude, coordinate[1]);
  }

  if (minLongitude === maxLongitude) {
    minLongitude -= 0.02;
    maxLongitude += 0.02;
  }

  if (minLatitude === maxLatitude) {
    minLatitude -= 0.02;
    maxLatitude += 0.02;
  }

  return [
    [minLongitude, minLatitude],
    [maxLongitude, maxLatitude],
  ];
}

export function getAccelReplayPlayedCoordinates(source, elapsedMs) {
  if (!source || !Array.isArray(source.frames) || !source.frames.length) return [];

  const replayFrame = getAccelReplayFrameAtElapsedMs(source, elapsedMs);
  if (!replayFrame) return [];

  const coordinates = [];

  for (let index = 0; index < source.frames.length; index += 1) {
    const frame = source.frames[index];
    if (frame.elapsedMs > replayFrame.elapsedMs) break;

    const coordinate = getCoordinatePair(frame);
    if (!coordinate) continue;
    if (!coordinates.length || !areCoordinatesEqual(coordinate, coordinates[coordinates.length - 1])) {
      coordinates.push(coordinate);
    }
  }

  const replayCoordinate = getCoordinatePair(replayFrame);
  if (replayCoordinate && (!coordinates.length || !areCoordinatesEqual(replayCoordinate, coordinates[coordinates.length - 1]))) {
    coordinates.push(replayCoordinate);
  }

  return coordinates;
}

export function buildAccelReplayMarkers(result, source, options = {}) {
  if (!result || !source || !Array.isArray(source.frames) || !source.frames.length) return [];

  const getPartialLabel = typeof options.getPartialLabel === "function"
    ? options.getPartialLabel
    : (partial) => partial?.labelKey || "";
  const markers = [];

  if (Array.isArray(result.partials)) {
    for (let index = 0; index < result.partials.length; index += 1) {
      const partial = result.partials[index];
      if (!partial || !isFiniteNumber(partial.elapsedMs)) continue;

      const frameAtPartial = getAccelReplayFrameAtElapsedMs(source, partial.elapsedMs);
      markers.push({
        id: partial.id || `partial-${index + 1}`,
        kind: "partial",
        label: getPartialLabel(partial),
        elapsedMs: partial.elapsedMs,
        distanceM: isFiniteNumber(partial.distanceM)
          ? Math.max(0, partial.distanceM)
          : (frameAtPartial?.distanceM ?? null),
        speedMs: partial.kind === "speed"
          ? partial.targetSpeedMs
          : (isFiniteNumber(partial.trapSpeedMs) ? partial.trapSpeedMs : (frameAtPartial?.speedMs ?? null)),
      });
    }
  }

  markers.push({
    id: `finish-${result.id}`,
    kind: "finish",
    label: typeof options.finishLabel === "string" ? options.finishLabel : "Finish",
    elapsedMs: Math.max(0, result.elapsedMs || 0),
    distanceM: Math.max(0, isFiniteNumber(result.runDistanceM) ? result.runDistanceM : source.totalDistanceM),
    speedMs: isFiniteNumber(result.finishSpeedMs) ? result.finishSpeedMs : null,
  });

  return markers;
}
