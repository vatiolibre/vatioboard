import qrScannerTemplate from "./qr-scanner-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const QR_SCANNER_APP_ID = "vatio.qrScanner";

interface QrScannerRouteModule {
  mountQrScannerRoute?: (routeContext: QrScannerRouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountQrScannerRoute?: (routeContext: QrScannerRouteMountContext) => void;
}

export type QrScannerRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  qrScannerService?: VatioAppRuntime["services"]["qrScanner"] | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asQrScannerRouteModule(module: unknown): QrScannerRouteModule {
  return module as QrScannerRouteModule;
}

function resolveQrScannerRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === QR_SCANNER_APP_ID ? runtime : null;
}

export function createQrScannerRouteMountContext(routeContext: RouteMountContext): QrScannerRouteMountContext {
  const runtime = resolveQrScannerRuntime(routeContext);
  const context = routeContext.context || {};

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    qrScannerService: runtime?.services.qrScanner || null,
    logger: runtime?.logger || null,
  };
}

const view = createRouteView({
  pageName: "qr-scanner",
  template: qrScannerTemplate,
  meta: {
    title: "QR Scanner - VatioBoard",
    description: "Minimal local QR scanner for camera and image-based QR reads.",
    canonicalPath: "/qr-scanner",
    bodyClass: "qr-scanner-page",
  },
  loadModule: () => import("./qr-scanner-app.js"),
  mountController: (module, routeContext) => {
    const qrRouteContext = createQrScannerRouteMountContext(routeContext);
    qrRouteContext.appRuntime?.logger.debug("QR scanner route app mounted with scoped runtime services.");
    return asQrScannerRouteModule(module).mountQrScannerRoute?.(qrRouteContext);
  },
  unmountController: (module, routeContext) =>
    asQrScannerRouteModule(module).unmountQrScannerRoute?.(createQrScannerRouteMountContext(routeContext)),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
