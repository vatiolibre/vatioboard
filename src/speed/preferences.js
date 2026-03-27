import { loadBoolean, loadNumber, loadText, saveBoolean, saveNumber, saveText } from "../shared/storage.js";
import {
  ALERT_CONFIG,
  DEFAULT_ALERT_LIMIT_MS,
  DISTANCE_UNIT_CONFIG,
  LEGACY_STORAGE_ALTITUDE_UNIT_KEY,
  STORAGE_ALERT_ENABLED_KEY,
  STORAGE_ALERT_LIMIT_KEY,
  STORAGE_ALERT_SOUND_ENABLED_KEY,
  STORAGE_ALERT_TRIGGER_DISCOVERED_KEY,
  STORAGE_AUDIO_MUTED_KEY,
  STORAGE_BACKGROUND_AUDIO_ENABLED_KEY,
  STORAGE_DISTANCE_UNIT_KEY,
  STORAGE_PRIMARY_VIEW_KEY,
  STORAGE_TRAP_ALERT_DISTANCE_KEY,
  STORAGE_TRAP_ALERT_ENABLED_KEY,
  STORAGE_TRAP_SOUND_ENABLED_KEY,
  STORAGE_UNIT_KEY,
  TRAP_ALERT_PRESETS,
  UNIT_CONFIG,
} from "./constants.js";

export function loadUnitPreference() {
  const unit = loadText(STORAGE_UNIT_KEY, "");
  return unit && UNIT_CONFIG[unit] ? unit : "kmh";
}

export function saveUnitPreference(unit) {
  saveText(STORAGE_UNIT_KEY, unit);
}

export function loadDistanceUnitPreference() {
  const storedUnit = loadText(STORAGE_DISTANCE_UNIT_KEY, "");
  if (storedUnit && DISTANCE_UNIT_CONFIG[storedUnit]) {
    return storedUnit;
  }

  const legacyUnit = loadText(LEGACY_STORAGE_ALTITUDE_UNIT_KEY, "");
  return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit] ? legacyUnit : "m";
}

export function saveDistanceUnitPreference(unit) {
  saveText(STORAGE_DISTANCE_UNIT_KEY, unit);
}

export function loadPrimaryViewPreference() {
  return loadText(STORAGE_PRIMARY_VIEW_KEY, "") === "waze" ? "waze" : "gauge";
}

export function savePrimaryViewPreference(view) {
  saveText(STORAGE_PRIMARY_VIEW_KEY, view);
}

export function loadAlertEnabledPreference() {
  return loadBoolean(STORAGE_ALERT_ENABLED_KEY, false);
}

export function saveAlertEnabledPreference(enabled) {
  saveBoolean(STORAGE_ALERT_ENABLED_KEY, enabled);
}

export function loadAlertLimitPreference() {
  return loadNumber(STORAGE_ALERT_LIMIT_KEY, DEFAULT_ALERT_LIMIT_MS, {
    validate: (value) => value > 0,
  });
}

export function saveAlertLimitPreference(limitMs) {
  saveNumber(STORAGE_ALERT_LIMIT_KEY, limitMs);
}

export function loadAlertSoundEnabledPreference() {
  return loadBoolean(STORAGE_ALERT_SOUND_ENABLED_KEY, true);
}

export function saveAlertSoundEnabledPreference(enabled) {
  saveBoolean(STORAGE_ALERT_SOUND_ENABLED_KEY, enabled);
}

export function loadAudioMutedPreference() {
  return loadBoolean(STORAGE_AUDIO_MUTED_KEY, false);
}

export function saveAudioMutedPreference(muted) {
  saveBoolean(STORAGE_AUDIO_MUTED_KEY, muted);
}

export function loadBackgroundAudioEnabledPreference() {
  return loadBoolean(STORAGE_BACKGROUND_AUDIO_ENABLED_KEY, false);
}

export function saveBackgroundAudioEnabledPreference(enabled) {
  saveBoolean(STORAGE_BACKGROUND_AUDIO_ENABLED_KEY, enabled);
}

export function getTrapAlertPresets(unit) {
  return TRAP_ALERT_PRESETS[unit];
}

export function getDefaultTrapAlertDistanceM(unit) {
  const presets = getTrapAlertPresets(unit);
  return presets[Math.min(1, presets.length - 1)]?.meters ?? 500;
}

export function normalizeTrapAlertDistance(distanceM, unit) {
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

export function loadTrapAlertEnabledPreference() {
  return loadBoolean(STORAGE_TRAP_ALERT_ENABLED_KEY, true);
}

export function saveTrapAlertEnabledPreference(enabled) {
  saveBoolean(STORAGE_TRAP_ALERT_ENABLED_KEY, enabled);
}

export function loadTrapAlertDistancePreference(unit) {
  const value = loadNumber(STORAGE_TRAP_ALERT_DISTANCE_KEY, getDefaultTrapAlertDistanceM(unit), {
    validate: (distance) => distance > 0,
  });
  return normalizeTrapAlertDistance(value, unit);
}

export function saveTrapAlertDistancePreference(distanceM) {
  saveNumber(STORAGE_TRAP_ALERT_DISTANCE_KEY, distanceM);
}

export function loadTrapSoundEnabledPreference() {
  return loadBoolean(STORAGE_TRAP_SOUND_ENABLED_KEY, true);
}

export function saveTrapSoundEnabledPreference(enabled) {
  saveBoolean(STORAGE_TRAP_SOUND_ENABLED_KEY, enabled);
}

export function loadAlertTriggerDiscoveredPreference() {
  return loadBoolean(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY, false);
}

export function saveAlertTriggerDiscoveredPreference(discovered) {
  saveBoolean(STORAGE_ALERT_TRIGGER_DISCOVERED_KEY, discovered);
}

export function loadInitialPreferences() {
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
    backgroundAudioEnabled: loadBackgroundAudioEnabledPreference(),
    trapAlertEnabled: loadTrapAlertEnabledPreference(),
    trapAlertDistanceM: loadTrapAlertDistancePreference(distanceUnit),
    trapSoundEnabled: loadTrapSoundEnabledPreference(),
    alertTriggerDiscovered: loadAlertTriggerDiscoveredPreference(),
  };
}

export function normalizeInitialAudioPreferences(preferences) {
  if (!preferences.audioMuted || !preferences.backgroundAudioEnabled) {
    return {
      preferences,
      changed: false,
    };
  }

  return {
    preferences: {
      ...preferences,
      backgroundAudioEnabled: false,
    },
    changed: true,
  };
}

export function getAlertConfig(unit) {
  return ALERT_CONFIG[unit];
}
