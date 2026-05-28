import "../styles/app.less";
import "../styles/player.less";
import "../styles/activity-indicator.less";
import "../shared/ui/confirm-dialog.less";
import "../styles/welcome-consent.less";

import { createPlayerWidget } from "../player/player-widget.js";
import { initBackendAuthControllers } from "../shared/backend-auth.js";
import { startCloudSyncLoop } from "../shared/cloud-sync.js";
import { initActivityIndicator } from "../shared/activity-indicator.js";
import { initFloatingTools } from "../shared/floating-tools.js";
import { initSharedStartMenu } from "../shared/start-menu.js";
import { ensureSingleTabOwnership } from "../shared/single-tab.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import { createShellTaskbar } from "../shared/shell-taskbar.js";
import { installShellKeyboardShortcuts } from "../shared/shell-keyboard.js";
import {
  appRegistry,
  createAppLauncher,
  createAppRuntime,
  createShellAppRuntimeManager,
} from "../app-platform/index.js";
import { createHashRouter, emitRouteVisible, navigateToAppRoute } from "./router.js";
import { routes } from "./routes.js";
import { createRuntimeContext } from "./runtime-context.js";
import { showWelcomeConsentIfNeeded } from "./welcome-consent.js";
import type { AppRoute, MountedView } from "../types/route";
import type { ShellRuntime } from "../types/shell";

interface AppShellStartOptions {
  viewRoot?: HTMLElement | null;
  persistentLayer?: HTMLElement | null;
}

interface HashRouterRuntime {
  getRoute(): AppRoute | null;
  destroy(): void;
}

const createShellPlayerWidget = createPlayerWidget as (options: Record<string, unknown>) => unknown;
const installShellKeyboard = installShellKeyboardShortcuts as (options: {
  shellManager: ShellRuntime;
}) => { uninstall(): void };

function installLinkInterceptor() {
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
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
}: AppShellStartOptions = {}) {
  if (!viewRoot || !persistentLayer) {
    throw new Error("VatioBoard app shell roots are missing.");
  }

  window.__vatioboardSpa = true;

  const context = createRuntimeContext();
  context.gpsService.installGlobalShim();
  window.__vatioboardGpsStore = context.gpsService;
  window.__vatioboardGpsGetCurrentPosition = () => context.gpsService.getCurrentPosition?.() || null;
  window.__vatioboardDriveRecording = context.driveRecordingService;
  window.__vatioboardDrivingAlerts = context.drivingAlertService;
  // Deprecated compatibility alias for older Camera Map/Speed integrations.
  window.__vatioboardSpeedGetCurrentPosition = window.__vatioboardGpsGetCurrentPosition;

  initBackendAuthControllers();
  void ensureSingleTabOwnership();
  startCloudSyncLoop();

  const shellManager = getDefaultShellWindowManager({ root: persistentLayer }) as ShellRuntime;
  context.shellManager = shellManager;
  let router: HashRouterRuntime | null = null;
  const shellAppRuntimeManager = createShellAppRuntimeManager({
    shellManager,
    baseContext: context as unknown as Record<string, unknown>,
    navigate: navigateToAppRoute,
  });
  context.shellAppRuntimeManager = shellAppRuntimeManager;
  const appLauncher = createAppLauncher({
    shellManager,
    navigate: navigateToAppRoute,
    getCurrentRoute: () => router?.getRoute?.() || null,
    shellAppRuntimeManager,
  });
  shellAppRuntimeManager.setLauncher(appLauncher);
  const playerWidget = createShellPlayerWidget({
    mount: persistentLayer,
    floating: false,
    preload: "immediate",
    persistVisibility: true,
    restoreVisibility: true,
    shellManager,
  });
  window.__vatioboardPlayerWidget = playerWidget;

  await showWelcomeConsentIfNeeded({ gpsService: context.gpsService });

  const floatingTools = initFloatingTools({
    mount: persistentLayer,
    shellManager,
    gpsService: context.gpsService,
    drivingAlertService: context.drivingAlertService,
  });
  const startMenu = initSharedStartMenu({ floatingTools, mount: persistentLayer });
  const activityIndicator = initActivityIndicator({ mount: persistentLayer });
  const shellTaskbar = createShellTaskbar({ shellManager, root: persistentLayer });
  const shellKeyboard = installShellKeyboard({ shellManager });
  floatingTools.taskbar = shellTaskbar;
  shellManager.restoreShellLayout();

  installLinkInterceptor();

  let activeView: MountedView | null = null;
  let activeRouteController: AbortController | null = null;
  let routeVersion = 0;

  router = createHashRouter({
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

      const appManifest = appRegistry.getAppByRoute(route.requestedPath || route.path);
      const appRuntime = appManifest
        ? createAppRuntime({
            manifest: appManifest,
            shellManager,
            baseContext: context as unknown as Record<string, unknown>,
            navigate: navigateToAppRoute,
            route,
            routeSignal: routeController.signal,
            launcher: appLauncher,
          })
        : null;
      appRuntime?.lifecycle.mount();
      appRuntime?.lifecycle.activate();

      let view: MountedView | null = null;
      try {
        view = await loaded.mount(viewRoot, {
          ...context,
          route,
          routeSignal: routeController.signal,
          navigate: navigateToAppRoute,
          emitRouteVisible: () => emitRouteVisible(route),
          appManifest,
          appRuntime,
        });
      } catch (error) {
        appRuntime?.lifecycle.deactivate();
        appRuntime?.lifecycle.unmount();
        throw error;
      }
      if (version !== routeVersion || routeController.signal.aborted) {
        view?.unmount?.();
        appRuntime?.lifecycle.deactivate();
        appRuntime?.lifecycle.unmount();
        return;
      }

      activeView = {
        unmount() {
          view?.unmount?.();
          appRuntime?.lifecycle.deactivate();
          appRuntime?.lifecycle.unmount();
        },
      };
      emitRouteVisible(route);
    },
  }) as HashRouterRuntime;

  window.__vatioboardRouter = router;
  const originalRouterDestroy = router.destroy;
  router.destroy = () => {
    shellKeyboard.uninstall();
    shellTaskbar.destroy();
    shellAppRuntimeManager.destroy();
    context.drivingAlertService?.destroy?.();
    context.driveRecordingService?.destroy?.();
    context.gpsService.destroy?.();
    const gpsProvider = window.__vatioboardGpsGetCurrentPosition;
    if (window.__vatioboardGpsStore === context.gpsService) delete window.__vatioboardGpsStore;
    if (window.__vatioboardSpeedGetCurrentPosition === gpsProvider) {
      delete window.__vatioboardSpeedGetCurrentPosition;
    }
    if (window.__vatioboardGpsGetCurrentPosition === gpsProvider) delete window.__vatioboardGpsGetCurrentPosition;
    if (window.__vatioboardDriveRecording === context.driveRecordingService) {
      delete window.__vatioboardDriveRecording;
    }
    if (window.__vatioboardDrivingAlerts === context.drivingAlertService) {
      delete window.__vatioboardDrivingAlerts;
    }
    originalRouterDestroy.call(router);
  };
  scheduleRoutePreload({ router, routes });

  return {
    router,
    floatingTools,
    playerWidget,
    shellManager,
    shellTaskbar,
    shellKeyboard,
    startMenu,
    activityIndicator,
    context,
  };
}
