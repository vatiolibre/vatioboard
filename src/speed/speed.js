import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/speed.less";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import { createAnalogSpeedometer } from "../shared/analog-speedometer.js";
import { initSupportPanel } from "../shared/support-panel.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import { IconAccel, IconBoard, IconGpsLab, IconReplay } from "../icons.js";
import {
  archiveReplaySession,
  createReplaySession,
  hasReplaySamples,
  loadActiveReplaySession,
  appendReplaySample,
  saveActiveReplaySession,
} from "../replay/session.js";
import {
  DEFAULT_ALERT_LIMIT_MS,
  DISTANCE_UNIT_CONFIG,
  GEO_ERROR_CODE,
  MAX_PLAUSIBLE_SPEED_MS,
  MIN_MOVING_SPEED_MS,
  SPEED_SMOOTHING_SAMPLES,
  UNIT_CONFIG,
  WAZE_EMBED_BASE_URL,
} from "./constants.js";
import {
  getTrapAlertPresets,
  loadInitialPreferences,
  normalizeInitialAudioPreferences,
  normalizeTrapAlertDistance,
  saveAlertEnabledPreference,
  saveAlertLimitPreference,
  saveAlertSoundEnabledPreference,
  saveAlertTriggerDiscoveredPreference,
  saveAudioMutedPreference,
  saveBackgroundAudioEnabledPreference,
  saveDistanceUnitPreference,
  savePrimaryViewPreference,
  saveTrapAlertDistancePreference,
  saveTrapAlertEnabledPreference,
  saveTrapSoundEnabledPreference,
  saveUnitPreference,
} from "./preferences.js";
import {
  getAlertConfig,
  getAlertLimitDisplayValue as computeAlertLimitDisplayValue,
  getAlertUiState as buildAlertUiState,
  isManualAlertActive,
  normalizeAlertDisplayValue,
} from "./alerts.js";
import { createSpeedAudioController } from "./audio.js";
import {
  createGlobeController,
  createWazeController,
  getMovementThresholdM,
  haversineDistance,
  normalizePositionTimestamp,
} from "./navigation.js";
import {
  convertDisplaySpeedToMs,
  convertSpeed,
  createSpeedRenderer,
  formatGlobeTimestamp,
  tf,
} from "./render.js";
import {
  createTrapLoader,
  formatTrapDistance,
  formatTrapSpeed,
  updateNearestTrap,
} from "./traps.js";

const elements = {
  gaugeCard: document.querySelector(".gauge-card"),
  langToggle: document.getElementById("langToggle"),
  toolsMenuBtn: document.getElementById("speedToolsMenuBtn"),
  toolsMenuList: document.getElementById("speedToolsMenuList"),
  openReplayMenu: document.getElementById("openSpeedReplayMenu"),
  openAccelMenu: document.getElementById("openSpeedAccelMenu"),
  openGpsLabMenu: document.getElementById("openSpeedGpsLabMenu"),
  openBoardMenu: document.getElementById("openSpeedBoardMenu"),
  primaryViewButtons: Array.from(document.querySelectorAll(".speed-view-btn")),
  speedPrimaryStage: document.getElementById("speedPrimaryStage"),
  gaugeStage: document.getElementById("gaugeStage"),
  gaugeStageInner: document.querySelector(".gauge-stage-inner"),
  wazeStage: document.getElementById("wazeStage"),
  wazeFrame: document.getElementById("wazeFrame"),
  wazePlaceholder: document.getElementById("wazePlaceholder"),
  wazePlaceholderText: document.getElementById("wazePlaceholderText"),
  wazeSpeedPill: document.getElementById("wazeSpeedPill"),
  wazeSpeedValue: document.getElementById("wazeSpeedValue"),
  wazeSpeedUnit: document.getElementById("wazeSpeedUnit"),
  wazeSpeedLimitLabel: document.getElementById("wazeSpeedLimitLabel"),
  wazeSpeedLimitValue: document.getElementById("wazeSpeedLimitValue"),
  wazeSpeedNote: document.getElementById("wazeSpeedNote"),
  wazeLocationPrompt: document.getElementById("wazeLocationPrompt"),
  wazeRecenter: document.getElementById("wazeRecenter"),
  alertBackdrop: document.getElementById("speedAlertBackdrop"),
  dialCanvas: document.getElementById("speedDial"),
  needleCanvas: document.getElementById("speedNeedle"),
  speedValue: document.getElementById("speedValue"),
  speedUnit: document.getElementById("speedUnit"),
  status: document.getElementById("status"),
  subStatus: document.getElementById("subStatus"),
  maxSpeed: document.getElementById("maxSpeed"),
  maxSpeedUnit: document.getElementById("maxSpeedUnit"),
  avgSpeed: document.getElementById("avgSpeed"),
  avgSpeedUnit: document.getElementById("avgSpeedUnit"),
  distanceValue: document.getElementById("distanceValue"),
  distanceUnit: document.getElementById("distanceUnit"),
  nearestTrapDistance: document.getElementById("nearestTrapDistance"),
  nearestTrapUnit: document.getElementById("nearestTrapUnit"),
  durationValue: document.getElementById("durationValue"),
  altitudeValue: document.getElementById("altitudeValue"),
  altitudeUnit: document.getElementById("altitudeUnit"),
  maxAltitude: document.getElementById("maxAltitude"),
  maxAltitudeUnit: document.getElementById("maxAltitudeUnit"),
  minAltitude: document.getElementById("minAltitude"),
  minAltitudeUnit: document.getElementById("minAltitudeUnit"),
  notice: document.getElementById("notice"),
  noticeText: document.getElementById("noticeText"),
  retryGps: document.getElementById("retryGps"),
  resetTrip: document.getElementById("resetTrip"),
  toggleRecording: document.getElementById("toggleRecording"),
  stopRecording: document.getElementById("stopRecording"),
  alertTrigger: document.getElementById("alertTrigger"),
  alertTriggerValue: document.getElementById("alertTriggerValue"),
  alertTriggerHint: document.getElementById("alertTriggerHint"),
  alertPanel: document.getElementById("speedAlertPanel"),
  alertPanelStatus: document.getElementById("alertPanelStatus"),
  closeAlertPanel: document.getElementById("closeAlertPanel"),
  alertToggle: document.getElementById("alertToggle"),
  alertUseCurrent: document.getElementById("alertUseCurrent"),
  alertDecrease: document.getElementById("alertDecrease"),
  alertIncrease: document.getElementById("alertIncrease"),
  alertValue: document.getElementById("alertValue"),
  alertUnit: document.getElementById("alertUnit"),
  alertPresets: document.getElementById("alertPresets"),
  alertSoundButtons: Array.from(document.querySelectorAll(".alert-sound-btn")),
  trapAlertButtons: Array.from(document.querySelectorAll(".trap-alert-btn")),
  trapDistancePresets: document.getElementById("trapDistancePresets"),
  trapSoundButtons: Array.from(document.querySelectorAll(".trap-sound-btn")),
  quickAudioToggle: document.getElementById("quickAudioToggle"),
  quickBackgroundAudioToggle: document.getElementById("quickBackgroundAudioToggle"),
  backgroundAudioButtons: Array.from(document.querySelectorAll(".background-audio-btn")),
  unitButtons: Array.from(document.querySelectorAll(".unit-btn")),
  distanceUnitButtons: Array.from(document.querySelectorAll(".distance-unit-btn")),
  globeMount: document.getElementById("speedGlobe"),
  globeStatus: document.getElementById("globeStatus"),
};

