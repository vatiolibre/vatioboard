import '../styles/speed.less';
import '../styles/cloud-sync-status.less';
import '../shared/ui/confirm-dialog.less';
import { createCleanupStack } from '../app/view-cleanup.js';
import { applyTranslations, getLang, t, toggleLang } from '../i18n.js';
import { createAnalogSpeedometer } from '../shared/analog-speedometer.js';
import { ACTIVITY_OPEN_EVENT } from '../shared/activity-state.js';
import { FOCUSED_VIEW_CHANGE_EVENT } from '../shared/focused-workspace.js';
import { initBackendAuthControllers } from '../shared/backend-auth.js';
import { initCloudSyncStatusIndicator } from '../shared/cloud-sync-status-indicator.js';
import { initFloatingTools } from '../shared/floating-tools.js';
import { navigateToAppRoute } from '../app/router.js';
import {
  markWelcomeLocationChoice,
  shouldDeferWelcomeLocationRequest,
} from '../app/welcome-consent.js';
import { showConfirmDialog } from '../shared/ui/confirm-dialog.js';
import { createPlaceResolver } from '../shared/place-resolver.js';
import {
  enrichRouteBoundaryPlaces,
  getRouteBoundaryInputSamples,
  reverseGeocodeBoundarySample,
} from '../shared/route-boundary.js';
import { applyButtonIcon } from '../shared/tools-menu.js';
import {
  createDrivingTelemetryReducerState,
  reduceDrivingTelemetryPosition,
} from '../app/services/driving-telemetry-reducer.js';
import {
  hasConfiguredUnitPreferences,
  maybeInitializeUnitsFromCountry,
} from '../shared/unit-bootstrap.js';
import '../styles/backend-auth.less';
import {
  IconReplay,
  IconRestart,
  IconSettings,
} from '../icons.js';
import {
  archiveReplaySession,
  createReplaySession,
  hasReplaySamples,
  loadActiveReplaySession,
  appendReplaySample,
  REPLAY_PERSIST_CHUNK_SIZE,
  saveActiveReplaySession,
} from '../replay/session.js';
import {
  CLOUD_SYNC_ENTITY_TYPES,
  queueCloudSyncChange,
} from '../shared/cloud-sync.js';
import {
  ensureSingleTabOwnership,
  hasSingleTabOwnership,
  releaseSingleTabOwnership,
  SINGLE_TAB_OWNERSHIP_EVENT,
} from '../shared/single-tab.js';
import {
  DEFAULT_ALERT_LIMIT_MS,
  DISTANCE_UNIT_CONFIG,
  GEO_ERROR_CODE,
  UNIT_CONFIG,
} from './constants.js';
import {
  getTrapAlertPresets,
  loadCameraApproachOptionsPreference,
  loadInitialPreferences,
  normalizeTrapAlertDistance,
  saveAlertEnabledPreference,
  saveAlertLimitPreference,
  saveAlertSoundEnabledPreference,
  saveAlertTriggerDiscoveredPreference,
  saveAudioMutedPreference,
  saveDistanceUnitPreference,
  saveTrapAlertDistancePreference,
  saveTrapAlertEnabledPreference,
  saveTrapSoundEnabledPreference,
  saveUnitPreference,
} from './preferences.js';
import {
  getAlertConfig,
  getAlertLimitDisplayValue as computeAlertLimitDisplayValue,
  getAlertUiState as buildAlertUiState,
  isManualAlertActive,
  normalizeAlertDisplayValue,
} from './alerts.js';
import { createSpeedAudioController } from './audio.js';
import { findApproachingTrapAcrossDatasets } from './camera-approach.js';
import {
  SPEED_ALERTS_ACTIVITY_ID,
  SPEED_GPS_STALE_MS,
  SPEED_RECORDING_ACTIVITY_ID,
  speedRuntime,
} from './runtime.js';
import {
  createGlobeController,
  normalizePositionTimestamp,
} from './navigation.js';
import {
  convertDisplaySpeedToMs,
  convertSpeed,
  createSpeedRenderer,
  formatGlobeTimestamp,
  tf,
} from './render.js';
import {
  formatTrapDistance,
  formatTrapSpeed,
} from './traps.js';
import { createCameraDatabase } from './camera-database.js';

type AnyRecord = Record<string, any>;

const DRIVING_AUDIO_OPPORTUNISTIC_IGNORE_SELECTOR = [
  '.player-panel',
  '#quickAudioToggle',
  '#alertToggle',
  '#drivingAudioPrompt',
  '[data-alert-sound="off"]',
  '[data-trap-alert="off"]',
  '[data-trap-sound="off"]',
].join(', ');
const SPEED_HEADING_TTL_MS = 5000;

function queryAll(root: any, selector: string): any[] {
  return root?.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : [];
}

function queryOne(root: any, selector: string): any {
  return root?.querySelector ? root.querySelector(selector) : null;
}

export function getSpeedElements(root: any): AnyRecord {
  return {
    speedApp: queryOne(root, '.speed-app'),
    speedShell: queryOne(root, '.speed-shell'),
    gaugeCard: queryOne(root, '.gauge-card'),
    langToggle: queryOne(root, '#langToggle'),
    langToggleButtons: queryAll(root, '[data-lang-toggle], #langToggle'),
    pageDescriptionMeta: root ? document.querySelector('meta[name="description"]') : null,
    toolbar: queryOne(root, '.speed-toolbar'),
    openReplayQuick: queryOne(root, '#openReplayQuick'),
    quickAlertConfig: queryOne(root, '#quickAlertConfig'),
    speedPrimaryStage: queryOne(root, '#speedPrimaryStage'),
    gaugeStage: queryOne(root, '#gaugeStage'),
    gaugeStageInner: queryOne(root, '.gauge-stage-inner'),
    alertBackdrop: queryOne(root, '#speedAlertBackdrop'),
    dialCanvas: queryOne(root, '#speedDial'),
    needleCanvas: queryOne(root, '#speedNeedle'),
    speedValue: queryOne(root, '#speedValue'),
    speedUnit: queryOne(root, '#speedUnit'),
    status: queryOne(root, '#status'),
    subStatus: queryOne(root, '#subStatus'),
    maxSpeed: queryOne(root, '#maxSpeed'),
    maxSpeedUnit: queryOne(root, '#maxSpeedUnit'),
    avgSpeed: queryOne(root, '#avgSpeed'),
    avgSpeedUnit: queryOne(root, '#avgSpeedUnit'),
    distanceValue: queryOne(root, '#distanceValue'),
    distanceUnit: queryOne(root, '#distanceUnit'),
    nearestTrapDistance: queryOne(root, '#nearestTrapDistance'),
    nearestTrapUnit: queryOne(root, '#nearestTrapUnit'),
    durationValue: queryOne(root, '#durationValue'),
    altitudeValue: queryOne(root, '#altitudeValue'),
    altitudeUnit: queryOne(root, '#altitudeUnit'),
    maxAltitude: queryOne(root, '#maxAltitude'),
    maxAltitudeUnit: queryOne(root, '#maxAltitudeUnit'),
    minAltitude: queryOne(root, '#minAltitude'),
    minAltitudeUnit: queryOne(root, '#minAltitudeUnit'),
    notice: queryOne(root, '#notice'),
    noticeText: queryOne(root, '#noticeText'),
    retryGps: queryOne(root, '#retryGps'),
    resetTrip: queryOne(root, '#resetTrip'),
    toggleRecording: queryOne(root, '#toggleRecording'),
    stopRecording: queryOne(root, '#stopRecording'),
    alertTrigger: queryOne(root, '#alertTrigger'),
    alertTriggerValue: queryOne(root, '#alertTriggerValue'),
    alertTriggerHint: queryOne(root, '#alertTriggerHint'),
    alertPanel: queryOne(root, '#speedAlertPanel'),
    alertPanelStatus: queryOne(root, '#alertPanelStatus'),
    closeAlertPanel: queryOne(root, '#closeAlertPanel'),
    alertToggle: queryOne(root, '#alertToggle'),
    alertUseCurrent: queryOne(root, '#alertUseCurrent'),
    alertDecrease: queryOne(root, '#alertDecrease'),
    alertIncrease: queryOne(root, '#alertIncrease'),
    alertValue: queryOne(root, '#alertValue'),
    alertUnit: queryOne(root, '#alertUnit'),
    alertPresets: queryOne(root, '#alertPresets'),
    alertSoundButtons: queryAll(root, '.alert-sound-btn'),
    trapAlertButtons: queryAll(root, '.trap-alert-btn'),
    trapDistancePresets: queryOne(root, '#trapDistancePresets'),
    trapSoundButtons: queryAll(root, '.trap-sound-btn'),
    cameraDatabaseStatus: queryOne(root, '#cameraDatabaseStatus'),
    openCameraMap: queryOne(root, '#openCameraMap'),
    quickAudioToggle: queryOne(root, '#quickAudioToggle'),
    drivingAudioPrompt: queryOne(root, '#drivingAudioPrompt'),
    drivingAudioPromptTitle: queryOne(root, '#drivingAudioPromptTitle'),
    drivingAudioPromptBody: queryOne(root, '#drivingAudioPromptBody'),
    drivingAudioPromptPrimary: queryOne(root, '#drivingAudioPromptPrimary'),
    drivingAudioPromptSecondary: queryOne(root, '#drivingAudioPromptSecondary'),
    unitButtons: queryAll(root, '.unit-btn'),
    distanceUnitButtons: queryAll(root, '.distance-unit-btn'),
    globeMount: queryOne(root, '#speedGlobe'),
    globeStatus: queryOne(root, '#globeStatus'),
  };
}

function createEmptySpeedElements() {
  return getSpeedElements(null);
}

const elements = createEmptySpeedElements();

const isSpaRuntime = Boolean(window.__vatioboardSpa);
let singleTabOwnershipPromise = Promise.resolve(true);
let activeSpeedRoute: any = null;
let speedRouteGeneration = 0;
let standaloneCleanup = null;
let standaloneBackendAuthInitialized = false;
let appGpsService = null;
let appDrivingTelemetryService: any = null;
let drivingTelemetryUnsubscribe: any = null;
let drivingTelemetrySampleUnsubscribe: any = null;
let appDriveRecordingService: any = null;
let driveRecordingUnsubscribe: any = null;
let standaloneTelemetrySampleSequence = 0;
let standaloneTelemetryState = createDrivingTelemetryReducerState(`standalone-${Date.now()}`);

var speedRouteLifecycle: any;

export function mountSpeedRoute(routeContext: AnyRecord = {}) {
  if (speedRouteLifecycle?.mount) return speedRouteLifecycle.mount(routeContext);
  return Promise.resolve().then(() => speedRouteLifecycle?.mount?.(routeContext));
}

export function unmountSpeedRoute() {
  if (speedRouteLifecycle?.unmount) {
    speedRouteLifecycle.unmount();
    return;
  }
  void Promise.resolve().then(() => {
    speedRouteLifecycle?.unmount?.();
  });
}

const placeResolver = createPlaceResolver({ getLanguage: getLang });

