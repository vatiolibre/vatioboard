import { SHARED_DISTANCE_UNIT_KEY, SHARED_SPEED_UNIT_KEY } from '../accel/constants.js';
import { hasStoredValue, loadJson, loadText, saveJson, saveText } from './storage.js';
import { normalizeCountryCode } from './place-resolver.js';

export const UNIT_BOOTSTRAP_KEY = 'vatio_unit_bootstrap_v1';

const IMPERIAL_COUNTRY_CODES = new Set([
  'as',
  'gb',
  'gg',
  'gu',
  'im',
  'je',
  'lr',
  'mm',
  'mp',
  'pr',
  'us',
  'vi',
]);

function normalizeSpeedUnit(value, fallback = 'kmh') {
  return value === 'mph' ? 'mph' : value === 'kmh' ? 'kmh' : fallback;
}

function normalizeDistanceUnit(value, fallback = 'm') {
  return value === 'ft' ? 'ft' : value === 'm' ? 'm' : fallback;
}

function normalizeTripDistanceUnit(value, fallback = 'km') {
  return value === 'mi' ? 'mi' : value === 'km' ? 'km' : fallback;
}

function inferTripDistanceUnit(speedUnit, distanceUnit) {
  if (speedUnit === 'mph' || distanceUnit === 'ft') return 'mi';
  return 'km';
}

function loadSharedSpeedUnit() {
  const unit = loadText(SHARED_SPEED_UNIT_KEY, '');
  return unit === 'mph' || unit === 'kmh' ? unit : null;
}

function loadSharedDistanceUnit() {
  const unit = loadText(SHARED_DISTANCE_UNIT_KEY, '');
  return unit === 'ft' || unit === 'm' ? unit : null;
}

export function loadConfiguredSpeedUnit(fallback = 'kmh') {
  const bootstrapUnit = loadUnitBootstrap()?.speedUnit;
  if (bootstrapUnit === 'mph' || bootstrapUnit === 'kmh') {
    return bootstrapUnit;
  }

  return normalizeSpeedUnit(loadSharedSpeedUnit(), fallback);
}

export function loadConfiguredDistanceUnit(fallback = 'm') {
  const bootstrapUnit = loadUnitBootstrap()?.distanceUnit;
  if (bootstrapUnit === 'ft' || bootstrapUnit === 'm') {
    return bootstrapUnit;
  }

  return normalizeDistanceUnit(loadSharedDistanceUnit(), fallback);
}

export function saveSharedUnitPreferences(partialConfig = {}) {
  if (partialConfig.speedUnit === 'mph' || partialConfig.speedUnit === 'kmh') {
    saveText(SHARED_SPEED_UNIT_KEY, partialConfig.speedUnit);
  }
  if (partialConfig.distanceUnit === 'ft' || partialConfig.distanceUnit === 'm') {
    saveText(SHARED_DISTANCE_UNIT_KEY, partialConfig.distanceUnit);
  }
}

export function hasConfiguredUnitPreferences() {
  return Boolean(
    loadUnitBootstrap() ||
    hasStoredValue(SHARED_SPEED_UNIT_KEY) ||
    hasStoredValue(SHARED_DISTANCE_UNIT_KEY)
  );
}

export function getRegionalUnitsForCountry(countryCode) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const useImperial = IMPERIAL_COUNTRY_CODES.has(normalizedCountryCode);

  return {
    speedUnit: useImperial ? 'mph' : 'kmh',
    distanceUnit: useImperial ? 'ft' : 'm',
    tripDistanceUnit: useImperial ? 'mi' : 'km',
  };
}

export function loadUnitBootstrap() {
  const stored = loadJson(UNIT_BOOTSTRAP_KEY, null);
  if (!stored || typeof stored !== 'object') return null;

  return {
    initializedAtMs: Number.isFinite(stored.initializedAtMs) ? stored.initializedAtMs : null,
    updatedAtMs: Number.isFinite(stored.updatedAtMs) ? stored.updatedAtMs : null,
    source:
      stored.source === 'manual' || stored.source === 'auto' || stored.source === 'existing'
        ? stored.source
        : 'manual',
    countryCode: normalizeCountryCode(stored.countryCode),
    speedUnit: normalizeSpeedUnit(stored.speedUnit),
    distanceUnit: normalizeDistanceUnit(stored.distanceUnit),
    tripDistanceUnit: normalizeTripDistanceUnit(
      stored.tripDistanceUnit,
      inferTripDistanceUnit(stored.speedUnit, stored.distanceUnit)
    ),
  };
}

function saveUnitBootstrap(snapshot) {
  saveJson(UNIT_BOOTSTRAP_KEY, snapshot);
  return snapshot;
}

export function maybeInitializeUnitsFromCountry(countryCode, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const existingBootstrap = loadUnitBootstrap();
  if (existingBootstrap) {
    return {
      changed: false,
      reason: 'bootstrap-present',
      config: existingBootstrap,
    };
  }

  const storedSpeedUnit = loadSharedSpeedUnit();
  const storedDistanceUnit = loadSharedDistanceUnit();
  if (storedSpeedUnit || storedDistanceUnit) {
    return {
      changed: false,
      reason: 'existing-preferences',
      config: {
        initializedAtMs: nowMs,
        updatedAtMs: nowMs,
        source: 'existing',
        countryCode: normalizeCountryCode(countryCode),
        speedUnit: normalizeSpeedUnit(storedSpeedUnit),
        distanceUnit: normalizeDistanceUnit(storedDistanceUnit),
        tripDistanceUnit: inferTripDistanceUnit(storedSpeedUnit, storedDistanceUnit),
      },
    };
  }

  const config = getRegionalUnitsForCountry(countryCode);
  saveSharedUnitPreferences(config);

  return {
    changed: true,
    reason: 'auto-initialized',
    config: saveUnitBootstrap({
      initializedAtMs: nowMs,
      updatedAtMs: nowMs,
      source: 'auto',
      countryCode: normalizeCountryCode(countryCode),
      ...config,
    }),
  };
}

export function markUnitBootstrapManualSelection(partialConfig = {}) {
  const nowMs = Date.now();
  const existing = loadUnitBootstrap();
  saveSharedUnitPreferences(partialConfig);

  const nextConfig = {
    initializedAtMs: existing?.initializedAtMs ?? nowMs,
    updatedAtMs: nowMs,
    source: 'manual',
    countryCode: normalizeCountryCode(partialConfig.countryCode ?? existing?.countryCode),
    speedUnit: normalizeSpeedUnit(
      partialConfig.speedUnit,
      existing?.speedUnit ?? loadSharedSpeedUnit() ?? 'kmh'
    ),
    distanceUnit: normalizeDistanceUnit(
      partialConfig.distanceUnit,
      existing?.distanceUnit ?? loadSharedDistanceUnit() ?? 'm'
    ),
    tripDistanceUnit: normalizeTripDistanceUnit(
      partialConfig.tripDistanceUnit,
      existing?.tripDistanceUnit ??
        inferTripDistanceUnit(
          partialConfig.speedUnit ?? existing?.speedUnit ?? loadSharedSpeedUnit(),
          partialConfig.distanceUnit ?? existing?.distanceUnit ?? loadSharedDistanceUnit()
        )
    ),
  };

  return saveUnitBootstrap(nextConfig);
}

export function getPreferredTripDistanceUnit() {
  const bootstrap = loadUnitBootstrap();
  if (bootstrap?.tripDistanceUnit) {
    return bootstrap.tripDistanceUnit;
  }

  return inferTripDistanceUnit(loadSharedSpeedUnit(), loadSharedDistanceUnit());
}
