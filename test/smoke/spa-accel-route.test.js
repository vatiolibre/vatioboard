import { beforeEach, describe, expect, it } from "vitest";
import { expectRealSpaRouteRemount, resetRealSpaSmoke } from "../helpers/real-spa-route-smoke.js";

describe("SPA Accel route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "#/accel",
      targetSelector: "#presetGrid .accel-preset-btn",
      sequence: ["#/board", "#/accel", "#/board", "#/accel"],
    });

    expect(document.querySelector("#liveSpeedDial")?.width).toBeGreaterThan(0);
    expect(document.querySelectorAll("#presetGrid .accel-preset-btn").length).toBeGreaterThan(1);
  }, 40000);
});
