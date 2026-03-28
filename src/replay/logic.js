import { DISTANCE_UNIT_CONFIG, UNIT_CONFIG } from "../speed/constants.js";
import { isFiniteNumber } from "./session.js";

export function getReplayDurationMs(session) {
  if (!session) return 0;

  if (Array.isArray(session.samples) && session.samples.length >= 2) {
    return Math.max(0, session.samples[session.samples.length - 1].timestampMs - session.samples[0].timestampMs);
  }

  if (isFiniteNumber(session.startedAtMs) && isFiniteNumber(session.endedAtMs)) {
    return Math.max(0, session.endedAtMs - session.startedAtMs);
  }

  return 0;
}

export function getReplaySummary(session) {
  if (!session) {
    return {
      sampleCount: 0,
      durationMs: 0,
      totalDistanceM: 0,
      maxSpeedMs: 0,
      averageSpeedMs: 0,
      startedAtMs: null,
      endedAtMs: null,
      minAltitudeM: null,
      maxAltitudeM: null,
    };
  }

  const durationMs = getReplayDurationMs(session);
  const sampleCount = isFiniteNumber(session.sampleCount)
    ? Math.max(0, Math.round(session.sampleCount))
    : (Array.isArray(session.samples) ? session.samples.length : 0);
  const lastSample = Array.isArray(session.samples) && session.samples.length
    ? session.samples[session.samples.length - 1]
    : null;
  const firstSample = Array.isArray(session.samples) && session.samples.length
    ? session.samples[0]
    : null;
  const totalDistanceM = isFiniteNumber(session.totalDistanceM)
    ? Math.max(0, session.totalDistanceM)
    : (lastSample?.totalDistanceM ?? 0);

  return {
    sampleCount,
    durationMs,
    totalDistanceM,
    maxSpeedMs: isFiniteNumber(session.maxSpeedMs) ? session.maxSpeedMs : 0,
    averageSpeedMs: durationMs > 0 ? totalDistanceM / (durationMs / 1000) : 0,
    startedAtMs: session.startedAtMs ?? firstSample?.timestampMs ?? null,
    endedAtMs: session.endedAtMs ?? lastSample?.timestampMs ?? null,
    minAltitudeM: isFiniteNumber(session.minAltitudeM) ? session.minAltitudeM : null,
    maxAltitudeM: isFiniteNumber(session.maxAltitudeM) ? session.maxAltitudeM : null,
  };
}

export function getReplayPathCoordinates(session) {
  if (!session || !Array.isArray(session.samples)) return [];
  return session.samples.map((sample) => [sample.longitude, sample.latitude]);
}

function getSampleDistanceM(sample) {
  return isFiniteNumber(sample?.totalDistanceM) ? Math.max(0, sample.totalDistanceM) : 0;
}

export function getReplayBounds(session) {
  const coordinates = getReplayPathCoordinates(session);
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

function interpolateValue(left, right, ratio, key) {
  const leftValue = left[key];
  const rightValue = right[key];

  if (!isFiniteNumber(leftValue) && !isFiniteNumber(rightValue)) {
    return null;
  }

  if (!isFiniteNumber(leftValue)) return rightValue;
  if (!isFiniteNumber(rightValue)) return leftValue;

  return leftValue + ((rightValue - leftValue) * ratio);
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
  return normalizeHeadingDegrees(left + (delta * ratio));
}

export function getReplaySampleAtElapsedMs(session, elapsedMs) {
  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) {
    return null;
  }

  const summary = getReplaySummary(session);
  const clampedElapsedMs = Math.min(Math.max(elapsedMs, 0), summary.durationMs);
  const firstSample = session.samples[0];
  const targetTimestampMs = firstSample.timestampMs + clampedElapsedMs;

  if (session.samples.length === 1) {
    return {
      ...firstSample,
      elapsedMs: 0,
      progress: 1,
      sampleIndex: 0,
    };
  }

  for (let index = 1; index < session.samples.length; index += 1) {
    const right = session.samples[index];
    const left = session.samples[index - 1];

    if (targetTimestampMs > right.timestampMs) {
      continue;
    }

    const spanMs = Math.max(1, right.timestampMs - left.timestampMs);
    const ratio = Math.min(Math.max((targetTimestampMs - left.timestampMs) / spanMs, 0), 1);

    return {
      timestampMs: targetTimestampMs,
      latitude: interpolateValue(left, right, ratio, "latitude"),
      longitude: interpolateValue(left, right, ratio, "longitude"),
      speedMs: interpolateValue(left, right, ratio, "speedMs") ?? 0,
      altitudeM: interpolateValue(left, right, ratio, "altitudeM"),
      accuracyM: interpolateValue(left, right, ratio, "accuracyM"),
      headingDeg: interpolateHeadingDegrees(left.headingDeg, right.headingDeg, ratio),
      totalDistanceM: interpolateValue(left, right, ratio, "totalDistanceM") ?? left.totalDistanceM,
      elapsedMs: clampedElapsedMs,
      progress: summary.durationMs > 0 ? clampedElapsedMs / summary.durationMs : 1,
      sampleIndex: index,
    };
  }

  const lastSample = session.samples[session.samples.length - 1];
  return {
    ...lastSample,
    elapsedMs: summary.durationMs,
    progress: 1,
    sampleIndex: session.samples.length - 1,
  };
}

