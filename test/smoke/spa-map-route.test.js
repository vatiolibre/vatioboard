import { beforeEach, describe, expect, it } from "vitest";

import {
  expectRealSpaRouteRemount,
  getRealSpaResourceSnapshot,
  getRealSpaSmokeMocks,
  navigateRealSpaSmoke,
  resetRealSpaSmoke,
  settleRealSpaSmoke,
} from "../helpers/real-spa-route-smoke.js";

describe("SPA Map route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("mounts as a route, keeps shared services alive, and cleans up route resources", async () => {
    const { maplibre } = getRealSpaSmokeMocks();
    const { targetSnapshots } = await expectRealSpaRouteRemount({
      targetHash: "/map",
      targetSelector: "[data-map-app] .camera-map-container",
      sequence: ["/board", "/map"],
    });

    expect(document.querySelector("[data-map-app]")).toBeTruthy();
    expect(document.querySelector(".camera-map-panel")?.dataset.cameraMapMode).toBe("route");
    expect(document.querySelector("[data-vb-shell-window='camera-map']")).toBeNull();
    expect(document.querySelector(".driving-status-pill")).toBeTruthy();
    expect(document.querySelector(".driving-actions")).toBeTruthy();
    expect(targetSnapshots[0].activeMapCount).toBe(1);
    expect(targetSnapshots[0].activeWatchCount).toBe(1);
    expect(maplibre.maps.filter((map) => !map.removed)).toHaveLength(1);

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
    expect(document.querySelector("[data-driving-speed]")?.textContent).toBe("36");

    const board = await navigateRealSpaSmoke("/board");
    expect(board.activeMapCount).toBe(0);
    expect(board.activeRafCount).toBe(0);
    expect(document.querySelector("[data-map-app]")).toBeNull();
    expect(window.__vatioboardDrivingAlerts?.getSnapshot().consumers).not.toContain("vatio.map.route");
    expect(maplibre.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(getRealSpaResourceSnapshot().activeMapCount).toBe(0);
  }, 40000);

  it("changes presentation without creating a second map", async () => {
    const { maplibre } = getRealSpaSmokeMocks();
    await expectRealSpaRouteRemount({
      targetHash: "/map",
      targetSelector: "#mapPresentation",
      sequence: ["/board", "/map"],
    });

    document.getElementById("mapPresentation")?.click();
    document.querySelector("[data-map-presentation-option='3d']")?.click();
    expect(document.querySelector("[data-map-app]")?.dataset.mapPresentation).toBe("3d");
    expect(maplibre.maps.filter((map) => !map.removed)).toHaveLength(1);
  }, 40000);
});
