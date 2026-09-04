import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "dist");
await copyFile(resolve(outputDirectory, "index.html"), resolve(outputDirectory, "404.html"));
