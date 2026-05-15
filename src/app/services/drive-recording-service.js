import {
  archiveReplaySession,
  appendReplaySample,
  createReplaySession,
  saveActiveReplaySession,
} from "../../replay/session.js";
import { distanceMeters } from "../../shared/geo-heading.js";

const RECORDING_CONSUMER_ID = "speed-recording";

function getDefaultUnits() {
  return {
    unit: "kmh",
    distanceUnit: "km",
  };
}

function createSnapshot(state) {
  return {
    state: state.recordingState,
    sessionId: state.session?.id || "",
    startedAtMs: state.startedAtMs,
    sampleCount: state.sampleCount,
    totalDistanceM: state.totalDistanceM,
    currentSpeedMs: state.currentSpeedMs,
    maxSpeedMs: state.maxSpeedMs,
    lastPosition: state.lastPosition,
    lastHeadingDeg: state.lastHeadingDeg,
    lastPersistedAtMs: state.lastPersistedAtMs,
    localOnly: true,
    pendingCloudSync: state.pendingCloudSync,
  };
}

function normalizeGpsPosition(snapshotOrPosition) {
  const position = snapshotOrPosition?.normalized || snapshotOrPosition;
  if (!position) return null;
  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(position.accuracy)) ? Number(position.accuracy) : null,
    altitudeM: Number.isFinite(Number(position.altitudeM)) ? Number(position.altitudeM) : null,
    speedMs: Number.isFinite(Number(position.speedMs)) ? Math.max(0, Number(position.speedMs)) : 0,
    headingDeg: Number.isFinite(Number(position.headingDeg)) ? Number(position.headingDeg) : null,
    timestampMs: Number.isFinite(Number(position.timestampMs)) ? Number(position.timestampMs) : Date.now(),
    stale: position.stale === true,
  };
}

