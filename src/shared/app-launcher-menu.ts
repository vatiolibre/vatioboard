import "../styles/app-launcher-menu.less";

import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import {
  IconClose,
  IconPages,
  IconTrash,
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

const IconStar = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m12 3.9 2.45 4.96 5.48.8-3.96 3.86.94 5.46L12 16.4l-4.9 2.58.93-5.46-3.96-3.86 5.48-.8L12 3.9Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/>
  </svg>
`;

type AnyRecord = Record<string, any>;

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
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const aLast = Date.parse(String(appControl.getState(a.app.id).lastOpenedAt || ""));
  const bLast = Date.parse(String(appControl.getState(b.app.id).lastOpenedAt || ""));
  if (Number.isFinite(aLast) && Number.isFinite(bLast) && aLast !== bLast) return bLast - aLast;
  if (a.app.order !== b.app.order) return a.app.order - b.app.order;
  return getAppLabel(a.app).localeCompare(getAppLabel(b.app)) || a.app.id.localeCompare(b.app.id);
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
  brand.title = "Simple full-page drawing board by Vatio Libre";
  brand.innerHTML = `
    <span class="dot" aria-hidden="true"></span>
    <picture class="brand-logo compact-tools-menu-logo" aria-hidden="true">
      <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
      <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
      <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
    </picture>
    <span class="sr-only" data-i18n="brand">Vatio Board</span>
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
  controls.append(utilityControls);
  header.append(brand, titleBlock, controls);

  const body = createEl("div", "vb-app-launcher-body");
  const main = createEl("main", "vb-app-launcher-main");
  const pageStatus = createEl("p", "vb-app-launcher-page-status", {
    "aria-live": "polite",
  });
  const grid = createEl("div", "vb-app-launcher-grid", {
    role: "list",
    "aria-label": "Applications",
  });
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
  main.append(grid, emptyState, pagination);
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

  list.append(header, searchPanel, body, contextSheet, compatibilityList);
  mount.append(list);

  let open = false;
  let activeTrigger: HTMLElement | null = null;
  let activeHeader: HTMLElement | null = null;
  let currentPage = 0;
  let latestPageCount = 1;
  let pageSize = 8;
  let query = "";
  let currentRoutePath = getCurrentRoutePath();
  let contextAppId = "";
  let contextAnchor: HTMLElement | null = null;
  let suppressNextGridClick = false;
  let searchActive = false;
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

  function buildAppViews({ includeHidden = false } = {}) {
    const running = getRunningAppIds();
    const search = query.trim().toLowerCase();
    const revealHiddenMatches = Boolean(search);
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
      })
      .sort(compareLauncherApps);
  }

  function calculatePageSize() {
    const listWidth = numberFromStyle(list.style.width, list.offsetWidth || 900);
    const listHeight = numberFromStyle(list.style.height, list.offsetHeight || 640);
    const gridRect = grid.getBoundingClientRect();
    const gridWidth = gridRect.width || Math.max(280, listWidth - 40);
    const gridHeight = gridRect.height || Math.max(220, listHeight - 150);
    const minTileWidth = gridWidth < 520 ? 92 : LAUNCHER_MIN_TILE_WIDTH;
    const columns = Math.max(1, Math.floor((gridWidth + LAUNCHER_GRID_GAP) / (minTileWidth + LAUNCHER_GRID_GAP)));
    const rows = Math.max(1, Math.floor((gridHeight + LAUNCHER_GRID_GAP) / (LAUNCHER_TILE_HEIGHT + LAUNCHER_GRID_GAP)));
    pageSize = Math.max(1, columns * rows);
    list.style.setProperty("--vb-app-launcher-tile-min", `${minTileWidth}px`);
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

  function syncSearchUi() {
    list.dataset.searchActive = searchActive ? "true" : "false";
    searchPanel.hidden = !searchActive;
    searchButton.hidden = searchActive;
    searchInput.tabIndex = searchActive ? 0 : -1;
    searchButton.setAttribute("aria-expanded", searchActive ? "true" : "false");
  }

  function openSearch({ focus = false } = {}) {
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

    contextSheet.append(heading, openButton, favoriteButton, visibilityButton);
    contextSheet.hidden = false;
    contextSheet.setAttribute("aria-hidden", "false");
    positionContextSheet(anchor, point);
    window.setTimeout(() => {
      const firstAction = contextSheet.querySelector<HTMLButtonElement>(".vb-app-launcher-context-button:not(:disabled)");
      firstAction?.focus({ preventScroll: true });
    }, 0);
  }

  function getViewForAppId(appId: string) {
    return buildAppViews({ includeHidden: true }).find((view) => view.app.id === appId) || null;
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
      if (event.button !== 0) return;
      clearPressTimer();
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
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
      openFromEvent(event);
    });
    mainButton.addEventListener("keydown", (event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      openFromEvent(event);
    });
  }

  function createTile(view: LauncherAppView) {
    const app = view.app;
    const label = getAppLabel(app);
    const tile = createEl("article", "vb-app-launcher-tile", {
      role: "listitem",
      "data-app-id": app.id,
      "data-favorite": view.favorite ? "true" : "false",
      "data-hidden": view.hidden ? "true" : "false",
      "data-current-page": view.current ? "true" : "false",
      "data-running": view.running ? "true" : "false",
      "data-protected": view.protected ? "true" : "false",
      "data-disabled": view.disabled ? "true" : "false",
    });
    applyAppIconTheme(tile, app);

    const mainButton = createEl("button", "vb-app-launcher-tile-main", {
      type: "button",
      "aria-label": view.hidden
        ? `${label} hidden from launcher`
        : view.disabled
          ? `${label} unavailable`
          : `Open ${label}`,
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

  function renderDots(pageCount: number) {
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
    currentPage = clamp(currentPage, 0, pageCount - 1);
    const pageItems = normalViews.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

    grid.replaceChildren();
    for (const view of pageItems) grid.append(createTile(view));
    emptyState.textContent = "No apps match your search.";
    emptyState.hidden = normalViews.length > 0;

    compatibilityList.replaceChildren();
    for (const view of buildAppViews({ includeHidden: true })) {
      compatibilityList.append(createCompatibilityButton(view));
    }

    const pageText = `Page ${currentPage + 1} of ${pageCount}`;
    pageStatus.textContent = `${pageText} · ${normalViews.length} app${normalViews.length === 1 ? "" : "s"}`;
    pageStatus.setAttribute("aria-label", pageText);
    renderDots(pageCount);
    dots.hidden = pageCount <= 1;
    pagination.hidden = false;
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
    if (suppressNextGridClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextGridClick = false;
      return;
    }
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

    const pageDot = target?.closest<HTMLElement>("[data-page]");
    if (pageDot?.dataset.page) {
      event.preventDefault();
      currentPage = Number(pageDot.dataset.page) || 0;
      render();
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
    if (!tileButton || !list.contains(tileButton)) return;
    const appId = tileButton.dataset.appId || tileButton.closest<HTMLElement>("[data-app-id]")?.dataset.appId || "";
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
    source: grid,
    canStart(event) {
      if (latestPageCount <= 1) return null;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.(".vb-app-launcher-context, .vb-app-launcher-page-dot, input, a")) return null;
      return { page: currentPage };
    },
    onStart() {
      closeContextSheet();
    },
    onEnd(payload) {
      const horizontal = Math.abs(payload.dx);
      const vertical = Math.abs(payload.dy);
      if (horizontal < 48 || horizontal < vertical * 1.2) return;
      suppressNextGridClick = true;
      window.setTimeout(() => {
        suppressNextGridClick = false;
      }, 350);
      currentPage = clamp(currentPage + (payload.dx < 0 ? 1 : -1), 0, latestPageCount - 1);
      render();
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
