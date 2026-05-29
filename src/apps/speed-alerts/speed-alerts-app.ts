import "../../styles/speed-alert-panel.less";
import "./speed-alerts-app.less";

import { createDrivingAlertService } from "../../app/services/driving-alert-service.js";
import {
  createSpeedAlertPanel,
  type SpeedAlertPanelApi,
} from "../../speed/speed-alert-panel.js";
import {
  DISTANCE_UNIT_CONFIG,
  STORAGE_ALERT_ENABLED_KEY,
  STORAGE_ALERT_LIMIT_KEY,
  STORAGE_ALERT_SOUND_ENABLED_KEY,
  STORAGE_AUDIO_MUTED_KEY,
  STORAGE_DISTANCE_UNIT_KEY,
  STORAGE_TRAP_ALERT_DISTANCE_KEY,
  STORAGE_TRAP_ALERT_ENABLED_KEY,
  STORAGE_TRAP_SOUND_ENABLED_KEY,
  STORAGE_UNIT_KEY,
  UNIT_CONFIG,
  type DistanceUnit,
} from "../../speed/constants.js";
import {
  normalizeTrapAlertDistance,
  saveAlertEnabledPreference,
  saveAlertLimitPreference,
  saveAlertSoundEnabledPreference,
  saveAudioMutedPreference,
  saveDistanceUnitPreference,
  saveTrapAlertDistancePreference,
  saveTrapAlertEnabledPreference,
  saveTrapSoundEnabledPreference,
  saveUnitPreference,
} from "../../speed/preferences.js";
import { hasStoredValue } from "../../shared/storage.js";
import type {
  DrivingAlertService,
  DrivingAlertSnapshot,
  GpsService,
} from "../../types/services";
import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const SPEED_ALERTS_APP_ID = "vatio.speedAlerts";
export const SPEED_ALERTS_SETTINGS_KEY = "preferences";
const CAMERA_MAP_APP_ID = "vatio.cameraMap";
const CAMERA_MAP_WINDOW_ID = "camera-map";

const LEGACY_SPEED_ALERT_KEYS = [
  STORAGE_UNIT_KEY,
  STORAGE_DISTANCE_UNIT_KEY,
  STORAGE_ALERT_ENABLED_KEY,
  STORAGE_ALERT_LIMIT_KEY,
  STORAGE_ALERT_SOUND_ENABLED_KEY,
  STORAGE_AUDIO_MUTED_KEY,
  STORAGE_TRAP_ALERT_ENABLED_KEY,
  STORAGE_TRAP_ALERT_DISTANCE_KEY,
  STORAGE_TRAP_SOUND_ENABLED_KEY,
] as const;

type AnyDrivingAlertService = DrivingAlertService & Record<string, any>;

interface SpeedAlertsPreferences {
  unit?: string;
  distanceUnit?: string;
  alertEnabled?: boolean;
  alertLimitMs?: number;
  alertSoundEnabled?: boolean;
  audioMuted?: boolean;
  trapAlertEnabled?: boolean;
  trapAlertDistanceM?: number;
  trapSoundEnabled?: boolean;
}

export interface SpeedAlertsAppOptions extends Record<string, any> {
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
  gpsService?: GpsService | null;
  drivingAlertService?: DrivingAlertService | null;
  onOpenCameraMap?: (() => unknown) | null;
}

export interface SpeedAlertsAppApi extends SpeedAlertPanelApi {
  drivingAlertService: DrivingAlertService;
  runtime: VatioAppRuntime | null;
}

export function resolveSpeedAlertsRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<SpeedAlertsAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === SPEED_ALERTS_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(SPEED_ALERTS_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(SPEED_ALERTS_APP_ID)
    || null;
}

function hasLegacySpeedAlertsPreferences() {
  return LEGACY_SPEED_ALERT_KEYS.some((key) => hasStoredValue(key));
}