function focusElement(element) {
  if (!element || typeof element.focus !== 'function') return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function isVisibleForFocus(element) {
  return Boolean(element && element.hidden !== true && !element.closest('[hidden]'));
}

function getCloudSyncLauncherFocusTarget() {
  const menuList = window.__vatioboardStartMenu?.list;
  const candidates = [
    menuList?.querySelector('[data-backend-auth-user]'),
    menuList?.querySelector('[data-backend-auth-password]'),
    menuList?.querySelector('[data-backend-auth-login]'),
    menuList?.querySelector('[data-backend-auth-logout]'),
    menuList?.querySelector('[data-backend-auth-status]'),
  ];

  return candidates.find(isVisibleForFocus) || null;
}

function focusCloudSyncLauncherTarget(attempt = 0) {
  window.__vatioboardStartMenu?.setOpen?.(true);
  const target = getCloudSyncLauncherFocusTarget();
  if (target) {
    focusElement(target);
    if (target.matches?.('input') && typeof target.select === 'function') {
      target.select();
    }
    return;
  }

  if (attempt >= 6) return;
  Promise.resolve().then(() => {
    focusCloudSyncLauncherTarget(attempt + 1);
  });
}

function openCloudSyncLauncher() {
  Promise.resolve().then(() => {
    focusCloudSyncLauncherTarget();
  });
}

function getCurrentSpeedPosition() {
  const telemetry = appDrivingTelemetryService?.getSnapshot?.();
  if (telemetry?.lastPosition) {
    return {
      ...telemetry.lastPosition,
      speedMs: telemetry.currentSpeedMs,
      heading: telemetry.headingDeg,
      headingDeg: telemetry.headingDeg,
    };
  }
  const appGpsPosition = appGpsService?.getCurrentPosition?.();
  if (appGpsPosition) return appGpsPosition;
  if (!Number.isFinite(state.lastKnownLatitude) || !Number.isFinite(state.lastKnownLongitude)) {
    return null;
  }
  const now = Date.now();
  const headingFresh = Number.isFinite(state.lastHeadingDeg)
    && state.lastHeadingAtMs > 0
    && now - state.lastHeadingAtMs <= SPEED_HEADING_TTL_MS;
  const headingDeg = headingFresh ? state.lastHeadingDeg : null;
  return {
    latitude: state.lastKnownLatitude,
    longitude: state.lastKnownLongitude,
    accuracy: Number.isFinite(state.lastAccuracyM) ? state.lastAccuracyM : null,
    speedMs: Number.isFinite(state.currentSpeedMs) ? state.currentSpeedMs : null,
    heading: headingDeg,
    headingDeg,
    timestampMs: Number.isFinite(state.lastPositionTimestamp) ? state.lastPositionTimestamp : null,
    receivedAtMs: Number.isFinite(state.lastFixAt) ? state.lastFixAt : null,
    stale: !(state.lastFixAt > 0 && now - state.lastFixAt <= SPEED_GPS_STALE_MS),
  };
}

function dispatchSpeedPositionUpdate() {
  if (typeof window === 'undefined') return;
  const appGpsProvider = window.__vatioboardGpsGetCurrentPosition;
  if (
    window.__vatioboardSpeedGetCurrentPosition !== getCurrentSpeedPosition &&
    window.__vatioboardSpeedGetCurrentPosition !== appGpsProvider
  ) {
    return;
  }
  const detail = getCurrentSpeedPosition();
  if (!detail) return;
  window.dispatchEvent(new CustomEvent('vatioboard:speed-position', { detail }));
}

function getOrInitFloatingTools() {
  const existing = window.__vatioboardFloatingTools;
  if (existing?.shellManager) return existing;
  return initFloatingTools({
    mount: document.getElementById('app-persistent-layer') || document.body,
    gpsService: window.__vatioboardGpsStore || null,
    drivingAlertService: appDrivingAlertService || window.__vatioboardDrivingAlerts || null,
  });
}

function openCameraMapPanel() {
  navigateToAppRoute('/map');
}

function markAlertTriggerDiscovered() {
  if (state.alertTriggerDiscovered) return;
  state.alertTriggerDiscovered = true;
  saveAlertTriggerDiscoveredPreference(true);
  syncAlertTriggerDiscovery();
}

function openSpeedAlertPanel() {
  markAlertTriggerDiscovered();
  getOrInitFloatingTools()?.openSpeedAlerts?.();
}

const initialPreferences = loadInitialPreferences();
const initialReplaySession = createReplaySession({
  unit: initialPreferences.unit,
  distanceUnit: initialPreferences.distanceUnit,
  recordingState: 'stopped',
});
const ACTIVE_REPLAY_PERSIST_INTERVAL_MS = 5000;

const state: AnyRecord = {
  unit: initialPreferences.unit,
  distanceUnit: initialPreferences.distanceUnit,
  alertEnabled: initialPreferences.alertEnabled,
  alertLimitMs: initialPreferences.alertLimitMs,
  alertSoundEnabled: initialPreferences.alertSoundEnabled,
  audioMuted: initialPreferences.audioMuted,
  backgroundMode: false,
  audioPrimed: false,
  audioPrimePending: false,
  backgroundAudioArmed: false,
  backgroundAudioArmPending: false,
  backgroundAudioRevision: 0,
  backgroundAudioSuppressed: false,
  alertAudioControlActive: false,
  recordingKeepAliveIntended: false,
  recordingKeepAliveArmed: false,
  recordingKeepAlivePending: false,
  recordingKeepAliveRevision: 0,
  recordingKeepAliveSuppressed: false,
  recordingKeepAliveBlocked: false,
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
  viewMounted: false,
  initialized: false,
  watchId: null,
  startTime: null,
  trackingStartedAt: Date.now(),
  statusKind: 'requesting',
  statusParams: null,
  statusText: t('requestingGps'),
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
  trapDatasets: [],
  nearestTrapId: null,
  nearestTrapDistanceM: null,
  nearestTrapSpeedKph: null,
  nearestTrapSpeedMeta: null,
  cameraApproachState: 'none',
  cameraApproachConfidence: 'none',
  cameraApproachReason: 'no-candidate',
  cameraApproachDetails: null,
  trapLoadPending: false,
  trapLoadError: null,
  cameraDatabaseStatus: {
    status: 'idle',
    activeCountryCode: '',
    activeCountryName: '',
    cameraCount: 0,
    loadedCameraCount: 0,
    lastUpdated: null,
    cacheHit: false,
    offline: false,
    error: null,
    unavailable: false,
    updating: false,
  },
  lastTrapSoundedId: null,
  recentSpeeds: [],
  lastAccuracyM: null,
  lastFixAt: 0,
  lastPositionTimestamp: null,
  lastHeadingDeg: null,
  lastHeadingAtMs: 0,
  lastKnownLatitude: null,
  lastKnownLongitude: null,
  renderFrameId: null,
  lastTextUpdateAt: 0,
  globeMap: null,
  globeInitToken: 0,
  globeReady: false,
  globeError: null,
  globeResizeObserver: null,
  globeCenter: null,
  globeFollowPausedUntil: 0,
  globeFollowResumeTimeoutId: null,
  globeSolarUpdateIntervalId: null,
  globeSolarSyncFrameId: null,
  globeSolarGeometryDirty: false,
  runtimePageTitle: '',
  runtimeArtworkSignature: '',
  runtimeArtworkDataUrl: '',
  runtimeDynamicArtworkBlocked: false,
  runtimeMediaMetadataSignature: '',
  runtimeMediaMetadataUrgencySignature: '',
  runtimeMediaMetadataUpdatedAt: 0,
  runtimeMediaPlaybackState: '',
  recordingState: initialReplaySession.recordingState,
  replaySession: initialReplaySession,
};

function createInactiveAnalogSpeedometer() {
  return {
    destroy() {},
    render() {},
    resize() {},
  };
}

function createInactiveSpeedRenderer() {
  return {
    drawGauge() {},
    getAlertPanelStatusText: () => '',
    getAlertTriggerLabel: () => '',
    getAlertTriggerText: () => '',
    getCriticalAlertText: () => '',
    getStatusText: () => state.statusText || t('requestingGps'),
    getSubStatusText: () => state.statusText || '',
    renderAlertPresets() {},
    renderMetrics() {},
    renderSubStatus() {},
    renderTrapDistancePresets() {},
    syncLanguage() {},
  };
}

function createInactiveGlobeController() {
  return {
    clearGlobeFollowResumeTimeout() {},
    clearGlobePosition() {},
    getCurrentCoordinates: () => null,
    hasLiveCoordinateFix: () => false,
    initGlobe() {},
    pauseGlobeFollow() {},
    queueGlobeSolarSync() {},
    renderGlobeStatus() {},
    resetGlobe() {},
    resizeGlobe() {},
    startGlobeSolarUpdates() {},
    stopGlobeSolarUpdates() {},
    syncGlobePosition() {},
  };
}

function createInactiveAudioController() {
  return {
    armBackgroundAlertAudio: () => Promise.resolve(false),
    armRecordingKeepAliveAudio: () => Promise.resolve(false),
    attachRuntimeAudioEventListeners() {},
    disarmBackgroundAlertAudio() {},
    disarmRecordingKeepAliveAudio() {},
    dispose() {},
    handleUserGestureAudioActivation() {},
    installMediaSessionActionHandlers() {},
    isBackgroundAlertAudioArmed: () => false,
    isRecordingKeepAliveArmed: () => false,
    maybeRecoverRecordingKeepAliveAudio: () => false,
    maybeRecoverSuppressedBackgroundAudio() {},
    playAlertAudioEnabledSound() {},
    playStartRecordingSound() {},
    primeAlertAudio() {},
    stopOverspeedSound() {},
    stopTrapSound() {},
    suppressBackgroundAudioRuntime() {},
    suppressRecordingKeepAliveAudio() {},
    syncOverspeedSound() {},
    syncRuntimePagePresentation() {},
    syncTrapSound() {},
    wantsBackgroundAudio: () => false,
  };
}

let analogSpeedometer: any = createInactiveAnalogSpeedometer();
let speedRenderer: any = createInactiveSpeedRenderer();
let globeController: any = createInactiveGlobeController();
let audioController: any = createInactiveAudioController();
let audioControllerInitialized = false;
let cameraDatabase: any = null;
let speedRuntimeLifecycleCleanup: (() => void) | null = null;
let appDrivingAlertService: any = null;
let drivingAlertUnsubscribe: any = null;
let syncingDrivingAlertSnapshot = false;
let speedRecoveryDialogOpen = false;
let replayPersistTimerId = null;
let replayPersistChain: Promise<any> = Promise.resolve();
let replayPersistInFlight = false;
let replayPersistRequested = false;
let replayPersistScheduled = false;
let replayStartPlacePendingSessionId = '';
let replayEndPlacePendingSessionId = '';
let drivingAudioPromptActivationInFlight = false;
let drivingAudioPromptLastPointerActivationAt = 0;
let spaSpeedReadyPromise: Promise<any> | null = null;
let spaSpeedReadyResolve: any = null;

const DRIVING_AUDIO_PROMPT_POINTER_CLICK_SUPPRESS_MS = 800;

function shouldWaitForSpaSpeedRouteReady() {
  if (!isSpaRuntime) return false;
  const path = String(window.location.pathname || '/').replace(/\/+$/, '') || '/';
  return path === '/' || path === '/speed';
}

function resolveSpaSpeedRouteReady() {
  spaSpeedReadyResolve?.();
  spaSpeedReadyResolve = null;
  spaSpeedReadyPromise = null;
}

function waitForSpaSpeedRouteReady() {
  if (!shouldWaitForSpaSpeedRouteReady()) return speedInitPromise;
  if (state.initialized && state.viewMounted && activeSpeedRoute) return speedInitPromise;
  if (!spaSpeedReadyPromise) {
    spaSpeedReadyPromise = new Promise((resolve) => {
      spaSpeedReadyResolve = resolve;
    });
  }
  return spaSpeedReadyPromise.then(() => speedInitPromise);
}

function getReplayActivitySampleCount(session) {
  if (Number.isFinite(session?.sampleCount)) return Math.max(0, Math.round(session.sampleCount));
  if (Array.isArray(session?.samples)) return session.samples.length;
  return 0;
}

function getReplayActivityStartedAtMs(session) {
  const candidates = [
    session?.startedAtMs,
    session?.firstSample?.timestampMs,
    Array.isArray(session?.samples) ? session.samples[0]?.timestampMs : null,
  ];
  return candidates.find((value) => Number.isFinite(value) && value > 0) ?? null;
}

function getDrivingAlertServiceSnapshot() {
  return appDrivingAlertService?.getSnapshot?.() || null;
}

function syncSpeedRuntime({ persist = false, reason = 'sync' } = {}) {
  const trackingRetained =
    state.watchId !== null ||
    (isSpaRuntime && !state.viewMounted && state.recordingState === 'recording');
  const drivingAlertSnapshot = getDrivingAlertServiceSnapshot();
  const drivingAlertAudio = drivingAlertSnapshot?.audio || null;
  const backgroundAlertAudioArmed = drivingAlertAudio
    ? Boolean(drivingAlertAudio.backgroundAudioArmed)
    : audioController.isBackgroundAlertAudioArmed();
  const backgroundAlertAudioPending = drivingAlertAudio
    ? Boolean(drivingAlertAudio.backgroundAudioArmPending)
    : state.backgroundAudioArmPending;
  const alertSoundBlocked = drivingAlertAudio
    ? Boolean(drivingAlertAudio.alertSoundBlocked || drivingAlertAudio.blocked)
    : state.alertSoundBlocked;
  const trapSoundBlocked = drivingAlertAudio
    ? Boolean(drivingAlertAudio.trapSoundBlocked)
    : state.trapSoundBlocked;
  const recordingKeepAliveArmed = audioController.isRecordingKeepAliveArmed();

  if (
    !drivingAlertAudio &&
    state.backgroundAudioArmed &&
    !backgroundAlertAudioArmed &&
    (state.backgroundMode || state.alertAudioControlActive) &&
    !state.backgroundAudioArmPending
  ) {
    state.backgroundAudioArmed = false;
    state.backgroundAudioSuppressed = true;
  }

  if (
    state.recordingKeepAliveArmed &&
    !recordingKeepAliveArmed &&
    state.recordingKeepAliveIntended &&
    !state.recordingKeepAlivePending
  ) {
    state.recordingKeepAliveArmed = false;
    state.recordingKeepAliveSuppressed = true;
  }

  return speedRuntime.sync(
    {
      isSpaRuntime,
      viewMounted: state.viewMounted,
      recordingState: state.recordingState,
      recordingActive: state.recordingState === 'recording',
      watchActive: state.watchId !== null,
      trackingRetained,
      sampleCount: getReplayActivitySampleCount(state.replaySession),
      startedAtMs: getReplayActivityStartedAtMs(state.replaySession),
      lastFixAt: state.lastFixAt,
      lastPositionTimestamp: state.lastPositionTimestamp,
      recordingKeepAliveIntended:
        state.recordingKeepAliveIntended || state.recordingState === 'recording',
      recordingKeepAliveArmed,
      recordingKeepAlivePending: state.recordingKeepAlivePending,
      recordingKeepAliveSuppressed: state.recordingKeepAliveSuppressed,
      recordingKeepAliveBlocked: state.recordingKeepAliveBlocked,
      manualAlertActive: isManualAlertActive(state.alertEnabled, state.alertLimitMs),
      trapAlertActive: state.trapAlertEnabled,
      speedAlertAudioIntended: state.backgroundMode || state.alertAudioControlActive,
      backgroundAudioArmed: backgroundAlertAudioArmed,
      backgroundAudioArmPending: backgroundAlertAudioPending,
      backgroundAudioSuppressed: state.backgroundAudioSuppressed,
      alertSoundBlocked,
      trapSoundBlocked,
      audioMuted: state.audioMuted,
    },
    { persist, reason }
  );
}

function publishSpeedRecordingActivity(options: AnyRecord = {}) {
  syncSpeedRuntime(options);
  renderDrivingAudioPrompt();
}

function syncDrivingAlertServiceState({ fromUserGesture = false }: AnyRecord = {}) {
  const service = appDrivingAlertService || window.__vatioboardDrivingAlerts;
  if (!service || syncingDrivingAlertSnapshot) return;
  service.setUnits?.({ unit: state.unit, distanceUnit: state.distanceUnit });
  const syncOnly = { startIfNeeded: false };
  service.setManualAlertLimitMs?.(state.alertLimitMs, syncOnly);
  service.setManualAlertEnabled?.(state.alertEnabled, syncOnly);
  service.setAlertSoundEnabled?.(state.alertSoundEnabled, syncOnly);
  service.setTrapAlertDistanceM?.(state.trapAlertDistanceM, syncOnly);
  service.setTrapAlertEnabled?.(state.trapAlertEnabled, syncOnly);
  service.setTrapSoundEnabled?.(state.trapSoundEnabled, syncOnly);
  service.setMuted?.(state.audioMuted, syncOnly);
  if (state.backgroundMode || state.alertAudioControlActive) {
    service.start?.({ reason: fromUserGesture ? 'speed-user-alert-sync' : 'speed-alert-sync' });
  }
}

function applyDrivingAlertSnapshot(snapshot: AnyRecord = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  syncingDrivingAlertSnapshot = true;
  try {
    const preferences = snapshot.preferences || {};
    if (UNIT_CONFIG[preferences.unit]) state.unit = preferences.unit;
    if (DISTANCE_UNIT_CONFIG[preferences.distanceUnit]) state.distanceUnit = preferences.distanceUnit;
    if (Object.prototype.hasOwnProperty.call(preferences, 'alertEnabled')) {
      state.alertEnabled = Boolean(preferences.alertEnabled);
    }
    if (Number.isFinite(preferences.alertLimitMs)) state.alertLimitMs = preferences.alertLimitMs;
    if (Object.prototype.hasOwnProperty.call(preferences, 'alertSoundEnabled')) {
      state.alertSoundEnabled = Boolean(preferences.alertSoundEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(preferences, 'audioMuted')) {
      state.audioMuted = Boolean(preferences.audioMuted);
    }
    if (Object.prototype.hasOwnProperty.call(preferences, 'trapAlertEnabled')) {
      state.trapAlertEnabled = Boolean(preferences.trapAlertEnabled);
    }
    if (Number.isFinite(preferences.trapAlertDistanceM)) {
      state.trapAlertDistanceM = preferences.trapAlertDistanceM;
    }
    if (Object.prototype.hasOwnProperty.call(preferences, 'trapSoundEnabled')) {
      state.trapSoundEnabled = Boolean(preferences.trapSoundEnabled);
    }
    state.alertAudioControlActive = Boolean(preferences.audioControlActive);

    if (!appDrivingTelemetryService && Number.isFinite(snapshot.currentSpeedMs)) {
      state.currentSpeedMs = snapshot.currentSpeedMs;
    }
    state.nearestTrapId = snapshot.nearestTrapId ?? null;
    state.nearestTrapDistanceM = Number.isFinite(snapshot.nearestTrapDistanceM)
      ? snapshot.nearestTrapDistanceM
      : null;
    state.nearestTrapSpeedKph = Number.isFinite(snapshot.nearestTrapSpeedKph)
      ? snapshot.nearestTrapSpeedKph
      : null;
    state.nearestTrapSpeedMeta = snapshot.nearestTrapSpeedMeta || null;
    state.cameraApproachState = snapshot.cameraApproachState || 'none';
    state.cameraApproachConfidence = snapshot.cameraApproachConfidence || 'none';
    state.cameraApproachReason = snapshot.cameraApproachReason || '';
    state.cameraApproachDetails = snapshot.cameraApproachDetails || null;
    state.cameraDatabaseStatus = {
      ...state.cameraDatabaseStatus,
      ...(snapshot.cameraDatabaseStatus || {}),
    };
    state.trapLoadPending = snapshot.status === 'camera-loading';
    state.trapLoadError = snapshot.status === 'camera-unavailable'
      ? (snapshot.cameraDatabaseStatus?.error || new Error(t('trapDataUnavailable')))
      : null;
    const audio = snapshot.audio || {};
    state.overspeedAudible = Boolean(audio.overspeedAudible);
    state.trapAudible = Boolean(audio.trapAudible);
    state.alertSoundBlocked = Boolean(audio.alertSoundBlocked || (audio.blocked && !audio.trapSoundBlocked));
    state.trapSoundBlocked = Boolean(audio.trapSoundBlocked);
    state.audioPrimed = Boolean(audio.primed);
    state.audioPrimePending = Boolean(audio.pending);
    state.backgroundAudioArmed = Boolean(audio.backgroundAudioArmed);
    state.backgroundAudioArmPending = Boolean(audio.backgroundAudioArmPending);
    state.backgroundAudioSuppressed = false;
  } finally {
    syncingDrivingAlertSnapshot = false;
  }

  if (state.viewMounted) {
    renderAlertUi({ skipRouteAlertAudio: true });
    renderMetrics();
    speedRenderer.drawGauge();
    renderDrivingAudioPrompt();
  }
  publishSpeedRecordingActivity({ persist: true, reason: 'driving-alert-service' });
}

function bindDrivingAlertService(service) {
  drivingAlertUnsubscribe?.();
  drivingAlertUnsubscribe = null;
  appDrivingAlertService = service || null;
  if (!appDrivingAlertService) return;
  drivingAlertUnsubscribe = appDrivingAlertService.subscribe?.(applyDrivingAlertSnapshot) || null;
  syncDrivingAlertServiceState();
}

function applyDrivingTelemetrySnapshot(snapshot: AnyRecord = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  state.startTime = Number.isFinite(snapshot.startedAtMs) ? snapshot.startedAtMs : null;
  state.currentSpeedMs = Number.isFinite(snapshot.currentSpeedMs) ? snapshot.currentSpeedMs : 0;
  state.maxSpeedMs = Number.isFinite(snapshot.maxSpeedMs) ? snapshot.maxSpeedMs : 0;
  state.totalDistanceM = Number.isFinite(snapshot.totalDistanceM) ? snapshot.totalDistanceM : 0;
  state.currentAltitudeM = Number.isFinite(snapshot.currentAltitudeM) ? snapshot.currentAltitudeM : null;
  state.maxAltitudeM = Number.isFinite(snapshot.maxAltitudeM) ? snapshot.maxAltitudeM : null;
  state.minAltitudeM = Number.isFinite(snapshot.minAltitudeM) ? snapshot.minAltitudeM : null;
  state.lastAccuracyM = Number.isFinite(snapshot.accuracyM) ? snapshot.accuracyM : null;
  state.lastHeadingDeg = Number.isFinite(snapshot.headingDeg) ? snapshot.headingDeg : null;
  state.lastHeadingAtMs = Number.isFinite(snapshot.lastFixAtMs) ? snapshot.lastFixAtMs : 0;
  state.lastFixAt = Number.isFinite(snapshot.lastFixAtMs) ? snapshot.lastFixAtMs : 0;
  state.lastPositionTimestamp = Number.isFinite(snapshot.lastPosition?.timestampMs)
    ? snapshot.lastPosition.timestampMs
    : null;
  state.lastKnownLatitude = Number.isFinite(snapshot.lastPosition?.latitude)
    ? snapshot.lastPosition.latitude
    : null;
  state.lastKnownLongitude = Number.isFinite(snapshot.lastPosition?.longitude)
    ? snapshot.lastPosition.longitude
    : null;
  state.statusKind = snapshot.status === 'active' ? 'accuracy' : snapshot.status === 'error' ? 'error' : 'waiting';
  state.statusParams = snapshot.status === 'active' ? { accuracyM: snapshot.accuracyM } : null;

  if (state.viewMounted) {
    renderMetrics();
    renderRecordingControls();
  }
}

function handleDrivingTelemetrySample(sample: AnyRecord) {
  const snapshot = appDrivingTelemetryService?.getSnapshot?.();
  if (!snapshot?.lastPosition) return;
  const position = snapshot.lastPosition;
  const previousPoint = state.lastPoint
    ? {
      latitude: state.lastPoint.latitude,
      longitude: state.lastPoint.longitude,
      timestampMs: state.lastPoint.timestampMs ?? state.lastPoint.timestamp,
    }
    : null;
  state.lastPoint = {
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp: sample.timestampMs,
    timestampMs: sample.timestampMs,
  };
  applyDrivingTelemetrySnapshot(snapshot);
  void ensureCameraArtifactsForPoint(position.longitude, position.latitude);
  updateNearestTrapState(position.longitude, position.latitude, {
    headingDeg: sample.headingDeg,
    speedMs: sample.processedSpeedMs,
    timestampMs: sample.timestampMs,
    accuracyM: sample.accuracyM,
    previousPosition: previousPoint,
  });
  if (state.viewMounted) {
    hideNotice();
    globeController.syncGlobePosition(position.longitude, position.latitude);
    setStatus('accuracy', { accuracyM: sample.accuracyM });
    renderMetrics();
  }
  dispatchSpeedPositionUpdate();
  audioController.maybeRecoverSuppressedBackgroundAudio();
}

function bindDrivingTelemetryService(service) {
  drivingTelemetryUnsubscribe?.();
  drivingTelemetrySampleUnsubscribe?.();
  drivingTelemetryUnsubscribe = null;
  drivingTelemetrySampleUnsubscribe = null;
  appDrivingTelemetryService = service || null;
  if (!appDrivingTelemetryService) return;
  drivingTelemetryUnsubscribe = appDrivingTelemetryService.subscribe?.(applyDrivingTelemetrySnapshot) || null;
  drivingTelemetrySampleUnsubscribe = appDrivingTelemetryService.subscribeSamples?.(handleDrivingTelemetrySample) || null;
}

function applyDriveRecordingSnapshot(snapshot: AnyRecord = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  state.recordingState = snapshot.state === 'idle' ? 'stopped' : snapshot.state;
  state.recordingKeepAliveIntended = Boolean(snapshot.keepAliveIntended);
  state.recordingKeepAliveArmed = Boolean(snapshot.keepAliveArmed);
  state.recordingKeepAlivePending = Boolean(snapshot.keepAlivePending);
  state.recordingKeepAliveSuppressed = Boolean(snapshot.keepAliveSuppressed);
  state.recordingKeepAliveBlocked = Boolean(snapshot.keepAliveBlocked);
  const session = appDriveRecordingService?.getCurrentSession?.();
  if (session) state.replaySession = session;
  if (state.viewMounted) renderRecordingControls();
  publishSpeedRecordingActivity();
}

function bindDriveRecordingService(service) {
  driveRecordingUnsubscribe?.();
  driveRecordingUnsubscribe = null;
  appDriveRecordingService = service || null;
  if (!appDriveRecordingService) return;
  driveRecordingUnsubscribe = appDriveRecordingService.subscribe?.(applyDriveRecordingSnapshot) || null;
}

function hasEnabledAlertAudioFeature() {
  return (
    (isManualAlertActive(state.alertEnabled, state.alertLimitMs) && state.alertSoundEnabled) ||
    (state.trapAlertEnabled && state.trapSoundEnabled)
  );
}

function shouldActivateAlertAudioFromGesture() {
  return !state.audioMuted && hasEnabledAlertAudioFeature();
}

function wantsRecordingKeepAliveFromGesture() {
  return state.recordingState === 'recording' || state.recordingKeepAliveIntended;
}

function isRecordingGpsContinuityHealthy() {
  return (
    state.recordingState === 'recording' &&
    state.watchId !== null &&
    state.lastFixAt > 0 &&
    Date.now() - state.lastFixAt <= SPEED_GPS_STALE_MS
  );
}

function recordingKeepAliveNeedsRearm() {
  if (!state.recordingKeepAliveIntended && state.recordingState !== 'recording') return false;
  if (state.recordingKeepAlivePending) return false;
  return (
    state.recordingKeepAliveSuppressed ||
    state.recordingKeepAliveBlocked ||
    !state.recordingKeepAliveArmed ||
    !audioController.isRecordingKeepAliveArmed()
  );
}

function shouldShowRecordingKeepAlivePrompt() {
  const recovery = speedRuntime.getRecoveryState();
  if (recovery.keepAliveOnly) return true;
  return isRecordingGpsContinuityHealthy() && recordingKeepAliveNeedsRearm();
}

function shouldShowDrivingAlertsPrompt() {
  if (state.audioMuted || !hasEnabledAlertAudioFeature()) return false;

  const alertAudioIntended = state.backgroundMode || state.alertAudioControlActive;
  const drivingAlertAudio = getDrivingAlertServiceSnapshot()?.audio || null;
  const backgroundAlertAudioArmed = drivingAlertAudio
    ? Boolean(drivingAlertAudio.backgroundAudioArmed)
    : audioController.isBackgroundAlertAudioArmed();
  if (backgroundAlertAudioArmed) return false;

  const blocked = drivingAlertAudio
    ? Boolean(drivingAlertAudio.blocked)
    : (state.alertSoundBlocked || state.trapSoundBlocked);
  const missing =
    alertAudioIntended &&
    !backgroundAlertAudioArmed &&
    !(drivingAlertAudio?.backgroundAudioArmPending || state.backgroundAudioArmPending);

  return blocked || missing;
}

function renderDrivingAudioPrompt() {
  if (!state.viewMounted || !elements.drivingAudioPrompt) return;

  const showKeepAlivePrompt = shouldShowRecordingKeepAlivePrompt();
  const showAlertsPrompt = !showKeepAlivePrompt && shouldShowDrivingAlertsPrompt();

  if (!showKeepAlivePrompt && !showAlertsPrompt) {
    elements.drivingAudioPrompt.hidden = true;
    elements.drivingAudioPrompt.dataset.prompt = '';
    return;
  }

  elements.drivingAudioPrompt.hidden = false;

  if (showKeepAlivePrompt) {
    elements.drivingAudioPrompt.dataset.prompt = 'recording-keep-alive';
    elements.drivingAudioPromptTitle.textContent = t('recordingKeepAlivePromptTitle');
    elements.drivingAudioPromptBody.textContent = t('recordingKeepAlivePromptBody');
    elements.drivingAudioPromptPrimary.textContent = t('rearmKeepAliveAudio');
    elements.drivingAudioPromptSecondary.hidden = true;
    return;
  }

  elements.drivingAudioPrompt.dataset.prompt = 'driving-alerts';
  elements.drivingAudioPromptTitle.textContent = t('drivingAlertsPromptTitle');
  elements.drivingAudioPromptBody.textContent = t('drivingAlertsPromptBody');
  elements.drivingAudioPromptPrimary.textContent = t('enableDrivingAlerts');
  elements.drivingAudioPromptSecondary.textContent = t('keepAlertsOff');
  elements.drivingAudioPromptSecondary.hidden = false;
}

function armDrivingAudioFromUserGesture(
  reason = 'speed-shell-user-gesture',
  { activateAlertAudio = true } = {}
) {
  const wantsAlertAudio = activateAlertAudio && shouldActivateAlertAudioFromGesture();
  const wantsRecordingKeepAlive = wantsRecordingKeepAliveFromGesture();

  if (!wantsAlertAudio && !wantsRecordingKeepAlive) {
    return false;
  }

  if (wantsAlertAudio && !state.alertAudioControlActive) {
    state.alertAudioControlActive = true;
    state.backgroundAudioRevision += 1;
  }

  if (wantsAlertAudio && state.backgroundAudioSuppressed) {
    audioController.maybeRecoverSuppressedBackgroundAudio({ fromUserGesture: true });
  }

  audioController.handleUserGestureAudioActivation();
  if (wantsAlertAudio) {
    appDrivingAlertService?.primeAudioFromUserGesture?.();
  }

  if (wantsAlertAudio && !appDrivingAlertService) {
    audioController.syncOverspeedSound({ fromUserGesture: true });
    audioController.syncTrapSound({ fromUserGesture: true });
  }

  publishSpeedRecordingActivity({ persist: true, reason });
  return true;
}

function rearmRecordingKeepAliveFromUserGesture(reason = 'recording-keep-alive-user-rearm') {
  audioController.handleUserGestureAudioActivation();
  audioController.maybeRecoverRecordingKeepAliveAudio({ fromUserGesture: true });
  publishSpeedRecordingActivity({ persist: true, reason });
  return true;
}

function isMediaSessionSource(source = '') {
  return String(source).startsWith('media-session');
}

function handleRecordingKeepAliveLeaseLost({
  blocked = false,
  source = '',
  reason = 'recording-keep-alive-interrupted',
} = {}) {
  if (isMediaSessionSource(source)) {
    publishSpeedRecordingActivity({
      persist: true,
      reason: 'media-session-ignored-recording-keep-alive',
    });
    return false;
  }

  const retainIntent = state.recordingState === 'recording' || state.recordingKeepAliveIntended;
  if (!retainIntent) return false;

  state.recordingKeepAliveIntended = true;
  audioController.suppressRecordingKeepAliveAudio({ blocked });
  publishSpeedRecordingActivity({ persist: true, reason });
  return true;
}

function reconcileRecordingKeepAliveAfterAudioInterruption(
  reason = 'recording-keep-alive-interrupted'
) {
  if (state.recordingState !== 'recording' && !state.recordingKeepAliveIntended) {
    return false;
  }
  if (state.recordingKeepAlivePending || audioController.isRecordingKeepAliveArmed()) {
    return false;
  }

  return handleRecordingKeepAliveLeaseLost({ reason });
}

function handleRecordingMediaSessionPlay({
  fromUserGesture = true,
  reason = 'recording-keep-alive-media-session-play',
} = {}) {
  if (!wantsRecordingKeepAliveFromGesture()) return false;

  if (state.recordingState === 'recording') {
    syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
  } else {
    audioController.maybeRecoverRecordingKeepAliveAudio({ fromUserGesture });
  }
  publishSpeedRecordingActivity({ persist: true, reason });
  return true;
}

function handleSpeedMediaSessionPause({
  reason = 'speed-media-session-pause-ignored-for-keep-alive',
} = {}) {
  publishSpeedRecordingActivity({ persist: true, reason });
  return false;
}

function handleSpeedMediaSessionStop({
  reason = 'speed-media-session-stop-ignored-for-keep-alive',
} = {}) {
  publishSpeedRecordingActivity({ persist: true, reason });
  return false;
}

function shouldIgnoreOpportunisticDrivingAudioGesture(target) {
  return Boolean(target?.closest?.(DRIVING_AUDIO_OPPORTUNISTIC_IGNORE_SELECTOR));
}

function maybeArmDrivingAudioFromTrustedGesture(event) {
  if (event?.isTrusted !== true) return false;
  if (shouldIgnoreOpportunisticDrivingAudioGesture(event.target)) return false;

  const wantsAlertAudio = shouldActivateAlertAudioFromGesture();
  const wantsRecordingKeepAlive = wantsRecordingKeepAliveFromGesture();
  const drivingAlertAudio = getDrivingAlertServiceSnapshot()?.audio || null;
  const backgroundAlertAudioArmed = drivingAlertAudio
    ? Boolean(drivingAlertAudio.backgroundAudioArmed)
    : audioController.isBackgroundAlertAudioArmed();
  const backgroundAlertAudioPending = Boolean(
    drivingAlertAudio?.backgroundAudioArmPending || state.backgroundAudioArmPending
  );
  const alertAudioBlocked = drivingAlertAudio
    ? Boolean(drivingAlertAudio.blocked)
    : (state.alertSoundBlocked || state.trapSoundBlocked);
  const alertNeedsArming =
    wantsAlertAudio &&
    (
      !state.alertAudioControlActive ||
      state.backgroundAudioSuppressed ||
      alertAudioBlocked ||
      (!backgroundAlertAudioArmed && !backgroundAlertAudioPending)
    );
  const recordingNeedsArming =
    wantsRecordingKeepAlive &&
    !state.recordingKeepAlivePending &&
    (
      state.recordingKeepAliveSuppressed ||
      state.recordingKeepAliveBlocked ||
      !audioController.isRecordingKeepAliveArmed()
    );

  if (!alertNeedsArming && !recordingNeedsArming) return false;

  return armDrivingAudioFromUserGesture('speed-shell-trusted-gesture', {
    activateAlertAudio: alertNeedsArming,
  });
}

function clearReplayPersistTimer() {
  if (replayPersistTimerId !== null) {
    window.clearTimeout(replayPersistTimerId);
    replayPersistTimerId = null;
  }
}

function reconcilePersistedReplaySession(currentSession, sessionSnapshot, persistedSession) {
  if (!persistedSession) return currentSession;
  if (!currentSession || currentSession.id !== persistedSession.id) return currentSession;

  const snapshotSampleCount = Number.isFinite(sessionSnapshot?.sampleCount)
    ? Math.max(0, Math.round(sessionSnapshot.sampleCount))
    : 0;
  const currentSampleCount = Number.isFinite(currentSession.sampleCount)
    ? Math.max(0, Math.round(currentSession.sampleCount))
    : 0;
  const unsavedSampleCount = Math.max(0, currentSampleCount - snapshotSampleCount);

  if (unsavedSampleCount === 0) {
    return {
      ...persistedSession,
      unit: currentSession.unit,
      distanceUnit: currentSession.distanceUnit,
      recordingState: currentSession.recordingState,
    };
  }

  const pendingSamples = Array.isArray(currentSession.samples)
    ? currentSession.samples.slice(-unsavedSampleCount)
    : [];
  const latestPendingSample =
    pendingSamples[pendingSamples.length - 1] ?? currentSession.lastSample;

  return {
    ...persistedSession,
    unit: currentSession.unit,
    distanceUnit: currentSession.distanceUnit,
    recordingState: currentSession.recordingState,
    sampleCount: persistedSession.sampleCount + pendingSamples.length,
    persistedSampleCount: persistedSession.sampleCount,
    samples: pendingSamples,
    lastSample: latestPendingSample ?? persistedSession.lastSample,
    maxSpeedMs: Math.max(
      Number.isFinite(persistedSession.maxSpeedMs) ? persistedSession.maxSpeedMs : 0,
      Number.isFinite(currentSession.maxSpeedMs) ? currentSession.maxSpeedMs : 0
    ),
    totalDistanceM: Math.max(
      Number.isFinite(persistedSession.totalDistanceM) ? persistedSession.totalDistanceM : 0,
      Number.isFinite(currentSession.totalDistanceM) ? currentSession.totalDistanceM : 0
    ),
    minAltitudeM: Number.isFinite(currentSession.minAltitudeM)
      ? Number.isFinite(persistedSession.minAltitudeM)
        ? Math.min(persistedSession.minAltitudeM, currentSession.minAltitudeM)
        : currentSession.minAltitudeM
      : persistedSession.minAltitudeM,
    maxAltitudeM: Number.isFinite(currentSession.maxAltitudeM)
      ? Number.isFinite(persistedSession.maxAltitudeM)
        ? Math.max(persistedSession.maxAltitudeM, currentSession.maxAltitudeM)
        : currentSession.maxAltitudeM
      : persistedSession.maxAltitudeM,
    updatedAtMs:
      latestPendingSample?.timestampMs ??
      currentSession.updatedAtMs ??
      persistedSession.updatedAtMs,
    endedAtMs:
      latestPendingSample?.timestampMs ?? currentSession.endedAtMs ?? persistedSession.endedAtMs,
  };
}

function enqueueReplaySessionPersist() {
  replayPersistRequested = true;
  if (replayPersistInFlight || replayPersistScheduled) return replayPersistChain;

  replayPersistScheduled = true;
  replayPersistChain = replayPersistChain
    .catch(() => {})
    .then(async () => {
      replayPersistScheduled = false;
      replayPersistInFlight = true;

      try {
        while (replayPersistRequested) {
          replayPersistRequested = false;
          const sessionSnapshot = state.replaySession;
          const persistedSession = await saveActiveReplaySession(sessionSnapshot);
          state.replaySession = reconcilePersistedReplaySession(
            state.replaySession,
            sessionSnapshot,
            persistedSession
          );
        }

        return state.replaySession;
      } finally {
        replayPersistInFlight = false;
      }
    });
  return replayPersistChain;
}

function persistReplaySessionNow() {
  clearReplayPersistTimer();
  if (appDriveRecordingService) return appDriveRecordingService.persistNow?.() || Promise.resolve(null);
  return enqueueReplaySessionPersist();
}

function scheduleReplaySessionPersist({ immediate = false } = {}) {
  if (immediate || state.recordingState !== 'recording') {
    void persistReplaySessionNow();
    return;
  }

  if (replayPersistTimerId !== null) return;

  replayPersistTimerId = window.setTimeout(() => {
    replayPersistTimerId = null;
    void enqueueReplaySessionPersist();
  }, ACTIVE_REPLAY_PERSIST_INTERVAL_MS);
}

function syncUnitButtons() {
  for (const button of elements.unitButtons) {
    button.setAttribute('aria-pressed', button.dataset.unit === state.unit ? 'true' : 'false');
  }
}

function syncDistanceUnitButtons() {
  for (const button of elements.distanceUnitButtons) {
    button.setAttribute(
      'aria-pressed',
      button.dataset.distanceUnit === state.distanceUnit ? 'true' : 'false'
    );
  }
}

function applyUnitsConfiguration(
  { unit = state.unit, distanceUnit = state.distanceUnit } = {},
  { persist = true } = {}
) {
  let unitChanged = false;
  let distanceChanged = false;

  if (UNIT_CONFIG[unit] && unit !== state.unit) {
    state.unit = unit;
    unitChanged = true;
    if (persist) {
      saveUnitPreference(unit);
    }
    if (elements.alertPresets) delete elements.alertPresets.dataset.unit;
  }

  if (DISTANCE_UNIT_CONFIG[distanceUnit] && distanceUnit !== state.distanceUnit) {
    state.distanceUnit = distanceUnit;
    state.trapAlertDistanceM = normalizeTrapAlertDistance(state.trapAlertDistanceM, distanceUnit);
    distanceChanged = true;
    if (persist) {
      saveDistanceUnitPreference(distanceUnit);
    }
    saveTrapAlertDistancePreference(state.trapAlertDistanceM);
    if (elements.trapDistancePresets) delete elements.trapDistancePresets.dataset.unit;
  }

  if (!unitChanged && !distanceChanged) {
    return false;
  }

  syncUnitButtons();
  syncDistanceUnitButtons();
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setUnits?.({ unit: state.unit, distanceUnit: state.distanceUnit });
  }
  syncReplaySessionPreferences();
  renderMetrics();
  if (unitChanged) {
    speedRenderer.drawGauge();
  }
  return true;
}

function maybeApplyAutoConfiguredUnits(countryCode) {
  if (hasConfiguredUnitPreferences()) return false;

  const bootstrapResult = maybeInitializeUnitsFromCountry(countryCode);
  if (!bootstrapResult.changed) return false;

  return applyUnitsConfiguration(
    {
      unit: bootstrapResult.config.speedUnit,
      distanceUnit: bootstrapResult.config.distanceUnit,
    },
    {
      persist: false,
    }
  );
}


function getReplayBoundaryInputSamples(session) {
  return getRouteBoundaryInputSamples(session);
}

async function maybeResolveReplayStartPlace(sample) {
  if (!sample) return;
  if (state.replaySession.startPlace) return;
  if (replayStartPlacePendingSessionId === state.replaySession.id) return;

  const sessionId = state.replaySession.id;
  replayStartPlacePendingSessionId = sessionId;

  try {
    const result = await reverseGeocodeBoundarySample(sample, placeResolver);
    if (result?.countryCode) {
      maybeApplyAutoConfiguredUnits(result.countryCode);
    }
    if (!result?.place) return;
    if (state.replaySession.id !== sessionId) return;

    state.replaySession = {
      ...state.replaySession,
      startPlace: {
        label: result.boundaryDisplay.label,
        detail: result.boundaryDisplay.detail,
        raw: result.place,
      },
    };
    scheduleReplaySessionPersist({ immediate: true });
  } catch {
    // Ignore Nominatim/network failures and keep recording.
  } finally {
    if (replayStartPlacePendingSessionId === sessionId) {
      replayStartPlacePendingSessionId = '';
    }
  }
}

async function maybeResolveReplayEndPlace(sample) {
  if (!sample) return;
  if (state.replaySession.endPlace) return;
  if (replayEndPlacePendingSessionId === state.replaySession.id) return;

  const sessionId = state.replaySession.id;
  replayEndPlacePendingSessionId = sessionId;

  try {
    const result = await reverseGeocodeBoundarySample(sample, placeResolver);
    if (result?.countryCode) {
      maybeApplyAutoConfiguredUnits(result.countryCode);
    }
    if (!result?.place) return;
    if (state.replaySession.id !== sessionId) return;

    state.replaySession = {
      ...state.replaySession,
      endPlace: {
        label: result.boundaryDisplay.label,
        detail: result.boundaryDisplay.detail,
        raw: result.place,
      },
    };
    scheduleReplaySessionPersist({ immediate: true });
  } catch {
    // Ignore Nominatim/network failures and keep recording.
  } finally {
    if (replayEndPlacePendingSessionId === sessionId) {
      replayEndPlacePendingSessionId = '';
    }
  }
}

async function enrichReplaySessionPlaces(session) {
  if (!session) return session;

  const boundarySamples = getReplayBoundaryInputSamples(session);
  const enrichment = await enrichRouteBoundaryPlaces(boundarySamples, placeResolver, {
    mode: 'speed',
    onCountryCode: (code) => maybeApplyAutoConfiguredUnits(code),
  });

  if (!enrichment) return session;

  return {
    ...session,
    startBoundaryPoint: enrichment.startBoundaryPoint,
    endBoundaryPoint: enrichment.endBoundaryPoint,
    startPlace: enrichment.startPlace ?? session.startPlace,
    endPlace: enrichment.endPlace ?? session.endPlace,
  };
}

function archiveReplaySessionWithPlaces(session, options: AnyRecord = {}) {
  void (async () => {
    const archivedSession = await archiveReplaySession(session, options);
    if (archivedSession) {
      await queueCloudSyncChange({
        entityType: CLOUD_SYNC_ENTITY_TYPES.replaySession,
        recordId: archivedSession.id,
        recordTitle: archivedSession.startPlace?.label || archivedSession.id,
        updatedAtMs: archivedSession.updatedAtMs ?? archivedSession.endedAtMs ?? Date.now(),
        payload: archivedSession,
      });
    }
    const enrichmentSourceSession = archivedSession ?? session;
    const sessionWithPlaces = await enrichReplaySessionPlaces(enrichmentSourceSession);
    if (sessionWithPlaces !== enrichmentSourceSession) {
      const enrichedArchivedSession = await archiveReplaySession(sessionWithPlaces, options);
      if (enrichedArchivedSession) {
        await queueCloudSyncChange({
          entityType: CLOUD_SYNC_ENTITY_TYPES.replaySession,
          recordId: enrichedArchivedSession.id,
          recordTitle:
            enrichedArchivedSession.startPlace?.label || enrichedArchivedSession.id,
          updatedAtMs:
            enrichedArchivedSession.updatedAtMs
            ?? enrichedArchivedSession.endedAtMs
            ?? Date.now(),
          payload: enrichedArchivedSession,
        });
      }
    }
  })();
}

async function hydrateReplaySession() {
  const restoredReplaySession = await loadActiveReplaySession();
  if (!restoredReplaySession) return;

  state.recordingState = restoredReplaySession.recordingState;
  state.backgroundMode = false;
  state.recordingKeepAliveIntended = state.recordingState === 'recording';
  state.recordingKeepAliveArmed = false;
  state.recordingKeepAlivePending = false;
  state.recordingKeepAliveSuppressed = state.recordingKeepAliveIntended;
  state.recordingKeepAliveBlocked = false;
  state.replaySession = {
    ...restoredReplaySession,
    unit: state.unit,
    distanceUnit: state.distanceUnit,
    recordingState: restoredReplaySession.recordingState,
  };
  publishSpeedRecordingActivity();

  // Attempt to resolve missing end place after hydration
  if (
    state.replaySession.startPlace &&
    !state.replaySession.endPlace &&
    state.replaySession.lastSample
  ) {
    void maybeResolveReplayEndPlace(state.replaySession.lastSample);
  }
}

function bindMenuNavigation(element, href, cleanup) {
  if (!element) return;
  cleanup.addEventListener(element, 'click', () => {
    window.__vatioboardStartMenu?.close?.();
    navigateToAppRoute(href);
  });
}

function getTrapAlertDistanceLabel(distanceM = state.trapAlertDistanceM) {
  const formatted = formatTrapDistance(distanceM, state.distanceUnit, t('away'));
  if (formatted.value === '—') return '—';
  return `${formatted.value} ${formatted.unit}`;
}

function getConfiguredTrapAlertDistanceLabel(
  distanceM = state.trapAlertDistanceM,
  unit = state.distanceUnit
) {
  const matchingPreset = getTrapAlertPresets(unit).find(
    (preset) => Math.abs(preset.meters - distanceM) < 1
  );
  return matchingPreset?.label ?? getTrapAlertDistanceLabel(distanceM);
}

function formatCameraDatabaseDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(getLang(), { month: 'short', day: 'numeric' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatCameraDatabaseCount(value) {
  const count = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  try {
    return count.toLocaleString(getLang());
  } catch {
    return String(count);
  }
}

function renderCameraDatabaseStatus() {
  if (!elements.cameraDatabaseStatus) return;

  const cameraStatus = state.cameraDatabaseStatus || {};
  const country = cameraStatus.activeCountryName || cameraStatus.activeCountryCode?.toUpperCase?.() || '';
  const count = formatCameraDatabaseCount(cameraStatus.cameraCount);
  const date = formatCameraDatabaseDate(cameraStatus.lastUpdated);
  let text = t('cameraDatabaseWaitingGps');

  if (cameraStatus.status === 'loading' || (cameraStatus.updating && !cameraStatus.cameraCount)) {
    text = t('cameraDatabaseUpdating');
  } else if (cameraStatus.status === 'offline' && cameraStatus.cacheHit) {
    text = date
      ? tf(t, 'cameraDatabaseOfflineCachedDate', { date })
      : t('cameraDatabaseOfflineCached');
  } else if (cameraStatus.status === 'ready' || cameraStatus.status === 'stale') {
    if (country && cameraStatus.cameraCount > 0) {
      text = cameraStatus.cacheHit
        ? tf(t, 'cameraDatabaseSummaryCached', { country, count })
        : tf(t, 'cameraDatabaseSummary', { country, count });
    } else if (cameraStatus.updating) {
      text = t('cameraDatabaseUpdating');
    } else {
      text = t('cameraDatabaseUnavailableRegion');
    }
  } else if (cameraStatus.unavailable || cameraStatus.status === 'error') {
    text = t('cameraDatabaseUnavailableRegion');
  }

  elements.cameraDatabaseStatus.textContent = text;
  elements.cameraDatabaseStatus.dataset.status = cameraStatus.status || 'idle';
  elements.cameraDatabaseStatus.classList.toggle('is-offline', Boolean(cameraStatus.offline));
  elements.cameraDatabaseStatus.classList.toggle('is-updating', Boolean(cameraStatus.updating));
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
    nearestTrapSpeedMeta: state.nearestTrapSpeedMeta,
    cameraApproachState: state.cameraApproachState,
    cameraApproachConfidence: state.cameraApproachConfidence,
    cameraApproachReason: state.cameraApproachReason,
    cameraApproachDetails: state.cameraApproachDetails,
    trapAlertDistanceM: state.trapAlertDistanceM,
    convertSpeed,
    getTrapAlertDistanceLabel,
    formatTrapSpeed: (speedKph) => formatTrapSpeed(speedKph, state.unit),
  });
}

function createSpeedRouteControllers() {
  analogSpeedometer.destroy?.();
  analogSpeedometer = createAnalogSpeedometer({
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

  speedRenderer = createSpeedRenderer({
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

  if (!audioControllerInitialized) {
    audioController = createSpeedAudioController({
      state,
      t,
      getAlertUiState,
      convertSpeed,
      getConfiguredTrapAlertDistanceLabel,
      getAlertLimitDisplayValue,
      getSubStatusText: (alertState) => speedRenderer.getSubStatusText(alertState),
      getCriticalAlertText: (alertState) => speedRenderer.getCriticalAlertText(alertState),
      onStateChange: () => {
        publishSpeedRecordingActivity();
      },
    });
    audioControllerInitialized = true;
  }
}

function renderMetrics() {
  speedRenderer.renderMetrics(renderAlertUi);
}

function renderRecordingControls() {
  if (!elements.toggleRecording || !elements.stopRecording) return;

  const hasSamples = appDriveRecordingService
    ? Number(appDriveRecordingService.getSnapshot?.().sampleCount || 0) > 0
    : hasReplaySamples(state.replaySession, 1);
  const toggleLabel =
    state.recordingState === 'recording'
      ? t('pauseRecording')
      : state.recordingState === 'paused'
        ? t('resumeRecording')
        : t('startRecording');
  const toggleIcon = state.recordingState === 'recording' ? 'pause' : 'record';
  const resetLabel = t('resetTrip');
  const stopLabel = t('stopRecording');
  const replayLabel = t('driveReplay');

  elements.resetTrip?.setAttribute('aria-label', resetLabel);
  elements.resetTrip?.setAttribute('title', resetLabel);
  elements.toggleRecording.dataset.recordingIcon = toggleIcon;
  elements.toggleRecording.setAttribute('aria-label', toggleLabel);
  elements.toggleRecording.setAttribute('title', toggleLabel);
  elements.toggleRecording.setAttribute(
    'aria-pressed',
    String(state.recordingState === 'recording')
  );
  elements.openReplayQuick?.setAttribute('aria-label', replayLabel);
  elements.openReplayQuick?.setAttribute('title', replayLabel);
  elements.stopRecording.setAttribute('aria-label', stopLabel);
  elements.stopRecording.setAttribute('title', stopLabel);
  elements.stopRecording.disabled = state.recordingState === 'stopped' && !hasSamples;
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
  publishSpeedRecordingActivity({ persist: true, reason: 'replay-preferences' });
}

function resetReplaySession({
  archiveCurrent = true,
  endedAtMs = Date.now(),
  recordingState = state.recordingState,
  minSamples = 2,
} = {}) {
  if (archiveCurrent) {
    archiveReplaySessionWithPlaces(state.replaySession, { endedAtMs, minSamples });
  }

  state.recordingState = recordingState;
  replayStartPlacePendingSessionId = '';
  replayEndPlacePendingSessionId = '';
  state.replaySession = createReplaySession({
    unit: state.unit,
    distanceUnit: state.distanceUnit,
    recordingState,
  });
  scheduleReplaySessionPersist({ immediate: true });
  renderRecordingControls();
  publishSpeedRecordingActivity({ persist: true, reason: 'recording-reset' });
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
  publishSpeedRecordingActivity({ persist: true, reason: 'recording-state' });
}

function toggleRecording() {
  if (state.recordingState === 'recording') {
    pauseRecordingSession({ fromUserGesture: true });
    return;
  }

  startRecordingSession({ fromUserGesture: true });
}

function startRecordingSession({ fromUserGesture = false } = {}) {
  if (appDriveRecordingService) {
    const snapshot = appDriveRecordingService.getSnapshot?.();
    if (snapshot?.state === 'paused') appDriveRecordingService.resumeRecording?.();
    else appDriveRecordingService.startRecording?.({ source: 'speed', fromUserGesture });
    if (fromUserGesture && snapshot?.state === 'idle') audioController.playStartRecordingSound();
    applyDriveRecordingSnapshot(appDriveRecordingService.getSnapshot?.());
    syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
    return;
  }
  if (state.recordingState === 'recording') {
    syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
    return;
  }

  const shouldPlayStartCue = fromUserGesture;

  if (state.recordingState === 'stopped') {
    resetReplaySession({
      archiveCurrent: false,
      recordingState: 'recording',
    });
  } else {
    setRecordingState('recording');
  }

  syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
  if (shouldPlayStartCue) {
    audioController.playStartRecordingSound();
  }
}

function pauseRecordingSession({ fromUserGesture = false } = {}) {
  if (appDriveRecordingService) {
    appDriveRecordingService.pauseRecording?.();
    applyDriveRecordingSnapshot(appDriveRecordingService.getSnapshot?.());
    syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
    return;
  }
  if (state.recordingState !== 'recording') return;
  setRecordingState('paused');
  syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
  stopHiddenTrackingIfIdle({ disarmBackgroundAudio: true });
}

function stopRecordingSession({ fromUserGesture = false } = {}) {
  if (appDriveRecordingService) {
    void appDriveRecordingService.stopRecording?.().then?.((snapshot) => {
      applyDriveRecordingSnapshot(snapshot);
      syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
    });
    return;
  }
  resetReplaySession({
    archiveCurrent: true,
    endedAtMs: Number.isFinite(state.lastPositionTimestamp)
      ? state.lastPositionTimestamp
      : Date.now(),
    recordingState: 'stopped',
    minSamples: 1,
  });
  syncRecordingKeepAliveWithRecordingState({ fromUserGesture });
  stopHiddenTrackingIfIdle({ disarmBackgroundAudio: true });
}

function clearNearestTrapState(reason = 'no-candidate') {
  state.nearestTrapId = null;
  state.nearestTrapDistanceM = null;
  state.nearestTrapSpeedKph = null;
  state.nearestTrapSpeedMeta = null;
  state.cameraApproachState = 'none';
  state.cameraApproachConfidence = 'none';
  state.cameraApproachReason = reason;
  state.cameraApproachDetails = null;
}

function buildApproachPosition(longitude, latitude, overrides: AnyRecord = {}) {
  const previousPosition = overrides.previousPosition || (state.lastPoint
    ? {
      latitude: state.lastPoint.latitude,
      longitude: state.lastPoint.longitude,
      timestampMs: state.lastPoint.timestampMs ?? state.lastPoint.timestamp,
    }
    : null);
  return {
    latitude,
    longitude,
    headingDeg: overrides.headingDeg ?? state.lastHeadingDeg,
    speedMs: overrides.speedMs ?? state.currentSpeedMs,
    timestampMs: overrides.timestampMs ?? state.lastPositionTimestamp ?? Date.now(),
    accuracyM: overrides.accuracyM ?? state.lastAccuracyM,
    previousPosition,
  };
}

function updateNearestTrapState(longitude, latitude, options: AnyRecord = {}) {
  const datasets = Array.isArray(state.trapDatasets) ? state.trapDatasets : [];
  const candidateDatasets = datasets.length > 0
    ? datasets
    : (state.trapIndex && Array.isArray(state.trapRecords) && state.trapRecords.length > 0
      ? [{ key: 'legacy', index: state.trapIndex, traps: state.trapRecords }]
      : []);
  if (candidateDatasets.length === 0 || !state.trapAlertEnabled) {
    clearNearestTrapState(state.trapAlertEnabled ? 'no-datasets' : 'trap-alert-disabled');
    return;
  }

  const nextTrapState = findApproachingTrapAcrossDatasets(
    candidateDatasets,
    buildApproachPosition(longitude, latitude, options),
    {
      alertDistanceM: state.trapAlertDistanceM,
      ...loadCameraApproachOptionsPreference(),
    },
  );
  state.nearestTrapId = nextTrapState.nearestTrapId;
  state.nearestTrapDistanceM = nextTrapState.nearestTrapDistanceM;
  state.nearestTrapSpeedKph = nextTrapState.nearestTrapSpeedKph;
  state.nearestTrapSpeedMeta = nextTrapState.nearestTrapSpeedMeta;
  state.cameraApproachState = nextTrapState.cameraApproachState || 'none';
  state.cameraApproachConfidence = nextTrapState.cameraApproachConfidence || 'none';
  state.cameraApproachReason = nextTrapState.cameraApproachReason || '';
  state.cameraApproachDetails = nextTrapState.cameraApproachDetails || null;
}

function getCameraDatabase() {
  if (!cameraDatabase) {
    cameraDatabase = createCameraDatabase({
      onStatusChange: handleCameraDatabaseStatus,
    });
  }
  return cameraDatabase;
}

function syncTrapLoadStateFromCameraStatus(status) {
  const hasLoadedData = Array.isArray(state.trapDatasets) && state.trapDatasets.length > 0;
  state.trapLoadPending = status.status === 'loading' || (status.updating && !hasLoadedData);
  state.trapLoadError =
    status.status === 'error' && !hasLoadedData
      ? (status.error || new Error(t('trapDataUnavailable')))
      : null;
}

function handleCameraDatabaseStatus(nextStatus) {
  state.cameraDatabaseStatus = {
    ...state.cameraDatabaseStatus,
    ...nextStatus,
  };
  state.trapDatasets = getCameraDatabase().getLoadedDatasets();
  syncTrapLoadStateFromCameraStatus(state.cameraDatabaseStatus);
  if (state.lastPoint) {
    updateNearestTrapState(state.lastPoint.longitude, state.lastPoint.latitude);
  }
  if (!state.viewMounted) return;
  renderCameraDatabaseStatus();
  renderMetrics();
  speedRenderer.drawGauge();
}

function isCameraTrapDataReady() {
  return (
    Array.isArray(state.trapDatasets)
    && state.trapDatasets.length > 0
    && !state.trapLoadPending
    && !state.trapLoadError
  );
}

function ensureCameraArtifactsForPoint(longitude, latitude, countryCode = '') {
  if (!state.trapAlertEnabled) return Promise.resolve(null);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return Promise.resolve(null);

  const routeSignal = activeSpeedRoute?.signal || null;
  return getCameraDatabase()
    .loadForLocation({ longitude, latitude, countryCode }, { signal: routeSignal })
    .then((result) => {
      state.trapDatasets = getCameraDatabase().getLoadedDatasets();
      syncTrapLoadStateFromCameraStatus(result.status || getCameraDatabase().getStatus());
      if (state.lastPoint) {
        updateNearestTrapState(state.lastPoint.longitude, state.lastPoint.latitude);
      }
      if (state.viewMounted) {
        renderCameraDatabaseStatus();
        renderMetrics();
      }
      return result;
    });
}

const trapLoader = {
  ensureTrapArtifactsLoaded() {
    if (!state.trapAlertEnabled) return;
    if (state.lastPoint) {
      void ensureCameraArtifactsForPoint(state.lastPoint.longitude, state.lastPoint.latitude);
    }
  },
  isTrapDataReady() {
    return isCameraTrapDataReady();
  },
  loadTrapArtifacts() {
    if (!state.lastPoint) return Promise.resolve(null);
    return ensureCameraArtifactsForPoint(state.lastPoint.longitude, state.lastPoint.latitude);
  },
};

function updatePageMeta() {
  document.documentElement.lang = getLang();
  if (elements.pageDescriptionMeta) {
    elements.pageDescriptionMeta.setAttribute('content', t('speedPageDescription'));
  }
  audioController.syncRuntimePagePresentation();
}

function setStatus(kind, params = null) {
  state.statusKind = kind;
  state.statusParams = params;
  state.statusText = speedRenderer.getStatusText(kind, params);
  if (elements.status) elements.status.textContent = state.statusText;
  speedRenderer.renderSubStatus();
  globeController.renderGlobeStatus();
  audioController.syncRuntimePagePresentation();
}

function showNotice(message) {
  state.noticeKey = null;
  state.noticeParams = null;
  if (!elements.notice || !elements.noticeText) return;
  elements.notice.hidden = false;
  elements.noticeText.textContent = message;
}

function showTranslatedNotice(key, params = null) {
  state.noticeKey = key;
  state.noticeParams = params;
  if (!elements.notice || !elements.noticeText) return;
  elements.notice.hidden = false;
  elements.noticeText.textContent = tf(t, key, params ?? {});
}

function hideNotice() {
  state.noticeKey = null;
  state.noticeParams = null;
  if (!elements.notice) return;
  elements.notice.hidden = true;
}

function renderQuickAudioControls() {
  if (elements.quickAudioToggle) {
    elements.quickAudioToggle.setAttribute('aria-pressed', String(!state.audioMuted));
    elements.quickAudioToggle.classList.toggle('is-muted', state.audioMuted);
    const audioToggleLabel = state.audioMuted ? t('unmuteAlertAudio') : t('muteAlertAudio');
    elements.quickAudioToggle.setAttribute('aria-label', audioToggleLabel);
    elements.quickAudioToggle.title = audioToggleLabel;
  }
}

function syncAlertTriggerDiscovery() {
  if (!elements.alertTriggerHint || !elements.gaugeCard) return;
  const shouldHighlightTrigger = !state.alertTriggerDiscovered;
  elements.alertTriggerHint.hidden = !shouldHighlightTrigger;
  elements.gaugeCard.classList.toggle('is-alert-discoverable', shouldHighlightTrigger);
}

function renderAlertUi(options: AnyRecord = {}) {
  const alertState = getAlertUiState();
  const currentLimitDisplay = getAlertLimitDisplayValue();
  const canUseCurrentSpeed =
    state.lastFixAt > 0 &&
    Math.round(convertSpeed(state.currentSpeedMs, state.unit)) >= getAlertConfig(state.unit).min;

  if (elements.alertPresets) speedRenderer.renderAlertPresets();
  if (elements.trapDistancePresets) speedRenderer.renderTrapDistancePresets();

  elements.alertTriggerValue.textContent = speedRenderer.getAlertTriggerText(alertState);
  elements.alertTrigger.setAttribute('aria-label', speedRenderer.getAlertTriggerLabel(alertState));
  elements.alertTrigger.setAttribute('aria-pressed', String(alertState.enabled || state.trapAlertEnabled));
  elements.quickAlertConfig?.setAttribute('aria-pressed', String(alertState.enabled || state.trapAlertEnabled));
  elements.quickAlertConfig?.setAttribute('aria-label', speedRenderer.getAlertTriggerLabel(alertState));
  if (elements.alertPanelStatus) {
    elements.alertPanelStatus.textContent = speedRenderer.getAlertPanelStatusText(alertState);
  }
  if (elements.alertToggle) {
    elements.alertToggle.textContent = isManualAlertActive(state.alertEnabled, state.alertLimitMs)
      ? t('turnOff')
      : t('turnOn');
    elements.alertToggle.setAttribute(
      'aria-pressed',
      String(isManualAlertActive(state.alertEnabled, state.alertLimitMs))
    );
  }
  if (elements.alertUseCurrent) elements.alertUseCurrent.disabled = !canUseCurrentSpeed;
  if (elements.alertValue) elements.alertValue.textContent = String(currentLimitDisplay);
  if (elements.alertUnit) elements.alertUnit.textContent = UNIT_CONFIG[state.unit].label;
  if (elements.alertDecrease) elements.alertDecrease.disabled = currentLimitDisplay <= getAlertConfig(state.unit).min;
  if (elements.alertIncrease) elements.alertIncrease.disabled = currentLimitDisplay >= getAlertConfig(state.unit).max;

  if (elements.alertPresets) {
    for (const button of elements.alertPresets.querySelectorAll('button')) {
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.alertPreset) === currentLimitDisplay)
      );
    }
  }

  for (const button of elements.alertSoundButtons) {
    button.setAttribute(
      'aria-pressed',
      String((button.dataset.alertSound === 'on') === state.alertSoundEnabled)
    );
  }

  for (const button of elements.trapAlertButtons) {
    button.setAttribute(
      'aria-pressed',
      String((button.dataset.trapAlert === 'on') === state.trapAlertEnabled)
    );
  }

  if (elements.trapDistancePresets) {
    for (const button of elements.trapDistancePresets.querySelectorAll('button')) {
      button.setAttribute(
        'aria-pressed',
        String(Math.abs(Number(button.dataset.trapDistance) - state.trapAlertDistanceM) < 1)
      );
    }
  }

  for (const button of elements.trapSoundButtons) {
    button.setAttribute(
      'aria-pressed',
      String((button.dataset.trapSound === 'on') === state.trapSoundEnabled)
    );
  }

  elements.gaugeCard.classList.toggle(
    'is-alert-enabled',
    isManualAlertActive(state.alertEnabled, state.alertLimitMs) ||
      (state.trapAlertEnabled && trapLoader.isTrapDataReady())
  );
  elements.gaugeCard.classList.toggle('is-alert-near', alertState.near);
  elements.gaugeCard.classList.toggle('is-alert-over', alertState.over);
  elements.gaugeCard.classList.toggle('is-trap-active', alertState.trapActive);

  renderCameraDatabaseStatus();
  renderQuickAudioControls();
  syncAlertTriggerDiscovery();
  speedRenderer.renderSubStatus();
  if (!options.skipRouteAlertAudio && !appDrivingAlertService) {
    audioController.syncOverspeedSound(options);
    audioController.syncTrapSound(options);
  }
}

function setAlertEnabled(enabled, options: AnyRecord = {}) {
  state.alertEnabled = enabled;
  if (!Number.isFinite(state.alertLimitMs) || state.alertLimitMs <= 0) {
    state.alertLimitMs = DEFAULT_ALERT_LIMIT_MS;
  }

  saveAlertEnabledPreference(enabled);
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setManualAlertEnabled?.(enabled);
  }
  renderAlertUi(options);
  if (enabled && options.fromUserGesture) {
    armDrivingAudioFromUserGesture('manual-alert-toggle');
  }
  speedRenderer.drawGauge();
  publishSpeedRecordingActivity({ persist: true, reason: 'manual-alert-toggle' });
}

function setAlertSoundEnabled(enabled, options: AnyRecord = {}) {
  state.alertSoundEnabled = enabled;
  saveAlertSoundEnabledPreference(enabled);
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setAlertSoundEnabled?.(enabled);
  }
  renderAlertUi(options);
  if (enabled && options.fromUserGesture) {
    armDrivingAudioFromUserGesture('manual-alert-sound-toggle');
  }
  publishSpeedRecordingActivity({ persist: true, reason: 'manual-alert-sound-toggle' });
}

