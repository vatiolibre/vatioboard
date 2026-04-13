/**
 * Shared audio runtime.
 *
 * Singleton-style controller for primary audio playback in the current
 * document.  Owns a long-lived HTMLAudioElement, queue state, and
 * Media Session integration.  Designed to be imported by any page that
 * needs audio playback (player, library, future speed/accel integration).
 *
 * The runtime does NOT own the UI — it exposes state and events so page-
 * specific shells can render whatever controls they need.
 *
 * Local-first: uses audio-source-resolver to prefer pinned/cached blobs,
 * falling back to remote BFF streaming URLs.
 */

import { resolveAudioSource, hasLocalSource, triggerBackgroundCache } from "./audio-source-resolver.js";
import {
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  setMediaSessionActionHandlers,
  clearMediaSession,
} from "./media-session-adapter.js";
import { setMainAudioElement } from "./audio-cue.js";
import { loadPlayerSession, savePlayerSession } from "./player-session.js";

// ── State ────────────────────────────────────────────────────────────

const listeners = new Set();

const state = {
  /** @type {object[]} Queue of track metadata objects */
  queue: [],
  /** Index into queue for the current track (-1 = none) */
  currentIndex: -1,
  /** Whether the user intends playback to be paused */
  paused: true,
  /** Volume 0-1 */
  volume: 1,
  /** Muted */
  muted: false,
  /** "off" | "all" | "one" */
  repeat: "off",
  /** Shuffle mode */
  shuffle: false,
  /** Whether background mode keepalive is desired */
  backgroundMode: false,
  /** Source type for current track: "blob" | "remote" | null */
  sourceType: null,
  /** Current track metadata (from queue) */
  currentTrack: null,
  /** Loading state */
  loading: false,
  /** Error state */
  error: null,
  /** Whether the current remote session should block auto-cache hot-swap */
  remoteSessionActive: false,
};

// ── Audio element ────────────────────────────────────────────────────

let audio = null;
let currentSourceRevoke = null;
let positionSyncTimer = null;
let sessionSaveTimer = null;

/**
 * Audio priming state — follows the speed/audio.js primeAudioElement pattern.
 *
 * On gesture-gated platforms (Tesla browser, iOS Safari, mobile Chrome)
 * each HTMLAudioElement must receive a play() call inside a user gesture
 * before it can produce audio.  We prime the **actual** playback element
 * (not a throwaway), and only set `primed = true` when play() succeeds.
 * Failure leaves `primed = false` so the next user gesture can retry.
 */
let primed = false;
let primeInFlight = null;

/**
 * Prime the actual playback audio element via a mute→play→pause cycle.
 *
 * Must be called synchronously from a user-gesture handler.
 * Mirrors speed/audio.js primeAudioElement():
 *  - success → sets primed = true
 *  - failure → leaves primed = false, next gesture can retry
 *  - safe to call repeatedly
 *
 * Returns a promise that resolves to true (primed) or false.
 */
export function primeAudio() {
  if (primed) return Promise.resolve(true);
  if (primeInFlight) return primeInFlight;

  const el = getAudio();
  if (!el.src) return Promise.resolve(false);

  const prevMuted = el.muted;
  const prevVolume = el.volume;

  el.muted = true;
  el.volume = 0;

  primeInFlight = (async () => {
    try {
      const p = el.play();
      if (p && typeof p.then === "function") await p;
      el.pause();
      el.currentTime = 0;
      primed = true;
      return true;
    } catch {
      el.pause();
      el.currentTime = 0;
      primed = false;
      return false;
    } finally {
      el.muted = prevMuted;
      el.volume = prevVolume;
      primeInFlight = null;
    }
  })();

  return primeInFlight;
}

function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "metadata";
    audio.playsInline = true;

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);

    setMainAudioElement(audio);
  }
  return audio;
}

// ── Core playback ────────────────────────────────────────────────────

/**
 * Load and play a track from the queue by index.
 *
 * @param {number} index - Queue index
 * @param {{ startTime?: number, autoplay?: boolean }} [opts]
 */
