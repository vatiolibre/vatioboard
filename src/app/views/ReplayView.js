import replayHtml from "../../../replay.html?raw";
import { createLegacyView } from "./legacy-view.js";

const view = createLegacyView({
  html: replayHtml,
  pageName: "replay",
  loadModule: () => import("../../replay/replay.js"),
});

export function mount(root, context) {
  return view.mount(root, context);
}
