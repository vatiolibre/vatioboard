const SETTINGS_KEY = "energy_trip_cost_settings_v1";
const VALUES_KEY = "energy_trip_cost_values_v1";

const DEFAULT_SETTINGS = {
  unit: "km", // "km" or "mi"
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

export { DEFAULT_SETTINGS, DEFAULT_VALUES };
