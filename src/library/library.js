import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/library.less";
import "../styles/backend-auth.less";
import "../styles/cloud-sync-status.less";
import "../shared/ui/confirm-dialog.less";

import {
  IconAccel,
  IconBoard,
  IconDownload,
  IconMedia,
  IconMore,
  IconMuted,
  IconPages,
  IconPin,
  IconReplay,
  IconRestart,
  IconSpeed,
  IconTrash,
  IconVolume,
  IconWorld,
} from "../icons.js";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import {
  getCurrentAppRouteQuery,
  navigateToAppRoute,
  replaceAppRouteQuery,
  ROUTE_VISIBLE_EVENT,
} from "../app/router.js";
import {
  BACKEND_AUTH_STATE_EVENT,
  buildMediaBffUrl,
  deleteBoardDocumentFromBackend,
  deleteMediaAssetFromBackend,
  deleteSyncRecordFromBackend,
  fetchBackendLoggedUser,
  fetchBackendMediaAssetBlob,
  getBackendFeatureAccessState,
  getBackendMediaAssetAccess,
  getProtectedMediaRequestGate,
  getBackendSessionState,
  initBackendAuthControllers,
  updateBoardDocumentInBackend,
  updateMediaAssetInBackend,
} from "../shared/backend-auth.js";
import {
  CLOUD_LIBRARY_TAB_KEYS,
  getCloudLibraryResource,
} from "../shared/cloud-library-resources.js";
import {
  clearMediaAccessCache,
  getCachedMediaAccess,
  setCachedMediaAccess,
} from "../shared/media-access-cache.js";
import {
  clearPersistedMediaCacheUser,
  getMediaCacheUser,
  getPinnedBlobMeta,
  getPinnedMediaBlob,
  isMediaBlobPinned,
  pinMediaBlob,
  pinMediaFromResponse,
  restorePersistedMediaCacheUser,
  setMediaCacheUser,
  unpinMediaBlob,
  getLocalMediaBlob,
  getLocalBlobMeta,
  getCachedBlobMeta,
  getCachedMediaBlob,
  cacheMediaBlob,
  isAutoCacheEligible,
  isAutoCacheInFlight,
  registerAutoCacheDownload,
  deriveLocalAvailability,
  removeCachedMediaBlob,
} from "../shared/media-cache.js";
import { triggerBackgroundCache } from "../shared/audio-source-resolver.js";
import { getResourceConfig } from "./resource-registry.js";
import { createLibraryMapPreview } from "./library-map-preview.js";
import { createLibraryMediaPlayer } from "./library-media-player.js";
import { showConfirmDialog, showPromptDialog } from "../shared/ui/confirm-dialog.js";
import {
  openCloudAccelRun,
  openCloudBoardDocument,
  openCloudReplaySession,
} from "../shared/cloud-library-open.js";
import * as audioRuntime from "../shared/audio-runtime.js";
import { applyButtonIcon, getActiveToolsMenuList, initToolsMenu } from "../shared/tools-menu.js";
import { integratePlayerWidget } from "../player/integrate-player-widget.js";
import { initCloudSyncStatusIndicator } from "../shared/cloud-sync-status-indicator.js";

applyTranslations();

const isSpaRuntime = Boolean(window.__vatioboardSpa);
if (!isSpaRuntime) initBackendAuthControllers();
const PAGE_SIZE = 24;
const SORT_OPTIONS = new Set(["newest", "oldest", "title_asc", "title_desc"]);
const TAB_ORDER = [
  CLOUD_LIBRARY_TAB_KEYS.speed,
  CLOUD_LIBRARY_TAB_KEYS.accel,
  CLOUD_LIBRARY_TAB_KEYS.boardDocuments,
  CLOUD_LIBRARY_TAB_KEYS.media,
];
const initialRouteQuery = getCurrentAppRouteQuery();

const elements = {
  langToggleButtons: Array.from(document.querySelectorAll("[data-lang-toggle], #langToggle")),
  libraryTabs: Array.from(document.querySelectorAll(".library-tab[data-tab]")),
  searchForm: document.getElementById("librarySearchForm"),
  searchInput: document.getElementById("librarySearch"),
  sortSelect: document.getElementById("librarySort"),
  refreshButton: document.getElementById("libraryRefresh"),
  toolsMenuButton: document.getElementById("libraryToolsMenuBtn"),
  toolsMenuList: document.getElementById("libraryToolsMenuList"),
  toolbar: document.querySelector(".library-toolbar"),
  status: document.getElementById("libraryStatus"),
  listEmpty: document.getElementById("libraryListEmpty"),
  listPanel: document.getElementById("libraryList"),
  loadMoreButton: document.getElementById("libraryLoadMore"),
  detailEmpty: document.getElementById("libraryDetailEmpty"),
  detailCard: document.getElementById("libraryDetailCard"),
  detailPreview: document.getElementById("libraryDetailPreview"),
  detailTitle: document.getElementById("libraryDetailTitle"),
  detailSubtitle: document.getElementById("libraryDetailSubtitle"),
  detailMeta: document.getElementById("libraryDetailMeta"),
  actionOpen: document.getElementById("libraryActionOpen"),
  actionDownload: document.getElementById("libraryActionDownload"),
  actionRename: document.getElementById("libraryActionRename"),
  actionDelete: document.getElementById("libraryActionDelete"),
  actionPin: document.getElementById("libraryActionPin"),
  overflowBtn: document.getElementById("libraryOverflowBtn"),
  overflowList: document.getElementById("libraryOverflowList"),
  toolbarVolume: document.getElementById("libraryToolbarVolume"),
  toolbarMuteBtn: document.getElementById("libraryToolbarMute"),
  toolbarVolumeSlider: document.getElementById("libraryToolbarVolumeSlider"),
  openBoardPage: document.getElementById("openLibraryBoardMenu"),
  openSpeedPage: document.getElementById("openLibrarySpeedMenu"),
  openReplayPage: document.getElementById("openLibraryReplayMenu"),
  openAccelPage: document.getElementById("openLibraryAccelMenu"),
  openCurrentPage: document.getElementById("openLibraryCurrentMenu"),
};

const toolsMenu = initToolsMenu({
  button: elements.toolsMenuButton,
  list: elements.toolsMenuList,
});
toolsMenu.setOpen(false);

const overflowMenu = initToolsMenu({
  button: elements.overflowBtn,
  list: elements.overflowList,
});

