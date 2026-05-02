import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SINGLE_TAB_MODULE = "../../src/shared/single-tab.js";

async function importSingleTabModule() {
  return import(SINGLE_TAB_MODULE);
}

async function flushAsyncWork(turns = 4) {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

async function waitFor(predicate, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await flushAsyncWork(6);
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  return predicate();
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createLeaseRequest(transaction, executor) {
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

function createSingleTabIndexedDbDatabase() {
  const records = new Map();
  const objectStoreNames = new Set();
  let closed = false;

  const database = {
    __records: records,
    objectStoreNames: {
      contains(name) {
        return objectStoreNames.has(name);
      },
    },
    onclose: null,
    onversionchange: null,
    close() {
      closed = true;
      database.onclose?.({ target: database });
    },
    createObjectStore(name) {
      objectStoreNames.add(name);
      return {};
    },
    transaction() {
      if (closed) {
        throw new Error("Database is closed");
      }

      const transaction = {
        onabort: null,
        oncomplete: null,
        onerror: null,
        error: null,
        objectStore() {
          return {
            get(key) {
              return createLeaseRequest(transaction, () => ({
                result: records.has(key) ? records.get(key) : undefined,
              }));
            },
            put(value, key) {
              return createLeaseRequest(transaction, () => ({
                commit: () => {
                  records.set(key, cloneJson(value));
                },
              }));
            },
            delete(key) {
              return createLeaseRequest(transaction, () => ({
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
    fireVersionChange() {
      database.onversionchange?.({ target: database });
    },
  };

  return database;
}

function createSequencedIndexedDb(steps) {
  let openIndex = 0;

  return {
    open: vi.fn(() => {
      const step = steps[Math.min(openIndex, steps.length - 1)];
      openIndex += 1;
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
    }),
  };
}

describe("single tab guard", () => {
  const originalLocks = navigator.locks;
  const originalIndexedDb = globalThis.indexedDB;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    delete document.documentElement.dataset.singleTabBlocked;
    vi.resetModules();

    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  afterEach(async () => {
    const module = await importSingleTabModule();
    module.releaseSingleTabOwnership();

    localStorage.clear();
    document.body.innerHTML = "";
    delete document.documentElement.dataset.singleTabBlocked;
    vi.restoreAllMocks();
    vi.resetModules();

    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: originalLocks,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
  });

  it("acquires a browser lock when the Locks API is available", async () => {
    const request = vi.fn((_lockName, _options, callback) => callback({ name: "vatioboard" }));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });

    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(true);
    expect(module.hasSingleTabOwnership()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("shows a blocking overlay when another tab already owns the browser lock", async () => {
    const request = vi.fn((_lockName, _options, callback) => callback(null));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });

    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(false);
    expect(module.hasSingleTabOwnership()).toBe(false);

    const overlay = document.querySelector('[role="alertdialog"]');
    expect(overlay).not.toBeNull();
    expect(overlay.hidden).toBe(false);
    expect(document.documentElement.dataset.singleTabBlocked).toBe("true");
  });

  it("blocks ownership when atomic browser primitives are unavailable", async () => {
    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(false);
    expect(module.hasSingleTabOwnership()).toBe(false);
    expect(document.documentElement.dataset.singleTabBlocked).toBe("true");
  });

  it("emits ownership changes when the active tab is acquired and released", async () => {
    const request = vi.fn((_lockName, _options, callback) => callback({ name: "vatioboard" }));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });
    const module = await importSingleTabModule();
    const events = [];
    window.addEventListener("vatioboard:single-tab-ownership", (event) => {
      events.push(event.detail);
    });

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(true);
    module.releaseSingleTabOwnership();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owned: true,
          reason: "acquired",
          scope: "app",
        }),
        expect.objectContaining({
          owned: false,
          reason: "released",
          scope: "app",
        }),
      ])
    );
  });

  it("blocks duplicate tabs when the browser lock is unavailable", async () => {
    const request = vi.fn((_lockName, _options, callback) => callback(null));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });

    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(false);
    expect(module.hasSingleTabOwnership()).toBe(false);
    expect(document.documentElement.dataset.singleTabBlocked).toBe("true");
  });

  it("reacquires ownership after releasing on pagehide", async () => {
    const request = vi.fn((_lockName, _options, callback) => callback({ name: "vatioboard" }));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });
    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(true);

    window.dispatchEvent(new Event("pagehide"));
    expect(module.hasSingleTabOwnership()).toBe(false);

    await expect(module.ensureSingleTabOwnership({ force: true })).resolves.toBe(true);
    expect(module.hasSingleTabOwnership()).toBe(true);
    expect(document.documentElement.dataset.singleTabBlocked).toBe("false");
  });

  it("reuses an in-flight ownership attempt for non-forced callers", async () => {
    let grantLock = null;
    const request = vi.fn((_lockName, _options, callback) => {
      grantLock = () => {
        void callback({ name: "vatioboard" });
      };
      return new Promise(() => {});
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });

    const module = await importSingleTabModule();

    const firstOwnershipPromise = module.ensureSingleTabOwnership({ force: true });
    const secondOwnershipPromise = module.ensureSingleTabOwnership();

    expect(request).toHaveBeenCalledTimes(1);
    expect(typeof grantLock).toBe("function");

    grantLock();
    await expect(firstOwnershipPromise).resolves.toBe(true);
    await expect(secondOwnershipPromise).resolves.toBe(true);
    expect(module.hasSingleTabOwnership()).toBe(true);
  });

  it("reuses an in-flight ownership attempt for forced callers too", async () => {
    let grantLock = null;
    const request = vi.fn((_lockName, _options, callback) => {
      grantLock = () => {
        void callback({ name: "vatioboard" });
      };
      return new Promise(() => {});
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });

    const module = await importSingleTabModule();

    const firstOwnershipPromise = module.ensureSingleTabOwnership({ force: true });
    const secondOwnershipPromise = module.ensureSingleTabOwnership({ force: true });

    expect(request).toHaveBeenCalledTimes(1);
    expect(typeof grantLock).toBe("function");

    grantLock();
    await expect(firstOwnershipPromise).resolves.toBe(true);
    await expect(secondOwnershipPromise).resolves.toBe(true);
    expect(module.hasSingleTabOwnership()).toBe(true);
  });

  it("shows the blocker when persisted pageshow cannot reacquire ownership", async () => {
    const request = vi
      .fn()
      .mockImplementationOnce((_lockName, _options, callback) => callback({ name: "vatioboard" }))
      .mockImplementation((_lockName, _options, callback) => callback(null));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      writable: true,
      value: { request },
    });
    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(true);

    window.dispatchEvent(new Event("pagehide"));

    const restoreEvent = new Event("pageshow");
    Object.defineProperty(restoreEvent, "persisted", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(restoreEvent);
    const blocked = await waitFor(
      () =>
        module.hasSingleTabOwnership() === false
        && document.documentElement.dataset.singleTabBlocked === "true"
    );

    expect(blocked).toBe(true);
    expect(module.hasSingleTabOwnership()).toBe(false);
    expect(document.documentElement.dataset.singleTabBlocked).toBe("true");
    expect(document.querySelector('[role="alertdialog"]')?.hidden).toBe(false);
  });

  it("retries the IndexedDB lease fallback after a transient blocked open", async () => {
    const database = createSingleTabIndexedDbDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "blocked" },
      { type: "success", database },
    ]);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(false);
    await expect(module.ensureSingleTabOwnership({ force: true })).resolves.toBe(true);
    expect(module.hasSingleTabOwnership()).toBe(true);
    expect(fakeIndexedDb.open).toHaveBeenCalledTimes(2);
  });

  it("blocks duplicate fallback tabs while the lease hint is still fresh", async () => {
    const database = createSingleTabIndexedDbDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "success", database },
    ]);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const firstModule = await importSingleTabModule();
    await expect(firstModule.ensureSingleTabOwnership()).resolves.toBe(true);

    vi.resetModules();
    const secondModule = await importSingleTabModule();
    await expect(secondModule.ensureSingleTabOwnership({ force: true })).resolves.toBe(false);
    expect(secondModule.hasSingleTabOwnership()).toBe(false);
  });

  it("keeps duplicate fallback tabs blocked for the full lease lifetime", async () => {
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    const database = createSingleTabIndexedDbDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "success", database },
    ]);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const firstModule = await importSingleTabModule();
    await expect(firstModule.ensureSingleTabOwnership()).resolves.toBe(true);

    nowMs = 13_000;
    vi.resetModules();
    const secondModule = await importSingleTabModule();
    await expect(secondModule.ensureSingleTabOwnership({ force: true })).resolves.toBe(false);
    expect(secondModule.hasSingleTabOwnership()).toBe(false);
  });

  it("blocks duplicate fallback tabs when the lease hint cannot be persisted", async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (String(key).startsWith("vatioboard.single_tab.hint:")) {
        throw new Error("blocked");
      }
      return originalSetItem.call(this, key, value);
    });

    const database = createSingleTabIndexedDbDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "success", database },
    ]);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const firstModule = await importSingleTabModule();
    await expect(firstModule.ensureSingleTabOwnership()).resolves.toBe(true);

    vi.resetModules();
    const secondModule = await importSingleTabModule();
    await expect(secondModule.ensureSingleTabOwnership({ force: true })).resolves.toBe(false);
    expect(secondModule.hasSingleTabOwnership()).toBe(false);
  });

  it("blocks duplicate fallback tabs when the lease hint cannot be read", async () => {
    const database = createSingleTabIndexedDbDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "success", database },
    ]);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const firstModule = await importSingleTabModule();
    await expect(firstModule.ensureSingleTabOwnership()).resolves.toBe(true);

    const originalGetItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (key) {
      if (String(key).startsWith("vatioboard.single_tab.hint:")) {
        throw new Error("blocked");
      }
      return originalGetItem.call(this, key);
    });

    vi.resetModules();
    const secondModule = await importSingleTabModule();
    await expect(secondModule.ensureSingleTabOwnership({ force: true })).resolves.toBe(false);
    expect(secondModule.hasSingleTabOwnership()).toBe(false);
  });

  it("allows immediate fallback reacquire when the old lease record survives but the hint is cleared", async () => {
    const database = createSingleTabIndexedDbDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "success", database },
    ]);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const firstModule = await importSingleTabModule();
    await expect(firstModule.ensureSingleTabOwnership()).resolves.toBe(true);

    const leaseEntries = Array.from(database.__records.entries());
    firstModule.releaseSingleTabOwnership();
    await flushAsyncWork(6);
    for (const [key, value] of leaseEntries) {
      database.__records.set(key, cloneJson(value));
    }

    vi.resetModules();
    const secondModule = await importSingleTabModule();
    await expect(secondModule.ensureSingleTabOwnership({ force: true })).resolves.toBe(true);
    expect(secondModule.hasSingleTabOwnership()).toBe(true);
  });

  it("reopens the IndexedDB lease fallback after the cached handle is invalidated", async () => {
    const firstDatabase = createSingleTabIndexedDbDatabase();
    const secondDatabase = createSingleTabIndexedDbDatabase();
    const fakeIndexedDb = createSequencedIndexedDb([
      { type: "success", database: firstDatabase },
      { type: "success", database: secondDatabase },
    ]);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });

    const module = await importSingleTabModule();

    await expect(module.ensureSingleTabOwnership()).resolves.toBe(true);
    module.releaseSingleTabOwnership();
    firstDatabase.fireVersionChange();
    await flushAsyncWork(6);

    await expect(module.ensureSingleTabOwnership({ force: true })).resolves.toBe(true);
    expect(module.hasSingleTabOwnership()).toBe(true);
    expect(fakeIndexedDb.open).toHaveBeenCalledTimes(2);
  });
});
