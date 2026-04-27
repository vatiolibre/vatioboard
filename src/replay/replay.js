import 'maplibre-gl/dist/maplibre-gl.css';
import '@stanko/dual-range-input/dist/index.css';
import '../styles/replay.less';
import '../styles/cloud-sync-status.less';
import '../styles/backend-auth.less';
import { createCleanupStack } from '../app/view-cleanup.js';
import { applyTranslations, getLang, t, toggleLang } from '../i18n.js';
import {
  IconAccel,
  IconBoard,
  IconDistance,
  IconPages,
  IconPause,
  IconPlay,
  IconRestart,
  IconSpeed,
  IconTime,
  IconWorld,
} from '../icons.js';
import {
  initBackendAuthControllers,
} from '../shared/backend-auth.js';
import { initCloudSyncStatusIndicator } from '../shared/cloud-sync-status-indicator.js';
import { getCurrentAppRouteQuery, navigateToAppRoute, ROUTE_VISIBLE_EVENT } from '../app/router.js';
import {
  CLOUD_SYNC_APPLIED_EVENT,
  CLOUD_SYNC_ENTITY_TYPES,
  queueCloudSyncDeletion,
  startCloudSyncLoop,
} from '../shared/cloud-sync.js';
import {
  clearReplayRestoreFailure,
  ensureReplayTelemetry,
  getReplaySelection,
  listReplayRecords,
  registerLinkedReplayCloudRecord,
  removeReplayRecord,
} from '../shared/repositories/replay-repository.js';
import {
  NAVIGATION_PAYLOAD_RESOURCES,
  queueNavigationPayloadHandoff,
} from '../shared/navigation-payload-handoff.js';
import {
  ensureSingleTabOwnership,
  releaseSingleTabOwnership,
  SINGLE_TAB_OWNERSHIP_EVENT,
} from '../shared/single-tab.js';
import { applyButtonIcon, getActiveToolsMenuList, initToolsMenu } from '../shared/tools-menu.js';
import { integratePlayerWidget } from '../player/integrate-player-widget.js';
import {
  getReplayAxisRange,
  formatReplayDistanceValue,
  formatReplaySpeedValue,
  getReplayHighlights,
  getReplayPlayedCoordinates,
  getReplaySampleAtDistanceM,
  getReplaySampleAtElapsedMs,
  getReplaySummary,
} from './logic.js';
import { createReplayChartsController } from './charts.js';
import { createReplayMapController } from './map.js';
import { isReplayPayloadComplete } from './session.js';

const isSpaRuntime = Boolean(window.__vatioboardSpa);

function queryAll(root, selector) {
  return root?.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : [];
}

function queryOne(root, selector) {
  return root?.querySelector ? root.querySelector(selector) : null;
}

export function getReplayElements(root) {
  return {
    langToggle: queryOne(root, '#langToggle'),
    langToggleButtons: queryAll(root, '[data-lang-toggle], #langToggle'),
    pageDescriptionMeta: root ? document.querySelector('meta[name="description"]') : null,
    toolbar: queryOne(root, '.replay-toolbar'),
    replaySessionChip: queryOne(root, '#replaySessionChip'),
    replayAxisButtons: queryAll(root, '.replay-axis-btn'),
    replayGraphTriggers: queryAll(root, '.replay-graph-trigger'),
    replayToolsMenuBtn: queryOne(root, '#replayToolsMenuBtn'),
    replayToolsMenuList: queryOne(root, '#replayToolsMenuList'),
    openReplaySpeedMenu: queryOne(root, '#openReplaySpeedMenu'),
    openReplayAccelMenu: queryOne(root, '#openReplayAccelMenu'),
    openReplayLibraryMenu: queryOne(root, '#openReplayLibraryMenu'),
    openReplayBoardMenu: queryOne(root, '#openReplayBoardMenu'),
    replayRecordedAtValue: queryOne(root, '#replayRecordedAtValue'),
    replaySampleCountValue: queryOne(root, '#replaySampleCountValue'),
    replayEmptyState: queryOne(root, '#replayEmptyState'),
    replayOpenSpeed: queryOne(root, '#replayOpenSpeed'),
    replayShell: queryOne(root, '#replayShell'),
    replayMap: queryOne(root, '#replayMap'),
    replayPlayPause: queryOne(root, '#replayPlayPause'),
    replayPlayPauseIcon: queryOne(root, '#replayPlayPauseIcon'),
    replayPlayPauseText: queryOne(root, '#replayPlayPauseText'),
    replayRestart: queryOne(root, '#replayRestart'),
    replayRestartIcon: queryOne(root, '#replayRestartIcon'),
    replayApproach: queryOne(root, '#replayApproach'),
    replayApproachIcon: queryOne(root, '#replayApproachIcon'),
    replayProgress: queryOne(root, '#replayProgress'),
    replayElapsedValue: queryOne(root, '#replayElapsedValue'),
    replayDurationValue: queryOne(root, '#replayDurationValue'),
    replayPeakSpeedValue: queryOne(root, '#replayPeakSpeedValue'),
    replayAverageSpeedValue: queryOne(root, '#replayAverageSpeedValue'),
    replaySummaryDistanceValue: queryOne(root, '#replaySummaryDistanceValue'),
    replaySummaryDurationValue: queryOne(root, '#replaySummaryDurationValue'),
    replayAltitudeRangeValue: queryOne(root, '#replayAltitudeRangeValue'),
    replayRouteValue: queryOne(root, '#replayRouteValue'),
    replayHighlightsList: queryOne(root, '#replayHighlightsList'),
    replayRecordingsList: queryOne(root, '#replayRecordingsList'),
    replayRateButtons: queryAll(root, '.replay-rate-btn'),
    replayGraphSheet: queryOne(root, '#replayGraphSheet'),
    replayGraphSheetBackdrop: queryOne(root, '#replayGraphSheetBackdrop'),
    closeReplayGraphSheet: queryOne(root, '#closeReplayGraphSheet'),
    replayGraphSheetTitle: queryOne(root, '#replayGraphSheetTitle'),
    replayFilterSlider: queryOne(root, '#replayFilterSlider'),
    replayFilterStart: queryOne(root, '#replayFilterStart'),
    replayFilterEnd: queryOne(root, '#replayFilterEnd'),
    replayFilterStartValue: queryOne(root, '#replayFilterStartValue'),
    replayFilterEndValue: queryOne(root, '#replayFilterEndValue'),
  };
}

export function getReplayGraphElements(root) {
  return {
    speed: {
      current: queryOne(root, '#replayGraphSpeedCurrent'),
      canvas: queryOne(root, '#replayGraphSpeedCanvas'),
    },
    altitude: {
      current: queryOne(root, '#replayGraphAltitudeCurrent'),
      canvas: queryOne(root, '#replayGraphAltitudeCanvas'),
    },
    heading: {
      current: queryOne(root, '#replayGraphHeadingCurrent'),
      canvas: queryOne(root, '#replayGraphHeadingCanvas'),
    },
    expanded: {
      speed: {
        current: queryOne(root, '#replayExpandedSpeedCurrent'),
        canvas: queryOne(root, '#replayExpandedSpeedCanvas'),
      },
      altitude: {
        current: queryOne(root, '#replayExpandedAltitudeCurrent'),
        canvas: queryOne(root, '#replayExpandedAltitudeCanvas'),
      },
      heading: {
        current: queryOne(root, '#replayExpandedHeadingCurrent'),
        canvas: queryOne(root, '#replayExpandedHeadingCanvas'),
      },
    },
  };
}

