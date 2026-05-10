import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_RAW_OSM_PATH,
  OVERPASS_QUERY,
  buildWorldwideCameraArtifacts,
} from "./build-worldwide-cameras.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export async function fetchWorldwideCameras({
  overpassUrl = process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL,
  outputPath = DEFAULT_RAW_OSM_PATH,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this Node runtime.");
  }

  const body = new URLSearchParams({ data: OVERPASS_QUERY });
  const response = await fetchImpl(overpassUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "VatioBoard camera artifact builder",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.elements)) {
    throw new Error("Overpass response did not include an elements array.");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`);
  return {
    outputPath,
    count: payload.elements.length,
  };
}

async function main() {
  const fetched = await fetchWorldwideCameras();
  console.warn(
    `Fetched ${fetched.count} OSM speed cameras -> ${path.relative(projectRoot, fetched.outputPath)}`,
  );

  const built = await buildWorldwideCameraArtifacts({
    sourcePath: fetched.outputPath,
    allowLegacyFallback: false,
  });
  const count = Object.values(built.manifest.countries)
    .reduce((sum, country) => sum + country.count, 0);
  console.warn(
    `Prepared ${count} OSM speed cameras -> ${path.relative(projectRoot, built.outputDir)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
