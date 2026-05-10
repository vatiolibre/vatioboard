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
    });

    const indexBuffer = await fs.readFile(path.join(outputDir, "countries/us.kdbush"));
    const arrayBuffer = new ArrayBuffer(indexBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(indexBuffer);
    const index = KDBush.from(arrayBuffer);
    expect(index.range(-74, 39, -72, 41)).toEqual([0]);
    expect(index.range(39, -74, 41, -72)).toEqual([]);
  });
});
