export type DrivingSpeedUnit = "kmh" | "mph";
export type DrivingDistanceUnit = "m" | "mi";

export interface TripStatsInput {
  currentSpeedMs?: number | null;
  maxSpeedMs?: number | null;
  averageSpeedMs?: number | null;
  totalDistanceM?: number | null;
  durationMs?: number | null;
  startedAtMs?: number | null;
  currentAltitudeM?: number | null;
  maxAltitudeM?: number | null;
  minAltitudeM?: number | null;
  nearestCameraDistanceM?: number | null;
  speedUnit?: DrivingSpeedUnit;
  distanceUnit?: DrivingDistanceUnit;
  nowMs?: number;
}

export interface TripMetric {
  value: string;
  unit: string;
}

export interface TripStatsModel {
  currentSpeed: TripMetric;
  maxSpeed: TripMetric;
  averageSpeed: TripMetric;
  distance: TripMetric;
  nearestCamera: TripMetric;
  duration: TripMetric;
  altitude: TripMetric;
  maxAltitude: TripMetric;
  minAltitude: TripMetric;
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function speed(valueMs: unknown, unit: DrivingSpeedUnit): TripMetric {
  return {
    value: String(Math.round(Math.max(0, finite(valueMs)) * (unit === "mph" ? 2.2369362920544 : 3.6))),
    unit: unit === "mph" ? "mph" : "km/h",
  };
}

export function formatTripDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(finite(durationMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTripDistance(distanceM: unknown, unit: DrivingDistanceUnit): TripMetric {
  const meters = Math.max(0, finite(distanceM));
  if (unit === "mi") {
    const miles = meters / 1609.344;
    return { value: miles < 10 ? miles.toFixed(1) : String(Math.round(miles)), unit: "mi" };
  }
  if (meters < 1000) return { value: String(Math.round(meters)), unit: "m" };
  const kilometers = meters / 1000;
  return { value: kilometers < 10 ? kilometers.toFixed(1) : String(Math.round(kilometers)), unit: "km" };
}

export function formatProximityDistance(distanceM: unknown, unit: DrivingDistanceUnit): TripMetric {
  const meters = Number(distanceM);
  if (!Number.isFinite(meters)) return { value: "—", unit: "" };
  if (unit === "m") return formatTripDistance(meters, unit);
  const feet = Math.max(0, meters) * 3.2808398950131;
  if (feet < 5280) return { value: String(Math.round(feet)), unit: "ft" };
  return formatTripDistance(meters, unit);
}

function altitude(valueM: unknown, unit: DrivingDistanceUnit): TripMetric {
  if (valueM === null || valueM === undefined || valueM === "") {
    return { value: "—", unit: unit === "mi" ? "ft" : "m" };
  }
  const value = Number(valueM);
  if (!Number.isFinite(value)) return { value: "—", unit: unit === "mi" ? "ft" : "m" };
  return {
    value: String(Math.round(value * (unit === "mi" ? 3.2808398950131 : 1))),
    unit: unit === "mi" ? "ft" : "m",
  };
}

export function createTripStatsModel(input: TripStatsInput = {}): TripStatsModel {
  const speedUnit = input.speedUnit === "mph" ? "mph" : "kmh";
  const distanceUnit = input.distanceUnit === "mi" ? "mi" : "m";
  const durationMs = Number.isFinite(Number(input.durationMs))
    ? Math.max(0, Number(input.durationMs))
    : Number.isFinite(Number(input.startedAtMs))
      ? Math.max(0, finite(input.nowMs, Date.now()) - Number(input.startedAtMs))
      : 0;
  const averageSpeedMs = Number.isFinite(Number(input.averageSpeedMs))
    ? Math.max(0, Number(input.averageSpeedMs))
    : durationMs > 0
      ? Math.max(0, finite(input.totalDistanceM)) / (durationMs / 1000)
      : 0;
  return {
    currentSpeed: speed(input.currentSpeedMs, speedUnit),
    maxSpeed: speed(input.maxSpeedMs, speedUnit),
    averageSpeed: speed(averageSpeedMs, speedUnit),
    distance: formatTripDistance(input.totalDistanceM, distanceUnit),
    nearestCamera: input.nearestCameraDistanceM !== null
      && input.nearestCameraDistanceM !== undefined
      && Number.isFinite(Number(input.nearestCameraDistanceM))
      ? formatProximityDistance(input.nearestCameraDistanceM, distanceUnit)
      : { value: "—", unit: "" },
    duration: { value: formatTripDuration(durationMs), unit: "" },
    altitude: altitude(input.currentAltitudeM, distanceUnit),
    maxAltitude: altitude(input.maxAltitudeM, distanceUnit),
    minAltitude: altitude(input.minAltitudeM, distanceUnit),
  };
}