function focusElement(element) {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function isVisibleForFocus(element) {
  return Boolean(element && element.hidden !== true && !element.closest("[hidden]"));
}

function getCloudSyncLauncherFocusTarget() {
  const menuList = getActiveToolsMenuList(elements.toolsMenuList);
  const candidates = [
    menuList?.querySelector("[data-backend-auth-user]"),
    menuList?.querySelector("[data-backend-auth-password]"),
    menuList?.querySelector("[data-backend-auth-login]"),
    menuList?.querySelector("[data-backend-auth-logout]"),
    menuList?.querySelector("[data-backend-auth-status]"),
  ];

  return candidates.find(isVisibleForFocus) || null;
}

function focusCloudSyncLauncherTarget(attempt = 0) {
  toolsMenu.setOpen(true);
  const target = getCloudSyncLauncherFocusTarget();
  if (target) {
    focusElement(target);
    if (target.matches?.("input") && typeof target.select === "function") {
      target.select();
    }
    return;
  }

  if (attempt >= 6) return;
  Promise.resolve().then(() => {
    focusCloudSyncLauncherTarget(attempt + 1);
  });
}

function openCloudSyncLauncher() {
  Promise.resolve().then(() => {
    focusCloudSyncLauncherTarget();
  });
}

initCloudSyncStatusIndicator({
  mount: elements.toolbar,
  alignEnd: true,
  openLauncher: openCloudSyncLauncher,
});

const state = {
  viewMounted: true,
  initialized: false,
  activeTab: normalizeTabKey(initialRouteQuery.get("tab")),
  featureAccess: null,
  session: null,
  authLoading: true,
  query: {
    search: normalizeSearch(initialRouteQuery.get("search")),
    sort: normalizeSort(initialRouteQuery.get("sort")),
  },
  items: [],
  totalCount: 0,
  hasMore: false,
  nextOffset: 0,
  listLoading: false,
  detailLoading: false,
  selectedName: "",
  selectedDetail: null,
  openBusy: false,
  mutatingNames: new Set(),
  pinnedNames: new Set(),
  stalePinnedNames: new Set(),
  cachedBlobNames: new Set(),
  staleCachedNames: new Set(),
  listOffline: false,
  reconnecting: false,
  statusKey: "",
  statusParams: null,
  statusText: "",
  statusTone: "muted",
};

let mapPreview = null;
let previewObjectUrl = null;
const libraryMediaPlayer = createLibraryMediaPlayer();

/**
 * Tracks an active remote playback session by asset name.  Set when the
 * user first plays a remote (non-blob) source; cleared when the player
 * is destroyed or a new preview is mounted.  While set, the async local
 * blob resolution in renderDetail() skips hot-swapping the player source
 * so playback is not interrupted by a background auto-cache completion.
 */
let remotePlaybackSessionName = "";

/**
 * Lightweight preview-state memo to avoid redundant preview rebuilds.
 * Updated inside renderDetail(); renderDetailPreview() only runs when the
 * derived signature changes.  This prevents map animation restarts and
 * image element recreation caused by metadata-only rerenders.
 */
let lastPreviewSignature = "";

/**
 * Monotonically increasing generation counter for auth operations.
 * Incremented by refreshAuthState(); checked by rehydrateAuthOnReconnect()
 * to discard stale results from in-flight reconnect recovery.
 */
let authGeneration = 0;
let pendingAuthRefresh = null;

let libraryRouteLifecycle = {
  mount() {},
  unmount() {},
};

export function mountLibraryRoute() {
  libraryRouteLifecycle.mount();
}

export function unmountLibraryRoute() {
  libraryRouteLifecycle.unmount();
}

function canRenderView() {
  return !isSpaRuntime || state.viewMounted;
}

function revokePreviewObjectUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

/**
 * Resolve signed object-storage URLs for a media asset on demand.
 * Returns the cached access if still valid, otherwise fetches fresh URLs
 * from the backend and caches them in memory (never persisted).
 *
 * @param {string} assetName
 * @param {string} [contentHash]
 * @param {{ intent?: string }} [opts]
 */
async function resolveMediaAccess(assetName, contentHash, { intent } = {}) {
  if (!assetName) return null;

  // When no intent is specified, use the generic cache lookup.
  // Intent-specific requests always go to the backend since the cached
  // response may hold a different URL set.
  if (!intent) {
    const cached = getCachedMediaAccess(assetName, contentHash);
    if (cached) return cached;
  }

  let gate = null;
  try {
    gate = await getProtectedMediaRequestGate();
    if (!gate.allowed) return null;

    const result = await getBackendMediaAssetAccess({
      name: assetName,
      intent,
      signal: gate.signal,
    });
    if (result.access) {
      const expiry = Number(result.access.expires_in_seconds) || 300;
      const hash = result.asset?.content_hash || contentHash;
      // Only cache the generic (no-intent) response to avoid polluting the
      // cache with partial responses.
      if (!intent) {
        setCachedMediaAccess(assetName, hash, result.access, expiry);
      }
      return result.access;
    }
    return null;
  } finally {
    gate?.cleanup?.();
  }
}

/**
 * Background-download and cache a media blob for future local-first use.
 *
 * Non-blocking: does not stall playback or the UI.  Deduplicates concurrent
 * downloads for the same asset via ``registerAutoCacheDownload``.
 */
async function triggerAutoCacheDownload(assetName, asset) {
  if (!assetName || !asset) return;
  if (!isAutoCacheEligible(asset)) return;

  // Skip if the item is already pinned or locally cached with a fresh hash.
  if (state.pinnedNames.has(assetName) && !state.stalePinnedNames.has(assetName)) return;
  if (state.cachedBlobNames.has(assetName) && !state.staleCachedNames.has(assetName)) return;

  triggerBackgroundCache(assetName, asset, {
    onCached() {
      state.cachedBlobNames.add(assetName);
      state.staleCachedNames.delete(assetName);
      renderList();
      renderDetail();
    },
  });
}

/**
 * Derive a stable identity string for the current preview state.
 * Used to skip renderDetailPreview() when preview inputs are unchanged.
 */
function derivePreviewSignature(item, { isOfflineItem = false, isPinned = false, localPreviewUrl = "" } = {}) {
  if (!item) return "";
  const config = getResourceConfig(state.activeTab);
  const previewKind = config.previewKind;
  // For media items, use BFF-derived preview source or fallback to any
  // URL fields that may be present on resolved items.
  const imageUrl = item.image_url || item.preview_image_url || "";
  const effectiveUrl = localPreviewUrl || imageUrl;
  const mediaKind = String(item.media_kind || "");

  // For map previews, include a hash of the route coordinates so we detect
  // actual route changes but treat identical revalidation data as a no-op.
  let routeIdentity = "";
  if (previewKind === "map" && typeof config.getPreviewRoute === "function") {
    const coords = config.getPreviewRoute(item);
    if (coords && coords.length >= 2) {
      // Use first, last, count, and a sampling of middle points for identity.
      const first = coords[0];
      const last = coords[coords.length - 1];
      routeIdentity = `${coords.length}:${first[0]},${first[1]}:${last[0]},${last[1]}`;
    }
  }

  // For media items, include the playback/download URL so that transitions
  // from cache-without-URLs to fresh-with-URLs trigger a re-render.
  const mediaSrcUrl = previewKind === "media"
    ? (item.playback_url || item.download_url || "")
    : "";

  return [
    state.activeTab,
    item.name || "",
    previewKind,
    effectiveUrl,
    routeIdentity,
    isOfflineItem ? "offline" : "",
    isPinned ? "pinned" : "",
    mediaKind,
    mediaSrcUrl,
  ].join("|");
}

const listRequestState = {
  controller: null,
  generation: 0,
  requestId: 0,
  requestKey: "",
};

const detailRequestState = {
  controller: null,
  requestId: 0,
};

function normalizeTabKey(value) {
  return TAB_ORDER.includes(value) ? value : CLOUD_LIBRARY_TAB_KEYS.speed;
}

function normalizeSearch(value) {
  return String(value || "").trim();
}

function normalizeSort(value) {
  const normalized = String(value || "newest").trim().toLowerCase();
  return SORT_OPTIONS.has(normalized) ? normalized : "newest";
}

function createAbortError() {
  const error = new Error("Request aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function formatCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat().format(Math.max(0, Math.round(numeric)));
}

function formatFileSize(bytes) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = numeric;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDurationMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "—";

  const totalSeconds = Math.round(numeric / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}:${String(remainingMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDimensionPair(width, height) {
  const normalizedWidth = Number(width);
  const normalizedHeight = Number(height);
  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight)) {
    return "—";
  }

  return `${Math.round(normalizedWidth)} x ${Math.round(normalizedHeight)}`;
}

function getCurrentResourceConfig() {
  return getCloudLibraryResource(state.activeTab);
}

function getCurrentCapability() {
  if (!state.session?.authenticated) {
    return {
      enabled: false,
      reason: t("cloudLibraryLoginPrompt"),
      csrfToken: "",
    };
  }

  if (!state.featureAccess?.ok) {
    return {
      enabled: false,
      reason: t("cloudLibraryAccessUnavailable"),
      csrfToken: "",
    };
  }

  const resourceConfig = getCurrentResourceConfig();
  if (resourceConfig.capabilityKey === "media_assets") {
    return state.featureAccess.capability;
  }

  return state.featureAccess.cloudSyncCapability;
}

function getFirstAccessibleTab() {
  if (!state.session?.authenticated || !state.featureAccess?.ok) {
    return CLOUD_LIBRARY_TAB_KEYS.speed;
  }

  return (
    TAB_ORDER.find((tabKey) => {
      const resourceConfig = getCloudLibraryResource(tabKey);
      const capability = resourceConfig.capabilityKey === "media_assets"
        ? state.featureAccess.capability
        : state.featureAccess.cloudSyncCapability;
      return capability?.enabled === true;
    })
    || CLOUD_LIBRARY_TAB_KEYS.speed
  );
}

function stopRequest(requestState) {
  requestState.requestId += 1;
  requestState.controller?.abort?.();
  requestState.controller = null;
  return requestState.requestId;
}

function buildListRequestKey({
  tabKey,
  limit = PAGE_SIZE,
  offset = 0,
  search = "",
  sort = "newest",
} = {}) {
  return JSON.stringify({
    limit,
    offset,
    search: normalizeSearch(search),
    sort: normalizeSort(sort),
    tabKey: normalizeTabKey(tabKey),
  });
}

function isActiveListRequest({
  tabKey,
  requestId,
  generation,
  requestKey,
} = {}) {
  return (
    requestId === listRequestState.requestId
    && generation === listRequestState.generation
    && requestKey === listRequestState.requestKey
    && tabKey === state.activeTab
  );
}

function updateLocationState() {
  replaceAppRouteQuery({
    tab: state.activeTab,
    search: state.query.search || null,
    sort: state.query.sort !== "newest" ? state.query.sort : null,
  });
}

function syncLangToggleButtons(langCode) {
  const label = String(langCode || getLang()).toUpperCase();
  elements.langToggleButtons.forEach((button) => {
    button.textContent = label;
  });
}

function setStatus(statusKey = "", statusParams = null, statusTone = "muted") {
  state.statusKey = statusKey;
  state.statusParams = statusParams;
  state.statusText = "";
  state.statusTone = statusTone;
  renderStatus();
}

function setStatusText(statusText = "", statusTone = "muted") {
  state.statusKey = "";
  state.statusParams = null;
  state.statusText = String(statusText || "");
  state.statusTone = statusTone;
  renderStatus();
}

function renderStatus() {
  if (!canRenderView()) return;
  if (!elements.status) return;

  const hasMessage = Boolean(state.statusText || state.statusKey);
  elements.status.hidden = !hasMessage;
  elements.status.dataset.tone = state.statusTone;
  elements.status.textContent = state.statusText
    || (hasMessage ? t(state.statusKey, state.statusParams || undefined) : "");
}

function renderTabs() {
  if (!canRenderView()) return;
  elements.libraryTabs.forEach((button) => {
    const tabKey = normalizeTabKey(button.dataset.tab);
    const resourceConfig = getCloudLibraryResource(tabKey);
    const capability = state.featureAccess?.ok
      ? (resourceConfig.capabilityKey === "media_assets"
        ? state.featureAccess.capability
        : state.featureAccess.cloudSyncCapability)
      : null;
    const isAccessible = Boolean(state.session?.authenticated) && capability?.enabled === true;
    const isActive = tabKey === state.activeTab;

    // In offline-limited or reconnecting mode, disable non-media tabs to
    // prevent interaction before capability state is fully restored.
    const offlineBlocked = (state.listOffline || state.reconnecting)
      && tabKey !== CLOUD_LIBRARY_TAB_KEYS.media;

    button.dataset.active = isActive ? "true" : "false";
    button.dataset.access = (isAccessible || (isActive && (state.listOffline || state.reconnecting))) ? "granted" : "blocked";
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.disabled = offlineBlocked;
  });
}

function buildListEmptyMessage() {
  if (state.authLoading || state.listLoading) {
    return t("cloudLibraryLoading");
  }

  if (state.statusTone === "danger") {
    return state.statusText || (state.statusKey ? t(state.statusKey, state.statusParams || undefined) : t("cloudLibraryAccessUnavailable"));
  }

  if (!state.session?.authenticated) {
    return t("cloudLibraryLoginPrompt");
  }

  const capability = getCurrentCapability();
  if (!capability?.enabled) {
    return capability?.reason || t("cloudLibraryAccessUnavailable");
  }

  return t("cloudLibraryNoItems");
}

function getRequestErrorStatus(error) {
  return Number(error?.result?.status || error?.status || 0) || 0;
}

function isNotFoundError(error) {
  return getRequestErrorStatus(error) === 404;
}

function applyLibraryRequestError(error, {
  genericKey = "cloudLibraryRequestFailed",
} = {}) {
  const status = getRequestErrorStatus(error);

  if (status === 401) {
    authGeneration += 1;
    state.session = {
      authenticated: false,
      isGuest: true,
      ok: false,
      status,
    };
    state.featureAccess = null;
    state.reconnecting = false;
    state.authLoading = false;
    clearPersistedMediaCacheUser();
    clearMediaAccessCache();
    setStatus("cloudLibraryLoginPrompt", null, "danger");
    renderTabs();
    renderDetail();
    return;
  }

  if (status === 403) {
    setStatus("cloudLibraryAccessDenied", null, "danger");
    return;
  }

  if (error?.libraryStatusKey) {
    setStatus(error.libraryStatusKey, error.libraryStatusParams || null, "danger");
    return;
  }

  setStatus(genericKey, { status: status || 0 }, "danger");
}

function canOpenCloudLibraryItem(item) {
  if (!item) return false;
  const config = getResourceConfig(state.activeTab);
  return config.canOpen(item);
}

/**
 * Check non-pinned cached blob state for a single item, verifying that
 * both meta and blob exist.  Orphaned meta (meta without a blob) is
 * cleaned up and the item is NOT marked as locally cached.
 *
 * Shared between refreshPinState() and refreshPinStatesForItems() so
 * the two paths cannot drift.
 *
 * @returns {boolean} true if any state set changed
 */
async function reconcileCachedBlobState(name, item) {
  const cachedMeta = await getCachedBlobMeta(name).catch(() => null);
  const wasCached = state.cachedBlobNames.has(name);
  let changed = false;

  if (cachedMeta) {
    // Verify that the actual blob exists — orphaned meta without
    // a usable blob must not mark the item as locally available.
    const blobExists = await getCachedMediaBlob(name).catch(() => null);
    if (!blobExists) {
      // Orphaned meta — clean it up silently.
      removeCachedMediaBlob(name).catch(() => {});
      if (wasCached) { state.cachedBlobNames.delete(name); changed = true; }
      if (state.staleCachedNames.has(name)) { state.staleCachedNames.delete(name); changed = true; }
    } else {
      if (!wasCached) { state.cachedBlobNames.add(name); changed = true; }
      const stale = item?.content_hash && cachedMeta.content_hash
        && item.content_hash !== cachedMeta.content_hash;
      const wasStale = state.staleCachedNames.has(name);
      if (stale && !wasStale) { state.staleCachedNames.add(name); changed = true; }
      else if (!stale && wasStale) { state.staleCachedNames.delete(name); changed = true; }
    }
  } else {
    if (wasCached) { state.cachedBlobNames.delete(name); changed = true; }
    if (state.staleCachedNames.has(name)) { state.staleCachedNames.delete(name); changed = true; }
  }

  return changed;
}

async function refreshPinState(name) {
  if (!name || state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.media) return;
  try {
    const meta = await getPinnedBlobMeta(name);
    if (meta) {
      state.pinnedNames.add(name);
      const item = state.selectedDetail
        || state.items.find((i) => i.name === name) || null;
      if (item?.content_hash && meta.content_hash && item.content_hash !== meta.content_hash) {
        state.stalePinnedNames.add(name);
      } else {
        state.stalePinnedNames.delete(name);
      }
    } else {
      state.pinnedNames.delete(name);
      state.stalePinnedNames.delete(name);
    }

    // Also check non-pinned cached blob state.
    if (!state.pinnedNames.has(name)) {
      const item = state.selectedDetail
        || state.items.find((i) => i.name === name) || null;
      await reconcileCachedBlobState(name, item);
    }

    renderDetail();
  } catch {
    // IndexedDB may be unavailable; leave pin state unknown.
  }
}

async function refreshPinStatesForItems(items) {
  if (state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.media || !items?.length) return;
  let changed = false;
  for (const item of items) {
    if (!item.name) continue;
    try {
      const meta = await getPinnedBlobMeta(item.name);
      const wasPinned = state.pinnedNames.has(item.name);
      if (meta) {
        if (!wasPinned) { state.pinnedNames.add(item.name); changed = true; }
        const stale = item.content_hash && meta.content_hash
          && item.content_hash !== meta.content_hash;
        const wasStale = state.stalePinnedNames.has(item.name);
        if (stale && !wasStale) { state.stalePinnedNames.add(item.name); changed = true; }
        else if (!stale && wasStale) { state.stalePinnedNames.delete(item.name); changed = true; }
      } else {
        if (wasPinned) { state.pinnedNames.delete(item.name); changed = true; }
        if (state.stalePinnedNames.has(item.name)) { state.stalePinnedNames.delete(item.name); changed = true; }
      }

      // Check non-pinned cached blob state via shared helper.
      if (!state.pinnedNames.has(item.name)) {
        if (await reconcileCachedBlobState(item.name, item)) changed = true;
      }
    } catch {
      // skip
    }
  }
  if (changed) {
    renderList();
    renderDetail();
  }
}

async function recoverMissingCloudRecord(name, { tabKey = state.activeTab } = {}) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return;

  const normalizedTabKey = normalizeTabKey(tabKey);
  const resourceConfig = getCloudLibraryResource(normalizedTabKey);
  resourceConfig.resource.invalidateDetail(normalizedName, { mode: "summary" });
  resourceConfig.resource.invalidateDetail(normalizedName, { mode: "full" });
  resourceConfig.resource.invalidateList();

  if (state.activeTab !== normalizedTabKey) {
    return;
  }

  state.items = state.items.filter((item) => item.name !== normalizedName);
  if (state.selectedDetail?.name === normalizedName) {
    state.selectedDetail = null;
  }
  if (state.selectedName === normalizedName) {
    state.selectedName = state.items[0]?.name || "";
  }

  renderList();
  renderDetail();

  let refreshed = false;
  try {
    await loadList({ force: true, preserveSnapshot: true });
    refreshed = true;
  } finally {
    if (refreshed && state.activeTab === normalizedTabKey) {
      setStatus("cloudLibraryRecordUnavailable", null, "danger");
    }
  }
}

function buildRecordSubtitle(item = {}) {
  const config = getResourceConfig(state.activeTab);
  return config.buildSubtitle(item);
}

function renderList() {
  if (!canRenderView()) return;
  if (!elements.listPanel || !elements.listEmpty || !elements.loadMoreButton) return;

  elements.listPanel.replaceChildren();
  const hasItems = state.items.length > 0;
  elements.listEmpty.hidden = hasItems;
  elements.listEmpty.textContent = buildListEmptyMessage();

  if (hasItems) {
    const fragment = document.createDocumentFragment();
    const config = getResourceConfig(state.activeTab);

    state.items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "library-record";
      button.dataset.selected = item.name === state.selectedName ? "true" : "false";

      const title = document.createElement("strong");
      title.className = "library-record-title";
      title.textContent = item.title || item.name;

      const subtitle = document.createElement("span");
      subtitle.className = "library-record-subtitle";
      subtitle.textContent = buildRecordSubtitle(item) || item.name;

      button.append(title, subtitle);

      const badges = config.buildBadges(item);
      if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media) {
        if (state.stalePinnedNames.has(item.name)) {
          badges.push({ label: t("cloudLibraryPinOutdated"), tone: "warning" });
        } else if (state.pinnedNames.has(item.name)) {
          badges.push({ label: t("cloudLibraryOfflineAvailable"), tone: "success" });
        } else if (state.staleCachedNames.has(item.name)) {
          badges.push({ label: t("cloudLibraryOutdatedLocal"), tone: "warning" });
        } else if (state.cachedBlobNames.has(item.name)) {
          badges.push({ label: t("cloudLibraryCachedLocally"), tone: "success" });
        } else if (isAutoCacheInFlight(item.name)) {
          badges.push({ label: t("cloudLibraryCachingLocally"), tone: "muted" });
        } else if (item._offline) {
          badges.push({ label: t("cloudLibraryMetadataCached"), tone: "muted" });
        }
      }
      if (badges.length > 0) {
        const badgeRow = document.createElement("span");
        badgeRow.className = "library-record-badges";
        badges.forEach((badge) => {
          const chip = document.createElement("span");
          chip.className = "library-record-badge";
          chip.dataset.tone = badge.tone || "muted";
          chip.textContent = badge.label;
          badgeRow.append(chip);
        });
        button.append(badgeRow);
      }

      button.addEventListener("click", () => {
        if (state.selectedName === item.name && state.selectedDetail && !state.detailLoading) {
          return;
        }

        state.selectedName = item.name;
        const config = getResourceConfig(state.activeTab);
        if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media || config.detailFromList) {
          state.selectedDetail = item;
        } else {
          state.selectedDetail = null;
        }
        renderList();
        renderDetail();
        if (state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.media && !config.detailFromList) {
          void loadDetail(item.name);
        }
      });
      fragment.append(button);
    });

    elements.listPanel.append(fragment);
  }

  const showLoadMore = hasItems && state.hasMore && !state.listLoading;
  elements.loadMoreButton.hidden = !showLoadMore;
  elements.loadMoreButton.disabled = state.listLoading;
}

