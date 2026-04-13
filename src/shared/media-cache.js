import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";

const METADATA_DB_NAME = "vatioboard_media_metadata";
const METADATA_STORE_NAME = "metadata";
const BLOB_DB_NAME = "vatioboard_media_blobs";
const BLOB_STORE_NAME = "blobs";
const CACHED_BLOB_DB_NAME = "vatioboard_media_cached_blobs";
const CACHED_BLOB_STORE_NAME = "cached_blobs";
const CACHED_BLOB_META_DB_NAME = "vatioboard_media_cached_blob_meta";
const CACHED_BLOB_META_STORE_NAME = "cached_blob_meta";

const metadataStore = createIndexedJsonKeyValueStore({
  dbName: METADATA_DB_NAME,
  storeName: METADATA_STORE_NAME,
});

const blobStore = createIndexedJsonKeyValueStore({
  dbName: BLOB_DB_NAME,
  storeName: BLOB_STORE_NAME,
});

const cachedBlobStore = createIndexedJsonKeyValueStore({
  dbName: CACHED_BLOB_DB_NAME,
  storeName: CACHED_BLOB_STORE_NAME,
});

const cachedBlobMetaStore = createIndexedJsonKeyValueStore({
  dbName: CACHED_BLOB_META_DB_NAME,
  storeName: CACHED_BLOB_META_STORE_NAME,
});

// ── User-scoped cache namespace ──────────────────────────────────────

const PERSISTED_USER_KEY = "vatioboard_media_cache_user";

let currentCacheUser = null;

export function setMediaCacheUser(user) {
  currentCacheUser = user ? String(user).trim().toLowerCase() : null;
  try {
    if (currentCacheUser) {
      localStorage.setItem(PERSISTED_USER_KEY, currentCacheUser);
    } else {
      localStorage.removeItem(PERSISTED_USER_KEY);
    }
  } catch { /* quota/private */ }
}

export function getMediaCacheUser() {
  return currentCacheUser;
}

/**
 * Restore the last-known cache namespace without a network round-trip.
 * Returns the user string if one was found, or null.
 */
export function restorePersistedMediaCacheUser() {
  if (currentCacheUser) return currentCacheUser;
  try {
    const stored = localStorage.getItem(PERSISTED_USER_KEY);
    if (stored) {
      currentCacheUser = stored;
      return currentCacheUser;
    }
  } catch { /* unavailable */ }
  return null;
}

/**
 * Erase the persisted namespace entirely.
 * Called on explicit logout to prevent offline reuse.
 */
export function clearPersistedMediaCacheUser() {
  currentCacheUser = null;
  try { localStorage.removeItem(PERSISTED_USER_KEY); } catch { /* ignore */ }
}

function userKey(key) {
  if (!currentCacheUser) return null;
  return `${currentCacheUser}:${key}`;
}

// ── Metadata ─────────────────────────────────────────────────────────

/**
 * Persist per-asset detail metadata to IndexedDB.
 *
 * **Durable cache contract**: this record is stored for offline access.
 * All URL fields persisted here MUST be stable BFF-origin URLs (e.g.
 * ``/api/method/…download_my_media_asset?name=X``).  Presigned object-
 * storage URLs are **never** safe to persist — they expire and leak
 * credentials.  Signed URLs live only in the in-memory access cache
 * (media-access-cache.js).
 */
export async function cacheMediaMetadata(assetName, metadata) {
  const key = userKey(assetName);
  if (!key || !metadata) return false;
  return metadataStore.setValue(key, {
    ...metadata,
    cached_at: Date.now(),
  });
}

export async function getCachedMediaMetadata(assetName) {
  const key = userKey(assetName);
  if (!key) return undefined;
  return metadataStore.getValue(key);
}

export async function removeCachedMediaMetadata(assetName) {
  const key = userKey(assetName);
  if (!key) return false;
  return metadataStore.deleteValue(key);
}

// ── Manifest ─────────────────────────────────────────────────────────

/**
 * Compute a numeric millisecond timestamp at cache time so offline sorting
 * never needs to parse human-readable display labels at runtime.
 */
