import { IconFullscreen, IconFullscreenExit, IconMuted, IconPause, IconPlay, IconVolume } from "../icons.js";
import { t } from "../i18n.js";
import { createMiniAudioVisualizer } from "./audio-mini-visualizer.js";
import { loadText, saveText } from "./storage.js";

/**
 * Format seconds as m:ss or h:mm:ss.
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const totalSeconds = Math.floor(seconds);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;

  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${m}:${String(s).padStart(2, "0")}`;
}

const PROGRESS_MAX = 1000;
const VISUALIZER_MODE_STORAGE_KEY = "vatio_board_media_player_visualizer_mode";
const VALID_VISUALIZER_MODES = new Set(["spectrum", "scope", "off"]);

function normalizeVisualizerMode(mode) {
  const value = String(mode || "").toLowerCase();
  return VALID_VISUALIZER_MODES.has(value) ? value : "spectrum";
}

function loadVisualizerModePreference() {
  return normalizeVisualizerMode(loadText(VISUALIZER_MODE_STORAGE_KEY, "spectrum"));
}

function saveVisualizerModePreference(mode) {
  saveText(VISUALIZER_MODE_STORAGE_KEY, normalizeVisualizerMode(mode));
}

function getVisualizerModeLabel(mode) {
  if (mode === "scope") return t("mediaPlayerVisualizerScope");
  if (mode === "off") return t("mediaPlayerVisualizerOff");
  return t("mediaPlayerVisualizerSpectrum");
}

function getNextVisualizerMode(mode) {
  if (mode === "spectrum") return "scope";
  if (mode === "scope") return "off";
  return "spectrum";
}

/**
 * Creates a reusable inline media player with transport controls.
 *
 * @param {object} options
 * @param {HTMLElement} options.container - Parent element to mount into
 * @param {string} options.src - Media source URL
 * @param {"audio"|"video"} options.kind - Media type
 * @param {string} [options.title] - Accessible title for the media
 * @param {string} [options.posterUrl] - Poster image URL for video
 * @returns {{ destroy: () => void, mediaElement: HTMLMediaElement }}
 */
