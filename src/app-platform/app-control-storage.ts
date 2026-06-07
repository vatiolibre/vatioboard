import type { StorageLike } from "../types/storage";

export const APP_CONTROL_STORAGE_KEY = "vatioboard.os.appControl.v1";

export interface StoredAppControlRecord {
  version: 1;
  apps: Record<string, unknown>;
}

function getDefaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function createEmptyRecord(): StoredAppControlRecord {
  return {
    version: 1,
    apps: {},
  };
}

export function readAppControlRecord(storage: StorageLike | null = getDefaultStorage()): StoredAppControlRecord {
  if (!storage) return createEmptyRecord();

  try {
    const raw = storage.getItem(APP_CONTROL_STORAGE_KEY);
    if (!raw) return createEmptyRecord();

    const parsed = JSON.parse(raw) as Partial<StoredAppControlRecord> | null;
    if (!parsed || parsed.version !== 1 || !parsed.apps || typeof parsed.apps !== "object") {
      return createEmptyRecord();
    }

    return {
      version: 1,
      apps: { ...parsed.apps },
    };
  } catch {
    return createEmptyRecord();
  }
}

export function writeAppControlRecord(
  record: StoredAppControlRecord,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(APP_CONTROL_STORAGE_KEY, JSON.stringify({
      version: 1,
      apps: record.apps || {},
    }));
    return true;
  } catch {
    return false;
  }
}

export function removeAppControlState(
  appId: string,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  const record = readAppControlRecord(storage);
  delete record.apps[appId];
  return writeAppControlRecord(record, storage);
}