function setAudioMuted(muted, { fromUserGesture = false, reason = 'alert-audio-toggle' }: AnyRecord = {}) {
  const nextMuted = Boolean(muted);
  const wasMuted = state.audioMuted;
  const nextAlertAudioControlActive = fromUserGesture && !nextMuted
    ? true
    : nextMuted
      ? false
      : state.alertAudioControlActive;
  const alertAudioControlChanged =
    state.alertAudioControlActive !== nextAlertAudioControlActive;

  state.audioMuted = nextMuted;
  state.alertAudioControlActive = nextAlertAudioControlActive;
  if (wasMuted !== nextMuted || alertAudioControlChanged) {
    state.backgroundAudioRevision += 1;
  }
  saveAudioMutedPreference(nextMuted);
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setMuted?.(nextMuted);
  }

  if (fromUserGesture) {
    if (nextMuted && !audioController.wantsBackgroundAudio()) {
      audioController.disarmBackgroundAlertAudio({ fromUserGesture });
    } else {
      armDrivingAudioFromUserGesture(reason);
    }
    if (wasMuted && !nextMuted && hasEnabledAlertAudioFeature()) {
      audioController.playAlertAudioEnabledSound();
    }
  } else if (nextMuted && !audioController.wantsBackgroundAudio()) {
    audioController.disarmBackgroundAlertAudio({ fromUserGesture });
  }

  renderAlertUi({ fromUserGesture });
  publishSpeedRecordingActivity({ persist: true, reason });
}

