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

const FALLBACK_ARTWORK = [
  { src: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
  { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
];

/**
 * Update the lock-screen / notification metadata for the current track.
 *
 * @param {{ title?: string, artist?: string, album?: string, artworkUrl?: string }} meta
 */
export function setMediaSessionMetadata({ title = "", artist = "", album = "", artworkUrl = "" } = {}) {
  if (!supportsMetadata()) return;

  const artwork = artworkUrl
    ? [{ src: artworkUrl, sizes: "512x512", type: "image/png" }, ...FALLBACK_ARTWORK]
    : [...FALLBACK_ARTWORK];

  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork });
  } catch {
    // Partial implementations may throw
  }
}

/**
 * Update the playback state shown on the lock screen.
 *
 * @param {"none"|"paused"|"playing"} state
 */
export function setMediaSessionPlaybackState(state) {
  if (!supported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch { /* ignore */ }
}

/**
 * Update the position state (progress bar on lock screen).
 *
 * @param {{ duration: number, position: number, playbackRate?: number }} pos
 */
export function setMediaSessionPositionState({ duration, position, playbackRate = 1 }) {
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

/**
 * Bind Media Session action handlers.
 * Pass null for an action to release it.
 *
 * @param {Record<string, Function|null>} handlers
 */
export function setMediaSessionActionHandlers(handlers) {
  if (!supported()) return;

  const actionNames = [
    "play", "pause", "stop",
    "previoustrack", "nexttrack",
    "seekbackward", "seekforward", "seekto",
  ];

  for (const action of actionNames) {
    const handler = handlers[action] ?? null;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some browsers do not support all actions
    }
  }
}

/**
 * Clear all Media Session state (metadata, handlers, playback state).
 */
export function clearMediaSession() {
  setMediaSessionPlaybackState("none");
  if (supportsMetadata()) {
    try { navigator.mediaSession.metadata = null; } catch { /* ignore */ }
  }
  setMediaSessionActionHandlers({
    play: null, pause: null, stop: null,
    previoustrack: null, nexttrack: null,
    seekbackward: null, seekforward: null, seekto: null,
  });
}
