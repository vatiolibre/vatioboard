/**
 * In-memory ephemeral cache for resolved media access URLs.
 *
 * Signed object-storage URLs must never be persisted to IndexedDB.
 * This cache lives only in JavaScript memory for the current page session.
 *
 * The cache key is `name:content_hash` so that a re-uploaded asset
 * (different content_hash) never returns stale signed URLs.
 */

const SAFETY_MARGIN_MS = 30_000;

export interface MediaAssetAccess {
  playback_url?: string;
  download_url?: string;
  export_url?: string;
  image_url?: string;
  preview_image_url?: string;
  expires_in_seconds?: number;
  [key: string]: unknown;
}

interface MediaAccessCacheEntry {
  access: MediaAssetAccess;
  expiresAt: number;
}

const cache = new Map<string, MediaAccessCacheEntry>();

function cacheKey(assetName: string, contentHash?: string | null): string {
  return contentHash ? `${assetName}:${contentHash}` : assetName;
}

export function getCachedMediaAccess(assetName: string, contentHash?: string | null): MediaAssetAccess | null {
  const entry = cache.get(cacheKey(assetName, contentHash));
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt - SAFETY_MARGIN_MS) {
    cache.delete(cacheKey(assetName, contentHash));
    return null;
  }

  return entry.access;
}

export function setCachedMediaAccess(
  assetName: string,
  contentHash: string | null | undefined,
  access: MediaAssetAccess,
  expiresInSeconds: number,
): void {
  cache.set(cacheKey(assetName, contentHash), {
    access,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });
}

export function clearMediaAccessCache(assetName?: string): void {
  if (assetName) {
    // Clear all entries whose key starts with the asset name.
    for (const key of [...cache.keys()]) {
      if (key === assetName || key.startsWith(`${assetName}:`)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}
