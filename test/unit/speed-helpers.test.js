import { describe, expect, it, vi } from "vitest";
import {
  getAlertUiState,
  normalizeAlertDisplayValue,
} from "../../src/speed/alerts.js";
import {
  getMovementThresholdM,
  getWazeEmbedUrl,
  getWazeZoomLevel,
  normalizePositionTimestamp,
} from "../../src/speed/navigation.js";
import { normalizeTrapAlertDistance } from "../../src/speed/preferences.js";
import { convertSpeed } from "../../src/speed/render.js";
import {
  formatTrapDistance,
  formatTrapSpeed,
  updateNearestTrap,
} from "../../src/speed/traps.js";

describe("speed extracted helpers", () => {
  it("normalizes alert display values to unit steps and limits", () => {
    expect(normalizeAlertDisplayValue(67, "mph")).toBe(65);
    expect(normalizeAlertDisplayValue(9, "mph")).toBe(10);
    expect(normalizeAlertDisplayValue(287, "kmh")).toBe(280);
  });

  it("snaps trap alert distance preferences to the nearest preset", () => {
    expect(normalizeTrapAlertDistance(780, "ft")).toBeCloseTo(804.672, 6);
    expect(normalizeTrapAlertDistance(850, "m")).toBe(1000);
  });

  it("builds trap-priority alert state with over-limit details", () => {
    const alertState = getAlertUiState({
      unit: "mph",
      currentSpeedMs: 35,
      alertEnabled: true,
      alertLimitMs: 30,
      trapAlertEnabled: true,
      trapLoadPending: false,
      trapLoadError: null,
      nearestTrapId: 7,
      nearestTrapDistanceM: 320,
      nearestTrapSpeedKph: 100,
      trapAlertDistanceM: 500,
      convertSpeed,
      getTrapAlertDistanceLabel: (distanceM) => `${Math.round(distanceM)} m`,
      formatTrapSpeed: (speedKph) => `${Math.round(speedKph / 1.609344)} mph`,
    });

    expect(alertState).toMatchObject({
      source: "trap",
      enabled: true,
      trapActive: true,
      trapDistanceLabel: "320 m",
      trapSpeedLabel: "62 mph",
      over: true,
      near: false,
    });
    expect(alertState.limitDisplayValue).toBe(62);
    expect(alertState.deltaDisplayValue).toBe(16);
  });

  it("builds manual near-limit alert state when no trap limit is active", () => {
    const alertState = getAlertUiState({
      unit: "kmh",
      currentSpeedMs: 28,
      alertEnabled: true,
      alertLimitMs: 30,
      trapAlertEnabled: false,
      trapLoadPending: false,
      trapLoadError: null,
      nearestTrapId: null,
      nearestTrapDistanceM: null,
      nearestTrapSpeedKph: null,
      trapAlertDistanceM: 500,
      convertSpeed,
      getTrapAlertDistanceLabel: () => null,
      formatTrapSpeed: () => null,
    });

    expect(alertState).toMatchObject({
      source: "manual",
      enabled: true,
      trapActive: false,
      over: false,
      near: true,
      limitDisplayValue: 108,
    });
  });

  it("formats trap distances and speeds for metric and imperial units", () => {
    expect(formatTrapDistance(450, "m")).toEqual({ value: "450", unit: "m" });
    expect(formatTrapDistance(2000, "ft")).toEqual({ value: "1.2", unit: "mi" });
    expect(formatTrapDistance(Number.NaN, "m", "away")).toEqual({ value: "—", unit: "away" });
    expect(formatTrapSpeed(100, "kmh")).toBe("100 km/h");
    expect(formatTrapSpeed(100, "mph")).toBe("62 mph");
  });

  it("updates nearest trap state from injected spatial helpers", () => {
    const trapState = updateNearestTrap(
      { fake: true },
      [
        [-74, 4.7, 50],
        [-73.99, 4.71, 80],
      ],
      -74.1,
      4.72,
      {
        around: vi.fn(() => [1]),
        distanceKm: vi.fn(() => 0.42),
      },
    );

    expect(trapState).toEqual({
      nearestTrapId: 1,
      nearestTrapDistanceM: 420,
      nearestTrapSpeedKph: 80,
    });
  });

  it("derives stable Waze zoom levels and embed URLs", () => {
    expect(getWazeZoomLevel(2)).toBe(15);
    expect(getWazeZoomLevel(20 / 3.6)).toBe(14);
    expect(getWazeZoomLevel(60 / 3.6)).toBe(13);
    expect(getWazeZoomLevel(120 / 3.6)).toBe(12);

    const url = getWazeEmbedUrl(40.7484, -73.9857, 60 / 3.6);
    expect(url).toContain("zoom=13");
    expect(url).toContain("lat=40.748400");
    expect(url).toContain("lon=-73.985700");
  });

  it("normalizes timestamps and movement thresholds safely", () => {
    const now = Date.UTC(2026, 2, 26, 12, 0, 0);
    expect(normalizePositionTimestamp(now - 1000, now)).toBe(now - 1000);
    expect(normalizePositionTimestamp(Date.UTC(1990, 0, 1), now)).toBe(now);
    expect(getMovementThresholdM(50, 30)).toBe(9);
    expect(getMovementThresholdM(null, null)).toBe(4);
  });
});
