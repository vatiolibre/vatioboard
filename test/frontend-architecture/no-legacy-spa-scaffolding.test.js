import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

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

describe("SPA architecture guard", () => {
  it("keeps route views free of legacy raw HTML wrappers", () => {
    const routeViewFiles = listFiles("src/app/views", (file) => basename(file).endsWith("View.js"));

    for (const file of routeViewFiles) {
      const source = readProjectFile(file);
      expect(source, file).not.toMatch(/\.html\?raw/);
      expect(source, file).not.toContain("createLegacyView");
      expect(source, file).not.toContain("legacy-view");
      expect(source, file).not.toContain("onLegacyViewMount");
      expect(source, file).not.toContain("onLegacyViewUnmount");
    }
  });

  it("keeps production source and CSS free of legacy SPA scaffolding", () => {
    const productionFiles = listFiles("src", (file) => [".js", ".mjs", ".less", ".css"].includes(extname(file)));

    for (const file of productionFiles) {
      const source = readProjectFile(file);
      expect(source, file).not.toContain("createLegacyView");
      expect(source, file).not.toContain("app-legacy-view");
      expect(source, file).not.toContain("onLegacyViewMount");
      expect(source, file).not.toContain("onLegacyViewUnmount");
    }
  });

  it("keeps Vite production build on the single SPA entry", () => {
    const viteConfig = readProjectFile("vite.config.js");

    expect(viteConfig).toContain('index: resolve(__dirname, "index.html")');
    expect(viteConfig).not.toContain('calculator: resolve(__dirname, "calculator.html")');
    expect(viteConfig).not.toContain('gpsRate: resolve(__dirname, "gps-rate.html")');
    expect(viteConfig).not.toContain('login: resolve(__dirname, "login.html")');
  });

  it("keeps the SPA router free of old standalone page aliases", () => {
    const router = readProjectFile("src/app/router.js");

    expect(router).not.toContain("/speed.html");
    expect(router).not.toContain("/library.html");
    expect(router).not.toContain("/accel.html");
    expect(router).not.toContain("/replay.html");
    expect(router).not.toContain("/player.html");
  });

  it("keeps route view modules free of obvious top-level browser side effects", () => {
    const allowList = new Set(["PlayerDebugView.js"]);
    const routeViewFiles = listFiles("src/app/views", (file) => basename(file).endsWith("View.js"));
    const sideEffectPatterns = [
      /document\.querySelector\(/,
      /document\.getElementById\(/,
      /window\.addEventListener\(/,
      /navigator\.geolocation\.watchPosition\(/,
      /setInterval\(/,
      /setTimeout\(/,
    ];

    for (const file of routeViewFiles) {
      if (allowList.has(basename(file))) continue;
      const source = readProjectFile(file);
      const beforeFirstExport = source.split(/\bexport\s+/)[0] || "";
      for (const pattern of sideEffectPatterns) {
        expect(beforeFirstExport, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
