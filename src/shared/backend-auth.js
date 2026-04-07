import { t } from "../i18n.js";
import { getEnvironmentConfig } from "./environment.js";

export const BACKEND_AUTH_SIGNUP_URL = "https://www.vatiolibre.com/login#signup";
export const BACKEND_AUTH_FORGOT_URL = "https://www.vatiolibre.com/login#forgot";

// Use an allow_guest endpoint first so guest sessions do not trigger a visible 403.
const SESSION_PROBE_METHOD = "vatiolibre.services.tesla_connection_status";
const LOGGED_USER_METHOD = "frappe.auth.get_logged_user";
const FEATURE_ACCESS_METHOD = "vatiolibre.vatiolibre.feature_access.get_my_feature_access";
const SAVE_DRAWING_METHOD = "vatiolibre.vatiolibre.drawings.save_my_saved_drawing";
const LIST_SAVED_DRAWINGS_METHOD = "vatiolibre.vatiolibre.drawings.list_my_saved_drawings";
const GET_SAVED_DRAWING_DETAIL_METHOD = "vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail";
const PUSH_SYNC_METHOD = "vatiolibre.vatiolibre.cloud_sync.push_my_sync_changes";
const PULL_SYNC_METHOD = "vatiolibre.vatiolibre.cloud_sync.pull_my_sync_changes";
const DOWNLOAD_SYNC_PAYLOAD_METHOD = "vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload";
const DELETE_SYNC_RECORD_METHOD = "vatiolibre.vatiolibre.cloud_sync.delete_my_sync_record";
const LIST_SPEED_RECORDINGS_METHOD = "vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings";
const GET_SPEED_RECORDING_DETAIL_METHOD = "vatiolibre.vatiolibre.cloud_sync.get_my_speed_recording_detail";
const LIST_ACCEL_RECORDINGS_METHOD = "vatiolibre.vatiolibre.cloud_sync.list_my_accel_recordings";
const GET_ACCEL_RECORDING_DETAIL_METHOD = "vatiolibre.vatiolibre.cloud_sync.get_my_accel_recording_detail";
const LIST_BOARD_DOCUMENTS_METHOD = "vatiolibre.vatiolibre.board_documents.list_my_board_documents";
const GET_BOARD_DOCUMENT_DETAIL_METHOD = "vatiolibre.vatiolibre.board_documents.get_my_board_document_detail";
const SAVE_BOARD_DOCUMENT_METHOD = "vatiolibre.vatiolibre.board_documents.save_my_board_document";
const UPDATE_BOARD_DOCUMENT_METHOD = "vatiolibre.vatiolibre.board_documents.update_my_board_document";
const DELETE_BOARD_DOCUMENT_METHOD = "vatiolibre.vatiolibre.board_documents.delete_my_board_document";
const SYNC_REQUEST_COMPRESSION_MIN_BYTES = 128 * 1024;
const SYNC_REQUEST_GZIP_ENCODING = "gzip";
const SYNC_RESPONSE_GZIP_BASE64_ENCODING = "gzip_base64";

export const BACKEND_AUTH_STATE_EVENT = "vatioboard:backend-auth-state";

const BACKEND_SESSION_CACHE_TTL_MS = 30 * 1000;
const BACKEND_FEATURE_ACCESS_CACHE_TTL_MS = 30 * 1000;
const BACKEND_MEDIA_FIELD_KEYS = Object.freeze([
  "download_url",
  "export_url",
  "image_url",
  "preview_image_url",
]);
const BACKEND_OWNED_HOSTS = new Set([
  "127.0.0.1",
  "debug.vatiolibre.com",
  "dev.vatiolibre.com",
  "localhost",
  "vatiolibre.com",
  "www.vatiolibre.com",
]);
const BACKEND_OWNED_PATH_PREFIXES = Object.freeze([
  "/api/method",
  "/files",
  "/private/files",
]);
const backendSessionCache = {
  configKey: "",
  fetchedAtMs: 0,
  promise: null,
  requestVersion: 0,
  value: null,
};
const backendFeatureAccessCache = {
  configKey: "",
  fetchedAtMs: 0,
  promise: null,
  requestVersion: 0,
  value: null,
};

