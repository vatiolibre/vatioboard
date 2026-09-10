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

import { resolveAudioSource, triggerBackgroundCache } from "./audio-source-resolver.js";
import {
  clearMediaSessionClient,
  updateMediaSessionClient,
} from "./media-session-adapter.js";
import {
  primeAudioElement as primeManagedAudioElement,
  resetAudioElementPlaybackRate,
} from "./audio-channel-retainer.js";
import {
  acquireBackgroundAudioLease,
  getBackgroundKeepAliveAudio,
  isBackgroundAudioLeaseActive,
  releaseBackgroundAudioLease,
} from "./audio-system.js";
import { setMainAudioElement } from "./audio-cue.js";
import {
  destroyVisualizerGraphForElement,
  resumeVisualizerGraphForElement,
} from "./audio-mini-visualizer.js";
import { loadPlayerSession, savePlayerSession } from "./player-session.js";
import { getRadioLogoUrl, radioBrowser, radioStationToTrack } from "./radio-browser.js";
import type { AudioRuntimeState } from "../types/services";

// TODO(ts-migration): player/library track payloads are still owned by JS feature modules.
type RuntimeTrack = Record<string, any>;
type ManagedAudioElement = HTMLAudioElement & { playsInline?: boolean };
type ResolvedAudioSource = {
  src: string;
  sourceType?: "blob" | "remote" | "live";
  sourceTransport?: "local" | "backend" | "radio-direct-cors" | "radio-relay";
  isLive?: boolean;
  type: "blob" | "remote" | "live";
  transport: "local" | "backend" | "radio-direct-cors" | "radio-relay";
  live: boolean;
  cacheable: boolean;
  seekable: boolean;
  analysisEligible: boolean;
  fallbackSrc?: string;
  stationUuid?: string;
  blob?: Blob;
  source?: string;
  contentHash?: string;
  revokeUrl?: () => void;
};
type PreparedNextSource = {
  index: number;
  queueId: string;
  resolved: ResolvedAudioSource;
  preparedAt: number;
};
type PrepareNextPromise = {
  key: string;
  promise: Promise<PreparedNextSource | null>;
};
type AudioRuntimeMutableState = Omit<AudioRuntimeState, "queue" | "playedHistory" | "currentTrack" | "error"> & {
  queue: RuntimeTrack[];
  playedHistory: RuntimeTrack[];
  currentIndex: number;
  currentTrack: RuntimeTrack | null;
  error: unknown;
};

const resolveRuntimeAudioSource = resolveAudioSource as (
  assetName: string,
  asset?: RuntimeTrack,
) => Promise<ResolvedAudioSource | null>;
const savePlayerSessionSnapshot = savePlayerSession as (snapshot: RuntimeTrack) => void;

function isArtworkUrl(ref) {
  return typeof ref === "string" && (ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("/"));
}

// ── State ────────────────────────────────────────────────────────────

let mediaSessionEnabled = true;
const PLAYER_MEDIA_SESSION_OWNER = "player-runtime";
const PLAYER_MEDIA_SESSION_PRIORITY = 10;
const PLAYER_BACKGROUND_AUDIO_LEASE = "player-runtime";

/**
 * Enable or disable Media Session management by this runtime.
 * Useful when another controller (e.g. speed audio) owns Media Session.
 * When disabling, immediately clears any existing Media Session state.
 */
export function setMediaSessionEnabled(enabled) {
  mediaSessionEnabled = enabled;
  if (!enabled) {
    clearMediaSessionClient(PLAYER_MEDIA_SESSION_OWNER);
    return;
  }

  updateMediaSessionMetadata();
  syncMediaSessionPlaybackState();
  syncPositionState();
}

const listeners = new Set<(state: AudioRuntimeState) => void>();

const state: AudioRuntimeMutableState = {
  /** @type {object[]} Queue of track metadata objects */
  queue: [],
  /** Stack of consumed tracks that can be restored by Previous */
  playedHistory: [],
  /** Index into queue for the current track (-1 = none) */
  currentIndex: -1,
  /** Whether the user intends playback to be paused */
  paused: true,
  /** Volume 0-1 */
  volume: 0.88,
  /** Muted */
  muted: false,
  /** "off" | "all" | "one" */
  repeat: "off",
  /** Shuffle mode */
  shuffle: false,
  /** Internal background audio keepalive policy, enabled after playback starts */
  backgroundMode: false,
  /** Source type for current track: "blob" | "remote" | null */
  sourceType: null,
  sourceTransport: null,
  isLive: false,
  seekable: true,
  cacheable: false,
  analysisEligible: false,
  connectionState: "idle",
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

let audio: ManagedAudioElement | null = null;
let currentSourceRevoke: (() => void) | null = null;
let positionSyncTimer: ReturnType<typeof setInterval> | null = null;
let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let loadRequestToken = 0;
let lastPersistedPlaybackSecond = -1;
let lifecycleBound = false;
let pendingSeek: RuntimeTrack | null = null;
let activeResolvedSource: ResolvedAudioSource | null = null;
let radioConnectionTimer: ReturnType<typeof setTimeout> | null = null;
let radioReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let radioStableTimer: ReturnType<typeof setTimeout> | null = null;
let radioFallbackUsed = false;
let radioHadPlayed = false;
let radioRetryCount = 0;
let pendingRadioClickUuid = "";
let pendingRadioClickQueueId = "";
const radioTransportCache = new Map<string, {
  resolvedUrl: string;
  mode: "radio-direct-cors" | "radio-relay";
  expiresAt: number;
}>();

const RADIO_CONNECT_TIMEOUT_MS = 12_000;
const RADIO_RETRY_DELAY_MS = 5_000;
const RADIO_STABLE_RESET_MS = 30_000;
const RADIO_TRANSPORT_CACHE_MS = 6 * 60 * 60 * 1000;

const PREPARE_MIN_LEAD_SECONDS = 8;
const PREPARE_MAX_LEAD_SECONDS = 24;
const PREPARE_LEAD_RATIO = 0.15;
const PREPARED_SOURCE_MAX_AGE_MS = 90_000;
const PLAYED_HISTORY_LIMIT = 50;

let preparedNext: PreparedNextSource | null = null;
let prepareNextPromise: PrepareNextPromise | null = null;
let prepareNextGeneration = 0;
let queueEntrySeed = 0;
let libraryContinuation: RuntimeTrack | null = null;

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
let primeInFlight: Promise<boolean> | null = null;
let backgroundKeepAliveGeneration = 0;
let backgroundKeepAliveArmPending = false;

const backgroundKeepAliveAudio = getBackgroundKeepAliveAudio();

function bindAudioElement(el: ManagedAudioElement) {
  el.addEventListener("play", onPlay);
  el.addEventListener("pause", onPause);
  el.addEventListener("ended", onEnded);
  el.addEventListener("timeupdate", onTimeUpdate);
  el.addEventListener("loadedmetadata", onLoadedMetadata);
  el.addEventListener("canplay", onCanPlay);
  el.addEventListener("error", onError);
  el.addEventListener("waiting", onWaiting);
  el.addEventListener("playing", onPlaying);
}

function unbindAudioElement(el: ManagedAudioElement) {
  el.removeEventListener("play", onPlay);
  el.removeEventListener("pause", onPause);
  el.removeEventListener("ended", onEnded);
  el.removeEventListener("timeupdate", onTimeUpdate);
  el.removeEventListener("loadedmetadata", onLoadedMetadata);
  el.removeEventListener("canplay", onCanPlay);
  el.removeEventListener("error", onError);
  el.removeEventListener("waiting", onWaiting);
  el.removeEventListener("playing", onPlaying);
}

function createManagedAudioElement() {
  bindLifecyclePersistence();
  const el = new Audio() as ManagedAudioElement;
  resetAudioElementPlaybackRate(el);
  el.preload = "metadata";
  el.playsInline = true;
  // Set crossOrigin early so iOS Safari includes the Origin header on the
  // very first network request.  Without this, createMediaElementSource()
  // produces a tainted node and the mini-visualizer cannot read frequency
  // data.  The attribute is harmless for blob:/same-origin sources.
  el.crossOrigin = "anonymous";
  el.volume = state.muted ? 0 : state.volume;
  el.muted = state.muted;
  bindAudioElement(el);
  setMainAudioElement(el);
  return el;
}

function clearAudioElementSource(el: ManagedAudioElement | null) {
  if (!el) return;

  try { el.pause(); } catch { /* ignore */ }

  if ("srcObject" in el) {
    try { el.srcObject = null; } catch { /* ignore */ }
  }

  if (typeof el.removeAttribute === "function") {
    try { el.removeAttribute("src"); } catch { /* ignore */ }
  } else {
    try { el.src = ""; } catch { /* ignore */ }
  }

  try { el.load(); } catch { /* ignore */ }
}

function replaceManagedAudioElement() {
  if (audio) {
    unbindAudioElement(audio);
    clearAudioElementSource(audio);
  }

  primed = false;
  primeInFlight = null;
  audio = createManagedAudioElement();
  return audio;
}

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
  resetAudioElementPlaybackRate(el);
  if (!el.src) return Promise.resolve(false);

  primeInFlight = (async () => {
    try {
      await resumeVisualizerGraphForElement(el);
      const audioPrimed = await primeManagedAudioElement(el, {
        getResumeTime: () => getCurrentPlaybackTime(),
        beforePlay: () => applyPendingSeek(),
        restorePlayback: (audioElement, resumeTime) => {
          restorePlaybackTimeAfterPrime(audioElement, resumeTime);
        },
      });
      primed = audioPrimed;
      return audioPrimed;
    } finally {
      primeInFlight = null;
    }
  })();

  return primeInFlight;
}

