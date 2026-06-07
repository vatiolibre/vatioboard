import { expect, vi } from "vitest";
import { bootHtmlPage, flushTasks } from "./page-smoke.js";

const maplibreMocks = vi.hoisted(() => ({
  maps: [],
}));

const chartMocks = vi.hoisted(() => ({
  charts: [],
}));

const lifecycleMocks = vi.hoisted(() => ({
  activeWatchIds: new Set(),
  activeIntervalIds: new Set(),
  activeRafIds: new Set(),
  activeResizeObservers: new Set(),
  activeTimeoutIds: new Set(),
  audioInstances: [],
  downloadMySyncPayloadRequests: [],
  listenerRegistry: {
    window: new Map(),
    document: new Map(),
  },
  mediaSessionActionHandlers: new Map(),
  nextWatchId: 1,
  nextIntervalId: 1,
  nextRafId: 1,
  nextTimeoutId: 1,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options = {}) {
      this.handlers = {};
      this.sources = new Map();
      this.options = options;
      this.removed = false;
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
      this.stop = vi.fn();
      this.resize = vi.fn();
      this.remove = vi.fn(() => {
        this.removed = true;
      });
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
    getZoom() { return 0; }
    getCenter() { return { lng: 0, lat: 0 }; }
    getSource(id) {
      if (!this.sources.has(id)) this.sources.set(id, { setData: vi.fn() });
      return this.sources.get(id);
    }
    setPaintProperty() {}
  }
  return { default: { Map: FakeMap, AttributionControl: class {} } };
});

vi.mock("chart.js/auto", () => {
  class FakeChart {
    constructor(canvas, config = {}) {
      this.canvas = canvas;
      this.config = config;
      this.ctx = canvas?.getContext?.("2d") ?? {};
      this.data = config.data ?? { datasets: [] };
      this.options = config.options ?? {};
      this.destroyed = false;
      this.chartArea = { left: 0, right: 320, top: 0, bottom: 180 };
      this.scales = {
        x: {
          getPixelForValue: vi.fn((value) => Number(value) || 0),
          getValueForPixel: vi.fn((value) => Number(value) || 0),
        },
        y: {
          getPixelForValue: vi.fn((value) => Number(value) || 0),
          getValueForPixel: vi.fn((value) => Number(value) || 0),
        },
      };
      this.tooltip = {
        getActiveElements: vi.fn(() => []),
        setActiveElements: vi.fn(),
      };
      chartMocks.charts.push(this);
    }

    destroy = vi.fn(() => {
      this.destroyed = true;
    });
    draw = vi.fn();
    resize = vi.fn();
    setActiveElements = vi.fn();
    update = vi.fn();

    getDatasetMeta(index) {
      const dataset = this.data?.datasets?.[index] ?? { data: [] };
      return {
        data: (dataset.data ?? []).map((point, pointIndex) => ({
          x: Number(point?.x ?? pointIndex) || 0,
          y: Number(point?.y ?? 0) || 0,
        })),
      };
    }
  }

  return { default: FakeChart };
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
    if (url.includes("download_my_sync_payload")) {
      lifecycleMocks.downloadMySyncPayloadRequests.push(url);
      return jsonResponse({ message: { records: [], has_more: false, next_cursor: "" } });
    }
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

function resetLifecycleMocks() {
  lifecycleMocks.activeWatchIds.clear();
  lifecycleMocks.activeIntervalIds.clear();
  lifecycleMocks.activeRafIds.clear();
  lifecycleMocks.activeResizeObservers.clear();
  lifecycleMocks.activeTimeoutIds.clear();
  lifecycleMocks.audioInstances = [];
  lifecycleMocks.downloadMySyncPayloadRequests = [];
  lifecycleMocks.listenerRegistry.window = new Map();
  lifecycleMocks.listenerRegistry.document = new Map();
  lifecycleMocks.mediaSessionActionHandlers = new Map();
  lifecycleMocks.nextWatchId = 1;
  lifecycleMocks.nextIntervalId = 1;
  lifecycleMocks.nextRafId = 1;
  lifecycleMocks.nextTimeoutId = 1;
}

function getListenerSet(targetName, type) {
  const registry = lifecycleMocks.listenerRegistry[targetName];
  if (!registry.has(type)) registry.set(type, new Set());
  return registry.get(type);
}

function installListenerTracker(target, targetName) {
  const originalAddEventListener = target.addEventListener.bind(target);
  const originalRemoveEventListener = target.removeEventListener.bind(target);

  vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
    getListenerSet(targetName, type).add(listener);
    return originalAddEventListener(type, listener, options);
  });

  vi.spyOn(target, "removeEventListener").mockImplementation((type, listener, options) => {
    getListenerSet(targetName, type).delete(listener);
    return originalRemoveEventListener(type, listener, options);
  });
}

