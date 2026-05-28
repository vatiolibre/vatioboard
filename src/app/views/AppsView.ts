import appsTemplate from "./templates/apps-template.js";
import { createRouteView } from "./route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";

interface AppsRouteModule {
  mountAppsRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountAppsRoute?: (routeContext: RouteMountContext) => void;
}

function asAppsRouteModule(module: unknown): AppsRouteModule {
  return module as AppsRouteModule;
}

const view = createRouteView({
  pageName: "apps",
  template: appsTemplate,
  meta: {
    title: "VatioBoard OS Apps",
    description: "Internal VatioBoard OS app manager and diagnostics.",
    canonicalPath: "/apps",
    bodyClass: "apps-page",
  },
  loadModule: () => import("../../apps/app-manager/app-manager.js"),
  mountController: (module, routeContext) => asAppsRouteModule(module).mountAppsRoute?.(routeContext),
  unmountController: (module, routeContext) => asAppsRouteModule(module).unmountAppsRoute?.(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
