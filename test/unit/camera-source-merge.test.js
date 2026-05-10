import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  extractDirectionTokens,
  mergeCameraRecords,
  normalizeCoordinateKey,
} from "../../scripts/camera-source-merge.mjs";

function record(overrides = {}) {
  const source = overrides.source || "osm";
  const sourceId = overrides.sourceId || 1;
  return {
    source,
    sourceId,
    lon: -73.9857,
    lat: 40.7484,
    country: "us",
    speedKph: null,
    speedMeta: null,
    sourceMeta: {
      sources: [source],
      primarySource: source,
      ids: { [source]: sourceId },
      official: source !== "osm",
      ...overrides.sourceMeta,
    },
    ...overrides,
  };
}

describe("camera source merge", () => {
  it("normalizes coordinate keys and extracts direction tokens", () => {
    expect(normalizeCoordinateKey(-73.1, 40.2)).toBe("-73.100000,40.200000");
    expect(extractDirectionTokens("WB QUEENS BV SENTIDO NORTE-SUR")).toEqual(["NORTE-SUR", "WB"]);
    expect(distanceMeters({ lon: 0, lat: 0 }, { lon: 0, lat: 0.001 })).toBeCloseTo(111, 0);
  });

  it("adds official cameras when there is no OSM match", () => {
    const result = mergeCameraRecords([
      record({ source: "osm", sourceId: 10, lon: -73.9, lat: 40.7 }),
      record({ source: "nyc", sourceId: 20, lon: -74.2, lat: 40.8, sourceMeta: { ids: { nyc: 20 } } }),
    ]);

    expect(result.records).toHaveLength(2);
    expect(result.stats.addedByOfficialSources).toBe(1);
  });

  it("merges official records into nearby OSM records and keeps source IDs", () => {
    const result = mergeCameraRecords([
      record({ source: "osm", sourceId: 10, lon: -73.9857, lat: 40.7484, sourceMeta: { ids: { osm: 10 } } }),
      record({
        source: "nyc",
        sourceId: 20,
        lon: -73.98571,
        lat: 40.74841,
        sourceMeta: { ids: { nyc: 20 }, names: ["Local camera"] },
      }),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].sourceMeta.sources).toEqual(["nyc", "osm"]);
    expect(result.records[0].sourceMeta.ids).toMatchObject({ osm: 10, nyc: 20 });
    expect(result.stats.mergedOfficialIntoOsm).toBe(1);
  });

  it("lets ANSV official speed override missing OSM speed", () => {
    const result = mergeCameraRecords([
      record({ source: "osm", sourceId: 10, lon: -74.1, lat: 4.6, country: "co", sourceMeta: { ids: { osm: 10 } } }),
      record({
        source: "ansv",
        sourceId: "SOL:C2",
        lon: -74.10001,
        lat: 4.60001,
        country: "co",
        speedKph: 60,
        speedMeta: { source: "official:ansv:speed", confidence: "high", raw: "60.0" },
        sourceMeta: { ids: { ansv: "SOL:C2" }, official: true },
      }),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].speedKph).toBe(60);
    expect(result.records[0].speedMeta.source).toBe("official:ansv:speed");
  });

  it("preserves conflicting high-confidence speeds in source metadata", () => {
    const result = mergeCameraRecords([
      record({
        source: "osm",
        sourceId: 10,
        lon: -74.1,
        lat: 4.6,
        country: "co",
        speedKph: 80,
        speedMeta: { source: "camera:maxspeed", confidence: "high", raw: "80" },
        sourceMeta: { ids: { osm: 10 } },
      }),
      record({
        source: "ansv",
        sourceId: "SOL:C2",
        lon: -74.10001,
        lat: 4.60001,
        country: "co",
        speedKph: 60,
        speedMeta: { source: "official:ansv:speed", confidence: "high", raw: "60.0" },
        sourceMeta: { ids: { ansv: "SOL:C2" }, official: true },
      }),
    ]);

    expect(result.records[0].speedKph).toBe(60);
    expect(result.records[0].sourceMeta.speedConflicts).toHaveLength(1);
  });

  it("collapses exact-coordinate NYC directional records into one alert point", () => {
    const result = mergeCameraRecords([
      record({
        source: "nyc",
        sourceId: 1,
        lon: -73.9097138,
        lat: 40.7421843,
        sourceMeta: { ids: { nyc: 1 }, directions: ["WB"], aliases: ["WB QUEENS BV"] },
      }),
      record({
        source: "nyc",
        sourceId: 3,
        lon: -73.9097138,
        lat: 40.7421843,
        sourceMeta: { ids: { nyc: 3 }, directions: ["EB"], aliases: ["EB QUEENS BV"] },
      }),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].sourceMeta.directions).toEqual(["EB", "WB"]);
    expect(result.records[0].sourceMeta.ids.nyc).toEqual(["1", "3"]);
  });
});