function getAudio() {
  if (!audio) {
    audio = createManagedAudioElement();
  }
  return audio;
}

function enableBackgroundModeForPlaybackStart() {
  if (state.backgroundMode) return false;
  state.backgroundMode = true;
  return true;
}

function wantsBackgroundModeKeepAlive() {
  return state.backgroundMode && !state.paused && (state.loading || state.currentTrack !== null);
}

function isBackgroundModeKeepAliveStale(generation) {
  return generation !== backgroundKeepAliveGeneration || !wantsBackgroundModeKeepAlive();
}

function getDesiredPlaybackState() {
  if (isBackgroundAudioLeaseActive(PLAYER_BACKGROUND_AUDIO_LEASE)) return "playing";

  if (backgroundKeepAliveArmPending && wantsBackgroundModeKeepAlive()) {
    return "playing";
  }

  const el = audio;
  if (el && !el.paused && !el.ended) {
    return "playing";
  }

  if (state.currentTrack || state.loading) {
    return "paused";
  }

  return "none";
}

function syncMediaSessionPlaybackState() {
  if (!mediaSessionEnabled) return;
  const playbackState = getDesiredPlaybackState();
  updateMediaSessionClient(PLAYER_MEDIA_SESSION_OWNER, {
    active: playbackState !== "none",
    priority: PLAYER_MEDIA_SESSION_PRIORITY,
    playbackState,
  });
}

function stopBackgroundModeKeepAlive() {
  backgroundKeepAliveGeneration += 1;
  backgroundKeepAliveArmPending = false;
  releaseBackgroundAudioLease(PLAYER_BACKGROUND_AUDIO_LEASE);
  syncMediaSessionPlaybackState();
}

async function armBackgroundModeKeepAlive() {
  if (!wantsBackgroundModeKeepAlive()) {
    stopBackgroundModeKeepAlive();
    return false;
  }

  if (isBackgroundAudioLeaseActive(PLAYER_BACKGROUND_AUDIO_LEASE)) {
    syncMediaSessionPlaybackState();
    return true;
  }

  if (backgroundKeepAliveArmPending) {
    syncMediaSessionPlaybackState();
    return false;
  }

  const generation = backgroundKeepAliveGeneration;
  backgroundKeepAliveArmPending = true;

  try {
    const armed = await acquireBackgroundAudioLease(PLAYER_BACKGROUND_AUDIO_LEASE, {
      shouldContinue: () => !isBackgroundModeKeepAliveStale(generation),
    });

    if (!armed && !isBackgroundModeKeepAliveStale(generation)) {
      releaseBackgroundAudioLease(PLAYER_BACKGROUND_AUDIO_LEASE);
    }

    return armed;
  } catch {
    if (!isBackgroundModeKeepAliveStale(generation)) {
      releaseBackgroundAudioLease(PLAYER_BACKGROUND_AUDIO_LEASE);
    }
    return false;
  } finally {
    backgroundKeepAliveArmPending = false;
    syncMediaSessionPlaybackState();
  }
}

function syncBackgroundModeKeepAlive() {
  if (wantsBackgroundModeKeepAlive()) {
    void armBackgroundModeKeepAlive();
    return;
  }

  stopBackgroundModeKeepAlive();
}

backgroundKeepAliveAudio.addEventListener("play", syncMediaSessionPlaybackState);
backgroundKeepAliveAudio.addEventListener("pause", syncMediaSessionPlaybackState);

function shouldResetVisualizerGraph(previousSourceType, nextResolved) {
  return previousSourceType === "blob" && nextResolved?.type === "remote";
}

function clearRadioTimers() {
  if (radioConnectionTimer) clearTimeout(radioConnectionTimer);
  if (radioReconnectTimer) clearTimeout(radioReconnectTimer);
  if (radioStableTimer) clearTimeout(radioStableTimer);
  radioConnectionTimer = null;
  radioReconnectTimer = null;
  radioStableTimer = null;
}

function resetRadioLifecycle() {
  clearRadioTimers();
  activeResolvedSource = null;
  radioFallbackUsed = false;
  radioHadPlayed = false;
  radioRetryCount = 0;
}

function isCurrentRadioToken(token) {
  return token === loadRequestToken && state.isLive && Boolean(state.currentTrack?.station_uuid);
}

function startRadioConnectionTimeout(token) {
  if (!isCurrentRadioToken(token)) return;
  if (radioConnectionTimer) clearTimeout(radioConnectionTimer);
  radioConnectionTimer = setTimeout(() => {
    if (!isCurrentRadioToken(token) || state.connectionState === "playing") return;
    handleRadioConnectionFailure(token);
  }, RADIO_CONNECT_TIMEOUT_MS);
}

function playCurrentRadioElement(token) {
  if (!isCurrentRadioToken(token)) return;
  const el = getAudio();
  state.loading = true;
  state.connectionState = radioRetryCount > 0 ? "reconnecting" : "connecting";
  notify();
  startRadioConnectionTimeout(token);
  void resumeVisualizerGraphForElement(el).then(() => {
    if (!isCurrentRadioToken(token) || state.paused) return;
    return el.play();
  }).catch(() => {
    if (isCurrentRadioToken(token)) handleRadioConnectionFailure(token);
  });
}

