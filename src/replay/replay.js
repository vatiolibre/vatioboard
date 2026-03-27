import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/replay.less";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import {
  IconAccel,
  IconBoard,
  IconGpsLab,
  IconPause,
  IconPlay,
  IconRestart,
  IconSpeed,
  IconWorld,
} from "../icons.js";
import { initSupportPanel } from "../shared/support-panel.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import {
  formatReplayDistanceValue,
  formatReplaySpeedValue,
  getReplayHighlights,
  getReplayPlayedCoordinates,
  getReplaySampleAtElapsedMs,
  getReplaySummary,
} from "./logic.js";
import { createReplayChartsController } from "./charts.js";
import { createReplayMapController } from "./map.js";
import { loadReplaySelection, removeReplayRecording } from "./session.js";

applyTranslations();

const elements = {
  langToggle: document.getElementById("langToggle"),
  pageDescriptionMeta: document.querySelector('meta[name="description"]'),
  replaySessionChip: document.getElementById("replaySessionChip"),
  replayToolsMenuBtn: document.getElementById("replayToolsMenuBtn"),
  replayToolsMenuList: document.getElementById("replayToolsMenuList"),
  openReplaySpeedMenu: document.getElementById("openReplaySpeedMenu"),
  openReplayGpsLabMenu: document.getElementById("openReplayGpsLabMenu"),
  openReplayAccelMenu: document.getElementById("openReplayAccelMenu"),
  openReplayBoardMenu: document.getElementById("openReplayBoardMenu"),
  replayRecordedAtValue: document.getElementById("replayRecordedAtValue"),
  replaySampleCountValue: document.getElementById("replaySampleCountValue"),
  replayEmptyState: document.getElementById("replayEmptyState"),
  replayOpenSpeed: document.getElementById("replayOpenSpeed"),
  replayShell: document.getElementById("replayShell"),
  replayMap: document.getElementById("replayMap"),
  replayPlayPause: document.getElementById("replayPlayPause"),
  replayPlayPauseIcon: document.getElementById("replayPlayPauseIcon"),
  replayPlayPauseText: document.getElementById("replayPlayPauseText"),
  replayRestart: document.getElementById("replayRestart"),
  replayRestartIcon: document.getElementById("replayRestartIcon"),
  replayApproach: document.getElementById("replayApproach"),
  replayApproachIcon: document.getElementById("replayApproachIcon"),
  replayProgress: document.getElementById("replayProgress"),
  replayElapsedValue: document.getElementById("replayElapsedValue"),
  replayDurationValue: document.getElementById("replayDurationValue"),
  replayPeakSpeedValue: document.getElementById("replayPeakSpeedValue"),
  replayAverageSpeedValue: document.getElementById("replayAverageSpeedValue"),
  replaySummaryDistanceValue: document.getElementById("replaySummaryDistanceValue"),
  replaySummaryDurationValue: document.getElementById("replaySummaryDurationValue"),
  replayAltitudeRangeValue: document.getElementById("replayAltitudeRangeValue"),
  replayHighlightsList: document.getElementById("replayHighlightsList"),
  replayRecordingsList: document.getElementById("replayRecordingsList"),
  replayRateButtons: Array.from(document.querySelectorAll(".replay-rate-btn")),
};

const graphElements = {
  speed: {
    current: document.getElementById("replayGraphSpeedCurrent"),
    canvas: document.getElementById("replayGraphSpeedCanvas"),
  },
  altitude: {
    current: document.getElementById("replayGraphAltitudeCurrent"),
    canvas: document.getElementById("replayGraphAltitudeCanvas"),
  },
  heading: {
    current: document.getElementById("replayGraphHeadingCurrent"),
    canvas: document.getElementById("replayGraphHeadingCanvas"),
  },
};

const toolsMenu = initToolsMenu({
  button: elements.replayToolsMenuBtn,
  list: elements.replayToolsMenuList,
});
initSupportPanel();

