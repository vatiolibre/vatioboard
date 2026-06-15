import deliveryChecklistTemplate from "./delivery-checklist-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const DELIVERY_CHECKLIST_APP_ID = "vatio.deliveryChecklist";

interface DeliveryChecklistRouteModule {
  mountDeliveryChecklistRoute?: (routeContext: DeliveryChecklistRouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountDeliveryChecklistRoute?: (routeContext: DeliveryChecklistRouteMountContext) => void;
}

export type DeliveryChecklistRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  settingsService?: VatioAppRuntime["services"]["settings"] | null;
  authService?: VatioAppRuntime["services"]["auth"] | null;
  qrScannerService?: VatioAppRuntime["services"]["qrScanner"] | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asDeliveryChecklistRouteModule(module: unknown): DeliveryChecklistRouteModule {
  return module as DeliveryChecklistRouteModule;
}

function resolveDeliveryChecklistRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === DELIVERY_CHECKLIST_APP_ID ? runtime : null;
}

export function createDeliveryChecklistRouteMountContext(routeContext: RouteMountContext): DeliveryChecklistRouteMountContext {
  const runtime = resolveDeliveryChecklistRuntime(routeContext);
  const context = routeContext.context || {};

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    appStorage: runtime?.storage || null,
    settingsService: runtime?.services.settings || null,
    authService: runtime?.services.auth || null,
    qrScannerService: runtime?.services.qrScanner || null,
    translate: runtime ? (key, fallback) => runtime.i18n.t(key, fallback) : null,
    logger: runtime?.logger || null,
  };
}

const view = createRouteView({
  pageName: "delivery-checklist",
  template: deliveryChecklistTemplate,
  meta: {
    title: "Tesla Delivery Checklist - VatioBoard",
    description:
      "Local-first Tesla delivery checklist for Model 3, Model Y, and Cybertruck with optional read-only VatioLibre vehicle import.",
    canonicalPath: "/delivery-checklist",
    bodyClass: "delivery-checklist-page",
  },
  loadModule: () => import("./delivery-checklist-app.js"),
  mountController: (module, routeContext) => {
    const deliveryRouteContext = createDeliveryChecklistRouteMountContext(routeContext);
    deliveryRouteContext.appRuntime?.logger.debug("Delivery checklist route app mounted with scoped runtime services.");
    return asDeliveryChecklistRouteModule(module).mountDeliveryChecklistRoute?.(deliveryRouteContext);
  },
  unmountController: (module, routeContext) =>
    asDeliveryChecklistRouteModule(module).unmountDeliveryChecklistRoute?.(
      createDeliveryChecklistRouteMountContext(routeContext),
    ),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
