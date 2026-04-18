/**
 * Player shell — compact embeddable panel renderer.
 *
 * Renders now-playing metadata, transport controls, progress, volume,
 * and a collapsible queue bottom-sheet.  Communicates with the
 * audio-runtime singleton — the shell owns zero playback logic.
 *
 * Designed to be mounted inside a draggable widget container by
 * createPlayerWidget().  Not a full-page layout.
 */

import {
  IconPlay, IconPause, IconSkipBack, IconSkipForward,
  IconRepeat, IconShuffle, IconVolume, IconMuted,
  IconMusic, IconClose, IconQueue,
} from "../icons.js";
import { t } from "../i18n.js";
import { createMiniAudioVisualizer } from "../shared/audio-mini-visualizer.js";
import { isVisualizerSafeSource } from "../shared/audio-visualizer.js";
import { primeAudioContext } from "../shared/audio-graph-registry.js";
import { createMilkdropPanel } from "./milkdrop-panel.js";
import * as runtime from "../shared/audio-runtime.js";
import { loadText, saveText } from "../shared/storage.js";

const PROGRESS_MAX = 1000;
const VISUALIZER_VISIBLE_STORAGE_KEY = "vatio_board_player_widget_visualizer_visible";
const VISUALIZER_MODE_STORAGE_KEY = "vatio_board_player_widget_visualizer_mode";
const VISUALIZER_MODES = new Set(["spectrum", "scope"]);
const IconVisualizer = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 17V9M9.5 17V5M15 17v-7M20 17V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
`;
const IconMilkdrop = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.5 2"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  </svg>
`;

function updateRangeVisualFill(input) {
  if (!(input instanceof HTMLInputElement)) return;

  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const safeValue = Number.isFinite(value) ? value : safeMin;
  const span = safeMax - safeMin;
  const clampedValue = Math.min(safeMax, Math.max(safeMin, safeValue));
  const percent = span > 0 ? ((clampedValue - safeMin) / span) * 100 : 0;

  input.style.setProperty("--player-range-percent", `${percent}%`);
}

function normalizeVisualizerMode(mode) {
  const value = String(mode || "").toLowerCase();
  return VISUALIZER_MODES.has(value) ? value : "spectrum";
}

function getNextVisualizerMode(mode) {
  return normalizeVisualizerMode(mode) === "spectrum" ? "scope" : "spectrum";
}

function getVisualizerModeLabel(mode) {
  return normalizeVisualizerMode(mode) === "scope"
    ? t("mediaPlayerVisualizerScope")
    : t("mediaPlayerVisualizerSpectrum");
}

function isSafeVisualizerElement(audioElement) {
  if (!audioElement?.src) return true;
  return isVisualizerSafeSource(audioElement.currentSrc || audioElement.src);
}

/**
 * Format seconds as m:ss or h:mm:ss.
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Create the compact player panel.
 *
 * @param {{ container: HTMLElement }} opts
 * @returns {{
 *   root: HTMLElement,
 *   header: HTMLElement,
 *   closeBtn: HTMLElement,
 *   destroy: () => void,
 *   setTracks: (tracks: object[]) => void,
 * }}
 */
