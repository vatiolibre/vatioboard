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
 *  - backgroundMode (boolean — internal playback keepalive policy)
 *
 * Never persists blobs, object URLs, or signed/expiring playback URLs.
 */

const STORAGE_KEY = "vatioboard_player_session_v2";
const LEGACY_STORAGE_KEY = "vatioboard_player_session_v1";
const SESSION_VERSION = 2;

export type PlayerRepeatMode = "off" | "all" | "one";

export interface PlayerQueueEntry {
  entryId: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number | null;
  artwork_ref: string;
  media_kind: string;
  original_filename: string;
  content_hash: string;
  mime_type: string;
  blob_size: number;
  file_extension: string;
  folder_path: string;
  src: string;
}

export interface PlayerSession {
  version: number;
  queueEntries: PlayerQueueEntry[];
  playedEntries: PlayerQueueEntry[];
  queue: string[];
  currentEntryId: string;
  currentIndex: number;
  currentTrackName: string;
  currentTime: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  repeat: PlayerRepeatMode;
  shuffle: boolean;
  backgroundMode: boolean;
}

type PersistedPlayerSession = Omit<PlayerSession, "queue" | "currentTrackName">;

const DEFAULTS: Readonly<PlayerSession> = Object.freeze({
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
export function loadPlayerSession(): PlayerSession {
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
export function savePlayerSession(state: Partial<PlayerSession>): void {
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
export function clearPlayerSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* ignore */ }
}

function cloneDefaults(): PlayerSession {
  return {
    ...DEFAULTS,
    queueEntries: [],
    playedEntries: [],
    queue: [],
  };
}

function readStoredSession(key: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw);
}

function normalizeV2Session(parsed: Record<string, unknown>): PlayerSession {
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

function normalizeLegacySession(parsed: Record<string, unknown>): PlayerSession {
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

function serializeV2Session(state: Partial<PlayerSession>): PersistedPlayerSession {
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

function normalizeQueueEntries(entries: unknown): PlayerQueueEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(normalizeQueueEntry)
    .filter((entry): entry is PlayerQueueEntry => Boolean(entry));
}

function normalizeQueueEntry(entry: unknown): PlayerQueueEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;

  const entryId = str(record.entryId);
  const name = str(record.name);
  if (!entryId || !name) return null;

  return {
    entryId,
    name,
    title: str(record.title),
    artist: str(record.artist),
    album: str(record.album),
    genre: str(record.genre),
    duration: numOrNull(record.duration),
    artwork_ref: sanitizeArtworkRef(record.artwork_ref),
    media_kind: str(record.media_kind) || "audio",
    original_filename: str(record.original_filename),
    content_hash: str(record.content_hash),
    mime_type: str(record.mime_type),
    blob_size: numOrZero(record.blob_size),
    file_extension: str(record.file_extension),
    folder_path: str(record.folder_path),
    src: sanitizeStableSrc(record.src),
  };
}

function sanitizeStableSrc(src: unknown): string {
  const value = str(src);
  if (!value) return "";
  if (value.startsWith("blob:") || value.startsWith("data:")) return "";
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

function sanitizeArtworkRef(ref: unknown): string {
  const value = str(ref);
  if (!value) return "";
  if (value.startsWith("blob:") || value.startsWith("data:")) return "";
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

function normalizeIndex(value: unknown, length: number): number {
  const index = Number(value);
  if (!Number.isFinite(index)) return length > 0 ? 0 : -1;
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

function clampTime(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function clampVolume(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.volume;
  return Math.max(0, Math.min(1, n));
}

function validateRepeat(v: unknown): PlayerRepeatMode {
  const valid = new Set<PlayerRepeatMode>(["off", "all", "one"]);
  return valid.has(v as PlayerRepeatMode) ? v as PlayerRepeatMode : "off";
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : (v != null ? String(v).trim() : "");
}
