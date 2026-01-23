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
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    return {
      ...DEFAULT_SETTINGS,
      unit: stored?.unit === "mi" ? "mi" : "km",
      mode: stored?.mode === "multi" ? "multi" : "simple",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveTripCostSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function loadTripCostValues() {
  try {
    const raw = localStorage.getItem(VALUES_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    return {
      distance: stored?.distance ?? DEFAULT_VALUES.distance,
      consumption: stored?.consumption ?? DEFAULT_VALUES.consumption,
      price: stored?.price ?? DEFAULT_VALUES.price,
    };
  } catch {
    return { ...DEFAULT_VALUES };
  }
}

export function saveTripCostValues(values) {
  try {
    localStorage.setItem(VALUES_KEY, JSON.stringify(values));
  } catch {
    // ignore
  }
}

// Multi-trip functions
let nextTripId = 1;

export function loadMultiTrips() {
  try {
    const raw = localStorage.getItem(MULTI_TRIP_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    if (stored?.trips && Array.isArray(stored.trips)) {
      // Update nextTripId based on stored trips
      nextTripId = Math.max(...stored.trips.map(t => t.id), 0) + 1;
      return stored.trips;
    }
    return [];
  } catch {
    return [];
  }
}

export function saveMultiTrips(trips) {
  try {
    localStorage.setItem(MULTI_TRIP_KEY, JSON.stringify({ trips }));
  } catch {
    // ignore
  }
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
  try {
    localStorage.removeItem(MULTI_TRIP_KEY);
    nextTripId = 1;
  } catch {
    // ignore
  }
}

export { DEFAULT_SETTINGS, DEFAULT_VALUES };
