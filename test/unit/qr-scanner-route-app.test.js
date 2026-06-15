import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupRouteAppTestDom,
  expectManifestEntryResolvesRouteApp,
  loadRouteAppModules,
  resetRouteAppTestDom,
} from "../helpers/route-app-test-utils.js";

describe("QR scanner route OS app module", () => {
  beforeEach(() => {
    resetRouteAppTestDom();
  });

  afterEach(() => {
    cleanupRouteAppTestDom();
  });

  it("uses the vatio.qrScanner manifest entry as the route app module", async () => {
    const modules = await loadRouteAppModules("../../src/apps/qr-scanner/index.js");

    await expectManifestEntryResolvesRouteApp({
      modules,
      appId: "vatio.qrScanner",
      appIdExport: "QR_SCANNER_APP_ID",
      expectedRoute: "/qr-scanner",
    });
  });
});
