import { IconFullscreen, IconFullscreenExit, IconMuted, IconPause, IconPlay, IconVolume } from "../icons.js";
import { t } from "../i18n.js";

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
  let firstPlayFired = false;

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

  if (isVideo) {
    media.playsInline = true;
    media.controls = false;
    if (posterUrl) media.poster = posterUrl;
    stage.append(media);
  } else {
    // Audio: show a type-aware stage with icon
    const audioVisual = document.createElement("div");
    audioVisual.className = "media-player-audio-visual";
    const iconEl = document.createElement("span");
    iconEl.className = "media-player-audio-icon";
    iconEl.innerHTML = IconVolume;
    audioVisual.append(iconEl);
    const kindLabel = document.createElement("span");
    kindLabel.className = "media-player-audio-label";
    kindLabel.textContent = title || t("mediaPlayerAudio");
    audioVisual.append(kindLabel);
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
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    syncProgress();
    syncTimeDisplay();
  }

  function onEnded() {
    playing = false;
    syncPlayIcon();
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    syncProgress();
    syncTimeDisplay();
  }

  function onLoadedMetadata() {
    syncTimeDisplay();
    syncProgress();
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
      if (activeVisualizer) {
        activeVisualizer.resume().catch(() => {});
      }
      media.play().catch((err) => {
        if (err?.name === "AbortError") return;
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

  // Bind events
  media.addEventListener("play", onPlay);
  media.addEventListener("pause", onPause);
  media.addEventListener("ended", onEnded);
  media.addEventListener("loadedmetadata", onLoadedMetadata);
  media.addEventListener("timeupdate", onTimeUpdate);
  media.addEventListener("volumechange", onVolumeChange);
  playBtn.addEventListener("click", onPlayBtnClick);
  progress.addEventListener("input", onProgressInput);
  progress.addEventListener("change", onProgressChange);
  muteBtn.addEventListener("click", onMuteBtnClick);
  volumeSlider.addEventListener("input", onVolumeInput);
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", onFullscreenBtnClick);
    document.addEventListener("fullscreenchange", onFullscreenChange);
  }

  // Mount
  container.replaceChildren(root);

  // Lazy-load audio visualizer when enabled (audio only).
  // The visualizer is a progressive enhancement — it never gates or
  // reroutes the native audio playback path unless explicitly activated
  // via resume(). The caller is responsible for only enabling the
  // visualizer when the source is safe for Web Audio routing (blob:/same-origin).
  let activeVisualizer = null;
  let visualizerLoadPromise = null;
  if (enableVisualizer && !isVideo) {
    visualizerLoadPromise = import("./audio-visualizer.js").then(({ createAudioVisualizer }) =>
      createAudioVisualizer({ stage, audioElement: media })
    ).then((viz) => {
      if (destroyed) {
        viz?.destroy();
        return;
      }
      activeVisualizer = viz;
      if (playing && activeVisualizer) {
        activeVisualizer.resume().catch(() => {});
      }
    }).catch(() => {});
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    media.removeEventListener("play", onPlay);
    media.removeEventListener("pause", onPause);
    media.removeEventListener("ended", onEnded);
    media.removeEventListener("loadedmetadata", onLoadedMetadata);
    media.removeEventListener("timeupdate", onTimeUpdate);
    media.removeEventListener("volumechange", onVolumeChange);
    playBtn.removeEventListener("click", onPlayBtnClick);
    progress.removeEventListener("input", onProgressInput);
    progress.removeEventListener("change", onProgressChange);
    muteBtn.removeEventListener("click", onMuteBtnClick);
    volumeSlider.removeEventListener("input", onVolumeInput);
    if (fullscreenBtn) {
      fullscreenBtn.removeEventListener("click", onFullscreenBtnClick);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (isFullscreen()) document.exitFullscreen().catch(() => {});
    }

    if (activeVisualizer) {
      activeVisualizer.destroy();
      activeVisualizer = null;
    }

    // Ensure any in-flight visualizer load is cleaned up, not leaked
    if (visualizerLoadPromise) {
      visualizerLoadPromise.then(() => {
        if (activeVisualizer) {
          activeVisualizer.destroy();
          activeVisualizer = null;
        }
      }).catch(() => {});
      visualizerLoadPromise = null;
    }

    media.pause();
    media.removeAttribute("src");
    media.load();

    root.remove();
  }

  return { destroy, mediaElement: media, root };
}

export { formatTime };
