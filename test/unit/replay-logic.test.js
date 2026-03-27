import { beforeEach, describe, expect, it } from "vitest";
import {
  buildReplayGraphModel,
  buildReplayMetricSeries,
  getReplayBounds,
  getReplayGraphCursorX,
  getReplayHighlights,
  getReplayPlayedCoordinates,
  getReplaySampleAtDistanceM,
  getReplaySampleAtElapsedMs,
  getReplaySummary,
} from "../../src/replay/logic.js";
import {
  archiveReplaySession,
  appendReplaySample,
  createReplaySession,
  limitReplaySamples,
  loadReplayLibrary,
  loadReplayRecords,
  loadReplaySelection,
  normalizeReplaySession,
  removeReplayRecording,
  saveActiveReplaySession,
  saveReplayLibrary,
  saveLastReplaySession,
} from "../../src/replay/session.js";

function createSample(overrides = {}) {
  return {
    timestampMs: 1000,
    latitude: 40.7128,
    longitude: -74.006,
    speedMs: 0,
    altitudeM: 10,
    accuracyM: 5,
    headingDeg: 180,
    totalDistanceM: 0,
    ...overrides,
  };
}

describe("replay helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("limits recorded samples while preserving the first and last point", () => {
    const samples = Array.from({ length: 8 }, (_, index) => createSample({
      timestampMs: 1000 + (index * 1000),
      latitude: 40 + index,
      longitude: -74 + index,
    }));

    const limited = limitReplaySamples(samples, 4);

    expect(limited).toHaveLength(4);
    expect(limited[0].timestampMs).toBe(samples[0].timestampMs);
    expect(limited[limited.length - 1].timestampMs).toBe(samples[samples.length - 1].timestampMs);
  });

  it("appends replay samples and keeps units plus summary metadata in sync", () => {
    let session = createReplaySession({ unit: "mph", distanceUnit: "ft" });

    session = appendReplaySample(session, createSample(), {
      unit: "mph",
      distanceUnit: "ft",
    });
    session = appendReplaySample(session, createSample({
      timestampMs: 2000,
      latitude: 40.7138,
      longitude: -74.005,
      speedMs: 20,
      altitudeM: 14,
      totalDistanceM: 120,
    }), {
      unit: "kmh",
      distanceUnit: "m",
    });

    expect(session.unit).toBe("kmh");
    expect(session.distanceUnit).toBe("m");
    expect(session.samples).toHaveLength(2);
    expect(session.maxSpeedMs).toBe(20);
    expect(session.totalDistanceM).toBe(120);
    expect(session.minAltitudeM).toBe(10);
    expect(session.maxAltitudeM).toBe(14);
  });

  it("rebuilds cumulative distance for legacy recordings that are missing per-sample totals", () => {
    const session = normalizeReplaySession({
      id: "legacy-distance",
      unit: "kmh",
      distanceUnit: "m",
      startedAtMs: 1000,
      endedAtMs: 3000,
      totalDistanceM: 0,
      samples: [
        createSample({ timestampMs: 1000, latitude: 40.7128, longitude: -74.006, totalDistanceM: undefined }),
        createSample({ timestampMs: 2000, latitude: 40.7138, longitude: -74.005, totalDistanceM: undefined }),
        createSample({ timestampMs: 3000, latitude: 40.7148, longitude: -74.004, totalDistanceM: undefined }),
      ],
    });

    expect(session.samples[0].totalDistanceM).toBe(0);
    expect(session.samples[1].totalDistanceM).toBeGreaterThan(0);
    expect(session.samples[2].totalDistanceM).toBeGreaterThan(session.samples[1].totalDistanceM);
    expect(session.totalDistanceM).toBe(session.samples[2].totalDistanceM);
  });

  it("prefers the active session when loading replay selection and exposes the recordings list", () => {
    const activeSession = appendReplaySample(
      appendReplaySample(createReplaySession(), createSample()),
      createSample({ timestampMs: 2000, speedMs: 15 }),
    );
    const lastSession = appendReplaySample(
      appendReplaySample(createReplaySession(), createSample({ timestampMs: 5000 })),
      createSample({ timestampMs: 6000, speedMs: 8 }),
    );

    saveActiveReplaySession(activeSession);
    saveLastReplaySession(lastSession);

    const selection = loadReplaySelection();
    const records = loadReplayRecords();

    expect(selection.source).toBe("active");
    expect(selection.session.samples).toHaveLength(2);
    expect(records).toHaveLength(2);
    expect(records[0].source).toBe("active");
  });

  it("falls back to the saved recordings library when there is no active session", () => {
    saveReplayLibrary([
      appendReplaySample(
        appendReplaySample(createReplaySession({ id: "library-only" }), createSample({ timestampMs: 5000 })),
        createSample({ timestampMs: 6000, speedMs: 9, totalDistanceM: 120 }),
      ),
    ]);

    const selection = loadReplaySelection();

    expect(selection.source).toBe("library");
    expect(selection.session.id).toBe("library-only");
  });

  it("archives finalized sessions into a bounded replay library and migrates the legacy slot", () => {
    const session = appendReplaySample(
      appendReplaySample(createReplaySession({ id: "active-1" }), createSample()),
      createSample({ timestampMs: 3000, speedMs: 18, totalDistanceM: 240 }),
    );

    archiveReplaySession(session, { endedAtMs: 3000 });

    const library = loadReplayLibrary();

    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({
      id: "active-1",
      recordingState: "stopped",
      totalDistanceM: 240,
    });

    saveLastReplaySession(appendReplaySample(
      appendReplaySample(createReplaySession({ id: "legacy-last" }), createSample({ timestampMs: 7000 })),
      createSample({ timestampMs: 8000, speedMs: 11 }),
    ));

    expect(loadReplayLibrary().map((entry) => entry.id)).toContain("legacy-last");
  });

  it("removes saved recordings without affecting the rest of the library", () => {
    saveReplayLibrary([
      appendReplaySample(
        appendReplaySample(createReplaySession({ id: "keep-me" }), createSample({ timestampMs: 1000 })),
        createSample({ timestampMs: 2000, speedMs: 7 }),
      ),
      appendReplaySample(
        appendReplaySample(createReplaySession({ id: "delete-me" }), createSample({ timestampMs: 3000 })),
        createSample({ timestampMs: 4000, speedMs: 9 }),
      ),
    ]);
    saveLastReplaySession(appendReplaySample(
      appendReplaySample(createReplaySession({ id: "delete-me" }), createSample({ timestampMs: 5000 })),
      createSample({ timestampMs: 6000, speedMs: 10 }),
    ));

    const remaining = removeReplayRecording("delete-me");

    expect(remaining.map((entry) => entry.id)).toEqual(["keep-me"]);
    expect(loadReplayLibrary().map((entry) => entry.id)).toEqual(["keep-me"]);
    expect(localStorage.getItem("vatio_speed_replay_last_v1")).toBeNull();
  });

  it("interpolates replay samples and the played route at a given elapsed time", () => {
    const session = {
      samples: [
        createSample({ timestampMs: 1000, latitude: 40, longitude: -74, speedMs: 0, totalDistanceM: 0 }),
        createSample({ timestampMs: 3000, latitude: 42, longitude: -72, speedMs: 20, totalDistanceM: 200 }),
        createSample({ timestampMs: 5000, latitude: 43, longitude: -71, speedMs: 30, totalDistanceM: 400 }),
      ],
      startedAtMs: 1000,
      endedAtMs: 5000,
      totalDistanceM: 400,
      maxSpeedMs: 30,
      distanceUnit: "m",
      unit: "kmh",
    };

    const sample = getReplaySampleAtElapsedMs(session, 1000);
    const playedCoordinates = getReplayPlayedCoordinates(session, 1000);
    const bounds = getReplayBounds(session);

    expect(sample.latitude).toBe(41);
    expect(sample.longitude).toBe(-73);
    expect(sample.speedMs).toBe(10);
    expect(sample.totalDistanceM).toBe(100);
    expect(playedCoordinates).toEqual([
      [-74, 40],
      [-73, 41],
    ]);
    expect(bounds).toEqual([
      [-74, 40],
      [-71, 43],
    ]);
  });

  it("interpolates replay samples from traveled distance for distance-mode scrubbing", () => {
    const session = {
      samples: [
        createSample({ timestampMs: 1000, latitude: 40, longitude: -74, speedMs: 0, totalDistanceM: 0 }),
        createSample({ timestampMs: 3000, latitude: 42, longitude: -72, speedMs: 20, totalDistanceM: 200 }),
        createSample({ timestampMs: 5000, latitude: 43, longitude: -71, speedMs: 30, totalDistanceM: 400 }),
      ],
      startedAtMs: 1000,
      endedAtMs: 5000,
      totalDistanceM: 400,
      maxSpeedMs: 30,
      distanceUnit: "m",
      unit: "kmh",
    };

    const sample = getReplaySampleAtDistanceM(session, 300);

    expect(sample.latitude).toBe(42.5);
    expect(sample.longitude).toBe(-71.5);
    expect(sample.speedMs).toBe(25);
    expect(sample.totalDistanceM).toBe(300);
    expect(sample.elapsedMs).toBe(3000);
  });

  it("builds summary totals and highlight moments from the replay session", () => {
    const session = {
      samples: [
        createSample({ timestampMs: 1000, speedMs: 0, altitudeM: 10, totalDistanceM: 0 }),
        createSample({ timestampMs: 2000, latitude: 40.713, longitude: -74.0055, speedMs: 12, altitudeM: 14, totalDistanceM: 40 }),
        createSample({ timestampMs: 3000, latitude: 40.714, longitude: -74.005, speedMs: 26, altitudeM: 22, totalDistanceM: 110 }),
        createSample({ timestampMs: 5000, latitude: 40.715, longitude: -74.004, speedMs: 18, altitudeM: 18, totalDistanceM: 170 }),
      ],
      startedAtMs: 1000,
      endedAtMs: 5000,
      totalDistanceM: 170,
      maxSpeedMs: 26,
      minAltitudeM: 10,
      maxAltitudeM: 22,
      distanceUnit: "m",
      unit: "kmh",
    };

    const summary = getReplaySummary(session);
    const highlights = getReplayHighlights(session);

    expect(summary).toMatchObject({
      sampleCount: 4,
      durationMs: 4000,
      totalDistanceM: 170,
      maxSpeedMs: 26,
      averageSpeedMs: 42.5,
      minAltitudeM: 10,
      maxAltitudeM: 22,
    });
    expect(highlights.map((highlight) => highlight.id)).toEqual([
      "first-move",
      "peak-speed",
      "highest-point",
      "strongest-pull",
    ]);
    expect(highlights[1].value).toBe(26);
    expect(highlights[2].value).toBe(22);
    expect(highlights[3].value).toBeCloseTo(14, 6);
  });

  it("builds graph models and playback cursors for speed, altitude, and heading", () => {
    const session = {
      samples: [
        createSample({ timestampMs: 1000, speedMs: 0, altitudeM: 10, headingDeg: 90 }),
        createSample({ timestampMs: 3000, speedMs: 10, altitudeM: 20, headingDeg: 180 }),
        createSample({ timestampMs: 5000, speedMs: 20, altitudeM: 15, headingDeg: 270 }),
      ],
      startedAtMs: 1000,
      endedAtMs: 5000,
      totalDistanceM: 180,
      maxSpeedMs: 20,
      distanceUnit: "m",
      unit: "kmh",
    };

    const speedGraph = buildReplayGraphModel(session, {
      metricKey: "speedMs",
      width: 320,
      height: 92,
      paddingX: 10,
      paddingY: 10,
      minValue: 0,
    });
    const headingGraph = buildReplayGraphModel(session, {
      metricKey: "headingDeg",
      width: 320,
      height: 92,
      paddingX: 10,
      paddingY: 10,
      minValue: 0,
      maxValue: 360,
    });

    expect(speedGraph.hasValues).toBe(true);
    expect(speedGraph.path.startsWith("M")).toBe(true);
    expect(speedGraph.areaPath.endsWith("Z")).toBe(true);
    expect(speedGraph.maxValue).toBe(20);
    expect(headingGraph.minValue).toBe(0);
    expect(headingGraph.maxValue).toBe(360);
    expect(buildReplayMetricSeries(session, "speedMs")).toEqual([
      { elapsedMs: 0, elapsedSeconds: 0, distanceM: 0, xValue: 0, value: 0 },
      { elapsedMs: 2000, elapsedSeconds: 2, distanceM: 0, xValue: 2, value: 10 },
      { elapsedMs: 4000, elapsedSeconds: 4, distanceM: 0, xValue: 4, value: 20 },
    ]);
    expect(buildReplayMetricSeries({
      ...session,
      samples: [
        createSample({ timestampMs: 1000, speedMs: 0, altitudeM: 10, headingDeg: 90, totalDistanceM: 0 }),
        createSample({ timestampMs: 3000, speedMs: 10, altitudeM: 20, headingDeg: 180, totalDistanceM: 60 }),
        createSample({ timestampMs: 5000, speedMs: 20, altitudeM: 15, headingDeg: 270, totalDistanceM: 180 }),
      ],
    }, "speedMs", "distance")).toEqual([
      { elapsedMs: 0, elapsedSeconds: 0, distanceM: 0, xValue: 0, value: 0 },
      { elapsedMs: 2000, elapsedSeconds: 2, distanceM: 60, xValue: 60, value: 10 },
      { elapsedMs: 4000, elapsedSeconds: 4, distanceM: 180, xValue: 180, value: 20 },
    ]);
    expect(getReplayGraphCursorX(session, 2000, { width: 320, paddingX: 10 })).toBe(160);
  });
});
