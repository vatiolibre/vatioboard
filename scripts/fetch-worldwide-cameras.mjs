import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_MAXSPEED_ENRICHMENT_PATH,
  DEFAULT_RAW_OSM_PATH,
  OVERPASS_QUERY,
  buildWorldwideCameraArtifacts,
  prepareAnsvCameraGeoJson,
} from "./build-worldwide-cameras.mjs";
import {
  enrichCameraRecordsWithRoadSpeeds,
  fetchOverpassJsonWithRetry,
  fetchRoadWaysForCameraBatch,
  parseMaxspeed,
} from "./camera-maxspeed-enrichment.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_ROAD_SPEED_CACHE_DIR = path.resolve(projectRoot, "data-src/osm-road-speeds");
const ROAD_TILE_SIZE_DEGREES = Number.parseFloat(process.env.CAMERA_ROAD_TILE_SIZE_DEGREES || "1");
const ROAD_BBOX_PADDING_DEGREES = Number.parseFloat(process.env.CAMERA_ROAD_BBOX_PADDING_DEGREES || "0.002");
const ROAD_REQUEST_DELAY_MS = Number.parseInt(process.env.CAMERA_ROAD_REQUEST_DELAY_MS || "2500", 10);
const OVERPASS_MAX_RETRIES = Number.parseInt(process.env.OVERPASS_MAX_RETRIES || "5", 10);
const OVERPASS_RETRY_INITIAL_DELAY_MS = Number.parseInt(
  process.env.OVERPASS_RETRY_INITIAL_DELAY_MS || "5000",
  10,
);
const OVERPASS_RETRY_MAX_DELAY_MS = Number.parseInt(
  process.env.OVERPASS_RETRY_MAX_DELAY_MS || "120000",
  10,
);
const OVERPASS_PROGRESS_INTERVAL_MS = Number.parseInt(
  process.env.OVERPASS_PROGRESS_INTERVAL_MS || "30000",
  10,
);
const CAMERA_REFRESH_CACHE = parseBoolean(
  process.env.CAMERA_REFRESH_CACHE ?? process.env.CAMERA_REFRESH_CAMERAS,
  false,
);
const ROAD_REFRESH_CACHE = parseBoolean(process.env.CAMERA_ROAD_REFRESH_CACHE, false);
const ROAD_PROGRESS_ENABLED = parseBoolean(process.env.CAMERA_ROAD_PROGRESS, true);
const ROAD_PROGRESS_EVERY = Number.parseInt(process.env.CAMERA_ROAD_PROGRESS_EVERY || "25", 10);
const ROAD_SLOW_TILE_MS = Number.parseInt(process.env.CAMERA_ROAD_SLOW_TILE_MS || "2000", 10);
const ROAD_FETCH_MISSING = parseBoolean(process.env.CAMERA_ROAD_FETCH_MISSING, true);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function parseBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function formatDelayMs(delayMs) {
  if (!Number.isFinite(delayMs)) return "a moment";
  if (delayMs >= 60000) return `${Math.round(delayMs / 60000)}m`;
  if (delayMs >= 1000) return `${Math.round(delayMs / 1000)}s`;
  return `${Math.round(delayMs)}ms`;
}

