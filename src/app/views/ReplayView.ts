import replayTemplate from "./templates/replay-template.js";
import { createRouteView } from "./route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";

interface ReplayRouteModule {
  mountReplayRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountReplayRoute?: (routeContext: RouteMountContext) => void;
}

function asReplayRouteModule(module: unknown): ReplayRouteModule {
  return module as ReplayRouteModule;
}

const view = createRouteView({
  pageName: "replay",
  template: replayTemplate,
  meta: {
    title: "Vatio Drive Replay - Replay your latest GPS drive on a 3D globe",
    description:
      "Replay your latest Vatio Speed drive with a hardware-accelerated 3D globe, route timeline, live playback metrics, and session highlights.",
    canonicalPath: "/replay",
    bodyClass: "replay-page",
    cleanupBodyClasses: ["replay-graph-sheet-open"],
  },
  loadModule: () => import("../../replay/replay.js"),
  mountController: (module, routeContext) => asReplayRouteModule(module).mountReplayRoute?.(routeContext),
  unmountController: (module, routeContext) => asReplayRouteModule(module).unmountReplayRoute?.(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