const toolsMenu = initToolsMenu({
  button: elements.toolsMenuBtn,
  list: elements.toolsMenuList,
});
initSupportPanel();

applyButtonIcon(elements.openAccelMenu, IconAccel);
applyButtonIcon(elements.openGpsLabMenu, IconGpsLab);
applyButtonIcon(elements.openBoardMenu, IconBoard);
applyButtonIcon(elements.openReplayMenu, IconReplay);

const analogSpeedometer = createAnalogSpeedometer({
  stageElement: elements.gaugeStage,
  stageInnerElement: elements.gaugeStageInner,
  dialCanvas: elements.dialCanvas,
  needleCanvas: elements.needleCanvas,
  valueElement: elements.speedValue,
  unitElement: elements.speedUnit,
  substatusElement: elements.subStatus,
  resizeTarget: elements.speedPrimaryStage,
  styleSourceElement: elements.gaugeStage,
});

const pageDescriptionMeta = document.querySelector('meta[name="description"]');
const loadedPreferences = normalizeInitialAudioPreferences(loadInitialPreferences());
const initialPreferences = loadedPreferences.preferences;
const initialReplaySession = createReplaySession({
  unit: initialPreferences.unit,
  distanceUnit: initialPreferences.distanceUnit,
  recordingState: "recording",
});
const ACTIVE_REPLAY_PERSIST_INTERVAL_MS = 5000;

const state = {
  unit: initialPreferences.unit,
  distanceUnit: initialPreferences.distanceUnit,
  primaryView: initialPreferences.primaryView,
  alertEnabled: initialPreferences.alertEnabled,
  alertLimitMs: initialPreferences.alertLimitMs,
  alertSoundEnabled: initialPreferences.alertSoundEnabled,
  audioMuted: initialPreferences.audioMuted,
  backgroundAudioEnabled: initialPreferences.backgroundAudioEnabled,
  audioPrimed: false,
  audioPrimePending: false,
  backgroundAudioArmed: false,
  backgroundAudioArmPending: false,
  backgroundAudioRevision: 0,
  backgroundAudioSuppressed: false,
  overspeedSoundRequestId: 0,
  alertSoundBlocked: false,
  alertSoundPending: false,
  overspeedAudible: false,
  trapAlertEnabled: initialPreferences.trapAlertEnabled,
  trapAlertDistanceM: initialPreferences.trapAlertDistanceM,
  trapSoundEnabled: initialPreferences.trapSoundEnabled,
  alertTriggerDiscovered: initialPreferences.alertTriggerDiscovered,
  trapSoundRequestId: 0,
  trapSoundBlocked: false,
  trapSoundPending: false,
  trapAudible: false,
  trapSoundDeadlineAt: 0,
  trapMuteTimeoutId: null,
  watchId: null,
  startTime: null,
  trackingStartedAt: Date.now(),
  statusKind: "requesting",
  statusParams: null,
  statusText: t("requestingGps"),
  noticeKey: null,
  noticeParams: null,
  currentSpeedMs: 0,
  displayedSpeedMs: 0,
  maxSpeedMs: 0,
  totalDistanceM: 0,
  currentAltitudeM: null,
  maxAltitudeM: null,
  minAltitudeM: null,
  lastPoint: null,
  trapRecords: [],
  trapIndex: null,
  nearestTrapId: null,
  nearestTrapDistanceM: null,
  nearestTrapSpeedKph: null,
  trapLoadPending: true,
  trapLoadError: null,
  lastTrapSoundedId: null,
  recentSpeeds: [],
  lastAccuracyM: null,
  lastFixAt: 0,
  lastPositionTimestamp: null,
  lastKnownLatitude: null,
  lastKnownLongitude: null,
  renderFrameId: null,
  lastTextUpdateAt: 0,
  wazeLoaded: false,
  wazeLoadPending: false,
  wazeCenteredAt: null,
  wazeCenterLatitude: null,
  wazeCenterLongitude: null,
  globeMap: null,
  globeReady: false,
  globeError: null,
  globeResizeObserver: null,
  globeCenter: null,
  globeFollowPausedUntil: 0,
  globeFollowResumeTimeoutId: null,
  globeSolarUpdateIntervalId: null,
  globeSolarSyncFrameId: null,
  globeSolarGeometryDirty: false,
  runtimePageTitle: "",
  runtimeArtworkSignature: "",
  runtimeArtworkDataUrl: "",
  runtimeDynamicArtworkBlocked: false,
  runtimeMediaMetadataSignature: "",
  runtimeMediaMetadataUrgencySignature: "",
  runtimeMediaMetadataUpdatedAt: 0,
  runtimeMediaPlaybackState: "",
  recordingState: initialReplaySession.recordingState,
  replaySession: initialReplaySession,
};

let globeController = null;
let wazeController = null;
let audioController = null;
let replayPersistTimerId = null;
let replayPersistChain = Promise.resolve();

function clearReplayPersistTimer() {
  if (replayPersistTimerId !== null) {
    window.clearTimeout(replayPersistTimerId);
    replayPersistTimerId = null;
  }
}

function enqueueReplaySessionPersist(sessionSnapshot) {
  replayPersistChain = replayPersistChain
    .catch(() => {})
    .then(() => saveActiveReplaySession(sessionSnapshot));
  return replayPersistChain;
}

