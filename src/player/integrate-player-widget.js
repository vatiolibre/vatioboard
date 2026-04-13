/**
 * Shared player widget integration for host pages.
 *
 * Provides a single function that host pages call to embed the player
 * widget into their existing tools menu.  Handles:
 *  - importing player styles
 *  - creating the widget instance (singleton per page)
 *  - injecting a "Player" button into the page's tools menu list
 *  - wiring toggle + menu close behavior
 *
 * Usage (from any page):
 *
 *   import { integratePlayerWidget } from "../player/integrate-player-widget.js";
 *   const player = integratePlayerWidget({ toolsMenuList, toolsMenu });
 *
 * Options:
 *   - toolsMenuList: the <ul>/<div> that holds tools-menu items
 *   - toolsMenu: the tools-menu controller (from initToolsMenu) — used to close the menu
 *   - mediaSession: whether the player runtime should manage Media Session (default true)
 *   - preload: "on-open" (default) or "immediate"
 *   - mount: element to mount the panel into (default document.body)
 */

import "../styles/player.less";
import { createPlayerWidget } from "./player-widget.js";
import { IconMusic } from "../icons.js";
import { t } from "../i18n.js";
import { setMediaSessionEnabled } from "../shared/audio-runtime.js";

/**
 * @param {object} opts
 * @param {HTMLElement} opts.toolsMenuList - Container for menu items
 * @param {{ close: Function }} opts.toolsMenu - Tools menu controller
 * @param {boolean} [opts.mediaSession=true] - Let player own Media Session
 * @param {"on-open"|"immediate"} [opts.preload="on-open"]
 * @param {HTMLElement} [opts.mount=document.body]
 * @returns {{ widget: { open, close, toggle, destroy, setTracks }, button: HTMLElement }}
 */
export function integratePlayerWidget({
  toolsMenuList,
  toolsMenu,
  mediaSession = true,
  preload = "on-open",
  mount = document.body,
} = {}) {
  // Opt out of Media Session if requested (e.g. speed page owns it)
  if (!mediaSession) {
    setMediaSessionEnabled(false);
  }

  const widget = createPlayerWidget({
    floating: false,
    preload,
    mount,
  });

  // Inject a menu item into the tools menu list
  let button = null;
  if (toolsMenuList) {
    const li = document.createElement("li");
    button = document.createElement("button");
    button.type = "button";
    button.className = "tools-menu-item";
    button.dataset.playerToggle = "true";

    const iconSpan = document.createElement("span");
    iconSpan.className = "btn-icon";
    iconSpan.innerHTML = IconMusic;

    const label = document.createElement("span");
    label.textContent = t("player") || "Player";

    button.append(iconSpan, label);
    li.append(button);
    toolsMenuList.append(li);

    button.addEventListener("click", () => {
      widget.toggle();
      if (toolsMenu && typeof toolsMenu.close === "function") {
        toolsMenu.close();
      }
    });
  }

  return { widget, button };
}
