import { loadJson, removeStoredValue, saveJson } from "../shared/storage.js";

const SETTINGS_KEY = "energy_trip_cost_settings_v1";
const VALUES_KEY = "energy_trip_cost_values_v1";
const MULTI_TRIP_KEY = "energy_multi_trip_v1";

const DEFAULT_SETTINGS = {
  unit: "km", // "km" or "mi"
  mode: "simple", // "simple" or "multi"
};

const DEFAULT_VALUES = {
  distance: "",
  consumption: "",
  price: "",
};

export function loadTripCostSettings() {
  const stored = loadJson(SETTINGS_KEY, null);
  return {
    ...DEFAULT_SETTINGS,
    unit: stored?.unit === "mi" ? "mi" : "km",
    mode: stored?.mode === "multi" ? "multi" : "simple",
  };
}

export function saveTripCostSettings(settings) {
  saveJson(SETTINGS_KEY, settings);
}

export function loadTripCostValues() {
  const stored = loadJson(VALUES_KEY, null);
  return {
    distance: stored?.distance ?? DEFAULT_VALUES.distance,
    consumption: stored?.consumption ?? DEFAULT_VALUES.consumption,
    price: stored?.price ?? DEFAULT_VALUES.price,
  };
}

export function saveTripCostValues(values) {
  saveJson(VALUES_KEY, values);
}

// Multi-trip functions
let nextTripId = 1;

export function loadMultiTrips() {
  const stored = loadJson(MULTI_TRIP_KEY, null);
  if (stored?.trips && Array.isArray(stored.trips)) {
    nextTripId = Math.max(...stored.trips.map((t) => t.id), 0) + 1;
    return stored.trips;
  }
  return [];
}

export function saveMultiTrips(trips) {
  saveJson(MULTI_TRIP_KEY, { trips });
}

export function createNewTrip(number) {
  return {
    id: nextTripId++,
    name: `Trip ${number}`,
    distance: "",
    consumption: "",
    price: "",
    expanded: true,
  };
}

export function clearAllTrips() {
  removeStoredValue(MULTI_TRIP_KEY);
  nextTripId = 1;
}

export { DEFAULT_SETTINGS, DEFAULT_VALUES };
