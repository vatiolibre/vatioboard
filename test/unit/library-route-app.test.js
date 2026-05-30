import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const libraryRouteMocks = vi.hoisted(() => ({
  mountLibraryRoute: vi.fn(() => ({ unmount: vi.fn() })),
  unmountLibraryRoute: vi.fn(),
}));

vi.mock("../../src/library/library.js", () => libraryRouteMocks);

async function loadModules() {
  vi.resetModules();
  const [
    appPlatform,
    libraryApp,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/apps/library/index.js"),
  ]);
  return {
    ...appPlatform,
    ...libraryApp,
  };
}

describe("Library route OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    libraryRouteMocks.mountLibraryRoute.mockClear();
    libraryRouteMocks.mountLibraryRoute.mockReturnValue({ unmount: vi.fn() });
    libraryRouteMocks.unmountLibraryRoute.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses the vatio.library manifest entry as the route app module", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.library");
    const routeModule = await manifest.entry();

    expect(manifest.route).toBe("/library");
    expect(routeModule.LIBRARY_APP_ID).toBe("vatio.library");
    expect(routeModule.mount).toBe(modules.mount);
  });

  it("passes scoped runtime services to the existing Library route controller", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.library");
    const runtime = modules.createAppRuntime({
      manifest,
      baseContext: {},
    });
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {
      appRuntime: runtime,
      appManifest: manifest,
      route: { path: "/library", hash: "#/library", query: new URLSearchParams(), requestedPath: "/library" },
      routeSignal: new AbortController().signal,
      navigate: vi.fn(() => true),
      emitRouteVisible: vi.fn(),
    });

    const libraryRouteContext = libraryRouteMocks.mountLibraryRoute.mock.calls[0][0];
    expect(libraryRouteContext.appRuntime).toBe(runtime);
    expect(libraryRouteContext.appManifest).toBe(manifest);
    expect(libraryRouteContext.appStorage).toBe(runtime.storage);
    expect(libraryRouteContext.settingsService).toBe(runtime.services.settings);
    expect(libraryRouteContext.authService).toBe(runtime.services.auth);
    expect(libraryRouteContext.cloudSyncService).toBe(runtime.services.cloudSync);
    expect(libraryRouteContext.context.appRuntime).toBe(runtime);

    mounted.unmount();
    expect(libraryRouteMocks.unmountLibraryRoute).toHaveBeenCalledTimes(1);
  });

  it("preserves direct route callers without a scoped runtime", async () => {
    const modules = await loadModules();
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {});

    const libraryRouteContext = libraryRouteMocks.mountLibraryRoute.mock.calls[0][0];
    expect(libraryRouteContext.appRuntime).toBeNull();
    expect(libraryRouteContext.appStorage).toBeNull();
    expect(libraryRouteContext.settingsService).toBeNull();
    expect(libraryRouteContext.authService).toBeNull();
    expect(libraryRouteContext.cloudSyncService).toBeNull();

    mounted.unmount();
  });
});