export function getReplaySampleAtDistanceM(session, distanceM) {
  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) {
    return null;
  }

  const summary = getReplaySummary(session);
  const clampedDistanceM = Math.min(Math.max(distanceM, 0), summary.totalDistanceM);
  const firstSample = session.samples[0];

  if (session.samples.length === 1) {
    return {
      ...firstSample,
      elapsedMs: 0,
      totalDistanceM: clampedDistanceM,
      progress: summary.totalDistanceM > 0 ? clampedDistanceM / summary.totalDistanceM : 1,
      sampleIndex: 0,
    };
  }

  for (let index = 1; index < session.samples.length; index += 1) {
    const right = session.samples[index];
    const left = session.samples[index - 1];
    const leftDistanceM = getSampleDistanceM(left);
    const rightDistanceM = getSampleDistanceM(right);

    if (clampedDistanceM > rightDistanceM) {
      continue;
    }

    const spanDistanceM = rightDistanceM - leftDistanceM;
    const ratio = spanDistanceM > 0
      ? Math.min(Math.max((clampedDistanceM - leftDistanceM) / spanDistanceM, 0), 1)
      : 0;
    const timestampMs = interpolateValue(left, right, ratio, "timestampMs");
    const elapsedMs = isFiniteNumber(timestampMs) && isFiniteNumber(summary.startedAtMs)
      ? Math.max(0, timestampMs - summary.startedAtMs)
      : 0;

    return {
      timestampMs,
      latitude: interpolateValue(left, right, ratio, "latitude"),
      longitude: interpolateValue(left, right, ratio, "longitude"),
      speedMs: interpolateValue(left, right, ratio, "speedMs") ?? 0,
      altitudeM: interpolateValue(left, right, ratio, "altitudeM"),
      accuracyM: interpolateValue(left, right, ratio, "accuracyM"),
      headingDeg: interpolateHeadingDegrees(left.headingDeg, right.headingDeg, ratio),
      totalDistanceM: clampedDistanceM,
      elapsedMs,
      progress: summary.totalDistanceM > 0 ? clampedDistanceM / summary.totalDistanceM : 1,
      sampleIndex: index,
    };
  }

  const lastSample = session.samples[session.samples.length - 1];
  return {
    ...lastSample,
    elapsedMs: summary.durationMs,
    totalDistanceM: summary.totalDistanceM,
    progress: 1,
    sampleIndex: session.samples.length - 1,
  };
}

export function getReplayPlayedCoordinates(session, elapsedMs) {
  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) return [];

  const sample = getReplaySampleAtElapsedMs(session, elapsedMs);
  if (!sample) return [];

  const coordinates = [];

  for (let index = 0; index < session.samples.length; index += 1) {
    const current = session.samples[index];
    if (current.timestampMs >= sample.timestampMs) break;
    coordinates.push([current.longitude, current.latitude]);
  }

  coordinates.push([sample.longitude, sample.latitude]);
  return coordinates;
}

