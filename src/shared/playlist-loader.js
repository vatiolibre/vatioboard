/**
 * Playlist loader.
 *
 * Loads the user's playlists (and their tracks) from the cached
 * manifest, falling back to a one-shot backend fetch on cold boot.
 * Mirrors audio-catalog.js in structure but operates on playlists
 * instead of individual assets.
 *
 * Data flow:
 *  1. Read the playlists manifest from IndexedDB (playlist-cache.js)
 *  2. If empty, fetch from backend and cache for future offline use
 *  3. For individual playlist detail, read from cache or fetch
 */

import {
  getCachedPlaylistsManifestSnapshot,
  cachePlaylistsManifestSnapshot,
  getCachedPlaylistDetail,
  cachePlaylistDetail,
  fanOutManifestDetails,
} from "./playlist-cache.js";
import {
  getBackendPlaylistsManifest,
  getBackendPlaylistsManifestVersion,
  getBackendPlaylistDetail,
  getProtectedMediaRequestGate,
} from "./backend-auth.js";

function isAbortError(error) {
  return Boolean(
    error
    && (error.name === "AbortError" || error.code === 20),
  );
}

function isAuthBlockedResponse(result) {
  return result?.blockedByAuth === true || result?.status === 401 || result?.status === 403;
}

/**
 * Load the user's playlists from the cached manifest.
 *
 * Falls back to a one-shot backend fetch if no cached copy exists.
 *
 * @param {{ search?: string }} [query]
 * @returns {Promise<{ playlists: object[], total: number }>}
 */
export async function loadPlaylists(query = {}) {
  let playlists = [];

  try {
    const snapshot = await getCachedPlaylistsManifestSnapshot();
    if (Array.isArray(snapshot?.playlists)) {
      playlists = snapshot.playlists;
    }
  } catch { /* ignore */ }

  // Cold-online boot: no cached manifest — fetch from backend.
  if (playlists.length === 0) {
    let gate = null;
    try {
      gate = await getProtectedMediaRequestGate();
      if (!gate.allowed) {
        return { playlists: [], total: 0 };
      }

      const response = await getBackendPlaylistsManifest({ signal: gate.signal });
      if (response?.ok && Array.isArray(response.playlists)) {
        playlists = response.playlists;
        const token = (response.manifestToken && !response.isTruncated)
          ? response.manifestToken
          : null;
        cachePlaylistsManifestSnapshot({ playlists, token }).catch(() => {});
        fanOutManifestDetails(playlists).catch(() => {});
      }
    } catch (error) {
      if (!isAbortError(error)) { /* offline */ }
    } finally {
      gate?.cleanup?.();
    }
  }

  // Apply search filter
  const filtered = filterPlaylists(playlists, query);
  return { playlists: filtered, total: filtered.length };
}

/**
 * Load a single playlist's detail (including track list).
 *
 * Prefers the cached detail. Falls back to backend if not cached.
 *
 * @param {string} playlistName
 * @returns {Promise<object|null>}
 */
export async function loadPlaylistDetail(playlistName) {
  if (!playlistName) return null;

  // Try cache first
  try {
    const cached = await getCachedPlaylistDetail(playlistName);
    if (cached?.name) return cached;
  } catch { /* ignore */ }

  // Fetch from backend
  let gate = null;
  try {
    gate = await getProtectedMediaRequestGate();
    if (!gate.allowed) return null;

    const response = await getBackendPlaylistDetail({
      name: playlistName,
      signal: gate.signal,
    });
    if (response?.ok && response.playlist) {
      cachePlaylistDetail(playlistName, response.playlist).catch(() => {});
      return response.playlist;
    }
  } catch (error) {
    if (!isAbortError(error)) { /* offline */ }
  } finally {
    gate?.cleanup?.();
  }

  return null;
}

/**
 * Non-blocking background sync of the playlists manifest.
 *
 * Checks the remote manifest token against the cached one and
 * only downloads the full manifest when they differ.
 *
 * @returns {Promise<boolean>} true when the manifest was refreshed
 */
export async function syncPlaylistsManifest() {
  let gate = null;
  try {
    gate = await getProtectedMediaRequestGate();
    if (!gate.allowed) return false;

    const remoteVersion = await getBackendPlaylistsManifestVersion({ signal: gate.signal })
      .catch((error) => {
        if (isAbortError(error)) throw error;
        return null;
      });
    if (isAuthBlockedResponse(remoteVersion)) return false;
    const remoteToken = remoteVersion?.ok ? remoteVersion.manifestToken : null;

    // Freshness check
    if (remoteToken) {
      const snapshot = await getCachedPlaylistsManifestSnapshot().catch(() => null);
      if (snapshot?.token && snapshot.token === remoteToken && Array.isArray(snapshot.playlists)) {
        return false; // already fresh
      }
    }

    // Token mismatch — fetch full manifest
    const response = await getBackendPlaylistsManifest({ signal: gate.signal });
    if (!response?.ok || !Array.isArray(response.playlists)) return false;
    const token = (response.manifestToken && !response.isTruncated)
      ? response.manifestToken
      : null;
    await cachePlaylistsManifestSnapshot({ playlists: response.playlists, token });
    fanOutManifestDetails(response.playlists).catch(() => {});
    return true;
  } catch (error) {
    if (isAbortError(error)) return false;
    return false;
  } finally {
    gate?.cleanup?.();
  }
}

// ── Internal ─────────────────────────────────────────────────────────

function filterPlaylists(playlists, query) {
  let result = playlists;

  const search = String(query?.search || "").trim().toLowerCase();
  if (search) {
    result = result.filter((p) => {
      const haystack = `${p.title || ""} ${p.name || ""}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  return result;
}
