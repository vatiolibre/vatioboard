import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import KDBush from "kdbush";
import { parseMaxspeed } from "./camera-maxspeed-enrichment.mjs";
import {
  attachNycTicketStats,
  normalizeAnsvCameraGeoJson,
  normalizeNycCameraGeoJson,
  normalizeNycTicketGeoJson,
  normalizeOsmCameraElements,
} from "./camera-source-normalizers.mjs";
import { mergeCameraRecords } from "./camera-source-merge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const DEFAULT_RAW_OSM_PATH = path.resolve(projectRoot, "data-src/osm_speed_cameras_overpass.json");
export const DEFAULT_MAXSPEED_ENRICHMENT_PATH = path.resolve(
  projectRoot,
  "data-src/osm_speed_cameras_maxspeed_enrichment.json",
);
export const LEGACY_ANSV_PATH = path.resolve(projectRoot, "data-src/ansv_cameras_maplibre.geojson");
export const DEFAULT_LOCAL_CAMERA_SOURCE_PATHS = [
  LEGACY_ANSV_PATH,
  path.resolve(projectRoot, "data-src/nyc/nyc_cameras.geojson"),
  path.resolve(projectRoot, "data-src/nyc/nyc_tickets.geojson"),
];
export const DEFAULT_OUTPUT_DIR = path.resolve(projectRoot, "public/geo/cameras");
export const OVERPASS_QUERY = `[out:json][timeout:1000];
node["highway"="speed_camera"];
out body;`;

export const TILE_COUNT_THRESHOLD = Number.parseInt(process.env.CAMERA_TILE_COUNT_THRESHOLD || "5000", 10);
export const TILE_BYTES_THRESHOLD = Number.parseInt(process.env.CAMERA_TILE_BYTES_THRESHOLD || "500000", 10);
export const TILE_SIZE_DEGREES = Number.parseFloat(process.env.CAMERA_TILE_SIZE_DEGREES || "1");

const COUNTRY_NAME_OVERRIDES = {
  co: "Colombia",
  us: "United States",
  gb: "United Kingdom",
  zz: "Unknown region",
};

const COUNTRY_CODE_BY_NAME = {
  colombia: "co",
  "united states": "us",
  "united states of america": "us",
  usa: "us",
  "united kingdom": "gb",
  "great britain": "gb",
};

const LIGHTWEIGHT_COUNTRY_BBOXES = [
  ["co", [-81.8, -4.5, -66.8, 13.8]],
  ["us", [-179.5, 18.5, -52.5, 72.5]],
  ["ca", [-141.5, 41.5, -52.0, 84.0]],
  ["mx", [-118.8, 14.0, -86.0, 33.5]],
  ["gb", [-8.7, 49.7, 2.2, 60.9]],
  ["fr", [-5.5, 41.0, 9.8, 51.5]],
  ["de", [5.5, 47.0, 15.5, 55.5]],
  ["es", [-9.8, 35.5, 4.5, 44.5]],
  ["it", [6.0, 35.0, 19.0, 47.5]],
];

function createCountryNameFormatter() {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
}

const countryNameFormatter = createCountryNameFormatter();

export function roundCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(6)) : null;
}

export function parseSpeedKph(value) {
  const parsed = parseMaxspeed(value);
  return parsed.parsed ? parsed.speedKph : null;
}

export function normalizeCountryCode(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^country:/i, "")
    .replace(/^iso3166-1:/i, "")
    .toLowerCase();

  if (!normalized) return "";
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  if (/^[a-z]{2}-/.test(normalized)) return normalized.slice(0, 2);
  if (/^[a-z]{3}$/.test(normalized) && normalized === "usa") return "us";
  return COUNTRY_CODE_BY_NAME[normalized] || "";
}

export function getCountryName(code) {
  const normalized = normalizeCountryCode(code) || "zz";
  if (COUNTRY_NAME_OVERRIDES[normalized]) return COUNTRY_NAME_OVERRIDES[normalized];

  const formatted = countryNameFormatter?.of(normalized.toUpperCase());
  return formatted && formatted !== normalized.toUpperCase()
    ? formatted
    : normalized.toUpperCase();
}

function getTaggedCountryCode(tags = {}) {
  const candidates = [
    tags["ISO3166-1:alpha2"],
    tags["ISO3166-1"],
    tags["addr:country"],
    tags["is_in:country_code"],
    tags.country_code,
    tags.country,
    tags["is_in:country"],
  ];

  for (const candidate of candidates) {
    const code = normalizeCountryCode(candidate);
    if (code) return code;
  }

  return "";
}

