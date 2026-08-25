import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRegistry, createAppRuntime } from "../../src/app-platform/index.js";
import { createWazeRouteMountContext, WAZE_APP_ID } from "../../src/apps/waze/index.js";
import { IconWaze } from "../../src/icons.js";

function createGpsService() {
  return {
    watchPosition: vi.fn(() => 1),
    clearWatch: vi.fn(),
    startConsumer: vi.fn(() => vi.fn()),
    stopConsumer: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ status: "idle", normalized: null })),
    getCurrentPosition: vi.fn(() => null),
    requestHighAccuracy: vi.fn(() => vi.fn()),
    releaseHighAccuracy: vi.fn(),
    installGlobalShim: vi.fn(() => true),
    destroy: vi.fn(),
  };
}

function createDrivingAlertService() {
  return {
    start: vi.fn(() => ({ status: "idle", started: true, currentSpeedMs: 0 })),
    stop: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ status: "idle", started: false, currentSpeedMs: 0 })),
    destroy: vi.fn(),
  };
}

function wrapContext(context) {
  return {
    root: document.createElement("main"),
    context,
    cleanup: { add: (cleanup) => cleanup },
  };
}

describe("Waze route OS app module", () => {
  beforeEach(() => {
    delete window.__vatioboardGpsStore;
    delete window.__vatioboardDrivingAlerts;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__vatioboardGpsStore;
    delete window.__vatioboardDrivingAlerts;
  });

  it("registers the network-dependent full-work-area route", async () => {
    const manifest = appRegistry.getApp(WAZE_APP_ID);
    const entry = await manifest.entry();

    expect(manifest).toMatchObject({
      id: "vatio.waze",
      route: "/waze",
      order: 15,
      localFirst: false,
      teslaOptimized: true,
      offlineCapable: false,
      surfaces: ["main-route", "start-menu", "launcher"],
      metadata: { networkDependent: true },
    });
    expect(entry.WAZE_APP_ID).toBe(WAZE_APP_ID);
    expect(manifest.icon).toBe(IconWaze);
    expect(manifest.icon).toContain('viewBox="0 0 640 640"');
  });

  it("resolves scoped GPS and driving-alert gateways from its own runtime", () => {
    const gpsService = createGpsService();
    const drivingAlertService = createDrivingAlertService();
    const manifest = appRegistry.getApp(WAZE_APP_ID);
    const runtime = createAppRuntime({
      manifest,
      baseContext: { gpsService, drivingAlertService },
    });
    const routeContext = createWazeRouteMountContext(wrapContext({
      appRuntime: runtime,
      appManifest: manifest,
    }));

    expect(routeContext.appRuntime).toBe(runtime);
    expect(routeContext.appManifest).toBe(manifest);
    expect(routeContext.gpsService).toBe(runtime.services.gps);
    expect(routeContext.drivingAlertService).toBe(runtime.services.drivingAlerts);
    expect(routeContext.translate("wazeMap", "Waze map")).toBe("Waze map");
  });

  it("keeps global service fallbacks for direct route callers", () => {
    const gpsService = createGpsService();
    const drivingAlertService = createDrivingAlertService();
    window.__vatioboardGpsStore = gpsService;
    window.__vatioboardDrivingAlerts = drivingAlertService;

    const routeContext = createWazeRouteMountContext(wrapContext({}));
    expect(routeContext.appRuntime).toBeNull();
    expect(routeContext.gpsService).toBe(gpsService);
    expect(routeContext.drivingAlertService).toBe(drivingAlertService);
  });
});
