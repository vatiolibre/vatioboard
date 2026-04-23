import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";
import { createChunkedBlobStore } from "./chunked-blob-store.js";
import { normalizeTrack } from "./track-model.js";
import { isDemoTrackName } from "./track-source-policy.js";

const DEMO_PLAYLIST_DB_NAME = "vatioboard_demo_playlist";
const DEMO_PLAYLIST_STORE_NAME = "demo_playlist";
const DEMO_TRACK_DB_NAME = "vatioboard_demo_track_blobs";
const DEMO_TRACK_STORE_NAME = "demo_track_blobs";
const DEMO_PLAYLIST_KEY = "__demo_playlist_v1__";
export const DEMO_PLAYLIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const demoPlaylistStore = createIndexedJsonKeyValueStore({
  dbName: DEMO_PLAYLIST_DB_NAME,
  storeName: DEMO_PLAYLIST_STORE_NAME,
});

const demoTrackStore = createChunkedBlobStore(
  createIndexedJsonKeyValueStore({
    dbName: DEMO_TRACK_DB_NAME,
    storeName: DEMO_TRACK_STORE_NAME,
  }),
);

const inFlightDemoTrackDownloads = new Map();

function isDemoTrack(assetName, track = {}) {
  return Boolean(
    isDemoTrackName(assetName)
      || isDemoTrackName(track?.name)
      || track?._demo === true,
  );
}

function getDemoTrackKey(assetName, track = {}) {
  const key = String(assetName || track?.name || "").trim();
  return isDemoTrack(key, track) ? key : "";
}

function toStoredDemoTrack(track) {
  const normalized = normalizeTrack(track);
  if (!normalized?._demo || !normalized.src) return null;

  return {
    name: normalized.name,
    title: normalized.title,
    artist: normalized.artist,
    album: normalized.album,
    genre: normalized.genre,
    duration: normalized.duration,
    track_number: normalized.track_number,
    artwork_ref: normalized.artwork_ref,
    media_kind: normalized.media_kind,
    original_filename: normalized.original_filename,
    content_hash: normalized.content_hash,
    mime_type: normalized.mime_type,
    blob_size: normalized.blob_size,
    file_extension: normalized.file_extension,
    folder_path: normalized.folder_path,
    src: normalized.src,
    has_preview_image: normalized.has_preview_image,
    has_artwork: normalized.has_artwork,
    created_at: normalized.created_at,
    modified_at: normalized.modified_at,
    sort_timestamp: normalized.sort_timestamp,
    _demo: true,
  };
}

function normalizeStoredDemoTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .map((track) => normalizeTrack(track))
    .filter((track) => track?._demo && Boolean(track.src));
}

function getTrackSignature(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return "";
  return tracks.map((track) => [
    track?.name || "",
    track?.src || "",
    track?.title || "",
    track?.content_hash || "",
    String(track?.duration ?? ""),
  ].join("\u001f")).join("\u001e");
}

async function fetchDemoPlaylist({ fetchFn = fetch } = {}) {
  try {
    const response = await fetchFn("/audio/demo/playlist.json");
    if (!response?.ok) return null;
    const raw = await response.json();
    const tracks = normalizeStoredDemoTracks(raw);
    await cacheDemoPlaylistSnapshot(tracks);
    return {
      tracks,
      cachedAt: Date.now(),
      signature: getTrackSignature(tracks),
    };
  } catch {
    return null;
  }
}

export async function cacheDemoPlaylistSnapshot(tracks) {
  const normalized = Array.isArray(tracks)
    ? tracks.map(toStoredDemoTrack).filter(Boolean)
    : [];

  if (normalized.length === 0) return false;

  return demoPlaylistStore.setValue(DEMO_PLAYLIST_KEY, {
    tracks: normalized,
    cached_at: Date.now(),
  });
}

export async function getCachedDemoPlaylistSnapshot() {
  const snapshot = await demoPlaylistStore.getValue(DEMO_PLAYLIST_KEY);
  if (!Array.isArray(snapshot?.tracks) || snapshot.tracks.length === 0) return null;

  const tracks = normalizeStoredDemoTracks(snapshot.tracks);
  if (tracks.length === 0) return null;

  return {
    tracks,
    cachedAt: Number(snapshot.cached_at) || 0,
    signature: getTrackSignature(tracks),
  };
}