function createInactiveReplayElements() {
  return getReplayElements(null);
}

function createInactiveReplayGraphElements() {
  return getReplayGraphElements(null);
}

function createInactiveToolsMenu() {
  return {
    close() {},
    destroy() {},
    setOpen() {},
  };
}

function createInactiveReplayChartsController() {
  return {
    destroy() {},
    renderSession() {},
    setDetailOpen() {},
    setDetailRange() {},
    updatePlayback() {},
  };
}

function createInactiveReplayMapController() {
  return {
    cancelApproachAnimation() {},
    destroy() {},
    init() {
      return Promise.resolve();
    },
    renderPlaybackFrame() {},
    resize() {},
    runApproachAnimation() {
      return Promise.resolve();
    },
    setSession() {},
  };
}

let elements = createInactiveReplayElements();
let graphElements = createInactiveReplayGraphElements();
let toolsMenu = createInactiveToolsMenu();
let replayFilterController = null;
let chartsController = createInactiveReplayChartsController();
let mapController = createInactiveReplayMapController();
let singleTabOwnershipPromise = Promise.resolve(true);
let replayRouteGeneration = 0;
let activeReplayRoute = null;
let standaloneCleanup = null;
let standaloneBackendAuthInitialized = false;
let DualRangeInput = null;
let dualRangeInputLoadPromise = null;
let Chart = null;
let chartLoadPromise = null;

function loadDualRangeInput() {
  if (!dualRangeInputLoadPromise) {
    dualRangeInputLoadPromise = import('@stanko/dual-range-input').then((module) => {
      DualRangeInput = module.default || module;
      return DualRangeInput;
    });
  }
  return dualRangeInputLoadPromise;
}

