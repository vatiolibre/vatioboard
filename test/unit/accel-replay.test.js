import { describe, expect, it } from "vitest";
import { MPH_TO_MS } from "../../src/accel/constants.js";
import {
  appendRunSampleLog,
  buildResult,
  createLiveSample,
  createRunState,
} from "../../src/accel/logic.js";
import { buildComparisonSignature, getPresetSignature } from "../../src/accel/presets.js";
import {
  buildAccelReplayMarkers,
  buildAccelReplayMapSession,
  buildAccelReplaySource,
  getAccelReplayBounds,
  getAccelReplayFrameAtDistanceM,
  getAccelReplayFrameAtElapsedMs,
  getAccelReplayMapDisplayFrame,
  getAccelReplayNearestGeoFrame,
  getAccelReplayPathCoordinates,
  getAccelReplayPlayedCoordinates,
} from "../../src/accel/replay.js";

function createResult(overrides = {}) {
  return {
    id: "run-1",
    elapsedMs: 5000,
    runDistanceM: 120,
    startAltitudeM: 100,
    finishSpeedMs: 60 * MPH_TO_MS,
    speedTrace: [
      { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5, speedSource: "reported" },
      { elapsedMs: 5000, speedMs: 60 * MPH_TO_MS, distanceM: 120, altitudeM: 102, accuracyM: 4, speedSource: "reported" },
    ],
    sampleLog: [
      { elapsedFromStartMs: 1000, speedMs: 12 * MPH_TO_MS, distanceFromStartM: 16, altitudeM: 100.4, headingDeg: 12, accuracyM: 5, speedSource: "reported", latitude: 12, longitude: -77 },
      { elapsedFromStartMs: 2500, speedMs: 31 * MPH_TO_MS, distanceFromStartM: 58, altitudeM: 101, headingDeg: 18, accuracyM: 4.5, speedSource: "reported", latitude: 12.001, longitude: -77.001 },
      { elapsedFromStartMs: 4000, speedMs: 49 * MPH_TO_MS, distanceFromStartM: 95, altitudeM: 101.7, headingDeg: 24, accuracyM: 4.2, speedSource: "reported", latitude: 12.002, longitude: -77.002 },
    ],
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
    ...overrides,
  };
}

function createCompletedResultFromLiveSamples() {
  const settings = {
    speedUnit: "mph",
    distanceUnit: "ft",
    launchThresholdMs: 0.5 * MPH_TO_MS,
    rolloutEnabled: false,
    notes: "",
  };
  const preset = {
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
  };
  const run = createRunState({
    preset,
    settings,
    partials: [],
    nowMs: 100000,
    perfMs: 900,
  });
  const inputs = [
    { perfMs: 1000, latitude: 40.7484, longitude: -73.9857, speed: 0 },
    { perfMs: 1200, latitude: 40.7484, longitude: -73.9857, speed: 0 },
    { perfMs: 2200, latitude: 40.7489, longitude: -73.9851, speed: 5 },
    { perfMs: 3200, latitude: 40.7494, longitude: -73.9845, speed: 15 },
    { perfMs: 4200, latitude: 40.7499, longitude: -73.9839, speed: 25 },
    { perfMs: 5200, latitude: 40.7504, longitude: -73.9833, speed: 30 },
  ];

  let previousSample = null;
  const samples = inputs.map((input) => {
    const sample = createLiveSample({
      position: {
        timestamp: input.perfMs,
        coords: {
          latitude: input.latitude,
          longitude: input.longitude,
          speed: input.speed,
          accuracy: 5,
          altitude: 15,
          heading: 180,
        },
      },
      previousSample,
      rawPerfMs: input.perfMs,
      receivedAtMs: input.perfMs,
    });
    previousSample = sample;
    return sample;
  });

  run.sampleCount = samples.length - 1;
  run.intervalValues = [1000, 1000, 1000, 1000];
  run.accuracyValues = [5, 5, 5, 5, 5];
  appendRunSampleLog(run, samples[1]);

  run.stage = "running";
  run.startPerfMs = samples[2].perfMs;
  run.startDistanceM = 0;
  run.startAltitudeM = samples[2].altitudeM;
  run.startAccuracyM = samples[2].accuracyM;
  run.startTraceSpeedMs = 0;
  run.startSpeedSource = samples[2].speedSource;

  for (let index = 2; index < samples.length; index += 1) {
    run.distanceSinceArmM += samples[index].segmentDistanceM;
    appendRunSampleLog(run, samples[index]);
  }

  run.finishPerfMs = samples[5].perfMs;
  run.finishDistanceM = run.distanceSinceArmM;
  run.finishSpeedMs = 60 * MPH_TO_MS;
  run.finishAltitudeM = samples[5].altitudeM;

  return buildResult(run, settings, {
    getPresetSignature,
    buildComparisonSignature,
  });
}

