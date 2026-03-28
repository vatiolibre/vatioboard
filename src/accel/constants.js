export const SHARED_SPEED_UNIT_KEY = "vatio_speed_unit";
export const SHARED_DISTANCE_UNIT_KEY = "vatio_speed_distance_unit";
export const SHARED_LEGACY_ALTITUDE_UNIT_KEY = "vatio_speed_altitude_unit";

export const STORAGE_KEYS = {
  runs: "vatioboard.accel.runs",
  settings: "vatioboard.accel.settings",
};

export const MPH_TO_MS = 0.44704;
export const KMH_TO_MS = 1000 / 3600;
export const FT_TO_M = 0.3048;
export const EIGHTH_MILE_M = 201.168;
export const QUARTER_MILE_M = 402.336;

export const SPEED_UNIT_CONFIG = {
  mph: { factor: 2.2369362920544, labelKey: "accelMphUnit" },
  kmh: { factor: 3.6, labelKey: "accelKmhUnit" },
};

export const DISTANCE_UNIT_CONFIG = {
  ft: { factor: 3.2808398950131, label: "ft" },
  m: { factor: 1, label: "m" },
};

export const GEO_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
};

export const GEO_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
};

export const MAX_RUNS = 40;
export const MAX_DEBUG_SAMPLE_ROWS = 5000;
export const MAX_RESULT_TRACE_POINTS = 800;
export const MAX_PLAUSIBLE_SPEED_MS = 90;
export const READY_SAMPLE_AGE_MS = 2500;
export const STALE_INTERVAL_MS = 1500;
export const SPARSE_INTERVAL_MS = 1800;
export const MOVING_SPEED_THRESHOLD_MS = 1;
export const STATIONARY_SPEED_THRESHOLD_MS = 0.3;
export const MIN_DISTANCE_NOISE_FLOOR_M = 4;
export const MAX_ACCURACY_INFLUENCE_M = 18;
export const RECENT_INTERVAL_WINDOW = 12;
export const TIMER_TICK_MS = 50;
export const TRACE_DUPLICATE_EPSILON_MS = 0.01;
export const CLOCK_DELTA_DISAGREEMENT_RATIO = 4;
export const CLOCK_DELTA_DISAGREEMENT_MS = 250;
export const MIN_VALID_RUN_SAMPLES = 4;
export const MIN_VALID_RUN_DURATION_MS = 800;
export const FINISH_SOUND_URL = "/audio/finish.m4a";
export const RESULT_GRAPH_HEIGHT = 220;

export const defaultSettings = {
  selectedPresetId: "0-60-mph",
  rolloutEnabled: false,
  launchThresholdMs: 0.5 * MPH_TO_MS,
  speedUnit: "mph",
  distanceUnit: "ft",
  customStart: 0,
  customEnd: 60,
  notes: "",
};

