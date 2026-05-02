import { describe, expect, it } from "vitest";
import {
  getResourceConfig,
  extractPreviewRouteCoordinates,
} from "../../src/library/resource-registry.js";
import { CLOUD_LIBRARY_TAB_KEYS } from "../../src/shared/cloud-library-resources.js";

// ── getResourceConfig ────────────────────────────────────────────────

describe("getResourceConfig", () => {
  it("returns a config for every known tab key", () => {
    for (const key of Object.values(CLOUD_LIBRARY_TAB_KEYS)) {
      const config = getResourceConfig(key);
      expect(config).toBeTruthy();
      expect(config).toHaveProperty("tabIcon");
      expect(config).toHaveProperty("previewKind");
      expect(typeof config.canOpen).toBe("function");
      expect(typeof config.buildSubtitle).toBe("function");
      expect(typeof config.buildMetaEntries).toBe("function");
      expect(typeof config.buildBadges).toBe("function");
      expect(typeof config.getPreviewRoute).toBe("function");
      expect(typeof config.getDeleteIdentifiers).toBe("function");
    }
  });

  it("falls back to the speed config for unknown keys", () => {
    const fallback = getResourceConfig("nonexistent_tab");
    const speed = getResourceConfig(CLOUD_LIBRARY_TAB_KEYS.speed);
    expect(fallback).toBe(speed);
  });
});

// ── speed config ─────────────────────────────────────────────────────

