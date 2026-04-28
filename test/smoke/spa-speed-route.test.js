import { beforeEach, describe, expect, it } from "vitest";
import {
  expectRealSpaRouteRemount,
  getRealSpaSmokeMocks,
  resetRealSpaSmoke,
} from "../helpers/real-spa-route-smoke.js";

describe("SPA Speed route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    const { maplibre } = getRealSpaSmokeMocks();

    await expectRealSpaRouteRemount({
      targetHash: "#/speed",
      targetSelector: '.gauge-card[data-primary-view="gauge"] #speedValue',
      sequence: ["#/board", "#/speed", "#/board", "#/speed"],
    });

    expect(document.querySelector("#gaugeStage")?.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector("#wazeStage")?.getAttribute("aria-hidden")).toBe("true");
    expect(maplibre.maps).toHaveLength(2);
  }, 40000);

  it("restores the Waze primary stage after a remount", async () => {
    localStorage.setItem("vatio_speed_primary_view", "waze");

    await expectRealSpaRouteRemount({
      targetHash: "#/speed",
      targetSelector: '.gauge-card[data-primary-view="waze"] #wazeStage',
      sequence: ["#/board", "#/speed", "#/board", "#/speed"],
    });

    expect(document.querySelector("#gaugeStage")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("#wazeStage")?.getAttribute("aria-hidden")).toBe("false");
  }, 40000);
});
