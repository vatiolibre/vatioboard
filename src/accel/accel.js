import 'maplibre-gl/dist/maplibre-gl.css';
import '@stanko/dual-range-input/dist/index.css';
import '../styles/accel.less';
import '../styles/cloud-sync-status.less';
import '../styles/backend-auth.less';
import Chart from 'chart.js/auto';
import DualRangeInput from '@stanko/dual-range-input';
import {
  applyTranslations as applySharedTranslations,
  getLang,
  t as sharedT,
  toggleLang,
} from '../i18n.js';
import { getCurrentAppRouteQuery, navigateToAppRoute, ROUTE_VISIBLE_EVENT } from '../app/router.js';
import { clearActivity, setActivity } from '../shared/activity-state.js';
import { initBackendAuthControllers } from '../shared/backend-auth.js';
import { createAnalogSpeedometer } from '../shared/analog-speedometer.js';
import { initCloudSyncStatusIndicator } from '../shared/cloud-sync-status-indicator.js';
import {
  CLOUD_SYNC_APPLIED_EVENT,
  CLOUD_SYNC_ENTITY_TYPES,
  queueCloudSyncChange,
  queueCloudSyncDeletion,
  startCloudSyncLoop,
} from '../shared/cloud-sync.js';
import { createPlaceResolver } from '../shared/place-resolver.js';
import {
  getRouteBoundarySamples,
  reverseGeocodeBoundarySample,
} from '../shared/route-boundary.js';
import {
  clearAccelRestoreFailure,
  ensureAccelTelemetry,
  getAccelSelection,
} from '../shared/repositories/accel-repository.js';
import { formatRouteString } from '../shared/route-string.js';
import { hasStoredValue } from '../shared/storage.js';
import { applyButtonIcon, getActiveToolsMenuList, initToolsMenu } from '../shared/tools-menu.js';
import { integratePlayerWidget } from '../player/integrate-player-widget.js';
import {
  hasConfiguredUnitPreferences,
  markUnitBootstrapManualSelection,
  maybeInitializeUnitsFromCountry,
} from '../shared/unit-bootstrap.js';
import { ensureSingleTabOwnership, SINGLE_TAB_OWNERSHIP_EVENT } from '../shared/single-tab.js';
import {
  IconBoard,
  IconClose,
  IconDistance,
  IconPages,
  IconPause,
  IconPlay,
  IconReplay,
  IconRestart,
  IconSettings,
  IconSpeed,
  IconTime,
  IconWorld,
} from '../icons.js';
import {
  FINISH_SOUND_URL,
  GEO_ERROR_CODE,
  GEO_OPTIONS,
  MAX_RUNS,
  MPH_TO_MS,
  READY_SAMPLE_AGE_MS,
  RECENT_INTERVAL_WINDOW,
  RESULT_GRAPH_HEIGHT,
  SPARSE_INTERVAL_MS,
  STORAGE_KEYS,
  STALE_INTERVAL_MS,
  TIMER_TICK_MS,
  normalizeDistanceUnit,
  normalizeSpeedUnit,
} from './constants.js';
import { createAccelFormatters } from './formatters.js';
import { createAccelHistoryHelpers } from './history.js';
import {
  appendRunSampleLog,
  appendSpeedTracePoint,
  averageFinite,
  buildCurrentRunQuality,
  buildLiveQuality,
  buildResult,
  buildSlopeAnalysis,
  clamp,
  compactSpeedTrace,
  createLiveSample,
  createRunState,
  ensureSpeedTraceStarted,
  interpolateMeasurement,
  interpolateRangeCrossing,
  interpolateSpeedCrossing,
  interpolateValue,
  isFiniteNumber,
  resolveClockDeltaMs,
  seedRunPartialStarts,
  toFiniteNumber,
  updateRunPartials,
} from './logic.js';
import {
  buildComparisonSignature,
  buildRunPartials,
  copyPreset,
  getAvailablePresetDefinitions as listAvailablePresetDefinitions,
  getPresetSignature,
  getSelectedPreset as resolveSelectedPreset,
  presetKeyFromId,
  resolvePresetIdForUnits,
} from './presets.js';
import {
  buildAccelReplayMarkers,
  buildAccelReplaySource,
  getAccelReplayFrameAtDistanceM,
  getAccelReplayFrameAtElapsedMs,
} from './replay.js';
import { createAccelReplayMapController } from './replay-map.js';
import { createAccelReplayChartsController } from './replay-charts.js';
import { createAccelResultGraph } from './result-graph.js';
import {
  createDefaultSettings,
  isAccelPayloadComplete,
  loadRuns,
  loadSettings,
  saveRuns as persistRuns,
  saveSettings as persistSettings,
} from './storage.js';

const ACCEL_ACTIVITY_ID = 'accel.run';

let accelRouteLifecycle = {
  mount() {},
  unmount() {},
};

export function mountAccelRoute() {
  accelRouteLifecycle.mount();
}

export function unmountAccelRoute() {
  accelRouteLifecycle.unmount();
}

