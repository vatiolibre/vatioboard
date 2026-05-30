import { hasStoredValue, loadText, saveText } from "../shared/storage.js";
import { readStoredSharedSettings, sharedSettings } from "./shared-settings.js";
import type { VatioSharedSettingsKey, VatioSharedSettingsSnapshot } from "./types";

type Normalizer<T> = (value: unknown) => T | null;

interface LegacyBridgeOptions<K extends VatioSharedSettingsKey, T> {
  sharedKey: K;
  legacyKey: string;
  fallback: T;
  normalize: Normalizer<T>;
  serialize?: (value: T) => string;
}

function loadLegacyFirst<K extends VatioSharedSettingsKey, T>({
  sharedKey,
  legacyKey,
  fallback,
  normalize,
  serialize = (value) => String(value),
}: LegacyBridgeOptions<K, T>): T {
  if (hasStoredValue(legacyKey)) {
    const legacyValue = normalize(loadText(legacyKey, ""));
    if (legacyValue !== null) {
      sharedSettings.set(sharedKey, legacyValue as VatioSharedSettingsSnapshot[K]);
      return legacyValue;
    }
  }

  const sharedValue = normalize(readStoredSharedSettings()[sharedKey]);
  if (sharedValue !== null) {
    saveText(legacyKey, serialize(sharedValue));
    return sharedValue;
  }

  return fallback;
}

function saveLegacyFirst<K extends VatioSharedSettingsKey, T>({
  sharedKey,
  legacyKey,
  fallback,
  normalize,
  serialize = (value) => String(value),
}: LegacyBridgeOptions<K, T>, value: unknown): T {
  const normalized = normalize(value) ?? fallback;
  saveText(legacyKey, serialize(normalized));
  sharedSettings.set(sharedKey, normalized as VatioSharedSettingsSnapshot[K]);
  return normalized;
}

export function normalizeSharedSpeedUnit(value: unknown): "kmh" | "mph" | null {
  return value === "mph" || value === "kmh" ? value : null;
}

export function normalizeSharedDistanceUnit(value: unknown): "m" | "ft" | null {
  return value === "ft" || value === "m" ? value : null;
}

export function normalizeSharedTripDistanceUnit(value: unknown): "km" | "mi" | null {
  return value === "mi" || value === "km" ? value : null;
}

export function loadLegacyBackedSpeedUnit(legacyKey: string, fallback: "kmh" | "mph" = "kmh") {
  return loadLegacyFirst({
    sharedKey: "speedUnit",
    legacyKey,
    fallback,
    normalize: normalizeSharedSpeedUnit,
  });
}

export function saveLegacyBackedSpeedUnit(
  legacyKey: string,
  value: unknown,
  fallback: "kmh" | "mph" = "kmh",
) {
  return saveLegacyFirst({
    sharedKey: "speedUnit",
    legacyKey,
    fallback,
    normalize: normalizeSharedSpeedUnit,
  }, value);
}

export function loadLegacyBackedDistanceUnit(legacyKey: string, fallback: "m" | "ft" = "m") {
  return loadLegacyFirst({
    sharedKey: "distanceUnit",
    legacyKey,
    fallback,
    normalize: normalizeSharedDistanceUnit,
  });
}

export function saveLegacyBackedDistanceUnit(
  legacyKey: string,
  value: unknown,
  fallback: "m" | "ft" = "m",
) {
  return saveLegacyFirst({
    sharedKey: "distanceUnit",
    legacyKey,
    fallback,
    normalize: normalizeSharedDistanceUnit,
  }, value);
}
