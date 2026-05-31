import { appRegistry } from "./app-registry.js";
import { appControl } from "./app-control.js";
import { createAppRuntime } from "./runtime.js";
import type { ShellRuntime } from "../types/shell";
import type {
  VatioAppControlService,
  VatioAppId,
  VatioAppRegistry,
  VatioAppRuntime,
  VatioAppShellRuntime,
  VatioBackgroundServiceApp,
  VatioBackgroundServiceAppModule,
  VatioBackgroundServiceManager,
  VatioBackgroundServiceRecord,
} from "./types";

export interface CreateBackgroundServiceManagerOptions {
  shellManager?: ShellRuntime | null;
  baseContext?: Record<string, unknown> | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  launcher?: Pick<VatioAppShellRuntime, "openApp" | "openAppAsync" | "closeApp" | "focusApp" | "getAppRuntime" | "getInstalledApps" | "getRunningApps"> | null;
  registry?: VatioAppRegistry;
  control?: VatioAppControlService;
}

function isBackgroundService(appId: VatioAppId, registry: VatioAppRegistry) {
  const manifest = registry.getApp(appId);
  return manifest?.kind === "background-service" && manifest.surfaces.includes("background");
}

function activateRuntime(runtime: VatioAppRuntime) {
  const state = runtime.lifecycle.getState();
  if (state === "registered" || state === "unmounted") runtime.lifecycle.mount();
  if (runtime.lifecycle.getState() !== "active") runtime.lifecycle.activate();
}

function deactivateRuntime(runtime: VatioAppRuntime) {
  const state = runtime.lifecycle.getState();
  if (state === "active" || state === "mounted" || state === "suspended") {
    runtime.lifecycle.deactivate();
  }
  if (runtime.lifecycle.getState() !== "unmounted") runtime.lifecycle.unmount();
}

function getBackgroundServiceFactory(entryModule: unknown) {
  const module = entryModule as Partial<VatioBackgroundServiceAppModule> | null;
  return typeof module?.createBackgroundServiceApp === "function" ? module.createBackgroundServiceApp : null;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof (value as Promise<unknown>).then === "function");
}

function reportServiceError(runtime: VatioAppRuntime, action: string, error: unknown) {
  runtime.logger.warn(`Background service "${runtime.appId}" failed during ${action}.`, error);
}

