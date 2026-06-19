import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("loads checklist styles from the route entry before the controller mounts", () => {
    const routeEntry = readFileSync(
      join(process.cwd(), "src/apps/delivery-checklist/index.ts"),
      "utf8",
    );
    const controller = readFileSync(
      join(process.cwd(), "src/apps/delivery-checklist/delivery-checklist-app.ts"),
      "utf8",
    );

    expect(routeEntry).toContain('import "./delivery-checklist.less";');
    expect(controller).not.toContain('import "./delivery-checklist.less";');
  });
});
