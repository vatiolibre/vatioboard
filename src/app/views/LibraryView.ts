import libraryTemplate from "./templates/library-template.js";
import { createRouteView } from "./route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";

interface LibraryRouteModule {
  mountLibraryRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountLibraryRoute?: (routeContext: RouteMountContext) => void;
}

function asLibraryRouteModule(module: unknown): LibraryRouteModule {
  return module as LibraryRouteModule;
}

const view = createRouteView({
  pageName: "library",
  template: libraryTemplate,
  meta: {
    title: "VatioBoard Cloud Library - Recover your saved speed, accel, board, and media data",
    description:
      "Browse your VatioBoard cloud library across devices with summary-first speed replays, accel runs, editable board documents, and private media assets.",
    canonicalPath: "/library",
    bodyClass: "library-page",
  },
  loadModule: () => import("../../library/library.js"),
  mountController: (module, routeContext) => asLibraryRouteModule(module).mountLibraryRoute?.(routeContext),
  unmountController: (module, routeContext) => asLibraryRouteModule(module).unmountLibraryRoute?.(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
