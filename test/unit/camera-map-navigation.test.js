import { describe, expect, it } from "vitest";

import {
  computeNavigationCameraUpdate,
  createNavigationCameraState,
  deriveHeadingFromPositions,
  normalizeLivePosition,
  shouldUpdateBearing,
  smoothHeading,
} from "../../src/speed/camera-map-navigation.js";

describe("camera map navigation helpers", () => {
  it("normalizes headingDeg and course aliases from Speed GPS samples", () => {
    expect(normalizeLivePosition({
      latitude: 40.7,
      longitude: -73.9,
      headingDeg: 361,
      speedMs: 8,
      timestampMs: 1000,
    }, 1000)).toMatchObject({
      heading: 1,
      speedMs: 8,
      timestampMs: 1000,
    });

    expect(normalizeLivePosition({
      coords: {
        latitude: 40.7,
        longitude: -73.9,
        course: 725,
      },
    }, 2000)).toMatchObject({
      heading: 5,
      timestampMs: 2000,
    });
  });

  it("derives heading from meaningful movement", () => {
    const heading = deriveHeadingFromPositions(
      { latitude: 40.7, longitude: -73.9 },
      { latitude: 40.701, longitude: -73.9 }
    );

    expect(heading).toBeCloseTo(0, 0);
  });

  it("computes a lower-third anchored easeTo command in drive mode", () => {
    const command = computeNavigationCameraUpdate({
      position: { latitude: 40.7, longitude: -73.9, speedMs: 8, timestampMs: 1000 },
      headingState: { headingAvailable: false, headingStale: true, source: "none" },
      previousCameraState: createNavigationCameraState(),
      orientationMode: "north-up",
      navigationMode: "drive",
      mapSize: { width: 800, height: 500 },
      currentZoom: 8,
      currentBearing: 0,
      now: 1000,
    });

    expect(command).toMatchObject({
      method: "easeTo",
      center: [-73.9, 40.7],
      bearing: 0,
      pitch: 0,
      offset: [0, 110],
      reason: "following",
    });
    expect(command.zoom).toBeGreaterThan(15);
  });

  it("uses heading-up bearing when reliable and keeps north-up bearing at zero", () => {
    const position = { latitude: 40.7, longitude: -73.9, speedMs: 8, timestampMs: 1000 };
    const headingState = { heading: 123, headingAvailable: true, headingStale: false, source: "gps" };

    expect(computeNavigationCameraUpdate({
      position,
      headingState,
      previousCameraState: createNavigationCameraState(),
      orientationMode: "heading-up",
      navigationMode: "drive",
      mapSize: { height: 500 },
      currentZoom: 16,
      currentBearing: 0,
      now: 1000,
    }).bearing).toBe(123);

    expect(computeNavigationCameraUpdate({
      position,
      headingState,
      previousCameraState: createNavigationCameraState(),
      orientationMode: "north-up",
      navigationMode: "drive",
      mapSize: { height: 500 },
      currentZoom: 16,
      currentBearing: 27,
      now: 1000,
    }).bearing).toBe(0);
  });

  it("keeps the previous bearing when heading-up loses heading", () => {
    const command = computeNavigationCameraUpdate({
      position: { latitude: 40.7, longitude: -73.9, speedMs: 0, timestampMs: 7000 },
      headingState: { heading: null, headingAvailable: false, headingStale: true, source: "none" },
      previousCameraState: {
        ...createNavigationCameraState(),
        latestBearingApplied: 91,
        latestHeading: 91,
      },
      orientationMode: "heading-up",
      navigationMode: "drive",
      mapSize: { height: 500 },
      currentZoom: 16,
      currentBearing: 91,
      now: 7000,
    });

    expect(command).toMatchObject({
      bearing: 91,
      reason: "heading-unavailable",
      headingAvailable: false,
    });
  });

  it("ignores tiny heading changes and smooths large turns", () => {
    expect(smoothHeading(90, 92)).toBe(90);

    const smoothed = smoothHeading(90, 150);
    expect(smoothed).toBeGreaterThan(90);
    expect(smoothed).toBeLessThan(150);
    expect(shouldUpdateBearing(90, 92, 8)).toBe(false);
    expect(shouldUpdateBearing(90, 112, 8)).toBe(true);
    expect(shouldUpdateBearing(90, 160, 0.4)).toBe(false);
  });

  it("uses meaningful camera-ahead context without switching to fitBounds", () => {
    const command = computeNavigationCameraUpdate({
      position: { latitude: 40.7, longitude: -73.9, speedMs: 16, timestampMs: 1000 },
      headingState: { heading: 0, headingAvailable: true, headingStale: false, source: "gps" },
      previousCameraState: createNavigationCameraState(),
      orientationMode: "heading-up",
      navigationMode: "drive",
      relevantCamera: {
        key: "camera-1",
        ahead: true,
        distance: 900,
      },
      mapSize: { width: 800, height: 500 },
      currentZoom: 16,
      currentBearing: 0,
      now: 1000,
    });

    expect(command.method).toBe("easeTo");
    expect(command.reason).toBe("camera-ahead");
    expect(command.padding).toMatchObject({ bottom: expect.any(Number) });
    expect(command.relevantCameraKey).toBe("camera-1");
  });
});
