import { describe, expect, it } from "vitest";

import accelerationStop from "../fixtures/gps/acceleration-stop.json";
import constant30Kmh from "../fixtures/gps/constant-30-kmh.json";
import constant60Mph from "../fixtures/gps/constant-60-mph.json";
import implausibleJump from "../fixtures/gps/implausible-jump.json";
import missingSpeed from "../fixtures/gps/missing-speed.json";
import poorAccuracy from "../fixtures/gps/poor-accuracy.json";
import routeTransition from "../fixtures/gps/route-transition.json";
import stationaryNoise from "../fixtures/gps/stationary-noise.json";
import urbanNoise from "../fixtures/gps/urban-noise.json";
import {
  createDrivingTelemetryReducerState,
  reduceDrivingTelemetryPosition,
} from "../../src/app/services/driving-telemetry-reducer.js";
import { createGpsTracePlayer } from "../helpers/gps-trace-player.js";

const TRACE_ORIGIN_MS = 1_700_000_000_000;

function reduceTrace(trace) {
  let state = createDrivingTelemetryReducerState(`fixture-${trace.name}`);
  let sequence = 0;
  const player = createGpsTracePlayer({
    now: () => TRACE_ORIGIN_MS,
    emit(position) {
      sequence += 1;
      const { coords } = position;
      state = reduceDrivingTelemetryPosition(state, {
        sampleSequence: sequence,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
        altitudeM: Number.isFinite(coords.altitude) ? coords.altitude : null,
        altitudeAccuracyM: Number.isFinite(coords.altitudeAccuracy) ? coords.altitudeAccuracy : null,
        speedMs: Number.isFinite(coords.speed) ? coords.speed : null,
        headingDeg: Number.isFinite(coords.heading) ? coords.heading : null,
        fixTimestampMs: position.timestamp,
        timestampMs: position.timestamp,
        receivedAtMs: position.timestamp,
        stale: false,
      }).state;
    },
  });
  player.play(trace);
  return state;
}

describe("canonical raw GPS trace fixtures", () => {
  it("locks constant-speed, acceleration, and route-transition behavior", () => {
    const metric = reduceTrace(constant30Kmh);
    expect(metric.sampleCount).toBe(3);
    expect(metric.currentSpeedMs).toBeCloseTo(8.333333, 6);
    expect(metric.totalDistanceM).toBeCloseTo(16.68, 1);

    const imperial = reduceTrace(constant60Mph);
    expect(imperial.currentSpeedMs).toBeCloseTo(26.8224, 4);
    expect(imperial.totalDistanceM).toBeCloseTo(53.6, 0);

    const acceleration = reduceTrace(accelerationStop);
    expect(acceleration.currentSpeedMs).toBeCloseTo(5.2, 5);
    expect(acceleration.maxSpeedMs).toBeCloseTo(6.5, 5);
    expect(acceleration.totalDistanceM).toBeGreaterThan(24);

    const transition = reduceTrace(routeTransition);
    expect(transition).toMatchObject({ sampleCount: 5, currentSpeedMs: 10, maxSpeedMs: 10 });
    expect(transition.totalDistanceM).toBeCloseTo(40, 0);
  });

  it("locks missing-speed, noise, accuracy, jump, and heading behavior", () => {
    const fallback = reduceTrace(missingSpeed);
    expect(fallback.totalDistanceM).toBeCloseTo(10, 0);
    expect(fallback.currentSpeedMs).toBeCloseTo(5, 0);

    expect(reduceTrace(stationaryNoise).totalDistanceM).toBe(0);
    expect(reduceTrace(implausibleJump).totalDistanceM).toBe(0);

    const inaccurate = reduceTrace(poorAccuracy);
    expect(inaccurate.totalDistanceM).toBeGreaterThan(19);
    expect(inaccurate.totalDistanceM).toBeLessThan(21);

    const urban = reduceTrace(urbanNoise);
    expect(urban.sampleCount).toBe(4);
    expect(urban.headingDeg).toBe(2);
    expect(urban.totalDistanceM).toBeGreaterThan(15);
  });
});
