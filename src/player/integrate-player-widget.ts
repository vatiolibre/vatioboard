/**
 * Shared player widget integration for host pages.
 *
 * Provides a single function that host pages call to embed the player
 * widget into their existing tools menu.  Handles:
 *  - importing player styles
 *  - creating the widget instance (singleton per page)
 *  - injecting a "Player" launcher button into the page's tools menu list
 *  - showing/hiding the launcher + FAB based on backend auth state
 *  - closing the widget + stopping playback on logout
 *  - Media Session ownership opt-out for pages that own it themselves
 *
 * Usage (from any page):
 *
 *   import { integratePlayerWidget } from "../player/integrate-player-widget.js";
 *   const player = integratePlayerWidget({ toolsMenuList, toolsMenu });
 */

import "../styles/player.less";
import "../shared/ui/confirm-dialog.less";
import { createPlayerWidget } from "./player-widget.js";
import { IconMusic } from "../icons.js";
import { t } from "../i18n.js";
import { setMediaSessionEnabled, stopPlayback } from "../shared/audio-runtime.js";
import {
  BACKEND_AUTH_STATE_EVENT,
  getBackendSessionState,
} from "../shared/backend-auth.js";

// ── Auth helpers ─────────────────────────────────────────────────────

type BackendAuthDetail = {
  authenticated?: boolean;
  isGuest?: boolean;
  pendingLogout?: boolean;
  [key: string]: unknown;
};

type ToolsMenuController = {
  close?: () => void;
};

type PlayerWidgetApi = {
  open?: (options?: Record<string, unknown>) => void;
  close: (options?: Record<string, unknown>) => void;
  restoreVisibility: () => void;
  [key: string]: unknown;
};

type IntegratePlayerWidgetOptions = {
  toolsMenuList?: HTMLElement | null;
  toolsMenu?: ToolsMenuController | null;
  mediaSession?: boolean;
  preload?: "on-open" | "immediate";
  mount?: HTMLElement;
};

type IntegratePlayerWidgetResult = {
  widget: PlayerWidgetApi | null;
  button: HTMLButtonElement | null;
};

type VisibilityOptions = {
  loggedIn?: boolean;
  available?: boolean;
  stop?: boolean;
  restore?: boolean;
  known?: boolean;
};

function isLoggedIn(detail: BackendAuthDetail) {
  return (
    detail.authenticated === true &&
    detail.isGuest !== true &&
    detail.pendingLogout !== true
  );
}

/**
 * Read the initial auth state from the nearest [data-backend-auth] root.
 * Returns undefined when the auth form has not completed its initial
 * session check yet.  Treating that as a logout would wipe player restore
 * state during page refresh.
 */
function readInitialAuth(toolsMenuList: HTMLElement | null | undefined): boolean | undefined {
  const root = toolsMenuList?.closest<HTMLElement>("[data-backend-auth]")
    || toolsMenuList?.querySelector<HTMLElement>("[data-backend-auth]");
  if (!root?.dataset || !("authState" in root.dataset)) return undefined;
  return root.dataset.authState === "authenticated";
}