function inferCountryFromCoordinate(lon, lat, fallback = "zz") {
  for (const [code, bbox] of LIGHTWEIGHT_COUNTRY_BBOXES) {
    if (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) {
      return code;
    }
  }
  return fallback || "zz";
}

function isFiniteCoordinate(lon, lat) {
  return Number.isFinite(lon)
    && Number.isFinite(lat)
    && lon >= -180
    && lon <= 180
    && lat >= -90
    && lat <= 90;
}

function parseCameraMaxspeed(tags = {}) {
  const candidates = [
    tags.maxspeed,
    tags.speed,
    tags.limit,
    tags["maxspeed:forward"],
    tags["maxspeed:backward"],
  ];

  for (const candidate of candidates) {
    const parsed = parseMaxspeed(candidate);
    if (parsed.parsed) return parsed;
  }

  return { speedKph: null, raw: null, parsed: false, reason: "missing" };
}

function normalizeSpeedMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const source = String(meta.source ?? "").trim();
  const compactSource = String(meta.s ?? "").trim();
  const normalizedSource = source || (
    compactSource === "road"
      ? "nearest_road:maxspeed"
      : (compactSource === "camera" ? "camera:maxspeed" : "")
  );
  if (!normalizedSource) return null;

  const confidence = String(meta.confidence ?? meta.c ?? "low").trim() || "low";
  const wayId = meta.wayId ?? meta.sourceWayId ?? meta.w;
  const distanceM = Number(meta.distanceM ?? meta.d);
  const raw = meta.raw ?? meta.r;
  const normalized = {
    source: normalizedSource,
    confidence,
  };

  if (wayId !== null && wayId !== undefined && wayId !== "") {
    normalized.wayId = Number.isFinite(Number(wayId)) ? Math.round(Number(wayId)) : wayId;
  }
  if (Number.isFinite(distanceM)) normalized.distanceM = Math.round(distanceM);
  if (raw !== null && raw !== undefined && raw !== "") normalized.raw = String(raw);
  return normalized;
}

function normalizeEnrichmentEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const speedKph = Number(entry.speedKph);
  if (!Number.isFinite(speedKph) || speedKph <= 0) return null;
  const speedMeta = normalizeSpeedMeta(entry.speedMeta ?? entry.meta);
  if (!speedMeta || !speedMeta.source.startsWith("nearest_road:")) return null;
  return {
    speedKph: Math.round(speedKph),
    speedMeta,
  };
}

function getEnrichmentForKey(maxspeedEnrichment, key) {
  if (!key || !maxspeedEnrichment) return null;
  if (maxspeedEnrichment instanceof Map) return maxspeedEnrichment.get(key) || null;
  return normalizeEnrichmentEntry(maxspeedEnrichment[key]);
}

function buildTrap({ lon, lat, osmId, explicitSpeed, enrichment }) {
  const trap = osmId ? [lon, lat, null, osmId] : [lon, lat, null];
  if (explicitSpeed?.parsed) {
    trap[2] = explicitSpeed.speedKph;
    return trap;
  }

  if (enrichment?.speedKph) {
    trap[2] = enrichment.speedKph;
    if (enrichment.speedMeta) {
      trap[4] = enrichment.speedMeta;
    }
  }

  return trap;
}

function normalizeOsmElement(element, options = {}) {
  const lon = roundCoordinate(element?.lon);
  const lat = roundCoordinate(element?.lat);
  if (!isFiniteCoordinate(lon, lat)) return null;

  const osmId = Number.isFinite(Number(element.id)) ? Math.round(Number(element.id)) : null;
  const key = osmId ? `osm:${osmId}` : `coord:${lon},${lat}`;
  const explicitSpeed = parseCameraMaxspeed(element?.tags);
  const enrichment = explicitSpeed.parsed
    ? null
    : getEnrichmentForKey(options.maxspeedEnrichment, key);
  const country = getTaggedCountryCode(element?.tags) || inferCountryFromCoordinate(lon, lat, "zz");

  return {
    country,
    key,
    trap: buildTrap({ lon, lat, osmId, explicitSpeed, enrichment }),
  };
}

