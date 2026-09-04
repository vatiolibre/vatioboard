import { beforeEach, describe, it } from "vitest";
import { expectRealSpaRouteRemount, resetRealSpaSmoke } from "../helpers/real-spa-route-smoke.js";

describe("SPA Board route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable through mixed SPA route changes", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "/board",
      targetSelector: "#pad",
      sequence: ["/board", "/", "/library", "/replay", "/accel", "/board"],
    });
  }, 40000);
});