describe("speed resource config", () => {
  const config = getResourceConfig(CLOUD_LIBRARY_TAB_KEYS.speed);

  it("has map previewKind", () => {
    expect(config.previewKind).toBe("map");
  });

  it("has detailFromList enabled", () => {
    expect(config.detailFromList).toBe(true);
  });

  it("canDelete but not rename or download", () => {
    expect(config.canDelete).toBe(true);
    expect(config.canRename).toBe(false);
    expect(config.canDownload).toBe(false);
  });

  it("canOpen returns false when payload_available is false", () => {
    expect(config.canOpen({ payload_available: false })).toBe(false);
  });

  it("canOpen returns false when can_open is false", () => {
    expect(config.canOpen({ can_open: false })).toBe(false);
  });

  it("canOpen returns true for a typical item", () => {
    expect(config.canOpen({ can_open: true, payload_available: true })).toBe(true);
  });

  it("buildSubtitle joins time and route", () => {
    const sub = config.buildSubtitle({
      started_at_label: "Jan 1",
      start_place_label: "Miami",
      end_place_label: "Orlando",
    });
    expect(sub).toContain("Jan 1");
    expect(sub).toContain("Miami -> Orlando");
  });

  it("buildSubtitle returns empty string when no data", () => {
    expect(config.buildSubtitle({})).toBe("");
  });

  it("uses structured place data for route when available", () => {
    const sub = config.buildSubtitle({
      started_at_label: "Apr 8",
      start_place: {
        label: "Fort Lee",
        detail: "Bergen County, New Jersey, United States",
        road: "Hilltop Court",
        house_number: "6312",
        city: "Fort Lee",
        state: "New Jersey",
        state_code: "US-NJ",
        country_code: "us",
        country_name: "United States",
      },
      end_place: {
        label: "Fort Lee",
        detail: "Bergen County, New Jersey, United States",
        road: "Anderson Avenue",
        house_number: "123",
        city: "Fort Lee",
        state: "New Jersey",
        state_code: "US-NJ",
        country_code: "us",
        country_name: "United States",
      },
      start_place_label: "Fort Lee",
      end_place_label: "Fort Lee",
    });
    // Should NOT be "Fort Lee -> Fort Lee" — must use street-level detail
    expect(sub).not.toContain("Fort Lee -> Fort Lee");
    expect(sub).toContain("6312 Hilltop Ct");
    expect(sub).toContain("123 Anderson Ave");
  });

  it("deduplicates same-city route with structured places", () => {
    const entries = config.buildMetaEntries({
      started_at_label: "Apr 8",
      start_place: {
        label: "Fort Lee",
        detail: "Bergen County, New Jersey, United States",
        road: "Hilltop Court",
        house_number: "6312",
        city: "Fort Lee",
        state: "New Jersey",
        state_code: "US-NJ",
        country_code: "us",
        country_name: "United States",
      },
      end_place: {
        label: "Fort Lee",
        detail: "Bergen County, New Jersey, United States",
        road: "Anderson Avenue",
        house_number: "123",
        city: "Fort Lee",
        state: "New Jersey",
        state_code: "US-NJ",
        country_code: "us",
        country_name: "United States",
      },
    });
    const routeEntry = entries.find((pair) => pair[1]?.includes("->"));
    expect(routeEntry).toBeTruthy();
    // End should be street-only (city deduplicated)
    expect(routeEntry[1]).toContain("123 Anderson Ave");
    expect(routeEntry[1]).not.toMatch(/Fort Lee.*->.*Fort Lee/);
  });

  it("falls back to flat labels when structured places are absent", () => {
    const sub = config.buildSubtitle({
      started_at_label: "Jan 1",
      start_place_label: "Fort Lee",
      end_place_label: "Edgewater",
    });
    expect(sub).toContain("Fort Lee -> Edgewater");
  });

  it("falls back to label+detail reconstruction", () => {
    const sub = config.buildSubtitle({
      started_at_label: "Jan 1",
      start_place_label: "Fort Lee",
      start_place_detail: "Bergen County, New Jersey, United States",
      end_place_label: "Edgewater",
      end_place_detail: "Bergen County, New Jersey, United States",
    });
    // Both have detail so formatRouteString can parse state
    expect(sub).toContain("Fort Lee");
    expect(sub).toContain("Edgewater");
  });

  it("buildMetaEntries returns array of pairs", () => {
    const entries = config.buildMetaEntries({
      started_at_label: "Jan 1",
      sample_count: 120,
      max_speed: 60,
      unit: "kmh",
    });
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    for (const pair of entries) {
      expect(pair).toHaveLength(2);
    }
  });

  it("formats metric speed as rounded km/h", () => {
    const entries = config.buildMetaEntries({
      max_speed: 82.4,
      unit: "kmh",
    });
    const maxEntry = entries.find(([label]) => label === "Max");
    expect(maxEntry[1]).toBe("82 km/h");
  });

  it("formats imperial speed as rounded mph", () => {
    const entries = config.buildMetaEntries({
      max_speed: 70.2,
      unit: "mph",
    });
    const maxEntry = entries.find(([label]) => label === "Max");
    expect(maxEntry[1]).toBe("70 mph");
  });

  it("formats metric distance with km promotion", () => {
    const entries = config.buildMetaEntries({
      total_distance_m: 1280,
      distance_unit: "m",
    });
    const distEntry = entries.find(([label]) => label === "Distance");
    expect(distEntry[1]).toBe("1.3 km");
  });

  it("formats short metric distance in meters", () => {
    const entries = config.buildMetaEntries({
      total_distance_m: 640,
      distance_unit: "m",
    });
    const distEntry = entries.find(([label]) => label === "Distance");
    expect(distEntry[1]).toBe("640 m");
  });

  it("formats imperial distance with mi promotion", () => {
    const entries = config.buildMetaEntries({
      total_distance_m: 1609.344,
      distance_unit: "ft",
    });
    const distEntry = entries.find(([label]) => label === "Distance");
    expect(distEntry[1]).toBe("1.0 mi");
  });

  it("formats short imperial distance in feet", () => {
    const entries = config.buildMetaEntries({
      total_distance_m: 289.56,
      distance_unit: "ft",
    });
    const distEntry = entries.find(([label]) => label === "Distance");
    expect(distEntry[1]).toBe("950 ft");
  });

  it("shows fallback dash when distance is missing", () => {
    const entries = config.buildMetaEntries({});
    const distEntry = entries.find(([label]) => label === "Distance");
    expect(distEntry[1]).toBe("—");
  });

  it("shows fallback dash when speed is missing", () => {
    const entries = config.buildMetaEntries({});
    const maxEntry = entries.find(([label]) => label === "Max");
    expect(maxEntry[1]).toBe("—");
  });

  it("buildBadges returns badges array", () => {
    const badges = config.buildBadges({ can_open: true, sample_count: 50 });
    expect(Array.isArray(badges)).toBe(true);
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges[0]).toHaveProperty("label");
    expect(badges[0]).toHaveProperty("tone");
  });

  it("getPreviewRoute delegates to extractPreviewRouteCoordinates", () => {
    const coords = [[1, 2], [3, 4]];
    const result = config.getPreviewRoute({ preview_route: coords });
    expect(result).toEqual(coords);
  });

  it("getPreviewRoute synthesizes fallback from boundary points", () => {
    const result = config.getPreviewRoute({
      start_boundary_point: { latitude: 40.85, longitude: -73.97 },
      end_boundary_point: { latitude: 40.82, longitude: -73.98 },
    });
    expect(result).toEqual([[-73.97, 40.85], [-73.98, 40.82]]);
  });

  it("getPreviewRoute synthesizes fallback from place coordinates", () => {
    const result = config.getPreviewRoute({
      start_place: { label: "Fort Lee", latitude: 40.85, longitude: -73.97 },
      end_place: { label: "Edgewater", latitude: 40.82, longitude: -73.98 },
    });
    expect(result).toEqual([[-73.97, 40.85], [-73.98, 40.82]]);
  });

  it("getPreviewRoute prefers boundary points over places for fallback", () => {
    const result = config.getPreviewRoute({
      start_boundary_point: { latitude: 1, longitude: 2 },
      end_boundary_point: { latitude: 3, longitude: 4 },
      start_place: { label: "A", latitude: 10, longitude: 20 },
      end_place: { label: "B", latitude: 30, longitude: 40 },
    });
    expect(result).toEqual([[2, 1], [4, 3]]);
  });

  it("getPreviewRoute returns null when neither route nor places are available", () => {
    expect(config.getPreviewRoute({})).toBeNull();
    expect(config.getPreviewRoute({ start_place: { label: "A" } })).toBeNull();
  });

  it("getDeleteIdentifiers returns entity_type, client_record_id, device_id", () => {
    const item = { entity_type: "speed", client_record_id: "abc", device_id: "d1" };
    expect(config.getDeleteIdentifiers(item)).toEqual({
      entityType: "speed",
      clientRecordId: "abc",
      deviceId: "d1",
    });
  });
});

