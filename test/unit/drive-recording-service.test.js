import { describe, expect, it, vi } from "vitest";

import {
  createDriveRecordingService,
  DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE,
} from "../../src/app/services/drive-recording-service.js";
import { getBackgroundKeepAliveAudio, hasBackgroundAudioLease } from "../../src/shared/audio-system.js";

function createGpsStoreDouble() {
  const listeners = new Set();
  let position = null;
  return {
    startConsumer: vi.fn(() => vi.fn()),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    getCurrentPosition: vi.fn(() => position),
    emit(nextPosition) {
      position = nextPosition;
      for (const listener of listeners) listener({ normalized: nextPosition });
    },
  };
}

function createRepositoryDouble() {
  return {
    createReplaySession: vi.fn((options = {}) => ({
      id: "session-1",
      samples: [],
      sampleCount: 0,
      recordingState: options.recordingState || "stopped",
      unit: options.unit || "kmh",
      distanceUnit: options.distanceUnit || "km",
    })),
    appendReplaySample: vi.fn((session, sample, options = {}) => ({
      ...session,
      samples: [...(session.samples || []), sample],
      sampleCount: (session.sampleCount || 0) + 1,
      recordingState: options.recordingState || session.recordingState,
    })),
    loadActiveReplaySession: vi.fn(async () => null),
    saveActiveReplaySession: vi.fn(async (session) => session),
    archiveReplaySession: vi.fn(async (session, options = {}) => ({
      ...session,
      recordingState: "stopped",
      endedAtMs: options.endedAtMs,
    })),
  };
}

function createTelemetryDouble() {
  const sampleListeners = new Set();
  let snapshot = {
    lastPosition: null,
    lastGpsSampleSequence: null,
    currentSpeedMs: 0,
    totalDistanceM: 0,
    currentAltitudeM: null,
    headingDeg: null,
    accuracyM: null,
  };
  return {
    start: vi.fn(() => snapshot),
    subscribeSamples: vi.fn((listener) => {
      sampleListeners.add(listener);
      return () => sampleListeners.delete(listener);
    }),
    getSnapshot: vi.fn(() => snapshot),
    emit(sample) {
      snapshot = {
        ...snapshot,
        lastGpsSampleSequence: sample.gpsSampleSequence,
        currentSpeedMs: sample.processedSpeedMs,
        totalDistanceM: sample.totalDistanceM,
        currentAltitudeM: sample.altitudeM,
        headingDeg: sample.headingDeg,
        accuracyM: sample.accuracyM,
        lastPosition: {
          sampleSequence: sample.gpsSampleSequence,
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracy: sample.accuracyM,
          altitudeM: sample.altitudeM,
          speedMs: sample.processedSpeedMs,
          headingDeg: sample.headingDeg,
          timestampMs: sample.timestampMs,
          receivedAtMs: sample.timestampMs,
          stale: false,
        },
      };
      for (const listener of sampleListeners) listener(sample);
    },
  };
}