function persistReplaySessionNow() {
  clearReplayPersistTimer();
  return enqueueReplaySessionPersist(state.replaySession);
}

function scheduleReplaySessionPersist({ immediate = false } = {}) {
  if (immediate || state.recordingState !== "recording") {
    void persistReplaySessionNow();
    return;
  }

  if (replayPersistTimerId !== null) return;

  replayPersistTimerId = window.setTimeout(() => {
    replayPersistTimerId = null;
    void enqueueReplaySessionPersist(state.replaySession);
  }, ACTIVE_REPLAY_PERSIST_INTERVAL_MS);
}

async function hydrateReplaySession() {
  const restoredReplaySession = await loadActiveReplaySession();
  if (!restoredReplaySession) return;

  state.recordingState = restoredReplaySession.recordingState;
  state.replaySession = {
    ...restoredReplaySession,
    unit: state.unit,
    distanceUnit: state.distanceUnit,
    recordingState: restoredReplaySession.recordingState,
  };
}

function bindMenuNavigation(element, href) {
  if (!element) return;
  element.addEventListener("click", () => {
    toolsMenu.close();
    window.location.href = href;
  });
}

function getTrapAlertDistanceLabel(distanceM = state.trapAlertDistanceM) {
  const formatted = formatTrapDistance(distanceM, state.distanceUnit, t("away"));
  if (formatted.value === "—") return "—";
  return `${formatted.value} ${formatted.unit}`;
}

function getConfiguredTrapAlertDistanceLabel(distanceM = state.trapAlertDistanceM, unit = state.distanceUnit) {
  const matchingPreset = getTrapAlertPresets(unit).find((preset) => Math.abs(preset.meters - distanceM) < 1);
  return matchingPreset?.label ?? getTrapAlertDistanceLabel(distanceM);
}

function getAlertLimitDisplayValue(unit = state.unit) {
  return computeAlertLimitDisplayValue(state.alertLimitMs, unit, convertSpeed);
}

function getAlertUiState() {
  return buildAlertUiState({
    unit: state.unit,
    currentSpeedMs: state.currentSpeedMs,
    alertEnabled: state.alertEnabled,
    alertLimitMs: state.alertLimitMs,
    trapAlertEnabled: state.trapAlertEnabled,
    trapLoadPending: state.trapLoadPending,
    trapLoadError: state.trapLoadError,
    nearestTrapId: state.nearestTrapId,
    nearestTrapDistanceM: state.nearestTrapDistanceM,
    nearestTrapSpeedKph: state.nearestTrapSpeedKph,
    trapAlertDistanceM: state.trapAlertDistanceM,
    convertSpeed,
    getTrapAlertDistanceLabel,
    formatTrapSpeed: (speedKph) => formatTrapSpeed(speedKph, state.unit),
  });
}

const speedRenderer = createSpeedRenderer({
  state,
  elements,
  analogSpeedometer,
  t,
  getLang,
  getAlertUiState,
  isManualAlertActive: () => isManualAlertActive(state.alertEnabled, state.alertLimitMs),
  getAlertConfig,
  getAlertLimitDisplayValue,
  getConfiguredTrapAlertDistanceLabel,
  getTrapAlertPresets,
  formatTrapDistance,
  renderWazeUi: () => {
    wazeController?.renderWazeUi();
  },
  renderGlobeStatus: () => {
    globeController?.renderGlobeStatus();
  },
  syncRuntimePagePresentation: () => {
    audioController?.syncRuntimePagePresentation();
  },
});

globeController = createGlobeController({
  state,
  elements,
  t,
  renderStatusText: (timestamp) => formatGlobeTimestamp(timestamp, getLang()),
});

wazeController = createWazeController({
  state,
  elements,
  t,
  getAlertUiState,
  convertSpeed,
  hasLiveCoordinateFix: () => globeController.hasLiveCoordinateFix(),
  getCurrentCoordinates: () => globeController.getCurrentCoordinates(),
});

audioController = createSpeedAudioController({
  state,
  t,
  getAlertUiState,
  convertSpeed,
  getConfiguredTrapAlertDistanceLabel,
  getAlertLimitDisplayValue,
  getSubStatusText: (alertState) => speedRenderer.getSubStatusText(alertState),
  getCriticalAlertText: (alertState) => speedRenderer.getCriticalAlertText(alertState),
});

function renderMetrics() {
  speedRenderer.renderMetrics(renderAlertUi);
}

function renderRecordingControls() {
  if (!elements.toggleRecording || !elements.stopRecording) return;

  const hasSamples = hasReplaySamples(state.replaySession, 1);
  const toggleLabel = state.recordingState === "recording"
    ? t("pauseRecording")
    : (state.recordingState === "paused" ? t("resumeRecording") : t("startRecording"));

  elements.toggleRecording.textContent = toggleLabel;
  elements.toggleRecording.setAttribute("aria-pressed", String(state.recordingState === "recording"));
  elements.stopRecording.disabled = state.recordingState === "stopped" && !hasSamples;
}

function syncReplaySessionPreferences() {
  state.replaySession = {
    ...state.replaySession,
    unit: state.unit,
    distanceUnit: state.distanceUnit,
    recordingState: state.recordingState,
  };
  scheduleReplaySessionPersist({ immediate: true });
  renderRecordingControls();
}

function resetReplaySession({
  archiveCurrent = true,
  endedAtMs = Date.now(),
  recordingState = state.recordingState,
  minSamples = 2,
} = {}) {
  if (archiveCurrent) {
    void archiveReplaySession(state.replaySession, { endedAtMs, minSamples });
  }

  state.recordingState = recordingState;
  state.replaySession = createReplaySession({
    unit: state.unit,
    distanceUnit: state.distanceUnit,
    recordingState,
  });
  scheduleReplaySessionPersist({ immediate: true });
  renderRecordingControls();
}

function setRecordingState(recordingState) {
  state.recordingState = recordingState;
  state.replaySession = {
    ...state.replaySession,
    recordingState,
    unit: state.unit,
    distanceUnit: state.distanceUnit,
  };
  scheduleReplaySessionPersist({ immediate: true });
  renderRecordingControls();
}

function toggleRecording() {
  if (state.recordingState === "recording") {
    setRecordingState("paused");
    return;
  }

  if (state.recordingState === "stopped") {
    resetReplaySession({
      archiveCurrent: false,
      recordingState: "recording",
    });
    return;
  }

  setRecordingState("recording");
}

