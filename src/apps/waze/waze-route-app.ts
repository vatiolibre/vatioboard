import wazeTemplate from "./waze-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const WAZE_APP_ID = "vatio.waze";

interface WazeRouteModule {
  mountWazeRoute?: (routeContext: WazeRouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountWazeRoute?: (routeContext: WazeRouteMountContext) => void;
}

export type WazeRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  gpsService?: RouteContext["gpsService"] | null;
  drivingAlertService?: RouteContext["drivingAlertService"] | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asWazeRouteModule(module: unknown): WazeRouteModule {
  return module as WazeRouteModule;
}

function getWindowFallback<T>(key: string): T | null {
  const source = window as typeof window & Record<string, unknown>;
  return (source[key] as T | null | undefined) || null;
}

function resolveWazeRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === WAZE_APP_ID ? runtime : null;
}

export function createWazeRouteMountContext(routeContext: RouteMountContext): WazeRouteMountContext {
  const runtime = resolveWazeRuntime(routeContext);
  const context = routeContext.context || {};

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    gpsService:
      runtime?.services.gps ||
      context.gpsService ||
      getWindowFallback<RouteContext["gpsService"]>("__vatioboardGpsStore"),
    drivingAlertService:
      runtime?.services.drivingAlerts ||
      context.drivingAlertService ||
      getWindowFallback<RouteContext["drivingAlertService"]>("__vatioboardDrivingAlerts"),
    translate: runtime ? (key, fallback) => runtime.i18n.t(key, fallback) : null,
    logger: runtime?.logger || null,
  };
}

const view = createRouteView({
  pageName: "waze",
  template: wazeTemplate,
  meta: {
    title: "Waze Map - VatioLibre",
    description: "Full-screen Waze live map with shared GPS speed and driving alert status.",
    canonicalPath: "/waze",
    bodyClass: "waze-page",
  },
  loadModule: () => import("./waze-app.js"),
  mountController: (module, routeContext) => {
    const wazeContext = createWazeRouteMountContext(routeContext);
    wazeContext.appRuntime?.logger.debug("Waze route app mounted with shared driving services.");
    return asWazeRouteModule(module).mountWazeRoute?.(wazeContext);
  },
  unmountController: (module, routeContext) =>
    asWazeRouteModule(module).unmountWazeRoute?.(createWazeRouteMountContext(routeContext)),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