describe("createDriveRecordingService", () => {
  it("persists canonical telemetry samples once without coordinate accumulation", () => {
    const gpsStore = createGpsStoreDouble();
    const telemetryService = createTelemetryDouble();
    const replayRepository = createRepositoryDouble();
    const service = createDriveRecordingService({ gpsStore, telemetryService, replayRepository });
    service.startRecording({ source: "map" });
    const sample = {
      gpsSampleSequence: 7,
      timestampMs: 7000,
      latitude: 40.7,
      longitude: -73.9,
      processedSpeedMs: 12,
      distanceDeltaM: 9,
      totalDistanceM: 109,
      altitudeM: 14,
      headingDeg: 90,
      accuracyM: 4,
    };
    telemetryService.emit(sample);
    telemetryService.emit(sample);

    expect(gpsStore.startConsumer).not.toHaveBeenCalled();
    expect(replayRepository.appendReplaySample).toHaveBeenCalledTimes(1);
    expect(replayRepository.appendReplaySample).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ speedMs: 12, totalDistanceM: 109 }),
      expect.objectContaining({ distanceUnit: "m", tripDistanceUnit: "km" }),
    );
    expect(service.getSnapshot()).toMatchObject({ sampleCount: 1, currentSpeedMs: 12 });
    service.destroy();
  });

  it("keeps replay distance monotonic when telemetry is reset during recording", () => {
    const telemetryService = createTelemetryDouble();
    const replayRepository = createRepositoryDouble();
    const service = createDriveRecordingService({ telemetryService, replayRepository });
    service.startRecording();
    const base = {
      timestampMs: 1000,
      latitude: 40.7,
      longitude: -73.9,
      processedSpeedMs: 8,
      distanceDeltaM: 10,
      altitudeM: null,
      headingDeg: null,
      accuracyM: 4,
    };
    telemetryService.emit({ ...base, gpsSampleSequence: 1, totalDistanceM: 100 });
    telemetryService.emit({ ...base, gpsSampleSequence: 2, timestampMs: 2000, totalDistanceM: 0 });
    telemetryService.emit({ ...base, gpsSampleSequence: 3, timestampMs: 3000, totalDistanceM: 10 });

    const totals = replayRepository.appendReplaySample.mock.calls.map(([, sample]) => sample.totalDistanceM);
    expect(totals).toEqual([100, 100, 110]);
    service.destroy();
  });

  it("recovers an active recording and resumes from canonical telemetry", async () => {
    const telemetryService = createTelemetryDouble();
    const replayRepository = createRepositoryDouble();
    replayRepository.loadActiveReplaySession.mockResolvedValue({
      id: "recovered",
      recordingState: "recording",
      startedAtMs: 1000,
      startDistanceM: 50,
      totalDistanceM: 20,
      sampleCount: 2,
      maxSpeedMs: 9,
      minAltitudeM: 4,
      maxAltitudeM: 12,
      samples: [],
      lastSample: {
        timestampMs: 2000,
        latitude: 40.7,
        longitude: -73.9,
        speedMs: 8,
        altitudeM: 10,
        headingDeg: 90,
      },
    });
    const service = createDriveRecordingService({ telemetryService, replayRepository });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getSnapshot()).toMatchObject({
      state: "recording",
      sessionId: "recovered",
      sampleCount: 2,
      totalDistanceM: 20,
    });
    expect(telemetryService.start).toHaveBeenCalledWith({ reason: "drive-recording" });
    service.destroy();
  });

  it("starts a GPS recording consumer and appends samples without DOM access", async () => {
    const gpsStore = createGpsStoreDouble();
    const replayRepository = createRepositoryDouble();
    const service = createDriveRecordingService({ gpsStore, replayRepository, now: () => 5000 });

    service.startRecording({ source: "speed" });
    gpsStore.emit({
      latitude: 40.7,
      longitude: -73.9,
      accuracy: 4,
      altitudeM: 10,
      speedMs: 8,
      headingDeg: 123,
      timestampMs: 1000,
    });
    await Promise.resolve();

    expect(gpsStore.startConsumer).toHaveBeenCalledWith("speed-recording", expect.objectContaining({
      enableHighAccuracy: true,
    }));
    expect(replayRepository.appendReplaySample).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 8,
      headingDeg: 123,
      accuracyM: 4,
    }), expect.objectContaining({ recordingState: "recording" }));
    expect(service.getSnapshot()).toMatchObject({
      state: "recording",
      sampleCount: 1,
      currentSpeedMs: 8,
      maxSpeedMs: 8,
      lastHeadingDeg: 123,
      localOnly: true,
    });
  });

  it("pauses, resumes, and stops with local archive persistence", async () => {
    const gpsStore = createGpsStoreDouble();
    const replayRepository = createRepositoryDouble();
    const service = createDriveRecordingService({ gpsStore, replayRepository, now: () => 5000 });

    service.startRecording();
    service.pauseRecording();
    gpsStore.emit({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 8,
      timestampMs: 1000,
    });

    expect(service.getSnapshot().state).toBe("paused");
    expect(replayRepository.appendReplaySample).not.toHaveBeenCalled();

    service.resumeRecording();
    gpsStore.emit({
      latitude: 40.701,
      longitude: -73.9,
      speedMs: 8,
      timestampMs: 2000,
    });
    await service.stopRecording();

    expect(replayRepository.appendReplaySample).toHaveBeenCalledTimes(2);
    expect(replayRepository.archiveReplaySession).toHaveBeenCalledWith(expect.objectContaining({
      sampleCount: 2,
    }), expect.objectContaining({ minSamples: 1 }));
    expect(service.getSnapshot().state).toBe("idle");
  });

  it("keeps recording local when persistence fails", async () => {
    const gpsStore = createGpsStoreDouble();
    const replayRepository = createRepositoryDouble();
    replayRepository.saveActiveReplaySession.mockRejectedValue(new TypeError("offline"));
    const service = createDriveRecordingService({ gpsStore, replayRepository, now: () => 5000 });

    service.startRecording();
    gpsStore.emit({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 8,
      timestampMs: 1000,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getSnapshot()).toMatchObject({
      state: "recording",
      sampleCount: 1,
      pendingCloudSync: true,
      localOnly: true,
    });
  });

  it("retains the shared GPS consumer with the Speed keep-alive pattern while recording", async () => {
    const keepAliveAudio = getBackgroundKeepAliveAudio();
    Object.defineProperty(keepAliveAudio, "paused", { configurable: true, value: false });
    const gpsStore = createGpsStoreDouble();
    const service = createDriveRecordingService({
      gpsStore,
      replayRepository: createRepositoryDouble(),
      now: () => 5000,
    });

    service.startRecording({ source: "map", fromUserGesture: true });
    await service.rearmKeepAlive({ fromUserGesture: true });

    expect(hasBackgroundAudioLease(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE)).toBe(true);
    expect(service.getSnapshot()).toMatchObject({
      state: "recording",
      keepAliveIntended: true,
      keepAliveArmed: true,
      keepAliveBlocked: false,
    });

    service.pauseRecording();
    expect(hasBackgroundAudioLease(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE)).toBe(false);
    expect(gpsStore.startConsumer.mock.results[0].value).toHaveBeenCalledTimes(1);
    service.destroy();
    Object.defineProperty(keepAliveAudio, "paused", { configurable: true, value: true });
  });

  it("tracks altitude and Speed-compatible trip statistics", async () => {
    let currentTime = 1000;
    const gpsStore = createGpsStoreDouble();
    const service = createDriveRecordingService({
      gpsStore,
      replayRepository: createRepositoryDouble(),
      now: () => currentTime,
    });
    service.startRecording({ source: "map", fromUserGesture: true });
    gpsStore.emit({ latitude: 40.7, longitude: -73.9, speedMs: 5, altitudeM: 20, timestampMs: 1000 });
    gpsStore.emit({ latitude: 40.701, longitude: -73.9, speedMs: 10, altitudeM: 8, timestampMs: 2000 });
    currentTime = 11_000;

    expect(service.getSnapshot()).toMatchObject({
      durationMs: 10_000,
      currentAltitudeM: 8,
      maxAltitudeM: 20,
      minAltitudeM: 8,
      maxSpeedMs: 10,
    });
    expect(service.getSnapshot().averageSpeedMs).toBeGreaterThan(0);
    await service.stopRecording();
    service.destroy();
  });
});