function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0s";
  if (durationMs >= 60000) return `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`;
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs)}ms`;
}

function warnOverpassRetry({ label, error, attempt, maxRetries, delayMs }) {
  const detail = error?.status
    ? `HTTP ${error.status}`
    : (error?.cause?.message || error?.message || "network error");
  console.warn(
    `${label} failed (${detail}); retrying in ${formatDelayMs(delayMs)} (${attempt}/${maxRetries})`,
  );
}

function createProgressLogger(enabled = true) {
  if (typeof enabled === "function") return enabled;
  return enabled
    ? (message) => console.warn(message)
    : () => {};
}

function mergeReasonCounts(target, source = {}) {
  for (const [reason, count] of Object.entries(source || {})) {
    target[reason] = (target[reason] || 0) + count;
  }
  return target;
}

function formatReasonCounts(counts = {}) {
  return Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(" ");
}

function formatProjectPath(filePath) {
  return path.relative(projectRoot, filePath) || ".";
}

async function withProgressHeartbeat(factory, {
  label,
  logProgress = true,
  intervalMs = OVERPASS_PROGRESS_INTERVAL_MS,
} = {}) {
  const progress = createProgressLogger(logProgress);
  const startedAtMs = Date.now();
  let heartbeatTimer = null;

  if (intervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      progress(`${label}: still waiting after ${formatDurationMs(Date.now() - startedAtMs)}...`);
    }, intervalMs);
    heartbeatTimer.unref?.();
  }

  try {
    return await factory();
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFiniteCoordinate(lon, lat) {
  return Number.isFinite(lon)
    && Number.isFinite(lat)
    && lon >= -180
    && lon <= 180
    && lat >= -90
    && lat <= 90;
}

function hasExplicitCameraMaxspeed(element) {
  const tags = element?.tags || {};
  return [
    tags.maxspeed,
    tags.speed,
    tags.limit,
    tags["maxspeed:forward"],
    tags["maxspeed:backward"],
  ].some((value) => parseMaxspeed(value).parsed);
}

function getRoadTileId(lon, lat, tileSize = ROAD_TILE_SIZE_DEGREES) {
  const size = Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 1;
  const x = Math.floor((lon + 180) / size);
  const y = Math.floor((lat + 90) / size);
  return `${String(size).replace(".", "p")}deg_${y}_${x}`;
}

function getCameraBBox(cameras, paddingDegrees = ROAD_BBOX_PADDING_DEGREES) {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;

  for (const camera of cameras) {
    const lon = finiteNumber(camera?.lon);
    const lat = finiteNumber(camera?.lat);
    if (!isFiniteCoordinate(lon, lat)) continue;
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }

  if (west > east || south > north) return null;
  return [
    Math.max(-180, west - paddingDegrees),
    Math.max(-90, south - paddingDegrees),
    Math.min(180, east + paddingDegrees),
    Math.min(90, north + paddingDegrees),
  ];
}

function groupCamerasByRoadTile(cameras, tileSize = ROAD_TILE_SIZE_DEGREES) {
  const groups = new Map();

  for (const camera of cameras) {
    const lon = finiteNumber(camera?.lon);
    const lat = finiteNumber(camera?.lat);
    if (!isFiniteCoordinate(lon, lat)) continue;
    const tileId = getRoadTileId(lon, lat, tileSize);
    const group = groups.get(tileId) || [];
    group.push(camera);
    groups.set(tileId, group);
  }

  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function getRoadCachePath(cacheDir, tileId) {
  return path.join(cacheDir, `${tileId}.json`);
}

async function readCachedRoadWays(cachePath) {
  try {
    const payload = JSON.parse(await fs.readFile(cachePath, "utf8"));
    const elements = Array.isArray(payload?.elements) ? payload.elements : [];
    return {
      payload,
      ways: elements.filter((element) =>
        element?.type === "way" && Array.isArray(element.geometry)
      ),
    };
  } catch {
    return null;
  }
}

async function readCachedCameraPayload(sourcePath) {
  try {
    const payload = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    return Array.isArray(payload?.elements) ? payload : null;
  } catch {
    return null;
  }
}

async function writeRoadCache(cachePath, payload) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(payload)}\n`);
}

function createEmptyCoverage() {
  return {
    total: 0,
    explicit: 0,
    inferred: 0,
    unknown: 0,
    ambiguous: 0,
  };
}

function countExplicitAndMissing(cameras) {
  const coverage = createEmptyCoverage();
  coverage.total = cameras.length;
  for (const camera of cameras) {
    if (hasExplicitCameraMaxspeed(camera)) coverage.explicit += 1;
    else coverage.unknown += 1;
  }
  return coverage;
}

