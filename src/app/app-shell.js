import "../styles/app.less";
import "../styles/player.less";
import "../shared/ui/confirm-dialog.less";

import { createPlayerWidget } from "../player/player-widget.js";
import { initBackendAuthControllers } from "../shared/backend-auth.js";
import { startCloudSyncLoop } from "../shared/cloud-sync.js";
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

  installLinkInterceptor();

  let activeView = null;
  let routeVersion = 0;

  const router = createHashRouter({
    routes,
    async onRouteChange(route) {
      const version = routeVersion + 1;
      routeVersion = version;

      if (activeView?.unmount) {
        activeView.unmount();
        activeView = null;
      }

      const loaded = await route.config.load();
      if (version !== routeVersion) return;

      const view = await loaded.mount(viewRoot, {
        ...context,
        route,
        navigate: navigateToAppRoute,
        emitRouteVisible: () => emitRouteVisible(route),
      });
      if (version !== routeVersion) {
        view?.unmount?.();
        return;
      }

      activeView = view;
      emitRouteVisible(route);
    },
  });

  window.__vatioboardRouter = router;

  setTimeout(() => {
    for (const route of routes) {
      if (route.path === router.getRoute()?.path) continue;
      route.load().catch(() => {});
    }
  }, 500);

  return {
    router,
    playerWidget,
    context,
  };
}