function setAlertLimitDisplay(value, { enable = true, fromUserGesture = false }: AnyRecord = {}) {
  const normalizedValue = normalizeAlertDisplayValue(value, state.unit);
  state.alertLimitMs = convertDisplaySpeedToMs(normalizedValue, state.unit);
  saveAlertLimitPreference(state.alertLimitMs);
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setManualAlertLimitMs?.(state.alertLimitMs);
  }

  if (enable) {
    state.alertEnabled = true;
    saveAlertEnabledPreference(true);
    if (!syncingDrivingAlertSnapshot) {
      appDrivingAlertService?.setManualAlertEnabled?.(true);
    }
  }

  renderAlertUi({ fromUserGesture });
  if (enable && fromUserGesture) {
    armDrivingAudioFromUserGesture('manual-alert-limit');
  }
  speedRenderer.drawGauge();
  publishSpeedRecordingActivity({ persist: true, reason: 'manual-alert-limit' });
}

function adjustAlertLimit(stepDirection, options: AnyRecord = {}) {
  const { step } = getAlertConfig(state.unit);
  const currentDisplayValue = normalizeAlertDisplayValue(getAlertLimitDisplayValue(), state.unit);
  setAlertLimitDisplay(currentDisplayValue + stepDirection * step, options);
}

function setAlertLimitToCurrentSpeed() {
  if (state.lastFixAt === 0) return;
  setAlertLimitDisplay(Math.round(convertSpeed(state.currentSpeedMs, state.unit)), {
    fromUserGesture: true,
  });
}

