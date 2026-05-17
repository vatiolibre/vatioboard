import KDBush from "kdbush";
import { createIndexedJsonKeyValueStore } from "../shared/indexed-storage.js";

export const CAMERA_MANIFEST_URL = "/geo/cameras/manifest.json";
const CAMERA_DB_NAME = "vatio-speed-cameras-v2";
const CAMERA_STORE_NAME = "cameraArtifacts";
const MANIFEST_CACHE_KEY = "manifest:v2";
const COUNTRY_DECISION_TTL_MS = 5 * 60 * 1000;
const COUNTRY_DECISION_DISTANCE_M = 25000;
const MANIFEST_REVALIDATE_INTERVAL_MS = 30 * 60 * 1000;
const MAX_MEMORY_DATASETS = 16;

const DEFAULT_STATUS = {
  status: "idle",
  activeCountryCode: "",
  activeCountryName: "",
  cameraCount: 0,
  loadedCameraCount: 0,
  lastUpdated: null,
  cacheHit: false,
  offline: false,
  error: null,
  unavailable: false,
  updating: false,
};

function nowMs() {
  return Date.now();
}

function normalizeCountryCode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  if (/^[a-z]{2}-/.test(normalized)) return normalized.slice(0, 2);
  return "";
}

function isFiniteCoordinate(longitude, latitude) {
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90;
}

