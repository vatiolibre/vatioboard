import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST_PATH = path.resolve(projectRoot, "public/geo/cameras/manifest.json");

function formatPct(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "0.0%";
}

function getCoverage(entry = {}) {
  return entry.speedCoverage || {
    total: entry.count || 0,
    explicit: 0,
    inferred: 0,
    unknown: entry.count || 0,
    explicitPct: 0,
    inferredPct: 0,
    unknownPct: 100,
  };
}

async function main() {
  const manifestPath = path.resolve(process.argv[2] || DEFAULT_MANIFEST_PATH);
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const coverage = getCoverage(manifest);
    console.warn(`Camera maxspeed coverage (${path.relative(projectRoot, manifestPath)}):`);
    console.warn(`  total:    ${coverage.total ?? 0}`);
    console.warn(`  explicit: ${coverage.explicit ?? 0} (${formatPct(coverage.explicitPct)})`);
    console.warn(`  inferred: ${coverage.inferred ?? 0} (${formatPct(coverage.inferredPct)})`);
    console.warn(`  unknown:  ${coverage.unknown ?? 0} (${formatPct(coverage.unknownPct)})`);

    const countries = Object.entries(manifest.countries || {})
      .map(([code, entry]) => ({
        code,
        name: entry.name || code.toUpperCase(),
        coverage: getCoverage(entry),
      }))
      .sort((a, b) => (b.coverage.unknown || 0) - (a.coverage.unknown || 0))
      .slice(0, 10);

    console.warn("");
    console.warn("Top countries by unknown count:");
    for (const country of countries) {
      console.warn(
        `  ${country.code} ${country.name}: ${country.coverage.unknown || 0} unknown / ${country.coverage.total || 0} total`,
      );
    }
  } catch (error) {
    console.error(
      `Could not analyze camera maxspeed coverage: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
