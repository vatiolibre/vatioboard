import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import KDBush from "kdbush";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const sourcePath = path.resolve(projectRoot, "data-src/ansv_cameras_maplibre.geojson");
const compactPath = path.resolve(projectRoot, "public/geo/ansv_cameras_compact.min.json");
const indexPath = path.resolve(projectRoot, "public/geo/ansv_cameras_compact.kdbush");

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function parseSpeed(value) {
  const numeric = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function isPointFeature(feature) {
  return feature?.geometry?.type === "Point" && Array.isArray(feature?.geometry?.coordinates);
}

async function buildSpeedTrapArtifacts() {
  const rawText = await fs.readFile(sourcePath, "utf8");
  const geojson = JSON.parse(rawText);

  if (geojson?.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection with a features array.");
  }

  const traps = [];
  for (const feature of geojson.features) {
    if (!isPointFeature(feature)) continue;

    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    traps.push([
      roundCoordinate(lon),
      roundCoordinate(lat),
      parseSpeed(feature.properties?.speed),
    ]);
  }

  const index = new KDBush(traps.length);
  for (const [lon, lat] of traps) {
    index.add(lon, lat);
  }
  index.finish();

  const compactPayload = JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    traps,
  });

  await fs.mkdir(path.dirname(compactPath), { recursive: true });
  await Promise.all([
    fs.writeFile(compactPath, compactPayload),
    fs.writeFile(indexPath, Buffer.from(index.data)),
  ]);

  console.log(
    `Prepared ${traps.length} speed traps -> ${path.relative(projectRoot, compactPath)} + ${path.relative(projectRoot, indexPath)}`,
  );
}

buildSpeedTrapArtifacts().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
