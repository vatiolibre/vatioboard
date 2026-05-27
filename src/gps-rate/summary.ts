import { normalizePlace } from '../shared/place-resolver.js';
import {
  type HistogramBucket,
  HISTOGRAM_BUCKETS,
  MAX_ACCURACY_INFLUENCE_M,
  MIN_DISTANCE_NOISE_FLOOR_M,
  MIN_VALID_EPOCH_MS,
  MOVING_SPEED_THRESHOLD_MS,
  STALE_SAMPLE_AGE_MS,
  STATIONARY_SPEED_THRESHOLD_MS,
} from './constants.js';

type UnknownRecord = Record<string, unknown>;

export type GpsRateSummarySource = 'current' | 'saved' | string;
export type GpsRateMovementState = 'moving' | 'stationary' | 'uncertain';
export type GpsRateMovementSource = 'reported' | 'derived' | 'unknown';
export type GpsRateVisibilityState = 'hidden' | 'visible';

export interface GpsRatePlace {
  label?: string;
  countryCode?: string;
  [key: string]: unknown;
}

export interface GpsRateFieldAvailability {
  speed: boolean;
  heading: boolean;
  altitude: boolean;
  altitudeAccuracy: boolean;
  accuracy: boolean;
}

export interface GpsRateHistogramEntry {
  label: string;
  count: number;
}

export interface GpsRateWarning {
  kind: string;
  label: string;
  detail: string;
  [key: string]: unknown;
}

export interface GpsRateMotionSummary {
  latestState?: GpsRateMovementState;
  latestSource?: GpsRateMovementSource;
  movingHz?: number | null;
  stationaryHz?: number | null;
  movingSamples?: number;
  stationarySamples?: number;
  [key: string]: unknown;
}

export interface GpsRateSummary {
  source: GpsRateSummarySource;
  savedAtMs: number | null;
  durationMs: number;
  sampleCount: number;
  currentIntervalMs: number | null;
  averageIntervalMs: number | null;
  medianIntervalMs: number | null;
  minIntervalMs: number | null;
  maxIntervalMs: number | null;
  effectiveAverageHz: number | null;
  bestObservedHz: number | null;
  fiveSecondHz: number | null;
  wholeSessionHz: number | null;
  averageAccuracyM: number | null;
  latestAccuracyM: number | null;
  nullSpeedCount: number;
  nullHeadingCount: number;
  missingAltitudeCount: number;
  staleSampleCount: number;
  jitterMs: number | null;
  fieldAvailability: GpsRateFieldAvailability;
  unsupportedFields: string[];
  motion: GpsRateMotionSummary;
  histogram: GpsRateHistogramEntry[];
  warnings: GpsRateWarning[];
  statusText: string;
  notes: string;
  place: GpsRatePlace | null;
}

export interface GpsRateSample {
  index: number;
  callbackWallClockMs: number;
  performanceNowMs: number;
  positionTimestampMs: number;
  latitude: number | null;
  longitude: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  accuracyM: number | null;
  altitudeM: number | null;
  altitudeAccuracyM: number | null;
  intervalMs: number | null;
  effectiveHz: number | null;
  geoTimestampDeltaMs: number | null;
  sampleAgeMs: number | null;
  movementState: GpsRateMovementState;
  movementSource: GpsRateMovementSource;
  derivedSpeedMps: number | null;
  distanceFromPreviousM: number | null;
  visibilityState: GpsRateVisibilityState;
  isStale: boolean;
  [key: string]: unknown;
}

export interface GpsRateCoordinateLike {
  latitude?: unknown;
  longitude?: unknown;
  speed?: unknown;
  heading?: unknown;
  accuracy?: unknown;
  altitude?: unknown;
  altitudeAccuracy?: unknown;
}

export interface GpsRatePositionLike {
  coords?: GpsRateCoordinateLike | null;
  timestamp?: unknown;
}

export interface GpsRatePreviousSampleLike {
  performanceNowMs: number;
  positionTimestampMs?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
}

export interface GpsRateMotionClassification {
  state: GpsRateMovementState;
  source: GpsRateMovementSource;
  derivedSpeedMps: number | null;
  distanceM: number | null;
}

