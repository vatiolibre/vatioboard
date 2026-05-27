const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_MIN_INTERVAL_MS = 1000;
const SCHEDULE_KEY_PREFIX = "vatio_nominatim_next_allowed:";
const CACHE_KEY_PREFIX = "vatio_nominatim_cache:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type WaitLike = (ms: number) => Promise<unknown>;
type NominatimParams = Record<string, unknown>;

export type NominatimErrorOptions = {
  status?: number | null;
  url?: string;
  payload?: unknown;
};

export type NominatimClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  wait?: WaitLike;
  minIntervalMs?: number;
  scheduleStorage?: StorageLike | null;
  cacheStorage?: StorageLike | null;
  allowPublicDetails?: boolean;
};

export type NominatimResponseMeta = {
  baseUrl: string;
  endpoint: string;
  fromCache: boolean;
  status: number;
  url: string;
  cachedAtMs: number | null;
};

export type NominatimResponse<T = unknown> = {
  data: T;
  meta: NominatimResponseMeta;
};

export type NominatimClient = {
  baseUrl: string;
  isPublicServer: boolean;
  search(params?: NominatimParams): Promise<NominatimResponse>;
  reverse(params?: NominatimParams): Promise<NominatimResponse>;
  lookup(params?: NominatimParams & { osmIds?: unknown; osm_ids?: unknown }): Promise<NominatimResponse>;
  status(params?: NominatimParams): Promise<NominatimResponse>;
  details(params?: NominatimParams): Promise<NominatimResponse>;
  clearCachedResponse(requestUrl: string): void;
};

type SchedulerState = {
  tail: Promise<unknown>;
  nextAllowedAtMs: number;
};

type SchedulerOptions = {
  now: () => number;
  wait: WaitLike;
  minIntervalMs: number;
  scheduleStorage: StorageLike | null;
};

type CachedResponse = {
  data: unknown;
  cachedAtMs: number | null;
};

const schedulerStateByBaseUrl = new Map<string, SchedulerState>();

export class NominatimError extends Error {
  status: number | null;
  url: string;
  payload: unknown | null;

  constructor(message: string, options: NominatimErrorOptions = {}) {
    super(message);
    this.name = "NominatimError";
    this.status = Number.isFinite(options.status) ? options.status : null;
    this.url = options.url || "";
    this.payload = options.payload === undefined ? null : options.payload;
  }
}

export class NominatimPolicyError extends NominatimError {
  constructor(message: string, options: NominatimErrorOptions = {}) {
    super(message, options);
    this.name = "NominatimPolicyError";
  }
}

function getDefaultStorage(storage: StorageLike | null | undefined): StorageLike | null {
  try {
    return storage || null;
  } catch {
    return null;
  }
}

function createDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeBaseUrl(baseUrl: unknown): string {
  const rawValue = typeof baseUrl === "string" ? baseUrl.trim() : "";
  const candidate = rawValue || DEFAULT_BASE_URL;

  try {
    const parsed = new URL(candidate);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function isNonEmptyValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function buildSearchParams(params: NominatimParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  Object.entries(params)
    .filter(([, value]) => isNonEmptyValue(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => {
      searchParams.set(key, String(value));
    });
  return searchParams;
}

function parseResponsePayload(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getStorageValue(storage: StorageLike | null, key: string): string | null {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageValue(storage: StorageLike | null, key: string, value: string): void {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage quota/privacy mode errors.
  }
}

function removeStorageValue(storage: StorageLike | null, key: string): void {
  if (!storage || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

function getScheduleStorageKey(baseUrl: string): string {
  return `${SCHEDULE_KEY_PREFIX}${encodeURIComponent(baseUrl)}`;
}

function getCacheStorageKey(requestUrl: string): string {
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(requestUrl)}`;
}

function readCachedResponse(cacheStorage: StorageLike | null, requestUrl: string): CachedResponse | null {
  const storedValue = getStorageValue(cacheStorage, getCacheStorageKey(requestUrl));
  if (!storedValue) return null;

  try {
    const parsed = JSON.parse(storedValue);
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) {
      return null;
    }
    return {
      data: parsed.data,
      cachedAtMs: Number.isFinite(parsed.cachedAtMs) ? parsed.cachedAtMs : null,
    };
  } catch {
    removeStorageValue(cacheStorage, getCacheStorageKey(requestUrl));
    return null;
  }
}

function writeCachedResponse(cacheStorage: StorageLike | null, requestUrl: string, data: unknown): void {
  setStorageValue(
    cacheStorage,
    getCacheStorageKey(requestUrl),
    JSON.stringify({
      cachedAtMs: Date.now(),
      data,
    }),
  );
}

function readNextAllowedAt(scheduleStorage: StorageLike | null, baseUrl: string): number {
  const storedValue = Number(getStorageValue(scheduleStorage, getScheduleStorageKey(baseUrl)));
  return Number.isFinite(storedValue) ? storedValue : 0;
}

function writeNextAllowedAt(scheduleStorage: StorageLike | null, baseUrl: string, nextAllowedAtMs: number): void {
  setStorageValue(scheduleStorage, getScheduleStorageKey(baseUrl), String(nextAllowedAtMs));
}

function getScheduler(baseUrl: string, options: SchedulerOptions) {
  if (!schedulerStateByBaseUrl.has(baseUrl)) {
    schedulerStateByBaseUrl.set(baseUrl, {
      tail: Promise.resolve(),
      nextAllowedAtMs: 0,
    });
  }

  const state = schedulerStateByBaseUrl.get(baseUrl)!;
  const {
    now,
    wait,
    minIntervalMs,
    scheduleStorage,
  } = options;

  return {
    schedule<T>(task: () => Promise<T> | T): Promise<T> {
      const queuedTask = state.tail.catch(() => undefined).then(async () => {
        const storedNextAllowedAtMs = readNextAllowedAt(scheduleStorage, baseUrl);
        const currentNow = now();
        const startAtMs = Math.max(currentNow, storedNextAllowedAtMs, state.nextAllowedAtMs);
        const waitMs = Math.max(0, startAtMs - currentNow);
        const nextAllowedAtMs = startAtMs + minIntervalMs;

        state.nextAllowedAtMs = nextAllowedAtMs;
        writeNextAllowedAt(scheduleStorage, baseUrl, nextAllowedAtMs);

        if (waitMs > 0) {
          await wait(waitMs);
        }

        return task();
      });

      state.tail = queuedTask.catch(() => undefined);
      return queuedTask;
    },
  };
}

function createRequestUrl(baseUrl: string, endpoint: string, params: NominatimParams): URL {
  const requestUrl = new URL(endpoint.replace(/^\//, ""), `${baseUrl}/`);
  requestUrl.search = buildSearchParams(params).toString();
  return requestUrl;
}

export function isPublicNominatimServer(baseUrl: unknown): boolean {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).hostname === "nominatim.openstreetmap.org";
  } catch {
    return false;
  }
}

export function normalizeNominatimBaseUrl(baseUrl: unknown): string {
  return normalizeBaseUrl(baseUrl);
}

export function createNominatimClient(options: NominatimClientOptions = {}): NominatimClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl || window.fetch.bind(window);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const wait = typeof options.wait === "function" ? options.wait : createDelay;
  const minIntervalMs = Math.max(DEFAULT_MIN_INTERVAL_MS, Number(options.minIntervalMs) || DEFAULT_MIN_INTERVAL_MS);
  const scheduleStorage = getDefaultStorage(options.scheduleStorage || window.localStorage);
  const cacheStorage = getDefaultStorage(options.cacheStorage || window.sessionStorage);
  const isPublicServer = isPublicNominatimServer(baseUrl);
  const scheduler = getScheduler(baseUrl, {
    now,
    wait,
    minIntervalMs,
    scheduleStorage,
  });

  async function requestJson(
    endpoint: string,
    params: NominatimParams = {},
    requestOptions: { cache?: boolean } = {}
  ): Promise<NominatimResponse> {
    const requestUrl = createRequestUrl(baseUrl, endpoint, params);
    const cacheKey = requestUrl.toString();
    const useCache = requestOptions.cache !== false;

    if (useCache) {
      const cachedResponse = readCachedResponse(cacheStorage, cacheKey);
      if (cachedResponse) {
        return {
          data: cloneJson(cachedResponse.data),
          meta: {
            baseUrl,
            endpoint,
            fromCache: true,
            status: 200,
            url: cacheKey,
            cachedAtMs: cachedResponse.cachedAtMs,
          },
        };
      }
    }

    const response = await scheduler.schedule(() => fetchImpl(cacheKey, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }));

    const bodyText = await response.text();
    const payload = parseResponsePayload(bodyText);

    if (!response.ok) {
      const errorPayload = payload && typeof payload === "object" ? (payload as { error?: unknown }) : null;
      throw new NominatimError(
        typeof errorPayload?.error === "string"
          ? errorPayload.error
          : `Nominatim request failed with status ${response.status}`,
        {
          status: response.status,
          url: cacheKey,
          payload,
        },
      );
    }

    if (useCache) {
      writeCachedResponse(cacheStorage, cacheKey, payload);
    }

    return {
      data: payload,
      meta: {
        baseUrl,
        endpoint,
        fromCache: false,
        status: response.status,
        url: cacheKey,
        cachedAtMs: null,
      },
    };
  }

  return {
    baseUrl,
    isPublicServer,
    search(params: NominatimParams = {}) {
      return requestJson("search", {
        format: "jsonv2",
        addressdetails: 1,
        limit: 5,
        ...params,
      });
    },
    reverse(params: NominatimParams = {}) {
      return requestJson("reverse", {
        format: "jsonv2",
        addressdetails: 1,
        zoom: 18,
        ...params,
      });
    },
    lookup(params: NominatimParams & { osmIds?: unknown; osm_ids?: unknown } = {}) {
      const normalizedParams = { ...params };
      if (normalizedParams.osmIds && !normalizedParams.osm_ids) {
        normalizedParams.osm_ids = normalizedParams.osmIds;
        delete normalizedParams.osmIds;
      }

      return requestJson("lookup", {
        format: "jsonv2",
        addressdetails: 1,
        ...normalizedParams,
      });
    },
    status(params: NominatimParams = {}) {
      return requestJson("status", {
        format: "json",
        ...params,
      }, { cache: false });
    },
    details(params: NominatimParams = {}) {
      if (isPublicServer && options.allowPublicDetails !== true) {
        return Promise.reject(new NominatimPolicyError(
          "The public Nominatim details endpoint may not be used in scripts or bots. Switch to a self-hosted or third-party Nominatim service to test details.",
          {
            status: 400,
            url: createRequestUrl(baseUrl, "details", params).toString(),
          },
        ));
      }

      return requestJson("details", params, { cache: false });
    },
    clearCachedResponse(requestUrl: string) {
      removeStorageValue(cacheStorage, getCacheStorageKey(requestUrl));
    },
  };
}

export function __resetNominatimTestState(): void {
  schedulerStateByBaseUrl.clear();
}

export { DEFAULT_BASE_URL as NOMINATIM_DEFAULT_BASE_URL };
