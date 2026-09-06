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

  it("keeps one canonical trip through Map, Board, Speed, and back to Map", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "/map",
      targetSelector: "[data-map-app] .camera-map-container",
      sequence: ["/board", "/map"],
    });

    const emit = (timestamp, latitude, longitude, speed, altitude) => {
      navigator.geolocation.success?.({
        timestamp,
        coords: {
          latitude,
          longitude,
          speed,
          accuracy: 5,
          altitude,
          heading: 90,
        },
      });
    };
    const startedAt = Date.now();
    emit(startedAt, 40.7484, -73.9857, 10, 10);
    await settleRealSpaSmoke();
    const first = window.__vatioboardDrivingTelemetry.getSnapshot();
    expect(first.sampleCount).toBe(1);
    expect(document.querySelector("[data-driving-speed]")?.textContent).toBe("36");

    await navigateRealSpaSmoke("/board");
    emit(startedAt + 1_000, 40.7485, -73.9856, 20, 20);
    await settleRealSpaSmoke();
    const background = window.__vatioboardDrivingTelemetry.getSnapshot();
    expect(background.tripId).toBe(first.tripId);
    expect(background.sampleCount).toBe(2);
    expect(background.totalDistanceM).toBeGreaterThan(0);

    await navigateRealSpaSmoke("/");
    expect(document.getElementById("maxSpeed")?.textContent).toBe("54");
    expect(document.getElementById("altitudeValue")?.textContent).toBe("20");
    emit(startedAt + 2_000, 40.7486, -73.9855, 30, 30);
    await settleRealSpaSmoke();
    const speed = window.__vatioboardDrivingTelemetry.getSnapshot();
    expect(speed.tripId).toBe(first.tripId);
    expect(speed.sampleCount).toBe(3);
    expect(document.getElementById("maxSpeed")?.textContent).toBe("72");

    await navigateRealSpaSmoke("/map");
    const final = window.__vatioboardDrivingTelemetry.getSnapshot();
    expect(final.tripId).toBe(first.tripId);
    expect(final.sampleCount).toBe(3);
    expect(final.totalDistanceM).toBe(speed.totalDistanceM);
    expect(document.querySelector("[data-driving-speed]")?.textContent).toBe("72");
    expect(document.querySelector("[data-driving-stat='maxSpeed']")?.textContent).toBe("72 km/h");
    expect(document.querySelector("[data-driving-stat='altitude']")?.textContent).toBe("30 m");
    expect(getRealSpaResourceSnapshot().activeWatchCount).toBe(1);
  }, 60000);
});
