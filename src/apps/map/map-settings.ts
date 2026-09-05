import {
  CAMERA_MAP_LEGACY_SETTING_KEYS,
  type CameraMapSettingId,
  type CameraMapSettingsStore,
} from "./map-renderer.js";
import {
  hasStoredValue,
  loadBoolean,
  loadText,
  removeStoredValue,
  saveBoolean,
  saveText,
} from "../../shared/storage.js";
import type { VatioAppRuntime } from "../../app-platform/types";

function normalizeBoolean(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Owns Map preferences while treating the former Camera Map keys as migration
 * inputs and mirrors. Keeping those mirrors lets the renderer retain one
 * preference contract while the obsolete shell app stays unregistered.
 */
export function createMapSettingsStore(runtime: VatioAppRuntime | null): CameraMapSettingsStore {
  function readRuntimeSetting(key: CameraMapSettingId): string | null {
    try {
      return normalizeString(runtime?.services.settings?.get<string | null>(key, null));
    } catch (error) {
      runtime?.logger.warn(`Map setting "${key}" could not be read.`, error);
      return null;
    }
  }

  function writeRuntimeSetting(key: CameraMapSettingId, value: string) {
    const saved = runtime?.services.settings?.set(key, value) === true;
    if (!saved && runtime) runtime.logger.warn(`Map setting "${key}" could not be saved; preserving its legacy mirror.`);
  }

  function removeRuntimeSetting(key: CameraMapSettingId) {
    const removed = runtime?.services.settings?.remove(key) === true;
    if (!removed && runtime) runtime.logger.warn(`Map setting "${key}" could not be removed from runtime storage.`);
  }

  function getCanonicalString(key: CameraMapSettingId, fallback: string | null = null) {
    const legacyKey = CAMERA_MAP_LEGACY_SETTING_KEYS[key];
    if (hasStoredValue(legacyKey)) {
      const value = loadText(legacyKey, fallback);
      if (value !== null && readRuntimeSetting(key) === null) writeRuntimeSetting(key, value);
      return value;
    }

    const runtimeValue = readRuntimeSetting(key);
    if (runtimeValue !== null) {
      saveText(legacyKey, runtimeValue);
      return runtimeValue;
    }
    return fallback;
  }

  return {
    get(key, fallback = null) {
      return getCanonicalString(key, fallback);
    },
    set(key, value) {
      saveText(CAMERA_MAP_LEGACY_SETTING_KEYS[key], value);
      writeRuntimeSetting(key, value);
    },
    remove(key) {
      removeStoredValue(CAMERA_MAP_LEGACY_SETTING_KEYS[key]);
      removeRuntimeSetting(key);
    },
    has(key) {
      return hasStoredValue(CAMERA_MAP_LEGACY_SETTING_KEYS[key]) || readRuntimeSetting(key) !== null;
    },
    getBoolean(key, fallback = false) {
      const legacyKey = CAMERA_MAP_LEGACY_SETTING_KEYS[key];
      if (hasStoredValue(legacyKey)) {
        const value = loadBoolean(legacyKey, fallback);
        if (readRuntimeSetting(key) === null) writeRuntimeSetting(key, value ? "true" : "false");
        return value;
      }
      const runtimeValue = normalizeBoolean(readRuntimeSetting(key));
      if (runtimeValue !== null) {
        saveBoolean(legacyKey, runtimeValue);
        return runtimeValue;
      }
      return fallback;
    },
    setBoolean(key, value) {
      saveBoolean(CAMERA_MAP_LEGACY_SETTING_KEYS[key], value);
      writeRuntimeSetting(key, value ? "true" : "false");
    },
    getEnum(key, allowedValues, fallback) {
      const value = getCanonicalString(key, null);
      return value && allowedValues.includes(value) ? value : fallback;
    },
    setEnum(key, value) {
      saveText(CAMERA_MAP_LEGACY_SETTING_KEYS[key], value);
      writeRuntimeSetting(key, value);
    },
  };
}