function loadChart() {
  if (!chartLoadPromise) {
    chartLoadPromise = import('chart.js/auto').then((module) => {
      Chart = module.default || module;
      return Chart;
    });
  }
  return chartLoadPromise;
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
  const menuList = getActiveToolsMenuList(elements.replayToolsMenuList);
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
  toolsMenu.setOpen(true);
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

let replayRouteLifecycle = {
  mount() {},
  unmount() {},
};

export function mountReplayRoute(routeContext = {}) {
  return replayRouteLifecycle.mount(routeContext);
}

export function unmountReplayRoute() {
  replayRouteLifecycle.unmount();
}

const state = {
  records: [],
  selectedRecordingId: null,
  sessionSource: null,
  session: null,
  initialSelectionPending: true,
  summary: getReplaySummary(null),
  highlights: getReplayHighlights(null),
  playbackRate: 1000,
  dashboardAxis: 'time',
  elapsedMs: 0,
  playing: false,
  playPending: false,
  frameId: null,
  lastFrameAt: null,
  viewMounted: false,
  initialized: false,
  introPlayed: false,
  expandedGraphOpen: false,
  expandedGraphFilterStartRatio: 0,
  expandedGraphFilterEndRatio: 1,
  expandedGraphPointerId: null,
};
let replaySelectionPromise = Promise.resolve();
let replaySelectionKickoffPromise = Promise.resolve();
let replaySelectionRequestVersion = 0;
let hasHydratedInitialSelection = false;
let introApproachPromise = null;
let introApproachToken = 0;
let recordingsDetailMeasureFrame = null;
let pendingReplayRecoveryRecordingId = null;

refreshDerivedState();

function cancelReplayApproach({ markPlayed = false } = {}) {
  introApproachToken += 1;
  introApproachPromise = null;
  mapController.cancelApproachAnimation();
  if (markPlayed) {
    state.introPlayed = true;
  }
}

function runReplayApproach({ force = false } = {}) {
  if (isSpaRuntime && !state.viewMounted) return Promise.resolve();
  if (!state.session) return Promise.resolve();
  if (!force && state.introPlayed) return Promise.resolve();
  if (introApproachPromise) return introApproachPromise;

  const runToken = introApproachToken;
  introApproachPromise = (async () => {
    await mapController.init();
    if (runToken !== introApproachToken || !state.session) return;
    await mapController.runApproachAnimation();
    if (runToken !== introApproachToken || !state.session) return;
    state.introPlayed = true;
  })().finally(() => {
    if (runToken === introApproachToken) {
      introApproachPromise = null;
    }
  });

  return introApproachPromise;
}

function bindMenuNavigation(element, href, cleanup) {
  if (!element) return;

  cleanup.addEventListener(element, 'click', () => {
    toolsMenu.close();
    navigateToAppRoute(href);
  });
}

function refreshDerivedState() {
  state.summary = getReplaySummary(state.session);
  state.highlights = getReplayHighlights(state.session);
}

function isLatestReplaySelectionRequest(requestId) {
  return Number.isFinite(requestId) && requestId === replaySelectionRequestVersion;
}

function shouldApplyReplayRestore(requestId, restoreRecordingId) {
  if (isLatestReplaySelectionRequest(requestId)) return true;
  return Boolean(
    typeof restoreRecordingId === 'string'
    && restoreRecordingId
    && (
      state.selectedRecordingId === restoreRecordingId
      || pendingReplayRecoveryRecordingId === restoreRecordingId
    )
  );
}

function hasReplayRecordSelection(recordingId = state.selectedRecordingId) {
  return Boolean(
    typeof recordingId === 'string'
    && recordingId
    && (state.session?.id === recordingId || state.records.some((record) => record.id === recordingId))
  );
}

function hasMissingReplaySelection(recordingId = state.selectedRecordingId) {
  return Boolean(
    typeof recordingId === 'string'
    && recordingId
    && !hasReplayRecordSelection(recordingId)
  );
}

function maybeFallbackMissingReplaySelection(recordingId = state.selectedRecordingId) {
  if (!hasMissingReplaySelection(recordingId)) return;
  void requestReplaySelection(null);
}

async function refreshReplayRecordsList() {
  state.records = await listReplayRecords();
  renderRecordings();
}

function getSpeedUnit() {
  return state.session?.unit === 'mph' ? 'mph' : 'kmh';
}

function getDistanceUnit() {
  return state.session?.distanceUnit === 'ft' ? 'ft' : 'm';
}

function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat(getLang(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDateTime(timestampMs) {
  if (!Number.isFinite(timestampMs)) return '—';

  return new Intl.DateTimeFormat(getLang(), {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestampMs));
}

function formatSpeed(speedMs) {
  if (!Number.isFinite(speedMs)) return '—';

  const unit = getSpeedUnit();
  const label = unit === 'mph' ? 'mph' : 'km/h';
  const speedValue = formatReplaySpeedValue(speedMs, unit);
  return `${formatNumber(speedValue, 0)} ${label}`;
}

function formatDistance(distanceM) {
  if (!Number.isFinite(distanceM)) return '—';

  const unit = getDistanceUnit();
  const distanceValue = formatReplayDistanceValue(distanceM, unit);
  const decimals = unit === 'm' && distanceValue < 1000 ? 0 : 1;
  const label = unit === 'ft' ? 'ft' : 'm';

  if (unit === 'ft' && distanceValue >= 5280) {
    return `${formatNumber(distanceM / 1609.344, distanceM < 16093.44 ? 1 : 0)} mi`;
  }

  if (unit === 'm' && distanceValue >= 1000) {
    return `${formatNumber(distanceM / 1000, distanceM < 10000 ? 1 : 0)} km`;
  }

  return `${formatNumber(distanceValue, decimals)} ${label}`;
}

function formatAltitude(altitudeM) {
  if (!Number.isFinite(altitudeM)) return '—';

  const unit = getDistanceUnit();
  const label = unit === 'ft' ? 'ft' : 'm';
  const altitudeValue = formatReplayDistanceValue(altitudeM, unit);
  return `${formatNumber(altitudeValue, 0)} ${label}`;
}

function formatHeading(headingDeg) {
  if (!Number.isFinite(headingDeg)) return '—';

  const normalizedHeading = ((headingDeg % 360) + 360) % 360;
  const sectors = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  const sector = sectors[Math.round(normalizedHeading / 45)];
  return `${formatNumber(normalizedHeading, 0)}° ${sector}`;
}

function formatAcceleration(value) {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value, 1)} m/s²`;
}

function setElementText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function syncRecordingDetailOverflow() {
  if (!elements.replayRecordingsList) return;

  for (const detail of elements.replayRecordingsList.querySelectorAll('.replay-recording-detail')) {
    const text = detail.querySelector('.replay-recording-detail-text');
    const button = detail.closest('.replay-recording-btn');

    detail.dataset.overflowing = 'false';
    detail.style.removeProperty('--replay-detail-scroll-distance');
    detail.style.removeProperty('--replay-detail-scroll-duration');

    if (!text || button?.getAttribute('aria-pressed') !== 'true') continue;

    const overflowPx = Math.ceil(text.scrollWidth - detail.clientWidth);
    if (!Number.isFinite(overflowPx) || overflowPx <= 8) continue;

    detail.dataset.overflowing = 'true';
    detail.style.setProperty('--replay-detail-scroll-distance', `${overflowPx}px`);
    detail.style.setProperty(
      '--replay-detail-scroll-duration',
      `${Math.max(8, Math.min(22, overflowPx / 18 + 6)).toFixed(2)}s`
    );
  }
}

function queueRecordingDetailOverflowSync() {
  if (recordingsDetailMeasureFrame !== null) {
    window.cancelAnimationFrame(recordingsDetailMeasureFrame);
  }

  recordingsDetailMeasureFrame = window.requestAnimationFrame(() => {
    recordingsDetailMeasureFrame = null;
    syncRecordingDetailOverflow();
  });
}

function updatePageMeta() {
  document.documentElement.lang = getLang();
  document.title = t('replayPageTitle');
  if (elements.pageDescriptionMeta) {
    elements.pageDescriptionMeta.setAttribute('content', t('replayPageDescription'));
  }
}

function renderSessionState() {
  if (!elements.replaySessionChip) return;
  if (!state.session) {
    elements.replaySessionChip.textContent = t('driveReplay');
    return;
  }
  elements.replaySessionChip.textContent =
    state.sessionSource === 'active' ? t('replaySessionActive') : t('replaySessionSaved');
}

function renderRateButtons() {
  for (const button of elements.replayRateButtons) {
    const isActive = Number(button.dataset.rate) === state.playbackRate;
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function renderAxisButtons() {
  for (const button of elements.replayAxisButtons) {
    const isActive = button.dataset.axis === state.dashboardAxis;
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function renderExpandedGraphControls() {
  const axisRange = getExpandedGraphAxisRange();
  const startValue = Math.round(axisRange.startRatio * 1000);
  const endValue = Math.round(axisRange.endRatio * 1000);

  if (elements.replayFilterStart) {
    elements.replayFilterStart.value = String(startValue);
  }

  if (elements.replayFilterEnd) {
    elements.replayFilterEnd.value = String(endValue);
  }

  if (elements.replayFilterStartValue) {
    elements.replayFilterStartValue.textContent = formatExpandedGraphAxisValue(axisRange.min);
  }

  if (elements.replayFilterEndValue) {
    elements.replayFilterEndValue.textContent = formatExpandedGraphAxisValue(axisRange.max);
  }

  if (elements.replayFilterSlider) {
    replayFilterController?.update();
  }
}

function renderExpandedGraphPlayback(sample) {
  setElementText(graphElements.expanded.speed.current, formatSpeed(sample?.speedMs));
  setElementText(graphElements.expanded.altitude.current, formatAltitude(sample?.altitudeM));
  setElementText(graphElements.expanded.heading.current, formatHeading(sample?.headingDeg));
}

function renderExpandedGraphSheet() {
  const shouldOpen = state.expandedGraphOpen && Boolean(state.session);

  if (elements.replayGraphSheet) {
    elements.replayGraphSheet.hidden = !shouldOpen;
  }
  document.body.classList.toggle('replay-graph-sheet-open', shouldOpen);

  if (!shouldOpen) {
    chartsController.setDetailOpen(false);
    return;
  }

  chartsController.setDetailRange(
    state.expandedGraphFilterStartRatio,
    state.expandedGraphFilterEndRatio
  );
  chartsController.setDetailOpen(true);
  renderExpandedGraphControls();
  renderExpandedGraphPlayback(getReplaySampleAtElapsedMs(state.session, state.elapsedMs));
}

function renderPlaybackButtons() {
  if (!elements.replayPlayPause) return;
  const hasSession = Boolean(state.session);
  const label = state.playing || state.playPending ? t('replayPause') : t('replayPlay');
  if (elements.replayPlayPauseIcon) {
    elements.replayPlayPauseIcon.innerHTML =
      state.playing || state.playPending ? IconPause : IconPlay;
  }
  if (elements.replayPlayPauseText) {
    elements.replayPlayPauseText.textContent = label;
  }
  elements.replayPlayPause.setAttribute('aria-label', label);
  elements.replayPlayPause.title = label;
  elements.replayPlayPause.disabled = !hasSession;
}

function renderActionIcons() {
  const hasSession = Boolean(state.session);
  if (elements.replayRestartIcon) {
    elements.replayRestartIcon.innerHTML = IconRestart;
  }
  if (elements.replayApproachIcon) {
    elements.replayApproachIcon.innerHTML = IconWorld;
  }
  if (elements.replayRestart) {
    const restartLabel = t('replayRestart');
    elements.replayRestart.setAttribute('aria-label', restartLabel);
    elements.replayRestart.title = restartLabel;
    elements.replayRestart.disabled = !hasSession;
  }
  if (elements.replayApproach) {
    const approachLabel = t('replayApproach');
    elements.replayApproach.setAttribute('aria-label', approachLabel);
    elements.replayApproach.title = approachLabel;
    elements.replayApproach.disabled = !hasSession;
  }
}

function renderStaticSummary() {
  setElementText(
    elements.replayRecordedAtValue,
    formatDateTime(state.summary.endedAtMs ?? state.summary.startedAtMs)
  );
  setElementText(elements.replaySampleCountValue, formatNumber(state.summary.sampleCount, 0));
  setElementText(elements.replayPeakSpeedValue, formatSpeed(state.summary.maxSpeedMs));
  setElementText(elements.replayAverageSpeedValue, formatSpeed(state.summary.averageSpeedMs));
  setElementText(elements.replaySummaryDistanceValue, formatDistance(state.summary.totalDistanceM));
  setElementText(elements.replaySummaryDurationValue, formatDuration(state.summary.durationMs));
  setElementText(elements.replayDurationValue, formatDuration(state.summary.durationMs));
  setElementText(elements.replayRouteValue, state.summary.routeLabel || '—');

  if (Number.isFinite(state.summary.minAltitudeM) && Number.isFinite(state.summary.maxAltitudeM)) {
    setElementText(
      elements.replayAltitudeRangeValue,
      `${formatAltitude(state.summary.minAltitudeM)} → ${formatAltitude(state.summary.maxAltitudeM)}`
    );
  } else {
    setElementText(elements.replayAltitudeRangeValue, '—');
  }
}

function renderHighlights() {
  elements.replayHighlightsList.innerHTML = '';

  if (!state.highlights.length) {
    const empty = document.createElement('div');
    empty.className = 'replay-highlight';
    empty.textContent = t('replayNoHighlights');
    elements.replayHighlightsList.appendChild(empty);
    return;
  }

  for (let index = 0; index < state.highlights.length; index += 1) {
    const highlight = state.highlights[index];
    const item = document.createElement('article');
    item.className = 'replay-highlight';

    const label = document.createElement('span');
    label.className = 'replay-highlight-label';
    label.textContent = t(highlight.labelKey);

    const value = document.createElement('strong');
    value.className = 'replay-highlight-value';
    if (highlight.valueUnit === 'speed') {
      value.textContent = formatSpeed(highlight.value);
    } else if (highlight.valueUnit === 'altitude') {
      value.textContent = formatAltitude(highlight.value);
    } else if (highlight.valueUnit === 'acceleration') {
      value.textContent = formatAcceleration(highlight.value);
    } else {
      value.textContent = String(highlight.value ?? '—');
    }

    const detail = document.createElement('span');
    detail.className = 'replay-highlight-detail';
    detail.textContent = `${formatDuration(highlight.elapsedMs)} · ${formatDateTime(highlight.sample?.timestampMs)}`;

    item.appendChild(label);
    item.appendChild(value);
    item.appendChild(detail);
    elements.replayHighlightsList.appendChild(item);
  }
}

function renderRecordings() {
  if (!elements.replayRecordingsList) return;

  elements.replayRecordingsList.innerHTML = '';

  if (!state.records.length) {
    const empty = document.createElement('div');
    empty.className = 'replay-highlight';
    empty.textContent = t('replayNoRecordings');
    elements.replayRecordingsList.appendChild(empty);
    queueRecordingDetailOverflowSync();
    return;
  }

  for (const record of state.records) {
    const summary = getReplaySummary(record.session);
    const item = document.createElement('article');
    item.className = 'replay-recording-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'replay-recording-btn';
    button.dataset.recordingId = record.id;
    button.setAttribute('aria-pressed', String(record.id === state.selectedRecordingId));

    const title = document.createElement('span');
    title.className = 'replay-recording-title';

    const titleText = document.createElement('strong');
    titleText.textContent = formatDateTime(summary.endedAtMs ?? summary.startedAtMs);

    const chip = document.createElement('span');
    chip.className = 'replay-recording-chip';
    chip.textContent =
      record.source === 'active' ? t('replaySessionActive') : t('replaySessionSaved');

    title.append(titleText, chip);

    const meta = document.createElement('span');
    meta.className = 'replay-recording-meta';
    meta.textContent = `${formatDistance(summary.totalDistanceM)} · ${formatDuration(summary.durationMs)}`;

    const detail = document.createElement('span');
    detail.className = 'replay-recording-detail';
    const detailText = document.createElement('span');
    detailText.className = 'replay-recording-detail-text';
    detailText.textContent =
      summary.routeLabel && summary.routeLabel !== '—'
        ? `${formatNumber(summary.sampleCount, 0)} ${t('replaySamples').toLowerCase()} · ${summary.routeLabel}`
        : `${formatNumber(summary.sampleCount, 0)} ${t('replaySamples').toLowerCase()}`;
    detail.appendChild(detailText);

    button.append(title, meta, detail);
    item.appendChild(button);

    if (record.source === 'library') {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'replay-recording-delete';
      deleteButton.dataset.deleteRecordingId = record.id;
      deleteButton.setAttribute('aria-label', t('replayDeleteRecording'));
      deleteButton.title = t('replayDeleteRecording');
      deleteButton.textContent = t('delete');
      item.appendChild(deleteButton);
    }

    elements.replayRecordingsList.appendChild(item);
  }

  queueRecordingDetailOverflowSync();
}

function renderGraphs() {
  chartsController.renderSession(state.session, state.dashboardAxis);
  renderExpandedGraphSheet();
}

function updateGraphPlayback(sample) {
  setElementText(graphElements.speed.current, formatSpeed(sample?.speedMs));
  setElementText(graphElements.altitude.current, formatAltitude(sample?.altitudeM));
  setElementText(graphElements.heading.current, formatHeading(sample?.headingDeg));
  renderExpandedGraphPlayback(sample);
  chartsController.updatePlayback(sample);
}

function getPlaybackProgressCurrentLabel(sample) {
  if (state.dashboardAxis === 'distance') {
    return formatDistance(sample?.totalDistanceM ?? 0);
  }

  return formatDuration(sample?.elapsedMs ?? 0);
}

function getPlaybackProgressTotalLabel() {
  if (state.dashboardAxis === 'distance') {
    return formatDistance(state.summary.totalDistanceM);
  }

  return formatDuration(state.summary.durationMs);
}

function getPlaybackAxisMaxValue() {
  return state.dashboardAxis === 'distance'
    ? Math.max(0, state.summary.totalDistanceM)
    : Math.max(0, state.summary.durationMs);
}

function getExpandedGraphAxisMaxValue() {
  return state.dashboardAxis === 'distance'
    ? Math.max(0, state.summary.totalDistanceM)
    : Math.max(0, state.summary.durationMs / 1000);
}

function getExpandedGraphAxisRange() {
  return getReplayAxisRange(
    getExpandedGraphAxisMaxValue(),
    state.expandedGraphFilterStartRatio,
    state.expandedGraphFilterEndRatio
  );
}

function formatExpandedGraphAxisValue(axisValue) {
  if (state.dashboardAxis === 'distance') {
    return formatDistance(axisValue);
  }

  return formatDuration(axisValue * 1000);
}

function getPlaybackAxisValue(sample) {
  if (state.dashboardAxis === 'distance') {
    return Math.max(0, sample?.totalDistanceM ?? 0);
  }
  return Math.max(0, sample?.elapsedMs ?? 0);
}

function renderPlaybackProgressScale(sample) {
  if (!elements.replayProgress) return;

  elements.replayProgress.min = '0';
  elements.replayProgress.max = String(getPlaybackAxisMaxValue());
  elements.replayProgress.step = 'any';
  elements.replayProgress.value = String(getPlaybackAxisValue(sample));
}

function renderPlaybackFrame() {
  if (!state.session) {
    updateGraphPlayback(null);
    return;
  }

  const sample = getReplaySampleAtElapsedMs(state.session, state.elapsedMs);
  if (!sample) {
    updateGraphPlayback(null);
    return;
  }

  const playedCoordinates = getReplayPlayedCoordinates(state.session, state.elapsedMs);
  renderPlaybackProgressScale(sample);
  setElementText(elements.replayElapsedValue, getPlaybackProgressCurrentLabel(sample));
  setElementText(elements.replayDurationValue, getPlaybackProgressTotalLabel());
  updateGraphPlayback(sample);

  mapController.renderPlaybackFrame({
    sample,
    playedCoordinates,
  });
}

function cancelPlaybackFrame() {
  if (state.frameId === null) return;
  window.cancelAnimationFrame(state.frameId);
  state.frameId = null;
}

function stopPlayback() {
  state.playing = false;
  state.playPending = false;
  state.lastFrameAt = null;
  cancelPlaybackFrame();
  renderPlaybackButtons();
}

function applyReplayIcons(routeElements = elements) {
  applyButtonIcon(routeElements.openReplaySpeedMenu, IconSpeed);
  applyButtonIcon(routeElements.openReplayAccelMenu, IconAccel);
  applyButtonIcon(routeElements.openReplayLibraryMenu, IconWorld);
  applyButtonIcon(routeElements.openReplayBoardMenu, IconBoard);
  applyButtonIcon(routeElements.replayToolsMenuBtn, IconPages);
  for (const button of routeElements.replayAxisButtons) {
    if (button.dataset.axis === 'time') {
      applyButtonIcon(button, IconTime);
    } else if (button.dataset.axis === 'distance') {
      applyButtonIcon(button, IconDistance);
    }
  }
}

function createReplayRouteControllers(routeElements = elements, routeGraphElements = graphElements) {
  replayFilterController =
    routeElements.replayFilterStart && routeElements.replayFilterEnd
      ? new DualRangeInput(routeElements.replayFilterStart, routeElements.replayFilterEnd)
      : null;
  chartsController = createReplayChartsController({
    Chart,
    elements: {
      speedCanvas: routeGraphElements.speed.canvas,
      altitudeCanvas: routeGraphElements.altitude.canvas,
      headingCanvas: routeGraphElements.heading.canvas,
      detailSpeedCanvas: routeGraphElements.expanded.speed.canvas,
      detailAltitudeCanvas: routeGraphElements.expanded.altitude.canvas,
      detailHeadingCanvas: routeGraphElements.expanded.heading.canvas,
    },
    getSpeedUnit,
    getDistanceUnit,
  });
  mapController = createReplayMapController({
    element: routeElements.replayMap,
    session: state.session,
  });
}

function destroyReplayRouteResources(route = activeReplayRoute) {
  if (!route || route.destroyed) return;
  route.destroyed = true;
  route.syncIndicator?.destroy?.();
  route.toolsMenu?.destroy?.();
  route.filterController?.destroy?.();
  route.chartsController?.destroy?.();
  route.mapController?.destroy?.();

  if (activeReplayRoute === route) {
    activeReplayRoute = null;
    elements = createInactiveReplayElements();
    graphElements = createInactiveReplayGraphElements();
    toolsMenu = createInactiveToolsMenu();
    replayFilterController = null;
    chartsController = createInactiveReplayChartsController();
    mapController = createInactiveReplayMapController();
  }
}

async function mountReplayController(routeContext = {}) {
  if (routeContext.signal?.aborted) return Promise.resolve();
  unmountReplayController();
  const ownsCleanup = !routeContext.cleanup;
  const cleanup = routeContext.cleanup || createCleanupStack();
  const route = {
    cleanup,
    destroyed: false,
    generation: replayRouteGeneration + 1,
    ownsCleanup,
    signal: routeContext.signal || null,
  };
  replayRouteGeneration = route.generation;
  activeReplayRoute = route;
  elements = getReplayElements(routeContext.root || document);
  graphElements = getReplayGraphElements(routeContext.root || document);
  toolsMenu = initToolsMenu({
    button: elements.replayToolsMenuBtn,
    list: elements.replayToolsMenuList,
  });
  route.toolsMenu = toolsMenu;
  await Promise.all([loadDualRangeInput(), loadChart()]);
  if (route.signal?.aborted) {
    destroyReplayRouteResources(route);
    return Promise.resolve();
  }
  createReplayRouteControllers(elements, graphElements);
  route.filterController = replayFilterController;
  route.chartsController = chartsController;
  route.mapController = mapController;
  route.syncIndicator = initCloudSyncStatusIndicator({
    mount: elements.toolbar,
    alignEnd: true,
    openLauncher: openCloudSyncLauncher,
  });
  cleanup.add(() => {
    destroyReplayRouteResources(route);
  });

  if (!isSpaRuntime && !standaloneBackendAuthInitialized) {
    standaloneBackendAuthInitialized = true;
    initBackendAuthControllers();
  }

  applyTranslations();
  applyReplayIcons(elements);
  bindEvents({ elements, graphElements, cleanup, signal: route.signal });
  state.viewMounted = true;
  if (!state.initialized) return startReplayInit();

  renderSessionStateView();
  renderSessionState();
  renderPlaybackFrame();
  queueRecordingDetailOverflowSync();
  mapController.resize();
  return Promise.resolve();
}

function unmountReplayController() {
  if (!state.viewMounted && !activeReplayRoute) return;

  const route = activeReplayRoute;
  stopPlayback();
  cancelReplayApproach({ markPlayed: true });
  closeExpandedGraph();
  if (recordingsDetailMeasureFrame !== null) {
    window.cancelAnimationFrame(recordingsDetailMeasureFrame);
    recordingsDetailMeasureFrame = null;
  }
  state.viewMounted = false;
  replayRouteGeneration += 1;
  replaySelectionRequestVersion += 1;
  document.body.classList.remove('replay-graph-sheet-open');
  destroyReplayRouteResources(route);
  if (route?.ownsCleanup) {
    route.cleanup?.run?.();
  }
}

function tick(now) {
  if (isSpaRuntime && !state.viewMounted) {
    cancelPlaybackFrame();
    return;
  }

  if (!state.playing) return;

  if (state.lastFrameAt === null) {
    state.lastFrameAt = now;
  } else {
    state.elapsedMs += (now - state.lastFrameAt) * state.playbackRate;
    state.lastFrameAt = now;
  }

  if (state.elapsedMs >= state.summary.durationMs) {
    state.elapsedMs = state.summary.durationMs;
    renderPlaybackFrame();
    stopPlayback();
    return;
  }

  renderPlaybackFrame();
  state.frameId = window.requestAnimationFrame(tick);
}

async function startPlayback() {
  if (isSpaRuntime && !state.viewMounted) return;
  if (!state.session || state.playing || state.playPending) return;
  if (state.summary.durationMs <= 0) return;

  if (state.elapsedMs >= state.summary.durationMs) {
    state.elapsedMs = 0;
    renderPlaybackFrame();
  }

  state.playPending = true;
  renderPlaybackButtons();

  if (introApproachPromise) {
    await introApproachPromise;
  } else if (!state.introPlayed) {
    await runReplayApproach();
  }

  if (!state.playPending) return;

  state.playPending = false;
  state.playing = true;
  state.lastFrameAt = null;
  renderPlaybackButtons();
  state.frameId = window.requestAnimationFrame(tick);
}

function togglePlayback() {
  if (state.playing || state.playPending) {
    stopPlayback();
    return;
  }

  void startPlayback();
}

function setPlaybackRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return;
  state.playbackRate = rate;
  renderRateButtons();
}

function setPlaybackFromExpandedAxisValue(axisValue) {
  if (!state.session || !Number.isFinite(axisValue)) return;

  if (state.dashboardAxis === 'distance') {
    const sample = getReplaySampleAtDistanceM(state.session, axisValue);
    state.elapsedMs = sample?.elapsedMs ?? 0;
  } else {
    state.elapsedMs = Math.max(0, axisValue * 1000);
  }

  renderPlaybackFrame();
}

function scrubExpandedGraph(metricKey, clientX) {
  const axisValue = chartsController.getDetailAxisValueFromClientX(metricKey, clientX);
  if (!Number.isFinite(axisValue)) return;
  stopPlayback();
  cancelReplayApproach({ markPlayed: true });
  setPlaybackFromExpandedAxisValue(axisValue);
}

function openExpandedGraph() {
  if (!state.session) return;
  state.expandedGraphOpen = true;
  renderExpandedGraphSheet();
}

function closeExpandedGraph() {
  state.expandedGraphOpen = false;
  state.expandedGraphPointerId = null;
  renderExpandedGraphSheet();
}

function setExpandedGraphRange(startRatio, endRatio) {
  const axisRange = getReplayAxisRange(1, startRatio, endRatio);
  if (
    state.expandedGraphFilterStartRatio === axisRange.startRatio &&
    state.expandedGraphFilterEndRatio === axisRange.endRatio
  ) {
    return;
  }

  state.expandedGraphFilterStartRatio = axisRange.startRatio;
  state.expandedGraphFilterEndRatio = axisRange.endRatio;
  renderExpandedGraphSheet();
}

function setDashboardAxis(axis) {
  const nextAxis = axis === 'distance' ? 'distance' : 'time';
  if (state.dashboardAxis === nextAxis) return;
  state.dashboardAxis = nextAxis;
  renderAxisButtons();
  renderGraphs();
  renderPlaybackFrame();
}

function resetPlayback({ refitMap = true } = {}) {
  stopPlayback();
  cancelReplayApproach({ markPlayed: true });
  state.elapsedMs = 0;
  renderPlaybackFrame();

  if (refitMap) {
    mapController.resetCamera();
  }
}

function renderSessionStateView() {
  if (state.initialSelectionPending) {
    elements.replayEmptyState.hidden = true;
    elements.replayShell.hidden = true;
    return;
  }

  const hasSession = Boolean(state.session);
  elements.replayEmptyState.hidden = hasSession;
  elements.replayShell.hidden = !hasSession;
}

function applyReplaySelectionState(selection) {
  state.records = selection.records;
  state.sessionSource = selection.source;
  state.session = selection.session;
  state.selectedRecordingId = selection.selectedRecordingId ?? selection.session?.id ?? null;
  state.elapsedMs = 0;
  state.introPlayed = false;
  state.expandedGraphOpen = false;
  state.expandedGraphPointerId = null;
  refreshDerivedState();

  renderSessionStateView();
  renderSessionState();
  renderRecordings();
  renderStaticSummary();
  renderHighlights();
  renderGraphs();
  renderPlaybackButtons();
  renderActionIcons();
  renderAxisButtons();
  renderPlaybackFrame();

  if (state.session) {
    mapController.init();
  }
  mapController.setSession(state.session, {
    resetCamera: hasHydratedInitialSelection,
  });
  hasHydratedInitialSelection = true;
}

async function refreshReplaySelectionTelemetry({
  requestId,
  restoreRecordingId,
  session,
} = {}) {
  const result = await ensureReplayTelemetry(restoreRecordingId, { session });
  if (!result?.restored) {
    return false;
  }
  if (!shouldApplyReplayRestore(requestId, restoreRecordingId)) return false;
  if (
    state.selectedRecordingId !== restoreRecordingId
    && pendingReplayRecoveryRecordingId !== restoreRecordingId
  ) {
    return false;
  }

  await requestReplaySelection(restoreRecordingId, { settleMicrotasks: 0 });
  return state.selectedRecordingId === restoreRecordingId;
}

async function applyReplaySelection(recordingId, { requestId = replaySelectionRequestVersion } = {}) {
  cancelReplayApproach();
  const requestedRecordingId = recordingId === undefined ? state.selectedRecordingId : recordingId;
  const normalizedRequestedRecordingId =
    typeof requestedRecordingId === 'string' && requestedRecordingId.trim()
      ? requestedRecordingId.trim()
      : null;
  const selection = await getReplaySelection(requestedRecordingId);
  if (!isLatestReplaySelectionRequest(requestId)) return false;

  const requestedRecordExists = normalizedRequestedRecordingId
    ? selection.records.some((record) => record.id === normalizedRequestedRecordingId)
    : false;

  if (normalizedRequestedRecordingId && !requestedRecordExists) {
    pendingReplayRecoveryRecordingId = normalizedRequestedRecordingId;
    applyReplaySelectionState({
      records: selection.records,
      source: selection.source,
      session: selection.session,
      selectedRecordingId: selection.session?.id ?? null,
    });
    void refreshReplaySelectionTelemetry({
      requestId,
      restoreRecordingId: normalizedRequestedRecordingId,
      session: null,
    });
    return true;
  }

  pendingReplayRecoveryRecordingId = null;
  const restoreRecordingId = normalizedRequestedRecordingId ?? selection.session?.id ?? null;
  applyReplaySelectionState(selection);

  if (
    restoreRecordingId
    && !(selection.session && isReplayPayloadComplete(selection.session))
  ) {
    void refreshReplaySelectionTelemetry({
      requestId,
      restoreRecordingId,
      session: selection.session,
    });
  }

  return true;
}

async function recoverReplaySelection(recordingId, attempts = 4) {
  const normalizedRecordingId =
    typeof recordingId === 'string' && recordingId.trim() ? recordingId.trim() : null;
  if (!normalizedRecordingId) {
    await requestReplaySelection(recordingId, { settleMicrotasks: 0 });
    return state.selectedRecordingId === null;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await requestReplaySelection(normalizedRecordingId, { settleMicrotasks: 0 });
    if (state.selectedRecordingId === normalizedRecordingId) {
      return true;
    }
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  return state.selectedRecordingId === normalizedRecordingId;
}

function requestReplaySelection(recordingId, { settleMicrotasks = 100 } = {}) {
  const requestId = replaySelectionRequestVersion + 1;
  replaySelectionRequestVersion = requestId;
  replaySelectionPromise = applyReplaySelection(recordingId, { requestId }).then(async (result) => {
    for (let index = 0; index < settleMicrotasks; index += 1) {
      await Promise.resolve();
    }
    return result;
  });
  return replaySelectionPromise;
}

export function waitForReplaySelection() {
  return Promise.all([replaySelectionPromise, replaySelectionKickoffPromise]).then(() => undefined);
}

function syncLanguage() {
  applyTranslations();
  updatePageMeta();
  elements.langToggleButtons.forEach((button) => {
    button.textContent = getLang().toUpperCase();
  });
  renderSessionState();
  renderPlaybackButtons();
  renderActionIcons();
  renderAxisButtons();
  renderRateButtons();
  renderRecordings();
  renderStaticSummary();
  renderHighlights();
  renderGraphs();
  renderPlaybackFrame();
}

function bindEvents({ elements: routeElements = elements, graphElements: routeGraphElements = graphElements, cleanup, signal } = {}) {
  if (!cleanup) return;
  if (signal?.aborted) return;

  routeElements.langToggleButtons.forEach((button) => {
    cleanup.addEventListener(button, 'click', () => {
      toggleLang();
    });
  });

  bindMenuNavigation(routeElements.openReplaySpeedMenu, '#/speed', cleanup);
  bindMenuNavigation(routeElements.openReplayAccelMenu, '#/accel', cleanup);
  bindMenuNavigation(routeElements.openReplayLibraryMenu, '#/library?tab=speed', cleanup);
  bindMenuNavigation(routeElements.openReplayBoardMenu, '#/board', cleanup);
  if (!isSpaRuntime) {
    integratePlayerWidget({ toolsMenuList: routeElements.replayToolsMenuList, toolsMenu });
  }

  cleanup.addEventListener(routeElements.replayOpenSpeed, 'click', () => {
    navigateToAppRoute('#/speed');
  });

  cleanup.addEventListener(window, ROUTE_VISIBLE_EVENT, (event) => {
    if (event?.detail?.path !== '/replay') return;
    const routeParams = getCurrentAppRouteQuery();
    const recordingId = routeParams.get('record');
    const cloudRecordName = routeParams.get('cloudRecord');
    if (recordingId && cloudRecordName) {
      registerLinkedReplayCloudRecord(recordingId, cloudRecordName);
    }
    if (recordingId && recordingId !== state.selectedRecordingId) {
      void requestReplaySelection(recordingId, { settleMicrotasks: 0 });
    }
  });

  for (const trigger of routeElements.replayGraphTriggers) {
    cleanup.addEventListener(trigger, 'click', () => {
      openExpandedGraph();
    });
  }

  cleanup.addEventListener(routeElements.replayPlayPause, 'click', togglePlayback);

  cleanup.addEventListener(routeElements.replayRestart, 'click', () => {
    resetPlayback();
  });

  cleanup.addEventListener(routeElements.replayApproach, 'click', async () => {
    stopPlayback();
    await runReplayApproach({ force: true });
  });

  cleanup.addEventListener(routeElements.closeReplayGraphSheet, 'click', closeExpandedGraph);
  cleanup.addEventListener(routeElements.replayGraphSheetBackdrop, 'click', closeExpandedGraph);

  cleanup.addEventListener(routeElements.replayProgress, 'input', (event) => {
    if (!state.session) return;
    stopPlayback();
    cancelReplayApproach({ markPlayed: true });
    const axisValue = Number(event.target.value);
    if (state.dashboardAxis === 'distance') {
      const sample = getReplaySampleAtDistanceM(state.session, axisValue);
      state.elapsedMs = sample?.elapsedMs ?? 0;
    } else {
      state.elapsedMs = axisValue;
    }
    renderPlaybackFrame();
  });

  cleanup.addEventListener(routeElements.replayFilterStart, 'input', (event) => {
    const startRatio = Number(event.target.value) / 1000;
    const endRatio = Number(routeElements.replayFilterEnd?.value ?? 1000) / 1000;
    setExpandedGraphRange(startRatio, endRatio);
  });

  cleanup.addEventListener(routeElements.replayFilterEnd, 'input', (event) => {
    const startRatio = Number(routeElements.replayFilterStart?.value ?? 0) / 1000;
    const endRatio = Number(event.target.value) / 1000;
    setExpandedGraphRange(startRatio, endRatio);
  });

  cleanup.addEventListener(routeElements.replayRecordingsList, 'click', async (event) => {
    const deleteButton = event.target.closest('button[data-delete-recording-id]');
    if (deleteButton) {
      const { deleteRecordingId } = deleteButton.dataset;
      if (!deleteRecordingId) return;
      if (!window.confirm(t('replayDeleteRecordingConfirm'))) return;

      stopPlayback();
      replaySelectionPromise = (async () => {
        await removeReplayRecord(deleteRecordingId);
        await queueCloudSyncDeletion({
          entityType: CLOUD_SYNC_ENTITY_TYPES.replaySession,
          recordId: deleteRecordingId,
        });
        return applyReplaySelection(
          deleteRecordingId === state.selectedRecordingId ? null : state.selectedRecordingId
        );
      })();
      await replaySelectionPromise;
      return;
    }

    const button = event.target.closest('button[data-recording-id]');
    if (!button) return;
    stopPlayback();
    const nextRecord = state.records.find((record) => record.id === button.dataset.recordingId) ?? null;
    if (nextRecord?.session && !isReplayPayloadComplete(nextRecord.session)) {
      replaySelectionKickoffPromise = new Promise((resolve) => {
        let settled = false;
        const resolveOnce = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        void ensureReplayTelemetry(button.dataset.recordingId, {
          session: nextRecord.session,
          onPayloadDownloadStart: resolveOnce,
        }).finally(resolveOnce);
      });
    } else {
      replaySelectionKickoffPromise = Promise.resolve();
    }
    await requestReplaySelection(button.dataset.recordingId);
  });

  for (const button of routeElements.replayRateButtons) {
    cleanup.addEventListener(button, 'click', () => {
      setPlaybackRate(Number(button.dataset.rate));
    });
  }

  for (const button of routeElements.replayAxisButtons) {
    cleanup.addEventListener(button, 'click', () => {
      setDashboardAxis(button.dataset.axis);
    });
  }

  for (const canvas of [
    routeGraphElements.expanded.speed.canvas,
    routeGraphElements.expanded.altitude.canvas,
    routeGraphElements.expanded.heading.canvas,
  ]) {
    cleanup.addEventListener(canvas, 'pointerdown', (event) => {
      if (!state.expandedGraphOpen) return;
      state.expandedGraphPointerId = event.pointerId;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      scrubExpandedGraph(event.currentTarget.dataset.graphSheetScrub, event.clientX);
    });

    cleanup.addEventListener(canvas, 'pointermove', (event) => {
      if (state.expandedGraphPointerId !== event.pointerId) return;
      event.preventDefault();
      scrubExpandedGraph(event.currentTarget.dataset.graphSheetScrub, event.clientX);
    });

    cleanup.addEventListener(canvas, 'pointerup', (event) => {
      if (state.expandedGraphPointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      state.expandedGraphPointerId = null;
    });

    cleanup.addEventListener(canvas, 'pointercancel', (event) => {
      if (state.expandedGraphPointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      state.expandedGraphPointerId = null;
    });
  }

  cleanup.addEventListener(document, 'visibilitychange', () => {
    if (document.hidden) {
      stopPlayback();
    }
  });

  cleanup.addEventListener(document, 'keydown', (event) => {
    if (event.target.closest('.player-panel, .player-fab')) return;
    if (event.key === 'Escape' && state.expandedGraphOpen) {
      closeExpandedGraph();
    }
  });

  cleanup.addEventListener(document, 'i18n:change', syncLanguage);
  cleanup.addEventListener(window, 'pagehide', stopPlayback);
  cleanup.addEventListener(window, 'resize', queueRecordingDetailOverflowSync);
  cleanup.addEventListener(window, SINGLE_TAB_OWNERSHIP_EVENT, (event) => {
    if (event?.detail?.owned !== false) return;
    stopPlayback();
  });
  cleanup.addEventListener(window, CLOUD_SYNC_APPLIED_EVENT, (event) => {
    if (event?.detail?.entityType !== CLOUD_SYNC_ENTITY_TYPES.replaySession) return;
    if (state.initialSelectionPending) return;
    if (
      event?.detail?.deleted !== true
      && pendingReplayRecoveryRecordingId
    ) {
      if (isReplayPayloadComplete(event?.detail?.payload)) {
        const payload = event.detail.payload;
        const nextRecords = state.records.some((record) => record.id === payload.id)
          ? state.records.map((record) =>
            record.id === payload.id
              ? {
                ...record,
                source: 'library',
                session: payload,
              }
              : record
          )
          : [{
            id: payload.id,
            source: 'library',
            session: payload,
          }, ...state.records];

        pendingReplayRecoveryRecordingId = null;
        queueNavigationPayloadHandoff({
          resourceType: NAVIGATION_PAYLOAD_RESOURCES.replaySession,
          recordId: payload.id,
          payload,
        });
        applyReplaySelectionState({
          records: nextRecords,
          source: 'library',
          session: payload,
          selectedRecordingId: payload.id,
        });
        return;
      }
      clearReplayRestoreFailure(event.detail.recordId);
      void recoverReplaySelection(event.detail.recordId);
      return;
    }
    if (event?.detail?.deleted === true && event?.detail?.recordId === state.selectedRecordingId) {
      clearReplayRestoreFailure(event.detail.recordId);
      void requestReplaySelection(null);
      return;
    }
    if (event?.detail?.recordId && event.detail.recordId === state.selectedRecordingId) {
      clearReplayRestoreFailure(event.detail.recordId);
      void requestReplaySelection(event.detail.recordId);
      return;
    }
    if (state.session && state.selectedRecordingId) {
      void refreshReplayRecordsList();
      return;
    }
    if (event?.detail?.deleted !== true) {
      void requestReplaySelection(event?.detail?.recordId ?? null);
    }
  });
}

const REPLAY_OWNERSHIP_TIMEOUT_MS = 3000;

async function raceOwnershipWithTimeout() {
  let timeoutId;
  try {
    const result = await Promise.race([
      singleTabOwnershipPromise.then(
        (owned) => ({ owned: owned === true, degraded: false }),
        () => ({ owned: false, degraded: true }),
      ),
      new Promise((resolve) => {
        timeoutId = setTimeout(
          () => resolve({ owned: false, degraded: true }),
          REPLAY_OWNERSHIP_TIMEOUT_MS,
        );
      }),
    ]);
    clearTimeout(timeoutId);
    return result;
  } catch {
    clearTimeout(timeoutId);
    return { owned: false, degraded: true };
  }
}

async function init() {
  const ownership = await raceOwnershipWithTimeout();

  if (!ownership.owned && !ownership.degraded) {
    return;
  }

  try {
    const urlParams = getCurrentAppRouteQuery();
    const initialRecordingId = urlParams.get('record');
    const initialCloudRecordName = urlParams.get('cloudRecord');
    if (initialRecordingId && initialCloudRecordName) {
      registerLinkedReplayCloudRecord(initialRecordingId, initialCloudRecordName);
    }

    updatePageMeta();
    renderSessionStateView();

    elements.langToggleButtons.forEach((button) => {
      button.textContent = getLang().toUpperCase();
    });

    renderSessionState();
    renderAxisButtons();
    renderRateButtons();
    renderPlaybackButtons();
    renderActionIcons();
    renderRecordings();
    updateGraphPlayback(null);

    const selectionSafetyTimeoutId = setTimeout(() => {
      if (state.initialSelectionPending) {
        state.initialSelectionPending = false;
        renderSessionStateView();
      }
    }, 4000);

    try {
      await requestReplaySelection(initialRecordingId, { settleMicrotasks: 0 });
    } finally {
      clearTimeout(selectionSafetyTimeoutId);
      state.initialSelectionPending = false;
      renderSessionStateView();
      if (state.session) {
        mapController.resize();
      }
    }
    if (!isSpaRuntime) {
      startCloudSyncLoop({ immediate: true });
    } else {
      maybeFallbackMissingReplaySelection();
    }
    state.initialized = true;
    if (state.viewMounted) {
      void runReplayApproach();
    }
  } finally {
    if (state.initialSelectionPending) {
      state.initialSelectionPending = false;
      renderSessionStateView();
    }
  }
}

let replayInitPromise = Promise.resolve();

function startReplayInit() {
  if (!isSpaRuntime) {
    singleTabOwnershipPromise = ensureSingleTabOwnership();
  } else {
    singleTabOwnershipPromise = Promise.resolve(true);
  }
  replayInitPromise = init();
  return replayInitPromise;
}

replayRouteLifecycle = {
  mount: mountReplayController,
  unmount: unmountReplayController,
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    releaseSingleTabOwnership();
    stopPlayback();
    if (recordingsDetailMeasureFrame !== null) {
      window.cancelAnimationFrame(recordingsDetailMeasureFrame);
    }
    chartsController.destroy();
    mapController.destroy();
    replayFilterController?.destroy();
  });
}

function ensureStandaloneReplayMounted() {
  if (!isSpaRuntime && !activeReplayRoute) {
    standaloneCleanup?.run();
    const mountPromise = mountReplayRoute({
      root: document,
      signal: null,
    });
    standaloneCleanup = activeReplayRoute?.cleanup || null;
    return Promise.resolve(mountPromise).then(() => replayInitPromise);
  }
  return replayInitPromise;
}

export const initPromise = {
  then(onFulfilled, onRejected) {
    return ensureStandaloneReplayMounted().then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return ensureStandaloneReplayMounted().catch(onRejected);
  },
  finally(onFinally) {
    return ensureStandaloneReplayMounted().finally(onFinally);
  },
};