function switchRadioToRelay(token) {
  const resolved = activeResolvedSource;
  if (!isCurrentRadioToken(token) || !resolved?.fallbackSrc || radioFallbackUsed) return false;
  const resolvedUrl = resolved.src;
  radioFallbackUsed = true;
  state.sourceTransport = "radio-relay";
  resolved.src = resolved.fallbackSrc;
  resolved.transport = "radio-relay";
  resolved.sourceTransport = "radio-relay";
  const uuid = resolved.stationUuid || state.currentTrack?.station_uuid || "";
  if (uuid) {
    radioTransportCache.set(uuid, {
      resolvedUrl,
      mode: "radio-relay",
      expiresAt: Date.now() + RADIO_TRANSPORT_CACHE_MS,
    });
  }
  const el = getAudio();
  el.crossOrigin = "anonymous";
  el.src = resolved.fallbackSrc;
  resetAudioElementPlaybackRate(el);
  playCurrentRadioElement(token);
  return true;
}

function markRadioUnavailable(error = "station-unavailable") {
  clearRadioTimers();
  state.loading = false;
  state.paused = true;
  state.connectionState = "unavailable";
  state.error = error;
  try { getAudio().pause(); } catch { /* ignore */ }
  flushSessionPersistence({ currentTime: 0 });
  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();
  notify();
}

function handleRadioConnectionFailure(token = loadRequestToken) {
  if (!isCurrentRadioToken(token) || state.paused) return;
  if (!radioHadPlayed && state.sourceTransport === "radio-direct-cors" && switchRadioToRelay(token)) return;

  clearRadioTimers();
  if (!radioHadPlayed) {
    markRadioUnavailable(state.sourceTransport === "radio-relay" ? "radio-relay-failed" : "station-unavailable");
    return;
  }

  if (radioRetryCount >= 2) {
    markRadioUnavailable();
    return;
  }

  radioRetryCount += 1;
  state.connectionState = "reconnecting";
  state.loading = true;
  state.error = null;
  notify();
  const retry = () => {
    if (!isCurrentRadioToken(token) || state.paused || !activeResolvedSource) return;
    const el = getAudio();
    el.crossOrigin = "anonymous";
    el.src = activeResolvedSource.src;
    resetAudioElementPlaybackRate(el);
    playCurrentRadioElement(token);
  };
  if (radioRetryCount === 1) retry();
  else radioReconnectTimer = setTimeout(retry, RADIO_RETRY_DELAY_MS);
}

function nextQueueEntryId() {
  queueEntrySeed += 1;
  return `queue_${Date.now().toString(36)}_${queueEntrySeed.toString(36)}`;
}

function ensureQueueEntry(track, entryId = "") {
  if (!track || typeof track !== "object") return null;
  const queueId = entryId || track._queueId || nextQueueEntryId();
  return {
    ...track,
    _queueId: queueId,
  };
}

function prepareQueueEntries(tracks, entryIds = []) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((track, index) => ensureQueueEntry(track, entryIds[index])).filter(Boolean);
}

function cloneContinuationTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .filter((track) => track && typeof track === "object" && track.name)
    .map((track) => ({ ...track }));
}

function clearLibraryContinuation() {
  libraryContinuation = null;
}

function setLibraryContinuation(tracks, currentTrackName = "") {
  const preparedTracks = cloneContinuationTracks(tracks);
  if (preparedTracks.length === 0) {
    clearLibraryContinuation();
    return false;
  }

  const currentName = String(currentTrackName || "");
  if (currentName && !preparedTracks.some((track) => track.name === currentName)) {
    clearLibraryContinuation();
    return false;
  }

  libraryContinuation = {
    tracks: preparedTracks,
    lastTrackName: currentName,
    shuffleCycle: currentName ? [currentName] : [],
  };
  return true;
}

function rememberLibraryContinuationTrack(trackName) {
  if (!libraryContinuation?.tracks?.length || !trackName) return;
  if (!libraryContinuation.tracks.some((track) => track.name === trackName)) return;

  libraryContinuation.lastTrackName = trackName;
  if (!libraryContinuation.shuffleCycle.includes(trackName)) {
    libraryContinuation.shuffleCycle.push(trackName);
  }
}

function getNextLibraryContinuationTrack() {
  const context = libraryContinuation;
  if (!context?.tracks?.length) return null;

  if (state.shuffle) {
    let available = context.tracks.filter((track) => !context.shuffleCycle.includes(track.name));
    if (available.length === 0) {
      if (state.repeat !== "all") return null;

      context.shuffleCycle = context.lastTrackName ? [context.lastTrackName] : [];
      available = context.tracks.filter((track) => !context.shuffleCycle.includes(track.name));

      // Single-track libraries should still be able to loop when repeat-all is active.
      if (available.length === 0) {
        available = context.tracks.slice();
      }
    }

    const nextTrack = available[Math.floor(Math.random() * available.length)];
    if (!nextTrack) return null;
    rememberLibraryContinuationTrack(nextTrack.name);
    return { ...nextTrack };
  }

  const currentIndex = context.lastTrackName
    ? context.tracks.findIndex((track) => track.name === context.lastTrackName)
    : -1;
  let nextIndex = currentIndex + 1;
  if (nextIndex >= context.tracks.length) {
    if (state.repeat !== "all") return null;
    nextIndex = 0;
  }

  const nextTrack = context.tracks[nextIndex];
  if (!nextTrack) return null;
  rememberLibraryContinuationTrack(nextTrack.name);
  return { ...nextTrack };
}

function findQueueIndex(ref) {
  if (!ref) return -1;
  const byQueueId = state.queue.findIndex((track) => track?._queueId === ref);
  if (byQueueId >= 0) return byQueueId;
  return state.queue.findIndex((track) => track?.name === ref);
}

function serializeQueueEntry(track) {
  if (!track) return null;
  return {
    entryId: track._queueId || nextQueueEntryId(),
    name: track.name || "",
    title: track.title || "",
    artist: track.artist || "",
    album: track.album || "",
    genre: track.genre || "",
    duration: Number.isFinite(track.duration) ? track.duration : null,
    artwork_ref: track.artwork_ref || "",
    media_kind: track.media_kind || "audio",
    original_filename: track.original_filename || "",
    content_hash: track.content_hash || "",
    mime_type: track.mime_type || "",
    blob_size: Number.isFinite(track.blob_size) ? track.blob_size : 0,
    file_extension: track.file_extension || "",
    folder_path: track.folder_path || "",
    src: isStablePersistedSrc(track.src) ? track.src : "",
    station_uuid: track.media_kind === "radio" ? track.station_uuid || "" : "",
    countrycode: track.media_kind === "radio" ? track.countrycode || "" : "",
    language: track.media_kind === "radio" ? track.language || "" : "",
    codec: track.media_kind === "radio" ? track.codec || "" : "",
    bitrate: track.media_kind === "radio" && Number.isFinite(track.bitrate) ? track.bitrate : null,
    hls: track.media_kind === "radio" && Number(track.hls) === 1 ? 1 : 0,
  };
}

function isStablePersistedSrc(src) {
  return typeof src === "string"
    && src.length > 0
    && !src.startsWith("blob:")
    && !src.startsWith("data:")
    && !/^https?:\/\//i.test(src);
}

