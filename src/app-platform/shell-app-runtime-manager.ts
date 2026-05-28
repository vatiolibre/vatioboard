import { appRegistry } from "./app-registry.js";
import { createAppRuntime } from "./runtime.js";
import type { ShellRuntime, ShellWindowSubscriptionEvent } from "../types/shell";
import type {
  ShellAppRuntimeManager,
  VatioAppRuntime,
  VatioAppShellRuntime,
} from "./types";

export interface CreateShellAppRuntimeManagerOptions {
  shellManager: ShellRuntime;
  baseContext?: Record<string, unknown> | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  launcher?: Pick<VatioAppShellRuntime, "openApp" | "closeApp" | "focusApp" | "getAppRuntime" | "getInstalledApps" | "getRunningApps"> | null;
}

function shouldMountRuntime(runtime: VatioAppRuntime) {
  const state = runtime.lifecycle.getState();
  return state === "registered" || state === "unmounted";
}

function mountAndActivate(runtime: VatioAppRuntime) {
  if (shouldMountRuntime(runtime)) runtime.lifecycle.mount();
  runtime.lifecycle.activate();
}

function deactivateAndUnmount(runtime: VatioAppRuntime) {
  const state = runtime.lifecycle.getState();
  if (state === "active" || state === "mounted" || state === "inactive" || state === "suspended") {
    runtime.lifecycle.deactivate();
  }
  if (runtime.lifecycle.getState() !== "unmounted") {
    runtime.lifecycle.unmount();
  }
}

export function createShellAppRuntimeManager({
  shellManager,
  baseContext = null,
  navigate,
  launcher = null,
}: CreateShellAppRuntimeManagerOptions): ShellAppRuntimeManager {
  const runtimesByAppId = new Map<string, VatioAppRuntime>();
  let activeLauncher = launcher;

  function getManifestByShellWindowId(shellWindowId: string) {
    return appRegistry.listApps().find((app) => app.window?.shellWindowId === shellWindowId) || null;
  }

  function ensureRuntime(appId: string) {
    const existing = runtimesByAppId.get(appId);
    if (existing) return existing;

    const manifest = appRegistry.getApp(appId);
    if (!manifest?.window?.shellWindowId) return null;

    const runtime = createAppRuntime({
      manifest,
      shellManager,
      baseContext,
      navigate,
      launcher: activeLauncher,
    });
    runtimesByAppId.set(appId, runtime);
    return runtime;
  }

  function getRuntime(appId: string) {
    return runtimesByAppId.get(appId) || null;
  }

  function getRuntimeForShellWindow(shellWindowId: string) {
    const manifest = getManifestByShellWindowId(shellWindowId);
    if (!manifest) return null;
    return getRuntime(manifest.id);
  }

  function handleShellWindowEvent({ event, record }: ShellWindowSubscriptionEvent) {
    if (!record?.id) return;
    const manifest = getManifestByShellWindowId(record.id);
    if (!manifest) return;

    const runtime = ensureRuntime(manifest.id);
    if (!runtime) return;

    if (
      event === "opened"
      || event === "restored"
      || event === "activated"
      || event === "fullscreen"
      || ((event === "registered" || event === "updated") && record.state !== "closed" && record.state !== "hidden" && !record.element?.hidden)
    ) {
      mountAndActivate(runtime);
      return;
    }

    if (event === "minimized" || event === "closed" || event === "unregistered") {
      deactivateAndUnmount(runtime);
    }
  }

  const unsubscribe = shellManager.subscribe(handleShellWindowEvent);

  return {
    ensureRuntime,
    getRuntime,
    getRuntimeForShellWindow,
    listRuntimes() {
      return Array.from(runtimesByAppId.values());
    },
    setLauncher(nextLauncher) {
      activeLauncher = nextLauncher;
    },
    destroy() {
      unsubscribe?.();
      for (const runtime of runtimesByAppId.values()) {
        deactivateAndUnmount(runtime);
      }
      runtimesByAppId.clear();
    },
  };
}
