import "../styles/accel.less";
import Chart from "chart.js/auto";
import { applyTranslations as applySharedTranslations, getLang, t as sharedT, toggleLang } from "../i18n.js";
import { createAnalogSpeedometer } from "../shared/analog-speedometer.js";
import { initSupportPanel } from "../shared/support-panel.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import { IconBoard, IconGpsLab, IconSpeed } from "../icons.js";
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
  STALE_INTERVAL_MS,
  TIMER_TICK_MS,
  normalizeDistanceUnit,
  normalizeSpeedUnit,
} from "./constants.js";
import { createAccelFormatters } from "./formatters.js";
import { createAccelHistoryHelpers } from "./history.js";
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
} from "./logic.js";
import {
  buildComparisonSignature,
  buildRunPartials,
  copyPreset,
  getAvailablePresetDefinitions as listAvailablePresetDefinitions,
  getPresetSignature,
  getSelectedPreset as resolveSelectedPreset,
  presetKeyFromId,
  resolvePresetIdForUnits,
} from "./presets.js";
import { createAccelResultGraph } from "./result-graph.js";
import { loadRuns, loadSettings, saveRuns as persistRuns, saveSettings as persistSettings } from "./storage.js";

(function () {
  var finishAudio = typeof Audio === "function" ? new Audio(FINISH_SOUND_URL) : null;
  var finishAudioPrimePromise = null;
  var finishAudioPrimed = false;

  if (finishAudio) {
    finishAudio.preload = "auto";
    finishAudio.loop = false;
  }

  var elements = {
    langToggle: document.getElementById("langToggle"),
    pageDescriptionMeta: document.querySelector('meta[name="description"]'),
    toolsMenuBtn: document.getElementById("accelToolsMenuBtn"),
    toolsMenuList: document.getElementById("accelToolsMenuList"),
    openSpeedMenu: document.getElementById("openAccelSpeedMenu"),
    openGpsLabMenu: document.getElementById("openAccelGpsLabMenu"),
    openBoardMenu: document.getElementById("openAccelBoardMenu"),
    sheetBackdrop: document.getElementById("accelSheetBackdrop"),
    setupTrigger: document.getElementById("setupTrigger"),
    setupTriggerValue: document.getElementById("setupTriggerValue"),
    setupTriggerMeta: document.getElementById("setupTriggerMeta"),
    resultsTrigger: document.getElementById("resultsTrigger"),
    resultsTriggerValue: document.getElementById("resultsTriggerValue"),
    resultsTriggerMeta: document.getElementById("resultsTriggerMeta"),
    toolbarPermissionValue: document.getElementById("toolbarPermissionValue"),
    toolbarQualityValue: document.getElementById("toolbarQualityValue"),
    toolbarStateValue: document.getElementById("toolbarStateValue"),
    setupPanel: document.getElementById("setupPanel"),
    closeSetupPanel: document.getElementById("closeSetupPanel"),
    setupPanelStatus: document.getElementById("setupPanelStatus"),
    resultsPanel: document.getElementById("resultsPanel"),
    closeResultsPanel: document.getElementById("closeResultsPanel"),
    resultsPanelStatus: document.getElementById("resultsPanelStatus"),
    permissionValue: document.getElementById("permissionValue"),
    gpsReadyValue: document.getElementById("gpsReadyValue"),
    latestAccuracyValue: document.getElementById("latestAccuracyValue"),
    observedHzValue: document.getElementById("observedHzValue"),
    statusSpeedValue: document.getElementById("statusSpeedValue"),
    statusHeadingValue: document.getElementById("statusHeadingValue"),
    statusAltitudeValue: document.getElementById("statusAltitudeValue"),
    speedSourceValue: document.getElementById("speedSourceValue"),
    presetGrid: document.getElementById("presetGrid"),
    customRangePanel: document.getElementById("customRangePanel"),
    customStartInput: document.getElementById("customStartInput"),
    customEndInput: document.getElementById("customEndInput"),
    speedUnitMph: document.getElementById("speedUnitMph"),
    speedUnitKmh: document.getElementById("speedUnitKmh"),
    distanceUnitFt: document.getElementById("distanceUnitFt"),
    distanceUnitM: document.getElementById("distanceUnitM"),
    customRangeNotice: document.getElementById("customRangeNotice"),
    armRun: document.getElementById("armRun"),
    cancelRun: document.getElementById("cancelRun"),
    rolloutOff: document.getElementById("rolloutOff"),
    rolloutOn: document.getElementById("rolloutOn"),
    launchThresholdHalf: document.getElementById("launchThresholdHalf"),
    launchThresholdOne: document.getElementById("launchThresholdOne"),
    runNotes: document.getElementById("runNotes"),
    actionNotice: document.getElementById("actionNotice"),
    liveElapsedValue: document.getElementById("liveElapsedValue"),
    liveSpeedGaugeStage: document.getElementById("liveSpeedGaugeStage"),
    liveSpeedGaugeInner: document.getElementById("liveSpeedGaugeInner"),
    liveSpeedDial: document.getElementById("liveSpeedDial"),
    liveSpeedNeedle: document.getElementById("liveSpeedNeedle"),
    liveSpeedValue: document.getElementById("liveSpeedValue"),
    liveSpeedUnit: document.getElementById("liveSpeedUnit"),
    liveSpeedSubstatus: document.getElementById("liveSpeedSubstatus"),
    liveDistanceValue: document.getElementById("liveDistanceValue"),
    liveSlopeValue: document.getElementById("liveSlopeValue"),
    liveTargetValue: document.getElementById("liveTargetValue"),
    liveStateValue: document.getElementById("liveStateValue"),
    liveQualityValue: document.getElementById("liveQualityValue"),
    livePartialsSection: document.getElementById("livePartialsSection"),
    livePartialsList: document.getElementById("livePartialsList"),
    progressLabel: document.getElementById("progressLabel"),
    progressFill: document.getElementById("progressFill"),
    resultEmptyState: document.getElementById("resultEmptyState"),
    resultContent: document.getElementById("resultContent"),
    resultPrimaryHeader: document.getElementById("resultPrimaryHeader"),
    resultElapsedValue: document.getElementById("resultElapsedValue"),
    resultGraphMeta: document.getElementById("resultGraphMeta"),
    resultGraphEmptyState: document.getElementById("resultGraphEmptyState"),
    resultGraphFrame: document.getElementById("resultGraphFrame"),
    resultGraphCanvas: document.getElementById("resultGraphCanvas"),
    resultGraphTimeValue: document.getElementById("resultGraphTimeValue"),
    resultGraphSpeedValue: document.getElementById("resultGraphSpeedValue"),
    resultGraphDistanceValue: document.getElementById("resultGraphDistanceValue"),
    resultGraphAltitudeValue: document.getElementById("resultGraphAltitudeValue"),
    resultGraphAccuracyValue: document.getElementById("resultGraphAccuracyValue"),
    resultGraphSlopeValue: document.getElementById("resultGraphSlopeValue"),
    debugRawSection: document.getElementById("debugRawSection"),
    debugRawEmptyState: document.getElementById("debugRawEmptyState"),
    debugRawTableWrap: document.getElementById("debugRawTableWrap"),
    debugRawTableBody: document.getElementById("debugRawTableBody"),
    debugGraphSection: document.getElementById("debugGraphSection"),
    debugGraphEmptyState: document.getElementById("debugGraphEmptyState"),
    debugGraphTableWrap: document.getElementById("debugGraphTableWrap"),
    debugGraphTableBody: document.getElementById("debugGraphTableBody"),
    resultPartialsSection: document.getElementById("resultPartialsSection"),
    resultPartialsList: document.getElementById("resultPartialsList"),
    resultPresetValue: document.getElementById("resultPresetValue"),
    resultFinishSpeedValue: document.getElementById("resultFinishSpeedValue"),
    resultRolloutValue: document.getElementById("resultRolloutValue"),
    resultAccuracyValue: document.getElementById("resultAccuracyValue"),
    resultSlopeValue: document.getElementById("resultSlopeValue"),
    resultElevationValue: document.getElementById("resultElevationValue"),
    resultHzValue: document.getElementById("resultHzValue"),
    resultQualityValue: document.getElementById("resultQualityValue"),
    resultTimestampValue: document.getElementById("resultTimestampValue"),
    resultComparisonValue: document.getElementById("resultComparisonValue"),
    resultNotesRow: document.getElementById("resultNotesRow"),
    resultNotesValue: document.getElementById("resultNotesValue"),
    warningBadges: document.getElementById("warningBadges"),
    diagnosticAverageIntervalValue: document.getElementById("diagnosticAverageIntervalValue"),
    diagnosticJitterValue: document.getElementById("diagnosticJitterValue"),
    diagnosticSparseValue: document.getElementById("diagnosticSparseValue"),
    diagnosticStaleValue: document.getElementById("diagnosticStaleValue"),
    diagnosticSpeedSourceValue: document.getElementById("diagnosticSpeedSourceValue"),
    diagnosticSamplesValue: document.getElementById("diagnosticSamplesValue"),
    clearHistory: document.getElementById("clearHistory"),
    historyEmptyState: document.getElementById("historyEmptyState"),
    historyList: document.getElementById("historyList"),
  };

  var toolsMenu = initToolsMenu({
    button: elements.toolsMenuBtn,
    list: elements.toolsMenuList,
  });
  initSupportPanel();

  applyButtonIcon(elements.openSpeedMenu, IconSpeed);
  applyButtonIcon(elements.openGpsLabMenu, IconGpsLab);
  applyButtonIcon(elements.openBoardMenu, IconBoard);

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
    permissionState: "prompt",
    permissionStatus: null,
    geolocationSupported: Boolean(navigator.geolocation),
    watchId: null,
    uiTimerId: null,
    sessionSampleCount: 0,
    sessionIntervals: [],
    recentIntervals: [],
    latestSample: null,
    currentQuality: null,
    runs: loadRuns(),
    settings: loadSettings(),
    run: null,
    latestResult: null,
    selectedResultId: "",
    openPanel: null,
    actionNoticeTimerId: null,
  };

  state.latestResult = state.runs.length ? state.runs[0] : null;
  state.selectedResultId = state.latestResult ? state.latestResult.id : "";

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
    formatDistanceMeasurement: formatDistanceMeasurement,
    formatNumber: formatNumber,
    formatRunDistance: formatRunDistance,
    formatRunSeconds: formatRunSeconds,
    formatSlopePercent: formatSlopePercent,
    formatSpeedValue: formatSpeedValue,
    getSpeedUnitLabel: getSpeedUnitLabel,
    t: t,
    resultGraphHeight: RESULT_GRAPH_HEIGHT,
  });

  init();

  function init() {
    applyTranslations();
    elements.runNotes.value = state.settings.notes;
    if (syncSelectedPresetForUnits()) saveSettings();
    renderPresetButtons();
    renderControlSelections();
    bindEvents();
    setupResultGraphObservers();
    renderAll();
    startUiTimer();
    updatePermissionState();
    ensureWatch();
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
        if (playPromise && typeof playPromise.then === "function") await playPromise;
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
      if (playPromise && typeof playPromise.catch === "function") {
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
    document.title = t("accelPageTitle");
    if (elements.pageDescriptionMeta) elements.pageDescriptionMeta.setAttribute("content", t("accelPageDescription"));
    document.documentElement.lang = getLang();
    applySharedTranslations();
    if (elements.langToggle) elements.langToggle.textContent = getLang().toUpperCase();
  }

  function bindEvents() {
    elements.langToggle.addEventListener("click", handleLangToggle);
    bindMenuNavigation(elements.openSpeedMenu, "/speed");
    bindMenuNavigation(elements.openGpsLabMenu, "/gps-rate");
    bindMenuNavigation(elements.openBoardMenu, "/");
    elements.setupTrigger.addEventListener("click", function () {
      togglePanel("setup");
    });
    elements.resultsTrigger.addEventListener("click", function () {
      togglePanel("results");
    });
    elements.closeSetupPanel.addEventListener("click", closePanel);
    elements.closeResultsPanel.addEventListener("click", closePanel);
    elements.sheetBackdrop.addEventListener("click", closePanel);
    elements.presetGrid.addEventListener("click", handlePresetClick);
    elements.customStartInput.addEventListener("input", handleCustomInput);
    elements.customEndInput.addEventListener("input", handleCustomInput);
    elements.speedUnitMph.addEventListener("click", handleSpeedUnitClick);
    elements.speedUnitKmh.addEventListener("click", handleSpeedUnitClick);
    elements.distanceUnitFt.addEventListener("click", handleDistanceUnitClick);
    elements.distanceUnitM.addEventListener("click", handleDistanceUnitClick);
    elements.armRun.addEventListener("click", handleArm);
    elements.cancelRun.addEventListener("click", handleCancel);
    elements.rolloutOff.addEventListener("click", handleRolloutClick);
    elements.rolloutOn.addEventListener("click", handleRolloutClick);
    elements.launchThresholdHalf.addEventListener("click", handleThresholdClick);
    elements.launchThresholdOne.addEventListener("click", handleThresholdClick);
    elements.runNotes.addEventListener("input", handleNotesInput);
    elements.clearHistory.addEventListener("click", handleClearHistory);
    elements.historyList.addEventListener("click", handleHistoryClick);
    document.addEventListener("visibilitychange", renderAll);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pagehide", destroyResultGraph);
    window.addEventListener("resize", requestResultGraphRefresh);
  }

  function bindMenuNavigation(element, href) {
    if (!element) return;
    element.addEventListener("click", function () {
      toolsMenu.close();
      window.location.href = href;
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
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape" || !state.openPanel) return;
    event.preventDefault();
    closePanel();
  }

  function openPanel(panelName) {
    if (state.openPanel === panelName) return;
    state.openPanel = panelName;
    if (panelName === "results" && elements.resultsPanel) {
      resultGraph.noteResultsPanelWidth();
    }
    renderSheetUi();

    var focusTarget = panelName === "setup" ? elements.closeSetupPanel : elements.closeResultsPanel;
    if (focusTarget) focusTarget.focus();
  }

  function closePanel() {
    if (!state.openPanel) return;

    var previouslyOpen = state.openPanel;
    state.openPanel = null;
    renderSheetUi();

    var trigger = previouslyOpen === "setup" ? elements.setupTrigger : elements.resultsTrigger;
    if (trigger) trigger.focus();
  }

  function togglePanel(panelName) {
    if (state.openPanel === panelName) {
      closePanel();
      return;
    }

    openPanel(panelName);
  }

  function saveSettings() {
    persistSettings(state.settings);
  }

  function saveRuns() {
    persistRuns(state.runs);
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
    if (!presetOrRun) return t("accelUnavailable");

    if (presetOrRun.id === "custom" || presetOrRun.presetId === "custom") {
      if (!isFiniteNumber(presetOrRun.targetSpeedMs)) {
        return t("accelPresetCustom");
      }
      var speedUnit = state.settings.speedUnit;
      var start = msToSpeedUnit(presetOrRun.startSpeedMs || 0, speedUnit);
      var end = msToSpeedUnit(presetOrRun.targetSpeedMs || 0, speedUnit);
      return t("accelPresetCustom") + " · " + formatAdaptiveNumber(start) + "-" + formatAdaptiveNumber(end) + " " + getSpeedUnitLabel(speedUnit);
    }

    return t(presetOrRun.labelKey || presetKeyFromId(presetOrRun.presetId));
  }

  function getPresetMetaLabel(presetOrRun) {
    if (!presetOrRun) return t("accelUnavailable");
    if (presetOrRun.id === "custom" || presetOrRun.presetId === "custom") return t("accelCustomRange");
    if (presetOrRun.type === "distance" || presetOrRun.presetKind === "distance") return t("accelDistanceTest");
    return presetOrRun.standingStart ? t("accelStandingStart") : t("accelRollingStart");
  }

  function renderPresetButtons() {
    var html = "";
    var selectedId = resolvePresetIdForUnits(
      state.settings.selectedPresetId,
      state.settings.speedUnit,
      state.settings.distanceUnit
    );
    var availablePresets = getAvailablePresetDefinitions();

    for (var index = 0; index < availablePresets.length; index += 1) {
      var preset = availablePresets[index];
      var pressed = preset.id === selectedId ? "true" : "false";
      var presetCopy = copyPreset(preset);
      html += '<button type="button" class="accel-preset-btn" data-preset-id="' + escapeHtml(preset.id) + '" aria-pressed="' + pressed + '">';
      html += '<span class="accel-preset-title">' + escapeHtml(getPresetLabel(presetCopy)) + "</span>";
      html += '<span class="accel-preset-meta">' + escapeHtml(getPresetMetaLabel(presetCopy)) + "</span>";
      html += "</button>";
    }

    elements.presetGrid.innerHTML = html;
    elements.customRangePanel.hidden = selectedId !== "custom";
    elements.customStartInput.value = formatInputSpeedValue(state.settings.customStart);
    elements.customEndInput.value = formatInputSpeedValue(state.settings.customEnd);
  }

  function renderControlSelections() {
    var rolloutPressed = state.settings.rolloutEnabled;
    elements.rolloutOff.setAttribute("aria-pressed", String(!rolloutPressed));
    elements.rolloutOn.setAttribute("aria-pressed", String(rolloutPressed));
    elements.launchThresholdHalf.setAttribute("aria-pressed", String(isSameNumber(state.settings.launchThresholdMs, 0.5 * MPH_TO_MS)));
    elements.launchThresholdOne.setAttribute("aria-pressed", String(isSameNumber(state.settings.launchThresholdMs, 1 * MPH_TO_MS)));
    elements.speedUnitMph.setAttribute("aria-pressed", String(state.settings.speedUnit === "mph"));
    elements.speedUnitKmh.setAttribute("aria-pressed", String(state.settings.speedUnit === "kmh"));
    elements.distanceUnitFt.setAttribute("aria-pressed", String(state.settings.distanceUnit === "ft"));
    elements.distanceUnitM.setAttribute("aria-pressed", String(state.settings.distanceUnit === "m"));
    elements.launchThresholdHalf.textContent = formatThresholdOptionLabel(0.5 * MPH_TO_MS);
    elements.launchThresholdOne.textContent = formatThresholdOptionLabel(1 * MPH_TO_MS);

    if (state.settings.selectedPresetId === "custom" && !isCustomRangeValid()) {
      elements.customRangeNotice.textContent = t("accelCustomInvalid");
    } else {
      elements.customRangeNotice.textContent = "";
    }
  }

  function startUiTimer() {
    if (state.uiTimerId) window.clearInterval(state.uiTimerId);
    state.uiTimerId = window.setInterval(renderRealtimeUi, TIMER_TICK_MS);
  }

  function renderRealtimeUi() {
    renderControlState();
    renderStatusPanel();
    renderLivePanel();
    renderDiagnostics();
  }

  function handlePresetClick(event) {
    var button = event.target.closest("[data-preset-id]");
    if (!button) return;

    state.settings.selectedPresetId = button.getAttribute("data-preset-id");
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
    var nextUnit = normalizeSpeedUnit(button.getAttribute("data-unit"));
    if (nextUnit === state.settings.speedUnit) return;

    state.settings.customStart = convertSpeedInputValue(state.settings.customStart, state.settings.speedUnit, nextUnit);
    state.settings.customEnd = convertSpeedInputValue(state.settings.customEnd, state.settings.speedUnit, nextUnit);
    state.settings.speedUnit = nextUnit;
    syncSelectedPresetForUnits();
    saveSettings();
    renderControlSelections();
    renderPresetButtons();
    renderAll();
  }

  function handleDistanceUnitClick(event) {
    var button = event.currentTarget;
    var nextUnit = normalizeDistanceUnit(button.getAttribute("data-unit"));
    if (nextUnit === state.settings.distanceUnit) return;

    state.settings.distanceUnit = nextUnit;
    syncSelectedPresetForUnits();
    saveSettings();
    renderControlSelections();
    renderPresetButtons();
    renderAll();
  }

  function handleRolloutClick(event) {
    state.settings.rolloutEnabled = event.currentTarget.getAttribute("data-rollout") === "on";
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleThresholdClick(event) {
    state.settings.launchThresholdMs = event.currentTarget.getAttribute("data-threshold") === "1" ? 1 * MPH_TO_MS : 0.5 * MPH_TO_MS;
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleNotesInput() {
    state.settings.notes = elements.runNotes.value || "";
    saveSettings();
  }

  function isRunActive(run) {
    return Boolean(run && (run.stage === "armed" || run.stage === "waiting_rollout" || run.stage === "running"));
  }

  function handleArm() {
    var preset = getSelectedPreset();

    primeFinishAudio();

    if (!state.geolocationSupported) {
      setActionNotice("accelNoGeolocation");
      renderAll();
      return;
    }

    if (state.settings.selectedPresetId === "custom" && !isCustomRangeValid()) {
      setActionNotice("accelCustomInvalid");
      renderAll();
      return;
    }

    if (!isGpsReady()) {
      setActionNotice("accelNeedGps");
      renderAll();
      return;
    }

    if (isRunActive(state.run)) {
      return;
    }

    state.run = createRun(preset);
    setActionNotice(preset.standingStart ? "accelArmedStandingNotice" : "accelArmedRollingNotice");
    renderAll();
  }

  function handleCancel() {
    if (!state.run || state.run.stage === "completed") return;
    state.run = null;
    setActionNotice("accelRunCancelledNotice");
    renderAll();
  }

  function handleClearHistory() {
    if (!state.runs.length) return;
    if (!window.confirm(t("accelClearHistoryConfirm"))) return;

    state.runs = [];
    state.latestResult = null;
    state.selectedResultId = "";
    saveRuns();
    setActionNotice("accelHistoryClearedNotice");
    renderAll();
  }

  function handleHistoryClick(event) {
    var button = event.target.closest("[data-history-action][data-run-id]");
    if (!button) return;

    var runId = button.getAttribute("data-run-id");
    var run = findRunById(runId);
    if (!run) return;

    var action = button.getAttribute("data-history-action");
    if (action === "load") {
      selectResult(runId);
      openPanel("results");
      scrollResultsPanelToTop();
      setActionNotice("accelResultLoadedNotice");
      renderAll();
      return;
    }

    if (action !== "delete") return;
    if (!window.confirm(t("accelDeleteRunConfirm", { label: getPresetLabel(run) }))) return;

    state.runs = state.runs.filter(function (entry) {
      return entry.id !== runId;
    });
    state.latestResult = state.runs.length ? state.runs[0] : null;
    if (state.selectedResultId === runId) selectResult(null);
    saveRuns();
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
      var selectedRun = findRunById(state.selectedResultId);
      if (selectedRun) return selectedRun;
    }
    return state.latestResult;
  }

  function selectResult(runId) {
    var run = runId ? findRunById(runId) : null;
    state.selectedResultId = run ? run.id : (state.latestResult ? state.latestResult.id : "");
  }

  function scrollResultsPanelToTop() {
    if (!elements.resultsPanel) return;
    var body = elements.resultsPanel.querySelector(".accel-sheet-body");
    if (body && typeof body.scrollTo === "function") body.scrollTo({ top: 0, behavior: "smooth" });
    else if (body) body.scrollTop = 0;
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
    if (!state.geolocationSupported || state.watchId !== null) return;

    try {
      state.watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, GEO_OPTIONS);
    } catch (error) {
      state.watchId = null;
      setActionNotice("accelNoGeolocation");
    }
  }

  function updatePermissionState() {
    if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
      state.permissionState = state.geolocationSupported ? "unknown" : "unsupported";
      renderAll();
      return;
    }

    navigator.permissions.query({ name: "geolocation" }).then(function (status) {
      state.permissionStatus = status;
      state.permissionState = status.state;
      renderAll();

      var handler = function () {
        state.permissionState = status.state;
        renderAll();
      };

      if (typeof status.addEventListener === "function") status.addEventListener("change", handler);
      else status.onchange = handler;
    }).catch(function () {
      state.permissionState = state.geolocationSupported ? "unknown" : "unsupported";
      renderAll();
    });
  }

  function handleGeoError(error) {
    if (!error) return;

    if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) state.permissionState = "denied";
    if (!state.latestSample && error.code === GEO_ERROR_CODE.PERMISSION_DENIED) setActionNotice("accelNeedGps");
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

    if (state.run && (state.run.stage === "armed" || state.run.stage === "waiting_rollout" || state.run.stage === "running")) {
      processRunSample(sample);
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
      if (sample.speedSource === "derived") run.derivedSpeedCount += 1;
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
    if (isFiniteNumber(sample.deltaMs) && sample.deltaMs > 0) run.intervalValues.push(sample.deltaMs);
    if (sample.accuracyM !== null) run.accuracyValues.push(sample.accuracyM);
    if (sample.rawSpeedMs === null) run.nullSpeedCount += 1;
    if (sample.speedSource === "derived") run.derivedSpeedCount += 1;
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
          run.launchCrossDistanceM = interpolateValue(run.prevDistanceSinceArmM, run.distanceSinceArmM, launchCross.ratio);
          run.launchCrossAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, launchCross.ratio);
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
          run.stage = "running";
        } else {
          run.stage = "waiting_rollout";
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
            run.startAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, rolloutCross.ratio);
            run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
            run.startTraceSpeedMs = interpolateValue(previousSpeed, currentSpeed, rolloutCross.ratio);
            run.startSpeedSource = sample.speedSource;
            run.stage = "running";
          }
        }
      }
    } else if (run.startPerfMs === null) {
      var rollingCross = interpolateSpeedCrossing(previousSample, sample, run.preset.startSpeedMs);
      if (rollingCross) {
        run.startPerfMs = rollingCross.perfMs;
        run.startDistanceM = interpolateValue(run.prevDistanceSinceArmM, run.distanceSinceArmM, rollingCross.ratio);
        run.startAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, rollingCross.ratio);
        run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
        run.startTraceSpeedMs = run.preset.startSpeedMs;
        run.startSpeedSource = sample.speedSource;
        run.stage = "running";
      }
    }

    if (run.startPerfMs !== null && run.startAltitudeM === null && isFiniteNumber(sample.altitudeM)) {
      run.startAltitudeM = sample.altitudeM;
    }
    if (run.startPerfMs !== null && run.startAccuracyM === null && isFiniteNumber(sample.accuracyM)) {
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
      if (run.preset.type === "speed") {
        var targetCross = interpolateSpeedCrossing(previousSample, sample, run.preset.targetSpeedMs);
        if (targetCross && targetCross.perfMs >= run.startPerfMs) {
          run.finishPerfMs = targetCross.perfMs;
          run.finishDistanceM = interpolateValue(run.prevDistanceSinceArmM, run.distanceSinceArmM, targetCross.ratio);
          run.finishSpeedMs = run.preset.targetSpeedMs;
          run.finishAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, targetCross.ratio);
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
      } else if (run.preset.type === "distance") {
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
          run.finishAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, finishCross.ratio);
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
    run.stage = "completed";
    run.result = result;
    state.latestResult = result;
    state.runs.unshift(result);
    if (state.runs.length > MAX_RUNS) state.runs = state.runs.slice(0, MAX_RUNS);
    state.selectedResultId = result.id;
    saveRuns();
    playFinishAudio();
    setActionNotice("accelRunSavedNotice");
    renderAll();
  }

  function renderAll() {
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
    var customInvalid = state.settings.selectedPresetId === "custom" && !isCustomRangeValid();
    var primaryLabelKey = state.run && state.run.stage === "completed" ? "accelRunAgain" : "accelArm";
    var gpsReady = isGpsReady();

    elements.armRun.textContent = t(primaryLabelKey);
    elements.cancelRun.textContent = t("accelCancel");
    elements.armRun.hidden = hasActiveRun;
    elements.cancelRun.hidden = !hasActiveRun;
    elements.armRun.disabled = !state.geolocationSupported || customInvalid || !gpsReady;
    elements.cancelRun.disabled = !hasActiveRun;
    elements.clearHistory.disabled = !state.runs.length;
  }

  function renderStatusPanel() {
    var speedUnit = state.settings.speedUnit;
    var permissionLabel = getPermissionLabel(state.permissionState);
    var ready = isGpsReady();
    var liveQuality = isRunActive(state.run)
      ? buildCurrentRunQuality(state.run, state.run.startPerfMs !== null ? performance.now() - state.run.startPerfMs : 0)
      : buildLiveQuality({
        sessionSampleCount: state.sessionSampleCount,
        recentIntervals: state.recentIntervals,
        latestSample: state.latestSample,
        latestSampleStale: isLatestSampleStale(),
        latestSampleSparse: isLatestSampleSparse(),
      });
    var qualityLabel = liveQuality ? getQualityLabel(liveQuality.grade) : t("accelUnavailable");
    var readyLabel = ready ? t("accelReadyYes") : t("accelReadyNo");
    var accuracyLabel = formatDistanceMeasurement(state.latestSample ? state.latestSample.accuracyM : null);

    elements.toolbarPermissionValue.textContent = readyLabel;
    elements.toolbarQualityValue.textContent = accuracyLabel;
    elements.toolbarStateValue.textContent = qualityLabel;

    elements.permissionValue.textContent = permissionLabel;
    elements.gpsReadyValue.textContent = readyLabel;
    elements.latestAccuracyValue.textContent = accuracyLabel;
    elements.observedHzValue.textContent = formatHz(liveQuality ? liveQuality.averageHz : null);
    elements.statusSpeedValue.textContent = formatSpeedValue(state.latestSample ? state.latestSample.speedMs : null, speedUnit);
    elements.statusHeadingValue.textContent = formatHeading(state.latestSample ? state.latestSample.headingDeg : null);
    elements.statusAltitudeValue.textContent = formatDistanceMeasurement(state.latestSample ? state.latestSample.altitudeM : null);
    elements.speedSourceValue.textContent = getSpeedSourceLabel(state.latestSample ? state.latestSample.speedSource : null);
  }

  function renderSheetUi() {
    var setupOpen = state.openPanel === "setup";
    var resultsOpen = state.openPanel === "results";
    var setupSummary = getSetupSummary();
    var resultsSummary = getResultsSummary();

    elements.setupTriggerValue.textContent = setupSummary.title;
    elements.setupTriggerMeta.textContent = setupSummary.meta;
    elements.resultsTriggerValue.textContent = resultsSummary.title;
    elements.resultsTriggerMeta.textContent = resultsSummary.meta;
    elements.setupPanelStatus.textContent = setupSummary.title + " · " + setupSummary.meta;
    elements.resultsPanelStatus.textContent = getResultsPanelStatusText();

    elements.setupTrigger.setAttribute("aria-expanded", String(setupOpen));
    elements.resultsTrigger.setAttribute("aria-expanded", String(resultsOpen));
    elements.setupTrigger.classList.toggle("is-open", setupOpen);
    elements.resultsTrigger.classList.toggle("is-open", resultsOpen);

    elements.sheetBackdrop.hidden = !(setupOpen || resultsOpen);
    elements.setupPanel.hidden = !setupOpen;
    elements.resultsPanel.hidden = !resultsOpen;

    document.body.classList.toggle("accel-sheet-open", setupOpen || resultsOpen);
    if (resultsOpen) requestResultGraphRefresh();
    else destroyResultGraph();
  }

  function renderLiveSpeedometer(preset, liveState) {
    var speedUnit = state.settings.speedUnit;
    var gaugeStep = speedUnit === "kmh" ? 20 : 10;
    var baseGaugeMax = speedUnit === "kmh" ? 140 : 80;
    var currentSpeedMs = state.latestSample ? state.latestSample.speedMs : null;
    var currentDisplay = Math.max(0, isFiniteNumber(currentSpeedMs) ? msToSpeedUnit(currentSpeedMs, speedUnit) : 0);
    var markerValue = preset && preset.type === "speed" && isFiniteNumber(preset.targetSpeedMs)
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
    var liveQuality = run && run.result
      ? { grade: run.result.qualityGrade }
      : (run && run.stage !== "completed"
        ? buildCurrentRunQuality(run, run.startPerfMs !== null ? performance.now() - run.startPerfMs : 0)
        : buildLiveQuality({
          sessionSampleCount: state.sessionSampleCount,
          recentIntervals: state.recentIntervals,
          latestSample: state.latestSample,
          latestSampleStale: isLatestSampleStale(),
          latestSampleSparse: isLatestSampleSparse(),
        }));

    elements.liveStateValue.textContent = liveState;
    elements.liveQualityValue.textContent = liveQuality ? getQualityLabel(liveQuality.grade) : t("accelUnavailable");
    elements.liveTargetValue.textContent = getPresetLabel(displayPreset);
    elements.liveSlopeValue.textContent = formatSlopePercent(getLiveSlopePercent(run));
    renderLivePartials(run);
    renderLiveSpeedometer(displayPreset, liveState);

    if (run && run.stage === "completed" && run.result) {
      elements.liveElapsedValue.textContent = formatRunSeconds(run.result.elapsedMs);
      elements.liveDistanceValue.textContent = formatRunDistance(
        isFiniteNumber(run.result.runDistanceM)
          ? run.result.runDistanceM
          : (run.result.presetKind === "distance" && isFiniteNumber(run.result.distanceTargetM)
            ? run.result.distanceTargetM
          : Math.max(0, (run.distanceSinceArmM || 0) - (run.startDistanceM || 0))
          )
      );
      setProgressFromRun(run, displayPreset);
      return;
    }

    if (run && run.startPerfMs !== null) {
      elements.liveElapsedValue.textContent = formatRunSeconds(getCurrentClockMs() - run.startPerfMs);
    } else {
      elements.liveElapsedValue.textContent = "0.000";
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
      elements.livePartialsList.innerHTML = "";
      return;
    }

    var html = "";
    for (var index = 0; index < run.partials.length; index += 1) {
      var partial = run.partials[index];
      var status = partial.elapsedMs !== null ? "done" : (run.stage === "completed" ? "missed" : "waiting");
      html += '<div class="accel-partial-row" data-status="' + status + '">';
      html += '<span class="accel-partial-label">' + escapeHtml(getPartialLabel(partial)) + "</span>";
      html += '<strong class="accel-partial-value">' + escapeHtml(formatPartialValue(partial, run && run.speedUnit ? run.speedUnit : state.settings.speedUnit, run && run.stage === "completed")) + "</strong>";
      html += "</div>";
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
    } else if (run.stage === "completed" && run.result) {
      fraction = 1;
      if (preset.type === "distance") label = getDistanceProgressLabel(preset.distanceTargetM, preset.distanceTargetM);
      else label = getSpeedProgressLabel(preset.targetSpeedMs, preset.targetSpeedMs, state.settings.speedUnit, preset.startSpeedMs);
    } else if (preset.type === "distance") {
      var distanceValue = run.startPerfMs !== null ? Math.max(0, run.distanceSinceArmM - run.startDistanceM) : 0;
      fraction = preset.distanceTargetM > 0 ? clamp(distanceValue / preset.distanceTargetM, 0, 1) : 0;
      label = getDistanceProgressLabel(distanceValue, preset.distanceTargetM);
    } else {
      var currentSpeed = state.latestSample ? state.latestSample.speedMs : 0;
      var baseline = preset.standingStart ? 0 : preset.startSpeedMs;
      var denominator = Math.max(0.1, preset.targetSpeedMs - baseline);
      fraction = clamp((currentSpeed - baseline) / denominator, 0, 1);
      label = getSpeedProgressLabel(currentSpeed, preset.targetSpeedMs, state.settings.speedUnit, baseline);
    }

    elements.progressLabel.textContent = label;
    elements.progressFill.style.width = String(Math.round(fraction * 1000) / 10) + "%";
  }

  function renderResultCard() {
    var result = getDisplayedResult();

    if (!result) {
      elements.resultEmptyState.hidden = false;
      elements.resultContent.hidden = true;
      if (elements.resultPrimaryHeader) elements.resultPrimaryHeader.hidden = true;
      renderResultPartials(null);
      if (elements.resultNotesRow) elements.resultNotesRow.hidden = true;
      renderResultGraph(null);
      return;
    }

    elements.resultEmptyState.hidden = true;
    elements.resultContent.hidden = false;
    if (elements.resultPrimaryHeader) elements.resultPrimaryHeader.hidden = false;
    elements.resultElapsedValue.textContent = formatRunSeconds(result.elapsedMs) + " s";
    elements.resultPresetValue.textContent = getPresetLabel(result);
    elements.resultFinishSpeedValue.textContent = formatSpeedValue(result.finishSpeedMs, state.settings.speedUnit);
    elements.resultRolloutValue.textContent = getRolloutLabel(result);
    elements.resultAccuracyValue.textContent = formatDistanceMeasurement(result.averageAccuracyM);
    elements.resultSlopeValue.textContent = formatSlopePercent(result.slopePercent);
    elements.resultElevationValue.textContent = formatSignedDistanceMeasurement(result.elevationDeltaM);
    elements.resultHzValue.textContent = formatHz(result.averageHz);
    elements.resultQualityValue.textContent = getQualityLabel(result.qualityGrade);
    elements.resultTimestampValue.textContent = formatTimestamp(result.savedAtMs);
    elements.resultComparisonValue.textContent = buildComparisonText(result);
    renderResultPartials(result);
    if (elements.resultNotesRow && elements.resultNotesValue) {
      var hasNotes = Boolean(result.notes);
      elements.resultNotesRow.hidden = !hasNotes;
      elements.resultNotesValue.textContent = hasNotes ? result.notes : t("accelUnavailable");
    }
    renderResultGraph(result);
  }

  function renderResultPartials(result) {
    if (!elements.resultPartialsSection || !elements.resultPartialsList) return;
    if (!result || !result.partials || !result.partials.length) {
      elements.resultPartialsSection.hidden = true;
      elements.resultPartialsList.innerHTML = "";
      return;
    }

    var html = "";
    for (var index = 0; index < result.partials.length; index += 1) {
      var partial = result.partials[index];
      var status = partial && partial.elapsedMs !== null ? "done" : "missed";
      html += '<div class="accel-partial-row" data-status="' + status + '">';
      html += '<span class="accel-partial-label">' + escapeHtml(getPartialLabel(partial)) + "</span>";
      html += '<strong class="accel-partial-value">' + escapeHtml(formatPartialValue(partial, state.settings.speedUnit, true)) + "</strong>";
      html += "</div>";
    }

    elements.resultPartialsSection.hidden = false;
    elements.resultPartialsList.innerHTML = html;
  }

  function renderResultGraph(result) {
    resultGraph.render(result);
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
    if (!elements.debugRawSection || !elements.debugRawEmptyState || !elements.debugRawTableWrap || !elements.debugRawTableBody) return;

    var activeRun = isRunActive(state.run) ? state.run : null;
    var result = activeRun ? null : getDisplayedResult();
    var rawRows = activeRun && Array.isArray(activeRun.sampleLog)
      ? activeRun.sampleLog
      : (result && Array.isArray(result.sampleLog) ? result.sampleLog : []);
    var hasContext = Boolean(activeRun || result);

    elements.debugRawSection.hidden = !hasContext;
    if (!hasContext) {
      elements.debugRawTableBody.innerHTML = "";
      return;
    }

    if (!rawRows.length) {
      elements.debugRawEmptyState.hidden = false;
      elements.debugRawTableWrap.hidden = true;
      elements.debugRawTableBody.innerHTML = "";
      return;
    }

    var html = "";
    for (var index = rawRows.length - 1; index >= 0; index -= 1) {
      var row = rawRows[index];
      var stateLabel = getDebugSampleState(row);
      html += "<tr>";
      html += "<td>" + escapeHtml(formatInteger(row.index)) + "</td>";
      html += "<td>" + escapeHtml(formatMs(row.deltaMs)) + "</td>";
      html += "<td>" + escapeHtml(formatHz(row.effectiveHz)) + "</td>";
      html += '<td class="accel-debug-mono">' + escapeHtml(formatDebugCoordinatePair(row.latitude, row.longitude)) + "</td>";
      html += "<td>" + escapeHtml(formatDebugSpeedMs(row.rawSpeedMs)) + "</td>";
      html += "<td>" + escapeHtml(formatDebugSpeedMs(row.derivedSpeedMs)) + "</td>";
      html += "<td>" + escapeHtml(formatDebugSpeedMs(row.speedMs)) + "</td>";
      html += "<td>" + escapeHtml(formatHeading(row.headingDeg)) + "</td>";
      html += "<td>" + escapeHtml(formatDebugMeters(row.accuracyM)) + "</td>";
      html += "<td>" + escapeHtml(stateLabel) + "</td>";
      html += "</tr>";
    }

    elements.debugRawEmptyState.hidden = true;
    elements.debugRawTableWrap.hidden = false;
    elements.debugRawTableBody.innerHTML = html;
  }

  function renderDebugGraphTable() {
    if (!elements.debugGraphSection || !elements.debugGraphEmptyState || !elements.debugGraphTableWrap || !elements.debugGraphTableBody) return;

    var activeRun = isRunActive(state.run) ? state.run : null;
    var result = activeRun ? null : getDisplayedResult();
    var graphRows = activeRun
      ? buildGraphDataFromTraceSource(activeRun)
      : (result ? buildResultGraphData(result) : []);
    var hasContext = Boolean(activeRun || result);

    elements.debugGraphSection.hidden = !hasContext;
    if (!hasContext) {
      elements.debugGraphTableBody.innerHTML = "";
      return;
    }

    if (!graphRows.length) {
      elements.debugGraphEmptyState.hidden = false;
      elements.debugGraphTableWrap.hidden = true;
      elements.debugGraphTableBody.innerHTML = "";
      return;
    }

    var html = "";
    for (var index = 0; index < graphRows.length; index += 1) {
      var row = graphRows[index];
      html += "<tr>";
      html += "<td>" + escapeHtml(formatInteger(index + 1)) + "</td>";
      html += "<td>" + escapeHtml(formatMs(row.elapsedMs)) + "</td>";
      html += "<td>" + escapeHtml(formatRunSeconds(row.elapsedMs) + " s") + "</td>";
      html += "<td>" + escapeHtml(formatSpeedValue(row.speedMs, state.settings.speedUnit)) + "</td>";
      html += "<td>" + escapeHtml(formatDebugMeters(row.distanceM)) + "</td>";
      html += "<td>" + escapeHtml(formatDebugMeters(row.altitudeM)) + "</td>";
      html += "<td>" + escapeHtml(formatDebugMeters(row.accuracyM)) + "</td>";
      html += "<td>" + escapeHtml(getSpeedSourceLabel(row.speedSource)) + "</td>";
      html += "</tr>";
    }

    elements.debugGraphEmptyState.hidden = true;
    elements.debugGraphTableWrap.hidden = false;
    elements.debugGraphTableBody.innerHTML = html;
  }

  function getDebugSampleState(sample) {
    if (!sample) return t("accelUnavailable");

    var flags = [];
    if (sample.stale) flags.push("stale");
    if (sample.sparse) flags.push("sparse");

    return flags.length ? sample.stage + " · " + flags.join(", ") : sample.stage;
  }

  function requestResultGraphRefresh() {
    resultGraph.requestRefresh();
  }

  function destroyResultGraph() {
    resultGraph.destroy();
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
        speedSource: state.run.derivedSpeedCount > (state.run.sampleCount / 2) ? "derived" : "reported",
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
    var warnings = warningKeys && warningKeys.length ? warningKeys : ["accelWarningNoWarnings"];
    var html = "";

    for (var index = 0; index < warnings.length; index += 1) {
      var warningKey = warnings[index];
      var tone = warningKey === "accelWarningNoWarnings" ? "ok" : "warning";
      if (warningKey === "accelWarningStale") tone = "danger";
      html += '<span class="accel-warning-badge" data-tone="' + tone + '">' + escapeHtml(t(warningKey)) + "</span>";
    }

    elements.warningBadges.innerHTML = html;
  }

  function renderHistory() {
    if (!state.runs.length) {
      elements.historyEmptyState.hidden = false;
      elements.historyList.innerHTML = "";
      return;
    }

    elements.historyEmptyState.hidden = true;

    var html = "";
    var displayedResult = getDisplayedResult();
    for (var index = 0; index < state.runs.length; index += 1) {
      var run = state.runs[index];
      var isSelected = Boolean(displayedResult && displayedResult.id === run.id);
      html += '<article class="accel-history-item" data-selected="' + String(isSelected) + '">';
      html += '<div class="accel-history-copy">';
      html += '<div class="accel-history-main"><strong>' + escapeHtml(getPresetLabel(run)) + "</strong> <span>" + escapeHtml(formatRunSeconds(run.elapsedMs)) + " s</span></div>";
      html += '<div class="accel-history-meta">' + escapeHtml(getQualityLabel(run.qualityGrade)) + " · " + escapeHtml(formatTimestamp(run.savedAtMs)) + "</div>";
      if (run.notes) html += '<div class="accel-history-note">' + escapeHtml(run.notes) + "</div>";
      html += "</div>";
      html += '<div class="accel-history-actions">';
      html += '<button type="button" class="accel-action-btn accel-action-btn-compact accel-history-load-btn" data-history-action="load" data-run-id="' + escapeHtml(run.id) + '" aria-pressed="' + String(isSelected) + '">' + escapeHtml(isSelected ? t("accelViewingResult") : t("accelLoadResult")) + "</button>";
      html += '<button type="button" class="accel-delete-btn" data-history-action="delete" data-run-id="' + escapeHtml(run.id) + '">' + escapeHtml(t("accelDelete")) + "</button>";
      html += "</div>";
      html += "</article>";
    }

    elements.historyList.innerHTML = html;
  }

  function getSetupSummary() {
    var preset = getSelectedPreset();
    var metaParts = [preset.standingStart ? t("accelStandingStart") : t("accelRollingStart")];

    if (preset.standingStart) {
      metaParts.push(state.settings.rolloutEnabled ? t("accelRolloutOn") : t("accelRolloutOff"));
    }

    metaParts.push(getSpeedUnitLabel(state.settings.speedUnit) + " / " + getDistanceUnitLabel(state.settings.distanceUnit));

    return {
      title: getPresetLabel(preset),
      meta: metaParts.join(" · "),
    };
  }

  function getResultsSummary() {
    var result = getDisplayedResult();
    if (!result) {
      return {
        title: t("accelNoSavedRunsShort"),
        meta: t("accelLocalOnly"),
      };
    }

    return {
      title: formatRunSeconds(result.elapsedMs) + " s",
      meta: getPresetLabel(result) + " · " + getQualityLabel(result.qualityGrade),
    };
  }

  function getResultsPanelStatusText() {
    var result = getDisplayedResult();
    if (!result) return t("accelStorageNote");
    return getPresetLabel(result) + " · " + formatTimestamp(result.savedAtMs);
  }

  function getRunStateLabel() {
    if (!state.geolocationSupported) return t("accelStateError");
    if (!isGpsReady() && (!state.run || state.run.stage !== "completed")) return t("accelStateGpsWaiting");
    if (!state.run) return t("accelStateIdle");

    switch (state.run.stage) {
      case "armed":
        return t("accelStateWaitingLaunch");
      case "waiting_rollout":
        return t("accelStateWaitingRollout");
      case "running":
        return t("accelStateRunning");
      case "completed":
        return t("accelStateCompleted");
      default:
        return t("accelStateIdle");
    }
  }

  function getPermissionLabel(permissionState) {
    switch (permissionState) {
      case "granted":
        return t("accelPermissionGranted");
      case "denied":
        return t("accelPermissionDenied");
      case "prompt":
        return t("accelPermissionPrompt");
      case "unsupported":
        return t("accelPermissionUnsupported");
      default:
        return t("accelPermissionUnknown");
    }
  }

  function getQualityLabel(grade) {
    switch (grade) {
      case "good":
        return t("accelQualityGood");
      case "fair":
        return t("accelQualityFair");
      case "poor":
        return t("accelQualityPoor");
      default:
        return t("accelQualityInvalid");
    }
  }

  function getSpeedSourceLabel(source) {
    if (source === "derived") return t("accelSpeedDerivedLabel");
    if (source === "reported") return t("accelSpeedReported");
    return t("accelUnavailable");
  }

  function getRolloutLabel(result) {
    if (!result.standingStart) return t("accelRolloutIgnored");
    return result.rolloutApplied ? t("accelRolloutOn") : t("accelRolloutOff");
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
    return Boolean(state.latestSample && (state.latestSample.stale || getLatestSampleAgeMs() >= STALE_INTERVAL_MS));
  }

  function isLatestSampleSparse() {
    return Boolean(state.latestSample && (state.latestSample.sparse || getLatestSampleAgeMs() >= SPARSE_INTERVAL_MS));
  }

  function isCustomRangeValid() {
    return toFiniteNumber(state.settings.customEnd, 0) > toFiniteNumber(state.settings.customStart, 0);
  }

  function setActionNotice(key, params) {
    if (state.actionNoticeTimerId) window.clearTimeout(state.actionNoticeTimerId);
    elements.actionNotice.textContent = t(key, params || {});

    state.actionNoticeTimerId = window.setTimeout(function () {
      elements.actionNotice.textContent = "";
      state.actionNoticeTimerId = null;
    }, 2600);
  }

  function getLiveSlopePercent(run) {
    if (!run) return null;
    if (run.stage === "completed" && run.result) return run.result.slopePercent;
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
})();
