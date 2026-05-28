import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppLauncher,
  createAppRuntime,
  createShellAppRuntimeManager,
} from "../../src/app-platform/index.js";
import {
  CALCULATOR_APP_ID,
  CALCULATOR_SETTINGS_KEY,
  createCalculatorApp,
  createCalculatorSettingsStore,
} from "../../src/apps/calculator/index.js";
import { createCalculatorWidget } from "../../src/calculator/calculator-widget.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { initFloatingTools } from "../../src/shared/floating-tools.js";
import { initSharedStartMenu } from "../../src/shared/start-menu.js";

function makeManifest(overrides = {}) {
  return {
    id: "test.calculator",
    title: "Test Calculator",
    shortTitle: "Calc",
    description: "Calculator test manifest.",
    kind: "tool-app",
    version: "1.0.0",
    icon: "<svg></svg>",
    i18nKey: "calculator",
    surfaces: ["shell-window"],
    order: 1,
    permissions: ["settings.read", "settings.write", "i18n.read"],
    services: ["settings", "i18n"],
    window: {
      shellWindowId: "test-calculator",
      mode: "floating",
      defaultBounds: { left: 0, top: 0, width: 320 },
      capabilities: {},
      restoreOnBoot: false,
      lazy: false,
    },
    localFirst: true,
    teslaOptimized: true,
    offlineCapable: true,
    status: "stable",
    metadata: {},
    ...overrides,
  };
}

function createShellHarness() {
  const shellManager = createShellWindowManager({
    root: document.body,
    storeOptions: { storage: localStorage, migrateLegacy: false },
  });
  const shellAppRuntimeManager = createShellAppRuntimeManager({
    shellManager,
    baseContext: {},
  });
  const launcher = createAppLauncher({
    shellManager,
    shellAppRuntimeManager,
  });
  shellAppRuntimeManager.setLauncher(launcher);
  return { shellManager, shellAppRuntimeManager, launcher };
}

describe("Calculator OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
  });

  afterEach(() => {
    window.__vatioboardRouter?.destroy?.();
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
    vi.restoreAllMocks();
  });

  it("opens vatio.calculator through the manifest-backed launcher and creates a runtime", () => {
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const calculator = createCalculatorApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(calculator.runtime?.appId).toBe(CALCULATOR_APP_ID);
    expect(shellAppRuntimeManager.getRuntime(CALCULATOR_APP_ID)).toBe(calculator.runtime);
    expect(launcher.openApp(CALCULATOR_APP_ID)).toBe(true);

    expect(shellManager.getWindow("calculator")?.state).toBe("open");
    expect(document.querySelector(".calc-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(CALCULATOR_APP_ID)?.lifecycle.getState()).toBe("active");

    calculator.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("persists Calculator preferences through runtime settings while mirroring legacy settings", () => {
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const calculator = createCalculatorApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(CALCULATOR_APP_ID);

    document.querySelector(".calc-settings-btn").click();
    document.querySelector(".calc-settings-decimals-plus").click();

    const runtimeSettings = JSON.parse(
      localStorage.getItem(`vatioboard.app.${CALCULATOR_APP_ID}.settings.${CALCULATOR_SETTINGS_KEY}`),
    );
    const legacySettings = JSON.parse(localStorage.getItem("embeddable_calc_settings_v1"));
    expect(runtimeSettings).toMatchObject({ decimals: 9, thousandSeparator: "" });
    expect(legacySettings).toMatchObject({ decimals: 9, thousandSeparator: "" });

    calculator.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("loads the shared legacy number-format source instead of stale Calculator runtime mirrors", () => {
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: CALCULATOR_APP_ID,
        permissions: ["settings.read", "settings.write", "i18n.read"],
        services: ["settings", "i18n"],
      }),
      baseContext: {},
    });
    runtime.services.settings?.setJson(CALCULATOR_SETTINGS_KEY, { decimals: 2, thousandSeparator: "" });
    localStorage.setItem("embeddable_calc_settings_v1", JSON.stringify({
      decimals: 6,
      thousandSeparator: ".",
    }));

    expect(createCalculatorSettingsStore(runtime).loadSettings?.()).toMatchObject({
      decimals: 6,
      thousandSeparator: ".",
    });
  });

  it("keeps legacy start-menu and floating-tool launch paths working", () => {
    const { shellManager, shellAppRuntimeManager } = createShellHarness();
    const mount = document.createElement("div");
    document.body.append(mount);
    const floatingTools = initFloatingTools({
      mount,
      shellManager,
      shellAppRuntimeManager,
    });
    const startMenu = initSharedStartMenu({ floatingTools, mount });

    startMenu.list.querySelector("[data-start-action='calculator']").click();
    expect(shellManager.getWindow("calculator")?.state).toBe("open");
    expect(shellAppRuntimeManager.getRuntime(CALCULATOR_APP_ID)?.lifecycle.getState()).toBe("active");

    shellManager.closeWindow("calculator");
    floatingTools.toggleCalculator();
    expect(shellManager.getWindow("calculator")?.state).toBe("open");
    expect(document.querySelector(".calc-panel")?.hidden).toBe(false);

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("fails safely when runtime settings writes are not permitted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: "test.calculator.readonly",
        permissions: ["settings.read"],
        services: ["settings"],
      }),
      baseContext: {},
    });
    const settingsStore = createCalculatorSettingsStore(runtime);

    expect(() => settingsStore.saveSettings?.({ decimals: 4, thousandSeparator: "." })).not.toThrow();
    expect(localStorage.getItem("vatioboard.app.test.calculator.readonly.settings.preferences")).toBeNull();
    expect(JSON.parse(localStorage.getItem("embeddable_calc_settings_v1"))).toMatchObject({
      decimals: 4,
      thousandSeparator: ".",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[vatioboard:app:test.calculator.readonly]"),
      expect.stringContaining("Permission denied"),
    );
  });

  it("keeps direct Calculator widget callers working without a runtime", () => {
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const calculator = createCalculatorWidget({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
    });

    expect(() => shellManager.openWindow("calculator")).not.toThrow();
    expect(shellManager.getWindow("calculator")?.state).toBe("open");
    expect(document.querySelector(".calc-panel")?.hidden).toBe(false);

    calculator.destroy();
    shellManager.destroy();
  });
});
