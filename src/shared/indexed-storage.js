export function hasIndexedDbSupport() {
  return typeof indexedDB !== "undefined" && typeof indexedDB.open === "function";
}

export function createIndexedJsonKeyValueStore({
  dbName,
  dbVersion = 1,
  storeName,
}) {
  let dbPromise = null;
  let databaseRef = null;

  function clearCachedDatabase(target = databaseRef) {
    if (databaseRef === target) {
      databaseRef = null;
    }
  }

  function cacheDatabase(database) {
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

  async function openDatabase() {
    if (!hasIndexedDbSupport()) {
      return null;
    }

    if (databaseRef) {
      return databaseRef;
    }

    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        const finish = (database) => {
          dbPromise = null;
          resolve(database);
        };

        try {
          const request = indexedDB.open(dbName, dbVersion);

          request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName);
            }
          };

          request.onsuccess = () => {
            finish(cacheDatabase(request.result));
          };

          request.onerror = () => {
            finish(null);
          };

          request.onblocked = () => {
            finish(null);
          };
        } catch {
          finish(null);
        }
      });
    }

    return dbPromise;
  }

  async function getValue(key) {
    const database = await openDatabase();
    if (!database) return undefined;

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(key);
        let result = undefined;
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

  async function setValue(key, value) {
    const database = await openDatabase();
    if (!database) return false;

    try {
      await new Promise((resolve, reject) => {
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

  async function deleteValue(key) {
    const database = await openDatabase();
    if (!database) return false;

    try {
      await new Promise((resolve, reject) => {
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