function getActiveListenerCount(targetName, type) {
  return lifecycleMocks.listenerRegistry[targetName]?.get(type)?.size ?? 0;
}

function installResourceStubs() {
  const geolocation = navigator.geolocation;

  vi.spyOn(geolocation, "watchPosition").mockImplementation((success, error, options) => {
    const watchId = lifecycleMocks.nextWatchId;
    lifecycleMocks.nextWatchId += 1;
    lifecycleMocks.activeWatchIds.add(watchId);
    geolocation.success = success;
    geolocation.error = error;
    geolocation.options = options;
    return watchId;
  });

  vi.spyOn(geolocation, "clearWatch").mockImplementation((watchId) => {
    lifecycleMocks.activeWatchIds.delete(watchId);
  });

  vi.spyOn(window, "setInterval").mockImplementation(() => {
    const intervalId = lifecycleMocks.nextIntervalId;
    lifecycleMocks.nextIntervalId += 1;
    lifecycleMocks.activeIntervalIds.add(intervalId);
    return intervalId;
  });

  vi.spyOn(window, "clearInterval").mockImplementation((intervalId) => {
    lifecycleMocks.activeIntervalIds.delete(intervalId);
  });

  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => {
    const frameId = lifecycleMocks.nextRafId;
    lifecycleMocks.nextRafId += 1;
    lifecycleMocks.activeRafIds.add(frameId);
    return frameId;
  });

  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
    lifecycleMocks.activeRafIds.delete(frameId);
  });

  vi.spyOn(window, "setTimeout").mockImplementation(() => {
    const timeoutId = lifecycleMocks.nextTimeoutId;
    lifecycleMocks.nextTimeoutId += 1;
    lifecycleMocks.activeTimeoutIds.add(timeoutId);
    return timeoutId;
  });

  vi.spyOn(window, "clearTimeout").mockImplementation((timeoutId) => {
    lifecycleMocks.activeTimeoutIds.delete(timeoutId);
  });

  const OriginalResizeObserver = window.ResizeObserver;
  class TrackedResizeObserver extends OriginalResizeObserver {
    constructor(callback) {
      super(callback);
      this.__active = false;
    }

    observe(target, options) {
      this.__active = true;
      lifecycleMocks.activeResizeObservers.add(this);
      return super.observe(target, options);
    }

    disconnect() {
      this.__active = false;
      lifecycleMocks.activeResizeObservers.delete(this);
      return super.disconnect();
    }
  }
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TrackedResizeObserver,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TrackedResizeObserver,
  });

  const OriginalAudio = window.Audio;
  class TrackedAudio extends OriginalAudio {
    constructor(src = "") {
      super(src);
      this.__listenerRegistry = new Map();
      lifecycleMocks.audioInstances.push(this);
    }

    addEventListener(type, listener, options) {
      if (!this.__listenerRegistry.has(type)) this.__listenerRegistry.set(type, new Set());
      this.__listenerRegistry.get(type).add(listener);
      return super.addEventListener(type, listener, options);
    }

    removeEventListener(type, listener, options) {
      this.__listenerRegistry.get(type)?.delete(listener);
      return super.removeEventListener(type, listener, options);
    }
  }
  Object.defineProperty(window, "Audio", {
    configurable: true,
    writable: true,
    value: TrackedAudio,
  });
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    writable: true,
    value: TrackedAudio,
  });
}

