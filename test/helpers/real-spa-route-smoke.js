import { expect, vi } from "vitest";
import { bootHtmlPage, flushTasks } from "./page-smoke.js";

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
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
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  installBrowserStubs();
}

async function settle(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

async function bootSpa(hash = "#/board") {
  await bootHtmlPage("index.html");
  window.history.replaceState({}, "", `https://vatioboard.com/${hash}`);
  window.__vatioboardSpa = true;
  activeView = null;
  activeRouteController = null;
  await navigate(hash);
}

const routeViews = {
  "#/board": () => import("../../src/app/views/BoardView.js"),
  "#/speed": () => import("../../src/app/views/SpeedView.js"),
  "#/replay": () => import("../../src/app/views/ReplayView.js"),
  "#/accel": () => import("../../src/app/views/AccelView.js"),
  "#/library": () => import("../../src/app/views/LibraryView.js"),
};

let activeView = null;
let activeRouteController = null;

async function navigate(hash) {
  activeRouteController?.abort();
  activeView?.unmount?.();
  activeView = null;
  activeRouteController = new AbortController();
  window.location.hash = hash;
  const loaded = await routeViews[hash]();
  activeView = await loaded.mount(document.getElementById("app-view"), {
    route: { path: hash.replace(/^#/, "") },
    routeSignal: activeRouteController.signal,
    navigate: vi.fn(),
    emitRouteVisible: vi.fn(),
  });
  await settle(24);
}

export async function expectRealSpaRouteRemount({ targetHash, targetSelector }) {
  await bootSpa("#/board");
  expect(document.querySelector("#pad")).toBeTruthy();

  await navigate(targetHash);
  expect(document.querySelector(targetSelector)).toBeTruthy();

  await navigate("#/board");
  expect(document.querySelector("#pad")).toBeTruthy();

  await navigate(targetHash);
  expect(document.querySelector(targetSelector)).toBeTruthy();
}
