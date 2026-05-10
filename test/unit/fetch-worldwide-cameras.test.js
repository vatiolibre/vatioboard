import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWorldwideCameras,
  fetchWorldwideCameraMaxspeedEnrichment,
} from "../../scripts/fetch-worldwide-cameras.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vatioboard-fetch-cameras-"));
  tempDirs.push(dir);
  return dir;
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function camera(overrides = {}) {
  return {
    type: "node",
    id: 100,
    lon: 0,
    lat: 0,
    tags: {},
    ...overrides,
  };
}

function way(overrides = {}) {
  return {
    type: "way",
    id: 200,
    tags: { highway: "residential", maxspeed: "50" },
    geometry: [
      { lat: -0.001, lon: 0 },
      { lat: 0.001, lon: 0 },
    ],
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("fetch-worldwide-cameras", () => {
  it("prints global camera fetch start and completion progress", async () => {
    const dir = await makeTempDir();
    const outputPath = path.join(dir, "overpass.json");
    const logs = [];

    const result = await fetchWorldwideCameras({
      outputPath,
      overpassUrl: "https://overpass.test/api/interpreter",
      fetchImpl: vi.fn(async () => jsonResponse({
        elements: [
          camera({ id: 1, lon: 1, lat: 1 }),
        ],
      })),
      progressIntervalMs: 0,
      logProgress: (message) => logs.push(message),
    });

    expect(result.count).toBe(1);
    expect(logs.join("\n")).toContain("Fetching global OSM speed cameras");
    expect(logs.join("\n")).toContain("Fetched 1 global OSM speed camera element");
  });

  it("uses the cached global camera payload unless refresh is requested", async () => {
    const dir = await makeTempDir();
    const outputPath = path.join(dir, "overpass.json");
    const logs = [];
    await fs.writeFile(outputPath, JSON.stringify({
      elements: [
        camera({ id: 1, lon: 1, lat: 1 }),
        camera({ id: 2, lon: 2, lat: 2 }),
      ],
    }));

    const fetchImpl = vi.fn(async () => {
      throw new Error("network should not be used when camera cache is valid");
    });
    const result = await fetchWorldwideCameras({
      outputPath,
      fetchImpl,
      logProgress: (message) => logs.push(message),
    });

    expect(result).toMatchObject({ count: 2, cacheHit: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Using cached global OSM speed cameras");
    expect(logs.join("\n")).toContain("CAMERA_REFRESH_CACHE=1");
  });

  it("resumes road enrichment from cached tile files by default", async () => {
    const dir = await makeTempDir();
    const roadCacheDir = path.join(dir, "osm-road-speeds");
    const outputPath = path.join(dir, "enrichment.json");
    const cachePath = path.join(roadCacheDir, "1deg_90_180.json");
    const logs = [];
    const sleeps = [];
    await fs.mkdir(roadCacheDir, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({
      version: 1,
      generatedAt: "2026-05-10T00:00:00.000Z",
      tileId: "1deg_90_180",
      elements: [way()],
    }));

    const result = await fetchWorldwideCameraMaxspeedEnrichment({
      cameras: [camera()],
      roadCacheDir,
      outputPath,
      fetchImpl: vi.fn(async () => {
        throw new Error("network should not be used for cached tiles");
      }),
      sleepImpl: async (delayMs) => sleeps.push(delayMs),
      requestDelayMs: 5000,
      generatedAt: "2026-05-10T00:00:00.000Z",
      logProgress: (message) => logs.push(message),
    });

    const sidecar = JSON.parse(await fs.readFile(outputPath, "utf8"));
    expect(result).toMatchObject({ records: 1, fetchedTiles: 0, cachedTiles: 1, failedTiles: 0 });
    expect(sidecar.records["osm:100"]).toMatchObject({ speedKph: 50 });
    expect(sidecar.tiles["1deg_90_180"]).toMatchObject({ cacheHit: true, source: "cache" });
    expect(sleeps).toEqual([]);
    expect(logs.join("\n")).toContain("resume from cached tiles");
    expect(logs.join("\n")).toContain("Road tile 1/1 1deg_90_180: cache");
  });

  it("prints tile labels in retry progress and writes fetched road cache", async () => {
    const dir = await makeTempDir();
    const roadCacheDir = path.join(dir, "osm-road-speeds");
    const outputPath = path.join(dir, "enrichment.json");
    const retries = [];
    const logs = [];
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response("busy", { status: 504 });
      }
      return jsonResponse({ elements: [way({ id: 201, tags: { highway: "residential", maxspeed: "30 mph" } })] });
    });

    const result = await fetchWorldwideCameraMaxspeedEnrichment({
      cameras: [camera()],
      roadCacheDir,
      outputPath,
      fetchImpl,
      requestDelayMs: 0,
      maxRetries: 1,
      retryInitialDelayMs: 10,
      random: () => 0.5,
      sleepImpl: async () => {},
      onRetry: (retry) => retries.push(retry),
      logProgress: (message) => logs.push(message),
    });

    expect(result).toMatchObject({ records: 1, fetchedTiles: 1, cachedTiles: 0, failedTiles: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(retries[0].label).toBe("Road tile 1/1 1deg_90_180");
    expect(logs.join("\n")).toContain("Road tile 1/1 1deg_90_180: fetching roads");
    expect(logs.join("\n")).toContain("network; roads=1; inferred=1");
    await expect(fs.access(path.join(roadCacheDir, "1deg_90_180.json"))).resolves.toBeUndefined();
  });

  it("can process road enrichment offline without fetching missing tile caches", async () => {
    const dir = await makeTempDir();
    const roadCacheDir = path.join(dir, "osm-road-speeds");
    const outputPath = path.join(dir, "enrichment.json");
    const logs = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error("network should not be used when missing tile fetch is disabled");
    });

    const result = await fetchWorldwideCameraMaxspeedEnrichment({
      cameras: [camera()],
      roadCacheDir,
      outputPath,
      fetchMissing: false,
      fetchImpl,
      logProgress: (message) => logs.push(message),
    });

    const sidecar = JSON.parse(await fs.readFile(outputPath, "utf8"));
    expect(result).toMatchObject({ records: 0, fetchedTiles: 0, cachedTiles: 0, skippedTiles: 1, failedTiles: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sidecar.tiles["1deg_90_180"]).toMatchObject({ source: "missing-cache" });
    expect(logs.join("\n")).toContain("missing-cache fetch disabled");
  });
});