function createMetaRow(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "library-detail-meta-row";

  const term = document.createElement("dt");
  term.textContent = label;

  const description = document.createElement("dd");
  description.textContent = value || "—";

  wrapper.append(term, description);
  return wrapper;
}

function buildDetailMetaEntries(item = {}) {
  const config = getResourceConfig(state.activeTab);
  return config.buildMetaEntries(item);
}

/**
 * Render a type-aware placeholder when the preview image cannot be loaded.
 * Used as a last-resort fallback after both the BFF URL and signed-URL
 * access resolution have failed.
 */
function renderPreviewPlaceholder(item, config) {
  if (!elements.detailPreview) return;
  elements.detailPreview.replaceChildren();
  elements.detailPreview.dataset.previewKind = "unavailable-fallback";
  const fallback = document.createElement("div");
  fallback.className = "library-preview-fallback";
  const iconWrapper = document.createElement("span");
  iconWrapper.className = "library-preview-type-icon";
  iconWrapper.innerHTML = config.tabIcon;
  fallback.append(iconWrapper);
  const label = document.createElement("span");
  label.className = "library-preview-offline-label";
  label.textContent = t("cloudLibraryPreviewUnavailable");
  fallback.append(label);
  elements.detailPreview.append(fallback);
}

async function playMediaItemInGlobalRuntime(item) {
  if (!item?.name) return;
  const tracks = state.items.filter((entry) => String(entry?.media_kind || "").toLowerCase() === "audio");
  audioRuntime.primeAudio?.();
  await audioRuntime.playLibraryTrackNow(item, tracks.length ? tracks : [item]);
  window.__vatioboardPlayerWidget?.open?.();
  if (isAutoCacheEligible(item)) {
    triggerAutoCacheDownload(item.name, item).catch(() => {});
  }
}

