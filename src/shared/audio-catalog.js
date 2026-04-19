/**
 * Audio catalog.
 *
 * Provides a filtered, sorted view of audio-only media assets from the
 * cached manifest.  Designed for the /player page browse list and for
 * any future surface that needs audio-only asset selection.
 *
 * Data flow:
 *  1. Read the full manifest snapshot from IndexedDB (via media-cache.js)
 *  2. If no cached manifest, fetch from backend and cache it (cold boot)
 *  3. Filter to audio-only assets
 *  4. Apply search / sort via filterAndSortOfflineAssets
 *  5. Expose offline-availability info per asset via hasLocalSource
 */

import {
  getCachedManifestSnapshot,
  getCachedMediaManifest,
  cacheManifestSnapshot,
} from "./media-cache.js";
import {
  getBackendMediaManifest,
  getBackendManifestVersion,
  getProtectedMediaRequestGate,
} from "./backend-auth.js";
import { hasLocalSource } from "./audio-source-resolver.js";
import { normalizeTrack } from "./track-model.js";

function isAbortError(error) {
  return Boolean(
    error
    && (
      error.name === "AbortError"
      || error.code === 20
    )
  );
}

function isAuthBlockedResponse(result) {
  return result?.blockedByAuth === true || result?.status === 401 || result?.status === 403;
}

/**
 * Load the audio catalog from the cached manifest.
 *
 * Returns audio-only assets, optionally filtered/sorted.
 * If the local manifest is empty, attempts a one-shot backend fetch
 * and caches the result for future offline use.
 *
 * @param {{ search?: string, sort?: string }} [query]
 * @returns {Promise<{ tracks: object[], total: number }>}
 */
export async function loadAudioCatalog(query = {}) {
  let assets = [];

  try {
    // Prefer the structured snapshot (includes token metadata)
    const snapshot = await getCachedManifestSnapshot();
    if (Array.isArray(snapshot?.assets)) {
      assets = snapshot.assets;
    }
  } catch { /* ignore */ }

  // Fallback: try the flat manifest
  if (assets.length === 0) {
    try {
      const cached = await getCachedMediaManifest();
      if (Array.isArray(cached)) assets = cached;
    } catch { /* ignore */ }
  }

  // Cold-online boot: no cached manifest — fetch from backend.
  if (assets.length === 0) {
    let gate = null;
    try {
      gate = await getProtectedMediaRequestGate();
      if (!gate.allowed) {
        return { tracks: [], total: 0 };
      }

      const response = await getBackendMediaManifest({ signal: gate.signal });
      if (response?.ok && Array.isArray(response.assets)) {
        assets = response.assets;
        // Cache atomically for future offline use.
        const token = (response.manifestToken && !response.isTruncated)
          ? response.manifestToken
          : null;
        cacheManifestSnapshot({ assets, token }).catch(() => {});
      }
    } catch (error) {
      if (!isAbortError(error)) {
        // offline — no manifest available
      }
    } finally {
      gate?.cleanup?.();
    }
  }

  // Filter to audio only and normalise into canonical shape
  const audioAssets = assets.filter(isAudioAsset).map(normalizeTrack).filter(Boolean);

  // Apply search + sort
  const filtered = filterAndSort(audioAssets, query);

  return { tracks: filtered, total: filtered.length };
}

/**
 * Non-blocking background sync of the audio catalog manifest.
 *
 * Performs a token-based freshness check before fetching the full
 * manifest to avoid wasteful duplicate downloads (mirrors the
 * cloud-library-resources syncCanonicalManifest pattern).
 *
 * @returns {Promise<boolean>} true when the manifest was refreshed
 */
export async function syncAudioCatalog() {
  let gate = null;
  try {
    gate = await getProtectedMediaRequestGate();
    if (!gate.allowed) return false;

    // Determine the remote manifest token
    const remoteVersion = await getBackendManifestVersion({ signal: gate.signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      return null;
    });
    if (isAuthBlockedResponse(remoteVersion)) {
      return false;
    }
    const remoteToken = remoteVersion?.ok ? remoteVersion.manifestToken : null;

    // Freshness check: matching token + existing snapshot → skip
    if (remoteToken) {
      const snapshot = await getCachedManifestSnapshot().catch(() => null);
      if (snapshot?.token && snapshot.token === remoteToken && Array.isArray(snapshot.assets)) {
        return false; // manifest is still fresh
      }
    }

    // Token mismatch or no cached snapshot — fetch the full manifest
    const response = await getBackendMediaManifest({ signal: gate.signal });
    if (!response?.ok || !Array.isArray(response.assets)) return false;
    const token = (response.manifestToken && !response.isTruncated)
      ? response.manifestToken
      : null;
    await cacheManifestSnapshot({ assets: response.assets, token });
    return true;
  } catch (error) {
    if (isAbortError(error)) return false;
    return false;
  } finally {
    gate?.cleanup?.();
  }
}

/**
 * Annotate tracks with offline availability.
 * Call this after loadAudioCatalog to enrich the track list.
 *
 * @param {object[]} tracks
 * @returns {Promise<object[]>} Same tracks with `_offline` boolean added
 */
export async function annotateOfflineAvailability(tracks) {
  const results = await Promise.all(
    tracks.map(async (track) => {
      const offline = await hasLocalSource(track.name).catch(() => false);
      return { ...track, _offline: offline };
    }),
  );
  return results;
}

// ── Internal ─────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus", "webm",
]);

/**
 * Determine whether a media asset is audio.
 *
 * Checks (in order):
 *  1. media_kind === "audio"
 *  2. mime_type starts with "audio/"
 *  3. Known audio file extension (fallback)
 */
export function isAudioAsset(asset) {
  if (!asset) return false;
  const kind = String(asset.media_kind || "").toLowerCase();
  if (kind === "audio") return true;
  // Reject explicit non-audio kinds
  if (kind === "video" || kind === "image") return false;
  const mime = String(asset.mime_type || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  return guessAudioFromFilename(asset.original_filename);
}

/**
 * Guess whether a file is audio from its extension.
 * Used as fallback when media_kind is not set.
 */
function guessAudioFromFilename(filename) {
  if (!filename) return false;
  const ext = filename.split(".").pop()?.toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

/**
 * Filter and sort assets (mirrors cloud-library-resources pattern).
 */
function filterAndSort(assets, query) {
  let result = assets;

  const search = String(query?.search || "").trim().toLowerCase();
  if (search) {
    result = result.filter((a) => {
      const haystack = `${a.title || ""} ${a.artist || ""} ${a.album || ""} ${a.genre || ""} ${a.original_filename || ""} ${a.folder_path || ""}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  const sort = String(query?.sort || "newest").trim().toLowerCase();
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  result = [...result].sort((a, b) => {
    if (sort === "oldest") return getSortableTimestamp(a) - getSortableTimestamp(b);
    if (sort === "title_asc") return collator.compare(a.title || "", b.title || "");
    if (sort === "title_desc") return collator.compare(b.title || "", a.title || "");
    return getSortableTimestamp(b) - getSortableTimestamp(a);
  });

  return result;
}

function getSortableTimestamp(item) {
  if (typeof item.sort_timestamp === "number" && item.sort_timestamp > 0) return item.sort_timestamp;
  for (const field of [item.modified_at, item.created_at]) {
    if (typeof field === "number" && field > 0) return field;
    if (field) {
      const parsed = Date.parse(field);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}
