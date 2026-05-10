import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import KDBush from "kdbush";
import {
  buildWorldwideCameraArtifacts,
  groupRecordsByCountry,
  normalizeCameraSource,
  parseSpeedKph,
} from "../../scripts/build-worldwide-cameras.mjs";
import { parseMaxspeed } from "../../scripts/camera-maxspeed-enrichment.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vatioboard-cameras-"));
  tempDirs.push(dir);
  return dir;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("build-worldwide-cameras", () => {
  it("parses maxspeed variants including mph", () => {
    expect(parseSpeedKph("50")).toBe(50);
    expect(parseSpeedKph("50 km/h")).toBe(50);
    expect(parseSpeedKph("50 kph")).toBe(50);
    expect(parseSpeedKph("30 mph")).toBe(48);
    expect(parseSpeedKph("signals")).toBeNull();
    expect(parseSpeedKph("50;60")).toBeNull();
    expect(parseSpeedKph("50 @ (22:00-06:00)")).toBeNull();
    expect(parseMaxspeed("DE:urban")).toMatchObject({ parsed: false, reason: "implicit_code" });
  });

  it("skips invalid coordinates and groups by country", () => {
    const normalized = normalizeCameraSource({
      elements: [
        { type: "node", id: 1, lon: -73.9857, lat: 40.7484, tags: { maxspeed: "30 mph", "addr:country": "US" } },
        { type: "node", id: 2, lon: -74.1, lat: 4.6, tags: { maxspeed: "50", "addr:country": "CO" } },
        { type: "node", id: 3, lon: 300, lat: 4.6, tags: { maxspeed: "50", "addr:country": "CO" } },
      ],
    });

    const groups = groupRecordsByCountry(normalized.records);

    expect(normalized.records).toHaveLength(2);
    expect(groups.get("us")).toHaveLength(1);
    expect(groups.get("co")).toHaveLength(1);
  });

  it("emits a manifest with counts and hashes", async () => {
    const dir = await makeTempDir();
    const sourcePath = path.join(dir, "overpass.json");
    const outputDir = path.join(dir, "geo");
    await fs.writeFile(sourcePath, JSON.stringify({
      elements: [
        { type: "node", id: 10, lon: -73.9857, lat: 40.7484, tags: { maxspeed: "30 mph", "addr:country": "US" } },
        { type: "node", id: 11, lon: -73.9858, lat: 40.7485, tags: { maxspeed: "50 km/h", "addr:country": "US" } },
      ],
    }));

    const { manifest } = await buildWorldwideCameraArtifacts({
      sourcePath,
      outputDir,
      generatedAt: "2026-05-10T00:00:00.000Z",
      allowLegacyFallback: false,
      includeLocalSources: false,
    });

    const countryJson = await fs.readFile(path.join(outputDir, "countries/us.json"), "utf8");
    expect(manifest.version).toBe(2);
    expect(manifest.countries.us.count).toBe(2);
    expect(manifest.countries.us.sha256).toBe(sha256(countryJson));
    expect(manifest.speedCoverage).toMatchObject({ total: 2, explicit: 2, inferred: 0, unknown: 0 });
  });

  it("keeps explicit camera maxspeed ahead of road enrichment", async () => {
    const dir = await makeTempDir();
    const sourcePath = path.join(dir, "overpass.json");
    const enrichmentPath = path.join(dir, "enrichment.json");
    const outputDir = path.join(dir, "geo");
    await fs.writeFile(sourcePath, JSON.stringify({
      elements: [
        { type: "node", id: 30, lon: -73.9857, lat: 40.7484, tags: { maxspeed: "30 mph", "addr:country": "US" } },
      ],
    }));
    await fs.writeFile(enrichmentPath, JSON.stringify({
      records: {
        "osm:30": {
          speedKph: 80,
          speedMeta: { source: "nearest_road:maxspeed", confidence: "high", wayId: 9, distanceM: 4, raw: "80" },
        },
      },
    }));

    await buildWorldwideCameraArtifacts({
      sourcePath,
      enrichmentPath,
      outputDir,
      generatedAt: "2026-05-10T00:00:00.000Z",
      allowLegacyFallback: false,
      includeLocalSources: false,
    });

    const country = JSON.parse(await fs.readFile(path.join(outputDir, "countries/us.json"), "utf8"));
    expect(country.traps[0]).toEqual([-73.9857, 40.7484, 48, 30]);
  });

  it("uses maxspeed enrichment sidecar when camera maxspeed is missing", async () => {
    const dir = await makeTempDir();
    const sourcePath = path.join(dir, "overpass.json");
    const enrichmentPath = path.join(dir, "enrichment.json");
    const outputDir = path.join(dir, "geo");
    await fs.writeFile(sourcePath, JSON.stringify({
      elements: [
        { type: "node", id: 40, lon: -73.9857, lat: 40.7484, tags: { "addr:country": "US" } },
      ],
    }));
    await fs.writeFile(enrichmentPath, JSON.stringify({
      records: {
        "osm:40": {
          speedKph: 50,
          speedMeta: { source: "nearest_road:maxspeed", confidence: "medium", wayId: 12, distanceM: 24, raw: "50" },
        },
      },
    }));

    await buildWorldwideCameraArtifacts({
      sourcePath,
      enrichmentPath,
      outputDir,
      generatedAt: "2026-05-10T00:00:00.000Z",
      allowLegacyFallback: false,
      includeLocalSources: false,
    });

    const country = JSON.parse(await fs.readFile(path.join(outputDir, "countries/us.json"), "utf8"));
    expect(country.traps[0]).toEqual([
      -73.9857,
      40.7484,
      50,
      40,
      { source: "nearest_road:maxspeed", confidence: "medium", wayId: 12, distanceM: 24, raw: "50" },
    ]);
  });

  it("keeps unknown speed null and reports manifest coverage", async () => {
    const dir = await makeTempDir();
    const sourcePath = path.join(dir, "overpass.json");
    const enrichmentPath = path.join(dir, "enrichment.json");
    const outputDir = path.join(dir, "geo");
    await fs.writeFile(sourcePath, JSON.stringify({
      elements: [
        { type: "node", id: 50, lon: -73.9857, lat: 40.7484, tags: { maxspeed: "30 mph", "addr:country": "US" } },
        { type: "node", id: 51, lon: -73.9858, lat: 40.7485, tags: { "addr:country": "US" } },
        { type: "node", id: 52, lon: -73.9859, lat: 40.7486, tags: { "addr:country": "US" } },
      ],
    }));
    await fs.writeFile(enrichmentPath, JSON.stringify({
      records: {
        "osm:51": {
          speedKph: 50,
          speedMeta: { source: "nearest_road:maxspeed", confidence: "high", wayId: 20, distanceM: 12, raw: "50" },
        },
      },
    }));

    const { manifest } = await buildWorldwideCameraArtifacts({
      sourcePath,
      enrichmentPath,
      outputDir,
      generatedAt: "2026-05-10T00:00:00.000Z",
      allowLegacyFallback: false,
      includeLocalSources: false,
    });

    const country = JSON.parse(await fs.readFile(path.join(outputDir, "countries/us.json"), "utf8"));
    expect(country.traps.find((trap) => trap[3] === 52)[2]).toBeNull();
    expect(country.traps.find((trap) => trap[3] === 52)[4]).toBeUndefined();
    expect(manifest.speedCoverage).toMatchObject({ total: 3, explicit: 1, inferred: 1, unknown: 1 });
    expect(manifest.countries.us.speedCoverage).toMatchObject({ total: 3, explicit: 1, inferred: 1, unknown: 1 });
  });

  it("generates a KDBush index with longitude/latitude order", async () => {
    const dir = await makeTempDir();
    const sourcePath = path.join(dir, "overpass.json");
    const outputDir = path.join(dir, "geo");
    await fs.writeFile(sourcePath, JSON.stringify({
      elements: [
        { type: "node", id: 20, lon: -73, lat: 40, tags: { "addr:country": "US" } },
      ],
    }));

    await buildWorldwideCameraArtifacts({
      sourcePath,
      outputDir,
      generatedAt: "2026-05-10T00:00:00.000Z",
      allowLegacyFallback: false,
      includeLocalSources: false,
    });

    const indexBuffer = await fs.readFile(path.join(outputDir, "countries/us.kdbush"));
    const arrayBuffer = new ArrayBuffer(indexBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(indexBuffer);
    const index = KDBush.from(arrayBuffer);
    expect(index.range(-74, 39, -72, 41)).toEqual([0]);
    expect(index.range(39, -74, 41, -72)).toEqual([]);
  });

  it("merges OSM, ANSV, NYC, and NYC ticket sources into worldwide artifacts", async () => {
    const dir = await makeTempDir();
    const sourcePath = path.join(dir, "overpass.json");
    const enrichmentPath = path.join(dir, "enrichment.json");
    const ansvPath = path.join(dir, "ansv.geojson");
    const nycPath = path.join(dir, "nyc.geojson");
    const ticketPath = path.join(dir, "nyc-tickets.geojson");
    const outputDir = path.join(dir, "geo");
    await fs.writeFile(sourcePath, JSON.stringify({
      elements: [
        { type: "node", id: 90, lon: -74.1, lat: 4.6, tags: { "addr:country": "CO" } },
        { type: "node", id: 91, lon: -73.9098, lat: 40.74218, tags: { "addr:country": "US" } },
      ],
    }));
    await fs.writeFile(enrichmentPath, JSON.stringify({ records: {} }));
    await fs.writeFile(ansvPath, JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [-74.10001, 4.60001] },
        properties: {
          request_code: "SOL1",
          device_name: "C2",
          operation_status: "Operando",
          department: "CUNDINAMARCA",
          municipality: "BOGOTA",
          address: "RUTA 1 SENTIDO NORTE-SUR",
          speed: "60.0",
          infractions: "C29",
          jurisdiction: "Municipal",
        },
      }],
    }));
    await fs.writeFile(nycPath, JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.9097138, 40.7421843] },
        properties: {
          id: 7,
          name: "Queens Bv b/t 58 St and 53 St",
          origName: ["WB QUEENS BV 58 ST -53 ST"],
        },
      }],
    }));
    await fs.writeFile(ticketPath, JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.9097138, 40.7421843] },
        properties: {
          name: "Queens Bv b/t 58 St and 53 St",
          origName: ["WB QUEENS BV 58 ST -53 ST"],
          dates: [{ date: "2014-01-16", tickets: 5 }],
        },
      }],
    }));

    const { manifest } = await buildWorldwideCameraArtifacts({
      sourcePath,
      enrichmentPath,
      outputDir,
      generatedAt: "2026-05-10T00:00:00.000Z",
      allowLegacyFallback: false,
      localSourcePaths: [ansvPath, nycPath, ticketPath],
    });

    const co = JSON.parse(await fs.readFile(path.join(outputDir, "countries/co.json"), "utf8"));
    const us = JSON.parse(await fs.readFile(path.join(outputDir, "countries/us.json"), "utf8"));
    expect(co.traps[0][2]).toBe(60);
    expect(co.traps[0][4]).toMatchObject({ source: "official:ansv:speed" });
    expect(co.traps[0][5]).toMatchObject({
      primarySource: "ansv",
      sources: expect.arrayContaining(["ansv", "osm"]),
      official: true,
    });
    expect(us.traps[0][5]).toMatchObject({
      primarySource: "nyc",
      sources: expect.arrayContaining(["nyc", "nyc-tickets", "osm"]),
      ticketStats: expect.objectContaining({ totalTickets: 5 }),
    });
    expect(manifest.source.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(["osm", "osm-maxspeed-enrichment", "ansv", "nyc", "nyc-tickets"]),
    );
    expect(manifest.sourceCoverage.byContributingSource).toMatchObject({
      ansv: 1,
      nyc: 1,
      "nyc-tickets": 1,
    });
  });
});
