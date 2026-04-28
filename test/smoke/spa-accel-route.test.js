import { beforeEach, describe, it } from "vitest";
import { expectRealSpaRouteRemount, resetRealSpaSmoke } from "../helpers/real-spa-route-smoke.js";

describe("SPA Accel route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "#/accel",
      targetSelector: "#armRun",
      sequence: ["#/board", "#/accel", "#/board", "#/accel"],
    });
  }, 40000);
});
