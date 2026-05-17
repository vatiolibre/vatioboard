import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGpsService } from "../../src/app/services/gps-service.js";

function createGeolocationDouble() {
  const geolocation = {
    success: null,
    error: null,
    watchPosition: vi.fn((success, error, options) => {
      geolocation.success = success;
      geolocation.error = error;
      geolocation.options = options;
      return geolocation.watchPosition.mock.calls.length;
    }),
    clearWatch: vi.fn(),
  };
  return geolocation;
}

function emitPosition(geolocation, overrides = {}) {
  const position = {
    coords: {
      latitude: 40.7,
      longitude: -73.9,
      accuracy: 4,
      altitude: 12,
      altitudeAccuracy: 2,
      speed: 8,
      heading: 123,
      ...overrides.coords,
    },
  };
  if (Object.hasOwn(overrides, "timestamp")) {
    position.timestamp = overrides.timestamp;
  } else {
    position.timestamp = 1000;
  }
  geolocation.success?.(position);
}

describe("createGpsService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shares one native watch across subscribers and consumers", () => {
    const geolocation = createGeolocationDouble();
    const service = createGpsService({ geolocation });
    const success = vi.fn();

    const watchId = service.watchPosition(success);
    const stopCamera = service.startConsumer("camera-map");

    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).toMatchObject({
      subscriberCount: 1,
      nativeWatchActive: true,
      consumers: ["camera-map"],
    });

    service.clearWatch(watchId);

    expect(geolocation.clearWatch).not.toHaveBeenCalled();
    expect(service.getSnapshot().nativeWatchActive).toBe(true);

    stopCamera();

    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);
    expect(service.getSnapshot().nativeWatchActive).toBe(false);
  });

  it("normalizes heading, timestamps, and dispatches app GPS events", () => {
    const geolocation = createGeolocationDouble();
    const service = createGpsService({ geolocation });
    const eventSpy = vi.fn();
    window.addEventListener("vatioboard:gps-position", eventSpy);

    try {
      service.startConsumer("speed-recording");
      emitPosition(geolocation, { timestamp: Date.now(), coords: { heading: 361, speed: 9 } });

      expect(service.getCurrentPosition()).toMatchObject({
        latitude: 40.7,
        longitude: -73.9,
        accuracy: 4,
        speedMs: 9,
        heading: 1,
        headingDeg: 1,
        receivedAtMs: expect.any(Number),
        stale: false,
      });
      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({ headingDeg: 1 }),
      }));
      expect(JSON.parse(localStorage.getItem("vatioboard.gps_service.snapshot.v1")).normalized.headingDeg).toBe(1);
    } finally {
      window.removeEventListener("vatioboard:gps-position", eventSpy);
    }
  });

  it("derives heading from movement when browser heading is missing", () => {
    const geolocation = createGeolocationDouble();
    const service = createGpsService({ geolocation });
    service.startConsumer("speed-recording");

    emitPosition(geolocation, {
      timestamp: 1000,
      coords: { latitude: 40.7, longitude: -73.9, heading: null, speed: 4 },
    });
    emitPosition(geolocation, {
      timestamp: 2000,
      coords: { latitude: 40.701, longitude: -73.9, heading: null, speed: 4 },
    });

    expect(service.getCurrentPosition().headingDeg).toBeCloseTo(0, 0);
  });

  it("uses receivedAtMs for freshness when browser timestamp is old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_767_225_600_000);
    const geolocation = createGeolocationDouble();
    const service = createGpsService({ geolocation });
    service.startConsumer("camera-map");

    for (const timestamp of [0, Date.now() - 60000, 1234, undefined]) {
      emitPosition(geolocation, { timestamp });
      const position = service.getCurrentPosition();

      expect(position).toMatchObject({
        timestampMs: Date.now(),
        receivedAtMs: Date.now(),
        lastCallbackAtMs: Date.now(),
        freshnessTimestampMs: Date.now(),
        timestampSource: "received",
        stale: false,
      });
      expect(position.fixTimestampMs).toBe(timestamp === undefined ? null : timestamp);
    }
  });

  it("getSnapshot recomputes stale from lastCallbackAtMs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_767_225_600_000);
    const geolocation = createGeolocationDouble();
    const service = createGpsService({ geolocation });
    service.startConsumer("camera-map");

    emitPosition(geolocation, { timestamp: 0 });

    expect(service.getSnapshot().normalized.stale).toBe(false);

    vi.advanceTimersByTime(10001);

    expect(service.getSnapshot().normalized).toMatchObject({
      stale: true,
      lastCallbackAtMs: 1_767_225_600_000,
    });
  });

  it("dispatches gps-position with non-stale normalized fix for Tesla-style timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_767_225_600_000);
    const geolocation = createGeolocationDouble();
    const service = createGpsService({ geolocation });
    const eventSpy = vi.fn();
    window.addEventListener("vatioboard:gps-position", eventSpy);

    try {
      service.startConsumer("camera-map");
      emitPosition(geolocation, { timestamp: 0 });

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({
          timestampMs: Date.now(),
          receivedAtMs: Date.now(),
          fixTimestampMs: 0,
          stale: false,
        }),
      }));
    } finally {
      window.removeEventListener("vatioboard:gps-position", eventSpy);
    }
  });

  it("does not clear normalized position on timeout error", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_767_225_600_000);
    const geolocation = createGeolocationDouble();
    const service = createGpsService({ geolocation });
    const error = { code: 3, message: "Position timeout" };
    service.startConsumer("camera-map");
    emitPosition(geolocation, { timestamp: 0 });
    const lastCallbackAtMs = service.getSnapshot().lastCallbackAtMs;

    vi.advanceTimersByTime(5000);
    geolocation.error?.(error);

    expect(service.getSnapshot()).toMatchObject({
      status: "degraded",
      lastCallbackAtMs,
      normalized: {
        latitude: 40.7,
        longitude: -73.9,
        stale: false,
      },
      lastError: {
        code: 3,
        message: "Position timeout",
      },
    });

    vi.advanceTimersByTime(6000);

    expect(service.getSnapshot().normalized).toMatchObject({
      latitude: 40.7,
      longitude: -73.9,
      stale: true,
    });
  });
});
