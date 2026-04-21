/**
 * Player session persistence.
 *
 * Saves and restores the audio player state to/from localStorage so the
 * player can resume across page reloads and navigations within VatioBoard.
 *
 * Persisted fields:
 *  - queueEntries (array of stable queue-entry snapshots)
 *  - playedEntries (array of stable snapshots consumed from the queue)
 *  - currentEntryId
 *  - currentIndex
 *  - currentTime
 *  - paused (boolean — true if the user paused intentionally)
 *  - volume
 *  - muted
 *  - repeat ("off" | "all" | "one")
 *  - shuffle (boolean)
 *  - backgroundMode (boolean)
 *
 * Never persists blobs, object URLs, or signed/expiring playback URLs.
 */

const STORAGE_KEY = "vatioboard_player_session_v2";
const LEGACY_STORAGE_KEY = "vatioboard_player_session_v1";
const SESSION_VERSION = 2;

const DEFAULTS = Object.freeze({
  version: SESSION_VERSION,
  queueEntries: [],
  playedEntries: [],
  queue: [],
  currentEntryId: "",
  currentIndex: -1,
  currentTrackName: "",
  currentTime: 0,
  paused: true,
  volume: 0.88,
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
    const parsed = readStoredSession(STORAGE_KEY);
    if (parsed) return normalizeV2Session(parsed);

    const legacy = readStoredSession(LEGACY_STORAGE_KEY);
    if (legacy) return normalizeLegacySession(legacy);

    return cloneDefaults();
  } catch {
    return cloneDefaults();
  }
}

/**
 * Save the current player session state.
 * @param {Partial<typeof DEFAULTS>} state
 */
export function savePlayerSession(state) {
  try {
    const current = loadPlayerSession();
    const merged = normalizeV2Session({ ...current, ...state });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeV2Session(merged)));
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
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* ignore */ }
}

function cloneDefaults() {
  return {
    ...DEFAULTS,
    queueEntries: [],
    playedEntries: [],
    queue: [],
  };
}

function readStoredSession(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw);
}

function normalizeV2Session(parsed) {
  const queueEntries = normalizeQueueEntries(parsed.queueEntries);
  const playedEntries = normalizeQueueEntries(parsed.playedEntries);
  const currentIndex = normalizeIndex(parsed.currentIndex, queueEntries.length);
  const currentEntryId = str(parsed.currentEntryId);
  const currentTrackName = str(parsed.currentTrackName)
    || queueEntries.find((entry) => entry.entryId === currentEntryId)?.name
    || queueEntries[currentIndex]?.name
    || "";

  return {
    version: SESSION_VERSION,
    queueEntries,
    playedEntries,
    queue: queueEntries.map((entry) => entry.name),
    currentEntryId,
    currentIndex,
    currentTrackName,
    currentTime: clampTime(parsed.currentTime),
    paused: parsed.paused !== false,
    volume: clampVolume(parsed.volume),
    muted: Boolean(parsed.muted),
    repeat: validateRepeat(parsed.repeat),
    shuffle: Boolean(parsed.shuffle),
    backgroundMode: Boolean(parsed.backgroundMode),
  };
}

function normalizeLegacySession(parsed) {
  const queue = Array.isArray(parsed.queue) ? parsed.queue.map(str).filter(Boolean) : [];
  const queueEntries = queue.map((name, index) => ({
    entryId: `legacy_${index}_${name}`,
    name,
    title: "",
    artist: "",
    album: "",
    genre: "",
    duration: null,
    artwork_ref: "",
    media_kind: "audio",
    original_filename: "",
    content_hash: "",
    mime_type: "",
    blob_size: 0,
    file_extension: "",
    folder_path: "",
    src: "",
  }));
  const currentTrackName = str(parsed.currentTrackName);
  const currentIndex = Math.max(0, queueEntries.findIndex((entry) => entry.name === currentTrackName));
  const currentEntryId = queueEntries[currentIndex]?.entryId || "";

  return {
    version: SESSION_VERSION,
    queueEntries,
    playedEntries: [],
    queue,
    currentEntryId,
    currentIndex: queueEntries.length > 0 ? currentIndex : -1,
    currentTrackName,
    currentTime: clampTime(parsed.currentTime),
    paused: parsed.paused !== false,
    volume: clampVolume(parsed.volume),
    muted: Boolean(parsed.muted),
    repeat: validateRepeat(parsed.repeat),
    shuffle: Boolean(parsed.shuffle),
    backgroundMode: Boolean(parsed.backgroundMode),
  };
}

function serializeV2Session(state) {
  return {
    version: SESSION_VERSION,
    queueEntries: normalizeQueueEntries(state.queueEntries),
    playedEntries: normalizeQueueEntries(state.playedEntries),
    currentEntryId: str(state.currentEntryId),
    currentIndex: normalizeIndex(state.currentIndex, state.queueEntries?.length ?? 0),
    currentTime: clampTime(state.currentTime),
    paused: state.paused !== false,
    volume: clampVolume(state.volume),
    muted: Boolean(state.muted),
    repeat: validateRepeat(state.repeat),
    shuffle: Boolean(state.shuffle),
    backgroundMode: Boolean(state.backgroundMode),
  };
}

function normalizeQueueEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizeQueueEntry).filter(Boolean);
}

function normalizeQueueEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const entryId = str(entry.entryId);
  const name = str(entry.name);
  if (!entryId || !name) return null;

  return {
    entryId,
    name,
    title: str(entry.title),
    artist: str(entry.artist),
    album: str(entry.album),
    genre: str(entry.genre),
    duration: numOrNull(entry.duration),
    artwork_ref: sanitizeArtworkRef(entry.artwork_ref),
    media_kind: str(entry.media_kind) || "audio",
    original_filename: str(entry.original_filename),
    content_hash: str(entry.content_hash),
    mime_type: str(entry.mime_type),
    blob_size: numOrZero(entry.blob_size),
    file_extension: str(entry.file_extension),
    folder_path: str(entry.folder_path),
    src: sanitizeStableSrc(entry.src),
  };
}

function sanitizeStableSrc(src) {
  const value = str(src);
  if (!value) return "";
  if (value.startsWith("blob:") || value.startsWith("data:")) return "";
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

function sanitizeArtworkRef(ref) {
  const value = str(ref);
  if (!value) return "";
  if (value.startsWith("blob:") || value.startsWith("data:")) return "";
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

function normalizeIndex(value, length) {
  const index = Number.isInteger(value) ? value : Number(value);
  if (!Number.isFinite(index)) return length > 0 ? 0 : -1;
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

function clampTime(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.volume;
  return Math.max(0, Math.min(1, n));
}

function validateRepeat(v) {
  const valid = new Set(["off", "all", "one"]);
  return valid.has(v) ? v : "off";
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function str(v) {
  return typeof v === "string" ? v.trim() : (v != null ? String(v).trim() : "");
}