function getAudioEventListenerCount() {
  return lifecycleMocks.audioInstances.reduce((total, audio) => {
    let audioTotal = 0;
    for (const listeners of audio.__listenerRegistry?.values?.() ?? []) {
      audioTotal += listeners.size;
    }
    return total + audioTotal;
  }, 0);
}

function installBrowserStubs() {
  installFetchStub();
  installResourceStubs();
  installListenerTracker(window, "window");
  installListenerTracker(document, "document");
  const originalSetActionHandler = navigator.mediaSession?.setActionHandler;
  if (typeof originalSetActionHandler === "function") {
    vi.spyOn(navigator.mediaSession, "setActionHandler").mockImplementation((action, handler) => {
      if (handler) lifecycleMocks.mediaSessionActionHandlers.set(action, handler);
      else lifecycleMocks.mediaSessionActionHandlers.delete(action);
      return originalSetActionHandler(action, handler);
    });
  }
  vi.spyOn(window, "open").mockImplementation(() => null);
}

export async function resetRealSpaSmoke() {
  window.__vatioboardRouter?.destroy?.();
  vi.restoreAllMocks();
  resetLifecycleMocks();
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
  chartMocks.charts = [];
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  installBrowserStubs();
}

export function getRealSpaSmokeMocks() {
  return {
    charts: chartMocks,
    cloudSync: cloudSyncMocks,
    lifecycle: lifecycleMocks,
    maplibre: maplibreMocks,
  };
}

export function getRealSpaResourceSnapshot() {
  return {
    activeChartCount: chartMocks.charts.filter((chart) => !chart.destroyed).length,
    activeIntervalCount: lifecycleMocks.activeIntervalIds.size,
    activeMapCount: maplibreMocks.maps.filter((map) => !map.removed).length,
    activeRafCount: lifecycleMocks.activeRafIds.size,
    activeResizeObserverCount: lifecycleMocks.activeResizeObservers.size,
    activeTimeoutCount: lifecycleMocks.activeTimeoutIds.size,
    activeWatchCount: lifecycleMocks.activeWatchIds.size,
    audioEventListenerCount: getAudioEventListenerCount(),
    audioInstanceCount: lifecycleMocks.audioInstances.length,
    chartCount: chartMocks.charts.length,
    downloadMySyncPayloadCount: lifecycleMocks.downloadMySyncPayloadRequests.length,
    mapCount: maplibreMocks.maps.length,
    mediaSessionActionHandlerCallCount: navigator.mediaSession?.setActionHandler?.mock?.calls?.length ?? 0,
    mediaSessionActionHandlerCount: lifecycleMocks.mediaSessionActionHandlers.size,
    listeners: {
      documentI18nChange: getActiveListenerCount("document", "i18n:change"),
      documentKeydown: getActiveListenerCount("document", "keydown"),
      documentVisibilityChange: getActiveListenerCount("document", "visibilitychange"),
      windowBackendAuth: getActiveListenerCount("window", "vatioboard:backend-auth-state"),
      windowCloudSyncApplied: getActiveListenerCount("window", "vatioboard:cloud-sync-applied"),
      windowRouteVisible: getActiveListenerCount("window", "vatioboard:route-visible"),
      windowSingleTabOwnership: getActiveListenerCount("window", "vatioboard:single-tab-ownership"),
    },
  };
}

async function settle(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
    await vi.dynamicImportSettled?.();
  }
}

export async function settleRealSpaSmoke(iterations = 16) {
  await settle(iterations);
}

const WELCOME_CONSENT_KEY = "vatioboard.welcome_consent.v1";

function seedWelcomeConsent(locationChoice = "enabled") {
  if (localStorage.getItem(WELCOME_CONSENT_KEY)) return;
  localStorage.setItem(
    WELCOME_CONSENT_KEY,
    JSON.stringify({
      accepted: true,
      acceptedAtMs: Date.now(),
      locationChoice,
      version: 1,
    }),
  );
}