function getFetch(fetchImpl) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof window?.fetch === "function") return window.fetch.bind(window);
  throw new Error("Fetch API is unavailable.");
}

function getMethodUrl(methodName, config) {
  return `${config.apiBase}/api/method/${methodName}`;
}

function buildMethodUrl(methodName, args = {}, config) {
  const url = new URL(getMethodUrl(methodName, config));

  Object.entries(args || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

function createUrlEncodedBody(args = {}) {
  const body = new URLSearchParams();

  Object.entries(args || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    body.set(key, String(value));
  });

  return body.toString();
}

function getConfigCacheKey(config) {
  return String(config?.apiBase || "").trim();
}

function hasBackendOwnedPath(pathname) {
  const normalizedPath = getText(pathname);
  if (!normalizedPath) return false;

  return BACKEND_OWNED_PATH_PREFIXES.some((prefix) =>
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  );
}

function getApiBaseUrl(config) {
  try {
    return new URL(String(config?.apiBase || "").trim());
  } catch {
    return null;
  }
}

export function normalizeBackendOwnedUrl(value, {
  config = getBackendAuthConfig(),
} = {}) {
  if (typeof value !== "string") return value;

  const normalizedValue = value.trim();
  if (!normalizedValue) return normalizedValue;

  const apiBaseUrl = getApiBaseUrl(config);
  if (!apiBaseUrl) return normalizedValue;

  let parsedUrl = null;
  let isRelativeBackendPath = false;

  try {
    parsedUrl = new URL(normalizedValue);
  } catch {
    if (!normalizedValue.startsWith("/")) {
      return normalizedValue;
    }

    try {
      parsedUrl = new URL(normalizedValue, apiBaseUrl);
      isRelativeBackendPath = true;
    } catch {
      return normalizedValue;
    }
  }

  if (!parsedUrl) {
    return normalizedValue;
  }

  if (parsedUrl.origin === apiBaseUrl.origin) {
    return parsedUrl.toString();
  }

  if (isRelativeBackendPath) {
    return hasBackendOwnedPath(parsedUrl.pathname)
      ? new URL(`${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`, apiBaseUrl).toString()
      : normalizedValue;
  }

  if (!BACKEND_OWNED_HOSTS.has(String(parsedUrl.hostname || "").toLowerCase())) {
    return normalizedValue;
  }

  if (!hasBackendOwnedPath(parsedUrl.pathname)) {
    return normalizedValue;
  }

  return new URL(
    `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
    apiBaseUrl
  ).toString();
}

function normalizeBackendMediaRecord(record, { config = getBackendAuthConfig() } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record ?? null;
  }

  let normalizedRecord = record;

  BACKEND_MEDIA_FIELD_KEYS.forEach((fieldName) => {
    if (!Object.prototype.hasOwnProperty.call(record, fieldName)) return;
    const fieldValue = record[fieldName];
    const normalizedValue = normalizeBackendOwnedUrl(fieldValue, { config });
    if (normalizedValue === fieldValue) return;

    if (normalizedRecord === record) {
      normalizedRecord = { ...record };
    }
    normalizedRecord[fieldName] = normalizedValue;
  });

  return normalizedRecord;
}

function normalizeBackendMediaRecords(records, { config = getBackendAuthConfig() } = {}) {
  if (!Array.isArray(records) || records.length === 0) return [];
  return records.map((record) => normalizeBackendMediaRecord(record, { config }));
}

async function safeJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getMessage(data) {
  return data && Object.prototype.hasOwnProperty.call(data, "message")
    ? data.message
    : data;
}

function getLoggedUser(data) {
  const user = typeof getMessage(data) === "string" ? getMessage(data).trim() : "";
  return user && user !== "Guest" ? user : null;
}

function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneCachedResult(value) {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.slice();
  }

  return { ...value };
}

function createAbortError() {
  const error = new Error("Request aborted.");
  error.name = "AbortError";
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

function clearRequestCache(cache) {
  cache.configKey = "";
  cache.fetchedAtMs = 0;
  cache.promise = null;
  cache.requestVersion += 1;
  cache.value = null;
}

function hasFreshCachedValue(cache, configKey, ttlMs) {
  return Boolean(
    cache.value
    && cache.configKey === configKey
    && (Date.now() - cache.fetchedAtMs) < ttlMs
  );
}

async function loadCachedBackendRequest(cache, loader, {
  force = false,
  ttlMs,
  configKey,
  signal,
} = {}) {
  if (!force && hasFreshCachedValue(cache, configKey, ttlMs)) {
    return cloneCachedResult(cache.value);
  }

  if (!force && cache.promise && cache.configKey === configKey) {
    return cloneCachedResult(await waitForAbort(cache.promise, signal));
  }

  const requestVersion = cache.requestVersion + 1;
  cache.requestVersion = requestVersion;
  cache.configKey = configKey;
  cache.promise = Promise.resolve()
    .then(loader)
    .then((result) => {
      if (cache.requestVersion === requestVersion && cache.configKey === configKey) {
        cache.value = cloneCachedResult(result);
        cache.fetchedAtMs = Date.now();
      }
      return cloneCachedResult(result);
    })
    .catch((error) => {
      if (cache.requestVersion === requestVersion && !cache.value) {
        cache.fetchedAtMs = 0;
      }
      throw error;
    })
    .finally(() => {
      if (cache.requestVersion === requestVersion) {
        cache.promise = null;
      }
    });

  return cloneCachedResult(await waitForAbort(cache.promise, signal));
}

function hasGzipCompressionSupport() {
  return (
    typeof CompressionStream === "function"
    && typeof Response === "function"
    && typeof Blob === "function"
    && typeof TextEncoder === "function"
  );
}

function hasGzipDecompressionSupport() {
  return (
    typeof DecompressionStream === "function"
    && typeof Response === "function"
    && typeof Blob === "function"
  );
}

async function createCompressedJsonBlob(value) {
  const serialized = String(value || "");
  const encoded = new TextEncoder().encode(serialized);
  if (
    encoded.byteLength < SYNC_REQUEST_COMPRESSION_MIN_BYTES
    || !hasGzipCompressionSupport()
  ) {
    return null;
  }

  const sourceStream = new Response(encoded, {
    headers: {
      "Content-Type": "application/json",
    },
  }).body;
  if (!sourceStream) {
    return null;
  }

  const compressedStream = sourceStream.pipeThrough(
    new CompressionStream(SYNC_REQUEST_GZIP_ENCODING)
  );
  return new Response(compressedStream).blob();
}

function decodeBase64ToBytes(value) {
  const normalized = getText(value);
  if (!normalized) return new Uint8Array();

  if (typeof atob === "function") {
    const decoded = atob(normalized);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(normalized, "base64"));
  }

  throw new Error("Base64 decoding is unavailable.");
}

async function decodeCompressedJsonBase64(value) {
  const compressedBytes = decodeBase64ToBytes(value);
  const sourceStream = new Response(compressedBytes, {
    headers: {
      "Content-Type": "application/gzip",
    },
  }).body;
  if (!sourceStream) {
    throw new Error("Compressed payload stream is unavailable.");
  }

  const decompressedStream = sourceStream.pipeThrough(
    new DecompressionStream(SYNC_REQUEST_GZIP_ENCODING)
  );
  return new Response(decompressedStream).json();
}

function getFeatureAccess(data) {
  const message = getMessage(data);
  return message && typeof message === "object" ? message : null;
}

function getFeatureCapabilityByKey(featureAccessData, featureKey) {
  const featureAccess = getFeatureAccess(featureAccessData);
  const feature = featureAccess?.features?.[featureKey];

  return {
    hasActiveSubscription: featureAccess?.has_active_subscription === true,
    enabled: feature?.enabled === true,
    reason: getText(feature?.reason),
    csrfToken: getText(featureAccess?.csrf_token),
  };
}

function emitBackendAuthState(detail) {
  if (
    typeof window === "undefined"
    || typeof window.dispatchEvent !== "function"
    || typeof CustomEvent !== "function"
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(BACKEND_AUTH_STATE_EVENT, {
      detail,
    })
  );
}

async function fetchBackendJson(methodName, {
  method = "GET",
  headers,
  body,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const request = getFetch(fetchImpl);
  const response = await request(getMethodUrl(methodName, config), {
    method,
    credentials: "include",
    headers,
    body,
    signal,
  });

  return {
    response,
    data: await safeJson(response),
  };
}

async function fetchBackendMethodJson(methodName, {
  method = "GET",
  args,
  headers,
  body,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const request = getFetch(fetchImpl);
  const upperMethod = String(method || "GET").toUpperCase();
  const requestHeaders = {
    ...(headers || {}),
  };
  let requestBody = body;
  let requestUrl = getMethodUrl(methodName, config);

  if (upperMethod === "GET") {
    requestUrl = buildMethodUrl(methodName, args, config);
  } else if (requestBody === undefined && args) {
    requestBody = createUrlEncodedBody(args);
    requestHeaders["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await request(requestUrl, {
    method: upperMethod,
    credentials: "include",
    headers: requestHeaders,
    body: requestBody,
    signal,
  });

  return {
    response,
    data: await safeJson(response),
  };
}

function setHidden(elements, isHidden) {
  elements.forEach((element) => {
    element.hidden = isHidden;
  });
}

export function getBackendAuthConfig(location = window.location) {
  const env = getEnvironmentConfig(location);

  return {
    frontendOrigin: env.frontendOrigin,
    apiBase: env.apiBase,
    signupUrl: BACKEND_AUTH_SIGNUP_URL,
    forgotUrl: BACKEND_AUTH_FORGOT_URL,
  };
}

export async function fetchBackendSession({
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendJson(SESSION_PROBE_METHOD, {
    fetchImpl,
    signal,
    config,
  });
  const payload = getMessage(data);
  const isGuest = response.status === 401
    || response.status === 403
    || Boolean(payload?.is_guest);

  return {
    ok: response.ok || isGuest,
    status: response.status,
    data,
    isGuest,
    authenticated: response.ok && !isGuest,
  };
}

export function clearBackendAccessCache() {
  clearRequestCache(backendSessionCache);
  clearRequestCache(backendFeatureAccessCache);
}

export async function getBackendSessionState({
  fetchImpl,
  signal,
  force = false,
  config = getBackendAuthConfig(),
} = {}) {
  return loadCachedBackendRequest(
    backendSessionCache,
    () => fetchBackendSession({ fetchImpl, config }),
    {
      force,
      ttlMs: BACKEND_SESSION_CACHE_TTL_MS,
      configKey: getConfigCacheKey(config),
      signal,
    }
  );
}

export async function fetchBackendLoggedUser({
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendJson(LOGGED_USER_METHOD, {
    fetchImpl,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
    user: getLoggedUser(data),
  };
}

export async function loginToBackend({
  username,
  password,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new URLSearchParams();
  body.set("usr", String(username || "").trim());
  body.set("pwd", String(password || ""));

  const request = getFetch(fetchImpl);
  const response = await request(getMethodUrl("login", config), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  return {
    ok: response.ok,
    status: response.status,
    data: await safeJson(response),
  };
}

export async function logoutFromBackend({ fetchImpl, config = getBackendAuthConfig() } = {}) {
  const { response, data } = await fetchBackendJson("logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    fetchImpl,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export function getSavedDrawingsCapability(featureAccessData) {
  return getFeatureCapabilityByKey(featureAccessData, "saved_drawings");
}

export function getCloudSyncCapability(featureAccessData) {
  return getFeatureCapabilityByKey(featureAccessData, "cloud_sync");
}

export async function fetchBackendFeatureAccess({
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendJson(FEATURE_ACCESS_METHOD, {
    fetchImpl,
    signal,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
    isGuest: response.status === 401 || response.status === 403,
    featureAccess: getFeatureAccess(data),
    capability: getSavedDrawingsCapability(data),
    cloudSyncCapability: getCloudSyncCapability(data),
  };
}

export async function getBackendFeatureAccessState({
  fetchImpl,
  signal,
  force = false,
  config = getBackendAuthConfig(),
} = {}) {
  return loadCachedBackendRequest(
    backendFeatureAccessCache,
    () => fetchBackendFeatureAccess({ fetchImpl, config }),
    {
      force,
      ttlMs: BACKEND_FEATURE_ACCESS_CACHE_TTL_MS,
      configKey: getConfigCacheKey(config),
      signal,
    }
  );
}

export async function listBackendSpeedRecordings({
  limit,
  offset,
  search,
  sort,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(LIST_SPEED_RECORDINGS_METHOD, {
    args: { limit, offset, search, sort },
    fetchImpl,
    signal,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(getMessage(data)?.records) ? getMessage(data).records : [],
    totalCount: Number(getMessage(data)?.total_count) || 0,
    hasMore: getMessage(data)?.has_more === true,
    nextOffset: Number(getMessage(data)?.next_offset) || 0,
    activeFilters: getMessage(data)?.active_filters || {},
  };
}

export async function getBackendSpeedRecordingDetail({
  name,
  includePayload = false,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_SPEED_RECORDING_DETAIL_METHOD, {
    args: {
      name,
      include_payload: includePayload ? 1 : 0,
    },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);

  return {
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
    payload: message?.payload ?? null,
  };
}

export async function listBackendAccelRuns({
  limit,
  offset,
  search,
  sort,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(LIST_ACCEL_RECORDINGS_METHOD, {
    args: { limit, offset, search, sort },
    fetchImpl,
    signal,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(getMessage(data)?.records) ? getMessage(data).records : [],
    totalCount: Number(getMessage(data)?.total_count) || 0,
    hasMore: getMessage(data)?.has_more === true,
    nextOffset: Number(getMessage(data)?.next_offset) || 0,
    activeFilters: getMessage(data)?.active_filters || {},
  };
}

export async function getBackendAccelRunDetail({
  name,
  includePayload = false,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_ACCEL_RECORDING_DETAIL_METHOD, {
    args: {
      name,
      include_payload: includePayload ? 1 : 0,
    },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);

  return {
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
    payload: message?.payload ?? null,
  };
}

export async function listBackendSavedDrawingAssets({
  limit,
  offset,
  search,
  sort,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(LIST_SAVED_DRAWINGS_METHOD, {
    args: { limit, offset, search, sort },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const drawings = normalizeBackendMediaRecords(
    Array.isArray(message?.drawings) ? message.drawings : [],
    { config }
  );

  return {
    ok: response.ok,
    status: response.status,
    data,
    drawings,
    totalCount: Number(message?.total_count) || 0,
    hasMore: message?.has_more === true,
    nextOffset: Number(message?.next_offset) || 0,
    activeFilters: message?.active_filters || {},
  };
}

export async function getBackendSavedDrawingAssetDetail({
  name,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_SAVED_DRAWING_DETAIL_METHOD, {
    args: { name },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const drawing = normalizeBackendMediaRecord(message?.drawing ?? null, { config });

  return {
    ok: response.ok,
    status: response.status,
    data,
    drawing,
  };
}

export async function listBackendBoardDocuments({
  limit,
  offset,
  search,
  sort,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(LIST_BOARD_DOCUMENTS_METHOD, {
    args: { limit, offset, search, sort },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const documents = normalizeBackendMediaRecords(
    Array.isArray(message?.documents) ? message.documents : [],
    { config }
  );

  return {
    ok: response.ok,
    status: response.status,
    data,
    documents,
    totalCount: Number(message?.total_count) || 0,
    hasMore: message?.has_more === true,
    nextOffset: Number(message?.next_offset) || 0,
    activeFilters: message?.active_filters || {},
  };
}

export async function getBackendBoardDocumentDetail({
  name,
  includePayload = false,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_BOARD_DOCUMENT_DETAIL_METHOD, {
    args: {
      name,
      include_payload: includePayload ? 1 : 0,
    },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const document = normalizeBackendMediaRecord(message?.document ?? null, { config });

  return {
    ok: response.ok,
    status: response.status,
    data,
    document,
    payload: message?.payload ?? null,
  };
}

export async function saveBoardDocumentToBackend({
  title,
  payload,
  csrfToken,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new FormData();
  body.append("title", getText(title) || "");
  body.append("payload", typeof payload === "string" ? payload : JSON.stringify(payload || {}));

  const headers = {};
  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendMethodJson(SAVE_BOARD_DOCUMENT_METHOD, {
    method: "POST",
    body,
    headers,
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const document = normalizeBackendMediaRecord(message?.document ?? null, { config });

  return {
    ok: response.ok,
    status: response.status,
    data,
    document,
  };
}

export async function updateBoardDocumentInBackend({
  name,
  title,
  payload,
  csrfToken,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new FormData();
  body.append("name", getText(name));
  if (title !== undefined) {
    body.append("title", String(title ?? ""));
  }
  if (payload !== undefined) {
    body.append("payload", typeof payload === "string" ? payload : JSON.stringify(payload || {}));
  }

  const headers = {};
  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendMethodJson(UPDATE_BOARD_DOCUMENT_METHOD, {
    method: "POST",
    body,
    headers,
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const document = normalizeBackendMediaRecord(message?.document ?? null, { config });

  return {
    ok: response.ok,
    status: response.status,
    data,
    document,
  };
}

export async function deleteBoardDocumentFromBackend({
  name,
  csrfToken,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new FormData();
  body.append("name", getText(name));

  const headers = {};
  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendMethodJson(DELETE_BOARD_DOCUMENT_METHOD, {
    method: "POST",
    body,
    headers,
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);

  return {
    ok: response.ok,
    status: response.status,
    data,
    name: message?.name ?? getText(name),
  };
}

export async function saveDrawingToBackend({
  fileBlob,
  fileName,
  title,
  imageWidth,
  imageHeight,
  csrfToken,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new FormData();

  if (!(fileBlob instanceof Blob)) {
    throw new Error("Drawing file is required.");
  }

  body.append("file", fileBlob, getText(fileName) || "drawing.png");

  const trimmedTitle = getText(title);
  if (trimmedTitle) {
    body.append("title", trimmedTitle);
  }

  if (Number.isFinite(imageWidth) && imageWidth > 0) {
    body.append("image_width", String(Math.round(imageWidth)));
  }

  if (Number.isFinite(imageHeight) && imageHeight > 0) {
    body.append("image_height", String(Math.round(imageHeight)));
  }

  const headers = {};

  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendJson(SAVE_DRAWING_METHOD, {
    method: "POST",
    headers,
    body,
    fetchImpl,
    config,
  });
  const message = getMessage(data);
  const drawing = normalizeBackendMediaRecord(message?.drawing ?? null, { config });

  return {
    ok: response.ok,
    status: response.status,
    data,
    drawing,
  };
}

export async function pushSyncChangesToBackend({
  changes,
  csrfToken,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const serializedChanges = JSON.stringify(Array.isArray(changes) ? changes : []);
  const compressedChanges = await createCompressedJsonBlob(serializedChanges);
  const body = new FormData();

  if (compressedChanges) {
    body.append("changes_encoding", SYNC_REQUEST_GZIP_ENCODING);
    body.append("changes_gzip", compressedChanges, "changes.json.gz");
  } else {
    body.append("changes", serializedChanges);
  }

  const headers = {};
  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendJson(PUSH_SYNC_METHOD, {
    method: "POST",
    headers,
    body,
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);

  return {
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(message?.records) ? message.records : [],
  };
}

export async function pullSyncChangesFromBackend({
  cursor,
  limit = 100,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new URLSearchParams();
  if (getText(cursor)) {
    body.set("cursor", getText(cursor));
  }
  if (Number.isFinite(limit) && limit > 0) {
    body.set("limit", String(Math.round(limit)));
  }

  const { response, data } = await fetchBackendJson(PULL_SYNC_METHOD, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);

  return {
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(message?.records) ? message.records : [],
    hasMore: message?.has_more === true,
    nextCursor: getText(message?.next_cursor),
  };
}

export async function downloadSyncPayloadFromBackend({
  name,
  fetchImpl,
  onRequestStart,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new URLSearchParams();
  body.set("name", getText(name));
  if (hasGzipDecompressionSupport()) {
    body.set("compressed", "1");
    body.set("payload_encoding", SYNC_RESPONSE_GZIP_BASE64_ENCODING);
  }

  onRequestStart?.();
  const { response, data } = await fetchBackendJson(DOWNLOAD_SYNC_PAYLOAD_METHOD, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  let payload = message?.payload ?? null;
  if (
    payload === null
    && getText(message?.payload_encoding) === SYNC_RESPONSE_GZIP_BASE64_ENCODING
    && getText(message?.payload_gzip_base64)
  ) {
    payload = await decodeCompressedJsonBase64(message.payload_gzip_base64);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
    payload,
  };
}

export async function deleteSyncRecordFromBackend({
  entityType,
  clientRecordId,
  deviceId,
  deletedAtMs,
  csrfToken,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new URLSearchParams();
  body.set("entity_type", getText(entityType));
  body.set("client_record_id", getText(clientRecordId));
  if (getText(deviceId)) {
    body.set("device_id", getText(deviceId));
  }
  if (Number.isFinite(deletedAtMs) && deletedAtMs > 0) {
    body.set("deleted_at_ms", String(Math.round(deletedAtMs)));
  }

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendJson(DELETE_SYNC_RECORD_METHOD, {
    method: "POST",
    headers,
    body: body.toString(),
    fetchImpl,
    config,
  });
  const message = getMessage(data);

  return {
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
  };
}

export function createBackendAuthController({
  root,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  if (!root) return null;

  const form = root.matches("form") ? root : root.querySelector("form");
  const statusEl = root.querySelector("[data-backend-auth-status]");
  const usernameInput = root.querySelector("[data-backend-auth-user]");
  const passwordInput = root.querySelector("[data-backend-auth-password]");
  const loginButton = root.querySelector("[data-backend-auth-login]");
  const logoutButton = root.querySelector("[data-backend-auth-logout]");
  const signupLink = root.querySelector("[data-backend-auth-signup]");
  const forgotLink = root.querySelector("[data-backend-auth-forgot]");
  const guestElements = Array.from(root.querySelectorAll("[data-backend-auth-guest]"));
  const authenticatedElements = Array.from(root.querySelectorAll("[data-backend-auth-authenticated]"));

  let busy = false;
  let currentUser = null;
  let statusKey = "authCheckingSession";
  let statusParams = null;
  let statusTone = "muted";

  if (signupLink && !signupLink.getAttribute("href")) {
    signupLink.href = config.signupUrl;
  }

  if (forgotLink && !forgotLink.getAttribute("href")) {
    forgotLink.href = config.forgotUrl;
  }

  function renderStatus() {
    if (!statusEl) return;
    statusEl.textContent = t(statusKey, statusParams || undefined);
    statusEl.dataset.tone = statusTone;
  }

  function setStatus(key, params, tone = "muted") {
    statusKey = key;
    statusParams = params || null;
    statusTone = tone;
    renderStatus();
  }

  function syncView() {
    const isAuthenticated = Boolean(currentUser);
    root.dataset.authState = isAuthenticated ? "authenticated" : "guest";
    root.dataset.authBusy = busy ? "true" : "false";

    setHidden(guestElements, isAuthenticated);
    setHidden(authenticatedElements, !isAuthenticated);
    if (signupLink) signupLink.hidden = isAuthenticated || busy;
    if (forgotLink) forgotLink.hidden = isAuthenticated || busy;

    if (usernameInput) usernameInput.disabled = busy;
    if (passwordInput) passwordInput.disabled = busy;
    if (loginButton) loginButton.disabled = busy;
    if (logoutButton) logoutButton.disabled = busy;
  }

  async function refreshSession(options = {}) {
    busy = true;
    setStatus("authCheckingSession");
    syncView();
    let isGuest = false;

    try {
      const session = await getBackendSessionState({
        fetchImpl,
        config,
        force: options.force !== false,
      });

      if (!session.ok) {
        currentUser = null;
        setStatus("authSessionCheckFailed", { status: session.status }, "danger");
      } else if (session.isGuest) {
        currentUser = null;
        isGuest = true;
        setStatus("authSignedOut");
      } else {
        currentUser = String(options.userHint || currentUser || "").trim() || null;
        try {
          const resolvedSession = await fetchBackendLoggedUser({ fetchImpl, config });
          if (resolvedSession.ok && resolvedSession.user) {
            currentUser = resolvedSession.user;
          }
        } catch {
          // Fall back to a generic signed-in state if the username lookup fails.
        }

        if (currentUser) {
          setStatus("authSignedInAs", { user: currentUser }, "success");
        } else {
          setStatus("authSignedIn", null, "success");
        }
      }
    } catch {
      currentUser = null;
      setStatus("authNetworkError", null, "danger");
    } finally {
      busy = false;
      syncView();
      emitBackendAuthState({
        authenticated: Boolean(currentUser),
        busy,
        isGuest,
        pendingLogout: false,
        user: currentUser,
      });
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const username = String(usernameInput?.value || "").trim();
    const password = String(passwordInput?.value || "");

    if (!username || !password) {
      setStatus("authMissingCredentials", null, "danger");
      return;
    }

    busy = true;
    setStatus("authLoggingIn");
    syncView();

    try {
      const result = await loginToBackend({
        username,
        password,
        fetchImpl,
        config,
      });

      if (!result.ok) {
        busy = false;
        setStatus("authLoginFailed", { status: result.status }, "danger");
        syncView();
        return;
      }

      clearBackendAccessCache();
      if (passwordInput) passwordInput.value = "";
      await refreshSession({ userHint: username, force: true });
    } catch {
      busy = false;
      setStatus("authNetworkError", null, "danger");
      syncView();
    }
  }

  async function handleLogout() {
    busy = true;
    setStatus("authLoggingOut");
    syncView();
    emitBackendAuthState({
      authenticated: Boolean(currentUser),
      busy,
      isGuest: false,
      pendingLogout: true,
      user: currentUser,
    });

    try {
      const result = await logoutFromBackend({ fetchImpl, config });

      if (!result.ok) {
        busy = false;
        setStatus("authLogoutFailed", { status: result.status }, "danger");
        syncView();
        emitBackendAuthState({
          authenticated: Boolean(currentUser),
          busy,
          isGuest: false,
          pendingLogout: false,
          user: currentUser,
        });
        return;
      }

      clearBackendAccessCache();
      currentUser = null;
      await refreshSession({ force: true });
    } catch {
      busy = false;
      setStatus("authNetworkError", null, "danger");
      syncView();
      emitBackendAuthState({
        authenticated: Boolean(currentUser),
        busy,
        isGuest: false,
        pendingLogout: false,
        user: currentUser,
      });
    }
  }

  function handleLanguageChange() {
    renderStatus();
  }

  form?.addEventListener("submit", handleSubmit);
  logoutButton?.addEventListener("click", handleLogout);
  document.addEventListener("i18n:change", handleLanguageChange);

  syncView();
  renderStatus();
  void refreshSession();

  return {
    refreshSession,
    destroy() {
      form?.removeEventListener("submit", handleSubmit);
      logoutButton?.removeEventListener("click", handleLogout);
      document.removeEventListener("i18n:change", handleLanguageChange);
    },
  };
}

export function initBackendAuthControllers({
  root = document,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  return Array.from(root.querySelectorAll("[data-backend-auth]"))
    .map((element) => createBackendAuthController({ root: element, fetchImpl, config }))
    .filter(Boolean);
}
