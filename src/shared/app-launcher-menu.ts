import "../styles/app-launcher-menu.less";

import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import {
  IconClose,
  IconPages,
  IconSave,
  IconTrash,
  IconUndo,
} from "../icons.js";
import {
  appControl,
  appRegistry,
  applyAppIconTheme,
  createAppLauncher,
} from "../app-platform/index.js";
import type {
  ShellAppRuntimeManager,
  VatioAppControlState,
  VatioAppManifest,
} from "../app-platform/types";
import { navigateToAppRoute, ROUTE_VISIBLE_EVENT } from "../app/router.js";
import { createDragSensors } from "./drag-sensors.js";
import type { FloatingToolsRuntime } from "./floating-tools";
import { SHELL_Z_INDEX } from "./shell-layers.js";
import { getShellWorkArea, getViewportRect } from "./shell-work-area.js";

const LAUNCHER_MIN_TILE_WIDTH = 110;
const LAUNCHER_TILE_HEIGHT = 122;
const LAUNCHER_GRID_GAP = 12;
const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const TASKBAR_FAVORITE_DRAG_EVENT = "vatio:taskbar-favorite-drag";
const APP_LAUNCHER_LAYOUT_STORAGE_KEY = "vatioboard.os.appLauncherLayout.v1";
const REORDER_EDGE_HOLD_MS = 520;
const REORDER_EDGE_ZONE_PX = 64;

const IconStar = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m12 3.9 2.45 4.96 5.48.8-3.96 3.86.94 5.46L12 16.4l-4.9 2.58.93-5.46-3.96-3.86 5.48-.8L12 3.9Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/>
  </svg>
