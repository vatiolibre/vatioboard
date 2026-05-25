import { createIndexedJsonKeyValueStore } from '../shared/indexed-storage.js';
import { normalizePlace } from '../shared/place-resolver.js';
import { buildRouteBoundaryPlaceDisplay } from '../shared/route-boundary.js';
import { createStorageCapability } from '../shared/storage-capability.js';
import { loadJson, loadText, removeStoredValue, saveJson } from '../shared/storage.js';
import { loadConfiguredDistanceUnit, loadConfiguredSpeedUnit } from '../shared/unit-bootstrap.js';
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
} from './constants.js';
import type { JsonValue } from '../types/storage';
import {
  buildResultSpeedTrace,
  isFiniteNumber,
  normalizeStoredPartials,
  normalizeStoredSampleLog,
  normalizeStoredSpeedTrace,
  toFiniteNumber,
} from './logic.js';
import {
  buildComparisonSignature,
  findPresetDefinition,
  getCustomPresetSignature,
} from './presets.js';

export type AccelSpeedUnit = 'mph' | 'kmh';
export type AccelDistanceUnit = 'ft' | 'm';

type UnknownRecord = Record<string, unknown>;

export interface AccelSettings {
  selectedPresetId: string;
  rolloutEnabled: boolean;
  launchThresholdMs: number;
  speedUnit: AccelSpeedUnit;
  distanceUnit: AccelDistanceUnit;
  customStart: number;
  customEnd: number;
  notes: string;
}

export interface AccelBoundaryPlace {
  label: string;
  detail?: string;
  raw?: unknown;
  [key: string]: unknown;
}

export interface AccelSpeedTracePoint {
  elapsedMs: number;
  speedMs: number;
  distanceM?: number | null;
  altitudeM?: number | null;
  accuracyM?: number | null;
  speedSource?: string | null;
  [key: string]: unknown;
}

export interface AccelSampleLogEntry {
  index: number;
  stage: string;
  deltaMs: number | null;
  effectiveHz: number | null;
  latitude: number | null;
  longitude: number | null;
  rawSpeedMs: number | null;
  derivedSpeedMs: number | null;
  speedMs: number | null;
  speedSource: string;
  headingDeg: number | null;
  accuracyM: number | null;
  altitudeM: number | null;
  distanceFromStartM: number | null;
  elapsedFromStartMs: number | null;
  stale: boolean;
  sparse: boolean;
  [key: string]: unknown;
}

export interface AccelDistancePartial {
  id: string;
  kind: 'distance';
  labelKey: string;
  distanceM: number;
  showTrapSpeed: boolean;
  elapsedMs: number | null;
  trapSpeedMs: number | null;
  [key: string]: unknown;
}

export interface AccelSpeedPartial {
  id: string;
  kind: 'speed';
  labelKey: string;
  startSpeedMs: number;
  targetSpeedMs: number;
  elapsedMs: number | null;
  [key: string]: unknown;
}

export type AccelStoredPartial = AccelDistancePartial | AccelSpeedPartial;

export interface AccelStoredRun {
  id: string;
  savedAtMs: number;
  presetId: string;
  presetSignature: string;
  comparisonSignature: string;
  presetKind: string;
  standingStart: boolean;
  customStart: number | null;
  customEnd: number | null;
  customUnit: AccelSpeedUnit | null;
  startSpeedMs: number;
  targetSpeedMs: number | null;
  distanceTargetM: number | null;
  displayUnit: AccelSpeedUnit;
  distanceDisplay: AccelDistanceUnit;
  elapsedMs: number;
  speedTrace: AccelSpeedTracePoint[];
  sampleLog: AccelSampleLogEntry[];
  partials: AccelStoredPartial[];
  finishSpeedMs: number | null;
  trapSpeedMs: number | null;
  rolloutApplied: boolean;
  launchThresholdMs: number | null;
  rolloutDistanceM: number | null;
  averageAccuracyM: number | null;
  runDistanceM: number | null;
  finishDistanceM: number | null;
  startAccuracyM: number | null;
  startAltitudeM: number | null;
  finishAltitudeM: number | null;
  elevationDeltaM: number | null;
  slopePercent: number | null;
  averageHz: number | null;
  averageIntervalMs: number | null;
  jitterMs: number | null;
  qualityGrade: string;
  qualityScore: number;
  warningKeys: unknown[];
  sampleCount: number;
  sparseCount: number;
  staleCount: number;
  nullSpeedCount: number;
  derivedSpeedCount: number;
  speedSource: string;
  startSpeedSource: string | null;
  notes: string;
  startPlace: AccelBoundaryPlace | null;
  endPlace: AccelBoundaryPlace | null;
  [key: string]: unknown;
}