function renderDetailPreview(item = {}, { isOfflineItem = false, isPinned = false, localPreviewUrl = "" } = {}) {
  if (!elements.detailPreview) return;

  // A new preview mount ends any active remote playback session.
  remotePlaybackSessionName = "";

  // Revoke any previous local preview URL to avoid memory leaks.
  revokePreviewObjectUrl();
  if (localPreviewUrl) {
    previewObjectUrl = localPreviewUrl;
  }

  const config = getResourceConfig(state.activeTab);
  const previewKind = config.previewKind;

  // Tear down previous map preview if switching away from map type
  if (previewKind !== "map" && mapPreview) {
    mapPreview.destroy();
    mapPreview = null;
  }

  // Tear down any active media player when switching to a non-playable preview
  const mediaKindLower = String(item.media_kind || "").toLowerCase();
  const isPlayableMedia = previewKind === "media" && (mediaKindLower === "audio" || mediaKindLower === "video");
  if (!isPlayableMedia) {
    libraryMediaPlayer.destroy();
    syncToolbarVolume();
  }

  const remoteImageUrl = item.image_url || item.preview_image_url;
  const hasLocalBlob = Boolean(localPreviewUrl);
  const isMetadataOnlyOffline = isOfflineItem && !isPinned && !hasLocalBlob;
  // For items with a local blob (pinned or cached), prefer the local URL
  // over the remote URL so playback works without network access.
  const imageUrl = hasLocalBlob ? localPreviewUrl : remoteImageUrl;

  // Playable media (audio/video): mount inline media player.
  // Fresh local blobs use the local URL regardless of online/offline state;
  // remote URLs are only the fallback when no local blob is available.
  // Metadata-only offline items cannot be played (no blob available).
  if (isPlayableMedia && !isMetadataOnlyOffline) {
    if (window.__vatioboardSpa && mediaKindLower === "audio") {
      libraryMediaPlayer.destroy();
      syncToolbarVolume();
      elements.detailPreview.replaceChildren();
      elements.detailPreview.dataset.previewKind = "audio-runtime";

      const fallback = document.createElement("div");
      fallback.className = "library-preview-fallback";
      const iconWrapper = document.createElement("span");
      iconWrapper.className = "library-preview-type-icon";
      iconWrapper.innerHTML = IconMedia;
      const label = document.createElement("span");
      label.className = "library-preview-kind-label";
      label.textContent = item.title || item.original_filename || t("audioPlayer");
      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.className = "btn-with-icon";
      playButton.innerHTML = `<span class="btn-icon" aria-hidden="true">${IconVolume}</span><span>${t("audioPlayer")}</span>`;
      playButton.addEventListener("click", () => {
        void playMediaItemInGlobalRuntime(item).catch((error) => {
          applyLibraryRequestError(error, { genericKey: "cloudLibraryOpenFailed" });
        });
      });
      fallback.append(iconWrapper, label, playButton);
      elements.detailPreview.append(fallback);
      return;
    }

    const mediaSrc = hasLocalBlob
      ? localPreviewUrl
      : (item.playback_url || item.download_url || item.downloadUrl || remoteImageUrl || "");

    if (mediaSrc) {
      libraryMediaPlayer.destroy();

      // When the source is remote and the item is auto-cache eligible,
      // wire first-play to trigger the same non-blocking background cache
      // used by the Open action.  This fires only once per player mount
      // and skips blob: sources entirely (handled inside createMediaPlayer).
      const onFirstRemotePlay = (!hasLocalBlob && isAutoCacheEligible(item))
        ? () => {
            remotePlaybackSessionName = item.name;
            triggerAutoCacheDownload(item.name, item).catch(() => {});
          }
        : null;

      const mounted = libraryMediaPlayer.mount({
        container: elements.detailPreview,
        item,
        blobUrl: hasLocalBlob ? localPreviewUrl : "",
        onFirstRemotePlay,
      });
      if (mounted) {
        elements.detailPreview.dataset.previewKind = "media-player";
        syncToolbarVolume();

        // For audio items with embedded artwork, resolve artwork URL on
        // demand and render a cover image above the player stage.
        // Deduped via resolveMediaAccess's internal cache.
        if (mediaKindLower === "audio" && item.has_artwork && item.name && !hasLocalBlob) {
          resolveMediaAccess(item.name, item.content_hash, { intent: "artwork" })
            .then((access) => {
              const artUrl = access?.artwork_url;
              if (!artUrl || state.selectedName !== item.name) return;
              const existing = elements.detailPreview.querySelector(".media-player-artwork");
              if (existing) return;
              const artImg = document.createElement("img");
              artImg.className = "media-player-artwork";
              artImg.src = artUrl;
              artImg.alt = item.title || "";
              artImg.loading = "lazy";
              artImg.onerror = () => artImg.remove();
              // Insert before the media player root (.media-player).
              const playerRoot = elements.detailPreview.querySelector(".media-player");
              if (playerRoot) {
                playerRoot.before(artImg);
              }
            })
            .catch(() => {});
        }

        return;
      }
    }
  }

  // Offline media with a local blob (pinned or cached) but no blob URL yet —
  // show a type-aware fallback. The blob URL will arrive asynchronously.
  const hasLocalBlobState = isPinned || state.cachedBlobNames.has(item.name);
  if (isOfflineItem && hasLocalBlobState && previewKind === "media") {
    if (mediaKindLower !== "image") {
      libraryMediaPlayer.destroy();
      syncToolbarVolume();
      elements.detailPreview.replaceChildren();
      elements.detailPreview.dataset.previewKind = "offline-local-fallback";
      const fallback = document.createElement("div");
      fallback.className = "library-preview-fallback";
      const iconWrapper = document.createElement("span");
      iconWrapper.className = "library-preview-type-icon";
      iconWrapper.innerHTML = config.tabIcon;
      fallback.append(iconWrapper);
      const kindLabel = document.createElement("span");
      kindLabel.className = "library-preview-kind-label";
      kindLabel.textContent = item.media_kind || t("cloudLibraryMedia");
      fallback.append(kindLabel);
      const statusLabel = document.createElement("span");
      statusLabel.className = "library-preview-offline-label";
      statusLabel.textContent = t("cloudLibraryOfflineAvailable");
      fallback.append(statusLabel);
      elements.detailPreview.append(fallback);
      return;
    }
  }

  if ((previewKind === "image" || previewKind === "board-preview" || previewKind === "media") && imageUrl && !isMetadataOnlyOffline) {
    // Preserve existing image element when the source URL is unchanged.
    const existingImg = elements.detailPreview.querySelector("img");
    if (existingImg && existingImg.src === imageUrl) {
      elements.detailPreview.dataset.previewKind = "image";
      return;
    }
    elements.detailPreview.replaceChildren();
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = item.title || item.name || t("cloudLibraryMedia");
    image.loading = "lazy";

    // When the BFF redirect URL fails (403/network error on cross-origin
    // subresource), attempt a single on-demand fallback via signed URL.
    // Local blob URLs (blob:) never trigger this path.
    if (!hasLocalBlob && item.name && !imageUrl.startsWith("blob:")) {
      image.onerror = () => {
        image.onerror = null; // prevent re-entry during first fallback
        resolveMediaAccess(item.name, item.content_hash, { intent: "preview" })
          .then((access) => {
            const fallbackUrl = access?.image_url || access?.preview_image_url || access?.download_url;
            if (fallbackUrl && image.parentNode) {
              // If the signed fallback URL also fails, show placeholder.
              image.onerror = () => {
                image.onerror = null;
                renderPreviewPlaceholder(item, config);
              };
              image.src = fallbackUrl;
            } else {
              renderPreviewPlaceholder(item, config);
            }
          })
          .catch(() => {
            renderPreviewPlaceholder(item, config);
          });
      };
    }

    elements.detailPreview.append(image);
    elements.detailPreview.dataset.previewKind = "image";
    return;
  }

  // For metadata-only offline items, render a type-aware offline fallback
  // instead of attempting to load a remote preview URL.
  if (isMetadataOnlyOffline && (previewKind === "media" || previewKind === "image")) {
    elements.detailPreview.replaceChildren();
    elements.detailPreview.dataset.previewKind = "offline-fallback";
    const fallback = document.createElement("div");
    fallback.className = "library-preview-fallback";
    const iconWrapper = document.createElement("span");
    iconWrapper.className = "library-preview-type-icon";
    iconWrapper.innerHTML = config.tabIcon;
    fallback.append(iconWrapper);
    const label = document.createElement("span");
    label.className = "library-preview-offline-label";
    label.textContent = t("cloudLibraryPreviewOffline");
    fallback.append(label);
    elements.detailPreview.append(fallback);
    return;
  }

  if (previewKind === "map") {
    const coordinates = config.getPreviewRoute(item);

    if (coordinates && coordinates.length >= 2) {
      // Ensure map container exists
      let mapContainer = elements.detailPreview.querySelector(".library-map-container");
      if (!mapContainer) {
        elements.detailPreview.replaceChildren();
        mapContainer = document.createElement("div");
        mapContainer.className = "library-map-container";
        elements.detailPreview.append(mapContainer);
      }
      elements.detailPreview.dataset.previewKind = "map";

      if (!mapPreview || mapPreview._element !== mapContainer) {
        if (mapPreview) mapPreview.destroy();
        mapPreview = createLibraryMapPreview({ element: mapContainer });
        mapPreview._element = mapContainer;
      }

      void mapPreview.showRoute(coordinates);
      return;
    }

    // Fall through to fallback if no route geometry
    if (mapPreview) {
      mapPreview.destroy();
      mapPreview = null;
    }
  }

  // Type icon or generic fallback
  elements.detailPreview.replaceChildren();
  elements.detailPreview.dataset.previewKind = previewKind || "fallback";
  const fallback = document.createElement("div");
  fallback.className = "library-preview-fallback";

  if (previewKind === "type-icon" || previewKind === "board-preview") {
    const iconWrapper = document.createElement("span");
    iconWrapper.className = "library-preview-type-icon";
    iconWrapper.innerHTML = config.tabIcon;
    fallback.append(iconWrapper);
    const label = document.createElement("span");
    label.textContent = item.title || item.name || t("cloudLibrary");
    fallback.append(label);
  } else {
    fallback.textContent = item.title || item.name || t("cloudLibrary");
  }

  elements.detailPreview.append(fallback);
}

function syncActionButton(button, isVisible, isDisabled) {
  if (!button) return;
  button.hidden = !isVisible;
  button.disabled = isDisabled;
}

