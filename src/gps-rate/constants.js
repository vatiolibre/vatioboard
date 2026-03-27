export const APP_NAME = "Vatio GPS Rate Lab";

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

export const STORAGE_KEYS = {
  notes: "vatio_gps_rate_notes",
  keepAwake: "vatio_gps_rate_keep_awake",
  lastSummary: "vatio_gps_rate_last_summary",
};

export const MAX_LOG_ROWS = 200;
export const SPARKLINE_WINDOW = 48;
export const ACCURACY_WARNING_M = 25;
export const SPARSE_INTERVAL_WARNING_MS = 2500;
export const SPARSE_HZ_WARNING = 0.66;
export const STALE_SAMPLE_AGE_MS = 1500;
export const MIN_VALID_EPOCH_MS = Date.UTC(2000, 0, 1);
export const MOVING_SPEED_THRESHOLD_MS = 1;
export const STATIONARY_SPEED_THRESHOLD_MS = 0.3;
export const MIN_DISTANCE_NOISE_FLOOR_M = 4;
export const MAX_ACCURACY_INFLUENCE_M = 18;

export const HISTOGRAM_BUCKETS = [
  { label: "<100", min: 0, max: 100 },
  { label: "100-249", min: 100, max: 250 },
  { label: "250-499", min: 250, max: 500 },
  { label: "500-999", min: 500, max: 1000 },
  { label: "1000-1499", min: 1000, max: 1500 },
  { label: "1500-2999", min: 1500, max: 3000 },
  { label: "3000+", min: 3000, max: Number.POSITIVE_INFINITY },
];
