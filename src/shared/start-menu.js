import "../styles/backend-auth.less";

import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import {
  IconAccel,
  IconBoard,
  IconCalculator,
  IconEnergy,
  IconLogin,
  IconLogout,
  IconReplay,
  IconSpeed,
  IconWorld,
} from "../icons.js";
import { initBackendAuthControllers } from "./backend-auth.js";
import { integratePlayerWidget } from "../player/integrate-player-widget.js";
import { navigateToAppRoute, ROUTE_VISIBLE_EVENT } from "../app/router.js";

const START_MENU_KEY = "__vatioboardStartMenu";

const NAV_ITEMS = [
  {
    icon: IconSpeed,
    i18nKey: "speedometer",
    href: "#/speed",
    path: "/",
    pathAliases: ["/speed"],
    text: "Speedometer",
  },
  {
    icon: IconBoard,
    i18nKey: "openBoard",
    href: "#/board",
    path: "/board",
    text: "Open board",
  },
  {
    icon: IconReplay,
    i18nKey: "driveReplay",
    href: "#/replay",
    path: "/replay",
    text: "Drive Replay",
  },
  {
    icon: IconAccel,
    i18nKey: "accelerationTest",
    href: "#/accel",
    path: "/accel",
    text: "Acceleration Test",
  },
  {
    icon: IconWorld,
    i18nKey: "cloudLibrary",
    href: "#/library",
    path: "/library",
    text: "Cloud library",
  },
];

function createIconButton({
  icon,
  i18nKey,
  text,
  type = "button",
  dataset = {},
} = {}) {
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
        <a class="backend-auth-link" data-backend-auth-signup href="https://www.vatiolibre.com/login#signup" rel="noreferrer" data-i18n="authCreateAccount">Create account</a>
        <a class="backend-auth-link" data-backend-auth-forgot href="https://www.vatiolibre.com/login#forgot" rel="noreferrer" data-i18n="authForgotPassword">Forgot password</a>
      </div>
    </div>
  `;

  return form;
}

function buildStartMenu() {
  const list = document.createElement("div");
  list.id = "appStartMenuList";
  list.className = "tools-menu-list app-start-menu-list";
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

  for (const item of NAV_ITEMS) {
    list.append(createIconButton({
      icon: item.icon,
      i18nKey: item.i18nKey,
      text: item.text,
      dataset: {
        href: item.href,
        startRoute: item.path,
      },
    }));
  }

  list.append(createIconButton({
    icon: IconCalculator,
    i18nKey: "calculator",
    text: "Calculator",
    dataset: { startAction: "calculator" },
  }));

  list.append(createIconButton({
    icon: IconEnergy,
    i18nKey: "energy",
    text: "Energy",
    dataset: { startAction: "energy" },
  }));

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
    const item = NAV_ITEMS.find((candidate) => candidate.path === button.dataset.startRoute);
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

function positionMenu(list, trigger) {
  const margin = 8;
  const triggerRect = trigger?.getBoundingClientRect?.();

  list.style.position = "fixed";
  list.style.right = "auto";
  list.style.bottom = "auto";

  const rect = list.getBoundingClientRect();
  const fallbackLeft = Math.max(margin, window.innerWidth - rect.width - 16);
  const fallbackTop = 64;
  const preferredLeft = triggerRect
    ? triggerRect.right - rect.width
    : fallbackLeft;
  const preferredTop = triggerRect
    ? triggerRect.bottom + 8
    : fallbackTop;

  list.style.left = `${clamp(preferredLeft, margin, window.innerWidth - rect.width - margin)}px`;
  list.style.top = `${clamp(preferredTop, margin, window.innerHeight - rect.height - margin)}px`;
}

export function getSharedStartMenu() {
  return window[START_MENU_KEY] || null;
}

export function initSharedStartMenu({
  floatingTools,
  mount = document.body,
} = {}) {
  const existing = getSharedStartMenu();
  if (existing?.list?.isConnected) return existing;
  if (existing) delete window[START_MENU_KEY];

  const { langButton, list } = buildStartMenu();
  mount.append(list);

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
    const actionButton = event.target.closest("[data-start-action]");
    if (actionButton?.dataset.startAction === "calculator") {
      floatingTools?.toggleCalculator?.();
      close();
      return;
    }
    if (actionButton?.dataset.startAction === "energy") {
      floatingTools?.toggleEnergy?.();
      close();
      return;
    }

    const navButton = event.target.closest("[data-href]");
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
    if (list.contains(event.target) || activeTrigger?.contains?.(event.target)) return;
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

  window.addEventListener(ROUTE_VISIBLE_EVENT, () => {
    syncCurrentRoute(list);
  });

  syncLanguageButton(langButton);
  applyTranslations(list);
  initBackendAuthControllers({ root: list });

  const api = {
    bindTrigger,
    close,
    list,
    setOpen,
  };

  window[START_MENU_KEY] = api;
  integratePlayerWidget({ toolsMenuList: list, toolsMenu: api });
  return api;
}
