export const STORAGE_BACKENDS = Object.freeze({
  indexedDb: 'indexeddb',
  localStorage: 'localStorage',
});

function createDefaultSnapshot({ indexedDbPresent } = {}) {
  const hasIndexedDb = indexedDbPresent === true;
  return {
    indexedDbPresent: hasIndexedDb,
    indexedDbOpenable: false,
    indexedDbWritable: false,
    fallbackMode: true,
    degraded: hasIndexedDb,
    preferredLargePayloadBackend: STORAGE_BACKENDS.localStorage,
  };
}

export function createStorageCapability({ store, namespace = 'storage-capability' } = {}) {
  let cachedSnapshot = createDefaultSnapshot({
    indexedDbPresent: Boolean(store?.hasSupport?.()),
  });
  let hasDetected = false;
  let probePromise = null;

  async function probeIndexedDb() {
    const indexedDbPresent = Boolean(store?.hasSupport?.());
    if (!indexedDbPresent || !store) {
      cachedSnapshot = createDefaultSnapshot({ indexedDbPresent: false });
      hasDetected = true;
      return cachedSnapshot;
    }

    const probeKey = `${namespace}:probe`;
    let indexedDbOpenable = false;
    let indexedDbWritable = false;

    try {
      const database = await store.openDatabase();
      indexedDbOpenable = Boolean(database);
      if (database) {
        indexedDbWritable = await store.setValue(probeKey, {
          checkedAtMs: Date.now(),
        });
        if (indexedDbWritable) {
          await store.deleteValue(probeKey);
        }
      }
    } catch {
      indexedDbOpenable = false;
      indexedDbWritable = false;
    }

    cachedSnapshot = {
      indexedDbPresent,
      indexedDbOpenable,
      indexedDbWritable,
      fallbackMode: !indexedDbWritable,
      degraded: indexedDbPresent && !indexedDbWritable,
      preferredLargePayloadBackend: indexedDbWritable
        ? STORAGE_BACKENDS.indexedDb
        : STORAGE_BACKENDS.localStorage,
    };
    hasDetected = true;
    return cachedSnapshot;
  }

  async function detect({ force = false } = {}) {
    if (!force && probePromise) {
      return probePromise;
    }

    if (!force && hasDetected) {
      return cachedSnapshot;
    }

    probePromise = probeIndexedDb().finally(() => {
      probePromise = null;
    });
    return probePromise;
  }

  return {
    detect,
    getSnapshot() {
      return { ...cachedSnapshot };
    },
    hasIndexedDbSupport() {
      return Boolean(store?.hasSupport?.());
    },
    async isDegraded({ force = false } = {}) {
      return Boolean((await detect({ force })).degraded);
    },
    async isFallbackMode({ force = false } = {}) {
      return Boolean((await detect({ force })).fallbackMode);
    },
    async isIndexedDbUsable({ force = false } = {}) {
      return Boolean((await detect({ force })).indexedDbWritable);
    },
    async resolveLargePayloadBackend({ force = false } = {}) {
      return (await detect({ force })).preferredLargePayloadBackend;
    },
  };
}