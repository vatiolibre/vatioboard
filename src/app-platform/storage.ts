import type {
  VatioAppId,
  VatioAppStorageExport,
  VatioAppLogger,
  VatioAppPermissionRuntime,
  VatioAppStorage,
  VatioAppStorageUsage,
  VatioStorageDriver,
} from "./types";
import type { StorageLike } from "../types/storage";

const APP_STORAGE_PREFIX = "vatioboard.app.";

function getDefaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeKey(key: string) {
  return String(key || "").trim();
}

function getByteLength(value: string) {
  try {
    return new Blob([value]).size;
  } catch {
    return value.length * 2;
  }
}

export function getAppStorageNamespace(appId: VatioAppId) {
  return `${APP_STORAGE_PREFIX}${appId}.`;
}

export function createLocalStorageDriver(
  storage: StorageLike | null = getDefaultStorage(),
): VatioStorageDriver {
  function listKeys(prefix: string) {
    if (!storage) return [];
    const keys: string[] = [];
    const iterableStorage = storage as StorageLike & { length?: number; key?: (index: number) => string | null };
    try {
      const length = "length" in iterableStorage ? Number(iterableStorage.length || 0) : 0;
      if (length > 0 && typeof iterableStorage.key === "function") {
        for (let index = 0; index < length; index += 1) {
          const key = iterableStorage.key(index);
          if (key?.startsWith(prefix)) keys.push(key);
        }
        return keys.sort();
      }

      return Object.keys(storage).filter((key) => key.startsWith(prefix)).sort();
    } catch {
      return [];
    }
  }

  return {
    getItem(key) {
      if (!storage) return null;
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      if (!storage) return false;
      try {
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    removeItem(key) {
      if (!storage) return false;
      try {
        storage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
    listKeys,
    estimate(prefix) {
      const keys = listKeys(prefix);
      let bytes = 0;
      for (const key of keys) {
        bytes += getByteLength(key) + getByteLength(this.getItem(key) || "");
      }
      const appId = prefix.startsWith(APP_STORAGE_PREFIX)
        ? prefix.slice(APP_STORAGE_PREFIX.length).replace(/\.$/, "")
        : prefix;
      return {
        appId,
        keyCount: keys.length,
        bytes,
        available: Boolean(storage),
      };
    },
  };
}

export function listAppPrivateStorageKeys(appId: VatioAppId, storage: StorageLike | null = getDefaultStorage()) {
  const namespace = getAppStorageNamespace(appId);
  return (createLocalStorageDriver(storage).listKeys(namespace) as string[])
    .map((key) => key.slice(namespace.length));
}

export function estimateAppPrivateStorage(appId: VatioAppId, storage: StorageLike | null = getDefaultStorage()) {
  return createLocalStorageDriver(storage).estimate(getAppStorageNamespace(appId)) as VatioAppStorageUsage;
}

export function clearAppPrivateStorage(appId: VatioAppId, storage: StorageLike | null = getDefaultStorage()) {
  const driver = createLocalStorageDriver(storage);
  const namespace = getAppStorageNamespace(appId);
  let ok = true;
  for (const key of driver.listKeys(namespace) as string[]) {
    ok = driver.removeItem(key) === true && ok;
  }
  return ok;
}

export function exportAppPrivateStorage(
  appId: VatioAppId,
  storage: StorageLike | null = getDefaultStorage(),
): VatioAppStorageExport {
  const driver = createLocalStorageDriver(storage);
  const namespace = getAppStorageNamespace(appId);
  const keys: Record<string, string> = {};

  for (const key of driver.listKeys(namespace) as string[]) {
    const value = driver.getItem(key);
    if (value !== null) keys[key.slice(namespace.length)] = value;
  }

  return {
    appId,
    exportedAt: new Date().toISOString(),
    keys,
  };
}

export function importAppPrivateStorage(
  appId: VatioAppId,
  data: Partial<VatioAppStorageExport> | Record<string, string>,
  storage: StorageLike | null = getDefaultStorage(),
) {
  const driver = createLocalStorageDriver(storage);
  const namespace = getAppStorageNamespace(appId);
  const source = "keys" in data && data.keys && typeof data.keys === "object"
    ? data.keys as Record<string, string>
    : data as Record<string, string>;
  let ok = true;

  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizeKey(key);
    if (!normalized) continue;
    ok = driver.setItem(`${namespace}${normalized}`, String(value)) === true && ok;
  }

  return ok;
}

export function createAppStorage({
  appId,
  storage = getDefaultStorage(),
  logger,
}: {
  appId: VatioAppId;
  storage?: StorageLike | null;
  logger?: Pick<VatioAppLogger, "warn"> | null;
}): VatioAppStorage {
  const namespace = getAppStorageNamespace(appId);

  function toStorageKey(key: string) {
    const normalized = normalizeKey(key);
    if (!normalized) return "";
    return `${namespace}${normalized}`;
  }

  function warn(message: string, error?: unknown) {
    logger?.warn?.(message, error);
  }

  function listKeys() {
    if (!storage) return [];
    const keys: string[] = [];
    try {
      const iterableStorage = storage as StorageLike & { length?: number; key?: (index: number) => string | null };
      const length = "length" in iterableStorage ? Number(iterableStorage.length || 0) : 0;
      if (length > 0 && typeof iterableStorage.key === "function") {
        for (let index = 0; index < length; index += 1) {
          const key = iterableStorage.key(index);
          if (key?.startsWith(namespace)) keys.push(key.slice(namespace.length));
        }
        return keys.sort();
      }

      for (const key of Object.keys(storage)) {
        if (key.startsWith(namespace)) keys.push(key.slice(namespace.length));
      }
    } catch (error) {
      warn("Could not list app storage keys.", error);
    }
    return keys.sort();
  }

  return {
    getItem(key) {
      const storageKey = toStorageKey(key);
      if (!storage || !storageKey) return null;
      try {
        return storage.getItem(storageKey);
      } catch (error) {
        warn(`Could not read app storage key "${key}".`, error);
        return null;
      }
    },
    setItem(key, value) {
      const storageKey = toStorageKey(key);
      if (!storage || !storageKey) return false;
      try {
        storage.setItem(storageKey, String(value));
        return true;
      } catch (error) {
        warn(`Could not write app storage key "${key}".`, error);
        return false;
      }
    },
    removeItem(key) {
      const storageKey = toStorageKey(key);
      if (!storage || !storageKey) return false;
      try {
        storage.removeItem(storageKey);
        return true;
      } catch (error) {
        warn(`Could not remove app storage key "${key}".`, error);
        return false;
      }
    },
    getJson(key, fallback) {
      const value = this.getItem(key);
      if (value === null) return fallback;
      try {
        return JSON.parse(value);
      } catch (error) {
        warn(`Could not parse app storage JSON key "${key}".`, error);
        return fallback;
      }
    },
    setJson(key, value) {
      try {
        return this.setItem(key, JSON.stringify(value));
      } catch (error) {
        warn(`Could not serialize app storage JSON key "${key}".`, error);
        return false;
      }
    },
    listKeys,
    clearAppStorage() {
      if (!storage) return false;
      let ok = true;
      for (const key of listKeys()) {
        ok = this.removeItem(key) && ok;
      }
      return ok;
    },
    estimateUsage(): VatioAppStorageUsage {
      if (!storage) {
        return {
          appId,
          keyCount: 0,
          bytes: 0,
          available: false,
        };
      }

      let bytes = 0;
      const keys = listKeys();
      for (const key of keys) {
        const value = this.getItem(key);
        bytes += getByteLength(`${namespace}${key}`) + getByteLength(value || "");
      }

      return {
        appId,
        keyCount: keys.length,
        bytes,
        available: true,
      };
    },
  };
}

export function createPermissionedAppStorage({
  appId,
  storage,
  permissions,
  serviceDeclared = true,
  logger,
}: {
  appId: VatioAppId;
  storage: VatioAppStorage;
  permissions: VatioAppPermissionRuntime;
  serviceDeclared?: boolean;
  logger?: Pick<VatioAppLogger, "warn"> | null;
}): VatioAppStorage {
  function canUseStorage() {
    if (!serviceDeclared) {
      logger?.warn?.('Service "storage" is not declared.');
      return false;
    }
    return permissions.require("storage.app");
  }

  return {
    getItem(key) {
      if (!canUseStorage()) return null;
      return storage.getItem(key);
    },
    setItem(key, value) {
      if (!canUseStorage()) return false;
      return storage.setItem(key, value);
    },
    removeItem(key) {
      if (!canUseStorage()) return false;
      return storage.removeItem(key);
    },
    getJson(key, fallback) {
      if (!canUseStorage()) return fallback;
      return storage.getJson(key, fallback);
    },
    setJson(key, value) {
      if (!canUseStorage()) return false;
      return storage.setJson(key, value);
    },
    listKeys() {
      if (!canUseStorage()) return [];
      return storage.listKeys();
    },
    clearAppStorage() {
      if (!canUseStorage()) return false;
      return storage.clearAppStorage();
    },
    estimateUsage() {
      if (!canUseStorage()) {
        return {
          appId,
          keyCount: 0,
          bytes: 0,
          available: false,
        };
      }
      return storage.estimateUsage();
    },
  };
}