export function createDriveRecordingService({
  gpsStore,
  replayRepository = {},
  unitStore = null,
  now = () => Date.now(),
} = {}) {
  const repository = {
    archiveReplaySession,
    appendReplaySample,
    createReplaySession,
    saveActiveReplaySession,
    ...replayRepository,
  };
  const listeners = new Set();
  const units = () => unitStore?.getSnapshot?.() || unitStore?.getUnits?.() || getDefaultUnits();
  const initialUnits = units();
  const state = {
    recordingState: "idle",
    session: repository.createReplaySession({
      unit: initialUnits.unit,
      distanceUnit: initialUnits.distanceUnit,
      recordingState: "stopped",
    }),
    startedAtMs: null,
    sampleCount: 0,
    totalDistanceM: 0,
    currentSpeedMs: 0,
    maxSpeedMs: 0,
    lastPosition: null,
    lastHeadingDeg: null,
    lastPersistedAtMs: 0,
    pendingCloudSync: false,
  };
  let gpsConsumerCleanup = null;
  let gpsUnsubscribe = null;
  let destroyed = false;

  function emit() {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Recording listeners are isolated from the capture pipeline.
      }
    }
    window.dispatchEvent?.(new CustomEvent("vatioboard:drive-recording", { detail: snapshot }));
  }

  function ensureGpsSubscription() {
    if (gpsConsumerCleanup || !gpsStore) return;
    gpsConsumerCleanup = gpsStore.startConsumer?.(RECORDING_CONSUMER_ID, {
      enableHighAccuracy: true,
      reason: "drive-recording",
    }) || null;
    gpsUnsubscribe = gpsStore.subscribe?.((snapshot) => {
      handleGpsPosition(snapshot);
    }) || null;
  }

  function releaseGpsSubscription() {
    gpsUnsubscribe?.();
    gpsUnsubscribe = null;
    gpsConsumerCleanup?.();
    gpsConsumerCleanup = null;
  }

  async function persistNow() {
    if (!state.session) return null;
    try {
      const persisted = await repository.saveActiveReplaySession(state.session);
      state.session = persisted || state.session;
      state.lastPersistedAtMs = now();
      state.pendingCloudSync = false;
      emit();
      return state.session;
    } catch {
      state.pendingCloudSync = true;
      emit();
      return state.session;
    }
  }

  function appendPosition(position) {
    if (!position || position.stale) return;
    const nextUnits = units();
    const previousPosition = state.lastPosition;
    const distanceDelta = previousPosition ? distanceMeters(previousPosition, position) : 0;
    if (Number.isFinite(distanceDelta) && distanceDelta > 0) {
      state.totalDistanceM += distanceDelta;
    }
    state.currentSpeedMs = position.speedMs || 0;
    state.maxSpeedMs = Math.max(state.maxSpeedMs, state.currentSpeedMs);
    state.lastPosition = position;
    state.lastHeadingDeg = position.headingDeg;
    state.session = repository.appendReplaySample(
      state.session,
      {
        timestampMs: position.timestampMs,
        latitude: position.latitude,
        longitude: position.longitude,
        speedMs: state.currentSpeedMs,
        altitudeM: position.altitudeM,
        accuracyM: position.accuracy,
        headingDeg: position.headingDeg,
        totalDistanceM: state.totalDistanceM,
      },
      {
        unit: nextUnits.unit,
        distanceUnit: nextUnits.distanceUnit,
        recordingState: "recording",
      }
    );
    state.sampleCount = Math.max(
      Number(state.session?.sampleCount) || 0,
      Array.isArray(state.session?.samples) ? state.session.samples.length : 0
    );
    void persistNow();
    emit();
  }

  function handleGpsPosition(snapshotOrPosition) {
    if (destroyed || state.recordingState !== "recording") return;
    appendPosition(normalizeGpsPosition(snapshotOrPosition));
  }

  function startRecording({ source = "speed" } = {}) {
    if (destroyed) return getSnapshot();
    if (state.recordingState === "recording") return getSnapshot();
    const nextUnits = units();
    state.recordingState = "recording";
    if (!state.session || state.recordingState === "idle" || state.session.recordingState === "stopped") {
      state.session = repository.createReplaySession({
        unit: nextUnits.unit,
        distanceUnit: nextUnits.distanceUnit,
        recordingState: "recording",
        source,
      });
      state.sampleCount = 0;
      state.totalDistanceM = 0;
      state.maxSpeedMs = 0;
      state.startedAtMs = now();
    } else {
      state.session = {
        ...state.session,
        recordingState: "recording",
      };
      state.startedAtMs ||= now();
    }
    ensureGpsSubscription();
    const currentPosition = normalizeGpsPosition(gpsStore?.getCurrentPosition?.());
    if (currentPosition) appendPosition(currentPosition);
    void persistNow();
    emit();
    return getSnapshot();
  }

  function pauseRecording() {
    if (state.recordingState !== "recording") return getSnapshot();
    state.recordingState = "paused";
    if (state.session) state.session = { ...state.session, recordingState: "paused" };
    void persistNow();
    emit();
    return getSnapshot();
  }

  function resumeRecording() {
    if (state.recordingState === "recording") return getSnapshot();
    return startRecording({ source: "resume" });
  }

  async function stopRecording() {
    if (state.recordingState === "idle" && state.sampleCount === 0) return getSnapshot();
    state.recordingState = "finalizing";
    emit();
    releaseGpsSubscription();
    const endedAtMs = state.lastPosition?.timestampMs || now();
    try {
      state.session = await repository.archiveReplaySession(state.session, {
        endedAtMs,
        minSamples: 1,
      });
      state.pendingCloudSync = false;
    } catch {
      state.pendingCloudSync = true;
    }
    state.recordingState = "idle";
    if (state.session) state.session = { ...state.session, recordingState: "stopped" };
    void persistNow();
    emit();
    return getSnapshot();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return createSnapshot(state);
  }

  function getCurrentSession() {
    return state.session;
  }

  function destroy() {
    destroyed = true;
    releaseGpsSubscription();
    listeners.clear();
  }

  return {
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    subscribe,
    getSnapshot,
    getCurrentSession,
    persistNow,
    destroy,
  };
}
