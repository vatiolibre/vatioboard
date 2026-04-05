import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";

const CLOUD_LIBRARY_DB_NAME = "vatioboard-cloud-library";
const CLOUD_LIBRARY_DB_VERSION = 1;
const CLOUD_LIBRARY_DB_STORE = "cloudLibraryCache";
const DETAIL_TTL_MS = 5 * 60 * 1000;

const detailStore = createIndexedJsonKeyValueStore({
  dbName: CLOUD_LIBRARY_DB_NAME,
  dbVersion: CLOUD_LIBRARY_DB_VERSION,
  storeName: CLOUD_LIBRARY_DB_STORE,
});

let detailStoreMutationChain = Promise.resolve();

function cloneJson(value, fallback = null) {
  if (value === null || value === undefined) return value ?? fallback;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function createAbortError() {
  const error = new Error("Request aborted.");
  error.name = "AbortError";
  return error;
}

function createRequestError(result) {
  const error = new Error("Cloud library request failed.");
  error.name = "CloudLibraryRequestError";
  error.result = cloneJson(result, null);
  error.status = Number(result?.status) || 0;
  return error;
}

function waitForAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => {
      signal.removeEventListener("abort", handleAbort);
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function normalizeName(value) {
  return String(value || "").trim();
}

function stableStringify(value) {
  return JSON.stringify(value ?? {});
}

function createCacheEntry() {
  return {
    fetchedAtMs: 0,
    promise: null,
    requestVersion: 0,
    value: null,
  };
}

function isFresh(entry, ttlMs) {
  return Boolean(entry?.value) && (Date.now() - Number(entry.fetchedAtMs || 0)) < ttlMs;
}

function beginLoad(entry, loader) {
  const requestVersion = entry.requestVersion + 1;
  entry.requestVersion = requestVersion;
  entry.promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (value && typeof value === "object" && value.ok === false) {
        throw createRequestError(value);
      }

      if (entry.requestVersion === requestVersion) {
        entry.value = cloneJson(value, null);
        entry.fetchedAtMs = Date.now();
      }
      return cloneJson(value, null);
    })
    .catch((error) => {
      if (entry.requestVersion === requestVersion && !entry.value) {
        entry.fetchedAtMs = 0;
      }
      throw error;
    })
    .finally(() => {
      if (entry.requestVersion === requestVersion) {
        entry.promise = null;
      }
    });

  return entry.promise;
}

function queueDetailStoreMutation(task) {
  detailStoreMutationChain = detailStoreMutationChain.catch(() => {}).then(task);
  return detailStoreMutationChain;
}

function getDetailEntryKey(resourceKey, mode, name) {
  return `detail:${resourceKey}:${mode}:${name}`;
}

function getDetailIndexKey(resourceKey, mode) {
  return `detail-index:${resourceKey}:${mode}`;
}

async function touchPersistedDetailIndex(resourceKey, mode, name, maxEntries) {
  const indexKey = getDetailIndexKey(resourceKey, mode);
  const indexValue = await detailStore.getValue(indexKey);
  const nextIndex = indexValue && typeof indexValue === "object" ? { ...indexValue } : {};
  nextIndex[name] = Date.now();

  const sortedEntries = Object.entries(nextIndex).sort((left, right) => right[1] - left[1]);
  const keptEntries = sortedEntries.slice(0, maxEntries);
  const evictedEntries = sortedEntries.slice(maxEntries);
  const nextStoredIndex = Object.fromEntries(keptEntries);

  for (const [evictedName] of evictedEntries) {
    await detailStore.deleteValue(getDetailEntryKey(resourceKey, mode, evictedName));
  }

  await detailStore.setValue(indexKey, nextStoredIndex);
}

async function loadPersistedDetail(resourceKey, mode, name, ttlMs, maxEntries) {
  if (!detailStore.hasSupport()) return null;

  const entryKey = getDetailEntryKey(resourceKey, mode, name);
  const storedEntry = await detailStore.getValue(entryKey);
  if (!storedEntry || typeof storedEntry !== "object") {
    return null;
  }

  const fetchedAtMs = Number(storedEntry.fetchedAtMs || 0);
  if (!fetchedAtMs || (Date.now() - fetchedAtMs) >= ttlMs) {
    await queueDetailStoreMutation(async () => {
      await detailStore.deleteValue(entryKey);
      const indexKey = getDetailIndexKey(resourceKey, mode);
      const indexValue = await detailStore.getValue(indexKey);
      if (!indexValue || typeof indexValue !== "object") return;
      const nextIndex = { ...indexValue };
      delete nextIndex[name];
      await detailStore.setValue(indexKey, nextIndex);
    });
    return null;
  }

  void queueDetailStoreMutation(() => touchPersistedDetailIndex(resourceKey, mode, name, maxEntries));
  return cloneJson(storedEntry.value, null);
}

