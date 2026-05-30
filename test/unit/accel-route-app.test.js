import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accelRouteMocks = vi.hoisted(() => ({
  mountAccelRoute: vi.fn(() => ({ unmount: vi.fn() })),
  unmountAccelRoute: vi.fn(),
}));

vi.mock("../../src/accel/accel.js", () => accelRouteMocks);

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

async function loadModules() {
  vi.resetModules();
  const [
    appPlatform,
    accelApp,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/apps/accel/index.js"),
  ]);
  return {
    ...appPlatform,
    ...accelApp,
  };
}

describe("Accel route OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    accelRouteMocks.mountAccelRoute.mockClear();
    accelRouteMocks.mountAccelRoute.mockReturnValue({ unmount: vi.fn() });
    accelRouteMocks.unmountAccelRoute.mockClear();
    delete window.__vatioboardGpsStore;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses the vatio.accel manifest entry as the route app module", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.accel");
    const routeModule = await manifest.entry();

    expect(manifest.route).toBe("/accel");
    expect(routeModule.ACCEL_APP_ID).toBe("vatio.accel");
    expect(routeModule.mount).toBe(modules.mount);
  });

  it("passes scoped runtime services to the existing Accel route controller", async () => {
    const modules = await loadModules();
    const gpsService = createGpsService();
    const manifest = modules.appRegistry.getApp("vatio.accel");
    const runtime = modules.createAppRuntime({
      manifest,
      baseContext: {
        gpsService,
      },
    });
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {
      appRuntime: runtime,
      appManifest: manifest,
      route: { path: "/accel", hash: "#/accel", query: new URLSearchParams(), requestedPath: "/accel" },
      routeSignal: new AbortController().signal,
      navigate: vi.fn(() => true),
      emitRouteVisible: vi.fn(),
    });

    const accelRouteContext = accelRouteMocks.mountAccelRoute.mock.calls[0][0];
    expect(accelRouteContext.appRuntime).toBe(runtime);
    expect(accelRouteContext.appManifest).toBe(manifest);
    expect(accelRouteContext.appStorage).toBe(runtime.storage);
    expect(accelRouteContext.gpsService).toBe(runtime.services.gps);
    expect(accelRouteContext.settingsService).toBe(runtime.services.settings);
    expect(accelRouteContext.authService).toBe(runtime.services.auth);
    expect(accelRouteContext.cloudSyncService).toBe(runtime.services.cloudSync);
    expect(accelRouteContext.context.appRuntime).toBe(runtime);

    mounted.unmount();
    expect(accelRouteMocks.unmountAccelRoute).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy GPS service fallbacks for direct route callers", async () => {
    const modules = await loadModules();
    const gpsService = createGpsService();
    window.__vatioboardGpsStore = gpsService;
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {});

    const accelRouteContext = accelRouteMocks.mountAccelRoute.mock.calls[0][0];
    expect(accelRouteContext.appRuntime).toBeNull();
    expect(accelRouteContext.appStorage).toBeNull();
    expect(accelRouteContext.gpsService).toBe(gpsService);
    expect(accelRouteContext.settingsService).toBeNull();
    expect(accelRouteContext.authService).toBeNull();
    expect(accelRouteContext.cloudSyncService).toBeNull();

    mounted.unmount();
  });
});
