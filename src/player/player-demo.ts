import "../styles/player.less";
import "../shared/ui/confirm-dialog.less";
import { applyTranslations } from "../i18n.js";
import { createPlayerWidget, _getBootstrapPromise } from "./player-widget.js";

interface PlayerDemoWidget {
  open: () => void;
  close: () => void;
  toggle: () => void;
  restoreVisibility: () => void;
  destroy: () => void;
  setTracks: (tracks: unknown[]) => void;
}

const createDemoPlayerWidget = createPlayerWidget as unknown as (options: {
  preload?: "on-open" | "immediate";
}) => PlayerDemoWidget;

const getBootstrapPromise = _getBootstrapPromise as () => Promise<unknown>;

applyTranslations();

export const widget = createDemoPlayerWidget({
  preload: "immediate",
});

document
  .getElementById("openPlayer")
  ?.addEventListener("click", () => widget.toggle());

/** Exposed for cold-boot integration tests. */
export const initPromise = getBootstrapPromise();
