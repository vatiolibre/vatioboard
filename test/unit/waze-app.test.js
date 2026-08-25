import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCleanupStack } from "../../src/app/view-cleanup.js";
import wazeTemplate from "../../src/apps/waze/waze-template.js";
import {
  WAZE_REFRESH_MIN_INTERVAL_MS,
  createWazeRouteController,
  getWazeEmbedUrl,
  getWazeZoomLevel,
  shouldRefreshWazeEmbed,
  unmountWazeRoute,
} from "../../src/apps/waze/waze-app.js";

const CONSENT_KEY = "vatioboard.welcome_consent.v1";

function storeConsent(locationChoice = "enabled") {
  localStorage.setItem(CONSENT_KEY, JSON.stringify({
    accepted: true,
    acceptedAtMs: Date.now(),
    locationChoice,
    version: 1,
  }));
}

function makePosition(overrides = {}) {
  return {
    latitude: 40.7484,
    longitude: -73.9857,
    accuracy: 5,
    altitudeM: 10,
    altitudeAccuracyM: 4,
    speedMs: 10,
    heading: 12,
    headingDeg: 12,
    timestampMs: 1_000_000,
    receivedAtMs: 1_000_000,
    stale: false,
    ...overrides,
  };
}

function makeAlertSnapshot(overrides = {}) {
  return {
    status: "active",
    started: true,
    currentSpeedMs: 10,
    latestPosition: makePosition(),
    alertUiState: {
      enabled: true,
      limitDisplayValue: 30,
      deltaDisplayValue: 0,
      over: false,
      near: false,
      source: "manual",
      trapActive: false,
    },
    preferences: { unit: "mph" },
    ...overrides,
  };
}

function createRoot() {
  const root = document.createElement("main");
  root.innerHTML = wazeTemplate;
  document.body.append(root);
  return root;
}

function createContext({ drivingAlertService = null, gpsService = null } = {}) {
  return {
    root: createRoot(),
    context: {},
    cleanup: createCleanupStack(),
    drivingAlertService,
    gpsService,
    translate: (_key, fallback) => fallback,
  };
}

