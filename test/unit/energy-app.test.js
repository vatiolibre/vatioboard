import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppLauncher,
  createAppRuntime,
  createShellAppRuntimeManager,
} from "../../src/app-platform/index.js";
import {
  ENERGY_APP_ID,
  ENERGY_NUMBER_FORMAT_SETTINGS_KEY,
  ENERGY_TRIP_SETTINGS_KEY,
  createEnergyApp,
  createEnergySettingsStore,
} from "../../src/apps/energy/index.js";
import {
  CALCULATOR_APP_ID,
  CALCULATOR_SETTINGS_KEY,
  createCalculatorApp,
} from "../../src/apps/calculator/index.js";
import { createEnergyCalculatorWidget } from "../../src/energy/energy-calculator-widget.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { initFloatingTools } from "../../src/shared/floating-tools.js";
import { initSharedStartMenu } from "../../src/shared/start-menu.js";

function makeManifest(overrides = {}) {
  return {
    id: "test.energy",
    title: "Test Energy",
    shortTitle: "Energy",
    description: "Energy test manifest.",
    kind: "tool-app",
    version: "1.0.0",
    icon: "<svg></svg>",
    i18nKey: "energy",
    surfaces: ["shell-window"],
    order: 1,
    permissions: ["settings.read", "settings.write", "i18n.read"],
    services: ["settings", "i18n"],
    window: {
      shellWindowId: "test-energy",
      mode: "floating",
      defaultBounds: { left: 0, top: 0, width: 640 },
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

describe("Energy OS app module", () => {
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

  it("opens vatio.energy through the manifest-backed launcher and creates a runtime", () => {
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const energy = createEnergyApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(energy.runtime?.appId).toBe(ENERGY_APP_ID);
    expect(shellAppRuntimeManager.getRuntime(ENERGY_APP_ID)).toBe(energy.runtime);
    expect(launcher.openApp(ENERGY_APP_ID)).toBe(true);

    expect(shellManager.getWindow("energy")?.state).toBe("open");
    expect(document.querySelector(".energy-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(ENERGY_APP_ID)?.lifecycle.getState()).toBe("active");

    energy.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("persists Energy preferences through runtime settings while mirroring legacy settings", () => {
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const energy = createEnergyApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(ENERGY_APP_ID);

    document.querySelector(".energy-mode-btn[data-mode='multi']").click();
    document.querySelector(".energy-settings-btn").click();
    document.querySelector(".energy-unit-btn[data-unit='mi']").click();
    const thousandsToggle = document.querySelector(".energy-settings-thousands");
    thousandsToggle.checked = true;
    thousandsToggle.dispatchEvent(new Event("change", { bubbles: true }));

    const runtimeTripSettings = JSON.parse(
      localStorage.getItem(`vatioboard.app.${ENERGY_APP_ID}.settings.${ENERGY_TRIP_SETTINGS_KEY}`),
    );
    const legacyTripSettings = JSON.parse(localStorage.getItem("energy_trip_cost_settings_v1"));
    expect(runtimeTripSettings).toMatchObject({ unit: "mi", mode: "multi" });
    expect(legacyTripSettings).toMatchObject({ unit: "mi", mode: "multi" });

    const runtimeNumberFormatSettings = JSON.parse(
      localStorage.getItem(`vatioboard.app.${ENERGY_APP_ID}.settings.${ENERGY_NUMBER_FORMAT_SETTINGS_KEY}`),
    );
    const legacyNumberFormatSettings = JSON.parse(localStorage.getItem("embeddable_calc_settings_v1"));
    expect(runtimeNumberFormatSettings).toMatchObject({ decimals: 8, thousandSeparator: "." });
    expect(legacyNumberFormatSettings).toMatchObject({ decimals: 8, thousandSeparator: "." });

    energy.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("loads the shared legacy number-format source instead of stale Energy runtime mirrors", () => {
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: ENERGY_APP_ID,
        permissions: ["settings.read", "settings.write", "i18n.read"],
        services: ["settings", "i18n"],
      }),
      baseContext: {},
    });
    runtime.services.settings?.setJson(ENERGY_NUMBER_FORMAT_SETTINGS_KEY, { decimals: 3, thousandSeparator: "" });
    localStorage.setItem("embeddable_calc_settings_v1", JSON.stringify({
      decimals: 7,
      thousandSeparator: ".",
    }));

    expect(createEnergySettingsStore(runtime).loadNumberFormatSettings?.()).toMatchObject({
      decimals: 7,
      thousandSeparator: ".",
    });
  });

  it("shows Calculator number-format changes in Energy after Energy is recreated", () => {
    localStorage.setItem(
      `vatioboard.app.${ENERGY_APP_ID}.settings.${ENERGY_NUMBER_FORMAT_SETTINGS_KEY}`,
      JSON.stringify({ decimals: 2, thousandSeparator: "" }),
    );
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
    const thousandsToggle = document.querySelector(".calc-settings-thousands");
    thousandsToggle.checked = true;
    thousandsToggle.dispatchEvent(new Event("change", { bubbles: true }));

    const energy = createEnergyApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(createEnergySettingsStore(energy.runtime).loadNumberFormatSettings?.()).toMatchObject({
      decimals: 9,
      thousandSeparator: ".",
    });

    energy.destroy();
    calculator.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("shows Energy number-format changes in Calculator after Calculator is recreated", () => {
    localStorage.setItem(
      `vatioboard.app.${CALCULATOR_APP_ID}.settings.${CALCULATOR_SETTINGS_KEY}`,
      JSON.stringify({ decimals: 4, thousandSeparator: "" }),
    );
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const energy = createEnergyApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(ENERGY_APP_ID);

    document.querySelector(".energy-settings-btn").click();
    const energyThousandsToggle = document.querySelector(".energy-settings-thousands");
    energyThousandsToggle.checked = true;
    energyThousandsToggle.dispatchEvent(new Event("change", { bubbles: true }));

    const calculator = createCalculatorApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(CALCULATOR_APP_ID);
    document.querySelector(".calc-settings-btn").click();

    expect(document.querySelector(".calc-settings-thousands").checked).toBe(true);
    expect(JSON.parse(localStorage.getItem("embeddable_calc_settings_v1"))).toMatchObject({
      decimals: 8,
      thousandSeparator: ".",
    });

    calculator.destroy();
    energy.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
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

    startMenu.list.querySelector("[data-start-action='energy']").click();
    expect(shellManager.getWindow("energy")?.state).toBe("open");
    expect(shellAppRuntimeManager.getRuntime(ENERGY_APP_ID)?.lifecycle.getState()).toBe("active");

    shellManager.closeWindow("energy");
    floatingTools.toggleEnergy();
    expect(shellManager.getWindow("energy")?.state).toBe("open");
    expect(document.querySelector(".energy-panel")?.hidden).toBe(false);

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps Calculator-to-Energy launch behavior working", () => {
    const { shellManager, shellAppRuntimeManager } = createShellHarness();
    const energy = createEnergyApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    const calculator = createCalculatorApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
      onOpenEnergy: () => shellManager.openWindow("energy"),
    });

    shellManager.openWindow("calculator");
    document.querySelector(".calc-energy-btn").click();

    expect(shellManager.getWindow("energy")?.state).toBe("open");
    expect(document.querySelector(".energy-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(ENERGY_APP_ID)?.lifecycle.getState()).toBe("active");

    calculator.destroy();
    energy.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps direct Energy widget callers working without a runtime", () => {
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const energy = createEnergyCalculatorWidget({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
    });

    expect(() => shellManager.openWindow("energy")).not.toThrow();
    expect(shellManager.getWindow("energy")?.state).toBe("open");
    expect(document.querySelector(".energy-panel")?.hidden).toBe(false);

    energy.destroy();
    shellManager.destroy();
  });

  it("fails safely when runtime settings writes are not permitted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: "test.energy.readonly",
        permissions: ["settings.read"],
        services: ["settings"],
      }),
      baseContext: {},
    });
    const settingsStore = createEnergySettingsStore(runtime);

    expect(() => settingsStore.saveTripCostSettings?.({ unit: "mi", mode: "multi" })).not.toThrow();
    expect(localStorage.getItem("vatioboard.app.test.energy.readonly.settings.tripCostSettings")).toBeNull();
    expect(JSON.parse(localStorage.getItem("energy_trip_cost_settings_v1"))).toMatchObject({
      unit: "mi",
      mode: "multi",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[vatioboard:app:test.energy.readonly]"),
      expect.stringContaining("Permission denied"),
    );
  });
});
