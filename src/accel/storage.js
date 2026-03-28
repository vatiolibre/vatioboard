import { createIndexedJsonKeyValueStore } from "../shared/indexed-storage.js";
import { loadJson, loadText, removeStoredValue, saveJson } from "../shared/storage.js";
import {
  DISTANCE_UNIT_CONFIG,
  MAX_RUNS,
  MPH_TO_MS,
  SHARED_DISTANCE_UNIT_KEY,
  SHARED_LEGACY_ALTITUDE_UNIT_KEY,
  SHARED_SPEED_UNIT_KEY,
  SPEED_UNIT_CONFIG,
  STORAGE_KEYS,
  defaultSettings,
  normalizeDistanceUnit,
  normalizeSpeedUnit,
} from "./constants.js";
import {
  buildResultSpeedTrace,
  isFiniteNumber,
  normalizeStoredPartials,
  normalizeStoredSampleLog,
  normalizeStoredSpeedTrace,
  toFiniteNumber,
} from "./logic.js";
import {
  buildComparisonSignature,
  findPresetDefinition,
  getCustomPresetSignature,
} from "./presets.js";

const ACCEL_DB_NAME = "vatio-accel-storage";
const ACCEL_DB_VERSION = 1;
const ACCEL_DB_STORE = "accelRecords";
const ACCEL_STORAGE_KEYS = [
  STORAGE_KEYS.settings,
  STORAGE_KEYS.runs,
];

const accelStore = createIndexedJsonKeyValueStore({
  dbName: ACCEL_DB_NAME,
  dbVersion: ACCEL_DB_VERSION,
  storeName: ACCEL_DB_STORE,
});

let accelMigrationPromise = null;
let settingsSavePromise = Promise.resolve();
let runsSavePromise = Promise.resolve();

export function loadSharedSpeedUnitPreference() {
  const unit = loadText(SHARED_SPEED_UNIT_KEY, "");
  return unit && SPEED_UNIT_CONFIG[unit] ? unit : null;
}

export function loadSharedDistanceUnitPreference() {
  const unit = loadText(SHARED_DISTANCE_UNIT_KEY, "");
  if (unit && DISTANCE_UNIT_CONFIG[unit]) return unit;

  const legacyUnit = loadText(SHARED_LEGACY_ALTITUDE_UNIT_KEY, "");
  return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit] ? legacyUnit : null;
}

export function getDefaultSpeedUnit(selectedPresetId) {
  const sharedUnit = loadSharedSpeedUnitPreference();
  if (sharedUnit) return sharedUnit;
  const preset = findPresetDefinition(selectedPresetId);
  if (preset && preset.speedSystem) return preset.speedSystem;
  return "mph";
}

export function getDefaultDistanceUnit(selectedPresetId) {
  const sharedUnit = loadSharedDistanceUnitPreference();
  if (sharedUnit) return sharedUnit;
  const preset = findPresetDefinition(selectedPresetId);
  if (preset && preset.distanceSystem) return preset.distanceSystem;
  return "ft";
}

function normalizeSettings(raw) {
  const settings = raw && typeof raw === "object" ? raw : {};
  const selectedPresetId = typeof settings.selectedPresetId === "string" ? settings.selectedPresetId : defaultSettings.selectedPresetId;
  const speedUnit = normalizeSpeedUnit(settings.speedUnit || settings.customUnit || getDefaultSpeedUnit(selectedPresetId));
  const distanceUnit = normalizeDistanceUnit(settings.distanceUnit || getDefaultDistanceUnit(selectedPresetId));
  const defaultCustomEnd = speedUnit === "kmh" ? 100 : defaultSettings.customEnd;
  const launchThresholdMs = isFiniteNumber(settings.launchThresholdMs)
    ? settings.launchThresholdMs
    : ((settings.launchThresholdMph === 1 ? 1 : 0.5) * MPH_TO_MS);

  return {
    selectedPresetId,
    rolloutEnabled: Boolean(settings.rolloutEnabled),
    launchThresholdMs,
    speedUnit,
    distanceUnit,
    customStart: toFiniteNumber(settings.customStart, defaultSettings.customStart),
    customEnd: toFiniteNumber(settings.customEnd, defaultCustomEnd),
    notes: typeof settings.notes === "string" ? settings.notes : "",
  };
}

