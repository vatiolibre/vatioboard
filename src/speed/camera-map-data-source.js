import { createIndexedJsonKeyValueStore } from "../shared/indexed-storage.js";

export const CAMERA_MAP_MANIFEST_URL = "/geo/cameras/manifest.json";

const CAMERA_DB_NAME = "vatio-speed-cameras-v2";
const CAMERA_STORE_NAME = "cameraArtifacts";
const MANIFEST_CACHE_KEY = "manifest:v2";
const DEFAULT_MIN_NETWORK_ZOOM = 5;
const DEFAULT_LARGE_UNTILED_COUNT = 2500;
const DEFAULT_LARGE_UNTILED_MIN_ZOOM = 7;
const DEFAULT_MAX_FEATURES = 15000;

const EMPTY_STATUS = {
  status: "idle",
  featureCount: 0,
  loadedCountries: [],
  loadedTiles: [],
  skippedCountries: [],
  cacheHit: false,
  offline: false,
  error: null,
};

function cloneStatus(status) {
  return {
    ...status,
    loadedCountries: [...(status.loadedCountries || [])],
    loadedTiles: [...(status.loadedTiles || [])],
    skippedCountries: [...(status.skippedCountries || [])],
  };
}

function createDefaultStore() {
  return createIndexedJsonKeyValueStore({
    dbName: CAMERA_DB_NAME,
    dbVersion: 1,
    storeName: CAMERA_STORE_NAME,
  });
}

function manifestCacheKey() {
  return MANIFEST_CACHE_KEY;
}

function countryJsonKey(code) {
  return `country:${code}:json:v2`;
}

function tileManifestKey(code) {
  return `country:${code}:tiles:manifest:v2`;
}

function tileJsonKey(code, tileId) {
  return `country:${code}:tile:${tileId}:json:v2`;
}

function datasetKeyForCountry(code) {
  return `country:${code}`;
}

function datasetKeyForTile(code, tileId) {
  return `tile:${code}:${tileId}`;
}