export function getReplayHighlights(session) {
  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) return [];

  const summary = getReplaySummary(session);
  const firstMovingSample = session.samples.find((sample) => sample.speedMs >= 1) ?? session.samples[0];
  let highestPointSample = null;
  let peakSpeedSample = session.samples[0];
  let strongestPull = null;

  for (let index = 0; index < session.samples.length; index += 1) {
    const sample = session.samples[index];

    if (!peakSpeedSample || sample.speedMs > peakSpeedSample.speedMs) {
      peakSpeedSample = sample;
    }

    if (
      isFiniteNumber(sample.altitudeM)
      && (!highestPointSample || sample.altitudeM > highestPointSample.altitudeM)
    ) {
      highestPointSample = sample;
    }

    if (index === 0) continue;

    const previous = session.samples[index - 1];
    const deltaMs = sample.timestampMs - previous.timestampMs;
    if (deltaMs <= 0 || deltaMs > 8000) continue;

    const accelerationMps2 = (sample.speedMs - previous.speedMs) / (deltaMs / 1000);
    if (!strongestPull || accelerationMps2 > strongestPull.accelerationMps2) {
      strongestPull = {
        sample,
        accelerationMps2,
      };
    }
  }

  const highlights = [
    {
      id: "first-move",
      labelKey: "replayFirstMove",
      sample: firstMovingSample,
      elapsedMs: Math.max(0, firstMovingSample.timestampMs - (summary.startedAtMs ?? firstMovingSample.timestampMs)),
      value: firstMovingSample.speedMs,
      valueUnit: "speed",
    },
    {
      id: "peak-speed",
      labelKey: "replayPeakSpeed",
      sample: peakSpeedSample,
      elapsedMs: Math.max(0, peakSpeedSample.timestampMs - (summary.startedAtMs ?? peakSpeedSample.timestampMs)),
      value: peakSpeedSample.speedMs,
      valueUnit: "speed",
    },
  ];

  if (highestPointSample) {
    highlights.push({
      id: "highest-point",
      labelKey: "replayHighestPoint",
      sample: highestPointSample,
      elapsedMs: Math.max(0, highestPointSample.timestampMs - (summary.startedAtMs ?? highestPointSample.timestampMs)),
      value: highestPointSample.altitudeM,
      valueUnit: "altitude",
    });
  }

  if (strongestPull && strongestPull.accelerationMps2 > 0) {
    highlights.push({
      id: "strongest-pull",
      labelKey: "replayStrongestPull",
      sample: strongestPull.sample,
      elapsedMs: Math.max(0, strongestPull.sample.timestampMs - (summary.startedAtMs ?? strongestPull.sample.timestampMs)),
      value: strongestPull.accelerationMps2,
      valueUnit: "acceleration",
    });
  }

  return highlights;
}

export function formatReplaySpeedValue(speedMs, unit) {
  return speedMs * UNIT_CONFIG[unit].factor;
}

export function formatReplayDistanceValue(distanceM, unit) {
  return distanceM * DISTANCE_UNIT_CONFIG[unit].factor;
}

export function getReplayAxisRange(axisMax, startRatio = 0, endRatio = 1) {
  const safeAxisMax = Number.isFinite(axisMax) && axisMax > 0 ? axisMax : 0;

  if (safeAxisMax <= 0) {
    return {
      startRatio: 0,
      endRatio: 1,
      min: 0,
      max: 1,
    };
  }

  let safeStartRatio = Number.isFinite(startRatio) ? startRatio : 0;
  let safeEndRatio = Number.isFinite(endRatio) ? endRatio : 1;

  safeStartRatio = Math.min(Math.max(safeStartRatio, 0), 1);
  safeEndRatio = Math.min(Math.max(safeEndRatio, 0), 1);

  if (safeStartRatio > safeEndRatio) {
    [safeStartRatio, safeEndRatio] = [safeEndRatio, safeStartRatio];
  }

  const minGapRatio = 0.02;
  if ((safeEndRatio - safeStartRatio) < minGapRatio) {
    if (safeEndRatio >= 1) {
      safeEndRatio = 1;
      safeStartRatio = Math.max(0, safeEndRatio - minGapRatio);
    } else {
      safeEndRatio = Math.min(1, safeStartRatio + minGapRatio);
      if ((safeEndRatio - safeStartRatio) < minGapRatio) {
        safeStartRatio = Math.max(0, safeEndRatio - minGapRatio);
      }
    }
  }

  return {
    startRatio: safeStartRatio,
    endRatio: safeEndRatio,
    min: safeAxisMax * safeStartRatio,
    max: safeAxisMax * safeEndRatio,
  };
}

export function buildReplayMetricSeries(session, metricKey, axisMode = "time") {
  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) {
    return [];
  }

  const summary = getReplaySummary(session);
  const baseTimestampMs = summary.startedAtMs ?? session.samples[0]?.timestampMs ?? 0;
  const series = [];
  let previousHeadingValue = null;

  for (let index = 0; index < session.samples.length; index += 1) {
    const sample = session.samples[index];
    if (!isFiniteNumber(sample[metricKey])) continue;

    const elapsedMs = Math.max(0, sample.timestampMs - baseTimestampMs);
    const distanceM = getSampleDistanceM(sample);
    let value = sample[metricKey];

    if (metricKey === "headingDeg") {
      const heading = normalizeHeadingDegrees(sample.headingDeg);
      if (!isFiniteNumber(heading)) continue;

      if (!isFiniteNumber(previousHeadingValue)) {
        value = heading;
      } else {
        const previousHeading = normalizeHeadingDegrees(previousHeadingValue);
        const delta = getHeadingDeltaDegrees(previousHeading, heading);
        value = previousHeadingValue + (delta ?? 0);
      }

      previousHeadingValue = value;
    }

    series.push({
      elapsedMs,
      elapsedSeconds: elapsedMs / 1000,
      distanceM,
      xValue: axisMode === "distance" ? distanceM : (elapsedMs / 1000),
      value,
    });
  }

  return series;
}

