import type { IndexedJsonKeyValueStore } from "./indexed-storage";

export const STORAGE_BACKENDS = Object.freeze({
  indexedDb: 'indexeddb',
  localStorage: 'localStorage',
});

export type StorageBackend = typeof STORAGE_BACKENDS[keyof typeof STORAGE_BACKENDS];

export interface StorageCapabilitySnapshot {
  indexedDbPresent: boolean;
  indexedDbOpenable: boolean;
  indexedDbWritable: boolean;
  fallbackMode: boolean;
  degraded: boolean;
  preferredLargePayloadBackend: StorageBackend;
}

export interface StorageCapabilityOptions {
  store?: IndexedJsonKeyValueStore | null;
  namespace?: string;
}

export interface StorageCapabilityDetectOptions {
  force?: boolean;
}

export interface StorageCapability {
  detect(options?: StorageCapabilityDetectOptions): Promise<StorageCapabilitySnapshot>;
  getSnapshot(): StorageCapabilitySnapshot;
  hasIndexedDbSupport(): boolean;
  isDegraded(options?: StorageCapabilityDetectOptions): Promise<boolean>;
  isFallbackMode(options?: StorageCapabilityDetectOptions): Promise<boolean>;
  isIndexedDbUsable(options?: StorageCapabilityDetectOptions): Promise<boolean>;
  resolveLargePayloadBackend(options?: StorageCapabilityDetectOptions): Promise<StorageBackend>;
}

function createDefaultSnapshot({ indexedDbPresent }: { indexedDbPresent?: boolean } = {}): StorageCapabilitySnapshot {
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

export function createStorageCapability({
  store,
  namespace = 'storage-capability',
}: StorageCapabilityOptions = {}): StorageCapability {
  let cachedSnapshot = createDefaultSnapshot({
    indexedDbPresent: Boolean(store?.hasSupport?.()),
  });
  let hasDetected = false;
  let probePromise: Promise<StorageCapabilitySnapshot> | null = null;

  async function probeIndexedDb(): Promise<StorageCapabilitySnapshot> {
    const indexedDbPresent = Boolean(store?.hasSupport?.());
    if (!indexedDbPresent || !store) {
      cachedSnapshot = createDefaultSnapshot({ indexedDbPresent: false });
      hasDetected = true;
      return cachedSnapshot;
    }

    const probeKey = `${namespace}:probe`;
    let indexedDbOpenable: boolean;
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

  async function detect({ force = false }: StorageCapabilityDetectOptions = {}) {
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
