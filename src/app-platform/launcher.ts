import { appRegistry } from "./app-registry.js";
import { appControl } from "./app-control.js";
import { readShellLayout } from "../shared/shell-layout-store.js";
import type { AppRoute } from "../types/route";
import type { ShellRuntime } from "../types/shell";
import type {
  ShellAppRuntimeManager,
  VatioAppId,
  VatioAppLaunchOptions,
  VatioAppManifest,
  VatioAppRegistry,
  VatioAppRuntime,
  VatioAppShellRuntime,
  VatioShellWindowRestoreOptions,
  VatioRunningApp,
  VatioShellWindowAppModule,
} from "./types";

function routeHref(route: string) {
  return route.startsWith("/") ? route : `/${route}`;
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
  registry?: VatioAppRegistry | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  getCurrentRoute?: () => AppRoute | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
}

const RESTORABLE_SHELL_WINDOW_STATES = new Set(["open", "fullscreen", "minimized"]);

export function createAppLauncher({
  shellManager = null,
  registry = appRegistry,
  navigate,
  getCurrentRoute,
  shellAppRuntimeManager = null,
}: CreateAppLauncherOptions = {}): VatioAppShellRuntime {
  const launchingAppIds = new Set<VatioAppId>();

  function getInstalledApps(): VatioAppManifest[] {
    return registry?.listApps?.() || [];
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
      launchingAppIds.add(manifest.id);
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
        launchingAppIds.delete(manifest.id);
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

  async function openOrFocusShellWindowAsync(manifest: VatioAppManifest, options: VatioAppLaunchOptions = {}) {
    if (!manifest.window?.shellWindowId || !shellManager) return false;
    const runtime = shellAppRuntimeManager?.ensureRuntime(manifest.id) || null;

    if (shellManager.getWindow(manifest.window.shellWindowId)) {
      return openOrFocusRegisteredShellWindow(manifest, options);
    }

    if (!manifest.entry) return false;
    const registered = await loadShellWindowEntry(manifest, runtime);
    return registered ? openOrFocusRegisteredShellWindow(manifest, options) : false;
  }

  async function restorePersistedShellWindows(options: VatioShellWindowRestoreOptions = {}) {
    if (!shellManager) return [];

    const layout = options.layout || readShellLayout();
    const windows = layout?.windows || {};
    const restorableStates = new Set(options.states || Array.from(RESTORABLE_SHELL_WINDOW_STATES));
    const restorableAppIds = options.appIds ? new Set(options.appIds) : null;
    const candidates = getInstalledApps().filter((manifest) => {
      if (restorableAppIds && !restorableAppIds.has(manifest.id)) return false;
      const shellWindowId = manifest.window?.shellWindowId;
      if (!shellWindowId) return false;
      const stored = windows[shellWindowId];
      if (!stored || !restorableStates.has(stored.state)) return false;
      if (manifest.window?.restoreOnBoot !== true) return false;
      if (!appControl.isEnabled(manifest.id)) return false;
      return !shellManager.getWindow(shellWindowId);
    });

    const loaded = await Promise.all(candidates.map(async (manifest) => {
      const runtime = shellAppRuntimeManager?.ensureRuntime(manifest.id) || null;
      return await loadShellWindowEntry(manifest, runtime) ? manifest.id : null;
    }));
    return loaded.filter((appId): appId is VatioAppId => Boolean(appId));
  }

  function openApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = registry?.getApp?.(appId) || null;
    if (!manifest) {
      console.warn(`[vatioboard:launcher] Unknown app "${appId}".`);
      return false;
    }

    if (!appControl.isEnabled(appId)) {
      console.warn(`[vatioboard:launcher] App "${appId}" is disabled.`);
      return false;
    }

    if (manifest.route && navigate) {
      const launched = navigate(routeHref(manifest.route), options);
      if (launched) appControl.recordLaunch(appId);
      return launched;
    }
    if (manifest.window?.shellWindowId) {
      const launched = openOrFocusShellWindow(manifest, options);
      if (launched) appControl.recordLaunch(appId);
      return launched;
    }

    if (manifest.kind === "background-service") {
      console.warn(`[vatioboard:launcher] Background app "${appId}" is registered but has no v1 launcher.`);
      return false;
    }

    console.warn(`[vatioboard:launcher] App "${appId}" has no launchable v1 surface.`);
    return false;
  }

  async function openAppAsync(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = registry?.getApp?.(appId) || null;
    if (!manifest) {
      console.warn(`[vatioboard:launcher] Unknown app "${appId}".`);
      return false;
    }

    if (!appControl.isEnabled(appId)) {
      console.warn(`[vatioboard:launcher] App "${appId}" is disabled.`);
      return false;
    }

    if (manifest.route && navigate) {
      const launched = navigate(routeHref(manifest.route), options);
      if (launched) appControl.recordLaunch(appId);
      return launched;
    }
    if (manifest.window?.shellWindowId) {
      const launched = await openOrFocusShellWindowAsync(manifest, options);
      if (launched) appControl.recordLaunch(appId);
      return launched;
    }

    if (manifest.kind === "background-service") {
      console.warn(`[vatioboard:launcher] Background app "${appId}" is registered but has no v1 launcher.`);
      return false;
    }

    console.warn(`[vatioboard:launcher] App "${appId}" has no launchable v1 surface.`);
    return false;
  }

  function closeApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = registry?.getApp?.(appId) || null;
    if (!manifest) return false;
    if (manifest.window?.shellWindowId && shellManager) {
      shellAppRuntimeManager?.ensureRuntime(manifest.id);
      return Boolean(shellManager.closeWindow(manifest.window.shellWindowId, options));
    }
    return false;
  }

  function focusApp(appId: VatioAppId, options: VatioAppLaunchOptions = {}) {
    const manifest = registry?.getApp?.(appId) || null;
    if (!manifest) return false;
    if (!appControl.isEnabled(appId)) return false;
    if (manifest.route && navigate) return navigate(routeHref(manifest.route), options);
    if (manifest.window?.shellWindowId) return openOrFocusShellWindow(manifest, options);
    return false;
  }

  function getRunningApps(): VatioRunningApp[] {
    const running: VatioRunningApp[] = [];
    const currentRoute = getCurrentRoute?.();
    const currentApp = currentRoute?.path ? registry?.getAppByRoute?.(currentRoute.path) || null : null;
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
      const manifest = getInstalledApps().find((app) => app.window?.shellWindowId === record.id);
      running.push({
        appId: manifest?.id || record.id,
        title: manifest?.title || record.title || record.id,
        surface: "shell-window",
        state: record.state,
      });
    }
    for (const appId of launchingAppIds) {
      if (running.some((app) => app.appId === appId)) continue;
      const manifest = registry?.getApp?.(appId) || null;
      if (!manifest) continue;
      running.push({
        appId,
        title: manifest.title,
        surface: "shell-window",
        state: "launching",
      });
    }
    return running;
  }

  return {
    openApp,
    openAppAsync,
    restorePersistedShellWindows,
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