function renderDetail() {
  if (!canRenderView()) return;
  if (
    !elements.detailEmpty
    || !elements.detailCard
    || !elements.detailTitle
    || !elements.detailSubtitle
    || !elements.detailMeta
  ) {
    return;
  }

  const selectedItem = state.selectedDetail
    || state.items.find((item) => item.name === state.selectedName)
    || null;
  const detailVisible = Boolean(selectedItem);

  elements.detailEmpty.hidden = detailVisible;
  elements.detailCard.hidden = !detailVisible;

  if (!detailVisible) {
    lastPreviewSignature = "";
    revokePreviewObjectUrl();
    elements.detailEmpty.textContent = state.detailLoading
      ? t("cloudLibraryLoading")
      : t("cloudLibrarySelectPrompt");
    syncActionButton(elements.actionOpen, false, false);
    syncActionButton(elements.actionDownload, false, false);
    syncActionButton(elements.actionRename, false, false);
    syncActionButton(elements.actionDelete, false, false);
    syncActionButton(elements.actionPin, false, false);
    overflowMenu.setOpen(false);
    if (elements.overflowBtn) elements.overflowBtn.hidden = true;

    // Tear down map preview when nothing selected
    if (mapPreview) {
      mapPreview.cancelAnimation();
    }
    remotePlaybackSessionName = "";
    libraryMediaPlayer.destroy();
    syncToolbarVolume();
    return;
  }

  const isSelectedMutating = state.mutatingNames.has(state.selectedName);
  const actionBusy = state.openBusy || isSelectedMutating || state.detailLoading;
  const config = getResourceConfig(state.activeTab);
  const isMediaTab = state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media;
  const isPinned = isMediaTab && state.pinnedNames.has(state.selectedName);
  const isStalePin = isMediaTab && state.stalePinnedNames.has(state.selectedName);
  const isCachedBlob = isMediaTab && state.cachedBlobNames.has(state.selectedName);
  const isStaleCached = isMediaTab && state.staleCachedNames.has(state.selectedName);
  const hasAnyFreshLocal = (isPinned && !isStalePin) || (isCachedBlob && !isStaleCached);
  const isOfflineItem = isMediaTab && Boolean(selectedItem._offline);
  const isMetadataOnly = isOfflineItem && !isPinned && !isCachedBlob;

  elements.detailTitle.textContent = selectedItem.title || selectedItem.name;
  elements.detailSubtitle.textContent = buildRecordSubtitle(selectedItem) || selectedItem.name;

  // Only rebuild the preview when preview-relevant inputs changed.
  // When a fresh local blob exists, skip the initial render if there is
  // already a preview showing — the async blob resolution below (or the
  // prior BFF render) provides a better URL.  Without this guard,
  // re-entering renderDetail after auto-cache would regress the preview
  // from the BFF URL to the raw item URL before the blob resolves.
  const previewSig = derivePreviewSignature(selectedItem, { isOfflineItem, isPinned });
  const skipInitialForLocalBlob = hasAnyFreshLocal && lastPreviewSignature;
  if (!skipInitialForLocalBlob && previewSig !== lastPreviewSignature) {
    lastPreviewSignature = previewSig;
    renderDetailPreview(selectedItem, { isOfflineItem, isPinned });
  }

  // For items with a fresh local blob (pinned or cached), asynchronously
  // resolve a local blob URL and re-render the preview so playback does
  // not rely on the remote BFF redirect URL.
  const selectedMediaKind = String(selectedItem.media_kind || "").toLowerCase();
  // Skip async blob resolution when a remote playback session is active
  // for this item.  The cached blob will be used on the next mount.
  const skipBlobForActiveRemoteSession = remotePlaybackSessionName === state.selectedName
    && (selectedMediaKind === "audio" || selectedMediaKind === "video");
  if (hasAnyFreshLocal && !skipBlobForActiveRemoteSession && (selectedMediaKind === "image" || selectedMediaKind === "audio" || selectedMediaKind === "video")) {
    const localName = state.selectedName;
    Promise.resolve(getLocalMediaBlob(localName)).then((result) => {
      if (!result?.blob || state.selectedName !== localName) return;
      // Stale local blobs should not be used for preview when online.
      if (result.contentHash && selectedItem.content_hash && result.contentHash !== selectedItem.content_hash) return;
      const localUrl = URL.createObjectURL(result.blob);
      const localIsPinned = result.source === "pinned";
      const localSig = derivePreviewSignature(selectedItem, { isOfflineItem, isPinned: localIsPinned, localPreviewUrl: localUrl });
      if (localSig !== lastPreviewSignature) {
        lastPreviewSignature = localSig;
        renderDetailPreview(selectedItem, { isOfflineItem, isPinned: localIsPinned, localPreviewUrl: localUrl });
      }
    }).catch(() => {});
  }

  // For online media items without a fresh local blob, resolve a presigned
  // URL via the authenticated access endpoint, then render the preview.
  // For images this avoids 403 on cross-origin BFF redirect <img> src.
  // For audio/video this provides a playback_url so the media player can mount.
  // Before making the network call, verify no local blob exists — the
  // cachedBlobNames set may not be reconciled yet (async pin-state refresh).
  const hasFreshLocal = hasAnyFreshLocal;
  if (!isOfflineItem && !hasFreshLocal && isMediaTab && (selectedMediaKind === "audio" || selectedMediaKind === "video" || selectedMediaKind === "image")) {
    const accessName = selectedItem.name;
    const accessHash = selectedItem.content_hash;
    Promise.resolve(getLocalMediaBlob(accessName)).then((localCheck) => {
      // A local blob exists (may not be in cachedBlobNames yet) — skip.
      if (localCheck?.blob) return null;
      // Fresh pinned/cached items don't need access; stale ones do.
      const freshPin = state.pinnedNames.has(accessName) && !state.stalePinnedNames.has(accessName);
      const freshCache = state.cachedBlobNames.has(accessName) && !state.staleCachedNames.has(accessName);
      if (freshPin || freshCache) return null;
      if (state.selectedName !== accessName) return null;
      return resolveMediaAccess(accessName, accessHash);
    }).then((access) => {
      // Abort if selection changed or a fresh local blob arrived in the meantime.
      if (!access || state.selectedName !== accessName) return;
      const freshPin = state.pinnedNames.has(accessName) && !state.stalePinnedNames.has(accessName);
      const freshCache = state.cachedBlobNames.has(accessName) && !state.staleCachedNames.has(accessName);
      if (freshPin || freshCache) return;
      const accessItem = { ...selectedItem };
      if (selectedMediaKind === "image") {
        accessItem.image_url = access.image_url || access.download_url || "";
      }
      if (selectedMediaKind === "audio" || selectedMediaKind === "video") {
        accessItem.playback_url = access.playback_url || access.download_url || "";
      }
      if (access.preview_image_url) {
        accessItem.preview_image_url = access.preview_image_url;
      }
      const accessSig = derivePreviewSignature(accessItem, { isOfflineItem, isPinned });
      if (accessSig !== lastPreviewSignature) {
        lastPreviewSignature = accessSig;
        renderDetailPreview(accessItem, { isOfflineItem, isPinned });
      }
    }).catch(() => {});
  }

  elements.detailMeta.replaceChildren();
  buildDetailMetaEntries(selectedItem).forEach(([label, value]) => {
    elements.detailMeta.append(createMetaRow(label, value));
  });

  const canOpenSelectedItem = canOpenCloudLibraryItem(selectedItem);
  const showOpen = !config.canDownload || canOpenSelectedItem;

  // When an item is metadata-only offline, disable actions that require network.
  // Pinned items can be opened offline but cannot be downloaded/renamed/deleted.
  // Stale pinned items prefer the remote URL, so open is also disabled offline.
  const offlineGated = isMetadataOnly || (isOfflineItem && isPinned);
  // Mutation actions (rename/delete/download) require an active capability with
  // a CSRF token.  During the offline→online reconnect window feature access may
  // still be null while rehydration is in progress.  Disable these actions until
  // the capability is fully resolved to avoid dead-end interactions.
  const capabilityReady = getCurrentCapability()?.enabled === true;
  const authGated = !capabilityReady || state.authLoading;
  const mutationGated = actionBusy || offlineGated || authGated;

  // Open: local-only open (fresh pinned or cached blob) works without auth;
  // all other open paths hit the network and require a valid session.
  const hasLocalBlob = (isPinned && !isStalePin) || (isCachedBlob && !isStaleCached);
  const openDisabled = actionBusy || !canOpenSelectedItem || isMetadataOnly
    || (isStalePin && isOfflineItem)
    || (!hasLocalBlob && authGated);
  syncActionButton(elements.actionOpen, showOpen, openDisabled);
  syncActionButton(elements.actionDownload, config.canDownload, mutationGated);
  syncActionButton(elements.actionRename, config.canRename, mutationGated);
  syncActionButton(elements.actionDelete, config.canDelete, mutationGated);

  // Pin/unpin for media assets.
  // Unpin is a local-only operation and stays available without auth.
  // Pin / re-pin downloads from the server and requires a valid session.
  const pinDisabled = actionBusy || (hasLocalBlob ? false : authGated);
  syncActionButton(elements.actionPin, isMediaTab, pinDisabled);
  if (elements.actionPin) {
    const pinLabel = elements.actionPin.querySelector("[data-i18n]");
    if (pinLabel) {
      if (isStalePin) {
        pinLabel.textContent = t("cloudLibraryRepin");
      } else {
        pinLabel.textContent = isPinned ? t("cloudLibraryUnpin") : t("cloudLibraryPin");
      }
    }
    elements.actionPin.dataset.pinned = isPinned ? "true" : "false";
    elements.actionPin.dataset.stale = isStalePin ? "true" : "false";
  }

  // Show the overflow trigger when at least one overflow item is visible.
  const hasOverflowItems = config.canDownload || config.canRename || config.canDelete || isMediaTab;
  if (elements.overflowBtn) elements.overflowBtn.hidden = !hasOverflowItems;

  // Availability status line in the meta section
  if (isMediaTab && elements.detailMeta) {
    if (isStalePin && isOfflineItem) {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryPinStaleOffline")),
      );
    } else if (isStalePin) {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryPinOutdated")),
      );
    } else if (isPinned) {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryOfflineAvailable")),
      );
    } else if (isStaleCached) {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryOutdatedLocal")),
      );
    } else if (isCachedBlob) {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryCachedLocally")),
      );
    } else if (isAutoCacheInFlight(state.selectedName)) {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryCachingLocally")),
      );
    } else if (isOfflineItem) {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryMetadataCached")),
      );
    } else {
      elements.detailMeta.append(
        createMetaRow(t("cloudLibraryAvailability"), t("cloudLibraryCloudOnly")),
      );
    }
  }
}

async function loadDetail(name, { force = false } = {}) {
  if (!name) return;

  const resourceConfig = getCurrentResourceConfig();
  const tabKey = state.activeTab;
  const detailFromList = getResourceConfig(tabKey).detailFromList;
  const requestId = stopRequest(detailRequestState);
  const controller = new AbortController();
  detailRequestState.controller = controller;

  state.detailLoading = true;
  renderDetail();

  try {
    const response = await resourceConfig.resource.getDetail(name, {
      force,
      mode: resourceConfig.detailMode || "summary",
      signal: controller.signal,
    });

    if (
      requestId !== detailRequestState.requestId
      || tabKey !== state.activeTab
      || name !== state.selectedName
    ) {
      return;
    }

    setStatus();
    state.selectedDetail = resourceConfig.getDetailItem(response) || null;
    renderDetail();

    if (!force && tabKey !== CLOUD_LIBRARY_TAB_KEYS.media && !detailFromList) {
      void resourceConfig.resource.getDetail(name, {
        force: true,
        mode: resourceConfig.detailMode || "summary",
      }).then((freshResponse) => {
        if (
          tabKey !== state.activeTab
          || name !== state.selectedName
          || requestId !== detailRequestState.requestId
        ) {
          return;
        }
        state.selectedDetail = resourceConfig.getDetailItem(freshResponse) || state.selectedDetail;
        renderDetail();
      }).catch(async (error) => {
        if (requestId !== detailRequestState.requestId || isAbortError(error)) return;
        if (isNotFoundError(error) && tabKey === state.activeTab && name === state.selectedName) {
          await recoverMissingCloudRecord(name);
        } else {
          applyLibraryRequestError(error, { genericKey: "cloudLibraryDetailFailed" });
          renderDetail();
        }
      });
    }
  } catch (error) {
    if (!isAbortError(error)) {
      if (isNotFoundError(error) && tabKey === state.activeTab && name === state.selectedName) {
        await recoverMissingCloudRecord(name);
      } else {
        applyLibraryRequestError(error, { genericKey: "cloudLibraryDetailFailed" });
      }
    }
  } finally {
    if (requestId === detailRequestState.requestId) {
      state.detailLoading = false;
      renderDetail();
      void refreshPinState(name);
    }
  }
}

/**
 * Re-fetch session + feature-access after recovering from offline-limited mode.
 * Called once when loadList detects a transition from offline → online so that
 * upload visibility, tab access, and capability-driven actions become current.
 *
 * Guarded by authGeneration: results are discarded if a newer auth operation
 * (refreshAuthState, logout, auth-state event) started while this was in-flight.
 */
function rehydrateAuthOnReconnect() {
  state.reconnecting = true;
  const myGeneration = authGeneration;
  void (async () => {
    try {
      const session = await getBackendSessionState({ force: true });
      if (authGeneration !== myGeneration) return;
      state.session = session;
      if (session.authenticated) {
        const loggedUser = await fetchBackendLoggedUser().catch(() => null);
        if (authGeneration !== myGeneration) return;
        if (loggedUser?.user) {
          setMediaCacheUser(loggedUser.user);
        }
        const featureAccess = await getBackendFeatureAccessState({ force: true });
        if (authGeneration !== myGeneration) return;
        state.featureAccess = featureAccess;
      }
    } catch { /* stay with stale state if backend is flaky */ }
    if (authGeneration === myGeneration) {
      state.reconnecting = false;
    }
    renderTabs();
    renderDetail();
  })();
}

