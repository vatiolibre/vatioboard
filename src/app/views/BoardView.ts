import boardTemplate from "./templates/board-template.js";
import { createRouteView } from "./route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";

interface BoardRouteModule {
  mountBoardRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountBoardRoute?: (routeContext: RouteMountContext) => void;
}

function asBoardRouteModule(module: unknown): BoardRouteModule {
  return module as BoardRouteModule;
}

const view = createRouteView({
  pageName: "board",
  template: boardTemplate,
  meta: {
    title: "Vatio Board - Free Drawing Board + Calculator",
    description:
      "Vatio Board is a fast, full-screen drawing board that works great in Tesla browsers. Draw with pen or eraser, adjust brush size, and save private drawings to VatioLibre.",
    canonicalPath: "/board",
    bodyClass: "board-page",
  },
  loadModule: () => import("../../board/board.js"),
  mountController: (module, routeContext) => asBoardRouteModule(module).mountBoardRoute?.(routeContext),
  unmountController: (module, routeContext) => asBoardRouteModule(module).unmountBoardRoute?.(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
