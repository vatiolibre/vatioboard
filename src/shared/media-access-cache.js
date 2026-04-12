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

const cache = new Map();

function cacheKey(assetName, contentHash) {
  return contentHash ? `${assetName}:${contentHash}` : assetName;
}

export function getCachedMediaAccess(assetName, contentHash) {
  const entry = cache.get(cacheKey(assetName, contentHash));
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt - SAFETY_MARGIN_MS) {
    cache.delete(cacheKey(assetName, contentHash));
    return null;
  }

  return entry.access;
}

export function setCachedMediaAccess(assetName, contentHash, access, expiresInSeconds) {
  cache.set(cacheKey(assetName, contentHash), {
    access,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });
}

export function clearMediaAccessCache(assetName) {
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