function cloneJsonValue(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function queuePersistence(previousPromise, task) {
  return previousPromise
    .catch(() => {})
    .then(task);
}

async function migrateLegacyAccelStorage() {
  if (!accelStore.hasSupport()) return;

  if (!accelMigrationPromise) {
    accelMigrationPromise = (async () => {
      const database = await accelStore.openDatabase();
      if (!database) return;

      for (const storageKey of ACCEL_STORAGE_KEYS) {
        const existingValue = await accelStore.getValue(storageKey);
        if (existingValue !== undefined) continue;

        const legacyValue = loadJson(storageKey, undefined);
        if (legacyValue === undefined) continue;

        const stored = await accelStore.setValue(storageKey, legacyValue);
        if (stored) {
          removeStoredValue(storageKey);
        }
      }
    })();
  }

  return accelMigrationPromise;
}

async function loadAccelValue(key, fallback) {
  await migrateLegacyAccelStorage();

  const indexedValue = await accelStore.getValue(key);
  if (indexedValue !== undefined) return indexedValue;

  return loadJson(key, fallback);
}

async function saveAccelValue(key, value) {
  await migrateLegacyAccelStorage();

  const stored = await accelStore.setValue(key, value);
  if (stored) {
    removeStoredValue(key);
    return;
  }

  saveJson(key, value);
}

export function createDefaultSettings() {
  return normalizeSettings(null);
}

export async function loadSettings() {
  return normalizeSettings(await loadAccelValue(STORAGE_KEYS.settings, null));
}

export function saveSettings(settings) {
  const snapshot = cloneJsonValue(settings, createDefaultSettings());
  settingsSavePromise = queuePersistence(settingsSavePromise, () => saveAccelValue(STORAGE_KEYS.settings, snapshot));
  return settingsSavePromise;
}

export function normalizeStoredRun(run) {
  if (!run || typeof run !== "object") return null;
  if (!isFiniteNumber(run.savedAtMs) || !isFiniteNumber(run.elapsedMs)) return null;

  const presetId = typeof run.presetId === "string" ? run.presetId : "custom";
  const startSpeedMs = isFiniteNumber(run.startSpeedMs) ? run.startSpeedMs : 0;
  const targetSpeedMs = isFiniteNumber(run.targetSpeedMs) ? run.targetSpeedMs : null;
  const presetKind = typeof run.presetKind === "string" ? run.presetKind : "speed";
  const sampleLog = normalizeStoredSampleLog(run.sampleLog);
  const partials = normalizeStoredPartials(run.partials);
  const finishSpeedMs = isFiniteNumber(run.finishSpeedMs)
    ? run.finishSpeedMs
    : (isFiniteNumber(run.trapSpeedMs)
      ? run.trapSpeedMs
      : (presetKind === "speed" && isFiniteNumber(targetSpeedMs) ? targetSpeedMs : null));
  let presetSignature = typeof run.presetSignature === "string" ? run.presetSignature : presetId;
  let comparisonSignature = typeof run.comparisonSignature === "string"
    ? run.comparisonSignature
    : buildComparisonSignature({
      presetId,
      presetSignature,
      startSpeedMs,
      targetSpeedMs,
    });

  if (presetId === "custom" && isFiniteNumber(startSpeedMs) && isFiniteNumber(targetSpeedMs)) {
    presetSignature = getCustomPresetSignature(startSpeedMs, targetSpeedMs);
  }

  const normalizedRun = {
    id: typeof run.id === "string" ? run.id : `run-${String(run.savedAtMs)}`,
    savedAtMs: run.savedAtMs,
    presetId,
    presetSignature,
    comparisonSignature,
    presetKind,
    standingStart: Boolean(run.standingStart),
    customStart: isFiniteNumber(run.customStart) ? run.customStart : null,
    customEnd: isFiniteNumber(run.customEnd) ? run.customEnd : null,
    customUnit: run.customUnit === "kmh" ? "kmh" : (run.customUnit === "mph" ? "mph" : null),
    startSpeedMs,
    targetSpeedMs,
    distanceTargetM: isFiniteNumber(run.distanceTargetM) ? run.distanceTargetM : null,
    displayUnit: run.displayUnit === "kmh" ? "kmh" : "mph",
    distanceDisplay: run.distanceDisplay === "m" ? "m" : "ft",
    elapsedMs: run.elapsedMs,
    speedTrace: [],
    sampleLog,
    partials,
    finishSpeedMs,
    trapSpeedMs: isFiniteNumber(run.trapSpeedMs) ? run.trapSpeedMs : null,
    rolloutApplied: Boolean(run.rolloutApplied),
    launchThresholdMs: isFiniteNumber(run.launchThresholdMs) ? run.launchThresholdMs : null,
    rolloutDistanceM: isFiniteNumber(run.rolloutDistanceM) ? run.rolloutDistanceM : null,
    averageAccuracyM: isFiniteNumber(run.averageAccuracyM) ? run.averageAccuracyM : null,
    runDistanceM: isFiniteNumber(run.runDistanceM) ? run.runDistanceM : null,
    finishDistanceM: isFiniteNumber(run.finishDistanceM) ? run.finishDistanceM : null,
    startAccuracyM: isFiniteNumber(run.startAccuracyM) ? run.startAccuracyM : null,
    startAltitudeM: isFiniteNumber(run.startAltitudeM) ? run.startAltitudeM : null,
    finishAltitudeM: isFiniteNumber(run.finishAltitudeM) ? run.finishAltitudeM : null,
    elevationDeltaM: isFiniteNumber(run.elevationDeltaM) ? run.elevationDeltaM : null,
    slopePercent: isFiniteNumber(run.slopePercent) ? run.slopePercent : null,
    averageHz: isFiniteNumber(run.averageHz) ? run.averageHz : null,
    averageIntervalMs: isFiniteNumber(run.averageIntervalMs) ? run.averageIntervalMs : null,
    jitterMs: isFiniteNumber(run.jitterMs) ? run.jitterMs : null,
    qualityGrade: typeof run.qualityGrade === "string" ? run.qualityGrade : "invalid",
    qualityScore: isFiniteNumber(run.qualityScore) ? run.qualityScore : 0,
    warningKeys: Array.isArray(run.warningKeys) ? run.warningKeys.slice(0, 8) : [],
    sampleCount: isFiniteNumber(run.sampleCount) ? run.sampleCount : 0,
    sparseCount: isFiniteNumber(run.sparseCount) ? run.sparseCount : 0,
    staleCount: isFiniteNumber(run.staleCount) ? run.staleCount : 0,
    nullSpeedCount: isFiniteNumber(run.nullSpeedCount) ? run.nullSpeedCount : 0,
    derivedSpeedCount: isFiniteNumber(run.derivedSpeedCount) ? run.derivedSpeedCount : 0,
    speedSource: typeof run.speedSource === "string" ? run.speedSource : "reported",
    startSpeedSource: typeof run.startSpeedSource === "string" ? run.startSpeedSource : null,
    notes: typeof run.notes === "string" ? run.notes : "",
  };

  normalizedRun.speedTrace = sampleLog.length
    ? buildResultSpeedTrace(normalizedRun, normalizedRun.elapsedMs)
    : normalizeStoredSpeedTrace(run.speedTrace, run.elapsedMs);

  comparisonSignature = normalizedRun.comparisonSignature;
  if (!comparisonSignature) {
    normalizedRun.comparisonSignature = buildComparisonSignature(normalizedRun);
  }

  return normalizedRun;
}

export async function loadRuns() {
  const raw = await loadAccelValue(STORAGE_KEYS.runs, null);
  if (!Array.isArray(raw)) return [];

  const runs = [];
  for (let index = 0; index < raw.length; index += 1) {
    const run = normalizeStoredRun(raw[index]);
    if (run) runs.push(run);
  }

  runs.sort((left, right) => right.savedAtMs - left.savedAtMs);
  return runs.slice(0, MAX_RUNS);
}

export function saveRuns(runs) {
  const snapshot = cloneJsonValue(Array.isArray(runs) ? runs.slice(0, MAX_RUNS) : [], []);
  runsSavePromise = queuePersistence(runsSavePromise, () => saveAccelValue(STORAGE_KEYS.runs, snapshot));
  return runsSavePromise;
}