function normalizeGeoJsonFeature(feature, { defaultCountry = "zz", maxspeedEnrichment = null } = {}) {
  if (feature?.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) {
    return null;
  }

  const [rawLon, rawLat] = feature.geometry.coordinates;
  const lon = roundCoordinate(rawLon);
  const lat = roundCoordinate(rawLat);
  if (!isFiniteCoordinate(lon, lat)) return null;

  const properties = feature.properties || {};
  const osmId = Number.isFinite(Number(properties.osmId ?? properties.osm_id ?? properties.id))
    ? Math.round(Number(properties.osmId ?? properties.osm_id ?? properties.id))
    : null;
  const taggedCountry =
    normalizeCountryCode(properties.countryCode ?? properties.country_code ?? properties.country)
    || "";
  const country = taggedCountry || inferCountryFromCoordinate(lon, lat, defaultCountry || "zz");
  const key = osmId ? `osm:${osmId}` : `coord:${lon},${lat}`;
  const explicitSpeed = parseCameraMaxspeed(properties);
  const enrichment = explicitSpeed.parsed
    ? null
    : getEnrichmentForKey(maxspeedEnrichment, key);

  return {
    country,
    key,
    trap: buildTrap({ lon, lat, osmId, explicitSpeed, enrichment }),
  };
}

function normalizePlainCamera(camera, options = {}) {
  const lon = roundCoordinate(camera?.lon ?? camera?.lng ?? camera?.longitude);
  const lat = roundCoordinate(camera?.lat ?? camera?.latitude);
  if (!isFiniteCoordinate(lon, lat)) return null;

  const osmId = Number.isFinite(Number(camera.osmId ?? camera.osm_id ?? camera.id))
    ? Math.round(Number(camera.osmId ?? camera.osm_id ?? camera.id))
    : null;
  const country =
    normalizeCountryCode(camera.country ?? camera.countryCode ?? camera.country_code)
    || inferCountryFromCoordinate(lon, lat, "zz");
  const key = osmId ? `osm:${osmId}` : `coord:${lon},${lat}`;
  const explicitSpeed = parseCameraMaxspeed(camera);
  const enrichment = explicitSpeed.parsed
    ? null
    : getEnrichmentForKey(options.maxspeedEnrichment, key);

  return {
    country,
    key,
    trap: buildTrap({ lon, lat, osmId, explicitSpeed, enrichment }),
  };
}

export function normalizeCameraSource(source, options = {}) {
  const records = [];
  const dedupeKeys = new Set();

  const addRecord = (record) => {
    if (!record || dedupeKeys.has(record.key)) return;
    dedupeKeys.add(record.key);
    records.push(record);
  };

  if (Array.isArray(source?.elements)) {
    for (const element of source.elements) {
      if (element?.type && element.type !== "node") continue;
      addRecord(normalizeOsmElement(element, options));
    }
    return {
      source: {
        name: "OpenStreetMap Overpass",
        query: OVERPASS_QUERY,
      },
      records,
    };
  }

  if (source?.type === "FeatureCollection" && Array.isArray(source.features)) {
    const defaultCountry = options.defaultCountry || "zz";
    for (const feature of source.features) {
      addRecord(normalizeGeoJsonFeature(feature, {
        defaultCountry,
        maxspeedEnrichment: options.maxspeedEnrichment,
      }));
    }
    return {
      source: {
        name: options.sourceName || "Local camera seed",
        query: options.sourceQuery || "local GeoJSON seed",
      },
      records,
    };
  }

  if (Array.isArray(source)) {
    for (const camera of source) {
      addRecord(normalizePlainCamera(camera, options));
    }
    return {
      source: {
        name: options.sourceName || "Local camera seed",
        query: options.sourceQuery || "local JSON seed",
      },
      records,
    };
  }

  throw new Error("Expected Overpass JSON, a GeoJSON FeatureCollection, or an array of camera records.");
}

export function groupRecordsByCountry(records) {
  const groups = new Map();

  for (const record of records) {
    const country = normalizeCountryCode(record.country) || "zz";
    const traps = groups.get(country) || [];
    traps.push(record.trap);
    groups.set(country, traps);
  }

  return groups;
}

function getSpeedMetaSource(meta) {
  if (!meta || typeof meta !== "object") return "";
  const source = String(meta.source ?? "").trim();
  if (source) return source;
  const compactSource = String(meta.s ?? "").trim();
  if (compactSource === "road") return "nearest_road:maxspeed";
  if (compactSource === "camera") return "camera:maxspeed";
  return "";
}

