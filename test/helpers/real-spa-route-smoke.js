import { expect, vi } from "vitest";
import { bootHtmlPage, flushTasks } from "./page-smoke.js";

const maplibreMocks = vi.hoisted(() => ({
  maps: [],
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options = {}) {
      this.handlers = {};
      this.sources = new Map();
      this.options = options;
      this.scrollZoom = { disable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.dragPan = { disable: vi.fn() };
      this.dragRotate = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
      this.touchZoomRotate = { disable: vi.fn() };
      this.jumpTo = vi.fn();
      this.easeTo = vi.fn();
      this.fitBounds = vi.fn();
      this.resize = vi.fn();
      this.remove = vi.fn();
      Promise.resolve().then(() => {
        for (const handler of this.handlers.load ?? []) handler();
      });
      maplibreMocks.maps.push(this);
    }
    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    addControl() { return this; }
    getCenter() { return { lng: 0, lat: 0 }; }
    getSource(id) {
      if (!this.sources.has(id)) this.sources.set(id, { setData: vi.fn() });
      return this.sources.get(id);
    }
    setPaintProperty() {}
  }
  return { default: { Map: FakeMap, AttributionControl: class {} } };
});

vi.mock("../../src/shared/single-tab.js", () => ({
  ensureSingleTabOwnership: vi.fn(() => Promise.resolve(true)),
  hasSingleTabOwnership: vi.fn(() => true),
  releaseSingleTabOwnership: vi.fn(),
  SINGLE_TAB_OWNERSHIP_EVENT: "vatioboard:single-tab-ownership",
}));

const cloudSyncMocks = vi.hoisted(() => ({
  queueCloudSyncChange: vi.fn(async () => true),
  queueCloudSyncDeletion: vi.fn(async () => true),
  requestCloudSync: vi.fn(() => true),
  startCloudSyncLoop: vi.fn(),
  syncCloudRecords: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../src/shared/cloud-sync.js", () => ({
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
  queueCloudSyncChange: cloudSyncMocks.queueCloudSyncChange,
  queueCloudSyncDeletion: cloudSyncMocks.queueCloudSyncDeletion,
  requestCloudSync: cloudSyncMocks.requestCloudSync,
  startCloudSyncLoop: cloudSyncMocks.startCloudSyncLoop,
  stopCloudSyncLoop: vi.fn(),
  syncCloudRecords: cloudSyncMocks.syncCloudRecords,
}));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchStub() {
  window.fetch = vi.fn(async (input) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");
    if (url.includes("tesla_connection_status")) {
      return jsonResponse({ message: { connected: false, is_guest: true } });
    }
    if (url.includes("frappe.auth.get_logged_user")) {
      return jsonResponse({ message: "Guest" });
    }
    if (url.includes("get_my_feature_access")) {
      return jsonResponse({
        message: {
          has_active_subscription: false,
          csrf_token: "",
          features: { cloud_sync: { enabled: false }, media_assets: { enabled: false } },
        },
      });
    }
    if (url.includes("pull_my_sync_records")) {
      return jsonResponse({ message: { records: [], has_more: false, next_cursor: "" } });
    }
    if (url.includes("list_my_") || url.includes("list_my_board_documents")) {
      return jsonResponse({ message: { records: [], documents: [], assets: [], total_count: 0, has_more: false } });
    }
    return jsonResponse({ message: {} });
  });
}

function installBrowserStubs() {
  installFetchStub();
  vi.spyOn(navigator.geolocation, "watchPosition").mockReturnValue(1);
  vi.spyOn(navigator.geolocation, "clearWatch").mockImplementation(() => {});
  vi.spyOn(window, "open").mockImplementation(() => null);
}

