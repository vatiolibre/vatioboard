import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupRouteAppTestDom,
  expectManifestEntryResolvesRouteApp,
  loadRouteAppModules,
  resetRouteAppTestDom,
} from "../helpers/route-app-test-utils.js";

describe("Delivery checklist route OS app module", () => {
  beforeEach(() => {
    resetRouteAppTestDom();
  });

  afterEach(() => {
    cleanupRouteAppTestDom();
  });

  it("uses the vatio.deliveryChecklist manifest entry as the route app module", async () => {
    const modules = await loadRouteAppModules("../../src/apps/delivery-checklist/index.js");

    await expectManifestEntryResolvesRouteApp({
      modules,
      appId: "vatio.deliveryChecklist",
      appIdExport: "DELIVERY_CHECKLIST_APP_ID",
      expectedRoute: "/delivery-checklist",
    });
  });
});
