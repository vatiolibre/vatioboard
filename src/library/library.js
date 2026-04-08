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
  IconPages,
  IconReplay,
  IconRestart,
  IconSpeed,
  IconTrash,
  IconWorld,
} from "../icons.js";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import {
  BACKEND_AUTH_STATE_EVENT,
  deleteBoardDocumentFromBackend,
  deleteSavedDrawingFromBackend,
  deleteSyncRecordFromBackend,
  getBackendFeatureAccessState,
  getBackendSessionState,
  initBackendAuthControllers,
  updateBoardDocumentInBackend,
} from "../shared/backend-auth.js";
import {
  CLOUD_LIBRARY_TAB_KEYS,
  getCloudLibraryResource,
} from "../shared/cloud-library-resources.js";
import { getResourceConfig } from "./resource-registry.js";
import { createLibraryMapPreview } from "./library-map-preview.js";
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
  CLOUD_LIBRARY_TAB_KEYS.savedImages,
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
  mutationBusy: false,
  statusKey: "",
  statusParams: null,
  statusText: "",
  statusTone: "muted",
};

let mapPreview = null;

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
  if (resourceConfig.capabilityKey === "saved_drawings") {
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
      const capability = resourceConfig.capabilityKey === "saved_drawings"
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
      ? (resourceConfig.capabilityKey === "saved_drawings"
        ? state.featureAccess.capability
        : state.featureAccess.cloudSyncCapability)
      : null;
    const isAccessible = Boolean(state.session?.authenticated) && capability?.enabled === true;
    const isActive = tabKey === state.activeTab;

    button.dataset.active = isActive ? "true" : "false";
    button.dataset.access = isAccessible ? "granted" : "blocked";
    button.setAttribute("aria-selected", isActive ? "true" : "false");
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
    state.session = {
      authenticated: false,
      isGuest: true,
      ok: false,
      status,
    };
    state.featureAccess = null;
    setStatus("cloudLibraryLoginPrompt", null, "danger");
    renderTabs();
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
    await loadList({ force: true });
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
        state.selectedDetail = null;
        renderList();
        renderDetail();
        void loadDetail(item.name);
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

function renderDetailPreview(item = {}) {
  if (!elements.detailPreview) return;

  const config = getResourceConfig(state.activeTab);
  const previewKind = config.previewKind;

  // Tear down previous map preview if switching away from map type
  if (previewKind !== "map" && mapPreview) {
    mapPreview.destroy();
    mapPreview = null;
  }

  const imageUrl = item.image_url || item.preview_image_url;
  if ((previewKind === "image" || previewKind === "board-preview") && imageUrl) {
    elements.detailPreview.replaceChildren();
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = item.title || item.name || t("cloudLibrarySavedImages");
    image.loading = "lazy";
    elements.detailPreview.append(image);
    elements.detailPreview.dataset.previewKind = "image";
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
    elements.detailEmpty.textContent = state.detailLoading
      ? t("cloudLibraryLoading")
      : t("cloudLibrarySelectPrompt");
    syncActionButton(elements.actionOpen, false, false);
    syncActionButton(elements.actionDownload, false, false);
    syncActionButton(elements.actionRename, false, false);
    syncActionButton(elements.actionDelete, false, false);

    // Tear down map preview when nothing selected
    if (mapPreview) {
      mapPreview.cancelAnimation();
    }
    return;
  }

  elements.detailTitle.textContent = selectedItem.title || selectedItem.name;
  elements.detailSubtitle.textContent = buildRecordSubtitle(selectedItem) || selectedItem.name;
  renderDetailPreview(selectedItem);

  elements.detailMeta.replaceChildren();
  buildDetailMetaEntries(selectedItem).forEach(([label, value]) => {
    elements.detailMeta.append(createMetaRow(label, value));
  });

  const actionBusy = state.openBusy || state.mutationBusy || state.detailLoading;
  const config = getResourceConfig(state.activeTab);
  const canOpenSelectedItem = canOpenCloudLibraryItem(selectedItem);
  const showOpen = !config.canDownload;

  syncActionButton(elements.actionOpen, showOpen, actionBusy || !canOpenSelectedItem);
  syncActionButton(elements.actionDownload, config.canDownload, actionBusy);
  syncActionButton(elements.actionRename, config.canRename, actionBusy);
  syncActionButton(elements.actionDelete, config.canDelete, actionBusy);
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

    if (!force) {
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
    }
  }
}

