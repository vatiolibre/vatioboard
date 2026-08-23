import libraryTemplate from "../../app/views/templates/library-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const LIBRARY_APP_ID = "vatio.library";

interface LibraryRouteModule {
  mountLibraryRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountLibraryRoute?: (routeContext: RouteMountContext) => void;
}

export type LibraryRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  settingsService?: VatioAppRuntime["services"]["settings"] | null;
  authService?: VatioAppRuntime["services"]["auth"] | null;
  cloudSyncService?: VatioAppRuntime["services"]["cloudSync"] | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asLibraryRouteModule(module: unknown): LibraryRouteModule {
  return module as LibraryRouteModule;
}

function resolveLibraryRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === LIBRARY_APP_ID ? runtime : null;
}

export function createLibraryRouteMountContext(routeContext: RouteMountContext): LibraryRouteMountContext {
  const runtime = resolveLibraryRuntime(routeContext);
  const context = routeContext.context || {};

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    appStorage: runtime?.storage || null,
    settingsService: runtime?.services.settings || null,
    authService: runtime?.services.auth || null,
    cloudSyncService: runtime?.services.cloudSync || null,
    translate: runtime ? (key, fallback) => runtime.i18n.t(key, fallback) : null,
    logger: runtime?.logger || null,
  };
}

const view = createRouteView({
  pageName: "library",
  template: libraryTemplate,
  meta: {
    title: "VatioLibre Saved Library - Recover speed, acceleration, drawings, and media",
    description:
      "Browse your private VatioLibre library across devices with summary-first speed replays, acceleration runs, editable drawings, and media assets.",
    canonicalPath: "/library",
    bodyClass: "library-page",
  },
  loadModule: () => import("../../library/library.js"),
  mountController: (module, routeContext) => {
    const libraryRouteContext = createLibraryRouteMountContext(routeContext);
    libraryRouteContext.appRuntime?.logger.debug("Library route app mounted with scoped runtime services.");
    return asLibraryRouteModule(module).mountLibraryRoute?.(libraryRouteContext);
  },
  unmountController: (module, routeContext) =>
    asLibraryRouteModule(module).unmountLibraryRoute?.(createLibraryRouteMountContext(routeContext)),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
