import { appRegistry } from "./app-registry.js";
import { appControl } from "./app-control.js";
import { createAppRuntime } from "./runtime.js";
import type { ShellRuntime } from "../types/shell";
import type {
  VatioAppId,
  VatioAppRuntime,
  VatioAppShellRuntime,
  VatioBackgroundServiceManager,
  VatioBackgroundServiceRecord,
} from "./types";

export interface CreateBackgroundServiceManagerOptions {
  shellManager?: ShellRuntime | null;
  baseContext?: Record<string, unknown> | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  launcher?: Pick<VatioAppShellRuntime, "openApp" | "openAppAsync" | "closeApp" | "focusApp" | "getAppRuntime" | "getInstalledApps" | "getRunningApps"> | null;
}

function isBackgroundService(appId: VatioAppId) {
  const manifest = appRegistry.getApp(appId);
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

export function createBackgroundServiceManager({
  shellManager = null,
  baseContext = null,
  navigate,
  launcher = null,
}: CreateBackgroundServiceManagerOptions = {}): VatioBackgroundServiceManager {
  const runtimes = new Map<VatioAppId, VatioAppRuntime>();

  function ensureRuntime(appId: VatioAppId) {
    const existing = runtimes.get(appId);
    if (existing) return existing;
    const manifest = appRegistry.getApp(appId);
    if (!manifest || !isBackgroundService(appId)) return null;

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

  function toRecord(runtime: VatioAppRuntime): VatioBackgroundServiceRecord {
    return {
      appId: runtime.appId,
      title: runtime.manifest.title,
      state: runtime.lifecycle.getState(),
      autostart: runtime.manifest.lifecycle?.autostart === true,
      runtime,
    };
  }

  return {
    start(appId) {
      if (!appControl.isEnabled(appId)) return false;
      const runtime = ensureRuntime(appId);
      if (!runtime) return false;
      activateRuntime(runtime);
      return true;
    },
    suspend(appId) {
      const runtime = runtimes.get(appId);
      if (!runtime) return false;
      runtime.lifecycle.suspend();
      return true;
    },
    resume(appId) {
      const runtime = runtimes.get(appId);
      if (!runtime) return false;
      runtime.lifecycle.resume();
      return true;
    },
    stop(appId) {
      const runtime = runtimes.get(appId);
      if (!runtime) return false;
      deactivateRuntime(runtime);
      runtimes.delete(appId);
      return true;
    },
    startAutostartServices() {
      for (const manifest of appRegistry.listApps()) {
        if (
          manifest.kind === "background-service"
          && manifest.lifecycle?.autostart === true
          && appControl.isEnabled(manifest.id)
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
      for (const runtime of runtimes.values()) {
        deactivateRuntime(runtime);
      }
      runtimes.clear();
    },
  };
}
