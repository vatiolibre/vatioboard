import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDrivingAlertService } from "../../src/app/services/driving-alert-service.js";
import { buildTrapIndex } from "../../src/speed/traps.js";

function createGpsServiceDouble() {
  const listeners = new Set();
  let currentPosition = null;
  return {
    startConsumer: vi.fn(() => vi.fn()),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      if (currentPosition) listener({ normalized: currentPosition });
      return () => listeners.delete(listener);
    }),
    getCurrentPosition: vi.fn(() => currentPosition),
    emit(position) {
      currentPosition = position;
      for (const listener of listeners) listener({ normalized: position });
    },
  };
}

function createAudioControllerDouble(overrides = {}) {
  const audioState = {
    overspeedAudible: false,
    trapAudible: false,
    blocked: false,
    alertSoundBlocked: false,
    trapSoundBlocked: false,
    muted: false,
    primed: false,
    pending: false,
    backgroundAudioArmed: false,
    backgroundAudioArmPending: false,
    ...overrides.state,
  };
  return {
    destroy: vi.fn(),
    disarmBackgroundAudio: vi.fn(),
    getSnapshot: vi.fn(() => ({ ...audioState })),
    primeAudioFromUserGesture: vi.fn(async () => {
      audioState.primed = true;
      audioState.backgroundAudioArmed = true;
      return true;
    }),
    setMuted: vi.fn((muted) => {
      audioState.muted = Boolean(muted);
    }),
    sync: vi.fn((options = {}) => {
      audioState.muted = Boolean(options.muted);
      audioState.overspeedAudible = Boolean(options.alertUiState?.over && options.alertSoundEnabled && !options.muted);
      audioState.trapAudible = Boolean(options.alertUiState?.trapActive && options.trapSoundEnabled && !options.muted);
    }),
  };
}

function createCameraDatabaseDouble({ traps = [], failAfterFirstLoad = false } = {}) {
  let loadedDatasets = [];
  let loadCount = 0;
  return {
    destroy: vi.fn(),
    getLoadedDatasets: vi.fn(() => loadedDatasets),
    getStatus: vi.fn(() => ({ status: loadedDatasets.length ? "ready" : "idle" })),
    loadForLocation: vi.fn(async () => {
      loadCount += 1;
      if (failAfterFirstLoad && loadCount > 1) {
        throw new Error("offline");
      }
      loadedDatasets = traps.length
        ? [{
          key: "test",
          country: "zz",
          traps,
          index: buildTrapIndex(traps),
        }]
        : [];
      return {
        datasets: loadedDatasets,
        status: {
          status: "ready",
          loadedCameraCount: traps.length,
          offline: false,
          unavailable: false,
        },
      };
    }),
  };
}

