import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";

const METADATA_DB_NAME = "vatioboard_media_metadata";
const METADATA_STORE_NAME = "metadata";
const BLOB_DB_NAME = "vatioboard_media_blobs";
const BLOB_STORE_NAME = "blobs";

const metadataStore = createIndexedJsonKeyValueStore({
  dbName: METADATA_DB_NAME,
  storeName: METADATA_STORE_NAME,
});

const blobStore = createIndexedJsonKeyValueStore({
  dbName: BLOB_DB_NAME,
  storeName: BLOB_STORE_NAME,
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

export async function cacheMediaManifest(assets) {
  const key = userKey("__manifest__");
  if (!key || !Array.isArray(assets)) return false;
  return metadataStore.setValue(key, {
    assets: assets.map((asset) => ({
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
      folder_path: asset.folder_path,
      sort_timestamp: computeSortTimestamp(asset),
    })),
    cached_at: Date.now(),
  });
}

export async function getCachedMediaManifest() {
  const key = userKey("__manifest__");
  if (!key) return null;
  const result = await metadataStore.getValue(key);
  return result?.assets || null;
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
