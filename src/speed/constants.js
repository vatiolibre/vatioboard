export const STORAGE_UNIT_KEY = "vatio_speed_unit";
export const STORAGE_DISTANCE_UNIT_KEY = "vatio_speed_distance_unit";
export const LEGACY_STORAGE_ALTITUDE_UNIT_KEY = "vatio_speed_altitude_unit";
export const STORAGE_ALERT_ENABLED_KEY = "vatio_speed_alert_enabled";
export const STORAGE_ALERT_LIMIT_KEY = "vatio_speed_alert_limit_ms";
export const STORAGE_ALERT_SOUND_ENABLED_KEY = "vatio_speed_alert_sound_enabled";
export const STORAGE_TRAP_ALERT_ENABLED_KEY = "vatio_speed_trap_alert_enabled";
export const STORAGE_TRAP_ALERT_DISTANCE_KEY = "vatio_speed_trap_alert_distance_m";
export const STORAGE_TRAP_SOUND_ENABLED_KEY = "vatio_speed_trap_sound_enabled";
export const STORAGE_AUDIO_MUTED_KEY = "vatio_speed_audio_muted";
export const STORAGE_BACKGROUND_AUDIO_ENABLED_KEY = "vatio_speed_background_audio_enabled";
export const STORAGE_ALERT_TRIGGER_DISCOVERED_KEY = "vatio_speed_alert_trigger_discovered";
export const STORAGE_PRIMARY_VIEW_KEY = "vatio_speed_primary_view";

export const OVERSPEED_SOUND_URL = "/audio/overspeed_notification.m4a";
export const TRAP_SOUND_URL = "/audio/near_camera_notification.m4a";
export const TRAP_DATA_URL = "/geo/ansv_cameras_compact.min.json";
export const TRAP_INDEX_URL = "/geo/ansv_cameras_compact.kdbush";

export const SPEED_APP_NAME = "Vatio Speed";
export const RUNTIME_ARTWORK_SIZE = 512;
export const MEDIA_METADATA_MIN_UPDATE_INTERVAL_MS = 1000;
export const BACKGROUND_KEEPALIVE_SAMPLE_RATE = 22050;
export const BACKGROUND_KEEPALIVE_DURATION_SECONDS = 2;

export const GLOBE_DEFAULT_CENTER = [137.9150899566626, 36.25956997955441];
export const GLOBE_DEFAULT_ZOOM = 0.15;
export const GLOBE_FOLLOW_ZOOM = 0.8;
export const GLOBE_FOLLOW_RESUME_DELAY_MS = 12000;
export const GLOBE_SOURCE_ID = "live-position";
export const GLOBE_TERMINATOR_SOURCE_ID = "solar-terminator";
export const GLOBE_NIGHT_SOURCE_ID = "solar-night";
export const GLOBE_SOLAR_UPDATE_INTERVAL_MS = 60000;
export const GLOBE_RASTER_BRIGHTNESS_MIN = 0.2;
export const GLOBE_RASTER_CONTRAST = 0.14;
export const GLOBE_SKY_COLOR = "#e6f2ff";
export const GLOBE_HORIZON_COLOR = "#ffffff";
export const GLOBE_SKY_HORIZON_BLEND = 0.28;
export const GLOBE_NIGHT_POLYGON_STEPS = 180;
export const GLOBE_NIGHT_CAPS = [
  { altitude: -1, opacity: 0.08, color: "#10233a" },
  { altitude: -6, opacity: 0.12, color: "#0a1525" },
  { altitude: -12, opacity: 0.18, color: "#050d18" },
  { altitude: -18, opacity: 0.24, color: "#020711" },
];
export const GLOBE_SATELLITE_ATTRIBUTION = [
  '<a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless</a>',
  "by",
  '<a href="https://eox.at" target="_blank" rel="noopener noreferrer">EOX IT Services GmbH</a>',
  "(Contains modified Copernicus Sentinel data 2020)",
].join(" ");

export const WAZE_EMBED_BASE_URL = "https://embed.waze.com/iframe";
export const WAZE_REFRESH_MIN_INTERVAL_MS = 300000;
export const WAZE_REFRESH_MIN_DISTANCE_M = 300;

export const UNIT_CONFIG = {
  mph: { label: "mph", baseMax: 120, tickStep: 20, factor: 2.2369362920544 },
  kmh: { label: "km/h", baseMax: 200, tickStep: 40, factor: 3.6 },
};

export const DISTANCE_UNIT_CONFIG = {
  ft: { label: "ft", factor: 3.2808398950131 },
  m: { label: "m", factor: 1 },
};

export const ALERT_CONFIG = {
  mph: { step: 5, min: 10, max: 180, presets: [25, 35, 45, 55, 65, 75] },
  kmh: { step: 10, min: 20, max: 280, presets: [40, 60, 80, 100, 120, 140] },
};

export const DEFAULT_ALERT_LIMIT_MS = 100 / UNIT_CONFIG.kmh.factor;

export const TRAP_ALERT_PRESETS = {
  ft: [
    { meters: 304.8, label: "1000 ft" },
    { meters: 609.6, label: "2000 ft" },
    { meters: 804.672, label: "0.5 mi" },
    { meters: 1609.344, label: "1 mi" },
  ],
  m: [
    { meters: 200, label: "200 m" },
    { meters: 500, label: "500 m" },
    { meters: 1000, label: "1 km" },
    { meters: 2000, label: "2 km" },
  ],
};

export const SPEED_SMOOTHING_SAMPLES = 5;
export const MIN_MOVING_SPEED_MS = 0.8;
export const MIN_DISTANCE_NOISE_FLOOR_M = 4;
export const MAX_ACCURACY_INFLUENCE_M = 18;
export const MAX_PLAUSIBLE_SPEED_MS = 120;
export const MIN_VALID_EPOCH_MS = Date.UTC(2000, 0, 1);

export const GEO_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
};

export const MEDIA_SESSION_FALLBACK_ARTWORK = [
  { src: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
  { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  { src: "/img/vatio-board-speed-og-1200x630.jpg", sizes: "1200x630", type: "image/jpeg" },
];
