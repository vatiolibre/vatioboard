import accelTemplate from "./templates/accel-template.js";
import { createRouteView } from "./route-view.js";

const view = createRouteView({
  pageName: "accel",
  template: accelTemplate,
  meta: {
    title: "Vatio Accel - Free GPS Acceleration Timer for Tesla and Mobile",
    description:
      "Free browser-based GPS acceleration timer for 0-60, 60-130, 1/8 mile, 1/4 mile, and 0-100 km/h testing. Built for Tesla and modern mobile browsers with local result history and interactive graphs.",
    canonicalPath: "/accel",
    bodyClass: "accel-page",
    cleanupBodyClasses: ["accel-sheet-open", "accel-replay-chart-sheet-open"],
  },
  loadModule: () => import("../../accel/accel.js"),
  mountController: (module) => module.mountAccelRoute?.(),
  unmountController: (module) => module.unmountAccelRoute?.(),
});

export function mount(root, context) {
  return view.mount(root, context);
}
