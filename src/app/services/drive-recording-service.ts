import {
  archiveReplaySession,
  appendReplaySample,
  createReplaySession,
  saveActiveReplaySession,
} from "../../replay/session.js";
import { distanceMeters } from "../../shared/geo-heading.js";
import {
  acquireBackgroundAudioLease,
  getBackgroundKeepAliveAudio,
  isBackgroundAudioLeaseActive,
  releaseBackgroundAudioLease,
} from "../../shared/audio-system.js";
import {
  clearMediaSessionClient,
  updateMediaSessionClient,
} from "../../shared/media-session-adapter.js";
import type {
  DriveRecordingService,
  DriveRecordingSnapshot,
  GpsService,
  NormalizedGpsPosition,
} from "../../types/services";

const RECORDING_CONSUMER_ID = "speed-recording";
export const DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE = "drive-recording";
const DRIVE_RECORDING_MEDIA_SESSION_OWNER = "drive-recording";
const DRIVE_RECORDING_MEDIA_SESSION_PRIORITY = 5;

// TODO(ts-migration): replay repository/session payloads remain JS-owned.
type LegacyRecordingRecord = Record<string, any>;

interface DriveRecordingServiceOptions {
  gpsStore?: GpsService | null;
  replayRepository?: LegacyRecordingRecord;
  unitStore?: LegacyRecordingRecord | null;
  now?: () => number;
}

function getDefaultUnits() {
  return {
    unit: "kmh",
    distanceUnit: "km",
  };
}

function createSnapshot(state: LegacyRecordingRecord, nowMs = Date.now()): DriveRecordingSnapshot {
  const durationMs = state.startedAtMs === null
    ? 0
    : Math.max(0, (state.recordingState === "idle" ? state.endedAtMs : nowMs) - state.startedAtMs);
  return {
    state: state.recordingState,
    sessionId: state.session?.id || "",
    startedAtMs: state.startedAtMs,
    sampleCount: state.sampleCount,
    totalDistanceM: state.totalDistanceM,
    currentSpeedMs: state.currentSpeedMs,
    maxSpeedMs: state.maxSpeedMs,
    averageSpeedMs: durationMs > 0 ? state.totalDistanceM / (durationMs / 1000) : 0,
    durationMs,
    currentAltitudeM: state.currentAltitudeM,
    maxAltitudeM: state.maxAltitudeM,
    minAltitudeM: state.minAltitudeM,
    lastPosition: state.lastPosition,
    lastHeadingDeg: state.lastHeadingDeg,
    lastPersistedAtMs: state.lastPersistedAtMs,
    localOnly: true,
    pendingCloudSync: state.pendingCloudSync,
    keepAliveIntended: state.keepAliveIntended,
    keepAliveArmed: state.keepAliveArmed && isBackgroundAudioLeaseActive(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE),
    keepAlivePending: state.keepAlivePending,
    keepAliveSuppressed: state.keepAliveSuppressed,
    keepAliveBlocked: state.keepAliveBlocked,
  };
}

function normalizeGpsPosition(snapshotOrPosition: LegacyRecordingRecord | NormalizedGpsPosition | null | undefined): NormalizedGpsPosition | null {
  const candidate = snapshotOrPosition as LegacyRecordingRecord | null | undefined;
  const position = (candidate?.normalized || snapshotOrPosition) as LegacyRecordingRecord | NormalizedGpsPosition | null | undefined;
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
    receivedAtMs: Number.isFinite(Number(position.receivedAtMs)) ? Number(position.receivedAtMs) : Date.now(),
    stale: position.stale === true,
  };
}

