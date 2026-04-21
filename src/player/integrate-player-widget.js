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
import { createPlayerWidget } from "./player-widget.js";
import { IconMusic } from "../icons.js";
import { t } from "../i18n.js";
import { setMediaSessionEnabled, stopPlayback } from "../shared/audio-runtime.js";
import { BACKEND_AUTH_STATE_EVENT } from "../shared/backend-auth.js";

// ── Auth helpers ─────────────────────────────────────────────────────

function isLoggedIn(detail) {
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
function readInitialAuth(toolsMenuList) {
  const root = toolsMenuList?.closest("[data-backend-auth]")
    || toolsMenuList?.querySelector("[data-backend-auth]");
  if (!root?.dataset || !("authState" in root.dataset)) return undefined;
  return root.dataset.authState === "authenticated";
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
} = {}) {
  // Duplicate-injection guard
  if (toolsMenuList?.querySelector("[data-player-toggle]")) {
    return { widget: null, button: null };
  }

  // Media Session ownership
  setMediaSessionEnabled(mediaSession);

  // Read this before creating the widget so auth-gated pages do not restore
  // a visible panel while the backend auth form is still checking session.
  const initialAuthState = readInitialAuth(toolsMenuList);
  let authenticated = initialAuthState === true;

  // ── Launcher button ────────────────────────────────────────────
  let button = null;
  if (toolsMenuList) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "btn-with-icon";
    button.dataset.playerToggle = "true";
    button.hidden = true; // hidden until authenticated

    const iconSpan = document.createElement("span");
    iconSpan.className = "btn-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.innerHTML = IconMusic;

    const label = document.createElement("span");
    label.setAttribute("data-i18n", "audioPlayer");
    label.textContent = t("audioPlayer");

    button.append(iconSpan, label);

    // Insert before the backend-auth form (same position as other launchers)
    const authForm = toolsMenuList.querySelector("[data-backend-auth]");
    if (authForm) {
      toolsMenuList.insertBefore(button, authForm);
    } else {
      toolsMenuList.append(button);
    }
  }

  // ── Widget (with floating FAB + external button) ───────────────
  const widget = createPlayerWidget({
    floating: true,
    button,
    preload,
    mount,
    restoreVisibility: authenticated,
    onOpen() {
      if (toolsMenu && typeof toolsMenu.close === "function") {
        toolsMenu.close();
      }
    },
  });

  // ── FAB element (created by the widget) ────────────────────────
  const fab = mount.querySelector(".player-fab");

  // ── Auth gating ────────────────────────────────────────────────
  function syncVisibility(loggedIn, { stop = false, restore = false } = {}) {
    authenticated = loggedIn;
    if (button) button.hidden = !loggedIn;
    if (fab) fab.hidden = !loggedIn;

    if (stop) {
      widget.close();
      stopPlayback();
    } else if (!loggedIn) {
      widget.close({ persist: false });
    } else if (restore) {
      widget.restoreVisibility();
    }
  }

  // Apply initial visibility
  syncVisibility(authenticated, { stop: false });

  // React to auth changes
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, (event) => {
    const detail = event?.detail || {};
    const loggedIn = isLoggedIn(detail);
    const shouldStopPlayback = detail.pendingLogout === true || (authenticated === true && !loggedIn);
    syncVisibility(loggedIn, { stop: shouldStopPlayback, restore: loggedIn });
  });

  return { widget, button };
}