describe("Waze route app", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    storeConsent();
  });

  afterEach(() => {
    unmountWazeRoute();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("derives stable Waze zoom levels and embed URLs", () => {
    expect(getWazeZoomLevel(2)).toBe(15);
    expect(getWazeZoomLevel(20 / 3.6)).toBe(14);
    expect(getWazeZoomLevel(60 / 3.6)).toBe(13);
    expect(getWazeZoomLevel(120 / 3.6)).toBe(12);

    const url = getWazeEmbedUrl(40.7484, -73.9857, 60 / 3.6);
    expect(url).toContain("zoom=13");
    expect(url).toContain("lat=40.748400");
    expect(url).toContain("lon=-73.985700");
  });

  it("uses the Waze mark in both the permission surface and live HUD", () => {
    const root = createRoot();
    expect(root.querySelector(".waze-placeholder-icon svg")?.getAttribute("viewBox")).toBe("0 0 640 640");
    expect(root.querySelector(".waze-brand-icon svg")?.getAttribute("viewBox")).toBe("0 0 640 640");
    expect(root.querySelector("#wazeLocationPrompt")?.textContent.trim()).toBe("Enable");
    expect(root.querySelector("#wazeLocationPrompt")?.getAttribute("aria-label")).toBe("Enable Waze location");
    expect(root.querySelector("#wazeRecenter")?.textContent.trim()).toBe("Refresh");
    expect(root.querySelector("#wazeRecenter")?.getAttribute("aria-label")).toBe("Refresh map");
    root.remove();
  });

  it("marks recentering stale only after both time and distance thresholds", () => {
    const center = { latitude: 40.7484, longitude: -73.9857, timestampMs: 1_000_000 };
    expect(shouldRefreshWazeEmbed(center, makePosition({
      latitude: 40.752,
      timestampMs: 1_000_000 + WAZE_REFRESH_MIN_INTERVAL_MS - 1,
    }))).toBe(false);
    expect(shouldRefreshWazeEmbed(center, makePosition({
      latitude: 40.7485,
      timestampMs: 1_000_000 + WAZE_REFRESH_MIN_INTERVAL_MS,
    }))).toBe(false);
    expect(shouldRefreshWazeEmbed(center, makePosition({
      latitude: 40.752,
      timestampMs: 1_000_000 + WAZE_REFRESH_MIN_INTERVAL_MS,
    }))).toBe(true);
  });

  it("renders the shared alert snapshot and stops only a route-owned alert session", () => {
    const stopped = vi.fn();
    const initial = makeAlertSnapshot({ started: false, status: "idle", latestPosition: null });
    const started = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => initial),
      start: vi.fn(() => started),
      stop: stopped,
      subscribe: vi.fn((listener) => {
        listener(started);
        return vi.fn();
      }),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.start).toHaveBeenCalledWith({ fromUserGesture: false, reason: "waze-route" });
    expect(context.root.querySelector("#wazeFrame").src).toContain("embed.waze.com/iframe");
    expect(context.root.querySelector("#wazeSpeedValue").textContent).toBe("22");
    expect(context.root.querySelector("#wazeSpeedUnit").textContent).toBe("mph");
    expect(context.root.querySelector("#wazeSpeedLimitValue").textContent).toBe("30 mph");

    controller.destroy();
    expect(stopped).toHaveBeenCalledWith({ reason: "waze-route-unmount" });
    context.cleanup.run();
  });

  it("moves from the loading placeholder to the ready iframe state", () => {
    const snapshot = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => ({ ...snapshot, started: false })),
      start: vi.fn(() => snapshot),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);
    const app = context.root.querySelector("[data-waze-app]");
    const frame = context.root.querySelector("#wazeFrame");
    const placeholder = context.root.querySelector("#wazePlaceholder");

    expect(app.classList.contains("is-loading")).toBe(true);
    expect(placeholder.classList.contains("is-hidden")).toBe(false);
    frame.dispatchEvent(new Event("load"));
    expect(app.classList.contains("is-loading")).toBe(false);
    expect(app.classList.contains("is-ready")).toBe(true);
    expect(placeholder.classList.contains("is-hidden")).toBe(true);

    controller.destroy();
    context.cleanup.run();
  });

  it("preserves a driving-alert session that was already active", () => {
    const snapshot = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => snapshot),
      start: vi.fn(() => snapshot),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.start).not.toHaveBeenCalled();
    controller.destroy();
    expect(service.stop).not.toHaveBeenCalled();
    context.cleanup.run();
  });

  it("uses a pre-existing alert session without bypassing skipped location consent", () => {
    storeConsent("skipped");
    const snapshot = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => snapshot),
      start: vi.fn(() => snapshot),
      stop: vi.fn(),
      subscribe: vi.fn((listener) => {
        listener(snapshot);
        return vi.fn();
      }),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.start).not.toHaveBeenCalled();
    expect(context.root.querySelector("#wazeFrame").src).toContain("embed.waze.com/iframe");
    controller.destroy();
    expect(service.stop).not.toHaveBeenCalled();
    context.cleanup.run();
  });

  it("defers GPS after skipped consent and starts it from the location action", () => {
    storeConsent("skipped");
    const started = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => makeAlertSnapshot({ started: false, latestPosition: null })),
      start: vi.fn(() => started),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.start).not.toHaveBeenCalled();
    expect(context.root.querySelector("#wazePlaceholderText").textContent).toContain("Enable location");
    context.root.querySelector("#wazeLocationPrompt").click();
    expect(service.start).toHaveBeenCalledWith({ fromUserGesture: true, reason: "waze-route-user" });
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY))).toMatchObject({ locationChoice: "enabled" });

    controller.destroy();
    context.cleanup.run();
  });

  it("falls back to the shared GPS service and releases its consumer", () => {
    const releaseConsumer = vi.fn();
    const unsubscribe = vi.fn();
    const position = makePosition();
    const gpsService = {
      startConsumer: vi.fn(() => releaseConsumer),
      subscribe: vi.fn((listener) => {
        listener({ status: "active", normalized: position });
        return unsubscribe;
      }),
      getCurrentPosition: vi.fn(() => position),
      getSnapshot: vi.fn(() => ({ status: "active", normalized: position })),
    };
    const context = createContext({ gpsService });
    const controller = createWazeRouteController(context);

    expect(gpsService.startConsumer).toHaveBeenCalledWith("vatio.waze.route", {
      enableHighAccuracy: true,
      reason: "waze-route",
    });
    expect(context.root.querySelector("#wazeFrame").src).toContain("embed.waze.com/iframe");
    controller.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(releaseConsumer).toHaveBeenCalledTimes(1);
    context.cleanup.run();
  });
});
