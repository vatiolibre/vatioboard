import { appRegistry } from "../app-registry.js";
import type { RouteConfig, RouteModule } from "../../types/route";
import type { VatioAppManifest } from "../types";

function isRouteApp(app: VatioAppManifest) {
  return app.surfaces.includes("main-route") && Boolean(app.route);
}

function loadRouteModule(app: VatioAppManifest): Promise<RouteModule> {
  if (app.entry) return app.entry() as Promise<RouteModule>;
  return Promise.reject(new Error(`App ${app.id} does not declare a route entry.`));
}

export function getRouteRegistryFromApps(): RouteConfig[] {
  return appRegistry
    .listApps()
    .filter(isRouteApp)
    .map((app) => ({
      path: app.route || "/",
      aliases: app.aliases,
      title: app.title,
      meta: {
        appId: app.id,
        status: app.status,
        localFirst: app.localFirst,
        teslaOptimized: app.teslaOptimized,
        offlineCapable: app.offlineCapable,
      },
      load: () => loadRouteModule(app),
    }));
}

export function getRouteConfigFromApps(path: string): RouteConfig | null {
  const route = appRegistry.getAppByRoute(path);
  if (!route || !isRouteApp(route)) return null;
  return getRouteRegistryFromApps().find((config) =>
    config.path === route.route || config.aliases?.includes(path)
  ) || null;
}