function stopRecordingSession() {
  resetReplaySession({
    archiveCurrent: true,
    endedAtMs: Number.isFinite(state.lastPositionTimestamp)
      ? state.lastPositionTimestamp
      : Date.now(),
    recordingState: "stopped",
    minSamples: 1,
  });
}

function updateNearestTrapState(longitude, latitude) {
  const nextTrapState = updateNearestTrap(state.trapIndex, state.trapRecords, longitude, latitude);
  state.nearestTrapId = nextTrapState.nearestTrapId;
  state.nearestTrapDistanceM = nextTrapState.nearestTrapDistanceM;
  state.nearestTrapSpeedKph = nextTrapState.nearestTrapSpeedKph;
}

const trapLoader = createTrapLoader({
  state,
  dataUrl: "/geo/ansv_cameras_compact.min.json",
  indexUrl: "/geo/ansv_cameras_compact.kdbush",
  renderMetrics,
  afterLoad: () => {
    if (state.lastPoint) {
      updateNearestTrapState(state.lastPoint.longitude, state.lastPoint.latitude);
    }
  },
});

function updatePageMeta() {
  document.documentElement.lang = getLang();
  if (pageDescriptionMeta) {
    pageDescriptionMeta.setAttribute("content", t("speedPageDescription"));
  }
  audioController.syncRuntimePagePresentation();
}

function setStatus(kind, params = null) {
  state.statusKind = kind;
  state.statusParams = params;
  state.statusText = speedRenderer.getStatusText(kind, params);
  elements.status.textContent = state.statusText;
  speedRenderer.renderSubStatus();
  globeController.renderGlobeStatus();
  wazeController.renderWazeUi();
  audioController.syncRuntimePagePresentation();
}

function showNotice(message) {
  state.noticeKey = null;
  state.noticeParams = null;
  elements.notice.hidden = false;
  elements.noticeText.textContent = message;
}

function showTranslatedNotice(key, params = null) {
  state.noticeKey = key;
  state.noticeParams = params;
  elements.notice.hidden = false;
  elements.noticeText.textContent = tf(t, key, params ?? {});
}

function hideNotice() {
  state.noticeKey = null;
  state.noticeParams = null;
  elements.notice.hidden = true;
}

function renderPrimaryView() {
  if (!elements.gaugeCard) return;

  elements.gaugeCard.dataset.primaryView = state.primaryView;
  elements.gaugeStage?.setAttribute("aria-hidden", String(state.primaryView !== "gauge"));
  elements.wazeStage?.setAttribute("aria-hidden", String(state.primaryView !== "waze"));
  elements.gaugeStage?.toggleAttribute("inert", state.primaryView !== "gauge");
  elements.wazeStage?.toggleAttribute("inert", state.primaryView !== "waze");

  if (elements.wazeFrame) {
    elements.wazeFrame.tabIndex = state.primaryView === "waze" ? 0 : -1;
  }

  if (elements.wazeRecenter) {
    elements.wazeRecenter.tabIndex = state.primaryView === "waze" ? 0 : -1;
  }

  if (elements.wazeLocationPrompt) {
    elements.wazeLocationPrompt.tabIndex = state.primaryView === "waze" ? 0 : -1;
  }

  for (const button of elements.primaryViewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.primaryView === state.primaryView));
  }

  wazeController.renderWazeUi();
}

function setPrimaryView(view) {
  if (view !== "gauge" && view !== "waze") return;

  const viewChanged = state.primaryView !== view;
  state.primaryView = view;
  savePrimaryViewPreference(view);
  renderPrimaryView();

  if (view === "waze" && (!state.wazeLoaded || !elements.wazeFrame?.getAttribute("src"))) {
    wazeController.syncWazeEmbed();
  }

  if (viewChanged) {
    resizeCanvas();
  }
}

function renderQuickAudioControls() {
  if (elements.quickAudioToggle) {
    elements.quickAudioToggle.setAttribute("aria-pressed", String(!state.audioMuted));
    elements.quickAudioToggle.classList.toggle("is-muted", state.audioMuted);
    const audioToggleLabel = state.audioMuted ? t("unmuteAlertAudio") : t("muteAlertAudio");
    elements.quickAudioToggle.setAttribute("aria-label", audioToggleLabel);
    elements.quickAudioToggle.title = audioToggleLabel;
  }

  if (elements.quickBackgroundAudioToggle) {
    elements.quickBackgroundAudioToggle.setAttribute("aria-pressed", String(state.backgroundAudioEnabled));
    const backgroundAudioLabel = state.backgroundAudioEnabled
      ? t("disableBackgroundAudio")
      : t("enableBackgroundAudio");
    elements.quickBackgroundAudioToggle.setAttribute("aria-label", backgroundAudioLabel);
    elements.quickBackgroundAudioToggle.title = backgroundAudioLabel;
  }
}

function syncAlertTriggerDiscovery() {
  const shouldHighlightTrigger = !state.alertTriggerDiscovered && elements.alertPanel.hidden;
  elements.alertTriggerHint.hidden = !shouldHighlightTrigger;
  elements.gaugeCard.classList.toggle("is-alert-discoverable", shouldHighlightTrigger);
}

