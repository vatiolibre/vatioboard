import speedTemplate from "./templates/speed-template.js";
import { createRouteView } from "./route-view.js";

const view = createRouteView({
  pageName: "speed",
  template: speedTemplate,
  meta: {
    title: "Vatio Speed - Free Live GPS Speedometer for Tesla and Mobile",
    description:
      "Vatio Speed is a free live GPS speedometer with an analog dial, trip stats, unit switching, altitude tracking, and speed trap alerts. Works in Tesla browsers and modern mobile browsers.",
    canonicalPath: "/",
    bodyClass: "speed-page",
    cleanupBodyClasses: ["alert-panel-open"],
  },
  loadModule: () => import("../../speed/speed.js"),
  mountController: (module) => module.mountSpeedRoute?.(),
  unmountController: (module) => module.unmountSpeedRoute?.(),
});

export function mount(root, context) {
  return view.mount(root, context);
}
