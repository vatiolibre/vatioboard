import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appControl,
  appRegistry,
  clearAppPrivateStorage,
  createAppLauncher,
  createAppPermissionRuntime,
  createAppRuntime,
  createBackgroundServiceManager,
  createShellAppRuntimeManager,
  sharedSettings,
} from "../../src/app-platform/index.js";
import { loadConfiguredSpeedUnit } from "../../src/shared/unit-bootstrap.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { initFloatingTools } from "../../src/shared/floating-tools.js";
import { initSharedStartMenu } from "../../src/shared/start-menu.js";
import appsTemplate from "../../src/app/views/templates/apps-template.js";
import { mountAppsRoute } from "../../src/apps/app-manager/app-manager.js";

function cleanupStack() {
  const callbacks = [];
  return {
    add(callback) {
      if (typeof callback === "function") callbacks.push(callback);
      return callback;
    },
    addEventListener(target, type, listener, options) {
      target?.addEventListener?.(type, listener, options);
      callbacks.push(() => target?.removeEventListener?.(type, listener, options));
    },
    run() {
      while (callbacks.length) callbacks.pop()?.();
    },
  };
}

describe("VatioBoard OS app control plane", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
    vi.restoreAllMocks();
  });

  it("recovers corrupt app control storage and protects core system apps", () => {
    localStorage.setItem("vatioboard.os.appControl.v1", "{");

    expect(appControl.getState("vatio.calculator")).toMatchObject({
      appId: "vatio.calculator",
      enabled: true,
    });
    expect(appControl.setEnabled("vatio.speed", false)).toBe(false);
    expect(appControl.isEnabled("vatio.speed")).toBe(true);

    expect(appControl.setEnabled("vatio.calculator", false)).toBe(true);
    expect(appControl.isEnabled("vatio.calculator")).toBe(false);
  });

  it("enforces declared and granted permissions", () => {
    const warn = vi.fn();
    const manifest = appRegistry.getApp("vatio.calculator");
    expect(manifest).toBeTruthy();

    appControl.revokePermission("vatio.calculator", "settings.write");
    const permissions = createAppPermissionRuntime(manifest, { warn });

    expect(permissions.has("settings.read")).toBe(true);
    expect(permissions.require("settings.write")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Grant it in App Manager"));
    expect(appControl.grantPermission("vatio.calculator", "gps.read")).toBe(false);

    const runtime = createAppRuntime({ manifest, baseContext: {} });
    expect(runtime.services.settings?.setJson("preferences", { decimals: 4 })).toBe(false);
  });

  it("blocks disabled launcher and start-menu launches", () => {
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const shellAppRuntimeManager = createShellAppRuntimeManager({ shellManager, baseContext: {} });
    const launcher = createAppLauncher({ shellManager, shellAppRuntimeManager });
    shellAppRuntimeManager.setLauncher(launcher);
    const floatingTools = initFloatingTools({ mount: document.body, shellManager, shellAppRuntimeManager });

    appControl.setEnabled("vatio.calculator", false);
    expect(launcher.openApp("vatio.calculator")).toBe(false);

    const startMenu = initSharedStartMenu({ floatingTools, mount: document.body, shellAppRuntimeManager });
    startMenu.setOpen(true);
    startMenu.list.querySelector("[data-start-action='calculator']").click();
    expect(shellManager.getWindow("calculator")?.state).not.toBe("open");

    appControl.setEnabled("vatio.calculator", true);
    expect(launcher.openApp("vatio.calculator")).toBe(true);
    expect(shellManager.getWindow("calculator")?.state).toBe("open");

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps app-private storage reset isolated from app control state", () => {
    appControl.setPinned("vatio.calculator", true);
    localStorage.setItem("vatioboard.app.vatio.calculator.settings.preferences", JSON.stringify({ decimals: 5 }));

    expect(clearAppPrivateStorage("vatio.calculator")).toBe(true);
    expect(localStorage.getItem("vatioboard.app.vatio.calculator.settings.preferences")).toBeNull();
    expect(appControl.isPinned("vatio.calculator")).toBe(true);
  });

  it("uses legacy speed unit preferences as canonical while mirroring shared settings", () => {
    sharedSettings.set("speedUnit", "mph");
    localStorage.setItem("vatio_speed_unit", "kmh");

    expect(loadConfiguredSpeedUnit("mph")).toBe("kmh");
    expect(sharedSettings.get("speedUnit")).toBe("kmh");

    localStorage.removeItem("vatio_speed_unit");
    sharedSettings.set("speedUnit", "mph");
    expect(loadConfiguredSpeedUnit("kmh")).toBe("mph");
    expect(localStorage.getItem("vatio_speed_unit")).toBe("mph");
  });

  it("autostarts conservative internal background services", () => {
    const manager = createBackgroundServiceManager({ baseContext: {} });
    const services = manager.startAutostartServices();

    expect(services.map((service) => service.appId)).toContain("vatio.offlineReadiness");
    expect(manager.getRuntime("vatio.offlineReadiness")?.lifecycle.getState()).toBe("active");

    manager.destroy();
    expect(manager.listServices()).toEqual([]);
  });

  it("renders App Manager controls and persists enable state changes", () => {
    const root = document.createElement("main");
    root.innerHTML = appsTemplate;
    document.body.append(root);
    const cleanup = cleanupStack();
    const runtime = createAppRuntime({
      manifest: appRegistry.getApp("vatio.appManager"),
      baseContext: {},
    });

    mountAppsRoute({
      root,
      context: {
        appRuntime: runtime,
        navigate: vi.fn(() => true),
      },
      cleanup,
    });

    const calculatorCard = root.querySelector("[data-app-id='vatio.calculator']");
    expect(calculatorCard).toBeTruthy();
    expect(calculatorCard.dataset.enabled).toBe("true");

    calculatorCard.querySelector(".vb-app-manager-toggle").click();
    const disabledCard = root.querySelector("[data-app-id='vatio.calculator']");
    expect(appControl.isEnabled("vatio.calculator")).toBe(false);
    expect(disabledCard.dataset.enabled).toBe("false");
    expect(disabledCard.querySelector(".vb-app-manager-launch").disabled).toBe(true);
    expect(root.querySelector("[data-app-id='vatio.speed'] .vb-app-manager-toggle").disabled).toBe(true);

    cleanup.run();
  });
});
