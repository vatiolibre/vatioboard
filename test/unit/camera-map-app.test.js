import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppLauncher,
  createAppRuntime,
  createShellAppRuntimeManager,
} from "../../src/app-platform/index.js";
import {
  CAMERA_MAP_APP_ID,
  createCameraMapApp,
  createCameraMapSettingsStore,
} from "../../src/apps/camera-map/index.js";
import { createCameraMapWidget } from "../../src/speed/camera-map-widget.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { initFloatingTools } from "../../src/shared/floating-tools.js";
import { initSharedStartMenu } from "../../src/shared/start-menu.js";

function makeManifest(overrides = {}) {
  return {
    id: CAMERA_MAP_APP_ID,
    title: "Camera Map",
    shortTitle: "Camera Map",
    description: "Camera Map test manifest.",
    kind: "tool-app",
    version: "1.0.0",
    icon: "<svg></svg>",
    i18nKey: "cameraMapTitle",
    surfaces: ["shell-window"],
    order: 1,
    permissions: ["settings.read", "i18n.read"],
    services: ["settings", "i18n"],
    window: {
      shellWindowId: "camera-map",
      mode: "floating",
      defaultBounds: { left: 0, top: 0, width: 560, height: 420 },
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

function createGpsServiceStub(position = null) {
  const snapshot = {
    status: position ? "active" : "idle",
    lastPosition: null,
    normalized: position,
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
      listener(snapshot);
      return vi.fn();
    }),
    getSnapshot: vi.fn(() => snapshot),
    getCurrentPosition: vi.fn(() => position),
    requestHighAccuracy: vi.fn(() => vi.fn()),
    releaseHighAccuracy: vi.fn(),
    installGlobalShim: vi.fn(() => true),
    destroy: vi.fn(),
  };
}

function createDrivingAlertServiceStub() {
  const snapshot = {
    status: "idle",
    currentSpeedMs: 0,
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
  };
  return {
    start: vi.fn(() => snapshot),
    stop: vi.fn(() => snapshot),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listener(snapshot);
      return vi.fn();
    }),
    primeAudioFromUserGesture: vi.fn(),
    setAlertSoundEnabled: vi.fn(() => snapshot),
    setManualAlertEnabled: vi.fn(() => snapshot),
    setManualAlertLimitMs: vi.fn(() => snapshot),
    setMuted: vi.fn(() => snapshot),
    setTrapAlertDistanceM: vi.fn(() => snapshot),
    setTrapAlertEnabled: vi.fn(() => snapshot),
    setTrapSoundEnabled: vi.fn(() => snapshot),
    setUnits: vi.fn(() => snapshot),
    destroy: vi.fn(),
  };
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