function renderAlertUi(options = {}) {
  const alertState = getAlertUiState();
  const currentLimitDisplay = getAlertLimitDisplayValue();
  const canUseCurrentSpeed = state.lastFixAt > 0
    && Math.round(convertSpeed(state.currentSpeedMs, state.unit)) >= getAlertConfig(state.unit).min;

  speedRenderer.renderAlertPresets();
  speedRenderer.renderTrapDistancePresets();

  elements.alertTriggerValue.textContent = speedRenderer.getAlertTriggerText(alertState);
  elements.alertTrigger.setAttribute("aria-label", speedRenderer.getAlertTriggerLabel(alertState));
  elements.alertPanelStatus.textContent = speedRenderer.getAlertPanelStatusText(alertState);
  elements.alertToggle.textContent = isManualAlertActive(state.alertEnabled, state.alertLimitMs) ? t("turnOff") : t("turnOn");
  elements.alertToggle.setAttribute("aria-pressed", String(isManualAlertActive(state.alertEnabled, state.alertLimitMs)));
  elements.alertUseCurrent.disabled = !canUseCurrentSpeed;
  elements.alertValue.textContent = String(currentLimitDisplay);
  elements.alertUnit.textContent = UNIT_CONFIG[state.unit].label;
  elements.alertDecrease.disabled = currentLimitDisplay <= getAlertConfig(state.unit).min;
  elements.alertIncrease.disabled = currentLimitDisplay >= getAlertConfig(state.unit).max;

  for (const button of elements.alertPresets.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.alertPreset) === currentLimitDisplay));
  }

  for (const button of elements.alertSoundButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.alertSound === "on") === state.alertSoundEnabled,
    ));
  }

  for (const button of elements.trapAlertButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapAlert === "on") === state.trapAlertEnabled,
    ));
  }

  for (const button of elements.trapDistancePresets.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(
      Math.abs(Number(button.dataset.trapDistance) - state.trapAlertDistanceM) < 1,
    ));
  }

  for (const button of elements.trapSoundButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapSound === "on") === state.trapSoundEnabled,
    ));
  }

  for (const button of elements.backgroundAudioButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.backgroundAudio === "on") === state.backgroundAudioEnabled,
    ));
  }

  elements.gaugeCard.classList.toggle("is-alert-enabled", isManualAlertActive(state.alertEnabled, state.alertLimitMs) || (state.trapAlertEnabled && trapLoader.isTrapDataReady()));
  elements.gaugeCard.classList.toggle("is-alert-near", alertState.near);
  elements.gaugeCard.classList.toggle("is-alert-over", alertState.over);
  elements.gaugeCard.classList.toggle("is-trap-active", alertState.trapActive);

  renderQuickAudioControls();
  syncAlertTriggerDiscovery();
  speedRenderer.renderSubStatus();
  audioController.syncOverspeedSound(options);
  audioController.syncTrapSound(options);
}

function setAlertEnabled(enabled, options = {}) {
  state.alertEnabled = enabled;
  if (!Number.isFinite(state.alertLimitMs) || state.alertLimitMs <= 0) {
    state.alertLimitMs = DEFAULT_ALERT_LIMIT_MS;
  }

  saveAlertEnabledPreference(enabled);
  renderAlertUi(options);
  speedRenderer.drawGauge();
}

function setAlertSoundEnabled(enabled, options = {}) {
  state.alertSoundEnabled = enabled;
  saveAlertSoundEnabledPreference(enabled);
  renderAlertUi(options);
}

function setAudioMuted(muted, { fromUserGesture = false } = {}) {
  state.audioMuted = muted;
  state.backgroundAudioRevision += 1;
  saveAudioMutedPreference(muted);

  if (muted) {
    state.backgroundAudioEnabled = false;
    saveBackgroundAudioEnabledPreference(false);
    audioController.disarmBackgroundAlertAudio();
    audioController.stopOverspeedSound();
    audioController.stopTrapSound();
  } else if (fromUserGesture) {
    audioController.handleUserGestureAudioActivation();
  }

  renderAlertUi({ fromUserGesture });
}

function setAlertLimitDisplay(value, { enable = true, fromUserGesture = false } = {}) {
  const normalizedValue = normalizeAlertDisplayValue(value, state.unit);
  state.alertLimitMs = convertDisplaySpeedToMs(normalizedValue, state.unit);
  saveAlertLimitPreference(state.alertLimitMs);

  if (enable) {
    state.alertEnabled = true;
    saveAlertEnabledPreference(true);
  }

  renderAlertUi({ fromUserGesture });
  speedRenderer.drawGauge();
}

function adjustAlertLimit(stepDirection, options = {}) {
  const { step } = getAlertConfig(state.unit);
  const currentDisplayValue = normalizeAlertDisplayValue(getAlertLimitDisplayValue(), state.unit);
  setAlertLimitDisplay(currentDisplayValue + (stepDirection * step), options);
}

function setAlertLimitToCurrentSpeed() {
  if (state.lastFixAt === 0) return;
  setAlertLimitDisplay(Math.round(convertSpeed(state.currentSpeedMs, state.unit)), { fromUserGesture: true });
}

function setTrapAlertEnabled(enabled, options = {}) {
  state.trapAlertEnabled = enabled;
  if (!Number.isFinite(state.trapAlertDistanceM) || state.trapAlertDistanceM <= 0) {
    state.trapAlertDistanceM = getTrapAlertPresets(state.distanceUnit)[Math.min(1, getTrapAlertPresets(state.distanceUnit).length - 1)]?.meters ?? 500;
  }

  if (!enabled) {
    state.lastTrapSoundedId = null;
  }

  saveTrapAlertEnabledPreference(enabled);
  if (enabled) {
    trapLoader.ensureTrapArtifactsLoaded();
  }
  renderAlertUi(options);
  speedRenderer.drawGauge();
}

function setTrapAlertDistance(distanceM, { enable = true, fromUserGesture = false } = {}) {
  state.trapAlertDistanceM = normalizeTrapAlertDistance(distanceM, state.distanceUnit);
  saveTrapAlertDistancePreference(state.trapAlertDistanceM);

  if (enable) {
    state.trapAlertEnabled = true;
    saveTrapAlertEnabledPreference(true);
    trapLoader.ensureTrapArtifactsLoaded();
  }

  state.lastTrapSoundedId = null;
  renderAlertUi({ fromUserGesture });
  speedRenderer.drawGauge();
}

function setTrapSoundEnabled(enabled, options = {}) {
  state.trapSoundEnabled = enabled;
  if (!enabled) {
    state.lastTrapSoundedId = null;
  }
  saveTrapSoundEnabledPreference(enabled);
  renderAlertUi(options);
}

function setBackgroundAudioEnabled(enabled, { fromUserGesture = false } = {}) {
  if (enabled && state.audioMuted) {
    state.audioMuted = false;
    saveAudioMutedPreference(false);
  }

  state.backgroundAudioEnabled = enabled;
  state.backgroundAudioRevision += 1;
  saveBackgroundAudioEnabledPreference(enabled);

  if (enabled) {
    if (fromUserGesture) {
      audioController.handleUserGestureAudioActivation();
    }
  } else {
    audioController.disarmBackgroundAlertAudio({ fromUserGesture });
  }

  renderAlertUi({ fromUserGesture });
}

function openAlertPanel() {
  if (elements.alertBackdrop) {
    elements.alertBackdrop.hidden = false;
  }
  elements.alertPanel.hidden = false;
  if (!state.alertTriggerDiscovered) {
    state.alertTriggerDiscovered = true;
    saveAlertTriggerDiscoveredPreference(true);
  }
  renderAlertUi();
  document.body.classList.add("alert-panel-open");
  elements.alertPanel.scrollTop = 0;
  elements.alertTrigger.setAttribute("aria-expanded", "true");
}