export const initPromise = (function () {
  const isSpaRuntime = Boolean(window.__vatioboardSpa);
  if (!isSpaRuntime) initBackendAuthControllers();
  const singleTabOwnershipPromise = isSpaRuntime ? Promise.resolve(true) : ensureSingleTabOwnership();

  var finishAudio = typeof Audio === 'function' ? new Audio(FINISH_SOUND_URL) : null;
  var finishAudioPrimePromise = null;
  var finishAudioPrimed = false;

  if (finishAudio) {
    finishAudio.preload = 'auto';
    finishAudio.loop = false;
  }

  function getAccelElements() {
    return {
    langToggle: document.getElementById('langToggle'),
    langToggleButtons: Array.from(document.querySelectorAll('[data-lang-toggle], #langToggle')),
    pageDescriptionMeta: document.querySelector('meta[name="description"]'),
    toolbar: document.querySelector('.accel-toolbar'),
    toolsMenuBtn: document.getElementById('accelToolsMenuBtn'),
    toolsMenuList: document.getElementById('accelToolsMenuList'),
    openSpeedMenu: document.getElementById('openAccelSpeedMenu'),
    openLibraryMenu: document.getElementById('openAccelLibraryMenu'),
    openBoardMenu: document.getElementById('openAccelBoardMenu'),
    sheetBackdrop: document.getElementById('accelSheetBackdrop'),
    setupTrigger: document.getElementById('setupTrigger'),
    setupTriggerValue: document.getElementById('setupTriggerValue'),
    setupTriggerMeta: document.getElementById('setupTriggerMeta'),
    resultsTrigger: document.getElementById('resultsTrigger'),
    resultsTriggerValue: document.getElementById('resultsTriggerValue'),
    resultsTriggerMeta: document.getElementById('resultsTriggerMeta'),
    toolbarSetup: document.getElementById('accelToolbarSetup'),
    toolbarResults: document.getElementById('accelToolbarResults'),
    toolbarPermissionValue: document.getElementById('toolbarPermissionValue'),
    toolbarQualityValue: document.getElementById('toolbarQualityValue'),
    toolbarStateValue: document.getElementById('toolbarStateValue'),
    setupPanel: document.getElementById('setupPanel'),
    closeSetupPanel: document.getElementById('closeSetupPanel'),
    setupPanelStatus: document.getElementById('setupPanelStatus'),
    resultsPanel: document.getElementById('resultsPanel'),
    closeResultsPanel: document.getElementById('closeResultsPanel'),
    resultsPanelStatus: document.getElementById('resultsPanelStatus'),
    permissionValue: document.getElementById('permissionValue'),
    gpsReadyValue: document.getElementById('gpsReadyValue'),
    latestAccuracyValue: document.getElementById('latestAccuracyValue'),
    observedHzValue: document.getElementById('observedHzValue'),
    statusSpeedValue: document.getElementById('statusSpeedValue'),
    statusHeadingValue: document.getElementById('statusHeadingValue'),
    statusAltitudeValue: document.getElementById('statusAltitudeValue'),
    speedSourceValue: document.getElementById('speedSourceValue'),
    presetGrid: document.getElementById('presetGrid'),
    customRangePanel: document.getElementById('customRangePanel'),
    customStartInput: document.getElementById('customStartInput'),
    customEndInput: document.getElementById('customEndInput'),
    speedUnitMph: document.getElementById('speedUnitMph'),
    speedUnitKmh: document.getElementById('speedUnitKmh'),
    distanceUnitFt: document.getElementById('distanceUnitFt'),
    distanceUnitM: document.getElementById('distanceUnitM'),
    customRangeNotice: document.getElementById('customRangeNotice'),
    armRun: document.getElementById('armRun'),
    rolloutOff: document.getElementById('rolloutOff'),
    rolloutOn: document.getElementById('rolloutOn'),
    launchThresholdHalf: document.getElementById('launchThresholdHalf'),
    launchThresholdOne: document.getElementById('launchThresholdOne'),
    runNotes: document.getElementById('runNotes'),
    actionNotice: document.getElementById('actionNotice'),
    liveElapsedValue: document.getElementById('liveElapsedValue'),
    liveSpeedGaugeStage: document.getElementById('liveSpeedGaugeStage'),
    liveSpeedGaugeInner: document.getElementById('liveSpeedGaugeInner'),
    liveSpeedDial: document.getElementById('liveSpeedDial'),
    liveSpeedNeedle: document.getElementById('liveSpeedNeedle'),
    liveSpeedValue: document.getElementById('liveSpeedValue'),
    liveSpeedUnit: document.getElementById('liveSpeedUnit'),
    liveSpeedSubstatus: document.getElementById('liveSpeedSubstatus'),
    liveDistanceValue: document.getElementById('liveDistanceValue'),
    liveSlopeValue: document.getElementById('liveSlopeValue'),
    liveTargetValue: document.getElementById('liveTargetValue'),
    liveStateValue: document.getElementById('liveStateValue'),
    liveQualityValue: document.getElementById('liveQualityValue'),
    livePartialsSection: document.getElementById('livePartialsSection'),
    livePartialsList: document.getElementById('livePartialsList'),
    progressLabel: document.getElementById('progressLabel'),
    progressFill: document.getElementById('progressFill'),
    resultEmptyState: document.getElementById('resultEmptyState'),
    resultContent: document.getElementById('resultContent'),
    resultPrimaryHeader: document.getElementById('resultPrimaryHeader'),
    resultElapsedValue: document.getElementById('resultElapsedValue'),
    resultGraphMeta: document.getElementById('resultGraphMeta'),
    resultGraphEmptyState: document.getElementById('resultGraphEmptyState'),
    resultGraphFrame: document.getElementById('resultGraphFrame'),
    resultGraphCanvas: document.getElementById('resultGraphCanvas'),
    resultReplayControls: document.getElementById('resultReplayControls'),
    resultReplayToggle: document.getElementById('resultReplayToggle'),
    resultReplayRestart: document.getElementById('resultReplayRestart'),
    resultReplayProgress: document.getElementById('resultReplayProgress'),
    resultReplayCurrentValue: document.getElementById('resultReplayCurrentValue'),
    resultReplayMaxValue: document.getElementById('resultReplayMaxValue'),
    resultReplayAxisTime: document.getElementById('resultReplayAxisTime'),
    resultReplayAxisDistance: document.getElementById('resultReplayAxisDistance'),
    resultReplayChartsBtn: document.getElementById('resultReplayChartsBtn'),
    resultReplayMapShell: document.getElementById('resultReplayMapShell'),
    resultReplayMap: document.getElementById('resultReplayMap'),
    resultReplayChartSheet: document.getElementById('resultReplayChartSheet'),
    resultReplayChartSheetBackdrop: document.getElementById('resultReplayChartSheetBackdrop'),
    closeResultReplayChartSheet: document.getElementById('closeResultReplayChartSheet'),
    resultReplaySheetAxisTime: document.getElementById('resultReplaySheetAxisTime'),
    resultReplaySheetAxisDistance: document.getElementById('resultReplaySheetAxisDistance'),
    resultReplaySheetFilterSlider: document.getElementById('resultReplaySheetFilterSlider'),
    resultReplaySheetFilterStart: document.getElementById('resultReplaySheetFilterStart'),
    resultReplaySheetFilterEnd: document.getElementById('resultReplaySheetFilterEnd'),
    resultReplaySheetFilterStartValue: document.getElementById('resultReplaySheetFilterStartValue'),
    resultReplaySheetFilterEndValue: document.getElementById('resultReplaySheetFilterEndValue'),
    resultReplaySheetSpeedStage: document.getElementById('resultReplaySheetSpeedStage'),
    resultReplaySheetSpeedValue: document.getElementById('resultReplaySheetSpeedValue'),
    resultReplaySheetSpeedCanvas: document.getElementById('resultReplaySheetSpeedCanvas'),
    resultReplaySheetAltitudeStage: document.getElementById('resultReplaySheetAltitudeStage'),
    resultReplaySheetAltitudeValue: document.getElementById('resultReplaySheetAltitudeValue'),
    resultReplaySheetAltitudeCanvas: document.getElementById('resultReplaySheetAltitudeCanvas'),
    resultReplaySheetHeadingStage: document.getElementById('resultReplaySheetHeadingStage'),
    resultReplaySheetHeadingValue: document.getElementById('resultReplaySheetHeadingValue'),
    resultReplaySheetHeadingCanvas: document.getElementById('resultReplaySheetHeadingCanvas'),
    resultGraphTimeValue: document.getElementById('resultGraphTimeValue'),
    resultGraphSpeedValue: document.getElementById('resultGraphSpeedValue'),
    resultGraphDistanceValue: document.getElementById('resultGraphDistanceValue'),
    resultGraphAltitudeValue: document.getElementById('resultGraphAltitudeValue'),
    resultGraphAccuracyValue: document.getElementById('resultGraphAccuracyValue'),
    resultGraphSlopeValue: document.getElementById('resultGraphSlopeValue'),
    debugRawSection: document.getElementById('debugRawSection'),
    debugRawEmptyState: document.getElementById('debugRawEmptyState'),
    debugRawTableWrap: document.getElementById('debugRawTableWrap'),
    debugRawTableBody: document.getElementById('debugRawTableBody'),
    debugGraphSection: document.getElementById('debugGraphSection'),
    debugGraphEmptyState: document.getElementById('debugGraphEmptyState'),
    debugGraphTableWrap: document.getElementById('debugGraphTableWrap'),
    debugGraphTableBody: document.getElementById('debugGraphTableBody'),
    resultPartialsSection: document.getElementById('resultPartialsSection'),
    resultPartialsList: document.getElementById('resultPartialsList'),
    resultPresetValue: document.getElementById('resultPresetValue'),
    resultFinishSpeedValue: document.getElementById('resultFinishSpeedValue'),
    resultRolloutValue: document.getElementById('resultRolloutValue'),
    resultAccuracyValue: document.getElementById('resultAccuracyValue'),
    resultSlopeValue: document.getElementById('resultSlopeValue'),
    resultElevationValue: document.getElementById('resultElevationValue'),
    resultHzValue: document.getElementById('resultHzValue'),
    resultQualityValue: document.getElementById('resultQualityValue'),
    resultTimestampValue: document.getElementById('resultTimestampValue'),
    resultLocationValue: document.getElementById('resultLocationValue'),
    resultComparisonValue: document.getElementById('resultComparisonValue'),
    resultNotesRow: document.getElementById('resultNotesRow'),
    resultNotesValue: document.getElementById('resultNotesValue'),
    warningBadges: document.getElementById('warningBadges'),
    diagnosticAverageIntervalValue: document.getElementById('diagnosticAverageIntervalValue'),
    diagnosticJitterValue: document.getElementById('diagnosticJitterValue'),
    diagnosticSparseValue: document.getElementById('diagnosticSparseValue'),
    diagnosticStaleValue: document.getElementById('diagnosticStaleValue'),
    diagnosticSpeedSourceValue: document.getElementById('diagnosticSpeedSourceValue'),
    diagnosticSamplesValue: document.getElementById('diagnosticSamplesValue'),
    clearHistory: document.getElementById('clearHistory'),
    historyEmptyState: document.getElementById('historyEmptyState'),
      historyList: document.getElementById('historyList'),
    };
  }

  var elements = getAccelElements();

  var toolsMenu = initToolsMenu({
    button: elements.toolsMenuBtn,
    list: elements.toolsMenuList,
  });

  function openCloudSyncLauncher() {
    Promise.resolve().then(function () {
      focusCloudSyncLauncherTarget();
    });
  }

  initCloudSyncStatusIndicator({
    mount: elements.toolbar,
    alignEnd: true,
    openLauncher: openCloudSyncLauncher,
  });

  applyButtonIcon(elements.armRun, IconPlay);
  applyButtonIcon(elements.toolsMenuBtn, IconPages);
  applyButtonIcon(elements.toolbarSetup, IconSettings);
  applyButtonIcon(elements.toolbarResults, IconReplay);
  applyButtonIcon(elements.openSpeedMenu, IconSpeed);
  applyButtonIcon(elements.openLibraryMenu, IconWorld);
  applyButtonIcon(elements.openBoardMenu, IconBoard);
  applyButtonIcon(elements.resultReplayToggle, IconPlay);
  applyButtonIcon(elements.resultReplayRestart, IconRestart);
  applyButtonIcon(elements.resultReplayAxisTime, IconTime);
  applyButtonIcon(elements.resultReplayAxisDistance, IconDistance);
  applyButtonIcon(elements.resultReplaySheetAxisTime, IconTime);
  applyButtonIcon(elements.resultReplaySheetAxisDistance, IconDistance);
  var placeResolver = createPlaceResolver({ getLanguage: getLang });
  var unitBootstrapPending = false;
  var runPlaceEnrichmentIds = new Set();

  var replayChartFilterController =
    elements.resultReplaySheetFilterStart && elements.resultReplaySheetFilterEnd
      ? new DualRangeInput(
          elements.resultReplaySheetFilterStart,
          elements.resultReplaySheetFilterEnd
        )
      : null;

  var liveSpeedometer = createAnalogSpeedometer({
    stageElement: elements.liveSpeedGaugeStage,
    stageInnerElement: elements.liveSpeedGaugeInner,
    dialCanvas: elements.liveSpeedDial,
    needleCanvas: elements.liveSpeedNeedle,
    valueElement: elements.liveSpeedValue,
    unitElement: elements.liveSpeedUnit,
    substatusElement: elements.liveSpeedSubstatus,
    styleSourceElement: elements.liveSpeedGaugeStage,
  });

  var state = {
    permissionState: 'prompt',
    permissionStatus: null,
    geolocationSupported: Boolean(navigator.geolocation),
    viewMounted: true,
    initialized: false,
    watchId: null,
    uiTimerId: null,
    sessionSampleCount: 0,
    sessionIntervals: [],
    recentIntervals: [],
    latestSample: null,
    currentQuality: null,
    runs: [],
    settings: createDefaultSettings(),
    run: null,
    latestResult: null,
    selectedResultId: '',
    replay: {
      axisMode: 'time',
      engaged: false,
      playing: false,
      playPending: false,
      positionMs: 0,
      playbackStartPerfMs: 0,
      playbackStartElapsedMs: 0,
      sourceResultId: '',
      source: null,
      introPlayed: false,
      chartSheetOpen: false,
      chartScrubMetric: '',
      chartFilterStartRatio: 0,
      chartFilterEndRatio: 1,
    },
    openPanel: null,
    lastPanelTrigger: null,
    actionNoticeTimerId: null,
  };
  var resultLocationMeasureFrame = null;
  var historyDetailMeasureFrame = null;

  var formatters = createAccelFormatters({
    t: t,
    getLang: getLang,
    getSettings: function () {
      return state.settings;
    },
  });
  var convertSpeedInputValue = formatters.convertSpeedInputValue;
  var escapeHtml = formatters.escapeHtml;
  var formatAdaptiveNumber = formatters.formatAdaptiveNumber;
  var formatDebugCoordinate = formatters.formatDebugCoordinate;
  var formatDebugCoordinatePair = formatters.formatDebugCoordinatePair;
  var formatDebugMeters = formatters.formatDebugMeters;
  var formatDebugSpeedMs = formatters.formatDebugSpeedMs;
  var formatDistanceMeasurement = formatters.formatDistanceMeasurement;
  var convertDistanceMeasurement = formatters.convertDistanceMeasurement;
  var formatHeading = formatters.formatHeading;
  var formatHz = formatters.formatHz;
  var formatInputSpeedValue = formatters.formatInputSpeedValue;
  var formatInteger = formatters.formatInteger;
  var formatLiveSpeedNumber = formatters.formatLiveSpeedNumber;
  var formatMs = formatters.formatMs;
  var formatNumber = formatters.formatNumber;
  var formatPartialValue = formatters.formatPartialValue;
  var formatRunDistance = formatters.formatRunDistance;
  var formatRunSeconds = formatters.formatRunSeconds;
  var formatSignedDistanceMeasurement = formatters.formatSignedDistanceMeasurement;
  var formatSlopePercent = formatters.formatSlopePercent;
  var formatSpeedValue = formatters.formatSpeedValue;
  var formatThresholdOptionLabel = formatters.formatThresholdOptionLabel;
  var formatTimestamp = formatters.formatTimestamp;
  var getDistanceProgressLabel = formatters.getDistanceProgressLabel;
  var getDistanceUnitLabel = formatters.getDistanceUnitLabel;
  var getPartialLabel = formatters.getPartialLabel;
  var getSpeedProgressLabel = formatters.getSpeedProgressLabel;
  var getSpeedUnitLabel = formatters.getSpeedUnitLabel;
  var getTargetProgressLabel = formatters.getTargetProgressLabel;
  var isSameNumber = formatters.isSameNumber;
  var msToSpeedUnit = formatters.msToSpeedUnit;
  var normalizeCustomSpeedInput = formatters.normalizeCustomSpeedInput;

  var historyHelpers = createAccelHistoryHelpers({
    getRuns: function () {
      return state.runs;
    },
    formatRunSeconds: formatRunSeconds,
    t: t,
    buildComparisonSignature: buildComparisonSignature,
  });
  var buildComparisonText = historyHelpers.buildComparisonText;

  var resultGraph = createAccelResultGraph({
    Chart: Chart,
    elements: elements,
    getDisplayedResult: getDisplayedResult,
    getLang: getLang,
    getState: function () {
      return state;
    },
    isFiniteNumber: isFiniteNumber,
    compactSpeedTrace: compactSpeedTrace,
    msToSpeedUnit: msToSpeedUnit,
    convertDistanceMeasurement: convertDistanceMeasurement,
    formatDistanceMeasurement: formatDistanceMeasurement,
    formatNumber: formatNumber,
    formatRunDistance: formatRunDistance,
    formatRunSeconds: formatRunSeconds,
    formatSlopePercent: formatSlopePercent,
    formatSpeedValue: formatSpeedValue,
    getDistanceUnitLabel: getDistanceUnitLabel,
    getSpeedUnitLabel: getSpeedUnitLabel,
    t: t,
    resultGraphHeight: RESULT_GRAPH_HEIGHT,
  });
  var replayCharts = createAccelReplayChartsController({
    Chart: Chart,
    elements: {
      replayDetailSpeedCanvas: elements.resultReplaySheetSpeedCanvas,
      replayDetailAltitudeCanvas: elements.resultReplaySheetAltitudeCanvas,
      replayDetailHeadingCanvas: elements.resultReplaySheetHeadingCanvas,
    },
    convertDistanceMeasurement: convertDistanceMeasurement,
    formatNumber: formatNumber,
    getDistanceUnit: function () {
      return state.settings.distanceUnit;
    },
    getDistanceUnitLabel: getDistanceUnitLabel,
    getSpeedUnit: function () {
      return state.settings.speedUnit;
    },
    getSpeedUnitLabel: getSpeedUnitLabel,
    isFiniteNumber: isFiniteNumber,
    msToSpeedUnit: msToSpeedUnit,
  });
  var replayMap = createAccelReplayMapController({
    element: elements.resultReplayMap,
  });
  var replayMapIntroPromise = null;
  var replayMapIntroToken = 0;
  var pendingMissingSelectionId = '';

  function applyStoredRuns(runs, preferredResultId, { preserveMissingPreferred = false } = {}) {
    state.runs = Array.isArray(runs) ? runs : [];
    state.latestResult = state.runs.length ? state.runs[0] : null;

    var requestedResultId =
      typeof preferredResultId === 'string' && preferredResultId.trim()
        ? preferredResultId.trim()
        : state.selectedResultId || '';
    var selectedRun = requestedResultId ? state.runs.find((entry) => entry.id === requestedResultId) : null;
    if (selectedRun) {
      state.selectedResultId = selectedRun.id;
      return;
    }

    if (preserveMissingPreferred && requestedResultId) {
      state.selectedResultId = requestedResultId;
      return;
    }

    state.selectedResultId = state.latestResult ? state.latestResult.id : '';
  }

  async function ensureSelectedResultTelemetry(runId, { selectionSnapshotId = null } = {}) {
    var normalizedRunId =
      typeof runId === 'string' && runId.trim() ? runId.trim() : state.selectedResultId || state.latestResult?.id || '';
    var selectedRun = normalizedRunId ? findRunById(normalizedRunId) : state.latestResult;

    var restoreResult = await ensureAccelTelemetry(normalizedRunId, { run: selectedRun });
    if (!restoreResult?.restored) {
      return false;
    }

    if (
      typeof selectionSnapshotId === 'string'
      && selectionSnapshotId
      && state.selectedResultId !== selectionSnapshotId
    ) {
      return false;
    }
    var selection = await getAccelSelection(normalizedRunId, {
      preserveMissingSelection: true,
    });
    applyStoredRuns(selection.runs, normalizedRunId, {
      preserveMissingPreferred: true,
    });
    return true;
  }

  function hasSelectedResultSelection(runId = state.selectedResultId) {
    return Boolean(
      typeof runId === 'string'
      && runId
      && findRunById(runId)
    );
  }

  function hasMissingSelectedResult(runId = state.selectedResultId) {
    return Boolean(
      typeof runId === 'string'
      && runId
      && !hasSelectedResultSelection(runId)
    );
  }

  function maybeFallbackMissingSelectedResult(runId = state.selectedResultId) {
    if (!hasMissingSelectedResult(runId)) return;
    pendingMissingSelectionId =
      typeof runId === 'string' && runId.trim() ? runId.trim() : pendingMissingSelectionId;
    refreshStoredRuns({
      preferredResultId: '',
      preserveMissingPreferred: false,
    });
  }

  async function init() {
    if (!(await singleTabOwnershipPromise)) {
      return;
    }
    var initialRunId = getCurrentAppRouteQuery().get('run') || '';

    var loadedState = await Promise.all([
      loadSettings(),
      getAccelSelection(initialRunId, {
        preserveMissingSelection: Boolean(initialRunId),
      }),
    ]);

    state.settings = loadedState[0];
    applyStoredRuns(loadedState[1].runs, initialRunId, {
      preserveMissingPreferred: Boolean(initialRunId),
    });

    if (hasStoredValue(STORAGE_KEYS.settings) && !hasConfiguredUnitPreferences()) {
      markUnitBootstrapManualSelection({
        speedUnit: state.settings.speedUnit,
        distanceUnit: state.settings.distanceUnit,
      });
    }

    applyTranslations();
    elements.runNotes.value = state.settings.notes;
    if (syncSelectedPresetForUnits()) saveSettings();
    renderPresetButtons();
    renderControlSelections();
    bindEvents();
    setupResultGraphObservers();
    renderAll();
    publishAccelActivity();
    var initialTelemetryPromise = ensureSelectedResultTelemetry(initialRunId || state.selectedResultId, {
      selectionSnapshotId: state.selectedResultId || '',
    }).then(function (restored) {
      if (restored) renderAll();
      return restored;
    }).catch(function () {
      return false;
    });
    if (!isSpaRuntime) {
      startCloudSyncLoop({ immediate: true });
    }
    void initialTelemetryPromise.finally(function () {
      maybeFallbackMissingSelectedResult();
    });
    state.initialized = true;
    if (state.viewMounted) {
      startUiTimer();
      updatePermissionState();
      ensureWatch();
    }
  }

  function primeFinishAudio() {
    if (!finishAudio) return Promise.resolve(false);
    if (finishAudioPrimed) return Promise.resolve(true);
    if (finishAudioPrimePromise) return finishAudioPrimePromise;

    finishAudioPrimePromise = (async function () {
      var previousMuted = finishAudio.muted;
      var previousVolume = finishAudio.volume;
      var previousLoop = finishAudio.loop;

      try {
        finishAudio.muted = true;
        finishAudio.volume = 0;
        finishAudio.loop = false;
        finishAudio.currentTime = 0;
        var playPromise = finishAudio.play();
        if (playPromise && typeof playPromise.then === 'function') await playPromise;
        finishAudio.pause();
        finishAudio.currentTime = 0;
        finishAudioPrimed = true;
        return true;
      } catch (error) {
        finishAudio.pause();
        finishAudio.currentTime = 0;
        finishAudioPrimed = false;
        return false;
      } finally {
        finishAudio.muted = previousMuted;
        finishAudio.volume = previousVolume;
        finishAudio.loop = previousLoop;
        finishAudioPrimePromise = null;
      }
    })();

    return finishAudioPrimePromise;
  }

  function playFinishAudio() {
    if (!finishAudio) return;

    try {
      finishAudio.pause();
      finishAudio.currentTime = 0;
      var playPromise = finishAudio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function () {
          // Ignore autoplay or playback failures.
        });
      }
    } catch (error) {
      // Ignore autoplay or playback failures.
    }
  }

  function t(key, params) {
    return sharedT(key, params);
  }

  function applyTranslations() {
    document.title = t('accelPageTitle');
    if (elements.pageDescriptionMeta)
      elements.pageDescriptionMeta.setAttribute('content', t('accelPageDescription'));
    document.documentElement.lang = getLang();
    applySharedTranslations();
    elements.langToggleButtons.forEach(function (button) {
      button.textContent = getLang().toUpperCase();
    });
  }

  function bindEvents() {
    elements.langToggleButtons.forEach(function (button) {
      button.addEventListener('click', handleLangToggle);
    });
    bindMenuNavigation(elements.openSpeedMenu, '#/speed');
    bindMenuNavigation(elements.openLibraryMenu, '#/library?tab=accel');
    bindMenuNavigation(elements.openBoardMenu, '#/board');
    if (!isSpaRuntime) {
      integratePlayerWidget({ toolsMenuList: elements.toolsMenuList, toolsMenu });
    }
    window.__vatioboardCanLeaveAccel = function () {
      if (!isRunActive(state.run)) return true;
      if (isSpaRuntime) return true;
      return window.confirm(t('accelLeaveActiveRunConfirm'));
    };
    window.addEventListener(ROUTE_VISIBLE_EVENT, function (event) {
      if (event?.detail?.path !== '/accel') return;
      var routeRunId = getCurrentAppRouteQuery().get('run') || '';
      if (!routeRunId || routeRunId === state.selectedResultId) return;
      refreshStoredRuns({
        preferredResultId: routeRunId,
        preserveMissingPreferred: true,
      });
    });
    elements.setupTrigger.addEventListener('click', function () {
      togglePanel('setup', elements.setupTrigger);
    });
    elements.resultsTrigger.addEventListener('click', function () {
      togglePanel('results', elements.resultsTrigger);
    });
    elements.toolbarSetup.addEventListener('click', function () {
      togglePanel('setup', elements.toolbarSetup);
    });
    elements.toolbarResults.addEventListener('click', function () {
      if (!getDisplayedResult()) return;
      togglePanel('results', elements.toolbarResults);
    });
    elements.closeSetupPanel.addEventListener('click', function () {
      closePanel();
    });
    elements.closeResultsPanel.addEventListener('click', function () {
      closePanel();
    });
    elements.sheetBackdrop.addEventListener('click', function () {
      closePanel();
    });
    elements.presetGrid.addEventListener('click', handlePresetClick);
    elements.customStartInput.addEventListener('input', handleCustomInput);
    elements.customEndInput.addEventListener('input', handleCustomInput);
    elements.speedUnitMph.addEventListener('click', handleSpeedUnitClick);
    elements.speedUnitKmh.addEventListener('click', handleSpeedUnitClick);
    elements.distanceUnitFt.addEventListener('click', handleDistanceUnitClick);
    elements.distanceUnitM.addEventListener('click', handleDistanceUnitClick);
    elements.armRun.addEventListener('click', handleRunPrimaryAction);
    elements.rolloutOff.addEventListener('click', handleRolloutClick);
    elements.rolloutOn.addEventListener('click', handleRolloutClick);
    elements.launchThresholdHalf.addEventListener('click', handleThresholdClick);
    elements.launchThresholdOne.addEventListener('click', handleThresholdClick);
    elements.runNotes.addEventListener('input', handleNotesInput);
    elements.clearHistory.addEventListener('click', handleClearHistory);
    elements.historyList.addEventListener('click', handleHistoryClick);
    elements.resultReplayToggle.addEventListener('click', handleReplayToggle);
    elements.resultReplayRestart.addEventListener('click', handleReplayRestart);
    elements.resultReplayProgress.addEventListener('input', handleReplayProgressInput);
    elements.resultReplayAxisTime.addEventListener('click', handleReplayAxisClick);
    elements.resultReplayAxisDistance.addEventListener('click', handleReplayAxisClick);
    elements.resultReplayChartsBtn.addEventListener('click', handleReplayChartsOpen);
    elements.closeResultReplayChartSheet.addEventListener('click', handleReplayChartsClose);
    elements.resultReplayChartSheetBackdrop.addEventListener('click', handleReplayChartsClose);
    elements.resultReplaySheetAxisTime.addEventListener('click', handleReplayAxisClick);
    elements.resultReplaySheetAxisDistance.addEventListener('click', handleReplayAxisClick);
    elements.resultReplaySheetFilterStart.addEventListener('input', handleReplayChartFilterInput);
    elements.resultReplaySheetFilterEnd.addEventListener('input', handleReplayChartFilterInput);
    bindReplayChartScrub(elements.resultReplaySheetSpeedCanvas);
    bindReplayChartScrub(elements.resultReplaySheetAltitudeCanvas);
    bindReplayChartScrub(elements.resultReplaySheetHeadingCanvas);
    document.addEventListener('visibilitychange', renderAll);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pagehide', destroyResultGraph);
    window.addEventListener('pageshow', (event) => {
      void restoreAfterPageShow(event);
    });
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener(SINGLE_TAB_OWNERSHIP_EVENT, handleSingleTabOwnershipChange);
    window.addEventListener(CLOUD_SYNC_APPLIED_EVENT, function (event) {
      if (event?.detail?.entityType !== CLOUD_SYNC_ENTITY_TYPES.accelRun) return;
      if (event?.detail?.deleted === true && event?.detail?.recordId === state.selectedResultId) {
        clearAccelRestoreFailure(event.detail.recordId);
        refreshStoredRuns({
          preferredResultId: '',
          preserveMissingPreferred: false,
        });
        return;
      }
      if (event?.detail?.recordId && event.detail.recordId === state.selectedResultId) {
        clearAccelRestoreFailure(event.detail.recordId);
        refreshStoredRuns({
          preferredResultId: event.detail.recordId,
          preserveMissingPreferred: true,
        });
        void ensureSelectedResultTelemetry(event.detail.recordId, {
          selectionSnapshotId: event.detail.recordId,
        }).then(function (restored) {
          if (restored) renderAll();
        });
        return;
      }
      if (event?.detail?.recordId && pendingMissingSelectionId) {
        var syncedRecordId = event.detail.recordId;
        pendingMissingSelectionId = '';
        clearAccelRestoreFailure(syncedRecordId);
        refreshStoredRuns({
          preferredResultId: syncedRecordId,
          preserveMissingPreferred: true,
        });
        void ensureSelectedResultTelemetry(syncedRecordId, {
          selectionSnapshotId: syncedRecordId,
        }).then(function (restored) {
          if (restored) renderAll();
        });
        return;
      }
      if (hasSelectedResultSelection()) {
        refreshStoredRuns({
          preferredResultId: state.selectedResultId,
          preserveMissingPreferred: false,
        });
        return;
      }
      refreshStoredRuns({
        preferredResultId: event?.detail?.recordId || '',
        preserveMissingPreferred: event?.detail?.deleted !== true,
      });
    });
  }

  function syncResultLocationOverflow() {
    if (!elements.resultLocationValue) return;

    var text = elements.resultLocationValue.querySelector('.accel-result-location-text');
    elements.resultLocationValue.dataset.overflowing = 'false';
    elements.resultLocationValue.style.removeProperty('--accel-result-location-scroll-distance');
    elements.resultLocationValue.style.removeProperty('--accel-result-location-scroll-duration');

    if (
      !text ||
      state.openPanel !== 'results' ||
      !elements.resultsPanel ||
      elements.resultsPanel.hidden ||
      !elements.resultContent ||
      elements.resultContent.hidden
    ) {
      return;
    }

    var overflowPx = Math.ceil(text.scrollWidth - elements.resultLocationValue.clientWidth);
    if (!Number.isFinite(overflowPx) || overflowPx <= 8) return;

    elements.resultLocationValue.dataset.overflowing = 'true';
    elements.resultLocationValue.style.setProperty(
      '--accel-result-location-scroll-distance',
      overflowPx + 'px'
    );
    elements.resultLocationValue.style.setProperty(
      '--accel-result-location-scroll-duration',
      Math.max(8, Math.min(22, overflowPx / 18 + 6)).toFixed(2) + 's'
    );
  }

  function queueResultLocationOverflowSync() {
    if (resultLocationMeasureFrame !== null) {
      window.cancelAnimationFrame(resultLocationMeasureFrame);
    }

    resultLocationMeasureFrame = window.requestAnimationFrame(function () {
      resultLocationMeasureFrame = null;
      syncResultLocationOverflow();
    });
  }

  function syncHistoryDetailOverflow() {
    if (!elements.historyList) return;

    for (var detail of elements.historyList.querySelectorAll('.accel-history-detail')) {
      var text = detail.querySelector('.accel-history-detail-text');
      var button = detail.closest('.accel-history-btn');

      detail.dataset.overflowing = 'false';
      detail.style.removeProperty('--accel-history-detail-scroll-distance');
      detail.style.removeProperty('--accel-history-detail-scroll-duration');

      if (
        !text ||
        !button ||
        button.getAttribute('aria-pressed') !== 'true' ||
        state.openPanel !== 'results' ||
        !elements.resultsPanel ||
        elements.resultsPanel.hidden
      ) {
        continue;
      }

      var overflowPx = Math.ceil(text.scrollWidth - detail.clientWidth);
      if (!Number.isFinite(overflowPx) || overflowPx <= 8) continue;

      detail.dataset.overflowing = 'true';
      detail.style.setProperty('--accel-history-detail-scroll-distance', overflowPx + 'px');
      detail.style.setProperty(
        '--accel-history-detail-scroll-duration',
        Math.max(8, Math.min(22, overflowPx / 18 + 6)).toFixed(2) + 's'
      );
    }
  }

  function queueHistoryDetailOverflowSync() {
    if (historyDetailMeasureFrame !== null) {
      window.cancelAnimationFrame(historyDetailMeasureFrame);
    }

    historyDetailMeasureFrame = window.requestAnimationFrame(function () {
      historyDetailMeasureFrame = null;
      syncHistoryDetailOverflow();
    });
  }

  function handleWindowResize() {
    requestResultGraphRefresh();
    queueResultLocationOverflowSync();
    queueHistoryDetailOverflowSync();
  }

  function setResultLocationText(text) {
    if (!elements.resultLocationValue) return;
    var textElement = elements.resultLocationValue.querySelector('.accel-result-location-text');
    if (textElement) textElement.textContent = text;
    else elements.resultLocationValue.textContent = text;
    queueResultLocationOverflowSync();
  }

  function bindMenuNavigation(element, href) {
    if (!element) return;
    element.addEventListener('click', function () {
      toolsMenu.close();
      navigateToAppRoute(href);
    });
  }

  function setupResultGraphObservers() {
    resultGraph.setupObservers();
  }

  function handleLangToggle() {
    toggleLang();
    applyTranslations();
    renderPresetButtons();
    renderAll();
    publishAccelActivity();
  }

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
    var menuList = getActiveToolsMenuList(elements.toolsMenuList);
    var candidates = [
      menuList?.querySelector('[data-backend-auth-user]'),
      menuList?.querySelector('[data-backend-auth-password]'),
      menuList?.querySelector('[data-backend-auth-login]'),
      menuList?.querySelector('[data-backend-auth-logout]'),
      menuList?.querySelector('[data-backend-auth-status]'),
    ];

    return candidates.find(isVisibleForFocus) || null;
  }

  function focusCloudSyncLauncherTarget(attempt) {
    var nextAttempt = Number.isFinite(attempt) ? attempt : 0;
    toolsMenu.setOpen(true);
    var target = getCloudSyncLauncherFocusTarget();
    if (target) {
      focusElement(target);
      if (target.matches?.('input') && typeof target.select === 'function') {
        target.select();
      }
      return;
    }

    if (nextAttempt >= 6) return;
    Promise.resolve().then(function () {
      focusCloudSyncLauncherTarget(nextAttempt + 1);
    });
  }

  function handleKeyDown(event) {
    if (event.target.closest('.player-panel, .player-fab')) return;
    if (event.key !== 'Escape' || !state.openPanel) return;
    event.preventDefault();
    if (state.replay.chartSheetOpen) {
      handleReplayChartsClose();
      return;
    }
    closePanel();
  }

  function teardownPanel(panelName) {
    if (panelName !== 'results') return;
    pauseReplayPlayback();
    resetReplayMapIntroState();
    replayMap.destroy();
    setReplayChartSheetOpen(false);
  }

  function openPanel(panelName, triggerElement) {
    if (state.openPanel === panelName) return;
    if (state.openPanel) {
      teardownPanel(state.openPanel);
    }
    state.openPanel = panelName;
    state.lastPanelTrigger = triggerElement || null;
    if (panelName === 'results' && elements.resultsPanel) {
      resultGraph.noteResultsPanelWidth();
    }
    renderSheetUi();
    if (panelName === 'results') {
      renderResultCard();
    }

    var focusTarget = panelName === 'setup' ? elements.closeSetupPanel : elements.closeResultsPanel;
    if (focusTarget) focusTarget.focus();
  }

  function closePanel(triggerElement) {
    if (!state.openPanel) return;

    var previouslyOpen = state.openPanel;
    teardownPanel(previouslyOpen);
    state.openPanel = null;
    renderSheetUi();

    var trigger =
      triggerElement ||
      state.lastPanelTrigger ||
      (previouslyOpen === 'setup' ? elements.setupTrigger : elements.resultsTrigger);
    state.lastPanelTrigger = null;
    if (trigger) focusElement(trigger);
  }

  function togglePanel(panelName, triggerElement) {
    if (state.openPanel === panelName) {
      closePanel(triggerElement);
      return;
    }

    openPanel(panelName, triggerElement);
  }

  function saveSettings() {
    void persistSettings(state.settings);
  }

  function saveRuns() {
    void persistRuns(state.runs);
  }

  function queueRunForCloudSync(run) {
    if (!run || !run.id) return;

    void queueCloudSyncChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
      recordId: run.id,
      recordTitle: run.presetId || run.id,
      updatedAtMs: run.savedAtMs || Date.now(),
      payload: run,
    });
  }

  function refreshStoredRuns({
    preferredResultId = state.selectedResultId || '',
    preserveMissingPreferred = false,
  } = {}) {
    void (async function () {
      var normalizedPreferredResultId =
        typeof preferredResultId === 'string' && preferredResultId.trim() ? preferredResultId.trim() : '';
      var currentSelectedResultId =
        typeof state.selectedResultId === 'string' && state.selectedResultId.trim() ? state.selectedResultId.trim() : '';
      var livePreferredResultId = normalizedPreferredResultId || currentSelectedResultId;
      var selection = await getAccelSelection(livePreferredResultId, {
        preserveMissingSelection: preserveMissingPreferred && Boolean(livePreferredResultId),
      });
      applyStoredRuns(selection.runs, livePreferredResultId, {
        preserveMissingPreferred: preserveMissingPreferred && Boolean(livePreferredResultId),
      });
      var selectedResultId = state.selectedResultId || livePreferredResultId || '';
      await ensureSelectedResultTelemetry(selectedResultId, {
        selectionSnapshotId: selectedResultId,
      });
      renderAll();
    })();
  }

  function applyAutoConfiguredUnits(countryCode) {
    if (hasConfiguredUnitPreferences()) return false;

    var bootstrapResult = maybeInitializeUnitsFromCountry(countryCode);
    if (!bootstrapResult.changed) return false;

    var nextSpeedUnit = normalizeSpeedUnit(bootstrapResult.config.speedUnit);
    var nextDistanceUnit = normalizeDistanceUnit(bootstrapResult.config.distanceUnit);
    if (
      nextSpeedUnit === state.settings.speedUnit &&
      nextDistanceUnit === state.settings.distanceUnit
    ) {
      return false;
    }

    state.settings.customStart = convertSpeedInputValue(
      state.settings.customStart,
      state.settings.speedUnit,
      nextSpeedUnit
    );
    state.settings.customEnd = convertSpeedInputValue(
      state.settings.customEnd,
      state.settings.speedUnit,
      nextSpeedUnit
    );
    state.settings.speedUnit = nextSpeedUnit;
    state.settings.distanceUnit = nextDistanceUnit;
    syncSelectedPresetForUnits();
    saveSettings();
    renderControlSelections();
    renderPresetButtons();
    renderAll();
    return true;
  }

  function maybeBootstrapUnitsFromSample(sample) {
    if (unitBootstrapPending || hasConfiguredUnitPreferences()) return;
    if (!sample || !isFiniteNumber(sample.latitude) || !isFiniteNumber(sample.longitude)) return;

    unitBootstrapPending = true;
    placeResolver
      .reverseCountry({
        latitude: sample.latitude,
        longitude: sample.longitude,
      })
      .then(function (response) {
        if (!response || !response.countryCode) return;
        applyAutoConfiguredUnits(response.countryCode);
      })
      .catch(function () {
        // Ignore Nominatim/network failures and keep GPS live.
      })
      .finally(function () {
        unitBootstrapPending = false;
      });
  }

  function getRunLocationLabel(run) {
    var startPlace = run && run.startPlace ? (run.startPlace.raw || run.startPlace) : null;
    var endPlace = run && run.endPlace ? (run.endPlace.raw || run.endPlace) : null;
    return formatRouteString(startPlace, endPlace, t('accelUnavailable'));
  }

  function getRunPlaceBoundarySamples(run) {
    if (!run || !Array.isArray(run.sampleLog)) {
      return {
        startSample: null,
        endSample: null,
        startIndex: -1,
        endIndex: -1,
        strategy: 'empty',
      };
    }

    // Use the shared route-boundary module with accel-specific options.
    // Accel runs are typically short and fast, so use a smaller lookahead
    // window and lower movement threshold.
    return getRouteBoundarySamples(run.sampleLog, {
      mode: 'accel',
      movementThresholdM: 10,
      speedThresholdMs: 0.5,
      lookaheadWindow: 2,
    });
  }

  function reversePlaceForRunSample(sample) {
    return reverseGeocodeBoundarySample(sample, placeResolver);
  }

  function updateRunInState(updatedRun) {
    state.runs = state.runs.map(function (entry) {
      return entry.id === updatedRun.id ? updatedRun : entry;
    });
    if (state.latestResult && state.latestResult.id === updatedRun.id) {
      state.latestResult = updatedRun;
    }
    if (state.selectedResultId === updatedRun.id) {
      state.selectedResultId = updatedRun.id;
    }
    if (state.run && state.run.result && state.run.result.id === updatedRun.id) {
      state.run.result = updatedRun;
    }
  }

  function enrichRunPlaces(runId) {
    if (!runId || runPlaceEnrichmentIds.has(runId)) return;

    var run = findRunById(runId);
    if (!run) return;

    var boundarySamples = getRunPlaceBoundarySamples(run);
    if (!boundarySamples.startSample && !boundarySamples.endSample) return;

    runPlaceEnrichmentIds.add(runId);
    void (async function () {
      var nextRun = run;

      try {
        if (!nextRun.startPlace && boundarySamples.startSample) {
          var startResult = await reversePlaceForRunSample(boundarySamples.startSample);
          if (startResult?.countryCode) {
            applyAutoConfiguredUnits(startResult.countryCode);
          }
          if (startResult?.place) {
            nextRun = {
              ...nextRun,
              startBoundaryPoint: {
                latitude: boundarySamples.startSample.latitude,
                longitude: boundarySamples.startSample.longitude,
                timestampMs: boundarySamples.startSample.timestampMs ?? null,
                sampleIndex: boundarySamples.startIndex,
              },
              startPlace: {
                label: startResult.boundaryDisplay.label,
                detail: startResult.boundaryDisplay.detail,
                raw: startResult.place,
              },
            };
          }
        }

        if (!nextRun.endPlace && boundarySamples.endSample) {
          var sameCoords = Boolean(
            nextRun.startPlace &&
            boundarySamples.canReuseBoundaryPlace
          );

          if (sameCoords) {
            nextRun = {
              ...nextRun,
              endBoundaryPoint: {
                latitude: boundarySamples.endSample.latitude,
                longitude: boundarySamples.endSample.longitude,
                timestampMs: boundarySamples.endSample.timestampMs ?? null,
                sampleIndex: boundarySamples.endIndex,
              },
              endPlace: { ...nextRun.startPlace },
            };
          } else {
            var endResult = await reversePlaceForRunSample(boundarySamples.endSample);
            if (endResult?.countryCode) {
              applyAutoConfiguredUnits(endResult.countryCode);
            }
            if (endResult?.place) {
              nextRun = {
                ...nextRun,
                endBoundaryPoint: {
                  latitude: boundarySamples.endSample.latitude,
                  longitude: boundarySamples.endSample.longitude,
                  timestampMs: boundarySamples.endSample.timestampMs ?? null,
                  sampleIndex: boundarySamples.endIndex,
                },
                endPlace: {
                  label: endResult.boundaryDisplay.label,
                  detail: endResult.boundaryDisplay.detail,
                  raw: endResult.place,
                },
              };
            }
          }
        }
      } catch {
        // Ignore Nominatim/network failures and keep the saved run.
      } finally {
        runPlaceEnrichmentIds.delete(runId);
      }

      if (nextRun === run) return;

      updateRunInState(nextRun);
      saveRuns();
      queueRunForCloudSync(nextRun);
      renderAll();
    })();
  }

  function getSelectedPreset() {
    return resolveSelectedPreset(state.settings);
  }

  function getAvailablePresetDefinitions() {
    return listAvailablePresetDefinitions(state.settings.speedUnit, state.settings.distanceUnit);
  }

  function syncSelectedPresetForUnits() {
    var resolvedPresetId = resolvePresetIdForUnits(
      state.settings.selectedPresetId,
      state.settings.speedUnit,
      state.settings.distanceUnit
    );

    if (resolvedPresetId === state.settings.selectedPresetId) return false;
    state.settings.selectedPresetId = resolvedPresetId;
    return true;
  }

  function getPresetLabel(presetOrRun) {
    if (!presetOrRun) return t('accelUnavailable');

    if (presetOrRun.id === 'custom' || presetOrRun.presetId === 'custom') {
      if (!isFiniteNumber(presetOrRun.targetSpeedMs)) {
        return t('accelPresetCustom');
      }
      var speedUnit = state.settings.speedUnit;
      var start = msToSpeedUnit(presetOrRun.startSpeedMs || 0, speedUnit);
      var end = msToSpeedUnit(presetOrRun.targetSpeedMs || 0, speedUnit);
      return (
        t('accelPresetCustom') +
        ' · ' +
        formatAdaptiveNumber(start) +
        '-' +
        formatAdaptiveNumber(end) +
        ' ' +
        getSpeedUnitLabel(speedUnit)
      );
    }

    return t(presetOrRun.labelKey || presetKeyFromId(presetOrRun.presetId));
  }

  function getPresetMetaLabel(presetOrRun) {
    if (!presetOrRun) return t('accelUnavailable');
    if (presetOrRun.id === 'custom' || presetOrRun.presetId === 'custom')
      return t('accelCustomRange');
    if (presetOrRun.type === 'distance' || presetOrRun.presetKind === 'distance')
      return t('accelDistanceTest');
    return presetOrRun.standingStart ? t('accelStandingStart') : t('accelRollingStart');
  }

  function getAccelActivityDetail(run) {
    var preset = run?.preset;
    if (!preset) return {};
    var detailKey = preset.labelKey || presetKeyFromId(preset.presetId || preset.id);
    if (detailKey) return { detailKey: detailKey };
    return { detail: getPresetLabel(preset) };
  }

  function getAccelActivityStartedAtMs(run) {
    if (!run || !isFiniteNumber(run.startPerfMs)) return null;
    return Date.now() - Math.max(0, performance.now() - run.startPerfMs);
  }

  function publishAccelActivity() {
    if (!isRunActive(state.run)) {
      clearActivity(ACCEL_ACTIVITY_ID);
      return;
    }

    var run = state.run;
    var isRunning = run.stage === 'running';
    var detail = getAccelActivityDetail(run);

    setActivity(ACCEL_ACTIVITY_ID, {
      kind: 'accel',
      order: 20,
      route: '#/accel',
      state: isRunning ? 'running' : run.stage,
      labelKey: isRunning ? 'activityAccelRunning' : 'activityAccelArmed',
      sampleCount: Number.isFinite(run.sampleCount) ? run.sampleCount : 0,
      startedAtMs: getAccelActivityStartedAtMs(run),
      ...detail,
    });
  }

  function renderPresetButtons() {
    var html = '';
    var selectedId = resolvePresetIdForUnits(
      state.settings.selectedPresetId,
      state.settings.speedUnit,
      state.settings.distanceUnit
    );
    var availablePresets = getAvailablePresetDefinitions();

    for (var index = 0; index < availablePresets.length; index += 1) {
      var preset = availablePresets[index];
      var pressed = preset.id === selectedId ? 'true' : 'false';
      var presetCopy = copyPreset(preset);
      html +=
        '<button type="button" class="accel-preset-btn" data-preset-id="' +
        escapeHtml(preset.id) +
        '" aria-pressed="' +
        pressed +
        '">';
      html +=
        '<span class="accel-preset-title">' + escapeHtml(getPresetLabel(presetCopy)) + '</span>';
      html +=
        '<span class="accel-preset-meta">' + escapeHtml(getPresetMetaLabel(presetCopy)) + '</span>';
      html += '</button>';
    }

    elements.presetGrid.innerHTML = html;
    elements.customRangePanel.hidden = selectedId !== 'custom';
    elements.customStartInput.value = formatInputSpeedValue(state.settings.customStart);
    elements.customEndInput.value = formatInputSpeedValue(state.settings.customEnd);
  }

  function renderControlSelections() {
    var rolloutPressed = state.settings.rolloutEnabled;
    elements.rolloutOff.setAttribute('aria-pressed', String(!rolloutPressed));
    elements.rolloutOn.setAttribute('aria-pressed', String(rolloutPressed));
    elements.launchThresholdHalf.setAttribute(
      'aria-pressed',
      String(isSameNumber(state.settings.launchThresholdMs, 0.5 * MPH_TO_MS))
    );
    elements.launchThresholdOne.setAttribute(
      'aria-pressed',
      String(isSameNumber(state.settings.launchThresholdMs, 1 * MPH_TO_MS))
    );
    elements.speedUnitMph.setAttribute('aria-pressed', String(state.settings.speedUnit === 'mph'));
    elements.speedUnitKmh.setAttribute('aria-pressed', String(state.settings.speedUnit === 'kmh'));
    elements.distanceUnitFt.setAttribute(
      'aria-pressed',
      String(state.settings.distanceUnit === 'ft')
    );
    elements.distanceUnitM.setAttribute(
      'aria-pressed',
      String(state.settings.distanceUnit === 'm')
    );
    elements.launchThresholdHalf.textContent = formatThresholdOptionLabel(0.5 * MPH_TO_MS);
    elements.launchThresholdOne.textContent = formatThresholdOptionLabel(1 * MPH_TO_MS);

    if (state.settings.selectedPresetId === 'custom' && !isCustomRangeValid()) {
      elements.customRangeNotice.textContent = t('accelCustomInvalid');
    } else {
      elements.customRangeNotice.textContent = '';
    }
  }

  function startUiTimer() {
    if (isSpaRuntime && !state.viewMounted) return;
    if (state.uiTimerId) window.clearInterval(state.uiTimerId);
    state.uiTimerId = window.setInterval(renderRealtimeUi, TIMER_TICK_MS);
  }

  function stopUiTimer() {
    if (!state.uiTimerId) return;
    window.clearInterval(state.uiTimerId);
    state.uiTimerId = null;
  }

  function stopRealtimeTracking() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    stopUiTimer();
    pauseReplayPlayback();
  }

  function shouldKeepRealtimeTrackingInBackground() {
    return isSpaRuntime && !state.viewMounted && isRunActive(state.run);
  }

  function stopHiddenRealtimeTrackingIfIdle() {
    if (!isSpaRuntime || state.viewMounted || shouldKeepRealtimeTrackingInBackground()) return;
    stopRealtimeTracking();
  }

  function cancelPendingMeasurementFrames() {
    if (resultLocationMeasureFrame !== null) {
      window.cancelAnimationFrame(resultLocationMeasureFrame);
      resultLocationMeasureFrame = null;
    }
    if (historyDetailMeasureFrame !== null) {
      window.cancelAnimationFrame(historyDetailMeasureFrame);
      historyDetailMeasureFrame = null;
    }
  }

  function mountAccelController() {
    state.viewMounted = true;
    if (!state.initialized) return;

    elements = getAccelElements();
    applyTranslations();
    liveSpeedometer.resize();
    handleWindowResize();
    renderAll();
    startUiTimer();
    updatePermissionState();
    ensureWatch();
  }

  function unmountAccelController() {
    if (!state.viewMounted && isSpaRuntime) return;

    var keepRealtimeTrackingInBackground = isRunActive(state.run);
    closePanel();
    if (keepRealtimeTrackingInBackground) {
      stopUiTimer();
      pauseReplayPlayback();
    } else {
      stopRealtimeTracking();
    }
    destroyResultGraph();
    cancelPendingMeasurementFrames();
    if (state.actionNoticeTimerId) {
      window.clearTimeout(state.actionNoticeTimerId);
      state.actionNoticeTimerId = null;
    }
    state.viewMounted = false;
    document.body.classList.remove('accel-sheet-open');
  }

  function handleSingleTabOwnershipChange(event) {
    if (event?.detail?.owned !== false) return;
    stopRealtimeTracking();
    clearActivity(ACCEL_ACTIVITY_ID);
  }

  async function restoreAfterPageShow(event) {
    if (isSpaRuntime && !state.viewMounted) return;
    if (event?.persisted !== true) return;
    if (!isSpaRuntime && !(await ensureSingleTabOwnership())) {
      return;
    }

    startUiTimer();
    updatePermissionState();
    ensureWatch();
    renderAll();
  }

  function renderRealtimeUi() {
    if (isSpaRuntime && !state.viewMounted) return;
    var replayChanged = updateReplayPlaybackClock();
    renderControlState();
    renderStatusPanel();
    renderLivePanel();
    renderDiagnostics();
    if (state.openPanel === 'results' && (state.replay.playing || replayChanged)) {
      renderResultCard();
    }
  }

  function handlePresetClick(event) {
    var button = event.target.closest('[data-preset-id]');
    if (!button) return;

    state.settings.selectedPresetId = button.getAttribute('data-preset-id');
    saveSettings();
    renderPresetButtons();
    renderControlSelections();
    renderAll();
  }

  function handleCustomInput() {
    state.settings.customStart = normalizeCustomSpeedInput(elements.customStartInput.value, 0);
    state.settings.customEnd = normalizeCustomSpeedInput(elements.customEndInput.value, 0);
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleSpeedUnitClick(event) {
    var button = event.currentTarget;
    var nextUnit = normalizeSpeedUnit(button.getAttribute('data-unit'));
    if (nextUnit === state.settings.speedUnit) return;

    state.settings.customStart = convertSpeedInputValue(
      state.settings.customStart,
      state.settings.speedUnit,
      nextUnit
    );
    state.settings.customEnd = convertSpeedInputValue(
      state.settings.customEnd,
      state.settings.speedUnit,
      nextUnit
    );
    state.settings.speedUnit = nextUnit;
    markUnitBootstrapManualSelection({ speedUnit: nextUnit });
    syncSelectedPresetForUnits();
    saveSettings();
    renderControlSelections();
    renderPresetButtons();
    renderAll();
  }

  function handleDistanceUnitClick(event) {
    var button = event.currentTarget;
    var nextUnit = normalizeDistanceUnit(button.getAttribute('data-unit'));
    if (nextUnit === state.settings.distanceUnit) return;

    state.settings.distanceUnit = nextUnit;
    markUnitBootstrapManualSelection({ distanceUnit: nextUnit });
    syncSelectedPresetForUnits();
    saveSettings();
    renderControlSelections();
    renderPresetButtons();
    renderAll();
  }

  function handleRolloutClick(event) {
    state.settings.rolloutEnabled = event.currentTarget.getAttribute('data-rollout') === 'on';
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleThresholdClick(event) {
    state.settings.launchThresholdMs =
      event.currentTarget.getAttribute('data-threshold') === '1' ? 1 * MPH_TO_MS : 0.5 * MPH_TO_MS;
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleNotesInput() {
    state.settings.notes = elements.runNotes.value || '';
    saveSettings();
  }

  function isRunActive(run) {
    return Boolean(
      run && (run.stage === 'armed' || run.stage === 'waiting_rollout' || run.stage === 'running')
    );
  }

  function handleArm() {
    var preset = getSelectedPreset();

    primeFinishAudio();

    if (!state.geolocationSupported) {
      setActionNotice('accelNoGeolocation');
      renderAll();
      return;
    }

    if (state.settings.selectedPresetId === 'custom' && !isCustomRangeValid()) {
      setActionNotice('accelCustomInvalid');
      renderAll();
      return;
    }

    if (!isGpsReady()) {
      setActionNotice('accelNeedGps');
      renderAll();
      return;
    }

    if (isRunActive(state.run)) {
      return;
    }

    state.run = createRun(preset);
    setActionNotice(preset.standingStart ? 'accelArmedStandingNotice' : 'accelArmedRollingNotice');
    publishAccelActivity();
    renderAll();
  }

  function handleCancel() {
    if (!state.run || state.run.stage === 'completed') return;
    state.run = null;
    setActionNotice('accelRunCancelledNotice');
    publishAccelActivity();
    renderAll();
  }

  function handleRunPrimaryAction() {
    if (isRunActive(state.run)) {
      handleCancel();
      return;
    }

    handleArm();
  }

  function handleClearHistory() {
    if (!state.runs.length) return;
    if (!window.confirm(t('accelClearHistoryConfirm'))) return;

    state.runs.forEach(function (run) {
      void queueCloudSyncDeletion({
        entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
        recordId: run.id,
      });
    });

    resetReplayState({ preserveAxisMode: true });
    state.runs = [];
    state.latestResult = null;
    state.selectedResultId = '';
    saveRuns();
    setActionNotice('accelHistoryClearedNotice');
    renderAll();
  }

  function handleHistoryClick(event) {
    var button = event.target.closest('[data-history-action][data-run-id]');
    if (!button) return;

    var runId = button.getAttribute('data-run-id');
    var run = findRunById(runId);
    if (!run) return;

    var action = button.getAttribute('data-history-action');
    if (action === 'load') {
      pauseReplayPlayback();
      selectResult(runId);
      openPanel('results');
      scrollResultsPanelToTop();
      setActionNotice('accelResultLoadedNotice');
      renderAll();
      return;
    }

    if (action === 'replay') {
      void (async function () {
        selectResult(runId);
        openPanel('results');
        scrollResultsPanelToTop();
        renderAll();
        if (await ensureSelectedResultTelemetry(runId, { selectionSnapshotId: runId })) {
          renderAll();
        }
        if (state.selectedResultId !== runId) return;
        await startReplayPlayback({ restart: true });
        renderAll();
      })();
      return;
    }

    if (action !== 'delete') return;
    if (!window.confirm(t('accelDeleteRunConfirm', { label: getPresetLabel(run) }))) return;

    state.runs = state.runs.filter(function (entry) {
      return entry.id !== runId;
    });
    state.latestResult = state.runs.length ? state.runs[0] : null;
    if (state.selectedResultId === runId) selectResult(null);
    saveRuns();
    void queueCloudSyncDeletion({
      entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
      recordId: runId,
    });
    renderAll();
  }

  function findRunById(runId) {
    for (var index = 0; index < state.runs.length; index += 1) {
      if (state.runs[index].id === runId) return state.runs[index];
    }
    return null;
  }

  function getDisplayedResult() {
    if (state.selectedResultId) {
      return findRunById(state.selectedResultId);
    }
    return state.latestResult;
  }

  function selectResult(runId) {
    var run = runId ? findRunById(runId) : null;
    var nextResultId = run ? run.id : state.latestResult ? state.latestResult.id : '';
    if (state.selectedResultId !== nextResultId) {
      resetReplayState({ preserveAxisMode: true });
    }
    state.selectedResultId = nextResultId;

    if (nextResultId) {
      void ensureSelectedResultTelemetry(nextResultId, {
        selectionSnapshotId: nextResultId,
      }).then(function (restored) {
        if (restored) renderAll();
      });
    }
  }

  function handleReplayToggle() {
    if (state.replay.playing || state.replay.playPending) pauseReplayPlayback();
    else void startReplayPlayback();
    renderResultCard();
  }

  function handleReplayRestart() {
    pauseReplayPlayback();
    cancelReplayMapApproach({ markPlayed: true });
    state.replay.engaged = true;
    state.replay.playing = false;
    state.replay.playPending = false;
    state.replay.positionMs = 0;
    state.replay.playbackStartElapsedMs = 0;
    state.replay.playbackStartPerfMs = 0;
    renderResultCard();
  }

  function handleReplayProgressInput() {
    pauseReplayPlayback();
    cancelReplayMapApproach({ markPlayed: true });
    setReplayPositionFromAxisValue(Number(elements.resultReplayProgress.value));
    renderResultCard();
  }

  function handleReplayAxisClick(event) {
    var nextAxisMode =
      event.currentTarget.getAttribute('data-axis') === 'distance' ? 'distance' : 'time';
    if (state.replay.axisMode === nextAxisMode) return;
    state.replay.axisMode = nextAxisMode;
    renderResultCard();
  }

  function scrollResultsPanelToTop() {
    if (!elements.resultsPanel) return;
    var body = elements.resultsPanel.querySelector('.accel-sheet-body');
    if (body && typeof body.scrollTo === 'function') body.scrollTo({ top: 0, behavior: 'smooth' });
    else if (body) body.scrollTop = 0;
  }

  function bindReplayChartScrub(canvas) {
    if (!canvas) return;
    canvas.addEventListener('pointerdown', handleReplayChartPointerDown);
    canvas.addEventListener('pointermove', handleReplayChartPointerMove);
    canvas.addEventListener('pointerup', handleReplayChartPointerUp);
    canvas.addEventListener('pointercancel', handleReplayChartPointerUp);
    canvas.addEventListener('lostpointercapture', handleReplayChartPointerUp);
  }

  function setReplayChartSheetOpen(nextOpen) {
    state.replay.chartSheetOpen = Boolean(nextOpen);
    state.replay.chartScrubMetric = '';
    if (!state.replay.chartSheetOpen) {
      replayCharts.destroy();
    }
    if (elements.resultReplayChartSheet)
      elements.resultReplayChartSheet.hidden = !state.replay.chartSheetOpen;
    document.body.classList.toggle('accel-replay-chart-sheet-open', state.replay.chartSheetOpen);
    if (state.replay.chartSheetOpen)
      focusElement(elements.closeResultReplayChartSheet || elements.resultReplayChartSheet);
    else if (state.openPanel === 'results') focusElement(elements.resultReplayChartsBtn);
  }

  function getReplayDisplayPoint(source) {
    if (!source) return null;
    return getAccelReplayFrameAtElapsedMs(source, state.replay.positionMs);
  }

  function handleReplayChartsOpen() {
    var result = getDisplayedResult();
    var source = ensureReplaySource(result);
    if (!source) return;
    setReplayChartSheetOpen(true);
    renderResultCard();
  }

  function handleReplayChartsClose() {
    setReplayChartSheetOpen(false);
    renderResultCard();
  }

  function handleReplayChartFilterInput() {
    var startRatio = Number(elements.resultReplaySheetFilterStart.value || 0) / 1000;
    var endRatio = Number(elements.resultReplaySheetFilterEnd.value || 1000) / 1000;
    setReplayChartFilterRange(startRatio, endRatio);
  }

  function scrubReplayChartAtClientX(metricKey, clientX) {
    var axisValue = replayCharts.getAxisValueFromClientX(metricKey, clientX);
    if (!isFiniteNumber(axisValue)) return;
    pauseReplayPlayback();
    cancelReplayMapApproach({ markPlayed: true });
    setReplayPositionFromAxisValue(axisValue);
    renderResultCard();
  }

  function handleReplayChartPointerDown(event) {
    var metricKey = event.currentTarget.getAttribute('data-accel-replay-scrub');
    if (!metricKey) return;

    event.preventDefault();
    state.replay.chartScrubMetric = metricKey;
    state.replay.engaged = true;
    if (event.currentTarget.setPointerCapture && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer-capture failures.
      }
    }
    scrubReplayChartAtClientX(metricKey, event.clientX);
  }

  function handleReplayChartPointerMove(event) {
    var metricKey = event.currentTarget.getAttribute('data-accel-replay-scrub');
    if (!metricKey || state.replay.chartScrubMetric !== metricKey) return;
    scrubReplayChartAtClientX(metricKey, event.clientX);
  }

  function handleReplayChartPointerUp() {
    state.replay.chartScrubMetric = '';
  }

  function resetReplayState(options) {
    var preserveAxisMode = !options || options.preserveAxisMode !== false;
    var nextAxisMode = preserveAxisMode ? state.replay.axisMode : 'time';

    state.replay.playing = false;
    state.replay.playPending = false;
    state.replay.engaged = false;
    state.replay.positionMs = 0;
    state.replay.playbackStartPerfMs = 0;
    state.replay.playbackStartElapsedMs = 0;
    state.replay.sourceResultId = '';
    state.replay.source = null;
    state.replay.introPlayed = false;
    state.replay.axisMode = nextAxisMode;
    state.replay.chartScrubMetric = '';
    state.replay.chartFilterStartRatio = 0;
    state.replay.chartFilterEndRatio = 1;
    resetReplayMapIntroState();
    setReplayChartSheetOpen(false);
  }

  function resetReplayMapIntroState() {
    cancelReplayMapApproach();
  }

  function cancelReplayMapApproach(options) {
    var markPlayed = Boolean(options && options.markPlayed);
    replayMapIntroToken += 1;
    replayMapIntroPromise = null;
    replayMap.cancelApproachAnimation();
    state.replay.introPlayed = markPlayed ? true : false;
  }

  function runReplayMapApproach(result, replaySource) {
    if (!result || !replaySource || !replaySource.hasGeoPath) return Promise.resolve();
    if (state.openPanel !== 'results') return Promise.resolve();
    if (state.replay.introPlayed) return Promise.resolve();
    if (replayMapIntroPromise) return replayMapIntroPromise;

    var introToken = replayMapIntroToken;
    replayMapIntroPromise = (async function () {
      await replayMap.init();
      if (
        introToken !== replayMapIntroToken ||
        state.openPanel !== 'results' ||
        !state.replay.source ||
        state.replay.sourceResultId !== result.id
      ) {
        return;
      }

      replayMap.setSource(replaySource, { resetCamera: false });
      await replayMap.runApproachAnimation();

      if (
        introToken !== replayMapIntroToken ||
        state.openPanel !== 'results' ||
        !state.replay.source ||
        state.replay.sourceResultId !== result.id
      ) {
        return;
      }

      state.replay.introPlayed = true;
    })().finally(function () {
      if (introToken === replayMapIntroToken) {
        replayMapIntroPromise = null;
      }
    });

    return replayMapIntroPromise;
  }

  function ensureReplaySource(result) {
    if (!result) {
      resetReplayState({ preserveAxisMode: true });
      return null;
    }

    if (state.replay.source && state.replay.sourceResultId === result.id) {
      return state.replay.source;
    }

    state.replay.playing = false;
    state.replay.playPending = false;
    state.replay.engaged = false;
    state.replay.positionMs = 0;
    state.replay.playbackStartPerfMs = 0;
    state.replay.playbackStartElapsedMs = 0;
    state.replay.sourceResultId = result.id;
    resetReplayMapIntroState();
    state.replay.source = buildAccelReplaySource(result);
    return state.replay.source;
  }

  function getReplayAxisModeForSource(source) {
    if (!source || !source.hasDistanceAxis) return 'time';
    return state.replay.axisMode === 'distance' ? 'distance' : 'time';
  }

  function getReplayAxisMaxValue(source, axisMode) {
    if (!source) return 0;
    return axisMode === 'distance' ? source.totalDistanceM : source.durationMs;
  }

  function getReplayChartAxisRange(axisMax, startRatio, endRatio) {
    var safeAxisMax = isFiniteNumber(axisMax) && axisMax > 0 ? axisMax : 0;

    if (safeAxisMax <= 0) {
      return {
        startRatio: 0,
        endRatio: 1,
        min: 0,
        max: 1,
      };
    }

    var safeStartRatio = isFiniteNumber(startRatio) ? clamp(startRatio, 0, 1) : 0;
    var safeEndRatio = isFiniteNumber(endRatio) ? clamp(endRatio, 0, 1) : 1;

    if (safeStartRatio > safeEndRatio) {
      var temp = safeStartRatio;
      safeStartRatio = safeEndRatio;
      safeEndRatio = temp;
    }

    var minGapRatio = 0.02;
    if (safeEndRatio - safeStartRatio < minGapRatio) {
      if (safeEndRatio >= 1) {
        safeEndRatio = 1;
        safeStartRatio = Math.max(0, safeEndRatio - minGapRatio);
      } else {
        safeEndRatio = Math.min(1, safeStartRatio + minGapRatio);
        if (safeEndRatio - safeStartRatio < minGapRatio) {
          safeStartRatio = Math.max(0, safeEndRatio - minGapRatio);
        }
      }
    }

    return {
      startRatio: safeStartRatio,
      endRatio: safeEndRatio,
      min: safeAxisMax * safeStartRatio,
      max: safeAxisMax * safeEndRatio,
    };
  }

  function getReplayChartAxisMaxValue(source, axisMode) {
    if (!source) return 0;
    if (axisMode === 'distance') return Math.max(0, source.totalDistanceM || 0);
    return Math.max(0, (source.durationMs || 0) / 1000);
  }

  function getReplayChartRangeForSource(source, axisMode) {
    return getReplayChartAxisRange(
      getReplayChartAxisMaxValue(source, axisMode),
      state.replay.chartFilterStartRatio,
      state.replay.chartFilterEndRatio
    );
  }

  function getReplayPositionPoint(source) {
    if (!source || !state.replay.engaged) return null;
    return getAccelReplayFrameAtElapsedMs(source, state.replay.positionMs);
  }

  function pauseReplayPlayback() {
    if (state.replay.playPending && !state.replay.playing) {
      state.replay.playPending = false;
      return;
    }

    if (!state.replay.playing) return;

    var result = getDisplayedResult();
    var source = ensureReplaySource(result);
    if (!source) {
      state.replay.playing = false;
      state.replay.playPending = false;
      return;
    }

    var nextElapsedMs =
      state.replay.playbackStartElapsedMs + (performance.now() - state.replay.playbackStartPerfMs);
    state.replay.positionMs = clamp(nextElapsedMs, 0, source.durationMs);
    state.replay.playing = false;
    state.replay.playPending = false;
  }

  async function startReplayPlayback(options) {
    var result = getDisplayedResult();
    var source = ensureReplaySource(result);
    if (!source) return;
    if (state.replay.playing || state.replay.playPending) return;

    var shouldRestart = Boolean(options && options.restart);
    if (shouldRestart || state.replay.positionMs >= source.durationMs) {
      state.replay.positionMs = 0;
    }

    state.replay.engaged = true;
    state.replay.playPending = true;
    renderResultCard();

    if (replayMapIntroPromise) {
      await replayMapIntroPromise;
    } else if (!state.replay.introPlayed) {
      await runReplayMapApproach(result, source);
    }

    if (!state.replay.playPending) {
      renderResultCard();
      return;
    }

    state.replay.playPending = false;
    state.replay.playing = true;
    state.replay.playbackStartPerfMs = performance.now();
    state.replay.playbackStartElapsedMs = state.replay.positionMs;
    renderResultCard();
  }

  function updateReplayPlaybackClock() {
    if (!state.replay.playing) return false;

    var result = getDisplayedResult();
    var source = ensureReplaySource(result);
    if (!source) {
      state.replay.playing = false;
      state.replay.playPending = false;
      return false;
    }

    var nextElapsedMs =
      state.replay.playbackStartElapsedMs + (performance.now() - state.replay.playbackStartPerfMs);
    var clampedElapsedMs = clamp(nextElapsedMs, 0, source.durationMs);
    var changed = Math.abs(clampedElapsedMs - state.replay.positionMs) > 0.5;
    state.replay.positionMs = clampedElapsedMs;

    if (clampedElapsedMs >= source.durationMs) {
      state.replay.playing = false;
      state.replay.playPending = false;
      state.replay.playbackStartPerfMs = 0;
      state.replay.playbackStartElapsedMs = clampedElapsedMs;
    }

    return changed;
  }

  function setReplayPositionFromAxisValue(value) {
    var result = getDisplayedResult();
    var source = ensureReplaySource(result);
    if (!source) return;

    var axisMode = getReplayAxisModeForSource(source);
    state.replay.engaged = true;
    state.replay.playing = false;

    if (axisMode === 'distance') {
      var replayPoint = getAccelReplayFrameAtDistanceM(source, value);
      state.replay.positionMs = replayPoint ? replayPoint.elapsedMs : 0;
      return;
    }

    state.replay.positionMs = clamp(value, 0, source.durationMs);
  }

  function setReplayChartFilterRange(startRatio, endRatio) {
    var axisRange = getReplayChartAxisRange(1, startRatio, endRatio);
    if (
      state.replay.chartFilterStartRatio === axisRange.startRatio &&
      state.replay.chartFilterEndRatio === axisRange.endRatio
    ) {
      return;
    }

    state.replay.chartFilterStartRatio = axisRange.startRatio;
    state.replay.chartFilterEndRatio = axisRange.endRatio;
    renderResultCard();
  }

  function formatReplayAxisValue(value, axisMode) {
    if (axisMode === 'distance') return formatRunDistance(value);
    return formatRunSeconds(value) + ' s';
  }

  function formatReplayChartAxisValue(value, axisMode) {
    if (axisMode === 'distance') return formatRunDistance(value);
    return formatRunSeconds(value * 1000) + ' s';
  }

  function isReplayableResult(result) {
    if (!result) return false;
    if (Array.isArray(result.sampleLog) && result.sampleLog.length >= 2) return true;
    return Boolean(Array.isArray(result.speedTrace) && result.speedTrace.length >= 2);
  }

  function createRun(preset) {
    return createRunState({
      preset: preset,
      settings: state.settings,
      partials: buildRunPartials(preset, state.settings),
      nowMs: Date.now(),
      perfMs: performance.now(),
    });
  }

  function ensureWatch() {
    if (isSpaRuntime && !state.viewMounted) return;
    if (!state.geolocationSupported || state.watchId !== null) return;

    try {
      state.watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handleGeoError,
        GEO_OPTIONS
      );
    } catch (error) {
      state.watchId = null;
      setActionNotice('accelNoGeolocation');
    }
  }

  function updatePermissionState() {
    if (isSpaRuntime && !state.viewMounted) return;
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      state.permissionState = state.geolocationSupported ? 'unknown' : 'unsupported';
      renderAll();
      return;
    }

    navigator.permissions
      .query({ name: 'geolocation' })
      .then(function (status) {
        if (isSpaRuntime && !state.viewMounted) return;
        state.permissionStatus = status;
        state.permissionState = status.state;
        renderAll();

        var handler = function () {
          if (isSpaRuntime && !state.viewMounted) return;
          state.permissionState = status.state;
          renderAll();
        };

        if (typeof status.addEventListener === 'function')
          status.addEventListener('change', handler);
        else status.onchange = handler;
      })
      .catch(function () {
        if (isSpaRuntime && !state.viewMounted) return;
        state.permissionState = state.geolocationSupported ? 'unknown' : 'unsupported';
        renderAll();
      });
  }

  function handleGeoError(error) {
    if (isSpaRuntime && !state.viewMounted) return;
    if (!error) return;

    if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) state.permissionState = 'denied';
    if (!state.latestSample && error.code === GEO_ERROR_CODE.PERMISSION_DENIED)
      setActionNotice('accelNeedGps');
    renderAll();
  }

  function handlePosition(position) {
    var sample = createLiveSample({
      position: position,
      previousSample: state.latestSample,
      rawPerfMs: performance.now(),
      receivedAtMs: Date.now(),
    });
    var deltaMs = sample.deltaMs;

    state.latestSample = sample;
    state.sessionSampleCount += 1;

    if (isFiniteNumber(deltaMs) && deltaMs > 0) {
      state.sessionIntervals.push(deltaMs);
      state.recentIntervals.push(deltaMs);
      if (state.recentIntervals.length > RECENT_INTERVAL_WINDOW) state.recentIntervals.shift();
    }

    state.currentQuality = buildLiveQuality({
      sessionSampleCount: state.sessionSampleCount,
      recentIntervals: state.recentIntervals,
      latestSample: state.latestSample,
      latestSampleStale: isLatestSampleStale(),
      latestSampleSparse: isLatestSampleSparse(),
    });
    maybeBootstrapUnitsFromSample(sample);

    if (
      state.run &&
      (state.run.stage === 'armed' ||
        state.run.stage === 'waiting_rollout' ||
        state.run.stage === 'running')
    ) {
      processRunSample(sample);
      publishAccelActivity();
    }

    renderAll();
  }

  function processRunSample(sample) {
    var run = state.run;
    if (!run) return;

    if (run.sampleCount === 0) {
      run.sampleCount = 1;
      if (sample.accuracyM !== null) run.accuracyValues.push(sample.accuracyM);
      if (sample.rawSpeedMs === null) run.nullSpeedCount += 1;
      if (sample.speedSource === 'derived') run.derivedSpeedCount += 1;
      appendRunSampleLog(run, sample);
      run.lastSample = sample;
      return;
    }

    var previousSample = run.lastSample;
    if (!previousSample) {
      appendRunSampleLog(run, sample);
      run.lastSample = sample;
      return;
    }

    run.sampleCount += 1;
    if (isFiniteNumber(sample.deltaMs) && sample.deltaMs > 0)
      run.intervalValues.push(sample.deltaMs);
    if (sample.accuracyM !== null) run.accuracyValues.push(sample.accuracyM);
    if (sample.rawSpeedMs === null) run.nullSpeedCount += 1;
    if (sample.speedSource === 'derived') run.derivedSpeedCount += 1;
    if (sample.stale) run.staleCount += 1;
    if (sample.sparse) run.sparseCount += 1;

    run.prevDistanceSinceArmM = run.distanceSinceArmM;
    run.distanceSinceArmM += sample.segmentDistanceM;

    var previousSpeed = previousSample.speedMs;
    var currentSpeed = sample.speedMs;

    if (run.preset.standingStart) {
      if (run.launchCrossPerfMs === null) {
        var launchCross = interpolateSpeedCrossing(previousSample, sample, run.launchThresholdMs);
        if (launchCross) {
          run.launchCrossPerfMs = launchCross.perfMs;
          run.launchCrossDistanceM = interpolateValue(
            run.prevDistanceSinceArmM,
            run.distanceSinceArmM,
            launchCross.ratio
          );
          run.launchCrossAltitudeM = interpolateMeasurement(
            previousSample.altitudeM,
            sample.altitudeM,
            launchCross.ratio
          );
        }
      }

      if (run.launchCrossPerfMs !== null && run.startPerfMs === null) {
        if (!run.rolloutApplied) {
          run.startPerfMs = run.launchCrossPerfMs;
          run.startDistanceM = run.launchCrossDistanceM;
          run.startAltitudeM = run.launchCrossAltitudeM;
          run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
          run.startTraceSpeedMs = run.launchThresholdMs;
          run.startSpeedSource = sample.speedSource;
          run.stage = 'running';
        } else {
          run.stage = 'waiting_rollout';
          var rolloutTarget = run.launchCrossDistanceM + run.rolloutDistanceM;
          var rolloutCross = interpolateRangeCrossing(
            run.prevDistanceSinceArmM,
            run.distanceSinceArmM,
            rolloutTarget,
            previousSample.perfMs,
            sample.perfMs
          );

          if (rolloutCross) {
            run.startPerfMs = rolloutCross.perfMs;
            run.startDistanceM = rolloutTarget;
            run.startAltitudeM = interpolateMeasurement(
              previousSample.altitudeM,
              sample.altitudeM,
              rolloutCross.ratio
            );
            run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
            run.startTraceSpeedMs = interpolateValue(
              previousSpeed,
              currentSpeed,
              rolloutCross.ratio
            );
            run.startSpeedSource = sample.speedSource;
            run.stage = 'running';
          }
        }
      }
    } else if (run.startPerfMs === null) {
      var rollingCross = interpolateSpeedCrossing(previousSample, sample, run.preset.startSpeedMs);
      if (rollingCross) {
        run.startPerfMs = rollingCross.perfMs;
        run.startDistanceM = interpolateValue(
          run.prevDistanceSinceArmM,
          run.distanceSinceArmM,
          rollingCross.ratio
        );
        run.startAltitudeM = interpolateMeasurement(
          previousSample.altitudeM,
          sample.altitudeM,
          rollingCross.ratio
        );
        run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
        run.startTraceSpeedMs = run.preset.startSpeedMs;
        run.startSpeedSource = sample.speedSource;
        run.stage = 'running';
      }
    }

    if (
      run.startPerfMs !== null &&
      run.startAltitudeM === null &&
      isFiniteNumber(sample.altitudeM)
    ) {
      run.startAltitudeM = sample.altitudeM;
    }
    if (
      run.startPerfMs !== null &&
      run.startAccuracyM === null &&
      isFiniteNumber(sample.accuracyM)
    ) {
      run.startAccuracyM = sample.accuracyM;
    }
    if (run.startPerfMs !== null && !isFiniteNumber(run.startTraceSpeedMs)) {
      run.startTraceSpeedMs = run.preset.standingStart ? 0 : run.preset.startSpeedMs;
    }
    if (run.startPerfMs !== null && !run.startSpeedSource) {
      run.startSpeedSource = sample.speedSource;
    }

    if (run.startPerfMs !== null) {
      ensureSpeedTraceStarted(run);
      seedRunPartialStarts(run);
      updateRunPartials(run, previousSample, sample);
    }

    if (run.startPerfMs !== null && run.finishPerfMs === null) {
      if (run.preset.type === 'speed') {
        var targetCross = interpolateSpeedCrossing(
          previousSample,
          sample,
          run.preset.targetSpeedMs
        );
        if (targetCross && targetCross.perfMs >= run.startPerfMs) {
          run.finishPerfMs = targetCross.perfMs;
          run.finishDistanceM = interpolateValue(
            run.prevDistanceSinceArmM,
            run.distanceSinceArmM,
            targetCross.ratio
          );
          run.finishSpeedMs = run.preset.targetSpeedMs;
          run.finishAltitudeM = interpolateMeasurement(
            previousSample.altitudeM,
            sample.altitudeM,
            targetCross.ratio
          );
          appendSpeedTracePoint(run, run.finishPerfMs - run.startPerfMs, run.finishSpeedMs, {
            distanceM: Math.max(0, run.finishDistanceM - run.startDistanceM),
            altitudeM: run.finishAltitudeM,
            accuracyM: averageFinite(previousSample.accuracyM, sample.accuracyM),
            speedSource: sample.speedSource,
          });
          appendRunSampleLog(run, sample);
          run.lastSample = sample;
          completeRun();
          return;
        }
      } else if (run.preset.type === 'distance') {
        var prevDistanceFromStartM = Math.max(0, run.prevDistanceSinceArmM - run.startDistanceM);
        var currentDistanceFromStartM = Math.max(0, run.distanceSinceArmM - run.startDistanceM);
        var finishCross = interpolateRangeCrossing(
          prevDistanceFromStartM,
          currentDistanceFromStartM,
          run.preset.distanceTargetM,
          previousSample.perfMs,
          sample.perfMs
        );

        if (finishCross) {
          run.finishPerfMs = finishCross.perfMs;
          run.finishDistanceM = run.startDistanceM + run.preset.distanceTargetM;
          run.finishSpeedMs = interpolateValue(previousSpeed, currentSpeed, finishCross.ratio);
          run.finishAltitudeM = interpolateMeasurement(
            previousSample.altitudeM,
            sample.altitudeM,
            finishCross.ratio
          );
          appendSpeedTracePoint(run, run.finishPerfMs - run.startPerfMs, run.finishSpeedMs, {
            distanceM: Math.max(0, run.finishDistanceM - run.startDistanceM),
            altitudeM: run.finishAltitudeM,
            accuracyM: averageFinite(previousSample.accuracyM, sample.accuracyM),
            speedSource: sample.speedSource,
          });
          appendRunSampleLog(run, sample);
          run.lastSample = sample;
          completeRun();
          return;
        }
      }
    }

    if (run.finishPerfMs === null && sample.perfMs >= run.startPerfMs) {
      appendSpeedTracePoint(run, sample.perfMs - run.startPerfMs, sample.speedMs, {
        distanceM: Math.max(0, run.distanceSinceArmM - run.startDistanceM),
        altitudeM: sample.altitudeM,
        accuracyM: sample.accuracyM,
        speedSource: sample.speedSource,
      });
    }

    appendRunSampleLog(run, sample);
    run.lastSample = sample;
  }

  function completeRun() {
    var run = state.run;
    if (!run || run.finishPerfMs === null || run.startPerfMs === null) return;

    var result = buildResult(run, state.settings, {
      getPresetSignature: getPresetSignature,
      buildComparisonSignature: buildComparisonSignature,
    });
    run.stage = 'completed';
    run.result = result;
    publishAccelActivity();
    state.latestResult = result;
    state.runs.unshift(result);
    if (state.runs.length > MAX_RUNS) state.runs = state.runs.slice(0, MAX_RUNS);
    resetReplayState({ preserveAxisMode: true });
    state.selectedResultId = result.id;
    saveRuns();
    queueRunForCloudSync(result);
    enrichRunPlaces(result.id);
    playFinishAudio();
    setActionNotice('accelRunSavedNotice');
    renderAll();
    stopHiddenRealtimeTrackingIfIdle();
  }

  function renderAll() {
    if (isSpaRuntime && !state.viewMounted) return;
    renderControlSelections();
    renderControlState();
    renderStatusPanel();
    renderLivePanel();
    renderResultCard();
    renderDiagnostics();
    renderDebugTables();
    renderHistory();
    renderSheetUi();
  }

  function renderControlState() {
    var hasActiveRun = isRunActive(state.run);
    var customInvalid = state.settings.selectedPresetId === 'custom' && !isCustomRangeValid();
    var primaryLabelKey = hasActiveRun
      ? 'accelCancel'
      : state.run && state.run.stage === 'completed'
        ? 'accelRunAgain'
        : 'accelArm';
    var gpsReady = isGpsReady();
    var primaryLabel = t(primaryLabelKey);

    applyButtonIcon(elements.armRun, hasActiveRun ? IconClose : IconPlay);
    elements.armRun.setAttribute('aria-label', primaryLabel);
    elements.armRun.setAttribute('title', primaryLabel);
    elements.armRun.classList.toggle('accel-toolbar-btn-start', !hasActiveRun);
    elements.armRun.classList.toggle('accel-toolbar-btn-cancel', hasActiveRun);
    elements.armRun.disabled = hasActiveRun
      ? false
      : !state.geolocationSupported || customInvalid || !gpsReady;
    elements.clearHistory.disabled = !state.runs.length;
  }

  function renderStatusPanel() {
    var speedUnit = state.settings.speedUnit;
    var permissionLabel = getPermissionLabel(state.permissionState);
    var ready = isGpsReady();
    var liveQuality = isRunActive(state.run)
      ? buildCurrentRunQuality(
          state.run,
          state.run.startPerfMs !== null ? performance.now() - state.run.startPerfMs : 0
        )
      : buildLiveQuality({
          sessionSampleCount: state.sessionSampleCount,
          recentIntervals: state.recentIntervals,
          latestSample: state.latestSample,
          latestSampleStale: isLatestSampleStale(),
          latestSampleSparse: isLatestSampleSparse(),
        });
    var qualityLabel = liveQuality ? getQualityLabel(liveQuality.grade) : t('accelUnavailable');
    var readyLabel = ready ? t('accelReadyYes') : t('accelReadyNo');
    var accuracyLabel = formatDistanceMeasurement(
      state.latestSample ? state.latestSample.accuracyM : null
    );

    elements.toolbarPermissionValue.textContent = readyLabel;
    elements.toolbarQualityValue.textContent = accuracyLabel;
    elements.toolbarStateValue.textContent = qualityLabel;

    elements.permissionValue.textContent = permissionLabel;
    elements.gpsReadyValue.textContent = readyLabel;
    elements.latestAccuracyValue.textContent = accuracyLabel;
    elements.observedHzValue.textContent = formatHz(liveQuality ? liveQuality.averageHz : null);
    elements.statusSpeedValue.textContent = formatSpeedValue(
      state.latestSample ? state.latestSample.speedMs : null,
      speedUnit
    );
    elements.statusHeadingValue.textContent = formatHeading(
      state.latestSample ? state.latestSample.headingDeg : null
    );
    elements.statusAltitudeValue.textContent = formatDistanceMeasurement(
      state.latestSample ? state.latestSample.altitudeM : null
    );
    elements.speedSourceValue.textContent = getSpeedSourceLabel(
      state.latestSample ? state.latestSample.speedSource : null
    );
  }

  function renderSheetUi() {
    var setupOpen = state.openPanel === 'setup';
    var resultsOpen = state.openPanel === 'results';
    var hasResults = Boolean(getDisplayedResult());
    var setupSummary = getSetupSummary();
    var resultsSummary = getResultsSummary();

    elements.setupTriggerValue.textContent = setupSummary.title;
    elements.setupTriggerMeta.textContent = setupSummary.meta;
    elements.resultsTriggerValue.textContent = resultsSummary.title;
    elements.resultsTriggerMeta.textContent = resultsSummary.meta;
    elements.setupPanelStatus.textContent = setupSummary.title + ' · ' + setupSummary.meta;
    elements.resultsPanelStatus.textContent = getResultsPanelStatusText();

    elements.setupTrigger.setAttribute('aria-expanded', String(setupOpen));
    elements.resultsTrigger.setAttribute('aria-expanded', String(resultsOpen));
    elements.setupTrigger.classList.toggle('is-open', setupOpen);
    elements.resultsTrigger.classList.toggle('is-open', resultsOpen);
    elements.toolbarSetup.setAttribute('aria-expanded', String(setupOpen));
    elements.toolbarSetup.setAttribute('aria-pressed', String(setupOpen));
    elements.toolbarResults.setAttribute('aria-expanded', String(resultsOpen));
    elements.toolbarResults.setAttribute('aria-pressed', String(resultsOpen));
    elements.toolbarResults.disabled = !hasResults;

    elements.sheetBackdrop.hidden = !(setupOpen || resultsOpen);
    elements.setupPanel.hidden = !setupOpen;
    elements.resultsPanel.hidden = !resultsOpen;

    document.body.classList.toggle('accel-sheet-open', setupOpen || resultsOpen);
    if (resultsOpen) {
      requestResultGraphRefresh();
      queueResultLocationOverflowSync();
      queueHistoryDetailOverflowSync();
    } else {
      destroyResultGraph();
      queueResultLocationOverflowSync();
      queueHistoryDetailOverflowSync();
    }
  }

  function renderLiveSpeedometer(preset, liveState) {
    var speedUnit = state.settings.speedUnit;
    var gaugeStep = speedUnit === 'kmh' ? 20 : 10;
    var baseGaugeMax = speedUnit === 'kmh' ? 140 : 80;
    var currentSpeedMs = state.latestSample ? state.latestSample.speedMs : null;
    var currentDisplay = Math.max(
      0,
      isFiniteNumber(currentSpeedMs) ? msToSpeedUnit(currentSpeedMs, speedUnit) : 0
    );
    var markerValue =
      preset && preset.type === 'speed' && isFiniteNumber(preset.targetSpeedMs)
        ? msToSpeedUnit(preset.targetSpeedMs, speedUnit)
        : null;
    var peakDisplay = Math.max(baseGaugeMax, currentDisplay, markerValue || 0);

    if (state.run && state.run.result && isFiniteNumber(state.run.result.finishSpeedMs)) {
      peakDisplay = Math.max(peakDisplay, msToSpeedUnit(state.run.result.finishSpeedMs, speedUnit));
    } else if (state.run && state.run.result && isFiniteNumber(state.run.result.trapSpeedMs)) {
      peakDisplay = Math.max(peakDisplay, msToSpeedUnit(state.run.result.trapSpeedMs, speedUnit));
    }

    liveSpeedometer.render({
      value: currentDisplay,
      valueText: formatLiveSpeedNumber(currentSpeedMs, speedUnit),
      unitText: getSpeedUnitLabel(speedUnit),
      substatusText: liveState,
      maxValue: Math.max(baseGaugeMax, Math.ceil(peakDisplay / gaugeStep) * gaugeStep),
      tickStep: gaugeStep,
      markerValue: markerValue,
    });
  }

  function renderLivePanel() {
    var run = state.run;
    var displayPreset = run ? run.preset : getSelectedPreset();
    var liveState = getRunStateLabel();
    var liveQuality =
      run && run.result
        ? { grade: run.result.qualityGrade }
        : run && run.stage !== 'completed'
          ? buildCurrentRunQuality(
              run,
              run.startPerfMs !== null ? performance.now() - run.startPerfMs : 0
            )
          : buildLiveQuality({
              sessionSampleCount: state.sessionSampleCount,
              recentIntervals: state.recentIntervals,
              latestSample: state.latestSample,
              latestSampleStale: isLatestSampleStale(),
              latestSampleSparse: isLatestSampleSparse(),
            });

    elements.liveStateValue.textContent = liveState;
    elements.liveQualityValue.textContent = liveQuality
      ? getQualityLabel(liveQuality.grade)
      : t('accelUnavailable');
    elements.liveTargetValue.textContent = getPresetLabel(displayPreset);
    elements.liveSlopeValue.textContent = formatSlopePercent(getLiveSlopePercent(run));
    renderLivePartials(run);
    renderLiveSpeedometer(displayPreset, liveState);

    if (run && run.stage === 'completed' && run.result) {
      elements.liveElapsedValue.textContent = formatRunSeconds(run.result.elapsedMs);
      elements.liveDistanceValue.textContent = formatRunDistance(
        isFiniteNumber(run.result.runDistanceM)
          ? run.result.runDistanceM
          : run.result.presetKind === 'distance' && isFiniteNumber(run.result.distanceTargetM)
            ? run.result.distanceTargetM
            : Math.max(0, (run.distanceSinceArmM || 0) - (run.startDistanceM || 0))
      );
      setProgressFromRun(run, displayPreset);
      return;
    }

    if (run && run.startPerfMs !== null) {
      elements.liveElapsedValue.textContent = formatRunSeconds(
        getCurrentClockMs() - run.startPerfMs
      );
    } else {
      elements.liveElapsedValue.textContent = '0.000';
    }

    if (run && run.startPerfMs !== null) {
      elements.liveDistanceValue.textContent = formatRunDistance(
        Math.max(0, run.distanceSinceArmM - run.startDistanceM)
      );
    } else {
      elements.liveDistanceValue.textContent = formatRunDistance(0);
    }

    setProgressFromRun(run, displayPreset);
  }

  function renderLivePartials(run) {
    if (!elements.livePartialsSection || !elements.livePartialsList) return;
    if (!run || !run.partials || !run.partials.length) {
      elements.livePartialsSection.hidden = true;
      elements.livePartialsList.innerHTML = '';
      return;
    }

    var html = '';
    for (var index = 0; index < run.partials.length; index += 1) {
      var partial = run.partials[index];
      var status =
        partial.elapsedMs !== null ? 'done' : run.stage === 'completed' ? 'missed' : 'waiting';
      html += '<div class="accel-partial-row" data-status="' + status + '">';
      html +=
        '<span class="accel-partial-label">' + escapeHtml(getPartialLabel(partial)) + '</span>';
      html +=
        '<strong class="accel-partial-value">' +
        escapeHtml(
          formatPartialValue(
            partial,
            run && run.speedUnit ? run.speedUnit : state.settings.speedUnit,
            run && run.stage === 'completed'
          )
        ) +
        '</strong>';
      html += '</div>';
    }

    elements.livePartialsSection.hidden = false;
    elements.livePartialsList.innerHTML = html;
  }

  function setProgressFromRun(run, preset) {
    var fraction;
    var label;

    if (!run) {
      fraction = 0;
      label = getTargetProgressLabel(preset, 0);
    } else if (run.stage === 'completed' && run.result) {
      fraction = 1;
      if (preset.type === 'distance')
        label = getDistanceProgressLabel(preset.distanceTargetM, preset.distanceTargetM);
      else
        label = getSpeedProgressLabel(
          preset.targetSpeedMs,
          preset.targetSpeedMs,
          state.settings.speedUnit,
          preset.startSpeedMs
        );
    } else if (preset.type === 'distance') {
      var distanceValue =
        run.startPerfMs !== null ? Math.max(0, run.distanceSinceArmM - run.startDistanceM) : 0;
      fraction =
        preset.distanceTargetM > 0 ? clamp(distanceValue / preset.distanceTargetM, 0, 1) : 0;
      label = getDistanceProgressLabel(distanceValue, preset.distanceTargetM);
    } else {
      var currentSpeed = state.latestSample ? state.latestSample.speedMs : 0;
      var baseline = preset.standingStart ? 0 : preset.startSpeedMs;
      var denominator = Math.max(0.1, preset.targetSpeedMs - baseline);
      fraction = clamp((currentSpeed - baseline) / denominator, 0, 1);
      label = getSpeedProgressLabel(
        currentSpeed,
        preset.targetSpeedMs,
        state.settings.speedUnit,
        baseline
      );
    }

    elements.progressLabel.textContent = label;
    elements.progressFill.style.width = String(Math.round(fraction * 1000) / 10) + '%';
  }

  function renderReplayControls(result, replaySource, replayPoint) {
    if (
      !elements.resultReplayControls ||
      !elements.resultReplayToggle ||
      !elements.resultReplayProgress
    )
      return;

    var hasReplay = Boolean(result && replaySource);
    elements.resultReplayControls.hidden = !hasReplay;
    if (elements.resultReplayChartsBtn) {
      elements.resultReplayChartsBtn.hidden = !hasReplay;
      elements.resultReplayChartsBtn.disabled = !hasReplay;
    }
    if (!hasReplay) return;

    var axisMode = getReplayAxisModeForSource(replaySource);
    var currentAxisValue = replayPoint
      ? axisMode === 'distance'
        ? replayPoint.distanceM
        : replayPoint.elapsedMs
      : 0;
    var maxAxisValue = getReplayAxisMaxValue(replaySource, axisMode);
    var playLabel =
      state.replay.playing || state.replay.playPending
        ? t('accelReplayPause')
        : t('accelReplayPlay');

    elements.resultReplayToggle.setAttribute('aria-label', playLabel);
    elements.resultReplayToggle.setAttribute('title', playLabel);
    applyButtonIcon(
      elements.resultReplayToggle,
      state.replay.playing || state.replay.playPending ? IconPause : IconPlay
    );
    elements.resultReplayToggle.disabled = false;
    elements.resultReplayRestart.disabled = false;

    elements.resultReplayProgress.disabled = false;
    elements.resultReplayProgress.max = String(maxAxisValue);
    elements.resultReplayProgress.value = String(currentAxisValue);
    elements.resultReplayCurrentValue.textContent = formatReplayAxisValue(
      currentAxisValue,
      axisMode
    );
    elements.resultReplayMaxValue.textContent = formatReplayAxisValue(maxAxisValue, axisMode);

    elements.resultReplayAxisTime.setAttribute('aria-pressed', String(axisMode === 'time'));
    elements.resultReplayAxisDistance.setAttribute('aria-pressed', String(axisMode === 'distance'));
    elements.resultReplayAxisDistance.disabled = !replaySource.hasDistanceAxis;
  }

  function renderReplayChartControls(replaySource) {
    if (
      !replaySource ||
      !elements.resultReplaySheetFilterStart ||
      !elements.resultReplaySheetFilterEnd
    )
      return;

    var axisMode = getReplayAxisModeForSource(replaySource);
    var axisRange = getReplayChartRangeForSource(replaySource, axisMode);
    var startValue = Math.round(axisRange.startRatio * 1000);
    var endValue = Math.round(axisRange.endRatio * 1000);

    elements.resultReplaySheetFilterStart.value = String(startValue);
    elements.resultReplaySheetFilterEnd.value = String(endValue);
    if (elements.resultReplaySheetFilterStartValue) {
      elements.resultReplaySheetFilterStartValue.textContent = formatReplayChartAxisValue(
        axisRange.min,
        axisMode
      );
    }
    if (elements.resultReplaySheetFilterEndValue) {
      elements.resultReplaySheetFilterEndValue.textContent = formatReplayChartAxisValue(
        axisRange.max,
        axisMode
      );
    }

    if (replayChartFilterController && typeof replayChartFilterController.update === 'function') {
      replayChartFilterController.update();
    }
  }

  function renderReplayChartSheet(result, replaySource, replayPoint) {
    if (!elements.resultReplayChartSheet) return;

    var hasReplay = Boolean(result && replaySource);
    if (!hasReplay) {
      setReplayChartSheetOpen(false);
      replayCharts.destroy();
      return;
    }

    if (!state.replay.chartSheetOpen) {
      elements.resultReplayChartSheet.hidden = true;
      replayCharts.destroy();
      return;
    }

    var axisMode = getReplayAxisModeForSource(replaySource);
    var displayPoint = replayPoint || getReplayDisplayPoint(replaySource);

    elements.resultReplayChartSheet.hidden = false;
    elements.resultReplaySheetAxisTime.setAttribute('aria-pressed', String(axisMode === 'time'));
    elements.resultReplaySheetAxisDistance.setAttribute(
      'aria-pressed',
      String(axisMode === 'distance')
    );
    elements.resultReplaySheetAxisDistance.disabled = !replaySource.hasDistanceAxis;
    renderReplayChartControls(replaySource);

    replayCharts.renderSource(
      replaySource,
      axisMode,
      state.replay.chartFilterStartRatio,
      state.replay.chartFilterEndRatio
    );

    var showAltitude = replayCharts.hasMetricData('altitudeM');
    var showHeading = replayCharts.hasMetricData('headingDeg');
    if (elements.resultReplaySheetAltitudeStage)
      elements.resultReplaySheetAltitudeStage.hidden = !showAltitude;
    if (elements.resultReplaySheetHeadingStage)
      elements.resultReplaySheetHeadingStage.hidden = !showHeading;

    elements.resultReplaySheetSpeedValue.textContent =
      displayPoint && isFiniteNumber(displayPoint.speedMs)
        ? formatSpeedValue(displayPoint.speedMs, state.settings.speedUnit)
        : '—';
    elements.resultReplaySheetAltitudeValue.textContent =
      showAltitude && displayPoint && isFiniteNumber(displayPoint.altitudeM)
        ? formatDistanceMeasurement(displayPoint.altitudeM)
        : '—';
    elements.resultReplaySheetHeadingValue.textContent =
      showHeading && displayPoint ? formatHeading(displayPoint.headingDeg) : '—';

    replayCharts.updatePlayback(displayPoint);
  }

  function renderResultCard() {
    var result = getDisplayedResult();
    var replaySource = ensureReplaySource(result);
    var replayPoint =
      replaySource && state.replay.engaged ? getReplayPositionPoint(replaySource) : null;

    if (!result) {
      elements.resultEmptyState.hidden = false;
      elements.resultContent.hidden = true;
      if (elements.resultPrimaryHeader) elements.resultPrimaryHeader.hidden = true;
      renderResultPartials(null, null);
      renderReplayControls(null, null, null);
      renderReplayMap(null, null, null);
      renderReplayChartSheet(null, null, null);
      if (elements.resultNotesRow) elements.resultNotesRow.hidden = true;
      renderResultGraph(null, null, null);
      return;
    }

    elements.resultEmptyState.hidden = true;
    elements.resultContent.hidden = false;
    if (elements.resultPrimaryHeader) elements.resultPrimaryHeader.hidden = false;
    elements.resultElapsedValue.textContent = formatRunSeconds(result.elapsedMs) + ' s';
    elements.resultPresetValue.textContent = getPresetLabel(result);
    elements.resultFinishSpeedValue.textContent = formatSpeedValue(
      result.finishSpeedMs,
      state.settings.speedUnit
    );
    elements.resultRolloutValue.textContent = getRolloutLabel(result);
    elements.resultAccuracyValue.textContent = formatDistanceMeasurement(result.averageAccuracyM);
    elements.resultSlopeValue.textContent = formatSlopePercent(result.slopePercent);
    elements.resultElevationValue.textContent = formatSignedDistanceMeasurement(
      result.elevationDeltaM
    );
    elements.resultHzValue.textContent = formatHz(result.averageHz);
    elements.resultQualityValue.textContent = getQualityLabel(result.qualityGrade);
    elements.resultTimestampValue.textContent = formatTimestamp(result.savedAtMs);
    if (elements.resultLocationValue) {
      setResultLocationText(getRunLocationLabel(result));
    }
    elements.resultComparisonValue.textContent = buildComparisonText(result);
    renderResultPartials(result, replayPoint);
    renderReplayControls(result, replaySource, replayPoint);
    renderReplayMap(result, replaySource, replayPoint);
    renderReplayChartSheet(result, replaySource, replayPoint);
    if (elements.resultNotesRow && elements.resultNotesValue) {
      var hasNotes = Boolean(result.notes);
      elements.resultNotesRow.hidden = !hasNotes;
      elements.resultNotesValue.textContent = hasNotes ? result.notes : t('accelUnavailable');
    }
    renderResultGraph(result, replaySource, replayPoint);
  }

  function renderResultPartials(result, replayPoint) {
    if (!elements.resultPartialsSection || !elements.resultPartialsList) return;
    if (!result || !result.partials || !result.partials.length) {
      elements.resultPartialsSection.hidden = true;
      elements.resultPartialsList.innerHTML = '';
      return;
    }

    var html = '';
    for (var index = 0; index < result.partials.length; index += 1) {
      var partial = result.partials[index];
      var status = partial && partial.elapsedMs !== null ? 'done' : 'missed';
      if (partial && partial.elapsedMs !== null && replayPoint) {
        if (Math.abs(replayPoint.elapsedMs - partial.elapsedMs) <= 140) status = 'active';
        else if (replayPoint.elapsedMs + 0.5 < partial.elapsedMs) status = 'waiting';
      }
      html += '<div class="accel-partial-row" data-status="' + status + '">';
      html +=
        '<span class="accel-partial-label">' + escapeHtml(getPartialLabel(partial)) + '</span>';
      html +=
        '<strong class="accel-partial-value">' +
        escapeHtml(formatPartialValue(partial, state.settings.speedUnit, true)) +
        '</strong>';
      html += '</div>';
    }

    elements.resultPartialsSection.hidden = false;
    elements.resultPartialsList.innerHTML = html;
  }

  function renderResultGraph(result, replaySource, replayPoint) {
    var markerPoints =
      result && replaySource
        ? buildAccelReplayMarkers(result, replaySource, {
            finishLabel: t('accelReplayFinish'),
            getPartialLabel: getPartialLabel,
          })
        : [];
    resultGraph.render(result, {
      axisMode: getReplayAxisModeForSource(replaySource),
      markerPoints: markerPoints,
      playbackPoint: replayPoint,
    });
  }

  function renderReplayMap(result, replaySource, replayPoint) {
    if (!elements.resultReplayMapShell || !elements.resultReplayMap) return;

    var hasReplayMap = Boolean(
      state.openPanel === 'results' && result && replaySource && replaySource.hasGeoPath
    );

    elements.resultReplayMapShell.hidden = !hasReplayMap;

    if (!hasReplayMap) {
      replayMap.clear();
      return;
    }

    replayMap.init();
    replayMap.setSource(replaySource, {
      resetCamera: state.replay.introPlayed,
    });

    var displayPoint = replayPoint || getReplayDisplayPoint(replaySource);
    replayMap.renderPlaybackFrame(
      replaySource,
      displayPoint,
      displayPoint ? displayPoint.elapsedMs : state.replay.positionMs
    );

    if (!state.replay.introPlayed) {
      void runReplayMapApproach(result, replaySource);
    }
  }

  function buildResultGraphData(result) {
    return resultGraph.buildGraphDataFromTraceSource(result);
  }

  function buildGraphDataFromTraceSource(source) {
    return resultGraph.buildGraphDataFromTraceSource(source);
  }

  function renderDebugTables() {
    renderDebugRawTable();
    renderDebugGraphTable();
  }

  function renderDebugRawTable() {
    if (
      !elements.debugRawSection ||
      !elements.debugRawEmptyState ||
      !elements.debugRawTableWrap ||
      !elements.debugRawTableBody
    )
      return;

    var activeRun = isRunActive(state.run) ? state.run : null;
    var result = activeRun ? null : getDisplayedResult();
    var rawRows =
      activeRun && Array.isArray(activeRun.sampleLog)
        ? activeRun.sampleLog
        : result && Array.isArray(result.sampleLog)
          ? result.sampleLog
          : [];
    var hasContext = Boolean(activeRun || result);

    elements.debugRawSection.hidden = !hasContext;
    if (!hasContext) {
      elements.debugRawTableBody.innerHTML = '';
      return;
    }

    if (!rawRows.length) {
      elements.debugRawEmptyState.hidden = false;
      elements.debugRawTableWrap.hidden = true;
      elements.debugRawTableBody.innerHTML = '';
      return;
    }

    var html = '';
    for (var index = rawRows.length - 1; index >= 0; index -= 1) {
      var row = rawRows[index];
      var stateLabel = getDebugSampleState(row);
      html += '<tr>';
      html += '<td>' + escapeHtml(formatInteger(row.index)) + '</td>';
      html += '<td>' + escapeHtml(formatMs(row.deltaMs)) + '</td>';
      html += '<td>' + escapeHtml(formatHz(row.effectiveHz)) + '</td>';
      html +=
        '<td class="accel-debug-mono">' +
        escapeHtml(formatDebugCoordinatePair(row.latitude, row.longitude)) +
        '</td>';
      html += '<td>' + escapeHtml(formatDebugSpeedMs(row.rawSpeedMs)) + '</td>';
      html += '<td>' + escapeHtml(formatDebugSpeedMs(row.derivedSpeedMs)) + '</td>';
      html += '<td>' + escapeHtml(formatDebugSpeedMs(row.speedMs)) + '</td>';
      html += '<td>' + escapeHtml(formatHeading(row.headingDeg)) + '</td>';
      html += '<td>' + escapeHtml(formatDebugMeters(row.accuracyM)) + '</td>';
      html += '<td>' + escapeHtml(stateLabel) + '</td>';
      html += '</tr>';
    }

    elements.debugRawEmptyState.hidden = true;
    elements.debugRawTableWrap.hidden = false;
    elements.debugRawTableBody.innerHTML = html;
  }

  function renderDebugGraphTable() {
    if (
      !elements.debugGraphSection ||
      !elements.debugGraphEmptyState ||
      !elements.debugGraphTableWrap ||
      !elements.debugGraphTableBody
    )
      return;

    var activeRun = isRunActive(state.run) ? state.run : null;
    var result = activeRun ? null : getDisplayedResult();
    var graphRows = activeRun
      ? buildGraphDataFromTraceSource(activeRun)
      : result
        ? buildResultGraphData(result)
        : [];
    var hasContext = Boolean(activeRun || result);

    elements.debugGraphSection.hidden = !hasContext;
    if (!hasContext) {
      elements.debugGraphTableBody.innerHTML = '';
      return;
    }

    if (!graphRows.length) {
      elements.debugGraphEmptyState.hidden = false;
      elements.debugGraphTableWrap.hidden = true;
      elements.debugGraphTableBody.innerHTML = '';
      return;
    }

    var html = '';
    for (var index = 0; index < graphRows.length; index += 1) {
      var row = graphRows[index];
      html += '<tr>';
      html += '<td>' + escapeHtml(formatInteger(index + 1)) + '</td>';
      html += '<td>' + escapeHtml(formatMs(row.elapsedMs)) + '</td>';
      html += '<td>' + escapeHtml(formatRunSeconds(row.elapsedMs) + ' s') + '</td>';
      html +=
        '<td>' + escapeHtml(formatSpeedValue(row.speedMs, state.settings.speedUnit)) + '</td>';
      html += '<td>' + escapeHtml(formatDebugMeters(row.distanceM)) + '</td>';
      html += '<td>' + escapeHtml(formatDebugMeters(row.altitudeM)) + '</td>';
      html += '<td>' + escapeHtml(formatDebugMeters(row.accuracyM)) + '</td>';
      html += '<td>' + escapeHtml(getSpeedSourceLabel(row.speedSource)) + '</td>';
      html += '</tr>';
    }

    elements.debugGraphEmptyState.hidden = true;
    elements.debugGraphTableWrap.hidden = false;
    elements.debugGraphTableBody.innerHTML = html;
  }

  function getDebugSampleState(sample) {
    if (!sample) return t('accelUnavailable');

    var flags = [];
    if (sample.stale) flags.push('stale');
    if (sample.sparse) flags.push('sparse');

    return flags.length ? sample.stage + ' · ' + flags.join(', ') : sample.stage;
  }

  function requestResultGraphRefresh() {
    resultGraph.requestRefresh();
  }

  function destroyResultGraph() {
    resultGraph.destroy();
    replayCharts.destroy();
    replayMap.destroy();
  }

  function renderDiagnostics() {
    var diagnostics = getCurrentDiagnostics();
    elements.diagnosticAverageIntervalValue.textContent = formatMs(diagnostics.averageIntervalMs);
    elements.diagnosticJitterValue.textContent = formatMs(diagnostics.jitterMs);
    elements.diagnosticSparseValue.textContent = formatInteger(diagnostics.sparseCount);
    elements.diagnosticStaleValue.textContent = formatInteger(diagnostics.staleCount);
    elements.diagnosticSpeedSourceValue.textContent = getSpeedSourceLabel(diagnostics.speedSource);
    elements.diagnosticSamplesValue.textContent = formatInteger(diagnostics.sampleCount);

    renderWarningBadges(diagnostics.warningKeys);
  }

  function getCurrentDiagnostics() {
    var displayedResult = getDisplayedResult();
    if (displayedResult) {
      return {
        averageIntervalMs: displayedResult.averageIntervalMs,
        jitterMs: displayedResult.jitterMs,
        sparseCount: displayedResult.sparseCount,
        staleCount: displayedResult.staleCount,
        speedSource: displayedResult.speedSource,
        sampleCount: displayedResult.sampleCount,
        warningKeys: displayedResult.warningKeys || [],
      };
    }

    if (state.run && state.run.result) {
      return {
        averageIntervalMs: state.run.result.averageIntervalMs,
        jitterMs: state.run.result.jitterMs,
        sparseCount: state.run.result.sparseCount,
        staleCount: state.run.result.staleCount,
        speedSource: state.run.result.speedSource,
        sampleCount: state.run.result.sampleCount,
        warningKeys: state.run.result.warningKeys || [],
      };
    }

    if (isRunActive(state.run)) {
      var liveRunQuality = buildCurrentRunQuality(
        state.run,
        state.run.startPerfMs !== null ? performance.now() - state.run.startPerfMs : 0
      );
      return {
        averageIntervalMs: liveRunQuality.averageIntervalMs,
        jitterMs: liveRunQuality.jitterMs,
        sparseCount: state.run.sparseCount,
        staleCount: state.run.staleCount,
        speedSource:
          state.run.derivedSpeedCount > state.run.sampleCount / 2 ? 'derived' : 'reported',
        sampleCount: state.run.sampleCount,
        warningKeys: liveRunQuality.warningKeys,
      };
    }

    var sessionQuality = buildLiveQuality({
      sessionSampleCount: state.sessionSampleCount,
      recentIntervals: state.recentIntervals,
      latestSample: state.latestSample,
      latestSampleStale: isLatestSampleStale(),
      latestSampleSparse: isLatestSampleSparse(),
    });
    return {
      averageIntervalMs: sessionQuality.averageIntervalMs,
      jitterMs: sessionQuality.jitterMs,
      sparseCount: isLatestSampleSparse() ? 1 : 0,
      staleCount: isLatestSampleStale() ? 1 : 0,
      speedSource: state.latestSample ? state.latestSample.speedSource : null,
      sampleCount: state.sessionSampleCount,
      warningKeys: sessionQuality.warningKeys || [],
    };
  }

  function renderWarningBadges(warningKeys) {
    var warnings = warningKeys && warningKeys.length ? warningKeys : ['accelWarningNoWarnings'];
    var html = '';

    for (var index = 0; index < warnings.length; index += 1) {
      var warningKey = warnings[index];
      var tone = warningKey === 'accelWarningNoWarnings' ? 'ok' : 'warning';
      if (warningKey === 'accelWarningStale') tone = 'danger';
      html +=
        '<span class="accel-warning-badge" data-tone="' +
        tone +
        '">' +
        escapeHtml(t(warningKey)) +
        '</span>';
    }

    elements.warningBadges.innerHTML = html;
  }

  function renderHistory() {
    if (!state.runs.length) {
      elements.historyEmptyState.hidden = false;
      elements.historyList.innerHTML = '';
      queueHistoryDetailOverflowSync();
      return;
    }

    elements.historyEmptyState.hidden = true;

    var html = '';
    var displayedResult = getDisplayedResult();
    for (var index = 0; index < state.runs.length; index += 1) {
      var run = state.runs[index];
      var isSelected = Boolean(displayedResult && displayedResult.id === run.id);
      var locationLabel = getRunLocationLabel(run);
      html += '<article class="accel-history-item" data-selected="' + String(isSelected) + '">';
      html +=
        '<button type="button" class="accel-history-btn" data-history-action="load" data-run-id="' +
        escapeHtml(run.id) +
        '" aria-pressed="' +
        String(isSelected) +
        '">';
      html +=
        '<span class="accel-history-title"><strong>' +
        escapeHtml(getPresetLabel(run)) +
        '</strong>';
      if (isSelected) {
        html += '<span class="accel-history-chip">' + escapeHtml(t('accelViewingResult')) + '</span>';
      }
      html += '</span>';
      html +=
        '<span class="accel-history-meta">' +
        escapeHtml(formatRunSeconds(run.elapsedMs)) +
        ' s · ' +
        escapeHtml(getQualityLabel(run.qualityGrade)) +
        ' · ' +
        escapeHtml(formatTimestamp(run.savedAtMs)) +
        '</span>';
      if (locationLabel !== t('accelUnavailable')) {
        html +=
          '<span class="accel-history-detail"><span class="accel-history-detail-text">' +
          escapeHtml(locationLabel) +
          '</span></span>';
      }
      if (run.notes) html += '<span class="accel-history-note">' + escapeHtml(run.notes) + '</span>';
      html += '</button>';
      html +=
        '<button type="button" class="accel-delete-btn accel-history-delete" data-history-action="delete" data-run-id="' +
        escapeHtml(run.id) +
        '" aria-label="' +
        escapeHtml(t('accelDelete')) +
        '" title="' +
        escapeHtml(t('accelDelete')) +
        '">' +
        escapeHtml(t('accelDelete')) +
        '</button>';
      html += '</article>';
    }

    elements.historyList.innerHTML = html;
    queueHistoryDetailOverflowSync();
  }

  function getSetupSummary() {
    var preset = getSelectedPreset();
    var metaParts = [preset.standingStart ? t('accelStandingStart') : t('accelRollingStart')];

    if (preset.standingStart) {
      metaParts.push(state.settings.rolloutEnabled ? t('accelRolloutOn') : t('accelRolloutOff'));
    }

    metaParts.push(
      getSpeedUnitLabel(state.settings.speedUnit) +
        ' / ' +
        getDistanceUnitLabel(state.settings.distanceUnit)
    );

    return {
      title: getPresetLabel(preset),
      meta: metaParts.join(' · '),
    };
  }

  function getResultsSummary() {
    var result = getDisplayedResult();
    if (!result) {
      return {
        title: t('accelNoSavedRunsShort'),
        meta: t('accelLocalOnly'),
      };
    }

    return {
      title: formatRunSeconds(result.elapsedMs) + ' s',
      meta: getPresetLabel(result) + ' · ' + getQualityLabel(result.qualityGrade),
    };
  }

  function getResultsPanelStatusText() {
    var result = getDisplayedResult();
    if (!result) return t('accelStorageNote');
    return getPresetLabel(result) + ' · ' + formatTimestamp(result.savedAtMs);
  }

  function getRunStateLabel() {
    if (!state.geolocationSupported) return t('accelStateError');
    if (!isGpsReady() && (!state.run || state.run.stage !== 'completed'))
      return t('accelStateGpsWaiting');
    if (!state.run) return t('accelStateIdle');

    switch (state.run.stage) {
      case 'armed':
        return t('accelStateWaitingLaunch');
      case 'waiting_rollout':
        return t('accelStateWaitingRollout');
      case 'running':
        return t('accelStateRunning');
      case 'completed':
        return t('accelStateCompleted');
      default:
        return t('accelStateIdle');
    }
  }

  function getPermissionLabel(permissionState) {
    switch (permissionState) {
      case 'granted':
        return t('accelPermissionGranted');
      case 'denied':
        return t('accelPermissionDenied');
      case 'prompt':
        return t('accelPermissionPrompt');
      case 'unsupported':
        return t('accelPermissionUnsupported');
      default:
        return t('accelPermissionUnknown');
    }
  }

  function getQualityLabel(grade) {
    switch (grade) {
      case 'good':
        return t('accelQualityGood');
      case 'fair':
        return t('accelQualityFair');
      case 'poor':
        return t('accelQualityPoor');
      default:
        return t('accelQualityInvalid');
    }
  }

  function getSpeedSourceLabel(source) {
    if (source === 'derived') return t('accelSpeedDerivedLabel');
    if (source === 'reported') return t('accelSpeedReported');
    return t('accelUnavailable');
  }

  function getRolloutLabel(result) {
    if (!result.standingStart) return t('accelRolloutIgnored');
    return result.rolloutApplied ? t('accelRolloutOn') : t('accelRolloutOff');
  }

  function isGpsReady() {
    var latestSampleAgeMs = getLatestSampleAgeMs();
    return isFiniteNumber(latestSampleAgeMs) && latestSampleAgeMs <= READY_SAMPLE_AGE_MS;
  }

  function getLatestSampleAgeMs() {
    if (!state.latestSample || !isFiniteNumber(state.latestSample.receivedAtMs)) return null;
    return Math.max(0, Date.now() - state.latestSample.receivedAtMs);
  }

  function isLatestSampleStale() {
    return Boolean(
      state.latestSample &&
      (state.latestSample.stale || getLatestSampleAgeMs() >= STALE_INTERVAL_MS)
    );
  }

  function isLatestSampleSparse() {
    return Boolean(
      state.latestSample &&
      (state.latestSample.sparse || getLatestSampleAgeMs() >= SPARSE_INTERVAL_MS)
    );
  }

  function isCustomRangeValid() {
    return (
      toFiniteNumber(state.settings.customEnd, 0) > toFiniteNumber(state.settings.customStart, 0)
    );
  }

  function setActionNotice(key, params) {
    if (state.actionNoticeTimerId) window.clearTimeout(state.actionNoticeTimerId);
    elements.actionNotice.textContent = t(key, params || {});

    state.actionNoticeTimerId = window.setTimeout(function () {
      elements.actionNotice.textContent = '';
      state.actionNoticeTimerId = null;
    }, 2600);
  }

  function getLiveSlopePercent(run) {
    if (!run) return null;
    if (run.stage === 'completed' && run.result) return run.result.slopePercent;
    if (run.startPerfMs === null) return null;

    var currentAltitudeM = state.latestSample ? state.latestSample.altitudeM : null;
    var currentDistanceM = isFiniteNumber(run.startDistanceM)
      ? Math.max(0, run.distanceSinceArmM - run.startDistanceM)
      : null;
    return buildSlopeAnalysis(run.startAltitudeM, currentAltitudeM, currentDistanceM).slopePercent;
  }

  function getCurrentClockMs() {
    var rawPerfMs = performance.now();
    if (!state.latestSample) return rawPerfMs;

    var perfDeltaMs = rawPerfMs - state.latestSample.rawPerfMs;
    var receivedDeltaMs = Date.now() - state.latestSample.receivedAtMs;
    var deltaMs = resolveClockDeltaMs(perfDeltaMs, receivedDeltaMs);
    if (!isFiniteNumber(deltaMs)) return state.latestSample.perfMs;
    return state.latestSample.perfMs + deltaMs;
  }

  accelRouteLifecycle = {
    mount: mountAccelController,
    unmount: unmountAccelController,
  };

  if (import.meta.hot) {
    import.meta.hot.dispose(function () {
      cancelPendingMeasurementFrames();
    });
  }

  return init();
})();
