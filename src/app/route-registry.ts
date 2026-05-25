import type { RouteConfig } from "../types/route";

export function defineRoute<const T extends RouteConfig>(route: T): T {
  return route;
}

export const routeRegistry = [
  defineRoute({
    path: "/",
    aliases: ["/speed"],
    title: "Vatio Speed",
    load: () => import("./views/SpeedView.js"),
  }),
  defineRoute({
    path: "/library",
    title: "Cloud Library",
    load: () => import("./views/LibraryView.js"),
  }),
  defineRoute({
    path: "/accel",
    title: "Vatio Accel",
    load: () => import("./views/AccelView.js"),
  }),
  defineRoute({
    path: "/replay",
    title: "Drive Replay",
    load: () => import("./views/ReplayView.js"),
  }),
  defineRoute({
    path: "/board",
    title: "Vatio Board",
    load: () => import("./views/BoardView.js"),
  }),
] satisfies readonly RouteConfig[];

export function getRouteConfig(path: string): RouteConfig | null {
  const registeredRoutes: readonly RouteConfig[] = routeRegistry;
  return registeredRoutes.find((route) => route.path === path || route.aliases?.includes(path)) || null;
}
