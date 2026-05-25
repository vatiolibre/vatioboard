import { loadJson, removeStoredValue, saveJson } from '../shared/storage.js';
import { getPreferredTripDistanceUnit } from '../shared/unit-bootstrap.js';

const SETTINGS_KEY = 'energy_trip_cost_settings_v1';
const VALUES_KEY = 'energy_trip_cost_values_v1';
const MULTI_TRIP_KEY = 'energy_multi_trip_v1';

export type TripDistanceUnit = 'km' | 'mi';
export type TripCostMode = 'simple' | 'multi';

export interface TripCostSettings {
  unit: TripDistanceUnit;
  mode: TripCostMode;
}

export interface TripCostValues {
  distance: string;
  consumption: string;
  price: string;
}

export interface MultiTripRecord {
  id: number;
  name: string;
  distance: string;
  consumption: string;
  price: string;
  expanded: boolean;
  [key: string]: unknown;
}

interface StoredMultiTrips {
  trips?: MultiTripRecord[];
}

const DEFAULT_SETTINGS: TripCostSettings = {
  unit: 'km', // "km" or "mi"
  mode: 'simple', // "simple" or "multi"
};

const DEFAULT_VALUES: TripCostValues = {
  distance: '',
  consumption: '',
  price: '',
};

export function loadTripCostSettings(): TripCostSettings {
  const stored = loadJson<Partial<TripCostSettings>>(SETTINGS_KEY, null);
  const defaultUnit = getPreferredTripDistanceUnit();
  return {
    ...DEFAULT_SETTINGS,
    unit: stored?.unit === 'mi' ? 'mi' : defaultUnit === 'mi' ? 'mi' : 'km',
    mode: stored?.mode === 'multi' ? 'multi' : 'simple',
  };
}

export function saveTripCostSettings(settings: TripCostSettings | Partial<TripCostSettings>): void {
  saveJson(SETTINGS_KEY, settings);
}

export function loadTripCostValues(): TripCostValues {
  const stored = loadJson<Partial<TripCostValues>>(VALUES_KEY, null);
  return {
    distance: (stored?.distance ?? DEFAULT_VALUES.distance) as string,
    consumption: (stored?.consumption ?? DEFAULT_VALUES.consumption) as string,
    price: (stored?.price ?? DEFAULT_VALUES.price) as string,
  };
}

export function saveTripCostValues(values: TripCostValues | Partial<TripCostValues>): void {
  saveJson(VALUES_KEY, values);
}

// Multi-trip functions
let nextTripId = 1;

export function loadMultiTrips(): MultiTripRecord[] {
  const stored = loadJson<StoredMultiTrips>(MULTI_TRIP_KEY, null);
  if (stored?.trips && Array.isArray(stored.trips)) {
    nextTripId = Math.max(...stored.trips.map((t) => t.id), 0) + 1;
    return stored.trips;
  }
  return [];
}

export function saveMultiTrips(trips: MultiTripRecord[]): void {
  saveJson(MULTI_TRIP_KEY, { trips });
}

export function createNewTrip(number: number): MultiTripRecord {
  return {
    id: nextTripId++,
    name: `Trip ${number}`,
    distance: '',
    consumption: '',
    price: '',
    expanded: true,
  };
}

export function clearAllTrips(): void {
  removeStoredValue(MULTI_TRIP_KEY);
  nextTripId = 1;
}

export { DEFAULT_SETTINGS, DEFAULT_VALUES };
