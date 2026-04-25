import accelHtml from "../../../accel.html?raw";
import { createLegacyView } from "./legacy-view.js";

const view = createLegacyView({
  html: accelHtml,
  pageName: "accel",
  loadModule: () => import("../../accel/accel.js"),
});

export function mount(root, context) {
  return view.mount(root, context);
}
