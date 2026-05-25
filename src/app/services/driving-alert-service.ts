import { getAlertUiState as buildAlertUiState, isManualAlertActive } from "../../speed/alerts.js";
import { findApproachingTrapAcrossDatasets } from "../../speed/camera-approach.js";
import { createCameraDatabase } from "../../speed/camera-database.js";
import {
  DEFAULT_ALERT_LIMIT_MS,
  DISTANCE_UNIT_CONFIG,
  UNIT_CONFIG,
} from "../../speed/constants.js";
import {
  loadCameraApproachOptionsPreference,
  loadInitialPreferences,
  normalizeTrapAlertDistance,
  saveAlertEnabledPreference,
  saveAlertLimitPreference,
  saveAlertSoundEnabledPreference,
  saveAudioMutedPreference,
  saveDistanceUnitPreference,
  saveTrapAlertDistancePreference,
  saveTrapAlertEnabledPreference,
  saveTrapSoundEnabledPreference,
  saveUnitPreference,
} from "../../speed/preferences.js";
import { convertSpeed } from "../../speed/render.js";
import {
  formatTrapDistance,
  formatTrapSpeed,
} from "../../speed/traps.js";
import { clearActivity, setActivity } from "../../shared/activity-state.js";
import type {
  DrivingAlertService,
  DrivingAlertSnapshot,
  GpsService,
  NormalizedGpsPosition,
} from "../../types/services";
import { createDrivingAudioAlertController } from "./driving-audio-alert-controller.js";

// TODO(ts-migration): speed camera DB and alert UI payloads are still JS-owned.
type LegacyDrivingAlertRecord = Record<string, any>;

interface DrivingAlertServiceOptions {
  gpsService?: GpsService | null;
  cameraDatabase?: LegacyDrivingAlertRecord | null;
  audioController?: LegacyDrivingAlertRecord | null;
  now?: () => number;
}

const ALERT_CONSUMER_ID = "speed-alerts";
const GPS_STALE_MS = 12000;

function isFiniteLatLon(position: LegacyDrivingAlertRecord | null | undefined) {
  return Number.isFinite(position?.latitude)
    && Number.isFinite(position?.longitude)
    && position.latitude >= -90
    && position.latitude <= 90
    && position.longitude >= -180
    && position.longitude <= 180;
}

function createDefaultCameraStatus() {
  return {
    status: "idle",
    activeCountryCode: "",
    activeCountryName: "",
    cameraCount: 0,
    loadedCameraCount: 0,
    lastUpdated: null,
    cacheHit: false,
    offline: false,
    error: null,
    unavailable: false,
    updating: false,
  };
}

function normalizeGpsSnapshot(snapshotOrPosition: LegacyDrivingAlertRecord | NormalizedGpsPosition | null | undefined): NormalizedGpsPosition | null {
  const candidate = snapshotOrPosition as LegacyDrivingAlertRecord | null | undefined;
  const position = (candidate?.normalized || snapshotOrPosition) as LegacyDrivingAlertRecord | NormalizedGpsPosition | null | undefined;
  if (!position || !isFiniteLatLon(position)) return null;
  return {
    latitude: Number(position.latitude),
    longitude: Number(position.longitude),
    accuracy: Number.isFinite(Number(position.accuracy)) ? Number(position.accuracy) : null,
    headingDeg: Number.isFinite(Number(position.headingDeg)) ? Number(position.headingDeg) : null,
    speedMs: Number.isFinite(Number(position.speedMs)) && Number(position.speedMs) >= 0
      ? Number(position.speedMs)
      : 0,
    timestampMs: Number.isFinite(Number(position.timestampMs)) ? Number(position.timestampMs) : Date.now(),
    receivedAtMs: Number.isFinite(Number(position.receivedAtMs)) ? Number(position.receivedAtMs) : Date.now(),
    stale: position.stale === true,
  };
}