function setTrapAlertEnabled(enabled, options: AnyRecord = {}) {
  state.trapAlertEnabled = enabled;
  if (!Number.isFinite(state.trapAlertDistanceM) || state.trapAlertDistanceM <= 0) {
    state.trapAlertDistanceM =
      getTrapAlertPresets(state.distanceUnit)[
        Math.min(1, getTrapAlertPresets(state.distanceUnit).length - 1)
      ]?.meters ?? 500;
  }

  if (!enabled) {
    state.lastTrapSoundedId = null;
    clearNearestTrapState('trap-alert-disabled');
  }

  saveTrapAlertEnabledPreference(enabled);
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setTrapAlertEnabled?.(enabled);
  }
  if (enabled) {
    trapLoader.ensureTrapArtifactsLoaded();
  }
  renderAlertUi(options);
  if (enabled && options.fromUserGesture) {
    armDrivingAudioFromUserGesture('trap-alert-toggle');
  }
  speedRenderer.drawGauge();
  publishSpeedRecordingActivity({ persist: true, reason: 'trap-alert-toggle' });
}

function setTrapAlertDistance(distanceM, { enable = true, fromUserGesture = false }: AnyRecord = {}) {
  state.trapAlertDistanceM = normalizeTrapAlertDistance(distanceM, state.distanceUnit);
  saveTrapAlertDistancePreference(state.trapAlertDistanceM);
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setTrapAlertDistanceM?.(state.trapAlertDistanceM);
  }

  if (enable) {
    state.trapAlertEnabled = true;
    saveTrapAlertEnabledPreference(true);
    if (!syncingDrivingAlertSnapshot) {
      appDrivingAlertService?.setTrapAlertEnabled?.(true);
    }
    trapLoader.ensureTrapArtifactsLoaded();
  }

  state.lastTrapSoundedId = null;
  renderAlertUi({ fromUserGesture });
  if (enable && fromUserGesture) {
    armDrivingAudioFromUserGesture('trap-alert-distance');
  }
  speedRenderer.drawGauge();
  publishSpeedRecordingActivity({ persist: true, reason: 'trap-alert-distance' });
}

