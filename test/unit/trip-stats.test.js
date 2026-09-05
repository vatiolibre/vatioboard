import { describe, expect, it } from "vitest";

import { createTripStatsModel, formatTripDuration } from "../../src/shared/trip-stats.js";

describe("shared trip statistics", () => {
  it("uses the Speed trip formulas for metric output", () => {
    const stats = createTripStatsModel({
      currentSpeedMs: 10,
      maxSpeedMs: 20,
      totalDistanceM: 1500,
      durationMs: 300_000,
      currentAltitudeM: 12.4,
      maxAltitudeM: 20.8,
      minAltitudeM: 8.2,
      nearestCameraDistanceM: 240,
      speedUnit: "kmh",
      distanceUnit: "m",
    });

    expect(stats.currentSpeed).toEqual({ value: "36", unit: "km/h" });
    expect(stats.maxSpeed).toEqual({ value: "72", unit: "km/h" });
    expect(stats.averageSpeed).toEqual({ value: "18", unit: "km/h" });
    expect(stats.distance).toEqual({ value: "1.5", unit: "km" });
    expect(stats.nearestCamera).toEqual({ value: "240", unit: "m" });
    expect(stats.duration.value).toBe("05:00");
    expect(stats.altitude).toEqual({ value: "12", unit: "m" });
  });

  it("uses feet for nearby imperial camera distances", () => {
    const stats = createTripStatsModel({ nearestCameraDistanceM: 240, distanceUnit: "mi" });
    expect(stats.nearestCamera).toEqual({ value: "787", unit: "ft" });
  });

  it("formats long recordings with hours", () => {
    expect(formatTripDuration(3_661_000)).toBe("1:01:01");
  });

  it("does not present missing camera or altitude data as zero", () => {
    const stats = createTripStatsModel({
      nearestCameraDistanceM: null,
      currentAltitudeM: null,
      maxAltitudeM: null,
      minAltitudeM: null,
    });
    expect(stats.nearestCamera.value).toBe("—");
    expect(stats.altitude.value).toBe("—");
    expect(stats.maxAltitude.value).toBe("—");
    expect(stats.minAltitude.value).toBe("—");
  });
});
