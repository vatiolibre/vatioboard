const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_MIN_INTERVAL_MS = 1000;
const SCHEDULE_KEY_PREFIX = "vatio_nominatim_next_allowed:";
const CACHE_KEY_PREFIX = "vatio_nominatim_cache:";

const schedulerStateByBaseUrl = new Map();

export class NominatimError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "NominatimError";
    this.status = Number.isFinite(options.status) ? options.status : null;
    this.url = options.url || "";
    this.payload = options.payload === undefined ? null : options.payload;
  }
}

export class NominatimPolicyError extends NominatimError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "NominatimPolicyError";
  }
}

function getDefaultStorage(storage) {
  try {
    return storage || null;
  } catch {
    return null;
  }
}

function createDelay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeBaseUrl(baseUrl) {
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

function isNonEmptyValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function buildSearchParams(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params)
    .filter(([, value]) => isNonEmptyValue(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => {
      searchParams.set(key, String(value));
    });
  return searchParams;
}

function parseResponsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getStorageValue(storage, key) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageValue(storage, key, value) {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage quota/privacy mode errors.
  }
}

function removeStorageValue(storage, key) {
  if (!storage || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

function getScheduleStorageKey(baseUrl) {
  return `${SCHEDULE_KEY_PREFIX}${encodeURIComponent(baseUrl)}`;
}

function getCacheStorageKey(requestUrl) {
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(requestUrl)}`;
}

function readCachedResponse(cacheStorage, requestUrl) {
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

function writeCachedResponse(cacheStorage, requestUrl, data) {
  setStorageValue(
    cacheStorage,
    getCacheStorageKey(requestUrl),
    JSON.stringify({
      cachedAtMs: Date.now(),
      data,
    }),
  );
}

function readNextAllowedAt(scheduleStorage, baseUrl) {
  const storedValue = Number(getStorageValue(scheduleStorage, getScheduleStorageKey(baseUrl)));
  return Number.isFinite(storedValue) ? storedValue : 0;
}

function writeNextAllowedAt(scheduleStorage, baseUrl, nextAllowedAtMs) {
  setStorageValue(scheduleStorage, getScheduleStorageKey(baseUrl), String(nextAllowedAtMs));
}

function getScheduler(baseUrl, options) {
  if (!schedulerStateByBaseUrl.has(baseUrl)) {
    schedulerStateByBaseUrl.set(baseUrl, {
      tail: Promise.resolve(),
      nextAllowedAtMs: 0,
    });
  }

  const state = schedulerStateByBaseUrl.get(baseUrl);
  const {
    now,
    wait,
    minIntervalMs,
    scheduleStorage,
  } = options;

  return {
    schedule(task) {
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

function createRequestUrl(baseUrl, endpoint, params) {
  const requestUrl = new URL(endpoint.replace(/^\//, ""), `${baseUrl}/`);
  requestUrl.search = buildSearchParams(params).toString();
  return requestUrl;
}

export function isPublicNominatimServer(baseUrl) {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).hostname === "nominatim.openstreetmap.org";
  } catch {
    return false;
  }
}

export function normalizeNominatimBaseUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl);
}

export function createNominatimClient(options = {}) {
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

  async function requestJson(endpoint, params = {}, requestOptions = {}) {
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
      throw new NominatimError(
        typeof payload === "object" && payload && typeof payload.error === "string"
          ? payload.error
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
    search(params = {}) {
      return requestJson("search", {
        format: "jsonv2",
        addressdetails: 1,
        limit: 5,
        ...params,
      });
    },
    reverse(params = {}) {
      return requestJson("reverse", {
        format: "jsonv2",
        addressdetails: 1,
        zoom: 18,
        ...params,
      });
    },
    lookup(params = {}) {
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
    status(params = {}) {
      return requestJson("status", {
        format: "json",
        ...params,
      }, { cache: false });
    },
    details(params = {}) {
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
    clearCachedResponse(requestUrl) {
      removeStorageValue(cacheStorage, getCacheStorageKey(requestUrl));
    },
  };
}

export function __resetNominatimTestState() {
  schedulerStateByBaseUrl.clear();
}

export { DEFAULT_BASE_URL as NOMINATIM_DEFAULT_BASE_URL };