function closeAlertPanel() {
  document.body.classList.remove("alert-panel-open");
  if (elements.alertBackdrop) {
    elements.alertBackdrop.hidden = true;
  }
  elements.alertPanel.hidden = true;
  elements.alertTrigger.setAttribute("aria-expanded", "false");
  syncAlertTriggerDiscovery();
}

function toggleAlertPanel() {
  if (elements.alertPanel.hidden) {
    openAlertPanel();
  } else {
    closeAlertPanel();
  }
}

function setUnit(unit) {
  if (!UNIT_CONFIG[unit] || unit === state.unit) return;

  state.unit = unit;
  saveUnitPreference(unit);

  for (const button of elements.unitButtons) {
    button.setAttribute("aria-pressed", button.dataset.unit === unit ? "true" : "false");
  }

  delete elements.alertPresets.dataset.unit;
  syncReplaySessionPreferences();
  renderMetrics();
  speedRenderer.drawGauge();
}

function setDistanceUnit(unit) {
  if (!DISTANCE_UNIT_CONFIG[unit] || unit === state.distanceUnit) return;

  state.distanceUnit = unit;
  state.trapAlertDistanceM = normalizeTrapAlertDistance(state.trapAlertDistanceM, unit);
  saveDistanceUnitPreference(unit);
  saveTrapAlertDistancePreference(state.trapAlertDistanceM);

  for (const button of elements.distanceUnitButtons) {
    button.setAttribute("aria-pressed", button.dataset.distanceUnit === unit ? "true" : "false");
  }

  delete elements.trapDistancePresets.dataset.unit;
  syncReplaySessionPreferences();
  renderMetrics();
}

function clearLiveFixState({ preserveContinuity = false } = {}) {
  state.currentSpeedMs = 0;
  state.displayedSpeedMs = 0;
  state.currentAltitudeM = null;
  state.nearestTrapId = null;
  state.nearestTrapDistanceM = null;
  state.nearestTrapSpeedKph = null;
  state.recentSpeeds = [];
  state.lastFixAt = 0;
  state.lastPositionTimestamp = null;
  if (!preserveContinuity) {
    state.lastKnownLatitude = null;
    state.lastKnownLongitude = null;
    state.lastPoint = null;
    state.lastTrapSoundedId = null;
    state.lastAccuracyM = null;
    wazeController.resetWazeEmbed({ clearFrame: true });
  }
  globeController.clearGlobePosition();
  wazeController.renderWazeUi();
}

function resetTripData() {
  resetReplaySession({
    endedAtMs: Number.isFinite(state.lastPositionTimestamp)
      ? state.lastPositionTimestamp
      : Date.now(),
    recordingState: state.recordingState,
  });
  state.startTime = null;
  state.currentSpeedMs = 0;
  state.displayedSpeedMs = 0;
  state.maxSpeedMs = 0;
  state.totalDistanceM = 0;
  state.currentAltitudeM = null;
  state.maxAltitudeM = null;
  state.minAltitudeM = null;
  state.lastPoint = null;
  state.nearestTrapId = null;
  state.nearestTrapDistanceM = null;
  state.nearestTrapSpeedKph = null;
  state.lastTrapSoundedId = null;
  state.recentSpeeds = [];
  state.lastAccuracyM = null;
  state.lastFixAt = 0;
  state.lastPositionTimestamp = null;

  globeController.resetGlobe();
  hideNotice();
  closeAlertPanel();
  setStatus("requesting");
  renderMetrics();
  speedRenderer.drawGauge();
}

function stopTracking({ disarmBackgroundAudio = false } = {}) {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  clearLiveFixState();
  if (disarmBackgroundAudio) {
    audioController.suppressBackgroundAudioRuntime();
  }
  audioController.stopOverspeedSound();
  audioController.stopTrapSound();
}

function startTracking({ fromUserGesture = false } = {}) {
  if (!("geolocation" in navigator)) {
    clearLiveFixState();
    audioController.suppressBackgroundAudioRuntime();
    audioController.stopOverspeedSound();
    audioController.stopTrapSound();
    setStatus("notSupported");
    showTranslatedNotice("noticeNoGeolocation");
    renderMetrics();
    speedRenderer.drawGauge();
    return;
  }

  stopTracking();
  state.trackingStartedAt = Date.now();
  setStatus("requesting");
  renderMetrics();
  speedRenderer.drawGauge();

  if (fromUserGesture) {
    audioController.handleUserGestureAudioActivation();
  }

  state.watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handlePositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    },
  );
}

function restartTrip({ fromUserGesture = false } = {}) {
  resetTripData();
  startTracking({ fromUserGesture });
}