function containsPoint(bbox, longitude, latitude) {
  return Array.isArray(bbox)
    && bbox.length >= 4
    && longitude >= bbox[0]
    && longitude <= bbox[2]
    && latitude >= bbox[1]
    && latitude <= bbox[3];
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function haversineDistanceM(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const radiusM = 6371000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * radiusM * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function createDefaultStore() {
  return createIndexedJsonKeyValueStore({
    dbName: CAMERA_DB_NAME,
    dbVersion: 1,
    storeName: CAMERA_STORE_NAME,
  });
}

function countryJsonKey(code) {
  return `country:${code}:json:v2`;
}

function countryIndexKey(code) {
  return `country:${code}:index:v2`;
}

function tileManifestKey(code) {
  return `country:${code}:tiles:manifest:v2`;
}

function tileJsonKey(code, tileId) {
  return `country:${code}:tile:${tileId}:json:v2`;
}

function tileIndexKey(code, tileId) {
  return `country:${code}:tile:${tileId}:index:v2`;
}

function datasetKeyForCountry(code) {
  return `country:${code}`;
}

function datasetKeyForTile(code, tileId) {
  return `tile:${code}:${tileId}`;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function sanitizeCameraTraps(payload) {
  const traps = Array.isArray(payload?.traps) ? payload.traps : [];
  return traps.filter((trap) =>
    Array.isArray(trap)
    && trap.length >= 2
    && Number.isFinite(trap[0])
    && Number.isFinite(trap[1]));
}

function buildTrapIndex(traps, KDBushClass) {
  const index = new KDBushClass(traps.length);
  for (const [longitude, latitude] of traps) {
    index.add(longitude, latitude);
  }
  index.finish();
  return index;
}

function normalizeManifest(value) {
  if (value?.version !== 2 || !value.countries || typeof value.countries !== "object") {
    throw new Error("Camera manifest is invalid.");
  }

  return value;
}

function normalizeTileManifest(value, countryCode) {
  if (
    value?.version !== 2
    || normalizeCountryCode(value.country) !== countryCode
    || !value.tiles
    || typeof value.tiles !== "object"
  ) {
    throw new Error("Camera tile manifest is invalid.");
  }

  return value;
}

function normalizeCountryPayload(value, countryCode) {
  if (value?.version !== 2 || normalizeCountryCode(value.country) !== countryCode) {
    throw new Error("Camera country payload is invalid.");
  }

  return {
    ...value,
    traps: sanitizeCameraTraps(value),
    count: sanitizeCameraTraps(value).length,
  };
}

function normalizeTilePayload(value, countryCode, tileId) {
  if (
    value?.version !== 2
    || normalizeCountryCode(value.country) !== countryCode
    || String(value.tile || "") !== tileId
  ) {
    throw new Error("Camera tile payload is invalid.");
  }

  return {
    ...value,
    traps: sanitizeCameraTraps(value),
    count: sanitizeCameraTraps(value).length,
  };
}

async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") return "";
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function assertJsonHash(jsonText, expectedHash) {
  if (!expectedHash) return;
  const actualHash = await sha256Hex(jsonText);
  if (actualHash && actualHash !== expectedHash) {
    throw new Error("Camera artifact hash mismatch.");
  }
}

async function responseJsonText(response) {
  const text = await response.text();
  return {
    text,
    payload: JSON.parse(text),
  };
}

function cloneStatus(status) {
  return { ...status };
}

function getTileCoordinate(longitude, latitude, tileSize) {
  const size = Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 1;
  return {
    x: Math.floor((longitude + 180) / size),
    y: Math.floor((latitude + 90) / size),
  };
}

function tileIdFromCoordinate(coordinate) {
  return `${coordinate.y}_${coordinate.x}`;
}

function getNeighborTileIds(longitude, latitude, tileSize) {
  const center = getTileCoordinate(longitude, latitude, tileSize);
  const tileIds = [];

  for (let y = center.y - 1; y <= center.y + 1; y += 1) {
    for (let x = center.x - 1; x <= center.x + 1; x += 1) {
      tileIds.push(tileIdFromCoordinate({ x, y }));
    }
  }

  return tileIds;
}

export function createCameraDatabase({
  manifestUrl = CAMERA_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
  store = createDefaultStore(),
  KDBushClass = KDBush,
  onStatusChange = null,
  clock = nowMs,
} = {}) {
  let manifest = null;
  let status = { ...DEFAULT_STATUS };
  let lastCountryDecision = null;
  let activeCountryCode = "";
  let previousCountryCode = "";
  let lastLocation = null;
  let lastManifestRevalidateAtMs = 0;
  let destroyed = false;
  const memoryDatasets = new Map();
  const tileManifests = new Map();
  const inflight = new Map();
  const pendingBackground = new Set();
  const controllers = new Set();

  function emitStatus(patch = {}) {
    status = {
      ...status,
      ...patch,
    };
    if (destroyed || typeof onStatusChange !== "function") return;
    onStatusChange(cloneStatus(status));
  }

  function trackBackground(promise) {
    pendingBackground.add(promise);
    promise.finally(() => {
      pendingBackground.delete(promise);
    });
    return promise;
  }

  function createSignal(externalSignal) {
    const controller = new AbortController();
    controllers.add(controller);
    let removeExternalAbort = null;

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        const abort = () => controller.abort();
        externalSignal.addEventListener("abort", abort, { once: true });
        removeExternalAbort = () => externalSignal.removeEventListener("abort", abort);
      }
    }

    return {
      signal: controller.signal,
      cleanup() {
        controllers.delete(controller);
        removeExternalAbort?.();
      },
    };
  }

  async function fetchText(url, { signal } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Camera database fetch is unavailable.");
    }
    const response = await fetchImpl(url, { cache: "no-cache", signal });
    if (!response.ok) {
      throw new Error(`Camera database request failed with ${response.status}`);
    }
    return response;
  }

  async function fetchManifest({ signal } = {}) {
    const response = await fetchText(manifestUrl, { signal });
    const { payload } = await responseJsonText(response);
    const nextManifest = normalizeManifest(payload);
    await store.setValue(MANIFEST_CACHE_KEY, {
      payload: nextManifest,
      storedAt: new Date(clock()).toISOString(),
    });
    manifest = nextManifest;
    return nextManifest;
  }

  async function revalidateManifest({ signal } = {}) {
    try {
      lastManifestRevalidateAtMs = clock();
      const nextManifest = await fetchManifest({ signal });
      emitStatus({
        updating: false,
        offline: false,
        error: null,
        lastUpdated: nextManifest.generatedAt || status.lastUpdated,
      });

      if (activeCountryCode && nextManifest.countries?.[activeCountryCode]) {
        trackBackground(loadCountryByEntry(activeCountryCode, nextManifest.countries[activeCountryCode], {
          signal,
          longitude: lastLocation?.longitude,
          latitude: lastLocation?.latitude,
          forceNetwork: true,
          allowCachedFallback: true,
        }).then(() => {
          const entry = nextManifest.countries[activeCountryCode];
          emitStatus({
            status: "ready",
            activeCountryCode,
            activeCountryName: entry.name || activeCountryCode.toUpperCase(),
            cameraCount: entry.count || 0,
            loadedCameraCount: summarizeLoadedDatasets(activeCountryCode),
            lastUpdated: entry.generatedAt || nextManifest.generatedAt || null,
            cacheHit: false,
            offline: false,
            updating: false,
            unavailable: false,
            error: null,
          });
          return null;
        }).catch(() => null));
      }
    } catch (error) {
      if (isAbortError(error)) return;
      emitStatus({
        status: status.cameraCount > 0 ? "offline" : "error",
        offline: true,
        updating: false,
        error,
      });
    }
  }

  async function getManifest({ signal } = {}) {
    if (manifest) {
      if (!pendingBackground.size && clock() - lastManifestRevalidateAtMs > MANIFEST_REVALIDATE_INTERVAL_MS) {
        emitStatus({ updating: true });
        trackBackground(Promise.resolve().then(() => revalidateManifest({ signal })));
      }
      return manifest;
    }

    const cached = await store.getValue(MANIFEST_CACHE_KEY);
    if (cached?.payload) {
      try {
        manifest = normalizeManifest(cached.payload);
        emitStatus({
          status: "stale",
          cacheHit: true,
          offline: false,
          lastUpdated: manifest.generatedAt || cached.storedAt || null,
          updating: true,
        });
        if (clock() - lastManifestRevalidateAtMs > MANIFEST_REVALIDATE_INTERVAL_MS) {
          trackBackground(Promise.resolve().then(() => revalidateManifest({ signal })));
        }
        return manifest;
      } catch {
        await store.deleteValue?.(MANIFEST_CACHE_KEY);
      }
    }

    emitStatus({ status: "loading", cacheHit: false, offline: false, error: null });
    try {
      const fetched = await fetchManifest({ signal });
      emitStatus({
        status: "ready",
        cacheHit: false,
        offline: false,
        error: null,
        lastUpdated: fetched.generatedAt || null,
      });
      return fetched;
    } catch (error) {
      if (isAbortError(error)) throw error;
      emitStatus({
        status: "error",
        offline: true,
        error,
        unavailable: true,
      });
      throw error;
    }
  }

  function getCountryCodesForLocation(currentManifest, { longitude, latitude, countryCode = "" }) {
    const explicitCountryCode = normalizeCountryCode(countryCode);
    if (explicitCountryCode && currentManifest.countries?.[explicitCountryCode]) {
      return [explicitCountryCode];
    }

    if (
      lastCountryDecision
      && clock() - lastCountryDecision.decidedAtMs < COUNTRY_DECISION_TTL_MS
      && haversineDistanceM(lastCountryDecision.point, { longitude, latitude }) < COUNTRY_DECISION_DISTANCE_M
    ) {
      return lastCountryDecision.countryCodes;
    }

    const countryCodes = Object.entries(currentManifest.countries || {})
      .filter(([, entry]) => containsPoint(entry.bbox, longitude, latitude))
      .map(([code]) => code)
      .sort((a, b) => {
        if (a === "zz") return 1;
        if (b === "zz") return -1;
        return a.localeCompare(b);
      });

    lastCountryDecision = {
      point: { longitude, latitude },
      countryCodes,
      decidedAtMs: clock(),
    };

    return countryCodes;
  }

  function touchDataset(key, dataset) {
    memoryDatasets.delete(key);
    memoryDatasets.set(key, {
      ...dataset,
      lastUsedAt: clock(),
    });

    while (memoryDatasets.size > MAX_MEMORY_DATASETS) {
      const [oldestKey] = memoryDatasets.keys();
      memoryDatasets.delete(oldestKey);
    }
  }

  function createDataset({
    key,
    countryCode,
    countryName,
    tileId = "",
    payload,
    index,
    source,
    cacheHit,
    countryTotalCount,
    manifestEntry,
  }) {
    const traps = sanitizeCameraTraps(payload);
    const dataset = {
      key,
      country: countryCode,
      countryName,
      tileId,
      traps,
      index,
      count: traps.length,
      generatedAt: payload.generatedAt || manifestEntry?.generatedAt || null,
      source,
      cacheHit,
      countryTotalCount,
      manifestEntry,
    };
    touchDataset(key, dataset);
    return dataset;
  }

  async function readCachedDataset({
    jsonKey,
    indexKey,
    countryCode,
    countryName,
    tileId = "",
    manifestEntry,
    normalizePayload,
    datasetKey,
  }) {
    const cached = await store.getValue(jsonKey);
    if (!cached?.payload) return null;

    const payload = normalizePayload(cached.payload);
    const cachedIndex = await store.getValue(indexKey);
    let index = null;
    try {
      if (cachedIndex?.buffer) {
        index = KDBushClass.from(cachedIndex.buffer);
      }
    } catch {
      index = null;
    }
    if (!index) {
      index = buildTrapIndex(payload.traps, KDBushClass);
    }

    return createDataset({
      key: datasetKey,
      countryCode,
      countryName,
      tileId,
      payload,
      index,
      source: "cached",
      cacheHit: true,
      countryTotalCount: manifestEntry.count,
      manifestEntry,
    });
  }

  async function fetchIndex(url, { signal } = {}) {
    if (!url) return null;
    try {
      const response = await fetchImpl(url, { cache: "no-cache", signal });
      if (!response.ok) return null;
      return await response.arrayBuffer();
    } catch {
      return null;
    }
  }

  async function fetchDataset({
    url,
    indexUrl,
    expectedHash,
    jsonKey,
    indexKey,
    countryCode,
    countryName,
    tileId = "",
    manifestEntry,
    normalizePayload,
    datasetKey,
    signal,
  }) {
    const response = await fetchText(url, { signal });
    const { text, payload: rawPayload } = await responseJsonText(response);
    await assertJsonHash(text, expectedHash);
    const payload = normalizePayload(rawPayload);
    let indexBuffer = await fetchIndex(indexUrl, { signal });
    let index = null;

    try {
      if (indexBuffer) {
        index = KDBushClass.from(indexBuffer);
      }
    } catch {
      indexBuffer = null;
      index = null;
    }

    if (!index) {
      index = buildTrapIndex(payload.traps, KDBushClass);
    }

    await Promise.all([
      store.setValue(jsonKey, {
        hash: expectedHash || "",
        payload,
        storedAt: new Date(clock()).toISOString(),
      }),
      indexBuffer
        ? store.setValue(indexKey, {
          hash: expectedHash || "",
          buffer: indexBuffer,
          storedAt: new Date(clock()).toISOString(),
        })
        : Promise.resolve(false),
    ]);

    return createDataset({
      key: datasetKey,
      countryCode,
      countryName,
      tileId,
      payload,
      index,
      source: "network",
      cacheHit: false,
      countryTotalCount: manifestEntry.count,
      manifestEntry,
    });
  }

  function loadInflight(key, factory) {
    if (inflight.has(key)) return inflight.get(key);
    const promise = factory().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  async function loadDatasetWithCache({
    cacheKey,
    jsonKey,
    indexKey,
    countryCode,
    countryName,
    tileId = "",
    manifestEntry,
    artifactEntry,
    normalizePayload,
    forceNetwork = false,
    allowCachedFallback = true,
    signal,
  }) {
    const existing = memoryDatasets.get(cacheKey);
    if (existing && !forceNetwork) {
      touchDataset(cacheKey, existing);
      return { dataset: existing, cacheHit: existing.cacheHit };
    }

    const cachedDataset = allowCachedFallback
      ? await readCachedDataset({
        jsonKey,
        indexKey,
        countryCode,
        countryName,
        tileId,
        manifestEntry,
        normalizePayload,
        datasetKey: cacheKey,
      }).catch(() => null)
      : null;

    if (cachedDataset && !forceNetwork) {
      trackBackground(Promise.resolve().then(() => loadDatasetWithCache({
        cacheKey,
        jsonKey,
        indexKey,
        countryCode,
        countryName,
        tileId,
        manifestEntry,
        artifactEntry,
        normalizePayload,
        forceNetwork: true,
        allowCachedFallback: false,
        signal,
      })).then(() => {
        emitStatus({
          status: "ready",
          loadedCameraCount: summarizeLoadedDatasets(activeCountryCode),
          cacheHit: false,
          offline: false,
          updating: false,
          unavailable: false,
          error: null,
        });
        return null;
      }).catch((error) => {
        if (!isAbortError(error)) {
          emitStatus({
            status: "offline",
            offline: true,
            cacheHit: true,
            updating: false,
            error,
          });
        }
        return null;
      }));
      return { dataset: cachedDataset, cacheHit: true };
    }

    try {
      const dataset = await fetchDataset({
        url: artifactEntry.json,
        indexUrl: artifactEntry.index,
        expectedHash: artifactEntry.sha256,
        jsonKey,
        indexKey,
        countryCode,
        countryName,
        tileId,
        manifestEntry,
        normalizePayload,
        datasetKey: cacheKey,
        signal,
      });
      return { dataset, cacheHit: false };
    } catch (error) {
      if (cachedDataset) {
        emitStatus({
          status: "offline",
          offline: true,
          cacheHit: true,
          updating: false,
          error,
        });
        return { dataset: cachedDataset, cacheHit: true };
      }
      throw error;
    }
  }

  async function loadCountryDataset(countryCode, entry, options = {}) {
    const countryName = entry.name || countryCode.toUpperCase();
    const cacheKey = datasetKeyForCountry(countryCode);
    return loadInflight(cacheKey, () => loadDatasetWithCache({
      cacheKey,
      jsonKey: countryJsonKey(countryCode),
      indexKey: countryIndexKey(countryCode),
      countryCode,
      countryName,
      manifestEntry: entry,
      artifactEntry: entry,
      normalizePayload: (payload) => normalizeCountryPayload(payload, countryCode),
      ...options,
    }));
  }

  async function fetchTileManifest(countryCode, entry, { signal } = {}) {
    const response = await fetchText(entry.tiles || entry.json, { signal });
    const { text, payload } = await responseJsonText(response);
    await assertJsonHash(text, entry.sha256);
    const nextTileManifest = normalizeTileManifest(payload, countryCode);
    await store.setValue(tileManifestKey(countryCode), {
      hash: entry.sha256 || "",
      payload: nextTileManifest,
      storedAt: new Date(clock()).toISOString(),
    });
    tileManifests.set(countryCode, nextTileManifest);
    return nextTileManifest;
  }

  async function getTileManifest(countryCode, entry, { signal } = {}) {
    if (tileManifests.has(countryCode)) return tileManifests.get(countryCode);

    const cached = await store.getValue(tileManifestKey(countryCode));
    if (cached?.payload) {
      try {
        const cachedManifest = normalizeTileManifest(cached.payload, countryCode);
        tileManifests.set(countryCode, cachedManifest);
        trackBackground(fetchTileManifest(countryCode, entry, { signal }).catch(() => null));
        return cachedManifest;
      } catch {
        await store.deleteValue?.(tileManifestKey(countryCode));
      }
    }

    return fetchTileManifest(countryCode, entry, { signal });
  }

  async function loadTiledCountryDatasets(countryCode, entry, { longitude, latitude, signal, forceNetwork = false } = {}) {
    const tileManifest = await getTileManifest(countryCode, entry, { signal });
    const tileSize = Number.isFinite(tileManifest.tileSize) ? tileManifest.tileSize : entry.tileSize;
    const tileIds = getNeighborTileIds(longitude, latitude, tileSize)
      .filter((tileId) => tileManifest.tiles[tileId]);

    const countryName = entry.name || countryCode.toUpperCase();
    const results = await Promise.all(tileIds.map((tileId) => {
      const tileEntry = tileManifest.tiles[tileId];
      const cacheKey = datasetKeyForTile(countryCode, tileId);
      return loadInflight(cacheKey, () => loadDatasetWithCache({
        cacheKey,
        jsonKey: tileJsonKey(countryCode, tileId),
        indexKey: tileIndexKey(countryCode, tileId),
        countryCode,
        countryName,
        tileId,
        manifestEntry: entry,
        artifactEntry: tileEntry,
        normalizePayload: (payload) => normalizeTilePayload(payload, countryCode, tileId),
        forceNetwork,
        signal,
      }));
    }));

    return results;
  }

  async function loadCountryByEntry(countryCode, entry, options = {}) {
    if (entry.tiled) {
      if (!Number.isFinite(options.longitude) || !Number.isFinite(options.latitude)) {
        return [];
      }
      return loadTiledCountryDatasets(countryCode, entry, options);
    }
    const result = await loadCountryDataset(countryCode, entry, options);
    return [result];
  }

  function summarizeLoadedDatasets(countryCode = activeCountryCode) {
    const datasets = getLoadedDatasets();
    const activeDatasets = datasets.filter((dataset) => dataset.country === countryCode);
    return activeDatasets.reduce((sum, dataset) => sum + dataset.count, 0);
  }

  async function loadForLocation({ longitude, latitude, countryCode = "" } = {}, { signal: externalSignal } = {}) {
    if (!isFiniteCoordinate(longitude, latitude)) {
      emitStatus({
        status: "error",
        unavailable: true,
        error: new Error("Camera database needs a valid GPS coordinate."),
      });
      return { datasets: getLoadedDatasets(), status: getStatus() };
    }

    const { signal, cleanup } = createSignal(externalSignal);
    try {
      lastLocation = { longitude, latitude };
      const currentManifest = await getManifest({ signal });
      const countryCodes = getCountryCodesForLocation(currentManifest, {
        longitude,
        latitude,
        countryCode,
      });

      if (countryCodes.length === 0) {
        emitStatus({
          status: "error",
          activeCountryCode: "",
          activeCountryName: "",
          cameraCount: 0,
          loadedCameraCount: 0,
          cacheHit: false,
          unavailable: true,
          offline: false,
          error: new Error("Camera database unavailable for this region."),
        });
        return { datasets: getLoadedDatasets(), status: getStatus() };
      }

      previousCountryCode = activeCountryCode && activeCountryCode !== countryCodes[0]
        ? activeCountryCode
        : previousCountryCode;
      activeCountryCode = countryCodes[0];
      const entry = currentManifest.countries[activeCountryCode];
      emitStatus({
        status: memoryDatasets.size ? "stale" : "loading",
        activeCountryCode,
        activeCountryName: entry.name || activeCountryCode.toUpperCase(),
        cameraCount: entry.count || 0,
        loadedCameraCount: summarizeLoadedDatasets(activeCountryCode),
        unavailable: false,
        updating: true,
        error: null,
      });

      const results = [];
      for (const code of countryCodes) {
        const countryEntry = currentManifest.countries[code];
        const countryResults = await loadCountryByEntry(code, countryEntry, {
          longitude,
          latitude,
          signal,
        });
        results.push(...countryResults);
      }

      const cacheHit = results.length > 0 && results.every((result) => result.cacheHit);
      emitStatus({
        status: "ready",
        activeCountryCode,
        activeCountryName: entry.name || activeCountryCode.toUpperCase(),
        cameraCount: entry.count || 0,
        loadedCameraCount: summarizeLoadedDatasets(activeCountryCode),
        lastUpdated: entry.generatedAt || currentManifest.generatedAt || null,
        cacheHit,
        offline: false,
        updating: false,
        unavailable: false,
        error: null,
      });

      return { datasets: getLoadedDatasets(), status: getStatus() };
    } catch (error) {
      if (!isAbortError(error)) {
        const hasLoadedData = getLoadedDatasets().length > 0;
        emitStatus({
          status: hasLoadedData ? "offline" : "error",
          cacheHit: hasLoadedData,
          offline: true,
          updating: false,
          unavailable: !hasLoadedData,
          error,
        });
      }
      return { datasets: getLoadedDatasets(), status: getStatus() };
    } finally {
      cleanup();
    }
  }

  function getLoadedDatasets() {
    const allowedCountries = new Set([activeCountryCode, previousCountryCode].filter(Boolean));
    const datasets = Array.from(memoryDatasets.values());
    if (allowedCountries.size === 0) return datasets;
    return datasets.filter((dataset) => allowedCountries.has(dataset.country));
  }

  function getStatus() {
    return cloneStatus(status);
  }

  async function waitForIdle() {
    while (pendingBackground.size > 0 || inflight.size > 0) {
      await Promise.allSettled([
        ...pendingBackground,
        ...inflight.values(),
      ]);
    }
  }

  function abortPending() {
    for (const controller of Array.from(controllers)) {
      controller.abort();
    }
    controllers.clear();
  }

  function destroy() {
    destroyed = true;
    abortPending();
    memoryDatasets.clear();
    tileManifests.clear();
    inflight.clear();
    pendingBackground.clear();
  }

  return {
    abortPending,
    destroy,
    getLoadedDatasets,
    getStatus,
    loadForLocation,
    waitForIdle,
  };
}
