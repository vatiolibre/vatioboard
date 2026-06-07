import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replayRouteMocks = vi.hoisted(() => ({
  mountReplayRoute: vi.fn(() => ({ unmount: vi.fn() })),
  unmountReplayRoute: vi.fn(),
}));

vi.mock("../../src/replay/replay.js", () => replayRouteMocks);

async function loadModules() {
  vi.resetModules();
  const [
    appPlatform,
    replayApp,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/apps/replay/index.js"),
  ]);
  return {
    ...appPlatform,
    ...replayApp,
  };
}

describe("Replay route OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    replayRouteMocks.mountReplayRoute.mockClear();
    replayRouteMocks.mountReplayRoute.mockReturnValue({ unmount: vi.fn() });
    replayRouteMocks.unmountReplayRoute.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses the vatio.replay manifest entry as the route app module", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.replay");
    const routeModule = await manifest.entry();

    expect(manifest.route).toBe("/replay");
    expect(routeModule.REPLAY_APP_ID).toBe("vatio.replay");
    expect(routeModule.mount).toBe(modules.mount);
  });

  it("passes scoped runtime services to the existing Replay route controller", async () => {
    const modules = await loadModules();
    const manifest = modules.appRegistry.getApp("vatio.replay");
    const driveRecordingService = {
      startRecording: vi.fn(),
      pauseRecording: vi.fn(),
      resumeRecording: vi.fn(),
      stopRecording: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      getSnapshot: vi.fn(() => ({ state: "idle" })),
      getCurrentSession: vi.fn(() => null),
      persistNow: vi.fn(),
      destroy: vi.fn(),
    };
    const runtime = modules.createAppRuntime({
      manifest,
      baseContext: {
        driveRecordingService,
      },
    });
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {
      appRuntime: runtime,
      appManifest: manifest,
      route: { path: "/replay", hash: "#/replay", query: new URLSearchParams(), requestedPath: "/replay" },
      routeSignal: new AbortController().signal,
      navigate: vi.fn(() => true),
      emitRouteVisible: vi.fn(),
    });

    const replayRouteContext = replayRouteMocks.mountReplayRoute.mock.calls[0][0];
    expect(replayRouteContext.appRuntime).toBe(runtime);
    expect(replayRouteContext.appManifest).toBe(manifest);
    expect(replayRouteContext.appStorage).toBe(runtime.storage);
    expect(replayRouteContext.settingsService).toBe(runtime.services.settings);
    expect(replayRouteContext.authService).toBe(runtime.services.auth);
    expect(replayRouteContext.cloudSyncService).toBe(runtime.services.cloudSync);
    expect(replayRouteContext.driveRecordingService).toBe(runtime.services.driveRecording);
    expect(replayRouteContext.context.appRuntime).toBe(runtime);

    mounted.unmount();
    expect(replayRouteMocks.unmountReplayRoute).toHaveBeenCalledTimes(1);
  });

  it("preserves direct route callers without a scoped runtime", async () => {
    const modules = await loadModules();
    const root = document.createElement("main");
    document.body.append(root);

    const mounted = await modules.mount(root, {});

    const replayRouteContext = replayRouteMocks.mountReplayRoute.mock.calls[0][0];
    expect(replayRouteContext.appRuntime).toBeNull();
    expect(replayRouteContext.appStorage).toBeNull();
    expect(replayRouteContext.settingsService).toBeNull();
    expect(replayRouteContext.authService).toBeNull();
    expect(replayRouteContext.cloudSyncService).toBeNull();
    expect(replayRouteContext.driveRecordingService).toBeNull();

    mounted.unmount();
  });
});
