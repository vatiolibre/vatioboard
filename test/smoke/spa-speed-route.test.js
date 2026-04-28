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

    const { snapshots, targetSnapshots } = await expectRealSpaRouteRemount({
      targetHash: "#/speed",
      targetSelector: '.gauge-card[data-primary-view="gauge"] #speedValue',
      sequence: ["#/board", "#/speed", "#/board", "#/speed"],
    });
    const firstSpeed = targetSnapshots[0];
    const secondSpeed = targetSnapshots[1];
    const boardAfterFirstSpeed = snapshots[2];

    expect(document.querySelector("#gaugeStage")?.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector("#wazeStage")?.getAttribute("aria-hidden")).toBe("true");
    expect(maplibre.maps).toHaveLength(2);
    expect(maplibre.maps.filter((map) => !map.removed)).toHaveLength(1);
    expect(maplibre.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(boardAfterFirstSpeed.activeWatchCount).toBe(0);
    expect(secondSpeed.activeWatchCount).toBe(1);
    expect(secondSpeed.activeIntervalCount).toBeLessThanOrEqual(firstSpeed.activeIntervalCount);
    expect(secondSpeed.activeRafCount).toBeLessThanOrEqual(firstSpeed.activeRafCount);
    expect(secondSpeed.listeners.windowSingleTabOwnership).toBe(
      firstSpeed.listeners.windowSingleTabOwnership
    );
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
