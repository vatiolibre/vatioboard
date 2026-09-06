import { describe, expect, it, vi } from "vitest";

import { createDrivingTelemetryService } from "../../src/app/services/driving-telemetry-service.js";

function createGpsDouble() {
  const positionListeners = new Set();
  const statusListeners = new Set();
  return {
    startConsumer: vi.fn(() => vi.fn()),
    subscribePositions: vi.fn((listener) => {
      positionListeners.add(listener);
      return () => positionListeners.delete(listener);
    }),
    subscribe: vi.fn((listener) => {
      statusListeners.add(listener);
      listener({ status: "idle", normalized: null });
      return () => statusListeners.delete(listener);
    }),
    emit(position) {
      for (const listener of positionListeners) listener(position);
    },
    emitStatus(snapshot) {
      for (const listener of statusListeners) listener(snapshot);
    },
  };
}

function position(sequence, overrides = {}) {
  const timestampMs = 1_700_000_000_000 + sequence * 1000;
  return {
    sampleSequence: sequence,
    latitude: 40.7,
    longitude: -73.9 + sequence * 0.0001,
    accuracy: 4,
    altitudeM: 10,
    speedMs: 8,
    headingDeg: 90,
    timestampMs,
    receivedAtMs: timestampMs,
    stale: false,
    ...overrides,
  };
}

describe("driving telemetry service", () => {
  it("starts idempotently and reduces each sequence once", () => {
    const gps = createGpsDouble();
    const currentTime = 1_700_000_010_000;
    const service = createDrivingTelemetryService({
      gpsService: gps,
      now: () => currentTime,
      createTripId: () => "trip-1",
    });
    const samples = [];
    service.subscribeSamples((sample) => samples.push(sample));
    service.start();
    service.start();

    expect(gps.startConsumer).toHaveBeenCalledTimes(1);
    gps.emit(position(1));
    gps.emit(position(1));
    gps.emit(position(2));
    expect(samples).toHaveLength(2);
    expect(service.getSnapshot()).toMatchObject({
      tripId: "trip-1",
      sampleCount: 2,
      lastGpsSampleSequence: 2,
      currentSpeedMs: 8,
    });
    expect(service.getSnapshot().averageSpeedMs).toBeGreaterThan(0);
    service.destroy();
  });

  it("keeps acquisition active while reset creates a fresh trip", () => {
    const gps = createGpsDouble();
    const ids = ["trip-1", "trip-2"];
    const service = createDrivingTelemetryService({
      gpsService: gps,
      createTripId: () => ids.shift(),
    });
    service.start();
    gps.emit(position(1));
    const reset = service.resetTrip();
    expect(reset).toMatchObject({ tripId: "trip-2", sampleCount: 0, startedAtMs: null });
    expect(gps.startConsumer).toHaveBeenCalledTimes(1);
    gps.emit(position(2));
    expect(service.getSnapshot()).toMatchObject({ tripId: "trip-2", sampleCount: 1 });
    service.destroy();
  });

  it("maps GPS error and stale states without changing aggregates", () => {
    const gps = createGpsDouble();
    const service = createDrivingTelemetryService({ gpsService: gps, createTripId: () => "trip" });
    service.start();
    gps.emit(position(1));
    gps.emitStatus({ status: "degraded", normalized: position(1, { stale: true }) });
    expect(service.getSnapshot()).toMatchObject({ status: "stale", sampleCount: 1 });
    service.destroy();
  });
});
