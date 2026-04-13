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
import * as runtime from "../shared/audio-runtime.js";

const PROGRESS_MAX = 1000;

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

  const queueToggleBtn = makeBtn("player-queue-toggle-btn", IconQueue, t("playerQueue"));

  const spacer = document.createElement("div");
  spacer.className = "player-spacer";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "player-close";
  closeBtn.textContent = t("close");

  header.append(titleEl, queueToggleBtn, spacer, closeBtn);

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
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "player-source-badge";
  sourceBadge.hidden = true;
  metaSection.append(metaTitle, metaArtist, sourceBadge);

  nowPlaying.append(artworkCompact, metaSection);

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
  body.append(nowPlaying, errorMsg, progressSection, transport, volumeRow);

  root.append(header, body, queueSheet);
  container.append(root);

  // ── State ──────────────────────────────────────────────────────
  let seeking = false;
  let allTracks = [];
  let queueOpen = false;

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

  // ── Event wiring ───────────────────────────────────────────────
  playBtn.addEventListener("click", () => {
    const s = runtime.getState();
    if (s.paused || !s.playing) {
      if (s.muted) runtime.setMuted(false);
      void runtime.play();
    } else {
      runtime.pause();
    }
  });

  prevBtn.addEventListener("click", () => { void runtime.previousTrack(); });
  nextBtn.addEventListener("click", () => { void runtime.nextTrack(); });
  shuffleBtn.addEventListener("click", () => runtime.toggleShuffle());
  repeatBtn.addEventListener("click", () => runtime.cycleRepeat());

  muteBtn.addEventListener("click", () => runtime.setMuted());
  volumeSlider.addEventListener("input", () => {
    runtime.setVolume(Number(volumeSlider.value) / 100);
  });

  progressBar.addEventListener("pointerdown", () => { seeking = true; });
  progressBar.addEventListener("input", () => {
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
    if (!seeking && Number.isFinite(s.duration) && s.duration > 0) {
      progressBar.value = String(Math.round((s.currentTime / s.duration) * PROGRESS_MAX));
      timeCurrent.textContent = formatTime(s.currentTime);
      timeTotal.textContent = formatTime(s.duration);
    }

    // Metadata
    const track = s.currentTrack;
    metaTitle.textContent = track?.title || track?.original_filename || t("playerNowPlaying");
    metaArtist.textContent = track?.folder_path || "";

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
  }

  function renderTrackList(filter = "") {
    trackListUl.innerHTML = "";
    const s = runtime.getState();
    const source = allTracks.length > 0 ? allTracks : s.queue;
    const tracks = filter
      ? source.filter((tr) => {
          const hay = `${tr.title || ""} ${tr.original_filename || ""} ${tr.folder_path || ""}`.toLowerCase();
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

      const badge = document.createElement("span");
      badge.className = "player-queue-item-badge";
      if (track._offline) {
        badge.classList.add("offline");
        badge.title = t("playerOffline");
      }

      li.append(nameSpan, badge);
      li.addEventListener("click", () => {
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
