import type { StorageLike } from "../types/storage";
import type {
  VatioSharedSettingsKey,
  VatioSharedSettingsService,
  VatioSharedSettingsSnapshot,
} from "./types";

export const SHARED_SETTINGS_STORAGE_KEY = "vatioboard.os.sharedSettings.v1";

const DEFAULT_SHARED_SETTINGS: VatioSharedSettingsSnapshot = {
  speedUnit: "kmh",
  distanceUnit: "m",
  tripDistanceUnit: "km",
  decimalPrecision: 2,
  thousandsSeparator: true,
  language: "en",
  uiDensity: "comfortable",
  inVehicleMode: "unknown",
  audioMuted: false,
  defaultVolume: 0.8,
};

function getDefaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeSetting<K extends VatioSharedSettingsKey>(
  key: K,
  value: unknown,
): VatioSharedSettingsSnapshot[K] | null {
  if (key === "speedUnit") return (value === "mph" || value === "kmh" ? value : null) as VatioSharedSettingsSnapshot[K] | null;
  if (key === "distanceUnit") return (value === "ft" || value === "m" ? value : null) as VatioSharedSettingsSnapshot[K] | null;
  if (key === "tripDistanceUnit") return (value === "mi" || value === "km" ? value : null) as VatioSharedSettingsSnapshot[K] | null;
  if (key === "decimalPrecision") {
    const numberValue = Number(value);
    return (Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= 8
      ? Math.round(numberValue)
      : null) as VatioSharedSettingsSnapshot[K] | null;
  }
  if (key === "thousandsSeparator" || key === "audioMuted") {
    return (typeof value === "boolean" ? value : null) as VatioSharedSettingsSnapshot[K] | null;
  }
  if (key === "language") {
    const text = String(value || "").trim();
    return (text ? text : null) as VatioSharedSettingsSnapshot[K] | null;
  }
  if (key === "uiDensity") {
    return (
      value === "compact" || value === "comfortable" || value === "spacious" ? value : null
    ) as VatioSharedSettingsSnapshot[K] | null;
  }
  if (key === "inVehicleMode") {
    return (
      value === "unknown" || value === "parked" || value === "driving" || value === "passenger"
        ? value
        : null
    ) as VatioSharedSettingsSnapshot[K] | null;
  }
  if (key === "defaultVolume") {
    const numberValue = Number(value);
    return (Number.isFinite(numberValue)
      ? Math.max(0, Math.min(1, numberValue))
      : null) as VatioSharedSettingsSnapshot[K] | null;
  }
  if (key === "cameraAlertDistanceM") {
    const numberValue = Number(value);
    return (Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null) as VatioSharedSettingsSnapshot[K] | null;
  }
  return null;
}

function normalizeSnapshot(value: unknown): VatioSharedSettingsSnapshot {
  const source = value && typeof value === "object" ? value as VatioSharedSettingsSnapshot : {};
  const snapshot: VatioSharedSettingsSnapshot = {};

  for (const key of Object.keys(DEFAULT_SHARED_SETTINGS) as VatioSharedSettingsKey[]) {
    const normalized = normalizeSetting(key, source[key]);
    if (normalized !== null) {
      snapshot[key] = normalized as never;
    }
  }

  if (typeof source.updatedAt === "string") snapshot.updatedAt = source.updatedAt;
  return snapshot;
}

export function readStoredSharedSettings(
  storage: StorageLike | null = getDefaultStorage(),
): VatioSharedSettingsSnapshot {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SHARED_SETTINGS_STORAGE_KEY);
    return raw ? normalizeSnapshot(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function createSharedSettingsService({
  storage = null,
  now = () => new Date(),
}: {
  storage?: StorageLike | null;
  now?: () => Date;
} = {}): VatioSharedSettingsService {
  const listeners = new Set<(settings: VatioSharedSettingsSnapshot) => void>();
  const getStorage = () => storage ?? getDefaultStorage();

  function readRaw() {
    return readStoredSharedSettings(getStorage());
  }

  function readSnapshot(): VatioSharedSettingsSnapshot {
    return {
      ...DEFAULT_SHARED_SETTINGS,
      ...normalizeSnapshot(readRaw()),
    };
  }

  function writeSnapshot(snapshot: VatioSharedSettingsSnapshot) {
    const activeStorage = getStorage();
    if (!activeStorage) return false;
    const next = {
      ...normalizeSnapshot(snapshot),
      updatedAt: now().toISOString(),
    };

    try {
      activeStorage.setItem(SHARED_SETTINGS_STORAGE_KEY, JSON.stringify(next));
      const emitted = {
        ...DEFAULT_SHARED_SETTINGS,
        ...next,
      };
      for (const listener of listeners) listener(emitted);
      return true;
    } catch {
      return false;
    }
  }

  return {
    getAll() {
      return readSnapshot();
    },
    get(key) {
      return readSnapshot()[key] ?? null;
    },
    set(key, value) {
      const normalized = normalizeSetting(key, value);
      if (normalized === null) return false;
      return writeSnapshot({
        ...readStoredSharedSettings(getStorage()),
        [key]: normalized,
      });
    },
    reset(key) {
      if (!key) return writeSnapshot({});
      const snapshot = { ...readStoredSharedSettings(getStorage()) };
      delete snapshot[key];
      return writeSnapshot(snapshot);
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const sharedSettings = createSharedSettingsService();