function getTrapSpeedCoverageType(trap) {
  const speedKph = Number(trap?.[2]);
  if (!Number.isFinite(speedKph) || speedKph <= 0) return "unknown";

  const source = getSpeedMetaSource(trap?.[4]);
  if (source.startsWith("nearest_road:")) return "inferred";
  return "explicit";
}

export function summarizeSpeedCoverage(traps, { includePercentages = true } = {}) {
  const coverage = {
    total: 0,
    explicit: 0,
    inferred: 0,
    unknown: 0,
  };

  for (const trap of Array.isArray(traps) ? traps : []) {
    coverage.total += 1;
    coverage[getTrapSpeedCoverageType(trap)] += 1;
  }

  if (includePercentages) {
    const denominator = coverage.total || 1;
    coverage.explicitPct = Number(((coverage.explicit / denominator) * 100).toFixed(1));
    coverage.inferredPct = Number(((coverage.inferred / denominator) * 100).toFixed(1));
    coverage.unknownPct = Number(((coverage.unknown / denominator) * 100).toFixed(1));
  }

  return coverage;
}

function getTrapSourceMeta(trap) {
  const meta = trap?.[5];
  return meta && typeof meta === "object" ? meta : null;
}

function getTrapSources(trap) {
  const sources = getTrapSourceMeta(trap)?.sources;
  if (Array.isArray(sources) && sources.length > 0) return sources;
  return ["osm"];
}

function getTrapPrimarySource(trap) {
  return getTrapSourceMeta(trap)?.primarySource || getTrapSources(trap)[0] || "osm";
}

function incrementCounter(target, key, amount = 1) {
  const normalized = String(key || "unknown");
  target[normalized] = (target[normalized] || 0) + amount;
}

export function summarizeSourceCoverage(traps, mergeStats = {}) {
  const coverage = {
    total: 0,
    byPrimarySource: {},
    byContributingSource: {},
    addedByOfficialSources: 0,
    mergedOfficialIntoOsm: 0,
    speedUpdatedFromOfficial: 0,
    ticketStatsAttached: 0,
    duplicateCandidatesSkipped: Number(mergeStats.duplicateCandidatesSkipped) || 0,
    conflicts: 0,
  };

  for (const trap of Array.isArray(traps) ? traps : []) {
    coverage.total += 1;
    const sourceMeta = getTrapSourceMeta(trap);
    const sources = getTrapSources(trap);
    const primarySource = getTrapPrimarySource(trap);
    incrementCounter(coverage.byPrimarySource, primarySource);
    for (const source of sources) incrementCounter(coverage.byContributingSource, source);

    const hasOfficial = sources.some((source) => source === "ansv" || source === "nyc");
    if (hasOfficial && !sources.includes("osm")) coverage.addedByOfficialSources += 1;
    if (hasOfficial && sources.includes("osm")) coverage.mergedOfficialIntoOsm += 1;
    if (sourceMeta?.speedUpdatedFromOfficial || String(trap?.[4]?.source || "").startsWith("official:")) {
      coverage.speedUpdatedFromOfficial += 1;
    }
    if (sourceMeta?.ticketStats) coverage.ticketStatsAttached += 1;
    coverage.conflicts += Array.isArray(sourceMeta?.speedConflicts) ? sourceMeta.speedConflicts.length : 0;
  }

  if (Number.isFinite(Number(mergeStats.addedByOfficialSources))) {
    coverage.addedByOfficialSources = Number(mergeStats.addedByOfficialSources);
  }
  if (Number.isFinite(Number(mergeStats.mergedOfficialIntoOsm))) {
    coverage.mergedOfficialIntoOsm = Number(mergeStats.mergedOfficialIntoOsm);
  }
  if (Number.isFinite(Number(mergeStats.speedUpdatedFromOfficial))) {
    coverage.speedUpdatedFromOfficial = Number(mergeStats.speedUpdatedFromOfficial);
  }
  if (Number.isFinite(Number(mergeStats.ticketStatsAttached))) {
    coverage.ticketStatsAttached = Number(mergeStats.ticketStatsAttached);
  }
  if (Number.isFinite(Number(mergeStats.conflicts))) {
    coverage.conflicts = Number(mergeStats.conflicts);
  }

  return coverage;
}