function setTrapSoundEnabled(enabled, options: AnyRecord = {}) {
  state.trapSoundEnabled = enabled;
  if (!enabled) {
    state.lastTrapSoundedId = null;
  }
  saveTrapSoundEnabledPreference(enabled);
  if (!syncingDrivingAlertSnapshot) {
    appDrivingAlertService?.setTrapSoundEnabled?.(enabled);
  }
  renderAlertUi(options);
  if (enabled && options.fromUserGesture) {
    armDrivingAudioFromUserGesture('trap-alert-sound-toggle');
  }
  publishSpeedRecordingActivity({ persist: true, reason: 'trap-alert-sound-toggle' });
}

function syncRecordingKeepAliveWithRecordingState({ fromUserGesture = false }: AnyRecord = {}) {
  const recordingActive = state.recordingState === 'recording';

  if (recordingActive) {
    if (!state.recordingKeepAliveIntended) {
      state.recordingKeepAliveIntended = true;
      state.recordingKeepAliveRevision = (state.recordingKeepAliveRevision || 0) + 1;
    }
    if (fromUserGesture) {
      state.recordingKeepAliveSuppressed = false;
      state.recordingKeepAliveBlocked = false;
    }

    void audioController.armRecordingKeepAliveAudio({ fromUserGesture }).then(() => {
      publishSpeedRecordingActivity({ persist: true, reason: 'recording-keep-alive' });
    });
  } else {
    audioController.disarmRecordingKeepAliveAudio();
  }

  publishSpeedRecordingActivity({ persist: true, reason: 'recording-keep-alive-intent' });
}

function shouldKeepTrackingInBackground() {
  return isSpaRuntime && !state.viewMounted && state.recordingState === 'recording';
}

function stopHiddenTrackingIfIdle({ disarmBackgroundAudio = false }: AnyRecord = {}) {
  if (!isSpaRuntime || state.viewMounted || shouldKeepTrackingInBackground()) return;
  stopTracking({ disarmBackgroundAudio });
}

function openAlertPanel() {
  openSpeedAlertPanel();
}

function closeAlertPanel() {
  window.__vatioboardFloatingTools?.closeSpeedAlerts?.();
  syncAlertTriggerDiscovery();
}

function setUnit(unit) {
  applyUnitsConfiguration({ unit });
}

function setDistanceUnit(unit) {
  applyUnitsConfiguration({ distanceUnit: unit });
}

function clearLiveFixState({ preserveContinuity = false }: AnyRecord = {}) {
  state.currentSpeedMs = 0;
  state.displayedSpeedMs = 0;
  state.currentAltitudeM = null;
  state.nearestTrapId = null;
  state.nearestTrapDistanceM = null;
  state.nearestTrapSpeedKph = null;
  state.nearestTrapSpeedMeta = null;
  state.cameraApproachState = 'none';
  state.cameraApproachConfidence = 'none';
  state.cameraApproachReason = 'gps-reset';
  state.cameraApproachDetails = null;
  state.recentSpeeds = [];
  state.lastFixAt = 0;
  state.lastPositionTimestamp = null;
  if (!preserveContinuity) {
    state.lastKnownLatitude = null;
    state.lastKnownLongitude = null;
    state.lastPoint = null;
    state.lastTrapSoundedId = null;
    state.lastAccuracyM = null;
    state.lastHeadingDeg = null;
    state.lastHeadingAtMs = 0;
  }
  if (!appDrivingTelemetryService) {
    standaloneTelemetryState = {
      ...standaloneTelemetryState,
      currentSpeedMs: 0,
      recentSpeeds: [],
      lastFixAtMs: null,
      ...(preserveContinuity ? {} : {
        accuracyM: null,
        headingDeg: null,
        headingAtMs: 0,
        lastAcceptedPoint: null,
        lastPosition: null,
      }),
    };
  }
  globeController.clearGlobePosition();
}

function resetTripData() {
  if (appDrivingTelemetryService) {
    appDrivingTelemetryService.resetTrip?.();
  } else {
    standaloneTelemetryState = createDrivingTelemetryReducerState(`standalone-${Date.now()}`);
    resetReplaySession({
      endedAtMs: Number.isFinite(state.lastPositionTimestamp)
        ? state.lastPositionTimestamp
        : Date.now(),
      recordingState: state.recordingState,
    });
  }
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
  state.nearestTrapSpeedMeta = null;
  state.cameraApproachState = 'none';
  state.cameraApproachConfidence = 'none';
  state.cameraApproachReason = 'session-reset';
  state.cameraApproachDetails = null;
  state.lastTrapSoundedId = null;
  state.recentSpeeds = [];
  state.lastAccuracyM = null;
  state.lastFixAt = 0;
  state.lastPositionTimestamp = null;
  state.lastHeadingDeg = null;
  state.lastHeadingAtMs = 0;

  globeController.resetGlobe();
  hideNotice();
  setStatus('requesting');
  renderMetrics();
  speedRenderer.drawGauge();
}

function stopTracking({ disarmBackgroundAudio = false }: AnyRecord = {}) {
  if (state.watchId !== null && state.watchId !== 'telemetry') {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  if (!appDrivingTelemetryService) clearLiveFixState();
  if (disarmBackgroundAudio) {
    audioController.suppressRecordingKeepAliveAudio();
    audioController.suppressBackgroundAudioRuntime();
  }
  audioController.stopOverspeedSound();
  audioController.stopTrapSound();
  publishSpeedRecordingActivity();
}

function startTracking({ fromUserGesture = false }: AnyRecord = {}) {
  if (isSpaRuntime && !state.viewMounted) return;
  if (fromUserGesture) markWelcomeLocationChoice('enabled');

  if (appDrivingTelemetryService) {
    state.trackingStartedAt = Date.now();
    state.watchId = 'telemetry';
    appDrivingTelemetryService.start?.({ reason: fromUserGesture ? 'speed-route-user' : 'speed-route' });
    applyDrivingTelemetrySnapshot(appDrivingTelemetryService.getSnapshot?.());
    if (fromUserGesture) audioController.handleUserGestureAudioActivation();
    publishSpeedRecordingActivity();
    return;
  }

  if (!('geolocation' in navigator)) {
    clearLiveFixState();
    audioController.suppressRecordingKeepAliveAudio({ blocked: true });
    audioController.suppressBackgroundAudioRuntime();
    audioController.stopOverspeedSound();
    audioController.stopTrapSound();
    setStatus('notSupported');
    showTranslatedNotice('noticeNoGeolocation');
    renderMetrics();
    speedRenderer.drawGauge();
    publishSpeedRecordingActivity();
    return;
  }

  stopTracking();
  state.trackingStartedAt = Date.now();
  setStatus('requesting');
  renderMetrics();
  speedRenderer.drawGauge();

  if (fromUserGesture) {
    audioController.handleUserGestureAudioActivation();
  }

  state.watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 10000,
  });
  publishSpeedRecordingActivity();
}

function deferTrackingUntilLocationGesture() {
  if (!isSpaRuntime || !shouldDeferWelcomeLocationRequest()) return false;
  if (state.watchId !== null) return false;

  clearLiveFixState();
  audioController.suppressRecordingKeepAliveAudio();
  audioController.suppressBackgroundAudioRuntime();
  audioController.stopOverspeedSound();
  audioController.stopTrapSound();
  setStatus('waiting');
  showTranslatedNotice('allowLocationAccess');
  renderMetrics();
  speedRenderer.drawGauge();
  publishSpeedRecordingActivity();
  return true;
}

function startTrackingIfAllowed({ fromUserGesture = false }: AnyRecord = {}) {
  if (!fromUserGesture && deferTrackingUntilLocationGesture()) return;
  startTracking({ fromUserGesture });
}

function restartTrip({ fromUserGesture = false }: AnyRecord = {}) {
  resetTripData();
  startTrackingIfAllowed({ fromUserGesture });
}

