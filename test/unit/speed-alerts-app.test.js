import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appControl,
  createAppLauncher,
  createAppRuntime,
  createShellAppRuntimeManager,
} from "../../src/app-platform/index.js";
import {
  SPEED_ALERTS_APP_ID,
  SPEED_ALERTS_SETTINGS_KEY,
  createSpeedAlertsApp,
} from "../../src/apps/speed-alerts/index.js";
import { createSpeedAlertPanel } from "../../src/speed/speed-alert-panel.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { initFloatingTools } from "../../src/shared/floating-tools.js";
import { initSharedStartMenu } from "../../src/shared/start-menu.js";

function makeManifest(overrides = {}) {
  return {
    id: SPEED_ALERTS_APP_ID,
    title: "Speed Alerts",
    shortTitle: "Alerts",
    description: "Speed Alerts test manifest.",
    kind: "tool-app",
    version: "1.0.0",
    icon: "<svg></svg>",
    i18nKey: "speedAlertsTitle",
    surfaces: ["shell-window"],
    order: 1,
    permissions: ["alerts.speed", "settings.read", "i18n.read"],
    services: ["drivingAlerts", "settings", "i18n"],
    window: {
      shellWindowId: "speed-alerts",
      mode: "floating",
      defaultBounds: { left: 0, top: 0, width: 380, height: 360 },
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

function createGpsServiceStub({ emitInitial = true } = {}) {
  const snapshot = {
    status: "idle",
    lastPosition: null,
    normalized: null,
    lastError: null,
    lastCallbackAtMs: 0,
    subscriberCount: 0,
    nativeWatchActive: false,
    consumers: [],
  };
  return {
    watchPosition: vi.fn(() => 1),
    clearWatch: vi.fn(),
    startConsumer: vi.fn(() => vi.fn()),
    stopConsumer: vi.fn(),
    subscribe: vi.fn((listener) => {
      if (emitInitial) listener(snapshot);
      return vi.fn();
    }),
    getSnapshot: vi.fn(() => snapshot),
    getCurrentPosition: vi.fn(() => null),
    requestHighAccuracy: vi.fn(() => vi.fn()),
    releaseHighAccuracy: vi.fn(),
    installGlobalShim: vi.fn(() => true),
    destroy: vi.fn(),
  };
}

function createDrivingAlertServiceStub(overrides = {}) {
  let snapshot = {
    status: "idle",
    currentSpeedMs: 22.352,
    nearestTrapDistanceM: null,
    nearestTrapSpeedKph: null,
    cameraApproachState: "none",
    cameraApproachReason: "no-candidate",
    cameraDatabaseStatus: { status: "idle" },
    preferences: {
      unit: "kmh",
      distanceUnit: "m",
      alertEnabled: false,
      alertLimitMs: 27.7777777778,
      alertSoundEnabled: true,
      audioMuted: false,
      trapAlertEnabled: true,
      trapAlertDistanceM: 500,
      trapSoundEnabled: true,
    },
    audio: {},
    ...overrides,
  };
  const listeners = new Set();
  const emit = (next = {}) => {
    snapshot = {
      ...snapshot,
      ...next,
      preferences: {
        ...snapshot.preferences,
        ...(next.preferences || {}),
      },
    };
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  const service = {
    emit,
    start: vi.fn(() => emit({ status: "active" })),
    stop: vi.fn(() => emit({ status: "idle" })),
    getSnapshot: vi.fn(() => snapshot),
    primeAudioFromUserGesture: vi.fn(async () => {
      emit({ audio: { backgroundAudioArmed: true } });
      return true;
    }),
    setAlertSoundEnabled: vi.fn((value) => emit({ preferences: { alertSoundEnabled: Boolean(value) } })),
    setManualAlertEnabled: vi.fn((value) => emit({ preferences: { alertEnabled: Boolean(value) } })),
    setManualAlertLimitMs: vi.fn((value) => emit({ preferences: { alertLimitMs: Number(value) } })),
    setMuted: vi.fn((value) => emit({ preferences: { audioMuted: Boolean(value) } })),
    setTrapAlertDistanceM: vi.fn((value) => emit({ preferences: { trapAlertDistanceM: Number(value) } })),
    setTrapAlertEnabled: vi.fn((value) => emit({ preferences: { trapAlertEnabled: Boolean(value) } })),
    setTrapSoundEnabled: vi.fn((value) => emit({ preferences: { trapSoundEnabled: Boolean(value) } })),
    setUnits: vi.fn((units = {}) => emit({ preferences: units })),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }),
    destroy: vi.fn(),
  };
  return service;
}

function createShellHarness(baseContext = {}) {
  const shellManager = createShellWindowManager({
    root: document.body,
    storeOptions: { storage: localStorage, migrateLegacy: false },
  });
  const shellAppRuntimeManager = createShellAppRuntimeManager({
    shellManager,
    baseContext,
  });
  const launcher = createAppLauncher({
    shellManager,
    shellAppRuntimeManager,
  });
  shellAppRuntimeManager.setLauncher(launcher);
  return { shellManager, shellAppRuntimeManager, launcher };
}

describe("Speed Alerts OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = "";
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
    delete window.__vatioboardDrivingAlerts;
  });

  afterEach(() => {
    window.__vatioboardRouter?.destroy?.();
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
    delete window.__vatioboardDrivingAlerts;
    vi.restoreAllMocks();
  });

  it("opens vatio.speedAlerts through the manifest-backed launcher and creates a runtime", () => {
    const drivingAlertService = createDrivingAlertServiceStub();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({ drivingAlertService });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(speedAlerts.runtime?.appId).toBe(SPEED_ALERTS_APP_ID);
    expect(shellAppRuntimeManager.getRuntime(SPEED_ALERTS_APP_ID)).toBe(speedAlerts.runtime);
    expect(launcher.openApp(SPEED_ALERTS_APP_ID)).toBe(true);

    expect(shellManager.getWindow("speed-alerts")?.state).toBe("open");
    expect(document.querySelector(".speed-alert-window")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(SPEED_ALERTS_APP_ID)?.lifecycle.getState()).toBe("active");

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("prefers the runtime driving-alert service when available", () => {
    const runtimeDrivingAlerts = createDrivingAlertServiceStub();
    const injectedDrivingAlerts = createDrivingAlertServiceStub();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({
      drivingAlertService: runtimeDrivingAlerts,
    });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
      drivingAlertService: injectedDrivingAlerts,
    });
    launcher.openApp(SPEED_ALERTS_APP_ID);

    document.querySelector(".speed-alert-window-manual-switch").click();

    expect(runtimeDrivingAlerts.setManualAlertEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ fromUserGesture: true }));
    expect(injectedDrivingAlerts.setManualAlertEnabled).not.toHaveBeenCalled();

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("uses the runtime GPS service when it owns the driving-alert service", () => {
    const gpsService = createGpsServiceStub({ emitInitial: false });
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({ gpsService });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(SPEED_ALERTS_APP_ID);

    document.querySelector(".speed-alert-window-manual-switch").click();

    expect(gpsService.startConsumer).toHaveBeenCalledWith("speed-alerts", expect.objectContaining({
      enableHighAccuracy: true,
      reason: "driving-alerts",
    }));

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps legacy start-menu and floating-tool launch paths working", () => {
    const { shellManager, shellAppRuntimeManager } = createShellHarness({
      drivingAlertService: createDrivingAlertServiceStub(),
    });
    const mount = document.createElement("div");
    document.body.append(mount);
    const floatingTools = initFloatingTools({
      mount,
      shellManager,
      shellAppRuntimeManager,
    });
    const startMenu = initSharedStartMenu({ floatingTools, mount });

    startMenu.list.querySelector("[data-start-action='speed-alerts']").click();
    expect(shellManager.getWindow("speed-alerts")?.state).toBe("open");
    expect(shellAppRuntimeManager.getRuntime(SPEED_ALERTS_APP_ID)?.lifecycle.getState()).toBe("active");

    shellManager.closeWindow("speed-alerts");
    floatingTools.toggleSpeedAlerts();
    expect(shellManager.getWindow("speed-alerts")?.state).toBe("open");
    expect(document.querySelector(".speed-alert-window")?.hidden).toBe(false);

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("does not stop active alerts when the Speed Alerts panel is minimized or closed", () => {
    const drivingAlertService = createDrivingAlertServiceStub();
    drivingAlertService.start();
    drivingAlertService.stop.mockClear();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({ drivingAlertService });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(SPEED_ALERTS_APP_ID);

    shellManager.minimizeWindow("speed-alerts");
    expect(document.querySelector(".speed-alert-window")?.hidden).toBe(true);
    shellManager.closeWindow("speed-alerts");

    expect(shellManager.getWindow("speed-alerts")?.state).toBe("closed");
    expect(document.querySelector(".speed-alert-window")?.hidden).toBe(true);
    expect(drivingAlertService.stop).not.toHaveBeenCalled();
    expect(drivingAlertService.getSnapshot()).toMatchObject({ status: "active" });

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("navigates from Speed Alerts to the full-screen Map route", () => {
    const { shellManager, shellAppRuntimeManager } = createShellHarness({
      drivingAlertService: createDrivingAlertServiceStub(),
    });
    const floatingTools = initFloatingTools({
      mount: document.body,
      shellManager,
      shellAppRuntimeManager,
    });

    floatingTools.openSpeedAlerts();
    document.querySelector(".speed-alert-window-map").click();

    expect(window.location.pathname).toBe("/map");
    expect(shellManager.getWindow("camera-map")).toBeNull();
    expect(document.querySelector("[data-vb-shell-window='camera-map']")).toBeNull();

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("preserves audio priming through the driving-alert service", () => {
    const drivingAlertService = createDrivingAlertServiceStub();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({ drivingAlertService });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(SPEED_ALERTS_APP_ID);

    document.querySelector(".speed-alert-window-enable-audio").click();

    expect(drivingAlertService.primeAudioFromUserGesture).toHaveBeenCalledTimes(1);

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps explicit alert-off and mute controls as the way to stop alert behavior", () => {
    const drivingAlertService = createDrivingAlertServiceStub();
    drivingAlertService.emit({
      status: "active",
      audio: { backgroundAudioArmed: true },
      preferences: {
        alertEnabled: true,
        audioMuted: false,
        trapAlertEnabled: true,
      },
    });
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({ drivingAlertService });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(SPEED_ALERTS_APP_ID);

    document.querySelector(".speed-alert-window-manual-switch").click();
    document.querySelector(".speed-alert-window-audio-switch").click();
    document.querySelector(".speed-alert-window-trap-switch").click();

    expect(drivingAlertService.setManualAlertEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));
    expect(drivingAlertService.setMuted).toHaveBeenCalledWith(true, expect.objectContaining({ fromUserGesture: true }));
    expect(drivingAlertService.setTrapAlertEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("permission revocation blocks new runtime alert API calls without stopping an active alert flow", () => {
    const drivingAlertService = createDrivingAlertServiceStub();
    drivingAlertService.start();
    drivingAlertService.stop.mockClear();
    const runtime = createAppRuntime({
      manifest: makeManifest({
        permissions: ["alerts.speed", "settings.read", "settings.write", "i18n.read"],
        services: ["drivingAlerts", "settings", "i18n"],
      }),
      baseContext: { drivingAlertService },
    });

    expect(runtime.services.drivingAlerts?.setMuted?.(true)).toMatchObject({
      preferences: expect.objectContaining({ audioMuted: true }),
    });

    appControl.revokePermission(SPEED_ALERTS_APP_ID, "alerts.speed");

    expect(runtime.services.drivingAlerts?.setMuted?.(false)).toMatchObject({ status: "permission-denied" });
    expect(runtime.services.drivingAlerts?.start()).toMatchObject({ status: "permission-denied" });
    expect(drivingAlertService.stop).not.toHaveBeenCalled();
    expect(drivingAlertService.getSnapshot()).toMatchObject({ status: "active" });
  });

  it("persists Speed Alerts preferences through runtime settings while mirroring legacy settings", () => {
    const drivingAlertService = createDrivingAlertServiceStub();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({ drivingAlertService });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(SPEED_ALERTS_APP_ID);

    document.querySelector(".speed-alert-window-alert-sound-switch").click();
    document.querySelector(".speed-alert-window-trap-switch").click();
    document.querySelector("button[data-unit='mph']").click();

    const runtimeSettings = JSON.parse(
      localStorage.getItem(`vatioboard.app.${SPEED_ALERTS_APP_ID}.settings.${SPEED_ALERTS_SETTINGS_KEY}`),
    );
    expect(runtimeSettings).toMatchObject({
      alertSoundEnabled: false,
      trapAlertEnabled: false,
      unit: "mph",
    });
    expect(localStorage.getItem("vatio_speed_alert_sound_enabled")).toBe("false");
    expect(localStorage.getItem("vatio_speed_trap_alert_enabled")).toBe("false");
    expect(localStorage.getItem("vatio_speed_unit")).toBe("mph");

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("seeds legacy preferences from runtime settings when no legacy value exists", () => {
    localStorage.setItem(`vatioboard.app.${SPEED_ALERTS_APP_ID}.settings.${SPEED_ALERTS_SETTINGS_KEY}`, JSON.stringify({
      unit: "mph",
      trapAlertEnabled: false,
    }));
    const drivingAlertService = createDrivingAlertServiceStub();
    const { shellManager, shellAppRuntimeManager } = createShellHarness({ drivingAlertService });
    const speedAlerts = createSpeedAlertsApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(drivingAlertService.setUnits).toHaveBeenCalledWith({ unit: "mph" });
    expect(drivingAlertService.setTrapAlertEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ startIfNeeded: false }));
    expect(localStorage.getItem("vatio_speed_unit")).toBe("mph");
    expect(localStorage.getItem("vatio_speed_trap_alert_enabled")).toBe("false");

    speedAlerts.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("fails safely when runtime settings writes are not permitted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drivingAlertService = createDrivingAlertServiceStub();
    const runtime = createAppRuntime({
      manifest: makeManifest(),
      baseContext: { drivingAlertService },
    });
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const speedAlerts = createSpeedAlertsApp({
      runtime,
      mount: document.body,
      restoreVisibility: false,
      shellManager,
    });
    shellManager.openWindow("speed-alerts");

    document.querySelector(".speed-alert-window-audio-switch").click();

    expect(localStorage.getItem(`vatioboard.app.${SPEED_ALERTS_APP_ID}.settings.${SPEED_ALERTS_SETTINGS_KEY}`)).toBeNull();
    expect(localStorage.getItem("vatio_speed_audio_muted")).toBe("true");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[vatioboard:app:vatio.speedAlerts]"),
      expect.stringContaining("Permission denied"),
    );

    speedAlerts.destroy();
    shellManager.destroy();
  });

  it("keeps direct Speed Alert panel callers working without a runtime", () => {
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const panel = createSpeedAlertPanel({
      mount: document.body,
      shellManager,
      restoreVisibility: false,
      drivingAlertService: createDrivingAlertServiceStub(),
    });

    expect(() => shellManager.openWindow("speed-alerts")).not.toThrow();
    expect(shellManager.getWindow("speed-alerts")?.state).toBe("open");
    expect(document.querySelector(".speed-alert-window")?.hidden).toBe(false);

    panel.destroy();
    shellManager.destroy();
  });
});
