import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushTasks } from "../helpers/page-smoke.js";

const ACCEL_SETTINGS_KEY = "vatioboard.accel.settings";
const ACCEL_RUNTIME_PRESET_KEY = "vatioboard.app.vatio.accel.settings.selectedPresetId";
const mountedAccelViews = [];

vi.mock("../../src/shared/backend-auth.js", () => ({
  BACKEND_AUTH_SIGNUP_URL: "https://www.vatiolibre.com/login#signup",
  BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
  getBackendFeatureAccessState: vi.fn(async () => ({ ok: false })),
  getBackendSessionState: vi.fn(async () => ({
    authenticated: false,
    isGuest: true,
    ok: false,
    status: 0,
  })),
  getSsoSubscribeUrl: vi.fn(() => "https://www.vatiolibre.com/subscribe"),
  getVatioLibreSubscribeUrl: vi.fn(() => "https://www.vatiolibre.com/subscribe"),
  initBackendAuthControllers: vi.fn(),
}));

vi.mock("../../src/shared/cloud-sync.js", () => ({
  CLOUD_SYNC_APPLIED_EVENT: "vatioboard:cloud-sync-applied",
  CLOUD_SYNC_ENTITY_TYPES: {
    accelRun: "accel_run",
    boardDrawing: "board_drawing",
    replaySession: "replay_session",
  },
  CLOUD_SYNC_STATUS_EVENT: "vatioboard:cloud-sync-status",
  CLOUD_SYNC_STATUS_STATES: {
    failed: "failed",
    localOnly: "local_only",
    paused: "paused",
    synced: "synced",
    syncing: "syncing",
  },
  getCloudSyncStatus: vi.fn(() => ({ state: "local_only", reason: "test" })),
  queueCloudSyncChange: vi.fn(async () => true),
  queueCloudSyncDeletion: vi.fn(async () => true),
}));

vi.mock("../../src/shared/repositories/accel-repository.js", () => ({
  clearAccelRestoreFailure: vi.fn(),
  ensureAccelTelemetry: vi.fn(async () => ({ restored: false, run: null })),
  getAccelSelection: vi.fn(async () => ({
    run: null,
    runs: [],
    selectedResultId: "",
  })),
}));

vi.mock("../../src/shared/single-tab.js", () => ({
  ensureSingleTabOwnership: vi.fn(() => Promise.resolve(true)),
  SINGLE_TAB_OWNERSHIP_EVENT: "vatioboard:single-tab-ownership",
}));

async function settleAccelTasks(iterations = 12) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function selectedPreset() {
  return document.querySelector(".vb-settings-select-menu [role='option'][aria-selected='true']")?.dataset.value || "";
}

async function mountAccelWithRuntime({ legacyPreset = "", runtimePreset = "" } = {}) {
  window.history.replaceState({}, "", "https://vatioboard.com/accel");
  if (legacyPreset) {
    localStorage.setItem(
      ACCEL_SETTINGS_KEY,
      JSON.stringify({
        selectedPresetId: legacyPreset,
        speedUnit: "mph",
        distanceUnit: "ft",
      })
    );
  }
  const { appRegistry, createAppRuntime } = await import("../../src/app-platform/index.js");
  const { mount } = await import("../../src/app/views/AccelView.js");
  const manifest = appRegistry.getApp("vatio.accel");
  const runtime = createAppRuntime({ manifest, baseContext: {} });
  if (runtimePreset) runtime.services.settings.set("selectedPresetId", runtimePreset);
  const root = document.getElementById("root");

  const mounted = await mount(root, {
    appRuntime: runtime,
    appManifest: manifest,
    routeSignal: new AbortController().signal,
  });
  mountedAccelViews.push(mounted);
  await settleAccelTasks();

  return { mounted, runtime };
}