function handlePosition(position) {
  const shouldRender = state.viewMounted === true;
  if (shouldRender) hideNotice();
  const normalizedTimestamp = normalizePositionTimestamp(position.timestamp);
  const coords = position.coords;
  const receivedAtMs = Date.now();
  const previousPoint = standaloneTelemetryState.lastAcceptedPoint;
  const reduction = reduceDrivingTelemetryPosition(standaloneTelemetryState, {
    sampleSequence: ++standaloneTelemetrySampleSequence,
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    altitudeM: Number.isFinite(coords.altitude) ? coords.altitude : null,
    altitudeAccuracyM: Number.isFinite(coords.altitudeAccuracy) ? coords.altitudeAccuracy : null,
    speedMs: Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null,
    heading: Number.isFinite(coords.heading) ? coords.heading : null,
    headingDeg: Number.isFinite(coords.heading) ? coords.heading : null,
    fixTimestampMs: Number.isFinite(position.timestamp) ? position.timestamp : null,
    timestampMs: normalizedTimestamp,
    receivedAtMs,
    stale: false,
  });
  if (!reduction.sample) return;
  standaloneTelemetryState = reduction.state;
  const sample = reduction.sample;
  state.startTime = standaloneTelemetryState.startedAtMs;
  state.currentSpeedMs = standaloneTelemetryState.currentSpeedMs;
  state.maxSpeedMs = standaloneTelemetryState.maxSpeedMs;
  state.totalDistanceM = standaloneTelemetryState.totalDistanceM;
  state.currentAltitudeM = standaloneTelemetryState.currentAltitudeM;
  state.maxAltitudeM = standaloneTelemetryState.maxAltitudeM;
  state.minAltitudeM = standaloneTelemetryState.minAltitudeM;
  state.lastPoint = standaloneTelemetryState.lastAcceptedPoint;
  state.recentSpeeds = standaloneTelemetryState.recentSpeeds;
  state.lastAccuracyM = standaloneTelemetryState.accuracyM;
  state.lastFixAt = standaloneTelemetryState.lastFixAtMs;
  state.lastPositionTimestamp = normalizedTimestamp;
  state.lastKnownLatitude = coords.latitude;
  state.lastKnownLongitude = coords.longitude;
  state.lastHeadingDeg = standaloneTelemetryState.headingDeg;
  state.lastHeadingAtMs = standaloneTelemetryState.headingAtMs;
  const currentAccuracyM = sample.accuracyM;
  const freshSampleHeadingDeg = sample.headingDeg;

  void ensureCameraArtifactsForPoint(coords.longitude, coords.latitude);
  updateNearestTrapState(coords.longitude, coords.latitude, {
    headingDeg: freshSampleHeadingDeg,
    speedMs: state.currentSpeedMs,
    timestampMs: normalizedTimestamp,
    accuracyM: currentAccuracyM,
    previousPosition: previousPoint,
  });
  if (shouldRender) {
    globeController.syncGlobePosition(coords.longitude, coords.latitude);
  }

  if (state.recordingState === 'recording' && !appDriveRecordingService) {
    state.replaySession = appendReplaySample(
      state.replaySession,
      {
        timestampMs: normalizedTimestamp,
        latitude: coords.latitude,
        longitude: coords.longitude,
        speedMs: state.currentSpeedMs,
        altitudeM: Number.isFinite(coords.altitude) ? coords.altitude : null,
        accuracyM: currentAccuracyM,
        headingDeg: freshSampleHeadingDeg,
        totalDistanceM: state.totalDistanceM,
      },
      {
        unit: state.unit,
        distanceUnit: state.distanceUnit,
        recordingState: state.recordingState,
      }
    );
    void maybeResolveReplayStartPlace(
      state.replaySession.firstSample ??
        state.replaySession.samples[0] ??
        state.replaySession.lastSample
    );
    if (state.replaySession.samples.length >= REPLAY_PERSIST_CHUNK_SIZE) {
      scheduleReplaySessionPersist({ immediate: true });
    } else {
      scheduleReplaySessionPersist();
    }
    if (shouldRender) renderRecordingControls();
    publishSpeedRecordingActivity();
  }

  if (shouldRender) {
    setStatus('accuracy', { accuracyM: coords.accuracy });
    renderMetrics();
  } else {
    state.statusKind = 'accuracy';
    state.statusParams = { accuracyM: coords.accuracy };
  }
  dispatchSpeedPositionUpdate();
  audioController.maybeRecoverSuppressedBackgroundAudio();
}

function handlePositionError(error) {
  const shouldRender = state.viewMounted === true;
  if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) {
    stopTracking({ disarmBackgroundAudio: true });
    if (!shouldRender) return;
    setStatus('blocked');
    showTranslatedNotice('noticeLocationRequired');
    renderMetrics();
    speedRenderer.drawGauge();
    return;
  }

  if (error.code === GEO_ERROR_CODE.POSITION_UNAVAILABLE) {
    clearLiveFixState({ preserveContinuity: true });
    if (!shouldRender) return;
    setStatus('unavailable');
    showTranslatedNotice('noticeSignalUnavailable');
    renderMetrics();
    speedRenderer.drawGauge();
    return;
  }

  if (error.code === GEO_ERROR_CODE.TIMEOUT) {
    clearLiveFixState({ preserveContinuity: true });
    if (!shouldRender) return;
    setStatus('waiting');
    showTranslatedNotice('noticeStillWaiting');
    renderMetrics();
    speedRenderer.drawGauge();
    return;
  }

  clearLiveFixState({ preserveContinuity: true });
  if (!shouldRender) return;
  setStatus('error');
  showNotice(error.message || t('gpsError'));
  renderMetrics();
  speedRenderer.drawGauge();
}

function resizeCanvas() {
  analogSpeedometer.resize();
  globeController.resizeGlobe();
}

function isGlobeSurfaceVisible() {
  const panel = elements.globeMount?.closest?.('[data-vb-focused-view-panel]');
  if (!elements.globeMount || panel?.hidden) return false;
  const rect = elements.globeMount.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function ensureVisibleGlobe() {
  if (!isGlobeSurfaceVisible()) return;
  globeController.initGlobe();
  queueMicrotask(() => globeController.resizeGlobe());
}

function renderFrame(now) {
  if (isSpaRuntime && !state.viewMounted) {
    state.renderFrameId = null;
    return;
  }

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
    showTranslatedNotice('noticeStillLookingFirstFix');
  }
}

function startRenderLoop() {
  if (isSpaRuntime && !state.viewMounted) return;
  if (state.renderFrameId !== null) return;
  state.renderFrameId = window.requestAnimationFrame(renderFrame);
}

function stopRenderLoop() {
  if (state.renderFrameId === null) return;
  window.cancelAnimationFrame(state.renderFrameId);
  state.renderFrameId = null;
}

function handleSingleTabOwnershipChange(event) {
  if (event?.detail?.owned !== false) return;

  void persistReplaySessionNow();
  if (state.recordingState === 'recording' && event?.detail?.reason === 'released') {
    speedRuntime.persistIntent('single-tab-released-recording-retained');
    stopRenderLoop();
    globeController.stopGlobeSolarUpdates();
    audioController.syncRuntimePagePresentation();
    return;
  }

  stopTracking({ disarmBackgroundAudio: true });
  stopRenderLoop();
  globeController.stopGlobeSolarUpdates();
  audioController.disarmBackgroundAlertAudio();
  audioController.syncRuntimePagePresentation();
}

function resumeVisibleRuntime() {
  if (isSpaRuntime && !state.viewMounted) return false;

  if (!hasSingleTabOwnership()) {
    audioController.syncRuntimePagePresentation();
    return false;
  }

  resizeCanvas();
  trapLoader.ensureTrapArtifactsLoaded();
  globeController.startGlobeSolarUpdates();
  globeController.queueGlobeSolarSync();
  startRenderLoop();
  if (audioController.wantsBackgroundAudio()) {
    void audioController.armBackgroundAlertAudio();
  }
  if (state.recordingState === 'recording') {
    reconcileRecordingKeepAliveAfterAudioInterruption(
      'recording-keep-alive-visible-return'
    );
    audioController.maybeRecoverRecordingKeepAliveAudio();
  }
  audioController.syncOverspeedSound();
  audioController.syncTrapSound();
  audioController.syncRuntimePagePresentation();
  return true;
}

function getRecoveryConfirmLabel(recovery) {
  if (recovery?.recording && recovery?.alerts) return t('speedRecoveryResumeAndRearm');
  if (recovery?.alerts) return t('speedRecoveryRearmAlerts');
  return t('speedRecoveryResumeRecording');
}

function getRecoveryMessage(recovery) {
  if (recovery?.recording && recovery?.alerts) {
    return t('speedRecoveryRecordingAndAlertsMessage');
  }
  if (recovery?.alerts) return t('speedRecoveryAlertsMessage');
  return t('speedRecoveryRecordingMessage');
}

function restartGpsSubscriptionForRecovery({ fromUserGesture = false }: AnyRecord = {}) {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  startTracking({ fromUserGesture });
}

function resumeRecordingFromRecovery(recovery) {
  if (state.recordingState !== 'recording') {
    startRecordingSession({ fromUserGesture: true });
  } else {
    syncRecordingKeepAliveWithRecordingState({ fromUserGesture: true });
  }

  audioController.maybeRecoverRecordingKeepAliveAudio({ fromUserGesture: true });

  if (
    recovery?.watchInactive ||
    recovery?.gpsStale ||
    recovery?.sampleCountStalled ||
    state.watchId === null
  ) {
    restartGpsSubscriptionForRecovery({ fromUserGesture: true });
  }

  renderRecordingControls();
  publishSpeedRecordingActivity({ persist: true, reason: 'recovery-recording' });
}

function rearmAlertsFromRecovery() {
  armDrivingAudioFromUserGesture('recovery-alert-audio');
}

function showSpeedRecoveryDialog(recovery = speedRuntime.getRecoveryState()) {
  if (!state.viewMounted || speedRecoveryDialogOpen || !recovery?.needed || !recovery.recording) {
    return;
  }

  speedRecoveryDialogOpen = true;
  void showConfirmDialog({
    title: t('speedRecoveryTitle'),
    message: getRecoveryMessage(recovery),
    description: t('speedRecoveryBackgroundLimit'),
    confirmLabel: getRecoveryConfirmLabel(recovery),
    cancelLabel: t('notNow'),
    onConfirm: () => {
      if (recovery.recording) {
        resumeRecordingFromRecovery(recovery);
      }
      if (recovery.alerts) {
        rearmAlertsFromRecovery();
      }
      speedRuntime.clearRecoveryNeeded();
    },
  }).then((confirmed) => {
    speedRecoveryDialogOpen = false;
    if (confirmed) return;
    speedRuntime.dismissRecoveryPrompt();
  });
}

function handleSpeedRuntimeRecoveryNeeded(recovery) {
  if (!state.viewMounted) return;
  if (recovery?.recording) {
    showSpeedRecoveryDialog(recovery);
    return;
  }
  renderDrivingAudioPrompt();
}

function handleActivityOpen(event) {
  const activityId = event?.detail?.activity?.id;
  if (activityId !== SPEED_ALERTS_ACTIVITY_ID && activityId !== SPEED_RECORDING_ACTIVITY_ID) return;
  if (state.viewMounted && activityId === SPEED_ALERTS_ACTIVITY_ID) {
    openAlertPanel();
  }
  const recovery = speedRuntime.getRecoveryState();
  if (recovery.needed && recovery.recording) {
    showSpeedRecoveryDialog(recovery);
  } else {
    renderDrivingAudioPrompt();
  }
}

function enableDrivingAlertsFromPrompt(reason = 'driving-alerts-user-arm') {
  setAudioMuted(false, {
    fromUserGesture: true,
    reason,
  });
}

function keepDrivingAlertsOffFromPrompt() {
  setAudioMuted(true, {
    fromUserGesture: true,
    reason: 'driving-alerts-user-disable',
  });
  state.alertAudioControlActive = false;
  audioController.disarmBackgroundAlertAudio({ fromUserGesture: true });
  publishSpeedRecordingActivity({
    persist: true,
    reason: 'driving-alerts-user-disable',
  });
}

function handleDrivingAudioPromptPrimary(reason = 'driving-audio-prompt-primary') {
  if (elements.drivingAudioPrompt?.dataset.prompt === 'recording-keep-alive') {
    rearmRecordingKeepAliveFromUserGesture(reason);
    return;
  }

  enableDrivingAlertsFromPrompt(reason);
}

function isPrimaryDrivingAudioPointerActivation(event) {
  if (!event) return true;
  if (event.button !== undefined && event.button !== 0) return false;
  if (event.isPrimary === false) return false;
  return true;
}

function shouldSuppressDrivingAudioPromptClickAfterPointer(event) {
  if (event?.type !== 'click') return false;
  if (!drivingAudioPromptLastPointerActivationAt) return false;
  return Date.now() - drivingAudioPromptLastPointerActivationAt <
    DRIVING_AUDIO_PROMPT_POINTER_CLICK_SUPPRESS_MS;
}

function runDrivingAudioPromptPrimaryFromTrustedGesture(
  event,
  reason = 'driving-audio-prompt-primary'
) {
  if (event && event.isTrusted === false) return false;
  if (event?.type === 'pointerdown' && !isPrimaryDrivingAudioPointerActivation(event)) {
    return false;
  }

  event?.preventDefault?.();

  if (shouldSuppressDrivingAudioPromptClickAfterPointer(event)) {
    return true;
  }

  if (drivingAudioPromptActivationInFlight) return true;
  drivingAudioPromptActivationInFlight = true;
  if (event?.type === 'pointerdown') {
    drivingAudioPromptLastPointerActivationAt = Date.now();
  }

  try {
    handleDrivingAudioPromptPrimary(reason);
  } finally {
    window.setTimeout(() => {
      drivingAudioPromptActivationInFlight = false;
    }, 0);
  }

  return true;
}

function handleDrivingAudioPromptPrimaryKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  runDrivingAudioPromptPrimaryFromTrustedGesture(event, 'driving-audio-prompt-keydown');
}

function handleDrivingAudioPromptSecondary() {
  keepDrivingAlertsOffFromPrompt();
}

function recheckSpeedRouteRecovery({
  reason = 'speed-remount-recheck',
  scheduleRecoveryCheck = true,
}: AnyRecord = {}) {
  if (state.recordingState === 'recording') {
    audioController.maybeRecoverRecordingKeepAliveAudio({ fromUserGesture: false });
  }

  publishSpeedRecordingActivity({ persist: true, reason });

  const recovery = speedRuntime.getRecoveryState();
  if (recovery.needed) {
    handleSpeedRuntimeRecoveryNeeded(recovery);
  }

  if (scheduleRecoveryCheck) {
    speedRuntime.handleAppReturn();
  }
}

function syncMountedSpeedRouteUi() {
  if (!state.viewMounted) return;

  renderMetrics();
  renderRecordingControls();
  speedRenderer.drawGauge();
  ensureVisibleGlobe();
  resizeCanvas();
}

function applySpeedIcons() {
  applyButtonIcon(elements.openReplayQuick, IconReplay);
  applyButtonIcon(elements.quickAlertConfig, IconSettings);
  applyButtonIcon(elements.resetTrip, IconRestart);
}

