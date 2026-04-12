import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/library.less";
import "../styles/backend-auth.less";
import "../styles/cloud-sync-status.less";
import "../shared/ui/confirm-dialog.less";

import {
  IconAccel,
  IconBoard,
  IconDownload,
  IconGpsLab,
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
  BACKEND_AUTH_STATE_EVENT,
  deleteBoardDocumentFromBackend,
  deleteMediaAssetFromBackend,
  deleteSyncRecordFromBackend,
  fetchBackendLoggedUser,
  getBackendFeatureAccessState,
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
  clearPersistedMediaCacheUser,
  getMediaCacheUser,
  getPinnedBlobMeta,
  getPinnedMediaBlob,
  isMediaBlobPinned,
  pinMediaBlob,
  restorePersistedMediaCacheUser,
  setMediaCacheUser,
  unpinMediaBlob,
} from "../shared/media-cache.js";
import { getResourceConfig } from "./resource-registry.js";
import { createLibraryMapPreview } from "./library-map-preview.js";
import { createLibraryMediaPlayer } from "./library-media-player.js";
import { showConfirmDialog } from "../shared/ui/confirm-dialog.js";
import { showPromptDialog } from "../shared/ui/confirm-dialog.js";
import {
  openCloudAccelRun,
  openCloudBoardDocument,
  openCloudReplaySession,
} from "../shared/cloud-library-open.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import { initCloudSyncStatusIndicator } from "../shared/cloud-sync-status-indicator.js";

applyTranslations();
initBackendAuthControllers();