async function loadList({ append = false, force = false, offlineBootstrap = false, preserveSnapshot = false } = {}) {
  const capability = getCurrentCapability();
  const isOfflineMediaTab = state.listOffline && state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media;
  const isReconnectingMediaTab = state.reconnecting && state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media;
  if (!capability?.enabled && !offlineBootstrap && !isOfflineMediaTab && !isReconnectingMediaTab) {
    state.items = [];
    state.totalCount = 0;
    state.hasMore = false;
    state.nextOffset = 0;
    state.selectedName = "";
    state.selectedDetail = null;
    renderList();
    renderDetail();
    return;
  }

  const resourceConfig = getCurrentResourceConfig();
  const tabKey = state.activeTab;
  const detailFromList = getResourceConfig(tabKey).detailFromList;
  const offset = append ? state.nextOffset : 0;
  const previousSelectedName = state.selectedName;
  const requestKey = buildListRequestKey({
    tabKey,
    limit: PAGE_SIZE,
    offset,
    search: state.query.search,
    sort: state.query.sort,
  });
  if (!append && !force && listRequestState.requestKey === requestKey && state.listLoading) {
    return;
  }

  const generation = listRequestState.generation + 1;
  listRequestState.generation = generation;
  const requestId = stopRequest(listRequestState);
  const controller = new AbortController();
  listRequestState.controller = controller;
  listRequestState.requestKey = requestKey;
  state.listLoading = true;
  if (!append && !state.reconnecting && !preserveSnapshot) {
    state.items = [];
    state.selectedName = "";
    state.selectedDetail = null;
  }
  renderList();
  renderDetail();

  try {
    const response = await resourceConfig.resource.list(
      {
        limit: PAGE_SIZE,
        offset,
        search: state.query.search || undefined,
        sort: state.query.sort,
      },
      {
        force,
        signal: controller.signal,
      }
    );

    if (!isActiveListRequest({
      generation,
      requestId,
      requestKey,
      tabKey,
    })) {
      return;
    }

    setStatus();
    const nextItems = resourceConfig.getItems(response);
    const isOfflineResponse = Boolean(response?._offline);
    // During offline bootstrap, cached manifest responses should be treated
    // as offline so items are tagged _offline and state.listOffline is set.
    // Without this, cache-first responses (_cached: true) masquerade as
    // online-capable and the player prefers remote URLs over local blobs.
    const effectivelyOffline = isOfflineResponse || (offlineBootstrap && Boolean(response?._cached));
    const isStaleResponse = Boolean(response?._cached || response?._offline);
    if (effectivelyOffline) {
      for (const item of nextItems) { item._offline = true; }
    }
    state.items = append ? [...state.items, ...nextItems.filter((item) =>
      !state.items.some((existing) => existing.name === item.name)
    )] : nextItems;
    const wasOffline = state.listOffline;
    state.listOffline = effectivelyOffline;
    if (wasOffline && !isOfflineResponse) rehydrateAuthOnReconnect();
    if (wasOffline !== isOfflineResponse) renderTabs();
    state.totalCount = Number(response?.totalCount ?? response?.total_count) || state.items.length;
    state.hasMore = response?.hasMore === true || response?.has_more === true;
    state.nextOffset = Number(response?.nextOffset ?? response?.next_offset) || (offset + nextItems.length);

    const nextSelected = state.items.find((item) => item.name === previousSelectedName)
      ? previousSelectedName
      : (state.items[0]?.name || "");
    const selectionChanged = nextSelected !== previousSelectedName;
    state.selectedName = nextSelected;
    if (selectionChanged || !state.selectedDetail || state.selectedDetail.name !== nextSelected) {
      if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media || detailFromList) {
        state.selectedDetail = state.items.find((i) => i.name === nextSelected) || null;
      } else {
        state.selectedDetail = null;
      }
    } else if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media || detailFromList) {
      // Keep detail in sync with the refreshed list row data so flags
      // like _offline and updated URLs propagate to renderDetail.
      state.selectedDetail = state.items.find((i) => i.name === state.selectedName) || state.selectedDetail;
    }
    renderList();
    renderDetail();

    if (state.selectedName && (!state.selectedDetail || selectionChanged || preserveSnapshot)) {
      if (tabKey !== CLOUD_LIBRARY_TAB_KEYS.media && !detailFromList) {
        void loadDetail(state.selectedName);
      }
    }

    void refreshPinStatesForItems(state.items);

    if (!force && !append && isStaleResponse) {
      const revalidationFence = {
        generation,
        requestId,
        requestKey,
        tabKey,
      };
      void resourceConfig.resource.list(
        {
          limit: PAGE_SIZE,
          offset,
          search: state.query.search || undefined,
          sort: state.query.sort,
        },
        { force: true }
      ).then((freshResponse) => {
        if (!isActiveListRequest(revalidationFence)) {
          return;
        }

        const freshItems = resourceConfig.getItems(freshResponse);
        const wasOffline = state.listOffline;
        const isFreshOffline = Boolean(freshResponse?._offline);
        if (isFreshOffline) {
          for (const item of freshItems) { item._offline = true; }
        }
        state.items = freshItems;
        state.listOffline = isFreshOffline;
        state.totalCount = Number(freshResponse?.totalCount ?? freshResponse?.total_count) || state.items.length;
        state.hasMore = freshResponse?.hasMore === true || freshResponse?.has_more === true;
        state.nextOffset = Number(freshResponse?.nextOffset ?? freshResponse?.next_offset) || state.items.length;
        if (!state.items.some((item) => item.name === state.selectedName)) {
          state.selectedName = state.items[0]?.name || "";
          if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media || detailFromList) {
            state.selectedDetail = state.items.find((i) => i.name === state.selectedName) || null;
          } else {
            state.selectedDetail = null;
            if (state.selectedName) {
              void loadDetail(state.selectedName, { force: true });
            }
          }
        } else if ((tabKey === CLOUD_LIBRARY_TAB_KEYS.media || detailFromList) && state.selectedName) {
          // Keep the detail in sync with the refreshed list row data
          // so that flags like _offline propagate to renderDetail.
          state.selectedDetail = state.items.find((i) => i.name === state.selectedName) || state.selectedDetail;
        }
        if (wasOffline && !isFreshOffline) rehydrateAuthOnReconnect();
        if (wasOffline !== isFreshOffline) renderTabs();
        renderList();
        renderDetail();
      }).catch((error) => {
        if (isAbortError(error) || !isActiveListRequest(revalidationFence)) return;
        applyLibraryRequestError(error);
        renderList();
        renderDetail();
      });
    }
  } catch (error) {
    if (!isAbortError(error)) {
      applyLibraryRequestError(error);
      if (!append) {
        state.items = [];
        state.totalCount = 0;
        state.hasMore = false;
        state.nextOffset = 0;
        state.selectedName = "";
        state.selectedDetail = null;
      }
      renderList();
      renderDetail();
    }
  } finally {
    if (requestId === listRequestState.requestId) {
      state.listLoading = false;
      renderList();
      renderDetail();
    }
  }
}

function triggerDownload(url) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noreferrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function openSelectedItem() {
  if (!state.selectedName || state.openBusy) return;

  const selectedName = state.selectedName;
  const tabKey = state.activeTab;
  state.openBusy = true;
  renderDetail();

  try {
    let href = "";

    if (tabKey === CLOUD_LIBRARY_TAB_KEYS.speed) {
      href = await openCloudReplaySession(selectedName);
    } else if (tabKey === CLOUD_LIBRARY_TAB_KEYS.accel) {
      href = await openCloudAccelRun(selectedName);
    } else if (tabKey === CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
      href = await openCloudBoardDocument(selectedName);
    } else if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media) {
      const asset = state.selectedDetail
        || state.items.find((item) => item.name === selectedName)
        || null;

      const mediaKind = String(asset?.media_kind || "").toLowerCase();

      if (window.__vatioboardSpa && mediaKind === "audio") {
        await playMediaItemInGlobalRuntime(asset);
        state.openBusy = false;
        renderDetail();
        return;
      }

      // Prefer a fresh local blob (pinned or cached) over remote access.
      const isPinnedStale = state.stalePinnedNames.has(selectedName);
      const isCachedStale = state.staleCachedNames.has(selectedName);
      const hasLocalPin = state.pinnedNames.has(selectedName) && !isPinnedStale;
      const hasLocalCache = state.cachedBlobNames.has(selectedName) && !isCachedStale;

      if (hasLocalPin || hasLocalCache) {
        const localResult = await getLocalMediaBlob(selectedName).catch(() => null);
        if (localResult?.blob) {
          // Verify content hash freshness.
          const hashOk = !asset?.content_hash || !localResult.contentHash
            || asset.content_hash === localResult.contentHash;
          if (hashOk) {
            const objectUrl = URL.createObjectURL(localResult.blob);
            window.open(objectUrl, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
            state.openBusy = false;
            renderDetail();
            return;
          }
        }
      }

      // Resolve a signed object-storage URL on demand; fall back to the
      // BFF redirect URL (which itself redirects to storage).
      const access = await resolveMediaAccess(selectedName, asset?.content_hash, { intent: "playback" }).catch(() => null);
      const viewUrl = (mediaKind === "audio" || mediaKind === "video")
        ? (access?.playback_url || access?.download_url || buildMediaBffUrl(selectedName))
        : (access?.image_url || access?.download_url || buildMediaBffUrl(selectedName));

      if (viewUrl) {
        window.open(viewUrl, "_blank", "noopener,noreferrer");
      }

      // Trigger background auto-cache for eligible items that were opened
      // via the remote path (no blocking — fire and forget).
      if (asset && isAutoCacheEligible(asset)) {
        triggerAutoCacheDownload(selectedName, asset).catch(() => {});
      }
    }

    if (href) {
      navigateToAppRoute(href);
    }
  } catch (error) {
    if (!isAbortError(error)) {
      if (isNotFoundError(error)) {
        await recoverMissingCloudRecord(selectedName, { tabKey });
      } else {
        applyLibraryRequestError(error, { genericKey: "cloudLibraryOpenFailed" });
      }
    }
  } finally {
    state.openBusy = false;
    renderDetail();
  }
}

async function renameSelectedBoardDocument() {
  if (!state.selectedName || state.mutatingNames.has(state.selectedName) || state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
    return;
  }

  const selectedName = state.selectedName;
  const tabKey = state.activeTab;
  const capability = getCurrentCapability();
  if (!capability?.enabled || !capability.csrfToken) {
    setStatus("cloudLibraryAccessUnavailable", null, "danger");
    return;
  }

  const currentTitle = state.selectedDetail?.title
    || state.items.find((item) => item.name === state.selectedName)?.title
    || t("boardDocumentUntitled");

  const title = await showPromptDialog({
    title: t("cloudLibraryRenameTitle"),
    message: t("cloudLibraryRenameMessage"),
    placeholder: t("boardTitlePlaceholder"),
    value: currentTitle,
    confirmLabel: t("cloudLibraryRename"),
    cancelLabel: t("cancel"),
  });

  if (title === null) return;

  const trimmedTitle = String(title || "").trim();
  if (!trimmedTitle) {
    setStatus("boardDocumentTitleRequired", null, "danger");
    return;
  }

  state.mutatingNames.add(selectedName);
  renderDetail();

  try {
    const response = await updateBoardDocumentInBackend({
      name: selectedName,
      title: trimmedTitle,
      csrfToken: capability.csrfToken,
    });

    if (!response.ok || !response.document) {
      if (response.status === 401) {
        applyLibraryRequestError({ status: response.status });
        return;
      }
      if (response.status === 404) {
        await recoverMissingCloudRecord(selectedName, { tabKey });
        return;
      }
      setStatus("cloudLibraryRenameFailed", { status: response.status || 0 }, "danger");
      return;
    }

    getCurrentResourceConfig().resource.invalidateDetail(selectedName, { mode: "summary" });
    getCurrentResourceConfig().resource.invalidateDetail(selectedName, { mode: "full" });
    getCurrentResourceConfig().resource.invalidateList();
    setStatus("cloudLibraryRenamed", { title: response.document.title }, "success");
    await loadList({ force: true, preserveSnapshot: true });
  } catch {
    setStatus("cloudLibraryRenameFailed", { status: 0 }, "danger");
  } finally {
    state.mutatingNames.delete(selectedName);
    renderDetail();
  }
}