`;

type AnyRecord = Record<string, any>;

type LauncherGridDragContext =
  | { kind: "page"; page: number }
  | { kind: "favorite"; app: VatioAppManifest; tile: HTMLElement }
  | { kind: "favorite-candidate"; app: VatioAppManifest; tile: HTMLElement; page: number }
  | { kind: "reorder"; app: VatioAppManifest; tile: HTMLElement; page: number };

type LauncherDropPlacement = "before" | "after";

type LauncherLayoutRecord = {
  version: 1;
  order: string[];
  updatedAt: string;
};

interface AppLauncherMenuOptions {
  floatingTools?: FloatingToolsRuntime | null;
  mount?: HTMLElement;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
}

type LauncherAppView = {
  app: VatioAppManifest;
  current: boolean;
  disabled: boolean;
  favorite: boolean;
  hidden: boolean;
  pinned: boolean;
  protected: boolean;
  running: boolean;
};

const applyStartMenuTranslations = applyTranslations as (root?: ParentNode) => void;

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs: Record<string, string> = {},
) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  return element;
}

function getAppLabel(app: VatioAppManifest) {
  const translated = app.i18nKey ? t(app.i18nKey) : "";
  return translated && translated !== app.i18nKey ? translated : app.shortTitle || app.title;
}

function getLauncherTileLabel(app: VatioAppManifest) {
  const label = getAppLabel(app);
  const words = label.trim().split(/\s+/).filter(Boolean);
  return words.length > 3 ? words.slice(0, 3).join(" ") : label;
}

function normalizeRoutePath(path: string) {
  const value = String(path || "").trim();
  if (!value || value === "/") return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

function getCurrentRoutePath() {
  const routePath = window.__vatioboardRouter?.getRoute?.()?.path;
  if (routePath) return normalizeRoutePath(routePath);
  const hash = window.location.hash || "#/";
  return normalizeRoutePath(hash.slice(1).split("?", 1)[0] || "/");
}

function isLaunchableApp(app: VatioAppManifest) {
  return Boolean(app.route || app.window?.shellWindowId);
}

function isLauncherSurfaceApp(app: VatioAppManifest) {
  const surfaces = new Set(app.surfaces || []);
  if (!surfaces.has("launcher") && !surfaces.has("start-menu")) return false;
  if (isLaunchableApp(app)) return true;
  return surfaces.has("app-manager") && app.kind !== "background-service";
}

function compareLauncherApps(a: LauncherAppView, b: LauncherAppView) {
  if (a.app.order !== b.app.order) return a.app.order - b.app.order;
  return getAppLabel(a.app).localeCompare(getAppLabel(b.app)) || a.app.id.localeCompare(b.app.id);
}

function getLauncherLayoutStorage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeLauncherLayoutOrder(order: unknown, defaultOrder: string[]) {
  const knownIds = new Set(defaultOrder);
  const seen = new Set<string>();
  const normalized: string[] = [];

  if (Array.isArray(order)) {
    for (const item of order) {
      const appId = typeof item === "string" ? item : "";
      if (!appId || !knownIds.has(appId) || seen.has(appId)) continue;
      seen.add(appId);
      normalized.push(appId);
    }
  }

  for (const appId of defaultOrder) {
    if (seen.has(appId)) continue;
    seen.add(appId);
    normalized.push(appId);
  }

  return normalized;
}

function readLauncherLayoutOrder(defaultOrder: string[]) {
  const storage = getLauncherLayoutStorage();
  if (!storage) return defaultOrder;
  try {
    const parsed = JSON.parse(storage.getItem(APP_LAUNCHER_LAYOUT_STORAGE_KEY) || "null") as Partial<LauncherLayoutRecord> | null;
    if (!parsed || parsed.version !== 1) return defaultOrder;
    return normalizeLauncherLayoutOrder(parsed.order, defaultOrder);
  } catch {
    return defaultOrder;
  }
}

function writeLauncherLayoutOrder(order: string[]) {
  const storage = getLauncherLayoutStorage();
  if (!storage) return;
  const record: LauncherLayoutRecord = {
    version: 1,
    order: normalizeLauncherLayoutOrder(order, order),
    updatedAt: new Date().toISOString(),
  };
  try {
    storage.setItem(APP_LAUNCHER_LAYOUT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Local layout persistence is best effort.
  }
}

function resetLauncherLayoutOrder() {
  const storage = getLauncherLayoutStorage();
  if (!storage) return;
  try {
    storage.removeItem(APP_LAUNCHER_LAYOUT_STORAGE_KEY);
  } catch {
    // Local layout persistence is best effort.
  }
}

function getTileDataset(app: VatioAppManifest) {
  if (app.route) {
    return {
      href: app.route,
      startRoute: normalizeRoutePath(app.route),
    };
  }
  if (app.window?.shellWindowId) {
    return {
      startAction: app.window.shellWindowId,
    };
  }
  const legacyToolId = typeof app.metadata.legacyToolId === "string" ? app.metadata.legacyToolId : app.id;
  return {
    startAction: legacyToolId,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function numberFromStyle(value: string | null | undefined, fallback: number) {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function suppressNativeDrag(element: HTMLElement) {
  element.draggable = false;
  element.setAttribute("draggable", "false");
  element.ondragstart = () => false;
}

function getLegacyFloatingToolLaunchers(shellWindowId: string) {
  if (shellWindowId === "calculator") return ["openCalculator", "toggleCalculator"];
  if (shellWindowId === "energy") return ["openEnergy", "toggleEnergy"];
  if (shellWindowId === "camera-map") return ["openCameraMap", "toggleCameraMap"];
  if (shellWindowId === "speed-alerts") return ["openSpeedAlerts", "toggleSpeedAlerts"];
  return [];
}

export function createAppLauncherMenu({
  floatingTools,
  mount = document.body,
  shellAppRuntimeManager = null,
}: AppLauncherMenuOptions = {}): VatioBoardStartMenu {
  const appLauncher = createAppLauncher({
    shellManager: floatingTools?.shellManager,
    navigate: navigateToAppRoute,
    getCurrentRoute: () => window.__vatioboardRouter?.getRoute?.() || null,
    shellAppRuntimeManager,
  });

  const list = createEl("section", "tools-menu-list app-start-menu-list vb-app-launcher", {
    role: "dialog",
    "aria-modal": "false",
    "aria-label": "Apps",
  });
  list.id = "appStartMenuList";
  list.style.zIndex = String(SHELL_Z_INDEX.startMenu);
  list.hidden = true;

  const header = createEl("header", "vb-app-launcher-header");
  const brand = createEl("div", "compact-tools-menu-brand app-start-menu-brand vb-app-launcher-brand");
  brand.dataset.i18nTitle = "tagline";
  brand.title = "Simple full-page drawing board by VatioLibre";
  brand.innerHTML = `
    <span class="dot" aria-hidden="true"></span>
    <picture class="brand-logo compact-tools-menu-logo" aria-hidden="true">
      <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
      <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
      <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
    </picture>
    <span class="sr-only" data-i18n="brand">VatioLibre</span>
  `;

  const titleBlock = createEl("div", "vb-app-launcher-title-block");
  const titleIcon = createEl("span", "vb-app-launcher-title-icon");
  titleIcon.setAttribute("aria-hidden", "true");
  titleIcon.innerHTML = IconPages;
  titleBlock.append(titleIcon);

  const searchPanel = createEl("div", "vb-app-launcher-search-panel", {
    "data-launcher-search-panel": "",
  });
  searchPanel.hidden = true;
  const searchWrap = createEl("label", "vb-app-launcher-search", {
    id: "appLauncherSearchField",
  });
  const searchSr = createEl("span", "sr-only");
  searchSr.textContent = "Search applications";
  const searchInput = createEl("input", "vb-app-launcher-search-input", {
    type: "search",
    placeholder: "Search apps",
    "aria-label": "Search applications",
  }) as HTMLInputElement;
  searchInput.tabIndex = -1;
  searchWrap.append(searchSr, searchInput);
  const searchCloseButton = createEl("button", "vb-app-launcher-search-close", {
    type: "button",
    "aria-label": "Close search",
    title: "Close search",
  }) as HTMLButtonElement;
  searchCloseButton.innerHTML = IconClose;
  searchPanel.append(searchWrap, searchCloseButton);

  const controls = createEl("div", "vb-app-launcher-controls");
  const arrangeControls = createEl("div", "vb-app-launcher-arrange-controls", {
    "data-vb-app-launcher-arrange-controls": "",
  });
  arrangeControls.hidden = true;
  const resetArrangeButton = createEl("button", "vb-app-launcher-arrange-action", {
    type: "button",
    "aria-label": "Reset app order",
    title: "Reset app order",
    "data-launcher-arrange-reset": "",
  }) as HTMLButtonElement;
  resetArrangeButton.innerHTML = IconUndo;
  const doneArrangeButton = createEl("button", "vb-app-launcher-arrange-action", {
    type: "button",
    "aria-label": "Done arranging apps",
    title: "Done arranging apps",
    "data-launcher-arrange-done": "",
  }) as HTMLButtonElement;
  doneArrangeButton.innerHTML = IconSave;
  arrangeControls.append(resetArrangeButton, doneArrangeButton);
  const utilityControls = createEl("div", "vb-app-launcher-utility-controls");
  const langButton = createEl("button", "lang-toggle vb-app-launcher-lang", {
    type: "button",
    "data-i18n-aria": "changeLanguage",
    "aria-label": "Change language",
    title: "Change language",
    "data-lang-toggle": "",
  }) as HTMLButtonElement;
  const closeButton = createEl("button", "vb-app-launcher-icon-button vb-app-launcher-close", {
    type: "button",
    "aria-label": "Close launcher",
    title: "Close launcher",
  }) as HTMLButtonElement;
  closeButton.innerHTML = IconClose;
  utilityControls.append(langButton, closeButton);
  controls.append(arrangeControls, utilityControls);
  header.append(brand, titleBlock, controls);

  const body = createEl("div", "vb-app-launcher-body");
  const main = createEl("main", "vb-app-launcher-main");
  const pageStatus = createEl("p", "vb-app-launcher-page-status", {
    "aria-live": "polite",
  });
  const pagesViewport = createEl("div", "vb-app-launcher-pages", {
    "aria-label": "Applications",
  });
  const pageTrack = createEl("div", "vb-app-launcher-page-track", {
    "data-vb-app-launcher-page-track": "",
    "data-vb-app-launcher-page-transition": "false",
  });
  pagesViewport.append(pageTrack);
  const emptyState = createEl("p", "vb-app-launcher-empty");
  emptyState.textContent = "No apps match your search.";
  emptyState.hidden = true;
  const pagination = createEl("div", "vb-app-launcher-pagination");
  const bottomBar = createEl("div", "vb-app-launcher-bottom-bar");
  const dots = createEl("div", "vb-app-launcher-page-dots", {
    "aria-label": "Launcher pages",
  });
  const searchButton = createEl("button", "vb-app-launcher-search-pill", {
    type: "button",
    "aria-label": "Search apps",
    "aria-controls": "appLauncherSearchField",
    "aria-expanded": "false",
    "data-launcher-search-open": "",
  }) as HTMLButtonElement;
  searchButton.innerHTML = `
    <span class="vb-app-launcher-search-pill-icon" aria-hidden="true"></span>
    <span>Search</span>
  `;
  bottomBar.append(dots, searchButton);
  pagination.append(pageStatus, bottomBar);
  main.append(pagesViewport, emptyState, pagination);
  body.append(main);

  const contextSheet = createEl("div", "vb-app-launcher-context", {
    role: "menu",
    "aria-hidden": "true",
    "data-launcher-context": "",
  });
  contextSheet.hidden = true;

  const compatibilityList = createEl("div", "vb-app-launcher-compat", {
    "aria-hidden": "true",
  });
  compatibilityList.hidden = true;

  list.append(header, searchPanel, compatibilityList, body, contextSheet);
  mount.append(list);

  let open = false;
  let activeTrigger: HTMLElement | null = null;
  let activeHeader: HTMLElement | null = null;
  let currentPage = 0;
  let latestPageCount = 1;
  let latestAppCount = 0;
  let pageSize = 8;
  let query = "";
  let currentRoutePath = getCurrentRoutePath();
  let contextAppId = "";
  let contextAnchor: HTMLElement | null = null;
  let suppressNextGridClick = false;
  let searchActive = false;
  let activeLauncherDrag: AnyRecord | null = null;
  let arrangeMode = false;
  let reorderEdgeSwitchTimer = 0;
  let pendingTileClickAppId = "";
  const suppressedAppClicks = new Set<string>();

  function setTriggerExpanded(trigger: HTMLElement | null, isExpanded: boolean) {
    trigger?.setAttribute?.("aria-expanded", isExpanded ? "true" : "false");
  }

  function clearActiveHeader() {
    activeHeader?.classList.remove("tools-menu-layer-open");
    activeHeader = null;
  }

  function syncLanguageButton() {
    langButton.textContent = String(getLang()).toUpperCase();
  }

  function getRunningAppIds() {
    return new Set(appLauncher.getRunningApps().map((app) => app.appId));
  }

  function buildBaseAppViews() {
    const running = getRunningAppIds();
    const routePath = currentRoutePath;
    return appRegistry.listApps()
      .filter(isLauncherSurfaceApp)
      .map((app): LauncherAppView => {
        const hidden = appControl.isHiddenFromStartMenu(app.id);
        const protectedApp = appControl.isProtected(app.id);
        return {
          app,
          current: Boolean(app.route && (
            normalizeRoutePath(app.route) === routePath
            || app.aliases?.map(normalizeRoutePath).includes(routePath)
          )),
          disabled: !appControl.isEnabled(app.id),
          favorite: appControl.isFavorite(app.id),
          hidden,
          pinned: appControl.isPinned(app.id),
          protected: protectedApp,
          running: running.has(app.id),
        };
      })
      .sort(compareLauncherApps);
  }

  function applyLauncherLayoutOrder(views: LauncherAppView[]) {
    const manifestOrder = [...views].sort(compareLauncherApps);
    const viewById = new Map(manifestOrder.map((view) => [view.app.id, view]));
    const savedOrder = readLauncherLayoutOrder(manifestOrder.map((view) => view.app.id));
    return savedOrder
      .map((appId) => viewById.get(appId))
      .filter((view): view is LauncherAppView => Boolean(view));
  }

  function buildAppViews({ includeHidden = false, includeSearch = true } = {}) {
    const search = includeSearch ? query.trim().toLowerCase() : "";
    const revealHiddenMatches = Boolean(search);
    return applyLauncherLayoutOrder(buildBaseAppViews())
      .filter((view) => includeHidden || !view.hidden || view.protected || (revealHiddenMatches && view.hidden))
      .filter((view) => {
        if (!search) return true;
        return [
          view.app.id,
          view.app.title,
          view.app.shortTitle,
          view.app.description,
          ...(view.app.tags || []),
        ].some((value) => String(value || "").toLowerCase().includes(search));
      });
  }

  function calculatePageSize() {
    const listWidth = numberFromStyle(list.style.width, list.offsetWidth || 900);
    const listHeight = numberFromStyle(list.style.height, list.offsetHeight || 640);
    const gridRect = pagesViewport.getBoundingClientRect();
    const gridWidth = gridRect.width || Math.max(280, listWidth - 40);
    const gridHeight = gridRect.height || Math.max(220, listHeight - 150);
    const minTileWidth = gridWidth < 520 ? 92 : LAUNCHER_MIN_TILE_WIDTH;
    const columns = Math.max(1, Math.floor((gridWidth + LAUNCHER_GRID_GAP) / (minTileWidth + LAUNCHER_GRID_GAP)));
    const rows = Math.max(1, Math.floor((gridHeight + LAUNCHER_GRID_GAP) / (LAUNCHER_TILE_HEIGHT + LAUNCHER_GRID_GAP)));
    pageSize = Math.max(1, columns * rows);
    list.style.setProperty("--vb-app-launcher-tile-min", `${minTileWidth}px`);
  }

  function getLauncherPageWidth() {
    const rect = pagesViewport.getBoundingClientRect();
    return rect.width || pagesViewport.offsetWidth || Math.max(280, numberFromStyle(list.style.width, list.offsetWidth || 900) - 40);
  }

  function getDampedPageOffset(dx: number, page = currentPage) {
    if ((page <= 0 && dx > 0) || (page >= latestPageCount - 1 && dx < 0)) return dx * 0.36;
    return dx;
  }

  function getPageTrackX(page: number, offset = 0) {
    return Math.round((-page * getLauncherPageWidth()) + offset);
  }

  function applyPageTrackPosition({ offset = 0, animate = false } = {}) {
    pageTrack.setAttribute("data-vb-app-launcher-page-transition", animate ? "true" : "false");
    pageTrack.style.transform = `translate3d(${getPageTrackX(currentPage, offset)}px, 0, 0)`;
  }

  function syncPageInteractivity() {
    const pages = Array.from(pageTrack.querySelectorAll<HTMLElement>("[data-vb-app-launcher-page]"));
    for (const page of pages) {
      const active = Number(page.dataset.page || "0") === currentPage;
      page.setAttribute("aria-hidden", active ? "false" : "true");
      page.setAttribute("data-vb-app-launcher-page-active", active ? "true" : "false");
      page.toggleAttribute("inert", !active);
      for (const control of page.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]")) {
        if (active) {
          const saved = control.dataset.launcherSavedTabIndex;
          if (saved == null || saved === "") control.removeAttribute("tabindex");
          else control.setAttribute("tabindex", saved);
          delete control.dataset.launcherSavedTabIndex;
        } else {
          if (!Object.prototype.hasOwnProperty.call(control.dataset, "launcherSavedTabIndex")) {
            control.dataset.launcherSavedTabIndex = control.getAttribute("tabindex") || "";
          }
          control.setAttribute("tabindex", "-1");
        }
      }
    }
  }

  function syncPageUi({ animate = false } = {}) {
    currentPage = clamp(currentPage, 0, Math.max(0, latestPageCount - 1));
    const pageText = `Page ${currentPage + 1} of ${latestPageCount}`;
    pageStatus.textContent = `${pageText} · ${latestAppCount} app${latestAppCount === 1 ? "" : "s"}`;
    pageStatus.setAttribute("aria-label", pageText);
    renderDots(latestPageCount);
    dots.hidden = latestPageCount <= 1;
    pagination.hidden = false;
    syncPageInteractivity();
    applyPageTrackPosition({ animate });
  }

  function goToPage(page: number, { animate = true } = {}) {
    const nextPage = clamp(page, 0, Math.max(0, latestPageCount - 1));
    if (nextPage === currentPage) {
      renderDots(latestPageCount);
      syncPageInteractivity();
      applyPageTrackPosition({ animate });
      return;
    }
    currentPage = nextPage;
    syncPageUi({ animate });
  }

  function positionMenu(trigger: HTMLElement | null = activeTrigger) {
    const margin = 8;
    const triggerRect = trigger?.getBoundingClientRect?.();
    const viewport = getViewportRect();
    const workArea = getShellWorkArea({ viewport, safeMargin: margin });
    const area = {
      left: Math.max(viewport.left + margin, workArea.left),
      top: Math.max(viewport.top + margin, workArea.top),
      right: Math.min(viewport.left + viewport.width - margin, workArea.left + workArea.width),
      bottom: Math.min(viewport.top + viewport.height - margin, workArea.top + workArea.height),
    };
    const areaWidth = Math.max(1, area.right - area.left);
    const areaHeight = Math.max(1, area.bottom - area.top);
    const compact = areaWidth < 680 || areaHeight < 520;
    const width = compact ? areaWidth : Math.min(areaWidth, 1120, Math.max(780, Math.floor(areaWidth * 0.88)));
    const height = compact ? areaHeight : Math.min(areaHeight, 740, Math.max(560, Math.floor(areaHeight * 0.9)));
    const preferredLeft = triggerRect
      ? triggerRect.left + (triggerRect.width / 2) - (width / 2)
      : area.left + ((areaWidth - width) / 2);
    const preferredTop = triggerRect && triggerRect.top - height - 12 >= area.top
      ? triggerRect.top - height - 12
      : area.top + ((areaHeight - height) / 2);

    list.style.position = "fixed";
    list.style.right = "auto";
    list.style.bottom = "auto";
    list.style.left = `${Math.round(clamp(preferredLeft, area.left, Math.max(area.left, area.right - width)))}px`;
    list.style.top = `${Math.round(clamp(preferredTop, area.top, Math.max(area.top, area.bottom - height)))}px`;
    list.style.width = `${Math.floor(width)}px`;
    list.style.height = `${Math.floor(height)}px`;
    list.style.maxHeight = `${Math.floor(height)}px`;
    calculatePageSize();
  }

  function closeContextSheet() {
    contextSheet.hidden = true;
    contextSheet.setAttribute("aria-hidden", "true");
    contextSheet.replaceChildren();
    contextAppId = "";
    contextAnchor?.removeAttribute("aria-expanded");
    contextAnchor = null;
  }

  function syncArrangeUi() {
    list.setAttribute("data-vb-app-launcher-reorder", arrangeMode ? "true" : "false");
    arrangeControls.hidden = !arrangeMode;
    pagesViewport.setAttribute("aria-label", arrangeMode ? "Arrange applications" : "Applications");
  }

  function syncSearchUi() {
    const searchVisible = searchActive && !arrangeMode;
    list.dataset.searchActive = searchVisible ? "true" : "false";
    searchPanel.hidden = !searchVisible;
    searchButton.hidden = arrangeMode || searchVisible;
    searchInput.tabIndex = searchVisible ? 0 : -1;
    searchButton.setAttribute("aria-expanded", searchVisible ? "true" : "false");
  }

  function openSearch({ focus = false } = {}) {
    if (arrangeMode) return;
    const wasActive = searchActive;
    searchActive = true;
    syncSearchUi();
    if (!wasActive) render();
    if (focus) {
      searchInput.focus({ preventScroll: true });
    }
  }

  function closeSearch({ clear = false, focusButton = false } = {}) {
    const hadQuery = Boolean(query || searchInput.value);
    const wasActive = searchActive;
    searchActive = false;
    if (clear && hadQuery) {
      searchInput.value = "";
      query = "";
      currentPage = 0;
    }
    syncSearchUi();
    if ((clear && hadQuery) || wasActive) {
      render();
    }
    if (focusButton && !list.hidden) {
      searchButton.focus({ preventScroll: true });
    }
  }

  function setArrangeMode(enabled: boolean, { renderView = true } = {}) {
    const nextArrangeMode = enabled === true;
    if (nextArrangeMode === arrangeMode) {
      syncArrangeUi();
      syncSearchUi();
      return;
    }

    if (nextArrangeMode) {
      closeContextSheet();
      arrangeMode = true;
      searchActive = false;
      query = "";
      searchInput.value = "";
      currentPage = 0;
    } else {
      cleanupReorderTileDrag();
      arrangeMode = false;
    }

    syncArrangeUi();
    syncSearchUi();
    if (renderView) render();
  }

  function resetArrangeOrder() {
    resetLauncherLayoutOrder();
    currentPage = 0;
    render();
  }

  function suppressGridClickForDrag(duration = 350) {
    suppressNextGridClick = true;
    window.setTimeout(() => {
      suppressNextGridClick = false;
    }, duration);
  }

  function rememberPotentialTileClick(appId: string) {
    pendingTileClickAppId = appId;
    window.setTimeout(() => {
      if (pendingTileClickAppId === appId) pendingTileClickAppId = "";
    }, 650);
  }

  function dispatchTaskbarFavoriteDrag(phase: "start" | "move" | "end" | "cancel", app: VatioAppManifest, point: { clientX: number; clientY: number }) {
    window.dispatchEvent(new CustomEvent(TASKBAR_FAVORITE_DRAG_EVENT, {
      detail: {
        phase,
        appId: app.id,
        point: {
          clientX: point.clientX,
          clientY: point.clientY,
        },
      },
    }));
  }

  function createFavoriteDragGhost(app: VatioAppManifest, tile: HTMLElement, rect: DOMRect) {
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("vb-app-launcher-drag-ghost");
    ghost.classList.remove("is-drag-source");
    ghost.removeAttribute("role");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("data-vb-app-launcher-drag-ghost", app.id);
    suppressNativeDrag(ghost);
    applyAppIconTheme(ghost, app);
    ghost.style.left = `${Math.round(rect.left)}px`;
    ghost.style.top = `${Math.round(rect.top)}px`;
    ghost.style.width = `${Math.round(rect.width || LAUNCHER_MIN_TILE_WIDTH)}px`;
    ghost.style.height = `${Math.round(rect.height || LAUNCHER_TILE_HEIGHT)}px`;
    document.body.append(ghost);
    return ghost;
  }

  function createReorderDragGhost(app: VatioAppManifest, tile: HTMLElement, rect: DOMRect) {
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.add("vb-app-launcher-drag-ghost", "vb-app-launcher-reorder-ghost");
    ghost.classList.remove("is-drag-source");
    ghost.removeAttribute("role");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("data-vb-app-launcher-reorder-ghost", app.id);
    suppressNativeDrag(ghost);
    applyAppIconTheme(ghost, app);
    ghost.style.left = `${Math.round(rect.left)}px`;
    ghost.style.top = `${Math.round(rect.top)}px`;
    ghost.style.width = `${Math.round(rect.width || LAUNCHER_MIN_TILE_WIDTH)}px`;
    ghost.style.height = `${Math.round(rect.height || LAUNCHER_TILE_HEIGHT)}px`;
    document.body.append(ghost);
    return ghost;
  }

  function scheduleLauncherDragGhostMove() {
    const drag = activeLauncherDrag;
    if (!drag || drag.rafId) return;
    drag.rafId = requestAnimationFrame(() => {
      drag.rafId = 0;
      if (!activeLauncherDrag) return;
      const tx = Math.round(drag.currentLeft - drag.startLeft);
      const ty = Math.round(drag.currentTop - drag.startTop);
      drag.ghost.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    });
  }

  function scheduleFavoriteDragGhostMove() {
    scheduleLauncherDragGhostMove();
  }

  function beginFavoriteTileDrag(payload: AnyRecord) {
    const context = payload.context || {};
    const app = context.app as VatioAppManifest | undefined;
    const tile = context.tile as HTMLElement | undefined;
    if (!app || !tile) return;
    closeContextSheet();

    const rect = tile.getBoundingClientRect();
    const ghost = createFavoriteDragGhost(app, tile, rect);
    activeLauncherDrag = {
      app,
      tile,
      ghost,
      startLeft: rect.left,
      startTop: rect.top,
      currentLeft: rect.left,
      currentTop: rect.top,
      rafId: 0,
      moved: false,
    };

    tile.classList.add("is-drag-source");
    list.classList.add("is-dragging");
    dispatchTaskbarFavoriteDrag("start", app, payload.point || { clientX: payload.clientX, clientY: payload.clientY });
    payload.event?.preventDefault?.();
  }

  function moveFavoriteTileDrag(payload: AnyRecord) {
    const drag = activeLauncherDrag;
    if (!drag) return;
    drag.currentLeft = drag.startLeft + payload.dx;
    drag.currentTop = drag.startTop + payload.dy;
    drag.lastPoint = payload.point || { clientX: payload.clientX, clientY: payload.clientY };
    drag.moved = true;
    dispatchTaskbarFavoriteDrag("move", drag.app, payload.point || { clientX: payload.clientX, clientY: payload.clientY });
    scheduleFavoriteDragGhostMove();
    payload.event?.preventDefault?.();
  }

  function cleanupFavoriteTileDrag() {
    const drag = activeLauncherDrag;
    activeLauncherDrag = null;
    if (!drag) return;
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = 0;
    }
    drag.tile?.classList?.remove("is-drag-source");
    drag.ghost?.remove?.();
    list.classList.remove("is-dragging");
  }

  function endFavoriteTileDrag(payload: AnyRecord = {}) {
    const drag = activeLauncherDrag;
    if (!drag) return;
    dispatchTaskbarFavoriteDrag("end", drag.app, payload.point || drag.lastPoint || { clientX: payload.clientX, clientY: payload.clientY });
    if (drag.moved) {
      suppressGridClickForDrag();
      suppressedAppClicks.add(drag.app.id);
      window.setTimeout(() => suppressedAppClicks.delete(drag.app.id), 0);
    }
    cleanupFavoriteTileDrag();
    payload.event?.preventDefault?.();
  }

  function cancelFavoriteTileDrag(payload: AnyRecord = {}) {
    const drag = activeLauncherDrag;
    if (drag) {
      dispatchTaskbarFavoriteDrag("cancel", drag.app, payload.point || drag.lastPoint || { clientX: payload.clientX, clientY: payload.clientY });
    }
    cleanupFavoriteTileDrag();
  }

  function getDragPayloadPoint(payload: AnyRecord = {}) {
    const point = payload.point || {};
    const clientX = Number.isFinite(Number(point.clientX)) ? Number(point.clientX) : Number(payload.clientX) || 0;
    const clientY = Number.isFinite(Number(point.clientY)) ? Number(point.clientY) : Number(payload.clientY) || 0;
    return { clientX, clientY };
  }

  function clearReorderEdgeSwitch() {
    if (reorderEdgeSwitchTimer) {
      window.clearTimeout(reorderEdgeSwitchTimer);
      reorderEdgeSwitchTimer = 0;
    }
    if (activeLauncherDrag?.kind === "reorder") {
      activeLauncherDrag.edgeTargetPage = null;
    }
  }

  function clearReorderDropPreview() {
    for (const tile of pageTrack.querySelectorAll<HTMLElement>("[data-vb-app-launcher-reorder-drop]")) {
      tile.removeAttribute("data-vb-app-launcher-reorder-drop");
    }
  }

  function getActiveLauncherPage() {
    return pageTrack.querySelector<HTMLElement>(`.vb-app-launcher-page[data-page="${currentPage}"]`);
  }

  function getReorderPlacement(tile: HTMLElement, point: { clientX: number; clientY: number }): LauncherDropPlacement {
    const rect = tile.getBoundingClientRect();
    const sameRow = point.clientY >= rect.top && point.clientY <= rect.bottom;
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    return (sameRow ? point.clientX < centerX : point.clientY < centerY) ? "before" : "after";
  }

  function resolveReorderDropTarget(point: { clientX: number; clientY: number }) {
    const drag = activeLauncherDrag;
    const page = getActiveLauncherPage();
    if (!drag || drag.kind !== "reorder" || !page) return null;

    const sourceId = drag.app.id;
    const directElement = document.elementFromPoint?.(point.clientX, point.clientY) || null;
    const directTile = directElement instanceof Element
      ? directElement.closest<HTMLElement>(".vb-app-launcher-tile[data-app-id]")
      : null;
    if (directTile && page.contains(directTile) && directTile.dataset.appId && directTile.dataset.appId !== sourceId) {
      return {
        tile: directTile,
        appId: directTile.dataset.appId,
        placement: getReorderPlacement(directTile, point),
      };
    }

    const tiles = Array.from(page.querySelectorAll<HTMLElement>(".vb-app-launcher-tile[data-app-id]"))
      .filter((tile) => tile.dataset.appId && tile.dataset.appId !== sourceId);
    if (!tiles.length) return null;

    let closestTile = tiles[0];
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const tile of tiles) {
      const rect = tile.getBoundingClientRect();
      const centerX = rect.left + (rect.width / 2);
      const centerY = rect.top + (rect.height / 2);
      const distance = Math.hypot(point.clientX - centerX, point.clientY - centerY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestTile = tile;
      }
    }

    return {
      tile: closestTile,
      appId: closestTile.dataset.appId || "",
      placement: getReorderPlacement(closestTile, point),
    };
  }

  function updateReorderDropPreview(point: { clientX: number; clientY: number }) {
    const drag = activeLauncherDrag;
    if (!drag || drag.kind !== "reorder") return;
    clearReorderDropPreview();
    const target = resolveReorderDropTarget(point);
    if (!target?.appId) {
      drag.dropTargetId = "";
      drag.dropPlacement = "after";
      return;
    }
    drag.dropTargetId = target.appId;
    drag.dropPlacement = target.placement;
    target.tile.setAttribute("data-vb-app-launcher-reorder-drop", target.placement);
  }

  function updateReorderEdgeSwitch(point: { clientX: number; clientY: number }) {
    const drag = activeLauncherDrag;
    if (!drag || drag.kind !== "reorder" || latestPageCount <= 1) {
      clearReorderEdgeSwitch();
      return;
    }

    const rect = pagesViewport.getBoundingClientRect();
    const insideY = point.clientY >= rect.top && point.clientY <= rect.bottom;
    let targetPage: number | null = null;
    if (insideY && point.clientX <= rect.left + REORDER_EDGE_ZONE_PX && currentPage > 0) {
      targetPage = currentPage - 1;
    } else if (insideY && point.clientX >= rect.right - REORDER_EDGE_ZONE_PX && currentPage < latestPageCount - 1) {
      targetPage = currentPage + 1;
    }

    if (targetPage == null) {
      clearReorderEdgeSwitch();
      return;
    }
    if (drag.edgeTargetPage === targetPage && reorderEdgeSwitchTimer) return;

    clearReorderEdgeSwitch();
    drag.edgeTargetPage = targetPage;
    reorderEdgeSwitchTimer = window.setTimeout(() => {
      reorderEdgeSwitchTimer = 0;
      const activeDrag = activeLauncherDrag;
      if (!activeDrag || activeDrag.kind !== "reorder" || activeDrag.edgeTargetPage !== targetPage) return;
      activeDrag.edgeTargetPage = null;
      goToPage(targetPage, { animate: true });
      window.setTimeout(() => {
        if (activeLauncherDrag?.kind === "reorder") updateReorderDropPreview(activeLauncherDrag.lastPoint || point);
      }, 80);
    }, REORDER_EDGE_HOLD_MS);
  }

  function saveReorderDrop(drag: AnyRecord) {
    const sourceId = String(drag.app?.id || "");
    const targetId = String(drag.dropTargetId || "");
    if (!sourceId || !targetId || sourceId === targetId) return false;

    const order = buildAppViews({ includeHidden: true, includeSearch: false }).map((view) => view.app.id);
    const fromIndex = order.indexOf(sourceId);
    if (fromIndex < 0 || !order.includes(targetId)) return false;

    order.splice(fromIndex, 1);
    const targetIndex = order.indexOf(targetId);
    if (targetIndex < 0) return false;
    const insertIndex = drag.dropPlacement === "before" ? targetIndex : targetIndex + 1;
    order.splice(insertIndex, 0, sourceId);
    writeLauncherLayoutOrder(order);
    return true;
  }

  function beginReorderTileDrag(payload: AnyRecord) {
    const context = payload.context || {};
    const app = context.app as VatioAppManifest | undefined;
    const tile = context.tile as HTMLElement | undefined;
    if (!app || !tile) return;
    closeContextSheet();

    const rect = tile.getBoundingClientRect();
    const ghost = createReorderDragGhost(app, tile, rect);
    activeLauncherDrag = {
      kind: "reorder",
      app,
      tile,
      ghost,
      startLeft: rect.left,
      startTop: rect.top,
      currentLeft: rect.left,
      currentTop: rect.top,
      rafId: 0,
      moved: false,
      dropTargetId: "",
      dropPlacement: "after",
      edgeTargetPage: null,
      lastPoint: getDragPayloadPoint(payload),
    };

    tile.classList.add("is-drag-source");
    list.classList.add("is-dragging");
    list.setAttribute("data-vb-app-launcher-reorder-dragging", "true");
    updateReorderDropPreview(activeLauncherDrag.lastPoint);
    payload.event?.preventDefault?.();
  }

  function moveReorderTileDrag(payload: AnyRecord) {
    const drag = activeLauncherDrag;
    if (!drag || drag.kind !== "reorder") return;
    drag.currentLeft = drag.startLeft + payload.dx;
    drag.currentTop = drag.startTop + payload.dy;
    drag.lastPoint = getDragPayloadPoint(payload);
    drag.moved = true;
    scheduleLauncherDragGhostMove();
    updateReorderDropPreview(drag.lastPoint);
    updateReorderEdgeSwitch(drag.lastPoint);
    payload.event?.preventDefault?.();
  }

  function cleanupReorderTileDrag() {
    const drag = activeLauncherDrag;
    if (!drag || drag.kind !== "reorder") return;
    activeLauncherDrag = null;
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = 0;
    }
    clearReorderEdgeSwitch();
    clearReorderDropPreview();
    drag.tile?.classList?.remove("is-drag-source");
    drag.ghost?.remove?.();
    list.classList.remove("is-dragging");
    list.removeAttribute("data-vb-app-launcher-reorder-dragging");
  }

  function endReorderTileDrag(payload: AnyRecord = {}) {
    const drag = activeLauncherDrag;
    if (!drag || drag.kind !== "reorder") return;
    const saved = drag.moved ? saveReorderDrop(drag) : false;
    if (drag.moved) {
      suppressGridClickForDrag();
      suppressedAppClicks.add(drag.app.id);
      window.setTimeout(() => suppressedAppClicks.delete(drag.app.id), 0);
    }
    cleanupReorderTileDrag();
    if (saved) render();
    payload.event?.preventDefault?.();
  }

  function cancelReorderTileDrag(payload: AnyRecord = {}) {
    cleanupReorderTileDrag();
    payload.event?.preventDefault?.();
  }

  function beginPageDrag(payload: AnyRecord) {
    const context = payload.context as AnyRecord;
    const startPage = Number.isFinite(Number(context.page)) ? Number(context.page) : currentPage;
    context.startPage = startPage;
    context.pageWidth = getLauncherPageWidth();
    pendingTileClickAppId = "";
    closeContextSheet();
    list.setAttribute("data-vb-app-launcher-page-dragging", "true");
    pageTrack.setAttribute("data-vb-app-launcher-page-transition", "false");
    pageTrack.style.transform = `translate3d(${getPageTrackX(startPage, getDampedPageOffset(payload.dx, startPage))}px, 0, 0)`;
    payload.event?.preventDefault?.();
  }

  function movePageDrag(payload: AnyRecord) {
    const context = payload.context as AnyRecord;
    const startPage = Number.isFinite(Number(context.startPage)) ? Number(context.startPage) : currentPage;
    const offset = getDampedPageOffset(payload.dx, startPage);
    pageTrack.setAttribute("data-vb-app-launcher-page-transition", "false");
    pageTrack.style.transform = `translate3d(${getPageTrackX(startPage, offset)}px, 0, 0)`;
    payload.event?.preventDefault?.();
  }

  function endPageDrag(payload: AnyRecord = {}) {
    const context = payload.context as AnyRecord;
    const startPage = Number.isFinite(Number(context.startPage)) ? Number(context.startPage) : currentPage;
    const horizontal = Math.abs(Number(payload.dx) || 0);
    const vertical = Math.abs(Number(payload.dy) || 0);
    const pageWidth = Number(context.pageWidth) || getLauncherPageWidth();
    const threshold = Math.max(48, Math.min(120, pageWidth * 0.18));
    const shouldChangePage = horizontal >= threshold && horizontal >= vertical * 1.2;
    const direction = (Number(payload.dx) || 0) < 0 ? 1 : -1;
    const nextPage = shouldChangePage
      ? clamp(startPage + direction, 0, latestPageCount - 1)
      : startPage;

    currentPage = clamp(startPage, 0, latestPageCount - 1);
    list.removeAttribute("data-vb-app-launcher-page-dragging");
    pendingTileClickAppId = "";
    suppressGridClickForDrag();
    goToPage(nextPage, { animate: true });
    payload.event?.preventDefault?.();
  }

  function cancelPageDrag(payload: AnyRecord = {}) {
    const context = payload.context as AnyRecord;
    const startPage = Number.isFinite(Number(context.startPage)) ? Number(context.startPage) : currentPage;
    currentPage = clamp(startPage, 0, latestPageCount - 1);
    list.removeAttribute("data-vb-app-launcher-page-dragging");
    pendingTileClickAppId = "";
    goToPage(currentPage, { animate: true });
    payload.event?.preventDefault?.();
  }

  function positionContextSheet(anchor: HTMLElement, point?: { clientX: number; clientY: number } | null) {
    const listRect = list.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const sheetRect = contextSheet.getBoundingClientRect();
    const width = sheetRect.width || 248;
    const height = sheetRect.height || 224;
    const margin = 10;
    const preferredLeft = point
      ? point.clientX - listRect.left - (width / 2)
      : anchorRect.left - listRect.left + (anchorRect.width / 2) - (width / 2);
    const belowTop = anchorRect.bottom - listRect.top + 8;
    const aboveTop = anchorRect.top - listRect.top - height - 8;
    const preferredTop = belowTop + height + margin <= listRect.height
      ? belowTop
      : aboveTop;

    contextSheet.style.left = `${Math.round(clamp(preferredLeft, margin, Math.max(margin, listRect.width - width - margin)))}px`;
    contextSheet.style.top = `${Math.round(clamp(preferredTop, margin, Math.max(margin, listRect.height - height - margin)))}px`;
  }

  function createContextButton({
    action,
    icon,
    label,
    disabled = false,
  }: {
    action: string;
    icon: string;
    label: string;
    disabled?: boolean;
  }) {
    const button = createEl("button", "vb-app-launcher-context-button", {
      type: "button",
      role: "menuitem",
      "data-launcher-context-action": action,
    }) as HTMLButtonElement;
    button.disabled = disabled;
    const iconEl = createEl("span", "vb-app-launcher-context-button-icon");
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.innerHTML = icon;
    const labelEl = createEl("span");
    labelEl.textContent = label;
    button.append(iconEl, labelEl);
    return button;
  }

  function openContextSheet(view: LauncherAppView, anchor: HTMLElement, point?: { clientX: number; clientY: number } | null) {
    const label = getAppLabel(view.app);
    closeContextSheet();
    contextAppId = view.app.id;
    contextAnchor = anchor;
    contextAnchor.setAttribute("aria-expanded", "true");

    const heading = createEl("div", "vb-app-launcher-context-heading");
    const headingIcon = createEl("span", "vb-app-launcher-context-heading-icon");
    headingIcon.setAttribute("aria-hidden", "true");
    headingIcon.innerHTML = view.app.icon || IconPages;
    applyAppIconTheme(contextSheet, view.app);
    const headingText = createEl("span", "vb-app-launcher-context-heading-text");
    const headingTitle = createEl("strong");
    headingTitle.textContent = label;
    const headingState = createEl("span");
    headingState.textContent = view.hidden
      ? "Hidden"
      : view.current
        ? "Current"
        : view.favorite
          ? "Taskbar favorite"
          : "App";
    headingText.append(headingTitle, headingState);
    heading.append(headingIcon, headingText);

    const openButton = createContextButton({
      action: "open",
      icon: view.app.icon || IconPages,
      label: "Open",
      disabled: view.disabled,
    });
    const arrangeButton = createContextButton({
      action: "arrange",
      icon: IconPages,
      label: "Arrange apps",
    });
    const favoriteButton = createContextButton({
      action: "favorite",
      icon: IconStar,
      label: view.favorite ? "Remove favorite" : "Add favorite",
    });
    const visibilityButton = createContextButton({
      action: view.hidden ? "restore" : "hide",
      icon: view.hidden ? IconPages : IconTrash,
      label: view.hidden ? "Show in launcher" : "Hide from launcher",
      disabled: !view.hidden && view.protected,
    });
    if (visibilityButton.disabled) visibilityButton.title = "Protected app";

    contextSheet.append(heading, openButton, arrangeButton, favoriteButton, visibilityButton);
    contextSheet.hidden = false;
    contextSheet.setAttribute("aria-hidden", "false");
    positionContextSheet(anchor, point);
    window.setTimeout(() => {
      const firstAction = contextSheet.querySelector<HTMLButtonElement>(".vb-app-launcher-context-button:not(:disabled)");
      firstAction?.focus({ preventScroll: true });
    }, 0);
  }

  function getViewForAppId(appId: string) {
    return buildAppViews({ includeHidden: true, includeSearch: false }).find((view) => view.app.id === appId) || null;
  }

  function attachTileContext(mainButton: HTMLElement, view: LauncherAppView) {
    let pressTimer = 0;
    let startX = 0;
    let startY = 0;
    let pointerId: number | null = null;

    function clearPressTimer() {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = 0;
      }
    }

    function suppressClick() {
      suppressedAppClicks.add(view.app.id);
      window.setTimeout(() => suppressedAppClicks.delete(view.app.id), 800);
    }

    function openFromEvent(event: PointerEvent | MouseEvent | KeyboardEvent) {
      const latestView = getViewForAppId(view.app.id) || view;
      suppressClick();
      const point = "clientX" in event && "clientY" in event
        ? { clientX: event.clientX, clientY: event.clientY }
        : null;
      openContextSheet(latestView, mainButton, point);
    }

    mainButton.addEventListener("pointerdown", (event) => {
      if (arrangeMode) return;
      if (event.button !== 0) return;
      clearPressTimer();
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
        if (activeLauncherDrag) return;
        openFromEvent(event);
      }, LONG_PRESS_MS);
    });
    mainButton.addEventListener("pointermove", (event) => {
      if (!pressTimer || pointerId !== event.pointerId) return;
      if (
        Math.abs(event.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE_PX
        || Math.abs(event.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE_PX
      ) {
        clearPressTimer();
      }
    });
    mainButton.addEventListener("pointerup", clearPressTimer);
    mainButton.addEventListener("pointercancel", clearPressTimer);
    mainButton.addEventListener("pointerleave", clearPressTimer);
    mainButton.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (arrangeMode) return;
      openFromEvent(event);
    });
    mainButton.addEventListener("keydown", (event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      if (arrangeMode) return;
      openFromEvent(event);
    });
  }

  function createTile(view: LauncherAppView) {
    const app = view.app;
    const label = getAppLabel(app);
    const tileAriaLabel = arrangeMode
      ? `Move ${label}`
      : view.hidden
        ? `${label} hidden from launcher`
        : view.disabled
          ? `${label} unavailable`
          : `Open ${label}`;
    const tile = createEl("article", "vb-app-launcher-tile", {
      role: "listitem",
      "data-app-id": app.id,
      "data-favorite": view.favorite ? "true" : "false",
      "data-hidden": view.hidden ? "true" : "false",
      "data-current-page": view.current ? "true" : "false",
      "data-running": view.running ? "true" : "false",
      "data-protected": view.protected ? "true" : "false",
      "data-disabled": view.disabled ? "true" : "false",
      "data-vb-app-launcher-reorderable": arrangeMode ? "true" : "false",
    });
    applyAppIconTheme(tile, app);

    const mainButton = createEl("button", "vb-app-launcher-tile-main", {
      type: "button",
      "aria-label": tileAriaLabel,
      "aria-current": view.current ? "page" : "false",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
    }) as HTMLButtonElement;
    Object.assign(mainButton.dataset, getTileDataset(app));
    mainButton.dataset.appId = app.id;
    if (view.disabled) mainButton.setAttribute("aria-disabled", "true");

    const icon = createEl("span", "vb-app-launcher-tile-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = app.icon || IconPages;
    const text = createEl("span", "vb-app-launcher-tile-text");
    const titleEl = createEl("span", "vb-app-launcher-tile-title");
    titleEl.textContent = getLauncherTileLabel(app);
    if (titleEl.textContent !== label) titleEl.title = label;
    text.append(titleEl);
    mainButton.append(icon, text);

    tile.append(mainButton);
    suppressNativeDrag(tile);
    attachTileContext(mainButton, view);
    return tile;
  }

  function createCompatibilityButton(view: LauncherAppView) {
    const button = createEl("button", "vb-app-launcher-compat-button", {
      type: "button",
      tabindex: "-1",
      "aria-hidden": "true",
      "data-app-id": view.app.id,
      "data-current-page": view.current ? "true" : "false",
    }) as HTMLButtonElement;
    Object.assign(button.dataset, getTileDataset(view.app));
    button.disabled = view.disabled;
    button.hidden = view.hidden && !view.protected;
    button.textContent = getAppLabel(view.app);
    return button;
  }

  function createLauncherPage(views: LauncherAppView[], pageIndex: number) {
    const page = createEl("div", "vb-app-launcher-page vb-app-launcher-grid", {
      role: "list",
      "aria-label": `Applications page ${pageIndex + 1}`,
      "data-vb-app-launcher-page": "",
    });
    page.dataset.page = String(pageIndex);
    for (const view of views) page.append(createTile(view));
    return page;
  }

  function renderDots(pageCount: number) {
    const existingDots = Array.from(dots.querySelectorAll<HTMLButtonElement>(".vb-app-launcher-page-dot"));
    if (existingDots.length === pageCount) {
      existingDots.forEach((dot, index) => {
        dot.setAttribute("aria-label", `Go to app page ${index + 1}`);
        dot.setAttribute("aria-current", index === currentPage ? "page" : "false");
        dot.dataset.page = String(index);
        dot.textContent = String(index + 1);
      });
      return;
    }

    dots.replaceChildren();
    for (let index = 0; index < pageCount; index += 1) {
      const dot = createEl("button", "vb-app-launcher-page-dot", {
        type: "button",
        "aria-label": `Go to app page ${index + 1}`,
        "aria-current": index === currentPage ? "page" : "false",
      }) as HTMLButtonElement;
      dot.dataset.page = String(index);
      dot.textContent = String(index + 1);
      dots.append(dot);
    }
  }

  function render() {
    currentRoutePath = getCurrentRoutePath();
    closeContextSheet();

    calculatePageSize();
    const normalViews = buildAppViews();
    const pageCount = Math.max(1, Math.ceil(normalViews.length / pageSize));
    latestPageCount = pageCount;
    latestAppCount = normalViews.length;
    currentPage = clamp(currentPage, 0, pageCount - 1);

    const pageElements: HTMLElement[] = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageItems = normalViews.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
      pageElements.push(createLauncherPage(pageItems, pageIndex));
    }
    pageTrack.replaceChildren(...pageElements);
    pagesViewport.hidden = normalViews.length <= 0;
    emptyState.textContent = "No apps match your search.";
    emptyState.hidden = normalViews.length > 0;

    compatibilityList.replaceChildren();
    for (const view of buildAppViews({ includeHidden: true, includeSearch: false })) {
      compatibilityList.append(createCompatibilityButton(view));
    }

    syncPageUi({ animate: false });
    syncArrangeUi();
    syncSearchUi();
    syncLanguageButton();
    applyStartMenuTranslations(list);
  }

  function launchApp(appId: string) {
    if (suppressedAppClicks.has(appId)) return;
    const app = appRegistry.getApp(appId);
    if (!app || !appControl.isEnabled(appId)) return;
    if (app.window?.shellWindowId && !floatingTools?.shellManager) {
      for (const method of getLegacyFloatingToolLaunchers(app.window.shellWindowId)) {
        const launch = (floatingTools as AnyRecord | null | undefined)?.[method];
        if (typeof launch === "function") {
          launch.call(floatingTools);
          api.close();
          return;
        }
      }
    }
    if (appLauncher.openApp(app.id)) api.close();
  }

  function handleLauncherClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    const contextAction = target?.closest<HTMLElement>("[data-launcher-context-action]");
    if (contextAction?.dataset.launcherContextAction && contextAppId) {
      event.preventDefault();
      event.stopPropagation();
      const appId = contextAppId;
      const action = contextAction.dataset.launcherContextAction;
      if (action === "open") {
        closeContextSheet();
        launchApp(appId);
        return;
      }
      if (action === "arrange") {
        setArrangeMode(true);
        return;
      }
      if (action === "favorite") {
        appControl.setFavorite(appId, !appControl.isFavorite(appId));
        return;
      }
      if (action === "hide") {
        if (!appControl.isProtected(appId)) appControl.setHiddenFromStartMenu(appId, true);
        return;
      }
      if (action === "restore") {
        appControl.setHiddenFromStartMenu(appId, false);
        return;
      }
      return;
    }

    if (target?.closest?.("[data-launcher-arrange-done]")) {
      event.preventDefault();
      event.stopPropagation();
      setArrangeMode(false);
      return;
    }

    if (target?.closest?.("[data-launcher-arrange-reset]")) {
      event.preventDefault();
      event.stopPropagation();
      resetArrangeOrder();
      return;
    }

    const pageDot = target?.closest<HTMLElement>(".vb-app-launcher-page-dot[data-page]");
    if (pageDot?.dataset.page) {
      event.preventDefault();
      goToPage(Number(pageDot.dataset.page) || 0, { animate: true });
      return;
    }

    if (target?.closest?.("[data-launcher-search-open]")) {
      event.preventDefault();
      event.stopPropagation();
      closeContextSheet();
      openSearch({ focus: true });
      return;
    }

    if (contextAppId && !target?.closest?.(".vb-app-launcher-context")) {
      closeContextSheet();
    }

    const tileButton = target?.closest<HTMLElement>("[data-app-id]");
    const activePage = tileButton?.closest<HTMLElement>("[data-vb-app-launcher-page]");
    if (activePage && activePage.getAttribute("data-vb-app-launcher-page-active") !== "true") return;
    const clickFromGridCapture = target === pagesViewport
      || target === pageTrack
      || Boolean(target?.closest?.(".vb-app-launcher-pages, .vb-app-launcher-grid"));
    if (suppressNextGridClick && (tileButton || clickFromGridCapture)) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextGridClick = false;
      return;
    }
    if (arrangeMode && tileButton) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((!tileButton || !list.contains(tileButton)) && !clickFromGridCapture) return;
    const appId = tileButton?.dataset.appId
      || tileButton?.closest<HTMLElement>("[data-app-id]")?.dataset.appId
      || (clickFromGridCapture ? pendingTileClickAppId : "");
    pendingTileClickAppId = "";
    if (appId) launchApp(appId);
  }

  function setOpen(isOpen: boolean, trigger = activeTrigger) {
    const nextOpen = isOpen === true;
    if (nextOpen) {
      activeTrigger = trigger || activeTrigger;
      list.hidden = false;
      positionMenu(activeTrigger);
      render();
      setTriggerExpanded(activeTrigger, true);
      clearActiveHeader();
      activeHeader = activeTrigger?.closest?.("header") || null;
      activeHeader?.classList.add("tools-menu-layer-open");
      open = true;
      closeSearch({ clear: true });
      return;
    }

    list.hidden = true;
    closeContextSheet();
    setArrangeMode(false, { renderView: false });
    closeSearch({ clear: true });
    setTriggerExpanded(activeTrigger, false);
    clearActiveHeader();
    open = false;
  }

  const api: VatioBoardStartMenu = {
    bindTrigger(button: HTMLElement) {
      if (!button || button.dataset.startMenuBound === "true") return api;
      button.dataset.startMenuBound = "true";
      button.setAttribute("aria-haspopup", "true");
      button.setAttribute("aria-controls", list.id);
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (open && activeTrigger === button) api.close();
        else api.setOpen(true, button);
      });
      return api;
    },
    close() {
      setOpen(false);
    },
    list,
    setOpen,
  };

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    currentPage = 0;
    render();
  });
  searchCloseButton.addEventListener("click", (event) => {
    event.preventDefault();
    closeSearch({ clear: true, focusButton: true });
  });
  langButton.addEventListener("click", () => {
    toggleLang();
    syncLanguageButton();
  });
  closeButton.addEventListener("click", () => api.close());
  list.addEventListener("click", handleLauncherClick);
  createDragSensors({
    source: pagesViewport,
    canStart(event): LauncherGridDragContext | null {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.(".vb-app-launcher-context, .vb-app-launcher-page-dot, input, a")) return null;

      const tile = target?.closest<HTMLElement>(".vb-app-launcher-tile[data-app-id]") || null;
      const appId = tile?.dataset.appId || "";
      const app = appId ? appRegistry.getApp(appId) : null;
      const activePage = tile?.closest<HTMLElement>("[data-vb-app-launcher-page]");
      if (arrangeMode) {
        if (app && tile && activePage?.getAttribute("data-vb-app-launcher-page-active") === "true") {
          return { kind: "reorder", app, tile, page: currentPage };
        }
        if (latestPageCount <= 1) return null;
        return { kind: "page", page: currentPage };
      }

      if (app && appControl.isEnabled(app.id) && isLaunchableApp(app) && !appControl.isFavorite(app.id)) {
        rememberPotentialTileClick(app.id);
        return { kind: "favorite-candidate", app, tile, page: currentPage };
      }

      if (latestPageCount <= 1) return null;
      return { kind: "page", page: currentPage };
    },
    onStart(payload) {
      const context = payload.context as AnyRecord;
      if (context.kind === "favorite-candidate") {
        const horizontal = Math.abs(payload.dx);
        const vertical = Math.abs(payload.dy);
        if (latestPageCount > 1 && horizontal > 12 && horizontal > vertical * 1.2) {
          context.kind = "page";
          beginPageDrag(payload);
          return;
        }
        context.kind = "favorite";
        beginFavoriteTileDrag(payload);
        return;
      }
      if (context.kind === "reorder") {
        beginReorderTileDrag(payload);
        return;
      }
      if (context.kind === "page") beginPageDrag(payload);
    },
    onMove(payload) {
      const context = payload.context as AnyRecord;
      if (context.kind === "favorite") moveFavoriteTileDrag(payload);
      if (context.kind === "reorder") moveReorderTileDrag(payload);
      if (context.kind === "page") movePageDrag(payload);
    },
    onEnd(payload) {
      const context = payload.context as AnyRecord;
      if (context.kind === "favorite") {
        endFavoriteTileDrag(payload);
        return;
      }
      if (context.kind === "reorder") {
        endReorderTileDrag(payload);
        return;
      }
      if (context.kind === "page") endPageDrag(payload);
    },
    onCancel(payload) {
      const context = payload.context as AnyRecord;
      if (context.kind === "favorite") cancelFavoriteTileDrag(payload);
      if (context.kind === "reorder") cancelReorderTileDrag(payload);
      if (context.kind === "page") cancelPageDrag(payload);
    },
  });
  document.addEventListener("click", (event) => {
    if (list.hidden) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (list.contains(target) || activeTrigger?.contains?.(target))) return;
    api.close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !list.hidden && searchActive) {
      event.preventDefault();
      closeSearch({ clear: true, focusButton: true });
      return;
    }
    if (event.key === "Escape" && !list.hidden && arrangeMode) {
      event.preventDefault();
      setArrangeMode(false);
      return;
    }
    if (event.key === "Escape") api.close();
  });
  document.addEventListener("i18n:change", () => {
    syncLanguageButton();
    render();
  });
  window.addEventListener("resize", () => {
    if (!list.hidden) {
      positionMenu(activeTrigger);
      render();
    }
  });
  window.addEventListener("orientationchange", () => {
    if (!list.hidden) {
      positionMenu(activeTrigger);
      render();
    }
  });
  window.addEventListener(ROUTE_VISIBLE_EVENT, () => {
    currentRoutePath = getCurrentRoutePath();
    render();
  });
  appControl.subscribe?.((_state: VatioAppControlState) => {
    render();
  });

  syncLanguageButton();
  render();

  return api;
}
