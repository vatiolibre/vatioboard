import {
  getBackendAccelRunDetail,
  getBackendBoardDocumentDetail,
  getBackendSavedDrawingAssetDetail,
  getBackendSpeedRecordingDetail,
  listBackendAccelRuns,
  listBackendBoardDocuments,
  listBackendSavedDrawingAssets,
  listBackendSpeedRecordings,
} from "./backend-auth.js";
import { createCloudLibraryResource } from "./cloud-library.js";

export const CLOUD_LIBRARY_TAB_KEYS = Object.freeze({
  accel: "accel",
  boardDocuments: "board_documents",
  savedImages: "saved_images",
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

const savedImagesResource = createCloudLibraryResource({
  resourceKey: "saved_drawing_asset",
  listLoader: async (query) => listBackendSavedDrawingAssets(query),
  detailLoader: async (name) =>
    getBackendSavedDrawingAssetDetail({
      name,
    }),
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
  [CLOUD_LIBRARY_TAB_KEYS.savedImages]: {
    capabilityKey: "saved_drawings",
    detailMode: "summary",
    getDetailItem: (response) => response?.drawing ?? null,
    getItems: (response) => response?.drawings ?? [],
    key: CLOUD_LIBRARY_TAB_KEYS.savedImages,
    title: "Saved Images",
    resource: savedImagesResource,
  },
});

export function getCloudLibraryResource(tabKey) {
  return cloudLibraryResources[tabKey] || cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.speed];
}