export async function fetchWorldwideCameras({
  overpassUrl = process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL,
  outputPath = DEFAULT_RAW_OSM_PATH,
  fetchImpl = globalThis.fetch,
  maxRetries = OVERPASS_MAX_RETRIES,
  retryInitialDelayMs = OVERPASS_RETRY_INITIAL_DELAY_MS,
  retryMaxDelayMs = OVERPASS_RETRY_MAX_DELAY_MS,
  sleepImpl = sleep,
  onRetry = warnOverpassRetry,
  logProgress = ROAD_PROGRESS_ENABLED,
  progressIntervalMs = OVERPASS_PROGRESS_INTERVAL_MS,
  refreshCache = CAMERA_REFRESH_CACHE,
} = {}) {
  const progress = createProgressLogger(logProgress);
  const startedAtMs = Date.now();

  if (!refreshCache) {
    const cachedPayload = await readCachedCameraPayload(outputPath);
    if (cachedPayload) {
      progress(
        `Using cached global OSM speed cameras from ${formatProjectPath(outputPath)} (${cachedPayload.elements.length} element(s)). Set CAMERA_REFRESH_CACHE=1 to refresh.`,
      );
      return {
        outputPath,
        count: cachedPayload.elements.length,
        payload: cachedPayload,
        cacheHit: true,
      };
    }

    progress(
      `No usable global camera cache found at ${formatProjectPath(outputPath)}; fetching from Overpass.`,
    );
  }

  progress(`Fetching global OSM speed cameras from ${overpassUrl}...`);
  progress("Camera query can take a few minutes on public Overpass; retries/backoff are enabled.");

  const payload = await withProgressHeartbeat(() => fetchOverpassJsonWithRetry({
    overpassUrl,
    query: OVERPASS_QUERY,
    fetchImpl,
    userAgent: "VatioBoard camera artifact builder",
    label: "Global camera Overpass request",
    maxRetries,
    retryInitialDelayMs,
    retryMaxDelayMs,
    sleepImpl,
    onRetry,
  }), {
    label: "Global camera Overpass request",
    logProgress,
    intervalMs: progressIntervalMs,
  });
  if (!Array.isArray(payload?.elements)) {
    throw new Error("Overpass response did not include an elements array.");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`);
  progress(
    `Fetched ${payload.elements.length} global OSM speed camera element(s) in ${formatDurationMs(Date.now() - startedAtMs)}.`,
  );
  return {
    outputPath,
    count: payload.elements.length,
    payload,
    cacheHit: false,
  };
}

function shouldLogRoadTileProgress({
  index,
  total,
  elapsedMs,
  progressEvery = ROAD_PROGRESS_EVERY,
  slowTileMs = ROAD_SLOW_TILE_MS,
  attemptedNetwork = false,
  tileSource = "",
} = {}) {
  if (index === 0 || index === total - 1) return true;
  if (attemptedNetwork || tileSource === "failed") return true;
  if (Number.isFinite(slowTileMs) && slowTileMs > 0 && elapsedMs >= slowTileMs) return true;
  if (Number.isFinite(progressEvery) && progressEvery > 0 && (index + 1) % progressEvery === 0) {
    return true;
  }
  return false;
}

export async function fetchWorldwideCameraMaxspeedEnrichment({
  cameras,
  overpassUrl = process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL,
  outputPath = DEFAULT_MAXSPEED_ENRICHMENT_PATH,
  roadCacheDir = DEFAULT_ROAD_SPEED_CACHE_DIR,
  fetchImpl = globalThis.fetch,
  generatedAt = new Date().toISOString(),
  tileSizeDegrees = ROAD_TILE_SIZE_DEGREES,
  bboxPaddingDegrees = ROAD_BBOX_PADDING_DEGREES,
  requestDelayMs = ROAD_REQUEST_DELAY_MS,
  maxRetries = OVERPASS_MAX_RETRIES,
  retryInitialDelayMs = OVERPASS_RETRY_INITIAL_DELAY_MS,
  retryMaxDelayMs = OVERPASS_RETRY_MAX_DELAY_MS,
  sleepImpl = sleep,
  onRetry = warnOverpassRetry,
  refreshCache = ROAD_REFRESH_CACHE,
  fetchMissing = ROAD_FETCH_MISSING,
  logProgress = ROAD_PROGRESS_ENABLED,
  progressIntervalMs = OVERPASS_PROGRESS_INTERVAL_MS,
  progressEvery = ROAD_PROGRESS_EVERY,
  slowTileMs = ROAD_SLOW_TILE_MS,
} = {}) {
  const cameraElements = Array.isArray(cameras) ? cameras : [];
  const nodeCameras = cameraElements.filter((camera) => camera?.type === "node");
  const missingSpeedCameras = nodeCameras.filter((camera) => !hasExplicitCameraMaxspeed(camera));
  const tileGroups = groupCamerasByRoadTile(nodeCameras, tileSizeDegrees);
  const records = {};
  const summary = countExplicitAndMissing(cameraElements.filter((camera) => camera?.type === "node"));
  const tileSummaries = {};
  let roadQueryTemplate = "";
  const progress = createProgressLogger(logProgress);
  const startedAtMs = Date.now();
  let fetchedTiles = 0;
  let cachedTiles = 0;
  let failedTiles = 0;
  let skippedTiles = 0;
  let totalRoadWays = 0;
  const skippedRoadReasons = {};

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(roadCacheDir, { recursive: true });

  if (tileGroups.length > 0) {
    roadQueryTemplate = `[out:json][timeout:180];
(
  way(<bbox>)["highway"]["maxspeed"];
  way(<bbox>)["highway"]["maxspeed:forward"];
  way(<bbox>)["highway"]["maxspeed:backward"];
);
out tags geom;`;
  }

  progress(
    `Road speed/approach enrichment: ${nodeCameras.length} camera(s), ${missingSpeedCameras.length} without explicit maxspeed, across ${tileGroups.length} tile(s).`,
  );
  progress(
    `Road speed cache: ${path.relative(projectRoot, roadCacheDir)} (${refreshCache ? "refresh cached tiles" : "resume from cached tiles"}; missing-cache fetch ${fetchMissing ? "enabled" : "disabled"})`,
  );

  for (let index = 0; index < tileGroups.length; index += 1) {
    const [tileId, tileCameras] = tileGroups[index];
    const cachePath = getRoadCachePath(roadCacheDir, tileId);
    const bbox = getCameraBBox(tileCameras, bboxPaddingDegrees);
    let ways = [];
    let cacheHit = false;
    let errorMessage = "";
    let tileSource = "network";
    let attemptedNetwork = false;
    const tileStartedAtMs = Date.now();
    const tileLabel = `Road tile ${index + 1}/${tileGroups.length} ${tileId}`;

    if (!refreshCache) {
      const cached = await readCachedRoadWays(cachePath);
      if (cached) {
        ways = cached.ways;
        cacheHit = true;
        tileSource = "cache";
      }
    }

    if (!cacheHit && !refreshCache && !fetchMissing) {
      skippedTiles += 1;
      tileSource = "missing-cache";
      errorMessage = "road cache missing and CAMERA_ROAD_FETCH_MISSING=0";
    } else if (!cacheHit) {
      try {
        attemptedNetwork = true;
        progress(
          `${tileLabel}: fetching roads for ${tileCameras.length} camera(s); bbox=${bbox?.join(",") || "n/a"}`,
        );
        const roadResult = await withProgressHeartbeat(() => fetchRoadWaysForCameraBatch(tileCameras, {
          overpassUrl,
          fetchImpl,
          bbox,
          maxRetries,
          retryInitialDelayMs,
          retryMaxDelayMs,
          sleepImpl,
          label: tileLabel,
          onRetry,
        }), {
          label: tileLabel,
          logProgress,
          intervalMs: progressIntervalMs,
        });
        ways = roadResult.ways;
        fetchedTiles += 1;
        await writeRoadCache(cachePath, {
          version: 1,
          generatedAt,
          tileId,
          bbox: roadResult.bbox,
          query: roadResult.query,
          elements: ways,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        const cached = await readCachedRoadWays(cachePath);
        if (cached) {
          ways = cached.ways;
          cacheHit = true;
          tileSource = "cache-after-error";
          cachedTiles += 1;
        } else {
          failedTiles += 1;
          tileSource = "failed";
          console.warn(`${tileLabel}: skipped after retries: ${errorMessage}`);
        }
      }
    } else {
      cachedTiles += 1;
    }

    const enrichmentStats = { skippedRoadReasons: {} };
    const enriched = enrichCameraRecordsWithRoadSpeeds(tileCameras, ways, {
      stats: enrichmentStats,
    });
    const tileSummary = {
      cameras: tileCameras.length,
      roadWays: ways.length,
      inferred: 0,
      unknown: 0,
      ambiguous: 0,
      cacheHit,
      source: tileSource,
      error: errorMessage || null,
      skippedRoadReasons: enrichmentStats.skippedRoadReasons,
    };

    for (const camera of enriched) {
      const hasApproach = Array.isArray(camera.speedMeta?.approach) && camera.speedMeta.approach.length > 0;
      if ((camera.speedEnrichmentStatus === "inferred" || hasApproach) && camera.key && camera.speedMeta) {
        records[camera.key] = {
          speedKph: Number.isFinite(camera.speedKph) ? camera.speedKph : null,
          speedMeta: camera.speedMeta,
        };
        if (camera.speedEnrichmentStatus === "inferred") {
          tileSummary.inferred += 1;
          summary.inferred += 1;
          summary.unknown = Math.max(0, summary.unknown - 1);
        }
      } else if (camera.speedEnrichmentStatus === "ambiguous") {
        tileSummary.ambiguous += 1;
        summary.ambiguous += 1;
      } else {
        tileSummary.unknown += 1;
      }
    }

    tileSummaries[tileId] = tileSummary;
    totalRoadWays += ways.length;
    mergeReasonCounts(skippedRoadReasons, enrichmentStats.skippedRoadReasons);

    const tileElapsedMs = Date.now() - tileStartedAtMs;
    if (shouldLogRoadTileProgress({
      index,
      total: tileGroups.length,
      elapsedMs: tileElapsedMs,
      progressEvery,
      slowTileMs,
      attemptedNetwork,
      tileSource,
    })) {
      const skippedRoadDetail = formatReasonCounts(tileSummary.skippedRoadReasons);
      progress(
        `${tileLabel}: ${tileSource}; roads=${ways.length}; inferred=${tileSummary.inferred}; unknown=${tileSummary.unknown}; ambiguous=${tileSummary.ambiguous}${skippedRoadDetail ? `; skippedRoads ${skippedRoadDetail}` : ""}; elapsed=${formatDurationMs(tileElapsedMs)}; totals fetched=${fetchedTiles} cached=${cachedTiles} skipped=${skippedTiles} failed=${failedTiles}`,
      );
    }

    if (attemptedNetwork && index < tileGroups.length - 1 && requestDelayMs > 0) {
      await sleepImpl(requestDelayMs);
    }
  }

  progress(
    `Road speed enrichment complete: records=${Object.keys(records).length}; fetched=${fetchedTiles}; cached=${cachedTiles}; skipped=${skippedTiles}; failed=${failedTiles}; elapsed=${formatDurationMs(Date.now() - startedAtMs)}`,
  );

  const sidecar = {
    version: 1,
    generatedAt,
    source: {
      name: "OpenStreetMap Overpass",
      cameraQuery: OVERPASS_QUERY,
      roadQuery: roadQueryTemplate || "per-tile Overpass road speed queries",
      roadCacheDir: path.relative(projectRoot, roadCacheDir),
      roadCacheMode: refreshCache ? "refresh" : "resume",
    },
    records,
    summary,
    roadFetchSummary: {
      tiles: tileGroups.length,
      fetchedTiles,
      cachedTiles,
      skippedTiles,
      failedTiles,
      totalRoadWays,
      skippedRoadReasons,
      elapsedMs: Date.now() - startedAtMs,
    },
    tiles: tileSummaries,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(sidecar)}\n`);
  return {
    outputPath,
    records: Object.keys(records).length,
    summary,
    tiles: tileGroups.length,
    fetchedTiles,
    cachedTiles,
    skippedTiles,
    failedTiles,
  };
}