function sortTraps(traps) {
  return traps.sort((a, b) => {
    const lon = a[0] - b[0];
    if (lon) return lon;
    const lat = a[1] - b[1];
    if (lat) return lat;
    return String(a[3] ?? "").localeCompare(String(b[3] ?? ""));
  });
}

function getBBox(traps, padding = 0.25) {
  if (!traps.length) return [-180, -90, 180, 90];

  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;

  for (const [lon, lat] of traps) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [
    roundCoordinate(Math.max(-180, minLon - padding)),
    roundCoordinate(Math.max(-90, minLat - padding)),
    roundCoordinate(Math.min(180, maxLon + padding)),
    roundCoordinate(Math.min(90, maxLat + padding)),
  ];
}

function sha256(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function serializeJson(payload) {
  return JSON.stringify(payload);
}

function createIndexBuffer(traps) {
  const index = new KDBush(traps.length);
  for (const [lon, lat] of traps) {
    index.add(lon, lat);
  }
  index.finish();
  return Buffer.from(index.data);
}

async function writeCountryPayload({ outputDir, code, generatedAt, traps }) {
  const payload = {
    version: 2,
    country: code,
    generatedAt,
    count: traps.length,
    speedCoverage: summarizeSpeedCoverage(traps),
    sourceCoverage: summarizeSourceCoverage(traps),
    traps,
  };
  const json = serializeJson(payload);
  const countryPath = path.join(outputDir, "countries", `${code}.json`);
  const indexPath = path.join(outputDir, "countries", `${code}.kdbush`);

  await fs.mkdir(path.dirname(countryPath), { recursive: true });
  await Promise.all([
    fs.writeFile(countryPath, json),
    fs.writeFile(indexPath, createIndexBuffer(traps)),
  ]);

  return {
    code,
    name: getCountryName(code),
    count: traps.length,
    json: `/geo/cameras/countries/${code}.json`,
    index: `/geo/cameras/countries/${code}.kdbush`,
    sha256: sha256(json),
    generatedAt,
    bbox: getBBox(traps),
    speedCoverage: payload.speedCoverage,
    sourceCoverage: payload.sourceCoverage,
  };
}

export function getTileId(lon, lat, tileSize = TILE_SIZE_DEGREES) {
  const size = Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 1;
  const x = Math.floor((lon + 180) / size);
  const y = Math.floor((lat + 90) / size);
  return `${y}_${x}`;
}

function getTileBBox(tileId, tileSize = TILE_SIZE_DEGREES) {
  const [rawY, rawX] = tileId.split("_").map((value) => Number.parseInt(value, 10));
  const size = Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 1;
  const minLon = rawX * size - 180;
  const minLat = rawY * size - 90;
  return [
    roundCoordinate(minLon),
    roundCoordinate(minLat),
    roundCoordinate(Math.min(180, minLon + size)),
    roundCoordinate(Math.min(90, minLat + size)),
  ];
}

async function writeTiledCountryPayload({ outputDir, code, generatedAt, traps, tileSize = TILE_SIZE_DEGREES }) {
  const tileGroups = new Map();
  for (const trap of traps) {
    const tileId = getTileId(trap[0], trap[1], tileSize);
    const tileTraps = tileGroups.get(tileId) || [];
    tileTraps.push(trap);
    tileGroups.set(tileId, tileTraps);
  }

  const tiles = {};
  const tileEntries = Array.from(tileGroups.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [tileId, tileTraps] of tileEntries) {
    sortTraps(tileTraps);
    const payload = {
      version: 2,
      country: code,
      tile: tileId,
      generatedAt,
      count: tileTraps.length,
      speedCoverage: summarizeSpeedCoverage(tileTraps),
      sourceCoverage: summarizeSourceCoverage(tileTraps),
      traps: tileTraps,
    };
    const json = serializeJson(payload);
    const tileDir = path.join(outputDir, "countries", code, "tiles");
    const tileJsonPath = path.join(tileDir, `${tileId}.json`);
    const tileIndexPath = path.join(tileDir, `${tileId}.kdbush`);
    await fs.mkdir(tileDir, { recursive: true });
    await Promise.all([
      fs.writeFile(tileJsonPath, json),
      fs.writeFile(tileIndexPath, createIndexBuffer(tileTraps)),
    ]);
    tiles[tileId] = {
      id: tileId,
      count: tileTraps.length,
      json: `/geo/cameras/countries/${code}/tiles/${tileId}.json`,
      index: `/geo/cameras/countries/${code}/tiles/${tileId}.kdbush`,
      sha256: sha256(json),
      bbox: getTileBBox(tileId, tileSize),
      speedCoverage: payload.speedCoverage,
      sourceCoverage: payload.sourceCoverage,
    };
  }

  const tileManifest = {
    version: 2,
    country: code,
    generatedAt,
    count: traps.length,
    speedCoverage: summarizeSpeedCoverage(traps),
    sourceCoverage: summarizeSourceCoverage(traps),
    tileSize,
    tiles,
  };
  const manifestJson = serializeJson(tileManifest);
  const tileManifestPath = path.join(outputDir, "countries", code, "manifest.json");
  await fs.mkdir(path.dirname(tileManifestPath), { recursive: true });
  await fs.writeFile(tileManifestPath, manifestJson);

  return {
    code,
    name: getCountryName(code),
    count: traps.length,
    json: `/geo/cameras/countries/${code}/manifest.json`,
    index: null,
    sha256: sha256(manifestJson),
    generatedAt,
    bbox: getBBox(traps, 1),
    speedCoverage: tileManifest.speedCoverage,
    sourceCoverage: tileManifest.sourceCoverage,
    tiled: true,
    tileSize,
    tiles: `/geo/cameras/countries/${code}/manifest.json`,
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadMaxspeedEnrichment(enrichmentPath) {
  if (!enrichmentPath) return new Map();

  try {
    const payload = await readJsonFile(enrichmentPath);
    const rawRecords = payload?.records || payload?.enrichment?.records || {};
    const entries = rawRecords instanceof Map
      ? Array.from(rawRecords.entries())
      : Object.entries(rawRecords);
    const records = new Map();

    for (const [key, entry] of entries) {
      const normalized = normalizeEnrichmentEntry(entry);
      if (normalized) records.set(key, normalized);
    }

    return records;
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
}

async function readOptionalJsonFile(filePath) {
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sourcePathId(filePath) {
  const normalized = path.basename(filePath).toLowerCase();
  if (normalized === "ansv_cameras_maplibre.geojson") return "ansv";
  if (normalized === "nyc_cameras.geojson") return "nyc";
  if (normalized === "nyc_tickets.geojson") return "nyc-tickets";
  if (normalized === "osm_speed_cameras_overpass.json") return "osm";
  if (normalized === "osm_speed_cameras_maxspeed_enrichment.json") return "osm-maxspeed-enrichment";
  return normalized.replace(/\.[^.]+$/, "");
}

function sourceManifestEntry(id, filePath) {
  const roles = {
    osm: "global baseline",
    "osm-maxspeed-enrichment": "nearest-road speed enrichment",
    ansv: "official Colombia cameras",
    nyc: "NYC local camera locations",
    "nyc-tickets": "NYC activity/ticket metadata",
  };
  return {
    id,
    path: path.relative(projectRoot, filePath),
    role: roles[id] || "local camera source",
  };
}

function isUsefulSourceMeta(record) {
  const sources = record?.sourceMeta?.sources || [];
  return sources.length > 1
    || record?.sourceMeta?.primarySource !== "osm"
    || record?.sourceMeta?.official
    || record?.sourceMeta?.ticketStats
    || record?.sourceMeta?.speedConflicts?.length;
}

function compactSourceMeta(record) {
  if (!isUsefulSourceMeta(record)) return null;
  const meta = record.sourceMeta || {};
  const compact = {
    sources: meta.sources,
    primarySource: meta.primarySource,
    ids: meta.ids,
    names: meta.names,
    aliases: meta.aliases,
    country: meta.country || record.country,
    region: meta.region || record.region,
    locality: meta.locality,
    address: meta.address,
    jurisdiction: meta.jurisdiction,
    official: meta.official,
    active: meta.active,
    enforcementTypes: meta.enforcementTypes,
    infractions: meta.infractions,
    directions: meta.directions,
    ticketStats: meta.ticketStats,
    speedConflicts: meta.speedConflicts,
    speedUpdatedFromOfficial: meta.speedUpdatedFromOfficial || undefined,
  };

  for (const key of Object.keys(compact)) {
    if (compact[key] === null || compact[key] === undefined || compact[key] === "") delete compact[key];
    else if (Array.isArray(compact[key]) && compact[key].length === 0) delete compact[key];
    else if (typeof compact[key] === "object" && !Array.isArray(compact[key]) && Object.keys(compact[key]).length === 0) {
      delete compact[key];
    }
  }
  return compact;
}

function getCanonicalTrapId(record) {
  const ids = record?.sourceMeta?.ids || {};
  const osmId = ids.osm;
  if (osmId !== null && osmId !== undefined && osmId !== "") {
    return Array.isArray(osmId) ? osmId[0] : osmId;
  }
  const primary = record?.sourceMeta?.primarySource || record?.source || "camera";
  const primaryId = ids[primary] ?? record?.sourceId ?? record?.id;
  return `${primary}:${Array.isArray(primaryId) ? primaryId[0] : primaryId}`;
}

function shouldOmitSpeedMeta(record, sourceMeta) {
  return !sourceMeta
    && record?.source === "osm"
    && record?.speedMeta?.source === "camera:maxspeed";
}

function cameraRecordToBuildRecord(record) {
  const lon = roundCoordinate(record.lon);
  const lat = roundCoordinate(record.lat);
  if (!isFiniteCoordinate(lon, lat)) return null;
  const sourceMeta = compactSourceMeta(record);
  const rawSpeedKph = record.speedKph === null || record.speedKph === undefined || record.speedKph === ""
    ? null
    : Number(record.speedKph);
  const speedKph = Number.isFinite(rawSpeedKph) ? Math.round(rawSpeedKph) : null;
  const trap = [lon, lat, speedKph, getCanonicalTrapId(record)];
  const speedMeta = shouldOmitSpeedMeta(record, sourceMeta) ? null : record.speedMeta;

  if (speedMeta || sourceMeta) {
    trap[4] = speedMeta || null;
  }
  if (sourceMeta) trap[5] = sourceMeta;

  return {
    country: normalizeCountryCode(record.country) || "zz",
    key: `${trap[3] ?? "camera"}:${lon},${lat}`,
    trap,
  };
}

function normalizeSourceForBuild(rawSource, {
  resolvedSourcePath,
  maxspeedEnrichment,
  defaultCountry = "zz",
} = {}) {
  if (Array.isArray(rawSource?.elements)) {
    return normalizeOsmCameraElements(rawSource.elements, { maxspeedEnrichment });
  }

  if (path.resolve(resolvedSourcePath || "") === LEGACY_ANSV_PATH) {
    return normalizeAnsvCameraGeoJson(rawSource);
  }

  const normalized = normalizeCameraSource(rawSource, {
    defaultCountry,
    maxspeedEnrichment,
  });
  return normalized.records.map((record) => ({
    source: "local",
    sourceId: record.key,
    lon: record.trap[0],
    lat: record.trap[1],
    speedKph: Number.isFinite(record.trap[2]) ? record.trap[2] : null,
    speedMeta: record.trap[4] || null,
    country: record.country,
    sourceMeta: {
      sources: ["local"],
      primarySource: "local",
      ids: { local: record.key },
      country: record.country,
    },
  }));
}

async function loadLocalCameraSources({ localSourcePaths, resolvedSourcePath } = {}) {
  const resolvedPrimary = path.resolve(resolvedSourcePath || "");
  const paths = Array.isArray(localSourcePaths) ? localSourcePaths : [];
  const sourceEntries = [];
  let ansvRecords = [];
  let nycRecords = [];
  let nycTickets = [];

  for (const sourcePath of paths) {
    const resolved = path.resolve(sourcePath);
    if (resolved === resolvedPrimary) continue;
    const payload = await readOptionalJsonFile(resolved);
    if (!payload) continue;
    const id = sourcePathId(resolved);
    sourceEntries.push(sourceManifestEntry(id, resolved));

    if (id === "ansv") ansvRecords = ansvRecords.concat(normalizeAnsvCameraGeoJson(payload));
    else if (id === "nyc") nycRecords = nycRecords.concat(normalizeNycCameraGeoJson(payload));
    else if (id === "nyc-tickets") nycTickets = nycTickets.concat(normalizeNycTicketGeoJson(payload));
  }

  if (nycTickets.length > 0) nycRecords = attachNycTicketStats(nycRecords, nycTickets);
  return {
    records: [...ansvRecords, ...nycRecords],
    sourceEntries,
  };
}

async function chooseSourcePath({ sourcePath = "", allowLegacyFallback = true } = {}) {
  if (sourcePath) return path.resolve(sourcePath);

  try {
    await fs.access(DEFAULT_RAW_OSM_PATH);
    return DEFAULT_RAW_OSM_PATH;
  } catch {
    if (!allowLegacyFallback) throw new Error(`Missing cached Overpass source at ${DEFAULT_RAW_OSM_PATH}`);
    return LEGACY_ANSV_PATH;
  }
}

export async function buildWorldwideCameraArtifacts({
  sourcePath = "",
  enrichmentPath = DEFAULT_MAXSPEED_ENRICHMENT_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
  generatedAt = new Date().toISOString(),
  allowLegacyFallback = true,
  tileCountThreshold = TILE_COUNT_THRESHOLD,
  tileBytesThreshold = TILE_BYTES_THRESHOLD,
  tileSize = TILE_SIZE_DEGREES,
  includeLocalSources = true,
  localSourcePaths = DEFAULT_LOCAL_CAMERA_SOURCE_PATHS,
  mergeOfficialSources = true,
} = {}) {
  const resolvedSourcePath = await chooseSourcePath({ sourcePath, allowLegacyFallback });
  const rawSource = await readJsonFile(resolvedSourcePath);
  const maxspeedEnrichment = await loadMaxspeedEnrichment(enrichmentPath);
  const enrichmentSourcePresent = Boolean(enrichmentPath) && await fs.access(enrichmentPath)
    .then(() => true)
    .catch(() => false);
  const isLegacyAnsv = path.resolve(resolvedSourcePath) === LEGACY_ANSV_PATH;
  const primaryCameraRecords = normalizeSourceForBuild(rawSource, {
    resolvedSourcePath,
    defaultCountry: isLegacyAnsv ? "co" : "zz",
    maxspeedEnrichment,
  });
  const primarySourceId = Array.isArray(rawSource?.elements) ? "osm" : sourcePathId(resolvedSourcePath);
  const sourceEntries = [sourceManifestEntry(primarySourceId, resolvedSourcePath)];

  if (enrichmentSourcePresent) {
    sourceEntries.push({
      ...sourceManifestEntry("osm-maxspeed-enrichment", enrichmentPath),
      records: maxspeedEnrichment.size,
    });
  }

  const local = includeLocalSources
    ? await loadLocalCameraSources({ localSourcePaths, resolvedSourcePath })
    : { records: [], sourceEntries: [] };
  sourceEntries.push(...local.sourceEntries);

  const cameraRecords = [...primaryCameraRecords, ...local.records];
  const merged = mergeOfficialSources
    ? mergeCameraRecords(cameraRecords)
    : { records: cameraRecords, stats: {} };
  const buildRecords = merged.records
    .map(cameraRecordToBuildRecord)
    .filter(Boolean);
  const groups = groupRecordsByCountry(buildRecords);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDir, "countries"), { recursive: true });

  const countries = {};
  const countryEntries = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [code, traps] of countryEntries) {
    sortTraps(traps);
    const estimatedJsonBytes = Buffer.byteLength(serializeJson({
      version: 2,
      country: code,
      generatedAt,
      count: traps.length,
      traps,
    }));

    countries[code] =
      traps.length > tileCountThreshold || estimatedJsonBytes > tileBytesThreshold
        ? await writeTiledCountryPayload({ outputDir, code, generatedAt, traps, tileSize })
        : await writeCountryPayload({ outputDir, code, generatedAt, traps });
  }

  const allTraps = Array.from(groups.values()).flat();
  const source = {
    name: sourceEntries.some((entry) => entry.id === "osm")
      ? "OpenStreetMap + official/local camera sources"
      : "Official/local camera sources",
    sources: sourceEntries,
  };

  const manifest = {
    version: 2,
    generatedAt,
    source,
    speedCoverage: summarizeSpeedCoverage(allTraps),
    sourceCoverage: summarizeSourceCoverage(allTraps, merged.stats),
    countries,
  };
  const manifestJson = serializeJson(manifest);
  await fs.writeFile(path.join(outputDir, "manifest.json"), manifestJson);

  return {
    manifest,
    sourcePath: resolvedSourcePath,
    outputDir,
    mergeStats: merged.stats,
  };
}

async function main() {
  const result = await buildWorldwideCameraArtifacts();
  const count = Object.values(result.manifest.countries)
    .reduce((sum, country) => sum + country.count, 0);
  const countryCount = Object.keys(result.manifest.countries).length;
  console.warn(
    `Prepared ${count} speed cameras across ${countryCount} country artifact(s) -> ${path.relative(projectRoot, result.outputDir)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