describe("createDrivingAlertService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts one GPS consumer and syncs overspeed audio from GPS outside Speed route", async () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble();
    const service = createDrivingAlertService({ gpsService, audioController });

    service.setManualAlertLimitMs(20);
    service.setManualAlertEnabled(true);
    await service.primeAudioFromUserGesture();
    service.start({ reason: "test" });
    gpsService.emit({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 25,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
    });

    expect(gpsService.startConsumer).toHaveBeenCalledWith("speed-alerts", expect.objectContaining({
      enableHighAccuracy: true,
    }));
    expect(audioController.sync).toHaveBeenLastCalledWith(expect.objectContaining({
      alertUiState: expect.objectContaining({ over: true }),
      alertSoundEnabled: true,
      audioIntended: true,
    }));
    expect(service.getSnapshot().audio.overspeedAudible).toBe(true);
  });

  it("keeps shared alerts active until the final route consumer releases its lease", () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble();
    const service = createDrivingAlertService({ gpsService, audioController });
    service.setManualAlertEnabled(false, { startIfNeeded: false });
    service.setTrapAlertEnabled(false, { startIfNeeded: false });

    const releaseWaze = service.acquireConsumer("vatio.waze.route", { reason: "waze-route" });
    const releaseHud = service.acquireConsumer("vatio.shell.activity", { reason: "activity" });

    expect(service.getSnapshot()).toMatchObject({
      started: true,
      consumers: ["vatio.shell.activity", "vatio.waze.route"],
    });
    expect(gpsService.startConsumer).toHaveBeenCalledTimes(1);

    releaseWaze();
    expect(service.getSnapshot()).toMatchObject({
      started: true,
      consumers: ["vatio.shell.activity"],
    });

    releaseHud();
    expect(service.getSnapshot()).toMatchObject({ started: false, consumers: [] });
    expect(gpsService.startConsumer.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  it("does not stop an armed background alert when its route consumer leaves", () => {
    const service = createDrivingAlertService({
      gpsService: createGpsServiceDouble(),
      audioController: createAudioControllerDouble(),
    });
    service.setManualAlertEnabled(true);
    const releaseWaze = service.acquireConsumer("vatio.waze.route");

    releaseWaze();

    expect(service.getSnapshot()).toMatchObject({ started: true, consumers: [] });
  });

  it("loads cached/static camera datasets and emits trap proximity alerts", async () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble();
    const traps = [[-73.9001, 40.7001, 50, null, { source: "camera:maxspeed" }]];
    const cameraDatabase = createCameraDatabaseDouble({ traps });
    const service = createDrivingAlertService({ gpsService, cameraDatabase, audioController });

    service.setManualAlertEnabled(false);
    service.setTrapAlertEnabled(true);
    service.setTrapAlertDistanceM(500);
    await service.primeAudioFromUserGesture();
    service.start({ reason: "test" });
    gpsService.emit({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 8,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(cameraDatabase.loadForLocation).toHaveBeenCalled();
    expect(service.getSnapshot().alertUiState).toMatchObject({
      trapActive: true,
      trapSpeedKph: 50,
    });
    expect(audioController.sync).toHaveBeenLastCalledWith(expect.objectContaining({
      nearestTrapId: "test:0",
      trapSoundEnabled: true,
    }));
  });

  it("keeps unknown camera speed null and does not turn it into a zero-speed overspeed limit", async () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble();
    const cameraDatabase = createCameraDatabaseDouble({ traps: [[-73.9001, 40.7001]] });
    const service = createDrivingAlertService({ gpsService, cameraDatabase, audioController });

    service.setManualAlertEnabled(false);
    service.setTrapAlertEnabled(true);
    service.setTrapAlertDistanceM(500);
    service.start({ reason: "test" });
    gpsService.emit({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 35,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
    });
    await Promise.resolve();
    await Promise.resolve();

    const alertState = service.getSnapshot().alertUiState;
    expect(alertState.trapActive).toBe(true);
    expect(alertState.trapSpeedKph).toBeNull();
    expect(alertState.limitMs).toBeNull();
    expect(alertState.over).toBe(false);
  });

  it("suppresses high-confidence cameras that are nearby but not on the driven approach", async () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble();
    const traps = [[-73.8999, 40.7, 50, "side", {
      source: "nearest_road:maxspeed",
      confidence: "high",
      approach: [{
        bearingDeg: 90,
        reverseBearingDeg: 270,
        direction: "both",
        confidence: "high",
        segment: [[-73.901, 40.7], [-73.899, 40.7]],
      }],
    }]];
    const cameraDatabase = createCameraDatabaseDouble({ traps });
    const service = createDrivingAlertService({ gpsService, cameraDatabase, audioController });

    service.setManualAlertEnabled(false);
    service.setTrapAlertEnabled(true);
    service.setTrapAlertDistanceM(500);
    service.start({ reason: "test" });
    gpsService.emit({
      latitude: 40.699,
      longitude: -73.9,
      headingDeg: 0,
      speedMs: 8,
      timestampMs: 1000,
      receivedAtMs: 1000,
    });
    gpsService.emit({
      latitude: 40.7,
      longitude: -73.9,
      headingDeg: 0,
      speedMs: 8,
      timestampMs: 2000,
      receivedAtMs: 2000,
    });
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = service.getSnapshot();
    expect(snapshot.nearestTrapId).toBeNull();
    expect(snapshot.cameraApproachState).toBe("near-not-approaching");
    expect(snapshot.alertUiState.trapActive).toBe(false);
    expect(snapshot.alertUiState.cameraApproachReason).toBe("metadata-heading-mismatch");
  });

  it("can alert on a second candidate when the nearest camera is not approaching", async () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble();
    const traps = [
      [-73.8999, 40.7, 50, "side"],
      [-73.9, 40.701, 80, "ahead"],
    ];
    const cameraDatabase = createCameraDatabaseDouble({ traps });
    const service = createDrivingAlertService({ gpsService, cameraDatabase, audioController });

    service.setManualAlertEnabled(false);
    service.setTrapAlertEnabled(true);
    service.setTrapAlertDistanceM(500);
    service.start({ reason: "test" });
    gpsService.emit({
      latitude: 40.699,
      longitude: -73.9,
      speedMs: 8,
      timestampMs: 1000,
      receivedAtMs: 1000,
    });
    gpsService.emit({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 8,
      timestampMs: 2000,
      receivedAtMs: 2000,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getSnapshot()).toMatchObject({
      nearestTrapId: "test:1",
      nearestTrapSpeedKph: 80,
      cameraApproachState: "missing-metadata",
    });
    expect(service.getSnapshot().alertUiState.trapActive).toBe(true);
  });

  it("keeps the previous loaded camera data when a refresh fails", async () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble();
    const traps = [[-73.9001, 40.7001, 50, null, { source: "camera:maxspeed" }]];
    const cameraDatabase = createCameraDatabaseDouble({ traps, failAfterFirstLoad: true });
    const service = createDrivingAlertService({ gpsService, cameraDatabase, audioController });

    service.setTrapAlertEnabled(true);
    service.setTrapAlertDistanceM(500);
    service.start({ reason: "test" });
    gpsService.emit({
      latitude: 40.7,
      longitude: -73.9,
      speedMs: 8,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
    });
    await Promise.resolve();
    await Promise.resolve();
    gpsService.emit({
      latitude: 40.704,
      longitude: -73.904,
      speedMs: 8,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
    });
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = service.getSnapshot();
    expect(snapshot.cameraDatabaseStatus.status).toBe("offline");
    expect(snapshot.cameraDatabaseStatus.unavailable).toBe(false);
    expect(snapshot.nearestTrapId).toBe("test:0");
  });

  it("preserves blocked audio state until user priming succeeds", async () => {
    const gpsService = createGpsServiceDouble();
    const audioController = createAudioControllerDouble({
      state: { blocked: true, alertSoundBlocked: true },
    });
    const service = createDrivingAlertService({ gpsService, audioController });

    service.setManualAlertEnabled(true);
    service.start({ reason: "test" });

    expect(service.getSnapshot().audio.blocked).toBe(true);
    await service.primeAudioFromUserGesture();
    expect(audioController.primeAudioFromUserGesture).toHaveBeenCalled();
  });
});