async function bootSpa(hash = "#/board") {
  await bootHtmlPage("index.html");
  seedWelcomeConsent();
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
  "#/apps": {
    bodyClass: "apps-page",
    selector: "[data-vb-app-manager]",
  },
};

async function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await waitForRoute(hash);
}

export async function navigateRealSpaSmoke(hash) {
  await navigate(hash);
  await expectRouteUsable(hash);
  return {
    hash,
    ...getRealSpaResourceSnapshot(),
  };
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
  expect(document.querySelectorAll(".floating-dock")).toHaveLength(0);
  expect(document.querySelectorAll(".player-panel")).toHaveLength(1);
  expect(document.querySelectorAll(".player-fab")).toHaveLength(0);
  expect(document.querySelectorAll("[data-vb-shell-taskbar]")).toHaveLength(1);

  const taskbar = document.querySelector("[data-vb-shell-taskbar]");
  expect(taskbar.hidden).toBe(false);
  const startButton = taskbar.querySelector("[data-vb-shell-start-button]");
  expect(startButton).toBeTruthy();
  expect(startButton.getAttribute("aria-controls")).toBe("appStartMenuList");
  window.__vatioboardStartMenu?.setOpen?.(true, startButton);
  await settle();
  const startMenu = document.getElementById("appStartMenuList");
  expect(startMenu).toBeTruthy();
  expect(startMenu.hidden).toBe(false);
  expect(startMenu.querySelector(".app-start-menu-brand")).toBeTruthy();
  expect(startMenu.querySelector("[data-lang-toggle]")).toBeTruthy();
  expect(startMenu.querySelector("[data-backend-auth]")).toBeNull();
  expect(document.querySelector("[data-start-route='/board']")).toBeTruthy();
  expect(document.querySelector("[data-start-route='/replay']")).toBeTruthy();
  expect(document.querySelector("[data-start-route='/accel']")).toBeTruthy();
  expect(document.querySelector("[data-start-route='/library']")).toBeTruthy();
  expect(document.querySelector("[data-start-action]")).toBeTruthy();

  const accountButton = taskbar.querySelector("[data-vb-shell-account-button]");
  expect(accountButton).toBeTruthy();
  accountButton.click();
  await settle();
  const accountPanel = document.querySelector("[data-vb-account-panel]");
  const authForm = accountPanel?.querySelector("[data-backend-auth]");
  expect(accountPanel?.hidden).toBe(false);
  expect(authForm).toBeTruthy();
  expect(authForm.querySelector("[data-backend-auth-user]")).toBeTruthy();
  expect(authForm.querySelector("[data-backend-auth-login]")).toBeTruthy();
  expect(authForm.querySelector("[data-backend-auth-signup]")?.getAttribute("href")).toBe("https://www.vatiolibre.com/login#signup");
  expect(authForm.querySelector("[data-backend-auth-forgot]")?.getAttribute("href")).toBe("https://www.vatiolibre.com/login#forgot");
  window.__vatioboardStartMenu?.close?.();
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
  const snapshots = [{
    hash: "#/board",
    ...getRealSpaResourceSnapshot(),
  }];

  const routeSequence = sequence || ["#/board", targetHash, "#/board", targetHash];

  for (const hash of routeSequence.slice(1)) {
    await navigate(hash);
    await expectRouteUsable(hash);
    snapshots.push({
      hash,
      ...getRealSpaResourceSnapshot(),
    });
  }

  expect(document.querySelector(targetSelector)).toBeTruthy();
  expect(cloudSyncMocks.startCloudSyncLoop).toHaveBeenCalledTimes(1);
  expect(cloudSyncMocks.syncCloudRecords).not.toHaveBeenCalled();
  expect(lifecycleMocks.downloadMySyncPayloadRequests).toHaveLength(0);

  return {
    finalSnapshot: snapshots.at(-1),
    snapshots,
    targetSnapshots: snapshots.filter((snapshot) => snapshot.hash === targetHash),
  };
}
