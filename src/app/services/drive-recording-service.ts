import {
  archiveReplaySession,
  appendReplaySample,
  createReplaySession,
  loadActiveReplaySession,
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
import {
  enrichRouteBoundaryPlaces,
  getRouteBoundaryInputSamples,
} from "../../shared/route-boundary.js";
import type {
  DriveRecordingService,
  DriveRecordingSnapshot,
  DrivingTelemetrySample,
  DrivingTelemetryService,
  GpsService,
  NormalizedGpsPosition,
} from "../../types/services";

const RECORDING_CONSUMER_ID = "speed-recording";
export const DRIVE_RECORDING_BACKGROUND_AUDIO_LEASE = "drive-recording";
const DRIVE_RECORDING_MEDIA_SESSION_OWNER = "drive-recording";
const DRIVE_RECORDING_MEDIA_SESSION_PRIORITY = 5;
const ACTIVE_REPLAY_PERSIST_INTERVAL_MS = 5000;
const REPLAY_PERSIST_CHUNK_SIZE = 200;

// TODO(ts-migration): replay repository/session payloads remain JS-owned.
type LegacyRecordingRecord = Record<string, any>;

interface DriveRecordingServiceOptions {
  gpsStore?: GpsService | null;
  telemetryService?: DrivingTelemetryService | null;
  replayRepository?: LegacyRecordingRecord;
  unitStore?: LegacyRecordingRecord | null;
  now?: () => number;
  placeResolver?: Parameters<typeof enrichRouteBoundaryPlaces>[1] | null;
  queueCloudSync?: ((change: LegacyRecordingRecord) => Promise<unknown>) | null;
}

function getDefaultUnits() {
  return {
    unit: "kmh",
    distanceUnit: "m",
    tripDistanceUnit: "km",
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
    sampleSequence: Number.isFinite(Number(position.sampleSequence)) ? Number(position.sampleSequence) : 0,
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(position.accuracy)) ? Number(position.accuracy) : null,
    altitudeM: position.altitudeM !== null && position.altitudeM !== undefined
      && Number.isFinite(Number(position.altitudeM)) ? Number(position.altitudeM) : null,
    speedMs: Number.isFinite(Number(position.speedMs)) ? Math.max(0, Number(position.speedMs)) : 0,
    headingDeg: Number.isFinite(Number(position.headingDeg)) ? Number(position.headingDeg) : null,
    timestampMs: Number.isFinite(Number(position.timestampMs)) ? Number(position.timestampMs) : Date.now(),
    receivedAtMs: Number.isFinite(Number(position.receivedAtMs)) ? Number(position.receivedAtMs) : Date.now(),
    stale: position.stale === true,
  };
}