export interface SummarizeSessionOptions {
  samples: GpsRateSample[];
  durationMs: number;
  source?: GpsRateSummarySource;
  savedAtMs?: number | null;
  notes?: unknown;
  statusText?: string;
  place?: unknown;
}

export interface CreateSampleOptions {
  position: GpsRatePositionLike;
  previousSample?: GpsRatePreviousSampleLike | null;
  sampleIndex: number;
  callbackPerfMs: number;
  callbackWallClockMs: number;
  hiddenNow: boolean;
}

const normalizeSummaryPlace = normalizePlace as (place: unknown) => GpsRatePlace | null;

function getDefaultFieldAvailability(): GpsRateFieldAvailability {
  return {
    speed: false,
    heading: false,
    altitude: false,
    altitudeAccuracy: false,
    accuracy: false,
  };
}

export function normalizeStoredSummary(summary: unknown, fallbackNow = Date.now()): GpsRateSummary | null {
  if (!summary || typeof summary !== 'object') return null;
  const record = summary as UnknownRecord;

  return {
    source: 'saved',
    savedAtMs: Number.isFinite(record.savedAtMs) ? record.savedAtMs as number : fallbackNow,
    durationMs: Number.isFinite(record.durationMs) ? record.durationMs as number : 0,
    sampleCount: Number.isFinite(record.sampleCount) ? record.sampleCount as number : 0,
    currentIntervalMs: Number.isFinite(record.currentIntervalMs)
      ? record.currentIntervalMs as number
      : null,
    averageIntervalMs: Number.isFinite(record.averageIntervalMs)
      ? record.averageIntervalMs as number
      : null,
    medianIntervalMs: Number.isFinite(record.medianIntervalMs) ? record.medianIntervalMs as number : null,
    minIntervalMs: Number.isFinite(record.minIntervalMs) ? record.minIntervalMs as number : null,
    maxIntervalMs: Number.isFinite(record.maxIntervalMs) ? record.maxIntervalMs as number : null,
    effectiveAverageHz: Number.isFinite(record.effectiveAverageHz)
      ? record.effectiveAverageHz as number
      : null,
    bestObservedHz: Number.isFinite(record.bestObservedHz) ? record.bestObservedHz as number : null,
    fiveSecondHz: Number.isFinite(record.fiveSecondHz) ? record.fiveSecondHz as number : null,
    wholeSessionHz: Number.isFinite(record.wholeSessionHz) ? record.wholeSessionHz as number : null,
    averageAccuracyM: Number.isFinite(record.averageAccuracyM) ? record.averageAccuracyM as number : null,
    latestAccuracyM: Number.isFinite(record.latestAccuracyM) ? record.latestAccuracyM as number : null,
    nullSpeedCount: Number.isFinite(record.nullSpeedCount) ? record.nullSpeedCount as number : 0,
    nullHeadingCount: Number.isFinite(record.nullHeadingCount) ? record.nullHeadingCount as number : 0,
    missingAltitudeCount: Number.isFinite(record.missingAltitudeCount)
      ? record.missingAltitudeCount as number
      : 0,
    staleSampleCount: Number.isFinite(record.staleSampleCount) ? record.staleSampleCount as number : 0,
    jitterMs: Number.isFinite(record.jitterMs) ? record.jitterMs as number : null,
    fieldAvailability: (record.fieldAvailability || getDefaultFieldAvailability()) as GpsRateFieldAvailability,
    unsupportedFields: Array.isArray(record.unsupportedFields) ? record.unsupportedFields as string[] : [],
    motion: (record.motion || {}) as GpsRateMotionSummary,
    histogram: Array.isArray(record.histogram) ? record.histogram as GpsRateHistogramEntry[] : [],
    warnings: Array.isArray(record.warnings) ? record.warnings as GpsRateWarning[] : [],
    statusText: typeof record.statusText === 'string' ? record.statusText : '',
    notes: typeof record.notes === 'string' ? record.notes : '',
    place: normalizeSummaryPlace(record.place),
  };
}

export function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