async function loadTrack(index, { startTime = 0, autoplay = true } = {}) {
  const track = state.queue[index];
  if (!track) return;

  state.currentIndex = index;
  state.currentTrack = track;
  state.loading = true;
  state.error = null;
  state.remoteSessionActive = false;
  notify();

  // Revoke previous blob URL
  if (currentSourceRevoke) {
    currentSourceRevoke();
    currentSourceRevoke = null;
  }

  const el = getAudio();

  const resolved = await resolveAudioSource(track.name, track);
  if (state.currentIndex !== index) return; // selection changed during resolve

  if (!resolved) {
    state.loading = false;
    state.error = "unavailable";
    state.sourceType = null;
    notify();
    return;
  }

  state.sourceType = resolved.type;
  currentSourceRevoke = resolved.revokeUrl;

  el.src = resolved.src;
  el.volume = state.muted ? 0 : state.volume;
  el.muted = state.muted;

  if (startTime > 0) {
    el.currentTime = startTime;
  }

  state.loading = false;
  notify();

  updateMediaSessionMetadata();

  if (!state.paused) {
    await primeAudio();
    el.play().catch((err) => {
      if (err?.name !== "AbortError") {
        state.error = "playback-failed";
        notify();
      }
    });
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Set the queue and optionally start playback.
 *
 * @param {object[]} tracks - Array of asset metadata objects
 * @param {{ startIndex?: number, autoplay?: boolean }} [opts]
 */
export function setQueue(tracks, { startIndex = 0, autoplay = true } = {}) {
  state.queue = [...tracks];
  state.paused = !autoplay;
  persistSession();
  if (tracks.length > 0) {
    loadTrack(Math.min(startIndex, tracks.length - 1), { autoplay });
  } else {
    stopPlayback();
  }
}

/**
 * Add tracks to the end of the queue.
 * @param {object[]} tracks
 */
export function enqueue(tracks) {
  state.queue.push(...tracks);
  persistSession();
  notify();
}

/**
 * Play (resume or start from current track).
 *
 * Primes the audio element on first call (speed/audio.js pattern),
 * then resolves any deferred track load before starting playback.
 */
export async function play() {
  state.paused = false;

  const el = getAudio();
  if (el.src) {
    await primeAudio();
    el.play().catch((err) => {
      if (err?.name !== "AbortError") {
        state.error = "playback-failed";
        notify();
      }
    });
  } else if (state.queue.length > 0) {
    const idx = state.currentIndex >= 0 ? state.currentIndex : 0;
    await loadTrack(idx, { autoplay: true });
  }
}

/**
 * Pause playback.
 */
export function pause() {
  state.paused = true;
  getAudio().pause();
}

/**
 * Stop playback and reset position.
 */
export function stopPlayback() {
  state.paused = true;
  state.currentIndex = -1;
  state.currentTrack = null;
  state.sourceType = null;
  state.loading = false;
  state.error = null;
  state.remoteSessionActive = false;

  const el = getAudio();
  el.pause();
  el.src = "";
  el.load();

  if (currentSourceRevoke) {
    currentSourceRevoke();
    currentSourceRevoke = null;
  }

  clearMediaSession();
  persistSession();
  notify();
}

/**
 * Skip to next track.
 */
export async function nextTrack() {
  if (state.queue.length === 0) return;

  let next;
  if (state.shuffle) {
    next = Math.floor(Math.random() * state.queue.length);
  } else {
    next = state.currentIndex + 1;
    if (next >= state.queue.length) {
      if (state.repeat === "all") {
        next = 0;
      } else {
        stopPlayback();
        return;
      }
    }
  }

  state.paused = false;
  await loadTrack(next, { autoplay: true });
}

/**
 * Skip to previous track (or restart current if > 3s in).
 */
export async function previousTrack() {
  if (state.queue.length === 0) return;
  const el = getAudio();

  if (el.currentTime > 3) {
    el.currentTime = 0;
    notify();
    return;
  }

  let prev = state.currentIndex - 1;
  if (prev < 0) {
    if (state.repeat === "all") {
      prev = state.queue.length - 1;
    } else {
      el.currentTime = 0;
      notify();
      return;
    }
  }

  state.paused = false;
  await loadTrack(prev, { autoplay: true });
}

/**
 * Seek to a position in seconds.
 * @param {number} time
 */
export function seekTo(time) {
  const el = getAudio();
  if (Number.isFinite(time) && Number.isFinite(el.duration)) {
    el.currentTime = Math.max(0, Math.min(time, el.duration));
    syncPositionState();
    notify();
  }
}

/**
 * Seek forward by delta seconds (default 10).
 * @param {number} [delta]
 */
export function seekForward(delta = 10) {
  seekTo(getAudio().currentTime + delta);
}

/**
 * Seek backward by delta seconds (default 10).
 * @param {number} [delta]
 */
export function seekBackward(delta = 10) {
  seekTo(getAudio().currentTime - delta);
}

/**
 * Set volume (0-1).
 * @param {number} v
 */
export function setVolume(v) {
  state.volume = Math.max(0, Math.min(1, v));
  const el = getAudio();
  if (!state.muted) el.volume = state.volume;
  persistSession();
  notify();
}

/**
 * Toggle or set mute state.
 * @param {boolean} [muted]
 */
export function setMuted(muted) {
  state.muted = muted ?? !state.muted;
  const el = getAudio();
  el.muted = state.muted;
  if (!state.muted) el.volume = state.volume;
  persistSession();
  notify();
}

/**
 * Cycle repeat mode: off → all → one → off.
 */
export function cycleRepeat() {
  const modes = ["off", "all", "one"];
  const idx = modes.indexOf(state.repeat);
  state.repeat = modes[(idx + 1) % modes.length];
  persistSession();
  notify();
}

/**
 * Toggle shuffle.
 */
export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  persistSession();
  notify();
}

/**
 * Toggle background mode.
 */
export function setBackgroundMode(enabled) {
  state.backgroundMode = enabled;
  persistSession();
  notify();
}

/**
 * Play a specific track from the queue by asset name.
 * @param {string} name
 */
export async function playTrackByName(name) {
  const idx = state.queue.findIndex((t) => t.name === name);
  if (idx >= 0) {
    state.paused = false;
    await loadTrack(idx, { autoplay: true });
  }
}

/**
 * Play a track by name, setting the queue from the provided catalog
 * if the track is not already in the current queue.
 *
 * @param {string} name - Asset name to play
 * @param {object[]} catalogTracks - Full catalog to use as queue fallback
 */
export async function playCatalogTrack(name, catalogTracks) {
  // Try current queue first
  const idx = state.queue.findIndex((t) => t.name === name);
  if (idx >= 0) {
    state.paused = false;
    await loadTrack(idx, { autoplay: true });
    return;
  }

  // Track not in queue — set the full catalog as queue and start the track
  if (Array.isArray(catalogTracks) && catalogTracks.length > 0) {
    const catalogIdx = catalogTracks.findIndex((t) => t.name === name);
    if (catalogIdx >= 0) {
      setQueue(catalogTracks, { startIndex: catalogIdx, autoplay: true });
      return;
    }
  }
}

/**
 * Get a readonly snapshot of the runtime state.
 */
export function getState() {
  const el = audio;
  return {
    queue: state.queue,
    currentIndex: state.currentIndex,
    currentTrack: state.currentTrack,
    paused: state.paused,
    volume: state.volume,
    muted: state.muted,
    repeat: state.repeat,
    shuffle: state.shuffle,
    backgroundMode: state.backgroundMode,
    sourceType: state.sourceType,
    loading: state.loading,
    error: state.error,
    currentTime: el?.currentTime || 0,
    duration: el?.duration || 0,
    playing: el ? !el.paused && !el.ended : false,
  };
}

/**
 * Get the underlying HTMLAudioElement (for external transport binding).
 * @returns {HTMLAudioElement|null}
 */
export function getAudioElement() {
  return audio;
}

/**
 * Subscribe to state changes.
 * @param {Function} listener - Called with the state snapshot
 * @returns {Function} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Restore a previously persisted session.
 * Call once on page boot after the audio catalog has loaded.
 *
 * @param {object[]} availableTracks - Full catalog of available tracks
 * @param {{ autoplay?: boolean }} [opts]
 */
export async function restoreSession(availableTracks, { autoplay = false } = {}) {
  const session = loadPlayerSession();

  state.volume = session.volume;
  state.muted = session.muted;
  state.repeat = session.repeat;
  state.shuffle = session.shuffle;
  state.backgroundMode = session.backgroundMode;

  // Rebuild queue from persisted names, filtering out tracks no longer available
  const trackMap = new Map(availableTracks.map((t) => [t.name, t]));
  const restoredQueue = session.queue
    .map((name) => trackMap.get(name))
    .filter(Boolean);

  if (restoredQueue.length === 0) {
    notify();
    return;
  }

  state.queue = restoredQueue;

  const currentTrack = trackMap.get(session.currentTrackName);
  const startIndex = currentTrack
    ? restoredQueue.findIndex((t) => t.name === currentTrack.name)
    : 0;

  if (startIndex >= 0) {
    state.paused = !autoplay;
    await loadTrack(startIndex, {
      startTime: session.currentTime || 0,
      autoplay,
    });
  }
}

// ── Event handlers ───────────────────────────────────────────────────

function onPlay() {
  state.paused = false;

  // Track remote session for no-hot-swap guard
  if (state.sourceType === "remote" && !state.remoteSessionActive) {
    state.remoteSessionActive = true;
    // Trigger background cache non-blockingly
    if (state.currentTrack) {
      triggerBackgroundCache(state.currentTrack.name, state.currentTrack);
    }
  }

  setMediaSessionPlaybackState("playing");
  startPositionSync();
  persistSession();
  notify();
}

function onPause() {
  // Only mark paused if not a temporary interruption (e.g. seeking)
  setMediaSessionPlaybackState("paused");
  stopPositionSync();
  persistSession();
  notify();
}

function onEnded() {
  state.remoteSessionActive = false;

  if (state.repeat === "one") {
    const el = getAudio();
    el.currentTime = 0;
    el.play().catch(() => {});
    return;
  }

  nextTrack();
}

function onTimeUpdate() {
  syncPositionState();
  notify();
}

function onLoadedMetadata() {
  syncPositionState();
  notify();
}

function onError() {
  state.error = "playback-error";
  state.loading = false;
  notify();
}

function onWaiting() {
  state.loading = true;
  notify();
}

function onPlaying() {
  state.loading = false;
  notify();
}

// ── Media Session ────────────────────────────────────────────────────

function updateMediaSessionMetadata() {
  const track = state.currentTrack;
  if (!track) return;

  setMediaSessionMetadata({
    title: track.title || track.original_filename || track.name || "",
    artist: track.folder_path || "",
    album: "VatioBoard",
    artworkUrl: track.preview_image_url || track.image_url || "",
  });

  setMediaSessionActionHandlers({
    play,
    pause,
    stop: stopPlayback,
    previoustrack: previousTrack,
    nexttrack: nextTrack,
    seekbackward: (details) => seekBackward(details?.seekOffset || 10),
    seekforward: (details) => seekForward(details?.seekOffset || 10),
    seekto: (details) => { if (details?.seekTime != null) seekTo(details.seekTime); },
  });
}

function syncPositionState() {
  const el = audio;
  if (!el) return;
  setMediaSessionPositionState({
    duration: el.duration || 0,
    position: el.currentTime || 0,
    playbackRate: el.playbackRate || 1,
  });
}

function startPositionSync() {
  stopPositionSync();
  positionSyncTimer = setInterval(() => {
    syncPositionState();
  }, 1000);
}

function stopPositionSync() {
  if (positionSyncTimer) {
    clearInterval(positionSyncTimer);
    positionSyncTimer = null;
  }
}

// ── Persistence ──────────────────────────────────────────────────────

function persistSession() {
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    savePlayerSession({
      queue: state.queue.map((t) => t.name),
      currentTrackName: state.currentTrack?.name || "",
      currentTime: audio?.currentTime || 0,
      paused: state.paused,
      volume: state.volume,
      muted: state.muted,
      repeat: state.repeat,
      shuffle: state.shuffle,
      backgroundMode: state.backgroundMode,
    });
    sessionSaveTimer = null;
  }, 500);
}

// ── Notify ───────────────────────────────────────────────────────────

function notify() {
  const snapshot = getState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}
