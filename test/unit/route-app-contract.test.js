import { beforeEach, describe, expect, it } from "vitest";

import {
  expectManifestEntryResolvesRouteApp,
  loadRouteAppModules,
  resetRouteAppTestDom,
} from "../helpers/route-app-test-utils.js";

const ROUTE_APPS = [
  {
    appId: "vatio.speed",
    appIdExport: "SPEED_APP_ID",
    contextFactoryExport: "createSpeedRouteMountContext",
    expectedAliases: ["/speed"],
    expectedRoute: "/",
    modulePath: "../../src/apps/speed/index.js",
    viewPath: "../../src/app/views/SpeedView.js",
  },
  {
    appId: "vatio.waze",
    appIdExport: "WAZE_APP_ID",
    contextFactoryExport: "createWazeRouteMountContext",
    expectedRoute: "/waze",
    modulePath: "../../src/apps/waze/index.js",
    viewPath: "../../src/app/views/WazeView.js",
  },
  {
    appId: "vatio.board",
    appIdExport: "BOARD_APP_ID",
    contextFactoryExport: "createBoardRouteMountContext",
    expectedRoute: "/board",
    modulePath: "../../src/apps/board/index.js",
    viewPath: "../../src/app/views/BoardView.js",
  },
  {
    appId: "vatio.library",
    appIdExport: "LIBRARY_APP_ID",
    contextFactoryExport: "createLibraryRouteMountContext",
    expectedRoute: "/library",
    modulePath: "../../src/apps/library/index.js",
    viewPath: "../../src/app/views/LibraryView.js",
  },
  {
    appId: "vatio.replay",
    appIdExport: "REPLAY_APP_ID",
    contextFactoryExport: "createReplayRouteMountContext",
    expectedRoute: "/replay",
    modulePath: "../../src/apps/replay/index.js",
    viewPath: "../../src/app/views/ReplayView.js",
  },
  {
    appId: "vatio.accel",
    appIdExport: "ACCEL_APP_ID",
    contextFactoryExport: "createAccelRouteMountContext",
    expectedRoute: "/accel",
    modulePath: "../../src/apps/accel/index.js",
    viewPath: "../../src/app/views/AccelView.js",
  },
  {
    appId: "vatio.codeRain",
    appIdExport: "CODE_RAIN_APP_ID",
    contextFactoryExport: "createCodeRainRouteMountContext",
    expectedRoute: "/code-rain",
    modulePath: "../../src/apps/code-rain/index.js",
    viewPath: "../../src/app/views/CodeRainView.js",
  },
];

describe("route app wrapper contract", () => {
  beforeEach(() => {
    resetRouteAppTestDom();
  });

  it.each(ROUTE_APPS)("$appId manifest entry and compatibility view point at the wrapper", async (config) => {
    const modules = await loadRouteAppModules(config.modulePath);
    const { routeModule } = await expectManifestEntryResolvesRouteApp({
      modules,
      appId: config.appId,
      appIdExport: config.appIdExport,
      expectedRoute: config.expectedRoute,
      expectedAliases: config.expectedAliases || [],
    });
    const viewModule = await import(config.viewPath);

    expect(typeof routeModule[config.contextFactoryExport]).toBe("function");
    expect(viewModule.mount).toBe(modules.mount);
  });

  it.each(ROUTE_APPS)("$appId ignores a runtime scoped to another app", async (config) => {
    const modules = await loadRouteAppModules(config.modulePath);
    const routeManifest = modules.appRegistry.getApp(config.appId);
    const otherManifest = modules.appRegistry.getApp("vatio.appManager");
    const otherRuntime = modules.createAppRuntime({ manifest: otherManifest, baseContext: {} });

    const routeContext = modules[config.contextFactoryExport]({
      root: document.createElement("main"),
      context: {
        appManifest: routeManifest,
        appRuntime: otherRuntime,
      },
      cleanup: {
        add: (cleanup) => cleanup,
      },
    });

    expect(routeContext.appRuntime).toBeNull();
    expect(routeContext.appManifest).toBe(routeManifest);
  });
});
