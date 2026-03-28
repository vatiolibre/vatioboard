import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FT_TO_M,
  MAX_RESULT_TRACE_POINTS,
  MPH_TO_MS,
} from "../../src/accel/constants.js";
import {
  appendRunSampleLog,
  buildResult,
  buildSlopeAnalysis,
  compactSpeedTrace,
  createLiveSample,
  createRunState,
  seedRunPartialStarts,
  updateRunPartials,
} from "../../src/accel/logic.js";
import { buildComparisonSignature, getPresetSignature } from "../../src/accel/presets.js";

function createSettings(overrides = {}) {
  return {
    speedUnit: "mph",
    distanceUnit: "ft",
    launchThresholdMs: 0.5 * MPH_TO_MS,
    rolloutEnabled: false,
    notes: "",
    ...overrides,
  };
}

function createPreset(overrides = {}) {
  return {
    id: "0-60-mph",
    type: "speed",
    labelKey: "accelPreset0to60",
    standingStart: true,
    startSpeedMs: 0,
    targetSpeedMs: 60 * MPH_TO_MS,
    variantGroup: "launch-4",
    customStart: null,
    customEnd: null,
    customUnit: null,
    ...overrides,
  };
}

describe("accel logic helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates run state with rollout only for standing starts", () => {
    const settings = createSettings({ rolloutEnabled: true });
    const standingRun = createRunState({
      preset: createPreset(),
      settings,
      partials: [],
      nowMs: 100,
      perfMs: 25,
    });
    const rollingRun = createRunState({
      preset: createPreset({
        id: "60-130-mph",
        labelKey: "accelPreset60to130",
        standingStart: false,
        startSpeedMs: 60 * MPH_TO_MS,
        targetSpeedMs: 130 * MPH_TO_MS,
      }),
      settings,
      partials: [],
      nowMs: 200,
      perfMs: 50,
    });

    expect(standingRun.rolloutApplied).toBe(true);
    expect(standingRun.rolloutDistanceM).toBe(FT_TO_M);
    expect(standingRun.speedUnit).toBe("mph");
    expect(standingRun.distanceUnit).toBe("ft");
    expect(rollingRun.rolloutApplied).toBe(false);
    expect(rollingRun.rolloutDistanceM).toBe(0);
  });

  it("creates live samples with derived speed and stale flags when GPS speed is missing", () => {
    const sample = createLiveSample({
      position: {
        coords: {
          latitude: 0.0001,
          longitude: 0,
          accuracy: 4,
          altitude: 12,
          heading: 90,
          speed: null,
        },
        timestamp: 2000,
      },
      previousSample: {
        rawPerfMs: 1000,
        perfMs: 1000,
        receivedAtMs: 1000,
        latitude: 0,
        longitude: 0,
        accuracyM: 4,
      },
      rawPerfMs: 3500,
      receivedAtMs: 3500,
    });

    expect(sample.deltaMs).toBe(2500);
    expect(sample.rawSpeedMs).toBeNull();
    expect(sample.speedSource).toBe("derived");
    expect(sample.speedMs).toBeGreaterThan(4);
    expect(sample.segmentDistanceM).toBeGreaterThan(10);
    expect(sample.headingDeg).toBe(90);
    expect(sample.stale).toBe(true);
    expect(sample.sparse).toBe(true);
  });

  it("captures distance and speed partials with interpolated timings", () => {
    const sixtyFeetM = 60 * FT_TO_M;
    const run = createRunState({
      preset: createPreset(),
      settings: createSettings(),
      partials: [
        {
          id: "60-ft",
          kind: "distance",
          labelKey: "accelPartial60ft",
          distanceM: sixtyFeetM,
          showTrapSpeed: true,
          elapsedMs: null,
          trapSpeedMs: null,
        },
        {
          id: "0-60-mph",
          kind: "speed",
          labelKey: "accelPreset0to60",
          startSpeedMs: 0,
          targetSpeedMs: 60 * MPH_TO_MS,
          startCrossPerfMs: null,
          elapsedMs: null,
        },
      ],
      nowMs: 100,
      perfMs: 10,
    });

    run.startPerfMs = 1000;
    run.startDistanceM = 0;
    run.prevDistanceSinceArmM = 0;
    run.distanceSinceArmM = sixtyFeetM * 2;

    seedRunPartialStarts(run);
    updateRunPartials(
      run,
      {
        perfMs: 2000,
        speedMs: 20 * MPH_TO_MS,
      },
      {
        perfMs: 3000,
        speedMs: 70 * MPH_TO_MS,
      },
    );

    expect(run.partials[0].elapsedMs).toBe(1500);
    expect(run.partials[0].trapSpeedMs).toBeCloseTo(45 * MPH_TO_MS, 6);
    expect(run.partials[1].startCrossPerfMs).toBe(1000);
    expect(run.partials[1].elapsedMs).toBeCloseTo(1800, 6);
  });

  it("builds signed slope analysis with null guards", () => {
    expect(buildSlopeAnalysis(null, 105, 100)).toEqual({
      elevationDeltaM: null,
      slopePercent: null,
    });
    expect(buildSlopeAnalysis(100, 95, 200)).toEqual({
      elevationDeltaM: -5,
      slopePercent: -2.5,
    });
  });

  it("builds persisted results with stable signatures, trace data, and notes", () => {
    const settings = createSettings({ notes: "Back road" });
    const run = createRunState({
      preset: createPreset(),
      settings,
      partials: [
        {
          id: "0-60-mph",
          kind: "speed",
          labelKey: "accelPreset0to60",
          startSpeedMs: 0,
          targetSpeedMs: 60 * MPH_TO_MS,
          elapsedMs: 5000,
        },
      ],
      nowMs: 500,
      perfMs: 100,
    });

    run.startPerfMs = 1000;
    run.startDistanceM = 0;
    run.startAltitudeM = 100;
    run.startAccuracyM = 5;
    run.startTraceSpeedMs = 0;
    run.startSpeedSource = "reported";
    run.finishPerfMs = 6000;
    run.finishDistanceM = 120;
    run.finishSpeedMs = 60 * MPH_TO_MS;
    run.finishAltitudeM = 102;
    run.sampleCount = 6;
    run.intervalValues = [1000, 1000, 1000, 1000, 1000];
    run.accuracyValues = [5, 5, 6, 5, 5, 6];
    run.speedTrace = [
      { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5, speedSource: "reported" },
      { elapsedMs: 2500, speedMs: 30 * MPH_TO_MS, distanceM: 50, altitudeM: 101, accuracyM: 5, speedSource: "reported" },
      { elapsedMs: 5000, speedMs: 60 * MPH_TO_MS, distanceM: 120, altitudeM: 102, accuracyM: 5, speedSource: "reported" },
    ];

    vi.spyOn(Date, "now").mockReturnValue(7000);

    const result = buildResult(run, settings, {
      getPresetSignature,
      buildComparisonSignature,
    });

    expect(result).toMatchObject({
      id: run.id,
      savedAtMs: 7000,
      presetId: "0-60-mph",
      presetSignature: "0-60-mph",
      comparisonSignature: "launch-4",
      elapsedMs: 5000,
      finishSpeedMs: 60 * MPH_TO_MS,
      runDistanceM: 120,
      elevationDeltaM: 2,
      slopePercent: 2 / 120 * 100,
      qualityGrade: "good",
      speedSource: "reported",
      notes: "Back road",
    });
    expect(result.speedTrace).toHaveLength(3);
    expect(result.partials).toEqual([
      {
        id: "0-60-mph",
        kind: "speed",
        labelKey: "accelPreset0to60",
        startSpeedMs: 0,
        targetSpeedMs: 60 * MPH_TO_MS,
        elapsedMs: 5000,
      },
    ]);
  });

  it("retains dense raw sample logs beyond the old 200-row cutoff", () => {
    const run = createRunState({
      preset: createPreset(),
      settings: createSettings(),
      partials: [],
      nowMs: 100,
      perfMs: 10,
    });

    for (let index = 0; index < 300; index += 1) {
      appendRunSampleLog(run, {
        deltaMs: 80,
        latitude: 4.7 + (index / 100000),
        longitude: -74.07,
        rawSpeedMs: 0,
        derivedSpeedMs: null,
        speedMs: 20,
        speedSource: "reported",
        headingDeg: 180,
        accuracyM: 5,
        altitudeM: 2600,
        perfMs: 1000 + (index * 80),
        stale: false,
        sparse: false,
      });
    }

    expect(run.sampleLog).toHaveLength(300);
    expect(run.sampleLog[0].index).toBe(1);
    expect(run.sampleLog[299].index).toBe(300);
  });

  it("keeps higher-density traces intact until they exceed the result graph cap", () => {
    const denseTrace = Array.from({ length: MAX_RESULT_TRACE_POINTS - 10 }, (_, index) => ({
      elapsedMs: index * 50,
      speedMs: index / 10,
    }));

    expect(compactSpeedTrace(denseTrace)).toHaveLength(MAX_RESULT_TRACE_POINTS - 10);
  });
});
