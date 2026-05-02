/**
 * Canonical track model — shared contract for playlist items, queue entries,
 * catalog assets, and demo tracks.
 *
 * Every surface that displays or plays a track should normalise raw data
 * through {@link normalizeTrack} so the shape is uniform regardless of the
 * source (backend manifest, playlist detail, demo playlist, queue entry).
 */

/**
 * @typedef {object} Track
 * @property {string}  name              - Stable asset id / name (e.g. hash or "demo:slug")
 * @property {string}  title             - Display title
 * @property {string}  artist            - Artist / performer
 * @property {string}  album             - Album name
 * @property {string}  genre             - Genre tag
 * @property {number|null} duration      - Duration in seconds (null if unknown)
 * @property {number|null} track_number  - Track number within album
 * @property {string}  artwork_ref       - Cover art reference (asset name, preview key, or URL)
 * @property {string}  media_kind        - "audio" | "video" | "image" | "other"
 * @property {string}  original_filename - Original upload filename
 * @property {string}  content_hash      - SHA-256 content hash (for staleness checks)
 * @property {string}  mime_type         - MIME type
 * @property {number}  blob_size         - File size in bytes
 * @property {string}  file_extension    - e.g. "mp3"
 * @property {string}  folder_path       - Virtual folder path
 * @property {string}  src               - Direct playback URL (demo tracks only)
 * @property {boolean} _offline          - Whether a local blob is available
 * @property {boolean} _demo             - Whether this is a demo track
 */

const EMPTY = "";

/**
 * Derive a human-readable title from a filename.
 *
 * Strips extension, replaces underscores / hyphens with spaces,
 * collapses whitespace, and title-cases the result.
 *
 * @param {string} filename
 * @returns {string}
 */
export function titleFromFilename(filename) {
  if (!filename) return EMPTY;
  let base = filename;
  const dotIdx = base.lastIndexOf(".");
  if (dotIdx > 0) base = base.slice(0, dotIdx);
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Parse the structured `metadata_json` field returned by the backend.
 *
 * @param {string|object|null|undefined} raw
 * @returns {object}
 */
function parseMetadataJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Normalise any raw track-like object into the canonical shape.
 *
 * Accepts:
 *  - Backend manifest assets
 *  - Playlist detail items (with optional snapshot fields)
 *  - Demo playlist entries
 *  - Runtime queue entries (already normalised — passthrough)
 *
 * @param {object} raw - Raw track-like object from any source
 * @returns {Track}
 */
export function normalizeTrack(raw) {
  if (!raw) return null;

  const meta = parseMetadataJson(raw.metadata_json);

  const name = str(raw.name);
  const isDemo = name.startsWith("demo:");

  // Title: explicit > metadata > snapshot > filename-derived > name
  const title =
    str(raw.title) ||
    str(meta.title) ||
    str(raw.snapshot_title) ||
    titleFromFilename(str(raw.original_filename)) ||
    name;

  const artist =
    str(raw.artist) || str(meta.artist) || str(raw.snapshot_artist) || EMPTY;

  const album =
    str(raw.album) || str(meta.album) || str(raw.snapshot_album) || EMPTY;

  const genre =
    str(raw.genre) || str(meta.genre) || str(raw.snapshot_genre) || EMPTY;

  const duration = numOrNull(raw.duration) ?? numOrNull(meta.duration) ?? numOrNull(raw.snapshot_duration);

  const track_number =
    numOrNull(raw.track_number) ?? numOrNull(meta.track_number) ?? null;

  const artwork_ref =
    str(raw.artwork_ref) ||
    str(meta.artwork_ref) ||
    str(raw.snapshot_artwork_ref) ||
    str(raw.cover_asset_name) ||
    str(raw.preview_image_url) ||
    str(raw.image_url) ||
    EMPTY;

  return {
    name,
    title,
    artist,
    album,
    genre,
    duration,
    track_number,
    artwork_ref,
    media_kind: str(raw.media_kind) || (isDemo ? "audio" : "other"),
    original_filename: str(raw.original_filename),
    content_hash: str(raw.content_hash) || str(raw.snapshot_content_hash),
    mime_type: str(raw.mime_type),
    blob_size: raw.blob_size ?? 0,
    file_extension: str(raw.file_extension),
    folder_path: str(raw.folder_path),
    src: str(raw.src),
    has_preview_image: Boolean(raw.has_preview_image),
    has_artwork: Boolean(raw.has_artwork),
    created_at: raw.created_at ?? null,
    modified_at: raw.modified_at ?? null,
    sort_timestamp: raw.sort_timestamp ?? 0,
    _offline: Boolean(raw._offline),
    _demo: isDemo,
  };
}

/**
 * Normalise an array of raw track-like objects, filtering out nulls.
 *
 * @param {object[]} rawTracks
 * @returns {Track[]}
 */
export function normalizeTracks(rawTracks) {
  if (!Array.isArray(rawTracks)) return [];
  return rawTracks.map(normalizeTrack).filter(Boolean);
}

/**
 * Format a duration in seconds as "m:ss" or "h:mm:ss".
 *
 * @param {number|null} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
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

// ── Helpers ──────────────────────────────────────────────────────────

function str(val) {
  return typeof val === "string" ? val.trim() : (val != null ? String(val).trim() : EMPTY);
}

function numOrNull(val) {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