applyButtonIcon(elements.openReplaySpeedMenu, IconSpeed);
applyButtonIcon(elements.openReplayGpsLabMenu, IconGpsLab);
applyButtonIcon(elements.openReplayAccelMenu, IconAccel);
applyButtonIcon(elements.openReplayBoardMenu, IconBoard);

const initialSelection = loadReplaySelection();

const state = {
  records: initialSelection.records,
  selectedRecordingId: initialSelection.session?.id ?? null,
  sessionSource: initialSelection.source,
  session: initialSelection.session,
  summary: getReplaySummary(initialSelection.session),
  highlights: getReplayHighlights(initialSelection.session),
  playbackRate: 4,
  elapsedMs: 0,
  playing: false,
  playPending: false,
  frameId: null,
  lastFrameAt: null,
  introPlayed: false,
};

refreshDerivedState();

const chartsController = createReplayChartsController({
  elements: {
    speedCanvas: graphElements.speed.canvas,
    altitudeCanvas: graphElements.altitude.canvas,
    headingCanvas: graphElements.heading.canvas,
  },
  getSpeedUnit,
  getDistanceUnit,
});

const mapController = createReplayMapController({
  element: elements.replayMap,
  session: state.session,
});

function bindMenuNavigation(element, href) {
  if (!element) return;

  element.addEventListener("click", () => {
    toolsMenu.close();
    window.location.href = href;
  });
}

function refreshDerivedState() {
  state.summary = getReplaySummary(state.session);
  state.highlights = getReplayHighlights(state.session);
}

function getSpeedUnit() {
  return state.session?.unit === "mph" ? "mph" : "kmh";
}

