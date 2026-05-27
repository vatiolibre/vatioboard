import speedTemplate from "./templates/speed-template.js";
import { createRouteView } from "./route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";

interface SpeedRouteModule {
  mountSpeedRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountSpeedRoute?: (routeContext: RouteMountContext) => void;
}

function asSpeedRouteModule(module: unknown): SpeedRouteModule {
  return module as SpeedRouteModule;
}

const view = createRouteView({
  pageName: "speed",
  template: speedTemplate,
  meta: {
    title: "Vatio Speed - Free Live GPS Speedometer for Tesla and Mobile",
    description:
      "Vatio Speed is a free live GPS speedometer with an analog dial, trip stats, unit switching, altitude tracking, and speed trap alerts. Works in Tesla browsers and modern mobile browsers.",
    canonicalPath: "/",
    bodyClass: "speed-page",
  },
  loadModule: () => import("../../speed/speed.js"),
  mountController: (module, routeContext) => asSpeedRouteModule(module).mountSpeedRoute?.(routeContext),
  unmountController: (module, routeContext) => asSpeedRouteModule(module).unmountSpeedRoute?.(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
