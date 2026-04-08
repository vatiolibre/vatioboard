import { describe, expect, it } from "vitest";
import {
  formatDisplaySpeed,
  formatDisplayDistance,
} from "../../src/shared/display-format.js";

// ── formatDisplaySpeed ───────────────────────────────────────────────

describe("formatDisplaySpeed", () => {
  it("formats metric speed with km/h label", () => {
    expect(formatDisplaySpeed(82.4, "kmh")).toBe("82 km/h");
  });

  it("formats imperial speed with mph label", () => {
    expect(formatDisplaySpeed(70.2, "mph")).toBe("70 mph");
  });

  it("rounds to nearest integer", () => {
    expect(formatDisplaySpeed(54.9, "mph")).toBe("55 mph");
    expect(formatDisplaySpeed(54.4, "mph")).toBe("54 mph");
  });

  it("handles zero speed", () => {
    expect(formatDisplaySpeed(0, "kmh")).toBe("0 km/h");
  });

  it("returns fallback for null", () => {
    expect(formatDisplaySpeed(null, "kmh")).toBe("—");
  });

  it("returns fallback for undefined", () => {
    expect(formatDisplaySpeed(undefined, "mph")).toBe("—");
  });

  it("returns fallback for NaN", () => {
    expect(formatDisplaySpeed(NaN, "kmh")).toBe("—");
  });

  it("returns fallback for non-numeric string", () => {
    expect(formatDisplaySpeed("abc", "kmh")).toBe("—");
  });

  it("accepts a custom fallback string", () => {
    expect(formatDisplaySpeed(null, "kmh", "N/A")).toBe("N/A");
  });

  it("uses unitKey as label when key is unknown", () => {
    expect(formatDisplaySpeed(50, "kts")).toBe("50 kts");
  });
});

// ── formatDisplayDistance ─────────────────────────────────────────────

describe("formatDisplayDistance", () => {
  // metric
  it("formats short metric distance in meters", () => {
    expect(formatDisplayDistance(640, "m")).toBe("640 m");
  });

  it("promotes metric distance to km above 1000 m", () => {
    expect(formatDisplayDistance(1280, "m")).toBe("1.3 km");
  });

  it("rounds km to integer above 10 km", () => {
    expect(formatDisplayDistance(12000, "m")).toBe("12 km");
  });

  it("shows one decimal for km below 10", () => {
    expect(formatDisplayDistance(5500, "m")).toBe("5.5 km");
  });

  it("formats exactly 1000 m as km", () => {
    expect(formatDisplayDistance(1000, "m")).toBe("1.0 km");
  });

  // imperial
  it("formats short imperial distance in feet", () => {
    // 290 m ≈ 951 ft
    expect(formatDisplayDistance(290, "ft")).toBe("951 ft");
  });

  it("promotes imperial distance to miles above 5280 ft", () => {
    // 1609.344 m = exactly 1 mi
    expect(formatDisplayDistance(1609.344, "ft")).toBe("1.0 mi");
  });

  it("rounds miles to integer above 10 mi", () => {
    // 19312.128 m = 12 mi
    expect(formatDisplayDistance(19312.128, "ft")).toBe("12 mi");
  });

  it("shows one decimal for miles below 10", () => {
    // 8046.72 m = 5 mi
    expect(formatDisplayDistance(8046.72, "ft")).toBe("5.0 mi");
  });

  it("keeps feet below threshold", () => {
    // 950 ft = 289.56 m
    expect(formatDisplayDistance(289.56, "ft")).toBe("950 ft");
  });

  // edge cases
  it("returns fallback for null", () => {
    expect(formatDisplayDistance(null, "m")).toBe("—");
  });

  it("returns fallback for undefined", () => {
    expect(formatDisplayDistance(undefined, "ft")).toBe("—");
  });

  it("returns fallback for negative values", () => {
    expect(formatDisplayDistance(-100, "m")).toBe("—");
  });

  it("handles zero distance", () => {
    expect(formatDisplayDistance(0, "m")).toBe("0 m");
    expect(formatDisplayDistance(0, "ft")).toBe("0 ft");
  });

  it("accepts a custom fallback string", () => {
    expect(formatDisplayDistance(null, "m", "N/A")).toBe("N/A");
  });

  it("defaults to metric when unit key is unknown", () => {
    expect(formatDisplayDistance(640, "xyz")).toBe("640 m");
  });
});
