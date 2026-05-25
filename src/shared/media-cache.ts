import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";
import { createChunkedBlobStore } from "./chunked-blob-store.js";
import type { JsonObject } from "../types/storage";

export interface MediaManifestAsset {
  name?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  duration?: number | null;
  track_number?: number | null;
  media_kind?: string | null;
  mime_type?: string | null;
  blob_size?: number | null;
  content_hash?: string | null;
  created_at?: string | number | null;
  modified_at?: string | number | null;
  created_at_label?: string | null;
  modified_at_label?: string | null;
  original_filename?: string;
  file_extension?: string;
  folder_path?: string;
  sort_timestamp?: number;
  has_preview_image?: boolean;
  [key: string]: unknown;
}

export interface MediaManifestSnapshot {
  assets: MediaManifestAsset[];
  token: string | null;
}

interface PersistedMediaManifestSnapshot extends MediaManifestSnapshot {
  cached_at?: number;
}

export type MediaMetadataRecord = JsonObject;

export interface MediaBlobCacheOptions {
  contentHash?: string | null;
  blobSize?: number;
  mediaKind?: string | null;
}

export interface PinnedMediaBlobRecord {
  blob?: Blob;
  content_hash?: string | null;
  pinned_at?: number | null;
}

export interface CachedMediaBlobRecord {
  blob?: Blob;
}

export interface CachedBlobMetaRecord {
  content_hash?: string | null;
  blob_size?: number;
  media_kind?: string | null;
  cached_at?: number | null;
  last_accessed_at?: number | null;
  pinned?: boolean;
}

export interface LocalMediaBlob {
  blob: Blob;
  source: "pinned" | "cached";
  contentHash: string | null;
}

export interface LocalBlobMeta {
  content_hash: string | null;
  pinned: boolean;
  cached_at: number | null;
  last_accessed_at: number | null;
  blob_size: number;
  source: "pinned" | "cached";
}

export type LocalAvailability =
  | "cloud-only"
  | "caching-locally"
  | "available-offline"
  | "outdated-local";

interface ChunkedBlobStore<TRecord extends object> {
  getValue(key: string): Promise<TRecord | undefined>;
  setValue(key: string, value: TRecord): Promise<boolean>;
  deleteValue(key: string): Promise<boolean>;
  streamResponse(key: string, response: Response, meta?: Record<string, unknown>): Promise<boolean>;
}

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

const blobStore = createChunkedBlobStore(
  createIndexedJsonKeyValueStore({
    dbName: BLOB_DB_NAME,
    storeName: BLOB_STORE_NAME,
  }),
) as ChunkedBlobStore<PinnedMediaBlobRecord>;

const cachedBlobStore = createChunkedBlobStore(
  createIndexedJsonKeyValueStore({
    dbName: CACHED_BLOB_DB_NAME,
    storeName: CACHED_BLOB_STORE_NAME,
  }),
) as ChunkedBlobStore<CachedMediaBlobRecord>;

const cachedBlobMetaStore = createIndexedJsonKeyValueStore({
  dbName: CACHED_BLOB_META_DB_NAME,
  storeName: CACHED_BLOB_META_STORE_NAME,
});

// ── User-scoped cache namespace ──────────────────────────────────────

const PERSISTED_USER_KEY = "vatioboard_media_cache_user";

let currentCacheUser: string | null = null;

export function setMediaCacheUser(user: string | null | undefined): void {
  currentCacheUser = user ? String(user).trim().toLowerCase() : null;
  try {
    if (currentCacheUser) {
      localStorage.setItem(PERSISTED_USER_KEY, currentCacheUser);
    } else {
      localStorage.removeItem(PERSISTED_USER_KEY);
    }
  } catch { /* quota/private */ }
}

export function getMediaCacheUser(): string | null {
  return currentCacheUser;
}

/**
 * Restore the last-known cache namespace without a network round-trip.
 * Returns the user string if one was found, or null.
 */
