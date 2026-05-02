import {
  getLocalMediaBlob,
  getLocalBlobMeta,
  isAutoCacheEligible,
  registerAutoCacheDownload,
  cacheMediaBlob,
  cacheMediaFromResponse,
} from "./media-cache.js";
import {
  getCachedDemoTrackBlob,
  triggerDemoTrackCache,
} from "./demo-cache.js";
import { getEnvironmentConfig } from "./environment.js";
import {
  fetchBackendMediaAssetBlob,
  getBackendMediaAssetAccess,
  getProtectedMediaRequestGate,
} from "./backend-auth.js";
import { getCachedMediaAccess, setCachedMediaAccess } from "./media-access-cache.js";
import {
  isDemoTrackName,
  isPublicStaticTrack,
  shouldUseBackendMediaAccess,
} from "./track-source-policy.js";

function isAbortError(error) {
  return Boolean(
    error
    && (
      error.name === "AbortError"
      || error.code === 20
    )
  );
}

function isDemoTrack(assetName, asset = {}) {
  return Boolean(
    isDemoTrackName(assetName)
      || isDemoTrackName(asset?.name)
      || asset?._demo === true,
  );
}

/**
 * Resolve the best available audio source for a media asset.
 *
 * Resolution order (local-first):
 *  1. Pinned blob from IndexedDB
 *  2. Cached blob from IndexedDB
 *  3. Remote presigned storage URL (via BFF access endpoint)
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

  // 0. Direct static src (e.g. demo tracks served from /audio/demo/)
  if (asset?.src) {
    if (isDemoTrack(assetName, asset)) {
      try {
        const local = await getCachedDemoTrackBlob(assetName, asset);
        if (local?.blob) {
          const url = URL.createObjectURL(local.blob);
          return {
            src: url,
            type: "blob",
            blob: local.blob,
            source: "demo-cache",
            revokeUrl() { URL.revokeObjectURL(url); },
          };
        }
      } catch {
        // IndexedDB unavailable — fall through to the public static src.
      }
    }

    return { src: asset.src, type: "remote", revokeUrl() {} };
  }

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
  if (!shouldUseBackendMediaAccess(assetName, asset)) return null;
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
  if (!shouldUseBackendMediaAccess(assetName, asset)) return "";
  if (asset?.playback_url) return asset.playback_url;
  if (asset?.download_url) return asset.download_url;

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
 * @param {{ onCached?: Function, onFailed?: Function, fetchFn?: Function }} [opts]
 * @returns {void}
 */
export function triggerBackgroundCache(assetName, asset, { onCached, onFailed, fetchFn = fetch } = {}) {
  if (!assetName || !asset) {
    if (typeof onFailed === "function") {
      try { onFailed("ineligible"); } catch { /* ignore */ }
    }
    return;
  }
  if (isDemoTrack(assetName, asset)) {
    triggerDemoTrackCache(assetName, asset, {
      fetchFn,
      onCached,
      onFailed,
    });
    return;
  }
  if (isPublicStaticTrack(assetName, asset)) {
    if (typeof onFailed === "function") {
      try { onFailed("static_source"); } catch { /* ignore */ }
    }
    return;
  }
  if (!isAutoCacheEligible(asset)) {
    if (typeof onFailed === "function") {
      try { onFailed("ineligible"); } catch { /* ignore */ }
    }
    return;
  }

  const doDownload = async () => {
    // Skip if already locally cached with a matching (fresh) content hash.
    try {
      const meta = await getLocalBlobMeta(assetName);
      if (meta?.content_hash && asset.content_hash && meta.content_hash === asset.content_hash) {
        if (typeof onCached === "function") {
          try { onCached(); } catch { /* ignore */ }
        }
        return;
      }
    } catch { /* proceed with download */ }

    let gate = null;
    try {
      gate = await getProtectedMediaRequestGate();
      if (!gate.allowed) {
        if (typeof onFailed === "function") {
          try { onFailed("not_allowed"); } catch { /* ignore */ }
        }
        return;
      }

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
        if (isAbortError(error)) {
          if (typeof onFailed === "function") {
            try { onFailed("aborted"); } catch { /* ignore */ }
          }
          return;
        }
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
          if (isAbortError(error)) {
            if (typeof onFailed === "function") {
              try { onFailed("aborted"); } catch { /* ignore */ }
            }
            return;
          }
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
            if (isAbortError(error)) {
              if (typeof onFailed === "function") {
                try { onFailed("aborted"); } catch { /* ignore */ }
              }
              return;
            }
            // no source available
          }
        }
      }

      if (!response) {
        if (typeof onFailed === "function") {
          try { onFailed("no_source"); } catch { /* ignore */ }
        }
        return;
      }

      const ok = await cacheMediaFromResponse(assetName, response, {
        contentHash: asset.content_hash || null,
        blobSize: asset.blob_size || 0,
        mediaKind: asset.media_kind || null,
      });

      if (ok && typeof onCached === "function") {
        try { onCached(); } catch { /* ignore callback errors */ }
      }
      if (!ok && typeof onFailed === "function") {
        try { onFailed("cache_failed"); } catch { /* ignore */ }
      }
    } catch {
      // Gate acquisition or unexpected error — settle as failure.
      if (typeof onFailed === "function") {
        try { onFailed("no_source"); } catch { /* ignore */ }
      }
    } finally {
      gate?.cleanup?.();
    }
  };

  const started = registerAutoCacheDownload(assetName, doDownload);
  if (!started) {
    if (typeof onFailed === "function") {
      try { onFailed("already_in_flight"); } catch { /* ignore */ }
    }
  }
}

/**
 * Check whether an asset has a local blob available (pinned or cached).
 *
 * @param {string} assetName
 * @param {object} [asset]
 * @returns {Promise<boolean>}
 */
export async function hasLocalSource(assetName, asset = {}) {
  if (!assetName) return false;

  if (isDemoTrack(assetName, asset)) {
    try {
      const cached = await getCachedDemoTrackBlob(assetName, asset);
      return Boolean(cached?.blob);
    } catch {
      return false;
    }
  }

  try {
    const meta = await getLocalBlobMeta(assetName);
    return Boolean(meta);
  } catch {
    return false;
  }
}
