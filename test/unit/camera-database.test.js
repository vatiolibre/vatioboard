import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KDBush from "kdbush";
import { createCameraDatabase } from "../../src/speed/camera-database.js";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

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

function createCountryPayload(traps, country = "us", generatedAt = "2026-05-10T00:00:00.000Z") {
  return {
    version: 2,
    country,
    generatedAt,
    count: traps.length,
    traps,
  };
}

function createCountryEntry(payload, overrides = {}) {
  const json = JSON.stringify(payload);
  return {
    code: payload.country,
    name: payload.country === "us" ? "United States" : payload.country.toUpperCase(),
    count: payload.traps.length,
    json: `/geo/cameras/countries/${payload.country}.json`,
    index: `/geo/cameras/countries/${payload.country}.kdbush`,
    sha256: sha256(json),
    generatedAt: payload.generatedAt,
    bbox: [-130, 20, -60, 55],
    ...overrides,
  };
}

function createManifest(countries) {
  return {
    version: 2,
    generatedAt: "2026-05-10T00:00:00.000Z",
    source: {
      name: "OpenStreetMap Overpass",
      query: "node[\"highway\"=\"speed_camera\"]",
    },
    countries,
  };
}

function createIndexBuffer(traps) {
  const index = new KDBush(traps.length);
  for (const [lon, lat] of traps) {
    index.add(lon, lat);
  }
  index.finish();
  return index.data;
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function bufferResponse(buffer, init = {}) {
  return new Response(buffer, {
    status: 200,
    ...init,
  });
}

async function flushCameraDb(db) {
  await db.waitForIdle();
  await Promise.resolve();
}

describe("speed camera database", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached data when fetch fails", async () => {
    const payload = createCountryPayload([[-73.9857, 40.7484, 48, 1]]);
    const manifest = createManifest({ us: createCountryEntry(payload) });
    const store = createMemoryStore({
      "manifest:v2": { payload: manifest, storedAt: "2026-05-10T00:00:00.000Z" },
      "country:us:json:v2": { payload, hash: manifest.countries.us.sha256 },
      "country:us:index:v2": { buffer: createIndexBuffer(payload.traps), hash: manifest.countries.us.sha256 },
    });
    const db = createCameraDatabase({
      store,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });

    const result = await db.loadForLocation({ longitude: -73.98, latitude: 40.75 });
    await flushCameraDb(db);

    expect(result.datasets).toHaveLength(1);
    expect(db.getLoadedDatasets()[0].traps).toEqual(payload.traps);
    expect(db.getStatus()).toMatchObject({ status: "offline", cacheHit: true, offline: true });
  });

  it("stale-while-revalidate updates cache when the manifest hash changes", async () => {
    const oldPayload = createCountryPayload([[-73.9857, 40.7484, 48, 1]], "us", "2026-05-09T00:00:00.000Z");
    const newPayload = createCountryPayload([[-73.9857, 40.7484, 48, 1], [-73.99, 40.74, 50, 2]]);
    const oldManifest = createManifest({ us: createCountryEntry(oldPayload) });
    const newManifest = createManifest({ us: createCountryEntry(newPayload) });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("manifest.json")) return jsonResponse(newManifest);
      if (String(url).endsWith("us.json")) return jsonResponse(newPayload);
      if (String(url).endsWith("us.kdbush")) return bufferResponse(createIndexBuffer(newPayload.traps));
      return new Response("", { status: 404 });
    });
    const store = createMemoryStore({
      "manifest:v2": { payload: oldManifest, storedAt: "2026-05-09T00:00:00.000Z" },
      "country:us:json:v2": { payload: oldPayload, hash: oldManifest.countries.us.sha256 },
      "country:us:index:v2": { buffer: createIndexBuffer(oldPayload.traps), hash: oldManifest.countries.us.sha256 },
    });
    const db = createCameraDatabase({ store, fetchImpl });

    await db.loadForLocation({ longitude: -73.98, latitude: 40.75 });
    await flushCameraDb(db);

    expect(store.values.get("country:us:json:v2").payload.traps).toEqual(newPayload.traps);
    expect(db.getLoadedDatasets()[0].traps).toEqual(newPayload.traps);
    expect(db.getStatus()).toMatchObject({ status: "ready", cacheHit: false, offline: false });
  });

  it("does not overwrite cache on a corrupt network response", async () => {
    const oldPayload = createCountryPayload([[-73.9857, 40.7484, 48, 1]]);
    const newPayload = createCountryPayload([[-73.99, 40.74, 50, 2]]);
    const oldManifest = createManifest({ us: createCountryEntry(oldPayload) });
    const newManifest = createManifest({ us: createCountryEntry(newPayload) });
    const store = createMemoryStore({
      "manifest:v2": { payload: oldManifest, storedAt: "2026-05-09T00:00:00.000Z" },
      "country:us:json:v2": { payload: oldPayload, hash: oldManifest.countries.us.sha256 },
    });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("manifest.json")) return jsonResponse(newManifest);
      if (String(url).endsWith("us.json")) {
        return new Response("{not-json", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("", { status: 404 });
    });
    const db = createCameraDatabase({ store, fetchImpl });

    await db.loadForLocation({ longitude: -73.98, latitude: 40.75 });
    await flushCameraDb(db);

    expect(store.values.get("country:us:json:v2").payload.traps).toEqual(oldPayload.traps);
    expect(db.getLoadedDatasets()[0].traps).toEqual(oldPayload.traps);
  });

  it("loads only the requested country", async () => {
    const usPayload = createCountryPayload([[-73.9857, 40.7484, 48, 1]], "us");
    const coPayload = createCountryPayload([[-74.1, 4.6, 50, 2]], "co");
    const manifest = createManifest({
      us: createCountryEntry(usPayload),
      co: createCountryEntry(coPayload, {
        name: "Colombia",
        json: "/geo/cameras/countries/co.json",
        index: "/geo/cameras/countries/co.kdbush",
        bbox: [-80, -5, -66, 13],
      }),
    });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("manifest.json")) return jsonResponse(manifest);
      if (String(url).endsWith("us.json")) return jsonResponse(usPayload);
      if (String(url).endsWith("us.kdbush")) return bufferResponse(createIndexBuffer(usPayload.traps));
      if (String(url).endsWith("co.json")) return jsonResponse(coPayload);
      return new Response("", { status: 404 });
    });
    const db = createCameraDatabase({ store: createMemoryStore(), fetchImpl });

    await db.loadForLocation({ longitude: -73.98, latitude: 40.75 });

    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toContain("/geo/cameras/countries/us.json");
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).not.toContain("/geo/cameras/countries/co.json");
  });

  it("rebuilds the index from JSON when the .kdbush artifact is missing", async () => {
    const payload = createCountryPayload([[-73.9857, 40.7484, 48, 1]]);
    const manifest = createManifest({ us: createCountryEntry(payload) });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("manifest.json")) return jsonResponse(manifest);
      if (String(url).endsWith("us.json")) return jsonResponse(payload);
      if (String(url).endsWith("us.kdbush")) return new Response("", { status: 404 });
      return new Response("", { status: 404 });
    });
    const db = createCameraDatabase({ store: createMemoryStore(), fetchImpl });

    await db.loadForLocation({ longitude: -73.98, latitude: 40.75 });
    const dataset = db.getLoadedDatasets()[0];

    expect(dataset.index.range(-74, 40, -73, 41)).toEqual([0]);
  });
});
