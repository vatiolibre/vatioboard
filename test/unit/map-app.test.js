import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const snapshot = {
    cameraStatus: { status: "ready" },
    decision: { distanceM: 240, state: "ahead" },
  };
  const widget = {
    cycleOrientationMode: vi.fn(() => "heading-up"),
    destroy: vi.fn(),
    focusCurrentLocation: vi.fn(),
    getApproachSnapshot: vi.fn(() => snapshot),
    getSessionState: vi.fn(() => ({ view: { center: [-73.9, 40.7], zoom: 13 }, presentationMode: "3d" })),
    refresh: vi.fn(async () => ({ status: "ready" })),
    resumeFollow: vi.fn(() => true),
    retry: vi.fn(async () => true),
    setPresentationMode: vi.fn(),
    subscribeStatus: vi.fn((listener) => {
      listener(snapshot);
      return vi.fn();
    }),
    updatePosition: vi.fn(),
  };
  const hud = {
    destroy: vi.fn(),
    render: vi.fn(),
  };
  return {
    hud,
    snapshot,
    widget,
    createMapRenderer: vi.fn(() => widget),
    createDrivingHud: vi.fn(() => hud),
  };
});

vi.mock("../../src/apps/map/map-renderer.js", () => ({
  createMapRenderer: mocks.createMapRenderer,
}));

vi.mock("../../src/shared/driving-hud.js", () => ({
  createDrivingHud: mocks.createDrivingHud,
}));

import { APP_CONTROL_STORAGE_KEY } from "../../src/app-platform/app-control-storage.js";
import { appRegistry } from "../../src/app-platform/index.js";
import { mapAppManifest } from "../../src/apps/map/manifest.js";
import { mountMapRoute, unmountMapRoute } from "../../src/apps/map/map-app.js";
import mapTemplate from "../../src/apps/map/map-template.js";
import { createCleanupStack } from "../../src/app/view-cleanup.js";

function createRuntime() {
  return {
    appId: "vatio.map",
    i18n: {
      apply: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      t: vi.fn((_key, fallback) => fallback),
    },
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    services: { settings: null, sharedSettings: null },
    shell: { openApp: vi.fn(() => true) },
  };
}

function mountMap() {
  const root = document.createElement("div");
  root.innerHTML = mapTemplate;
  document.body.append(root);
  const cleanup = createCleanupStack();
  const appRuntime = createRuntime();
  const view = mountMapRoute({
    root,
    cleanup,
    signal: new AbortController().signal,
    context: {},
    pageName: "map",
    appRuntime,
    gpsService: null,
    driveRecordingService: null,
    drivingTelemetryService: null,
    drivingAlertService: null,
    sharedSettingsService: null,
    translate: (_key, fallback) => fallback,
  });
  return { appRuntime, cleanup, root, view };
}