export function createDriveRecordingService({
  gpsStore,
  replayRepository = {},
  unitStore = null,
  now = () => Date.now(),
}: DriveRecordingServiceOptions = {}): DriveRecordingService {
  const repository = {
    archiveReplaySession,
    appendReplaySample,
    createReplaySession,
    saveActiveReplaySession,
    ...replayRepository,
  };
  const listeners = new Set<(snapshot: DriveRecordingSnapshot) => void>();
  const units = () => unitStore?.getSnapshot?.() || unitStore?.getUnits?.() || getDefaultUnits();
  const initialUnits = units();
  const state: LegacyRecordingRecord = {
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
    currentAltitudeM: null,
    maxAltitudeM: null,
    minAltitudeM: null,
    lastPosition: null,
    lastHeadingDeg: null,
    lastPersistedAtMs: 0,
    pendingCloudSync: false,
    endedAtMs: null,
    keepAliveIntended: false,
    keepAliveArmed: false,
    keepAlivePending: false,
    keepAliveSuppressed: false,
    keepAliveBlocked: false,
    keepAliveRevision: 0,
  };
  let gpsConsumerCleanup: (() => void) | null = null;
  let gpsUnsubscribe: (() => void) | null = null;
  let destroyed = false;
  let keepAlivePromise: Promise<boolean> | null = null;
  const keepAliveAudio = getBackgroundKeepAliveAudio();

  function updateMediaSession() {
    const recording = state.recordingState === "recording";
    updateMediaSessionClient(DRIVE_RECORDING_MEDIA_SESSION_OWNER, {
      active: recording,
      priority: DRIVE_RECORDING_MEDIA_SESSION_PRIORITY,
      playbackState: recording ? "playing" : "none",
      metadata: recording ? {
        title: "Drive recording",
        artist: "VatioBoard",
        album: "GPS recording active",
      } : null,
      handlers: recording ? {
        play: () => { void rearmKeepAlive({ fromUserGesture: true, reason: "media-session-play" }); },
        // Tesla may emit pause/stop when another app opens. Keep recording ownership intact.
        pause: () => { void persistNow(); },
        stop: () => { void persistNow(); },
      } : null,
    });
  }

  function disarmKeepAlive() {
    state.keepAliveRevision += 1;
    state.keepAliveIntended = false;
    state.keepAliveArmed = false;
    state.keepAlivePending = false;
    state.keepAliveSuppressed = false;
    state.keepAliveBlocked = false;
    keepAlivePromise = null;
    releaseBackgroundAudioLease(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE);
    updateMediaSession();
  }

  async function rearmKeepAlive({ fromUserGesture = false }: LegacyRecordingRecord = {}) {
    if (destroyed || state.recordingState !== "recording") return false;
    state.keepAliveIntended = true;
    if (fromUserGesture) {
      state.keepAliveSuppressed = false;
      state.keepAliveBlocked = false;
    }
    if (isBackgroundAudioLeaseActive(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE)) {
      state.keepAliveArmed = true;
      state.keepAliveSuppressed = false;
      state.keepAliveBlocked = false;
      emit();
      return true;
    }
    if (state.keepAlivePending) return keepAlivePromise ?? false;
    const revision = ++state.keepAliveRevision;
    state.keepAlivePending = true;
    emit();
    keepAlivePromise = acquireBackgroundAudioLease(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE, {
      shouldContinue: () => !destroyed
        && state.recordingState === "recording"
        && state.keepAliveIntended
        && revision === state.keepAliveRevision,
    }).then(Boolean, () => false);
    try {
      const armed = await keepAlivePromise;
      if (revision !== state.keepAliveRevision || state.recordingState !== "recording") {
        releaseBackgroundAudioLease(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE);
        return false;
      }
      state.keepAliveArmed = armed && isBackgroundAudioLeaseActive(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE);
      state.keepAliveSuppressed = !state.keepAliveArmed;
      state.keepAliveBlocked = !state.keepAliveArmed;
      if (!state.keepAliveArmed) releaseBackgroundAudioLease(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE);
      return state.keepAliveArmed;
    } finally {
      state.keepAlivePending = false;
      keepAlivePromise = null;
      updateMediaSession();
      emit();
    }
  }

  function handleKeepAliveInterruption() {
    if (destroyed || state.recordingState !== "recording" || state.keepAlivePending) return;
    if (isBackgroundAudioLeaseActive(DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE)) return;
    state.keepAliveArmed = false;
    state.keepAliveSuppressed = true;
    emit();
  }

  function persistForLifecycle() {
    if (state.recordingState !== "recording") return;
    void persistNow();
    handleKeepAliveInterruption();
  }

  keepAliveAudio.addEventListener("pause", handleKeepAliveInterruption);
  keepAliveAudio.addEventListener("ended", handleKeepAliveInterruption);
  document.addEventListener("visibilitychange", persistForLifecycle);
  window.addEventListener("pagehide", persistForLifecycle);

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
    state.currentAltitudeM = Number.isFinite(Number(position.altitudeM)) ? Number(position.altitudeM) : null;
    if (state.currentAltitudeM !== null) {
      state.maxAltitudeM = state.maxAltitudeM === null ? state.currentAltitudeM : Math.max(state.maxAltitudeM, state.currentAltitudeM);
      state.minAltitudeM = state.minAltitudeM === null ? state.currentAltitudeM : Math.min(state.minAltitudeM, state.currentAltitudeM);
    }
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

  function startRecording({ source = "speed", fromUserGesture = false }: LegacyRecordingRecord = {}) {
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
      state.currentAltitudeM = null;
      state.maxAltitudeM = null;
      state.minAltitudeM = null;
      state.startedAtMs = now();
      state.endedAtMs = null;
    } else {
      state.session = {
        ...state.session,
        recordingState: "recording",
      };
      state.startedAtMs ||= now();
    }
    ensureGpsSubscription();
    void rearmKeepAlive({ fromUserGesture, reason: `${source}-recording-start` });
    updateMediaSession();
    const currentPosition = normalizeGpsPosition(gpsStore?.getCurrentPosition?.());
    if (currentPosition) appendPosition(currentPosition);
    void persistNow();
    emit();
    return getSnapshot();
  }

  function pauseRecording() {
    if (state.recordingState !== "recording") return getSnapshot();
    state.recordingState = "paused";
    disarmKeepAlive();
    releaseGpsSubscription();
    if (state.session) state.session = { ...state.session, recordingState: "paused" };
    void persistNow();
    emit();
    return getSnapshot();
  }

  function resumeRecording() {
    if (state.recordingState === "recording") return getSnapshot();
    return startRecording({ source: "resume", fromUserGesture: true });
  }

  async function stopRecording() {
    if (state.recordingState === "idle" && state.sampleCount === 0) return getSnapshot();
    state.recordingState = "finalizing";
    state.endedAtMs = state.lastPosition?.timestampMs || now();
    disarmKeepAlive();
    emit();
    releaseGpsSubscription();
    const endedAtMs = state.endedAtMs;
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

  function subscribe(listener: (snapshot: DriveRecordingSnapshot) => void) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return createSnapshot(state, now());
  }

  function getCurrentSession() {
    return state.session;
  }

  function destroy() {
    destroyed = true;
    disarmKeepAlive();
    releaseGpsSubscription();
    keepAliveAudio.removeEventListener("pause", handleKeepAliveInterruption);
    keepAliveAudio.removeEventListener("ended", handleKeepAliveInterruption);
    document.removeEventListener("visibilitychange", persistForLifecycle);
    window.removeEventListener("pagehide", persistForLifecycle);
    clearMediaSessionClient(DRIVE_RECORDING_MEDIA_SESSION_OWNER);
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
    rearmKeepAlive,
    destroy,
  };
}