function createPreferencesSnapshot(state: LegacyDrivingAlertRecord) {
  return {
    unit: state.unit,
    distanceUnit: state.distanceUnit,
    alertEnabled: state.alertEnabled,
    alertLimitMs: state.alertLimitMs,
    alertSoundEnabled: state.alertSoundEnabled,
    audioMuted: state.audioMuted,
    trapAlertEnabled: state.trapAlertEnabled,
    trapAlertDistanceM: state.trapAlertDistanceM,
    trapSoundEnabled: state.trapSoundEnabled,
    audioControlActive: state.audioControlActive,
  };
}

function getTrapAlertDistanceLabel(distanceM, distanceUnit) {
  const formatted = formatTrapDistance(distanceM, distanceUnit);
  if (formatted.value === "—") return "—";
  return `${formatted.value} ${formatted.unit}`;
}

export function createDrivingAlertService({
  gpsService,
  cameraDatabase = null,
  audioController = null,
  now = () => Date.now(),
}: DrivingAlertServiceOptions = {}): DrivingAlertService {
  const initialPreferences = loadInitialPreferences();
  const listeners = new Set<(snapshot: DrivingAlertSnapshot) => void>();
  const state: LegacyDrivingAlertRecord = {
    status: "idle",
    started: false,
    unit: initialPreferences.unit,
    distanceUnit: initialPreferences.distanceUnit,
    alertEnabled: initialPreferences.alertEnabled,
    alertLimitMs: initialPreferences.alertLimitMs,
    alertSoundEnabled: initialPreferences.alertSoundEnabled,
    audioMuted: initialPreferences.audioMuted,
    trapAlertEnabled: initialPreferences.trapAlertEnabled,
    trapAlertDistanceM: initialPreferences.trapAlertDistanceM,
    trapSoundEnabled: initialPreferences.trapSoundEnabled,
    audioControlActive: false,
    currentSpeedMs: 0,
    latestPosition: null,
    previousPosition: null,
    nearestTrapId: null,
    nearestTrapDistanceM: null,
    nearestTrapSpeedKph: null,
    nearestTrapSpeedMeta: null,
    cameraApproachState: "none",
    cameraApproachConfidence: "none",
    cameraApproachReason: "no-candidate",
    cameraApproachDetails: null,
    cameraDatabaseStatus: createDefaultCameraStatus(),
    alertUiState: null,
    lastCameraLoadKey: "",
  };
  let gpsConsumerCleanup: (() => void) | null = null;
  let gpsUnsubscribe: (() => void) | null = null;
  let destroyed = false;
  let ownedCameraDatabase = null;
  const alertAudio = audioController || createDrivingAudioAlertController({
    onStateChange: () => emit(),
  });

  function getCameraDatabase() {
    if (cameraDatabase) return cameraDatabase;
    if (!ownedCameraDatabase) {
      ownedCameraDatabase = createCameraDatabase({
        onStatusChange: handleCameraDatabaseStatus,
      });
    }
    return ownedCameraDatabase;
  }

  function getLoadedDatasets() {
    return getCameraDatabase()?.getLoadedDatasets?.() || [];
  }

  function hasLoadedCameraData() {
    return getLoadedDatasets().length > 0;
  }

  function getTrapLoadPending() {
    return state.trapAlertEnabled
      && (state.cameraDatabaseStatus.status === "loading"
        || (state.cameraDatabaseStatus.updating && !hasLoadedCameraData()));
  }

  function getTrapLoadError() {
    if (!state.trapAlertEnabled) return null;
    if (state.cameraDatabaseStatus.status === "error" && !hasLoadedCameraData()) {
      return state.cameraDatabaseStatus.error || new Error("Camera database unavailable.");
    }
    return null;
  }

  function buildAlertState() {
    return buildAlertUiState({
      unit: state.unit,
      currentSpeedMs: state.currentSpeedMs,
      alertEnabled: state.alertEnabled,
      alertLimitMs: state.alertLimitMs,
      trapAlertEnabled: state.trapAlertEnabled,
      trapLoadPending: getTrapLoadPending(),
      trapLoadError: getTrapLoadError(),
      nearestTrapId: state.nearestTrapId,
      nearestTrapDistanceM: state.nearestTrapDistanceM,
      nearestTrapSpeedKph: state.nearestTrapSpeedKph,
      nearestTrapSpeedMeta: state.nearestTrapSpeedMeta,
      cameraApproachState: state.cameraApproachState,
      cameraApproachConfidence: state.cameraApproachConfidence,
      cameraApproachReason: state.cameraApproachReason,
      cameraApproachDetails: state.cameraApproachDetails,
      trapAlertDistanceM: state.trapAlertDistanceM,
      convertSpeed,
      getTrapAlertDistanceLabel: (distanceM) => getTrapAlertDistanceLabel(distanceM, state.distanceUnit),
      formatTrapSpeed: (speedKph) => formatTrapSpeed(speedKph, state.unit),
    });
  }

  function hasEnabledAlertAudioFeature() {
    return (
      (isManualAlertActive(state.alertEnabled, state.alertLimitMs) && state.alertSoundEnabled) ||
      (state.trapAlertEnabled && state.trapSoundEnabled)
    );
  }

  function hasActiveAlertFeature() {
    return isManualAlertActive(state.alertEnabled, state.alertLimitMs) || state.trapAlertEnabled;
  }

  function getAudioIntended() {
    return state.audioControlActive && !state.audioMuted && hasEnabledAlertAudioFeature();
  }

  function computeStatus() {
    if (!state.started) return "idle";
    const position = state.latestPosition;
    if (
      !position ||
      position.stale ||
      now() - Number(position.receivedAtMs || position.timestampMs || 0) > GPS_STALE_MS
    ) {
      return "gps-stale";
    }
    if (getTrapLoadPending()) return "camera-loading";
    if (getTrapLoadError()) return "camera-unavailable";
    return "active";
  }

  function syncNearestTrap() {
    const position = state.latestPosition;
    if (!position || !state.trapAlertEnabled) {
      state.nearestTrapId = null;
      state.nearestTrapDistanceM = null;
      state.nearestTrapSpeedKph = null;
      state.nearestTrapSpeedMeta = null;
      state.cameraApproachState = "none";
      state.cameraApproachConfidence = "none";
      state.cameraApproachReason = "trap-alert-disabled";
      state.cameraApproachDetails = null;
      return;
    }
    const previousPosition = state.previousPosition && isFiniteLatLon(state.previousPosition)
      ? state.previousPosition
      : null;
    const nearest = findApproachingTrapAcrossDatasets(getLoadedDatasets(), {
      ...position,
      accuracyM: position.accuracy,
      previousPosition,
    }, {
      alertDistanceM: state.trapAlertDistanceM,
      ...loadCameraApproachOptionsPreference(),
    });
    state.nearestTrapId = nearest.nearestTrapId;
    state.nearestTrapDistanceM = nearest.nearestTrapDistanceM;
    state.nearestTrapSpeedKph = nearest.nearestTrapSpeedKph;
    state.nearestTrapSpeedMeta = nearest.nearestTrapSpeedMeta;
    state.cameraApproachState = nearest.cameraApproachState || "none";
    state.cameraApproachConfidence = nearest.cameraApproachConfidence || "none";
    state.cameraApproachReason = nearest.cameraApproachReason || "no-candidate";
    state.cameraApproachDetails = nearest.cameraApproachDetails || null;
  }

  function syncAudio(options: LegacyDrivingAlertRecord = {}) {
    state.alertUiState = buildAlertState();
    state.status = computeStatus();
    alertAudio.sync?.({
      alertUiState: state.alertUiState,
      nearestTrapId: state.nearestTrapId,
      alertSoundEnabled: state.alertSoundEnabled,
      trapSoundEnabled: state.trapSoundEnabled,
      muted: state.audioMuted,
      audioIntended: getAudioIntended(),
      fromUserGesture: options.fromUserGesture === true,
    });
  }

  function publishActivity(snapshot = getSnapshot()) {
    const audio = snapshot.audio;
    const intended = getAudioIntended();
    const shouldShow =
      intended ||
      audio.backgroundAudioArmed ||
      audio.backgroundAudioArmPending ||
      audio.blocked;

    if (!shouldShow) {
      clearActivity("speed.alerts");
      return;
    }

    let stateName = "armed";
    let labelKey = "activitySpeedAlertsArmed";
    let detailKey = "activitySpeedAlertsReady";
    if (audio.blocked) {
      stateName = audio.backgroundAudioArmed ? "armed" : "blocked";
      labelKey = audio.backgroundAudioArmed ? "activitySpeedAlertsArmed" : "activitySpeedAlertsBlocked";
      detailKey = audio.backgroundAudioArmed
        ? "activitySpeedAlertsSoundMayNeedTap"
        : "activitySpeedAlertsUserAction";
    } else if (audio.backgroundAudioArmPending) {
      stateName = "arming";
      labelKey = "activitySpeedAlertsArming";
    }

    setActivity("speed.alerts", {
      kind: "speed",
      order: 11,
      route: "#/speed",
      openLabelKey: "activityOpenSpeedAlerts",
      state: stateName,
      labelKey,
      detailKey,
    });
  }

  function emit() {
    if (destroyed) return;
    const snapshot = getSnapshot();
    publishActivity(snapshot);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Advisory subscribers must not break app-level alerts.
      }
    }
    window.dispatchEvent?.(new CustomEvent("vatioboard:driving-alerts", { detail: snapshot }));
  }

  function handleCameraDatabaseStatus(nextStatus: LegacyDrivingAlertRecord = {}) {
    state.cameraDatabaseStatus = {
      ...state.cameraDatabaseStatus,
      ...nextStatus,
    };
    syncNearestTrap();
    syncAudio();
    emit();
  }

  function ensureCameraArtifactsForPosition(position) {
    if (!state.trapAlertEnabled || !position || !isFiniteLatLon(position)) return;
    const loadKey = `${position.longitude.toFixed(3)},${position.latitude.toFixed(3)}`;
    if (loadKey === state.lastCameraLoadKey && hasLoadedCameraData()) return;
    state.lastCameraLoadKey = loadKey;
    void getCameraDatabase()
      .loadForLocation?.({
        longitude: position.longitude,
        latitude: position.latitude,
      })
      .then((result) => {
        state.cameraDatabaseStatus = {
          ...state.cameraDatabaseStatus,
          ...(result?.status || getCameraDatabase().getStatus?.() || {}),
        };
        syncNearestTrap();
        syncAudio();
        emit();
      })
      .catch((error) => {
        state.cameraDatabaseStatus = {
          ...state.cameraDatabaseStatus,
          status: hasLoadedCameraData() ? "offline" : "error",
          offline: true,
          unavailable: !hasLoadedCameraData(),
          error,
        };
        syncNearestTrap();
        syncAudio();
        emit();
      });
  }

  function handleGpsSnapshot(snapshotOrPosition) {
    if (destroyed || !state.started) return;
    const position = normalizeGpsSnapshot(snapshotOrPosition);
    if (!position) {
      state.status = "gps-stale";
      syncAudio();
      emit();
      return;
    }
    const previousPosition = state.latestPosition;
    state.previousPosition = previousPosition;
    state.latestPosition = position;
    state.currentSpeedMs = position.stale ? 0 : position.speedMs;
    ensureCameraArtifactsForPosition(position);
    syncNearestTrap();
    syncAudio();
    emit();
  }

  function ensureGpsSubscription() {
    if (gpsConsumerCleanup || !gpsService) return;
    gpsConsumerCleanup = gpsService.startConsumer?.(ALERT_CONSUMER_ID, {
      enableHighAccuracy: true,
      reason: "driving-alerts",
    }) || null;
    gpsUnsubscribe = gpsService.subscribe?.((snapshot) => {
      if (snapshot?.normalized) handleGpsSnapshot(snapshot.normalized);
    }) || null;
  }

  function releaseGpsSubscription() {
    gpsUnsubscribe?.();
    gpsUnsubscribe = null;
    gpsConsumerCleanup?.();
    gpsConsumerCleanup = null;
  }

  function start({ reason: _reason = "start" }: LegacyDrivingAlertRecord = {}) {
    if (destroyed) return getSnapshot();
    state.started = true;
    ensureGpsSubscription();
    const currentPosition = gpsService?.getCurrentPosition?.();
    if (currentPosition) handleGpsSnapshot(currentPosition);
    else {
      syncAudio();
      emit();
    }
    return getSnapshot();
  }

  function stop({ reason: _reason = "stop" }: LegacyDrivingAlertRecord = {}) {
    state.started = false;
    state.audioControlActive = false;
    releaseGpsSubscription();
    alertAudio.disarmBackgroundAudio?.();
    state.status = "idle";
    syncAudio();
    clearActivity("speed.alerts");
    emit();
    return getSnapshot();
  }

  function updatePreference(mutator: () => void, { fromUserGesture = false, startIfNeeded = true }: LegacyDrivingAlertRecord = {}) {
    mutator();
    if (startIfNeeded && hasActiveAlertFeature()) start({ reason: "alert-preference" });
    else if (startIfNeeded && state.started && !hasActiveAlertFeature()) stop({ reason: "alerts-disabled" });
    syncAudio({ fromUserGesture });
    emit();
    return getSnapshot();
  }

  function setManualAlertEnabled(value: unknown, options: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      state.alertEnabled = Boolean(value);
      if (!Number.isFinite(state.alertLimitMs) || state.alertLimitMs <= 0) {
        state.alertLimitMs = DEFAULT_ALERT_LIMIT_MS;
      }
      saveAlertEnabledPreference(state.alertEnabled);
      saveAlertLimitPreference(state.alertLimitMs);
    }, options);
  }

  function setManualAlertLimitMs(value: unknown, options: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      const limit = Number(value);
      state.alertLimitMs = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_ALERT_LIMIT_MS;
      saveAlertLimitPreference(state.alertLimitMs);
    }, options);
  }

  function setAlertSoundEnabled(value: unknown, options: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      state.alertSoundEnabled = Boolean(value);
      saveAlertSoundEnabledPreference(state.alertSoundEnabled);
    }, options);
  }

  function setTrapAlertEnabled(value: unknown, options: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      state.trapAlertEnabled = Boolean(value);
      if (!state.trapAlertEnabled) {
        state.nearestTrapId = null;
        state.nearestTrapDistanceM = null;
        state.nearestTrapSpeedKph = null;
        state.nearestTrapSpeedMeta = null;
        state.cameraApproachState = "none";
        state.cameraApproachConfidence = "none";
        state.cameraApproachReason = "trap-alert-disabled";
        state.cameraApproachDetails = null;
      }
      saveTrapAlertEnabledPreference(state.trapAlertEnabled);
    }, options);
  }

  function setTrapSoundEnabled(value: unknown, options: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      state.trapSoundEnabled = Boolean(value);
      saveTrapSoundEnabledPreference(state.trapSoundEnabled);
    }, options);
  }

  function setTrapAlertDistanceM(value: unknown, options: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      state.trapAlertDistanceM = normalizeTrapAlertDistance(Number(value), state.distanceUnit);
      saveTrapAlertDistancePreference(state.trapAlertDistanceM);
    }, options);
  }

  function setMuted(value: unknown, options: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      state.audioMuted = Boolean(value);
      if (state.audioMuted) state.audioControlActive = false;
      saveAudioMutedPreference(state.audioMuted);
      alertAudio.setMuted?.(state.audioMuted);
    }, { startIfNeeded: false, ...options });
  }

  function setUnits({ unit = state.unit, distanceUnit = state.distanceUnit }: LegacyDrivingAlertRecord = {}) {
    return updatePreference(() => {
      if (UNIT_CONFIG[unit]) {
        state.unit = unit;
        saveUnitPreference(unit);
      }
      if (DISTANCE_UNIT_CONFIG[distanceUnit]) {
        state.distanceUnit = distanceUnit;
        state.trapAlertDistanceM = normalizeTrapAlertDistance(state.trapAlertDistanceM, distanceUnit);
        saveDistanceUnitPreference(distanceUnit);
        saveTrapAlertDistancePreference(state.trapAlertDistanceM);
      }
    }, { startIfNeeded: false });
  }

  function primeAudioFromUserGesture() {
    state.audioControlActive = true;
    if (hasActiveAlertFeature()) start({ reason: "user-audio-prime" });
    const keepAlive = hasEnabledAlertAudioFeature() && !state.audioMuted;
    const promise = alertAudio.primeAudioFromUserGesture?.({ keepAlive }) || Promise.resolve(false);
    syncAudio({ fromUserGesture: true });
    emit();
    return promise.then((result) => {
      syncAudio({ fromUserGesture: true });
      emit();
      return result;
    });
  }

  function subscribe(listener: (snapshot: DrivingAlertSnapshot) => void) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    const audio = alertAudio.getSnapshot?.() || {};
    return {
      status: state.status,
      currentSpeedMs: state.currentSpeedMs,
      latestPosition: state.latestPosition ? { ...state.latestPosition } : null,
      alertUiState: state.alertUiState || buildAlertState(),
      nearestTrapId: state.nearestTrapId,
      nearestTrapDistanceM: state.nearestTrapDistanceM,
      nearestTrapSpeedKph: state.nearestTrapSpeedKph,
      nearestTrapSpeedMeta: state.nearestTrapSpeedMeta,
      cameraApproachState: state.cameraApproachState,
      cameraApproachConfidence: state.cameraApproachConfidence,
      cameraApproachReason: state.cameraApproachReason,
      cameraApproachDetails: state.cameraApproachDetails ? { ...state.cameraApproachDetails } : null,
      cameraDatabaseStatus: { ...state.cameraDatabaseStatus },
      preferences: createPreferencesSnapshot(state),
      audio: {
        overspeedAudible: Boolean(audio.overspeedAudible),
        trapAudible: Boolean(audio.trapAudible),
        blocked: Boolean(audio.blocked),
        alertSoundBlocked: Boolean(audio.alertSoundBlocked),
        trapSoundBlocked: Boolean(audio.trapSoundBlocked),
        muted: state.audioMuted,
        primed: Boolean(audio.primed),
        pending: Boolean(audio.pending),
        backgroundAudioArmed: Boolean(audio.backgroundAudioArmed),
        backgroundAudioArmPending: Boolean(audio.backgroundAudioArmPending),
      },
    };
  }

  function destroy() {
    destroyed = true;
    releaseGpsSubscription();
    alertAudio.destroy?.();
    ownedCameraDatabase?.destroy?.();
    clearActivity("speed.alerts");
    listeners.clear();
  }

  state.alertUiState = buildAlertState();
  state.status = computeStatus();

  return {
    destroy,
    getSnapshot,
    primeAudioFromUserGesture,
    setAlertSoundEnabled,
    setManualAlertEnabled,
    setManualAlertLimitMs,
    setMuted,
    setTrapAlertDistanceM,
    setTrapAlertEnabled,
    setTrapSoundEnabled,
    setUnits,
    start,
    stop,
    subscribe,
  };
}
