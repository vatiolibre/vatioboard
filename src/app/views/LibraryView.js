import libraryHtml from "../../../library.html?raw";
import { createLegacyView } from "./legacy-view.js";

const view = createLegacyView({
  html: libraryHtml,
  pageName: "library",
  loadModule: () => import("../../library/library.js"),
});

export function mount(root, context) {
  return view.mount(root, context);
}
