import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupRouteAppTestDom,
  createRouteTestRoot,
  expectCommonRuntimeSeams,
  expectManifestEntryResolvesRouteApp,
  expectNoRuntimeSeams,
  expectRuntimeServiceSeams,
  loadRouteAppModules,
  mountRouteAppWithRuntime,
  resetRouteAppTestDom,
} from "../helpers/route-app-test-utils.js";

const libraryRouteMocks = vi.hoisted(() => ({
  mountLibraryRoute: vi.fn(() => ({ unmount: vi.fn() })),
  unmountLibraryRoute: vi.fn(),
}));

vi.mock("../../src/library/library.js", () => libraryRouteMocks);

describe("Library route OS app module", () => {
  beforeEach(() => {
    resetRouteAppTestDom();
    libraryRouteMocks.mountLibraryRoute.mockClear();
    libraryRouteMocks.mountLibraryRoute.mockReturnValue({ unmount: vi.fn() });
    libraryRouteMocks.unmountLibraryRoute.mockClear();
  });

  afterEach(() => {
    cleanupRouteAppTestDom();
  });

  it("uses the vatio.library manifest entry as the route app module", async () => {
    const modules = await loadRouteAppModules("../../src/apps/library/index.js");

    await expectManifestEntryResolvesRouteApp({
      modules,
      appId: "vatio.library",
      appIdExport: "LIBRARY_APP_ID",
      expectedRoute: "/library",
    });
  });

  it("passes scoped runtime services to the existing Library route controller", async () => {
    const modules = await loadRouteAppModules("../../src/apps/library/index.js");
    const { manifest, mounted, runtime } = await mountRouteAppWithRuntime({
      modules,
      appId: "vatio.library",
      path: "/library",
      url: "/library",
    });

    const libraryRouteContext = libraryRouteMocks.mountLibraryRoute.mock.calls[0][0];
    expectCommonRuntimeSeams(libraryRouteContext, { runtime, manifest });
    expectRuntimeServiceSeams(libraryRouteContext, runtime, {
      authService: "auth",
      cloudSyncService: "cloudSync",
    });

    mounted.unmount();
    expect(libraryRouteMocks.unmountLibraryRoute).toHaveBeenCalledTimes(1);
  });

  it("preserves direct route callers without a scoped runtime", async () => {
    const modules = await loadRouteAppModules("../../src/apps/library/index.js");
    const root = createRouteTestRoot();

    const mounted = await modules.mount(root, {});

    const libraryRouteContext = libraryRouteMocks.mountLibraryRoute.mock.calls[0][0];
    expectNoRuntimeSeams(libraryRouteContext, [
      "appStorage",
      "settingsService",
      "authService",
      "cloudSyncService",
    ]);

    mounted.unmount();
  });
});