function buildRestoredQueueEntry(snapshot, availableTrack) {
  if (!snapshot?.name) return null;
  const stationUuid = availableTrack?.station_uuid || snapshot.station_uuid || "";
  return ensureQueueEntry({
    ...snapshot,
    ...availableTrack,
    title: availableTrack?.title || snapshot.title || snapshot.original_filename || snapshot.name,
    artist: availableTrack?.artist || snapshot.artist || "",
    album: availableTrack?.album || snapshot.album || "",
    genre: availableTrack?.genre || snapshot.genre || "",
    duration: availableTrack?.duration ?? snapshot.duration ?? null,
    artwork_ref: availableTrack?.artwork_ref
      || snapshot.artwork_ref
      || (snapshot.media_kind === "radio" ? getRadioLogoUrl(stationUuid) : ""),
    media_kind: availableTrack?.media_kind || snapshot.media_kind || "audio",
    original_filename: availableTrack?.original_filename || snapshot.original_filename || "",
    content_hash: availableTrack?.content_hash || snapshot.content_hash || "",
    mime_type: availableTrack?.mime_type || snapshot.mime_type || "",
    blob_size: availableTrack?.blob_size ?? snapshot.blob_size ?? 0,
    file_extension: availableTrack?.file_extension || snapshot.file_extension || "",
    folder_path: availableTrack?.folder_path || snapshot.folder_path || "",
    src: availableTrack?.src || snapshot.src || "",
    station_uuid: stationUuid,
    countrycode: availableTrack?.countrycode || snapshot.countrycode || "",
    language: availableTrack?.language || snapshot.language || "",
    codec: availableTrack?.codec || snapshot.codec || "",
    bitrate: availableTrack?.bitrate ?? snapshot.bitrate ?? null,
    hls: Number(availableTrack?.hls ?? snapshot.hls) === 1 ? 1 : 0,
  }, snapshot.entryId);
}

function getUpcomingTrackIndex(fromIndex = state.currentIndex) {
  if (state.queue.length === 0 || fromIndex < 0) return -1;
  if (state.shuffle || state.repeat === "one") return -1;

  const nextIndex = fromIndex + 1;
  if (nextIndex < state.queue.length) return nextIndex;
  return state.repeat === "all" ? 0 : -1;
}

function getPrepareLeadSeconds(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return PREPARE_MIN_LEAD_SECONDS;
  return Math.max(
    PREPARE_MIN_LEAD_SECONDS,
    Math.min(PREPARE_MAX_LEAD_SECONDS, duration * PREPARE_LEAD_RATIO),
  );
}

function isPreparedEntryCurrent(index, track) {
  return Boolean(
    preparedNext
      && preparedNext.index === index
      && preparedNext.queueId === track?._queueId
      && (Date.now() - preparedNext.preparedAt) <= PREPARED_SOURCE_MAX_AGE_MS,
  );
}

function clearPreparedNext({ keepResolved = false } = {}) {
  prepareNextGeneration += 1;

  if (!preparedNext) return;

  if (!keepResolved && typeof preparedNext.resolved?.revokeUrl === "function") {
    try { preparedNext.resolved.revokeUrl(); } catch { /* ignore */ }
  }

  preparedNext = null;
}

async function prepareNextTrackSource(index) {
  const track = state.queue[index];
  if (!track || track.media_kind === "radio") return null;

  if (isPreparedEntryCurrent(index, track)) return preparedNext;

  const requestKey = `${index}:${track._queueId}`;
  if (prepareNextPromise?.key === requestKey) {
    return prepareNextPromise.promise;
  }

  clearPreparedNext();
  const generation = prepareNextGeneration;

  const promise = (async () => {
    const resolved = await resolveRuntimeAudioSource(track.name, track);
    const liveTrack = state.queue[index];
    if (generation !== prepareNextGeneration || !liveTrack || liveTrack._queueId !== track._queueId || !resolved) {
      if (resolved?.revokeUrl) {
        try { resolved.revokeUrl(); } catch { /* ignore */ }
      }
      return null;
    }

    preparedNext = {
      index,
      queueId: track._queueId,
      resolved,
      preparedAt: Date.now(),
    };
    return preparedNext;
  })().finally(() => {
    if (prepareNextPromise?.key === requestKey) {
      prepareNextPromise = null;
    }
  });

  prepareNextPromise = { key: requestKey, promise };
  return promise;
}

function maybePrepareUpcomingTrack({ force = false } = {}) {
  if (state.paused || state.isLive) return;

  const nextIndex = getUpcomingTrackIndex();
  if (nextIndex < 0) {
    clearPreparedNext();
    return;
  }

  const nextTrack = state.queue[nextIndex];
  if (!nextTrack || nextTrack.media_kind === "radio") return;
  if (isPreparedEntryCurrent(nextIndex, nextTrack)) return;

  const el = audio;
  if (!force) {
    const duration = el?.duration;
    const currentTime = el?.currentTime || 0;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const remaining = duration - currentTime;
    if (remaining > getPrepareLeadSeconds(duration)) return;
  }

  void prepareNextTrackSource(nextIndex);
}

function consumePreparedTrack(index, track) {
  if (!isPreparedEntryCurrent(index, track)) {
    if (preparedNext && (!track || preparedNext.queueId !== track._queueId || preparedNext.index !== index)) {
      clearPreparedNext();
    }
    return null;
  }

  const prepared = preparedNext;
  clearPreparedNext({ keepResolved: true });
  return prepared?.resolved || null;
}

function normalizePlaybackTime(time) {
  const value = Number(time);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isAutoplayBlockedError(error) {
  return error?.name === "NotAllowedError";
}

function isPendingSeekCurrent() {
  return Boolean(
    pendingSeek
      && pendingSeek.token === loadRequestToken
      && pendingSeek.queueId === state.currentTrack?._queueId,
  );
}

function getCurrentPlaybackTime() {
  if (state.isLive) return 0;
  if (isPendingSeekCurrent()) return pendingSeek.time;
  const currentTime = Number(audio?.currentTime || 0);
  return Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
}

function setAudioCurrentTime(el, time) {
  if (!el) return false;
  try {
    el.currentTime = time;
    return Math.abs(Number(el.currentTime || 0) - time) < 0.25;
  } catch {
    return false;
  }
}

function applyPendingSeek({ confirm = false } = {}) {
  if (!isPendingSeekCurrent()) return false;
  const applied = setAudioCurrentTime(audio, pendingSeek.time);
  if (applied && confirm) pendingSeek = null;
  return applied;
}

function reconcilePendingSeekDuringPlayback() {
  if (!isPendingSeekCurrent()) return;
  const currentTime = Number(audio?.currentTime || 0);
  if (Number.isFinite(currentTime) && (currentTime >= pendingSeek.time || Math.abs(currentTime - pendingSeek.time) < 0.75)) {
    pendingSeek = null;
    return;
  }
  applyPendingSeek();
}

function restorePlaybackTimeAfterPrime(el, time) {
  const restoreTime = normalizePlaybackTime(time);
  if (restoreTime > 0) {
    setAudioCurrentTime(el, restoreTime);
    return;
  }
  setAudioCurrentTime(el, 0);
}

function getCurrentPlaybackSecond() {
  return Math.floor(getCurrentPlaybackTime());
}

function writeSessionSnapshot(overrides: RuntimeTrack = {}) {
  savePlayerSessionSnapshot({
    queueEntries: state.queue.map(serializeQueueEntry).filter(Boolean),
    playedEntries: state.playedHistory.map(serializeQueueEntry).filter(Boolean),
    currentEntryId: state.currentTrack?._queueId || "",
    currentIndex: state.currentIndex,
    currentTrackName: state.currentTrack?.name || "",
    currentTime: state.isLive ? 0 : normalizePlaybackTime(overrides.currentTime ?? getCurrentPlaybackTime()),
    paused: state.paused,
    volume: state.volume,
    muted: state.muted,
    repeat: state.repeat,
    shuffle: state.shuffle,
    backgroundMode: state.backgroundMode,
  });
  lastPersistedPlaybackSecond = getCurrentPlaybackSecond();
}

function flushSessionPersistence(overrides = {}) {
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
  }
  writeSessionSnapshot(overrides);
}

