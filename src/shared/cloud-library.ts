import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";
import { createStorageCapability } from "./storage-capability.js";
import type { JsonObject, JsonValue } from "../types/storage";

const CLOUD_LIBRARY_DB_NAME = "vatioboard-cloud-library";
const CLOUD_LIBRARY_DB_VERSION = 1;
const CLOUD_LIBRARY_DB_STORE = "cloudLibraryCache";
const DETAIL_TTL_MS = 5 * 60 * 1000;

type DetailMode = string | null;
type MaybePromise<T> = T | Promise<T>;

export type CloudLibraryQuery = Record<string, unknown>;

export interface CloudLibraryLoadOptions {
  force?: boolean;
  signal?: AbortSignal | null;
}

export interface CloudLibraryDetailOptions extends CloudLibraryLoadOptions {
  mode?: DetailMode;
}

export interface CloudLibraryPersistDecision {
  mode: DetailMode;
  name: string;
}

export interface CloudLibraryResourceOptions<TListResponse = unknown, TDetailResponse = unknown> {
  resourceKey?: string;
  listLoader?: (
    query: CloudLibraryQuery,
    options: CloudLibraryLoadOptions,
  ) => MaybePromise<TListResponse>;
  detailLoader?: (
    name: string,
    options: CloudLibraryDetailOptions,
  ) => MaybePromise<TDetailResponse>;
  listTtlMs?: number;
  detailTtlMs?: number;
  maxPersistedDetailEntries?: number;
  shouldPersistDetail?: (decision: CloudLibraryPersistDecision) => boolean;
}

export interface CloudLibraryResource<TListResponse = unknown, TDetailResponse = unknown> {
  getDetail(name: unknown, options?: CloudLibraryDetailOptions): Promise<TDetailResponse | null>;
  invalidateDetail(name?: unknown, options?: { mode?: DetailMode }): void;
  invalidateList(query?: CloudLibraryQuery | null): void;
  list(query?: CloudLibraryQuery | null, options?: CloudLibraryLoadOptions): Promise<TListResponse | null>;
}

interface CacheEntry<TValue> {
  fetchedAtMs: number;
  promise: Promise<TValue> | null;
  requestVersion: number;
  value: TValue | null;
}

interface CloudLibraryRequestError extends Error {
  result: unknown;
  status: number;
}

const detailStore = createIndexedJsonKeyValueStore({
  dbName: CLOUD_LIBRARY_DB_NAME,
  dbVersion: CLOUD_LIBRARY_DB_VERSION,
  storeName: CLOUD_LIBRARY_DB_STORE,
});
const detailStoreCapability = createStorageCapability({
  namespace: "cloud-library-detail-cache",
  store: detailStore,
});

let detailStoreMutationChain: Promise<unknown> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function cloneJson<T = unknown>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return (value ?? fallback) as T;

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value as T;
  }
}

function createAbortError(): Error {
  const error = new Error("Request aborted.");
  error.name = "AbortError";
  return error;
}

function createRequestError(result: unknown): CloudLibraryRequestError {
  const error = new Error("Cloud library request failed.") as CloudLibraryRequestError;
  error.name = "CloudLibraryRequestError";
  error.result = cloneJson(result, null);
  error.status = Number(isRecord(result) ? result.status : undefined) || 0;
  return error;
}

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
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
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function normalizeName(value: unknown): string {
  return String(value || "").trim();
}

function stableStringify(value: unknown): string | undefined {
  return JSON.stringify(value ?? {});
}

function createCacheEntry<TValue>(): CacheEntry<TValue> {
  return {
    fetchedAtMs: 0,
    promise: null,
    requestVersion: 0,
    value: null,
  };
}

function isFresh<TValue>(entry: CacheEntry<TValue> | undefined, ttlMs: number): boolean {
  return Boolean(entry?.value) && (Date.now() - Number(entry.fetchedAtMs || 0)) < ttlMs;
}

