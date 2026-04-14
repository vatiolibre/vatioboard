import {
  getLocalMediaBlob,
  getLocalBlobMeta,
  isAutoCacheEligible,
  registerAutoCacheDownload,
  cacheMediaBlob,
} from "./media-cache.js";
import { getEnvironmentConfig } from "./environment.js";
import {
  fetchBackendMediaAssetBlob,
  getBackendMediaAssetAccess,
  getProtectedMediaRequestGate,
} from "./backend-auth.js";
import { getCachedMediaAccess, setCachedMediaAccess } from "./media-access-cache.js";

function isAbortError(error) {
  return Boolean(
    error
    && (
      error.name === "AbortError"
      || error.code === 20
    )
  );
}

/**
 * Resolve the best available audio source for a media asset.
 *
 * Resolution order (local-first):
 *  1. Pinned blob from IndexedDB
 *  2. Cached blob from IndexedDB
 *  3. Remote playback URL (BFF streaming endpoint)
 *
 * Returns an object describing the resolved source so consumers can
 * decide how to start playback and whether to trigger background caching.
 *
 * @param {string} assetName
 * @param {{ content_hash?: string, media_kind?: string, playback_url?: string, download_url?: string }} [asset]
 * @returns {Promise<{ src: string, type: "blob"|"remote", blob?: Blob, revokeUrl?: () => void } | null>}
 */
export async function resolveAudioSource(assetName, asset) {
  if (!assetName) return null;

  // 1. Try local blob (pinned > cached, handled by getLocalMediaBlob)
  try {
    const local = await getLocalMediaBlob(assetName);
    if (local?.blob) {
      // Staleness check: if both local and remote content_hash exist
      // and differ, treat the local blob as stale — skip to remote.
      const localHash = local.contentHash;
      const remoteHash = asset?.content_hash;
      if (localHash && remoteHash && localHash !== remoteHash) {
        // Stale local blob — fall through to remote
      } else {
        const url = URL.createObjectURL(local.blob);
        return {
          src: url,
          type: "blob",
          blob: local.blob,
          source: local.source,
          contentHash: local.contentHash,
          revokeUrl() { URL.revokeObjectURL(url); },
        };
      }
    }
  } catch {
    // IndexedDB unavailable — fall through to remote
  }

  // 2. Remote playback URL via signed access endpoint
  const remoteSrc = await resolveRemotePlaybackUrl(assetName, asset);
  if (remoteSrc) {
    return { src: remoteSrc, type: "remote", revokeUrl() {} };
  }

  return null;
}

/**
 * Resolve a signed playback URL for a media asset.
 *
 * Uses the BFF access endpoint with `intent: "playback"` and caches
 * the result in the ephemeral in-memory access cache.
 *
 * @param {string} assetName
 * @param {{ content_hash?: string }} [asset]
 * @returns {Promise<string|null>}
 */
async function resolveRemotePlaybackUrl(assetName, asset) {
  if (!assetName) return null;
  const hash = asset?.content_hash || null;

  // Check in-memory cache first
  const cached = getCachedMediaAccess(assetName, hash);
  if (cached?.playback_url) return cached.playback_url;

  let gate = null;
  try {
    gate = await getProtectedMediaRequestGate();
    if (!gate.allowed) return null;

    const result = await getBackendMediaAssetAccess({
      name: assetName,
      intent: "playback",
      signal: gate.signal,
    });
    if (result?.access?.playback_url) {
      const expiry = Number(result.access.expires_in_seconds) || 300;
      setCachedMediaAccess(assetName, result.asset?.content_hash || hash, result.access, expiry);
      return result.access.playback_url;
    }
  } catch (error) {
    if (!isAbortError(error)) {
      // offline or error — no remote playback available
    }
  } finally {
    gate?.cleanup?.();
  }

  return null;
}

/**
 * Build a stable BFF streaming URL for a media asset.
 * Used ONLY for background cache downloads (not for playback).
 * Never returns signed/expiring URLs — those are resolved on demand
 * by the backend auth layer.
 */
