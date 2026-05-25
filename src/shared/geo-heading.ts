const EARTH_RADIUS_M = 6371008.8;
const MIN_DERIVED_HEADING_DISTANCE_M = 8;

export interface LatLon {
  latitude: number;
  longitude: number;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function toDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}

export function normalizeHeading(value: unknown): number | null {
  const heading = finiteNumber(value);
  if (heading === null || heading < 0) return null;
  return ((heading % 360) + 360) % 360;
}

export function isUsableLatLon(value: unknown): value is LatLon {
  const point = value as Partial<LatLon> | null | undefined;
  return Number.isFinite(point?.latitude)
    && Number.isFinite(point?.longitude)
    && point.latitude! >= -90
    && point.latitude! <= 90
    && point.longitude! >= -180
    && point.longitude! <= 180;
}

export function distanceMeters(a: unknown, b: unknown): number {
  if (!isUsableLatLon(a) || !isUsableLatLon(b)) return Infinity;

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingDegrees(a: unknown, b: unknown): number | null {
  if (!isUsableLatLon(a) || !isUsableLatLon(b)) return null;

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return normalizeHeading(toDegrees(Math.atan2(y, x)));
}

export function angularDifferenceDegrees(a: unknown, b: unknown): number {
  const headingA = normalizeHeading(a);
  const headingB = normalizeHeading(b);
  if (headingA === null || headingB === null) return Infinity;
  return Math.abs(((headingA - headingB + 540) % 360) - 180);
}

export function deriveHeadingFromPositions(previous: unknown, next: unknown): number | null {
  if (distanceMeters(previous, next) < MIN_DERIVED_HEADING_DISTANCE_M) return null;
  return bearingDegrees(previous, next);
}
