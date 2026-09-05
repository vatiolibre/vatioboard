import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDrivingHud } from "../../src/shared/driving-hud.js";

function createAlertService(overrides = {}) {
  let snapshot = {
    started: true,
    status: "active",
    currentSpeedMs: 10,
    latestPosition: {
      latitude: 40.7,
      longitude: -73.9,
      accuracy: 5,
      speedMs: 10,
      headingDeg: 90,
      timestampMs: Date.now(),
      receivedAtMs: Date.now(),
      stale: false,
    },
    preferences: {
      unit: "kmh",
      distanceUnit: "m",
      audioMuted: false,
    },
    alertUiState: {
      enabled: true,
      limitDisplayValue: 100,
      near: false,
      over: false,
    },
    audio: { muted: false, primed: true, backgroundAudioArmed: true },
  };
  const listeners = new Set();
  const release = vi.fn();
  return {
    acquireConsumer: vi.fn(() => release),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }),
    setMuted: vi.fn((muted) => {
      snapshot = {
        ...snapshot,
        preferences: { ...snapshot.preferences, audioMuted: muted },
        audio: { ...snapshot.audio, muted },
      };
      for (const listener of listeners) listener(snapshot);
      return snapshot;
    }),
    primeAudioFromUserGesture: vi.fn(async () => true),
    release,
    ...overrides,
  };
}

function createRecordingService() {
  let snapshot = {
    state: "idle",
    session: null,
    totalDistanceM: 0,
    maxSpeedMs: 0,
    averageSpeedMs: 0,
    durationMs: 0,
    currentAltitudeM: null,
    maxAltitudeM: null,
    minAltitudeM: null,
    keepAliveIntended: false,
    keepAliveArmed: false,
    keepAlivePending: false,
    keepAliveSuppressed: false,
    keepAliveBlocked: false,
  };
  const listeners = new Set();
  const publish = (next) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  return {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }),
    startRecording: vi.fn(() => publish({ ...snapshot, state: "recording", session: { id: "map-run" }, keepAliveIntended: true, keepAliveArmed: true })),
    pauseRecording: vi.fn(() => publish({ state: "paused", session: { id: "map-run" } })),
    resumeRecording: vi.fn(() => publish({ state: "recording", session: { id: "map-run" } })),
    stopRecording: vi.fn(async () => publish({ state: "idle", session: null })),
  };
}

describe("neutral driving HUD", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="mount"></div>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders shared speed, alert, camera, and touch-friendly action state", () => {
    const alerts = createAlertService();
    const recording = createRecordingService();
    const mount = document.getElementById("mount");
    const hud = createDrivingHud({
      mount,
      consumerId: "vatio.map.route",
      recordingSource: "map",
      drivingAlerts: alerts,
      driveRecording: recording,
      getContext: () => ({ nearestCameraDistanceM: 240, cameraState: "ahead" }),
    });

    expect(alerts.acquireConsumer).toHaveBeenCalledWith("vatio.map.route", expect.objectContaining({
      reason: "map-route",
    }));
    expect(mount.querySelector("[data-driving-speed]").textContent).toBe("36");
    expect(mount.querySelector("[data-driving-limit]").textContent).toBe("100 km/h");
    expect(mount.querySelector("[data-driving-camera-distance]").textContent).toBe("240 m");
    expect(mount.querySelectorAll(".driving-actions button")).toHaveLength(6);
    expect(mount.querySelector("[data-driving-action='location']").hidden).toBe(true);
    expect(mount.querySelector("[data-driving-action='recenter']").hidden).toBe(false);

    hud.destroy();
    expect(alerts.release).toHaveBeenCalledTimes(1);
    expect(mount.children).toHaveLength(0);
  });

  it("starts, pauses, resumes, and stops recording without stopping shared alerts", async () => {
    const alerts = createAlertService();
    const recording = createRecordingService();
    const mount = document.getElementById("mount");
    const hud = createDrivingHud({
      mount,
      consumerId: "vatio.map.route",
      recordingSource: "map",
      drivingAlerts: alerts,
      driveRecording: recording,
    });
    const record = mount.querySelector("[data-driving-action='record']");
    const stop = mount.querySelector("[data-driving-action='stop']");

    record.click();
    expect(recording.startRecording).toHaveBeenCalledWith({ source: "map", fromUserGesture: true });
    expect(stop.hidden).toBe(false);
    record.click();
    expect(recording.pauseRecording).toHaveBeenCalledTimes(1);
    record.click();
    expect(recording.resumeRecording).toHaveBeenCalledTimes(1);
    stop.click();
    await Promise.resolve();
    expect(recording.stopRecording).toHaveBeenCalledTimes(1);

    hud.destroy();
    expect(alerts.stop).toBeUndefined();
    expect(alerts.release).toHaveBeenCalledTimes(1);
  });

  it("shows Enable Location instead of a duplicate Recenter control before GPS is available", () => {
    const gpsSnapshot = { status: "idle", normalized: null };
    const gps = {
      getSnapshot: vi.fn(() => gpsSnapshot),
      startConsumer: vi.fn(() => vi.fn()),
      subscribe: vi.fn((listener) => {
        listener(gpsSnapshot);
        return vi.fn();
      }),
    };
    const hud = createDrivingHud({
      mount: document.getElementById("mount"),
      consumerId: "vatio.map.route",
      recordingSource: "map",
      gps,
    });

    expect(document.querySelector("[data-driving-action='location']").hidden).toBe(false);
    expect(document.querySelector("[data-driving-action='recenter']").hidden).toBe(true);

    hud.destroy();
  });

  it("delegates alert settings, location, and recenter actions", () => {
    const alerts = createAlertService();
    const onOpenAlertSettings = vi.fn();
    const onLocationRequest = vi.fn();
    const onRecenter = vi.fn();
    const hud = createDrivingHud({
      mount: document.getElementById("mount"),
      consumerId: "vatio.map.route",
      recordingSource: "map",
      drivingAlerts: alerts,
      onOpenAlertSettings,
      onLocationRequest,
      onRecenter,
    });

    document.querySelector("[data-driving-action='alerts']").click();
    document.querySelector("[data-driving-action='location']").click();
    document.querySelector("[data-driving-action='recenter']").click();
    expect(onOpenAlertSettings).toHaveBeenCalledTimes(1);
    expect(onLocationRequest).toHaveBeenCalledTimes(1);
    expect(onRecenter).toHaveBeenCalledTimes(1);
    hud.destroy();
  });
});
