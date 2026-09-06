export const SPEED_SMOOTHING_SAMPLES = 5;
export const MIN_MOVING_SPEED_MS = 0.8;
export const MIN_DISTANCE_NOISE_FLOOR_M = 4;
export const MAX_ACCURACY_INFLUENCE_M = 18;
export const MAX_PLAUSIBLE_SPEED_MS = 120;

export interface TelemetryCoordinate {
  latitude: number;
  longitude: number;
}

export function drivingDistanceMeters(a: TelemetryCoordinate, b: TelemetryCoordinate): number {
  const radius = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const calc = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return radius * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

export function getDrivingMovementThresholdM(
  currentAccuracyM: number | null,
  previousAccuracyM: number | null,
): number {
  const accuracies = [currentAccuracyM, previousAccuracyM].filter(Number.isFinite) as number[];
  const accuracyFloorM = accuracies.length > 0
    ? Math.min(Math.max(...accuracies), MAX_ACCURACY_INFLUENCE_M)
    : 0;
  return Math.max(MIN_DISTANCE_NOISE_FLOOR_M, accuracyFloorM * 0.5);
}
