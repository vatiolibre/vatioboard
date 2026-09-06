import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speedRouteMocks = vi.hoisted(() => ({
  mountSpeedRoute: vi.fn(() => ({ unmount: vi.fn() })),
  unmountSpeedRoute: vi.fn(),
}));

vi.mock("../../src/speed/speed.js", () => speedRouteMocks);

function createGpsService() {
  return {
    watchPosition: vi.fn(() => 101),
    clearWatch: vi.fn(),
    startConsumer: vi.fn(() => vi.fn()),
    stopConsumer: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({
      status: "idle",
      lastPosition: null,
      normalized: null,
      lastError: null,
      lastCallbackAtMs: 0,
      subscriberCount: 0,
      nativeWatchActive: false,
      consumers: [],
    })),
    getCurrentPosition: vi.fn(() => null),
    requestHighAccuracy: vi.fn(() => vi.fn()),
    releaseHighAccuracy: vi.fn(),
    installGlobalShim: vi.fn(() => true),
    destroy: vi.fn(),
  };
}

function createDriveRecordingService() {
  return {
    startRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    stopRecording: vi.fn().mockResolvedValue({ state: "idle" }),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ state: "idle" })),
    getCurrentSession: vi.fn(() => null),
    persistNow: vi.fn().mockResolvedValue(null),
    destroy: vi.fn(),
  };
}

function createDrivingAlertService() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({
      status: "idle",
      preferences: {},
    })),
    destroy: vi.fn(),
  };
}

function createDrivingTelemetryService() {
  return {
    start: vi.fn(),
    resetTrip: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeSamples: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ status: "idle", tripId: "trip-1" })),
    destroy: vi.fn(),
  };
}

async function loadModules() {
  vi.resetModules();
  const [
    appPlatform,
    speedApp,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/apps/speed/index.js"),
  ]);
  return {
    ...appPlatform,
    ...speedApp,
  };
}

describe("Speed route OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    speedRouteMocks.mountSpeedRoute.mockClear();
    speedRouteMocks.mountSpeedRoute.mockReturnValue({ unmount: vi.fn() });
    speedRouteMocks.unmountSpeedRoute.mockClear();
    delete window.__vatioboardGpsStore;
    delete window.__vatioboardDriveRecording;
    delete window.__vatioboardDrivingAlerts;
    delete window.__vatioboardDrivingTelemetry;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses the vatio.speed manifest entry as the route app module", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.speed");
    const routeModule = await manifest.entry();

    expect(manifest.route).toBe("/");
    expect(manifest.aliases).toContain("/speed");
    expect(routeModule.SPEED_APP_ID).toBe("vatio.speed");
    expect(routeModule.mount).toBe(modules.mount);
  });

  it("passes scoped runtime services to the existing Speed route controller", async () => {
    const modules = await loadModules();
    const gpsService = createGpsService();
    const driveRecordingService = createDriveRecordingService();
    const drivingAlertService = createDrivingAlertService();
    const drivingTelemetryService = createDrivingTelemetryService();
    const manifest = modules.appRegistry.getApp("vatio.speed");
    const runtime = modules.createAppRuntime({
      manifest,
      baseContext: {
        gpsService,
        driveRecordingService,
        drivingAlertService,
        drivingTelemetryService,
      },
    });
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {
      appRuntime: runtime,
      appManifest: manifest,
      route: { path: "/", url: "/", query: new URLSearchParams(), requestedPath: "/speed" },
      routeSignal: new AbortController().signal,
      navigate: vi.fn(() => true),
      emitRouteVisible: vi.fn(),
    });

    const speedRouteContext = speedRouteMocks.mountSpeedRoute.mock.calls[0][0];
    expect(speedRouteContext.appRuntime).toBe(runtime);
    expect(speedRouteContext.appManifest).toBe(manifest);
    expect(speedRouteContext.appStorage).toBe(runtime.storage);
    expect(speedRouteContext.gpsService).toBe(runtime.services.gps);
    expect(speedRouteContext.driveRecordingService).toBe(runtime.services.driveRecording);
    expect(speedRouteContext.drivingAlertService).toBe(runtime.services.drivingAlerts);
    expect(speedRouteContext.drivingTelemetryService).toBe(runtime.services.drivingTelemetry);
    expect(speedRouteContext.settingsService).toBe(runtime.services.settings);
    expect(speedRouteContext.cloudSyncService).toBe(runtime.services.cloudSync);
    expect(speedRouteContext.logger).toBe(runtime.logger);
    expect(speedRouteContext.context.appRuntime).toBe(runtime);

    mounted.unmount();
    expect(speedRouteMocks.unmountSpeedRoute).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy global service fallbacks for direct route callers", async () => {
    const modules = await loadModules();
    const gpsService = createGpsService();
    const driveRecordingService = createDriveRecordingService();
    const drivingAlertService = createDrivingAlertService();
    const drivingTelemetryService = createDrivingTelemetryService();
    window.__vatioboardGpsStore = gpsService;
    window.__vatioboardDriveRecording = driveRecordingService;
    window.__vatioboardDrivingAlerts = drivingAlertService;
    window.__vatioboardDrivingTelemetry = drivingTelemetryService;
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {});

    const speedRouteContext = speedRouteMocks.mountSpeedRoute.mock.calls[0][0];
    expect(speedRouteContext.appRuntime).toBeNull();
    expect(speedRouteContext.appStorage).toBeNull();
    expect(speedRouteContext.gpsService).toBe(gpsService);
    expect(speedRouteContext.driveRecordingService).toBe(driveRecordingService);
    expect(speedRouteContext.drivingAlertService).toBe(drivingAlertService);
    expect(speedRouteContext.drivingTelemetryService).toBe(drivingTelemetryService);
    expect(speedRouteContext.settingsService).toBeNull();
    expect(speedRouteContext.cloudSyncService).toBeNull();
    expect(speedRouteContext.logger).toBeNull();

    mounted.unmount();
  });
});
