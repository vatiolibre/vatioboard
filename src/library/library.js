import "../styles/library.less";
import "../styles/backend-auth.less";

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
  getBackendFeatureAccessState,
  getBackendSessionState,
  initBackendAuthControllers,
  updateBoardDocumentInBackend,
} from "../shared/backend-auth.js";
import {
  CLOUD_LIBRARY_TAB_KEYS,
  getCloudLibraryResource,
} from "../shared/cloud-library-resources.js";
import {
  openCloudAccelRun,
  openCloudBoardDocument,
  openCloudReplaySession,
} from "../shared/cloud-library-open.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";

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
  status: document.getElementById("libraryStatus"),
  authSummaryTitle: document.getElementById("libraryAuthSummaryTitle"),
  authSummaryBody: document.getElementById("libraryAuthSummaryBody"),
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

function renderAuthSummary() {
  if (!elements.authSummaryTitle || !elements.authSummaryBody) return;

  if (state.authLoading) {
    elements.authSummaryTitle.textContent = t("authCheckingSession");
    elements.authSummaryBody.textContent = t("cloudLibraryLoading");
    return;
  }

  if (!state.session?.authenticated) {
    elements.authSummaryTitle.textContent = t("authSignedOut");
    elements.authSummaryBody.textContent = t("cloudLibraryLoginPrompt");
    return;
  }

  if (!state.featureAccess?.ok) {
    elements.authSummaryTitle.textContent = t("authSignedIn");
    elements.authSummaryBody.textContent = t("cloudLibraryAccessUnavailable");
    return;
  }

  const cloudSyncStatus = state.featureAccess.cloudSyncCapability?.enabled ? t("on") : t("off");
  const savedImagesStatus = state.featureAccess.capability?.enabled ? t("on") : t("off");

  elements.authSummaryTitle.textContent = t("authSignedIn");
  elements.authSummaryBody.textContent = [
    `${t("cloudLibrarySummaryCloudSync")}: ${cloudSyncStatus}`,
    `${t("cloudLibrarySummarySavedImages")}: ${savedImagesStatus}`,
  ].join(" · ");
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
    renderAuthSummary();
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
  if (!item || state.activeTab === CLOUD_LIBRARY_TAB_KEYS.savedImages) {
    return false;
  }

  if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
    return true;
  }

  if (item.payload_available === false) {
    return false;
  }

  if (item.can_open === false || item.payload_complete === false) {
    return false;
  }

  return true;
}

function buildRecordSubtitle(item = {}) {
  switch (state.activeTab) {
    case CLOUD_LIBRARY_TAB_KEYS.speed:
      return [
        item.started_at_label || item.ended_at_label,
        item.start_place_label && item.end_place_label
          ? `${item.start_place_label} -> ${item.end_place_label}`
          : item.start_place_label || item.end_place_label,
      ].filter(Boolean).join(" · ");
    case CLOUD_LIBRARY_TAB_KEYS.accel:
      return [
        item.saved_at_label,
        item.preset_id,
        item.quality_grade,
      ].filter(Boolean).join(" · ");
    case CLOUD_LIBRARY_TAB_KEYS.boardDocuments:
      return [
        item.updated_at_label || item.modified_at_label || item.created_at_label,
        `${formatCount(item.command_count)} ${t("libraryCommands").toLowerCase()}`,
      ].filter(Boolean).join(" · ");
    case CLOUD_LIBRARY_TAB_KEYS.savedImages:
      return [
        item.created_at_label || item.modified_at_label,
        formatDimensionPair(item.image_width, item.image_height),
      ].filter((value) => value && value !== "—").join(" · ");
    default:
      return "";
  }
}