// ── accel config ─────────────────────────────────────────────────────

describe("accel resource config", () => {
  const config = getResourceConfig(CLOUD_LIBRARY_TAB_KEYS.accel);

  it("has map previewKind", () => {
    expect(config.previewKind).toBe("map");
  });

  it("has detailFromList enabled", () => {
    expect(config.detailFromList).toBe(true);
  });

  it("buildSubtitle includes preset and quality", () => {
    const sub = config.buildSubtitle({
      saved_at_label: "Mar 15",
      preset_id: "0-100",
      quality_grade: "A",
    });
    expect(sub).toContain("Mar 15");
    expect(sub).toContain("0-100");
    expect(sub).toContain("A");
  });

  it("formats metric finish speed as rounded km/h", () => {
    const entries = config.buildMetaEntries({
      finish_speed: 96.8,
      display_unit: "kmh",
    });
    const speedEntry = entries.find(([label]) => label === "Speed");
    expect(speedEntry[1]).toBe("97 km/h");
  });

  it("formats imperial finish speed as rounded mph", () => {
    const entries = config.buildMetaEntries({
      finish_speed: 60.3,
      display_unit: "mph",
    });
    const speedEntry = entries.find(([label]) => label === "Speed");
    expect(speedEntry[1]).toBe("60 mph");
  });

  it("shows fallback dash when finish speed is missing", () => {
    const entries = config.buildMetaEntries({});
    const speedEntry = entries.find(([label]) => label === "Speed");
    expect(speedEntry[1]).toBe("—");
  });

  it("getDeleteIdentifiers returns correct shape", () => {
    const result = config.getDeleteIdentifiers({
      entity_type: "accel",
      client_record_id: "r1",
      device_id: "d2",
    });
    expect(result).toEqual({
      entityType: "accel",
      clientRecordId: "r1",
      deviceId: "d2",
    });
  });
});

// ── boardDocuments config ────────────────────────────────────────────

describe("boardDocuments resource config", () => {
  const config = getResourceConfig(CLOUD_LIBRARY_TAB_KEYS.boardDocuments);

  it("has board-preview previewKind", () => {
    expect(config.previewKind).toBe("board-preview");
  });

  it("has detailFromList enabled", () => {
    expect(config.detailFromList).toBe(true);
  });

  it("canOpen is always true", () => {
    expect(config.canOpen({})).toBe(true);
    expect(config.canOpen(null)).toBe(true);
  });

  it("supports rename", () => {
    expect(config.canRename).toBe(true);
  });

  it("getPreviewRoute always returns null", () => {
    expect(config.getPreviewRoute({ preview_route: [[1, 2], [3, 4]] })).toBeNull();
  });

  it("getDeleteIdentifiers returns name", () => {
    expect(config.getDeleteIdentifiers({ name: "doc-1" })).toEqual({ name: "doc-1" });
  });
});

// ── media config ─────────────────────────────────────────────────────

