import { beforeEach, describe, it } from "vitest";
import { expectRealSpaRouteRemount, resetRealSpaSmoke } from "../helpers/real-spa-route-smoke.js";

describe("SPA Library route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "#/library",
      targetSelector: "#libraryList",
    });
  }, 40000);
});
