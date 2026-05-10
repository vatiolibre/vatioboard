import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  compactTrapsToCameraFeatures,
  createCameraMapDataSource,
} from "../../src/speed/camera-map-data-source.js";

function createMemoryStore(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    deleteValue: vi.fn(async (key) => values.delete(key)),
    getValue: vi.fn(async (key) => values.get(key)),
    setValue: vi.fn(async (key, value) => {
      values.set(key, value);
      return true;
    }),
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function countryPayload(country, traps) {
  return {
    version: 2,
    country,
    generatedAt: "2026-05-10T00:00:00.000Z",
    count: traps.length,
    traps,
  };
}

function countryEntry(country, traps, overrides = {}) {
  return {
    code: country,
    name: country.toUpperCase(),
    count: traps.length,
    json: `/geo/cameras/countries/${country}.json`,
    index: null,
    sha256: "",
    generatedAt: "2026-05-10T00:00:00.000Z",
    bbox: [-180, -85, 180, 85],
    ...overrides,
  };
}

function manifest(countries) {
  return {
    version: 2,
    generatedAt: "2026-05-10T00:00:00.000Z",
    source: { name: "OpenStreetMap Overpass" },
    countries,
  };
}

function tilePayload(country, tile, traps) {
  return {
    version: 2,
    country,
    tile,
    generatedAt: "2026-05-10T00:00:00.000Z",
    count: traps.length,
    traps,
  };
}

function abortError() {
  return new DOMException("aborted", "AbortError");
}

describe("camera map data source", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the manifest only once", async () => {
    const payload = manifest({});
    const fetchImpl = vi.fn(async () => jsonResponse(payload));
    const dataSource = createCameraMapDataSource({ store: createMemoryStore(), fetchImpl });

    await dataSource.loadManifest();
    await dataSource.loadManifest();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("selects countries by bbox intersection", async () => {
    const usPayload = countryPayload("us", [[-73.9, 40.7, 48, 1]]);
    const coPayload = countryPayload("co", [[-74.1, 4.6, 50, 2]]);
    const rootManifest = manifest({
      us: countryEntry("us", usPayload.traps, { name: "United States", bbox: [-80, 35, -70, 45] }),
      co: countryEntry("co", coPayload.traps, { name: "Colombia", bbox: [-80, -5, -66, 13] }),
    });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("manifest.json")) return jsonResponse(rootManifest);
      if (String(url).endsWith("us.json")) return jsonResponse(usPayload);
      if (String(url).endsWith("co.json")) return jsonResponse(coPayload);
      return new Response("", { status: 404 });
    });
    const dataSource = createCameraMapDataSource({ store: createMemoryStore(), fetchImpl });

    const result = await dataSource.loadViewport({
      bounds: [-75, 39, -72, 42],
      zoom: 8,
    });

    expect(result.loadedCountries).toEqual(["us"]);
    expect(result.features).toHaveLength(1);
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toContain("/geo/cameras/countries/us.json");
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).not.toContain("/geo/cameras/countries/co.json");
  });

  it("loads only visible tiles for tiled countries", async () => {
    const visibleTile = tilePayload("fr", "138_182", [[2.35, 48.85, 50, 10]]);
    const hiddenTile = tilePayload("fr", "138_184", [[4.5, 48.8, 50, 11]]);
    const tileManifest = {
      version: 2,
      country: "fr",
      generatedAt: "2026-05-10T00:00:00.000Z",
      count: 2,
      tileSize: 1,
      tiles: {
        "138_182": {
          id: "138_182",
          count: 1,
          json: "/geo/cameras/countries/fr/tiles/138_182.json",
          index: null,
          sha256: "",
          bbox: [2, 48, 3, 49],
        },
        "138_184": {
          id: "138_184",
          count: 1,
          json: "/geo/cameras/countries/fr/tiles/138_184.json",
          index: null,
          sha256: "",
          bbox: [4, 48, 5, 49],
        },
      },
    };
    const rootManifest = manifest({
      fr: countryEntry("fr", [], {
        name: "France",
        count: 2,
        json: "/geo/cameras/countries/fr/manifest.json",
        tiles: "/geo/cameras/countries/fr/manifest.json",
        tiled: true,
        tileSize: 1,
        bbox: [-6, 40, 10, 52],
      }),
    });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("manifest.json") && !String(url).includes("/fr/")) return jsonResponse(rootManifest);
      if (String(url).endsWith("/fr/manifest.json")) return jsonResponse(tileManifest);
      if (String(url).endsWith("138_182.json")) return jsonResponse(visibleTile);
      if (String(url).endsWith("138_184.json")) return jsonResponse(hiddenTile);
      return new Response("", { status: 404 });
    });
    const dataSource = createCameraMapDataSource({ store: createMemoryStore(), fetchImpl });

    const result = await dataSource.loadViewport({
      bounds: [2.1, 48.1, 2.9, 48.9],
      zoom: 10,
    });

    expect(result.loadedTiles).toEqual(["fr:138_182"]);
    expect(result.features).toHaveLength(1);
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toContain("/geo/cameras/countries/fr/tiles/138_182.json");
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).not.toContain("/geo/cameras/countries/fr/tiles/138_184.json");
  });

  it("does not load a large untiled country at low zoom", async () => {
    const payload = countryPayload("xx", [[10, 10, null, 1]]);
    const rootManifest = manifest({
      xx: countryEntry("xx", payload.traps, {
        count: 5000,
        bbox: [0, 0, 20, 20],
      }),
    });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("manifest.json")) return jsonResponse(rootManifest);
      if (String(url).endsWith("xx.json")) return jsonResponse(payload);
      return new Response("", { status: 404 });
    });
    const dataSource = createCameraMapDataSource({ store: createMemoryStore(), fetchImpl });

    const result = await dataSource.loadViewport({
      bounds: [0, 0, 20, 20],
      zoom: 3,
    });

    expect(result.features).toHaveLength(0);
    expect(result.status.status).toBe("waiting-zoom");
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).not.toContain("/geo/cameras/countries/xx.json");
  });

  it("converts compact traps to GeoJSON features", () => {
    const features = compactTrapsToCameraFeatures(
      [[-73.9857, 40.7484, 48, 12345]],
      { countryCode: "us", countryName: "United States", tileId: "tile-a" }
    );

    expect(features).toEqual([
      expect.objectContaining({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.9857, 40.7484] },
        properties: expect.objectContaining({
          country: "us",
          countryName: "United States",
          tile: "tile-a",
          speedKph: 48,
          speedSource: "camera:maxspeed",
          speedConfidence: "high",
          osmId: "12345",
        }),
      }),
    ]);
  });

  it("preserves compact trap speed metadata in GeoJSON properties", () => {
    const features = compactTrapsToCameraFeatures(
      [[-73.9857, 40.7484, 50, 12345, {
        source: "nearest_road:maxspeed",
        confidence: "medium",
        wayId: 77,
        distanceM: 18,
        raw: "50",
      }]],
      { countryCode: "us", countryName: "United States" }
    );

    expect(features[0].properties).toMatchObject({
      speedKph: 50,
      speedSource: "nearest_road:maxspeed",
      speedConfidence: "medium",
      sourceWayId: "77",
      distanceM: 18,
    });
  });

  it("preserves compact trap source metadata in GeoJSON properties", () => {
    const sourceMeta = {
      sources: ["osm", "nyc", "nyc-tickets"],
      primarySource: "nyc",
      ids: { osm: 1, nyc: 7 },
      names: ["Queens Bv"],
      official: true,
      jurisdiction: "NYC DOT",
      ticketStats: { totalTickets: 12, firstDate: "2014-01-16", lastDate: "2026-03-18" },
    };
    const features = compactTrapsToCameraFeatures(
      [[-73.9857, 40.7484, null, 1, null, sourceMeta]],
      { countryCode: "us", countryName: "United States" }
    );

    expect(features[0].properties).toMatchObject({
      primarySource: "nyc",
      cameraSources: ["osm", "nyc", "nyc-tickets"],
      official: true,
      jurisdiction: "NYC DOT",
      cameraName: "Queens Bv",
      ticketStats: sourceMeta.ticketStats,
      sourceMeta,
    });
  });

  it("returns cached data if network fetch fails", async () => {
    const payload = countryPayload("us", [[-73.9857, 40.7484, 48, 1]]);
    const rootManifest = manifest({
      us: countryEntry("us", payload.traps, { bbox: [-80, 35, -70, 45] }),
    });
    const store = createMemoryStore({
      "manifest:v2": { payload: rootManifest },
      "country:us:json:v2": { payload },
    });
    const dataSource = createCameraMapDataSource({
      store,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });

    const result = await dataSource.loadViewport({
      bounds: [-75, 39, -72, 42],
      zoom: 8,
    });

    expect(result.features).toHaveLength(1);
    expect(result.status).toMatchObject({
      status: "offline-cached",
      cacheHit: true,
      offline: true,
    });
  });

  it("abort signal prevents late updates", async () => {
    const statuses = [];
    const fetchImpl = vi.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      if (!signal) resolve(jsonResponse(manifest({})));
    }));
    const dataSource = createCameraMapDataSource({
      store: createMemoryStore(),
      fetchImpl,
      onStatusChange: (status) => statuses.push(status),
    });
    const controller = new AbortController();

    const promise = dataSource.loadViewport({ bounds: [-1, -1, 1, 1], zoom: 8, signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(statuses.at(-1).status).toBe("loading-manifest");
  });

  it("destroy aborts pending fetches", async () => {
    const fetchImpl = vi.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      if (!signal) resolve(jsonResponse(manifest({})));
    }));
    const dataSource = createCameraMapDataSource({ store: createMemoryStore(), fetchImpl });

    const promise = dataSource.loadViewport({ bounds: [-1, -1, 1, 1], zoom: 8 });
    await Promise.resolve();
    dataSource.destroy();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