export interface AccelPayloadCompleteness {
  hasSampleLogPayload: boolean;
  hasSpeedTracePayload: boolean;
  payloadComplete: boolean;
  canOpen: boolean;
}

export interface AccelPayloadCompletenessOptions {
  minPoints?: number;
}

export interface ImportRunOptions extends AccelPayloadCompletenessOptions {
  maxRuns?: number;
}

const ACCEL_DB_NAME = 'vatio-accel-storage';
const ACCEL_DB_VERSION = 1;

function normalizeBoundaryPlace(place: unknown): AccelBoundaryPlace | null {
  if (!place || typeof place !== 'object') return null;
  const record = place as UnknownRecord;
  if (typeof record.label === 'string' && record.raw && typeof record.raw === 'object') {
    return {
      label: record.label.trim(),
      detail: typeof record.detail === 'string' ? record.detail.trim() : '',
      raw: normalizePlace(record.raw),
    };
  }
  const legacy = normalizePlace(place);
  if (!legacy) return null;
  return buildRouteBoundaryPlaceDisplay(legacy) as AccelBoundaryPlace;
}
const ACCEL_DB_STORE = 'accelRecords';
const ACCEL_STORAGE_KEYS = [STORAGE_KEYS.settings, STORAGE_KEYS.runs];

const accelStore = createIndexedJsonKeyValueStore({
  dbName: ACCEL_DB_NAME,
  dbVersion: ACCEL_DB_VERSION,
  storeName: ACCEL_DB_STORE,
});
const accelStorageCapability = createStorageCapability({
  namespace: 'accel-storage',
  store: accelStore,
});

let accelMigrationPromise: Promise<void> | null = null;
let settingsSavePromise: Promise<unknown> = Promise.resolve();
let runsSavePromise: Promise<unknown> = Promise.resolve();

export function getAccelStorageCapability() {
  return accelStorageCapability;
}

export function loadSharedSpeedUnitPreference(): AccelSpeedUnit | null {
  const unit = loadText(SHARED_SPEED_UNIT_KEY, '');
  return unit && SPEED_UNIT_CONFIG[unit] ? unit as AccelSpeedUnit : null;
}

export function loadSharedDistanceUnitPreference(): AccelDistanceUnit | null {
  const unit = loadText(SHARED_DISTANCE_UNIT_KEY, '');
  if (unit && DISTANCE_UNIT_CONFIG[unit]) return unit as AccelDistanceUnit;

  const legacyUnit = loadText(SHARED_LEGACY_ALTITUDE_UNIT_KEY, '');
  return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit] ? legacyUnit as AccelDistanceUnit : null;
}

export function getDefaultSpeedUnit(selectedPresetId?: unknown): AccelSpeedUnit {
  const sharedUnit = loadConfiguredSpeedUnit(null) ?? loadSharedSpeedUnitPreference();
  if (sharedUnit) return sharedUnit as AccelSpeedUnit;
  const preset = findPresetDefinition(selectedPresetId);
  if (preset && preset.speedSystem) return preset.speedSystem as AccelSpeedUnit;
  return 'mph';
}

export function getDefaultDistanceUnit(selectedPresetId?: unknown): AccelDistanceUnit {
  const sharedUnit = loadConfiguredDistanceUnit(null) ?? loadSharedDistanceUnitPreference();
  if (sharedUnit) return sharedUnit as AccelDistanceUnit;
  const preset = findPresetDefinition(selectedPresetId);
  if (preset && preset.distanceSystem) return preset.distanceSystem as AccelDistanceUnit;
  return 'ft';
}