function normalizeCountryCode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  if (/^[a-z]{2}-/.test(normalized)) return normalized.slice(0, 2);
  return "";
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function getAbortError() {
  try {
    return new DOMException("Camera map request aborted.", "AbortError");
  } catch {
    const error = new Error("Camera map request aborted.");
    error.name = "AbortError";
    return error;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw getAbortError();
}

function sanitizeCameraTraps(payload) {
  const traps = Array.isArray(payload?.traps) ? payload.traps : [];
  return traps.filter((trap) =>
    Array.isArray(trap)
    && trap.length >= 2
    && Number.isFinite(trap[0])
    && Number.isFinite(trap[1])
    && trap[0] >= -180
    && trap[0] <= 180
    && trap[1] >= -90
    && trap[1] <= 90);
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
  const traps = sanitizeCameraTraps(value);
  return {
    ...value,
    traps,
    count: traps.length,
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
  const traps = sanitizeCameraTraps(value);
  return {
    ...value,
    traps,
    count: traps.length,
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

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeViewportBounds(bounds) {
  if (Array.isArray(bounds)) {
    if (bounds.length >= 4 && bounds.every((value) => Number.isFinite(Number(value)))) {
      return {
        west: clamp(Number(bounds[0]), -180, 180),
        south: clamp(Number(bounds[1]), -90, 90),
        east: clamp(Number(bounds[2]), -180, 180),
        north: clamp(Number(bounds[3]), -90, 90),
      };
    }
    if (Array.isArray(bounds[0]) && Array.isArray(bounds[1])) {
      return normalizeViewportBounds([
        bounds[0][0],
        bounds[0][1],
        bounds[1][0],
        bounds[1][1],
      ]);
    }
  }

  const west = finiteNumber(bounds?.getWest?.(), finiteNumber(bounds?.west));
  const south = finiteNumber(bounds?.getSouth?.(), finiteNumber(bounds?.south));
  const east = finiteNumber(bounds?.getEast?.(), finiteNumber(bounds?.east));
  const north = finiteNumber(bounds?.getNorth?.(), finiteNumber(bounds?.north));

  if ([west, south, east, north].every(Number.isFinite)) {
    return {
      west: clamp(west, -180, 180),
      south: clamp(Math.min(south, north), -90, 90),
      east: clamp(east, -180, 180),
      north: clamp(Math.max(south, north), -90, 90),
    };
  }

  return {
    west: -180,
    south: -85,
    east: 180,
    north: 85,
  };
}

function bboxIntersectsPlainBounds(bbox, bounds) {
  return Array.isArray(bbox)
    && bbox.length >= 4
    && bbox[2] >= bounds.west
    && bbox[0] <= bounds.east
    && bbox[3] >= bounds.south
    && bbox[1] <= bounds.north;
}

export function cameraMapBoundsIntersect(bbox, boundsInput) {
  const bounds = normalizeViewportBounds(boundsInput);
  if (bounds.west <= bounds.east) {
    return bboxIntersectsPlainBounds(bbox, bounds);
  }
  return bboxIntersectsPlainBounds(bbox, { ...bounds, east: 180 })
    || bboxIntersectsPlainBounds(bbox, { ...bounds, west: -180 });
}

function pointInBounds(longitude, latitude, boundsInput) {
  const bounds = normalizeViewportBounds(boundsInput);
  const longitudeMatches = bounds.west <= bounds.east
    ? longitude >= bounds.west && longitude <= bounds.east
    : longitude >= bounds.west || longitude <= bounds.east;
  return longitudeMatches
    && latitude >= bounds.south
    && latitude <= bounds.north;
}

function readTrapSpeed(trap) {
  if (trap?.[2] === null || trap?.[2] === undefined || trap?.[2] === "") return null;
  const speed = Number(trap?.[2]);
  return Number.isFinite(speed) ? speed : null;
}

function readTrapSpeedMeta(trap) {
  const meta = trap?.[4];
  return meta && typeof meta === "object" ? meta : null;
}

function readSpeedMetaSource(meta, speedKph) {
  if (!meta) return Number.isFinite(speedKph) ? "camera:maxspeed" : "unknown";
  const source = String(meta.source ?? "").trim();
  if (source) return source;
  if (meta.s === "road") return "nearest_road:maxspeed";
  if (meta.s === "camera") return "camera:maxspeed";
  return Number.isFinite(speedKph) ? "camera:maxspeed" : "unknown";
}

function readSpeedMetaConfidence(meta, speedKph) {
  const confidence = String(meta?.confidence ?? meta?.c ?? "").trim();
  if (confidence) return confidence;
  return Number.isFinite(speedKph) ? "high" : "low";
}

function readSourceWayId(meta) {
  const wayId = meta?.wayId ?? meta?.sourceWayId ?? meta?.w;
  if (wayId === null || wayId === undefined || wayId === "") return null;
  return String(wayId);
}

function readDistanceM(meta) {
  const distanceM = Number(meta?.distanceM ?? meta?.d);
  return Number.isFinite(distanceM) ? Math.round(distanceM) : null;
}

function readTrapOsmId(trap) {
  const value = trap?.[3];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function compactTrapsToCameraFeatures(traps, {
  countryCode = "",
  countryName = "",
  tileId = "",
  bounds = null,
  maxFeatures = DEFAULT_MAX_FEATURES,
  startIndex = 0,
} = {}) {
  const features = [];
  const normalizedBounds = bounds ? normalizeViewportBounds(bounds) : null;

  for (let index = 0; index < traps.length; index += 1) {
    if (features.length >= maxFeatures) break;
    const trap = traps[index];
    const longitude = trap?.[0];
    const latitude = trap?.[1];
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    if (normalizedBounds && !pointInBounds(longitude, latitude, normalizedBounds)) continue;

    const osmId = readTrapOsmId(trap);
    const speedKph = readTrapSpeed(trap);
    const speedMeta = readTrapSpeedMeta(trap);
    const featureIndex = startIndex + features.length;
    features.push({
      type: "Feature",
      id: `${countryCode}:${tileId || "country"}:${osmId || featureIndex}`,
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      properties: {
        country: countryCode,
        countryName,
        tile: tileId,
        speedKph,
        speedSource: readSpeedMetaSource(speedMeta, speedKph),
        speedConfidence: readSpeedMetaConfidence(speedMeta, speedKph),
        sourceWayId: readSourceWayId(speedMeta),
        distanceM: readDistanceM(speedMeta),
        osmId,
      },
    });
  }

  return features;
}

function sortEntriesByCode(entries) {
  return entries.sort(([codeA], [codeB]) => {
    if (codeA === "zz") return 1;
    if (codeB === "zz") return -1;
    return codeA.localeCompare(codeB);
  });
}

function selectCountriesForBounds(manifest, bounds) {
  return sortEntriesByCode(Object.entries(manifest.countries || {})
    .filter(([, entry]) => cameraMapBoundsIntersect(entry?.bbox, bounds)));
}

function sortTilesById(tiles) {
  return tiles.sort(([tileA], [tileB]) => tileA.localeCompare(tileB));
}

function selectTilesForBounds(tileManifest, bounds) {
  return sortTilesById(Object.entries(tileManifest.tiles || {})
    .filter(([, entry]) => cameraMapBoundsIntersect(entry?.bbox, bounds)));
}

export function createCameraMapDataSource(options = {}) {
  const {
    manifestUrl = CAMERA_MAP_MANIFEST_URL,
    fetchImpl = globalThis.fetch,
    store = createDefaultStore(),
    clock = () => Date.now(),
    onStatusChange = null,
    minNetworkZoom = DEFAULT_MIN_NETWORK_ZOOM,
    largeUntiledCountryCount = DEFAULT_LARGE_UNTILED_COUNT,
    largeUntiledMinZoom = DEFAULT_LARGE_UNTILED_MIN_ZOOM,
    maxFeatures = DEFAULT_MAX_FEATURES,
  } = options;

  let manifest = null;
  let manifestPromise = null;
  let status = { ...EMPTY_STATUS };
  let destroyed = false;
  let activeRequestId = 0;
  const controllers = new Set();
  const payloads = new Map();
  const tileManifests = new Map();
  const inflight = new Map();

  function emitStatus(patch = {}, requestId = activeRequestId) {
    if (destroyed || requestId !== activeRequestId) return;
    status = {
      ...status,
      ...patch,
    };
    if (typeof onStatusChange === "function") {
      onStatusChange(cloneStatus(status));
    }
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

  async function fetchJson(url, { signal, expectedHash = "" } = {}) {
    throwIfAborted(signal);
    if (typeof fetchImpl !== "function") {
      throw new Error("Camera map fetch is unavailable.");
    }
    const response = await fetchImpl(url, { cache: "no-cache", signal });
    throwIfAborted(signal);
    if (!response?.ok) {
      throw new Error(`Camera map request failed with ${response?.status || 0}`);
    }
    const { text, payload } = await responseJsonText(response);
    await assertJsonHash(text, expectedHash);
    throwIfAborted(signal);
    return payload;
  }

  async function readCachedPayload(key, normalizePayload) {
    const cached = await store.getValue(key);
    if (!cached?.payload) return null;
    try {
      return normalizePayload(cached.payload);
    } catch {
      await store.deleteValue?.(key);
      return null;
    }
  }

  async function writeCachedPayload(key, payload, hash = "") {
    await store.setValue(key, {
      hash: hash || "",
      payload,
      storedAt: new Date(clock()).toISOString(),
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

  async function loadManifest({ signal } = {}) {
    if (manifest) return manifest;
    if (manifestPromise) return manifestPromise;

    manifestPromise = (async () => {
      const cached = await readCachedPayload(manifestCacheKey(), normalizeManifest);

      try {
        const fetched = normalizeManifest(await fetchJson(manifestUrl, { signal }));
        await writeCachedPayload(manifestCacheKey(), fetched);
        manifest = fetched;
        return fetched;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (cached) {
          manifest = cached;
          emitStatus({
            status: "offline-cached",
            cacheHit: true,
            offline: true,
            error,
          });
          return cached;
        }
        throw error;
      }
    })().finally(() => {
      manifestPromise = null;
    });

    return manifestPromise;
  }

  async function loadPayloadWithCache({
    cacheKey,
    url,
    hash = "",
    normalizePayload,
    allowNetwork,
    signal,
  }) {
    if (payloads.has(cacheKey)) {
      return {
        payload: payloads.get(cacheKey),
        cacheHit: true,
        offline: false,
      };
    }

    const cached = await readCachedPayload(cacheKey, normalizePayload);
    if (!allowNetwork) {
      if (!cached) return null;
      payloads.set(cacheKey, cached);
      return { payload: cached, cacheHit: true, offline: false };
    }

    try {
      const fetched = normalizePayload(await fetchJson(url, { signal, expectedHash: hash }));
      await writeCachedPayload(cacheKey, fetched, hash);
      payloads.set(cacheKey, fetched);
      return { payload: fetched, cacheHit: false, offline: false };
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (cached) {
        payloads.set(cacheKey, cached);
        return { payload: cached, cacheHit: true, offline: true, error };
      }
      throw error;
    }
  }

  async function getTileManifest(countryCode, countryEntry, { allowNetwork, signal } = {}) {
    if (tileManifests.has(countryCode)) return {
      manifest: tileManifests.get(countryCode),
      cacheHit: true,
      offline: false,
    };

    const cached = await readCachedPayload(
      tileManifestKey(countryCode),
      (payload) => normalizeTileManifest(payload, countryCode)
    );

    if (!allowNetwork) {
      if (!cached) return null;
      tileManifests.set(countryCode, cached);
      return { manifest: cached, cacheHit: true, offline: false };
    }

    try {
      const fetched = normalizeTileManifest(
        await fetchJson(countryEntry.tiles || countryEntry.json, {
          signal,
          expectedHash: countryEntry.sha256 || "",
        }),
        countryCode
      );
      await writeCachedPayload(tileManifestKey(countryCode), fetched, countryEntry.sha256 || "");
      tileManifests.set(countryCode, fetched);
      return { manifest: fetched, cacheHit: false, offline: false };
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (cached) {
        tileManifests.set(countryCode, cached);
        return { manifest: cached, cacheHit: true, offline: true, error };
      }
      throw error;
    }
  }

  function getStatus() {
    return cloneStatus(status);
  }

  async function loadTiledCountry({
    countryCode,
    countryEntry,
    bounds,
    allowNetwork,
    signal,
    features,
    loadedCountries,
    loadedTiles,
    skippedCountries,
    errors,
  }) {
    const countryName = countryEntry.name || countryCode.toUpperCase();
    let tileManifestResult = null;

    try {
      tileManifestResult = await getTileManifest(countryCode, countryEntry, { allowNetwork, signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      errors.push(error);
    }

    if (!tileManifestResult?.manifest) {
      skippedCountries.push({
        code: countryCode,
        reason: allowNetwork ? "unavailable" : "waiting-zoom",
      });
      return tileManifestResult;
    }

    const tileEntries = selectTilesForBounds(tileManifestResult.manifest, bounds);
    if (tileEntries.length === 0) return tileManifestResult;

    let countryLoaded = false;
    for (const [tileId, tileEntry] of tileEntries) {
      if (features.length >= maxFeatures) break;
      try {
        const result = await loadInflight(datasetKeyForTile(countryCode, tileId), () => loadPayloadWithCache({
          cacheKey: tileJsonKey(countryCode, tileId),
          url: tileEntry.json,
          hash: tileEntry.sha256 || "",
          normalizePayload: (payload) => normalizeTilePayload(payload, countryCode, tileId),
          allowNetwork,
          signal,
        }));
        if (!result?.payload) continue;

        const nextFeatures = compactTrapsToCameraFeatures(result.payload.traps, {
          countryCode,
          countryName,
          tileId,
          bounds,
          maxFeatures: maxFeatures - features.length,
          startIndex: features.length,
        });
        if (nextFeatures.length > 0) {
          features.push(...nextFeatures);
          loadedTiles.push(`${countryCode}:${tileId}`);
          countryLoaded = true;
        }
        if (result.offline) errors.push(result.error || new Error("Camera tile loaded from cache."));
      } catch (error) {
        if (isAbortError(error)) throw error;
        errors.push(error);
      }
    }

    if (countryLoaded) loadedCountries.add(countryCode);
    if (!countryLoaded && !allowNetwork) {
      skippedCountries.push({ code: countryCode, reason: "waiting-zoom" });
    }
    return tileManifestResult;
  }

  async function loadUntiledCountry({
    countryCode,
    countryEntry,
    bounds,
    zoom,
    allowNetwork,
    features,
    loadedCountries,
    skippedCountries,
    errors,
    signal,
  }) {
    const count = Number(countryEntry.count) || 0;
    if (features.length >= maxFeatures) return null;
    if (!allowNetwork) {
      const result = await loadPayloadWithCache({
        cacheKey: countryJsonKey(countryCode),
        url: countryEntry.json,
        hash: countryEntry.sha256 || "",
        normalizePayload: (payload) => normalizeCountryPayload(payload, countryCode),
        allowNetwork: false,
        signal,
      });
      if (!result?.payload) {
        skippedCountries.push({ code: countryCode, reason: "waiting-zoom" });
        return null;
      }
      const nextFeatures = compactTrapsToCameraFeatures(result.payload.traps, {
        countryCode,
        countryName: countryEntry.name || countryCode.toUpperCase(),
        bounds,
        maxFeatures: maxFeatures - features.length,
        startIndex: features.length,
      });
      if (nextFeatures.length > 0) {
        features.push(...nextFeatures);
        loadedCountries.add(countryCode);
      }
      return result;
    }

    if (count > largeUntiledCountryCount && zoom < largeUntiledMinZoom) {
      skippedCountries.push({ code: countryCode, reason: "waiting-zoom" });
      return null;
    }

    try {
      const result = await loadInflight(datasetKeyForCountry(countryCode), () => loadPayloadWithCache({
        cacheKey: countryJsonKey(countryCode),
        url: countryEntry.json,
        hash: countryEntry.sha256 || "",
        normalizePayload: (payload) => normalizeCountryPayload(payload, countryCode),
        allowNetwork: true,
        signal,
      }));
      if (!result?.payload) return result;

      const nextFeatures = compactTrapsToCameraFeatures(result.payload.traps, {
        countryCode,
        countryName: countryEntry.name || countryCode.toUpperCase(),
        bounds,
        maxFeatures: maxFeatures - features.length,
        startIndex: features.length,
      });
      if (nextFeatures.length > 0) {
        features.push(...nextFeatures);
        loadedCountries.add(countryCode);
      }
      if (result.offline) errors.push(result.error || new Error("Camera country loaded from cache."));
      return result;
    } catch (error) {
      if (isAbortError(error)) throw error;
      errors.push(error);
      skippedCountries.push({ code: countryCode, reason: "unavailable" });
      return null;
    }
  }

  async function loadViewport({ bounds, zoom = 0, signal: externalSignal } = {}) {
    const requestId = activeRequestId + 1;
    activeRequestId = requestId;
    const { signal, cleanup } = createSignal(externalSignal);
    const normalizedBounds = normalizeViewportBounds(bounds);
    const numericZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 0;
    const allowNetwork = numericZoom >= minNetworkZoom;
    const features = [];
    const loadedCountries = new Set();
    const loadedTiles = [];
    const skippedCountries = [];
    const errors = [];

    try {
      emitStatus({
        status: "loading-manifest",
        featureCount: 0,
        loadedCountries: [],
        loadedTiles: [],
        skippedCountries: [],
        cacheHit: false,
        offline: false,
        error: null,
      }, requestId);

      const currentManifest = await loadManifest({ signal });
      throwIfAborted(signal);
      const countryEntries = selectCountriesForBounds(currentManifest, normalizedBounds);

      if (countryEntries.length === 0) {
        emitStatus({
          status: "ready",
          featureCount: 0,
          loadedCountries: [],
          loadedTiles: [],
          skippedCountries: [],
          cacheHit: false,
          offline: false,
          error: null,
        }, requestId);
        return { features, loadedCountries: [], loadedTiles, skippedCountries, status: getStatus() };
      }

      emitStatus({
        status: allowNetwork ? "loading-cameras" : "waiting-zoom",
        skippedCountries: allowNetwork ? [] : countryEntries.map(([code]) => ({ code, reason: "waiting-zoom" })),
      }, requestId);

      for (const [countryCode, countryEntry] of countryEntries) {
        throwIfAborted(signal);
        if (features.length >= maxFeatures) break;
        if (countryEntry?.tiled) {
          await loadTiledCountry({
            countryCode,
            countryEntry,
            bounds: normalizedBounds,
            allowNetwork,
            signal,
            features,
            loadedCountries,
            loadedTiles,
            skippedCountries,
            errors,
          });
        } else {
          await loadUntiledCountry({
            countryCode,
            countryEntry,
            bounds: normalizedBounds,
            zoom: numericZoom,
            allowNetwork,
            features,
            loadedCountries,
            skippedCountries,
            errors,
            signal,
          });
        }
      }

      const uniqueSkipped = skippedCountries.filter((item, index, list) =>
        list.findIndex((candidate) => candidate.code === item.code && candidate.reason === item.reason) === index
      );
      const offline = errors.length > 0 && features.length > 0;
      const nextStatus = features.length > 0
        ? (offline ? "offline-cached" : "ready")
        : (uniqueSkipped.some((item) => item.reason === "waiting-zoom") ? "waiting-zoom" : "unavailable");

      emitStatus({
        status: nextStatus,
        featureCount: features.length,
        loadedCountries: Array.from(loadedCountries),
        loadedTiles,
        skippedCountries: uniqueSkipped,
        cacheHit: offline || (!allowNetwork && features.length > 0),
        offline,
        error: errors[0] || null,
      }, requestId);

      return {
        features,
        loadedCountries: Array.from(loadedCountries),
        loadedTiles,
        skippedCountries: uniqueSkipped,
        status: getStatus(),
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      emitStatus({
        status: features.length > 0 ? "offline-cached" : "unavailable",
        featureCount: features.length,
        loadedCountries: Array.from(loadedCountries),
        loadedTiles,
        skippedCountries,
        cacheHit: features.length > 0,
        offline: true,
        error,
      }, requestId);
      return {
        features,
        loadedCountries: Array.from(loadedCountries),
        loadedTiles,
        skippedCountries,
        status: getStatus(),
      };
    } finally {
      cleanup();
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
    activeRequestId += 1;
    abortPending();
    payloads.clear();
    tileManifests.clear();
    inflight.clear();
    manifestPromise = null;
  }

  return {
    abortPending,
    destroy,
    getStatus,
    loadManifest,
    loadViewport,
  };
}
