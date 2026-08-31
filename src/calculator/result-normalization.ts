import { round } from "mathjs";

const DEFAULT_DECIMAL_PLACES = 8;
const MIN_DECIMAL_PLACES = 0;
const MAX_DECIMAL_PLACES = 10;
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function clampDecimalPlaces(value: unknown): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_DECIMAL_PLACES;
  return Math.min(
    MAX_DECIMAL_PLACES,
    Math.max(MIN_DECIMAL_PLACES, Math.round(numericValue)),
  );
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !PLAIN_NUMBER.test(value.trim())) return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function normalizeCalculatorResult(
  value: unknown,
  decimalPlaces: unknown = DEFAULT_DECIMAL_PLACES,
): string {
  const numericValue = asFiniteNumber(value);
  if (numericValue == null) return String(value ?? "");

  const normalized = round(numericValue, clampDecimalPlaces(decimalPlaces));
  if (Object.is(normalized, -0) || normalized === 0) return "0";
  return String(normalized);
}