function normalizeSettings(raw: unknown): AccelSettings {
  const settings = raw && typeof raw === 'object' ? raw as UnknownRecord : {};
  const selectedPresetId =
    typeof settings.selectedPresetId === 'string'
      ? settings.selectedPresetId
      : defaultSettings.selectedPresetId;
  const speedUnit = normalizeSpeedUnit(
    settings.speedUnit || settings.customUnit || getDefaultSpeedUnit(selectedPresetId)
  );
  const distanceUnit = normalizeDistanceUnit(
    settings.distanceUnit || getDefaultDistanceUnit(selectedPresetId)
  );
  const defaultCustomEnd = speedUnit === 'kmh' ? 100 : defaultSettings.customEnd;
  const launchThresholdMs = isFiniteNumber(settings.launchThresholdMs)
    ? settings.launchThresholdMs
    : (settings.launchThresholdMph === 1 ? 1 : 0.5) * MPH_TO_MS;

  return {
    selectedPresetId,
    rolloutEnabled: Boolean(settings.rolloutEnabled),
    launchThresholdMs: launchThresholdMs as number,
    speedUnit: speedUnit as AccelSpeedUnit,
    distanceUnit: distanceUnit as AccelDistanceUnit,
    customStart: toFiniteNumber(settings.customStart, defaultSettings.customStart) as number,
    customEnd: toFiniteNumber(settings.customEnd, defaultCustomEnd) as number,
    notes: typeof settings.notes === 'string' ? settings.notes : '',
  };
}

function cloneJsonValue<T>(value: T, fallback: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return fallback;
  }
}

function queuePersistence<T>(previousPromise: Promise<unknown>, task: () => Promise<T>): Promise<T> {
  return previousPromise.catch(() => {}).then(task);
}

async function migrateLegacyAccelStorage(): Promise<void> {
  if (!(await accelStorageCapability.isIndexedDbUsable())) return;

  if (!accelMigrationPromise) {
    accelMigrationPromise = (async () => {
      const database = await accelStore.openDatabase();
      if (!database) return;

      for (const storageKey of ACCEL_STORAGE_KEYS) {
        const existingValue = await accelStore.getValue(storageKey);
        if (existingValue !== undefined) continue;

        const legacyValue = loadJson(storageKey, undefined);
        if (legacyValue === undefined) continue;

        const stored = await accelStore.setValue(storageKey, legacyValue as JsonValue);
        if (stored) {
          removeStoredValue(storageKey);
        }
      }
    })();
  }

  return accelMigrationPromise;
}

async function loadAccelValue(key: string, fallback: unknown): Promise<unknown> {
  await migrateLegacyAccelStorage();

  const indexedValue = await accelStore.getValue(key);
  if (indexedValue !== undefined) return indexedValue;

  return loadJson(key, fallback);
}

async function saveAccelValue(key: string, value: unknown): Promise<void> {
  await migrateLegacyAccelStorage();

  const stored = await accelStore.setValue(key, value as JsonValue);
  if (stored) {
    removeStoredValue(key);
    return;
  }

  saveJson(key, value);
}

export function createDefaultSettings(): AccelSettings {
  return normalizeSettings(null);
}

export async function loadSettings(): Promise<AccelSettings> {
  return normalizeSettings(await loadAccelValue(STORAGE_KEYS.settings, null));
}

export function saveSettings(settings: AccelSettings | Partial<AccelSettings>): Promise<unknown> {
  const snapshot = cloneJsonValue(settings, createDefaultSettings());
  settingsSavePromise = queuePersistence(settingsSavePromise, () =>
    saveAccelValue(STORAGE_KEYS.settings, snapshot)
  );
  return settingsSavePromise;
}

