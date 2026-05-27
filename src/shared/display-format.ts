/**
 * Shared display formatters for speed and distance values.
 *
 * These work with the BFF summary shape:
 *   - speed: pre-converted numeric value + unit key ("kmh" | "mph")
 *   - distance: raw meters value + unit key ("m" | "ft")
 */

const SPEED_UNIT_LABELS: Record<string, string> = { kmh: "km/h", mph: "mph" };
const FEET_PER_MILE = 5280;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

/**
 * Format a pre-converted speed value with its human-readable unit label.
 *
 *   formatDisplaySpeed(82.4, "kmh")  → "82 km/h"
 *   formatDisplaySpeed(70.2, "mph")  → "70 mph"
 *
 * @param {number|null|undefined} value  Already-converted speed number.
 * @param {string} unitKey              "kmh" or "mph".
 * @param {string} [fallback="—"]       Returned when value is not finite.
 * @returns {string}
 */
export function formatDisplaySpeed(
  value: number | null | undefined,
  unitKey: string,
  fallback = "—",
): string {
  if (value == null) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const label = SPEED_UNIT_LABELS[unitKey] || unitKey || "";
  return `${Math.round(numeric)} ${label}`;
}

/**
 * Format a distance from meters into the most readable display string,
 * automatically promoting to km / mi when the value is large enough.
 *
 * Metric ("m"):
 *   formatDisplayDistance(640,  "m")  → "640 m"
 *   formatDisplayDistance(1280, "m")  → "1.3 km"
 *   formatDisplayDistance(12000,"m")  → "12 km"
 *
 * Imperial ("ft"):
 *   formatDisplayDistance(290,  "ft") → "951 ft"
 *   formatDisplayDistance(1610, "ft") → "1.0 mi"
 *   formatDisplayDistance(19312,"ft") → "12 mi"
 *
 * @param {number|null|undefined} distanceM  Distance in meters.
 * @param {string} unitKey                   "m" or "ft".
 * @param {string} [fallback="—"]            Returned when value is not finite.
 * @returns {string}
 */
export function formatDisplayDistance(
  distanceM: number | null | undefined,
  unitKey: string,
  fallback = "—",
): string {
  if (distanceM == null) return fallback;
  const meters = Number(distanceM);
  if (!Number.isFinite(meters) || meters < 0) return fallback;

  if (unitKey === "ft") {
    const feet = meters / METERS_PER_FOOT;
    if (feet < FEET_PER_MILE) {
      return `${Math.round(feet)} ft`;
    }
    const miles = meters / METERS_PER_MILE;
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }

  // metric
  if (meters < METERS_PER_KM) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / METERS_PER_KM;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
