import boardTemplate from "../../app/views/templates/board-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const BOARD_APP_ID = "vatio.board";

interface BoardRouteModule {
  mountBoardRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountBoardRoute?: (routeContext: RouteMountContext) => void;
}

export type BoardRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  settingsService?: VatioAppRuntime["services"]["settings"] | null;
  authService?: VatioAppRuntime["services"]["auth"] | null;
  cloudSyncService?: VatioAppRuntime["services"]["cloudSync"] | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asBoardRouteModule(module: unknown): BoardRouteModule {
  return module as BoardRouteModule;
}

function resolveBoardRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === BOARD_APP_ID ? runtime : null;
}

export function createBoardRouteMountContext(routeContext: RouteMountContext): BoardRouteMountContext {
  const runtime = resolveBoardRuntime(routeContext);
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
  pageName: "board",
  template: boardTemplate,
  meta: {
    title: "VatioLibre Drawing Board + Calculator",
    description:
      "VatioLibre Drawing Board is a fast, full-screen tool for Tesla browsers. Draw with pen or eraser, adjust brush size, and optionally synchronize private drawings to your account.",
    canonicalPath: "/board",
    bodyClass: "board-page",
  },
  loadModule: () => import("../../board/board.js"),
  mountController: (module, routeContext) => {
    const boardRouteContext = createBoardRouteMountContext(routeContext);
    boardRouteContext.appRuntime?.logger.debug("Board route app mounted with scoped runtime services.");
    return asBoardRouteModule(module).mountBoardRoute?.(boardRouteContext);
  },
  unmountController: (module, routeContext) =>
    asBoardRouteModule(module).unmountBoardRoute?.(createBoardRouteMountContext(routeContext)),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
