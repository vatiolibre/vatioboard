import { t } from "../i18n.js";
import { IconBoard, IconLogin, IconLogout } from "../icons.js";
import { getEnvironmentConfig } from "./environment.js";

export const BACKEND_AUTH_SIGNUP_URL = "https://www.vatiolibre.com/login#signup";
export const BACKEND_AUTH_FORGOT_URL = "https://www.vatiolibre.com/login#forgot";
export const VATIOLIBRE_PROD_ORIGIN = "https://vatiolibre.com";
export const VATIOLIBRE_WWW_PROD_ORIGIN = "https://www.vatiolibre.com";
export const VATIOLIBRE_DEV_ORIGIN = "https://dev.vatiolibre.com";
export const VATIOBOARD_PROD_ORIGIN = "https://vatioboard.com";
export const VATIOBOARD_WWW_PROD_ORIGIN = "https://www.vatioboard.com";
export const VATIOBOARD_DEV_ORIGIN = "https://dev.vatioboard.com";

// Use an allow_guest endpoint first so guest sessions do not trigger a visible 403.
const SESSION_PROBE_METHOD = "vatiolibre.services.tesla_connection_status";
const LOGGED_USER_METHOD = "frappe.auth.get_logged_user";
const FEATURE_ACCESS_METHOD = "vatiolibre.vatiolibre.feature_access.get_my_feature_access";
const UPLOAD_MEDIA_ASSET_METHOD = "vatiolibre.vatiolibre.media_assets.upload_my_media_asset";
const LIST_MEDIA_ASSETS_METHOD = "vatiolibre.vatiolibre.media_assets.list_my_media_assets";
const GET_MEDIA_ASSET_DETAIL_METHOD = "vatiolibre.vatiolibre.media_assets.get_my_media_asset_detail";
const GET_MEDIA_ASSET_ACCESS_METHOD = "vatiolibre.vatiolibre.media_assets.get_my_media_asset_access";
const GET_MEDIA_MANIFEST_VERSION_METHOD = "vatiolibre.vatiolibre.media_assets.get_my_media_manifest_version";
const GET_MEDIA_MANIFEST_METHOD = "vatiolibre.vatiolibre.media_assets.get_my_media_manifest";
const UPDATE_MEDIA_ASSET_METHOD = "vatiolibre.vatiolibre.media_assets.update_my_media_asset";
const DELETE_MEDIA_ASSET_METHOD = "vatiolibre.vatiolibre.media_assets.delete_my_media_asset";
const STREAM_MEDIA_ASSET_BLOB_METHOD = "vatiolibre.vatiolibre.media_assets.stream_my_media_asset_blob";
const SSO_START_METHOD = "vatiolibre.vatiolibre.sso.start";
const LIST_PLAYLISTS_METHOD = "vatiolibre.vatiolibre.media_playlists.list_my_media_playlists";
const GET_PLAYLIST_DETAIL_METHOD = "vatiolibre.vatiolibre.media_playlists.get_my_media_playlist_detail";
const GET_PLAYLISTS_MANIFEST_VERSION_METHOD = "vatiolibre.vatiolibre.media_playlists.get_my_media_playlists_manifest_version";
const GET_PLAYLISTS_MANIFEST_METHOD = "vatiolibre.vatiolibre.media_playlists.get_my_media_playlists_manifest";
const CREATE_PLAYLIST_METHOD = "vatiolibre.vatiolibre.media_playlists.create_my_media_playlist";
const ADD_PLAYLIST_ITEM_METHOD = "vatiolibre.vatiolibre.media_playlists.add_my_media_playlist_item";
const BULK_ADD_PLAYLIST_ITEMS_METHOD = "vatiolibre.vatiolibre.media_playlists.bulk_add_my_media_playlist_items";
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
const BACKEND_FEATURE_KEYS = Object.freeze({
  cloudSync: "cloud_sync",
  mediaAssets: "media_assets",
});
const BACKEND_FEATURE_BLOCKED_REASONS = Object.freeze({
  [BACKEND_FEATURE_KEYS.cloudSync]: "This feature requires an active subscription.",
  [BACKEND_FEATURE_KEYS.mediaAssets]: "This feature requires an active subscription.",
});
const BACKEND_MEDIA_FIELD_KEYS = Object.freeze([
  "download_url",
  "export_url",
  "image_url",
  "playback_url",
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
const SSO_TARGETS = new Set(["board", "libre"]);
const SSO_BOARD_PROD_ORIGINS = new Set([
  VATIOBOARD_PROD_ORIGIN,
  VATIOBOARD_WWW_PROD_ORIGIN,
]);
const SSO_BOARD_DEV_ORIGINS = new Set([VATIOBOARD_DEV_ORIGIN]);
const SSO_LIBRE_PROD_ORIGINS = new Set([
  VATIOLIBRE_PROD_ORIGIN,
  VATIOLIBRE_WWW_PROD_ORIGIN,
]);
const SSO_LIBRE_DEV_ORIGINS = new Set([VATIOLIBRE_DEV_ORIGIN]);
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
const backendFeatureDenialCache = new Map();
const DEFAULT_BACKEND_AUTH_STATE = Object.freeze({
  authenticated: null,
  busy: false,
  isGuest: null,
  pendingLogout: false,
  user: null,
});

let backendAuthStateListenerInstalled = false;
let backendAuthStateSnapshot = { ...DEFAULT_BACKEND_AUTH_STATE };

function getDirectChildByClass(root, className) {
  return Array.from(root?.children || []).find((child) =>
    child.classList?.contains(className)
  ) || null;
}

function wrapBackendAuthChildren(root, className, children, datasetKey) {
  const existing = getDirectChildByClass(root, className);
  if (existing) return existing;

  const items = children.filter((child) => child?.parentElement === root);
  if (!items.length) return null;

  const wrapper = document.createElement("div");
  wrapper.className = className;
  if (datasetKey) wrapper.dataset[datasetKey] = "";

  root.insertBefore(wrapper, items[0]);
  items.forEach((child) => wrapper.append(child));
  return wrapper;
}

function enhanceBackendAuthButton(button, {
  icon,
  iconOnly = false,
  labelKey,
  className,
} = {}) {
  if (!button || button.dataset.authLayoutEnhanced === "true") return;

  const labelText = button.textContent.trim() || t(labelKey);
  button.classList.add(className);
  button.removeAttribute("data-i18n");
  button.dataset.authLayoutEnhanced = "true";

  if (iconOnly) {
    button.dataset.i18nAria = labelKey;
    button.dataset.i18nTitle = labelKey;
    button.setAttribute("aria-label", t(labelKey));
    button.setAttribute("title", t(labelKey));
    button.innerHTML = `
      <span class="backend-auth-action-icon" aria-hidden="true">${icon}</span>
      <span class="sr-only" data-i18n="${labelKey}">${labelText}</span>
    `;
    return;
  }

  button.innerHTML = `
    <span class="backend-auth-action-icon" aria-hidden="true">${icon}</span>
    <span data-i18n="${labelKey}">${labelText}</span>
  `;
}

function createBackendAuthActionButton({
  className,
  datasetKey,
  icon,
  labelKey,
  type = "button",
}) {
  const button = document.createElement("button");
  button.type = type;
  button.className = className;
  button.dataset[datasetKey] = "";
  button.innerHTML = `
    <span class="backend-auth-action-icon" aria-hidden="true">${icon}</span>
    <span data-i18n="${labelKey}">${t(labelKey)}</span>
  `;
  return button;
}

function ensureBackendAuthSsoActions(root) {
  const actions = getDirectChildByClass(root, "backend-auth-actions")
    || root.querySelector(".backend-auth-actions");
  if (actions && !root.querySelector("[data-backend-auth-sso-board]")) {
    const ssoButton = createBackendAuthActionButton({
      className: "backend-auth-sso-button",
      datasetKey: "backendAuthSsoBoard",
      icon: IconLogin,
      labelKey: "authContinueWithVatioLibre",
    });
    ssoButton.dataset.backendAuthGuest = "";
    actions.insertBefore(ssoButton, actions.firstChild);
  }

  let authenticatedActions = getDirectChildByClass(
    root,
    "backend-auth-authenticated-actions"
  );
  if (!authenticatedActions) {
    authenticatedActions = document.createElement("div");
    authenticatedActions.className = "backend-auth-authenticated-actions";
    authenticatedActions.dataset.backendAuthAuthenticated = "";
    root.append(authenticatedActions);
  }

  if (!root.querySelector("[data-backend-auth-open-libre]")) {
    authenticatedActions.append(
      createBackendAuthActionButton({
        className: "backend-auth-open-libre-button",
        datasetKey: "backendAuthOpenLibre",
        icon: IconLogin,
        labelKey: "authOpenVatioLibre",
      })
    );
  }

  if (!root.querySelector("[data-backend-auth-open-board]")) {
    authenticatedActions.append(
      createBackendAuthActionButton({
        className: "backend-auth-open-board-button",
        datasetKey: "backendAuthOpenBoard",
        icon: IconBoard,
        labelKey: "authOpenVatioBoard",
      })
    );
  }
}

function normalizeBackendAuthLayout(root) {
  if (!root || root.dataset.authLayout === "normalized") return;

  const titleEl = root.querySelector(".backend-auth-title");
  const statusEl = root.querySelector("[data-backend-auth-status]");
  const usernameInput = root.querySelector("[data-backend-auth-user]");
  const passwordInput = root.querySelector("[data-backend-auth-password]");
  const loginButton = root.querySelector("[data-backend-auth-login]");
  const logoutButton = root.querySelector("[data-backend-auth-logout]");
  const signupLink = root.querySelector("[data-backend-auth-signup]");
  const forgotLink = root.querySelector("[data-backend-auth-forgot]");

  enhanceBackendAuthButton(loginButton, {
    icon: IconLogin,
    labelKey: "authLogin",
    className: "backend-auth-login-button",
  });
  enhanceBackendAuthButton(logoutButton, {
    icon: IconLogout,
    iconOnly: true,
    labelKey: "authLogout",
    className: "backend-auth-logout-button",
  });

  const header = wrapBackendAuthChildren(
    root,
    "backend-auth-header",
    [titleEl, statusEl, logoutButton],
  );

  if (header && !getDirectChildByClass(header, "backend-auth-copy")) {
    const copy = document.createElement("div");
    copy.className = "backend-auth-copy";
    const firstCopyChild = [titleEl, statusEl].find((child) => child?.parentElement === header);
    if (firstCopyChild) header.insertBefore(copy, firstCopyChild);
    [titleEl, statusEl].forEach((child) => {
      if (child?.parentElement === header) copy.append(child);
    });
  }

  wrapBackendAuthChildren(
    root,
    "backend-auth-fields",
    [usernameInput, passwordInput],
    "backendAuthGuest",
  );

  const actions = wrapBackendAuthChildren(
    root,
    "backend-auth-actions",
    [loginButton, signupLink, forgotLink],
    "backendAuthGuest",
  );

  if (actions && !getDirectChildByClass(actions, "backend-auth-links")) {
    const links = document.createElement("div");
    links.className = "backend-auth-links";
    const firstLink = [signupLink, forgotLink].find((child) => child?.parentElement === actions);
    if (firstLink) actions.insertBefore(links, firstLink);
    [signupLink, forgotLink].forEach((child) => {
      if (child?.parentElement === actions) links.append(child);
    });
  }

  ensureBackendAuthSsoActions(root);

  root.dataset.authLayout = "normalized";
}

function getFetch(fetchImpl) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof window?.fetch === "function") return window.fetch.bind(window);
  throw new Error("Fetch API is unavailable.");
}

