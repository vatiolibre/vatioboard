import {
  getProtectedMediaRequestGate,
  getBackendManifestVersion,
  getBackendMediaAssetDetail,
  getBackendMediaManifest,
  getBackendBoardDocumentDetail,
  getBackendSpeedRecordingDetail,
  listBackendMediaAssets,
  listBackendBoardDocuments,
  listBackendSpeedRecordings,
} from "./backend-auth.js";

// Keep accel imports separate since they share a different import line
import {
  getBackendAccelRunDetail,
  listBackendAccelRuns,
} from "./backend-auth.js";
import { createCloudLibraryResource } from "./cloud-library.js";
import {
  cacheManifestSnapshot,
  cacheMediaMetadata,
  getCachedManifestSnapshot,
  getCachedMediaManifest,
  getCachedMediaMetadata,
} from "./media-cache.js";

export const CLOUD_LIBRARY_TAB_KEYS = Object.freeze({
  accel: "accel",
  boardDocuments: "board_documents",
  media: "media",
  speed: "speed",
});

const speedResource = createCloudLibraryResource({
  resourceKey: "replay_session",
  listLoader: async (query) => listBackendSpeedRecordings(query),
  detailLoader: async (name, { mode } = {}) =>
    getBackendSpeedRecordingDetail({
      name,
      includePayload: mode === "full",
    }),
});

const accelResource = createCloudLibraryResource({
  resourceKey: "accel_run",
  listLoader: async (query) => listBackendAccelRuns(query),
  detailLoader: async (name, { mode } = {}) =>
    getBackendAccelRunDetail({
      name,
      includePayload: mode === "full",
    }),
});

const boardDocumentsResource = createCloudLibraryResource({
  resourceKey: "board_document",
  listLoader: async (query) => listBackendBoardDocuments(query),
  detailLoader: async (name, { mode } = {}) =>
    getBackendBoardDocumentDetail({
      name,
      includePayload: mode === "full",
  }),
});

function isAbortError(error) {
  return Boolean(
    error
    && (
      error.name === "AbortError"
      || error.code === 20
    )
  );
}

function isAuthBlockedResponse(result) {
  return result?.blockedByAuth === true || result?.status === 401 || result?.status === 403;
}

function createBlockedMediaListResponse() {
  return {
    ok: false,
    status: 401,
    data: null,
    assets: [],
    blockedByAuth: true,
    hasMore: false,
    manifestToken: null,
    nextOffset: 0,
    totalCount: 0,
  };
}

function createBlockedMediaDetailResponse() {
  return {
    ok: false,
    status: 401,
    asset: null,
    blockedByAuth: true,
    data: null,
  };
}

