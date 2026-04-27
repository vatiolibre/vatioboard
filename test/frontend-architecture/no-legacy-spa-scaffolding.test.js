import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
    const router = readProjectFile("src/app/router.js");

    expect(router).not.toContain("/speed.html");
    expect(router).not.toContain("/library.html");
    expect(router).not.toContain("/accel.html");
    expect(router).not.toContain("/replay.html");
    expect(router).not.toContain("/player.html");

    const routes = readProjectFile("src/app/routes.js");
    expect(routes).not.toContain('path: "/player"');
    expect(routes).not.toContain("PlayerDebugView");
  });

  it("keeps production source free of standalone HTML route links", () => {
    const productionFiles = listFiles("src", (file) => [".js", ".mjs", ".less", ".css"].includes(extname(file)));

    for (const file of productionFiles) {
      const source = readProjectFile(file);
      expect(source, file).not.toMatch(/(?:speed|library|accel|replay|player|calculator|gps-rate|login)\.html["'#?]/);
    }
  });

  it("keeps route view modules free of obvious top-level browser side effects", () => {
    const routeViewFiles = listFiles("src/app/views", (file) => basename(file).endsWith("View.js"));
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
    // TODO: shrink this debt list as Library, Replay, Speed, and Accel move
    // DOM lookup/listener/timer setup fully behind their route mount functions.
    const pendingConversion = new Set([
      "src/library/library.js",
      "src/replay/replay.js",
      "src/speed/speed.js",
      "src/accel/accel.js",
    ]);
    expect(pendingConversion).toEqual(new Set([
      "src/library/library.js",
      "src/replay/replay.js",
      "src/speed/speed.js",
      "src/accel/accel.js",
    ]));

    vi.resetModules();
    const watchPosition = vi.spyOn(navigator.geolocation, "watchPosition");
    const addEventListener = vi.spyOn(window, "addEventListener");
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame");
    const bodyClassAdd = vi.spyOn(document.body.classList, "add");
    const bodyClassRemove = vi.spyOn(document.body.classList, "remove");
    const bodyClassToggle = vi.spyOn(document.body.classList, "toggle");

    try {
      await import("../../src/board/board.js");

      expect(watchPosition).not.toHaveBeenCalled();
      expect(addEventListener).not.toHaveBeenCalled();
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
