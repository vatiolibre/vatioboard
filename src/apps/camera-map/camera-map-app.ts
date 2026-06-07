import "../../styles/camera-map.less";
import "./camera-map-app.less";

import {
  CAMERA_MAP_LEGACY_SETTING_KEYS,
  createCameraMapWidget,
  type CameraMapSettingId,
  type CameraMapSettingsStore,
} from "../../speed/camera-map-widget.js";
import {
  hasStoredValue,
  loadBoolean,
  loadText,
  removeStoredValue,
  saveBoolean,
  saveText,
} from "../../shared/storage.js";
import type { GpsService } from "../../types/services";
import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const CAMERA_MAP_APP_ID = "vatio.cameraMap";

export interface CameraMapAppOptions extends Record<string, any> {
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
  gpsService?: GpsService | null;
}

export interface CameraMapAppApi extends Record<string, any> {
  runtime: VatioAppRuntime | null;
}

export function resolveCameraMapRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<CameraMapAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === CAMERA_MAP_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(CAMERA_MAP_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(CAMERA_MAP_APP_ID)
    || null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createCameraMapSettingsStore(runtime: VatioAppRuntime | null): CameraMapSettingsStore {
  function readRuntimeSetting(key: CameraMapSettingId): string | null {
    try {
      return normalizeString(runtime?.services.settings?.get<string | null>(key, null));
    } catch (error) {
      runtime?.logger.warn(`Camera Map setting "${key}" could not be read through runtime settings.`, error);
      return null;
    }
  }

  function writeRuntimeSetting(key: CameraMapSettingId, value: string) {
    const saved = runtime?.services.settings?.set(key, value) === true;
    if (!saved && runtime) {
      runtime.logger.warn(`Camera Map setting "${key}" could not be saved through runtime settings; preserving legacy fallback.`);
    }
  }

  function removeRuntimeSetting(key: CameraMapSettingId) {
    const removed = runtime?.services.settings?.remove(key) === true;
    if (!removed && runtime) {
      runtime.logger.warn(`Camera Map setting "${key}" could not be removed through runtime settings; removing legacy fallback only.`);
    }
  }

  function getCanonicalString(key: CameraMapSettingId, fallback: string | null = null) {
    const legacyKey = CAMERA_MAP_LEGACY_SETTING_KEYS[key];
    if (hasStoredValue(legacyKey)) return loadText(legacyKey, fallback);

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
      if (hasStoredValue(legacyKey)) return loadBoolean(legacyKey, fallback);

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

export function createCameraMapApp(options: CameraMapAppOptions = {}): CameraMapAppApi {
  const runtime = resolveCameraMapRuntime(options);
  const widget = createCameraMapWidget({
    ...options,
    gpsService: runtime?.services.gps || options.gpsService || null,
    settingsStore: createCameraMapSettingsStore(runtime),
  });

  runtime?.logger.debug("Camera Map app module mounted with scoped runtime GPS and settings.");

  return {
    ...widget,
    runtime,
  };
}

export const createShellWindowApp = createCameraMapApp;