function handlePosition(position) {
  hideNotice();
  const normalizedTimestamp = normalizePositionTimestamp(position.timestamp);

  if (!Number.isFinite(state.startTime)) {
    state.startTime = normalizedTimestamp;
  }

  const coords = position.coords;
  const currentAccuracyM = Number.isFinite(coords.accuracy) ? coords.accuracy : null;
  state.lastKnownLatitude = coords.latitude;
  state.lastKnownLongitude = coords.longitude;
  const nextPoint = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    timestamp: normalizedTimestamp,
  };

  let speedMs = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null;

  if (state.lastPoint) {
    const elapsedSeconds = Math.max((nextPoint.timestamp - state.lastPoint.timestamp) / 1000, 0.25);
    const distanceM = haversineDistance(state.lastPoint, nextPoint);
    const fallbackSpeedMs = distanceM / elapsedSeconds;
    const plausibleDistanceM = elapsedSeconds * MAX_PLAUSIBLE_SPEED_MS;
    const movementThresholdM = getMovementThresholdM(currentAccuracyM, state.lastAccuracyM);
    const hasReportedMotion = Number.isFinite(speedMs) && speedMs >= MIN_MOVING_SPEED_MS;
    const hasMeaningfulMovement =
      distanceM >= movementThresholdM
      && fallbackSpeedMs >= MIN_MOVING_SPEED_MS;

    if (distanceM <= plausibleDistanceM && (hasReportedMotion || hasMeaningfulMovement)) {
      state.totalDistanceM += distanceM;
      if (speedMs === null) {
        speedMs = fallbackSpeedMs;
      }
      state.lastPoint = nextPoint;
    }
  } else {
    state.lastPoint = nextPoint;
  }

  if (!Number.isFinite(speedMs) || speedMs < 0) speedMs = 0;

  state.recentSpeeds.push(speedMs);
  if (state.recentSpeeds.length > SPEED_SMOOTHING_SAMPLES) {
    state.recentSpeeds.shift();
  }

  state.currentSpeedMs =
    state.recentSpeeds.reduce((sum, sample) => sum + sample, 0) / state.recentSpeeds.length;
  state.maxSpeedMs = Math.max(state.maxSpeedMs, state.currentSpeedMs);
  state.lastAccuracyM = currentAccuracyM;
  state.lastFixAt = Date.now();
  state.lastPositionTimestamp = normalizedTimestamp;

  updateNearestTrapState(coords.longitude, coords.latitude);
  globeController.syncGlobePosition(coords.longitude, coords.latitude);
  if (state.primaryView === "waze" && (!state.wazeLoaded || !elements.wazeFrame?.getAttribute("src"))) {
    wazeController.syncWazeEmbed();
  } else {
    wazeController.renderWazeUi();
  }

  if (Number.isFinite(coords.altitude)) {
    state.currentAltitudeM = coords.altitude;
    state.maxAltitudeM = state.maxAltitudeM === null
      ? coords.altitude
      : Math.max(state.maxAltitudeM, coords.altitude);
    state.minAltitudeM = state.minAltitudeM === null
      ? coords.altitude
      : Math.min(state.minAltitudeM, coords.altitude);
  }

  if (state.recordingState === "recording") {
    state.replaySession = appendReplaySample(
      state.replaySession,
      {
        timestampMs: normalizedTimestamp,
        latitude: coords.latitude,
        longitude: coords.longitude,
        speedMs: state.currentSpeedMs,
        altitudeM: Number.isFinite(coords.altitude) ? coords.altitude : null,
        accuracyM: currentAccuracyM,
        headingDeg: Number.isFinite(coords.heading) ? coords.heading : null,
        totalDistanceM: state.totalDistanceM,
      },
      {
        unit: state.unit,
        distanceUnit: state.distanceUnit,
        recordingState: state.recordingState,
      },
    );
    scheduleReplaySessionPersist();
    renderRecordingControls();
  }

  setStatus("accuracy", { accuracyM: coords.accuracy });
  renderMetrics();
  audioController.maybeRecoverSuppressedBackgroundAudio();
}

function handlePositionError(error) {
  if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) {
    stopTracking({ disarmBackgroundAudio: true });
    setStatus("blocked");
    showTranslatedNotice("noticeLocationRequired");
    renderMetrics();
    speedRenderer.drawGauge();
    return;
  }

  if (error.code === GEO_ERROR_CODE.POSITION_UNAVAILABLE) {
    clearLiveFixState({ preserveContinuity: true });
    setStatus("unavailable");
    showTranslatedNotice("noticeSignalUnavailable");
    renderMetrics();
    speedRenderer.drawGauge();
    return;
  }

  if (error.code === GEO_ERROR_CODE.TIMEOUT) {
    clearLiveFixState({ preserveContinuity: true });
    setStatus("waiting");
    showTranslatedNotice("noticeStillWaiting");
    renderMetrics();
    speedRenderer.drawGauge();
    return;
  }

  clearLiveFixState({ preserveContinuity: true });
  setStatus("error");
  showNotice(error.message || t("gpsError"));
  renderMetrics();
  speedRenderer.drawGauge();
}

function resizeCanvas() {
  analogSpeedometer.resize();
  globeController.resizeGlobe();
}

function renderFrame(now) {
  state.renderFrameId = window.requestAnimationFrame(renderFrame);

  const delta = state.currentSpeedMs - state.displayedSpeedMs;
  if (Math.abs(delta) > 0.001) {
    state.displayedSpeedMs += delta * 0.16;
  } else {
    state.displayedSpeedMs = state.currentSpeedMs;
  }

  speedRenderer.drawGauge();

  if (now - state.lastTextUpdateAt > 200) {
    renderMetrics();
    state.lastTextUpdateAt = now;
  }

  if (!state.lastFixAt && Date.now() - state.trackingStartedAt > 9000 && elements.notice.hidden) {
    showTranslatedNotice("noticeStillLookingFirstFix");
  }
}

function startRenderLoop() {
  if (state.renderFrameId !== null) return;
  state.renderFrameId = window.requestAnimationFrame(renderFrame);
}

function stopRenderLoop() {
  if (state.renderFrameId === null) return;
  window.cancelAnimationFrame(state.renderFrameId);
  state.renderFrameId = null;
}

function syncLanguage() {
  updatePageMeta();
  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }
  speedRenderer.syncLanguage({
    applyTranslations,
    renderPrimaryView,
    renderMetrics,
  });
  renderRecordingControls();
}