function filterAndSortOfflineAssets(assets, query) {
  let result = assets;

  const search = String(query?.search || "").trim().toLowerCase();
  if (search) {
    result = result.filter((a) => {
      const haystack = `${a.title || ""} ${a.original_filename || ""} ${a.folder_path || ""}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  const sort = String(query?.sort || "newest").trim().toLowerCase();
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  result = [...result].sort((a, b) => {
    if (sort === "oldest") return getSortableTimestamp(a) - getSortableTimestamp(b);
    if (sort === "title_asc") return collator.compare(a.title || "", b.title || "");
    if (sort === "title_desc") return collator.compare(b.title || "", a.title || "");
    // "newest" (default) — descending by modified date
    return getSortableTimestamp(b) - getSortableTimestamp(a);
  });

  return result;
}

/**
 * Extract a numeric timestamp suitable for chronological sorting.
 * Uses the pre-computed `sort_timestamp` from the cached manifest when
 * available.  Falls back to parsing raw `modified_at` / `created_at` for
 * items that were not cached through `cacheMediaManifest()`.  Returns 0
 * when nothing is parseable so sort remains stable.
 */
function getSortableTimestamp(item) {
  if (typeof item.sort_timestamp === "number" && item.sort_timestamp > 0) return item.sort_timestamp;
  for (const field of [item.modified_at, item.created_at]) {
    if (typeof field === "number" && field > 0) return field;
    if (field) {
      const parsed = Date.parse(field);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

/**
 * Sync the canonical full-library manifest in the background.
 *
 * This is separate from the paginated browse path:
 *  - Uses the dedicated ``get_my_media_manifest`` endpoint that returns
 *    ALL assets (metadata-only, no URL fields, up to 5 000).
 *  - Persists the result into IndexedDB so the full library is available
 *    offline.
 *  - Includes a cheap token-based freshness check to skip redundant
 *    full-manifest fetches.
 *
 * When ``browseToken`` is supplied (from the canonical page-1 list
 * response), the freshness check uses it directly and avoids a
 * separate ``get_my_media_manifest_version`` round-trip.
 *
 * Returns ``true`` when the manifest was refreshed, ``false`` when skipped.
 */
async function syncCanonicalManifest({ browseToken = null, signal } = {}) {
  let gate = null;
  try {
    gate = await getProtectedMediaRequestGate({ signal });
    if (!gate.allowed) return false;

    // Determine the remote token — prefer the one already in hand.
    let remoteToken = browseToken;
    if (!remoteToken) {
      const remoteVersion = await getBackendManifestVersion({ signal: gate.signal }).catch((error) => {
        if (isAbortError(error)) throw error;
        return null;
      });
      if (isAuthBlockedResponse(remoteVersion)) {
        return false;
      }
      remoteToken = remoteVersion?.ok ? remoteVersion.manifestToken : null;
    }

    // Freshness check: require BOTH a matching token AND an existing
    // manifest snapshot.  A lone token without a manifest (e.g. from an
    // earlier failed write) must not be treated as fresh.
    if (remoteToken) {
      const snapshot = await getCachedManifestSnapshot().catch(() => null);
      if (snapshot?.token && snapshot.token === remoteToken && Array.isArray(snapshot.assets)) {
        return false; // manifest is still fresh
      }
    }

    // Token mismatch or no cached snapshot — fetch the full manifest
    const response = await getBackendMediaManifest({ signal: gate.signal });
    if (isAuthBlockedResponse(response) || response?.ok === false) {
      return false;
    }
    const assets = response?.assets;
    if (Array.isArray(assets)) {
      // Atomic write: assets and freshness token in a single record.
      // Truncated manifests store null token so the freshness check
      // always re-fetches until the library fits within the manifest cap.
      const token = (response.manifestToken && !response.isTruncated)
        ? response.manifestToken
        : null;
      await cacheManifestSnapshot({ assets, token });
    }
    return true;
  } catch (error) {
    if (isAbortError(error)) return false;
    return false;
  } finally {
    gate?.cleanup?.();
  }
}

const MEDIA_PAGE_SIZE = 24;

const mediaResource = createCloudLibraryResource({
  resourceKey: "media_asset",
  listLoader: async (query, { force = false, signal } = {}) => {
    const limit = Number(query?.limit) || MEDIA_PAGE_SIZE;
    const offset = Number(query?.offset) || 0;

    // Cache-first on non-forced requests: return a page-sized slice of
    // the IndexedDB manifest so the UI renders without a network wait.
    // The stale-while-revalidate pass (force=true) fetches fresh data.
    if (!force) {
      const cached = await getCachedMediaManifest().catch(() => null);
      if (Array.isArray(cached)) {
        const filtered = filterAndSortOfflineAssets(cached, query);
        const page = filtered.slice(offset, offset + limit);
        return {
          assets: page,
          total_count: filtered.length,
          has_more: offset + page.length < filtered.length,
          next_offset: offset + page.length,
          _cached: true,
        };
      }
    }

    let gate = null;
    try {
      gate = await getProtectedMediaRequestGate({ signal });
      if (!gate.allowed) {
        return createBlockedMediaListResponse();
      }

      const response = await listBackendMediaAssets({
        ...query,
        signal: gate.signal,
      });

      // Determine whether this is a canonical (unfiltered, first-page) load.
      const isCanonical = !query?.search && !offset;

      // Trigger background canonical manifest sync when:
      //  - forced canonical revalidation (stale-while-revalidate), or
      //  - first successful canonical load with no existing cache (cold visit)
      if (isCanonical) {
        if (force) {
          syncCanonicalManifest({
            browseToken: response.manifestToken || null,
            signal,
          }).catch(() => {});
        } else {
          // Cold visit: no cache existed (otherwise we'd have taken the
          // cache-first path above).  Seed the offline manifest now.
          syncCanonicalManifest({
            browseToken: response.manifestToken || null,
            signal,
          }).catch(() => {});
        }
      }

      return response;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const cached = await getCachedMediaManifest().catch(() => null);
      if (Array.isArray(cached)) {
        const filtered = filterAndSortOfflineAssets(cached, query);
        const page = filtered.slice(offset, offset + limit);
        return {
          assets: page,
          total_count: filtered.length,
          has_more: offset + page.length < filtered.length,
          next_offset: offset + page.length,
          _offline: true,
        };
      }
      throw error;
    } finally {
      gate?.cleanup?.();
    }
  },
  detailLoader: async (name, { signal } = {}) => {
    let gate = null;
    try {
      gate = await getProtectedMediaRequestGate({ signal });
      if (!gate.allowed) {
        return createBlockedMediaDetailResponse();
      }

      const response = await getBackendMediaAssetDetail({ name, signal: gate.signal });
      const asset = response?.asset;
      if (asset && asset.name) {
        cacheMediaMetadata(asset.name, asset).catch(() => {});
      }
      return response;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const cached = await getCachedMediaMetadata(name).catch(() => null);
      if (cached) {
        return { asset: { ...cached, _offline: true } };
      }
      throw error;
    } finally {
      gate?.cleanup?.();
    }
  },
  shouldPersistDetail: () => false,
});

export const cloudLibraryResources = Object.freeze({
  [CLOUD_LIBRARY_TAB_KEYS.speed]: {
    capabilityKey: "cloud_sync",
    detailMode: "summary",
    getDetailItem: (response) => response?.record ?? null,
    getItems: (response) => response?.records ?? [],
    key: CLOUD_LIBRARY_TAB_KEYS.speed,
    title: "Speed",
    resource: speedResource,
  },
  [CLOUD_LIBRARY_TAB_KEYS.accel]: {
    capabilityKey: "cloud_sync",
    detailMode: "summary",
    getDetailItem: (response) => response?.record ?? null,
    getItems: (response) => response?.records ?? [],
    key: CLOUD_LIBRARY_TAB_KEYS.accel,
    title: "Accel",
    resource: accelResource,
  },
  [CLOUD_LIBRARY_TAB_KEYS.boardDocuments]: {
    capabilityKey: "cloud_sync",
    detailMode: "summary",
    getDetailItem: (response) => response?.document ?? null,
    getItems: (response) => response?.documents ?? [],
    key: CLOUD_LIBRARY_TAB_KEYS.boardDocuments,
    title: "Board Documents",
    resource: boardDocumentsResource,
  },
  [CLOUD_LIBRARY_TAB_KEYS.media]: {
    capabilityKey: "media_assets",
    detailMode: "summary",
    getDetailItem: (response) => response?.asset ?? null,
    getItems: (response) => response?.assets ?? [],
    key: CLOUD_LIBRARY_TAB_KEYS.media,
    title: "Media",
    resource: mediaResource,
  },
});

export function getCloudLibraryResource(tabKey) {
  return cloudLibraryResources[tabKey] || cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.speed];
}