export function createBackgroundServiceManager({
  shellManager = null,
  baseContext = null,
  navigate,
  launcher = null,
  registry = appRegistry,
  control = appControl,
}: CreateBackgroundServiceManagerOptions = {}): VatioBackgroundServiceManager {
  const runtimes = new Map<VatioAppId, VatioAppRuntime>();
  const services = new Map<VatioAppId, VatioBackgroundServiceApp>();
  const controllers = new Map<VatioAppId, AbortController>();
  const starting = new Map<VatioAppId, Promise<boolean>>();

  function ensureRuntime(appId: VatioAppId) {
    const existing = runtimes.get(appId);
    if (existing) return existing;
    const manifest = registry.getApp(appId);
    if (!manifest || !isBackgroundService(appId, registry)) return null;

    const runtime = createAppRuntime({
      manifest,
      shellManager,
      baseContext,
      navigate,
      launcher,
    });
    runtimes.set(appId, runtime);
    return runtime;
  }

  function ensureController(appId: VatioAppId) {
    const existing = controllers.get(appId);
    if (existing && !existing.signal.aborted) return existing;
    const controller = new AbortController();
    controllers.set(appId, controller);
    return controller;
  }

  async function createServiceInstance(runtime: VatioAppRuntime, controller: AbortController) {
    if (services.has(runtime.appId)) return services.get(runtime.appId) || null;
    const entryModule = await runtime.manifest.entry?.();
    if (controller.signal.aborted || !control.isEnabled(runtime.appId)) return null;

    const createBackgroundServiceApp = getBackgroundServiceFactory(entryModule);
    if (!createBackgroundServiceApp) {
      runtime.logger.warn(`Background service "${runtime.appId}" entry did not export createBackgroundServiceApp().`);
      return null;
    }

    const service = await createBackgroundServiceApp({
      runtime,
      signal: controller.signal,
    });
    if (!service || typeof service !== "object") {
      runtime.logger.warn(`Background service "${runtime.appId}" factory did not return a service object.`);
      return null;
    }
    if (controller.signal.aborted || !control.isEnabled(runtime.appId)) {
      await service.destroy?.();
      return null;
    }

    services.set(runtime.appId, service);
    return service;
  }

  function invokeServiceAction(
    runtime: VatioAppRuntime,
    service: VatioBackgroundServiceApp | null | undefined,
    action: keyof VatioBackgroundServiceApp,
  ) {
    const handler = service?.[action];
    if (typeof handler !== "function") return;
    try {
      const result = handler.call(service);
      if (isPromiseLike(result)) {
        result.catch((error) => reportServiceError(runtime, action, error));
      }
    } catch (error) {
      reportServiceError(runtime, action, error);
    }
  }

  async function invokeServiceActionAsync(
    runtime: VatioAppRuntime,
    service: VatioBackgroundServiceApp | null | undefined,
    action: keyof VatioBackgroundServiceApp,
  ) {
    const handler = service?.[action];
    if (typeof handler !== "function") return;
    try {
      await handler.call(service);
    } catch (error) {
      reportServiceError(runtime, action, error);
    }
  }

  async function startService(appId: VatioAppId) {
    if (!control.isEnabled(appId)) return false;
    const runtime = ensureRuntime(appId);
    if (!runtime) return false;

    const existingService = services.get(appId);
    if (existingService) {
      activateRuntime(runtime);
      return true;
    }

    if (!runtime.manifest.entry) {
      activateRuntime(runtime);
      return true;
    }

    const controller = ensureController(appId);
    try {
      const service = await createServiceInstance(runtime, controller);
      if (controller.signal.aborted || !control.isEnabled(appId)) return false;
      if (!service) return false;
      await invokeServiceActionAsync(runtime, service, "start");
      if (controller.signal.aborted || !control.isEnabled(appId)) return false;
      activateRuntime(runtime);
      return true;
    } catch (error) {
      reportServiceError(runtime, "start", error);
      return false;
    }
  }

  function toRecord(runtime: VatioAppRuntime): VatioBackgroundServiceRecord {
    return {
      appId: runtime.appId,
      title: runtime.manifest.title,
      state: runtime.lifecycle.getState(),
      autostart: runtime.manifest.lifecycle?.autostart === true,
      runtime,
    };
  }

  const controlSubscriptions: Array<() => void> = [];
  const manager: VatioBackgroundServiceManager = {
    start(appId) {
      if (!control.isEnabled(appId)) return false;
      const runtime = ensureRuntime(appId);
      if (!runtime) return false;
      if (!runtime.manifest.entry || services.has(appId)) {
        activateRuntime(runtime);
        return true;
      }
      if (!starting.has(appId)) {
        const start = startService(appId).finally(() => {
          if (starting.get(appId) === start) starting.delete(appId);
        });
        starting.set(appId, start);
      }
      return true;
    },
    startAsync(appId) {
      const existing = starting.get(appId);
      if (existing) return existing;
      const start = startService(appId).finally(() => {
        if (starting.get(appId) === start) starting.delete(appId);
      });
      starting.set(appId, start);
      return start;
    },
    suspend(appId) {
      const runtime = runtimes.get(appId);
      if (!runtime) return false;
      invokeServiceAction(runtime, services.get(appId), "suspend");
      runtime.lifecycle.suspend();
      return true;
    },
    resume(appId) {
      const runtime = runtimes.get(appId);
      if (!runtime) return false;
      invokeServiceAction(runtime, services.get(appId), "resume");
      runtime.lifecycle.resume();
      return true;
    },
    stop(appId) {
      const runtime = runtimes.get(appId);
      if (!runtime) return false;
      const service = services.get(appId);
      invokeServiceAction(runtime, service, "stop");
      invokeServiceAction(runtime, service, "destroy");
      controllers.get(appId)?.abort();
      controllers.delete(appId);
      services.delete(appId);
      starting.delete(appId);
      deactivateRuntime(runtime);
      runtimes.delete(appId);
      return true;
    },
    startAutostartServices() {
      for (const manifest of registry.listApps()) {
        if (
          manifest.kind === "background-service"
          && manifest.lifecycle?.autostart === true
          && control.isEnabled(manifest.id)
        ) {
          this.start(manifest.id);
        }
      }
      return this.listServices();
    },
    getRuntime(appId) {
      return runtimes.get(appId) || null;
    },
    listServices() {
      return Array.from(runtimes.values()).map(toRecord);
    },
    destroy() {
      for (const unsubscribe of controlSubscriptions.splice(0)) unsubscribe();
      for (const appId of Array.from(runtimes.keys())) manager.stop(appId);
      for (const controller of controllers.values()) controller.abort();
      runtimes.clear();
      services.clear();
      controllers.clear();
      starting.clear();
    },
  };

  const unsubscribeControl = control.subscribe?.((state) => {
    if (state.enabled) return;
    if (!isBackgroundService(state.appId, registry)) return;
    manager.stop(state.appId);
  });
  if (unsubscribeControl) controlSubscriptions.push(unsubscribeControl);

  return manager;
}