export function normalizeStoredRun(run: unknown): AccelStoredRun | null {
  if (!run || typeof run !== 'object') return null;
  const record = run as UnknownRecord;
  if (!isFiniteNumber(record.savedAtMs) || !isFiniteNumber(record.elapsedMs)) return null;

  const presetId = typeof record.presetId === 'string' ? record.presetId : 'custom';
  const startSpeedMs = isFiniteNumber(record.startSpeedMs) ? record.startSpeedMs : 0;
  const targetSpeedMs = isFiniteNumber(record.targetSpeedMs) ? record.targetSpeedMs : null;
  const presetKind = typeof record.presetKind === 'string' ? record.presetKind : 'speed';
  const sampleLog = normalizeStoredSampleLog(record.sampleLog);
  const partials = normalizeStoredPartials(record.partials);
  const finishSpeedMs = isFiniteNumber(record.finishSpeedMs)
    ? record.finishSpeedMs
    : isFiniteNumber(record.trapSpeedMs)
      ? record.trapSpeedMs
      : presetKind === 'speed' && isFiniteNumber(targetSpeedMs)
        ? targetSpeedMs
        : null;
  let presetSignature = typeof record.presetSignature === 'string' ? record.presetSignature : presetId;
  let comparisonSignature =
    typeof record.comparisonSignature === 'string'
      ? record.comparisonSignature
      : buildComparisonSignature({
          presetId,
          presetSignature,
          startSpeedMs,
          targetSpeedMs,
        });

  if (presetId === 'custom' && isFiniteNumber(startSpeedMs) && isFiniteNumber(targetSpeedMs)) {
    presetSignature = getCustomPresetSignature(startSpeedMs, targetSpeedMs);
  }

  const normalizedRun = {
    id: typeof record.id === 'string' ? record.id : `run-${String(record.savedAtMs)}`,
    savedAtMs: record.savedAtMs,
    presetId,
    presetSignature,
    comparisonSignature,
    presetKind,
    standingStart: Boolean(record.standingStart),
    customStart: isFiniteNumber(record.customStart) ? record.customStart : null,
    customEnd: isFiniteNumber(record.customEnd) ? record.customEnd : null,
    customUnit: record.customUnit === 'kmh' ? 'kmh' : record.customUnit === 'mph' ? 'mph' : null,
    startSpeedMs,
    targetSpeedMs,
    distanceTargetM: isFiniteNumber(record.distanceTargetM) ? record.distanceTargetM : null,
    displayUnit: record.displayUnit === 'kmh' ? 'kmh' : 'mph',
    distanceDisplay: record.distanceDisplay === 'm' ? 'm' : 'ft',
    elapsedMs: record.elapsedMs,
    speedTrace: [],
    sampleLog,
    partials,
    finishSpeedMs,
    trapSpeedMs: isFiniteNumber(record.trapSpeedMs) ? record.trapSpeedMs : null,
    rolloutApplied: Boolean(record.rolloutApplied),
    launchThresholdMs: isFiniteNumber(record.launchThresholdMs) ? record.launchThresholdMs : null,
    rolloutDistanceM: isFiniteNumber(record.rolloutDistanceM) ? record.rolloutDistanceM : null,
    averageAccuracyM: isFiniteNumber(record.averageAccuracyM) ? record.averageAccuracyM : null,
    runDistanceM: isFiniteNumber(record.runDistanceM) ? record.runDistanceM : null,
    finishDistanceM: isFiniteNumber(record.finishDistanceM) ? record.finishDistanceM : null,
    startAccuracyM: isFiniteNumber(record.startAccuracyM) ? record.startAccuracyM : null,
    startAltitudeM: isFiniteNumber(record.startAltitudeM) ? record.startAltitudeM : null,
    finishAltitudeM: isFiniteNumber(record.finishAltitudeM) ? record.finishAltitudeM : null,
    elevationDeltaM: isFiniteNumber(record.elevationDeltaM) ? record.elevationDeltaM : null,
    slopePercent: isFiniteNumber(record.slopePercent) ? record.slopePercent : null,
    averageHz: isFiniteNumber(record.averageHz) ? record.averageHz : null,
    averageIntervalMs: isFiniteNumber(record.averageIntervalMs) ? record.averageIntervalMs : null,
    jitterMs: isFiniteNumber(record.jitterMs) ? record.jitterMs : null,
    qualityGrade: typeof record.qualityGrade === 'string' ? record.qualityGrade : 'invalid',
    qualityScore: isFiniteNumber(record.qualityScore) ? record.qualityScore : 0,
    warningKeys: Array.isArray(record.warningKeys) ? record.warningKeys.slice(0, 8) : [],
    sampleCount: isFiniteNumber(record.sampleCount) ? record.sampleCount : 0,
    sparseCount: isFiniteNumber(record.sparseCount) ? record.sparseCount : 0,
    staleCount: isFiniteNumber(record.staleCount) ? record.staleCount : 0,
    nullSpeedCount: isFiniteNumber(record.nullSpeedCount) ? record.nullSpeedCount : 0,
    derivedSpeedCount: isFiniteNumber(record.derivedSpeedCount) ? record.derivedSpeedCount : 0,
    speedSource: typeof record.speedSource === 'string' ? record.speedSource : 'reported',
    startSpeedSource: typeof record.startSpeedSource === 'string' ? record.startSpeedSource : null,
    notes: typeof record.notes === 'string' ? record.notes : '',
    startPlace: normalizeBoundaryPlace(record.startPlace),
    endPlace: normalizeBoundaryPlace(record.endPlace),
  } as AccelStoredRun;

  normalizedRun.speedTrace = sampleLog.length
    ? buildResultSpeedTrace(normalizedRun, normalizedRun.elapsedMs)
    : normalizeStoredSpeedTrace(record.speedTrace, record.elapsedMs);

  comparisonSignature = normalizedRun.comparisonSignature;
  if (!comparisonSignature) {
    normalizedRun.comparisonSignature = buildComparisonSignature(normalizedRun);
  }

  return normalizedRun;
}

