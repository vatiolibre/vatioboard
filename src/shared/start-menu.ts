import "../styles/backend-auth.less";

import { applyTranslations, getLang, toggleLang } from "../i18n.js";
import {
  IconLogin,
  IconLogout,
} from "../icons.js";
import { initBackendAuthControllers } from "./backend-auth.js";
import { integratePlayerWidget } from "../player/integrate-player-widget.js";
import { appRegistry, createAppLauncher } from "../app-platform/index.js";
import { navigateToAppRoute, ROUTE_VISIBLE_EVENT } from "../app/router.js";
import { SHELL_Z_INDEX } from "./shell-layers.js";
import { getShellWorkArea, getViewportRect } from "./shell-work-area.js";
import type { FloatingToolsRuntime } from "./floating-tools";
import type { VatioToolDefinition } from "../types/ui";
import { getRouteToolDefinition, getStartMenuToolDefinitions, TOOL_IDS } from "./tool-registry.js";

const START_MENU_KEY = "__vatioboardStartMenu";

interface IconButtonOptions {
  icon?: string;
  i18nKey?: string;
  text?: string;
  type?: "button" | "submit" | "reset";
  dataset?: Record<string, string>;
}

interface StartMenuApi {
  bindTrigger(button: HTMLElement): StartMenuApi;
  close(): void;
  list: HTMLElement;
  setOpen(isOpen: boolean, trigger?: HTMLElement | null): void;
}

interface StartMenuOptions {
  floatingTools?: FloatingToolsRuntime | null;
  mount?: HTMLElement;
}

const integrateShellPlayerWidget = integratePlayerWidget as (options: {
  toolsMenuList: HTMLElement;
  toolsMenu: StartMenuApi;
}) => unknown;
const applyStartMenuTranslations = applyTranslations as (root?: ParentNode) => void;
const initStartMenuBackendAuth = initBackendAuthControllers as unknown as (options?: { root?: HTMLElement }) => unknown;

function createIconButton({
  icon,
  i18nKey,
  text,
  type = "button",
  dataset = {},
}: IconButtonOptions = {}) {
  const button = document.createElement("button");
  button.type = type;
  button.className = "btn-with-icon";

  for (const [key, value] of Object.entries(dataset)) {
    button.dataset[key] = value;
  }

  const iconSlot = document.createElement("span");
  iconSlot.className = "btn-icon";
  iconSlot.setAttribute("aria-hidden", "true");
  iconSlot.innerHTML = icon || "";

  const label = document.createElement("span");
  if (i18nKey) label.dataset.i18n = i18nKey;
  label.textContent = text || "";

  button.append(iconSlot, label);
  return button;
}

function getStartMenuDataset(item: VatioToolDefinition) {
  if (item.kind === "route") {
    return {
      href: item.href || "",
      startRoute: item.path || "",
    };
  }
  if (item.kind === "shell-window") {
    return {
      startAction: item.shellWindowId || item.id,
    };
  }
  return {
    startAction: item.id,
  };
}

function buildBackendAuthForm() {
  const form = document.createElement("form");
  form.className = "backend-auth";
  form.dataset.backendAuth = "";
  form.noValidate = true;

  form.innerHTML = `
    <div class="backend-auth-header">
      <div class="backend-auth-copy">
        <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
      </div>
      <button class="backend-auth-logout-button" type="button" data-backend-auth-logout data-backend-auth-authenticated aria-label="Log out" title="Log out" data-i18n-aria="authLogout" data-i18n-title="authLogout">
        <span class="backend-auth-action-icon" aria-hidden="true">${IconLogout}</span>
        <span class="sr-only" data-i18n="authLogout">Log out</span>
      </button>
    </div>
    <div class="backend-auth-fields" data-backend-auth-guest>
      <input
        class="backend-auth-input"
        data-backend-auth-user
        type="text"
        autocomplete="username"
        spellcheck="false"
        aria-label="Email / username"
        data-i18n-aria="authUsername"
        placeholder="Email / username"
        data-i18n-placeholder="authUsername"
      />
      <input
        class="backend-auth-input"
        data-backend-auth-password
        type="password"
        autocomplete="current-password"
        aria-label="Password"
        data-i18n-aria="authPassword"
        placeholder="Password"
        data-i18n-placeholder="authPassword"
      />
    </div>
    <div class="backend-auth-actions" data-backend-auth-guest>
      <button class="backend-auth-login-button" type="submit" data-backend-auth-login>
        <span class="backend-auth-action-icon" aria-hidden="true">${IconLogin}</span>
        <span data-i18n="authLogin">Log in</span>
      </button>
      <div class="backend-auth-links">
        <a class="backend-auth-link" data-backend-auth-signup href="https://www.vatiolibre.com/login#signup" target="_blank" rel="noopener noreferrer" data-i18n="authCreateAccount">Create account</a>
        <a class="backend-auth-link" data-backend-auth-forgot href="https://www.vatiolibre.com/login#forgot" target="_blank" rel="noopener noreferrer" data-i18n="authForgotPassword">Forgot password</a>
      </div>
    </div>
  `;

  return form;
}

