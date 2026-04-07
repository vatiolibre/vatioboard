import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INDEXED_STORAGE_MODULE = "../../src/shared/indexed-storage.js";

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createRequest(transaction, executor) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  };

  queueMicrotask(() => {
    try {
      const outcome = executor() || {};

      request.result = cloneJson(outcome.result);
      request.onsuccess?.({ target: request });

      queueMicrotask(() => {
        if (outcome.abort) {
          const error = outcome.error ?? new Error("Transaction aborted");
          transaction.error = error;
          transaction.onabort?.({ target: transaction });
          return;
        }

        outcome.commit?.();
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

function createFakeDatabase({
  shouldAbortPut = () => false,
  shouldAbortDelete = () => false,
} = {}) {
  const records = new Map();
  const objectStoreNames = new Set();

  return {
    __records: records,
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
        onabort: null,
        oncomplete: null,
        onerror: null,
        error: null,
        objectStore() {
          return {
            get(key) {
              return createRequest(transaction, () => ({
                result: records.has(key) ? records.get(key) : undefined,
              }));
            },
            put(value, key) {
              return createRequest(transaction, () => ({
                abort: shouldAbortPut(key, cloneJson(value)),
                commit: () => {
                  records.set(key, cloneJson(value));
                },
              }));
            },
            delete(key) {
              return createRequest(transaction, () => ({
                abort: shouldAbortDelete(key),
                commit: () => {
                  records.delete(key);
                },
              }));
            },
          };
        },
      };

      return transaction;
    },
  };
}

function createOpenRequest(step) {
  const request = {
    result: step.database ?? null,
    error: step.error ?? null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  };

  queueMicrotask(() => {
    if (step.type === "blocked") {
      request.onblocked?.({ target: request });
      return;
    }

    if (step.type === "error") {
      request.onerror?.({ target: request });
      return;
    }

    request.onupgradeneeded?.({ target: request });
    request.onsuccess?.({ target: request });
  });

  return request;
}

function createSequencedIndexedDb(steps) {
  let openIndex = 0;

  return {
    open: vi.fn(() => {
      const step = steps[Math.min(openIndex, steps.length - 1)];
      openIndex += 1;
      return createOpenRequest(step);
    }),
  };
}

async function importIndexedStorageModule() {
  return import(INDEXED_STORAGE_MODULE);
}

describe("indexed storage helper", () => {
  const originalIndexedDb = globalThis.indexedDB;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
    vi.resetModules();
  });

  it("waits for transaction completion before reporting writes and deletes as successful", async () => {
    const database = createFakeDatabase({
      shouldAbortPut: (key) => key === "broken-write",
      shouldAbortDelete: (key) => key === "broken-delete",
    });
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "success", database },
    ]);

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const { createIndexedJsonKeyValueStore } = await importIndexedStorageModule();
    const store = createIndexedJsonKeyValueStore({
      dbName: "test-indexed-storage",
      storeName: "records",
    });

    await expect(store.setValue("broken-write", { ok: false })).resolves.toBe(false);
    expect(database.__records.has("broken-write")).toBe(false);

    await expect(store.setValue("broken-delete", { ok: true })).resolves.toBe(true);
    await expect(store.deleteValue("broken-delete")).resolves.toBe(false);
    expect(database.__records.get("broken-delete")).toEqual({ ok: true });
  });

  it("retries opening IndexedDB after a transient blocked open", async () => {
    const database = createFakeDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "blocked" },
      { type: "success", database },
    ]);

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const { createIndexedJsonKeyValueStore } = await importIndexedStorageModule();
    const store = createIndexedJsonKeyValueStore({
      dbName: "test-indexed-storage-retry",
      storeName: "records",
    });

    await expect(store.openDatabase()).resolves.toBeNull();
    await expect(store.setValue("retry", { ok: true })).resolves.toBe(true);
    await expect(store.getValue("retry")).resolves.toEqual({ ok: true });
    expect(fakeIndexedDb.open).toHaveBeenCalledTimes(2);
  });

  it("resolves openDatabase with null when indexedDB.open never fires a callback", async () => {
    vi.useFakeTimers();

    const fakeIndexedDb = {
      open: vi.fn(() => ({
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      })),
    };

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const { createIndexedJsonKeyValueStore } = await importIndexedStorageModule();
    const store = createIndexedJsonKeyValueStore({
      dbName: "test-indexed-storage-hang",
      storeName: "records",
    });

    const openPromise = store.openDatabase();
    await vi.advanceTimersByTimeAsync(3500);

    await expect(openPromise).resolves.toBeNull();
    expect(fakeIndexedDb.open).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