function renderList() {
  if (!elements.listPanel || !elements.listEmpty || !elements.loadMoreButton) return;

  elements.listPanel.replaceChildren();
  const hasItems = state.items.length > 0;
  elements.listEmpty.hidden = hasItems;
  elements.listEmpty.textContent = buildListEmptyMessage();

  if (hasItems) {
    const fragment = document.createDocumentFragment();

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
  switch (state.activeTab) {
    case CLOUD_LIBRARY_TAB_KEYS.speed:
      return [
        [t("libraryCreated"), item.started_at_label || item.ended_at_label || "—"],
        [t("libraryRoute"), item.start_place_label && item.end_place_label
          ? `${item.start_place_label} -> ${item.end_place_label}`
          : item.start_place_label || item.end_place_label || "—"],
        [t("librarySamples"), formatCount(item.sample_count)],
        [t("duration"), formatDurationMs(item.duration_ms)],
        [t("distance"), item.total_distance != null ? `${item.total_distance} ${item.distance_unit || ""}`.trim() : "—"],
        [t("max"), item.max_speed != null ? `${item.max_speed} ${item.unit || ""}`.trim() : "—"],
      ];
    case CLOUD_LIBRARY_TAB_KEYS.accel:
      return [
        [t("libraryCreated"), item.saved_at_label || "—"],
        [t("libraryPreset"), item.preset_id || "—"],
        [t("libraryQuality"), item.quality_grade || "—"],
        [t("duration"), formatDurationMs(item.elapsed_ms)],
        [t("librarySamples"), formatCount(item.sample_count)],
        [t("speed"), item.finish_speed != null ? `${item.finish_speed} ${item.display_unit || ""}`.trim() : "—"],
      ];
    case CLOUD_LIBRARY_TAB_KEYS.boardDocuments:
      return [
        [t("libraryUpdated"), item.updated_at_label || item.modified_at_label || "—"],
        [t("libraryCreated"), item.created_at_label || "—"],
        [t("libraryCommands"), formatCount(item.command_count)],
        [t("libraryRedoCommands"), formatCount(item.redo_command_count)],
        [t("libraryFileSize"), formatFileSize(item.payload_size)],
      ];
    case CLOUD_LIBRARY_TAB_KEYS.savedImages:
      return [
        [t("libraryCreated"), item.created_at_label || "—"],
        [t("libraryUpdated"), item.modified_at_label || "—"],
        [t("libraryDimensions"), formatDimensionPair(item.image_width, item.image_height)],
        [t("libraryFileSize"), formatFileSize(item.file_size)],
        [t("libraryFolder"), item.folder_label || "—"],
      ];
    default:
      return [];
  }
}

function renderDetailPreview(item = {}) {
  if (!elements.detailPreview) return;

  elements.detailPreview.replaceChildren();

  if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.savedImages && item.image_url) {
    const image = document.createElement("img");
    image.src = item.image_url;
    image.alt = item.title || item.name || t("cloudLibrarySavedImages");
    image.loading = "lazy";
    elements.detailPreview.append(image);
    return;
  }

  const fallback = document.createElement("div");
  fallback.className = "library-preview-fallback";
  fallback.textContent = item.title || item.name || t("cloudLibrary");
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
  const isBoardDocument = state.activeTab === CLOUD_LIBRARY_TAB_KEYS.boardDocuments;
  const isSavedImage = state.activeTab === CLOUD_LIBRARY_TAB_KEYS.savedImages;
  const canOpenSelectedItem = canOpenCloudLibraryItem(selectedItem);

  syncActionButton(elements.actionOpen, !isSavedImage, actionBusy || !canOpenSelectedItem);
  syncActionButton(elements.actionDownload, isSavedImage, actionBusy);
  syncActionButton(elements.actionRename, isBoardDocument, actionBusy);
  syncActionButton(elements.actionDelete, isBoardDocument, actionBusy);
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
      }).catch((error) => {
        if (requestId !== detailRequestState.requestId || isAbortError(error)) return;
        applyLibraryRequestError(error, { genericKey: "cloudLibraryDetailFailed" });
        renderDetail();
      });
    }
  } catch (error) {
    if (!isAbortError(error)) {
      applyLibraryRequestError(error, { genericKey: "cloudLibraryDetailFailed" });
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

  state.openBusy = true;
  renderDetail();

  try {
    let href = "";

    if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.speed) {
      href = await openCloudReplaySession(state.selectedName);
    } else if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.accel) {
      href = await openCloudAccelRun(state.selectedName);
    } else if (state.activeTab === CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
      href = await openCloudBoardDocument(state.selectedName);
    }

    if (href) {
      window.location.href = href;
    }
  } catch (error) {
    if (!isAbortError(error)) {
      applyLibraryRequestError(error, { genericKey: "cloudLibraryOpenFailed" });
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

  const capability = getCurrentCapability();
  if (!capability?.enabled || !capability.csrfToken) {
    setStatus("cloudLibraryAccessUnavailable", null, "danger");
    return;
  }

  const currentTitle = state.selectedDetail?.title
    || state.items.find((item) => item.name === state.selectedName)?.title
    || t("boardDocumentUntitled");
  const title = window.prompt(t("cloudLibraryRenamePrompt"), currentTitle);
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
      name: state.selectedName,
      title: trimmedTitle,
      csrfToken: capability.csrfToken,
    });

    if (!response.ok || !response.document) {
      setStatus("cloudLibraryRenameFailed", { status: response.status || 0 }, "danger");
      return;
    }

    getCurrentResourceConfig().resource.invalidateDetail(state.selectedName, { mode: "summary" });
    getCurrentResourceConfig().resource.invalidateDetail(state.selectedName, { mode: "full" });
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

async function deleteSelectedBoardDocument() {
  if (!state.selectedName || state.mutationBusy || state.activeTab !== CLOUD_LIBRARY_TAB_KEYS.boardDocuments) {
    return;
  }

  const capability = getCurrentCapability();
  if (!capability?.enabled || !capability.csrfToken) {
    setStatus("cloudLibraryAccessUnavailable", null, "danger");
    return;
  }

  const currentTitle = state.selectedDetail?.title
    || state.items.find((item) => item.name === state.selectedName)?.title
    || t("boardDocumentUntitled");
  if (!window.confirm(t("cloudLibraryDeleteConfirm", { title: currentTitle }))) {
    return;
  }

  state.mutationBusy = true;
  renderDetail();

  try {
    const response = await deleteBoardDocumentFromBackend({
      name: state.selectedName,
      csrfToken: capability.csrfToken,
    });

    if (!response.ok) {
      setStatus("cloudLibraryDeleteFailed", { status: response.status || 0 }, "danger");
      return;
    }

    getCurrentResourceConfig().resource.invalidateDetail(state.selectedName, { mode: "summary" });
    getCurrentResourceConfig().resource.invalidateDetail(state.selectedName, { mode: "full" });
    getCurrentResourceConfig().resource.invalidateList();
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
  renderAuthSummary();
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
    renderAuthSummary();
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
  renderAuthSummary();
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
    void deleteSelectedBoardDocument();
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
  const icon = tabKey === CLOUD_LIBRARY_TAB_KEYS.speed
    ? IconSpeed
    : tabKey === CLOUD_LIBRARY_TAB_KEYS.accel
      ? IconAccel
      : tabKey === CLOUD_LIBRARY_TAB_KEYS.boardDocuments
        ? IconBoard
        : IconDownload;
  applyButtonIcon(button, icon);
});

bindEvents();

export const initPromise = refreshAuthState();