function buildStartMenu() {
  const list = document.createElement("div");
  list.id = "appStartMenuList";
  list.className = "tools-menu-list app-start-menu-list";
  list.style.zIndex = String(SHELL_Z_INDEX.startMenu);
  list.hidden = true;

  const brand = document.createElement("div");
  brand.className = "compact-tools-menu-brand app-start-menu-brand";
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

  const langButton = document.createElement("button");
  langButton.type = "button";
  langButton.className = "lang-toggle";
  langButton.dataset.i18nAria = "changeLanguage";
  langButton.dataset.langToggle = "";
  langButton.setAttribute("aria-label", "Change language");
  brand.append(langButton);

  list.append(brand);
  list.append(buildBackendAuthForm());

  for (const item of getStartMenuToolDefinitions()) {
    list.append(createIconButton({
      icon: item.icon,
      i18nKey: item.i18nKey,
      text: item.text,
      dataset: getStartMenuDataset(item),
    }));
  }

  const playerAnchor = document.createElement("span");
  playerAnchor.dataset.playerToggleAnchor = "";
  playerAnchor.hidden = true;
  list.append(playerAnchor);

  return { langButton, list };
}

function getRoutePath() {
  const routePath = window.__vatioboardRouter?.getRoute?.()?.path;
  if (routePath) return routePath;

  const hash = window.location.hash || "#/";
  const path = hash.slice(1).split("?", 1)[0] || "/";
  return path === "/speed" ? "/" : path;
}

function syncCurrentRoute(list) {
  const routePath = getRoutePath();
  list.querySelectorAll("[data-start-route]").forEach((button) => {
    const item = getRouteToolDefinition(button instanceof HTMLElement ? button.dataset.startRoute || "" : "");
    const isCurrent = item?.path === routePath || item?.pathAliases?.includes(routePath);
    button.dataset.currentPage = isCurrent ? "true" : "false";
    button.setAttribute("aria-current", isCurrent ? "page" : "false");
  });
}

