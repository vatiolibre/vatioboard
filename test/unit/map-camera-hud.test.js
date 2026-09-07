import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => {
  const statusListeners = new Set();
  const snapshot = {
    cameraStatus: { status: "ready" },
    decision: null,
    mapReady: true,
    presentation: { mode: "2d", buildingsAvailable: false },
  };
  const widget = {
    cycleOrientationMode: vi.fn(() => "north-up"),
    destroy: vi.fn(),
    focusCurrentLocation: vi.fn(),
    getApproachSnapshot: vi.fn(() => snapshot),
    getSessionState: vi.fn(() => null),
    refresh: vi.fn(async () => snapshot),
    resumeFollow: vi.fn(() => true),
    retry: vi.fn(async () => true),
    setPresentationMode: vi.fn(),
    subscribeStatus: vi.fn((listener) => {
      statusListeners.add(listener);
      listener(snapshot);
      return () => statusListeners.delete(listener);
    }),
    updatePosition: vi.fn(),
  };
  return {
    snapshot,
    widget,
    createMapRenderer: vi.fn(() => widget),
    publish() {
      for (const listener of statusListeners) listener(snapshot);
    },
    reset() {
      statusListeners.clear();
      snapshot.decision = null;
      vi.clearAllMocks();
    },
  };
});

vi.mock("../../src/apps/map/map-renderer.js", () => ({
  createMapRenderer: renderer.createMapRenderer,
}));

import { createCleanupStack } from "../../src/app/view-cleanup.js";
import { mountMapRoute, unmountMapRoute } from "../../src/apps/map/map-app.js";
import mapTemplate from "../../src/apps/map/map-template.js";

function createAlertService(nearestTrapDistanceM) {
  const snapshot = {
    status: "active",
    started: true,
    consumers: [],
    currentSpeedMs: 0,
    latestPosition: null,
    nearestTrapDistanceM,
    alertUiState: { enabled: false, trapActive: false },
    audio: { muted: true },
    preferences: { unit: "mph", distanceUnit: "ft", trapAlertEnabled: false },
  };
  return {
    acquireConsumer: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listener(snapshot);
      return vi.fn();
    }),
  };
}

function mountMap(nearestTrapDistanceM = 3379) {
  const root = document.createElement("div");
  root.innerHTML = mapTemplate;
  document.body.append(root);
  const drivingAlertService = createAlertService(nearestTrapDistanceM);
  const sharedSettingsService = {
    getAll: vi.fn(() => ({ speedUnit: "mph", distanceUnit: "ft", tripDistanceUnit: "mi" })),
    subscribe: vi.fn(() => vi.fn()),
  };
  const appRuntime = {
    i18n: { apply: vi.fn(), subscribe: vi.fn(() => vi.fn()), t: vi.fn((_key, fallback) => fallback) },
    services: { settings: null, sharedSettings: sharedSettingsService },
    shell: { openApp: vi.fn(() => true) },
  };
  const view = mountMapRoute({
    root,
    cleanup: createCleanupStack(),
    signal: new AbortController().signal,
    context: {},
    pageName: "map",
    appRuntime,
    gpsService: null,
    driveRecordingService: null,
    drivingTelemetryService: null,
    drivingAlertService,
    sharedSettingsService,
    translate: (_key, fallback) => fallback,
  });
  return { root, view };
}

describe("Map canonical nearest-camera HUD", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    renderer.reset();
  });

  afterEach(() => {
    unmountMapRoute();
    vi.restoreAllMocks();
  });

  it("does not require a renderer approach decision", () => {
    const { root } = mountMap();
    expect(renderer.snapshot.decision).toBeNull();
    expect(root.querySelector("[data-driving-camera-row]").hidden).toBe(false);
    expect(root.querySelector("[data-driving-camera-distance]").textContent).toBe("2.1 mi");
  });

  it("does not let viewport decisions remove or replace canonical proximity", () => {
    const { root } = mountMap();
    const distance = root.querySelector("[data-driving-camera-distance]");

    renderer.snapshot.decision = null;
    renderer.publish();
    expect(distance.textContent).toBe("2.1 mi");

    renderer.snapshot.decision = { distanceM: 25, state: "ahead" };
    renderer.publish();
    expect(distance.textContent).toBe("2.1 mi");

    renderer.snapshot.decision = null;
    renderer.publish();
    expect(distance.textContent).toBe("2.1 mi");
  });
});
