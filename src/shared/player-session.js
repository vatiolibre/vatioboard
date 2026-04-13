/**
 * Player session persistence.
 *
 * Saves and restores the audio player state to/from localStorage so the
 * player can resume across page reloads and navigations within VatioBoard.
 *
 * Persisted fields:
 *  - queue (array of asset names)
 *  - currentTrackName
 *  - currentTime
 *  - paused (boolean — true if the user paused intentionally)
 *  - volume
 *  - muted
 *  - repeat ("off" | "all" | "one")
 *  - shuffle (boolean)
 *  - backgroundMode (boolean)
 *
 * Never persists blobs or signed URLs — only stable identifiers.
 */

const STORAGE_KEY = "vatioboard_player_session_v1";

const DEFAULTS = Object.freeze({
  queue: [],
  currentTrackName: "",
  currentTime: 0,
  paused: true,
  volume: 1,
  muted: false,
  repeat: "off",
  shuffle: false,
  backgroundMode: false,
});

/**
 * Load the persisted player session, or return defaults.
 * @returns {typeof DEFAULTS}
 */
export function loadPlayerSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      currentTrackName: String(parsed.currentTrackName || ""),
      currentTime: Number(parsed.currentTime) || 0,
      paused: parsed.paused !== false,
      volume: clampVolume(parsed.volume),
      muted: Boolean(parsed.muted),
      repeat: validateRepeat(parsed.repeat),
      shuffle: Boolean(parsed.shuffle),
      backgroundMode: Boolean(parsed.backgroundMode),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Save the current player session state.
 * @param {Partial<typeof DEFAULTS>} state
 */
export function savePlayerSession(state) {
  try {
    const current = loadPlayerSession();
    const merged = { ...current, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage unavailable in private/incognito
  }
}

/**
 * Clear the persisted player session.
 */
export function clearPlayerSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function validateRepeat(v) {
  const valid = new Set(["off", "all", "one"]);
  return valid.has(v) ? v : "off";
}