export const presetDefinitions = [
  { id: "0-30-mph", type: "speed", labelKey: "accelPreset0to30", standingStart: true, startSpeedMs: 0, targetSpeedMs: 30 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-1" },
  { id: "0-40-mph", type: "speed", labelKey: "accelPreset0to40", standingStart: true, startSpeedMs: 0, targetSpeedMs: 40 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-2" },
  { id: "0-50-mph", type: "speed", labelKey: "accelPreset0to50", standingStart: true, startSpeedMs: 0, targetSpeedMs: 50 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-3" },
  { id: "0-60-mph", type: "speed", labelKey: "accelPreset0to60", standingStart: true, startSpeedMs: 0, targetSpeedMs: 60 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-4" },
  { id: "60-130-mph", type: "speed", labelKey: "accelPreset60to130", standingStart: false, startSpeedMs: 60 * MPH_TO_MS, targetSpeedMs: 130 * MPH_TO_MS, speedSystem: "mph", variantGroup: "roll-1" },
  { id: "0-50-kmh", type: "speed", labelKey: "accelPreset0to50Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 50 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-1" },
  { id: "0-60-kmh", type: "speed", labelKey: "accelPreset0to60Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 60 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-2" },
  { id: "0-80-kmh", type: "speed", labelKey: "accelPreset0to80Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 80 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-3" },
  { id: "0-100-kmh", type: "speed", labelKey: "accelPreset0to100Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 100 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-4" },
  { id: "100-200-kmh", type: "speed", labelKey: "accelPreset100to200Kmh", standingStart: false, startSpeedMs: 100 * KMH_TO_MS, targetSpeedMs: 200 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "roll-1" },
  { id: "eighth-mile", type: "distance", labelKey: "accelPresetEighthMile", standingStart: true, distanceTargetM: EIGHTH_MILE_M, distanceSystem: "ft", variantGroup: "distance-short" },
  { id: "quarter-mile", type: "distance", labelKey: "accelPresetQuarterMile", standingStart: true, distanceTargetM: QUARTER_MILE_M, distanceSystem: "ft", variantGroup: "distance-long" },
  { id: "200-m", type: "distance", labelKey: "accelPreset200M", standingStart: true, distanceTargetM: 200, distanceSystem: "m", variantGroup: "distance-short" },
  { id: "400-m", type: "distance", labelKey: "accelPreset400M", standingStart: true, distanceTargetM: 400, distanceSystem: "m", variantGroup: "distance-long" },
  { id: "custom", type: "custom", labelKey: "accelPresetCustom", standingStart: false, variantGroup: "custom" },
];

export const distancePartialDefinitions = {
  ft: [
    { id: "60-ft", kind: "distance", labelKey: "accelPartial60ft", distanceM: 60 * FT_TO_M, showTrapSpeed: false },
    { id: "eighth-mile", kind: "distance", labelKey: "accelPresetEighthMile", distanceM: EIGHTH_MILE_M, showTrapSpeed: true },
    { id: "1000-ft", kind: "distance", labelKey: "accelPartial1000ft", distanceM: 1000 * FT_TO_M, showTrapSpeed: true },
    { id: "quarter-mile", kind: "distance", labelKey: "accelPresetQuarterMile", distanceM: QUARTER_MILE_M, showTrapSpeed: true },
  ],
  m: [
    { id: "100-m", kind: "distance", labelKey: "accelPartial100m", distanceM: 100, showTrapSpeed: false },
    { id: "200-m", kind: "distance", labelKey: "accelPreset200M", distanceM: 200, showTrapSpeed: true },
    { id: "400-m", kind: "distance", labelKey: "accelPreset400M", distanceM: 400, showTrapSpeed: true },
  ],
};

export const speedPartialDefinitions = {
  mph: [
    { id: "0-60-mph", kind: "speed", labelKey: "accelPreset0to60", startSpeedMs: 0, targetSpeedMs: 60 * MPH_TO_MS },
    { id: "60-130-mph", kind: "speed", labelKey: "accelPreset60to130", startSpeedMs: 60 * MPH_TO_MS, targetSpeedMs: 130 * MPH_TO_MS },
    { id: "0-130-mph", kind: "speed", labelKey: "accelPartial0to130", startSpeedMs: 0, targetSpeedMs: 130 * MPH_TO_MS },
  ],
  kmh: [
    { id: "0-100-kmh", kind: "speed", labelKey: "accelPreset0to100Kmh", startSpeedMs: 0, targetSpeedMs: 100 * KMH_TO_MS },
    { id: "100-200-kmh", kind: "speed", labelKey: "accelPreset100to200Kmh", startSpeedMs: 100 * KMH_TO_MS, targetSpeedMs: 200 * KMH_TO_MS },
    { id: "0-200-kmh", kind: "speed", labelKey: "accelPartial0to200Kmh", startSpeedMs: 0, targetSpeedMs: 200 * KMH_TO_MS },
  ],
};

export function normalizeSpeedUnit(unit) {
  return unit === "kmh" ? "kmh" : "mph";
}

export function normalizeDistanceUnit(unit) {
  return unit === "m" ? "m" : "ft";
}