function bindEvents() {
  elements.langToggle?.addEventListener("click", () => {
    toggleLang();
  });
  bindMenuNavigation(elements.openReplayMenu, "/replay.html");
  bindMenuNavigation(elements.openAccelMenu, "/accel");
  bindMenuNavigation(elements.openGpsLabMenu, "/gps-rate");
  bindMenuNavigation(elements.openBoardMenu, "/");
  elements.retryGps.addEventListener("click", () => restartTrip({ fromUserGesture: true }));
  elements.resetTrip.addEventListener("click", () => restartTrip({ fromUserGesture: true }));
  elements.toggleRecording?.addEventListener("click", () => {
    toggleRecording();
  });
  elements.stopRecording?.addEventListener("click", () => {
    stopRecordingSession();
  });
  elements.alertTrigger.addEventListener("click", toggleAlertPanel);
  elements.closeAlertPanel.addEventListener("click", closeAlertPanel);
  elements.alertToggle.addEventListener("click", () => {
    if (isManualAlertActive(state.alertEnabled, state.alertLimitMs)) {
      setAlertEnabled(false, { fromUserGesture: true });
      return;
    }
    setAlertEnabled(true, { fromUserGesture: true });
  });
  elements.alertUseCurrent.addEventListener("click", setAlertLimitToCurrentSpeed);
  elements.alertDecrease.addEventListener("click", () => adjustAlertLimit(-1, { fromUserGesture: true }));
  elements.alertIncrease.addEventListener("click", () => adjustAlertLimit(1, { fromUserGesture: true }));
  elements.alertPresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-alert-preset]");
    if (!button) return;
    setAlertLimitDisplay(Number(button.dataset.alertPreset), { fromUserGesture: true });
  });

  for (const button of elements.primaryViewButtons) {
    button.addEventListener("click", () => {
      setPrimaryView(button.dataset.primaryView);
    });
  }

  elements.wazeLocationPrompt?.addEventListener("click", () => {
    window.open(wazeController.getWazePermissionUrl(), "_blank", "noopener,noreferrer");
  });

  elements.wazeRecenter?.addEventListener("click", () => {
    wazeController.syncWazeEmbed({ force: true });
  });

  elements.wazeFrame?.addEventListener("load", () => {
    state.wazeLoadPending = false;
    state.wazeLoaded = Boolean(elements.wazeFrame?.getAttribute("src"));
    wazeController.renderWazeUi();
  });

  for (const button of elements.alertSoundButtons) {
    button.addEventListener("click", () => {
      setAlertSoundEnabled(button.dataset.alertSound === "on", { fromUserGesture: true });
    });
  }

  for (const button of elements.trapAlertButtons) {
    button.addEventListener("click", () => {
      setTrapAlertEnabled(button.dataset.trapAlert === "on", { fromUserGesture: true });
    });
  }

  elements.trapDistancePresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-trap-distance]");
    if (!button) return;
    setTrapAlertDistance(Number(button.dataset.trapDistance), { fromUserGesture: true });
  });

  for (const button of elements.trapSoundButtons) {
    button.addEventListener("click", () => {
      setTrapSoundEnabled(button.dataset.trapSound === "on", { fromUserGesture: true });
    });
  }

  elements.quickAudioToggle?.addEventListener("click", () => {
    setAudioMuted(!state.audioMuted, { fromUserGesture: true });
  });

  elements.quickBackgroundAudioToggle?.addEventListener("click", () => {
    setBackgroundAudioEnabled(!state.backgroundAudioEnabled, { fromUserGesture: true });
  });

  for (const button of elements.backgroundAudioButtons) {
    button.addEventListener("click", () => {
      setBackgroundAudioEnabled(button.dataset.backgroundAudio === "on", { fromUserGesture: true });
    });
  }

  for (const button of elements.unitButtons) {
    button.addEventListener("click", () => setUnit(button.dataset.unit));
  }

  for (const button of elements.distanceUnitButtons) {
    button.addEventListener("click", () => setDistanceUnit(button.dataset.distanceUnit));
  }

  elements.globeMount?.addEventListener("pointerdown", () => {
    globeController.pauseGlobeFollow();
  }, { passive: true });

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  window.addEventListener("pageshow", () => {
    trapLoader.ensureTrapArtifactsLoaded();
    resizeCanvas();
    globeController.startGlobeSolarUpdates();
    globeController.queueGlobeSolarSync();
    if (state.watchId === null) startTracking();
    startRenderLoop();
    if (audioController.wantsBackgroundAudio()) {
      void audioController.armBackgroundAlertAudio();
    }
    audioController.syncOverspeedSound();
    audioController.syncTrapSound();
  });
  document.addEventListener("pointerdown", (event) => {
    audioController.handleUserGestureAudioActivation();
    const insideAlertUi = elements.alertPanel.contains(event.target) || elements.alertTrigger.contains(event.target);
    if (!insideAlertUi) {
      audioController.syncOverspeedSound({ fromUserGesture: true });
      audioController.syncTrapSound({ fromUserGesture: true });
    }
    if (elements.alertPanel.hidden) return;
    if (insideAlertUi) return;
    closeAlertPanel();
  });
  document.addEventListener("keydown", (event) => {
    audioController.handleUserGestureAudioActivation();
    audioController.syncOverspeedSound({ fromUserGesture: true });
    audioController.syncTrapSound({ fromUserGesture: true });
    if (event.key === "Escape") closeAlertPanel();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void persistReplaySessionNow();
      globeController.stopGlobeSolarUpdates();
      stopRenderLoop();
      audioController.syncRuntimePagePresentation();
      return;
    }

    resizeCanvas();
    trapLoader.ensureTrapArtifactsLoaded();
    globeController.startGlobeSolarUpdates();
    globeController.queueGlobeSolarSync();
    startRenderLoop();
    if (audioController.wantsBackgroundAudio()) {
      void audioController.armBackgroundAlertAudio();
    }
    audioController.syncOverspeedSound();
    audioController.syncTrapSound();
    audioController.syncRuntimePagePresentation();
  });
  document.addEventListener("i18n:change", syncLanguage);
  window.addEventListener("pagehide", () => {
    void persistReplaySessionNow();
  });
}

async function init() {
  document.body.classList.remove("alert-panel-open");
  if (loadedPreferences.changed) {
    saveBackgroundAudioEnabledPreference(false);
  }
  await hydrateReplaySession();
  await persistReplaySessionNow();
  updatePageMeta();

  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }

  for (const button of elements.primaryViewButtons) {
    button.setAttribute("aria-pressed", button.dataset.primaryView === state.primaryView ? "true" : "false");
  }

  for (const button of elements.unitButtons) {
    button.setAttribute("aria-pressed", button.dataset.unit === state.unit ? "true" : "false");
  }

  for (const button of elements.distanceUnitButtons) {
    button.setAttribute("aria-pressed", button.dataset.distanceUnit === state.distanceUnit ? "true" : "false");
  }

  for (const button of elements.trapAlertButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapAlert === "on") === state.trapAlertEnabled,
    ));
  }

  for (const button of elements.trapSoundButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.trapSound === "on") === state.trapSoundEnabled,
    ));
  }

  for (const button of elements.backgroundAudioButtons) {
    button.setAttribute("aria-pressed", String(
      (button.dataset.backgroundAudio === "on") === state.backgroundAudioEnabled,
    ));
  }

  audioController.attachRuntimeAudioEventListeners();
  audioController.installMediaSessionActionHandlers({
    setAudioMuted,
    setBackgroundAudioEnabled,
  });
  renderPrimaryView();
  renderMetrics();
  renderRecordingControls();
  globeController.initGlobe();
  resizeCanvas();
  bindEvents();
  trapLoader.loadTrapArtifacts();
  startTracking();
  startRenderLoop();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearReplayPersistTimer();
    audioController.dispose();
    globeController.stopGlobeSolarUpdates();
    globeController.clearGlobeFollowResumeTimeout();
  });
}

export const initPromise = init();
