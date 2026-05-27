import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const root = process.cwd();
const PRODUCTION_SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".less", ".css"]);
const FEATURE_MODULE_EXTENSIONS = [".ts", ".js"];

function isRouteViewFile(file) {
  const name = basename(file);
  return name.endsWith("View.js") || name.endsWith("View.ts") || name.endsWith("View.tsx");
}

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function resolveProjectModule(path) {
  if (extname(path)) {
    const absolutePath = resolve(root, path);
    if (existsSync(absolutePath)) return path;
  }

  for (const extension of FEATURE_MODULE_EXTENSIONS) {
    const candidate = `${path}${extension}`;
    if (existsSync(resolve(root, candidate))) return candidate;
  }

  throw new Error(`Unable to resolve project module: ${path}`);
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
    const routeViewFiles = listFiles("src/app/views", isRouteViewFile);

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
    const productionFiles = listFiles("src", (file) => PRODUCTION_SOURCE_EXTENSIONS.has(extname(file)));

    for (const file of productionFiles) {
      const source = readProjectFile(file);
      expect(source, file).not.toContain("createLegacyView");
      expect(source, file).not.toContain("app-legacy-view");
      expect(source, file).not.toContain("onLegacyViewMount");
      expect(source, file).not.toContain("onLegacyViewUnmount");
      expect(source, file).not.toContain("handleLegacyViewMount");
      expect(source, file).not.toContain("handleLegacyViewUnmount");
      expect(source, file).not.toContain("speedLegacyLifecycle");
      expect(source, file).not.toContain("accelLegacyLifecycle");
    }
  });

  it("keeps Vite production build on the single SPA entry", () => {
    const viteConfig = readProjectFile("vite.config.js");

    expect(viteConfig).toContain('index: resolve(__dirname, "index.html")');
    expect(viteConfig).not.toContain('speed: resolve(__dirname, "speed.html")');
    expect(viteConfig).not.toContain('accel: resolve(__dirname, "accel.html")');
    expect(viteConfig).not.toContain('library: resolve(__dirname, "library.html")');
    expect(viteConfig).not.toContain('replay: resolve(__dirname, "replay.html")');
    expect(viteConfig).not.toContain('player: resolve(__dirname, "player.html")');
    expect(viteConfig).not.toContain('calculator: resolve(__dirname, "calculator.html")');
    expect(viteConfig).not.toContain('gpsRate: resolve(__dirname, "gps-rate.html")');
    expect(viteConfig).not.toContain('login: resolve(__dirname, "login.html")');
  });

  it("keeps the SPA router free of old standalone page aliases", () => {
    const router = readProjectFile(resolveProjectModule("src/app/router"));

    expect(router).not.toContain("/speed.html");
    expect(router).not.toContain("/library.html");
    expect(router).not.toContain("/accel.html");
    expect(router).not.toContain("/replay.html");
    expect(router).not.toContain("/player.html");

    const routes = readProjectFile(resolveProjectModule("src/app/routes"));
    expect(routes).not.toContain('path: "/player"');
    expect(routes).not.toContain("PlayerDebugView");
  });

  it("keeps production source free of standalone HTML route links", () => {
    const productionFiles = listFiles("src", (file) => PRODUCTION_SOURCE_EXTENSIONS.has(extname(file)));

    for (const file of productionFiles) {
      const source = readProjectFile(file);
      expect(source, file).not.toMatch(/(?:speed|library|accel|replay|player|calculator|gps-rate|login)\.html["'#?]/);
    }
  });

  it("keeps route view modules free of obvious top-level browser side effects", () => {
    const routeViewFiles = listFiles("src/app/views", isRouteViewFile);
    const sideEffectPatterns = [
      /document\.querySelector\(/,
      /document\.getElementById\(/,
      /window\.addEventListener\(/,
      /navigator\.geolocation\.watchPosition\(/,
      /setInterval\(/,
      /setTimeout\(/,
      /requestAnimationFrame\(/,
    ];

    for (const file of routeViewFiles) {
      const source = readProjectFile(file);
      const beforeFirstExport = source.split(/\bexport\s+/)[0] || "";
      for (const pattern of sideEffectPatterns) {
        expect(beforeFirstExport, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("keeps converted feature modules free of import-time route side effects", async () => {
    const convertedModules = [
      () => import("../../src/library/library.js"),
      () => import("../../src/replay/replay.js"),
      () => import("../../src/speed/speed.js"),
      () => import("../../src/accel/accel.js"),
    ];

    vi.resetModules();
    const watchPosition = vi.spyOn(navigator.geolocation, "watchPosition");
    const windowAddEventListener = vi.spyOn(window, "addEventListener");
    const documentAddEventListener = vi.spyOn(document, "addEventListener");
    const documentQuerySelector = vi.spyOn(document, "querySelector");
    const documentGetElementById = vi.spyOn(document, "getElementById");
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame");
    const bodyClassAdd = vi.spyOn(document.body.classList, "add");
    const bodyClassRemove = vi.spyOn(document.body.classList, "remove");
    const bodyClassToggle = vi.spyOn(document.body.classList, "toggle");

    try {
      for (const loadModule of convertedModules) {
        await loadModule();
      }

      expect(watchPosition).not.toHaveBeenCalled();
      expect(windowAddEventListener).not.toHaveBeenCalled();
      expect(documentAddEventListener).not.toHaveBeenCalled();
      expect(documentQuerySelector).not.toHaveBeenCalled();
      expect(documentGetElementById).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
      expect(bodyClassAdd).not.toHaveBeenCalled();
      expect(bodyClassRemove).not.toHaveBeenCalled();
      expect(bodyClassToggle).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