describe("Accel route lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    mountedAccelViews.length = 0;
    localStorage.clear();
    document.head.innerHTML = '<meta name="description" content="Accel test">';
    document.body.innerHTML = '<main id="root"></main>';
    window.__vatioboardSpa = true;
  });

  afterEach(() => {
    while (mountedAccelViews.length > 0) {
      mountedAccelViews.pop()?.unmount?.();
    }
    document.body.innerHTML = "";
    localStorage.clear();
    delete window.__vatioboardSpa;
    vi.restoreAllMocks();
  });

  it("keeps legacy Accel settings canonical while mirroring selected preset to runtime settings", async () => {
    const { mounted } = await mountAccelWithRuntime({
      legacyPreset: "quarter-mile",
      runtimePreset: "60-130-mph",
    });

    expect(selectedPreset()).toBe("quarter-mile");
    expect(localStorage.getItem(ACCEL_RUNTIME_PRESET_KEY)).toBe("quarter-mile");

    mounted.unmount();
  }, 40000);

  it("seeds the selected preset from runtime settings only when no legacy settings exist", async () => {
    const { mounted } = await mountAccelWithRuntime({
      runtimePreset: "60-130-mph",
    });

    expect(selectedPreset()).toBe("60-130-mph");
    expect(localStorage.getItem(ACCEL_RUNTIME_PRESET_KEY)).toBe("60-130-mph");

    mounted.unmount();
  }, 40000);

  it("preserves direct route callers without runtime settings", async () => {
    localStorage.setItem(
      ACCEL_SETTINGS_KEY,
      JSON.stringify({
        selectedPresetId: "quarter-mile",
        speedUnit: "mph",
        distanceUnit: "ft",
      })
    );
    window.history.replaceState({}, "", "https://vatioboard.com/accel");
    const { mount } = await import("../../src/app/views/AccelView.js");
    const root = document.getElementById("root");

    const mounted = await mount(root, {
      routeSignal: new AbortController().signal,
    });
    mountedAccelViews.push(mounted);
    await settleAccelTasks();

    expect(selectedPreset()).toBe("quarter-mile");
    expect(localStorage.getItem(ACCEL_RUNTIME_PRESET_KEY)).toBeNull();

    mounted.unmount();
  }, 40000);

  it("uses compact shared controls without changing Accel setting behavior", async () => {
    const { mounted } = await mountAccelWithRuntime();
    document.getElementById("accelToolbarSetup").click();
    await settleAccelTasks(2);

    const panel = document.getElementById("setupPanel");
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll("#setupPanelTitle")).toHaveLength(1);
    expect(document.querySelector("select")).toBeNull();
    expect(panel.querySelector("#setupPanelStatus").classList.contains("sr-only")).toBe(true);

    const rolloutMount = panel.querySelector("#rolloutControlMount");
    const rollout = rolloutMount.querySelector("[role='switch']");
    expect(rolloutMount.hidden).toBe(false);
    rollout.click();
    expect(rollout.checked).toBe(true);

    const presetTrigger = panel.querySelector("#presetGrid .vb-settings-select-trigger");
    presetTrigger.click();
    document.querySelector(".vb-settings-select-menu [data-value='60-130-mph']").click();
    await settleAccelTasks(2);
    expect(selectedPreset()).toBe("60-130-mph");
    expect(rolloutMount.hidden).toBe(true);

    panel.querySelector("#speedUnitKmh").click();
    await settleAccelTasks(2);
    expect(selectedPreset()).toBe("100-200-kmh");

    presetTrigger.click();
    document.querySelector(".vb-settings-select-menu [data-value='0-100-kmh']").click();
    await settleAccelTasks(2);
    expect(rolloutMount.hidden).toBe(false);
    expect(rollout.checked).toBe(true);

    const advancedToggle = panel.querySelector("#accelAdvancedToggle");
    const advancedPanel = panel.querySelector("#accelAdvancedPanel");
    expect(advancedPanel.hidden).toBe(true);
    advancedToggle.click();
    expect(advancedPanel.hidden).toBe(false);
    expect(advancedToggle.getAttribute("aria-expanded")).toBe("true");

    const notes = panel.querySelector("#runNotes");
    notes.value = "Dry road";
    notes.dispatchEvent(new Event("input", { bubbles: true }));
    expect(panel.querySelector("#accelAdvancedSummary").textContent).toContain("Notes added");

    presetTrigger.click();
    expect(document.querySelector(".vb-settings-select-menu").hidden).toBe(false);
    panel.querySelector("#closeSetupPanel").click();
    expect(document.querySelector(".vb-settings-select-menu").hidden).toBe(true);

    const menu = document.querySelector(".vb-settings-select-menu");
    mounted.unmount();
    expect(menu.isConnected).toBe(false);
  }, 40000);
});
