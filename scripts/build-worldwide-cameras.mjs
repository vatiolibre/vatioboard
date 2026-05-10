import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import KDBush from "kdbush";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const DEFAULT_RAW_OSM_PATH = path.resolve(projectRoot, "data-src/osm_speed_cameras_overpass.json");
export const LEGACY_ANSV_PATH = path.resolve(projectRoot, "data-src/ansv_cameras_maplibre.geojson");
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
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (!text || text === "none" || text === "signals" || text === "variable") return null;

  const match = text.match(/(-?\d+(?:[.,]\d+)?)/);
  if (!match) return null;

  const numeric = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 400) return null;

  if (/\bmph\b/.test(text)) {
    return Math.round(numeric * 1.609344);
  }

  return Math.round(numeric);
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

function normalizeOsmElement(element) {
  const lon = roundCoordinate(element?.lon);
  const lat = roundCoordinate(element?.lat);
  if (!isFiniteCoordinate(lon, lat)) return null;

  const osmId = Number.isFinite(Number(element.id)) ? Math.round(Number(element.id)) : null;
  const speedKph = parseSpeedKph(element?.tags?.maxspeed ?? element?.tags?.["maxspeed:forward"] ?? element?.tags?.["maxspeed:backward"]);
  const country = getTaggedCountryCode(element?.tags) || inferCountryFromCoordinate(lon, lat, "zz");

  return {
    country,
    key: osmId ? `osm:${osmId}` : `coord:${lon},${lat}`,
    trap: osmId ? [lon, lat, speedKph, osmId] : [lon, lat, speedKph],
  };
}

function normalizeGeoJsonFeature(feature, { defaultCountry = "zz" } = {}) {
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
  const speedKph = parseSpeedKph(properties.maxspeed ?? properties.speed ?? properties.limit);

  return {
    country,
    key: osmId ? `osm:${osmId}` : `coord:${lon},${lat}`,
    trap: osmId ? [lon, lat, speedKph, osmId] : [lon, lat, speedKph],
  };
}

function normalizePlainCamera(camera) {
  const lon = roundCoordinate(camera?.lon ?? camera?.lng ?? camera?.longitude);
  const lat = roundCoordinate(camera?.lat ?? camera?.latitude);
  if (!isFiniteCoordinate(lon, lat)) return null;

  const osmId = Number.isFinite(Number(camera.osmId ?? camera.osm_id ?? camera.id))
    ? Math.round(Number(camera.osmId ?? camera.osm_id ?? camera.id))
    : null;
  const country =
    normalizeCountryCode(camera.country ?? camera.countryCode ?? camera.country_code)
    || inferCountryFromCoordinate(lon, lat, "zz");
  const speedKph = parseSpeedKph(camera.maxspeed ?? camera.speed ?? camera.limit);

  return {
    country,
    key: osmId ? `osm:${osmId}` : `coord:${lon},${lat}`,
    trap: osmId ? [lon, lat, speedKph, osmId] : [lon, lat, speedKph],
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
      addRecord(normalizeOsmElement(element));
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
      addRecord(normalizeGeoJsonFeature(feature, { defaultCountry }));
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
      addRecord(normalizePlainCamera(camera));
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
    };
  }

  const tileManifest = {
    version: 2,
    country: code,
    generatedAt,
    count: traps.length,
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
    tiled: true,
    tileSize,
    tiles: `/geo/cameras/countries/${code}/manifest.json`,
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
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
  outputDir = DEFAULT_OUTPUT_DIR,
  generatedAt = new Date().toISOString(),
  allowLegacyFallback = true,
  tileCountThreshold = TILE_COUNT_THRESHOLD,
  tileBytesThreshold = TILE_BYTES_THRESHOLD,
  tileSize = TILE_SIZE_DEGREES,
} = {}) {
  const resolvedSourcePath = await chooseSourcePath({ sourcePath, allowLegacyFallback });
  const rawSource = await readJsonFile(resolvedSourcePath);
  const isLegacyAnsv = path.resolve(resolvedSourcePath) === LEGACY_ANSV_PATH;
  const normalized = normalizeCameraSource(rawSource, {
    defaultCountry: isLegacyAnsv ? "co" : "zz",
    sourceName: isLegacyAnsv ? "Colombia ANSV local seed" : undefined,
    sourceQuery: isLegacyAnsv
      ? "data-src/ansv_cameras_maplibre.geojson; run npm run fetch:cameras to refresh from OpenStreetMap Overpass"
      : undefined,
  });
  const groups = groupRecordsByCountry(normalized.records);

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

  const manifest = {
    version: 2,
    generatedAt,
    source: normalized.source,
    countries,
  };
  const manifestJson = serializeJson(manifest);
  await fs.writeFile(path.join(outputDir, "manifest.json"), manifestJson);

  return {
    manifest,
    sourcePath: resolvedSourcePath,
    outputDir,
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
