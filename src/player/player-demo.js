import "../styles/player.less";
import { applyTranslations } from "../i18n.js";
import { createPlayerWidget, _getBootstrapPromise } from "./player-widget.js";

applyTranslations();

export const widget = createPlayerWidget({
  preload: "immediate",
});

document
  .getElementById("openPlayer")
  ?.addEventListener("click", () => widget.toggle());

/** Exposed for cold-boot integration tests. */
export const initPromise = _getBootstrapPromise();