export function getReplayMetricDomain(session, metricKey, axisMode = "time", axisRange = null) {
  const series = buildReplayMetricSeries(session, metricKey, axisMode);
  if (!series.length) return null;

  const globalMinX = series[0].xValue;
  const globalMaxX = series[series.length - 1].xValue;
  let rangeMin = Number.isFinite(axisRange?.min) ? axisRange.min : globalMinX;
  let rangeMax = Number.isFinite(axisRange?.max) ? axisRange.max : globalMaxX;

  rangeMin = Math.min(Math.max(rangeMin, globalMinX), globalMaxX);
  rangeMax = Math.min(Math.max(rangeMax, globalMinX), globalMaxX);

  if (rangeMin > rangeMax) {
    [rangeMin, rangeMax] = [rangeMax, rangeMin];
  }

  const values = [];

  function addInterpolatedValue(targetX) {
    if (!Number.isFinite(targetX)) return;

    for (let index = 1; index < series.length; index += 1) {
      const left = series[index - 1];
      const right = series[index];

      if (targetX < left.xValue || targetX > right.xValue) continue;

      const span = right.xValue - left.xValue;
      if (span <= 0) {
        values.push(left.value);
        return;
      }

      const ratio = Math.min(Math.max((targetX - left.xValue) / span, 0), 1);
      values.push(left.value + ((right.value - left.value) * ratio));
      return;
    }

    values.push(series[series.length - 1].value);
  }

  addInterpolatedValue(rangeMin);
  addInterpolatedValue(rangeMax);

  for (let index = 0; index < series.length; index += 1) {
    const point = series[index];
    if (point.xValue < rangeMin || point.xValue > rangeMax) continue;
    values.push(point.value);
  }

  if (!values.length) return null;

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function buildReplayGraphModel(session, options = {}) {
  const width = Number.isFinite(options.width) ? options.width : 320;
  const height = Number.isFinite(options.height) ? options.height : 92;
  const paddingX = Number.isFinite(options.paddingX) ? options.paddingX : 10;
  const paddingY = Number.isFinite(options.paddingY) ? options.paddingY : 10;
  const metricKey = options.metricKey || "speedMs";

  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) {
    return {
      path: "",
      areaPath: "",
      hasValues: false,
      minValue: null,
      maxValue: null,
      width,
      height,
    };
  }

  const summary = getReplaySummary(session);
  const baseTimestampMs = summary.startedAtMs ?? session.samples[0]?.timestampMs ?? 0;
  const plotWidth = Math.max(1, width - (paddingX * 2));
  const plotHeight = Math.max(1, height - (paddingY * 2));
  const validSamples = session.samples.filter((sample) => isFiniteNumber(sample[metricKey]));

  if (!validSamples.length) {
    return {
      path: "",
      areaPath: "",
      hasValues: false,
      minValue: null,
      maxValue: null,
      width,
      height,
    };
  }

  const computedMinValue = Math.min(...validSamples.map((sample) => sample[metricKey]));
  const computedMaxValue = Math.max(...validSamples.map((sample) => sample[metricKey]));
  const minValue = isFiniteNumber(options.minValue) ? options.minValue : computedMinValue;
  const maxValue = isFiniteNumber(options.maxValue) ? options.maxValue : computedMaxValue;
  const spanValue = Math.max(1e-9, maxValue - minValue);
  const points = validSamples.map((sample) => {
    const elapsedMs = Math.max(0, sample.timestampMs - baseTimestampMs);
    const ratioX = summary.durationMs > 0
      ? Math.min(Math.max(elapsedMs / summary.durationMs, 0), 1)
      : 1;
    const normalizedValue = Math.min(Math.max((sample[metricKey] - minValue) / spanValue, 0), 1);

    return {
      x: paddingX + (ratioX * plotWidth),
      y: height - paddingY - (normalizedValue * plotHeight),
    };
  });

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = points.length
    ? `${path} L ${points[points.length - 1].x.toFixed(2)} ${(height - paddingY).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - paddingY).toFixed(2)} Z`
    : "";

  return {
    path,
    areaPath,
    hasValues: true,
    minValue,
    maxValue,
    width,
    height,
  };
}

export function getReplayGraphCursorX(session, elapsedMs, options = {}) {
  const width = Number.isFinite(options.width) ? options.width : 320;
  const paddingX = Number.isFinite(options.paddingX) ? options.paddingX : 10;
  const plotWidth = Math.max(1, width - (paddingX * 2));
  const durationMs = getReplayDurationMs(session);
  const ratio = durationMs > 0
    ? Math.min(Math.max(elapsedMs / durationMs, 0), 1)
    : 1;

  return paddingX + (ratio * plotWidth);
}
