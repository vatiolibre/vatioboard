import { t } from "../i18n.js";
import { IconAccel, IconBoard, IconDownload, IconMedia, IconSpeed } from "../icons.js";
import { CLOUD_LIBRARY_TAB_KEYS } from "../shared/cloud-library-resources.js";
import { formatDisplayDistance, formatDisplaySpeed } from "../shared/display-format.js";
import { formatRouteString } from "../shared/route-string.js";

function formatCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat().format(Math.max(0, Math.round(numeric)));
}

function formatFileSize(bytes) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = numeric;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDurationMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "—";

  const totalSeconds = Math.round(numeric / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}:${String(remainingMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDimensionPair(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return "—";
  return `${Math.round(w)} × ${Math.round(h)}`;
}

/**
 * Build a route label from structured place data, matching replay formatting.
 * Falls back to label+detail reconstruction, then flat labels.
 */
function buildSpeedRouteLabel(item, fallback = "") {
  if (item?.start_place || item?.end_place) {
    return formatRouteString(item.start_place, item.end_place, fallback);
  }

  const startText = item?.start_place_label || "";
  const endText = item?.end_place_label || "";
  if (startText || endText) {
    return formatRouteString(
      startText ? { label: startText, detail: item?.start_place_detail } : null,
      endText ? { label: endText, detail: item?.end_place_detail } : null,
      fallback,
    );
  }

  return fallback;
}

/**
 * Resource configuration registry.
 *
 * Each entry describes:
 * - previewKind: "map" | "image" | "type-icon"
 * - tabIcon: icon SVG for the tab
 * - canOpen(item): whether item can be opened
 * - canDelete: whether delete is supported
 * - canRename: whether rename is supported
 * - canDownload: whether download is supported
 * - buildSubtitle(item): card subtitle builder
 * - buildMetaEntries(item): detail meta pairs
 * - buildBadges(item): compact status badges
 * - getPreviewRoute(item): extract [lon,lat][] for map preview or null
 */

const RESOURCE_CONFIGS = {
  [CLOUD_LIBRARY_TAB_KEYS.speed]: {
    tabIcon: IconSpeed,
    previewKind: "map",
    detailFromList: true,
    canOpen: (item) => {
      if (item?.payload_available === false) return false;
      if (item?.can_open === false || item?.payload_complete === false) return false;
      return true;
    },
    canDelete: true,
    canRename: false,
    canDownload: false,

    buildSubtitle(item) {
      return [
        item.started_at_label || item.ended_at_label,
        buildSpeedRouteLabel(item),
      ].filter(Boolean).join(" · ");
    },

    buildMetaEntries(item) {
      return [
        [t("libraryCreated"), item.started_at_label || item.ended_at_label || "—"],
        [t("libraryRoute"), buildSpeedRouteLabel(item, "—")],
        [t("librarySamples"), formatCount(item.sample_count)],
        [t("duration"), formatDurationMs(item.duration_ms)],
        [t("distance"), formatDisplayDistance(item.total_distance_m, item.distance_unit)],
        [t("max"), formatDisplaySpeed(item.max_speed, item.unit)],
      ];
    },

    buildBadges(item) {
      const badges = [];
      if (item.can_open) badges.push({ label: t("cloudLibraryOpen"), tone: "success" });
      else if (item.payload_available === false) badges.push({ label: t("libraryBadgeSummaryOnly"), tone: "muted" });
      if (item.sample_count > 0) badges.push({ label: `${formatCount(item.sample_count)} ${t("librarySamples").toLowerCase()}`, tone: "muted" });
      return badges;
    },

    getPreviewRoute(item) {
      return extractPreviewRouteCoordinates(item?.preview_route)
        || synthesizeFallbackRoute(item);
    },

    getDeleteIdentifiers(item) {
      return {
        entityType: item.entity_type,
        clientRecordId: item.client_record_id,
        deviceId: item.device_id,
      };
    },
  },

  [CLOUD_LIBRARY_TAB_KEYS.accel]: {
    tabIcon: IconAccel,
    previewKind: "map",
    detailFromList: true,
    canOpen: (item) => {
      if (item?.payload_available === false) return false;
      if (item?.can_open === false || item?.payload_complete === false) return false;
      return true;
    },
    canDelete: true,
    canRename: false,
    canDownload: false,

    buildSubtitle(item) {
      return [
        item.saved_at_label,
        item.preset_id,
        item.quality_grade,
      ].filter(Boolean).join(" · ");
    },

    buildMetaEntries(item) {
      return [
        [t("libraryCreated"), item.saved_at_label || "—"],
        [t("libraryPreset"), item.preset_id || "—"],
        [t("libraryQuality"), item.quality_grade || "—"],
        [t("duration"), formatDurationMs(item.elapsed_ms)],
        [t("librarySamples"), formatCount(item.sample_count)],
        [t("speed"), formatDisplaySpeed(item.finish_speed, item.display_unit)],
      ];
    },

    buildBadges(item) {
      const badges = [];
      if (item.can_open) badges.push({ label: t("cloudLibraryOpen"), tone: "success" });
      else if (item.payload_available === false) badges.push({ label: t("libraryBadgeSummaryOnly"), tone: "muted" });
      if (item.preset_id) badges.push({ label: item.preset_id, tone: "muted" });
      return badges;
    },

    getPreviewRoute(item) {
      return extractPreviewRouteCoordinates(item?.preview_route)
        || synthesizeFallbackRoute(item);
    },

    getDeleteIdentifiers(item) {
      return {
        entityType: item.entity_type,
        clientRecordId: item.client_record_id,
        deviceId: item.device_id,
      };
    },
  },

  [CLOUD_LIBRARY_TAB_KEYS.boardDocuments]: {
    tabIcon: IconBoard,
    previewKind: "board-preview",
    detailFromList: true,
    canOpen: () => true,
    canDelete: true,
    canRename: true,
    canDownload: false,

    buildSubtitle(item) {
      return [
        item.updated_at_label || item.modified_at_label || item.created_at_label,
        `${formatCount(item.command_count)} ${t("libraryCommands").toLowerCase()}`,
      ].filter(Boolean).join(" · ");
    },

    buildMetaEntries(item) {
      return [
        [t("libraryUpdated"), item.updated_at_label || item.modified_at_label || "—"],
        [t("libraryCreated"), item.created_at_label || "—"],
        [t("libraryCommands"), formatCount(item.command_count)],
        [t("libraryRedoCommands"), formatCount(item.redo_command_count)],
        [t("libraryFileSize"), formatFileSize(item.payload_size)],
      ];
    },

    buildBadges(item) {
      const badges = [];
      badges.push({ label: `${formatCount(item.command_count)} ${t("libraryCommands").toLowerCase()}`, tone: "muted" });
      return badges;
    },

    getPreviewRoute() {
      return null;
    },

    getDeleteIdentifiers(item) {
      return { name: item.name };
    },
  },

  [CLOUD_LIBRARY_TAB_KEYS.media]: {
    tabIcon: IconMedia,
    previewKind: "media",
    canOpen: (item) => {
      const kind = String(item?.media_kind || "").toLowerCase();
      return kind === "image" || kind === "audio" || kind === "video";
    },
    canDelete: false,
    canRename: false,
    canDownload: true,

    buildSubtitle(item) {
      return [
        item.created_at_label || item.modified_at_label,
        item.media_kind,
        formatFileSize(item.blob_size),
      ].filter((v) => v && v !== "—").join(" · ");
    },

    buildMetaEntries(item) {
      return [
        [t("libraryCreated"), item.created_at_label || "—"],
        [t("libraryUpdated"), item.modified_at_label || "—"],
        [t("libraryMediaKind"), item.media_kind || "—"],
        [t("libraryFileSize"), formatFileSize(item.blob_size)],
        [t("libraryFolder"), item.folder_path || "—"],
        [t("libraryOriginalFilename"), item.original_filename || "—"],
      ];
    },

    buildBadges(item) {
      const badges = [];
      if (item.media_kind) {
        badges.push({ label: item.media_kind, tone: "muted" });
      }
      const size = formatFileSize(item.blob_size);
      if (size !== "0 B") {
        badges.push({ label: size, tone: "muted" });
      }
      return badges;
    },

    getPreviewRoute() {
      return null;
    },

    getDeleteIdentifiers(item) {
      return { name: item.name };
    },
  },
};

export function getResourceConfig(tabKey) {
  return RESOURCE_CONFIGS[tabKey] || RESOURCE_CONFIGS[CLOUD_LIBRARY_TAB_KEYS.speed];
}

/**
 * Try to extract a [lon, lat] pair from a place/boundary object.
 * Accepts {longitude, latitude}, {lon, lat}, or {lng, lat}.
 */
function extractCoordPair(obj) {
  if (!obj || typeof obj !== "object") return null;
  const lon = Number(obj.longitude ?? obj.lon ?? obj.lng);
  const lat = Number(obj.latitude ?? obj.lat);
  if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
  return null;
}

/**
 * Synthesize a minimal 2-point route from boundary/place data when
 * preview_route is missing.  Returns [[lon,lat],[lon,lat]] or null.
 */
function synthesizeFallbackRoute(item) {
  if (!item) return null;
  const start = extractCoordPair(item.start_boundary_point)
    || extractCoordPair(item.start_place);
  const end = extractCoordPair(item.end_boundary_point)
    || extractCoordPair(item.end_place);
  if (start && end) return [start, end];
  return null;
}

/**
 * Extract [lon, lat][] from a preview_route value.
 * Supports both the {coordinates: [...]} shape and a raw array.
 */
export function extractPreviewRouteCoordinates(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    const coords = normalizeCoordArray(value);
    return coords.length >= 2 ? coords : null;
  }

  if (typeof value === "object") {
    for (const key of ["coordinates", "route", "points", "path"]) {
      if (Array.isArray(value[key])) {
        const coords = normalizeCoordArray(value[key]);
        if (coords.length >= 2) return coords;
      }
    }
  }

  return null;
}

function normalizeCoordArray(arr) {
  const out = [];
  for (const item of arr) {
    if (Array.isArray(item) && item.length >= 2) {
      const a = Number(item[0]);
      const b = Number(item[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        out.push([a, b]);
      }
    } else if (item && typeof item === "object") {
      const lon = Number(item.longitude ?? item.lon ?? item.lng);
      const lat = Number(item.latitude ?? item.lat);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        out.push([lon, lat]);
      }
    }
  }
  return out;
}