export async function loadDemoPlaylist({ fetchFn = fetch } = {}) {
  const cached = await getCachedDemoPlaylistSnapshot().catch(() => null);
  if (cached?.tracks?.length) {
    return {
      tracks: cached.tracks,
      source: "cache",
      cachedAt: cached.cachedAt,
      signature: cached.signature,
    };
  }

  const fresh = await fetchDemoPlaylist({ fetchFn });
  if (fresh?.tracks?.length) {
    return {
      tracks: fresh.tracks,
      source: "network",
      cachedAt: fresh.cachedAt,
      signature: fresh.signature,
    };
  }

  return {
    tracks: [],
    source: "empty",
    cachedAt: 0,
    signature: "",
  };
}

export async function syncDemoPlaylist({
  fetchFn = fetch,
  maxAgeMs = DEMO_PLAYLIST_CACHE_TTL_MS,
} = {}) {
  const cached = await getCachedDemoPlaylistSnapshot().catch(() => null);
  const cachedAgeMs = cached?.cachedAt ? Math.max(0, Date.now() - cached.cachedAt) : Number.POSITIVE_INFINITY;

  if (cached && cachedAgeMs < maxAgeMs) {
    return {
      refreshed: false,
      changed: false,
      tracks: cached.tracks,
      source: "cache",
    };
  }

  const fresh = await fetchDemoPlaylist({ fetchFn });
  if (!fresh?.tracks?.length) {
    return {
      refreshed: false,
      changed: false,
      tracks: cached?.tracks || [],
      source: cached ? "cache" : "empty",
    };
  }

  return {
    refreshed: true,
    changed: fresh.signature !== (cached?.signature || ""),
    tracks: fresh.tracks,
    source: "network",
  };
}

export async function getCachedDemoTrackBlob(assetName, track = {}) {
  const key = getDemoTrackKey(assetName, track);
  if (!key) return null;

  const entry = await demoTrackStore.getValue(key);
  if (!(entry?.blob instanceof Blob)) return null;

  const expectedSrc = String(track?.src || "");
  if (expectedSrc && entry.src && entry.src !== expectedSrc) {
    return null;
  }

  return {
    blob: entry.blob,
    src: String(entry.src || ""),
    mimeType: String(entry.mime_type || entry.blob.type || ""),
    blobSize: Number(entry.blob_size) || entry.blob.size || 0,
    cachedAt: Number(entry.cached_at) || 0,
  };
}

async function cacheDemoTrackResponse(assetName, track, response) {
  const key = getDemoTrackKey(assetName, track);
  if (!key || !response) return false;

  const contentLength = Number(response.headers?.get("content-length"));

  return demoTrackStore.streamResponse(key, response, {
    src: String(track?.src || ""),
    mime_type: response.headers?.get("content-type") || String(track?.mime_type || ""),
    blob_size: Number.isFinite(contentLength) ? contentLength : Number(track?.blob_size) || 0,
    cached_at: Date.now(),
  });
}

export function triggerDemoTrackCache(assetName, track, {
  fetchFn = fetch,
  onCached,
  onFailed,
} = {}) {
  const key = getDemoTrackKey(assetName, track);
  if (!key || !track?.src) {
    if (typeof onFailed === "function") {
      try { onFailed("no_source"); } catch { /* ignore */ }
    }
    return;
  }

  if (inFlightDemoTrackDownloads.has(key)) {
    if (typeof onFailed === "function") {
      try { onFailed("already_in_flight"); } catch { /* ignore */ }
    }
    return;
  }

  const download = (async () => {
    try {
      const existing = await getCachedDemoTrackBlob(assetName, track).catch(() => null);
      if (existing?.blob) {
        if (typeof onCached === "function") {
          try { onCached(); } catch { /* ignore */ }
        }
        return;
      }

      const response = await fetchFn(track.src);
      if (!response?.ok) {
        if (typeof onFailed === "function") {
          try { onFailed("fetch_failed"); } catch { /* ignore */ }
        }
        return;
      }

      const ok = await cacheDemoTrackResponse(assetName, track, response);
      if (ok) {
        if (typeof onCached === "function") {
          try { onCached(); } catch { /* ignore */ }
        }
      } else if (typeof onFailed === "function") {
        try { onFailed("cache_failed"); } catch { /* ignore */ }
      }
    } catch {
      if (typeof onFailed === "function") {
        try { onFailed("fetch_failed"); } catch { /* ignore */ }
      }
    } finally {
      inFlightDemoTrackDownloads.delete(key);
    }
  })();

  inFlightDemoTrackDownloads.set(key, download);
}
