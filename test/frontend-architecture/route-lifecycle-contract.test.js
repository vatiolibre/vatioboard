import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();

const FEATURE_MODULES = [
  {
    name: "board",
    path: "src/board/board.js",
    importModule: () => import("../../src/board/board.js"),
    requiredExports: ["mountBoardRoute", "unmountBoardRoute"],
  },
  {
    name: "library",
    path: "src/library/library.js",
    importModule: () => import("../../src/library/library.js"),
    requiredExports: ["getLibraryElements", "mountLibraryRoute", "unmountLibraryRoute"],
  },
  {
    name: "replay",
    path: "src/replay/replay.js",
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
    path: "src/speed/speed.js",
    importModule: () => import("../../src/speed/speed.js"),
    requiredExports: ["getSpeedElements", "mountSpeedRoute", "unmountSpeedRoute"],
  },
  {
    name: "accel",
    path: "src/accel/accel.js",
    importModule: () => import("../../src/accel/accel.js"),
    requiredExports: ["mountAccelRoute", "unmountAccelRoute"],
    requiredSourcePatterns: [/function\s+getAccelElements\(/],
  },
];

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
      "src/app/views/route-view.js",
      ...listFiles("src/app/views", (file) => basename(file).endsWith("View.js")),
    ];

    for (const file of routeViewFiles) {
      expect(readProjectFile(file), file).not.toContain("preserveDom");
    }
  });

  it("keeps route views on template modules instead of standalone HTML or raw templates", () => {
    const routeViewFiles = listFiles("src/app/views", (file) => basename(file).endsWith("View.js"));

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
      const source = readProjectFile(feature.path);
      for (const pattern of feature.requiredSourcePatterns ?? []) {
        expect(source, feature.path).toMatch(pattern);
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
    expect(bodyClassAdd).not.toHaveBeenCalled();
    expect(bodyClassRemove).not.toHaveBeenCalled();
    expect(bodyClassToggle).not.toHaveBeenCalled();
    expect(cloudSyncSpies.syncCloudRecords).not.toHaveBeenCalled();
    expect(cloudSyncSpies.startCloudSyncLoop).not.toHaveBeenCalled();
  });

  it("keeps lifecycle-sensitive route code using cleanup-owned listeners", () => {
    const routeModules = FEATURE_MODULES.map((feature) => feature.path);
    const directListenerPattern = /(?<!cleanup\.)\b(?:window|document)\.addEventListener\(/;

    for (const file of routeModules) {
      const source = readProjectFile(file);
      expect(source, file).not.toMatch(directListenerPattern);
    }
  });
});
