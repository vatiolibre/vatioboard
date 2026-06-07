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

const boardRouteMocks = vi.hoisted(() => ({
  mountBoardRoute: vi.fn(() => ({ unmount: vi.fn() })),
  unmountBoardRoute: vi.fn(),
}));

vi.mock("../../src/board/board.js", () => boardRouteMocks);

describe("Board route OS app module", () => {
  beforeEach(() => {
    resetRouteAppTestDom();
    boardRouteMocks.mountBoardRoute.mockClear();
    boardRouteMocks.mountBoardRoute.mockReturnValue({ unmount: vi.fn() });
    boardRouteMocks.unmountBoardRoute.mockClear();
  });

  afterEach(() => {
    cleanupRouteAppTestDom();
  });

  it("uses the vatio.board manifest entry as the route app module", async () => {
    const modules = await loadRouteAppModules("../../src/apps/board/index.js");

    await expectManifestEntryResolvesRouteApp({
      modules,
      appId: "vatio.board",
      appIdExport: "BOARD_APP_ID",
      expectedRoute: "/board",
    });
  });

  it("passes scoped runtime services to the existing Board route controller", async () => {
    const modules = await loadRouteAppModules("../../src/apps/board/index.js");
    const { manifest, mounted, runtime } = await mountRouteAppWithRuntime({
      modules,
      appId: "vatio.board",
      path: "/board",
      hash: "#/board",
    });

    const boardRouteContext = boardRouteMocks.mountBoardRoute.mock.calls[0][0];
    expectCommonRuntimeSeams(boardRouteContext, { runtime, manifest });
    expectRuntimeServiceSeams(boardRouteContext, runtime, {
      authService: "auth",
      cloudSyncService: "cloudSync",
    });

    mounted.unmount();
    expect(boardRouteMocks.unmountBoardRoute).toHaveBeenCalledTimes(1);
  });

  it("preserves direct route callers without a scoped runtime", async () => {
    const modules = await loadRouteAppModules("../../src/apps/board/index.js");
    const root = createRouteTestRoot();

    const mounted = await modules.mount(root, {});

    const boardRouteContext = boardRouteMocks.mountBoardRoute.mock.calls[0][0];
    expectNoRuntimeSeams(boardRouteContext, [
      "appStorage",
      "settingsService",
      "authService",
      "cloudSyncService",
    ]);

    mounted.unmount();
  });
});