export function createMediaPlayer({ container, src, kind, title = "", posterUrl = "", visualizer: enableVisualizer = false, onFirstRemotePlay = null }) {
  if (!container || !src) return null;

  const isVideo = kind === "video";
  const shouldRenderVisualizer = enableVisualizer && !isVideo;
  let firstPlayFired = false;
  let preferredVisualizerMode = loadVisualizerModePreference();
  let effectiveVisualizerMode = shouldRenderVisualizer ? preferredVisualizerMode : "off";
  let activeVisualizer = null;
  let visualizerFailed = false;

  // Root wrapper
  const root = document.createElement("div");
  root.className = "media-player";
  root.dataset.mediaKind = kind;

  // Stage — holds the media element or audio fallback
  const stage = document.createElement("div");
  stage.className = "media-player-stage";

  // Create media element
  const media = document.createElement(isVideo ? "video" : "audio");
  media.src = src;
  media.preload = "metadata";
  if (title) media.title = title;

  let audioCanvasWrap = null;
  let audioCanvasMount = null;
  let audioFallback = null;
  let visualizerModeGroup = null;
  const visualizerModeButtons = new Map();

  if (isVideo) {
    media.playsInline = true;
    media.controls = false;
    if (posterUrl) media.poster = posterUrl;
    stage.append(media);
  } else {
    // Audio: show a compact stage with metadata and optional mini visualizer.
    const audioVisual = document.createElement("div");
    audioVisual.className = "media-player-audio-visual";

    const audioHeader = document.createElement("div");
    audioHeader.className = "media-player-audio-header";

    const audioMeta = document.createElement("div");
    audioMeta.className = "media-player-audio-meta";

    const iconEl = document.createElement("span");
    iconEl.className = "media-player-audio-icon";
    iconEl.innerHTML = IconVolume;
    audioMeta.append(iconEl);

    const kindLabel = document.createElement("span");
    kindLabel.className = "media-player-audio-label";
    kindLabel.textContent = title || t("mediaPlayerAudio");
    audioMeta.append(kindLabel);
    audioHeader.append(audioMeta);

    if (shouldRenderVisualizer) {
      visualizerModeGroup = document.createElement("div");
      visualizerModeGroup.className = "media-player-audio-visualizer-modes";
      visualizerModeGroup.setAttribute("role", "group");
      visualizerModeGroup.setAttribute("aria-label", t("mediaPlayerVisualizerMode"));

      ["spectrum", "scope", "off"].forEach((mode) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "media-player-audio-mode-btn";
        button.dataset.mode = mode;
        button.textContent = getVisualizerModeLabel(mode);
        button.setAttribute("aria-pressed", "false");
        visualizerModeButtons.set(mode, button);
        visualizerModeGroup.append(button);
      });

      audioHeader.append(visualizerModeGroup);
    }

    audioCanvasWrap = document.createElement(shouldRenderVisualizer ? "button" : "div");
    audioCanvasWrap.className = "media-player-audio-canvas-wrap";
    audioCanvasWrap.dataset.visualizerState = "disabled";
    audioCanvasWrap.dataset.visualizerMode = effectiveVisualizerMode;
    if (audioCanvasWrap instanceof HTMLButtonElement) {
      audioCanvasWrap.type = "button";
      audioCanvasWrap.setAttribute("aria-label", t("mediaPlayerVisualizerCycle"));
    }

    audioCanvasMount = document.createElement("div");
    audioCanvasMount.className = "media-player-audio-canvas-host";

    audioFallback = document.createElement("div");
    audioFallback.className = "media-player-audio-fallback";
    audioFallback.textContent = t("mediaPlayerVisualizerOff");

    audioCanvasWrap.append(audioCanvasMount, audioFallback);
    audioVisual.append(audioHeader, audioCanvasWrap);
    stage.append(audioVisual);

    // Audio element is hidden but present for playback
    media.style.display = "none";
    stage.append(media);
  }

  // Controls bar
  const controls = document.createElement("div");
  controls.className = "media-player-controls";

  // Play/pause button
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "media-player-play-btn";
  playBtn.setAttribute("aria-label", t("mediaPlayerPlay"));
  const playIcon = document.createElement("span");
  playIcon.className = "btn-icon";
  playIcon.innerHTML = IconPlay;
  playBtn.append(playIcon);

  // Progress slider
  const progress = document.createElement("input");
  progress.type = "range";
  progress.className = "media-player-progress";
  progress.min = "0";
  progress.max = String(PROGRESS_MAX);
  progress.value = "0";
  progress.step = "1";
  progress.setAttribute("aria-label", t("mediaPlayerProgress"));

  // Time display
  const timeDisplay = document.createElement("span");
  timeDisplay.className = "media-player-time";
  timeDisplay.textContent = "0:00 / 0:00";

  // Mute button
  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "media-player-mute-btn";
  muteBtn.setAttribute("aria-label", t("mediaPlayerMute"));
  const muteIcon = document.createElement("span");
  muteIcon.className = "btn-icon";
  muteIcon.innerHTML = IconVolume;
  muteBtn.append(muteIcon);

  // Volume slider
  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.className = "media-player-volume";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.value = "100";
  volumeSlider.step = "1";
  volumeSlider.setAttribute("aria-label", t("mediaPlayerVolume"));

  // Fullscreen button (video only)
  let fullscreenBtn = null;
  let fullscreenIcon = null;
  if (isVideo) {
    fullscreenBtn = document.createElement("button");
    fullscreenBtn.type = "button";
    fullscreenBtn.className = "media-player-fullscreen-btn";
    fullscreenBtn.setAttribute("aria-label", t("mediaPlayerFullscreen"));
    fullscreenIcon = document.createElement("span");
    fullscreenIcon.className = "btn-icon";
    fullscreenIcon.innerHTML = IconFullscreen;
    fullscreenBtn.append(fullscreenIcon);
  }

  controls.append(playBtn, progress, timeDisplay, muteBtn, volumeSlider);
  if (fullscreenBtn) controls.append(fullscreenBtn);
  root.append(stage, controls);

  // State
  let playing = false;
  let seeking = false;
  let destroyed = false;
  let rafId = null;

  function syncVisualizerUi() {
    const isVisualizerAvailable = Boolean(shouldRenderVisualizer && activeVisualizer?.isAvailable && !visualizerFailed);
    effectiveVisualizerMode = isVisualizerAvailable ? preferredVisualizerMode : "off";

    if (audioCanvasWrap) {
      audioCanvasWrap.dataset.visualizerMode = effectiveVisualizerMode;
      audioCanvasWrap.dataset.visualizerState = visualizerFailed
        ? "error"
        : effectiveVisualizerMode === "off"
          ? "disabled"
          : "ready";

      if (audioCanvasWrap instanceof HTMLButtonElement) {
        audioCanvasWrap.disabled = !isVisualizerAvailable;
      }
    }

    if (audioFallback) {
      if (visualizerFailed) {
        audioFallback.textContent = t("mediaPlayerVisualizerUnavailable");
      } else if (effectiveVisualizerMode === "off") {
        audioFallback.textContent = t("mediaPlayerVisualizerOff");
      } else {
        audioFallback.textContent = getVisualizerModeLabel(effectiveVisualizerMode);
      }
    }

    visualizerModeButtons.forEach((button, mode) => {
      button.setAttribute("aria-pressed", String(mode === effectiveVisualizerMode));
      button.disabled = !isVisualizerAvailable;
    });
  }

  function stopProgressLoop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  function stopVisualizerRendering() {
    activeVisualizer?.stop();
  }

  function markVisualizerUnavailable() {
    if (visualizerFailed) return;
    visualizerFailed = true;
    stopVisualizerRendering();
    syncVisualizerUi();
  }

  function syncVisualizerPlayback() {
    if (!shouldRenderVisualizer || !activeVisualizer || destroyed) return;

    if (visualizerFailed || !activeVisualizer.isAvailable) {
      markVisualizerUnavailable();
      return;
    }

    if (!playing || document.hidden || preferredVisualizerMode === "off") {
      stopVisualizerRendering();
      syncVisualizerUi();
      return;
    }

    activeVisualizer.setMode(preferredVisualizerMode);
    activeVisualizer.start().then((started) => {
      if (!started || destroyed || !activeVisualizer.isAvailable) {
        markVisualizerUnavailable();
        return;
      }
      syncVisualizerUi();
    }).catch(() => {
      markVisualizerUnavailable();
    });
  }

  function primeVisualizerFromGesture() {
    if (!shouldRenderVisualizer || !activeVisualizer || destroyed) return;

    if (visualizerFailed || !activeVisualizer.isAvailable) {
      markVisualizerUnavailable();
      return;
    }

    if (preferredVisualizerMode === "off") {
      stopVisualizerRendering();
      syncVisualizerUi();
      return;
    }

    activeVisualizer.setMode(preferredVisualizerMode);
    activeVisualizer.start().then((started) => {
      if (!started || destroyed || !activeVisualizer.isAvailable) {
        markVisualizerUnavailable();
        return;
      }
      syncVisualizerUi();
    }).catch(() => {
      markVisualizerUnavailable();
    });
  }

  function setVisualizerMode(nextMode, { persist = true } = {}) {
    preferredVisualizerMode = normalizeVisualizerMode(nextMode);
    if (persist) {
      saveVisualizerModePreference(preferredVisualizerMode);
    }

    if (activeVisualizer) {
      activeVisualizer.setMode(preferredVisualizerMode);
    }

    if (preferredVisualizerMode === "off") {
      stopVisualizerRendering();
      syncVisualizerUi();
      return;
    }

    syncVisualizerUi();
    syncVisualizerPlayback();
  }

  function syncPlayIcon() {
    playIcon.innerHTML = playing ? IconPause : IconPlay;
    playBtn.setAttribute("aria-label", playing ? t("mediaPlayerPause") : t("mediaPlayerPlay"));
  }

  function syncMuteIcon() {
    muteIcon.innerHTML = media.muted ? IconMuted : IconVolume;
    muteBtn.setAttribute("aria-label", media.muted ? t("mediaPlayerUnmute") : t("mediaPlayerMute"));
  }

  function syncTimeDisplay() {
    const current = formatTime(media.currentTime);
    const total = formatTime(media.duration);
    timeDisplay.textContent = `${current} / ${total}`;
  }

  function syncProgress() {
    if (seeking || !Number.isFinite(media.duration) || media.duration === 0) return;
    const ratio = media.currentTime / media.duration;
    progress.value = String(Math.round(ratio * PROGRESS_MAX));
  }

  function updateLoop() {
    if (destroyed) return;
    syncProgress();
    syncTimeDisplay();
    if (playing) {
      rafId = requestAnimationFrame(updateLoop);
    }
  }

  // Event handlers
  function onPlay() {
    playing = true;
    delete root.dataset.playbackError;
    syncPlayIcon();
    rafId = requestAnimationFrame(updateLoop);
    syncVisualizerPlayback();

    // Fire the first-remote-play callback exactly once for non-blob sources.
    if (!firstPlayFired && typeof onFirstRemotePlay === "function") {
      firstPlayFired = true;
      if (!src.startsWith("blob:")) {
        try { onFirstRemotePlay(); } catch { /* non-blocking */ }
      }
    }
  }

  function onPause() {
    playing = false;
    syncPlayIcon();
    stopProgressLoop();
    syncProgress();
    syncTimeDisplay();
    stopVisualizerRendering();
  }

  function onEnded() {
    playing = false;
    syncPlayIcon();
    stopProgressLoop();
    syncProgress();
    syncTimeDisplay();
    stopVisualizerRendering();
  }

  function onEmptied() {
    playing = false;
    syncPlayIcon();
    stopProgressLoop();
    syncTimeDisplay();
    stopVisualizerRendering();
  }

  function onMediaError() {
    stopVisualizerRendering();
  }

  function onLoadedMetadata() {
    syncTimeDisplay();
    syncProgress();
    activeVisualizer?.resize();
  }

  function onTimeUpdate() {
    if (!playing) {
      syncProgress();
      syncTimeDisplay();
    }
  }

  function onVolumeChange() {
    syncMuteIcon();
    if (!media.muted) {
      volumeSlider.value = String(Math.round(media.volume * 100));
    }
  }

  function onPlayBtnClick() {
    if (destroyed) return;
    if (media.paused || media.ended) {
      primeVisualizerFromGesture();
      media.play().catch((err) => {
        if (err?.name === "AbortError") return;
        stopVisualizerRendering();
        root.dataset.playbackError = "true";
      });
    } else {
      media.pause();
    }
  }

  function onProgressInput() {
    seeking = true;
    if (Number.isFinite(media.duration)) {
      const ratio = Number(progress.value) / PROGRESS_MAX;
      media.currentTime = ratio * media.duration;
      syncTimeDisplay();
    }
  }

  function onProgressChange() {
    seeking = false;
    if (Number.isFinite(media.duration)) {
      const ratio = Number(progress.value) / PROGRESS_MAX;
      media.currentTime = ratio * media.duration;
    }
  }

  function onMuteBtnClick() {
    if (destroyed) return;
    media.muted = !media.muted;
  }

  function onVolumeInput() {
    media.volume = Number(volumeSlider.value) / 100;
    if (media.muted && media.volume > 0) {
      media.muted = false;
    }
  }

  function isFullscreen() {
    return document.fullscreenElement === root;
  }

  function syncFullscreenIcon() {
    if (!fullscreenBtn) return;
    fullscreenIcon.innerHTML = isFullscreen() ? IconFullscreenExit : IconFullscreen;
    fullscreenBtn.setAttribute("aria-label",
      isFullscreen() ? t("mediaPlayerExitFullscreen") : t("mediaPlayerFullscreen"));
  }

  function onFullscreenBtnClick() {
    if (destroyed) return;
    if (isFullscreen()) {
      document.exitFullscreen().catch(() => {});
    } else {
      root.requestFullscreen().catch(() => {});
    }
  }

  function onFullscreenChange() {
    syncFullscreenIcon();
  }

  function onVisualizerModeClick(event) {
    const target = event.target.closest("button[data-mode]");
    if (!target || !visualizerModeGroup?.contains(target)) return;
    setVisualizerMode(target.dataset.mode);
  }

  function onVisualizerCanvasClick() {
    if (!shouldRenderVisualizer || visualizerFailed || !activeVisualizer?.isAvailable) return;
    setVisualizerMode(getNextVisualizerMode(preferredVisualizerMode));
  }

  function onVisibilityChange() {
    if (document.hidden) {
      stopVisualizerRendering();
      return;
    }
    syncVisualizerPlayback();
  }

  // Bind events
  media.addEventListener("play", onPlay);
  media.addEventListener("pause", onPause);
  media.addEventListener("ended", onEnded);
  media.addEventListener("emptied", onEmptied);
  media.addEventListener("error", onMediaError);
  media.addEventListener("loadedmetadata", onLoadedMetadata);
  media.addEventListener("timeupdate", onTimeUpdate);
  media.addEventListener("volumechange", onVolumeChange);
  playBtn.addEventListener("click", onPlayBtnClick);
  progress.addEventListener("input", onProgressInput);
  progress.addEventListener("change", onProgressChange);
  muteBtn.addEventListener("click", onMuteBtnClick);
  volumeSlider.addEventListener("input", onVolumeInput);
  visualizerModeGroup?.addEventListener("click", onVisualizerModeClick);
  audioCanvasWrap?.addEventListener("click", onVisualizerCanvasClick);
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", onFullscreenBtnClick);
    document.addEventListener("fullscreenchange", onFullscreenChange);
  }
  if (!isVideo) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  // Mount
  container.replaceChildren(root);

  if (shouldRenderVisualizer && audioCanvasMount) {
    activeVisualizer = createMiniAudioVisualizer({
      mediaElement: media,
      mount: audioCanvasMount,
      mode: preferredVisualizerMode,
    });
    if (!activeVisualizer.isAvailable) {
      visualizerFailed = true;
    }
  }
  syncVisualizerUi();

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    stopProgressLoop();

    media.removeEventListener("play", onPlay);
    media.removeEventListener("pause", onPause);
    media.removeEventListener("ended", onEnded);
    media.removeEventListener("emptied", onEmptied);
    media.removeEventListener("error", onMediaError);
    media.removeEventListener("loadedmetadata", onLoadedMetadata);
    media.removeEventListener("timeupdate", onTimeUpdate);
    media.removeEventListener("volumechange", onVolumeChange);
    playBtn.removeEventListener("click", onPlayBtnClick);
    progress.removeEventListener("input", onProgressInput);
    progress.removeEventListener("change", onProgressChange);
    muteBtn.removeEventListener("click", onMuteBtnClick);
    volumeSlider.removeEventListener("input", onVolumeInput);
    visualizerModeGroup?.removeEventListener("click", onVisualizerModeClick);
    audioCanvasWrap?.removeEventListener("click", onVisualizerCanvasClick);
    if (fullscreenBtn) {
      fullscreenBtn.removeEventListener("click", onFullscreenBtnClick);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (isFullscreen()) document.exitFullscreen().catch(() => {});
    }
    if (!isVideo) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    if (activeVisualizer) {
      activeVisualizer.destroy();
      activeVisualizer = null;
    }

    media.pause();
    media.removeAttribute("src");
    media.load();

    root.remove();
  }

  return { destroy, mediaElement: media, root };
}

export { formatTime, VISUALIZER_MODE_STORAGE_KEY };