function observeRequestPromise(promise) {
  promise?.catch?.(() => {});
  return promise;
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

function getUrlOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
}

function getUrlHostname(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isProductionApiBase(config) {
  return config?.isProduction === true
    || getUrlHostname(config?.apiBase) === "api.vatioboard.com";
}

function normalizeSsoTarget(target) {
  const normalizedTarget = String(target || "").trim().toLowerCase();
  return SSO_TARGETS.has(normalizedTarget) ? normalizedTarget : "";
}

function getBoardFrontendOrigin(config = getBackendAuthConfig()) {
  const frontendOrigin = getUrlOrigin(config?.frontendOrigin);
  if (
    SSO_BOARD_PROD_ORIGINS.has(frontendOrigin)
    || SSO_BOARD_DEV_ORIGINS.has(frontendOrigin)
  ) {
    return frontendOrigin;
  }

  return isProductionApiBase(config) ? VATIOBOARD_PROD_ORIGIN : VATIOBOARD_DEV_ORIGIN;
}

function getAllowedSsoRedirectOrigins(target, config = getBackendAuthConfig()) {
  if (target === "libre") {
    return isProductionApiBase(config)
      ? new Set(SSO_LIBRE_PROD_ORIGINS)
      : new Set(SSO_LIBRE_DEV_ORIGINS);
  }

  return isProductionApiBase(config)
    ? new Set(SSO_BOARD_PROD_ORIGINS)
    : new Set(SSO_BOARD_DEV_ORIGINS);
}

function getDefaultSsoRedirectTo(target, config = getBackendAuthConfig()) {
  if (target === "libre") {
    return `${getVatioLibreOrigin(config)}/fleet`;
  }

  return `${getBoardFrontendOrigin(config)}/#/board`;
}

function hasUnsafeSsoRedirectChars(value) {
  return (
    value.includes("\\")
    || Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

function normalizeSsoRedirectTo(redirectTo, target, config = getBackendAuthConfig()) {
  const normalizedTarget = normalizeSsoTarget(target);
  if (!normalizedTarget) return "";

  if (redirectTo === undefined || redirectTo === null || String(redirectTo).trim() === "") {
    return getDefaultSsoRedirectTo(normalizedTarget, config);
  }

  const value = String(redirectTo).trim();
  if (!value || value.startsWith("//") || hasUnsafeSsoRedirectChars(value)) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    parsedUrl = null;
  }

  if (parsedUrl) {
    if (parsedUrl.protocol !== "https:") return "";
    return getAllowedSsoRedirectOrigins(normalizedTarget, config).has(parsedUrl.origin)
      ? parsedUrl.toString()
      : "";
  }

  if (!value.startsWith("/")) return "";
  return `${normalizedTarget === "libre" ? getVatioLibreOrigin(config) : getBoardFrontendOrigin(config)}${value}`;
}

function getCurrentBoardRedirectTo({ config = getBackendAuthConfig(), location = window.location } = {}) {
  const currentUrl = String(location?.href || "");
  const normalizedCurrentUrl = normalizeSsoRedirectTo(currentUrl, "board", config);
  if (normalizedCurrentUrl) return normalizedCurrentUrl;

  const path = String(location?.pathname || "/") || "/";
  const search = String(location?.search || "");
  const hash = String(location?.hash || "");
  const route = `${path}${search}${hash}` || "/#/board";
  return normalizeSsoRedirectTo(route === "/" ? "/#/board" : route, "board", config);
}

export function getVatioLibreOrigin(config = getBackendAuthConfig()) {
  const configuredOrigin = getUrlOrigin(config?.vatioLibreOrigin);
  if (configuredOrigin) return configuredOrigin;
  return isProductionApiBase(config) ? VATIOLIBRE_PROD_ORIGIN : VATIOLIBRE_DEV_ORIGIN;
}

export function getVatioLibreSubscribeUrl(config = getBackendAuthConfig()) {
  return `${getVatioLibreOrigin(config)}/subscribe`;
}

export function getSsoStartUrl(target, redirectTo, config = getBackendAuthConfig()) {
  const normalizedTarget = normalizeSsoTarget(target);
  if (!normalizedTarget) return "";

  const normalizedRedirectTo = normalizeSsoRedirectTo(redirectTo, normalizedTarget, config);
  if (!normalizedRedirectTo) return "";

  try {
    const url = new URL(getMethodUrl(SSO_START_METHOD, config));
    url.searchParams.set("target", normalizedTarget);
    url.searchParams.set("redirect_to", normalizedRedirectTo);
    return url.toString();
  } catch {
    return "";
  }
}

export function getSsoSubscribeUrl(config = getBackendAuthConfig()) {
  return getSsoStartUrl("libre", getVatioLibreSubscribeUrl(config), config);
}

export function startSso(target, redirectTo, {
  config = getBackendAuthConfig(),
  location = window.location,
} = {}) {
  const normalizedTarget = normalizeSsoTarget(target);
  const fallbackRedirectTo = normalizedTarget === "libre"
    ? `${getVatioLibreOrigin(config)}/fleet`
    : getCurrentBoardRedirectTo({ config, location });
  const url = getSsoStartUrl(
    normalizedTarget,
    redirectTo || fallbackRedirectTo,
    config
  );
  if (!url) return false;

  if (typeof location?.assign === "function") {
    location.assign(url);
  } else {
    location.href = url;
  }
  return true;
}

export function startSubscriptionSso({
  config = getBackendAuthConfig(),
  location = window.location,
} = {}) {
  const subscribeUrl = getVatioLibreSubscribeUrl(config);
  if (startSso("libre", subscribeUrl, { config, location })) {
    return true;
  }

  if (!subscribeUrl) return false;
  if (typeof location?.assign === "function") {
    location.assign(subscribeUrl);
  } else {
    location.href = subscribeUrl;
  }
  return true;
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

  let parsedUrl;
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

function normalizeOptionalBoolean(value) {
  return value === true ? true : value === false ? false : null;
}

function normalizeBackendAuthStateDetail(detail) {
  return {
    authenticated: normalizeOptionalBoolean(detail?.authenticated),
    busy: detail?.busy === true,
    isGuest: normalizeOptionalBoolean(detail?.isGuest),
    pendingLogout: detail?.pendingLogout === true,
    user: getText(detail?.user) || null,
  };
}

function mergeBackendAuthStateSnapshot(detail = {}) {
  const nextDetail = normalizeBackendAuthStateDetail(detail);
  backendAuthStateSnapshot = {
    ...backendAuthStateSnapshot,
    ...nextDetail,
  };

  if (backendAuthStateSnapshot.pendingLogout === true) {
    backendAuthStateSnapshot.authenticated = false;
  }

  if (backendAuthStateSnapshot.authenticated !== true) {
    backendAuthStateSnapshot.user = null;
  }

  if (backendAuthStateSnapshot.isGuest === true) {
    backendAuthStateSnapshot.authenticated = false;
  }

  return { ...backendAuthStateSnapshot };
}

function ensureBackendAuthStateTracking() {
  if (
    backendAuthStateListenerInstalled
    || typeof window === "undefined"
    || typeof window.addEventListener !== "function"
  ) {
    return;
  }

  window.addEventListener(BACKEND_AUTH_STATE_EVENT, (event) => {
    mergeBackendAuthStateSnapshot(event?.detail || {});
  });
  backendAuthStateListenerInstalled = true;
}

function createMergedAbortSignal(signals = []) {
  const activeSignals = signals.filter(Boolean);

  if (activeSignals.length === 0) {
    return {
      signal: undefined,
      cleanup() {},
    };
  }

  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup() {},
    };
  }

  const controller = new AbortController();
  const handleAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  activeSignals.forEach((candidate) => {
    if (candidate.aborted) {
      handleAbort();
      return;
    }
    candidate.addEventListener("abort", handleAbort, { once: true });
  });

  return {
    signal: controller.signal,
    cleanup() {
      activeSignals.forEach((candidate) => {
        candidate.removeEventListener("abort", handleAbort);
      });
    },
  };
}

function shouldAbortProtectedMediaRequest(detail) {
  const normalized = normalizeBackendAuthStateDetail(detail);
  return (
    normalized.pendingLogout === true
    || normalized.isGuest === true
    || (
      normalized.authenticated === false
      && normalized.busy !== true
    )
  );
}

function getProtectedFeatureCapability(featureAccessState, featureKey) {
  if (featureKey === BACKEND_FEATURE_KEYS.mediaAssets) {
    return featureAccessState?.capability
      || getMediaAssetsCapability(featureAccessState?.data);
  }
  if (featureKey === BACKEND_FEATURE_KEYS.cloudSync) {
    return featureAccessState?.cloudSyncCapability
      || getCloudSyncCapability(featureAccessState?.data);
  }
  return getFeatureCapabilityByKey(featureAccessState?.data, featureKey);
}

function getFeatureBlockedReason(featureKey, capability = {}) {
  return getText(capability?.reason) || BACKEND_FEATURE_BLOCKED_REASONS[featureKey] || "Feature access is unavailable.";
}

function getBackendErrorReason(data, fallback = "") {
  const message = getMessage(data);
  if (typeof message === "string") return getText(message) || fallback;
  if (message && typeof message === "object") {
    return getText(message.reason)
      || getText(message.message)
      || getText(message.error)
      || fallback;
  }

  const serverMessages = getText(data?._server_messages);
  if (serverMessages) {
    try {
      const parsedMessages = JSON.parse(serverMessages);
      const firstMessage = Array.isArray(parsedMessages) ? parsedMessages[0] : null;
      const parsedFirstMessage = typeof firstMessage === "string"
        ? JSON.parse(firstMessage)
        : firstMessage;
      const text = getText(parsedFirstMessage?.message) || getText(firstMessage);
      if (text) return text;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function normalizeProtectedEndpointResult(result, {
  featureKey,
  fallbackReason = "",
} = {}) {
  if (!result || typeof result !== "object") return result;
  const status = Number(result.status) || 0;
  if (status !== 401 && status !== 403) return result;

  const reason = getBackendErrorReason(
    result.data,
    fallbackReason || getFeatureBlockedReason(featureKey)
  );

  if (status === 403 && featureKey) {
    rememberProtectedFeatureDenial(featureKey, {
      reason,
      status,
    });
  }

  return {
    ...result,
    blockedByAuth: status === 401,
    blockedByFeature: status === 403,
    featureKey,
    reason,
  };
}

function rememberProtectedFeatureDenial(featureKey, {
  reason = "",
  status = 403,
} = {}) {
  if (!featureKey) return;
  backendFeatureDenialCache.set(featureKey, {
    featureKey,
    reason: getText(reason) || getFeatureBlockedReason(featureKey),
    status: Number(status) || 403,
  });
}

function clearProtectedFeatureDenial(featureKey) {
  if (!featureKey) return;
  backendFeatureDenialCache.delete(featureKey);
}

function clearProtectedFeatureDenials() {
  backendFeatureDenialCache.clear();
}

function getRememberedProtectedFeatureDenial(featureKey) {
  if (!featureKey) return null;
  return backendFeatureDenialCache.get(featureKey) || null;
}

function createBlockedProtectedGate({
  capability = null,
  featureAccess = null,
  featureKey,
  reason,
  session = null,
  signal,
  status = 0,
  blockedByAuth = false,
  blockedByFeature = false,
} = {}) {
  return {
    allowed: false,
    blockedByAuth,
    blockedByFeature,
    capability,
    cleanup() {},
    featureAccess,
    featureKey,
    reason: getText(reason) || "",
    session,
    signal,
    status,
  };
}

export function isBackendUserAuthenticated(sessionOrDetail) {
  const detail = normalizeBackendAuthStateDetail(sessionOrDetail);
  return (
    detail.authenticated === true
    && detail.isGuest !== true
    && detail.pendingLogout !== true
  );
}

export async function getProtectedFeatureRequestGate({
  featureKey,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  ensureBackendAuthStateTracking();

  if (backendAuthStateSnapshot.pendingLogout === true) {
    return createBlockedProtectedGate({
      blockedByAuth: true,
      featureKey,
      reason: "logout",
      signal,
      status: 401,
    });
  }

  const authAbortController = new AbortController();
  const handleAuthStateChange = (event) => {
    const detail = mergeBackendAuthStateSnapshot(event?.detail || {});
    if (shouldAbortProtectedMediaRequest(detail)) {
      authAbortController.abort();
    }
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(BACKEND_AUTH_STATE_EVENT, handleAuthStateChange);
  }

  const mergedSignal = createMergedAbortSignal([signal, authAbortController.signal]);
  const cleanup = () => {
    mergedSignal.cleanup();
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener(BACKEND_AUTH_STATE_EVENT, handleAuthStateChange);
    }
  };

  try {
    const session = isBackendUserAuthenticated(backendAuthStateSnapshot)
      ? { ...backendAuthStateSnapshot }
      : await getBackendSessionState({
        fetchImpl,
        signal: mergedSignal.signal,
        config,
      });

    mergeBackendAuthStateSnapshot({
      authenticated: session?.authenticated === true,
      busy: false,
      isGuest: session?.isGuest === true,
      pendingLogout: false,
    });

    if (backendAuthStateSnapshot.pendingLogout === true) {
      cleanup();
      throw createAbortError();
    }

    if (!isBackendUserAuthenticated(session)) {
      cleanup();
      return createBlockedProtectedGate({
        blockedByAuth: true,
        featureKey,
        reason: session?.isGuest ? "guest" : "auth",
        session,
        signal: mergedSignal.signal,
        status: session?.isGuest ? 401 : (session?.status || 401),
      });
    }

    let featureAccess = null;
    try {
      featureAccess = await getBackendFeatureAccessState({
        fetchImpl,
        signal: mergedSignal.signal,
        config,
      });
    } catch {
      cleanup();
      return createBlockedProtectedGate({
        featureKey,
        reason: "feature_access_unavailable",
        session,
        signal: mergedSignal.signal,
        status: 0,
      });
    }

    if (!featureAccess?.ok || featureAccess?.isGuest) {
      if (featureAccess?.isGuest) {
        mergeBackendAuthStateSnapshot({
          authenticated: false,
          busy: false,
          isGuest: true,
          pendingLogout: false,
        });
      }
      cleanup();
      return createBlockedProtectedGate({
        blockedByAuth: featureAccess?.isGuest === true || featureAccess?.status === 401,
        featureAccess,
        featureKey,
        reason: featureAccess?.isGuest ? "guest" : "feature_access_unavailable",
        session,
        signal: mergedSignal.signal,
        status: featureAccess?.status || 0,
      });
    }

    const capability = getProtectedFeatureCapability(featureAccess, featureKey);
    const rememberedDenial = getRememberedProtectedFeatureDenial(featureKey);
    if (rememberedDenial && capability?.enabled === true) {
      cleanup();
      return createBlockedProtectedGate({
        blockedByFeature: true,
        capability: {
          ...capability,
          enabled: false,
          reason: rememberedDenial.reason || capability.reason,
        },
        featureAccess,
        featureKey,
        reason: rememberedDenial.reason || getFeatureBlockedReason(featureKey, capability),
        session,
        signal: mergedSignal.signal,
        status: rememberedDenial.status || 403,
      });
    }
    if (capability?.enabled !== true) {
      cleanup();
      return createBlockedProtectedGate({
        blockedByFeature: true,
        capability,
        featureAccess,
        featureKey,
        reason: getFeatureBlockedReason(featureKey, capability),
        session,
        signal: mergedSignal.signal,
        status: 403,
      });
    }

    return {
      allowed: true,
      capability,
      cleanup,
      featureAccess,
      featureKey,
      session,
      signal: mergedSignal.signal,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function getProtectedMediaAssetsRequestGate(options = {}) {
  return getProtectedFeatureRequestGate({
    ...options,
    featureKey: BACKEND_FEATURE_KEYS.mediaAssets,
  });
}

export function getProtectedCloudSyncRequestGate(options = {}) {
  return getProtectedFeatureRequestGate({
    ...options,
    featureKey: BACKEND_FEATURE_KEYS.cloudSync,
  });
}

export function getProtectedMediaRequestGate(options = {}) {
  return getProtectedMediaAssetsRequestGate(options);
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
  cache.promise.catch(() => {});

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
  ensureBackendAuthStateTracking();
  mergeBackendAuthStateSnapshot(detail);
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
  const response = await observeRequestPromise(request(getMethodUrl(methodName, config), {
    method,
    credentials: "include",
    headers,
    body,
    signal,
  }));

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

  const response = await observeRequestPromise(request(requestUrl, {
    method: upperMethod,
    credentials: "include",
    headers: requestHeaders,
    body: requestBody,
    signal,
  }));

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

function setExternalPageLinkAttributes(link) {
  if (!link) return;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
}

export function getBackendAuthConfig(location = window.location) {
  const env = getEnvironmentConfig(location);

  return {
    frontendOrigin: env.frontendOrigin,
    apiBase: env.apiBase,
    isProduction: env.isProduction,
    signupUrl: BACKEND_AUTH_SIGNUP_URL,
    forgotUrl: BACKEND_AUTH_FORGOT_URL,
  };
}

/**
 * Build a stable BFF redirect URL for a media asset.
 * These URLs redirect to presigned object storage at request time.
 * They are safe to persist, embed in ``<img>`` / ``<audio>`` sources,
 * and use anywhere a URL that never expires is needed.
 *
 * @param {string} assetName
 * @param {{ preview?: boolean, config?: { apiBase: string } }} [opts]
 */
export function buildMediaBffUrl(assetName, { preview = false, config = getBackendAuthConfig() } = {}) {
  if (!assetName) return "";
  const base = `${config.apiBase}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset`;
  const params = new URLSearchParams({ name: assetName });
  if (preview) params.set("preview", "1");
  return `${base}?${params.toString()}`;
}

/**
 * Build a stable BFF redirect URL for a board document preview image.
 * @param {string} documentName
 * @param {{ config?: { apiBase: string } }} [opts]
 */
export function buildBoardDocumentPreviewBffUrl(documentName, { config = getBackendAuthConfig() } = {}) {
  if (!documentName) return "";
  const base = `${config.apiBase}/api/method/vatiolibre.vatiolibre.board_documents.download_my_board_document_preview`;
  return `${base}?${new URLSearchParams({ name: documentName }).toString()}`;
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
  clearProtectedFeatureDenials();
  backendAuthStateSnapshot = { ...DEFAULT_BACKEND_AUTH_STATE };
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
  const response = await observeRequestPromise(request(getMethodUrl("login", config), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  }));

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

export function getMediaAssetsCapability(featureAccessData) {
  return getFeatureCapabilityByKey(featureAccessData, "media_assets");
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
  const capability = getMediaAssetsCapability(data);
  const cloudSyncCapability = getCloudSyncCapability(data);

  if (capability.enabled === true) {
    clearProtectedFeatureDenial(BACKEND_FEATURE_KEYS.mediaAssets);
  }
  if (cloudSyncCapability.enabled === true) {
    clearProtectedFeatureDenial(BACKEND_FEATURE_KEYS.cloudSync);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    isGuest: response.status === 401 || response.status === 403,
    featureAccess: getFeatureAccess(data),
    capability,
    cloudSyncCapability,
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(getMessage(data)?.records) ? getMessage(data).records : [],
    totalCount: Number(getMessage(data)?.total_count) || 0,
    hasMore: getMessage(data)?.has_more === true,
    nextOffset: Number(getMessage(data)?.next_offset) || 0,
    activeFilters: getMessage(data)?.active_filters || {},
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
    payload: message?.payload ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(getMessage(data)?.records) ? getMessage(data).records : [],
    totalCount: Number(getMessage(data)?.total_count) || 0,
    hasMore: getMessage(data)?.has_more === true,
    nextOffset: Number(getMessage(data)?.next_offset) || 0,
    activeFilters: getMessage(data)?.active_filters || {},
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
    payload: message?.payload ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
}

export async function listBackendMediaAssets({
  limit,
  offset,
  search,
  sort,
  media_kind,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(LIST_MEDIA_ASSETS_METHOD, {
    args: { limit, offset, search, sort, media_kind },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const assets = normalizeBackendMediaRecords(
    Array.isArray(message?.assets) ? message.assets : [],
    { config }
  );

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    assets,
    totalCount: Number(message?.total_count) || 0,
    hasMore: message?.has_more === true,
    nextOffset: Number(message?.next_offset) || 0,
    manifestToken: message?.manifest_token ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function getBackendMediaAssetDetail({
  name,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_MEDIA_ASSET_DETAIL_METHOD, {
    args: { name },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const asset = normalizeBackendMediaRecord(message?.asset ?? null, { config });

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    asset,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function getBackendMediaAssetAccess({
  name,
  intent,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const args = { name };
  if (intent) args.intent = intent;
  const { response, data } = await fetchBackendMethodJson(GET_MEDIA_ASSET_ACCESS_METHOD, {
    args,
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    asset: message?.asset ?? null,
    access: message?.access ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function getBackendManifestVersion({
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_MEDIA_MANIFEST_VERSION_METHOD, {
    args: {},
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    manifestToken: message?.manifest_token ?? null,
    totalCount: Number(message?.total_count) || 0,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

/**
 * Fetch the full metadata-only manifest for the user's library.
 *
 * Returns all assets (no pagination) plus the manifest token.
 * Used exclusively for offline manifest caching — the UI browse
 * path still uses the paginated ``listBackendMediaAssets``.
 */
export async function getBackendMediaManifest({
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_MEDIA_MANIFEST_METHOD, {
    args: {},
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const assets = normalizeBackendMediaRecords(
    Array.isArray(message?.assets) ? message.assets : [],
    { config }
  );
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    assets,
    totalCount: Number(message?.total_count) || 0,
    manifestToken: message?.manifest_token ?? null,
    isTruncated: message?.is_truncated === true,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

/**
 * Fetch media asset bytes streamed through the backend (CORS-safe fallback).
 *
 * Returns a raw ``Response`` so the caller can read ``.blob()`` directly.
 * This bypasses the JSON envelope used by other BFF methods because the
 * response body is an opaque binary blob.
 */
export async function fetchBackendMediaAssetBlob({
  name,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const request = getFetch(fetchImpl);
  const url = buildMethodUrl(STREAM_MEDIA_ASSET_BLOB_METHOD, { name }, config);
  return observeRequestPromise(request(url, {
    method: "GET",
    credentials: "include",
    signal,
  }));
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    documents,
    totalCount: Number(message?.total_count) || 0,
    hasMore: message?.has_more === true,
    nextOffset: Number(message?.next_offset) || 0,
    activeFilters: message?.active_filters || {},
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    document,
    payload: message?.payload ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
}

export async function saveBoardDocumentToBackend({
  title,
  payload,
  previewImage,
  csrfToken,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new FormData();
  body.append("title", getText(title) || "");
  body.append("payload", typeof payload === "string" ? payload : JSON.stringify(payload || {}));
  if (previewImage instanceof Blob) {
    body.append("preview_image", previewImage, "preview.png");
  }

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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    document,
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
}

export async function updateBoardDocumentInBackend({
  name,
  title,
  payload,
  previewImage,
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
  if (previewImage instanceof Blob) {
    body.append("preview_image", previewImage, "preview.png");
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    document,
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    name: message?.name ?? getText(name),
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
}

export async function uploadMediaAssetToBackend({
  fileBlob,
  fileName,
  title,
  folderPath,
  previewBlob,
  csrfToken,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new FormData();

  if (!(fileBlob instanceof Blob)) {
    throw new Error("A file is required.");
  }

  body.append("file", fileBlob, getText(fileName) || "upload");

  const trimmedTitle = getText(title);
  if (trimmedTitle) {
    body.append("title", trimmedTitle);
  }

  const trimmedFolder = getText(folderPath);
  if (trimmedFolder) {
    body.append("folder_path", trimmedFolder);
  }

  if (previewBlob instanceof Blob) {
    body.append("preview_image", previewBlob, "preview.png");
  }

  const headers = {};

  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendJson(UPLOAD_MEDIA_ASSET_METHOD, {
    method: "POST",
    headers,
    body,
    fetchImpl,
    config,
  });
  const message = getMessage(data);
  const asset = normalizeBackendMediaRecord(message?.asset ?? null, { config });

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    asset,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function updateMediaAssetInBackend({
  name,
  title,
  folderPath,
  csrfToken,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const body = new URLSearchParams();
  body.set("name", getText(name));
  if (title !== undefined && title !== null) {
    body.set("title", getText(title));
  }
  if (folderPath !== undefined && folderPath !== null) {
    body.set("folder_path", getText(folderPath));
  }

  const { response, data } = await fetchBackendJson(UPDATE_MEDIA_ASSET_METHOD, {
    method: "POST",
    headers,
    body: body.toString(),
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  const asset = normalizeBackendMediaRecord(message?.asset ?? null, { config });

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    asset,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(message?.records) ? message.records : [],
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    records: Array.isArray(message?.records) ? message.records : [],
    hasMore: message?.has_more === true,
    nextCursor: getText(message?.next_cursor),
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
    payload,
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
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

  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    record: message?.record ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.cloudSync });
}

export async function deleteMediaAssetFromBackend({
  name,
  csrfToken,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const body = new URLSearchParams();
  body.set("name", getText(name));

  const { response, data } = await fetchBackendJson(DELETE_MEDIA_ASSET_METHOD, {
    method: "POST",
    headers,
    body: body.toString(),
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);

  return normalizeProtectedEndpointResult({
    ok: response.ok && message?.ok !== false,
    status: response.status,
    data,
    name: message?.name ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

// ── Playlist methods ───────────────────────────────────────────────

export async function listBackendPlaylists({
  search,
  limit,
  offset,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const args = {};
  if (search) args.search = String(search);
  if (limit != null) args.limit = Number(limit);
  if (offset != null) args.offset = Number(offset);

  const { response, data } = await fetchBackendMethodJson(LIST_PLAYLISTS_METHOD, {
    args,
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    playlists: Array.isArray(message?.playlists) ? message.playlists : [],
    totalCount: Number(message?.total_count) || 0,
    manifestToken: message?.manifest_token ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function getBackendPlaylistDetail({
  name,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_PLAYLIST_DETAIL_METHOD, {
    args: { name: String(name || "") },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    playlist: message?.playlist ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function getBackendPlaylistsManifestVersion({
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_PLAYLISTS_MANIFEST_VERSION_METHOD, {
    args: {},
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    manifestToken: message?.manifest_token ?? null,
    totalCount: Number(message?.total_count) || 0,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function getBackendPlaylistsManifest({
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(GET_PLAYLISTS_MANIFEST_METHOD, {
    args: {},
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    playlists: Array.isArray(message?.playlists) ? message.playlists : [],
    totalCount: Number(message?.total_count) || 0,
    manifestToken: message?.manifest_token ?? null,
    isTruncated: message?.is_truncated === true,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function createBackendPlaylist({
  title,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const args = {};
  if (title) args.title = String(title);

  const { response, data } = await fetchBackendMethodJson(CREATE_PLAYLIST_METHOD, {
    method: "POST",
    args,
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    playlist: message?.playlist ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function addBackendPlaylistItem({
  name,
  mediaAssetName,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(ADD_PLAYLIST_ITEM_METHOD, {
    method: "POST",
    args: {
      name: String(name || ""),
      media_asset_name: String(mediaAssetName || ""),
    },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    playlist: message?.playlist ?? null,
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export async function bulkAddBackendPlaylistItems({
  name,
  mediaAssetNames,
  fetchImpl,
  signal,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendMethodJson(BULK_ADD_PLAYLIST_ITEMS_METHOD, {
    method: "POST",
    args: {
      name: String(name || ""),
      media_asset_names_json: JSON.stringify(mediaAssetNames || []),
    },
    fetchImpl,
    signal,
    config,
  });
  const message = getMessage(data);
  return normalizeProtectedEndpointResult({
    ok: response.ok,
    status: response.status,
    data,
    playlist: message?.playlist ?? null,
    added: message?.added ?? [],
    skipped: message?.skipped ?? [],
  }, { featureKey: BACKEND_FEATURE_KEYS.mediaAssets });
}

export function createBackendAuthController({
  root,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  if (!root) return null;

  normalizeBackendAuthLayout(root);

  const form = root.matches("form") ? root : root.querySelector("form");
  const statusEl = root.querySelector("[data-backend-auth-status]");
  const usernameInput = root.querySelector("[data-backend-auth-user]");
  const passwordInput = root.querySelector("[data-backend-auth-password]");
  const loginButton = root.querySelector("[data-backend-auth-login]");
  const logoutButton = root.querySelector("[data-backend-auth-logout]");
  const ssoBoardButton = root.querySelector("[data-backend-auth-sso-board]");
  const openLibreButton = root.querySelector("[data-backend-auth-open-libre]");
  const openBoardButton = root.querySelector("[data-backend-auth-open-board]");
  const signupLink = root.querySelector("[data-backend-auth-signup]");
  const forgotLink = root.querySelector("[data-backend-auth-forgot]");
  const guestElements = Array.from(root.querySelectorAll("[data-backend-auth-guest]"));
  const authenticatedElements = Array.from(root.querySelectorAll("[data-backend-auth-authenticated]"));
  statusEl?.removeAttribute("data-i18n");

  // ── Password reveal toggle ──────────────────────────────────────
  if (passwordInput && !passwordInput.closest(".backend-auth-password-wrap")) {
    const wrap = document.createElement("div");
    wrap.className = "backend-auth-password-wrap";
    passwordInput.parentNode.insertBefore(wrap, passwordInput);
    wrap.append(passwordInput);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "backend-auth-password-toggle";
    toggleBtn.setAttribute("aria-label", t("authTogglePassword"));
    toggleBtn.tabIndex = -1;
    toggleBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
      <path d="M10 3C5.5 3 1.7 6 .3 10c1.4 4 5.2 7 9.7 7s8.3-3 9.7-7C18.3 6 14.5 3 10 3Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>
    </svg>`;

    toggleBtn.addEventListener("click", () => {
      const revealed = passwordInput.type === "text";
      passwordInput.type = revealed ? "password" : "text";
      toggleBtn.classList.toggle("is-revealed", !revealed);
      toggleBtn.setAttribute("aria-label", t(revealed ? "authTogglePassword" : "authHidePassword"));
    });

    wrap.append(toggleBtn);
  }

  let busy = false;
  let currentUser = null;
  let statusKey = "authCheckingSession";
  let statusParams = null;
  let statusTone = "muted";

  if (signupLink && !signupLink.getAttribute("href")) {
    signupLink.href = config.signupUrl;
  }
  setExternalPageLinkAttributes(signupLink);

  if (forgotLink && !forgotLink.getAttribute("href")) {
    forgotLink.href = config.forgotUrl;
  }
  setExternalPageLinkAttributes(forgotLink);

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
    if (ssoBoardButton) ssoBoardButton.disabled = busy;
    if (openLibreButton) openLibreButton.disabled = busy;
    if (openBoardButton) openBoardButton.disabled = busy;
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
      if (passwordInput) {
        passwordInput.value = "";
        passwordInput.type = "password";
        const revealBtn = passwordInput.parentNode?.querySelector(".backend-auth-password-toggle");
        if (revealBtn) revealBtn.classList.remove("is-revealed");
      }
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

  function handleSsoBoard() {
    startSso("board", getCurrentBoardRedirectTo({ config }), { config });
  }

  function handleOpenLibre() {
    startSso("libre", `${getVatioLibreOrigin(config)}/fleet`, { config });
  }

  function handleOpenBoard() {
    startSso("board", getCurrentBoardRedirectTo({ config }), { config });
  }

  function handleLanguageChange() {
    renderStatus();
  }

  form?.addEventListener("submit", handleSubmit);
  logoutButton?.addEventListener("click", handleLogout);
  ssoBoardButton?.addEventListener("click", handleSsoBoard);
  openLibreButton?.addEventListener("click", handleOpenLibre);
  openBoardButton?.addEventListener("click", handleOpenBoard);
  document.addEventListener("i18n:change", handleLanguageChange);

  syncView();
  renderStatus();
  void refreshSession();

  return {
    refreshSession,
    destroy() {
      form?.removeEventListener("submit", handleSubmit);
      logoutButton?.removeEventListener("click", handleLogout);
      ssoBoardButton?.removeEventListener("click", handleSsoBoard);
      openLibreButton?.removeEventListener("click", handleOpenLibre);
      openBoardButton?.removeEventListener("click", handleOpenBoard);
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