describe("full-screen Map app", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    vi.clearAllMocks();
    mocks.snapshot.cameraStatus = { status: "ready" };
    mocks.snapshot.decision = { distanceM: 240, state: "ahead" };
    mocks.snapshot.mapReady = true;
    mocks.snapshot.presentation = { mode: "2d", buildingsAvailable: false };
  });

  afterEach(() => {
    unmountMapRoute();
    vi.restoreAllMocks();
  });

  it("registers /map as a route and removes the old Camera Map shell app", () => {
    expect(mapAppManifest).toMatchObject({
      id: "vatio.map",
      route: "/map",
      surfaces: expect.arrayContaining(["main-route", "launcher", "start-menu"]),
    });
    expect(mapAppManifest.window).toBeUndefined();
    expect(appRegistry.getApp("vatio.map")).toBe(mapAppManifest);
    expect(appRegistry.getApp("vatio.cameraMap")).toBeNull();
  });

  it("mounts the camera renderer in route mode and creates the neutral driving HUD", () => {
    const { view } = mountMap();

    expect(mocks.createMapRenderer).toHaveBeenCalledWith(expect.objectContaining({
      routeMode: true,
      restoreVisibility: false,
      persistVisibility: false,
    }));
    expect(mocks.createDrivingHud).toHaveBeenCalledWith(expect.objectContaining({
      consumerId: "vatio.map.route",
      recordingSource: "map",
    }));
    expect(document.querySelector("[data-map-app]")?.dataset.mapStatus).toBe("ready");

    view.unmount();
    expect(mocks.widget.getSessionState).toHaveBeenCalledTimes(1);
    expect(mocks.widget.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.hud.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses telemetry as the renderer's single typed position source", () => {
    const telemetry = {
      getSnapshot: vi.fn(() => ({ lastPosition: { latitude: 40.7, longitude: -73.9 } })),
    };
    const root = document.createElement("div");
    root.innerHTML = mapTemplate;
    document.body.append(root);
    const cleanup = createCleanupStack();
    const appRuntime = createRuntime();
    mountMapRoute({
      root,
      cleanup,
      signal: new AbortController().signal,
      context: {},
      pageName: "map",
      appRuntime,
      gpsService: { id: "gps" },
      driveRecordingService: null,
      drivingTelemetryService: telemetry,
      drivingAlertService: null,
      sharedSettingsService: null,
      translate: (_key, fallback) => fallback,
    });

    expect(mocks.createMapRenderer).toHaveBeenCalledWith(expect.objectContaining({
      gpsService: null,
      externalPositionSource: true,
    }));
    expect(mocks.createDrivingHud).toHaveBeenCalledWith(expect.objectContaining({
      drivingTelemetry: telemetry,
    }));
    const hudOptions = mocks.createDrivingHud.mock.calls.at(-1)[0];
    const position = { sampleSequence: 3, latitude: 40.7, longitude: -73.9 };
    hudOptions.onPosition(position);
    expect(mocks.widget.updatePosition).toHaveBeenLastCalledWith(position, { source: "telemetry" });
  });

  it("switches 2D, 3D, and globe presentation without remounting the map", () => {
    const { root } = mountMap();
    root.querySelector("#mapPresentation").click();
    root.querySelector("[data-map-presentation-option='3d']").click();
    expect(root.querySelector("[data-map-app]")?.dataset.mapPresentation).toBe("3d");
    expect(mocks.widget.setPresentationMode).toHaveBeenLastCalledWith("3d");

    root.querySelector("#mapPresentation").click();
    root.querySelector("[data-map-presentation-option='globe']").click();
    expect(mocks.widget.setPresentationMode).toHaveBeenLastCalledWith("globe");
    expect(mocks.createMapRenderer).toHaveBeenCalledTimes(1);
  });

  it("keeps camera-data failures non-blocking once the basemap is ready", () => {
    mocks.snapshot.mapReady = true;
    mocks.snapshot.cameraStatus = { status: "unavailable" };
    const { root } = mountMap();

    expect(root.querySelector("[data-map-app]")?.dataset.mapStatus).toBe("degraded");
    expect(root.querySelector("#mapRouteStatus").hidden).toBe(true);
    expect(root.querySelector("#mapModeNotice").hidden).toBe(false);
  });

  it("reports camera loading after the map style becomes renderable", () => {
    mocks.snapshot.mapReady = true;
    mocks.snapshot.cameraStatus = { status: "loading-manifest" };
    const { root } = mountMap();

    expect(root.querySelector("[data-map-app]")?.dataset.mapStatus).toBe("loading-cameras");
    expect(root.querySelector("#mapRouteStatus").hidden).toBe(true);
  });

  it("copies legacy app-control state once without retaining a shell-window manifest", () => {
    localStorage.setItem(APP_CONTROL_STORAGE_KEY, JSON.stringify({
      version: 1,
      apps: {
        "vatio.cameraMap": {
          appId: "vatio.cameraMap",
          enabled: true,
          favorite: true,
          pinned: true,
          hiddenFromStartMenu: false,
        },
      },
    }));

    mountMap();
    const record = JSON.parse(localStorage.getItem(APP_CONTROL_STORAGE_KEY));
    expect(record.apps["vatio.map"]).toMatchObject({
      appId: "vatio.map",
      favorite: true,
      pinned: true,
    });
    expect(record.apps["vatio.cameraMap"]).toBeTruthy();
    expect(localStorage.getItem("vatioboard.map.migration.v1")).toBe("complete");
  });

  it("shows a recoverable route error and delegates Retry", async () => {
    mocks.snapshot.cameraStatus = { status: "unavailable" };
    mocks.snapshot.mapReady = false;
    const { root } = mountMap();
    expect(root.querySelector("#mapRouteStatus").hidden).toBe(false);

    root.querySelector("#mapRetry").click();
    await Promise.resolve();
    expect(mocks.widget.retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the map available when a valid viewport contains no cameras", () => {
    mocks.snapshot.cameraStatus = { status: "ready", featureCount: 0 };
    const { root } = mountMap();

    expect(root.querySelector("[data-map-app]")?.dataset.mapStatus).toBe("ready");
    expect(root.querySelector("#mapRouteStatus").hidden).toBe(true);
  });
});
