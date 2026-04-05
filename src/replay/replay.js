import 'maplibre-gl/dist/maplibre-gl.css';
import '@stanko/dual-range-input/dist/index.css';
import '../styles/replay.less';
import '../styles/cloud-sync-status.less';
import '../styles/backend-auth.less';
import DualRangeInput from '@stanko/dual-range-input';
import { applyTranslations, getLang, t, toggleLang } from '../i18n.js';
import {
  IconAccel,
  IconBoard,
  IconDistance,
  IconGpsLab,
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
import {
  CLOUD_SYNC_APPLIED_EVENT,
  CLOUD_SYNC_ENTITY_TYPES,
  queueCloudSyncDeletion,
  startCloudSyncLoop,
  syncCloudRecords,
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
import { applyButtonIcon, initToolsMenu } from '../shared/tools-menu.js';
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

applyTranslations();
const singleTabOwnershipPromise = ensureSingleTabOwnership();
initBackendAuthControllers();

const elements = {
  langToggle: document.getElementById('langToggle'),
  langToggleButtons: Array.from(document.querySelectorAll('[data-lang-toggle], #langToggle')),
  pageDescriptionMeta: document.querySelector('meta[name="description"]'),
  toolbar: document.querySelector('.replay-toolbar'),
  replaySessionChip: document.getElementById('replaySessionChip'),
  replayAxisButtons: Array.from(document.querySelectorAll('.replay-axis-btn')),
  replayGraphTriggers: Array.from(document.querySelectorAll('.replay-graph-trigger')),
  replayToolsMenuBtn: document.getElementById('replayToolsMenuBtn'),
  replayToolsMenuList: document.getElementById('replayToolsMenuList'),
  openReplaySpeedMenu: document.getElementById('openReplaySpeedMenu'),
  openReplayGpsLabMenu: document.getElementById('openReplayGpsLabMenu'),
  openReplayAccelMenu: document.getElementById('openReplayAccelMenu'),
  openReplayLibraryMenu: document.getElementById('openReplayLibraryMenu'),
  openReplayBoardMenu: document.getElementById('openReplayBoardMenu'),
  replayRecordedAtValue: document.getElementById('replayRecordedAtValue'),
  replaySampleCountValue: document.getElementById('replaySampleCountValue'),
  replayEmptyState: document.getElementById('replayEmptyState'),
  replayOpenSpeed: document.getElementById('replayOpenSpeed'),
  replayShell: document.getElementById('replayShell'),
  replayMap: document.getElementById('replayMap'),
  replayPlayPause: document.getElementById('replayPlayPause'),
  replayPlayPauseIcon: document.getElementById('replayPlayPauseIcon'),
  replayPlayPauseText: document.getElementById('replayPlayPauseText'),
  replayRestart: document.getElementById('replayRestart'),
  replayRestartIcon: document.getElementById('replayRestartIcon'),
  replayApproach: document.getElementById('replayApproach'),
  replayApproachIcon: document.getElementById('replayApproachIcon'),
  replayProgress: document.getElementById('replayProgress'),
  replayElapsedValue: document.getElementById('replayElapsedValue'),
  replayDurationValue: document.getElementById('replayDurationValue'),
  replayPeakSpeedValue: document.getElementById('replayPeakSpeedValue'),
  replayAverageSpeedValue: document.getElementById('replayAverageSpeedValue'),
  replaySummaryDistanceValue: document.getElementById('replaySummaryDistanceValue'),
  replaySummaryDurationValue: document.getElementById('replaySummaryDurationValue'),
  replayAltitudeRangeValue: document.getElementById('replayAltitudeRangeValue'),
  replayRouteValue: document.getElementById('replayRouteValue'),
  replayHighlightsList: document.getElementById('replayHighlightsList'),
  replayRecordingsList: document.getElementById('replayRecordingsList'),
  replayRateButtons: Array.from(document.querySelectorAll('.replay-rate-btn')),
  replayGraphSheet: document.getElementById('replayGraphSheet'),
  replayGraphSheetBackdrop: document.getElementById('replayGraphSheetBackdrop'),
  closeReplayGraphSheet: document.getElementById('closeReplayGraphSheet'),
  replayGraphSheetTitle: document.getElementById('replayGraphSheetTitle'),
  replayFilterSlider: document.getElementById('replayFilterSlider'),
  replayFilterStart: document.getElementById('replayFilterStart'),
  replayFilterEnd: document.getElementById('replayFilterEnd'),
  replayFilterStartValue: document.getElementById('replayFilterStartValue'),
  replayFilterEndValue: document.getElementById('replayFilterEndValue'),
};

const graphElements = {
  speed: {
    current: document.getElementById('replayGraphSpeedCurrent'),
    canvas: document.getElementById('replayGraphSpeedCanvas'),
  },
  altitude: {
    current: document.getElementById('replayGraphAltitudeCurrent'),
    canvas: document.getElementById('replayGraphAltitudeCanvas'),
  },
  heading: {
    current: document.getElementById('replayGraphHeadingCurrent'),
    canvas: document.getElementById('replayGraphHeadingCanvas'),
  },
  expanded: {
    speed: {
      current: document.getElementById('replayExpandedSpeedCurrent'),
      canvas: document.getElementById('replayExpandedSpeedCanvas'),
    },
    altitude: {
      current: document.getElementById('replayExpandedAltitudeCurrent'),
      canvas: document.getElementById('replayExpandedAltitudeCanvas'),
    },
    heading: {
      current: document.getElementById('replayExpandedHeadingCurrent'),
      canvas: document.getElementById('replayExpandedHeadingCanvas'),
    },
  },
};

const toolsMenu = initToolsMenu({
  button: elements.replayToolsMenuBtn,
  list: elements.replayToolsMenuList,
});

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
  const candidates = [
    elements.replayToolsMenuList?.querySelector('[data-backend-auth-user]'),
    elements.replayToolsMenuList?.querySelector('[data-backend-auth-password]'),
    elements.replayToolsMenuList?.querySelector('[data-backend-auth-login]'),
    elements.replayToolsMenuList?.querySelector('[data-backend-auth-logout]'),
    elements.replayToolsMenuList?.querySelector('[data-backend-auth-status]'),
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

initCloudSyncStatusIndicator({
  mount: elements.toolbar,
  alignEnd: true,
  openLauncher: openCloudSyncLauncher,
});

applyButtonIcon(elements.openReplaySpeedMenu, IconSpeed);
applyButtonIcon(elements.openReplayGpsLabMenu, IconGpsLab);
applyButtonIcon(elements.openReplayAccelMenu, IconAccel);
applyButtonIcon(elements.openReplayLibraryMenu, IconWorld);
applyButtonIcon(elements.openReplayBoardMenu, IconBoard);
applyButtonIcon(elements.replayToolsMenuBtn, IconPages);
for (const button of document.querySelectorAll('.replay-axis-btn[data-axis="time"]')) {
  applyButtonIcon(button, IconTime);
}
for (const button of document.querySelectorAll('.replay-axis-btn[data-axis="distance"]')) {
  applyButtonIcon(button, IconDistance);
}

const replayFilterController =
  elements.replayFilterStart && elements.replayFilterEnd
    ? new DualRangeInput(elements.replayFilterStart, elements.replayFilterEnd)
    : null;

const state = {
  records: [],
  selectedRecordingId: null,
  sessionSource: null,
  session: null,
  initialSelectionPending: true,
  summary: getReplaySummary(null),
  highlights: getReplayHighlights(null),
  playbackRate: 4,
  dashboardAxis: 'time',
  elapsedMs: 0,
  playing: false,
  playPending: false,
  frameId: null,
  lastFrameAt: null,
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

const chartsController = createReplayChartsController({
  elements: {
    speedCanvas: graphElements.speed.canvas,
    altitudeCanvas: graphElements.altitude.canvas,
    headingCanvas: graphElements.heading.canvas,
    detailSpeedCanvas: graphElements.expanded.speed.canvas,
    detailAltitudeCanvas: graphElements.expanded.altitude.canvas,
    detailHeadingCanvas: graphElements.expanded.heading.canvas,
  },
  getSpeedUnit,
  getDistanceUnit,
});

const mapController = createReplayMapController({
  element: elements.replayMap,
  session: state.session,
});

function cancelReplayApproach({ markPlayed = false } = {}) {
  introApproachToken += 1;
  introApproachPromise = null;
  mapController.cancelApproachAnimation();
  if (markPlayed) {
    state.introPlayed = true;
  }
}

function runReplayApproach({ force = false } = {}) {
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

function bindMenuNavigation(element, href) {
  if (!element) return;

  element.addEventListener('click', () => {
    toolsMenu.close();
    window.location.href = href;
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

function tick(now) {
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

function bindEvents() {
  elements.langToggleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toggleLang();
    });
  });

  bindMenuNavigation(elements.openReplaySpeedMenu, '/speed');
  bindMenuNavigation(elements.openReplayGpsLabMenu, '/gps-rate');
  bindMenuNavigation(elements.openReplayAccelMenu, '/accel');
  bindMenuNavigation(elements.openReplayLibraryMenu, '/library.html?tab=speed');
  bindMenuNavigation(elements.openReplayBoardMenu, '/');

  elements.replayOpenSpeed?.addEventListener('click', () => {
    window.location.href = '/speed';
  });

  for (const trigger of elements.replayGraphTriggers) {
    trigger.addEventListener('click', () => {
      openExpandedGraph();
    });
  }

  elements.replayPlayPause?.addEventListener('click', togglePlayback);

  elements.replayRestart?.addEventListener('click', () => {
    resetPlayback();
  });

  elements.replayApproach?.addEventListener('click', async () => {
    stopPlayback();
    await runReplayApproach({ force: true });
  });

  elements.closeReplayGraphSheet?.addEventListener('click', closeExpandedGraph);
  elements.replayGraphSheetBackdrop?.addEventListener('click', closeExpandedGraph);

  elements.replayProgress?.addEventListener('input', (event) => {
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

  elements.replayFilterStart?.addEventListener('input', (event) => {
    const startRatio = Number(event.target.value) / 1000;
    const endRatio = Number(elements.replayFilterEnd?.value ?? 1000) / 1000;
    setExpandedGraphRange(startRatio, endRatio);
  });

  elements.replayFilterEnd?.addEventListener('input', (event) => {
    const startRatio = Number(elements.replayFilterStart?.value ?? 0) / 1000;
    const endRatio = Number(event.target.value) / 1000;
    setExpandedGraphRange(startRatio, endRatio);
  });

  elements.replayRecordingsList?.addEventListener('click', async (event) => {
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

  for (const button of elements.replayRateButtons) {
    button.addEventListener('click', () => {
      setPlaybackRate(Number(button.dataset.rate));
    });
  }

  for (const button of elements.replayAxisButtons) {
    button.addEventListener('click', () => {
      setDashboardAxis(button.dataset.axis);
    });
  }

  for (const canvas of [
    graphElements.expanded.speed.canvas,
    graphElements.expanded.altitude.canvas,
    graphElements.expanded.heading.canvas,
  ]) {
    canvas?.addEventListener('pointerdown', (event) => {
      if (!state.expandedGraphOpen) return;
      state.expandedGraphPointerId = event.pointerId;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      scrubExpandedGraph(event.currentTarget.dataset.graphSheetScrub, event.clientX);
    });

    canvas?.addEventListener('pointermove', (event) => {
      if (state.expandedGraphPointerId !== event.pointerId) return;
      event.preventDefault();
      scrubExpandedGraph(event.currentTarget.dataset.graphSheetScrub, event.clientX);
    });

    canvas?.addEventListener('pointerup', (event) => {
      if (state.expandedGraphPointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      state.expandedGraphPointerId = null;
    });

    canvas?.addEventListener('pointercancel', (event) => {
      if (state.expandedGraphPointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      state.expandedGraphPointerId = null;
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPlayback();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.expandedGraphOpen) {
      closeExpandedGraph();
    }
  });

  document.addEventListener('i18n:change', syncLanguage);
  window.addEventListener('pagehide', stopPlayback);
  window.addEventListener('resize', queueRecordingDetailOverflowSync);
  window.addEventListener(SINGLE_TAB_OWNERSHIP_EVENT, (event) => {
    if (event?.detail?.owned !== false) return;
    stopPlayback();
  });
  window.addEventListener(CLOUD_SYNC_APPLIED_EVENT, (event) => {
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

async function init() {
  if (!(await singleTabOwnershipPromise)) {
    return;
  }
  const urlParams = new URLSearchParams(window.location.search);
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
  try {
    await requestReplaySelection(initialRecordingId, { settleMicrotasks: 0 });
  } finally {
    state.initialSelectionPending = false;
    renderSessionStateView();
    if (state.session) {
      mapController.resize();
    }
  }
  startCloudSyncLoop({ immediate: false });
  const syncSelectionRequestVersion = replaySelectionRequestVersion;
  void syncCloudRecords()
    .catch(() => {
      // Keep the page usable with local data if sync is temporarily unavailable.
    })
    .finally(() => {
      if (replaySelectionRequestVersion !== syncSelectionRequestVersion) return;
      maybeFallbackMissingReplaySelection();
    });
  void runReplayApproach();
}

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

bindEvents();
export const initPromise = init();