async function renameSelectedMediaAsset() {
  if (!state.selectedName || state.mutatingNames.has(state.selectedName) || state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.media) {
    return;
  }

  const selectedName = state.selectedName;
  const tabKey = state.activeTab;
  const capability = getCurrentCapability();
  if (!capability?.enabled || !capability.csrfToken) {
    setStatus("cloudLibraryAccessUnavailable", null, "danger");
    return;
  }

  const currentTitle = state.selectedDetail?.title
    || state.items.find((item) => item.name === state.selectedName)?.title
    || t("cloudLibraryMediaUntitled");

  const title = await showPromptDialog({
    title: t("cloudLibraryRenameMediaTitle"),
    message: t("cloudLibraryRenameMediaMessage"),
    placeholder: currentTitle,
    value: currentTitle,
    confirmLabel: t("cloudLibraryRename"),
    cancelLabel: t("cancel"),
  });

  if (title === null) return;

  const trimmedTitle = String(title || "").trim();
  if (!trimmedTitle) {
    setStatus("cloudLibraryRenameFailed", { status: 0 }, "danger");
    return;
  }

  state.mutatingNames.add(selectedName);
  renderDetail();

  try {
    const response = await updateMediaAssetInBackend({
      name: selectedName,
      title: trimmedTitle,
      csrfToken: capability.csrfToken,
    });

    if (!response.ok || !response.asset) {
      if (response.status === 401) {
        applyLibraryRequestError({ status: response.status });
        return;
      }
      if (response.status === 404) {
        await recoverMissingCloudRecord(selectedName, { tabKey });
        return;
      }
      setStatus("cloudLibraryRenameFailed", { status: response.status || 0 }, "danger");
      return;
    }

    getCurrentResourceConfig().resource.invalidateDetail(selectedName, { mode: "summary" });
    getCurrentResourceConfig().resource.invalidateDetail(selectedName, { mode: "full" });
    getCurrentResourceConfig().resource.invalidateList();
    setStatus("cloudLibraryRenamed", { title: response.asset.title }, "success");
    await loadList({ force: true, preserveSnapshot: true });
  } catch {
    setStatus("cloudLibraryRenameFailed", { status: 0 }, "danger");
  } finally {
    state.mutatingNames.delete(selectedName);
    renderDetail();
  }
}

async function deleteSelectedItem() {
  if (!state.selectedName || state.mutatingNames.has(state.selectedName)) return;

  const selectedName = state.selectedName;
  const tabKey = state.activeTab;
  const config = getResourceConfig(state.activeTab);
  if (!config.canDelete) return;

  const capability = getCurrentCapability();
  if (!capability?.enabled || !capability.csrfToken) {
    setStatus("cloudLibraryAccessUnavailable", null, "danger");
    return;
  }

  const selectedItem = state.selectedDetail
    || state.items.find((item) => item.name === selectedName)
    || null;
  const currentTitle = selectedItem?.title || selectedItem?.name || selectedName;

  const confirmed = await showConfirmDialog({
    title: t("cloudLibraryDeleteTitle"),
    message: t("cloudLibraryDeleteMessage", { title: currentTitle }),
    confirmLabel: t("cloudLibraryDelete"),
    cancelLabel: t("cancel"),
    destructive: true,
    icon: IconTrash,
  });

  if (!confirmed) return;

  state.mutatingNames.add(selectedName);
  renderDetail();

  try {
    let response;

    if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
      response = await deleteBoardDocumentFromBackend({
        name: selectedName,
        csrfToken: capability.csrfToken,
      });
    } else if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media) {
      response = await deleteMediaAssetFromBackend({
        name: selectedName,
        csrfToken: capability.csrfToken,
      });
    } else if (
      state.activeTab === CLOUD_LIBRARY_TAB_KEYS.speed
      || state.activeTab === CLOUD_LIBRARY_TAB_KEYS.accel
    ) {
      const ids = config.getDeleteIdentifiers(selectedItem || { name: state.selectedName });
      response = await deleteSyncRecordFromBackend({
        entityType: ids.entityType,
        clientRecordId: ids.clientRecordId,
        deviceId: ids.deviceId,
        deletedAtMs: Date.now(),
        csrfToken: capability.csrfToken,
      });
    }

    if (response && !response.ok) {
      if (response.status === 401) {
        applyLibraryRequestError({ status: response.status });
        return;
      }
      if (response.status === 404) {
        await recoverMissingCloudRecord(selectedName, { tabKey });
        return;
      }
      setStatus("cloudLibraryDeleteFailed", { status: response.status || 0 }, "danger");
      return;
    }

    const resourceConfig = getCurrentResourceConfig();
    resourceConfig.resource.invalidateDetail(selectedName, { mode: "summary" });
    resourceConfig.resource.invalidateDetail(selectedName, { mode: "full" });
    resourceConfig.resource.invalidateList();
    setStatus("cloudLibraryDeleted", null, "success");
    state.selectedName = "";
    state.selectedDetail = null;
    await loadList({ force: true, preserveSnapshot: true });
  } catch {
    setStatus("cloudLibraryDeleteFailed", { status: 0 }, "danger");
  } finally {
    state.mutatingNames.delete(selectedName);
    renderDetail();
  }
}

async function downloadSelectedMedia() {
  const asset = state.selectedDetail
    || state.items.find((item) => item.name === state.selectedName)
    || null;
  const assetName = asset?.name || state.selectedName;
  if (!assetName) return;

  try {
    const access = await resolveMediaAccess(assetName, asset?.content_hash, { intent: "download" });
    if (access?.download_url) {
      triggerDownload(access.download_url);
      return;
    }
  } catch { /* fall through to BFF URL */ }

  triggerDownload(buildMediaBffUrl(assetName) + "&as_attachment=1");
}

async function togglePinSelectedMedia() {
  if (state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.media || !state.selectedName) return;
  if (state.mutatingNames.has(state.selectedName)) return;

  const selectedName = state.selectedName;
  const isPinned = state.pinnedNames.has(selectedName);
  const isStale = state.stalePinnedNames.has(selectedName);
  const asset = state.selectedDetail
    || state.items.find((item) => item.name === selectedName)
    || null;

  if (isPinned && !isStale) {
    // Unpin
    state.mutatingNames.add(selectedName);
    renderDetail();
    try {
      const unpinOk = await unpinMediaBlob(selectedName);
      if (unpinOk) {
        state.pinnedNames.delete(selectedName);
        state.stalePinnedNames.delete(selectedName);
        renderList();
        setStatus("cloudLibraryUnpinned", { title: asset?.title || selectedName }, "success");
      } else {
        setStatus("cloudLibraryPinFailed", null, "danger");
      }
    } catch {
      setStatus("cloudLibraryPinFailed", null, "danger");
    } finally {
      state.mutatingNames.delete(selectedName);
      renderDetail();
    }
    return;
  }

  // ── Local promotion fast path ──────────────────────────────────
  // When a fresh cached blob exists locally with a matching content hash,
  // promote it to pinned entirely locally — no backend access resolution,
  // no signed URL fetch, no BFF blob streaming.  Stale cached blobs are
  // intentionally excluded; they fall through to the network path below.
  const hasFreshCachedBlob = state.cachedBlobNames.has(selectedName) && !state.staleCachedNames.has(selectedName);
  if (!isPinned && hasFreshCachedBlob) {
    state.mutatingNames.add(selectedName);
    setStatusText(t("cloudLibraryPinning"), "muted");
    renderDetail();
    try {
      const localResult = await getCachedMediaBlob(selectedName).catch(() => null);
      const localMeta = await getCachedBlobMeta(selectedName).catch(() => null);
      const cachedHash = localMeta?.content_hash || null;
      const assetHash = asset?.content_hash || null;
      const hashMatch = !assetHash || !cachedHash || assetHash === cachedHash;

      if (localResult && hashMatch) {
        const pinOk = await pinMediaBlob(selectedName, localResult, { contentHash: cachedHash });
        if (pinOk) {
          removeCachedMediaBlob(selectedName).catch(() => {});
          state.cachedBlobNames.delete(selectedName);
          state.staleCachedNames.delete(selectedName);
          state.pinnedNames.add(selectedName);
          state.stalePinnedNames.delete(selectedName);
          renderList();
          setStatus("cloudLibraryPinned", { title: asset?.title || selectedName }, "success");
        } else {
          // Persistence failed — do NOT remove cached copy or update state.
          setStatus("cloudLibraryPinFailed", null, "danger");
        }
        // Whether pin succeeded or failed, do NOT fall through to network.
        return;
      }
      // Cached blob missing or hash mismatch — fall through to network path.
    } catch {
      // IndexedDB read failed — fall through to network path.
    } finally {
      state.mutatingNames.delete(selectedName);
      renderDetail();
    }
  }

  // Pin or re-pin stale blob — resolve a signed URL and download directly
  // from object storage so the blob never streams through Frappe.
  state.mutatingNames.add(selectedName);
  setStatusText(t("cloudLibraryPinning"), "muted");
  renderDetail();

  try {
    const access = await resolveMediaAccess(selectedName, asset?.content_hash, { intent: "pin" }).catch(() => null);
    const signedUrl = access?.download_url;

    let response;
    // Fast path: fetch directly from object storage using the signed URL.
    // This avoids streaming bytes through the Frappe worker.
    if (signedUrl) {
      try {
        response = await fetch(signedUrl);
        if (!response.ok) response = null;
      } catch {
        // TypeError from CORS or network failure — signed URL unusable.
        response = null;
      }
    }

    // Fallback: stream the blob bytes through the backend.
    // The redirect-based BFF download endpoint (download_my_media_asset)
    // is NOT a CORS bypass — fetch() follows the 302 to S3, so the
    // browser still enforces CORS on the final S3 response.
    // This dedicated streaming endpoint reads bytes server-side and
    // serves them from the same origin as the frontend.
    if (!response) {
      response = await fetchBackendMediaAssetBlob({ name: selectedName });
    }

    if (!response.ok) {
      if (response.status === 401) {
        applyLibraryRequestError({ status: response.status });
        return;
      }
      setStatus("cloudLibraryPinFailed", null, "danger");
      return;
    }
    const pinOk = await pinMediaFromResponse(selectedName, response, { contentHash: asset?.content_hash || null });
    if (pinOk) {
      // Remove any non-pinned cached copy since the durable pin supersedes it.
      removeCachedMediaBlob(selectedName).catch(() => {});
      state.cachedBlobNames.delete(selectedName);
      state.staleCachedNames.delete(selectedName);
      state.pinnedNames.add(selectedName);
      state.stalePinnedNames.delete(selectedName);
      renderList();
      setStatus("cloudLibraryPinned", { title: asset?.title || selectedName }, "success");
    } else {
      setStatus("cloudLibraryPinFailed", null, "danger");
    }
  } catch {
    setStatus("cloudLibraryPinFailed", null, "danger");
  } finally {
    state.mutatingNames.delete(selectedName);
    renderDetail();
  }
}

function handleTabSelection(nextTab) {
  const normalizedTab = normalizeTabKey(nextTab);
  if (normalizedTab === state.activeTab) return;

  // In offline-limited or reconnecting mode, only the media tab is interactive.
  if ((state.listOffline || state.reconnecting) && normalizedTab !== CLOUD_LIBRARY_TAB_KEYS.media) return;

  revokePreviewObjectUrl();

  // Tear down map preview when switching tabs
  if (mapPreview) {
    mapPreview.destroy();
    mapPreview = null;
  }

  state.activeTab = normalizedTab;
  setStatus();
  updateLocationState();
  renderTabs();
  renderList();
  renderDetail();
  void loadList();
}