function insertPlayerButton(toolsMenuList: HTMLElement | null | undefined, button: HTMLButtonElement) {
  const anchor = toolsMenuList?.querySelector("[data-player-toggle-anchor]")
    || toolsMenuList?.querySelector("[data-backend-auth]");
  if (anchor) toolsMenuList.insertBefore(button, anchor);
  else toolsMenuList?.append(button);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {HTMLElement} opts.toolsMenuList - Container for menu items
 * @param {{ close: Function }} opts.toolsMenu - Tools menu controller
 * @param {boolean} [opts.mediaSession=true] - Let player own Media Session
 * @param {"on-open"|"immediate"} [opts.preload="on-open"]
 * @param {HTMLElement} [opts.mount=document.body]
 * @returns {{ widget: object, button: HTMLElement|null }}
 */
export function integratePlayerWidget({
  toolsMenuList,
  toolsMenu,
  mediaSession = true,
  preload = "on-open",
  mount = document.body,
}: IntegratePlayerWidgetOptions = {}): IntegratePlayerWidgetResult {
  // Duplicate-injection guard
  if (toolsMenuList?.querySelector("[data-player-toggle]")) {
    return { widget: null, button: null };
  }

  // Media Session ownership
  setMediaSessionEnabled(mediaSession);

  if (window.__vatioboardSpa && window.__vatioboardPlayerWidget) {
    const existingWidget = window.__vatioboardPlayerWidget as PlayerWidgetApi;
    let button: HTMLButtonElement | null = null;
    if (toolsMenuList) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "btn-with-icon";
      button.dataset.playerToggle = "true";

      const iconSpan = document.createElement("span");
      iconSpan.className = "btn-icon";
      iconSpan.setAttribute("aria-hidden", "true");
      iconSpan.innerHTML = IconMusic;

      const label = document.createElement("span");
      label.setAttribute("data-i18n", "audioPlayer");
      label.textContent = t("audioPlayer");

      button.append(iconSpan, label);
      insertPlayerButton(toolsMenuList, button);

      button.addEventListener("click", () => {
        existingWidget.open?.();
        if (toolsMenu && typeof toolsMenu.close === "function") toolsMenu.close();
      });
    }

    return {
      widget: existingWidget,
      button,
    };
  }

  // Read this before creating the widget so auth-gated pages do not restore
  // a visible panel until the backend auth form has published whether the
  // page is authenticated or guest.
  const initialAuthState = readInitialAuth(toolsMenuList);
  let authenticated = initialAuthState === true;
  let authStateKnown = initialAuthState !== undefined;

  // ── Launcher button ────────────────────────────────────────────
  let button: HTMLButtonElement | null = null;
  if (toolsMenuList) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "btn-with-icon";
    button.dataset.playerToggle = "true";
    button.hidden = true; // hidden until auth state is known

    const iconSpan = document.createElement("span");
    iconSpan.className = "btn-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.innerHTML = IconMusic;

    const label = document.createElement("span");
    label.setAttribute("data-i18n", "audioPlayer");
    label.textContent = t("audioPlayer");

    button.append(iconSpan, label);
    insertPlayerButton(toolsMenuList, button);
  }

  // ── Widget (shell taskbar launcher + external button) ──────────
  const widget = createPlayerWidget({
    floating: false,
    button,
    preload,
    mount,
    restoreVisibility: false,
    onOpen() {
      if (toolsMenu && typeof toolsMenu.close === "function") {
        toolsMenu.close();
      }
    },
  });

  // ── Auth gating ────────────────────────────────────────────────
  function syncVisibility({
    loggedIn = false,
    available = false,
    stop = false,
    restore = false,
    known = true,
  }: VisibilityOptions = {}) {
    if (known) authStateKnown = true;
    authenticated = loggedIn === true;
    if (button) button.hidden = !available;

    if (stop) {
      stopPlayback();
    }

    if (!available) {
      widget.close({ persist: false });
    } else if (restore) {
      widget.restoreVisibility();
    }
  }

  async function reconcileInitialAuthState() {
    if (authStateKnown) return;

    // Give the backend auth form one microtask to publish its dataset after
    // page scripts finish wiring up. If an auth event already arrived, bail.
    await Promise.resolve();
    if (authStateKnown) return;

    const domAuthState = readInitialAuth(toolsMenuList);
    if (domAuthState !== undefined) {
      syncVisibility({ loggedIn: domAuthState, available: true, restore: true });
      return;
    }

    try {
      const session = await getBackendSessionState({ force: false });
      if (authStateKnown) return;
      const loggedIn = session?.authenticated === true && session?.isGuest !== true;
      syncVisibility({ loggedIn, available: true, restore: true });
    } catch {
      // Leave the widget hidden until the auth form emits a definitive state.
    }
  }

  // Apply initial visibility
  syncVisibility({
    loggedIn: authenticated,
    available: authStateKnown,
    restore: authStateKnown,
    known: authStateKnown,
  });

  // React to auth changes
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, (event) => {
    const detail = (event as CustomEvent<BackendAuthDetail>)?.detail || {};
    const loggedIn = isLoggedIn(detail);
    const available = detail.pendingLogout !== true;
    const shouldStopPlayback = detail.pendingLogout === true || (authenticated === true && !loggedIn);
    syncVisibility({ loggedIn, available, stop: shouldStopPlayback, restore: available });
  });

  void reconcileInitialAuthState();

  return { widget, button };
}