describe("Camera Map OS app module", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = "";
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
    delete window.__vatioboardGpsGetCurrentPosition;
    delete window.__vatioboardSpeedGetCurrentPosition;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    window.__vatioboardRouter?.destroy?.();
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
    delete window.__vatioboardGpsGetCurrentPosition;
    delete window.__vatioboardSpeedGetCurrentPosition;
    vi.restoreAllMocks();
  });

  it("opens vatio.cameraMap through the manifest-backed launcher and creates a runtime", () => {
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const cameraMap = createCameraMapApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(cameraMap.runtime?.appId).toBe(CAMERA_MAP_APP_ID);
    expect(shellAppRuntimeManager.getRuntime(CAMERA_MAP_APP_ID)).toBe(cameraMap.runtime);
    expect(launcher.openApp(CAMERA_MAP_APP_ID)).toBe(true);

    expect(shellManager.getWindow("camera-map")?.state).toBe("open");
    expect(document.querySelector(".camera-map-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(CAMERA_MAP_APP_ID)?.lifecycle.getState()).toBe("active");

    cameraMap.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("uses the runtime GPS service when available", () => {
    const position = {
      latitude: 40.7,
      longitude: -73.9,
      accuracy: 12,
      speedMs: 8,
      headingDeg: 92,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
      stale: false,
    };
    const gpsService = createGpsServiceStub(position);
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness({ gpsService });
    const cameraMap = createCameraMapApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    launcher.openApp(CAMERA_MAP_APP_ID);

    expect(gpsService.startConsumer).toHaveBeenCalledWith("camera-map", expect.objectContaining({
      enableHighAccuracy: true,
      reason: "camera-map-open",
    }));
    expect(gpsService.getCurrentPosition).toHaveBeenCalled();
    expect(cameraMap.getNavigationState().position).toMatchObject({
      latitude: 40.7,
      longitude: -73.9,
    });

    cameraMap.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps the legacy global GPS fallback when runtime GPS is unavailable", () => {
    const getCurrentPosition = vi.fn(() => ({
      latitude: 34.05,
      longitude: -118.24,
      accuracy: 18,
      speedMs: 5,
      headingDeg: 120,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
      stale: false,
    }));
    window.__vatioboardGpsGetCurrentPosition = getCurrentPosition;
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const cameraMap = createCameraMapApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    launcher.openApp(CAMERA_MAP_APP_ID);

    expect(getCurrentPosition).toHaveBeenCalled();
    expect(cameraMap.runtime?.services.gps).toBeNull();
    expect(cameraMap.getNavigationState().position).toMatchObject({
      latitude: 34.05,
      longitude: -118.24,
    });

    cameraMap.destroy();
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
      drivingAlertService: createDrivingAlertServiceStub(),
    });
    const startMenu = initSharedStartMenu({ floatingTools, mount });

    startMenu.list.querySelector("[data-start-action='camera-map']").click();
    expect(shellManager.getWindow("camera-map")?.state).toBe("open");
    expect(shellAppRuntimeManager.getRuntime(CAMERA_MAP_APP_ID)?.lifecycle.getState()).toBe("active");

    shellManager.closeWindow("camera-map");
    floatingTools.toggleCameraMap();
    expect(shellManager.getWindow("camera-map")?.state).toBe("open");
    expect(document.querySelector(".camera-map-panel")?.hidden).toBe(false);

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps Speed Alerts-to-Camera Map launch behavior working", () => {
    const { shellManager, shellAppRuntimeManager } = createShellHarness();
    const floatingTools = initFloatingTools({
      mount: document.body,
      shellManager,
      shellAppRuntimeManager,
      drivingAlertService: createDrivingAlertServiceStub(),
    });

    floatingTools.openSpeedAlerts();
    document.querySelector(".speed-alert-window-map").click();

    expect(shellManager.getWindow("camera-map")?.state).toBe("open");
    expect(document.querySelector(".camera-map-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(CAMERA_MAP_APP_ID)?.lifecycle.getState()).toBe("active");

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("persists Camera Map preferences through runtime settings while mirroring legacy settings", () => {
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness();
    const cameraMap = createCameraMapApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(CAMERA_MAP_APP_ID);

    document.querySelector(".camera-map-orientation-toggle").click();
    document.querySelector(".camera-map-layer-button").click();
    document.querySelector("[data-overlay-id='approach']").click();

    expect(localStorage.getItem(`vatioboard.app.${CAMERA_MAP_APP_ID}.settings.orientation`)).toBe("heading-up");
    expect(localStorage.getItem("vatioboard.cameraMap.orientation.v1")).toBe("heading-up");
    expect(localStorage.getItem(`vatioboard.app.${CAMERA_MAP_APP_ID}.settings.approachLayer`)).toBe("true");
    expect(localStorage.getItem("vatioboard.cameraMap.approachLayer.v1")).toBe("true");

    cameraMap.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("uses legacy Camera Map preferences before stale runtime mirrors", () => {
    localStorage.setItem(`vatioboard.app.${CAMERA_MAP_APP_ID}.settings.orientation`, "heading-up");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "north-up");
    const { shellManager, shellAppRuntimeManager } = createShellHarness();
    const cameraMap = createCameraMapApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(cameraMap.getNavigationState().orientationMode).toBe("north-up");

    cameraMap.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("mirrors runtime Camera Map preferences into legacy storage when no legacy value exists", () => {
    localStorage.setItem(`vatioboard.app.${CAMERA_MAP_APP_ID}.settings.orientation`, "heading-up");
    const { shellManager, shellAppRuntimeManager } = createShellHarness();
    const cameraMap = createCameraMapApp({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(cameraMap.getNavigationState().orientationMode).toBe("heading-up");
    expect(localStorage.getItem("vatioboard.cameraMap.orientation.v1")).toBe("heading-up");

    cameraMap.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps direct Camera Map widget callers working without a runtime", () => {
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const cameraMap = createCameraMapWidget({
      mount: document.body,
      floating: false,
      restoreVisibility: false,
      shellManager,
    });

    expect(() => shellManager.openWindow("camera-map")).not.toThrow();
    expect(shellManager.getWindow("camera-map")?.state).toBe("open");
    expect(document.querySelector(".camera-map-panel")?.hidden).toBe(false);

    cameraMap.destroy();
    shellManager.destroy();
  });

  it("fails safely when runtime settings writes are not permitted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = createAppRuntime({
      manifest: makeManifest({
        permissions: ["settings.read", "i18n.read"],
        services: ["settings", "i18n"],
      }),
      baseContext: {},
    });
    const settingsStore = createCameraMapSettingsStore(runtime);

    expect(() => settingsStore.setBoolean?.("follow", true)).not.toThrow();
    expect(localStorage.getItem(`vatioboard.app.${CAMERA_MAP_APP_ID}.settings.follow`)).toBeNull();
    expect(localStorage.getItem("vatioboard.cameraMap.follow.v1")).toBe("true");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[vatioboard:app:vatio.cameraMap]"),
      expect.stringContaining("Permission denied"),
    );
  });
});