function destroySpeedRouteResources(route = activeSpeedRoute) {
  if (!route || route.destroyed) return;
  route.destroyed = true;
  route.syncIndicator?.destroy?.();
  drivingAlertUnsubscribe?.();
  drivingAlertUnsubscribe = null;
  drivingTelemetryUnsubscribe?.();
  drivingTelemetrySampleUnsubscribe?.();
  driveRecordingUnsubscribe?.();
  drivingTelemetryUnsubscribe = null;
  drivingTelemetrySampleUnsubscribe = null;
  driveRecordingUnsubscribe = null;
  cameraDatabase?.abortPending?.();
  analogSpeedometer.destroy?.();
  state.globeInitToken += 1;
  globeController.stopGlobeSolarUpdates();
  globeController.clearGlobeFollowResumeTimeout();
  state.globeResizeObserver?.disconnect?.();
  state.globeResizeObserver = null;
  state.globeMap?.remove?.();
  state.globeMap = null;
  state.globeReady = false;
  state.globeError = null;
  analogSpeedometer = createInactiveAnalogSpeedometer();
  speedRenderer = createInactiveSpeedRenderer();
  globeController = createInactiveGlobeController();
  if (window.__vatioboardSpeedGetCurrentPosition === getCurrentSpeedPosition) {
    if (appGpsService && window.__vatioboardGpsGetCurrentPosition) {
      window.__vatioboardSpeedGetCurrentPosition = window.__vatioboardGpsGetCurrentPosition;
    } else {
      delete window.__vatioboardSpeedGetCurrentPosition;
    }
  }

  if (activeSpeedRoute === route) {
    activeSpeedRoute = null;
  }
}

function mountSpeedController(routeContext: AnyRecord = {}) {
  if (routeContext.signal?.aborted) return Promise.resolve();
  unmountSpeedController();
  appGpsService = routeContext.gpsService || window.__vatioboardGpsStore || appGpsService;
  bindDrivingTelemetryService(routeContext.drivingTelemetryService || window.__vatioboardDrivingTelemetry || appDrivingTelemetryService);
  bindDriveRecordingService(routeContext.driveRecordingService || window.__vatioboardDriveRecording || appDriveRecordingService);
  bindDrivingAlertService(routeContext.drivingAlertService || window.__vatioboardDrivingAlerts || appDrivingAlertService);
  const ownsCleanup = !routeContext.cleanup;
  const cleanup = routeContext.cleanup || createCleanupStack();
  const route: any = {
    cleanup,
    destroyed: false,
    generation: speedRouteGeneration + 1,
    ownsCleanup,
    signal: routeContext.signal || null,
  };
  speedRouteGeneration = route.generation;
  activeSpeedRoute = route;
  Object.assign(elements, getSpeedElements(routeContext.root || document));
  window.__vatioboardSpeedGetCurrentPosition = !appDrivingTelemetryService && appGpsService && window.__vatioboardGpsGetCurrentPosition
    ? window.__vatioboardGpsGetCurrentPosition
    : getCurrentSpeedPosition;
  createSpeedRouteControllers();
  route.syncIndicator = initCloudSyncStatusIndicator({
    mount: elements.toolbar,
    openLauncher: openCloudSyncLauncher,
  });
  cleanup.add(() => {
    destroySpeedRouteResources(route);
  });

  if (!isSpaRuntime && !standaloneBackendAuthInitialized) {
    standaloneBackendAuthInitialized = true;
    initBackendAuthControllers();
  }

  applyTranslations();
  applySpeedIcons();
  bindEvents({ cleanup, signal: route.signal });
  state.viewMounted = true;
  if (!state.initialized) return startSpeedInit();

  syncMountedSpeedRouteUi();
  if (state.watchId === null) startTrackingIfAllowed();
  resumeVisibleRuntime();
  recheckSpeedRouteRecovery();
  resolveSpaSpeedRouteReady();
  return Promise.resolve();
}

function unmountSpeedController() {
  if (!state.viewMounted && !activeSpeedRoute) return;

  const route = activeSpeedRoute;
  const keepTrackingInBackground = Boolean(appDrivingTelemetryService) || state.recordingState === 'recording';
  state.viewMounted = false;
  speedRouteGeneration += 1;
  void persistReplaySessionNow();
  speedRuntime.persistIntent('route-unmount');
  if (!keepTrackingInBackground) {
    stopTracking();
  }
  stopRenderLoop();
  globeController.stopGlobeSolarUpdates();
  globeController.clearGlobeFollowResumeTimeout();
  if (!keepTrackingInBackground) {
    audioController.stopOverspeedSound();
    audioController.stopTrapSound();
  }
  audioController.syncRuntimePagePresentation();
  destroySpeedRouteResources(route);
  if (route?.ownsCleanup) {
    route.cleanup?.run?.();
  }
}

function syncLanguage() {
  updatePageMeta();
  elements.langToggleButtons.forEach((button) => {
    button.textContent = getLang().toUpperCase();
  });
  speedRenderer.syncLanguage({
    applyTranslations,
    renderMetrics,
  });
  renderCameraDatabaseStatus();
  renderRecordingControls();
  renderDrivingAudioPrompt();
}

function bindEvents({ cleanup, signal }: AnyRecord = {}) {
  if (!cleanup) return;
  if (signal?.aborted) return;

  const drivingAudioGestureTarget = elements.speedApp || elements.speedShell;
  cleanup.addEventListener(
    drivingAudioGestureTarget,
    'pointerdown',
    maybeArmDrivingAudioFromTrustedGesture,
    { capture: true, passive: true }
  );
  cleanup.addEventListener(
    drivingAudioGestureTarget,
    'keydown',
    maybeArmDrivingAudioFromTrustedGesture,
    { capture: true }
  );

  elements.langToggleButtons.forEach((button) => {
    cleanup.addEventListener(button, 'click', () => {
      toggleLang();
    });
  });
  bindMenuNavigation(elements.openReplayQuick, '/replay', cleanup);
  cleanup.addEventListener(elements.retryGps, 'click', () => restartTrip({ fromUserGesture: true }));
  cleanup.addEventListener(elements.resetTrip, 'click', () => restartTrip({ fromUserGesture: true }));
  cleanup.addEventListener(elements.toggleRecording, 'click', () => {
    toggleRecording();
  });
  cleanup.addEventListener(elements.stopRecording, 'click', () => {
    stopRecordingSession({ fromUserGesture: true });
  });
  cleanup.addEventListener(elements.quickAlertConfig, 'click', openSpeedAlertPanel);
  cleanup.addEventListener(elements.alertTrigger, 'click', openSpeedAlertPanel);
  cleanup.addEventListener(elements.closeAlertPanel, 'click', closeAlertPanel);
  cleanup.addEventListener(elements.alertToggle, 'click', () => {
    if (isManualAlertActive(state.alertEnabled, state.alertLimitMs)) {
      setAlertEnabled(false, { fromUserGesture: true });
      return;
    }
    setAlertEnabled(true, { fromUserGesture: true });
  });
  cleanup.addEventListener(elements.alertUseCurrent, 'click', setAlertLimitToCurrentSpeed);
  cleanup.addEventListener(elements.alertDecrease, 'click', () =>
    adjustAlertLimit(-1, { fromUserGesture: true })
  );
  cleanup.addEventListener(elements.alertIncrease, 'click', () =>
    adjustAlertLimit(1, { fromUserGesture: true })
  );
  cleanup.addEventListener(elements.alertPresets, 'click', (event) => {
    const button = event.target.closest('button[data-alert-preset]');
    if (!button) return;
    setAlertLimitDisplay(Number(button.dataset.alertPreset), { fromUserGesture: true });
  });

  for (const button of elements.alertSoundButtons) {
    cleanup.addEventListener(button, 'click', () => {
      setAlertSoundEnabled(button.dataset.alertSound === 'on', { fromUserGesture: true });
    });
  }

  for (const button of elements.trapAlertButtons) {
    cleanup.addEventListener(button, 'click', () => {
      setTrapAlertEnabled(button.dataset.trapAlert === 'on', { fromUserGesture: true });
    });
  }

  cleanup.addEventListener(elements.trapDistancePresets, 'click', (event) => {
    const button = event.target.closest('button[data-trap-distance]');
    if (!button) return;
    setTrapAlertDistance(Number(button.dataset.trapDistance), { fromUserGesture: true });
  });

  cleanup.addEventListener(elements.openCameraMap, 'click', openCameraMapPanel);

  for (const button of elements.trapSoundButtons) {
    cleanup.addEventListener(button, 'click', () => {
      setTrapSoundEnabled(button.dataset.trapSound === 'on', { fromUserGesture: true });
    });
  }

  cleanup.addEventListener(elements.quickAudioToggle, 'click', () => {
    setAudioMuted(!state.audioMuted, { fromUserGesture: true });
  });
  cleanup.addEventListener(
    elements.drivingAudioPromptPrimary,
    'pointerdown',
    (event) => runDrivingAudioPromptPrimaryFromTrustedGesture(
      event,
      'driving-audio-prompt-pointerdown'
    ),
    { capture: true }
  );
  cleanup.addEventListener(
    elements.drivingAudioPromptPrimary,
    'keydown',
    handleDrivingAudioPromptPrimaryKeydown
  );
  cleanup.addEventListener(
    elements.drivingAudioPromptPrimary,
    'click',
    (event) => runDrivingAudioPromptPrimaryFromTrustedGesture(
      event,
      'driving-audio-prompt-click'
    )
  );
  cleanup.addEventListener(elements.drivingAudioPromptSecondary, 'click', handleDrivingAudioPromptSecondary);

  for (const button of elements.unitButtons) {
    cleanup.addEventListener(button, 'click', () => setUnit(button.dataset.unit));
  }

  for (const button of elements.distanceUnitButtons) {
    cleanup.addEventListener(button, 'click', () => setDistanceUnit(button.dataset.distanceUnit));
  }

  cleanup.addEventListener(
    elements.globeMount,
    'pointerdown',
    () => {
      globeController.pauseGlobeFollow();
    },
    { passive: true }
  );

  cleanup.addEventListener(elements.speedApp, FOCUSED_VIEW_CHANGE_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.activeView === 'globe' || detail.focused === false) ensureVisibleGlobe();
    if (detail.activeView === 'gauge' || detail.focused === false) analogSpeedometer.resize();
  });

  cleanup.addEventListener(window, 'resize', resizeCanvas, { passive: true });
  cleanup.addEventListener(window, 'orientationchange', resizeCanvas, { passive: true });
  cleanup.addEventListener(window, 'pageshow', async () => {
    if (!isSpaRuntime && !(await ensureSingleTabOwnership())) {
      return;
    }
    if (state.watchId === null) startTrackingIfAllowed();
    resumeVisibleRuntime();
    recheckSpeedRouteRecovery({ reason: 'pageshow-recheck' });
  });
  cleanup.addEventListener(document, 'visibilitychange', () => {
    if (document.hidden) {
      void persistReplaySessionNow();
      speedRuntime.persistIntent('visibility-hidden-route');
      globeController.stopGlobeSolarUpdates();
      stopRenderLoop();
      audioController.syncRuntimePagePresentation();
      return;
    }

    resumeVisibleRuntime();
    recheckSpeedRouteRecovery({ reason: 'visibility-visible-recheck' });
  });
  cleanup.addEventListener(document, 'i18n:change', syncLanguage);
  cleanup.addEventListener(window, 'pagehide', () => {
    void persistReplaySessionNow();
    speedRuntime.persistIntent('pagehide-route');
  });
  cleanup.addEventListener(window, 'beforeunload', () => {
    speedRuntime.persistIntent('beforeunload-route');
  });
  cleanup.addEventListener(window, ACTIVITY_OPEN_EVENT, handleActivityOpen);
  cleanup.addEventListener(window, SINGLE_TAB_OWNERSHIP_EVENT, handleSingleTabOwnershipChange);
}

async function init() {
  if (!(await singleTabOwnershipPromise)) {
    return;
  }

  if (!appDriveRecordingService) await hydrateReplaySession();
  await persistReplaySessionNow();
  updatePageMeta();

  elements.langToggleButtons.forEach((button) => {
    button.textContent = getLang().toUpperCase();
  });

  for (const button of elements.unitButtons) {
    button.setAttribute('aria-pressed', button.dataset.unit === state.unit ? 'true' : 'false');
  }

  for (const button of elements.distanceUnitButtons) {
    button.setAttribute(
      'aria-pressed',
      button.dataset.distanceUnit === state.distanceUnit ? 'true' : 'false'
    );
  }

  for (const button of elements.trapAlertButtons) {
    button.setAttribute(
      'aria-pressed',
      String((button.dataset.trapAlert === 'on') === state.trapAlertEnabled)
    );
  }

  for (const button of elements.trapSoundButtons) {
    button.setAttribute(
      'aria-pressed',
      String((button.dataset.trapSound === 'on') === state.trapSoundEnabled)
    );
  }

  audioController.attachRuntimeAudioEventListeners();
  audioController.installMediaSessionActionHandlers({
    handleRecordingMediaSessionPlay,
    handleSpeedMediaSessionPause,
    handleSpeedMediaSessionStop,
  });
  speedRuntimeLifecycleCleanup = speedRuntime.installLifecycleListeners({
    recoveryHandler: handleSpeedRuntimeRecoveryNeeded,
    persistHandler: () => {
      void persistReplaySessionNow();
    },
  });
  state.initialized = true;
  if (state.viewMounted) {
    syncMountedSpeedRouteUi();
    startTrackingIfAllowed();
    startRenderLoop();
    speedRuntime.handleAppReturn();
    resolveSpaSpeedRouteReady();
  }
}

let speedInitPromise = Promise.resolve();

function startSpeedInit() {
  singleTabOwnershipPromise = isSpaRuntime ? Promise.resolve(true) : ensureSingleTabOwnership();
  speedInitPromise = init();
  return speedInitPromise;
}

speedRouteLifecycle = {
  mount: mountSpeedController,
  unmount: unmountSpeedController,
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    releaseSingleTabOwnership();
    clearReplayPersistTimer();
    speedRuntimeLifecycleCleanup?.();
    speedRuntimeLifecycleCleanup = null;
    audioController.dispose();
    globeController.stopGlobeSolarUpdates();
    globeController.clearGlobeFollowResumeTimeout();
  });
}

export function __testMaybeArmDrivingAudioFromTrustedGesture(event) {
  return maybeArmDrivingAudioFromTrustedGesture(event);
}

export function __testRunDrivingAudioPromptPrimaryFromTrustedGesture(
  event,
  reason = 'driving-audio-prompt-test'
) {
  return runDrivingAudioPromptPrimaryFromTrustedGesture(event, reason);
}

export function __testGetSpeedStateSnapshot() {
  return {
    recordingState: state.recordingState,
    recordingKeepAliveIntended: state.recordingKeepAliveIntended,
    recordingKeepAliveArmed: state.recordingKeepAliveArmed,
    recordingKeepAlivePending: state.recordingKeepAlivePending,
    recordingKeepAliveSuppressed: state.recordingKeepAliveSuppressed,
    recordingKeepAliveBlocked: state.recordingKeepAliveBlocked,
    backgroundAudioArmed: state.backgroundAudioArmed,
    backgroundAudioSuppressed: state.backgroundAudioSuppressed,
    alertAudioControlActive: state.alertAudioControlActive,
    watchId: state.watchId,
    sampleCount: getReplayActivitySampleCount(state.replaySession),
    replaySessionId: state.replaySession?.id ?? '',
  };
}

function ensureStandaloneSpeedMounted() {
  if (!isSpaRuntime && !activeSpeedRoute) {
    standaloneCleanup?.run();
    mountSpeedRoute({
      root: document,
      signal: null,
    });
    standaloneCleanup = activeSpeedRoute?.cleanup || null;
  }
  return speedInitPromise;
}

export const initPromise = {
  then(onFulfilled, onRejected) {
    return (isSpaRuntime ? waitForSpaSpeedRouteReady() : ensureStandaloneSpeedMounted())
      .then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return (isSpaRuntime ? waitForSpaSpeedRouteReady() : ensureStandaloneSpeedMounted())
      .catch(onRejected);
  },
  finally(onFinally) {
    return (isSpaRuntime ? waitForSpaSpeedRouteReady() : ensureStandaloneSpeedMounted())
      .finally(onFinally);
  },
};
