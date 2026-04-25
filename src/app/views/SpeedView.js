import speedHtml from "../../../speed.html?raw";
import { createLegacyView } from "./legacy-view.js";

const view = createLegacyView({
  html: speedHtml,
  pageName: "speed",
  loadModule: () => import("../../speed/speed.js"),
});

export function mount(root, context) {
  return view.mount(root, context);
}
