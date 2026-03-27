import { describe, expect, it } from "vitest";
import {
  classifyMotion,
  createSample,
  normalizeStoredSummary,
  summarizeSession,
} from "../../src/gps-rate/summary.js";

describe("gps-rate summary helpers", () => {
  it("normalizes saved summaries with stable defaults", () => {
    const normalized = normalizeStoredSummary({
      savedAtMs: 123,
      sampleCount: 4,
      averageIntervalMs: 500,
      fieldAvailability: { speed: true },
      unsupportedFields: ["heading"],
      histogram: [{ label: "500-999", count: 2 }],
      warnings: [{ kind: "ok", label: "No warnings", detail: "" }],
      statusText: "Stopped",
      notes: "Saved run",
    }, 999);

    expect(normalized).toMatchObject({
      source: "saved",
      savedAtMs: 123,
      durationMs: 0,
      sampleCount: 4,
      averageIntervalMs: 500,
      fieldAvailability: { speed: true },
      unsupportedFields: ["heading"],
      histogram: [{ label: "500-999", count: 2 }],
      warnings: [{ kind: "ok", label: "No warnings", detail: "" }],
      statusText: "Stopped",
      notes: "Saved run",
    });
    expect(normalizeStoredSummary(null)).toBeNull();
  });

  it("prefers reported speed and falls back to derived motion classification", () => {
    expect(classifyMotion({ speed: 2.5 }, null, 1000)).toEqual({
      state: "moving",
      source: "reported",
      derivedSpeedMps: null,
      distanceM: null,
    });

    const previousSample = {
      performanceNowMs: 0,
      latitude: 0,
      longitude: 0,
      accuracyM: 4,
    };

    const derivedMoving = classifyMotion({
      latitude: 0.0001,
      longitude: 0,
      accuracy: 4,
      speed: null,
    }, previousSample, 2000);

    expect(derivedMoving.state).toBe("moving");
    expect(derivedMoving.source).toBe("derived");
    expect(derivedMoving.derivedSpeedMps).toBeGreaterThan(1);
    expect(derivedMoving.distanceM).toBeGreaterThan(4);

    const derivedStationary = classifyMotion({
      latitude: 0.000001,
      longitude: 0,
      accuracy: 4,
      speed: null,
    }, previousSample, 1000);

    expect(derivedStationary.state).toBe("stationary");
    expect(derivedStationary.source).toBe("derived");
    expect(derivedStationary.derivedSpeedMps).toBeLessThanOrEqual(0.3);
  });

  it("creates samples with normalized fields and stale detection", () => {
    const baseTimestampMs = Date.UTC(2024, 0, 1, 0, 0, 0);
    const sample = createSample({
      position: {
        coords: {
          latitude: 4.711,
          longitude: -74.0721,
          speed: 5,
          heading: 180,
          accuracy: 6,
          altitude: 2600,
          altitudeAccuracy: 12,
        },
        timestamp: baseTimestampMs + 1500,
      },
      previousSample: {
        performanceNowMs: 1000,
        positionTimestampMs: baseTimestampMs + 2000,
        latitude: 4.7109,
        longitude: -74.0721,
        accuracyM: 6,
      },
      sampleIndex: 2,
      callbackPerfMs: 1600,
      callbackWallClockMs: baseTimestampMs + 3000,
      hiddenNow: true,
    });

    expect(sample).toMatchObject({
      index: 2,
      intervalMs: 600,
      effectiveHz: 1000 / 600,
      geoTimestampDeltaMs: -500,
      sampleAgeMs: 1500,
      movementState: "moving",
      movementSource: "reported",
      visibilityState: "hidden",
      isStale: true,
    });
    expect(sample.latitude).toBe(4.711);
    expect(sample.longitude).toBe(-74.0721);
  });

  it("summarizes intervals, field availability, histogram, and motion metrics", () => {
    const samples = [
      {
        index: 1,
        performanceNowMs: 0,
        positionTimestampMs: 1000,
        accuracyM: 4,
        speedMps: null,
        headingDeg: null,
        altitudeM: null,
        altitudeAccuracyM: null,
        intervalMs: null,
        movementState: "uncertain",
        movementSource: "unknown",
        isStale: false,
      },
      {
        index: 2,
        performanceNowMs: 1000,
        positionTimestampMs: 2000,
        accuracyM: 6,
        speedMps: 2,
        headingDeg: 180,
        altitudeM: 10,
        altitudeAccuracyM: null,
        intervalMs: 1000,
        movementState: "moving",
        movementSource: "reported",
        isStale: false,
      },
      {
        index: 3,
        performanceNowMs: 1500,
        positionTimestampMs: 2500,
        accuracyM: 8,
        speedMps: 1,
        headingDeg: 200,
        altitudeM: 12,
        altitudeAccuracyM: null,
        intervalMs: 500,
        movementState: "moving",
        movementSource: "reported",
        isStale: true,
      },
    ];

    const summary = summarizeSession({
      samples,
      durationMs: 3500,
      notes: "  Tesla browser  ",
      statusText: "Running",
    });

    expect(summary.sampleCount).toBe(3);
    expect(summary.durationMs).toBe(3500);
    expect(summary.currentIntervalMs).toBe(500);
    expect(summary.averageIntervalMs).toBe(750);
    expect(summary.medianIntervalMs).toBe(750);
    expect(summary.minIntervalMs).toBe(500);
    expect(summary.maxIntervalMs).toBe(1000);
    expect(summary.effectiveAverageHz).toBeCloseTo(1000 / 750, 6);
    expect(summary.bestObservedHz).toBe(2);
    expect(summary.fiveSecondHz).toBeCloseTo(2 / 1.5, 6);
    expect(summary.wholeSessionHz).toBeCloseTo(2 / 1.5, 6);
    expect(summary.averageAccuracyM).toBe(6);
    expect(summary.latestAccuracyM).toBe(8);
    expect(summary.nullSpeedCount).toBe(1);
    expect(summary.nullHeadingCount).toBe(1);
    expect(summary.missingAltitudeCount).toBe(1);
    expect(summary.staleSampleCount).toBe(1);
    expect(summary.fieldAvailability).toEqual({
      speed: true,
      heading: true,
      altitude: true,
      altitudeAccuracy: false,
      accuracy: true,
    });
    expect(summary.unsupportedFields).toEqual(["altitudeAccuracy"]);
    expect(summary.motion).toMatchObject({
      latestState: "moving",
      latestSource: "reported",
      movingSamples: 2,
      stationarySamples: 0,
    });
    expect(summary.motion.movingHz).toBeCloseTo(1000 / 750, 6);
    expect(summary.motion.stationaryHz).toBeNull();
    expect(summary.histogram).toContainEqual({ label: "500-999", count: 1 });
    expect(summary.histogram).toContainEqual({ label: "1000-1499", count: 1 });
    expect(summary.statusText).toBe("Running");
    expect(summary.notes).toBe("Tesla browser");
    expect(summary.warnings).toEqual([]);
  });
});