async function loadList({ append = false, force = false } = {}) {
  const capability = getCurrentCapability();
  if (!capability?.enabled) {
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
  if (!append) {
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
    state.items = append ? [...state.items, ...nextItems.filter((item) =>
      !state.items.some((existing) => existing.name === item.name)
    )] : nextItems;
    state.totalCount = Number(response?.totalCount ?? response?.total_count) || state.items.length;
    state.hasMore = response?.hasMore === true || response?.has_more === true;
    state.nextOffset = Number(response?.nextOffset ?? response?.next_offset) || (offset + nextItems.length);

    const nextSelected = state.items.find((item) => item.name === previousSelectedName)
      ? previousSelectedName
      : (state.items[0]?.name || "");
    const selectionChanged = nextSelected !== previousSelectedName;
    state.selectedName = nextSelected;
    if (selectionChanged || !state.selectedDetail || state.selectedDetail.name !== nextSelected) {
      state.selectedDetail = null;
    }
    renderList();
    renderDetail();

    if (state.selectedName && (!state.selectedDetail || selectionChanged)) {
      void loadDetail(state.selectedName);
    }

    if (!force && !append) {
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
        state.items = freshItems;
        state.totalCount = Number(freshResponse?.totalCount ?? freshResponse?.total_count) || state.items.length;
        state.hasMore = freshResponse?.hasMore === true || freshResponse?.has_more === true;
        state.nextOffset = Number(freshResponse?.nextOffset ?? freshResponse?.next_offset) || state.items.length;
        if (!state.items.some((item) => item.name === state.selectedName)) {
          state.selectedName = state.items[0]?.name || "";
          state.selectedDetail = null;
          if (state.selectedName) {
            void loadDetail(state.selectedName, { force: true });
          }
        }
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
  if (!state.selectedName || state.mutationBusy || state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
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

  state.mutationBusy = true;
  renderDetail();

  try {
    const response = await updateBoardDocumentInBackend({
      name: selectedName,
      title: trimmedTitle,
      csrfToken: capability.csrfToken,
    });

    if (!response.ok || !response.document) {
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
    await loadList({ force: true });
  } catch {
    setStatus("cloudLibraryRenameFailed", { status: 0 }, "danger");
  } finally {
    state.mutationBusy = false;
    renderDetail();
  }
}

async function deleteSelectedItem() {
  if (!state.selectedName || state.mutationBusy) return;

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

  state.mutationBusy = true;
  renderDetail();

  try {
    let response;

    if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
      response = await deleteBoardDocumentFromBackend({
        name: selectedName,
        csrfToken: capability.csrfToken,
      });
    } else if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.savedImages) {
      response = await deleteSavedDrawingFromBackend({
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
    await loadList({ force: true });
  } catch {
    setStatus("cloudLibraryDeleteFailed", { status: 0 }, "danger");
  } finally {
    state.mutationBusy = false;
    renderDetail();
  }
}

function downloadSelectedImage() {
  const drawing = state.selectedDetail
    || state.items.find((item) => item.name === state.selectedName)
    || null;
  const downloadUrl = drawing?.download_url || drawing?.downloadUrl;
  if (!downloadUrl) return;
  triggerDownload(downloadUrl);
}

function handleTabSelection(nextTab) {
  const normalizedTab = normalizeTabKey(nextTab);
  if (normalizedTab === state.activeTab) return;

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

async function refreshAuthState({ force = false } = {}) {
  state.authLoading = true;
  renderTabs();

  try {
    const session = await getBackendSessionState({ force });
    state.session = session;

    if (session.authenticated) {
      state.featureAccess = await getBackendFeatureAccessState({ force });
    } else {
      state.featureAccess = null;
    }
  } catch {
    state.session = {
      authenticated: false,
      isGuest: true,
      ok: false,
      status: 0,
    };
    state.featureAccess = null;
  } finally {
    state.authLoading = false;
    renderTabs();
  }

  if (!state.session?.authenticated) {
    setStatus("cloudLibraryLoginPrompt", null, "muted");
    state.items = [];
    state.selectedName = "";
    state.selectedDetail = null;
    renderList();
    renderDetail();
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
  await loadList();
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
    downloadSelectedImage();
  });
  elements.actionRename?.addEventListener("click", () => {
    void renameSelectedBoardDocument();
  });
  elements.actionDelete?.addEventListener("click", () => {
    void deleteSelectedItem();
  });

  bindMenuNavigation(elements.openBoardPage, "/");
  bindMenuNavigation(elements.openSpeedPage, "/speed");
  bindMenuNavigation(elements.openReplayPage, "/replay.html");
  bindMenuNavigation(elements.openAccelPage, "/accel");
  bindMenuNavigation(elements.openGpsLabPage, "/gps-rate");

  window.addEventListener(BACKEND_AUTH_STATE_EVENT, () => {
    void refreshAuthState({ force: true });
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
elements.libraryTabs.forEach((button) => {
  const tabKey = normalizeTabKey(button.dataset.tab);
  const config = getResourceConfig(tabKey);
  applyButtonIcon(button, config.tabIcon);
});

bindEvents();

export const initPromise = refreshAuthState();
