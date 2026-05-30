import { appRegistry } from "./app-registry.js";
import type { AppRoute } from "../types/route";
import type { ShellRuntime } from "../types/shell";
import type {
  ShellAppRuntimeManager,
  VatioAppId,
  VatioAppLaunchOptions,
  VatioAppManifest,
  VatioAppRuntime,
  VatioAppShellRuntime,
  VatioRunningApp,
  VatioShellWindowAppModule,
} from "./types";

function routeHref(route: string) {
  return route.startsWith("#/") ? route : `#${route.startsWith("/") ? route : `/${route}`}`;
}

const shellWindowEntryLoads = new WeakMap<ShellRuntime, Map<VatioAppId, Promise<boolean>>>();

function getShellWindowEntryLoads(shellManager: ShellRuntime) {
  let loads = shellWindowEntryLoads.get(shellManager);
  if (!loads) {
    loads = new Map();
    shellWindowEntryLoads.set(shellManager, loads);
  }
  return loads;
}

function getShellMount(shellManager: ShellRuntime): HTMLElement {
  const root = shellManager.root;
  if (root instanceof HTMLElement) return root;
  if (root instanceof Document) return root.body;
  if (root instanceof Element) return root as HTMLElement;
  return document.body;
}

function getShellWindowAppFactory(entryModule: unknown) {
  const module = entryModule as Partial<VatioShellWindowAppModule> | null;
  return typeof module?.createShellWindowApp === "function" ? module.createShellWindowApp : null;
}

export interface CreateAppLauncherOptions {
  shellManager?: ShellRuntime | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  getCurrentRoute?: () => AppRoute | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
}

export function createAppLauncher({
  shellManager = null,
  navigate,
  getCurrentRoute,
  shellAppRuntimeManager = null,
}: CreateAppLauncherOptions = {}): VatioAppShellRuntime {
  function getInstalledApps(): VatioAppManifest[] {
    return appRegistry.listApps();
  }

  async function loadShellWindowEntry(manifest: VatioAppManifest, runtime: VatioAppRuntime | null) {
    if (!shellManager || !manifest.window?.shellWindowId) return false;
    const shellWindowId = manifest.window.shellWindowId;
    if (shellManager.getWindow(shellWindowId)) return true;
    if (!manifest.entry) {
      console.warn(`[vatioboard:launcher] Shell-window app "${manifest.id}" is not registered and has no lazy entry.`);
      return false;
    }

    const loads = getShellWindowEntryLoads(shellManager);
    const existingLoad = loads.get(manifest.id);
    if (existingLoad) return existingLoad;

    const load = (async () => {
      try {
        const entryModule = await manifest.entry?.();
        if (shellManager.getWindow(shellWindowId)) return true;

        const createShellWindowApp = getShellWindowAppFactory(entryModule);
        if (!createShellWindowApp) {
          console.warn(`[vatioboard:launcher] Shell-window app "${manifest.id}" entry did not export createShellWindowApp().`);
          return false;
        }

        createShellWindowApp({
          mount: getShellMount(shellManager),
          shellManager,
          shellAppRuntimeManager,
          runtime,
        });

        if (shellManager.getWindow(shellWindowId)) return true;
        console.warn(`[vatioboard:launcher] Shell-window app "${manifest.id}" did not register window "${shellWindowId}".`);
        return false;
      } catch (error) {
        console.warn(`[vatioboard:launcher] Shell-window app "${manifest.id}" failed to load.`, error);
        return false;
      } finally {
        loads.delete(manifest.id);
      }
    })();

    loads.set(manifest.id, load);
    return load;
  }

  function openOrFocusRegisteredShellWindow(manifest: VatioAppManifest, options: VatioAppLaunchOptions = {}) {
    if (!manifest.window?.shellWindowId || !shellManager) return false;
    const shellWindowId = manifest.window.shellWindowId;
    const record = shellManager.getWindow(shellWindowId);
    if (!record) return false;

    if (record.state === "minimized") {
      return Boolean(shellManager.restoreWindow(shellWindowId, options));
    }
    if (record.state === "closed" || record.state === "hidden" || record.element?.hidden) {
      return Boolean(shellManager.openWindow(shellWindowId, options));
    }
    return Boolean(shellManager.activateWindow(shellWindowId, options));
  }

  function openOrFocusShellWindow(manifest: VatioAppManifest, options: VatioAppLaunchOptions = {}) {
    if (!manifest.window?.shellWindowId || !shellManager) return false;
    const runtime = shellAppRuntimeManager?.ensureRuntime(manifest.id) || null;
    const shellWindowId = manifest.window.shellWindowId;

    if (shellManager.getWindow(shellWindowId)) {
      return openOrFocusRegisteredShellWindow(manifest, options);
    }

    if (!manifest.entry) return false;

    void loadShellWindowEntry(manifest, runtime).then((registered) => {
      if (registered) openOrFocusRegisteredShellWindow(manifest, options);
    });
    return true;
  }

  function openApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = appRegistry.getApp(appId);
    if (!manifest) {
      console.warn(`[vatioboard:launcher] Unknown app "${appId}".`);
      return false;
    }

    if (manifest.route && navigate) return navigate(routeHref(manifest.route), options);
    if (manifest.window?.shellWindowId) return openOrFocusShellWindow(manifest, options);

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
      shellAppRuntimeManager?.ensureRuntime(manifest.id);
      return Boolean(shellManager.closeWindow(manifest.window.shellWindowId, options));
    }
    return false;
  }

  function focusApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = appRegistry.getApp(appId);
    if (!manifest) return false;
    if (manifest.route && navigate) return navigate(routeHref(manifest.route), options);
    if (manifest.window?.shellWindowId) return openOrFocusShellWindow(manifest, options);
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
    getAppRuntime(appId) {
      return shellAppRuntimeManager?.getRuntime(appId) || null;
    },
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