export function createPlayerShell({ container }) {
  // ── Root panel ─────────────────────────────────────────────────
  const root = document.createElement("section");
  root.className = "player-panel";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", t("playerNowPlaying"));

  // ── Header (drag handle) ───────────────────────────────────────
  const header = document.createElement("div");
  header.className = "player-header";

  const titleEl = document.createElement("div");
  titleEl.className = "player-title";
  titleEl.textContent = t("playerNowPlaying");

  const visualizerToggleBtn = makeBtn("player-visualizer-toggle-btn", IconVisualizer, t("mediaPlayerVisualizerMode"));

  const milkdropToggleBtn = makeBtn("player-milkdrop-toggle-btn", IconMilkdrop, t("milkdropOpen"));

  const queueToggleBtn = makeBtn("player-queue-toggle-btn", IconQueue, t("playerQueue"));

  const spacer = document.createElement("div");
  spacer.className = "player-spacer";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "player-close";
  closeBtn.textContent = t("close");

  header.append(titleEl, visualizerToggleBtn, milkdropToggleBtn, queueToggleBtn, spacer, closeBtn);

  // ── Now-playing row (compact artwork + metadata) ───────────────
  const nowPlaying = document.createElement("div");
  nowPlaying.className = "player-now-playing";

  const artworkCompact = document.createElement("div");
  artworkCompact.className = "player-artwork-compact";
  artworkCompact.innerHTML = IconMusic;

  const metaSection = document.createElement("div");
  metaSection.className = "player-meta";
  const metaTitle = document.createElement("div");
  metaTitle.className = "player-meta-title";
  metaTitle.textContent = t("playerNowPlaying");
  const metaArtist = document.createElement("div");
  metaArtist.className = "player-meta-artist";
  const metaGenre = document.createElement("span");
  metaGenre.className = "player-meta-genre";
  metaGenre.hidden = true;
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "player-source-badge";
  sourceBadge.hidden = true;
  metaSection.append(metaTitle, metaArtist, metaGenre, sourceBadge);

  nowPlaying.append(artworkCompact, metaSection);

  // ── Mini visualizer ─────────────────────────────────────────────
  const visualizerStrip = document.createElement("button");
  visualizerStrip.type = "button";
  visualizerStrip.className = "player-visualizer-strip";
  visualizerStrip.dataset.visualizerState = "disabled";
  visualizerStrip.dataset.visualizerMode = "spectrum";
  visualizerStrip.setAttribute("aria-label", t("mediaPlayerVisualizerCycle"));

  const visualizerHost = document.createElement("div");
  visualizerHost.className = "player-visualizer-host";

  const visualizerLabel = document.createElement("span");
  visualizerLabel.className = "player-visualizer-label";
  visualizerLabel.textContent = t("mediaPlayerVisualizerSpectrum");

  visualizerStrip.append(visualizerHost, visualizerLabel);

  // ── Error ──────────────────────────────────────────────────────
  const errorMsg = document.createElement("div");
  errorMsg.className = "player-error";
  errorMsg.hidden = true;

  // ── Progress ───────────────────────────────────────────────────
  const progressSection = document.createElement("div");
  progressSection.className = "player-progress-section";

  const progressBar = document.createElement("input");
  progressBar.type = "range";
  progressBar.className = "player-progress";
  progressBar.min = "0";
  progressBar.max = String(PROGRESS_MAX);
  progressBar.value = "0";
  progressBar.step = "1";
  progressBar.setAttribute("aria-label", t("mediaPlayerProgress"));

  const timeRow = document.createElement("div");
  timeRow.className = "player-time-row";
  const timeCurrent = document.createElement("span");
  timeCurrent.className = "player-time-current";
  timeCurrent.textContent = "0:00";
  const timeTotal = document.createElement("span");
  timeTotal.className = "player-time-total";
  timeTotal.textContent = "0:00";
  timeRow.append(timeCurrent, timeTotal);
  progressSection.append(progressBar, timeRow);

  // ── Transport controls ─────────────────────────────────────────
  const transport = document.createElement("div");
  transport.className = "player-transport";

  const shuffleBtn = makeBtn("player-btn-shuffle", IconShuffle, t("playerShuffle"));
  const prevBtn = makeBtn("player-btn-prev", IconSkipBack, t("playerPreviousTrack"));
  const playBtn = makeBtn("player-btn-play", IconPlay, t("mediaPlayerPlay"));
  playBtn.classList.add("player-btn-play-main");
  const nextBtn = makeBtn("player-btn-next", IconSkipForward, t("playerNextTrack"));
  const repeatBtn = makeBtn("player-btn-repeat", IconRepeat, t("playerRepeat"));

  transport.append(shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn);

  // ── Volume row ─────────────────────────────────────────────────
  const volumeRow = document.createElement("div");
  volumeRow.className = "player-volume-row";

  const muteBtn = makeBtn("player-btn-mute", IconVolume, t("mediaPlayerMute"));
  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.className = "player-volume";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.value = "100";
  volumeSlider.step = "1";
  volumeSlider.setAttribute("aria-label", t("mediaPlayerVolume"));

  volumeRow.append(muteBtn, volumeSlider);
  updateRangeVisualFill(volumeSlider);

  // ── Queue bottom sheet ─────────────────────────────────────────
  const queueSheet = document.createElement("div");
  queueSheet.className = "player-queue-sheet";
  queueSheet.setAttribute("aria-hidden", "true");

  const queueSheetHeader = document.createElement("div");
  queueSheetHeader.className = "player-queue-sheet-header";

  const queueSheetTitle = document.createElement("span");
  queueSheetTitle.textContent = t("playerQueue");

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "player-queue-search";
  searchInput.placeholder = t("playerSearch");
  searchInput.setAttribute("aria-label", t("playerSearch"));

  const queueCloseBtn = document.createElement("button");
  queueCloseBtn.type = "button";
  queueCloseBtn.className = "player-queue-sheet-close";
  queueCloseBtn.setAttribute("aria-label", t("close"));
  queueCloseBtn.innerHTML = IconClose;

  queueSheetHeader.append(queueSheetTitle, searchInput, queueCloseBtn);

  const trackListUl = document.createElement("ul");
  trackListUl.className = "player-queue-list";
  trackListUl.setAttribute("role", "list");

  queueSheet.append(queueSheetHeader, trackListUl);

  // ── Assembly ───────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "player-body";
  body.append(nowPlaying, visualizerStrip, errorMsg, progressSection, transport, volumeRow);

  root.append(header, body, queueSheet);
  container.append(root);

  // ── State ──────────────────────────────────────────────────────
  let seeking = false;
  let allTracks = [];
  let queueOpen = false;
  let visualizerVisible = loadText(VISUALIZER_VISIBLE_STORAGE_KEY, "true") !== "false";
  let visualizerMode = normalizeVisualizerMode(loadText(VISUALIZER_MODE_STORAGE_KEY, "spectrum"));
  let visualizerController = null;
  let visualizerMediaElement = null;
  let visualizerFailed = false;

  // iOS Safari requires a user gesture before an AudioContext can run.
  // Block automatic visualizer start (from runtime state subscription) until
  // the very first user interaction (play / skip / toggle / track click).
  const _needsGestureGate = (() => {
    const ua = navigator.userAgent || "";
    return /Safari\//i.test(ua) && !/Chrom(e|ium)\//i.test(ua) && /iP(hone|od|ad)/i.test(ua);
  })();
  let _gestureUnlocked = !_needsGestureGate;

  // ── Queue sheet toggle ─────────────────────────────────────────
  function setQueueOpen(open) {
    queueOpen = open;
    queueSheet.classList.toggle("is-open", queueOpen);
    queueSheet.setAttribute("aria-hidden", String(!queueOpen));
    queueToggleBtn.classList.toggle("active", queueOpen);
    if (queueOpen) renderTrackList();
  }

  // Prevent queue toggle from triggering header drag
  queueToggleBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  queueToggleBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  queueToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setQueueOpen(!queueOpen);
  });
  queueCloseBtn.addEventListener("click", () => setQueueOpen(false));

  // ── Visualizer controls ─────────────────────────────────────────
  function getRuntimeAudioElement() {
    try {
      const audioElement = typeof runtime.getAudioElement === "function"
        ? runtime.getAudioElement()
        : null;
      return audioElement && typeof audioElement.addEventListener === "function"
        ? audioElement
        : null;
    } catch {
      return null;
    }
  }

  function syncVisualizerUi({ sourceSafe = true } = {}) {
    visualizerStrip.hidden = !visualizerVisible;
    visualizerStrip.dataset.visualizerMode = visualizerMode;
    visualizerStrip.dataset.visualizerState = visualizerFailed
      ? "error"
      : visualizerVisible
        ? sourceSafe ? "ready" : "disabled"
        : "disabled";
    visualizerToggleBtn.classList.toggle("active", visualizerVisible);
    visualizerToggleBtn.setAttribute("aria-pressed", String(visualizerVisible));
    visualizerLabel.textContent = visualizerFailed || (visualizerVisible && !sourceSafe)
      ? t("mediaPlayerVisualizerUnavailable")
      : getVisualizerModeLabel(visualizerMode);
  }

  function getOrCreateVisualizer() {
    if (!visualizerVisible || visualizerFailed) return null;

    const audioElement = getRuntimeAudioElement();
    if (!audioElement || !isSafeVisualizerElement(audioElement)) return null;

    if (visualizerController && visualizerMediaElement === audioElement) {
      return visualizerController;
    }

    visualizerController?.destroy();
    visualizerController = createMiniAudioVisualizer({
      mediaElement: audioElement,
      mount: visualizerHost,
      mode: visualizerMode,
    });
    visualizerMediaElement = audioElement;

    if (!visualizerController.isAvailable) {
      visualizerFailed = true;
      visualizerController = null;
      visualizerMediaElement = null;
      syncVisualizerUi();
      return null;
    }

    return visualizerController;
  }

  function stopVisualizer() {
    visualizerController?.stop();
  }

  function syncVisualizerPlayback(stateSnapshot = runtime.getState()) {
    const audioElement = getRuntimeAudioElement();
    const sourceSafe = isSafeVisualizerElement(audioElement);
    syncVisualizerUi({ sourceSafe });
    if (!visualizerVisible) {
      stopVisualizer();
      return;
    }

    // On iOS Safari, defer visualizer start until the first user gesture
    // so the AudioContext can transition to "running".
    if (!_gestureUnlocked) return;

    if (!sourceSafe) {
      visualizerController?.destroy();
      visualizerController = null;
      visualizerMediaElement = null;
      return;
    }

    const controller = getOrCreateVisualizer();
    if (!controller) return;

    controller.setMode(visualizerMode);
    if (!stateSnapshot.playing || document.hidden) {
      controller.stop();
      return;
    }

    controller.start().then((started) => {
      if (!started || !controller.isAvailable) {
        visualizerFailed = true;
        controller.stop();
        syncVisualizerUi();
      }
    }).catch(() => {
      visualizerFailed = true;
      syncVisualizerUi();
    });
  }

  function setVisualizerVisible(visible) {
    visualizerVisible = Boolean(visible);
    saveText(VISUALIZER_VISIBLE_STORAGE_KEY, visualizerVisible ? "true" : "false");
    syncVisualizerPlayback();
  }

  visualizerToggleBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  visualizerToggleBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  visualizerToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _gestureUnlocked = true;
    primeAudioContext();
    setVisualizerVisible(!visualizerVisible);
  });

  visualizerStrip.addEventListener("click", () => {
    _gestureUnlocked = true;
    primeAudioContext();
    if (visualizerFailed) return;
    visualizerMode = getNextVisualizerMode(visualizerMode);
    saveText(VISUALIZER_MODE_STORAGE_KEY, visualizerMode);
    visualizerController?.setMode(visualizerMode);
    syncVisualizerPlayback();
  });

  // ── Milkdrop panel (lazy) ──────────────────────────────────────
  let milkdropPanel = null;

  milkdropToggleBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  milkdropToggleBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  milkdropToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!milkdropPanel) {
      milkdropPanel = createMilkdropPanel({ mount: container });
    }
    milkdropPanel.toggle();
    milkdropToggleBtn.classList.toggle("active", milkdropPanel.isOpen());
  });

  // ── Event wiring ───────────────────────────────────────────────
  playBtn.addEventListener("click", () => {
    // Pre-warm AudioContext synchronously from the user gesture so iOS
    // Safari allows it to enter the "running" state.  acquireGraph()
    // will reuse this context when the visualizer starts later.
    _gestureUnlocked = true;
    primeAudioContext();

    const s = runtime.getState();
    if (s.paused || !s.playing) {
      if (s.muted) runtime.setMuted(false);
      void runtime.play();
    } else {
      runtime.pause();
    }
  });

  prevBtn.addEventListener("click", () => {
    _gestureUnlocked = true;
    primeAudioContext();
    void runtime.previousTrack();
  });
  nextBtn.addEventListener("click", () => {
    _gestureUnlocked = true;
    primeAudioContext();
    void runtime.nextTrack();
  });
  shuffleBtn.addEventListener("click", () => runtime.toggleShuffle());
  repeatBtn.addEventListener("click", () => runtime.cycleRepeat());

  muteBtn.addEventListener("click", () => runtime.setMuted());
  volumeSlider.addEventListener("input", () => {
    updateRangeVisualFill(volumeSlider);
    runtime.setVolume(Number(volumeSlider.value) / 100);
  });

  progressBar.addEventListener("pointerdown", () => { seeking = true; });
  progressBar.addEventListener("input", () => {
    updateRangeVisualFill(progressBar);
    const s = runtime.getState();
    if (Number.isFinite(s.duration) && s.duration > 0) {
      const time = (Number(progressBar.value) / PROGRESS_MAX) * s.duration;
      timeCurrent.textContent = formatTime(time);
    }
  });
  progressBar.addEventListener("change", () => {
    const s = runtime.getState();
    if (Number.isFinite(s.duration) && s.duration > 0) {
      runtime.seekTo((Number(progressBar.value) / PROGRESS_MAX) * s.duration);
    }
    updateRangeVisualFill(progressBar);
    seeking = false;
  });

  searchInput.addEventListener("input", () => {
    renderTrackList(searchInput.value.trim().toLowerCase());
  });

  // ── Render helpers ─────────────────────────────────────────────

  function renderState(s) {
    // Play/pause
    playBtn.querySelector(".btn-icon").innerHTML = s.playing ? IconPause : IconPlay;
    playBtn.setAttribute("aria-label", s.playing ? t("mediaPlayerPause") : t("mediaPlayerPlay"));

    // Progress
    if (!seeking) {
      if (Number.isFinite(s.duration) && s.duration > 0) {
        progressBar.value = String(Math.round((s.currentTime / s.duration) * PROGRESS_MAX));
        timeCurrent.textContent = formatTime(s.currentTime);
        timeTotal.textContent = formatTime(s.duration);
      } else {
        progressBar.value = "0";
        timeCurrent.textContent = "0:00";
        timeTotal.textContent = "0:00";
      }
    }
    updateRangeVisualFill(progressBar);

    // Metadata
    const track = s.currentTrack;
    metaTitle.textContent = track?.title || track?.original_filename || t("playerNowPlaying");
    metaArtist.textContent = track?.artist || track?.folder_path || "";

    // Genre tag
    const genre = track?.genre || "";
    if (genre) {
      metaGenre.textContent = genre;
      metaGenre.hidden = false;
    } else {
      metaGenre.hidden = true;
    }

    // Compact artwork
    const artUrl = track?.preview_image_url || track?.image_url || "";
    if (artUrl) {
      artworkCompact.innerHTML = "";
      artworkCompact.style.backgroundImage = `url(${CSS.escape(artUrl)})`;
      artworkCompact.classList.add("has-image");
    } else {
      artworkCompact.style.backgroundImage = "";
      artworkCompact.innerHTML = IconMusic;
      artworkCompact.classList.remove("has-image");
    }

    // Source badge
    if (s.sourceType === "blob") {
      sourceBadge.textContent = t("playerOffline");
      sourceBadge.hidden = false;
      sourceBadge.className = "player-source-badge offline";
    } else if (s.sourceType === "remote") {
      sourceBadge.textContent = t("playerRemote");
      sourceBadge.hidden = false;
      sourceBadge.className = "player-source-badge remote";
    } else {
      sourceBadge.hidden = true;
    }

    // Shuffle / repeat
    shuffleBtn.classList.toggle("active", s.shuffle);
    repeatBtn.classList.toggle("active", s.repeat !== "off");
    if (s.repeat === "one") {
      repeatBtn.dataset.repeatMode = "one";
    } else {
      delete repeatBtn.dataset.repeatMode;
    }

    // Volume
    muteBtn.querySelector(".btn-icon").innerHTML = s.muted ? IconMuted : IconVolume;
    muteBtn.setAttribute("aria-label", s.muted ? t("mediaPlayerUnmute") : t("mediaPlayerMute"));
    volumeSlider.value = String(Math.round(s.volume * 100));
    updateRangeVisualFill(volumeSlider);

    // Loading/error
    root.classList.toggle("loading", s.loading);
    root.classList.toggle("error", Boolean(s.error));

    if (s.error) {
      errorMsg.textContent = s.error === "unavailable"
        ? t("playerTrackUnavailable")
        : t("playerPlaybackError");
      errorMsg.hidden = false;
    } else {
      errorMsg.hidden = true;
    }

    // Queue active indicator
    renderQueueActive(s.currentTrack?.name);
    updateOfflineBadges(s.queue);
    syncVisualizerPlayback(s);
  }

  function renderTrackList(filter = "") {
    trackListUl.innerHTML = "";
    const s = runtime.getState();
    const source = allTracks.length > 0 ? allTracks : s.queue;
    const tracks = filter
      ? source.filter((tr) => {
          const hay = `${tr.title || ""} ${tr.artist || ""} ${tr.original_filename || ""} ${tr.folder_path || ""}`.toLowerCase();
          return hay.includes(filter);
        })
      : source;

    if (tracks.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "player-queue-empty";
      emptyLi.textContent = t("playerNoTracks");
      trackListUl.append(emptyLi);
      return;
    }

    for (const track of tracks) {
      const li = document.createElement("li");
      li.className = "player-queue-item";
      li.dataset.trackName = track.name;
      if (s.currentTrack?.name === track.name) li.classList.add("active");

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-queue-item-name";
      nameSpan.textContent = track.title || track.original_filename || track.name;

      const artistSpan = document.createElement("span");
      artistSpan.className = "player-queue-item-artist";
      artistSpan.textContent = track.artist || track.folder_path || "";

      const badge = document.createElement("span");
      badge.className = "player-queue-item-badge";
      if (track._offline) {
        badge.classList.add("offline");
        badge.title = t("playerOffline");
      }

      li.append(nameSpan, artistSpan, badge);
      li.addEventListener("click", () => {
        _gestureUnlocked = true;
        primeAudioContext();
        void runtime.playCatalogTrack(track.name, allTracks);
      });

      trackListUl.append(li);
    }
  }

  function renderQueueActive(currentName) {
    for (const li of trackListUl.children) {
      if (li.dataset?.trackName) {
        li.classList.toggle("active", li.dataset.trackName === currentName);
      }
    }
  }

  function updateOfflineBadges(queue) {
    const newOffline = new Set();
    for (const track of queue) {
      if (track._offline) newOffline.add(track.name);
    }
    if (newOffline.size === 0) return;

    // Update existing badge DOM nodes without full re-render
    for (const li of trackListUl.children) {
      const name = li.dataset?.trackName;
      if (!name || !newOffline.has(name)) continue;
      const badge = li.querySelector(".player-queue-item-badge");
      if (badge && !badge.classList.contains("offline")) {
        badge.classList.add("offline");
        badge.title = t("playerOffline");
      }
    }

    // Sync allTracks so queue re-renders preserve the badge
    for (const track of allTracks) {
      if (newOffline.has(track.name)) track._offline = true;
    }
  }

  // ── Runtime subscription ───────────────────────────────────────
  const unsubscribe = runtime.subscribe(renderState);
  updateRangeVisualFill(progressBar);
  updateRangeVisualFill(volumeSlider);
  renderState(runtime.getState());

  // ── Public API ─────────────────────────────────────────────────
  return {
    /** The panel DOM element. */
    root,
    /** The header element (drag handle for the widget). */
    header,
    /** The close button (widget wires its click handler). */
    closeBtn,

    destroy() {
      unsubscribe();
      visualizerController?.destroy();
      visualizerController = null;
      milkdropPanel?.destroy();
      milkdropPanel = null;
      root.remove();
    },

    setTracks(tracks) {
      allTracks = tracks;
      if (queueOpen) renderTrackList();
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeBtn(className, iconHtml, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-label", label);
  const icon = document.createElement("span");
  icon.className = "btn-icon";
  icon.innerHTML = iconHtml;
  btn.append(icon);
  return btn;
}