async function main() {
  const fetched = await fetchWorldwideCameras();
  const fetchVerb = fetched.cacheHit ? "Loaded" : "Fetched";
  console.warn(
    `${fetchVerb} ${fetched.count} OSM speed cameras -> ${formatProjectPath(fetched.outputPath)}`,
  );

  let enrichment = null;
  try {
    enrichment = await fetchWorldwideCameraMaxspeedEnrichment({
      cameras: fetched.payload.elements,
    });
    console.warn(
      `Prepared ${enrichment.records} inferred maxspeed record(s) across ${enrichment.tiles} road tile(s) (fetched ${enrichment.fetchedTiles}, cached ${enrichment.cachedTiles}, skipped ${enrichment.skippedTiles}, failed ${enrichment.failedTiles}) -> ${path.relative(projectRoot, enrichment.outputPath)}`,
    );
  } catch (error) {
    console.warn(
      `Road speed enrichment unavailable; continuing with explicit camera maxspeed tags only: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const ansvResult = await prepareAnsvCameraGeoJson();
  if (ansvResult) {
    const skipped = ansvResult.skippedRows ? ` (${ansvResult.skippedRows} row(s) skipped)` : "";
    console.warn(
      `Prepared ${ansvResult.featureCount} ANSV camera feature(s)${skipped} -> ${path.relative(projectRoot, ansvResult.outputPath)}`,
    );
  }

  const built = await buildWorldwideCameraArtifacts({
    sourcePath: fetched.outputPath,
    enrichmentPath: enrichment?.outputPath || DEFAULT_MAXSPEED_ENRICHMENT_PATH,
    allowLegacyFallback: false,
  });
  const count = Object.values(built.manifest.countries)
    .reduce((sum, country) => sum + country.count, 0);
  console.warn(
    `Prepared ${count} speed cameras -> ${path.relative(projectRoot, built.outputDir)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
