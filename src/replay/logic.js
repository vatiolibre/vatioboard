import { DISTANCE_UNIT_CONFIG, UNIT_CONFIG } from "../speed/constants.js";
import { isFiniteNumber } from "./session.js";

export function getReplayDurationMs(session) {
  if (!session || !Array.isArray(session.samples) || session.samples.length < 2) return 0;
  return Math.max(0, session.samples[session.samples.length - 1].timestampMs - session.samples[0].timestampMs);
}

export function getReplaySummary(session) {
  if (!session || !Array.isArray(session.samples)) {
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
  const totalDistanceM = isFiniteNumber(session.totalDistanceM)
    ? Math.max(0, session.totalDistanceM)
    : (session.samples[session.samples.length - 1]?.totalDistanceM ?? 0);

  return {
    sampleCount: session.samples.length,
    durationMs,
    totalDistanceM,
    maxSpeedMs: isFiniteNumber(session.maxSpeedMs) ? session.maxSpeedMs : 0,
    averageSpeedMs: durationMs > 0 ? totalDistanceM / (durationMs / 1000) : 0,
    startedAtMs: session.startedAtMs ?? session.samples[0]?.timestampMs ?? null,
    endedAtMs: session.endedAtMs ?? session.samples[session.samples.length - 1]?.timestampMs ?? null,
    minAltitudeM: isFiniteNumber(session.minAltitudeM) ? session.minAltitudeM : null,
    maxAltitudeM: isFiniteNumber(session.maxAltitudeM) ? session.maxAltitudeM : null,
  };
}

export function getReplayPathCoordinates(session) {
  if (!session || !Array.isArray(session.samples)) return [];
  return session.samples.map((sample) => [sample.longitude, sample.latitude]);
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
      headingDeg: interpolateValue(left, right, ratio, "headingDeg"),
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

export function buildReplayMetricSeries(session, metricKey) {
  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) {
    return [];
  }

  const summary = getReplaySummary(session);
  const baseTimestampMs = summary.startedAtMs ?? session.samples[0]?.timestampMs ?? 0;
  const series = [];

  for (let index = 0; index < session.samples.length; index += 1) {
    const sample = session.samples[index];
    if (!isFiniteNumber(sample[metricKey])) continue;

    const elapsedMs = Math.max(0, sample.timestampMs - baseTimestampMs);
    series.push({
      elapsedMs,
      elapsedSeconds: elapsedMs / 1000,
      value: sample[metricKey],
    });
  }

  return series;
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