describe("accel replay helpers", () => {
  it("builds replay frames from sample logs while preserving trace start and finish", () => {
    const source = buildAccelReplaySource(createResult());

    expect(source).toMatchObject({
      resultId: "run-1",
      sourceType: "sampleLog",
      durationMs: 5000,
      totalDistanceM: 120,
      hasDistanceAxis: true,
    });
    expect(source.frames[0]).toMatchObject({
      elapsedMs: 0,
      speedMs: 0,
      distanceM: 0,
    });
    expect(source.frames[source.frames.length - 1]).toMatchObject({
      elapsedMs: 5000,
      distanceM: 120,
    });
    expect(source.frames[1].headingDeg).toBe(12);
    expect(source.frames[1]).toMatchObject({
      latitude: 12,
      longitude: -77,
    });
    expect(source.hasGeoPath).toBe(true);
  });

  it("keeps geo replay available for a completed result built from live GPS samples", () => {
    const completedResult = createCompletedResultFromLiveSamples();
    const replaySource = buildAccelReplaySource(completedResult);
    const mapSession = buildAccelReplayMapSession(replaySource);

    expect(completedResult.sampleLog.some((sample) =>
      Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude)
    )).toBe(true);
    expect(replaySource?.hasGeoPath).toBe(true);
    expect(getAccelReplayPathCoordinates(replaySource).length).toBeGreaterThanOrEqual(2);
    expect(mapSession.samples.filter((sample) =>
      Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude)
    ).length).toBeGreaterThanOrEqual(2);
  });

  it("interpolates replay frames by elapsed time and distance", () => {
    const source = buildAccelReplaySource(createResult({
      sampleLog: [],
      speedTrace: [
        { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5 },
        { elapsedMs: 5000, speedMs: 60 * MPH_TO_MS, distanceM: 120, altitudeM: 102, accuracyM: 4 },
      ],
    }));

    const atHalfTime = getAccelReplayFrameAtElapsedMs(source, 2500);
    const atHalfDistance = getAccelReplayFrameAtDistanceM(source, 60);

    expect(atHalfTime.speedMs).toBeCloseTo(30 * MPH_TO_MS, 6);
    expect(atHalfTime.distanceM).toBeCloseTo(60, 6);
    expect(atHalfTime.altitudeM).toBeCloseTo(101, 6);
    expect(atHalfDistance.elapsedMs).toBeCloseTo(2500, 6);
    expect(atHalfDistance.speedMs).toBeCloseTo(30 * MPH_TO_MS, 6);
  });

  it("interpolates heading through north instead of crossing the long way around", () => {
    const source = buildAccelReplaySource(createResult({
      speedTrace: [
        { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5 },
        { elapsedMs: 5000, speedMs: 60 * MPH_TO_MS, distanceM: 120, altitudeM: 102, accuracyM: 4 },
      ],
      sampleLog: [
        { elapsedFromStartMs: 1000, speedMs: 12 * MPH_TO_MS, distanceFromStartM: 16, altitudeM: 100.4, headingDeg: 350, accuracyM: 5, speedSource: "reported" },
        { elapsedFromStartMs: 4000, speedMs: 49 * MPH_TO_MS, distanceFromStartM: 95, altitudeM: 101.7, headingDeg: 10, accuracyM: 4.2, speedSource: "reported" },
      ],
    }));

    const midpoint = getAccelReplayFrameAtElapsedMs(source, 2500);

    expect(midpoint.headingDeg).toBeCloseTo(0, 6);
  });

  it("keeps geo coordinates through accel replay and avoids snapping before the first geo sample", () => {
    const source = buildAccelReplaySource(createResult());

    const beforeFirstGeoSample = getAccelReplayFrameAtElapsedMs(source, 500);
    const afterLastGeoSample = getAccelReplayFrameAtElapsedMs(source, 4800);

    expect(beforeFirstGeoSample.latitude).toBeNull();
    expect(beforeFirstGeoSample.longitude).toBeNull();
    expect(afterLastGeoSample.latitude).toBeCloseTo(12.002, 6);
    expect(afterLastGeoSample.longitude).toBeCloseTo(-77.002, 6);
  });

  it("provides a map marker fallback when the first replay frame has no coordinates", () => {
    const source = buildAccelReplaySource(createResult());
    const initialPlaybackFrame = getAccelReplayFrameAtElapsedMs(source, 0);
    const nearestGeoFrame = getAccelReplayNearestGeoFrame(source, 0);
    const mapDisplayFrame = getAccelReplayMapDisplayFrame(source, initialPlaybackFrame, 0);
    const pathCoordinates = getAccelReplayPathCoordinates(source);
    const initialPlayedCoordinates = getAccelReplayPlayedCoordinates(source, 0);

    expect(pathCoordinates).toHaveLength(3);
    expect(pathCoordinates[0]).toEqual([-77, 12]);
    expect(initialPlaybackFrame.latitude).toBeNull();
    expect(initialPlaybackFrame.longitude).toBeNull();
    expect(nearestGeoFrame).toMatchObject({
      latitude: 12,
      longitude: -77,
    });
    expect(mapDisplayFrame).toMatchObject({
      elapsedMs: 0,
      latitude: 12,
      longitude: -77,
    });
    expect(initialPlayedCoordinates).toEqual([]);
  });

  it("uses an interpolated geo finish when the completing GPS callback lands after the result time", () => {
    const source = buildAccelReplaySource(createResult({
      elapsedMs: 3300,
      runDistanceM: 100,
      finishDistanceM: 100,
      finishSpeedMs: 60 * MPH_TO_MS,
      finishAltitudeM: 103,
      speedTrace: [
        { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5 },
        { elapsedMs: 3300, speedMs: 60 * MPH_TO_MS, distanceM: 100, altitudeM: 103, accuracyM: 4 },
      ],
      sampleLog: [
        {
          elapsedFromStartMs: 1000,
          speedMs: 18 * MPH_TO_MS,
          distanceFromStartM: 20,
          altitudeM: 100.5,
          headingDeg: 10,
          accuracyM: 5,
          speedSource: "reported",
          latitude: 12,
          longitude: -77,
        },
        {
          elapsedFromStartMs: 3000,
          speedMs: 52 * MPH_TO_MS,
          distanceFromStartM: 88,
          altitudeM: 102.5,
          headingDeg: 20,
          accuracyM: 4.2,
          speedSource: "reported",
          latitude: 12.002,
          longitude: -77.002,
        },
        {
          elapsedFromStartMs: 4000,
          speedMs: 65 * MPH_TO_MS,
          distanceFromStartM: 126,
          altitudeM: 104,
          headingDeg: 30,
          accuracyM: 4,
          speedSource: "reported",
          latitude: 12.004,
          longitude: -77.004,
        },
      ],
    }));

    const playedCoordinates = getAccelReplayPlayedCoordinates(source, source.durationMs);
    const finishPoint = getAccelReplayFrameAtElapsedMs(source, source.durationMs);

    expect(source.durationMs).toBe(3300);
    expect(source.frames.every((frame) => frame.elapsedMs <= source.durationMs)).toBe(true);
    expect(finishPoint).toMatchObject({
      elapsedMs: 3300,
      distanceM: 100,
    });
    expect(finishPoint.latitude).toBeCloseTo(12.0026, 6);
    expect(finishPoint.longitude).toBeCloseTo(-77.0026, 6);
    expect(playedCoordinates.at(-1)[0]).toBeCloseTo(-77.0026, 6);
    expect(playedCoordinates.at(-1)[1]).toBeCloseTo(12.0026, 6);
  });

  it("builds accel replay geo helpers from replay frames", () => {
    const source = buildAccelReplaySource(createResult());

    expect(getAccelReplayPathCoordinates(source)).toEqual([
      [-77, 12],
      [-77.001, 12.001],
      [-77.002, 12.002],
    ]);
    expect(getAccelReplayPlayedCoordinates(source, 3200)).toEqual([
      [-77, 12],
      [-77.001, 12.001],
      [-77.00146666666667, 12.001466666666667],
    ]);
    expect(getAccelReplayBounds(source)).toEqual([
      [-77.002, 12],
      [-77, 12.002],
    ]);
  });

  it("builds a session-like map payload from accel replay sources", () => {
    const source = buildAccelReplaySource(createResult());
    const mapSession = buildAccelReplayMapSession(source);

    expect(mapSession).toMatchObject({
      startedAtMs: 0,
      endedAtMs: 5000,
      totalDistanceM: 120,
      minAltitudeM: 100.4,
      maxAltitudeM: 101.7,
    });
    expect(mapSession.samples).toHaveLength(3);
    expect(mapSession.samples[0]).toMatchObject({
      timestampMs: 1000,
      latitude: 12,
      longitude: -77,
      totalDistanceM: 16,
    });
  });

  it("keeps the accel map available when geo samples repeat the same coordinate", () => {
    const source = buildAccelReplaySource(createResult({
      sampleLog: [
        {
          elapsedFromStartMs: 1000,
          speedMs: 12 * MPH_TO_MS,
          distanceFromStartM: 16,
          altitudeM: 100.4,
          headingDeg: 12,
          accuracyM: 5,
          speedSource: "reported",
          latitude: 12,
          longitude: -77,
        },
        {
          elapsedFromStartMs: 2500,
          speedMs: 31 * MPH_TO_MS,
          distanceFromStartM: 58,
          altitudeM: 101,
          headingDeg: 18,
          accuracyM: 4.5,
          speedSource: "reported",
          latitude: 12,
          longitude: -77,
        },
      ],
    }));

    const mapSession = buildAccelReplayMapSession(source);

    expect(source.hasGeoPath).toBe(true);
    expect(getAccelReplayPathCoordinates(source)).toEqual([[-77, 12]]);
    expect(mapSession).not.toBeNull();
    expect(mapSession.samples).toHaveLength(2);
  });

  it("builds partial and finish markers for accel replay", () => {
    const source = buildAccelReplaySource(createResult());
    const markers = buildAccelReplayMarkers(createResult(), source, {
      finishLabel: "Finish",
      getPartialLabel: (partial) => partial.labelKey,
    });

    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({
      id: "0-60-mph",
      kind: "partial",
      label: "accelPreset0to60",
      elapsedMs: 5000,
    });
    expect(markers[1]).toMatchObject({
      kind: "finish",
      label: "Finish",
      distanceM: 120,
    });
  });

  it("preserves the saved finish distance when stored traces end short", () => {
    const source = buildAccelReplaySource(createResult({
      speedTrace: [
        { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5, speedSource: "reported" },
        { elapsedMs: 1200, speedMs: 14 * MPH_TO_MS, distanceM: 18, altitudeM: 100.4, accuracyM: 5, speedSource: "reported" },
        { elapsedMs: 3000, speedMs: 38 * MPH_TO_MS, distanceM: 72, altitudeM: 101.4, accuracyM: 4.4, speedSource: "reported" },
        { elapsedMs: 5000, speedMs: 60 * MPH_TO_MS, distanceM: 102, altitudeM: 102, accuracyM: 4.5, speedSource: "reported" },
      ],
    }));

    const finishFrame = getAccelReplayFrameAtElapsedMs(source, 5000);

    expect(source.totalDistanceM).toBe(120);
    expect(finishFrame.distanceM).toBe(120);
    expect(finishFrame.speedMs).toBeCloseTo(60 * MPH_TO_MS, 6);
  });
});
