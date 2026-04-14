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
 * Returns true when the form's dataset already says "authenticated".
 */
function readInitialAuth(toolsMenuList) {
  const root = toolsMenuList?.closest("[data-backend-auth]")
    || toolsMenuList?.querySelector("[data-backend-auth]");
  return root?.dataset?.authState === "authenticated";
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
    onOpen() {
      if (toolsMenu && typeof toolsMenu.close === "function") {
        toolsMenu.close();
      }
    },
  });

  // ── FAB element (created by the widget) ────────────────────────
  const fab = mount.querySelector(".player-fab");

  // ── Auth gating ────────────────────────────────────────────────
  let authenticated = readInitialAuth(toolsMenuList);

  function syncVisibility(loggedIn) {
    authenticated = loggedIn;
    if (button) button.hidden = !loggedIn;
    if (fab) fab.hidden = !loggedIn;

    if (!loggedIn) {
      widget.close();
      stopPlayback();
    }
  }

  // Apply initial visibility
  syncVisibility(authenticated);

  // React to auth changes
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, (event) => {
    syncVisibility(isLoggedIn(event?.detail || {}));
  });

  return { widget, button };
}