async function savePersistedDetail(resourceKey, mode, name, value, maxEntries) {
  if (!detailStore.hasSupport()) return;

  await queueDetailStoreMutation(async () => {
    await detailStore.setValue(getDetailEntryKey(resourceKey, mode, name), {
      fetchedAtMs: Date.now(),
      value: cloneJson(value, null),
    });
    await touchPersistedDetailIndex(resourceKey, mode, name, maxEntries);
  });
}

export function createCloudLibraryResource({
  resourceKey,
  listLoader,
  detailLoader,
  listTtlMs = 15 * 1000,
  detailTtlMs = DETAIL_TTL_MS,
  maxPersistedDetailEntries = 12,
  shouldPersistDetail = ({ mode }) => mode === "full",
} = {}) {
  const listCache = new Map();
  const detailCache = new Map();

  function getListEntry(queryKey) {
    if (!listCache.has(queryKey)) {
      listCache.set(queryKey, createCacheEntry());
    }
    return listCache.get(queryKey);
  }

  function getDetailEntry(detailKey) {
    if (!detailCache.has(detailKey)) {
      detailCache.set(detailKey, createCacheEntry());
    }
    return detailCache.get(detailKey);
  }

  async function list(query = {}, { force = false, signal } = {}) {
    const querySnapshot = cloneJson(query, {});
    const queryKey = stableStringify(querySnapshot);
    const entry = getListEntry(queryKey);

    if (!force && isFresh(entry, listTtlMs)) {
      return cloneJson(entry.value, null);
    }

    if (!force && entry.promise) {
      return cloneJson(await waitForAbort(entry.promise, signal), null);
    }

    return cloneJson(await waitForAbort(
      beginLoad(entry, () => listLoader(querySnapshot)),
      signal
    ), null);
  }

  async function getDetail(name, {
    force = false,
    mode = "summary",
    signal,
  } = {}) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return null;

    const detailKey = `${mode}:${normalizedName}`;
    const entry = getDetailEntry(detailKey);

    if (!force && isFresh(entry, detailTtlMs)) {
      return cloneJson(entry.value, null);
    }

    if (!force && entry.promise) {
      return cloneJson(await waitForAbort(entry.promise, signal), null);
    }

    if (!force && shouldPersistDetail({ mode, name: normalizedName })) {
      const persistedValue = await loadPersistedDetail(
        resourceKey,
        mode,
        normalizedName,
        detailTtlMs,
        maxPersistedDetailEntries
      );
      if (persistedValue !== null) {
        entry.value = cloneJson(persistedValue, null);
        entry.fetchedAtMs = Date.now();
        return cloneJson(persistedValue, null);
      }
    }

    const value = await waitForAbort(
      beginLoad(entry, () => detailLoader(normalizedName, { mode })),
      signal
    );
    if (shouldPersistDetail({ mode, name: normalizedName })) {
      void savePersistedDetail(resourceKey, mode, normalizedName, value, maxPersistedDetailEntries);
    }
    return cloneJson(value, null);
  }

  function invalidateList(query = null) {
    if (query === null) {
      listCache.clear();
      return;
    }

    const queryKey = stableStringify(query);
    const entry = listCache.get(queryKey);
    if (!entry) return;
    entry.requestVersion += 1;
    entry.fetchedAtMs = 0;
    entry.promise = null;
    entry.value = null;
  }

  function invalidateDetail(name = "", { mode = null } = {}) {
    const normalizedName = normalizeName(name);
    if (!normalizedName && mode === null) {
      detailCache.clear();
      void queueDetailStoreMutation(async () => {
        // Clear persisted detail indexes for this resource.
        for (const candidateMode of ["full"]) {
          await detailStore.deleteValue(getDetailIndexKey(resourceKey, candidateMode));
        }
      });
      return;
    }

    const keys = Array.from(detailCache.keys());
    for (const detailKey of keys) {
      const matchesMode = mode === null || detailKey.startsWith(`${mode}:`);
      const matchesName = !normalizedName || detailKey.endsWith(`:${normalizedName}`);
      if (!matchesMode || !matchesName) continue;
      const entry = detailCache.get(detailKey);
      if (!entry) continue;
      entry.requestVersion += 1;
      entry.fetchedAtMs = 0;
      entry.promise = null;
      entry.value = null;
      detailCache.delete(detailKey);
    }

    void queueDetailStoreMutation(async () => {
      const candidateModes = mode === null ? ["full"] : [mode];

      for (const candidateMode of candidateModes) {
        if (!shouldPersistDetail({ mode: candidateMode, name: normalizedName })) {
          continue;
        }

        const indexKey = getDetailIndexKey(resourceKey, candidateMode);
        const indexValue = await detailStore.getValue(indexKey);
        if (indexValue && typeof indexValue === "object") {
          const nextIndex = { ...indexValue };
          if (normalizedName) {
            delete nextIndex[normalizedName];
          }
          await detailStore.setValue(indexKey, nextIndex);
        }
        if (normalizedName) {
          await detailStore.deleteValue(
            getDetailEntryKey(resourceKey, candidateMode, normalizedName)
          );
        }
      }
    });
  }

  return {
    getDetail,
    invalidateDetail,
    invalidateList,
    list,
  };
}
