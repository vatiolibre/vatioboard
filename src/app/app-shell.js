import "../styles/app.less";
import "../styles/player.less";
import "../styles/activity-indicator.less";
import "../shared/ui/confirm-dialog.less";

import { createPlayerWidget } from "../player/player-widget.js";
import { initBackendAuthControllers } from "../shared/backend-auth.js";
import { startCloudSyncLoop } from "../shared/cloud-sync.js";
import { initActivityIndicator } from "../shared/activity-indicator.js";
import { initFloatingTools } from "../shared/floating-tools.js";
import { initSharedStartMenu } from "../shared/start-menu.js";
import { ensureSingleTabOwnership } from "../shared/single-tab.js";
import { createHashRouter, emitRouteVisible, navigateToAppRoute } from "./router.js";
import { routes } from "./routes.js";
import { createRuntimeContext } from "./runtime-context.js";

function installLinkInterceptor() {
  document.addEventListener("click", (event) => {
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || event.defaultPrevented) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const href = anchor.getAttribute("href");
    if (!href) return;
    if (!href.startsWith("/") && !href.startsWith("#/")) return;

    const handled = navigateToAppRoute(href);
    if (handled) event.preventDefault();
  });
}

function shouldPreloadRoutes() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData) return false;
  if (["slow-2g", "2g"].includes(connection?.effectiveType)) return false;
  if (navigator.deviceMemory && navigator.deviceMemory <= 2) return false;
  return true;
}

function scheduleRoutePreload({ router, routes: appRoutes }) {
  if (!shouldPreloadRoutes()) return;

  const preload = () => {
    for (const route of appRoutes) {
      if (route.path === router.getRoute()?.path) continue;
      route.load().catch(() => {});
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(preload, { timeout: 2500 });
  } else {
    window.setTimeout(preload, 500);
  }
}

export async function startAppShell({
  viewRoot = document.getElementById("app-view"),
  persistentLayer = document.getElementById("app-persistent-layer"),
} = {}) {
  if (!viewRoot || !persistentLayer) {
    throw new Error("VatioBoard app shell roots are missing.");
  }

  window.__vatioboardSpa = true;

  const context = createRuntimeContext();
  context.gpsService.installGlobalShim();

  initBackendAuthControllers();
  void ensureSingleTabOwnership();
  startCloudSyncLoop();

  const playerWidget = createPlayerWidget({
    mount: persistentLayer,
    floating: true,
    preload: "immediate",
    persistVisibility: true,
    restoreVisibility: true,
  });
  window.__vatioboardPlayerWidget = playerWidget;
  const floatingTools = initFloatingTools({ mount: persistentLayer });
  const startMenu = initSharedStartMenu({ floatingTools, mount: persistentLayer });
  const activityIndicator = initActivityIndicator({ mount: persistentLayer });

  installLinkInterceptor();

  let activeView = null;
  let activeRouteController = null;
  let routeVersion = 0;

  const router = createHashRouter({
    routes,
    async onRouteChange(route) {
      const version = routeVersion + 1;
      routeVersion = version;

      activeRouteController?.abort();
      const routeController = new AbortController();
      activeRouteController = routeController;

      if (activeView?.unmount) {
        activeView.unmount();
        activeView = null;
      }

      const loaded = await route.config.load();
      if (version !== routeVersion || routeController.signal.aborted) return;

      const view = await loaded.mount(viewRoot, {
        ...context,
        route,
        routeSignal: routeController.signal,
        navigate: navigateToAppRoute,
        emitRouteVisible: () => emitRouteVisible(route),
      });
      if (version !== routeVersion || routeController.signal.aborted) {
        view?.unmount?.();
        return;
      }

      activeView = view;
      emitRouteVisible(route);
    },
  });

  window.__vatioboardRouter = router;
  scheduleRoutePreload({ router, routes });

  return {
    router,
    floatingTools,
    playerWidget,
    startMenu,
    activityIndicator,
    context,
  };
}
