import {
  MAX_PLAUSIBLE_SPEED_MS,
  MIN_MOVING_SPEED_MS,
  SPEED_SMOOTHING_SAMPLES,
  drivingDistanceMeters,
  getDrivingMovementThresholdM,
} from "../../shared/driving-telemetry-rules.js";
import { deriveHeadingFromPositions, normalizeHeading } from "../../shared/geo-heading.js";
import type {
  DrivingTelemetrySample,
  NormalizedGpsPosition,
} from "../../types/services";

const HEADING_TTL_MS = 5000;

interface TelemetryPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  timestampMs: number;
}

export interface DrivingTelemetryReducerState {
  tripId: string;
  startedAtMs: number | null;
  currentSpeedMs: number;
  maxSpeedMs: number;
  totalDistanceM: number;
  currentAltitudeM: number | null;
  minAltitudeM: number | null;
  maxAltitudeM: number | null;
  headingDeg: number | null;
  headingAtMs: number;
  accuracyM: number | null;
  lastAcceptedPoint: TelemetryPoint | null;
  recentSpeeds: number[];
  lastPosition: NormalizedGpsPosition | null;
  sampleCount: number;
  lastGpsSampleSequence: number | null;
  lastFixAtMs: number | null;
}

export interface DrivingTelemetryReduction {
  state: DrivingTelemetryReducerState;
  sample: DrivingTelemetrySample | null;
}

export function createDrivingTelemetryReducerState(tripId: string): DrivingTelemetryReducerState {
  return {
    tripId,
    startedAtMs: null,
    currentSpeedMs: 0,
    maxSpeedMs: 0,
    totalDistanceM: 0,
    currentAltitudeM: null,
    minAltitudeM: null,
    maxAltitudeM: null,
    headingDeg: null,
    headingAtMs: 0,
    accuracyM: null,
    lastAcceptedPoint: null,
    recentSpeeds: [],
    lastPosition: null,
    sampleCount: 0,
    lastGpsSampleSequence: null,
    lastFixAtMs: null,
  };
}

/**
 * Applies the characterized Vatio Speed processing rules to one normalized GPS fix.
 * The reducer is immutable and rejects a sequence that it has already consumed.
 */
export function reduceDrivingTelemetryPosition(
  current: DrivingTelemetryReducerState,
  position: NormalizedGpsPosition,
): DrivingTelemetryReduction {
  if (
    !Number.isFinite(position.sampleSequence)
    || (current.lastGpsSampleSequence !== null && position.sampleSequence <= current.lastGpsSampleSequence)
    || position.stale
  ) {
    return { state: current, sample: null };
  }

  const timestampMs = Number.isFinite(position.timestampMs) ? position.timestampMs : position.receivedAtMs;
  const accuracyM = position.accuracy !== null && position.accuracy !== undefined
    && Number.isFinite(Number(position.accuracy))
    ? Number(position.accuracy)
    : null;
  const nextPoint: TelemetryPoint = {
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp: timestampMs,
    timestampMs,
  };
  const previousPoint = current.lastAcceptedPoint;
  let lastAcceptedPoint = previousPoint;
  let speedMs = position.speedMs !== null && position.speedMs !== undefined
    && Number.isFinite(Number(position.speedMs)) && Number(position.speedMs) >= 0
    ? Number(position.speedMs)
    : null;
  let distanceDeltaM = 0;

  if (previousPoint) {
    const elapsedSeconds = Math.max((timestampMs - previousPoint.timestamp) / 1000, 0.25);
    const distanceM = drivingDistanceMeters(previousPoint, nextPoint);
    const fallbackSpeedMs = distanceM / elapsedSeconds;
    const plausibleDistanceM = elapsedSeconds * MAX_PLAUSIBLE_SPEED_MS;
    const movementThresholdM = getDrivingMovementThresholdM(accuracyM, current.accuracyM);
    const hasReportedMotion = speedMs !== null && speedMs >= MIN_MOVING_SPEED_MS;
    const hasMeaningfulMovement = distanceM >= movementThresholdM && fallbackSpeedMs >= MIN_MOVING_SPEED_MS;

    if (distanceM <= plausibleDistanceM && (hasReportedMotion || hasMeaningfulMovement)) {
      distanceDeltaM = distanceM;
      if (speedMs === null) speedMs = fallbackSpeedMs;
      lastAcceptedPoint = nextPoint;
    }
  } else {
    lastAcceptedPoint = nextPoint;
  }

  if (speedMs === null || !Number.isFinite(speedMs) || speedMs < 0) speedMs = 0;
  const recentSpeeds = [...current.recentSpeeds, speedMs].slice(-SPEED_SMOOTHING_SAMPLES);
  const processedSpeedMs = recentSpeeds.reduce((sum, value) => sum + value, 0) / recentSpeeds.length;
  const receivedAtMs = Number.isFinite(position.receivedAtMs) ? position.receivedAtMs : timestampMs;
  const suppliedHeading = normalizeHeading(position.headingDeg ?? position.heading);
  const derivedHeading = suppliedHeading === null && processedSpeedMs >= MIN_MOVING_SPEED_MS
    ? deriveHeadingFromPositions(previousPoint, nextPoint)
    : null;
  const nextHeading = suppliedHeading ?? derivedHeading;
  const headingDeg = nextHeading ?? (
    current.headingDeg !== null && receivedAtMs - current.headingAtMs <= HEADING_TTL_MS
      ? current.headingDeg
      : null
  );
  const headingAtMs = nextHeading !== null ? receivedAtMs : current.headingAtMs;
  const altitudeM = position.altitudeM !== null && position.altitudeM !== undefined
    && Number.isFinite(Number(position.altitudeM))
    ? Number(position.altitudeM)
    : null;
  const totalDistanceM = current.totalDistanceM + distanceDeltaM;

  const state: DrivingTelemetryReducerState = {
    ...current,
    startedAtMs: current.startedAtMs ?? timestampMs,
    currentSpeedMs: processedSpeedMs,
    maxSpeedMs: Math.max(current.maxSpeedMs, processedSpeedMs),
    totalDistanceM,
    currentAltitudeM: altitudeM ?? current.currentAltitudeM,
    minAltitudeM: altitudeM === null
      ? current.minAltitudeM
      : current.minAltitudeM === null ? altitudeM : Math.min(current.minAltitudeM, altitudeM),
    maxAltitudeM: altitudeM === null
      ? current.maxAltitudeM
      : current.maxAltitudeM === null ? altitudeM : Math.max(current.maxAltitudeM, altitudeM),
    headingDeg,
    headingAtMs,
    accuracyM,
    lastAcceptedPoint,
    recentSpeeds,
    lastPosition: position,
    sampleCount: current.sampleCount + 1,
    lastGpsSampleSequence: position.sampleSequence,
    lastFixAtMs: receivedAtMs,
  };

  return {
    state,
    sample: {
      gpsSampleSequence: position.sampleSequence,
      timestampMs,
      latitude: position.latitude,
      longitude: position.longitude,
      processedSpeedMs,
      distanceDeltaM,
      totalDistanceM,
      altitudeM,
      headingDeg,
      accuracyM,
    },
  };
}