function getDistanceUnit() {
  return state.session?.distanceUnit === "ft" ? "ft" : "m";
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
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(timestampMs) {
  if (!Number.isFinite(timestampMs)) return "—";

  return new Intl.DateTimeFormat(getLang(), {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestampMs));
}

function formatSpeed(speedMs) {
  if (!Number.isFinite(speedMs)) return "—";

  const unit = getSpeedUnit();
  const label = unit === "mph" ? "mph" : "km/h";
  const speedValue = formatReplaySpeedValue(speedMs, unit);
  return `${formatNumber(speedValue, 0)} ${label}`;
}

function formatDistance(distanceM) {
  if (!Number.isFinite(distanceM)) return "—";

  const unit = getDistanceUnit();
  const distanceValue = formatReplayDistanceValue(distanceM, unit);
  const decimals = unit === "m" && distanceValue < 1000 ? 0 : 1;
  const label = unit === "ft" ? "ft" : "m";

  if (unit === "ft" && distanceValue >= 5280) {
    return `${formatNumber(distanceM / 1609.344, distanceM < 16093.44 ? 1 : 0)} mi`;
  }

  if (unit === "m" && distanceValue >= 1000) {
    return `${formatNumber(distanceM / 1000, distanceM < 10000 ? 1 : 0)} km`;
  }

  return `${formatNumber(distanceValue, decimals)} ${label}`;
}

function formatAltitude(altitudeM) {
  if (!Number.isFinite(altitudeM)) return "—";

  const unit = getDistanceUnit();
  const label = unit === "ft" ? "ft" : "m";
  const altitudeValue = formatReplayDistanceValue(altitudeM, unit);
  return `${formatNumber(altitudeValue, 0)} ${label}`;
}

function formatHeading(headingDeg) {
  if (!Number.isFinite(headingDeg)) return "—";

  const normalizedHeading = ((headingDeg % 360) + 360) % 360;
  const sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
  const sector = sectors[Math.round(normalizedHeading / 45)];
  return `${formatNumber(normalizedHeading, 0)}° ${sector}`;
}

function formatAcceleration(value) {
  if (!Number.isFinite(value)) return "—";
  return `${formatNumber(value, 1)} m/s²`;
}

function setElementText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function updatePageMeta() {
  document.documentElement.lang = getLang();
  document.title = t("replayPageTitle");
  if (elements.pageDescriptionMeta) {
    elements.pageDescriptionMeta.setAttribute("content", t("replayPageDescription"));
  }
}

function renderSessionState() {
  if (!elements.replaySessionChip) return;
  if (!state.session) {
    elements.replaySessionChip.textContent = t("driveReplay");
    return;
  }
  elements.replaySessionChip.textContent = state.sessionSource === "active"
    ? t("replaySessionActive")
    : t("replaySessionSaved");
}

function renderRateButtons() {
  for (const button of elements.replayRateButtons) {
    const isActive = Number(button.dataset.rate) === state.playbackRate;
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function renderPlaybackButtons() {
  if (!elements.replayPlayPause) return;
  const label = state.playing || state.playPending
    ? t("replayPause")
    : t("replayPlay");
  if (elements.replayPlayPauseIcon) {
    elements.replayPlayPauseIcon.innerHTML = state.playing || state.playPending
      ? IconPause
      : IconPlay;
  }
  if (elements.replayPlayPauseText) {
    elements.replayPlayPauseText.textContent = label;
  }
  elements.replayPlayPause.setAttribute("aria-label", label);
  elements.replayPlayPause.title = label;
}

function renderActionIcons() {
  if (elements.replayRestartIcon) {
    elements.replayRestartIcon.innerHTML = IconRestart;
  }
  if (elements.replayApproachIcon) {
    elements.replayApproachIcon.innerHTML = IconWorld;
  }
  if (elements.replayRestart) {
    const restartLabel = t("replayRestart");
    elements.replayRestart.setAttribute("aria-label", restartLabel);
    elements.replayRestart.title = restartLabel;
  }
  if (elements.replayApproach) {
    const approachLabel = t("replayApproach");
    elements.replayApproach.setAttribute("aria-label", approachLabel);
    elements.replayApproach.title = approachLabel;
  }
}

function renderStaticSummary() {
  setElementText(
    elements.replayRecordedAtValue,
    formatDateTime(
    state.summary.endedAtMs ?? state.summary.startedAtMs,
    ),
  );
  setElementText(elements.replaySampleCountValue, formatNumber(state.summary.sampleCount, 0));
  setElementText(elements.replayPeakSpeedValue, formatSpeed(state.summary.maxSpeedMs));
  setElementText(elements.replayAverageSpeedValue, formatSpeed(state.summary.averageSpeedMs));
  setElementText(elements.replaySummaryDistanceValue, formatDistance(state.summary.totalDistanceM));
  setElementText(elements.replaySummaryDurationValue, formatDuration(state.summary.durationMs));
  setElementText(elements.replayDurationValue, formatDuration(state.summary.durationMs));

  if (
    Number.isFinite(state.summary.minAltitudeM)
    && Number.isFinite(state.summary.maxAltitudeM)
  ) {
    setElementText(
      elements.replayAltitudeRangeValue,
      `${formatAltitude(state.summary.minAltitudeM)} → ${formatAltitude(state.summary.maxAltitudeM)}`,
    );
  } else {
    setElementText(elements.replayAltitudeRangeValue, "—");
  }
}

function renderHighlights() {
  elements.replayHighlightsList.innerHTML = "";

  if (!state.highlights.length) {
    const empty = document.createElement("div");
    empty.className = "replay-highlight";
    empty.textContent = t("replayNoHighlights");
    elements.replayHighlightsList.appendChild(empty);
    return;
  }

  for (let index = 0; index < state.highlights.length; index += 1) {
    const highlight = state.highlights[index];
    const item = document.createElement("article");
    item.className = "replay-highlight";

    const label = document.createElement("span");
    label.className = "replay-highlight-label";
    label.textContent = t(highlight.labelKey);

    const value = document.createElement("strong");
    value.className = "replay-highlight-value";
    if (highlight.valueUnit === "speed") {
      value.textContent = formatSpeed(highlight.value);
    } else if (highlight.valueUnit === "altitude") {
      value.textContent = formatAltitude(highlight.value);
    } else if (highlight.valueUnit === "acceleration") {
      value.textContent = formatAcceleration(highlight.value);
    } else {
      value.textContent = String(highlight.value ?? "—");
    }

    const detail = document.createElement("span");
    detail.className = "replay-highlight-detail";
    detail.textContent = `${formatDuration(highlight.elapsedMs)} · ${formatDateTime(highlight.sample?.timestampMs)}`;

    item.appendChild(label);
    item.appendChild(value);
    item.appendChild(detail);
    elements.replayHighlightsList.appendChild(item);
  }
}

function renderRecordings() {
  if (!elements.replayRecordingsList) return;

  elements.replayRecordingsList.innerHTML = "";

  if (!state.records.length) {
    const empty = document.createElement("div");
    empty.className = "replay-highlight";
    empty.textContent = t("replayNoRecordings");
    elements.replayRecordingsList.appendChild(empty);
    return;
  }

  for (const record of state.records) {
    const summary = getReplaySummary(record.session);
    const item = document.createElement("article");
    item.className = "replay-recording-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "replay-recording-btn";
    button.dataset.recordingId = record.id;
    button.setAttribute("aria-pressed", String(record.id === state.selectedRecordingId));

    const title = document.createElement("span");
    title.className = "replay-recording-title";

    const titleText = document.createElement("strong");
    titleText.textContent = formatDateTime(summary.endedAtMs ?? summary.startedAtMs);

    const chip = document.createElement("span");
    chip.className = "replay-recording-chip";
    chip.textContent = record.source === "active"
      ? t("replaySessionActive")
      : t("replaySessionSaved");

    title.append(titleText, chip);

    const meta = document.createElement("span");
    meta.className = "replay-recording-meta";
    meta.textContent = `${formatDistance(summary.totalDistanceM)} · ${formatDuration(summary.durationMs)}`;

    const detail = document.createElement("span");
    detail.className = "replay-recording-detail";
    detail.textContent = `${formatNumber(summary.sampleCount, 0)} ${t("replaySamples").toLowerCase()}`;

    button.append(title, meta, detail);
    item.appendChild(button);

    if (record.source === "library") {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "replay-recording-delete";
      deleteButton.dataset.deleteRecordingId = record.id;
      deleteButton.setAttribute("aria-label", t("replayDeleteRecording"));
      deleteButton.title = t("replayDeleteRecording");
      deleteButton.textContent = t("delete");
      item.appendChild(deleteButton);
    }

    elements.replayRecordingsList.appendChild(item);
  }
}

function renderGraphs() {
  chartsController.renderSession(state.session);
}

function updateGraphPlayback(sample) {
  setElementText(graphElements.speed.current, formatSpeed(sample?.speedMs));
  setElementText(graphElements.altitude.current, formatAltitude(sample?.altitudeM));
  setElementText(graphElements.heading.current, formatHeading(sample?.headingDeg));
  chartsController.updatePlayback(state.elapsedMs);
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
  const progressValue = state.summary.durationMs > 0
    ? Math.round((state.elapsedMs / state.summary.durationMs) * 1000)
    : 0;

  if (elements.replayProgress) {
    elements.replayProgress.value = String(progressValue);
  }
  setElementText(elements.replayElapsedValue, formatDuration(sample.elapsedMs));
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

  if (!state.introPlayed) {
    await mapController.runApproachAnimation();
    state.introPlayed = true;
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

function resetPlayback({ refitMap = true } = {}) {
  stopPlayback();
  state.elapsedMs = 0;
  renderPlaybackFrame();

  if (refitMap) {
    mapController.resetCamera();
  }
}

function renderSessionStateView() {
  const hasSession = Boolean(state.session);
  elements.replayEmptyState.hidden = hasSession;
  elements.replayShell.hidden = !hasSession;
}

function applyReplaySelection(recordingId = null) {
  const selection = loadReplaySelection(recordingId ?? state.selectedRecordingId);

  state.records = selection.records;
  state.sessionSource = selection.source;
  state.session = selection.session;
  state.selectedRecordingId = selection.session?.id ?? null;
  state.elapsedMs = 0;
  state.introPlayed = false;
  refreshDerivedState();

  renderSessionStateView();
  renderSessionState();
  renderRecordings();
  renderStaticSummary();
  renderHighlights();
  renderGraphs();
  renderPlaybackButtons();
  renderPlaybackFrame();

  if (state.session) {
    mapController.init();
  }
  mapController.setSession(state.session);
}

function syncLanguage() {
  applyTranslations();
  updatePageMeta();
  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }
  renderSessionState();
  renderPlaybackButtons();
  renderActionIcons();
  renderRateButtons();
  renderRecordings();
  renderStaticSummary();
  renderHighlights();
  renderGraphs();
  renderPlaybackFrame();
}

function bindEvents() {
  elements.langToggle?.addEventListener("click", () => {
    toggleLang();
  });

  bindMenuNavigation(elements.openReplaySpeedMenu, "/speed");
  bindMenuNavigation(elements.openReplayGpsLabMenu, "/gps-rate");
  bindMenuNavigation(elements.openReplayAccelMenu, "/accel");
  bindMenuNavigation(elements.openReplayBoardMenu, "/");

  elements.replayOpenSpeed?.addEventListener("click", () => {
    window.location.href = "/speed";
  });

  elements.replayPlayPause?.addEventListener("click", togglePlayback);

  elements.replayRestart?.addEventListener("click", () => {
    resetPlayback();
  });

  elements.replayApproach?.addEventListener("click", async () => {
    stopPlayback();
    await mapController.runApproachAnimation();
    state.introPlayed = true;
  });

  elements.replayProgress?.addEventListener("input", (event) => {
    if (!state.session) return;
    stopPlayback();
    const progressValue = Number(event.target.value) / 1000;
    state.elapsedMs = state.summary.durationMs * progressValue;
    renderPlaybackFrame();
  });

  elements.replayRecordingsList?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("button[data-delete-recording-id]");
    if (deleteButton) {
      const { deleteRecordingId } = deleteButton.dataset;
      if (!deleteRecordingId) return;
      if (!window.confirm(t("replayDeleteRecordingConfirm"))) return;

      stopPlayback();
      removeReplayRecording(deleteRecordingId);
      applyReplaySelection(
        deleteRecordingId === state.selectedRecordingId ? null : state.selectedRecordingId,
      );
      return;
    }

    const button = event.target.closest("button[data-recording-id]");
    if (!button) return;
    stopPlayback();
    applyReplaySelection(button.dataset.recordingId);
  });

  for (const button of elements.replayRateButtons) {
    button.addEventListener("click", () => {
      setPlaybackRate(Number(button.dataset.rate));
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPlayback();
    }
  });

  document.addEventListener("i18n:change", syncLanguage);
  window.addEventListener("pagehide", stopPlayback);
}

function init() {
  updatePageMeta();
  renderSessionStateView();

  if (elements.langToggle) {
    elements.langToggle.textContent = getLang().toUpperCase();
  }

  renderSessionState();
  renderRateButtons();
  renderPlaybackButtons();
  renderActionIcons();
  renderRecordings();

  if (!state.session) {
    updateGraphPlayback(null);
    return;
  }

  renderStaticSummary();
  renderHighlights();
  renderGraphs();
  mapController.init();
  renderPlaybackFrame();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopPlayback();
    chartsController.destroy();
    mapController.destroy();
  });
}

bindEvents();
init();