export function buildRemotePlaybackUrl(assetName, asset) {
  if (asset?.playback_url) return asset.playback_url;
  if (asset?.download_url) return asset.download_url;
  if (!assetName) return "";

  const { apiBase } = getEnvironmentConfig();
  return `${apiBase}/api/method/vatiolibre.vatiolibre.media_assets.stream_my_media_asset_blob?name=${encodeURIComponent(assetName)}`;
}

/**
 * Trigger a non-blocking background cache download for an audio asset.
 *
 * Shared by both /library and /player pages:
 *  - deduplicates via registerAutoCacheDownload
 *  - skips download when local blob is already fresh (content_hash match)
 *  - prefers getBackendMediaAssetAccess({ intent: "download" }) signed URL
 *  - falls back to fetchBackendMediaAssetBlob (BFF stream with credentials)
 *  - final fallback to stable BFF streaming URL
 *  - does NOT interrupt active playback
 *  - never persists signed URLs to IndexedDB (durable-cache contract)
 *
 * @param {string} assetName
 * @param {object} asset - Asset metadata (needs content_hash, media_kind, blob_size)
 * @param {{ onCached?: Function, fetchFn?: Function }} [opts]
 * @returns {void}
 */
export function triggerBackgroundCache(assetName, asset, { onCached, fetchFn = fetch } = {}) {
  if (!assetName || !asset) return;
  if (!isAutoCacheEligible(asset)) return;

  const doDownload = async () => {
    // Skip if already locally cached with a matching (fresh) content hash.
    try {
      const meta = await getLocalBlobMeta(assetName);
      if (meta?.content_hash && asset.content_hash && meta.content_hash === asset.content_hash) {
        return;
      }
    } catch { /* proceed with download */ }

    let gate = null;
    try {
      gate = await getProtectedMediaRequestGate();
      if (!gate.allowed) return;

      let response = null;

      // 1. Prefer signed download URL via backend access endpoint.
      try {
        const result = await getBackendMediaAssetAccess({
          name: assetName,
          intent: "download",
          signal: gate.signal,
        });
        const signedUrl = result?.access?.download_url;
        if (signedUrl) {
          const r = await fetchFn(signedUrl, { signal: gate.signal });
          if (r.ok) response = r;
        }
      } catch (error) {
        if (isAbortError(error)) return;
        // fall through
      }

      // 2. Fallback: stream through the backend (includes credentials).
      if (!response) {
        try {
          const r = await fetchBackendMediaAssetBlob({
            name: assetName,
            signal: gate.signal,
          });
          if (r.ok) response = r;
        } catch (error) {
          if (isAbortError(error)) return;
          // fall through
        }
      }

      // 3. Final fallback: stable BFF streaming URL.
      if (!response) {
        const streamUrl = buildRemotePlaybackUrl(assetName, asset);
        if (streamUrl) {
          try {
            const r = await fetchFn(streamUrl, { signal: gate.signal });
            if (r.ok) response = r;
          } catch (error) {
            if (isAbortError(error)) return;
            // no source available
          }
        }
      }

      if (!response) return;

      const blob = await response.blob();
      const ok = await cacheMediaBlob(assetName, blob, {
        contentHash: asset.content_hash || null,
        blobSize: blob.size,
        mediaKind: asset.media_kind || null,
      });

      if (ok && typeof onCached === "function") {
        try { onCached(); } catch { /* ignore callback errors */ }
      }
    } finally {
      gate?.cleanup?.();
    }
  };

  registerAutoCacheDownload(assetName, doDownload);
}

/**
 * Check whether an asset has a local blob available (pinned or cached).
 *
 * @param {string} assetName
 * @returns {Promise<boolean>}
 */
export async function hasLocalSource(assetName) {
  if (!assetName) return false;
  try {
    const meta = await getLocalBlobMeta(assetName);
    return Boolean(meta);
  } catch {
    return false;
  }
}
