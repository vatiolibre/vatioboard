import type {
  VatioAppPermissionRuntime,
  VatioAppSettingsService,
  VatioAppStorage,
} from "./types";

const SETTINGS_PREFIX = "settings.";

function settingsKey(key: string) {
  const normalized = String(key || "").trim();
  return normalized ? `${SETTINGS_PREFIX}${normalized}` : "";
}

export function createAppSettingsService({
  storage,
  permissions,
}: {
  storage: VatioAppStorage;
  permissions: VatioAppPermissionRuntime;
}): VatioAppSettingsService {
  const listeners = new Set<(key: string, value: unknown) => void>();

  function canRead() {
    return permissions.require("settings.read");
  }

  function canWrite() {
    return permissions.require("settings.write");
  }

  function notify(key: string, value: unknown) {
    for (const listener of listeners) listener(key, value);
  }

  return {
    get(key, fallback = null) {
      if (!canRead()) return fallback;
      const value = storage.getItem(settingsKey(key));
      return value === null ? fallback : value;
    },
    set(key, value) {
      if (!canWrite()) return false;
      const namespacedKey = settingsKey(key);
      if (!namespacedKey) return false;
      const saved = storage.setItem(namespacedKey, value);
      if (saved) notify(key, value);
      return saved;
    },
    remove(key) {
      if (!canWrite()) return false;
      const namespacedKey = settingsKey(key);
      if (!namespacedKey) return false;
      const removed = storage.removeItem(namespacedKey);
      if (removed) notify(key, null);
      return removed;
    },
    getJson(key, fallback) {
      if (!canRead()) return fallback;
      return storage.getJson(settingsKey(key), fallback);
    },
    setJson(key, value) {
      if (!canWrite()) return false;
      const namespacedKey = settingsKey(key);
      if (!namespacedKey) return false;
      const saved = storage.setJson(namespacedKey, value);
      if (saved) notify(key, value);
      return saved;
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
