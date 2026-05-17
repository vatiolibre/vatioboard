import { pathToFileURL } from "node:url";
import { buildWorldwideCameraArtifacts } from "./build-worldwide-cameras.mjs";

async function main() {
  const result = await buildWorldwideCameraArtifacts();
  const count = Object.values(result.manifest.countries)
    .reduce((sum, country) => sum + country.count, 0);
  console.warn(`Prepared ${count} speed cameras -> public/geo/cameras`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