export async function resetRealSpaSmoke() {
  window.__vatioboardRouter?.destroy?.();
  delete window.__vatioboardRouter;
  delete window.__vatioboardFloatingTools;
  delete window.__vatioboardPlayerWidget;
  delete window.__vatioboardStartMenu;
  delete window.__vatioboardSpa;
  cloudSyncMocks.queueCloudSyncChange.mockClear();
  cloudSyncMocks.queueCloudSyncDeletion.mockClear();
  cloudSyncMocks.requestCloudSync.mockClear();
  cloudSyncMocks.startCloudSyncLoop.mockClear();
  cloudSyncMocks.syncCloudRecords.mockClear();
  maplibreMocks.maps = [];
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  installBrowserStubs();
}

export function getRealSpaSmokeMocks() {
  return {
    cloudSync: cloudSyncMocks,
    maplibre: maplibreMocks,
  };
}

async function settle(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
    await vi.dynamicImportSettled?.();
  }
}

async function bootSpa(hash = "#/board") {
  await bootHtmlPage("index.html");
  expect(document.getElementById("app-view"), "index.html should provide #app-view").toBeTruthy();
  window.history.replaceState({}, "", `https://vatioboard.com/${hash}`);
  const { startAppShell } = await import("../../src/app/app-shell.js");
  await startAppShell();
  await waitForRoute(hash);
}

const routeConfig = {
  "#/board": {
    bodyClass: "board-page",
    selector: "#pad",
  },
  "#/speed": {
    bodyClass: "speed-page",
    selector: "#speedValue",
  },
  "#/replay": {
    bodyClass: "replay-page",
    selector: "#replayShell",
  },
  "#/accel": {
    bodyClass: "accel-page",
    selector: "#armRun",
  },
  "#/library": {
    bodyClass: "library-page",
    selector: "#libraryList",
  },
};

async function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await waitForRoute(hash);
}

async function waitForRoute(hash) {
  const selector = routeConfig[hash]?.selector;
  if (!selector) throw new Error(`Unknown route hash ${hash}`);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await settle(4);
    if (document.querySelector(selector)) return;
  }

  const rootHtml = document.getElementById("app-view")?.innerHTML;
  expect(
    document.querySelector(selector),
    `Expected ${selector} for ${hash}. app-view: ${rootHtml ? rootHtml.slice(0, 500) : "<empty or missing>"}`
  ).toBeTruthy();
}

async function expectPersistentShellReady() {
  expect(document.querySelectorAll(".floating-dock")).toHaveLength(1);
  expect(document.querySelectorAll(".player-panel")).toHaveLength(1);
  expect(document.querySelectorAll(".player-fab")).toHaveLength(1);

  const routeToolsButton = document.querySelector(
    "#speedToolsMenuBtn, #replayToolsMenuBtn, #accelToolsMenuBtn, #libraryToolsMenuBtn, #toolsMenuBtn"
  );
  routeToolsButton?.click();
  await settle();
  expect(document.getElementById("appStartMenuList")).toBeTruthy();
  expect(document.querySelector("[data-start-route='/board']")).toBeTruthy();
}

async function expectRouteUsable(hash) {
  const config = routeConfig[hash];
  expect(document.querySelector(config.selector)).toBeTruthy();
  expect(document.body.classList.contains(config.bodyClass)).toBe(true);

  for (const [otherHash, otherConfig] of Object.entries(routeConfig)) {
    if (otherHash === hash) continue;
    expect(document.body.classList.contains(otherConfig.bodyClass)).toBe(false);
  }

  await expectPersistentShellReady();
}

export async function expectRealSpaRouteRemount({
  targetHash,
  targetSelector,
  sequence,
}) {
  await bootSpa("#/board");
  await expectRouteUsable("#/board");

  const routeSequence = sequence || ["#/board", targetHash, "#/board", targetHash];

  for (const hash of routeSequence.slice(1)) {
    await navigate(hash);
    await expectRouteUsable(hash);
  }

  expect(document.querySelector(targetSelector)).toBeTruthy();
  expect(cloudSyncMocks.startCloudSyncLoop).toHaveBeenCalledTimes(1);
  expect(cloudSyncMocks.syncCloudRecords).not.toHaveBeenCalled();
}
