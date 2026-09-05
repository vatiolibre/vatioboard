import mapTemplate from "./map-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const MAP_APP_ID = "vatio.map";

interface MapRouteModule {
  mountMapRoute?: (context: MapRouteMountContext) => MountedView | void;
  unmountMapRoute?: () => void;
}

export type MapRouteMountContext = RouteMountContext & {
  appRuntime: VatioAppRuntime | null;
  gpsService: RouteContext["gpsService"] | null;
  driveRecordingService: RouteContext["driveRecordingService"] | null;
  drivingAlertService: RouteContext["drivingAlertService"] | null;
  translate: (key: string, fallback?: string) => string;
};

function getWindowFallback<T>(key: string): T | null {
  return ((window as typeof window & Record<string, unknown>)[key] as T | null | undefined) || null;
}

export function createMapRouteMountContext(routeContext: RouteMountContext): MapRouteMountContext {
  const runtime = routeContext.context.appRuntime?.appId === MAP_APP_ID
    ? routeContext.context.appRuntime
    : null;
  return {
    ...routeContext,
    appRuntime: runtime,
    gpsService: runtime?.services.gps || routeContext.context.gpsService || getWindowFallback("__vatioboardGpsStore"),
    driveRecordingService: runtime?.services.driveRecording || routeContext.context.driveRecordingService || getWindowFallback("__vatioboardDriveRecording"),
    drivingAlertService: runtime?.services.drivingAlerts || routeContext.context.drivingAlertService || getWindowFallback("__vatioboardDrivingAlerts"),
    translate: runtime
      ? (key, fallback) => runtime.i18n.t(key, fallback)
      : (key, fallback) => fallback || key,
  };
}

const view = createRouteView({
  pageName: "map",
  template: mapTemplate,
  meta: {
    title: "Map - VatioLibre",
    description: "Live MapLibre driving map with local speed-camera information.",
    canonicalPath: "/map",
    bodyClass: "map-page",
  },
  loadModule: () => import("./map-app.js"),
  mountController: (module, routeContext) =>
    (module as MapRouteModule).mountMapRoute?.(createMapRouteMountContext(routeContext)),
  unmountController: (module) => (module as MapRouteModule).unmountMapRoute?.(),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
