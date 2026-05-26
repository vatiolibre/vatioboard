import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const STANDALONE_PAGES = [
  "speed.html",
  "accel.html",
  "library.html",
  "replay.html",
  "player.html",
  "calculator.html",
  "gps-rate.html",
  "login.html",
];
const HARNESS_COMMENT =
  "Legacy standalone test/dev harness. Production ships through index.html SPA routes.";
const PRODUCTION_SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".less", ".css"]);
const TEST_SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function listFiles(dir, predicate = () => true) {
  return readdirSync(resolve(root, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(relativePath, predicate);
      return predicate(relativePath) ? [relativePath] : [];
    });
}

describe("standalone HTML production-surface guard", () => {
  it("keeps the production build configured for index.html only", () => {
    const viteConfig = readProjectFile("vite.config.js");

    expect(viteConfig).toContain('index: resolve(__dirname, "index.html")');
    for (const page of STANDALONE_PAGES) {
      expect(viteConfig, page).not.toContain(page);
    }
  });

  it("labels every standalone root page as a dev/test harness", () => {
    for (const page of STANDALONE_PAGES) {
      expect(readProjectFile(page), page).toContain(HARNESS_COMMENT);
    }
  });

  it("keeps standalone page bootstraps in dev-harness adapters", () => {
    const expectedAdapters = {
      "speed.html": "/src/speed/dev-harness.ts",
      "accel.html": "/src/accel/dev-harness.ts",
      "library.html": "/src/library/dev-harness.ts",
      "replay.html": "/src/replay/dev-harness.ts",
    };

    for (const [page, adapter] of Object.entries(expectedAdapters)) {
      const source = readProjectFile(page);
      expect(source, page).toContain(adapter);
      expect(source, page).not.toMatch(/mount(?:Speed|Accel|Library|Replay)Route\(\{ root: document/);
    }
  });

  it("keeps production source from linking to standalone root pages", () => {
    const productionFiles = listFiles("src", (file) => PRODUCTION_SOURCE_EXTENSIONS.has(extname(file)));
    const pagePattern = new RegExp(`(?:${STANDALONE_PAGES.map((page) => page.replace(".", "\\.")).join("|")})["'#?]`);

    for (const file of productionFiles) {
      expect(readProjectFile(file), file).not.toMatch(pagePattern);
    }
  });

  it("keeps product smoke tests on SPA route surfaces", () => {
    const smokeFiles = listFiles("test/smoke", (file) => TEST_SOURCE_EXTENSIONS.has(extname(file)));
    const standaloneBootPattern = /bootHtmlPage\(["'](?:speed|accel|library|replay|player|calculator|gps-rate|login)\.html["']\)/;

    for (const file of smokeFiles) {
      const source = readProjectFile(file);
      if (!standaloneBootPattern.test(source)) continue;
      expect(basename(file), file).toMatch(/^dev-harness-/);
    }
  });
});
