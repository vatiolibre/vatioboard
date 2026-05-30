import accelTemplate from "../../app/views/templates/accel-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const ACCEL_APP_ID = "vatio.accel";

interface AccelRouteModule {
  mountAccelRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountAccelRoute?: (routeContext: RouteMountContext) => void;
}

export type AccelRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  gpsService?: RouteContext["gpsService"] | null;
  settingsService?: VatioAppRuntime["services"]["settings"] | null;
  authService?: VatioAppRuntime["services"]["auth"] | null;
  cloudSyncService?: VatioAppRuntime["services"]["cloudSync"] | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asAccelRouteModule(module: unknown): AccelRouteModule {
  return module as AccelRouteModule;
}

function getWindowFallback<T>(key: string): T | null {
  const source = window as typeof window & Record<string, unknown>;
  return (source[key] as T | null | undefined) || null;
}

function resolveAccelRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === ACCEL_APP_ID ? runtime : null;
}

export function createAccelRouteMountContext(routeContext: RouteMountContext): AccelRouteMountContext {
  const runtime = resolveAccelRuntime(routeContext);
  const context = routeContext.context || {};
  const gpsService =
    runtime?.services.gps ||
    context.gpsService ||
    getWindowFallback<RouteContext["gpsService"]>("__vatioboardGpsStore");

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    appStorage: runtime?.storage || null,
    gpsService,
    settingsService: runtime?.services.settings || null,
    authService: runtime?.services.auth || null,
    cloudSyncService: runtime?.services.cloudSync || null,
    translate: runtime ? (key, fallback) => runtime.i18n.t(key, fallback) : null,
    logger: runtime?.logger || null,
  };
}

const view = createRouteView({
  pageName: "accel",
  template: accelTemplate,
  meta: {
    title: "Vatio Accel - Free GPS Acceleration Timer for Tesla and Mobile",
    description:
      "Free browser-based GPS acceleration timer for 0-60, 60-130, 1/8 mile, 1/4 mile, and 0-100 km/h testing. Built for Tesla and modern mobile browsers with local result history and interactive graphs.",
    canonicalPath: "/accel",
    bodyClass: "accel-page",
    cleanupBodyClasses: ["accel-sheet-open", "accel-replay-chart-sheet-open"],
  },
  loadModule: () => import("../../accel/accel.js"),
  mountController: (module, routeContext) => {
    const accelRouteContext = createAccelRouteMountContext(routeContext);
    accelRouteContext.appRuntime?.logger.debug("Accel route app mounted with scoped runtime services.");
    return asAccelRouteModule(module).mountAccelRoute?.(accelRouteContext);
  },
  unmountController: (module, routeContext) =>
    asAccelRouteModule(module).unmountAccelRoute?.(createAccelRouteMountContext(routeContext)),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
