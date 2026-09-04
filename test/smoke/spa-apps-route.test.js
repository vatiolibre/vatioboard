import { beforeEach, describe, expect, it } from "vitest";
import { expectRealSpaRouteRemount, resetRealSpaSmoke } from "../helpers/real-spa-route-smoke.js";

describe("SPA Apps route smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("lists installed VatioBoard OS apps", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "/apps",
      targetSelector: "[data-vb-app-manager] [data-app-list] [data-app-id='vatio.speed']",
      sequence: ["/board", "/apps"],
    });

    expect(document.querySelector("[data-app-id='vatio.appManager']")).toBeTruthy();
    expect(document.querySelector("[data-app-id='vatio.calculator']")).toBeTruthy();
    expect(document.querySelector("[data-app-count]")?.textContent).toMatch(/\d+ \/ \d+/);
  }, 40000);
});
