import { describe, expect, it } from "vitest";

import {
  createDrivingTelemetryReducerState,
  reduceDrivingTelemetryPosition,
} from "../../src/app/services/driving-telemetry-reducer.js";

function position(sequence, overrides = {}) {
  return {
    sampleSequence: sequence,
    latitude: 40.7,
    longitude: -73.9,
    accuracy: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMs: 10,
    heading: null,
    headingDeg: null,
    fixTimestampMs: 1_700_000_000_000 + sequence * 1000,
    timestampMs: 1_700_000_000_000 + sequence * 1000,
    receivedAtMs: 1_700_000_000_000 + sequence * 1000,
    stale: false,
    ...overrides,
  };
}

describe("driving telemetry reducer", () => {
  it("preserves Speed smoothing and smoothed maximum semantics", () => {
    let state = createDrivingTelemetryReducerState("trip-1");
    for (const [index, speedMs] of [5, 10, 15, 20, 25, 30].entries()) {
      state = reduceDrivingTelemetryPosition(state, position(index + 1, {
        speedMs,
        longitude: -73.9 + index * 0.0001,
      })).state;
    }
    expect(state.currentSpeedMs).toBe(20);
    expect(state.maxSpeedMs).toBe(20);
    expect(state.sampleCount).toBe(6);
  });

  it("uses coordinate fallback speed when browser speed is missing", () => {
    let state = createDrivingTelemetryReducerState("trip-1");
    state = reduceDrivingTelemetryPosition(state, position(1, { speedMs: null })).state;
    const result = reduceDrivingTelemetryPosition(state, position(2, {
      speedMs: null,
      latitude: 40.7001,
    }));
    expect(result.sample.processedSpeedMs).toBeGreaterThan(0);
    expect(result.sample.distanceDeltaM).toBeGreaterThan(4);
  });

  it("rejects stationary jitter, implausible jumps, and duplicate sequences", () => {
    let state = createDrivingTelemetryReducerState("trip-1");
    state = reduceDrivingTelemetryPosition(state, position(1, { speedMs: 0 })).state;
    state = reduceDrivingTelemetryPosition(state, position(2, {
      speedMs: 0,
      latitude: 40.700001,
    })).state;
    expect(state.totalDistanceM).toBe(0);

    state = reduceDrivingTelemetryPosition(state, position(3, {
      speedMs: 20,
      latitude: 45,
    })).state;
    expect(state.totalDistanceM).toBe(0);

    const duplicate = reduceDrivingTelemetryPosition(state, position(3));
    expect(duplicate.sample).toBeNull();
    expect(duplicate.state).toBe(state);
  });

  it("tracks altitude extrema and resets through a fresh reducer state", () => {
    let state = createDrivingTelemetryReducerState("trip-1");
    state = reduceDrivingTelemetryPosition(state, position(1, { altitudeM: 20 })).state;
    state = reduceDrivingTelemetryPosition(state, position(2, { altitudeM: 8 })).state;
    expect(state).toMatchObject({ currentAltitudeM: 8, minAltitudeM: 8, maxAltitudeM: 20 });

    const reset = createDrivingTelemetryReducerState("trip-2");
    expect(reset).toMatchObject({ tripId: "trip-2", startedAtMs: null, sampleCount: 0, totalDistanceM: 0 });
  });
});