async function drainPendingAuthRefresh(myGeneration) {
  if (authGeneration === myGeneration && pendingAuthRefresh) {
    const coalescedOpts = pendingAuthRefresh;
    pendingAuthRefresh = null;
    await refreshAuthState(coalescedOpts);
  }
}

async function refreshAuthState({ force = false, pendingLogout = false } = {}) {
  authGeneration += 1;
  const myGeneration = authGeneration;
  pendingAuthRefresh = null;
  state.authLoading = true;
  renderTabs();

  // Explicit logout — erase the persisted cache namespace so offline
  // reuse of this account's cached media is prevented.
  if (pendingLogout) {
    clearPersistedMediaCacheUser();
    clearMediaAccessCache();
  }

  try {
    const session = await getBackendSessionState({ force });
    if (authGeneration !== myGeneration) return;
    state.session = session;

    if (session.authenticated) {
      const loggedUser = await fetchBackendLoggedUser().catch(() => null);
      if (authGeneration !== myGeneration) return;
      const user = loggedUser?.user || null;
      // Only update the cache namespace when we got a concrete user.
      // A transient logged-user lookup failure should not wipe the
      // persisted namespace while the session is still valid.
      if (user) {
        setMediaCacheUser(user);
      }
      const featureAccess = await getBackendFeatureAccessState({ force });
      if (authGeneration !== myGeneration) return;
      state.featureAccess = featureAccess;
    } else {
      clearPersistedMediaCacheUser();
      clearMediaAccessCache();
      state.featureAccess = null;
    }
  } catch {
    if (authGeneration !== myGeneration) return;
    // Backend unreachable — try to restore a cached namespace so the
    // media tab can still serve pinned / cached-manifest items.
    const restoredUser = restorePersistedMediaCacheUser();
    if (!restoredUser) {
      setMediaCacheUser(null);
    }
    state.session = {
      authenticated: false,
      isGuest: true,
      ok: false,
      status: 0,
    };
    state.featureAccess = null;
  } finally {
    if (authGeneration === myGeneration) {
      state.authLoading = false;
      state.reconnecting = false;
      renderTabs();
    }
  }

  if (authGeneration !== myGeneration) return;

  if (!state.session?.authenticated) {
    // Even when unauthenticated, if a cached media namespace exists
    // we allow the media tab to load in offline-limited mode.
    const hasOfflineNamespace = Boolean(getMediaCacheUser());
    if (!hasOfflineNamespace) {
      setStatus("cloudLibraryLoginPrompt", null, "muted");
      revokePreviewObjectUrl();
      state.items = [];
      state.selectedName = "";
      state.selectedDetail = null;
      state.pinnedNames.clear();
      state.stalePinnedNames.clear();
      state.listOffline = false;
      renderList();
      renderDetail();
      await drainPendingAuthRefresh(myGeneration);
      return;
    }

    // Offline-limited mode: switch to media tab and load from cache.
    if (state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.media) {
      state.activeTab = CLOUD_LIBRARY_TAB_KEYS.media;
      updateLocationState();
      renderTabs();
    }
    setStatus();
    await loadList({ offlineBootstrap: true, preserveSnapshot: true });
    await drainPendingAuthRefresh(myGeneration);
    return;
  }

  if (!getCurrentCapability().enabled) {
    const nextTab = getFirstAccessibleTab();
    if (nextTab !== state.activeTab) {
      state.activeTab = nextTab;
      updateLocationState();
      renderTabs();
    }
  }

  setStatus();
  await loadList({ preserveSnapshot: true });
  await drainPendingAuthRefresh(myGeneration);
}

function handleLanguageChange() {
  syncLangToggleButtons(getLang());
  renderStatus();
  renderList();
  renderDetail();
}

function bindMenuNavigation(button, href) {
  button?.addEventListener("click", () => {
    toolsMenu.close();
    navigateToAppRoute(href);
  });
}

function mountLibraryController() {
  state.viewMounted = true;
  renderStatus();
  renderTabs();
  renderList();
  renderDetail();
  syncToolbarVolume();

  if (state.initialized && !state.listLoading && state.items.length === 0) {
    void refreshAuthState();
  }
}

function unmountLibraryController() {
  if (isSpaRuntime && !state.viewMounted) return;

  state.viewMounted = false;
  stopRequest(listRequestState);
  stopRequest(detailRequestState);
  toolsMenu.close();
  overflowMenu.close();
  libraryMediaPlayer.destroy();
  if (mapPreview) {
    mapPreview.destroy();
    mapPreview = null;
  }
  revokePreviewObjectUrl();
  remotePlaybackSessionName = "";
  lastPreviewSignature = "";
  if (elements.toolbarVolume) elements.toolbarVolume.hidden = true;
}

function bindEvents() {
  syncLangToggleButtons(getLang());
  elements.langToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextLang = toggleLang();
      syncLangToggleButtons(nextLang);
      handleLanguageChange();
    });
  });

  elements.libraryTabs.forEach((button) => {
    button.addEventListener("click", () => {
      handleTabSelection(button.dataset.tab);
    });
  });

  elements.searchInput.value = state.query.search;
  elements.sortSelect.value = state.query.sort;

  elements.searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.query.search = normalizeSearch(elements.searchInput?.value);
    state.query.sort = normalizeSort(elements.sortSelect?.value);
    updateLocationState();
    void loadList();
  });

  elements.sortSelect?.addEventListener("change", () => {
    state.query.sort = normalizeSort(elements.sortSelect.value);
    updateLocationState();
    void loadList();
  });

  elements.refreshButton?.addEventListener("click", () => {
    toolsMenu.close();
    void refreshAuthState({ force: true });
  });

  elements.loadMoreButton?.addEventListener("click", () => {
    if (!state.hasMore || state.listLoading) return;
    void loadList({ append: true });
  });

  elements.actionOpen?.addEventListener("click", () => {
    void openSelectedItem();
  });
  elements.actionDownload?.addEventListener("click", () => {
    downloadSelectedMedia();
  });
  elements.actionRename?.addEventListener("click", () => {
    if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media) {
      void renameSelectedMediaAsset();
    } else {
      void renameSelectedBoardDocument();
    }
  });
  elements.actionDelete?.addEventListener("click", () => {
    void deleteSelectedItem();
  });
  elements.actionPin?.addEventListener("click", () => {
    void togglePinSelectedMedia();
  });

  bindMenuNavigation(elements.openBoardPage, "#/board");
  bindMenuNavigation(elements.openSpeedPage, "#/speed");
  bindMenuNavigation(elements.openReplayPage, "#/replay");
  bindMenuNavigation(elements.openAccelPage, "#/accel");
  if (!isSpaRuntime) {
    integratePlayerWidget({ toolsMenuList: elements.toolsMenuList, toolsMenu });
  }

  window.addEventListener(ROUTE_VISIBLE_EVENT, (event) => {
    if (event?.detail?.path !== "/library") return;
    const routeQuery = getCurrentAppRouteQuery();
    const nextTab = normalizeTabKey(routeQuery.get("tab"));
    const nextSearch = normalizeSearch(routeQuery.get("search"));
    const nextSort = normalizeSort(routeQuery.get("sort"));
    const queryChanged = nextSearch !== state.query.search || nextSort !== state.query.sort;

    state.query.search = nextSearch;
    state.query.sort = nextSort;
    if (elements.searchInput) elements.searchInput.value = nextSearch;
    if (elements.sortSelect) elements.sortSelect.value = nextSort;

    if (nextTab !== state.activeTab) {
      handleTabSelection(nextTab);
    } else if (queryChanged) {
      void loadList();
    }
  });

  window.addEventListener(BACKEND_AUTH_STATE_EVENT, (event) => {
    const detail = event?.detail || {};
    const opts = { force: true, pendingLogout: Boolean(detail.pendingLogout) };
    // Logout events are always processed immediately.
    if (opts.pendingLogout) {
      pendingAuthRefresh = null;
      void refreshAuthState(opts);
      return;
    }
    // Coalesce non-logout events arriving during an auth refresh.
    // The pending request is consumed when the current refresh finishes.
    if (state.authLoading) {
      pendingAuthRefresh = opts;
      return;
    }
    void refreshAuthState(opts);
  });
  document.addEventListener("i18n:change", handleLanguageChange);
}

applyButtonIcon(elements.toolsMenuButton, IconPages);
applyButtonIcon(elements.refreshButton, IconRestart);
applyButtonIcon(elements.openBoardPage, IconBoard);
applyButtonIcon(elements.openSpeedPage, IconSpeed);
applyButtonIcon(elements.openReplayPage, IconReplay);
applyButtonIcon(elements.openAccelPage, IconAccel);
applyButtonIcon(elements.openCurrentPage, IconWorld);
applyButtonIcon(elements.actionOpen, IconWorld);
applyButtonIcon(elements.actionDownload, IconDownload);
applyButtonIcon(elements.actionRename, IconBoard);
applyButtonIcon(elements.actionDelete, IconTrash);
applyButtonIcon(elements.actionPin, IconPin);
applyButtonIcon(elements.overflowBtn, IconMore);
applyButtonIcon(elements.toolbarMuteBtn, IconVolume);
elements.libraryTabs.forEach((button) => {
  const tabKey = normalizeTabKey(button.dataset.tab);
  const config = getResourceConfig(tabKey);
  applyButtonIcon(button, config.tabIcon);
});

// ── Toolbar volume controls ──────────────────────────────────────────

/** Show or hide the toolbar volume group based on active media player. */
function syncToolbarVolume() {
  const mediaEl = libraryMediaPlayer.getMediaElement();
  if (!mediaEl) {
    if (elements.toolbarVolume) elements.toolbarVolume.hidden = true;
    return;
  }
  if (elements.toolbarVolume) elements.toolbarVolume.hidden = false;
  if (elements.toolbarVolumeSlider) {
    elements.toolbarVolumeSlider.value = String(Math.round(mediaEl.volume * 100));
  }
  applyButtonIcon(elements.toolbarMuteBtn, mediaEl.muted ? IconMuted : IconVolume);
}

if (elements.toolbarMuteBtn) {
  elements.toolbarMuteBtn.addEventListener("click", () => {
    const mediaEl = libraryMediaPlayer.getMediaElement();
    if (mediaEl) {
      mediaEl.muted = !mediaEl.muted;
      syncToolbarVolume();
    }
  });
}

if (elements.toolbarVolumeSlider) {
  elements.toolbarVolumeSlider.addEventListener("input", () => {
    const mediaEl = libraryMediaPlayer.getMediaElement();
    if (mediaEl) {
      mediaEl.volume = Number(elements.toolbarVolumeSlider.value) / 100;
      if (mediaEl.muted && mediaEl.volume > 0) mediaEl.muted = false;
      syncToolbarVolume();
    }
  });
}

bindEvents();

libraryRouteLifecycle = {
  mount: mountLibraryController,
  unmount: unmountLibraryController,
};

async function initLibrary() {
  try {
    await refreshAuthState();
  } finally {
    state.initialized = true;
  }
}

export const initPromise = initLibrary();
