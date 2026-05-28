import { appRegistry } from "./app-registry.js";
import type { AppRoute } from "../types/route";
import type { ShellRuntime } from "../types/shell";
import type {
  VatioAppId,
  VatioAppLaunchOptions,
  VatioAppManifest,
  VatioAppShellRuntime,
  VatioRunningApp,
} from "./types";

function routeHref(route: string) {
  return route.startsWith("#/") ? route : `#${route.startsWith("/") ? route : `/${route}`}`;
}

export interface CreateAppLauncherOptions {
  shellManager?: ShellRuntime | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  getCurrentRoute?: () => AppRoute | null;
}

export function createAppLauncher({
  shellManager = null,
  navigate,
  getCurrentRoute,
}: CreateAppLauncherOptions = {}): VatioAppShellRuntime {
  function getInstalledApps(): VatioAppManifest[] {
    return appRegistry.listApps();
  }

  function openApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = appRegistry.getApp(appId);
    if (!manifest) {
      console.warn(`[vatioboard:launcher] Unknown app "${appId}".`);
      return false;
    }

    if (manifest.route && navigate) return navigate(routeHref(manifest.route), options);
    if (manifest.window?.shellWindowId && shellManager) {
      return Boolean(shellManager.openWindow(manifest.window.shellWindowId, options));
    }

    if (manifest.kind === "background-service") {
      console.warn(`[vatioboard:launcher] Background app "${appId}" is registered but has no v1 launcher.`);
      return false;
    }

    console.warn(`[vatioboard:launcher] App "${appId}" has no launchable v1 surface.`);
    return false;
  }

  function closeApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = appRegistry.getApp(appId);
    if (!manifest) return false;
    if (manifest.window?.shellWindowId && shellManager) {
      return Boolean(shellManager.closeWindow(manifest.window.shellWindowId, options));
    }
    return false;
  }

  function focusApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = appRegistry.getApp(appId);
    if (!manifest) return false;
    if (manifest.route && navigate) return navigate(routeHref(manifest.route), options);
    if (manifest.window?.shellWindowId && shellManager) {
      const record = shellManager.getWindow(manifest.window.shellWindowId);
      if (record?.state === "minimized") {
        return Boolean(shellManager.restoreWindow(manifest.window.shellWindowId, options));
      }
      if (record?.state === "closed" || record?.element?.hidden) {
        return Boolean(shellManager.openWindow(manifest.window.shellWindowId, options));
      }
      return Boolean(shellManager.activateWindow(manifest.window.shellWindowId, options));
    }
    return false;
  }

  function getRunningApps(): VatioRunningApp[] {
    const running: VatioRunningApp[] = [];
    const currentRoute = getCurrentRoute?.();
    const currentApp = currentRoute?.path ? appRegistry.getAppByRoute(currentRoute.path) : null;
    if (currentApp) {
      running.push({
        appId: currentApp.id,
        title: currentApp.title,
        surface: "route",
        state: "active",
      });
    }

    for (const record of shellManager?.listWindows?.() || []) {
      if (record.state === "closed" || record.state === "hidden") continue;
      const manifest = appRegistry.listApps().find((app) => app.window?.shellWindowId === record.id);
      running.push({
        appId: manifest?.id || record.id,
        title: manifest?.title || record.title || record.id,
        surface: "shell-window",
        state: record.state,
      });
    }
    return running;
  }

  return {
    openApp,
    closeApp,
    focusApp,
    listApps: getInstalledApps,
    getInstalledApps,
    getRunningApps,
    shellManager,
  };
}

export const launchApp = (appId: VatioAppId, options?: VatioAppLaunchOptions) =>
  createAppLauncher().openApp(appId, options);
export const openApp = launchApp;
export const closeApp = (appId: VatioAppId, options?: VatioAppLaunchOptions) =>
  createAppLauncher().closeApp(appId, options);
export const focusApp = (appId: VatioAppId, options?: VatioAppLaunchOptions) =>
  createAppLauncher().focusApp(appId, options);
export const getInstalledApps = () => appRegistry.listApps();
export const getRunningApps = () => createAppLauncher().getRunningApps();
