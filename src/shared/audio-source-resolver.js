import {
  getLocalMediaBlob,
  getLocalBlobMeta,
  isAutoCacheEligible,
  registerAutoCacheDownload,
  cacheMediaBlob,
} from "./media-cache.js";
import { getEnvironmentConfig } from "./environment.js";
import { getBackendMediaAssetAccess } from "./backend-auth.js";
import { getCachedMediaAccess, setCachedMediaAccess } from "./media-access-cache.js";

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

  try {
    const result = await getBackendMediaAssetAccess({ name: assetName, intent: "playback" });
    if (result?.access?.playback_url) {
      const expiry = Number(result.access.expires_in_seconds) || 300;
      setCachedMediaAccess(assetName, result.asset?.content_hash || hash, result.access, expiry);
      return result.access.playback_url;
    }
  } catch { /* offline or error — no remote playback available */ }

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
 * Follows the same contract as library.js triggerAutoCacheDownload:
 *  - deduplicates via registerAutoCacheDownload
 *  - resolves a signed URL on demand, falls back to BFF streaming
 *  - does NOT interrupt active playback
 *
 * @param {string} assetName
 * @param {object} asset - Asset metadata (needs content_hash, media_kind, blob_size)
 * @param {{ fetchFn?: Function }} [opts]
 * @returns {void}
 */
export function triggerBackgroundCache(assetName, asset, { fetchFn = fetch } = {}) {
  if (!assetName || !asset) return;
  if (!isAutoCacheEligible(asset)) return;

  const doDownload = async () => {
    const streamUrl = buildRemotePlaybackUrl(assetName, asset);
    if (!streamUrl) return;

    const response = await fetchFn(streamUrl);
    if (!response.ok) return;

    const blob = await response.blob();
    await cacheMediaBlob(assetName, blob, {
      contentHash: asset.content_hash || null,
      blobSize: blob.size,
      mediaKind: asset.media_kind || null,
    });
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