function computeSortTimestamp(asset) {
  for (const field of [asset.modified_at, asset.created_at, asset.modified_at_label, asset.created_at_label]) {
    if (typeof field === "number" && field > 0) return field;
    if (field) {
      const parsed = Date.parse(field);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function mapManifestAsset(asset) {
  return {
    name: asset.name,
    title: asset.title,
    media_kind: asset.media_kind,
    mime_type: asset.mime_type,
    blob_size: asset.blob_size,
    content_hash: asset.content_hash,
    created_at: asset.created_at,
    modified_at: asset.modified_at,
    created_at_label: asset.created_at_label,
    modified_at_label: asset.modified_at_label,
    original_filename: asset.original_filename,
    file_extension: asset.file_extension || "",
    folder_path: asset.folder_path,
    sort_timestamp: computeSortTimestamp(asset),
    has_preview_image: Boolean(asset.has_preview_image),
  };
}

/**
 * Persist the manifest snapshot atomically — assets and freshness token
 * are written as a single IndexedDB record so they can never be out of
 * sync.  Pass ``token: null`` for truncated manifests that should not be
 * considered canonical/fresh.
 */
export async function cacheManifestSnapshot({ assets, token = null }) {
  const key = userKey("__manifest__");
  if (!key || !Array.isArray(assets)) return false;
  return metadataStore.setValue(key, {
    assets: assets.map(mapManifestAsset),
    token: token || null,
    cached_at: Date.now(),
  });
}

/**
 * Return the full manifest snapshot (assets + optional freshness token).
 * Returns ``null`` when no snapshot is stored.
 */
export async function getCachedManifestSnapshot() {
  const key = userKey("__manifest__");
  if (!key) return null;
  const result = await metadataStore.getValue(key);
  if (!result?.assets) return null;
  return { assets: result.assets, token: result.token || null };
}

/** Convenience wrapper — returns the cached asset list or null. */
export async function getCachedMediaManifest() {
  const snapshot = await getCachedManifestSnapshot();
  return snapshot?.assets || null;
}

/** Convenience wrapper — returns the cached freshness token or null. */
export async function getCachedManifestToken() {
  const snapshot = await getCachedManifestSnapshot();
  return snapshot?.token || null;
}

/** @deprecated Use {@link cacheManifestSnapshot} instead. */
export async function cacheMediaManifest(assets) {
  return cacheManifestSnapshot({ assets });
}

/** @deprecated Token is now persisted atomically inside the manifest snapshot. */
export async function cacheManifestToken() {
  return false;
}

// ── Pinned blobs ─────────────────────────────────────────────────────

export async function pinMediaBlob(assetName, blob, { contentHash } = {}) {
  const key = userKey(assetName);
  if (!key || !(blob instanceof Blob)) return false;
  return blobStore.setValue(key, {
    blob,
    content_hash: contentHash || null,
    pinned_at: Date.now(),
  });
}

export async function getPinnedMediaBlob(assetName) {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await blobStore.getValue(key);
  return entry?.blob || null;
}

export async function getPinnedBlobMeta(assetName) {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await blobStore.getValue(key);
  if (!entry) return null;
  return {
    content_hash: entry.content_hash || null,
    pinned_at: entry.pinned_at || null,
  };
}

export async function unpinMediaBlob(assetName) {
  const key = userKey(assetName);
  if (!key) return false;
  return blobStore.deleteValue(key);
}

export async function isMediaBlobPinned(assetName) {
  const key = userKey(assetName);
  if (!key) return false;
  const entry = await blobStore.getValue(key);
  return entry != null;
}

// ── Auto-cache policy ────────────────────────────────────────────────

/** Maximum blob size (bytes) eligible for auto-caching. Default 50 MB. */
export const AUTO_CACHE_MAX_BYTES = 50 * 1024 * 1024;

/** Media kinds eligible for auto-cache-on-play/open. */
export const AUTO_CACHE_ELIGIBLE_KINDS = Object.freeze(["audio", "image"]);

/**
 * Returns true when a media item is eligible for auto-caching on play/open.
 */
export function isAutoCacheEligible(item) {
  if (!item) return false;
  const kind = String(item.media_kind || "").toLowerCase();
  if (!AUTO_CACHE_ELIGIBLE_KINDS.includes(kind)) return false;
  if (typeof item.blob_size === "number" && item.blob_size > AUTO_CACHE_MAX_BYTES) return false;
  return true;
}

// ── Non-pinned cached blobs ──────────────────────────────────────────

/** In-flight download promises keyed by user-scoped asset key. */
const _inFlightCacheDownloads = new Map();

/**
 * Store a non-pinned cached blob in IndexedDB.
 *
 * @param {string} assetName
 * @param {Blob} blob
 * @param {{ contentHash?: string, blobSize?: number, mediaKind?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function cacheMediaBlob(assetName, blob, { contentHash, blobSize, mediaKind } = {}) {
  const key = userKey(assetName);
  if (!key || !(blob instanceof Blob)) return false;

  const now = Date.now();
  const size = blobSize ?? blob.size ?? 0;

  const [blobOk, metaOk] = await Promise.all([
    cachedBlobStore.setValue(key, { blob }),
    cachedBlobMetaStore.setValue(key, {
      content_hash: contentHash || null,
      blob_size: size,
      media_kind: mediaKind || null,
      cached_at: now,
      last_accessed_at: now,
      pinned: false,
    }),
  ]);

  return blobOk && metaOk;
}

/**
 * Retrieve a non-pinned cached blob.
 * Returns null when no cached blob exists.
 */
export async function getCachedMediaBlob(assetName) {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await cachedBlobStore.getValue(key);
  return entry?.blob || null;
}

/**
 * Retrieve metadata for a non-pinned cached blob.
 * Returns null when no cached blob metadata exists.
 */
export async function getCachedBlobMeta(assetName) {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await cachedBlobMetaStore.getValue(key);
  if (!entry) return null;
  return {
    content_hash: entry.content_hash || null,
    blob_size: entry.blob_size ?? 0,
    media_kind: entry.media_kind || null,
    cached_at: entry.cached_at || null,
    last_accessed_at: entry.last_accessed_at || null,
    pinned: false,
  };
}

/**
 * Update last_accessed_at for a cached blob (touch on use).
 */
export async function touchCachedBlobAccess(assetName) {
  const key = userKey(assetName);
  if (!key) return false;
  const entry = await cachedBlobMetaStore.getValue(key);
  if (!entry) return false;
  return cachedBlobMetaStore.setValue(key, {
    ...entry,
    last_accessed_at: Date.now(),
  });
}

/**
 * Remove a non-pinned cached blob and its metadata.
 */
export async function removeCachedMediaBlob(assetName) {
  const key = userKey(assetName);
  if (!key) return false;
  const [a, b] = await Promise.all([
    cachedBlobStore.deleteValue(key),
    cachedBlobMetaStore.deleteValue(key),
  ]);
  return a || b;
}

/**
 * Get the best local blob for an asset, preferring pinned over cached.
 *
 * Returns ``{ blob, source, contentHash }`` or null.
 * ``source`` is ``"pinned"`` or ``"cached"``.
 */
export async function getLocalMediaBlob(assetName) {
  const key = userKey(assetName);
  if (!key) return null;

  // Pinned blobs have highest priority.
  const pinnedEntry = await blobStore.getValue(key);
  if (pinnedEntry?.blob) {
    return {
      blob: pinnedEntry.blob,
      source: "pinned",
      contentHash: pinnedEntry.content_hash || null,
    };
  }

  // Non-pinned cache is second priority.
  const cachedEntry = await cachedBlobStore.getValue(key);
  if (cachedEntry?.blob) {
    // Touch access time in background.
    touchCachedBlobAccess(assetName).catch(() => {});
    const meta = await cachedBlobMetaStore.getValue(key).catch(() => null);
    return {
      blob: cachedEntry.blob,
      source: "cached",
      contentHash: meta?.content_hash || null,
    };
  }

  return null;
}

/**
 * Get combined metadata for any local blob (pinned or cached).
 */
export async function getLocalBlobMeta(assetName) {
  const key = userKey(assetName);
  if (!key) return null;

  const pinnedEntry = await blobStore.getValue(key);
  if (pinnedEntry) {
    return {
      content_hash: pinnedEntry.content_hash || null,
      pinned: true,
      cached_at: pinnedEntry.pinned_at || null,
      last_accessed_at: null,
      blob_size: pinnedEntry.blob?.size ?? 0,
      source: "pinned",
    };
  }

  const cachedMeta = await cachedBlobMetaStore.getValue(key);
  if (cachedMeta) {
    return {
      content_hash: cachedMeta.content_hash || null,
      pinned: false,
      cached_at: cachedMeta.cached_at || null,
      last_accessed_at: cachedMeta.last_accessed_at || null,
      blob_size: cachedMeta.blob_size ?? 0,
      source: "cached",
    };
  }

  return null;
}

/**
 * Check whether an in-flight auto-cache download is already running
 * for the given asset.
 */
export function isAutoCacheInFlight(assetName) {
  const key = userKey(assetName);
  return key ? _inFlightCacheDownloads.has(key) : false;
}

/**
 * Register an in-flight auto-cache download promise.
 * Returns false if one is already in progress (dedup).
 * The promise is removed from the map when it settles.
 */
export function registerAutoCacheDownload(assetName, downloadPromise) {
  const key = userKey(assetName);
  if (!key) return false;
  if (_inFlightCacheDownloads.has(key)) return false;

  const cleanup = () => { _inFlightCacheDownloads.delete(key); };
  const tracked = downloadPromise.then(cleanup, cleanup);
  _inFlightCacheDownloads.set(key, tracked);
  return true;
}

/**
 * Derive the local availability state for a media item.
 *
 * @param {object} item - Media asset with name/content_hash fields.
 * @param {{ pinnedNames?: Set, stalePinnedNames?: Set }} [state]
 * @returns {"cloud-only"|"caching-locally"|"available-offline"|"outdated-local"}
 */
export function deriveLocalAvailability(item, { pinnedNames, stalePinnedNames } = {}) {
  if (!item?.name) return "cloud-only";

  // Check pinned state (passed from library state sets).
  const isPinned = pinnedNames?.has(item.name);
  if (isPinned) {
    const isStale = stalePinnedNames?.has(item.name);
    return isStale ? "outdated-local" : "available-offline";
  }

  // Check non-pinned cache in-flight.
  if (isAutoCacheInFlight(item.name)) return "caching-locally";

  // Synchronous check not possible for IndexedDB — caller should use
  // getLocalBlobMeta() for a definitive answer.  Return cloud-only as
  // the safe default for render-time.
  return "cloud-only";
}