export function normalizePositionTimestamp(timestamp: unknown, fallbackMs = Date.now()): number {
  if (!isFiniteNumber(timestamp)) return fallbackMs;

  const safeFallbackMs = isFiniteNumber(fallbackMs) ? fallbackMs : Date.now();
  const maxReasonableMs = safeFallbackMs + 60 * 1000;

  if (timestamp < MIN_VALID_EPOCH_MS || timestamp > maxReasonableMs) {
    return safeFallbackMs;
  }

  return timestamp;
}

export function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const meanValue = average(values) as number;
  const variance =
    values.reduce((sum, value) => {
      const delta = value - meanValue;
      return sum + delta * delta;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

export function haversineDistance(a: GpsRateCoordinateLike, b: GpsRateCoordinateLike): number | null {
  if (
    !isFiniteNumber(a.latitude) ||
    !isFiniteNumber(a.longitude) ||
    !isFiniteNumber(b.latitude) ||
    !isFiniteNumber(b.longitude)
  ) {
    return null;
  }

  const latitudeA = a.latitude;
  const longitudeA = a.longitude;
  const latitudeB = b.latitude;
  const longitudeB = b.longitude;
  const radius = 6371000;
  const lat1 = (latitudeA * Math.PI) / 180;
  const lat2 = (latitudeB * Math.PI) / 180;
  const deltaLat = ((latitudeB - latitudeA) * Math.PI) / 180;
  const deltaLon = ((longitudeB - longitudeA) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const calc = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return radius * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

export function getMovementThresholdM(currentAccuracyM: unknown, previousAccuracyM: unknown): number {
  const accuracies = [currentAccuracyM, previousAccuracyM].filter(isFiniteNumber);
  const accuracyFloorM = accuracies.length
    ? Math.min(Math.max.apply(null, accuracies), MAX_ACCURACY_INFLUENCE_M)
    : 0;

  return Math.max(MIN_DISTANCE_NOISE_FLOOR_M, accuracyFloorM * 0.5);
}

export function normalizeSpeed(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

export function normalizeHeading(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

export function normalizeMetric(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

export function classifyMotion(
  coords: GpsRateCoordinateLike,
  previousSample: GpsRatePreviousSampleLike | null | undefined,
  callbackPerfMs: number,
): GpsRateMotionClassification {
  const reportedSpeed = normalizeSpeed(coords.speed);

  if (reportedSpeed !== null) {
    if (reportedSpeed >= MOVING_SPEED_THRESHOLD_MS) {
      return { state: 'moving', source: 'reported', derivedSpeedMps: null, distanceM: null };
    }
    if (reportedSpeed <= STATIONARY_SPEED_THRESHOLD_MS) {
      return { state: 'stationary', source: 'reported', derivedSpeedMps: null, distanceM: null };
    }
  }

  if (!previousSample) {
    return { state: 'uncertain', source: 'unknown', derivedSpeedMps: null, distanceM: null };
  }

  const intervalMs = callbackPerfMs - previousSample.performanceNowMs;
  const distanceM = haversineDistance(
    { latitude: previousSample.latitude, longitude: previousSample.longitude },
    { latitude: coords.latitude, longitude: coords.longitude }
  );

  if (!isFiniteNumber(intervalMs) || intervalMs <= 0 || !isFiniteNumber(distanceM)) {
    return { state: 'uncertain', source: 'unknown', derivedSpeedMps: null, distanceM: null };
  }

  const derivedSpeedMps = distanceM / (intervalMs / 1000);
  const movementThresholdM = getMovementThresholdM(coords.accuracy, previousSample.accuracyM);

  if (distanceM >= movementThresholdM && derivedSpeedMps >= MOVING_SPEED_THRESHOLD_MS) {
    return { state: 'moving', source: 'derived', derivedSpeedMps, distanceM };
  }

  if (
    distanceM <= Math.max(2, movementThresholdM * 0.5) &&
    derivedSpeedMps <= STATIONARY_SPEED_THRESHOLD_MS
  ) {
    return { state: 'stationary', source: 'derived', derivedSpeedMps, distanceM };
  }

  return { state: 'uncertain', source: 'unknown', derivedSpeedMps, distanceM };
}

export function isStaleSample(
  positionTimestampMs: unknown,
  previousSample: GpsRatePreviousSampleLike | null | undefined,
  sampleAgeMs: unknown,
): boolean {
  if (
    isFiniteNumber(positionTimestampMs) &&
    previousSample &&
    isFiniteNumber(previousSample.positionTimestampMs)
  ) {
    if (positionTimestampMs <= previousSample.positionTimestampMs) {
      return true;
    }
  }

  return isFiniteNumber(sampleAgeMs) && sampleAgeMs > STALE_SAMPLE_AGE_MS;
}

export function computeSessionHz(
  samples: Pick<GpsRateSample, 'performanceNowMs'>[],
  windowMs: number | null = null,
): number | null {
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

export function computeMotionHz(
  samples: Pick<GpsRateSample, 'intervalMs' | 'movementState'>[],
  motionState: GpsRateMovementState,
): { sampleCount: number; hz: number | null } {
  const intervals: number[] = [];
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
    hz: intervals.length ? 1000 / (average(intervals) as number) : null,
  };
}

export function buildHistogram(
  intervals: number[],
  histogramBuckets: HistogramBucket[] = HISTOGRAM_BUCKETS,
): GpsRateHistogramEntry[] {
  return histogramBuckets.map((bucket) => {
    const count = intervals.filter((value) => value >= bucket.min && value < bucket.max).length;
    return { label: bucket.label, count };
  });
}

export function summarizeSession({
  samples,
  durationMs,
  source = 'current',
  savedAtMs = null,
  notes = '',
  statusText = '',
  place = null,
}: SummarizeSessionOptions): GpsRateSummary {
  const latestSample = samples.length ? samples[samples.length - 1] : null;
  const intervals = samples
    .map((sample) => sample.intervalMs)
    .filter((value) => isFiniteNumber(value) && value > 0);
  const accuracyValues = samples.map((sample) => sample.accuracyM).filter(isFiniteNumber);
  const fieldAvailability = {
    speed: samples.some((sample) => isFiniteNumber(sample.speedMps)),
    heading: samples.some((sample) => isFiniteNumber(sample.headingDeg)),
    altitude: samples.some((sample) => isFiniteNumber(sample.altitudeM)),
    altitudeAccuracy: samples.some((sample) => isFiniteNumber(sample.altitudeAccuracyM)),
    accuracy: samples.some((sample) => isFiniteNumber(sample.accuracyM)),
  };
  const unsupportedFields = Object.keys(fieldAvailability).filter(
    (field) => !fieldAvailability[field]
  );
  const movingSummary = computeMotionHz(samples, 'moving');
  const stationarySummary = computeMotionHz(samples, 'stationary');

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
    effectiveAverageHz: intervals.length ? 1000 / (average(intervals) as number) : null,
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
      latestState: latestSample ? latestSample.movementState : 'uncertain',
      latestSource: latestSample ? latestSample.movementSource : 'unknown',
      movingHz: movingSummary.hz,
      stationaryHz: stationarySummary.hz,
      movingSamples: movingSummary.sampleCount,
      stationarySamples: stationarySummary.sampleCount,
    },
    warnings: [],
    statusText,
    notes: typeof notes === 'string' ? notes.trim() : '',
    place: normalizeSummaryPlace(place),
  };
}

export function createSample({
  position,
  previousSample,
  sampleIndex,
  callbackPerfMs,
  callbackWallClockMs,
  hiddenNow,
}: CreateSampleOptions): GpsRateSample {
  const coords = position.coords || {};
  const positionTimestampMs = normalizePositionTimestamp(position.timestamp, callbackWallClockMs);
  const intervalMs = previousSample ? callbackPerfMs - previousSample.performanceNowMs : null;
  const effectiveHz = isFiniteNumber(intervalMs) && intervalMs > 0 ? 1000 / intervalMs : null;
  const geoTimestampDeltaMs =
    previousSample &&
    isFiniteNumber(positionTimestampMs) &&
    isFiniteNumber(previousSample.positionTimestampMs)
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
    visibilityState: hiddenNow ? 'hidden' : 'visible',
    isStale: isStaleSample(positionTimestampMs, previousSample, sampleAgeMs),
  };
}
