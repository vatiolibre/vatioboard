import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boardRouteMocks = vi.hoisted(() => ({
  mountBoardRoute: vi.fn(() => ({ unmount: vi.fn() })),
  unmountBoardRoute: vi.fn(),
}));

vi.mock("../../src/board/board.js", () => boardRouteMocks);

async function loadModules() {
  vi.resetModules();
  const [
    appPlatform,
    boardApp,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/apps/board/index.js"),
  ]);
  return {
    ...appPlatform,
    ...boardApp,
  };
}

describe("Board route OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    boardRouteMocks.mountBoardRoute.mockClear();
    boardRouteMocks.mountBoardRoute.mockReturnValue({ unmount: vi.fn() });
    boardRouteMocks.unmountBoardRoute.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses the vatio.board manifest entry as the route app module", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.board");
    const routeModule = await manifest.entry();

    expect(manifest.route).toBe("/board");
    expect(routeModule.BOARD_APP_ID).toBe("vatio.board");
    expect(routeModule.mount).toBe(modules.mount);
  });

  it("passes scoped runtime services to the existing Board route controller", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.board");
    const runtime = modules.createAppRuntime({
      manifest,
      baseContext: {},
    });
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {
      appRuntime: runtime,
      appManifest: manifest,
      route: { path: "/board", hash: "#/board", query: new URLSearchParams(), requestedPath: "/board" },
      routeSignal: new AbortController().signal,
      navigate: vi.fn(() => true),
      emitRouteVisible: vi.fn(),
    });

    const boardRouteContext = boardRouteMocks.mountBoardRoute.mock.calls[0][0];
    expect(boardRouteContext.appRuntime).toBe(runtime);
    expect(boardRouteContext.appManifest).toBe(manifest);
    expect(boardRouteContext.appStorage).toBe(runtime.storage);
    expect(boardRouteContext.settingsService).toBe(runtime.services.settings);
    expect(boardRouteContext.authService).toBe(runtime.services.auth);
    expect(boardRouteContext.cloudSyncService).toBe(runtime.services.cloudSync);
    expect(boardRouteContext.context.appRuntime).toBe(runtime);

    mounted.unmount();
    expect(boardRouteMocks.unmountBoardRoute).toHaveBeenCalledTimes(1);
  });

  it("preserves direct route callers without a scoped runtime", async () => {
    const modules = await loadModules();
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {});

    const boardRouteContext = boardRouteMocks.mountBoardRoute.mock.calls[0][0];
    expect(boardRouteContext.appRuntime).toBeNull();
    expect(boardRouteContext.appStorage).toBeNull();
    expect(boardRouteContext.settingsService).toBeNull();
    expect(boardRouteContext.authService).toBeNull();
    expect(boardRouteContext.cloudSyncService).toBeNull();

    mounted.unmount();
  });
});
