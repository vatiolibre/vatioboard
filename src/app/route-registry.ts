import type { RouteConfig } from "../types/route";
import { getRouteRegistryFromApps } from "../app-platform/adapters/route-registry-adapter.js";

export function defineRoute<const T extends RouteConfig>(route: T): T {
  return route;
}

export const routeRegistry = getRouteRegistryFromApps().map(defineRoute) satisfies readonly RouteConfig[];

export function getRouteConfig(path: string): RouteConfig | null {
  const registeredRoutes: readonly RouteConfig[] = routeRegistry;
  return registeredRoutes.find((route) => route.path === path || route.aliases?.includes(path)) || null;
}
