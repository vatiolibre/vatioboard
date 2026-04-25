/**
 * Media Session adapter.
 *
 * Wraps the Media Session API behind a safe facade so consumers do not
 * need to feature-detect or handle partial implementations.  Designed
 * to be shared across pages (player, speed, future integrations).
 *
 * The adapter does NOT own the audio element — it receives playback
 * state updates from the caller and forwards them to the platform.
 */

function supported() {
  return "mediaSession" in navigator;
}

function supportsMetadata() {
  return supported() && typeof window.MediaMetadata === "function";
}

const DEFAULT_OWNER = "default";
const mediaSessionClients = new Map();
let mediaSessionClientSequence = 0;

const FALLBACK_ARTWORK = [
  { src: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
  { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
];

const ACTION_NAMES = [
  "play", "pause", "stop",
  "previoustrack", "nexttrack",
  "seekbackward", "seekforward", "seekto",
];

function normalizeOwner(owner) {
  return String(owner || DEFAULT_OWNER).trim() || DEFAULT_OWNER;
}

function getClient(owner) {
  const normalizedOwner = normalizeOwner(owner);
  if (!mediaSessionClients.has(normalizedOwner)) {
    mediaSessionClients.set(normalizedOwner, {
      owner: normalizedOwner,
      active: true,
      priority: 0,
      metadata: null,
      playbackState: "none",
      handlers: null,
      positionState: null,
      sequence: 0,
    });
  }

  return mediaSessionClients.get(normalizedOwner);
}

function getTopClient() {
  let topClient = null;

  for (const client of mediaSessionClients.values()) {
    if (client.active === false) continue;

    if (
      !topClient ||
      client.priority > topClient.priority ||
      (client.priority === topClient.priority && client.sequence > topClient.sequence)
    ) {
      topClient = client;
    }
  }

  return topClient;
}

function buildArtwork(metadata = {}) {
  if (Array.isArray(metadata.artwork)) {
    return metadata.artwork.length > 0
      ? metadata.artwork
      : [...FALLBACK_ARTWORK];
  }

  return metadata.artworkUrl
    ? [{ src: metadata.artworkUrl, sizes: "512x512", type: "image/png" }, ...FALLBACK_ARTWORK]
    : [...FALLBACK_ARTWORK];
}

function applyPlatformMediaSessionMetadata(metadata) {
  if (!supportsMetadata()) return;

  if (!metadata) {
    try { navigator.mediaSession.metadata = null; } catch { /* ignore */ }
    return;
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata.title || "",
      artist: metadata.artist || "",
      album: metadata.album || "",
      artwork: buildArtwork(metadata),
    });
  } catch {
    if (!Array.isArray(metadata.fallbackArtwork)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title || "",
        artist: metadata.artist || "",
        album: metadata.album || "",
        artwork: metadata.fallbackArtwork,
      });
    } catch {
      // Partial implementations may throw
    }
  }
}

function applyPlatformMediaSessionPlaybackState(state) {
  if (!supported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch { /* ignore */ }
}

function applyPlatformMediaSessionPositionState({ duration, position, playbackRate = 1 } = {}) {
  if (!supported()) return;
  if (typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(position, duration),
      playbackRate,
    });
  } catch { /* ignore */ }
}

function applyPlatformMediaSessionActionHandlers(handlers = {}) {
  if (!supported()) return;

  for (const action of ACTION_NAMES) {
    const handler = handlers?.[action] ?? null;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some browsers do not support all actions
    }
  }
}

function applyMediaSessionClients() {
  const topClient = getTopClient();

  if (!topClient) {
    applyPlatformMediaSessionPlaybackState("none");
    applyPlatformMediaSessionMetadata(null);
    applyPlatformMediaSessionActionHandlers(null);
    return;
  }

  applyPlatformMediaSessionPlaybackState(topClient.playbackState || "none");
  applyPlatformMediaSessionMetadata(topClient.metadata);
  applyPlatformMediaSessionActionHandlers(topClient.handlers);

  if (topClient.positionState) {
    applyPlatformMediaSessionPositionState(topClient.positionState);
  }
}

export function updateMediaSessionClient(owner, patch = {}) {
  const client = getClient(owner);
  Object.assign(client, patch);
  client.owner = normalizeOwner(owner);
  client.sequence = ++mediaSessionClientSequence;
  applyMediaSessionClients();
}

export function clearMediaSessionClient(owner) {
  mediaSessionClients.delete(normalizeOwner(owner));
  applyMediaSessionClients();
}

/**
 * Update the lock-screen / notification metadata for the current track.
 *
 * @param {{ title?: string, artist?: string, album?: string, artworkUrl?: string }} meta
 */
export function setMediaSessionMetadata({ title = "", artist = "", album = "", artworkUrl = "" } = {}) {
  updateMediaSessionClient(DEFAULT_OWNER, {
    metadata: { title, artist, album, artworkUrl },
  });
}

/**
 * Update the playback state shown on the lock screen.
 *
 * @param {"none"|"paused"|"playing"} state
 */
export function setMediaSessionPlaybackState(state) {
  updateMediaSessionClient(DEFAULT_OWNER, { playbackState: state });
}

/**
 * Update the position state (progress bar on lock screen).
 *
 * @param {{ duration: number, position: number, playbackRate?: number }} pos
 */
export function setMediaSessionPositionState({ duration, position, playbackRate = 1 }) {
  updateMediaSessionClient(DEFAULT_OWNER, {
    positionState: { duration, position, playbackRate },
  });
}

/**
 * Bind Media Session action handlers.
 * Pass null for an action to release it.
 *
 * @param {Record<string, Function|null>} handlers
 */
export function setMediaSessionActionHandlers(handlers) {
  updateMediaSessionClient(DEFAULT_OWNER, { handlers });
}

/**
 * Clear all Media Session state (metadata, handlers, playback state).
 */
export function clearMediaSession() {
  mediaSessionClients.clear();
  applyMediaSessionClients();
}
