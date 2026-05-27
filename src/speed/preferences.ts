import {
  loadBoolean,
  loadNumber,
  loadText,
  saveBoolean,
  saveNumber,
  saveText,
} from '../shared/storage.js';
import { loadConfiguredDistanceUnit, loadConfiguredSpeedUnit } from '../shared/unit-bootstrap.js';
import {
  ALERT_CONFIG,
  type AlertConfig,
  type CameraApproachFallbackMode,
  DEFAULT_ALERT_LIMIT_MS,
  DISTANCE_UNIT_CONFIG,
  type DistanceUnit,
  LEGACY_STORAGE_ALTITUDE_UNIT_KEY,
  STORAGE_ALERT_ENABLED_KEY,
  STORAGE_ALERT_LIMIT_KEY,
  STORAGE_ALERT_SOUND_ENABLED_KEY,
  STORAGE_ALERT_TRIGGER_DISCOVERED_KEY,
  STORAGE_AUDIO_MUTED_KEY,
  STORAGE_CAMERA_APPROACH_FALLBACK_MODE_KEY,
  STORAGE_CAMERA_APPROACH_HEADING_TOLERANCE_KEY,
  STORAGE_CAMERA_APPROACH_MINIMUM_SPEED_KEY,
  STORAGE_DISTANCE_UNIT_KEY,
  STORAGE_PRIMARY_VIEW_KEY,
  STORAGE_TRAP_ALERT_DISTANCE_KEY,
  STORAGE_TRAP_ALERT_ENABLED_KEY,
  STORAGE_TRAP_SOUND_ENABLED_KEY,
  STORAGE_UNIT_KEY,
  TRAP_ALERT_PRESETS,
  type PrimaryView,
  type SpeedUnit,
  type TrapAlertPreset,
  UNIT_CONFIG,
} from './constants.js';

export interface CameraApproachOptions {
  fallbackMode: CameraApproachFallbackMode;
  headingToleranceDeg: number;
  minimumSpeedMs: number;
}

export interface SpeedPreferences {
  unit: SpeedUnit;
  distanceUnit: DistanceUnit;
  primaryView: PrimaryView;
  alertEnabled: boolean;
  alertLimitMs: number;
  alertSoundEnabled: boolean;
  audioMuted: boolean;
  trapAlertEnabled: boolean;
  trapAlertDistanceM: number;
  trapSoundEnabled: boolean;
  cameraApproachOptions: CameraApproachOptions;
  alertTriggerDiscovered: boolean;
}

const CAMERA_APPROACH_FALLBACK_MODES = new Set<CameraApproachFallbackMode>(['legacy-radius', 'heading-only', 'silent']);
const DEFAULT_CAMERA_APPROACH_HEADING_TOLERANCE_DEG = 45;
const DEFAULT_CAMERA_APPROACH_MINIMUM_SPEED_MS = 1.5;
const loadConfiguredDistanceUnitOrNull = loadConfiguredDistanceUnit as (fallback: null) => DistanceUnit | null;

export function loadUnitPreference(): SpeedUnit {
  const unit = loadConfiguredSpeedUnit('kmh');
  return unit && UNIT_CONFIG[unit] ? unit : 'kmh';
}

export function saveUnitPreference(unit: unknown): void {
  saveText(STORAGE_UNIT_KEY, unit);
}

export function loadDistanceUnitPreference(): DistanceUnit {
  const storedUnit = loadConfiguredDistanceUnitOrNull(null);
  if (storedUnit && DISTANCE_UNIT_CONFIG[storedUnit]) return storedUnit;

  const legacyUnit = loadText(LEGACY_STORAGE_ALTITUDE_UNIT_KEY, '');
  return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit as DistanceUnit] ? legacyUnit as DistanceUnit : 'm';
}

export function saveDistanceUnitPreference(unit: unknown): void {
  saveText(STORAGE_DISTANCE_UNIT_KEY, unit);
}

export function loadPrimaryViewPreference(): PrimaryView {
  return loadText(STORAGE_PRIMARY_VIEW_KEY, '') === 'waze' ? 'waze' : 'gauge';
}

export function savePrimaryViewPreference(view: unknown): void {
  saveText(STORAGE_PRIMARY_VIEW_KEY, view);
}

export function loadAlertEnabledPreference(): boolean {
  return loadBoolean(STORAGE_ALERT_ENABLED_KEY, false);
}

export function saveAlertEnabledPreference(enabled: unknown): void {
  saveBoolean(STORAGE_ALERT_ENABLED_KEY, enabled);
}

export function loadAlertLimitPreference(): number {
  return loadNumber(STORAGE_ALERT_LIMIT_KEY, DEFAULT_ALERT_LIMIT_MS, {
    validate: (value) => value > 0,
  });
}

export function saveAlertLimitPreference(limitMs: number): void {
  saveNumber(STORAGE_ALERT_LIMIT_KEY, limitMs);
}

export function loadAlertSoundEnabledPreference(): boolean {
  return loadBoolean(STORAGE_ALERT_SOUND_ENABLED_KEY, true);
}

export function saveAlertSoundEnabledPreference(enabled: unknown): void {
  saveBoolean(STORAGE_ALERT_SOUND_ENABLED_KEY, enabled);
}

export function loadAudioMutedPreference(): boolean {
  return loadBoolean(STORAGE_AUDIO_MUTED_KEY, false);
}

export function saveAudioMutedPreference(muted: unknown): void {
  saveBoolean(STORAGE_AUDIO_MUTED_KEY, muted);
}