export function getAccelPayloadCompleteness(
  run: unknown,
  { minPoints = 2 }: AccelPayloadCompletenessOptions = {},
): AccelPayloadCompleteness {
  const normalizedRun = normalizeStoredRun(run);
  const requiredPoints = Math.max(1, Math.round(Number(minPoints) || 2));
  const hasSampleLogPayload = Boolean(
    normalizedRun
    && Array.isArray(normalizedRun.sampleLog)
    && normalizedRun.sampleLog.length >= requiredPoints
  );
  const hasSpeedTracePayload = Boolean(
    normalizedRun
    && Array.isArray(normalizedRun.speedTrace)
    && normalizedRun.speedTrace.length >= requiredPoints
  );
  const payloadComplete = hasSampleLogPayload || hasSpeedTracePayload;

  return {
    hasSampleLogPayload,
    hasSpeedTracePayload,
    payloadComplete,
    canOpen: payloadComplete,
  };
}

export function isAccelPayloadComplete(
  run: unknown,
  options: AccelPayloadCompletenessOptions = {},
): boolean {
  return getAccelPayloadCompleteness(run, options).payloadComplete;
}

export async function loadRuns(): Promise<AccelStoredRun[]> {
  const raw = await loadAccelValue(STORAGE_KEYS.runs, null);
  if (!Array.isArray(raw)) return [];

  const runs: AccelStoredRun[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const run = normalizeStoredRun(raw[index]);
    if (run) runs.push(run);
  }

  runs.sort((left, right) => right.savedAtMs - left.savedAtMs);
  return runs.slice(0, MAX_RUNS);
}

export function saveRuns(runs: unknown): Promise<unknown> {
  const snapshot = cloneJsonValue(Array.isArray(runs) ? runs.slice(0, MAX_RUNS) : [], []);
  runsSavePromise = queuePersistence(runsSavePromise, () =>
    saveAccelValue(STORAGE_KEYS.runs, snapshot)
  );
  return runsSavePromise;
}

export async function importRun(
  run: unknown,
  options: ImportRunOptions = {},
): Promise<AccelStoredRun | null> {
  const normalizedRun = normalizeStoredRun(run);
  if (!normalizedRun || !isAccelPayloadComplete(normalizedRun, options)) {
    return null;
  }

  const nextRuns = (await loadRuns()).filter((entry) => entry.id !== normalizedRun.id);
  nextRuns.unshift(normalizedRun);
  await saveRuns(nextRuns.slice(0, options.maxRuns ?? MAX_RUNS));
  return normalizedRun;
}
