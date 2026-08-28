import { beforeEach, describe, expect, it } from "vitest";

import {
  expectRealSpaRouteRemount,
  getRealSpaResourceSnapshot,
  navigateRealSpaSmoke,
  resetRealSpaSmoke,
  settleRealSpaSmoke,
} from "../helpers/real-spa-route-smoke.js";

describe("SPA Waze route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("remounts without leaking its route-owned driving resources", async () => {
    const { snapshots, targetSnapshots } = await expectRealSpaRouteRemount({
      targetHash: "#/waze",
      targetSelector: "[data-waze-app] #wazeFrame",
      sequence: ["#/board", "#/waze", "#/board", "#/waze"],
    });

    expect(targetSnapshots[0].activeWatchCount).toBe(1);
    expect(targetSnapshots[1].activeWatchCount).toBe(1);
    expect(snapshots[2].activeWatchCount).toBe(1);
    expect(snapshots[2].activeRafCount).toBe(0);
    expect(window.__vatioboardDrivingAlerts?.getSnapshot().started).toBe(true);
    expect(document.querySelectorAll("[data-waze-app]")).toHaveLength(1);

    const board = await navigateRealSpaSmoke("#/board");
    expect(board.activeWatchCount).toBe(1);
    expect(board.activeRafCount).toBe(0);
    expect(window.__vatioboardDrivingAlerts?.getSnapshot().consumers).not.toContain("vatio.waze.route");
    expect(document.querySelector("[data-waze-app]")).toBeNull();
  }, 40000);

  it("centers the iframe from shared GPS and updates the compact HUD", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "#/waze",
      targetSelector: "[data-waze-app] #wazeFrame",
      sequence: ["#/board", "#/waze"],
    });
    navigator.geolocation.success?.({
      timestamp: Date.now(),
      coords: {
        latitude: 40.7484,
        longitude: -73.9857,
        speed: 10,
        accuracy: 5,
        altitude: 14,
        heading: 12,
      },
    });
    await settleRealSpaSmoke();

    const frame = document.getElementById("wazeFrame");
    expect(frame?.getAttribute("src")).toContain("https://embed.waze.com/iframe");
    expect(frame?.getAttribute("src")).toContain("lat=40.748400");
    expect(document.getElementById("wazeSpeedValue")?.textContent).toBe("36");
    expect(document.getElementById("wazeSpeedUnit")?.textContent).toBe("km/h");
    expect(getRealSpaResourceSnapshot().activeWatchCount).toBe(1);

    const board = await navigateRealSpaSmoke("#/board");
    expect(board.activeWatchCount).toBe(1);
    expect(window.__vatioboardDrivingAlerts?.getSnapshot().consumers).not.toContain("vatio.waze.route");
  }, 40000);
});