export function createDriveRecordingService({
  gpsStore,
  telemetryService = null,
  replayRepository = {},
  unitStore = null,
  now = () => Date.now(),
  placeResolver = null,
  queueCloudSync = null,
}: DriveRecordingServiceOptions = {}): DriveRecordingService {
  const repository = {
    archiveReplaySession,
    appendReplaySample,
    createReplaySession,
    loadActiveReplaySession,
    saveActiveReplaySession,
    ...replayRepository,
  };
  const listeners = new Set<(snapshot: DriveRecordingSnapshot) => void>();
  const units = () => {
    const preferences = unitStore?.getAll?.() || unitStore?.getSnapshot?.() || unitStore?.getUnits?.() || getDefaultUnits();
    const distanceUnit = preferences.distanceUnit === "ft" ? "ft" : "m";
    return {
      unit: preferences.unit === "mph" || preferences.speedUnit === "mph" ? "mph" : "kmh",
      distanceUnit,
      tripDistanceUnit: preferences.tripDistanceUnit === "mi" || distanceUnit === "ft" ? "mi" : "km",
    };
  };
  const initialUnits = units();
  const state: LegacyRecordingRecord = {
    recordingState: "idle",
    session: repository.createReplaySession({
      unit: initialUnits.unit,
      distanceUnit: initialUnits.distanceUnit,
      tripDistanceUnit: initialUnits.tripDistanceUnit,
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
    lastTelemetrySequence: null,
    recordingDistanceOffsetM: 0,
    lastTelemetryTripDistanceM: null,
  };
  let gpsConsumerCleanup: (() => void) | null = null;
  let gpsUnsubscribe: (() => void) | null = null;
  let telemetryUnsubscribe: (() => void) | null = null;
  let destroyed = false;
  let keepAlivePromise: Promise<boolean> | null = null;
  let persistTimerId: ReturnType<typeof setTimeout> | null = null;
  let hydrationRevision = 0;
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

  function clearPersistTimer() {
    if (persistTimerId === null) return;
    clearTimeout(persistTimerId);
    persistTimerId = null;
  }

  function schedulePersist({ immediate = false }: { immediate?: boolean } = {}) {
    clearPersistTimer();
    if (immediate) {
      void persistNow();
      return;
    }
    persistTimerId = setTimeout(() => {
      persistTimerId = null;
      void persistNow();
    }, ACTIVE_REPLAY_PERSIST_INTERVAL_MS);
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
    if (telemetryService) {
      if (telemetryUnsubscribe) return;
      telemetryService.start({ reason: "drive-recording" });
      telemetryUnsubscribe = telemetryService.subscribeSamples(appendTelemetrySample);
      return;
    }
    if (gpsConsumerCleanup || !gpsStore) return;
    gpsConsumerCleanup = gpsStore.startConsumer?.(RECORDING_CONSUMER_ID, {
      enableHighAccuracy: true,
      reason: "drive-recording",
    }) || null;
    gpsUnsubscribe = gpsStore.subscribePositions?.(handleGpsPosition)
      || gpsStore.subscribe?.(handleGpsPosition)
      || null;
  }

  function releaseGpsSubscription() {
    telemetryUnsubscribe?.();
    telemetryUnsubscribe = null;
    gpsUnsubscribe?.();
    gpsUnsubscribe = null;
    gpsConsumerCleanup?.();
    gpsConsumerCleanup = null;
  }

  async function persistNow() {
    if (!state.session) return null;
    const sessionSnapshot = state.session;
    const snapshotSampleCount = Number(sessionSnapshot.sampleCount) || 0;
    try {
      const persisted = await repository.saveActiveReplaySession(sessionSnapshot);
      const currentSampleCount = Number(state.session?.sampleCount) || 0;
      if (persisted && state.session?.id === sessionSnapshot.id && currentSampleCount <= snapshotSampleCount) {
        state.session = persisted;
      }
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
    state.currentAltitudeM = position.altitudeM !== null && position.altitudeM !== undefined
      && Number.isFinite(Number(position.altitudeM)) ? Number(position.altitudeM) : null;
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
        tripDistanceUnit: nextUnits.tripDistanceUnit,
        recordingState: "recording",
      }
    );
    state.sampleCount = Math.max(
      Number(state.session?.sampleCount) || 0,
      Array.isArray(state.session?.samples) ? state.session.samples.length : 0
    );
    schedulePersist({ immediate: state.sampleCount > 0 && state.sampleCount % REPLAY_PERSIST_CHUNK_SIZE === 0 });
    emit();
  }

  function appendTelemetrySample(sample: DrivingTelemetrySample) {
    if (destroyed || state.recordingState !== "recording") return;
    if (state.lastTelemetrySequence !== null && sample.gpsSampleSequence <= state.lastTelemetrySequence) return;
    state.lastTelemetrySequence = sample.gpsSampleSequence;
    if (
      state.lastTelemetryTripDistanceM !== null
      && sample.totalDistanceM < state.lastTelemetryTripDistanceM
    ) {
      // A telemetry reset starts a new visible trip but must not make an active
      // recording's canonical cumulative distance move backwards.
      state.recordingDistanceOffsetM += state.lastTelemetryTripDistanceM;
    }
    state.lastTelemetryTripDistanceM = sample.totalDistanceM;
    const recordingTotalDistanceM = state.recordingDistanceOffsetM + sample.totalDistanceM;
    const nextUnits = units();
    const snapshot = telemetryService?.getSnapshot();
    const position = snapshot?.lastPosition || null;
    state.currentSpeedMs = sample.processedSpeedMs;
    state.maxSpeedMs = Math.max(state.maxSpeedMs, sample.processedSpeedMs);
    state.currentAltitudeM = sample.altitudeM;
    if (sample.altitudeM !== null) {
      state.maxAltitudeM = state.maxAltitudeM === null ? sample.altitudeM : Math.max(state.maxAltitudeM, sample.altitudeM);
      state.minAltitudeM = state.minAltitudeM === null ? sample.altitudeM : Math.min(state.minAltitudeM, sample.altitudeM);
    }
    state.lastPosition = position;
    state.lastHeadingDeg = sample.headingDeg;
    state.session = repository.appendReplaySample(
      state.session,
      {
        timestampMs: sample.timestampMs,
        latitude: sample.latitude,
        longitude: sample.longitude,
        speedMs: sample.processedSpeedMs,
        altitudeM: sample.altitudeM,
        accuracyM: sample.accuracyM,
        headingDeg: sample.headingDeg,
        totalDistanceM: recordingTotalDistanceM,
      },
      {
        unit: nextUnits.unit,
        distanceUnit: nextUnits.distanceUnit,
        tripDistanceUnit: nextUnits.tripDistanceUnit,
        recordingState: "recording",
      },
    );
    state.sampleCount = Math.max(
      Number(state.session?.sampleCount) || 0,
      Array.isArray(state.session?.samples) ? state.session.samples.length : 0,
    );
    state.totalDistanceM = Math.max(0, Number(state.session?.totalDistanceM) || 0);
    schedulePersist({ immediate: state.sampleCount > 0 && state.sampleCount % REPLAY_PERSIST_CHUNK_SIZE === 0 });
    emit();
  }

  function handleGpsPosition(snapshotOrPosition) {
    if (destroyed || state.recordingState !== "recording") return;
    appendPosition(normalizeGpsPosition(snapshotOrPosition));
  }

  function startRecording({ source = "speed", fromUserGesture = false }: LegacyRecordingRecord = {}) {
    if (destroyed) return getSnapshot();
    if (state.recordingState === "recording") return getSnapshot();
    hydrationRevision += 1;
    const nextUnits = units();
    state.recordingState = "recording";
    if (!state.session || state.recordingState === "idle" || state.session.recordingState === "stopped") {
      state.session = repository.createReplaySession({
        unit: nextUnits.unit,
        distanceUnit: nextUnits.distanceUnit,
        tripDistanceUnit: nextUnits.tripDistanceUnit,
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
      state.lastTelemetrySequence = null;
      state.recordingDistanceOffsetM = 0;
      state.lastTelemetryTripDistanceM = null;
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
    if (telemetryService) {
      const telemetry = telemetryService.getSnapshot();
      const currentPosition = telemetry.lastPosition;
      if (currentPosition && telemetry.lastGpsSampleSequence !== null) {
        appendTelemetrySample({
          gpsSampleSequence: telemetry.lastGpsSampleSequence,
          timestampMs: currentPosition.timestampMs,
          latitude: currentPosition.latitude,
          longitude: currentPosition.longitude,
          processedSpeedMs: telemetry.currentSpeedMs,
          distanceDeltaM: 0,
          totalDistanceM: telemetry.totalDistanceM,
          altitudeM: telemetry.currentAltitudeM,
          headingDeg: telemetry.headingDeg,
          accuracyM: telemetry.accuracyM,
        });
      }
    } else {
      const currentPosition = normalizeGpsPosition(gpsStore?.getCurrentPosition?.());
      if (currentPosition) appendPosition(currentPosition);
    }
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
    hydrationRevision += 1;
    clearPersistTimer();
    state.endedAtMs = state.lastPosition?.timestampMs || now();
    disarmKeepAlive();
    emit();
    releaseGpsSubscription();
    const endedAtMs = state.endedAtMs;
    try {
      const archivedSession = await repository.archiveReplaySession(state.session, {
        endedAtMs,
        minSamples: 1,
      });
      state.session = archivedSession;
      state.pendingCloudSync = false;
      void enrichAndQueueArchivedSession(archivedSession, endedAtMs);
    } catch {
      state.pendingCloudSync = true;
    }
    state.recordingState = "idle";
    if (state.session) state.session = { ...state.session, recordingState: "stopped" };
    void persistNow();
    emit();
    return getSnapshot();
  }

  async function queueArchivedSession(session) {
    if (!session) return;
    let enqueue = queueCloudSync;
    if (!enqueue) {
      try {
        enqueue = (await import("../../shared/cloud-sync.js")).queueCloudSyncChange;
      } catch {
        return;
      }
    }
    if (typeof enqueue !== "function") return;
    await enqueue({
      entityType: "replay_session",
      recordId: session.id,
      recordTitle: session.startPlace?.label || session.id,
      updatedAtMs: session.updatedAtMs ?? session.endedAtMs ?? now(),
      payload: session,
    });
  }

  async function enrichAndQueueArchivedSession(session, endedAtMs) {
    if (!session) return;
    try {
      await queueArchivedSession(session);
      if (!placeResolver) return;
      const enrichment = await enrichRouteBoundaryPlaces(
        getRouteBoundaryInputSamples(session),
        placeResolver,
        { mode: "speed", sessionId: session.id },
      );
      if (!enrichment) return;
      const enrichedSession = {
        ...session,
        startBoundaryPoint: enrichment.startBoundaryPoint,
        endBoundaryPoint: enrichment.endBoundaryPoint,
        startPlace: enrichment.startPlace ?? session.startPlace,
        endPlace: enrichment.endPlace ?? session.endPlace,
      };
      const persisted = await repository.archiveReplaySession(enrichedSession, {
        endedAtMs,
        minSamples: 1,
      });
      if (state.session?.id === persisted?.id) state.session = persisted;
      await queueArchivedSession(persisted);
      emit();
    } catch {
      state.pendingCloudSync = true;
      emit();
    }
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
    clearPersistTimer();
    releaseGpsSubscription();
    keepAliveAudio.removeEventListener("pause", handleKeepAliveInterruption);
    keepAliveAudio.removeEventListener("ended", handleKeepAliveInterruption);
    document.removeEventListener("visibilitychange", persistForLifecycle);
    window.removeEventListener("pagehide", persistForLifecycle);
    clearMediaSessionClient(DRIVE_RECORDING_MEDIA_SESSION_OWNER);
    listeners.clear();
  }

  async function hydrateActiveRecording() {
    const revision = hydrationRevision;
    try {
      const restored = await repository.loadActiveReplaySession?.();
      if (!restored || destroyed || revision !== hydrationRevision) return;
      const recordingState = restored.recordingState === "recording"
        ? "recording"
        : restored.recordingState === "paused" ? "paused" : "idle";
      if (recordingState === "idle") return;
      const lastSample = restored.lastSample
        || (Array.isArray(restored.samples) ? restored.samples[restored.samples.length - 1] : null);
      state.session = restored;
      state.recordingState = recordingState;
      state.startedAtMs = Number.isFinite(restored.startedAtMs) ? restored.startedAtMs : lastSample?.timestampMs ?? now();
      state.endedAtMs = Number.isFinite(restored.endedAtMs) ? restored.endedAtMs : null;
      state.sampleCount = Math.max(Number(restored.sampleCount) || 0, Array.isArray(restored.samples) ? restored.samples.length : 0);
      state.totalDistanceM = Math.max(0, Number(restored.totalDistanceM) || 0);
      state.currentSpeedMs = Math.max(0, Number(lastSample?.speedMs) || 0);
      state.maxSpeedMs = Math.max(0, Number(restored.maxSpeedMs) || state.currentSpeedMs);
      state.currentAltitudeM = Number.isFinite(lastSample?.altitudeM) ? lastSample.altitudeM : null;
      state.minAltitudeM = Number.isFinite(restored.minAltitudeM) ? restored.minAltitudeM : null;
      state.maxAltitudeM = Number.isFinite(restored.maxAltitudeM) ? restored.maxAltitudeM : null;
      state.lastHeadingDeg = Number.isFinite(lastSample?.headingDeg) ? lastSample.headingDeg : null;
      state.lastPosition = lastSample ? normalizeGpsPosition({
        ...lastSample,
        sampleSequence: 0,
        receivedAtMs: lastSample.timestampMs,
        stale: true,
      }) : null;
      state.recordingDistanceOffsetM = Math.max(
        0,
        (Number(restored.startDistanceM) || 0) + (Number(restored.totalDistanceM) || 0),
      );
      state.lastTelemetryTripDistanceM = 0;
      state.keepAliveIntended = recordingState === "recording";
      if (recordingState === "recording") {
        ensureGpsSubscription();
        void rearmKeepAlive({ reason: "active-recording-recovery" });
      }
      updateMediaSession();
      emit();
    } catch {
      // Recovery is best-effort; a fresh recording can still be started.
    }
  }

  void hydrateActiveRecording();

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