function maybePersistPlaybackProgress() {
  if (state.isLive) return;
  const second = getCurrentPlaybackSecond();
  if (second === lastPersistedPlaybackSecond) return;
  flushSessionPersistence();
}

function bindLifecyclePersistence() {
  if (lifecycleBound || typeof window === "undefined" || typeof document === "undefined") return;

  const flushOnHide = () => {
    if (document.visibilityState === "hidden") {
      flushSessionPersistence();
    }
  };

  window.addEventListener("pagehide", flushSessionPersistence);
  window.addEventListener("beforeunload", flushSessionPersistence);
  document.addEventListener("visibilitychange", flushOnHide);
  lifecycleBound = true;
}

function removeQueueEntryAt(index) {
  if (index < 0 || index >= state.queue.length) return null;

  const [removed] = state.queue.splice(index, 1);
  if (!removed) return null;

  if (index < state.currentIndex) {
    state.currentIndex -= 1;
  } else if (index === state.currentIndex) {
    if (state.queue.length === 0) {
      state.currentIndex = -1;
      state.currentTrack = null;
    } else {
      state.currentIndex = Math.min(index, state.queue.length - 1);
      state.currentTrack = state.queue[state.currentIndex] || null;
    }
  }

  return removed;
}

function pushPlayedHistory(track) {
  if (!track) return;
  state.playedHistory.push(track);
  if (state.playedHistory.length > PLAYED_HISTORY_LIMIT) {
    state.playedHistory.splice(0, state.playedHistory.length - PLAYED_HISTORY_LIMIT);
  }
}

function popPlayedHistory() {
  while (state.playedHistory.length > 0) {
    const track = state.playedHistory.pop();
    if (track?.name) return track;
  }
  return null;
}

async function restorePreviousFromHistory({ autoplay = true } = {}) {
  const previous = popPlayedHistory();
  if (!previous) return false;

  clearPreparedNext();
  const insertAt = state.currentIndex >= 0
    ? Math.max(0, Math.min(state.currentIndex, state.queue.length))
    : 0;

  state.queue.splice(insertAt, 0, previous);
  state.paused = !autoplay;
  flushSessionPersistence({ currentTime: 0 });
  await loadTrack(insertAt, { autoplay });
  return true;
}

function reconcilePreparedNextAfterRemoval(removedIndex, removedQueueId = "") {
  if (!preparedNext) return;

  if (preparedNext.queueId === removedQueueId || preparedNext.index === removedIndex) {
    clearPreparedNext();
    return;
  }

  if (preparedNext.index > removedIndex) {
    preparedNext = {
      ...preparedNext,
      index: preparedNext.index - 1,
    };
  }
}

async function continueLibraryPlayback({ autoplay = true, pausedState = !autoplay } = {}) {
  const nextTrack = getNextLibraryContinuationTrack();
  if (!nextTrack) {
    clearLibraryContinuation();
    return false;
  }

  clearPreparedNext();
  state.queue = prepareQueueEntries([nextTrack]);
  state.paused = pausedState;
  flushSessionPersistence({ currentTime: 0 });
  await loadTrack(0, { autoplay });
  return true;
}

async function advanceToNextTrack({ autoplay = true, pausedState = !autoplay, consumeCurrent = false } = {}) {
  if (state.queue.length === 0) return;

  const previousIndex = state.currentIndex;
  const currentQueueId = state.currentTrack?._queueId || "";

  if (consumeCurrent && !state.shuffle && state.repeat !== "all" && previousIndex >= 0 && previousIndex >= state.queue.length - 1) {
    clearPreparedNext();
    const removed = removeQueueEntryAt(previousIndex);
    pushPlayedHistory(removed);
    flushSessionPersistence({ currentTime: 0 });
    if (state.queue.length === 0) {
      if (await continueLibraryPlayback({ autoplay, pausedState })) {
        return;
      }
      stopPlayback();
      return;
    }
    stopPlayback();
    return;
  }

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

  if (consumeCurrent && previousIndex >= 0) {
    if (next >= 0 && next > previousIndex) {
      next -= 1;
    }

    reconcilePreparedNextAfterRemoval(previousIndex, currentQueueId);
    const removed = removeQueueEntryAt(previousIndex);
    pushPlayedHistory(removed);

    if (state.queue.length === 0) {
      if (await continueLibraryPlayback({ autoplay, pausedState })) {
        return;
      }
      stopPlayback();
      return;
    }

    if (next < 0 || next >= state.queue.length) {
      next = Math.min(state.currentIndex >= 0 ? state.currentIndex : 0, state.queue.length - 1);
    }

    if (currentQueueId && state.queue[next]?._queueId === currentQueueId) {
      next = Math.min(next + 1, state.queue.length - 1);
    }
  }

  state.paused = pausedState;
  await loadTrack(next, { autoplay });
}

// ── Core playback ────────────────────────────────────────────────────

/**
 * Counter to prevent infinite skip loops when consecutive tracks are
 * unavailable.  Reset to 0 each time a track loads successfully.
 */
let consecutiveSkips = 0;

/**
 * Auto-skip to the next track when the current one is unavailable.
 * Scans forward through the entire queue (wrapping around once) so
 * playback continues even when a long run of tracks is unavailable,
 * as long as at least one later track is reachable.  Gives up after
 * exhausting the queue to prevent infinite loops.
 */
function autoSkipUnavailable(autoplay = !state.paused) {
  consecutiveSkips += 1;
  // Allow skipping up to the full queue length (every track tried once)
  if (consecutiveSkips >= state.queue.length) {
    consecutiveSkips = 0;
    return; // every track in the queue has been tried — give up
  }
  if (state.queue.length > 1) {
    advanceToNextTrack({ autoplay, pausedState: state.paused });
  }
}

/**
 * Load and play a track from the queue by index.
 *
 * @param {number} index - Queue index
 * @param {{ startTime?: number, autoplay?: boolean, suppressAutoplayError?: boolean }} [opts]
 */
