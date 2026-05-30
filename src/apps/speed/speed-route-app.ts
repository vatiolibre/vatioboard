import speedTemplate from "../../app/views/templates/speed-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const SPEED_APP_ID = "vatio.speed";

interface SpeedRouteModule {
  mountSpeedRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountSpeedRoute?: (routeContext: RouteMountContext) => void;
}

export type SpeedRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  gpsService?: RouteContext["gpsService"] | null;
  driveRecordingService?: RouteContext["driveRecordingService"] | null;
  drivingAlertService?: RouteContext["drivingAlertService"] | null;
  settingsService?: VatioAppRuntime["services"]["settings"] | null;
  cloudSyncService?: VatioAppRuntime["services"]["cloudSync"] | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asSpeedRouteModule(module: unknown): SpeedRouteModule {
  return module as SpeedRouteModule;
}

function getWindowFallback<T>(key: string): T | null {
  const source = window as typeof window & Record<string, unknown>;
  return (source[key] as T | null | undefined) || null;
}

function resolveSpeedRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === SPEED_APP_ID ? runtime : null;
}

export function createSpeedRouteMountContext(routeContext: RouteMountContext): SpeedRouteMountContext {
  const runtime = resolveSpeedRuntime(routeContext);
  const context = routeContext.context || {};
  const gpsService =
    runtime?.services.gps ||
    context.gpsService ||
    getWindowFallback<RouteContext["gpsService"]>("__vatioboardGpsStore");
  const driveRecordingService =
    runtime?.services.driveRecording ||
    context.driveRecordingService ||
    getWindowFallback<RouteContext["driveRecordingService"]>("__vatioboardDriveRecording");
  const drivingAlertService =
    runtime?.services.drivingAlerts ||
    context.drivingAlertService ||
    getWindowFallback<RouteContext["drivingAlertService"]>("__vatioboardDrivingAlerts");

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    appStorage: runtime?.storage || null,
    gpsService,
    driveRecordingService,
    drivingAlertService,
    settingsService: runtime?.services.settings || null,
    cloudSyncService: runtime?.services.cloudSync || null,
    translate: runtime ? (key, fallback) => runtime.i18n.t(key, fallback) : null,
    logger: runtime?.logger || null,
  };
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
  mountController: (module, routeContext) => {
    const speedRouteContext = createSpeedRouteMountContext(routeContext);
    speedRouteContext.appRuntime?.logger.debug("Speed route app mounted with scoped runtime services.");
    return asSpeedRouteModule(module).mountSpeedRoute?.(speedRouteContext);
  },
  unmountController: (module, routeContext) =>
    asSpeedRouteModule(module).unmountSpeedRoute?.(createSpeedRouteMountContext(routeContext)),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