describe("media resource config", () => {
  const config = getResourceConfig(CLOUD_LIBRARY_TAB_KEYS.media);

  it("has media previewKind", () => {
    expect(config.previewKind).toBe("media");
  });

  it("does not have detailFromList (media uses inline detail)", () => {
    expect(config.detailFromList).toBeFalsy();
  });

  it("canOpen returns true for image media", () => {
    expect(config.canOpen({ media_kind: "image" })).toBe(true);
  });

  it("canOpen returns true for audio media", () => {
    expect(config.canOpen({ media_kind: "audio" })).toBe(true);
  });

  it("canOpen returns true for video media", () => {
    expect(config.canOpen({ media_kind: "video" })).toBe(true);
  });

  it("canOpen returns false for archive media", () => {
    expect(config.canOpen({ media_kind: "archive" })).toBe(false);
  });

  it("canOpen returns false for other media", () => {
    expect(config.canOpen({ media_kind: "other" })).toBe(false);
  });

  it("canOpen returns false when media_kind is missing", () => {
    expect(config.canOpen({})).toBe(false);
    expect(config.canOpen(null)).toBe(false);
  });

  it("supports download", () => {
    expect(config.canDownload).toBe(true);
  });

  it("does not support rename", () => {
    expect(config.canRename).toBe(false);
  });

  it("buildSubtitle includes media_kind and size", () => {
    const sub = config.buildSubtitle({
      created_at_label: "Apr 1",
      media_kind: "image",
      blob_size: 245760,
    });
    expect(sub).toContain("Apr 1");
    expect(sub).toContain("image");
  });

  it("getDeleteIdentifiers returns name", () => {
    expect(config.getDeleteIdentifiers({ name: "media-1" })).toEqual({ name: "media-1" });
  });
});

// ── extractPreviewRouteCoordinates ───────────────────────────────────

describe("extractPreviewRouteCoordinates", () => {
  it("returns null for null/undefined", () => {
    expect(extractPreviewRouteCoordinates(null)).toBeNull();
    expect(extractPreviewRouteCoordinates(undefined)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(extractPreviewRouteCoordinates([])).toBeNull();
  });

  it("returns null for a single-point array", () => {
    expect(extractPreviewRouteCoordinates([[1, 2]])).toBeNull();
  });

  it("extracts from a plain coordinate array", () => {
    const input = [[10, 20], [30, 40]];
    expect(extractPreviewRouteCoordinates(input)).toEqual([[10, 20], [30, 40]]);
  });

  it("extracts from { coordinates: [...] } shape", () => {
    const input = { coordinates: [[10, 20], [30, 40]] };
    expect(extractPreviewRouteCoordinates(input)).toEqual([[10, 20], [30, 40]]);
  });

  it("extracts from { route: [...] } shape", () => {
    const input = { route: [[-73.9, 40.7], [-74.0, 40.8]] };
    expect(extractPreviewRouteCoordinates(input)).toEqual([[-73.9, 40.7], [-74.0, 40.8]]);
  });

  it("extracts from { points: [...] } shape", () => {
    const input = { points: [[1, 2], [3, 4]] };
    expect(extractPreviewRouteCoordinates(input)).toEqual([[1, 2], [3, 4]]);
  });

  it("extracts from { path: [...] } shape", () => {
    const input = { path: [[5, 6], [7, 8]] };
    expect(extractPreviewRouteCoordinates(input)).toEqual([[5, 6], [7, 8]]);
  });

  it("normalizes object-style coordinates [{lon, lat}]", () => {
    const input = [
      { longitude: 10, latitude: 20 },
      { lon: 30, lat: 40 },
      { lng: 50, lat: 60 },
    ];
    expect(extractPreviewRouteCoordinates(input)).toEqual([
      [10, 20],
      [30, 40],
      [50, 60],
    ]);
  });

  it("skips invalid entries in a mixed array", () => {
    const input = [[1, 2], "bad", [3, 4], null, [NaN, NaN]];
    expect(extractPreviewRouteCoordinates(input)).toEqual([[1, 2], [3, 4]]);
  });

  it("returns null when all entries are invalid", () => {
    expect(extractPreviewRouteCoordinates(["x", "y"])).toBeNull();
  });

  it("returns null for non-array, non-object values", () => {
    expect(extractPreviewRouteCoordinates("string")).toBeNull();
    expect(extractPreviewRouteCoordinates(42)).toBeNull();
    expect(extractPreviewRouteCoordinates(true)).toBeNull();
  });

  it("returns null for object without matching keys", () => {
    expect(extractPreviewRouteCoordinates({ data: [[1, 2], [3, 4]] })).toBeNull();
  });

  it("handles string numbers in arrays", () => {
    const input = [["10", "20"], ["30", "40"]];
    expect(extractPreviewRouteCoordinates(input)).toEqual([[10, 20], [30, 40]]);
  });
});