async function loadTrack(index, { startTime = 0, autoplay = true, suppressAutoplayError = false } = {}) {
  const track = state.queue[index];
  if (!track) return;
  const requestToken = ++loadRequestToken;
  resetRadioLifecycle();
  if (pendingRadioClickQueueId && pendingRadioClickQueueId !== track._queueId) {
    pendingRadioClickQueueId = "";
    pendingRadioClickUuid = "";
  }
  const requestedStartTime = track.media_kind === "radio" ? 0 : normalizePlaybackTime(startTime);

  if (autoplay) enableBackgroundModeForPlaybackStart();

  state.currentIndex = index;
  state.currentTrack = track;
  state.loading = true;
  state.error = null;
  state.remoteSessionActive = false;
  state.sourceTransport = null;
  state.isLive = track.media_kind === "radio";
  state.seekable = track.media_kind !== "radio";
  state.cacheable = false;
  state.analysisEligible = false;
  state.connectionState = track.media_kind === "radio" ? "connecting" : "idle";
  pendingSeek = requestedStartTime > 0
    ? { token: requestToken, queueId: track._queueId, time: requestedStartTime }
    : null;
  flushSessionPersistence({ currentTime: requestedStartTime });
  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();
  notify();

  // Revoke previous blob URL
  if (currentSourceRevoke) {
    currentSourceRevoke();
    currentSourceRevoke = null;
  }

  let el = getAudio();
  const previousSourceType = state.sourceType;

  const prepared = consumePreparedTrack(index, track);
  const resolved = prepared || await resolveAudioSource(track.name, track);
  if (loadRequestToken !== requestToken || state.currentTrack?._queueId !== track._queueId) {
    if (!prepared && resolved?.revokeUrl) {
      try { resolved.revokeUrl(); } catch { /* ignore */ }
    }
    return;
  }

  if (!resolved) {
    state.loading = false;
    state.error = track.media_kind === "radio"
      ? Number(track.hls) === 1 ? "unsupported-hls" : "station-unavailable"
      : "unavailable";
    state.sourceType = null;
    state.sourceTransport = null;
    state.connectionState = track.media_kind === "radio" ? "unavailable" : "idle";
    if (track.media_kind === "radio") {
      state.paused = true;
      clearAudioElementSource(getAudio());
    }
    flushSessionPersistence({ currentTime: requestedStartTime });
    syncBackgroundModeKeepAlive();
    syncMediaSessionPlaybackState();
    notify();
    // Auto-skip unavailable tracks (with loop guard)
    if (track.media_kind !== "radio") autoSkipUnavailable(autoplay);
    return;
  }

  const resolvedIsLive = Boolean(resolved.isLive ?? resolved.live ?? (resolved.type === "live"));
  if (resolvedIsLive && resolved.stationUuid) {
    const cachedTransport = radioTransportCache.get(resolved.stationUuid);
    if (cachedTransport && cachedTransport.expiresAt > Date.now() && cachedTransport.mode === "radio-relay" && resolved.fallbackSrc) {
      resolved.src = resolved.fallbackSrc;
      resolved.transport = "radio-relay";
      resolved.sourceTransport = "radio-relay";
      radioFallbackUsed = true;
    } else if (cachedTransport && cachedTransport.expiresAt <= Date.now()) {
      radioTransportCache.delete(resolved.stationUuid);
    }
  }

  if (shouldResetVisualizerGraph(previousSourceType, resolved)) {
    const hadVisualizerGraph = destroyVisualizerGraphForElement(el);
    if (hadVisualizerGraph) {
      el = replaceManagedAudioElement();
    }
  }

  const resolvedSourceType = resolved.sourceType ?? resolved.type;
  state.sourceType = resolvedSourceType;
  state.sourceTransport = resolved.sourceTransport
    ?? resolved.transport
    ?? (resolvedSourceType === "blob" ? "local" : "backend");
  state.isLive = resolvedIsLive;
  state.seekable = resolved.seekable !== false && !resolvedIsLive;
  state.cacheable = resolved.cacheable ?? (resolvedSourceType === "remote" && !resolvedIsLive);
  state.analysisEligible = resolved.analysisEligible !== false;
  state.connectionState = resolvedIsLive ? "connecting" : "idle";
  activeResolvedSource = resolved;
  currentSourceRevoke = resolved.revokeUrl;

  // CORS: keep crossOrigin="anonymous" for all sources.  The attribute is
  // set at element creation time so iOS Safari includes the Origin header
  // from the very first network request, preventing tainted
  // MediaElementAudioSourceNodes.  For blob:/same-origin sources the
  // attribute is harmless — the browser skips CORS negotiation.
  el.crossOrigin = "anonymous";
  el.preload = resolvedIsLive ? "none" : "metadata";

  resetAudioElementPlaybackRate(el);
  el.src = resolved.src;
  resetAudioElementPlaybackRate(el);
  el.volume = state.muted ? 0 : state.volume;
  el.muted = state.muted;

  if (requestedStartTime > 0) {
    applyPendingSeek();
  }

  state.loading = false;
  consecutiveSkips = 0; // successful load — reset skip counter
  flushSessionPersistence({ currentTime: requestedStartTime });
  syncBackgroundModeKeepAlive();
  notify();

  updateMediaSessionMetadata();
  syncMediaSessionPlaybackState();

  if (autoplay) {
    if (resolvedIsLive) startRadioConnectionTimeout(requestToken);
    if (state.backgroundMode) {
      void armBackgroundModeKeepAlive();
    }
    await primeAudio();
    resetAudioElementPlaybackRate(el);
    await resumeVisualizerGraphForElement(el);
    el.play().catch((err) => {
      if (suppressAutoplayError && isAutoplayBlockedError(err)) {
        state.paused = true;
        state.error = null;
        flushSessionPersistence();
        syncBackgroundModeKeepAlive();
        syncMediaSessionPlaybackState();
        notify();
        return;
      }
      if (resolvedIsLive) {
        handleRadioConnectionFailure(requestToken);
      } else if (err?.name !== "AbortError") {
        state.error = "playback-failed";
        syncBackgroundModeKeepAlive();
        syncMediaSessionPlaybackState();
        notify();
      }
    });
  }

  maybePrepareUpcomingTrack({ force: false });
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Set the queue and optionally start playback.
 *
 * @param {object[]} tracks - Array of asset metadata objects
 * @param {{ startIndex?: number, autoplay?: boolean }} [opts]
 */
export function setQueue(tracks, { startIndex = 0, autoplay = true } = {}) {
  clearLibraryContinuation();
  clearPreparedNext();
  state.queue = prepareQueueEntries(tracks);
  state.playedHistory = [];
  state.paused = !autoplay;
  persistSession();
  if (state.queue.length > 0) {
    loadTrack(Math.min(startIndex, state.queue.length - 1), { autoplay });
  } else {
    stopPlayback();
  }
}

/**
 * Add tracks to the end of the queue.
 * @param {object[]} tracks
 */
export function enqueue(tracks) {
  state.queue.push(...prepareQueueEntries(tracks));
  persistSession();
  notify();
}

/**
 * Insert tracks immediately after the current track ("Play Next").
 * @param {object[]} tracks
 */
export function playNext(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return;
  const insertAt = state.currentIndex >= 0 ? state.currentIndex + 1 : 0;
  state.queue.splice(insertAt, 0, ...prepareQueueEntries(tracks));
  persistSession();
  notify();
}

/**
 * Remove a track from the queue by name.
 * If the removed track is currently playing, skip to next.
 * @param {string} trackName
 */
export function removeFromQueue(trackRef) {
  if (!trackRef) return;
  const idx = findQueueIndex(trackRef);
  if (idx < 0) return;

  const wasPlaying = idx === state.currentIndex;
  const removedQueueId = state.queue[idx]?._queueId || "";
  reconcilePreparedNextAfterRemoval(idx, removedQueueId);
  removeQueueEntryAt(idx);

  // Adjust currentIndex if the removed track was before/at current
  if (wasPlaying) {
    // If we removed the current track, load the next one at same index
    if (state.queue.length === 0) {
      continueLibraryPlayback({ autoplay: !state.paused, pausedState: state.paused }).then((continued) => {
        if (!continued) stopPlayback();
      });
      return;
    }
    const nextIdx = Math.min(state.currentIndex, state.queue.length - 1);
    flushSessionPersistence({ currentTime: 0 });
    loadTrack(nextIdx, { autoplay: !state.paused });
    return;
  }

  flushSessionPersistence();
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

  if (state.isLive && state.connectionState === "unavailable" && state.currentIndex >= 0) {
    await loadTrack(state.currentIndex, { autoplay: true });
    return;
  }

  const el = getAudio();
  if (el.src || state.queue.length > 0) {
    enableBackgroundModeForPlaybackStart();
  }

  if (el.src) {
    if (state.backgroundMode) {
      void armBackgroundModeKeepAlive();
    }
    applyPendingSeek();
    await primeAudio();
    applyPendingSeek();
    resetAudioElementPlaybackRate(el);
    await resumeVisualizerGraphForElement(el);
    el.play().catch((err) => {
      if (err?.name !== "AbortError") {
        state.error = "playback-failed";
        syncBackgroundModeKeepAlive();
        syncMediaSessionPlaybackState();
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
  clearRadioTimers();
  getAudio().pause();
}

/**
 * Stop playback and reset position.
 */
export function stopPlayback() {
  loadRequestToken += 1;
  resetRadioLifecycle();
  pendingRadioClickUuid = "";
  pendingRadioClickQueueId = "";
  clearLibraryContinuation();
  state.paused = true;
  state.currentIndex = -1;
  state.currentTrack = null;
  state.sourceType = null;
  state.sourceTransport = null;
  state.isLive = false;
  state.seekable = true;
  state.cacheable = false;
  state.analysisEligible = false;
  state.connectionState = "idle";
  state.loading = false;
  state.error = null;
  state.remoteSessionActive = false;
  pendingSeek = null;
  clearPreparedNext();
  lastPersistedPlaybackSecond = -1;

  const el = getAudio();
  const hadVisualizerGraph = destroyVisualizerGraphForElement(el);
  if (hadVisualizerGraph) {
    replaceManagedAudioElement();
  } else {
    clearAudioElementSource(el);
  }

  if (currentSourceRevoke) {
    currentSourceRevoke();
    currentSourceRevoke = null;
  }

  stopBackgroundModeKeepAlive();
  if (mediaSessionEnabled) clearMediaSessionClient(PLAYER_MEDIA_SESSION_OWNER);
  flushSessionPersistence({ currentTime: 0 });
  notify();
}

/**
 * Skip to next track.
 */
export async function nextTrack() {
  await advanceToNextTrack({ autoplay: true, pausedState: false, consumeCurrent: true });
}

/**
 * Skip to previous track (or restart current if > 3s in).
 */
export async function previousTrack() {
  if (state.queue.length === 0) {
    await restorePreviousFromHistory({ autoplay: true });
    return;
  }
  const el = getAudio();

  if (!state.isLive && el.currentTime > 3) {
    pendingSeek = null;
    el.currentTime = 0;
    flushSessionPersistence({ currentTime: 0 });
    notify();
    return;
  }

  let prev = state.currentIndex - 1;
  if (prev < 0) {
    if (state.repeat === "all") {
      prev = state.queue.length - 1;
    } else {
      if (await restorePreviousFromHistory({ autoplay: true })) {
        return;
      }
      pendingSeek = null;
      if (state.seekable) el.currentTime = 0;
      flushSessionPersistence({ currentTime: 0 });
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
  if (!state.seekable) return;
  const el = getAudio();
  if (Number.isFinite(time) && Number.isFinite(el.duration)) {
    pendingSeek = null;
    el.currentTime = Math.max(0, Math.min(time, el.duration));
    syncPositionState();
    flushSessionPersistence();
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
  const modes: Array<AudioRuntimeMutableState["repeat"]> = ["off", "all", "one"];
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
  if (libraryContinuation?.tracks?.length && state.shuffle) {
    libraryContinuation.shuffleCycle = libraryContinuation.lastTrackName
      ? [libraryContinuation.lastTrackName]
      : [];
  }
  persistSession();
  notify();
}

/**
 * Play a specific track from the queue by asset name.
 * @param {string} name
 */
export async function playTrackByName(name) {
  const idx = findQueueIndex(name);
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
 * Start a specific library track immediately without copying the whole
 * library into the queue. When there is no upcoming queue, playback can
 * continue through the library lazily as tracks finish.
 *
 * @param {object} track - Track metadata to start now
 * @param {object[]} libraryTracks - Full library ordering for optional continuation
 */
export async function playLibraryTrackNow(track, libraryTracks) {
  const selectedTrack = ensureQueueEntry(track);
  if (!selectedTrack) return;

  clearPreparedNext();

  const remainingQueue = state.currentIndex >= 0
    ? state.queue.slice(state.currentIndex + 1)
    : state.queue.slice();
  const preservedQueue = remainingQueue.filter((queuedTrack) => queuedTrack?.name !== selectedTrack.name);
  const hadUpcomingQueue = preservedQueue.length > 0;

  if (state.currentTrack?.name && state.currentTrack.name !== selectedTrack.name) {
    pushPlayedHistory(state.currentTrack);
  }

  state.queue = prepareQueueEntries([selectedTrack, ...preservedQueue], [
    selectedTrack._queueId,
  ]);
  state.paused = false;

  if (!hadUpcomingQueue) {
    setLibraryContinuation(libraryTracks, selectedTrack.name);
  } else {
    clearLibraryContinuation();
  }

  flushSessionPersistence({ currentTime: 0 });
  await loadTrack(0, { autoplay: true });
}

/**
 * Play an arbitrary track immediately while preserving the pending queue.
 * Used by Radio so discovery results never become queue entries en masse.
 */
export async function playTrackNow(track) {
  const selectedTrack = ensureQueueEntry(track);
  if (!selectedTrack) return false;

  clearPreparedNext();
  clearLibraryContinuation();
  const remainingQueue = state.currentIndex >= 0
    ? state.queue.slice(state.currentIndex + 1)
    : state.queue.slice();
  if (state.currentTrack) pushPlayedHistory(state.currentTrack);
  state.queue = prepareQueueEntries([selectedTrack, ...remainingQueue], [selectedTrack._queueId]);
  state.paused = false;
  pendingRadioClickUuid = selectedTrack.media_kind === "radio" ? selectedTrack.station_uuid || "" : "";
  pendingRadioClickQueueId = pendingRadioClickUuid ? selectedTrack._queueId : "";
  flushSessionPersistence({ currentTime: 0 });
  await loadTrack(0, { autoplay: true });
  return true;
}

/**
 * Get a readonly snapshot of the runtime state.
 */
export function getState() {
  const el = audio;
  return {
    queue: state.queue,
    playedHistory: state.playedHistory,
    currentIndex: state.currentIndex,
    currentTrack: state.currentTrack,
    paused: state.paused,
    volume: state.volume,
    muted: state.muted,
    repeat: state.repeat,
    shuffle: state.shuffle,
    backgroundMode: state.backgroundMode,
    sourceType: state.sourceType,
    sourceTransport: state.sourceTransport,
    isLive: state.isLive,
    seekable: state.seekable,
    cacheable: state.cacheable,
    analysisEligible: state.analysisEligible,
    connectionState: state.connectionState,
    loading: state.loading,
    error: state.error,
    remoteSessionActive: state.remoteSessionActive,
    currentTime: getCurrentPlaybackTime(),
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
  clearLibraryContinuation();

  state.volume = session.volume;
  state.muted = session.muted;
  state.repeat = session.repeat;
  state.shuffle = session.shuffle;
  state.backgroundMode = session.backgroundMode;

  // Rebuild queue from persisted snapshots, overlaying live catalog metadata
  // when available but preserving snapshot-only entries and duplicates.
  const trackMap = new Map(availableTracks.map((t) => [t.name, t]));
  const restoredQueue = session.queueEntries
    .map((snapshot) => buildRestoredQueueEntry(snapshot, trackMap.get(snapshot.name)))
    .filter(Boolean);
  state.playedHistory = session.playedEntries
    .map((snapshot) => buildRestoredQueueEntry(snapshot, trackMap.get(snapshot.name)))
    .filter(Boolean);

  if (restoredQueue.length === 0) {
    notify();
    return;
  }

  state.queue = restoredQueue;

  const byEntryId = session.currentEntryId
    ? restoredQueue.findIndex((track) => track._queueId === session.currentEntryId)
    : -1;
  const byLegacyName = session.currentTrackName
    ? restoredQueue.findIndex((track) => track.name === session.currentTrackName)
    : -1;
  const startIndex = byEntryId >= 0
    ? byEntryId
    : session.currentIndex >= 0 && session.currentIndex < restoredQueue.length
      ? session.currentIndex
      : byLegacyName >= 0
        ? byLegacyName
        : 0;

  if (startIndex >= 0) {
    const restoredRadio = state.queue[startIndex];
    if (restoredRadio?.media_kind === "radio" && restoredRadio.station_uuid) {
      try {
        const freshStation = await radioBrowser.getStationByUuid(restoredRadio.station_uuid);
        if (freshStation) {
          state.queue[startIndex] = ensureQueueEntry({
            ...restoredRadio,
            ...radioStationToTrack(freshStation),
          }, restoredRadio._queueId);
        }
      } catch {
        // Keep the safe persisted snapshot and let source resolution retry later.
      }
    }
    state.paused = session.paused;
    await loadTrack(startIndex, {
      startTime: session.currentTime || 0,
      autoplay: autoplay && !session.paused,
      suppressAutoplayError: true,
    });
  }
}

// ── Event handlers ───────────────────────────────────────────────────

function onPlay() {
  state.paused = false;
  enableBackgroundModeForPlaybackStart();

  // Track remote session for no-hot-swap guard
  if (state.cacheable && state.sourceType === "remote" && !state.remoteSessionActive) {
    state.remoteSessionActive = true;
    // Trigger background cache non-blockingly
    if (state.currentTrack) {
      const cachedName = state.currentTrack.name;
      triggerBackgroundCache(state.currentTrack.name, state.currentTrack, {
        onCached() {
          for (const track of state.queue) {
            if (track.name === cachedName) track._offline = true;
          }
          notify();
        },
      });
    }
  }

  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();
  startPositionSync();
  maybePrepareUpcomingTrack({ force: false });
  maybePersistPlaybackProgress();
  persistSession();
  notify();
}

function onPause() {
  if (state.paused) clearRadioTimers();
  // Only mark paused if not a temporary interruption (e.g. seeking)
  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();
  stopPositionSync();
  flushSessionPersistence();
  notify();
}

function onEnded() {
  if (state.isLive) {
    handleRadioConnectionFailure(loadRequestToken);
    return;
  }
  state.remoteSessionActive = false;
  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();

  if (state.repeat === "one") {
    const el = getAudio();
    pendingSeek = null;
    el.currentTime = 0;
    flushSessionPersistence({ currentTime: 0 });
    el.play().catch(() => {});
    return;
  }

  advanceToNextTrack({ autoplay: true, pausedState: false, consumeCurrent: true });
}

function onTimeUpdate() {
  if (state.isLive) {
    notify();
    return;
  }
  reconcilePendingSeekDuringPlayback();
  syncPositionState();
  maybePrepareUpcomingTrack({ force: false });
  maybePersistPlaybackProgress();
  notify();
}

function onLoadedMetadata() {
  if (state.isLive) {
    syncPositionState();
    notify();
    return;
  }
  applyPendingSeek();
  syncPositionState();
  maybePrepareUpcomingTrack({ force: true });
  maybePersistPlaybackProgress();
  notify();
}

function onCanPlay() {
  if (state.isLive) {
    notify();
    return;
  }
  applyPendingSeek();
  syncPositionState();
  maybePersistPlaybackProgress();
  notify();
}

function onError(event) {
  const target = event?.currentTarget;
  const sourceAttr = typeof target?.getAttribute === "function"
    ? target.getAttribute("src")
    : target?.src;
  if (!sourceAttr) return;

  if (state.isLive) {
    handleRadioConnectionFailure(loadRequestToken);
    return;
  }

  state.error = "playback-error";
  state.loading = false;
  flushSessionPersistence();
  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();
  notify();
}

function onWaiting() {
  state.loading = true;
  if (state.isLive && state.connectionState === "playing") {
    state.connectionState = "reconnecting";
    startRadioConnectionTimeout(loadRequestToken);
  }
  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();
  notify();
}

function onPlaying() {
  state.loading = false;
  if (state.isLive) {
    if (radioConnectionTimer) clearTimeout(radioConnectionTimer);
    radioConnectionTimer = null;
    radioHadPlayed = true;
    state.connectionState = "playing";
    state.error = null;
    const uuid = state.currentTrack?.station_uuid || "";
    if (uuid && state.sourceTransport) {
      const cachedTransport = radioTransportCache.get(uuid);
      radioTransportCache.set(uuid, {
        resolvedUrl: cachedTransport?.resolvedUrl || activeResolvedSource?.src || "",
        mode: state.sourceTransport as "radio-direct-cors" | "radio-relay",
        expiresAt: Date.now() + RADIO_TRANSPORT_CACHE_MS,
      });
    }
    if (uuid && pendingRadioClickUuid === uuid) {
      pendingRadioClickUuid = "";
      pendingRadioClickQueueId = "";
      void radioBrowser.registerStationClick(uuid);
    }
    if (radioStableTimer) clearTimeout(radioStableTimer);
    const token = loadRequestToken;
    radioStableTimer = setTimeout(() => {
      if (isCurrentRadioToken(token) && state.connectionState === "playing") radioRetryCount = 0;
    }, RADIO_STABLE_RESET_MS);
  }
  syncBackgroundModeKeepAlive();
  syncMediaSessionPlaybackState();
  applyPendingSeek();
  syncPositionState();
  maybePersistPlaybackProgress();
  maybePrepareUpcomingTrack({ force: false });
  notify();
}

// ── Media Session ────────────────────────────────────────────────────

function updateMediaSessionMetadata() {
  if (!mediaSessionEnabled) return;
  const track = state.currentTrack;
  if (!track) return;

  updateMediaSessionClient(PLAYER_MEDIA_SESSION_OWNER, {
    active: true,
    priority: PLAYER_MEDIA_SESSION_PRIORITY,
    metadata: {
      title: track.title || track.original_filename || track.name || "",
      artist: track.artist || track.folder_path || "",
      album: "VatioLibre",
      artworkUrl: track.artwork_ref && isArtworkUrl(track.artwork_ref) ? track.artwork_ref : "",
    },
    handlers: {
      play,
      pause,
      stop: stopPlayback,
      previoustrack: previousTrack,
      nexttrack: nextTrack,
      ...(state.seekable ? {
        seekbackward: (details) => seekBackward(details?.seekOffset || 10),
        seekforward: (details) => seekForward(details?.seekOffset || 10),
        seekto: (details) => { if (details?.seekTime != null) seekTo(details.seekTime); },
      } : {}),
    },
  });
}

export function updatePlayerMediaSessionMetadata(metadata = {}) {
  if (!mediaSessionEnabled) return;

  updateMediaSessionClient(PLAYER_MEDIA_SESSION_OWNER, {
    active: true,
    priority: PLAYER_MEDIA_SESSION_PRIORITY,
    metadata,
  });
}

function syncPositionState() {
  if (!mediaSessionEnabled) return;
  if (state.isLive || !state.seekable) {
    updateMediaSessionClient(PLAYER_MEDIA_SESSION_OWNER, {
      active: true,
      priority: PLAYER_MEDIA_SESSION_PRIORITY,
      positionState: null,
    });
    return;
  }
  const el = audio;
  if (!el) return;
  updateMediaSessionClient(PLAYER_MEDIA_SESSION_OWNER, {
    active: true,
    priority: PLAYER_MEDIA_SESSION_PRIORITY,
    positionState: {
      duration: el.duration || 0,
      position: getCurrentPlaybackTime(),
      playbackRate: el.playbackRate || 1,
    },
  });
}

function startPositionSync() {
  stopPositionSync();
  if (state.isLive) return;
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
    writeSessionSnapshot();
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
