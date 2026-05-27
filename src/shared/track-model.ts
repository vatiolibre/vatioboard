/**
 * Canonical track model — shared contract for playlist items, queue entries,
 * catalog assets, and demo tracks.
 *
 * Every surface that displays or plays a track should normalise raw data
 * through {@link normalizeTrack} so the shape is uniform regardless of the
 * source (backend manifest, playlist detail, demo playlist, queue entry).
 */

export interface Track {
  [key: string]: unknown;
  /** Stable asset id / name (e.g. hash or "demo:slug"). */
  name: string;
  /** Display title. */
  title: string;
  /** Artist / performer. */
  artist: string;
  /** Album name. */
  album: string;
  /** Genre tag. */
  genre: string;
  /** Duration in seconds (null if unknown). */
  duration: number | null;
  /** Track number within album. */
  track_number: number | null;
  /** Cover art reference (asset name, preview key, or URL). */
  artwork_ref: string;
  /** "audio" | "video" | "image" | "other" in current callers. */
  media_kind: string;
  /** Original upload filename. */
  original_filename: string;
  /** SHA-256 content hash (for staleness checks). */
  content_hash: string;
  /** MIME type. */
  mime_type: string;
  /** File size in bytes. */
  blob_size: number;
  /** e.g. "mp3". */
  file_extension: string;
  /** Virtual folder path. */
  folder_path: string;
  /** Direct playback URL (demo tracks only). */
  src: string;
  has_preview_image: boolean;
  has_artwork: boolean;
  created_at: string | number | null;
  modified_at: string | number | null;
  sort_timestamp: number;
  /** Whether a local blob is available. */
  _offline: boolean;
  /** Whether this is a demo track. */
  _demo: boolean;
}

export interface RawTrackLike {
  name?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  genre?: unknown;
  duration?: unknown;
  track_number?: unknown;
  artwork_ref?: unknown;
  media_kind?: unknown;
  original_filename?: unknown;
  content_hash?: unknown;
  mime_type?: unknown;
  blob_size?: unknown;
  file_extension?: unknown;
  folder_path?: unknown;
  src?: unknown;
  has_preview_image?: unknown;
  has_artwork?: unknown;
  created_at?: unknown;
  modified_at?: unknown;
  sort_timestamp?: unknown;
  metadata_json?: unknown;
  snapshot_title?: unknown;
  snapshot_artist?: unknown;
  snapshot_album?: unknown;
  snapshot_genre?: unknown;
  snapshot_duration?: unknown;
  snapshot_artwork_ref?: unknown;
  snapshot_content_hash?: unknown;
  cover_asset_name?: unknown;
  preview_image_url?: unknown;
  image_url?: unknown;
  _offline?: unknown;
  [key: string]: unknown;
}

type TrackMetadata = RawTrackLike;

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
export function titleFromFilename(filename: string | null | undefined): string {
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
 */
function parseMetadataJson(raw: unknown): TrackMetadata {
  if (!raw) return {};
  if (typeof raw === "object") return raw as TrackMetadata;
  try {
    const parsed = (JSON.parse as (text: unknown) => unknown)(raw);
    return typeof parsed === "object" && parsed !== null ? parsed as TrackMetadata : {};
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
 */
export function normalizeTrack(raw: RawTrackLike | null | undefined): Track | null {
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
    blob_size: (raw.blob_size ?? 0) as number,
    file_extension: str(raw.file_extension),
    folder_path: str(raw.folder_path),
    src: str(raw.src),
    has_preview_image: Boolean(raw.has_preview_image),
    has_artwork: Boolean(raw.has_artwork),
    created_at: (raw.created_at ?? null) as string | number | null,
    modified_at: (raw.modified_at ?? null) as string | number | null,
    sort_timestamp: (raw.sort_timestamp ?? 0) as number,
    _offline: Boolean(raw._offline),
    _demo: isDemo,
  };
}

/**
 * Normalise an array of raw track-like objects, filtering out nulls.
 *
 */
export function normalizeTracks(rawTracks: unknown): Track[] {
  if (!Array.isArray(rawTracks)) return [];
  return rawTracks
    .map((track) => normalizeTrack(track as RawTrackLike | null | undefined))
    .filter((track): track is Track => Boolean(track));
}

/**
 * Format a duration in seconds as "m:ss" or "h:mm:ss".
 *
 */
export function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "";
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

function str(val: unknown): string {
  return typeof val === "string" ? val.trim() : (val != null ? String(val).trim() : EMPTY);
}

function numOrNull(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