const PAGE_SIZE = 24;
const SORT_OPTIONS = new Set(["newest", "oldest", "title_asc", "title_desc"]);
const TAB_ORDER = [
  CLOUD_LIBRARY_TAB_KEYS.speed,
  CLOUD_LIBRARY_TAB_KEYS.accel,
  CLOUD_LIBRARY_TAB_KEYS.boardDocuments,
  CLOUD_LIBRARY_TAB_KEYS.media,
];

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
  openGpsLabPage: document.getElementById("openLibraryGpsLabMenu"),
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
  const candidates = [
    elements.toolsMenuList?.querySelector("[data-backend-auth-user]"),
    elements.toolsMenuList?.querySelector("[data-backend-auth-password]"),
    elements.toolsMenuList?.querySelector("[data-backend-auth-login]"),
    elements.toolsMenuList?.querySelector("[data-backend-auth-logout]"),
    elements.toolsMenuList?.querySelector("[data-backend-auth-status]"),
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
  activeTab: normalizeTabKey(new URL(window.location.href).searchParams.get("tab")),
  featureAccess: null,
  session: null,
  authLoading: true,
  query: {
    search: normalizeSearch(new URL(window.location.href).searchParams.get("search")),
    sort: normalizeSort(new URL(window.location.href).searchParams.get("sort")),
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

function revokePreviewObjectUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

/**
 * Derive a stable identity string for the current preview state.
 * Used to skip renderDetailPreview() when preview inputs are unchanged.
 */
function derivePreviewSignature(item, { isOfflineItem = false, isPinned = false, localPreviewUrl = "" } = {}) {
  if (!item) return "";
  const config = getResourceConfig(state.activeTab);
  const previewKind = config.previewKind;
  const imageUrl = item.image_url || item.preview_image_url || "";
  const effectiveUrl = (isOfflineItem && isPinned && localPreviewUrl) ? localPreviewUrl : imageUrl;
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
  const url = new URL(window.location.href);
  url.searchParams.set("tab", state.activeTab);

  if (state.query.search) {
    url.searchParams.set("search", state.query.search);
  } else {
    url.searchParams.delete("search");
  }

  if (state.query.sort !== "newest") {
    url.searchParams.set("sort", state.query.sort);
  } else {
    url.searchParams.delete("sort");
  }

  window.history.replaceState({}, "", url);
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
  if (!elements.status) return;

  const hasMessage = Boolean(state.statusText || state.statusKey);
  elements.status.hidden = !hasMessage;
  elements.status.dataset.tone = state.statusTone;
  elements.status.textContent = state.statusText
    || (hasMessage ? t(state.statusKey, state.statusParams || undefined) : "");
}

function renderTabs() {
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
        if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.media) {
          state.selectedDetail = item;
        } else {
          state.selectedDetail = null;
        }
        renderList();
        renderDetail();
        if (state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.media) {
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

function renderDetailPreview(item = {}, { isOfflineItem = false, isPinned = false, localPreviewUrl = "" } = {}) {
  if (!elements.detailPreview) return;

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
  const isMetadataOnlyOffline = isOfflineItem && !isPinned;
  // For pinned offline items, prefer the local blob URL over the remote URL
  // to avoid broken previews when the network is unavailable.
  const imageUrl = (isOfflineItem && isPinned && localPreviewUrl) ? localPreviewUrl : remoteImageUrl;

  // Playable media (audio/video): mount inline media player.
  // Pinned offline blobs use the local URL; online items use the remote URL.
  // Metadata-only offline items cannot be played (no blob available).
  if (isPlayableMedia && !isMetadataOnlyOffline) {
    const mediaSrc = (isOfflineItem && isPinned && localPreviewUrl)
      ? localPreviewUrl
      : (item.playback_url || item.download_url || item.downloadUrl || remoteImageUrl || "");

    if (mediaSrc) {
      libraryMediaPlayer.destroy();
      const mounted = libraryMediaPlayer.mount({
        container: elements.detailPreview,
        item,
        blobUrl: (isOfflineItem && isPinned && localPreviewUrl) ? localPreviewUrl : "",
      });
      if (mounted) {
        elements.detailPreview.dataset.previewKind = "media-player";
        syncToolbarVolume();
        return;
      }
    }
  }

  // Pinned offline non-image media without a blob URL yet — show a type-aware
  // fallback. The blob URL will arrive asynchronously and re-trigger this render.
  if (isOfflineItem && isPinned && previewKind === "media") {
    if (mediaKindLower !== "image") {
      libraryMediaPlayer.destroy();
      syncToolbarVolume();
      elements.detailPreview.replaceChildren();
      elements.detailPreview.dataset.previewKind = "offline-pinned-fallback";
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
  const isOfflineItem = isMediaTab && Boolean(selectedItem._offline);
  const isMetadataOnly = isOfflineItem && !isPinned;

  elements.detailTitle.textContent = selectedItem.title || selectedItem.name;
  elements.detailSubtitle.textContent = buildRecordSubtitle(selectedItem) || selectedItem.name;

  // Only rebuild the preview when preview-relevant inputs changed.
  const previewSig = derivePreviewSignature(selectedItem, { isOfflineItem, isPinned });
  if (previewSig !== lastPreviewSignature) {
    lastPreviewSignature = previewSig;
    renderDetailPreview(selectedItem, { isOfflineItem, isPinned });
  }

  // For pinned offline items, asynchronously resolve a local blob URL
  // and re-render the preview so it does not rely on a remote URL.
  // Covers image (for <img>), audio, and video (for inline media player).
  const selectedMediaKind = String(selectedItem.media_kind || "").toLowerCase();
  if (isOfflineItem && isPinned && !isStalePin && (selectedMediaKind === "image" || selectedMediaKind === "audio" || selectedMediaKind === "video")) {
    const pinnedName = state.selectedName;
    getPinnedMediaBlob(pinnedName).then((blob) => {
      if (!blob || state.selectedName !== pinnedName) return;
      const localUrl = URL.createObjectURL(blob);
      const localSig = derivePreviewSignature(selectedItem, { isOfflineItem, isPinned, localPreviewUrl: localUrl });
      if (localSig !== lastPreviewSignature) {
        lastPreviewSignature = localSig;
        renderDetailPreview(selectedItem, { isOfflineItem, isPinned, localPreviewUrl: localUrl });
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

  // Open: local-only open (fresh pinned blob) works without auth; all other
  // open paths hit the network and require a valid session.
  const hasLocalBlob = isPinned && !isStalePin;
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

    if (!force && tabKey !== CLOUD_LIBRARY_TAB_KEYS.media) {
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
  const offset = append ? state.nextOffset : 0;
  const previousSelectedName = state.selectedName;
  const requestKey = buildListRequestKey({
    tabKey,
    limit: PAGE_SIZE,
    offset,
    search: state.query.search,
    sort: state.query.sort,
  });
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
    const isStaleResponse = Boolean(response?._cached || response?._offline);
    if (isOfflineResponse) {
      for (const item of nextItems) { item._offline = true; }
    }
    state.items = append ? [...state.items, ...nextItems.filter((item) =>
      !state.items.some((existing) => existing.name === item.name)
    )] : nextItems;
    const wasOffline = state.listOffline;
    state.listOffline = isOfflineResponse;
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
      if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media) {
        state.selectedDetail = state.items.find((i) => i.name === nextSelected) || null;
      } else {
        state.selectedDetail = null;
      }
    } else if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media) {
      // Keep detail in sync with the refreshed list row data so flags
      // like _offline and updated URLs propagate to renderDetail.
      state.selectedDetail = state.items.find((i) => i.name === state.selectedName) || state.selectedDetail;
    }
    renderList();
    renderDetail();

    if (state.selectedName && (!state.selectedDetail || selectionChanged || preserveSnapshot)) {
      if (tabKey !== CLOUD_LIBRARY_TAB_KEYS.media) {
        void loadDetail(state.selectedName);
      }
    }

    void refreshPinStatesForItems(state.items);

    if (!force && !append && (tabKey !== CLOUD_LIBRARY_TAB_KEYS.media || isStaleResponse)) {
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
          if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media) {
            state.selectedDetail = state.items.find((i) => i.name === state.selectedName) || null;
          } else {
            state.selectedDetail = null;
            if (state.selectedName) {
              void loadDetail(state.selectedName, { force: true });
            }
          }
        } else if (tabKey === CLOUD_LIBRARY_TAB_KEYS.media && state.selectedName) {
          // Keep the media detail in sync with the refreshed list row data
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

      // Prefer the fresh remote asset when the pinned blob is stale
      const isStale = state.stalePinnedNames.has(selectedName);
      const mediaKind = String(asset?.media_kind || "").toLowerCase();
      const viewUrl = (mediaKind === "audio" || mediaKind === "video")
        ? (asset?.playback_url || asset?.download_url || asset?.downloadUrl)
        : (asset?.image_url || asset?.download_url || asset?.downloadUrl);

      if (!isStale && state.pinnedNames.has(selectedName)) {
        const blob = await getPinnedMediaBlob(selectedName).catch(() => null);
        if (blob) {
          const objectUrl = URL.createObjectURL(blob);
          window.open(objectUrl, "_blank", "noopener,noreferrer");
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
          state.openBusy = false;
          renderDetail();
          return;
        }
      }

      if (viewUrl) {
        window.open(viewUrl, "_blank", "noopener,noreferrer");
      }
    }

    if (href) {
      window.location.href = href;
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

function downloadSelectedMedia() {
  const asset = state.selectedDetail
    || state.items.find((item) => item.name === state.selectedName)
    || null;
  const downloadUrl = asset?.download_url || asset?.downloadUrl;
  if (!downloadUrl) return;
  triggerDownload(downloadUrl);
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
      await unpinMediaBlob(selectedName);
      state.pinnedNames.delete(selectedName);
      state.stalePinnedNames.delete(selectedName);
      setStatus("cloudLibraryUnpinned", { title: asset?.title || selectedName }, "success");
    } catch {
      setStatus("cloudLibraryPinFailed", null, "danger");
    } finally {
      state.mutatingNames.delete(selectedName);
      renderDetail();
    }
    return;
  }

  // Pin or re-pin stale blob — download the blob and store it locally
  const downloadUrl = asset?.download_url || asset?.downloadUrl;
  if (!downloadUrl) return;

  state.mutatingNames.add(selectedName);
  setStatusText(t("cloudLibraryPinning"), "muted");
  renderDetail();

  try {
    const response = await fetch(downloadUrl, { credentials: "include" });
    if (!response.ok) {
      if (response.status === 401) {
        applyLibraryRequestError({ status: response.status });
        return;
      }
      setStatus("cloudLibraryPinFailed", null, "danger");
      return;
    }
    const blob = await response.blob();
    await pinMediaBlob(selectedName, blob, { contentHash: asset?.content_hash || null });
    state.pinnedNames.add(selectedName);
    state.stalePinnedNames.delete(selectedName);
    setStatus("cloudLibraryPinned", { title: asset?.title || selectedName }, "success");
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
    window.location.href = href;
  });
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

  bindMenuNavigation(elements.openBoardPage, "/");
  bindMenuNavigation(elements.openSpeedPage, "/speed");
  bindMenuNavigation(elements.openReplayPage, "/replay.html");
  bindMenuNavigation(elements.openAccelPage, "/accel");
  bindMenuNavigation(elements.openGpsLabPage, "/gps-rate");

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
applyButtonIcon(elements.openGpsLabPage, IconGpsLab);
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

export const initPromise = refreshAuthState();
