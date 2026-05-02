import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIndexedJsonKeyValueStore } from '../../src/shared/indexed-storage.js';
import { createStorageCapability } from '../../src/shared/storage-capability.js';

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createRequest(transaction, executor) {
  const request = {
    error: null,
    onerror: null,
    onsuccess: null,
    result: undefined,
  };

  queueMicrotask(() => {
    try {
      request.result = cloneJson(executor());
      request.onsuccess?.({ target: request });
      queueMicrotask(() => {
        transaction.oncomplete?.({ target: transaction });
      });
    } catch (error) {
      request.error = error;
      transaction.error = error;
      request.onerror?.({ target: request });
      queueMicrotask(() => {
        transaction.onabort?.({ target: transaction });
      });
    }
  });

  return request;
}

function createWritableIndexedDb() {
  const records = new Map();
  const objectStoreNames = new Set();
  const database = {
    objectStoreNames: {
      contains(name) {
        return objectStoreNames.has(name);
      },
    },
    createObjectStore(name) {
      objectStoreNames.add(name);
      return {};
    },
    transaction() {
      const transaction = {
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore() {
          return {
            delete(key) {
              return createRequest(transaction, () => {
                records.delete(key);
                return undefined;
              });
            },
            get(key) {
              return createRequest(transaction, () => records.get(key));
            },
            put(value, key) {
              return createRequest(transaction, () => {
                records.set(key, cloneJson(value));
                return undefined;
              });
            },
          };
        },
      };

      return transaction;
    },
  };

  return {
    open: vi.fn(() => {
      const request = {
        error: null,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: database,
      };

      queueMicrotask(() => {
        request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });

      return request;
    }),
  };
}

function createBlockedIndexedDb() {
  return {
    open: vi.fn(() => {
      const request = {
        error: new Error('blocked'),
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: null,
      };

      queueMicrotask(() => {
        request.onblocked?.({ target: request });
      });

      return request;
    }),
  };
}

describe('storage capability', () => {
  const originalIndexedDb = globalThis.indexedDB;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
  });

  it('reports localStorage fallback when IndexedDB is unavailable', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const store = createIndexedJsonKeyValueStore({
      dbName: 'storage-capability-missing',
      storeName: 'records',
    });
    const capability = createStorageCapability({
      namespace: 'missing-indexeddb',
      store,
    });

    await expect(capability.detect()).resolves.toMatchObject({
      degraded: false,
      fallbackMode: true,
      indexedDbPresent: false,
      indexedDbWritable: false,
      preferredLargePayloadBackend: 'localStorage',
    });
  });

  it('reports degraded fallback when IndexedDB exists but cannot open', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: createBlockedIndexedDb(),
    });

    const store = createIndexedJsonKeyValueStore({
      dbName: 'storage-capability-blocked',
      storeName: 'records',
    });
    const capability = createStorageCapability({
      namespace: 'blocked-indexeddb',
      store,
    });

    await expect(capability.detect()).resolves.toMatchObject({
      degraded: true,
      fallbackMode: true,
      indexedDbPresent: true,
      indexedDbWritable: false,
      preferredLargePayloadBackend: 'localStorage',
    });
  });

  it('prefers IndexedDB for large payloads when probing succeeds', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: createWritableIndexedDb(),
    });

    const store = createIndexedJsonKeyValueStore({
      dbName: 'storage-capability-usable',
      storeName: 'records',
    });
    const capability = createStorageCapability({
      namespace: 'usable-indexeddb',
      store,
    });

    await expect(capability.detect()).resolves.toMatchObject({
      degraded: false,
      fallbackMode: false,
      indexedDbPresent: true,
      indexedDbWritable: true,
      preferredLargePayloadBackend: 'indexeddb',
    });
  });
});