function normalizePreferences(input: unknown): SpeedAlertsPreferences | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  const distanceUnit = DISTANCE_UNIT_CONFIG[String(candidate.distanceUnit || "")]
    ? String(candidate.distanceUnit)
    : undefined;
  const unit = UNIT_CONFIG[String(candidate.unit || "")]
    ? String(candidate.unit)
    : undefined;
  const normalized: SpeedAlertsPreferences = {};

  if (unit) normalized.unit = unit;
  if (distanceUnit) normalized.distanceUnit = distanceUnit;
  if (typeof candidate.alertEnabled === "boolean") normalized.alertEnabled = candidate.alertEnabled;
  if (Number.isFinite(Number(candidate.alertLimitMs)) && Number(candidate.alertLimitMs) > 0) {
    normalized.alertLimitMs = Number(candidate.alertLimitMs);
  }
  if (typeof candidate.alertSoundEnabled === "boolean") normalized.alertSoundEnabled = candidate.alertSoundEnabled;
  if (typeof candidate.audioMuted === "boolean") normalized.audioMuted = candidate.audioMuted;
  if (typeof candidate.trapAlertEnabled === "boolean") normalized.trapAlertEnabled = candidate.trapAlertEnabled;
  if (Number.isFinite(Number(candidate.trapAlertDistanceM)) && Number(candidate.trapAlertDistanceM) > 0) {
    normalized.trapAlertDistanceM = normalizeTrapAlertDistance(
      Number(candidate.trapAlertDistanceM),
      (distanceUnit || "m") as DistanceUnit,
    );
  }
  if (typeof candidate.trapSoundEnabled === "boolean") normalized.trapSoundEnabled = candidate.trapSoundEnabled;

  return Object.keys(normalized).length ? normalized : null;
}

function getSnapshotPreferences(snapshot?: DrivingAlertSnapshot | null): SpeedAlertsPreferences | null {
  return normalizePreferences((snapshot as Record<string, unknown> | null | undefined)?.preferences);
}

function loadRuntimePreferences(runtime: VatioAppRuntime | null): SpeedAlertsPreferences | null {
  if (!runtime?.services.settings) return null;
  const stored = runtime.services.settings.getJson<SpeedAlertsPreferences | null>(SPEED_ALERTS_SETTINGS_KEY, null);
  return normalizePreferences(stored);
}

function saveLegacyPreferences(preferences: SpeedAlertsPreferences | null) {
  if (!preferences) return;
  if (preferences.unit) saveUnitPreference(preferences.unit);
  if (preferences.distanceUnit) saveDistanceUnitPreference(preferences.distanceUnit);
  if (typeof preferences.alertEnabled === "boolean") saveAlertEnabledPreference(preferences.alertEnabled);
  if (Number.isFinite(preferences.alertLimitMs)) saveAlertLimitPreference(Number(preferences.alertLimitMs));
  if (typeof preferences.alertSoundEnabled === "boolean") saveAlertSoundEnabledPreference(preferences.alertSoundEnabled);
  if (typeof preferences.audioMuted === "boolean") saveAudioMutedPreference(preferences.audioMuted);
  if (typeof preferences.trapAlertEnabled === "boolean") saveTrapAlertEnabledPreference(preferences.trapAlertEnabled);
  if (Number.isFinite(preferences.trapAlertDistanceM)) saveTrapAlertDistancePreference(Number(preferences.trapAlertDistanceM));
  if (typeof preferences.trapSoundEnabled === "boolean") saveTrapSoundEnabledPreference(preferences.trapSoundEnabled);
}

function saveRuntimePreferences(runtime: VatioAppRuntime | null, preferences: SpeedAlertsPreferences | null) {
  if (!runtime || !preferences) return;
  const saved = runtime.services.settings?.setJson(SPEED_ALERTS_SETTINGS_KEY, preferences) === true;
  if (!saved) {
    runtime.logger.warn("Speed Alerts preferences could not be saved through runtime settings; preserving legacy fallback.");
  }
}

function applyPreferencesToService(service: AnyDrivingAlertService, preferences: SpeedAlertsPreferences | null) {
  if (!service || !preferences) return;
  if (preferences.unit || preferences.distanceUnit) {
    service.setUnits?.({
      ...(preferences.unit ? { unit: preferences.unit } : {}),
      ...(preferences.distanceUnit ? { distanceUnit: preferences.distanceUnit } : {}),
    });
  }
  if (Number.isFinite(preferences.alertLimitMs)) {
    service.setManualAlertLimitMs?.(preferences.alertLimitMs, { startIfNeeded: false });
  }
  if (typeof preferences.alertEnabled === "boolean") {
    service.setManualAlertEnabled?.(preferences.alertEnabled, { startIfNeeded: false });
  }
  if (typeof preferences.alertSoundEnabled === "boolean") {
    service.setAlertSoundEnabled?.(preferences.alertSoundEnabled, { startIfNeeded: false });
  }
  if (typeof preferences.trapAlertEnabled === "boolean") {
    service.setTrapAlertEnabled?.(preferences.trapAlertEnabled, { startIfNeeded: false });
  }
  if (Number.isFinite(preferences.trapAlertDistanceM)) {
    service.setTrapAlertDistanceM?.(preferences.trapAlertDistanceM, { startIfNeeded: false });
  }
  if (typeof preferences.trapSoundEnabled === "boolean") {
    service.setTrapSoundEnabled?.(preferences.trapSoundEnabled, { startIfNeeded: false });
  }
  if (typeof preferences.audioMuted === "boolean") {
    service.setMuted?.(preferences.audioMuted, { startIfNeeded: false });
  }
}

