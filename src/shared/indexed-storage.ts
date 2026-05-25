const INDEXED_DB_OPEN_TIMEOUT_MS = 3000;

import type { JsonValue } from "../types/storage";

export interface IndexedJsonKeyValueStoreOptions {
  dbName: string;
  dbVersion?: number;
  storeName: string;
}

export interface IndexedJsonKeyValueStore {
  deleteValue(key: IDBValidKey): Promise<boolean>;
  getValue<T extends JsonValue = JsonValue>(key: IDBValidKey): Promise<T | undefined>;
  hasSupport(): boolean;
  openDatabase(): Promise<IDBDatabase | null>;
  setValue(key: IDBValidKey, value: JsonValue): Promise<boolean>;
}

export function hasIndexedDbSupport(): boolean {
  return typeof indexedDB !== "undefined" && typeof indexedDB.open === "function";
}

export function createIndexedJsonKeyValueStore({
  dbName,
  dbVersion = 1,
  storeName,
}: IndexedJsonKeyValueStoreOptions): IndexedJsonKeyValueStore {
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let databaseRef: IDBDatabase | null = null;

  function clearCachedDatabase(target = databaseRef): void {
    if (databaseRef === target) {
      databaseRef = null;
    }
  }

  function cacheDatabase(database: IDBDatabase | null): IDBDatabase | null {
    if (!database) return null;
    if (databaseRef === database) return database;

    const clear = () => {
      clearCachedDatabase(database);
    };

    try {
      database.onclose = clear;
    } catch {
      // Ignore environments that do not expose onclose.
    }

    try {
      database.onversionchange = () => {
        clear();
        try {
          database.close();
        } catch {
          // Ignore close failures while cleaning up stale handles.
        }
      };
    } catch {
      // Ignore environments that do not expose onversionchange.
    }

    databaseRef = database;
    return database;
  }

  async function openDatabase(): Promise<IDBDatabase | null> {
    if (!hasIndexedDbSupport()) {
      return null;
    }

    if (databaseRef) {
      return databaseRef;
    }

    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        let settled = false;
        let openTimeoutId: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;

        const finish = (database: IDBDatabase | null) => {
          if (settled) return;
          settled = true;
          if (openTimeoutId !== undefined) clearTimeout(openTimeoutId);
          // When the open succeeds, clear dbPromise so future calls use databaseRef.
          // When it fails via error/blocked, clear dbPromise to allow a retry.
          // When it times out, keep dbPromise cached so subsequent calls return
          // the resolved null immediately instead of triggering repeated timeouts.
          if (!timedOut) {
            dbPromise = null;
          }
          resolve(database);
        };

        try {
          const request = indexedDB.open(dbName, dbVersion);

          request.onupgradeneeded = () => {
            if (settled) return;
            const database = request.result;
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName);
            }
          };

          request.onsuccess = () => {
            if (settled) return;
            finish(cacheDatabase(request.result));
          };

          request.onerror = () => {
            finish(null);
          };

          request.onblocked = () => {
            finish(null);
          };

          openTimeoutId = setTimeout(() => {
            timedOut = true;
            finish(null);
          }, INDEXED_DB_OPEN_TIMEOUT_MS);
        } catch {
          finish(null);
        }
      });
    }

    return dbPromise;
  }

  async function getValue<T extends JsonValue = JsonValue>(key: IDBValidKey): Promise<T | undefined> {
    const database = await openDatabase();
    if (!database) return undefined;

    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(key);
        let result: T | undefined = undefined;
        request.onsuccess = () => {
          result = request.result ?? undefined;
        };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () => reject(transaction.error ?? request.error);
      });
    } catch {
      return undefined;
    }
  }

  async function setValue(key: IDBValidKey, value: JsonValue): Promise<boolean> {
    const database = await openDatabase();
    if (!database) return false;

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const request = transaction.objectStore(storeName).put(value, key);
        request.onsuccess = () => {};
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () => reject(transaction.error ?? request.error);
      });
      return true;
    } catch {
      return false;
    }
  }

  async function deleteValue(key: IDBValidKey): Promise<boolean> {
    const database = await openDatabase();
    if (!database) return false;

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const request = transaction.objectStore(storeName).delete(key);
        request.onsuccess = () => {};
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () => reject(transaction.error ?? request.error);
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    deleteValue,
    getValue,
    hasSupport: hasIndexedDbSupport,
    openDatabase,
    setValue,
  };
}
