/**
 * Player shell.
 *
 * Full-page audio player UI component.  Renders artwork, metadata,
 * transport controls, progress bar, volume, queue drawer, and offline
 * indicators.  Communicates with the audio-runtime singleton — the
 * shell owns zero playback logic.
 *
 * Mount into any container via createPlayerShell({ container }).
 */

import {
  IconPlay, IconPause, IconSkipBack, IconSkipForward,
  IconRepeat, IconShuffle, IconVolume, IconMuted,
  IconMusic,
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
 * Create and mount the player shell.
 *
 * @param {{ container: HTMLElement, onTrackSelect?: (track: object) => void }} opts
 * @returns {{ destroy: () => void, setTracks: (tracks: object[]) => void }}
 */
export function createPlayerShell({ container, onTrackSelect }) {
  // ── Root element ───────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "player-shell";

  // ── Artwork stage ──────────────────────────────────────────────
  const artworkStage = document.createElement("div");
  artworkStage.className = "player-artwork";
  const artworkImg = document.createElement("div");
  artworkImg.className = "player-artwork-inner";
  artworkImg.innerHTML = IconMusic;
  artworkStage.append(artworkImg);

  // ── Metadata ───────────────────────────────────────────────────
  const metaSection = document.createElement("div");
  metaSection.className = "player-meta";
  const metaTitle = document.createElement("div");
  metaTitle.className = "player-meta-title";
  metaTitle.textContent = t("playerNowPlaying");
  const metaArtist = document.createElement("div");
  metaArtist.className = "player-meta-artist";
  metaSection.append(metaTitle, metaArtist);

  // ── Source badge ───────────────────────────────────────────────
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "player-source-badge";
  sourceBadge.hidden = true;
  metaSection.append(sourceBadge);

  // ── Error message ──────────────────────────────────────────────
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

  // ── Search bar ─────────────────────────────────────────────────
  const searchBar = document.createElement("input");
  searchBar.type = "search";
  searchBar.className = "player-search";
  searchBar.placeholder = t("playerSearch");
  searchBar.setAttribute("aria-label", t("playerSearch"));

  // ── Track list (visible by default) ─────────────────────────────
  const trackList = document.createElement("div");
  trackList.className = "player-track-list";

  const trackListHeader = document.createElement("div");
  trackListHeader.className = "player-track-list-header";
  const trackListTitle = document.createElement("span");
  trackListTitle.className = "player-track-list-title";
  trackListTitle.textContent = t("playerQueue");
  trackListHeader.append(trackListTitle);

  const trackListUl = document.createElement("ul");
  trackListUl.className = "player-track-list-items";
  trackListUl.setAttribute("role", "list");

  const trackListEmpty = document.createElement("li");
  trackListEmpty.className = "player-queue-empty";
  trackListEmpty.textContent = t("playerNoTracks");
  trackListUl.append(trackListEmpty);

  trackList.append(trackListHeader, trackListUl);

  // ── Main layout assembly ───────────────────────────────────────
  const controlsArea = document.createElement("div");
  controlsArea.className = "player-controls-area";
  controlsArea.append(metaSection, errorMsg, progressSection, transport, volumeRow);

  root.append(artworkStage, controlsArea, searchBar, trackList);
  container.append(root);

  // ── State ──────────────────────────────────────────────────────
  let seeking = false;
  let allTracks = [];

  // ── Event wiring ───────────────────────────────────────────────
  playBtn.addEventListener("click", () => {
    const s = runtime.getState();
    if (s.paused || !s.playing) {
      if (s.muted) {
        runtime.setMuted(false);
      }
      void runtime.play();
    }
    else runtime.pause();
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

  searchBar.addEventListener("input", () => {
    const query = searchBar.value.trim().toLowerCase();
    renderTrackList(query);
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

    // Artwork
    const artUrl = track?.preview_image_url || track?.image_url || "";
    if (artUrl) {
      artworkImg.innerHTML = "";
      artworkImg.style.backgroundImage = `url(${CSS.escape(artUrl)})`;
      artworkImg.classList.add("has-image");
    } else {
      artworkImg.style.backgroundImage = "";
      artworkImg.innerHTML = IconMusic;
      artworkImg.classList.remove("has-image");
    }

    // Source badge
    if (s.sourceType === "blob") {
      sourceBadge.textContent = t("playerOffline");
      sourceBadge.hidden = false;
      sourceBadge.classList.add("offline");
      sourceBadge.classList.remove("remote");
    } else if (s.sourceType === "remote") {
      sourceBadge.textContent = t("playerRemote");
      sourceBadge.hidden = false;
      sourceBadge.classList.add("remote");
      sourceBadge.classList.remove("offline");
    } else {
      sourceBadge.hidden = true;
    }

    // Shuffle / repeat indicators
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
  }

  /**
   * Render the visible track list panel (always shown below search).
   */
  function renderTrackList(filter = "") {
    trackListUl.innerHTML = "";
    const s = runtime.getState();
    const source = allTracks.length > 0 ? allTracks : s.queue;
    const tracks = filter
      ? source.filter((t) => {
          const hay = `${t.title || ""} ${t.original_filename || ""} ${t.folder_path || ""}`.toLowerCase();
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
      li.className = "player-queue-item player-track-item";
      li.dataset.trackName = track.name;
      if (s.currentTrack?.name === track.name) li.classList.add("active");

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-queue-item-name";
      nameSpan.textContent = track.title || track.original_filename || track.name;

      const offlineDot = document.createElement("span");
      offlineDot.className = "player-queue-item-badge";
      if (track._offline) {
        offlineDot.classList.add("offline");
        offlineDot.title = t("playerOffline");
      }

      li.append(nameSpan, offlineDot);
      li.addEventListener("click", () => {
        void runtime.playCatalogTrack(track.name, allTracks);
        if (typeof onTrackSelect === "function") onTrackSelect(track);
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

  // ── Runtime subscription ───────────────────────────────────────
  const unsubscribe = runtime.subscribe(renderState);

  // Initial render
  renderState(runtime.getState());

  // ── Public API ─────────────────────────────────────────────────
  return {
    destroy() {
      unsubscribe();
      root.remove();
    },

    /**
     * Set the browsable track list (used by queue drawer and search).
     * @param {object[]} tracks
     */
    setTracks(tracks) {
      allTracks = tracks;
      renderTrackList();
    },

    /** The root DOM element (for external styling hooks). */
    root,
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