function createSpeedAlertsDrivingAlertService({
  runtime,
  drivingAlertService,
  gpsService,
}: {
  runtime: VatioAppRuntime | null;
  drivingAlertService?: DrivingAlertService | null;
  gpsService?: GpsService | null;
}) {
  const runtimePreferences = loadRuntimePreferences(runtime);
  const shouldSeedLegacy = Boolean(runtimePreferences && !hasLegacySpeedAlertsPreferences());
  if (!drivingAlertService && shouldSeedLegacy) saveLegacyPreferences(runtimePreferences);

  const ownedService = drivingAlertService
    ? null
    : createDrivingAlertService({ gpsService });
  const baseService = (drivingAlertService || ownedService) as AnyDrivingAlertService;

  if (drivingAlertService && shouldSeedLegacy) {
    applyPreferencesToService(baseService, runtimePreferences);
    saveLegacyPreferences(runtimePreferences);
  }

  function mirror(snapshot?: DrivingAlertSnapshot | null, { mirrorLegacy = false } = {}) {
    const preferences = getSnapshotPreferences(snapshot || baseService.getSnapshot?.());
    if (!preferences) return;
    saveRuntimePreferences(runtime, preferences);
    if (mirrorLegacy) saveLegacyPreferences(preferences);
  }

  function wrapPreferenceMethod(name: string) {
    const original = baseService?.[name];
    if (typeof original !== "function") return undefined;
    return (...args: unknown[]) => {
      const result = original.apply(baseService, args);
      mirror(result as DrivingAlertSnapshot, { mirrorLegacy: true });
      return result;
    };
  }

  const service = {
    ...baseService,
    setAlertSoundEnabled: wrapPreferenceMethod("setAlertSoundEnabled") || baseService.setAlertSoundEnabled,
    setManualAlertEnabled: wrapPreferenceMethod("setManualAlertEnabled") || baseService.setManualAlertEnabled,
    setManualAlertLimitMs: wrapPreferenceMethod("setManualAlertLimitMs") || baseService.setManualAlertLimitMs,
    setMuted: wrapPreferenceMethod("setMuted") || baseService.setMuted,
    setTrapAlertDistanceM: wrapPreferenceMethod("setTrapAlertDistanceM") || baseService.setTrapAlertDistanceM,
    setTrapAlertEnabled: wrapPreferenceMethod("setTrapAlertEnabled") || baseService.setTrapAlertEnabled,
    setTrapSoundEnabled: wrapPreferenceMethod("setTrapSoundEnabled") || baseService.setTrapSoundEnabled,
    setUnits: wrapPreferenceMethod("setUnits") || baseService.setUnits,
  } as AnyDrivingAlertService;

  mirror(baseService.getSnapshot?.(), { mirrorLegacy: false });

  return {
    service,
    destroyOwnedService() {
      ownedService?.destroy?.();
    },
  };
}

function createCameraMapLauncher({
  runtime,
  shellManager,
  onOpenCameraMap,
}: Pick<SpeedAlertsAppOptions, "shellManager" | "onOpenCameraMap"> & {
  runtime: VatioAppRuntime | null;
}) {
  if (typeof onOpenCameraMap === "function") return onOpenCameraMap;
  return () => {
    if (runtime?.shell.openApp(CAMERA_MAP_APP_ID)) return true;
    if (shellManager?.openWindow?.(CAMERA_MAP_WINDOW_ID)) return true;
    return window.__vatioboardFloatingTools?.openCameraMap?.();
  };
}

export function createSpeedAlertsApp(options: SpeedAlertsAppOptions = {}): SpeedAlertsAppApi {
  const runtime = resolveSpeedAlertsRuntime(options);
  const gpsService = runtime?.services.gps || options.gpsService || null;
  const { service, destroyOwnedService } = createSpeedAlertsDrivingAlertService({
    runtime,
    gpsService,
    drivingAlertService: runtime?.services.drivingAlerts || options.drivingAlertService || null,
  });
  const panel = createSpeedAlertPanel({
    ...options,
    gpsService,
    drivingAlertService: service,
    onOpenCameraMap: createCameraMapLauncher({
      runtime,
      shellManager: options.shellManager,
      onOpenCameraMap: options.onOpenCameraMap,
    }),
  });

  runtime?.logger.debug("Speed Alerts app module mounted with scoped runtime services.");

  return {
    ...panel,
    drivingAlertService: service,
    runtime,
    destroy() {
      panel.destroy();
      destroyOwnedService();
    },
  };
}