function syncLanguageButton(button) {
  button.textContent = String(getLang()).toUpperCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readPositiveNumber(...values) {
  for (const value of values) {
    const parsed = Number.parseFloat(String(value ?? ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function getMenuNaturalSize(list) {
  const rect = list.getBoundingClientRect?.() || {};
  return {
    width: readPositiveNumber(rect.width, list.scrollWidth, list.offsetWidth, 320),
    height: readPositiveNumber(list.scrollHeight, rect.height, list.offsetHeight, 320),
  };
}

function positionMenu(list, trigger) {
  const margin = 8;
  const gap = 8;
  const triggerRect = trigger?.getBoundingClientRect?.();
  const viewport = getViewportRect();
  const workArea = getShellWorkArea({ viewport, safeMargin: margin });
  const area: Record<string, number> = {
    left: Math.max(viewport.left + margin, workArea.left),
    top: Math.max(viewport.top + margin, workArea.top),
    right: Math.min(viewport.left + viewport.width - margin, workArea.left + workArea.width),
    bottom: Math.min(viewport.top + viewport.height - margin, workArea.top + workArea.height),
  };
  area.width = Math.max(1, area.right - area.left);
  area.height = Math.max(1, area.bottom - area.top);

  list.style.position = "fixed";
  list.style.right = "auto";
  list.style.bottom = "auto";
  list.style.height = "auto";
  list.style.maxHeight = "none";
  list.style.overflowY = "visible";

  const naturalSize = getMenuNaturalSize(list);
  const menuWidth = Math.min(naturalSize.width, area.width);
  const fallbackLeft = Math.max(area.left, area.right - menuWidth - margin);
  const fallbackTop = 64;
  const preferredLeft = triggerRect
    ? triggerRect.right - menuWidth
    : fallbackLeft;

  const belowTop = triggerRect ? triggerRect.bottom + gap : clamp(fallbackTop, area.top, area.bottom);
  const aboveBottom = triggerRect ? triggerRect.top - gap : area.bottom;
  const availableBelow = Math.max(0, area.bottom - belowTop);
  const availableAbove = Math.max(0, aboveBottom - area.top);
  const opensBelow = !triggerRect
    || naturalSize.height <= availableBelow
    || (naturalSize.height > availableAbove && availableBelow >= availableAbove);
  const chosenAvailableHeight = opensBelow ? availableBelow : availableAbove;
  const availableHeight = Math.max(1, chosenAvailableHeight || area.height);
  const menuHeight = Math.min(naturalSize.height, availableHeight);
  const preferredTop = opensBelow
    ? belowTop
    : aboveBottom - menuHeight;
  const needsScroll = naturalSize.height > availableHeight + 1;

  list.style.left = `${clamp(preferredLeft, area.left, Math.max(area.left, area.right - menuWidth))}px`;
  list.style.top = `${clamp(preferredTop, area.top, Math.max(area.top, area.bottom - menuHeight))}px`;
  list.style.maxHeight = needsScroll ? `${Math.floor(availableHeight)}px` : "none";
  list.style.overflowY = needsScroll ? "auto" : "visible";
}

export function getSharedStartMenu(): StartMenuApi | null {
  return window[START_MENU_KEY] || null;
}

export function initSharedStartMenu({
  floatingTools,
  mount = document.body,
}: StartMenuOptions = {}): StartMenuApi {
  const existing = getSharedStartMenu();
  if (existing?.list?.isConnected) return existing;
  if (existing) delete window[START_MENU_KEY];

  const { langButton, list } = buildStartMenu();
  mount.append(list);
  const appLauncher = createAppLauncher({
    shellManager: floatingTools?.shellManager,
    navigate: navigateToAppRoute,
    getCurrentRoute: () => window.__vatioboardRouter?.getRoute?.() || null,
  });

  let open = false;
  let activeTrigger = null;
  let activeHeader = null;

  function setTriggerExpanded(trigger, isExpanded) {
    trigger?.setAttribute?.("aria-expanded", isExpanded ? "true" : "false");
  }

  function clearActiveHeader() {
    activeHeader?.classList.remove("tools-menu-layer-open");
    activeHeader = null;
  }

  function setOpen(isOpen, trigger = activeTrigger) {
    const nextOpen = isOpen === true;
    if (nextOpen) {
      activeTrigger = trigger || activeTrigger;
      syncCurrentRoute(list);
      list.hidden = false;
      positionMenu(list, activeTrigger);
      setTriggerExpanded(activeTrigger, true);
      clearActiveHeader();
      activeHeader = activeTrigger?.closest?.("header") || null;
      activeHeader?.classList.add("tools-menu-layer-open");
      open = true;
      return;
    }

    list.hidden = true;
    setTriggerExpanded(activeTrigger, false);
    clearActiveHeader();
    open = false;
  }

  function close() {
    setOpen(false);
  }

  function toggleShellTool(action: string) {
    const app = appRegistry.listApps().find((candidate) =>
      candidate.window?.shellWindowId === action || candidate.metadata.legacyToolId === action
    );
    if (app && appLauncher.openApp(app.id)) return true;
    if (action === TOOL_IDS.calculator) return floatingTools?.toggleCalculator?.();
    if (action === TOOL_IDS.energy) return floatingTools?.toggleEnergy?.();
    if (action === TOOL_IDS.cameraMap) return floatingTools?.toggleCameraMap?.();
    if (action === TOOL_IDS.speedAlerts) return floatingTools?.toggleSpeedAlerts?.();
    return null;
  }

  function bindTrigger(button) {
    if (!button || button.dataset.startMenuBound === "true") return api;
    button.dataset.startMenuBound = "true";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-controls", list.id);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (open && activeTrigger === button) close();
      else setOpen(true, button);
    });
    return api;
  }

  list.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const actionButton = target?.closest("[data-start-action]") as HTMLElement | null;
    if (actionButton?.dataset.startAction) {
      toggleShellTool(actionButton.dataset.startAction);
      close();
      return;
    }

    const navButton = target?.closest("[data-href]") as HTMLElement | null;
    if (!navButton) return;
    close();
    navigateToAppRoute(navButton.dataset.href);
  });

  langButton.addEventListener("click", () => {
    toggleLang();
    syncLanguageButton(langButton);
  });

  document.addEventListener("click", (event) => {
    if (list.hidden) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (list.contains(target) || activeTrigger?.contains?.(target))) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  document.addEventListener("i18n:change", () => {
    syncLanguageButton(langButton);
  });

  window.addEventListener("resize", () => {
    if (!list.hidden) positionMenu(list, activeTrigger);
  });

  window.addEventListener("orientationchange", () => {
    if (!list.hidden) positionMenu(list, activeTrigger);
  });

  window.addEventListener(ROUTE_VISIBLE_EVENT, () => {
    syncCurrentRoute(list);
  });

  syncLanguageButton(langButton);
  applyStartMenuTranslations(list);
  initStartMenuBackendAuth({ root: list });

  const api: StartMenuApi = {
    bindTrigger,
    close,
    list,
    setOpen,
  };

  window[START_MENU_KEY] = api;
  integrateShellPlayerWidget({ toolsMenuList: list, toolsMenu: api });
  return api;
}
