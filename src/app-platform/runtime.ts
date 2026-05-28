import { appRegistry } from "./app-registry.js";
import { createAppI18n } from "./i18n.js";
import { createAppLifecycle } from "./lifecycle.js";
import { createAppLogger } from "./logger.js";
import { createAppPermissionRuntime } from "./permissions.js";
import { createAppServiceGateway } from "./services.js";
import { createAppStorage, createPermissionedAppStorage } from "./storage.js";
import type {
  CreateAppRuntimeOptions,
  VatioAppLaunchOptions,
  VatioAppRuntime,
  VatioRunningApp,
} from "./types";

function routeHref(route: string) {
  return route.startsWith("#/") ? route : `#${route.startsWith("/") ? route : `/${route}`}`;
}

export function createAppRuntime({
  manifest,
  shellManager = null,
  baseContext = null,
  navigate,
  route = null,
  routeSignal = null,
  launcher = null,
}: CreateAppRuntimeOptions): VatioAppRuntime {
  const logger = createAppLogger(manifest.id);
  const permissions = createAppPermissionRuntime(manifest, logger);
  const rawStorage = createAppStorage({ appId: manifest.id, logger });
  const storage = createPermissionedAppStorage({ appId: manifest.id, storage: rawStorage, permissions });
  const i18n = createAppI18n({ permissions, logger });
  const lifecycle = createAppLifecycle();
  const services = createAppServiceGateway({ baseContext, appStorage: rawStorage, permissions, logger });

  function getInstalledApps() {
    return launcher?.getInstalledApps?.() || appRegistry.listApps();
  }

  function getRunningApps(): VatioRunningApp[] {
    if (launcher?.getRunningApps) return launcher.getRunningApps();
    return (shellManager?.listWindows?.() || []).map((record) => ({
      appId: appRegistry.listApps().find((app) => app.window?.shellWindowId === record.id)?.id || record.id,
      title: record.title || record.id,
      surface: "shell-window",
      state: record.state,
    }));
  }

  function getAppRuntime(appId: string) {
    return launcher?.getAppRuntime?.(appId) || null;
  }

  function openApp(appId: string, options: VatioAppLaunchOptions = {}) {
    if (!permissions.require("shell.launchApp")) return false;
    if (launcher?.openApp) return launcher.openApp(appId, { ...options, sourceAppId: manifest.id });

    const target = appRegistry.getApp(appId);
    if (!target) {
      logger.warn(`Cannot open unknown app "${appId}".`);
      return false;
    }
    if (target.route && navigate) return navigate(routeHref(target.route), options);
    if (target.window?.shellWindowId && shellManager) {
      return Boolean(shellManager.openWindow(target.window.shellWindowId, options));
    }
    logger.warn(`App "${appId}" has no launchable v1 surface.`);
    return false;
  }

  function closeApp(appId: string, options: VatioAppLaunchOptions = {}) {
    if (!permissions.require("shell.launchApp")) return false;
    if (launcher?.closeApp) return launcher.closeApp(appId, { ...options, sourceAppId: manifest.id });

    const target = appRegistry.getApp(appId);
    if (target?.window?.shellWindowId && shellManager) {
      return Boolean(shellManager.closeWindow(target.window.shellWindowId, options));
    }
    return false;
  }

  function focusApp(appId: string, options: VatioAppLaunchOptions = {}) {
    if (!permissions.require("shell.launchApp")) return false;
    if (launcher?.focusApp) return launcher.focusApp(appId, { ...options, sourceAppId: manifest.id });

    const target = appRegistry.getApp(appId);
    if (target?.route && navigate) return navigate(routeHref(target.route), options);
    if (target?.window?.shellWindowId && shellManager) {
      return Boolean(shellManager.activateWindow(target.window.shellWindowId, options));
    }
    return false;
  }

  return {
    appId: manifest.id,
    manifest,
    permissions,
    services,
    shell: {
      openApp,
      closeApp,
      focusApp,
      getAppRuntime,
      listApps: getInstalledApps,
      getInstalledApps,
      getRunningApps,
      shellManager,
    },
    storage,
    i18n,
    lifecycle,
    logger,
    route,
    routeSignal,
  };
}
