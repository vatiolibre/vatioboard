import { getAlertUiState as buildAlertUiState, isManualAlertActive } from "../../speed/alerts.js";
import { createCameraDatabase } from "../../speed/camera-database.js";
import {
  DEFAULT_ALERT_LIMIT_MS,
  DISTANCE_UNIT_CONFIG,
  UNIT_CONFIG,
} from "../../speed/constants.js";
import {
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
  updateNearestTrapAcrossDatasets,
} from "../../speed/traps.js";
import { clearActivity, setActivity } from "../../shared/activity-state.js";
import { createDrivingAudioAlertController } from "./driving-audio-alert-controller.js";

const ALERT_CONSUMER_ID = "speed-alerts";
const GPS_STALE_MS = 12000;

function isFiniteLatLon(position) {
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

function normalizeGpsSnapshot(snapshotOrPosition) {
  const position = snapshotOrPosition?.normalized || snapshotOrPosition;
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

function createPreferencesSnapshot(state) {
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
} = {}) {
  const initialPreferences = loadInitialPreferences();
  const listeners = new Set();
  const state = {
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
    nearestTrapId: null,
    nearestTrapDistanceM: null,
    nearestTrapSpeedKph: null,
    nearestTrapSpeedMeta: null,
    cameraDatabaseStatus: createDefaultCameraStatus(),
    alertUiState: null,
    lastCameraLoadKey: "",
  };
  let gpsConsumerCleanup = null;
  let gpsUnsubscribe = null;
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
      return;
    }
    const nearest = updateNearestTrapAcrossDatasets(
      getLoadedDatasets(),
      position.longitude,
      position.latitude,
    );
    state.nearestTrapId = nearest.nearestTrapId;
    state.nearestTrapDistanceM = nearest.nearestTrapDistanceM;
    state.nearestTrapSpeedKph = nearest.nearestTrapSpeedKph;
    state.nearestTrapSpeedMeta = nearest.nearestTrapSpeedMeta;
  }

  function syncAudio(options = {}) {
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

  function handleCameraDatabaseStatus(nextStatus = {}) {
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

  function start({ reason = "start" } = {}) {
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

  function stop({ reason = "stop" } = {}) {
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

  function updatePreference(mutator, { fromUserGesture = false, startIfNeeded = true } = {}) {
    mutator();
    if (startIfNeeded && hasActiveAlertFeature()) start({ reason: "alert-preference" });
    else if (startIfNeeded && state.started && !hasActiveAlertFeature()) stop({ reason: "alerts-disabled" });
    syncAudio({ fromUserGesture });
    emit();
    return getSnapshot();
  }

  function setManualAlertEnabled(value, options = {}) {
    return updatePreference(() => {
      state.alertEnabled = Boolean(value);
      if (!Number.isFinite(state.alertLimitMs) || state.alertLimitMs <= 0) {
        state.alertLimitMs = DEFAULT_ALERT_LIMIT_MS;
      }
      saveAlertEnabledPreference(state.alertEnabled);
      saveAlertLimitPreference(state.alertLimitMs);
    }, options);
  }

  function setManualAlertLimitMs(value, options = {}) {
    return updatePreference(() => {
      const limit = Number(value);
      state.alertLimitMs = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_ALERT_LIMIT_MS;
      saveAlertLimitPreference(state.alertLimitMs);
    }, options);
  }

  function setAlertSoundEnabled(value, options = {}) {
    return updatePreference(() => {
      state.alertSoundEnabled = Boolean(value);
      saveAlertSoundEnabledPreference(state.alertSoundEnabled);
    }, options);
  }

  function setTrapAlertEnabled(value, options = {}) {
    return updatePreference(() => {
      state.trapAlertEnabled = Boolean(value);
      if (!state.trapAlertEnabled) {
        state.nearestTrapId = null;
      }
      saveTrapAlertEnabledPreference(state.trapAlertEnabled);
    }, options);
  }

  function setTrapSoundEnabled(value, options = {}) {
    return updatePreference(() => {
      state.trapSoundEnabled = Boolean(value);
      saveTrapSoundEnabledPreference(state.trapSoundEnabled);
    }, options);
  }

  function setTrapAlertDistanceM(value, options = {}) {
    return updatePreference(() => {
      state.trapAlertDistanceM = normalizeTrapAlertDistance(Number(value), state.distanceUnit);
      saveTrapAlertDistancePreference(state.trapAlertDistanceM);
    }, options);
  }

  function setMuted(value, options = {}) {
    return updatePreference(() => {
      state.audioMuted = Boolean(value);
      if (state.audioMuted) state.audioControlActive = false;
      saveAudioMutedPreference(state.audioMuted);
      alertAudio.setMuted?.(state.audioMuted);
    }, { startIfNeeded: false, ...options });
  }

  function setUnits({ unit = state.unit, distanceUnit = state.distanceUnit } = {}) {
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

  function subscribe(listener) {
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