export function getTrapAlertPresets(unit: DistanceUnit): TrapAlertPreset[] {
  return TRAP_ALERT_PRESETS[unit];
}

export function getDefaultTrapAlertDistanceM(unit: DistanceUnit): number {
  const presets = getTrapAlertPresets(unit);
  return presets[Math.min(1, presets.length - 1)]?.meters ?? 500;
}

export function normalizeTrapAlertDistance(distanceM: number, unit: DistanceUnit): number {
  const presets = getTrapAlertPresets(unit);
  let closestDistance = presets[0]?.meters ?? getDefaultTrapAlertDistanceM(unit);
  let smallestDifference = Number.POSITIVE_INFINITY;

  for (const preset of presets) {
    const difference = Math.abs(preset.meters - distanceM);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      closestDistance = preset.meters;
    }
  }

  return closestDistance;
}

export function loadTrapAlertEnabledPreference(): boolean {
  return loadBoolean(STORAGE_TRAP_ALERT_ENABLED_KEY, true);
}

export function saveTrapAlertEnabledPreference(enabled: unknown): void {
  saveBoolean(STORAGE_TRAP_ALERT_ENABLED_KEY, enabled);
}

export function loadTrapAlertDistancePreference(unit: DistanceUnit): number {
  const value = loadNumber(STORAGE_TRAP_ALERT_DISTANCE_KEY, getDefaultTrapAlertDistanceM(unit), {
    validate: (distance) => distance > 0,
  });
  return normalizeTrapAlertDistance(value, unit);
}

export function saveTrapAlertDistancePreference(distanceM: number): void {
  saveNumber(STORAGE_TRAP_ALERT_DISTANCE_KEY, distanceM);
}

export function loadTrapSoundEnabledPreference(): boolean {
  return loadBoolean(STORAGE_TRAP_SOUND_ENABLED_KEY, true);
}

export function saveTrapSoundEnabledPreference(enabled: unknown): void {
  saveBoolean(STORAGE_TRAP_SOUND_ENABLED_KEY, enabled);
}

export function normalizeCameraApproachFallbackMode(value: unknown): CameraApproachFallbackMode {
  const mode = String(value || '').trim();
  return CAMERA_APPROACH_FALLBACK_MODES.has(mode as CameraApproachFallbackMode)
    ? mode as CameraApproachFallbackMode
    : 'legacy-radius';
}

export function loadCameraApproachFallbackModePreference(): CameraApproachFallbackMode {
  return normalizeCameraApproachFallbackMode(
    loadText(STORAGE_CAMERA_APPROACH_FALLBACK_MODE_KEY, 'legacy-radius')
  );
}

export function saveCameraApproachFallbackModePreference(mode: unknown): void {
  saveText(STORAGE_CAMERA_APPROACH_FALLBACK_MODE_KEY, normalizeCameraApproachFallbackMode(mode));
}

export function loadCameraApproachHeadingTolerancePreference(): number {
  return loadNumber(
    STORAGE_CAMERA_APPROACH_HEADING_TOLERANCE_KEY,
    DEFAULT_CAMERA_APPROACH_HEADING_TOLERANCE_DEG,
    { validate: (value) => value >= 10 && value <= 90 },
  );
}

export function saveCameraApproachHeadingTolerancePreference(degrees: number): void {
  saveNumber(STORAGE_CAMERA_APPROACH_HEADING_TOLERANCE_KEY, degrees);
}

export function loadCameraApproachMinimumSpeedPreference(): number {
  return loadNumber(
    STORAGE_CAMERA_APPROACH_MINIMUM_SPEED_KEY,
    DEFAULT_CAMERA_APPROACH_MINIMUM_SPEED_MS,
    { validate: (value) => value >= 0 && value <= 15 },
  );
}

export function saveCameraApproachMinimumSpeedPreference(speedMs: number): void {
  saveNumber(STORAGE_CAMERA_APPROACH_MINIMUM_SPEED_KEY, speedMs);
}

export function loadCameraApproachOptionsPreference(): CameraApproachOptions {
  return {
    fallbackMode: loadCameraApproachFallbackModePreference(),
    headingToleranceDeg: loadCameraApproachHeadingTolerancePreference(),
    minimumSpeedMs: loadCameraApproachMinimumSpeedPreference(),
  };
}

export function loadAlertTriggerDiscoveredPreference(): boolean {
  return loadBoolean(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY, false);
}

export function saveAlertTriggerDiscoveredPreference(discovered: unknown): void {
  saveBoolean(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY, discovered);
}

export function loadInitialPreferences(): SpeedPreferences {
  const unit = loadUnitPreference();
  const distanceUnit = loadDistanceUnitPreference();

  return {
    unit,
    distanceUnit,
    primaryView: loadPrimaryViewPreference(),
    alertEnabled: loadAlertEnabledPreference(),
    alertLimitMs: loadAlertLimitPreference(),
    alertSoundEnabled: loadAlertSoundEnabledPreference(),
    audioMuted: loadAudioMutedPreference(),
    trapAlertEnabled: loadTrapAlertEnabledPreference(),
    trapAlertDistanceM: loadTrapAlertDistancePreference(distanceUnit),
    trapSoundEnabled: loadTrapSoundEnabledPreference(),
    cameraApproachOptions: loadCameraApproachOptionsPreference(),
    alertTriggerDiscovered: loadAlertTriggerDiscoveredPreference(),
  };
}

export function getAlertConfig(unit: SpeedUnit): AlertConfig {
  return ALERT_CONFIG[unit];
}