function beginLoad<TValue>(entry: CacheEntry<TValue>, loader: () => MaybePromise<TValue>): Promise<TValue> {
  const requestVersion = entry.requestVersion + 1;
  entry.requestVersion = requestVersion;
  entry.promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (value && typeof value === "object" && (value as { ok?: unknown }).ok === false) {
        throw createRequestError(value);
      }

      if (entry.requestVersion === requestVersion) {
        entry.value = cloneJson<TValue | null>(value, null);
        entry.fetchedAtMs = Date.now();
      }
      return cloneJson<TValue>(value, null as TValue);
    })
    .catch((error: unknown) => {
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

function queueDetailStoreMutation<TValue>(task: () => MaybePromise<TValue>): Promise<TValue> {
  const nextMutation = detailStoreMutationChain.catch(() => undefined).then(task);
  detailStoreMutationChain = nextMutation;
  return nextMutation;
}

function getDetailEntryKey(resourceKey: string | undefined, mode: DetailMode, name: string): string {
  return `detail:${resourceKey}:${mode}:${name}`;
}

function getDetailIndexKey(resourceKey: string | undefined, mode: DetailMode): string {
  return `detail-index:${resourceKey}:${mode}`;
}

async function touchPersistedDetailIndex(
  resourceKey: string | undefined,
  mode: DetailMode,
  name: string,
  maxEntries: number,
): Promise<void> {
  const indexKey = getDetailIndexKey(resourceKey, mode);
  const indexValue = await detailStore.getValue(indexKey);
  const nextIndex: JsonObject = indexValue && typeof indexValue === "object"
    ? { ...(indexValue as JsonObject) }
    : {};
  nextIndex[name] = Date.now();

  const sortedEntries = Object.entries(nextIndex).sort(
    (left, right) => (right[1] as number) - (left[1] as number),
  );
  const keptEntries = sortedEntries.slice(0, maxEntries);
  const evictedEntries = sortedEntries.slice(maxEntries);
  const nextStoredIndex = Object.fromEntries(keptEntries) as JsonObject;

  for (const [evictedName] of evictedEntries) {
    await detailStore.deleteValue(getDetailEntryKey(resourceKey, mode, evictedName));
  }

  await detailStore.setValue(indexKey, nextStoredIndex);
}

async function loadPersistedDetail<TValue>(
  resourceKey: string | undefined,
  mode: DetailMode,
  name: string,
  ttlMs: number,
  maxEntries: number,
): Promise<TValue | null> {
  if (!(await detailStoreCapability.isIndexedDbUsable())) return null;

  const entryKey = getDetailEntryKey(resourceKey, mode, name);
  const storedEntry = await detailStore.getValue(entryKey);
  if (!storedEntry || typeof storedEntry !== "object") {
    return null;
  }

  const storedRecord = storedEntry as JsonObject;
  const fetchedAtMs = Number(storedRecord.fetchedAtMs || 0);
  if (!fetchedAtMs || (Date.now() - fetchedAtMs) >= ttlMs) {
    await queueDetailStoreMutation(async () => {
      await detailStore.deleteValue(entryKey);
      const indexKey = getDetailIndexKey(resourceKey, mode);
      const indexValue = await detailStore.getValue(indexKey);
      if (!indexValue || typeof indexValue !== "object") return;
      const nextIndex: JsonObject = { ...(indexValue as JsonObject) };
      delete nextIndex[name];
      await detailStore.setValue(indexKey, nextIndex);
    });
    return null;
  }

  void queueDetailStoreMutation(() => touchPersistedDetailIndex(resourceKey, mode, name, maxEntries));
  return cloneJson<TValue | null>(storedRecord.value, null);
}

async function savePersistedDetail(
  resourceKey: string | undefined,
  mode: DetailMode,
  name: string,
  value: unknown,
  maxEntries: number,
): Promise<void> {
  if (!(await detailStoreCapability.isIndexedDbUsable())) return;

  await queueDetailStoreMutation(async () => {
    await detailStore.setValue(getDetailEntryKey(resourceKey, mode, name), {
      fetchedAtMs: Date.now(),
      value: cloneJson<JsonValue | null>(value, null),
    });
    await touchPersistedDetailIndex(resourceKey, mode, name, maxEntries);
  });
}

export function createCloudLibraryResource<TListResponse = unknown, TDetailResponse = unknown>({
  resourceKey,
  listLoader,
  detailLoader,
  listTtlMs = 15 * 1000,
  detailTtlMs = DETAIL_TTL_MS,
  maxPersistedDetailEntries = 12,
  shouldPersistDetail = ({ mode }) => mode === "full",
}: CloudLibraryResourceOptions<TListResponse, TDetailResponse> = {}): CloudLibraryResource<
  TListResponse,
  TDetailResponse
> {
  const listCache = new Map<string | undefined, CacheEntry<TListResponse>>();
  const detailCache = new Map<string, CacheEntry<TDetailResponse>>();

  function getListEntry(queryKey: string | undefined): CacheEntry<TListResponse> {
    if (!listCache.has(queryKey)) {
      listCache.set(queryKey, createCacheEntry());
    }
    return listCache.get(queryKey)!;
  }

  function getDetailEntry(detailKey: string): CacheEntry<TDetailResponse> {
    if (!detailCache.has(detailKey)) {
      detailCache.set(detailKey, createCacheEntry());
    }
    return detailCache.get(detailKey)!;
  }

  async function list(
    query: CloudLibraryQuery | null = {},
    { force = false, signal }: CloudLibraryLoadOptions = {},
  ): Promise<TListResponse | null> {
    const querySnapshot = cloneJson<CloudLibraryQuery>(query, {});
    const queryKey = stableStringify(querySnapshot);
    const entry = getListEntry(queryKey);

    if (!force && isFresh(entry, listTtlMs)) {
      return cloneJson<TListResponse | null>(entry.value, null);
    }

    if (!force && entry.promise) {
      return cloneJson<TListResponse | null>(await waitForAbort(entry.promise, signal), null);
    }

    return cloneJson<TListResponse | null>(await waitForAbort(
      beginLoad(entry, () => listLoader!(querySnapshot, { force, signal })),
      signal,
    ), null);
  }

  async function getDetail(name: unknown, {
    force = false,
    mode = "summary",
    signal,
  }: CloudLibraryDetailOptions = {}): Promise<TDetailResponse | null> {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return null;

    const detailKey = `${mode}:${normalizedName}`;
    const entry = getDetailEntry(detailKey);

    if (!force && isFresh(entry, detailTtlMs)) {
      return cloneJson<TDetailResponse | null>(entry.value, null);
    }

    if (!force && entry.promise) {
      return cloneJson<TDetailResponse | null>(await waitForAbort(entry.promise, signal), null);
    }

    if (!force && shouldPersistDetail({ mode, name: normalizedName })) {
      const persistedValue = await loadPersistedDetail<TDetailResponse>(
        resourceKey,
        mode,
        normalizedName,
        detailTtlMs,
        maxPersistedDetailEntries,
      );
      if (persistedValue !== null) {
        entry.value = cloneJson<TDetailResponse | null>(persistedValue, null);
        entry.fetchedAtMs = Date.now();
        return cloneJson<TDetailResponse | null>(persistedValue, null);
      }
    }

    const value = await waitForAbort(
      beginLoad(entry, () => detailLoader!(normalizedName, { mode, signal })),
      signal,
    );
    if (shouldPersistDetail({ mode, name: normalizedName })) {
      void savePersistedDetail(resourceKey, mode, normalizedName, value, maxPersistedDetailEntries);
    }
    return cloneJson<TDetailResponse | null>(value, null);
  }

  function invalidateList(query: CloudLibraryQuery | null = null): void {
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

  function invalidateDetail(name: unknown = "", { mode = null }: { mode?: DetailMode } = {}): void {
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
          const nextIndex: JsonObject = { ...(indexValue as JsonObject) };
          if (normalizedName) {
            delete nextIndex[normalizedName];
          }
          await detailStore.setValue(indexKey, nextIndex);
        }
        if (normalizedName) {
          await detailStore.deleteValue(
            getDetailEntryKey(resourceKey, candidateMode, normalizedName),
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
