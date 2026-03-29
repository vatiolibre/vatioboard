import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReplayGraphModel,
  buildReplayMetricSeries,
  getReplayAxisRange,
  getReplayMetricDomain,
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
  loadActiveReplaySession,
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

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createFakeIndexedDb({ shouldFailPut = () => false } = {}) {
  const records = new Map();
  const objectStoreNames = new Set();
  let putCounter = 0;
  let failPut = shouldFailPut;

  function createRequest(executor) {
    const request = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };

    queueMicrotask(() => {
      try {
        executor({
          resolve(value) {
            request.result = cloneJson(value);
            request.onsuccess?.({ target: request });
          },
          reject(error) {
            request.error = error;
            request.onerror?.({ target: request });
          },
        });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
      }
    });

    return request;
  }

  const database = {
    objectStoreNames: {
      contains(name) {
        return objectStoreNames.has(name);
      },
    },
    createObjectStore(name) {
      objectStoreNames.add(name);
      return {};
    },
    transaction() {
      const transaction = {
        onabort: null,
        error: null,
        objectStore() {
          return {
            get(key) {
              return createRequest(({ resolve }) => {
                resolve(records.has(key) ? records.get(key) : undefined);
              });
            },
            put(value, key) {
              return createRequest(({ resolve, reject }) => {
                putCounter += 1;
                if (failPut(key, cloneJson(value), putCounter)) {
                  const error = new Error(`Failed to store ${key}`);
                  transaction.error = error;
                  reject(error);
                  return;
                }

                records.set(key, cloneJson(value));
                resolve(undefined);
              });
            },
            delete(key) {
              return createRequest(({ resolve }) => {
                records.delete(key);
                resolve(undefined);
              });
            },
          };
        },
      };

      return transaction;
    },
  };

  return {
    __records: records,
    open: vi.fn(() => {
      const request = {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        try {
          request.onupgradeneeded?.({ target: request });
          request.onsuccess?.({ target: request });
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
        }
      });

      return request;
    }),
    setShouldFailPut(nextShouldFailPut) {
      failPut = nextShouldFailPut;
    },
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

    session = appendReplaySample(session, createSample({
      totalDistanceM: 500,
    }), {
      unit: "mph",
      distanceUnit: "ft",
    });
    session = appendReplaySample(session, createSample({
      timestampMs: 2000,
      latitude: 40.7138,
      longitude: -74.005,
      speedMs: 20,
      altitudeM: 14,
      totalDistanceM: 620,
    }), {
      unit: "kmh",
      distanceUnit: "m",
    });

    expect(session.unit).toBe("kmh");
    expect(session.distanceUnit).toBe("m");
    expect(session.startDistanceM).toBe(500);
    expect(session.samples).toHaveLength(2);
    expect(session.samples[0].totalDistanceM).toBe(0);
    expect(session.samples[1].totalDistanceM).toBe(120);
    expect(session.sampleCount).toBe(2);
    expect(session.maxSpeedMs).toBe(20);
    expect(session.totalDistanceM).toBe(120);
    expect(session.minAltitudeM).toBe(10);
    expect(session.maxAltitudeM).toBe(14);
  });

  it("rebases replay distances to the recording start when recording begins mid-trip", () => {
    const legacySession = normalizeReplaySession({
      id: "mid-trip",
      unit: "kmh",
      distanceUnit: "m",
      totalDistanceM: 680,
      samples: [
        createSample({
          timestampMs: 1000,
          totalDistanceM: 500,
        }),
        createSample({
          timestampMs: 2000,
          speedMs: 12,
          totalDistanceM: 580,
        }),
        createSample({
          timestampMs: 3000,
          speedMs: 20,
          totalDistanceM: 680,
        }),
      ],
    });

    expect(legacySession.startDistanceM).toBe(500);
    expect(legacySession.totalDistanceM).toBe(180);
    expect(legacySession.samples[0].totalDistanceM).toBe(0);
    expect(legacySession.samples[1].totalDistanceM).toBe(80);
    expect(legacySession.samples[2].totalDistanceM).toBe(180);
    expect(getReplaySummary(legacySession).totalDistanceM).toBe(180);
    expect(buildReplayMetricSeries(legacySession, "speedMs", "distance").map((point) => point.xValue)).toEqual([0, 80, 180]);
    expect(getReplaySampleAtDistanceM(legacySession, 180)?.totalDistanceM).toBe(180);
  });

  it("preserves more than 1200 replay samples when saving and loading the active session", async () => {
    let session = createReplaySession({ id: "long-drive", unit: "kmh", distanceUnit: "m" });

    for (let index = 0; index < 1305; index += 1) {
      session = appendReplaySample(session, createSample({
        timestampMs: 1000 + (index * 100),
        latitude: 40.7128 + (index / 100000),
        longitude: -74.006 + (index / 100000),
        speedMs: index % 30,
        altitudeM: 10 + (index % 5),
        totalDistanceM: index * 8,
      }));
    }

    await saveActiveReplaySession(session);
    const restoredSession = await loadActiveReplaySession({ includeSamples: true });

    expect(restoredSession.sampleCount).toBe(1305);
    expect(restoredSession.samples).toHaveLength(1305);
    expect(restoredSession.samples[0].timestampMs).toBe(1000);
    expect(restoredSession.samples[1304].timestampMs).toBe(1000 + (1304 * 100));
  });

  it("rebases chunked metadata-only sessions after reload", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const replay = await import("../../src/replay/session.js");

      fakeIndexedDb.__records.set(replay.REPLAY_ACTIVE_KEY, {
        id: "legacy-chunked",
        version: 1,
        source: "speed",
        unit: "kmh",
        distanceUnit: "m",
        recordingState: "stopped",
        startedAtMs: 1000,
        updatedAtMs: 3000,
        endedAtMs: 3000,
        maxSpeedMs: 20,
        totalDistanceM: 680,
        minAltitudeM: 10,
        maxAltitudeM: 20,
        sampleCount: 3,
        chunkCount: 1,
        persistedSampleCount: 3,
        lastSample: createSample({
          timestampMs: 3000,
          speedMs: 20,
          altitudeM: 20,
          totalDistanceM: 680,
        }),
        samples: [],
      });
      fakeIndexedDb.__records.set("replayChunk:legacy-chunked:0", [
        createSample({
          timestampMs: 1000,
          totalDistanceM: 500,
        }),
        createSample({
          timestampMs: 2000,
          speedMs: 12,
          altitudeM: 15,
          totalDistanceM: 580,
        }),
        createSample({
          timestampMs: 3000,
          speedMs: 20,
          altitudeM: 20,
          totalDistanceM: 680,
        }),
      ]);

      const restoredSession = await replay.loadActiveReplaySession();

      expect(restoredSession.startDistanceM).toBe(500);
      expect(restoredSession.totalDistanceM).toBe(180);
      expect(restoredSession.lastSample.totalDistanceM).toBe(180);
      expect(fakeIndexedDb.__records.get(replay.REPLAY_ACTIVE_KEY)).toMatchObject({
        startDistanceM: 500,
        totalDistanceM: 180,
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it("keeps unsaved replay samples embedded when a chunk write fails", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb({
      shouldFailPut: (key) => key === "replayChunk:partial-save:1",
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const replay = await import("../../src/replay/session.js");
      let session = replay.createReplaySession({ id: "partial-save", unit: "kmh", distanceUnit: "m" });

      for (let index = 0; index < 401; index += 1) {
        session = replay.appendReplaySample(session, createSample({
          timestampMs: 1000 + (index * 100),
          latitude: 40.7128 + (index / 100000),
          longitude: -74.006 + (index / 100000),
          totalDistanceM: index * 6,
        }));
      }

      await replay.saveActiveReplaySession(session);

      const pendingSession = await replay.loadActiveReplaySession();

      expect(pendingSession.chunkCount).toBe(1);
      expect(pendingSession.persistedSampleCount).toBe(200);
      expect(pendingSession.sampleCount).toBe(401);
      expect(pendingSession.samples).toHaveLength(201);
      expect(fakeIndexedDb.__records.has("replayChunk:partial-save:0")).toBe(true);
      expect(fakeIndexedDb.__records.has("replayChunk:partial-save:1")).toBe(false);

      fakeIndexedDb.setShouldFailPut(() => false);
      await replay.saveActiveReplaySession(pendingSession);

      const restoredSession = await replay.loadActiveReplaySession({ includeSamples: true });

      expect(restoredSession.sampleCount).toBe(401);
      expect(restoredSession.persistedSampleCount).toBe(401);
      expect(restoredSession.samples).toHaveLength(401);
      expect((await replay.loadActiveReplaySession()).samples).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it("deletes stored replay chunks when clearing the active session", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const replay = await import("../../src/replay/session.js");
      let session = replay.createReplaySession({ id: "active-cleanup", unit: "kmh", distanceUnit: "m" });

      for (let index = 0; index < 250; index += 1) {
        session = replay.appendReplaySample(session, createSample({
          timestampMs: 1000 + (index * 100),
          latitude: 40.7128 + (index / 100000),
          longitude: -74.006 + (index / 100000),
          totalDistanceM: index * 4,
        }));
      }

      await replay.saveActiveReplaySession(session);
      expect(fakeIndexedDb.__records.has(replay.REPLAY_ACTIVE_KEY)).toBe(true);
      expect(fakeIndexedDb.__records.has("replayChunk:active-cleanup:0")).toBe(true);
      expect(fakeIndexedDb.__records.has("replayChunk:active-cleanup:1")).toBe(true);

      await replay.clearActiveReplaySession();

      expect(await replay.loadActiveReplaySession()).toBeNull();
      expect(fakeIndexedDb.__records.has(replay.REPLAY_ACTIVE_KEY)).toBe(false);
      expect(fakeIndexedDb.__records.has("replayChunk:active-cleanup:0")).toBe(false);
      expect(fakeIndexedDb.__records.has("replayChunk:active-cleanup:1")).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
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

  it("prefers the active session when loading replay selection and exposes the recordings list", async () => {
    const activeSession = appendReplaySample(
      appendReplaySample(createReplaySession(), createSample()),
      createSample({ timestampMs: 2000, speedMs: 15 }),
    );
    const lastSession = appendReplaySample(
      appendReplaySample(createReplaySession(), createSample({ timestampMs: 5000 })),
      createSample({ timestampMs: 6000, speedMs: 8 }),
    );

    await saveActiveReplaySession(activeSession);
    await saveLastReplaySession(lastSession);

    const selection = await loadReplaySelection();
    const records = await loadReplayRecords();

    expect(selection.source).toBe("active");
    expect(selection.session.samples).toHaveLength(2);
    expect(records).toHaveLength(2);
    expect(records[0].source).toBe("active");
  });

  it("falls back to the saved recordings library when there is no active session", async () => {
    await saveReplayLibrary([
      appendReplaySample(
        appendReplaySample(createReplaySession({ id: "library-only" }), createSample({ timestampMs: 5000 })),
        createSample({ timestampMs: 6000, speedMs: 9, totalDistanceM: 120 }),
      ),
    ]);

    const selection = await loadReplaySelection();

    expect(selection.source).toBe("library");
    expect(selection.session.id).toBe("library-only");
  });

  it("archives finalized sessions into a bounded replay library and migrates the legacy slot", async () => {
    const session = appendReplaySample(
      appendReplaySample(createReplaySession({ id: "active-1" }), createSample()),
      createSample({ timestampMs: 3000, speedMs: 18, totalDistanceM: 240 }),
    );

    await archiveReplaySession(session, { endedAtMs: 3000 });

    const library = await loadReplayLibrary();

    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({
      id: "active-1",
      recordingState: "stopped",
      totalDistanceM: 240,
    });

    await saveLastReplaySession(appendReplaySample(
      appendReplaySample(createReplaySession({ id: "legacy-last" }), createSample({ timestampMs: 7000 })),
      createSample({ timestampMs: 8000, speedMs: 11 }),
    ));

    expect((await loadReplayLibrary()).map((entry) => entry.id)).toContain("legacy-last");
  });

  it("removes saved recordings without affecting the rest of the library", async () => {
    await saveReplayLibrary([
      appendReplaySample(
        appendReplaySample(createReplaySession({ id: "keep-me" }), createSample({ timestampMs: 1000 })),
        createSample({ timestampMs: 2000, speedMs: 7 }),
      ),
      appendReplaySample(
        appendReplaySample(createReplaySession({ id: "delete-me" }), createSample({ timestampMs: 3000 })),
        createSample({ timestampMs: 4000, speedMs: 9 }),
      ),
    ]);
    await saveLastReplaySession(appendReplaySample(
      appendReplaySample(createReplaySession({ id: "delete-me" }), createSample({ timestampMs: 5000 })),
      createSample({ timestampMs: 6000, speedMs: 10 }),
    ));

    const remaining = await removeReplayRecording("delete-me");

    expect(remaining.map((entry) => entry.id)).toEqual(["keep-me"]);
    expect((await loadReplayLibrary()).map((entry) => entry.id)).toEqual(["keep-me"]);
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

  it("interpolates heading across north using the shortest circular path", () => {
    const session = {
      samples: [
        createSample({ timestampMs: 1000, headingDeg: 350, totalDistanceM: 0 }),
        createSample({ timestampMs: 3000, headingDeg: 10, totalDistanceM: 100 }),
      ],
      startedAtMs: 1000,
      endedAtMs: 3000,
      totalDistanceM: 100,
      distanceUnit: "m",
      unit: "kmh",
    };

    expect(getReplaySampleAtElapsedMs(session, 1000).headingDeg).toBe(0);
    expect(getReplaySampleAtDistanceM(session, 50).headingDeg).toBe(0);
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

  it("builds stable chart windows for touch-friendly graph filters", () => {
    expect(getReplayAxisRange(180, 0, 1)).toEqual({
      startRatio: 0,
      endRatio: 1,
      min: 0,
      max: 180,
    });
    expect(getReplayAxisRange(180, 0, 0.38)).toEqual({
      startRatio: 0,
      endRatio: 0.38,
      min: 0,
      max: 68.4,
    });
    expect(getReplayAxisRange(180, 0.8, 0.2)).toEqual({
      startRatio: 0.2,
      endRatio: 0.8,
      min: 36,
      max: 144,
    });
    expect(getReplayAxisRange(180, 0.99, 1)).toEqual({
      startRatio: 0.98,
      endRatio: 1,
      min: 176.4,
      max: 180,
    });
    expect(getReplayAxisRange(0, 0.4, 0.6)).toEqual({
      startRatio: 0,
      endRatio: 1,
      min: 0,
      max: 1,
    });
  });

  it("derives metric min and max from the filtered replay interval", () => {
    const session = {
      samples: [
        createSample({ timestampMs: 1000, speedMs: 0, altitudeM: 10, totalDistanceM: 0 }),
        createSample({ timestampMs: 2000, speedMs: 10, altitudeM: 16, totalDistanceM: 50 }),
        createSample({ timestampMs: 3000, speedMs: 30, altitudeM: 22, totalDistanceM: 110 }),
        createSample({ timestampMs: 4000, speedMs: 15, altitudeM: 18, totalDistanceM: 160 }),
      ],
      startedAtMs: 1000,
      endedAtMs: 4000,
      totalDistanceM: 160,
      maxSpeedMs: 30,
      distanceUnit: "m",
      unit: "kmh",
    };

    expect(getReplayMetricDomain(session, "speedMs", "time", { min: 1, max: 2.5 })).toEqual({
      min: 10,
      max: 30,
    });
    expect(getReplayMetricDomain(session, "altitudeM", "distance", { min: 25, max: 135 })).toEqual({
      min: 13,
      max: 22,
    });
  });

  it("keeps heading domains tight when the filtered interval crosses north", () => {
    const session = {
      samples: [
        createSample({ timestampMs: 1000, headingDeg: 350, totalDistanceM: 0 }),
        createSample({ timestampMs: 2000, headingDeg: 355, totalDistanceM: 40 }),
        createSample({ timestampMs: 3000, headingDeg: 5, totalDistanceM: 80 }),
        createSample({ timestampMs: 4000, headingDeg: 12, totalDistanceM: 120 }),
      ],
      startedAtMs: 1000,
      endedAtMs: 4000,
      totalDistanceM: 120,
      distanceUnit: "m",
      unit: "kmh",
    };

    expect(buildReplayMetricSeries(session, "headingDeg")).toEqual([
      { elapsedMs: 0, elapsedSeconds: 0, distanceM: 0, xValue: 0, value: 350 },
      { elapsedMs: 1000, elapsedSeconds: 1, distanceM: 40, xValue: 1, value: 355 },
      { elapsedMs: 2000, elapsedSeconds: 2, distanceM: 80, xValue: 2, value: 365 },
      { elapsedMs: 3000, elapsedSeconds: 3, distanceM: 120, xValue: 3, value: 372 },
    ]);
    expect(getReplayMetricDomain(session, "headingDeg", "time", { min: 0.5, max: 2.5 })).toEqual({
      min: 352.5,
      max: 368.5,
    });
  });
});