export function restorePersistedMediaCacheUser(): string | null {
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
export function clearPersistedMediaCacheUser(): void {
  currentCacheUser = null;
  try { localStorage.removeItem(PERSISTED_USER_KEY); } catch { /* ignore */ }
}

function userKey(key: string): string | null {
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
export async function cacheMediaMetadata(
  assetName: string,
  metadata: MediaMetadataRecord | null | undefined,
): Promise<boolean> {
  const key = userKey(assetName);
  if (!key || !metadata) return false;
  return metadataStore.setValue(key, {
    ...metadata,
    cached_at: Date.now(),
  } as JsonObject);
}

export async function getCachedMediaMetadata(assetName: string): Promise<MediaMetadataRecord | undefined> {
  const key = userKey(assetName);
  if (!key) return undefined;
  return metadataStore.getValue(key) as Promise<MediaMetadataRecord | undefined>;
}

export async function removeCachedMediaMetadata(assetName: string): Promise<boolean> {
  const key = userKey(assetName);
  if (!key) return false;
  return metadataStore.deleteValue(key);
}

// ── Manifest ─────────────────────────────────────────────────────────

/**
 * Compute a numeric millisecond timestamp at cache time so offline sorting
 * never needs to parse human-readable display labels at runtime.
 */
function computeSortTimestamp(asset: MediaManifestAsset): number {
  for (const field of [asset.modified_at, asset.created_at, asset.modified_at_label, asset.created_at_label]) {
    if (typeof field === "number" && field > 0) return field;
    if (field) {
      const parsed = Date.parse(String(field));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function mapManifestAsset(asset: MediaManifestAsset): MediaManifestAsset {
  return {
    name: asset.name,
    title: asset.title,
    artist: asset.artist || "",
    album: asset.album || "",
    genre: asset.genre || "",
    duration: asset.duration ?? null,
    track_number: asset.track_number ?? null,
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
export async function cacheManifestSnapshot({
  assets,
  token = null,
}: {
  assets: MediaManifestAsset[];
  token?: string | null;
}): Promise<boolean> {
  const key = userKey("__manifest__");
  if (!key || !Array.isArray(assets)) return false;
  return metadataStore.setValue(key, {
    assets: assets.map(mapManifestAsset),
    token: token || null,
    cached_at: Date.now(),
  } as JsonObject);
}

/**
 * Return the full manifest snapshot (assets + optional freshness token).
 * Returns ``null`` when no snapshot is stored.
 */
export async function getCachedManifestSnapshot(): Promise<MediaManifestSnapshot | null> {
  const key = userKey("__manifest__");
  if (!key) return null;
  const result = await metadataStore.getValue(key) as unknown as PersistedMediaManifestSnapshot | undefined;
  if (!result?.assets) return null;
  return { assets: result.assets, token: result.token || null };
}

/** Convenience wrapper — returns the cached asset list or null. */
export async function getCachedMediaManifest(): Promise<MediaManifestAsset[] | null> {
  const snapshot = await getCachedManifestSnapshot();
  return snapshot?.assets || null;
}

/** Convenience wrapper — returns the cached freshness token or null. */
export async function getCachedManifestToken(): Promise<string | null> {
  const snapshot = await getCachedManifestSnapshot();
  return snapshot?.token || null;
}

/** @deprecated Use {@link cacheManifestSnapshot} instead. */
export async function cacheMediaManifest(assets: MediaManifestAsset[]): Promise<boolean> {
  return cacheManifestSnapshot({ assets });
}

/** @deprecated Token is now persisted atomically inside the manifest snapshot. */
export async function cacheManifestToken(): Promise<boolean> {
  return false;
}

// ── Pinned blobs ─────────────────────────────────────────────────────

export async function pinMediaBlob(
  assetName: string,
  blob: Blob,
  { contentHash }: { contentHash?: string | null } = {},
): Promise<boolean> {
  const key = userKey(assetName);
  if (!key || !(blob instanceof Blob)) return false;
  return blobStore.setValue(key, {
    blob,
    content_hash: contentHash || null,
    pinned_at: Date.now(),
  });
}

/**
 * Pin a media asset by streaming a fetch Response directly into IndexedDB.
 *
 * Unlike {@link pinMediaBlob} this never calls `response.blob()` — the
 * body is read via ReadableStream and each chunk is written to IndexedDB
 * individually, keeping peak memory usage proportional to one chunk size
 * (~5 MB) instead of the full file.  This avoids per-object memory limits
 * on constrained browsers (Tesla Chromium).
 *
 * @param {string}   assetName
 * @param {Response} response   Unconsumed fetch Response.
 * @param {{ contentHash?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function pinMediaFromResponse(
  assetName: string,
  response: Response,
  { contentHash }: { contentHash?: string | null } = {},
): Promise<boolean> {
  const key = userKey(assetName);
  if (!key || !response) return false;
  return blobStore.streamResponse(key, response, {
    content_hash: contentHash || null,
    pinned_at: Date.now(),
  });
}

export async function getPinnedMediaBlob(assetName: string): Promise<Blob | null> {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await blobStore.getValue(key);
  return entry?.blob || null;
}

export async function getPinnedBlobMeta(
  assetName: string,
): Promise<{ content_hash: string | null; pinned_at: number | null } | null> {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await blobStore.getValue(key);
  if (!entry) return null;
  return {
    content_hash: entry.content_hash || null,
    pinned_at: entry.pinned_at || null,
  };
}

export async function unpinMediaBlob(assetName: string): Promise<boolean> {
  const key = userKey(assetName);
  if (!key) return false;
  return blobStore.deleteValue(key);
}

export async function isMediaBlobPinned(assetName: string): Promise<boolean> {
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
export function isAutoCacheEligible(item: MediaManifestAsset | null | undefined): boolean {
  if (!item) return false;
  const kind = String(item.media_kind || "").toLowerCase();
  if (!AUTO_CACHE_ELIGIBLE_KINDS.includes(kind)) return false;
  if (typeof item.blob_size === "number" && item.blob_size > AUTO_CACHE_MAX_BYTES) return false;
  return true;
}

// ── Non-pinned cached blobs ──────────────────────────────────────────

/** In-flight download promises keyed by user-scoped asset key. */
const _inFlightCacheDownloads = new Map<string, Promise<unknown>>();

/**
 * Store a non-pinned cached blob in IndexedDB.
 *
 * @param {string} assetName
 * @param {Blob} blob
 * @param {{ contentHash?: string, blobSize?: number, mediaKind?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function cacheMediaBlob(
  assetName: string,
  blob: Blob,
  { contentHash, blobSize, mediaKind }: MediaBlobCacheOptions = {},
): Promise<boolean> {
  const key = userKey(assetName);
  if (!key || !(blob instanceof Blob)) return false;

  const now = Date.now();
  const size = blobSize ?? blob.size ?? 0;

  // Write blob first, then meta.  If either step fails, roll back the
  // other so we never leave orphaned state across the two stores.
  let blobOk;
  try {
    blobOk = await cachedBlobStore.setValue(key, { blob });
  } catch {
    return false;
  }

  let metaOk;
  try {
    metaOk = await cachedBlobMetaStore.setValue(key, {
      content_hash: contentHash || null,
      blob_size: size,
      media_kind: mediaKind || null,
      cached_at: now,
      last_accessed_at: now,
      pinned: false,
    });
  } catch {
    // Meta write failed — remove the blob to avoid orphaned data.
    cachedBlobStore.deleteValue(key).catch(() => {});
    return false;
  }

  if (!metaOk) {
    cachedBlobStore.deleteValue(key).catch(() => {});
    return false;
  }
  if (!blobOk) {
    cachedBlobMetaStore.deleteValue(key).catch(() => {});
    return false;
  }

  return true;
}

/**
 * Cache a media asset by streaming a fetch Response directly into IndexedDB.
 *
 * Streaming variant of {@link cacheMediaBlob} — reads the response body
 * via ReadableStream so the full blob is never materialised in memory.
 *
 * @param {string}   assetName
 * @param {Response} response   Unconsumed fetch Response.
 * @param {{ contentHash?: string, blobSize?: number, mediaKind?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function cacheMediaFromResponse(
  assetName: string,
  response: Response,
  { contentHash, blobSize, mediaKind }: MediaBlobCacheOptions = {},
): Promise<boolean> {
  const key = userKey(assetName);
  if (!key || !response) return false;

  const now = Date.now();

  let blobOk;
  try {
    blobOk = await cachedBlobStore.streamResponse(key, response);
  } catch {
    return false;
  }

  if (!blobOk) return false;

  // Determine total size: prefer caller-provided, else read manifest.
  let size = blobSize ?? 0;
  if (!size) {
    try {
      const record = await cachedBlobStore.getValue(key);
      size = record?.blob?.size ?? 0;
    } catch { /* use 0 */ }
  }

  let metaOk;
  try {
    metaOk = await cachedBlobMetaStore.setValue(key, {
      content_hash: contentHash || null,
      blob_size: size,
      media_kind: mediaKind || null,
      cached_at: now,
      last_accessed_at: now,
      pinned: false,
    });
  } catch {
    cachedBlobStore.deleteValue(key).catch(() => {});
    return false;
  }

  if (!metaOk) {
    cachedBlobStore.deleteValue(key).catch(() => {});
    return false;
  }

  return true;
}

/**
 * Retrieve a non-pinned cached blob.
 * Returns null when no cached blob exists.
 */
export async function getCachedMediaBlob(assetName: string): Promise<Blob | null> {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await cachedBlobStore.getValue(key);
  return entry?.blob || null;
}

/**
 * Retrieve metadata for a non-pinned cached blob.
 * Returns null when no cached blob metadata exists.
 */
export async function getCachedBlobMeta(assetName: string): Promise<CachedBlobMetaRecord | null> {
  const key = userKey(assetName);
  if (!key) return null;
  const entry = await cachedBlobMetaStore.getValue(key) as CachedBlobMetaRecord | undefined;
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
export async function touchCachedBlobAccess(assetName: string): Promise<boolean> {
  const key = userKey(assetName);
  if (!key) return false;
  const entry = await cachedBlobMetaStore.getValue(key) as CachedBlobMetaRecord | undefined;
  if (!entry) return false;
  return cachedBlobMetaStore.setValue(key, {
    ...entry,
    last_accessed_at: Date.now(),
  } as JsonObject);
}

/**
 * Remove a non-pinned cached blob and its metadata.
 */
export async function removeCachedMediaBlob(assetName: string): Promise<boolean> {
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
export async function getLocalMediaBlob(assetName: string): Promise<LocalMediaBlob | null> {
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
    const meta = await cachedBlobMetaStore.getValue(key).catch(() => null) as CachedBlobMetaRecord | null;
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
export async function getLocalBlobMeta(assetName: string): Promise<LocalBlobMeta | null> {
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

  const cachedMeta = await cachedBlobMetaStore.getValue(key) as CachedBlobMetaRecord | undefined;
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
export function isAutoCacheInFlight(assetName: string): boolean {
  const key = userKey(assetName);
  return key ? _inFlightCacheDownloads.has(key) : false;
}

/**
 * Register an in-flight auto-cache download.
 *
 * Accepts a **factory function** that produces the download promise.
 * The factory is invoked only when no download is already running for
 * the same asset — this prevents the caller from starting network work
 * before the dedup guard has claimed ownership.
 *
 * Returns ``true`` when the caller's factory won and the download was
 * started, or ``false`` when a download was already in progress.
 */
export function registerAutoCacheDownload(
  assetName: string,
  factoryFn:
    | PromiseLike<unknown>
    | (() => PromiseLike<unknown> | null | undefined)
    | null
    | undefined,
): boolean {
  const key = userKey(assetName);
  if (!key) return false;
  if (_inFlightCacheDownloads.has(key)) return false;

  const downloadPromise = typeof factoryFn === "function" ? factoryFn() : factoryFn;
  if (!downloadPromise || typeof downloadPromise.then !== "function") return false;

  const cleanup = () => { _inFlightCacheDownloads.delete(key); };
  const tracked = Promise.resolve(downloadPromise).then(cleanup, cleanup);
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
export function deriveLocalAvailability(
  item: { name?: string | null } | null | undefined,
  {
    pinnedNames,
    stalePinnedNames,
  }: { pinnedNames?: Set<string>; stalePinnedNames?: Set<string> } = {},
): LocalAvailability {
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
