import { readAppControlRecord, writeAppControlRecord } from "../../app-platform/app-control-storage.js";

export const MAP_MIGRATION_KEY = "vatioboard.map.migration.v1";
const LEGACY_APP_ID = "vatio.cameraMap";
const MAP_APP_ID = "vatio.map";
const LEGACY_SETTING_KEYS = {
  basemap: "vatioboard:camera-map:basemap",
  follow: "vatioboard.cameraMap.follow.v1",
  orientation: "vatioboard.cameraMap.orientation.v1",
  projection: "vatioboard.cameraMap.projection.v1",
  approachLayer: "vatioboard.cameraMap.approachLayer.v1",
  approachFilter: "vatioboard.cameraMap.approachFilter.v1",
} as const;

function mapSettingStorageKey(settingId: string) {
  return `vatioboard.app.${MAP_APP_ID}.settings.${settingId}`;
}

/** Copies durable state into the route app without deleting the legacy values. */
export function migrateCameraMapToMapApp(storage: Storage = localStorage): boolean {
  try {
    if (storage.getItem(MAP_MIGRATION_KEY) === "complete") return false;

    const record = readAppControlRecord(storage);
    if (!record.apps[MAP_APP_ID] && record.apps[LEGACY_APP_ID]) {
      record.apps[MAP_APP_ID] = {
        ...(record.apps[LEGACY_APP_ID] as Record<string, unknown>),
        appId: MAP_APP_ID,
      };
      writeAppControlRecord(record, storage);
    }

    for (const [settingId, legacyKey] of Object.entries(LEGACY_SETTING_KEYS)) {
      const targetKey = mapSettingStorageKey(settingId);
      if (storage.getItem(targetKey) !== null) continue;
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue !== null) storage.setItem(targetKey, legacyValue);
    }

    storage.setItem(MAP_MIGRATION_KEY, "complete");
    return true;
  } catch {
    return false;
  }
}
