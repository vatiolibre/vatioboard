import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();
const SOURCE_MODULE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const FEATURE_MODULE_EXTENSIONS = [".ts", ".js"];

function isRouteViewFile(file) {
  const name = basename(file);
  return name.endsWith("View.js") || name.endsWith("View.ts") || name.endsWith("View.tsx");
}

const FEATURE_MODULES = [
  {
    name: "board",
    path: "src/board/board",
    importModule: () => import("../../src/board/board.js"),
    requiredExports: ["mountBoardRoute", "unmountBoardRoute"],
  },
  {
    name: "library",
    path: "src/library/library",
    importModule: () => import("../../src/library/library.js"),
    requiredExports: ["getLibraryElements", "mountLibraryRoute", "unmountLibraryRoute"],
  },
  {
    name: "replay",
    path: "src/replay/replay",
    importModule: () => import("../../src/replay/replay.js"),
    requiredExports: [
      "getReplayElements",
      "getReplayGraphElements",
      "mountReplayRoute",
      "unmountReplayRoute",
    ],
  },
  {
    name: "speed",
    path: "src/speed/speed",
    importModule: () => import("../../src/speed/speed.js"),
    requiredExports: ["getSpeedElements", "mountSpeedRoute", "unmountSpeedRoute"],
  },
  {
    name: "accel",
    path: "src/accel/accel",
    importModule: () => import("../../src/accel/accel.js"),
    requiredExports: ["mountAccelRoute", "unmountAccelRoute"],
    requiredSourcePatterns: [/function\s+getAccelElements\(/],
  },
];

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

const cloudSyncSpies = vi.hoisted(() => ({
  queueCloudSyncChange: vi.fn(async () => true),
  queueCloudSyncDeletion: vi.fn(async () => true),
  requestCloudSync: vi.fn(() => true),
  startCloudSyncLoop: vi.fn(),
  syncCloudRecords: vi.fn(async () => ({ ok: true })),
}));

function installCloudSyncMock() {
  cloudSyncSpies.queueCloudSyncChange.mockClear();
  cloudSyncSpies.queueCloudSyncDeletion.mockClear();
  cloudSyncSpies.requestCloudSync.mockClear();
  cloudSyncSpies.startCloudSyncLoop.mockClear();
  cloudSyncSpies.syncCloudRecords.mockClear();

  vi.doMock("../../src/shared/cloud-sync.js", () => ({
    CLOUD_SYNC_APPLIED_EVENT: "vatioboard:cloud-sync-applied",
    CLOUD_SYNC_ENTITY_TYPES: {
      accelRun: "accel_run",
      boardDrawing: "board_drawing",
      replaySession: "replay_session",
    },
    CLOUD_SYNC_STATUS_EVENT: "vatioboard:cloud-sync-status",
    CLOUD_SYNC_STATUS_STATES: {
      failed: "failed",
      localOnly: "local-only",
      paused: "paused",
      scheduled: "scheduled",
      synced: "synced",
      syncing: "syncing",
    },
    getCloudSyncStatus: vi.fn(() => ({ state: "idle" })),
    isCloudSyncScheduled: vi.fn(() => false),
    queueCloudSyncChange: cloudSyncSpies.queueCloudSyncChange,
    queueCloudSyncDeletion: cloudSyncSpies.queueCloudSyncDeletion,
    requestCloudSync: cloudSyncSpies.requestCloudSync,
    startCloudSyncLoop: cloudSyncSpies.startCloudSyncLoop,
    stopCloudSyncLoop: vi.fn(),
    syncCloudRecords: cloudSyncSpies.syncCloudRecords,
  }));
}

describe("route lifecycle contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.className = "";
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete window.__vatioboardSpa;
  });

  it("does not allow preserveDom in route views or the route-view helper", () => {
    const routeViewFiles = [
      resolveProjectModule("src/app/views/route-view"),
      ...listFiles("src/app/views", isRouteViewFile),
    ];

    for (const file of routeViewFiles) {
      expect(readProjectFile(file), file).not.toContain("preserveDom");
    }
  });

  it("keeps route views on template modules instead of standalone HTML or raw templates", () => {
    const routeViewFiles = listFiles("src/app/views", isRouteViewFile);

    for (const file of routeViewFiles) {
      const source = readProjectFile(file);
      expect(source, file).not.toMatch(/\.html\?raw/);
      expect(source, file).not.toMatch(/from\s+["'][^"']+\.html["']/);
      expect(source, file).not.toContain("createLegacyView");
    }
  });

  it("keeps feature route modules on explicit mount/unmount exports", async () => {
    installCloudSyncMock();

    for (const feature of FEATURE_MODULES) {
      const modulePath = resolveProjectModule(feature.path);
      const source = readProjectFile(modulePath);
      for (const pattern of feature.requiredSourcePatterns ?? []) {
        expect(source, modulePath).toMatch(pattern);
      }

      const module = await feature.importModule();
      for (const exportName of feature.requiredExports) {
        expect(module[exportName], `${feature.name} must export ${exportName}`).toBeDefined();
      }
    }
  });

  it("does not bind route DOM, listeners, GPS, timers, RAFs, body classes, or cloud sync on import", async () => {
    installCloudSyncMock();

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
    const OriginalAudio = window.Audio;
    const AudioSpy = vi.fn(function AudioMock(src = "") {
      this.src = src;
      this.loop = false;
      this.preload = "";
      this.currentTime = 0;
      this.muted = false;
      this.volume = 1;
      this.addEventListener = vi.fn();
      this.removeEventListener = vi.fn();
      this.pause = vi.fn();
      this.play = vi.fn(() => Promise.resolve());
    });
    Object.defineProperty(window, "Audio", {
      configurable: true,
      writable: true,
      value: AudioSpy,
    });

    try {
      for (const feature of FEATURE_MODULES) {
        await feature.importModule();
      }

      expect(documentGetElementById).not.toHaveBeenCalled();
      expect(documentQuerySelector).not.toHaveBeenCalled();
      expect(windowAddEventListener).not.toHaveBeenCalled();
      expect(documentAddEventListener).not.toHaveBeenCalled();
      expect(watchPosition).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
      expect(AudioSpy.mock.calls.map(([src]) => String(src ?? ""))).not.toContain(
        "/audio/finish.m4a"
      );
      expect(bodyClassAdd).not.toHaveBeenCalled();
      expect(bodyClassRemove).not.toHaveBeenCalled();
      expect(bodyClassToggle).not.toHaveBeenCalled();
      expect(cloudSyncSpies.syncCloudRecords).not.toHaveBeenCalled();
      expect(cloudSyncSpies.startCloudSyncLoop).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "Audio", {
        configurable: true,
        writable: true,
        value: OriginalAudio,
      });
    }
  });

  it("keeps lifecycle-sensitive route code using cleanup-owned listeners", () => {
    const routeModules = FEATURE_MODULES.map((feature) => resolveProjectModule(feature.path));
    const directListenerPattern = /(?<!cleanup\.)\b(?:window|document)\.addEventListener\(/;

    for (const file of routeModules) {
      const source = readProjectFile(file);
      expect(source, file).not.toMatch(directListenerPattern);
    }
  });

  it("keeps raw cloud sync pull loops out of route controllers", () => {
    const routeModules = FEATURE_MODULES.map((feature) => resolveProjectModule(feature.path));

    for (const file of routeModules) {
      const source = readProjectFile(file);
      expect(source, file).not.toMatch(/\bsyncCloudRecords\s*\(/);
      expect(source, file).not.toMatch(/\bstartCloudSyncLoop\s*\(/);
      expect(source, file).not.toContain("download_my_sync_payload");
    }
  });

  it("keeps heavy map, chart, and visualizer modules out of eager feature imports", () => {
    const sourceFiles = listFiles("src", (file) => SOURCE_MODULE_EXTENSIONS.has(extname(file)));

    for (const file of sourceFiles) {
      const source = readProjectFile(file);
      if (file !== "src/shared/maplibre-loader.ts") {
        expect(source, file).not.toContain("maplibre-gl");
        expect(source, file).not.toContain("maplibre-gl/dist/maplibre-gl.css");
      }
      expect(source, file).not.toMatch(/from\s+["']chart\.js\/auto["']/);
    }

    expect(readProjectFile(resolveProjectModule("src/player/player-shell"))).not.toMatch(
      /from\s+["']\.\/milkdrop-panel\.js["']/
    );
  });
});
