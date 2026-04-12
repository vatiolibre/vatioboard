import {
  getBackendMediaAssetDetail,
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
  cacheMediaManifest,
  cacheMediaMetadata,
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

const mediaResource = createCloudLibraryResource({
  resourceKey: "media_asset",
  listLoader: async (query, { force = false } = {}) => {
    // Cache-first on non-forced requests: return the IndexedDB manifest
    // immediately so the UI renders without waiting for the network.
    // The background revalidation pass (force=true) fetches fresh data.
    if (!force) {
      const cached = await getCachedMediaManifest().catch(() => null);
      if (cached && cached.length) {
        const filtered = filterAndSortOfflineAssets(cached, query);
        return { assets: filtered, total_count: filtered.length, has_more: false, _cached: true };
      }
    }

    try {
      const response = await listBackendMediaAssets(query);
      const assets = response?.assets;
      // Always cache the manifest on a successful online response, even when
      // the list is empty. This ensures a previous manifest does not survive
      // after the user deletes all their media assets.
      if (Array.isArray(assets)) {
        cacheMediaManifest(assets).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await getCachedMediaManifest().catch(() => null);
      if (cached && cached.length) {
        const filtered = filterAndSortOfflineAssets(cached, query);
        return { assets: filtered, total_count: filtered.length, has_more: false, _offline: true };
      }
      throw error;
    }
  },
  detailLoader: async (name) => {
    try {
      const response = await getBackendMediaAssetDetail({ name });
      const asset = response?.asset;
      if (asset && asset.name) {
        cacheMediaMetadata(asset.name, asset).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await getCachedMediaMetadata(name).catch(() => null);
      if (cached) {
        return { asset: { ...cached, _offline: true } };
      }
      throw error;
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
