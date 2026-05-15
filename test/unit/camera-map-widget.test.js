import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cameraMapLessPath = `${process.cwd()}/src/styles/camera-map.less`;

const mapLibreDouble = vi.hoisted(() => {
  const maps = [];

  class FakeMap {
    constructor(options = {}) {
      this.options = options;
      this.handlers = {};
      this.sources = new Map();
      this.style = options.style || {};
      this.layers = [...(this.style.layers || [])];
      this.zoom = 8;
      this.bearing = 0;
      this.pitch = 0;
      this.resize = vi.fn();
      this.remove = vi.fn();
      this.easeTo = vi.fn((camera = {}) => {
        if (Number.isFinite(camera.zoom)) this.zoom = camera.zoom;
        if (Number.isFinite(camera.bearing)) this.bearing = camera.bearing;
        if (Number.isFinite(camera.pitch)) this.pitch = camera.pitch;
      });
      this.fitBounds = vi.fn();
      this.rotateTo = vi.fn((bearing) => {
        if (Number.isFinite(bearing)) this.bearing = bearing;
      });
      this.jumpTo = vi.fn((camera = {}) => {
        if (Number.isFinite(camera.zoom)) this.zoom = camera.zoom;
        if (Number.isFinite(camera.bearing)) this.bearing = camera.bearing;
        if (Number.isFinite(camera.pitch)) this.pitch = camera.pitch;
      });
      this.controls = [];
      this.addControl = vi.fn((control, position) => {
        this.controls.push({ control, position });
        return this;
      });
      this.projection = "mercator";
      this.getZoom = vi.fn(() => this.zoom);
      this.getCenter = vi.fn(() => ({ lng: -73.9, lat: 40.7 }));
      this.getBearing = vi.fn(() => this.bearing);
      this.getPitch = vi.fn(() => this.pitch);
      this.getBounds = vi.fn(() => ({
        getWest: () => -75,
        getSouth: () => 39,
        getEast: () => -72,
        getNorth: () => 42,
      }));
      this.getCanvas = vi.fn(() => ({ style: {} }));
      this.setProjection = vi.fn((projection) => {
        this.projection = typeof projection === "string" ? projection : projection?.type;
        return this;
      });
      this.getProjection = vi.fn(() => ({ type: this.projection }));
      this.setStyle = vi.fn((style, options = {}) => {
        this.style = style;
        this.styleOptions = options;
        this.sources.clear();
        for (const [id, config] of Object.entries(style.sources || {})) {
          this.sources.set(id, { id, config });
        }
        this.layers = [...(style.layers || [])];
        return this;
      });
      this.getStyle = vi.fn(() => this.style);
      for (const [id, config] of Object.entries(this.style.sources || {})) {
        this.sources.set(id, { id, config });
      }
      maps.push(this);
    }

    on(event, layerOrHandler, maybeHandler) {
      const handler = typeof layerOrHandler === "function" ? layerOrHandler : maybeHandler;
      (this.handlers[event] ??= []).push(handler);
      return this;
    }

    once(event, handler) {
      const wrapped = (...args) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    }

    off(event, handler) {
      this.handlers[event] = (this.handlers[event] || []).filter((candidate) => candidate !== handler);
      return this;
    }

    addSource(id, config) {
      const source = {
        id,
        config,
        setData: vi.fn(),
      };
      this.sources.set(id, source);
      return this;
    }

    getSource(id) {
      return this.sources.get(id) || null;
    }

    getLayer(id) {
      return this.layers.find((layer) => layer.id === id) || null;
    }

    addLayer(layer, beforeId) {
      if (this.getLayer(layer.id)) return this;
      const beforeIndex = beforeId ? this.layers.findIndex((candidate) => candidate.id === beforeId) : -1;
      if (beforeIndex >= 0) {
        this.layers.splice(beforeIndex, 0, layer);
      } else {
        this.layers.push(layer);
      }
      return this;
    }
  }

  class FakeNavigationControl {}
  class FakeAttributionControl {}
  class FakePopup {
    setLngLat = vi.fn(() => this);
    setHTML = vi.fn(() => this);
    addTo = vi.fn(() => this);
  }

  return {
    maps,
    module: {
      Map: FakeMap,
      NavigationControl: FakeNavigationControl,
      AttributionControl: FakeAttributionControl,
      Popup: FakePopup,
    },
  };
});

const dataSourceDouble = vi.hoisted(() => ({
  instances: [],
  loadViewport: vi.fn(async () => ({
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.9, 40.7] },
        properties: { country: "us" },
      },
    ],
    loadedCountries: ["us"],
    loadedTiles: [],
    skippedCountries: [],
    status: { status: "ready", featureCount: 1 },
  })),
}));

vi.mock("../../src/i18n.js", () => ({
  t: (key, params) => (params?.count !== undefined ? `${key}:${params.count}` : key),
}));

vi.mock("../../src/shared/maplibre-loader.js", () => ({
  loadMapLibre: vi.fn(() => Promise.resolve(mapLibreDouble.module)),
}));

vi.mock("../../src/speed/camera-map-data-source.js", () => ({
  createCameraMapDataSource: vi.fn((options = {}) => {
    const source = {
      destroy: vi.fn(),
      getStatus: vi.fn(() => ({ status: "idle", featureCount: 0 })),
      loadViewport: dataSourceDouble.loadViewport,
      options,
    };
    dataSourceDouble.instances.push(source);
    return source;
  }),
}));

async function flushTimers() {
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
  await Promise.resolve();
}

async function openAndLoad(widget) {
  widget.open();
  await flushTimers();
  const map = mapLibreDouble.maps.at(-1);
  for (const handler of [...(map.handlers.load || [])]) handler();
  await Promise.resolve();
  await Promise.resolve();
  return map;
}

function fireMapEvent(map, eventName) {
  for (const handler of [...(map.handlers[eventName] || [])]) handler();
}

function latestSourceData(map, sourceId) {
  const source = map.getSource(sourceId);
  const calls = source?.setData?.mock?.calls || [];
  return calls.at(-1)?.[0] || source?.config?.data || null;
}

function getLayerButton() {
  return document.querySelector(".camera-map-layer-button");
}

function chooseLayer(layerId) {
  const layerButton = getLayerButton();
  layerButton.click();
  expect(document.querySelector(".camera-map-layer-menu").hidden).toBe(false);
  document.querySelector(`.camera-map-layer-option[data-layer-id="${layerId}"]`).click();
}

function stubPanelRect(panel, { left = 20, top = 24, width = 520, height = 420 } = {}) {
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
  panel.getBoundingClientRect = () => {
    const nextWidth = Number.parseInt(panel.style.width, 10) || width;
    const nextHeight = Number.parseInt(panel.style.height, 10) || height;
    const nextLeft = Number.parseInt(panel.style.left, 10) || left;
    const nextTop = Number.parseInt(panel.style.top, 10) || top;
    return {
      left: nextLeft,
      top: nextTop,
      right: nextLeft + nextWidth,
      bottom: nextTop + nextHeight,
      width: nextWidth,
      height: nextHeight,
      x: nextLeft,
      y: nextTop,
      toJSON() {},
    };
  };
}

function createColorSchemeMatchMedia(initialMatches = false) {
  let matches = initialMatches;
  const listeners = new Set();
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((event, listener) => {
      if (event === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((event, listener) => {
      if (event === "change") listeners.delete(listener);
    }),
    addListener: vi.fn((listener) => listeners.add(listener)),
    removeListener: vi.fn((listener) => listeners.delete(listener)),
    dispatchEvent: vi.fn(),
  };

  return {
    matchMedia: vi.fn(() => mediaQueryList),
    mediaQueryList,
    setMatches(nextMatches) {
      matches = nextMatches;
      for (const listener of [...listeners]) {
        listener({ matches, media: mediaQueryList.media });
      }
    },
  };
}

describe("createCameraMapWidget", () => {
  let createCameraMapWidget;
  let createShellWindowManager;
  let loadMapLibre;
  let originalRequestFullscreen;
  let originalExitFullscreen;
  let originalMatchMedia;

  beforeEach(async () => {
    vi.useFakeTimers();
    originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    originalExitFullscreen = document.exitFullscreen;
    originalMatchMedia = globalThis.matchMedia;
    document.body.innerHTML = "";
    delete window.__vatioboardSpeedGetCurrentPosition;
    localStorage.clear();
    mapLibreDouble.maps.length = 0;
    dataSourceDouble.instances.length = 0;
    dataSourceDouble.loadViewport.mockReset();
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-73.9, 40.7] },
          properties: { country: "us" },
        },
      ],
      loadedCountries: ["us"],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 1 },
    }));
    vi.resetModules();
    ({ loadMapLibre } = await import("../../src/shared/maplibre-loader.js"));
    ({ createShellWindowManager } = await import("../../src/shared/shell-window-manager.js"));
    ({ createCameraMapWidget } = await import("../../src/speed/camera-map-widget.js"));
  });

  afterEach(() => {
    HTMLElement.prototype.requestFullscreen = originalRequestFullscreen;
    document.exitFullscreen = originalExitFullscreen;
    if (originalMatchMedia === undefined) {
      delete globalThis.matchMedia;
    } else {
      globalThis.matchMedia = originalMatchMedia;
    }
    delete window.__vatioboardSpeedGetCurrentPosition;
    vi.useRealTimers();
  });

  it("creates a hidden shell-registered camera map panel", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });

    const panel = document.querySelector(".camera-map-panel");
    expect(panel).not.toBeNull();
    expect(panel.hidden).toBe(true);
    expect(manager.getWindow("camera-map")).toMatchObject({
      id: "camera-map",
      title: "Camera Map",
      capabilities: expect.objectContaining({ fullscreen: true }),
    });

    widget.destroy();
    manager.destroy();
  });

  it("uses a map-first layout with compact overlays", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });

    const body = document.querySelector(".camera-map-body");
    const mapContainer = document.querySelector(".camera-map-container");
    const topOverlay = document.querySelector(".camera-map-overlay--top");
    const navOverlay = document.querySelector(".camera-map-overlay--nav");
    const bottomOverlay = document.querySelector(".camera-map-overlay--bottom");

    expect(body).not.toBeNull();
    expect(mapContainer.parentElement).toBe(body);
    expect(topOverlay).not.toBeNull();
    expect(navOverlay).not.toBeNull();
    expect(bottomOverlay).not.toBeNull();
    expect(topOverlay.contains(document.querySelector(".camera-map-status"))).toBe(true);
    expect(topOverlay.contains(document.querySelector(".camera-map-layer-control"))).toBe(false);
    expect(navOverlay.contains(document.querySelector(".camera-map-follow-toggle"))).toBe(true);
    expect(navOverlay.contains(document.querySelector(".camera-map-orientation-toggle"))).toBe(true);
    expect(navOverlay.contains(document.querySelector(".camera-map-refresh"))).toBe(true);
    expect(navOverlay.contains(document.querySelector(".camera-map-layer-button"))).toBe(true);
    expect(navOverlay.contains(document.querySelector(".camera-map-layer-menu"))).toBe(true);
    expect(bottomOverlay.contains(document.querySelector(".camera-map-attribution"))).toBe(true);
    expect(bottomOverlay.contains(document.querySelector(".camera-map-privacy"))).toBe(true);
    expect(document.querySelector(".camera-map-toolbar")).toBeNull();
    expect(document.querySelector(".camera-map-footer")).toBeNull();
    expect(document.querySelector(".camera-map-layer-select")).toBeNull();
    expect(document.querySelector(".camera-map-layer-control").tagName).toBe("DIV");
    expect(document.querySelector(".camera-map-minimize")).toBeNull();
    expect(document.querySelector(".camera-map-resize-handle").tagName).toBe("BUTTON");
    expect(document.querySelector(".camera-map-resize-handle").getAttribute("aria-label")).toBe("cameraMapResize");
    expect(Array.from(document.querySelectorAll(".camera-map-actions .camera-map-action"))
      .map((button) => button.className)).toEqual([
      "camera-map-action camera-map-fullscreen",
      "camera-map-action camera-map-close",
    ]);

    widget.destroy();
    manager.destroy();
  });

  it("styles the layer picker as a custom touch target with light and dark contrast", () => {
    const css = readFileSync(cameraMapLessPath, "utf8");

    expect(css).toContain("--camera-map-overlay-text: #111827;");
    expect(css).toContain("--camera-map-overlay-text: #f9fafb;");
    expect(css).not.toContain(".camera-map-layer-select");
    expect(css).toContain(".camera-map-layer-button");
    expect(css).toContain(".camera-map-layer-menu");
    expect(css).toContain(".camera-map-layer-option");
    expect(css).toContain(".camera-map-overlay--nav");
    expect(css).toContain(".camera-map-nav-controls");
    expect(css).toContain("bottom: calc(72px + env(safe-area-inset-bottom, 0px));");
    expect(css).toContain("width: 44px;");
    expect(css).toContain("max-width: 44px;");
    expect(css).toContain("clip: rect(0 0 0 0);");
    expect(css).toContain("min-height: 44px;");
    expect(css).toContain("touch-action: manipulation;");
    expect(css).toContain("pointer-events: auto;");
    expect(css).toContain("-webkit-tap-highlight-color: transparent;");
    expect(css).toContain(".camera-map-resize-handle");
    expect(css).toContain("width: 48px;");
    expect(css).toContain("height: 48px;");
    expect(css).toContain("touch-action: none;");
    expect(css).toContain("cursor: nwse-resize;");
  });

  it("opens the layer menu without relying on a native dropdown", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const layerButton = getLayerButton();
    const layerMenu = document.querySelector(".camera-map-layer-menu");

    expect(document.querySelector(".camera-map-layer-select")).toBeNull();
    expect(layerButton.getAttribute("aria-haspopup")).toBe("listbox");
    expect(layerButton.getAttribute("aria-expanded")).toBe("false");
    expect(layerMenu.hidden).toBe(true);

    layerButton.click();

    expect(layerButton.getAttribute("aria-expanded")).toBe("true");
    expect(layerMenu.hidden).toBe(false);
    expect(Array.from(layerMenu.querySelectorAll(".camera-map-layer-option")).map((option) => option.dataset.layerId))
      .toEqual([
        "auto",
        "carto-voyager",
        "osm-standard",
        "carto-positron",
        "carto-dark-matter",
        "opentopomap",
        "esri-world-imagery",
      ]);

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(layerButton.getAttribute("aria-expanded")).toBe("false");
    expect(layerMenu.hidden).toBe(true);

    layerButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(layerButton.getAttribute("aria-expanded")).toBe("true");
    expect(layerMenu.hidden).toBe(false);
    expect(document.activeElement).toBe(layerMenu.querySelector(".camera-map-layer-option.is-active"));

    layerMenu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(layerButton.getAttribute("aria-expanded")).toBe("false");
    expect(layerMenu.hidden).toBe(true);
    expect(document.activeElement).toBe(layerButton);

    widget.destroy();
    manager.destroy();
  });

  it("initializes MapLibre lazily on first open", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });

    expect(loadMapLibre).not.toHaveBeenCalled();
    widget.open();
    await flushTimers();

    expect(loadMapLibre).toHaveBeenCalledTimes(1);
    expect(mapLibreDouble.maps).toHaveLength(1);

    widget.destroy();
    manager.destroy();
  });

  it("keeps app controls out of the MapLibre top-right navigation control area", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    expect(map.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ position: "top-right" }),
    ]));
    expect(document.querySelector(".camera-map-overlay--top .camera-map-layer-control")).toBeNull();
    expect(document.querySelector(".camera-map-overlay--top .camera-map-follow-toggle")).toBeNull();
    expect(document.querySelector(".camera-map-overlay--nav .camera-map-layer-control")).not.toBeNull();
    expect(document.querySelector(".camera-map-overlay--nav .camera-map-follow-toggle")).not.toBeNull();

    widget.destroy();
    manager.destroy();
  });

  it("configures only attributed legal basemap providers", async () => {
    const { CAMERA_MAP_BASEMAPS } = await import("../../src/speed/camera-map-layers.js");
    const disallowedProviders = /google|gstatic|apple|waze|mapbox/i;

    expect(CAMERA_MAP_BASEMAPS.length).toBeGreaterThan(0);
    for (const basemap of CAMERA_MAP_BASEMAPS) {
      expect(basemap).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        attribution: expect.any(String),
      });
      expect(basemap.tiles).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(basemap.attribution.trim()).not.toBe("");
      expect(basemap.tiles.join(" ")).not.toMatch(disallowedProviders);
    }
  });

  it("applies the default basemap on first map creation", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    expect(map.options.style.sources["camera-map-basemap"].tiles[0]).toContain("basemaps.cartocdn.com");
    expect(map.options.style.sources["camera-map-basemap"].tiles[0]).toContain("voyager");
    expect(getLayerButton().dataset.layerId).toBe("auto");

    widget.destroy();
    manager.destroy();
  });

  it("adds user position source and layers after map load", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    const layerIds = map.layers.map((layer) => layer.id);

    expect(map.getSource("camera-map-user-position")).not.toBeNull();
    expect(layerIds).toEqual(expect.arrayContaining([
      "camera-map-user-accuracy",
      "camera-map-user-glow",
      "camera-map-user-dot",
      "camera-map-user-heading-arrow",
    ]));
    expect(map.getLayer("camera-map-user-heading-arrow").filter).toEqual(["==", ["get", "headingAvailable"], true]);

    widget.destroy();
    manager.destroy();
  });

  it("auto-enters drive navigation with the Speed provider when GPS is available", async () => {
    window.__vatioboardSpeedGetCurrentPosition = () => ({
      latitude: 40.7,
      longitude: -73.9,
      accuracy: 5,
      headingDeg: 44,
      speedMs: 7,
      timestampMs: Date.now(),
    });
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    try {
      const map = await openAndLoad(widget);

      expect(widget.getNavigationState()).toMatchObject({
        followEnabled: true,
        followPaused: false,
        navigationMode: "drive",
        orientationMode: "heading-up",
      });
      expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
        center: [-73.9, 40.7],
        bearing: 44,
        offset: expect.arrayContaining([0, expect.any(Number)]),
      }));
      expect(widget.getNavigationState().latestBearingApplied).toBe(44);
    } finally {
      widget.destroy();
      manager.destroy();
      delete window.__vatioboardSpeedGetCurrentPosition;
    }
  });

  it("stays in browse mode without a Speed provider and reports GPS unavailable on follow", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);

    expect(widget.getNavigationState()).toMatchObject({
      followEnabled: false,
      navigationMode: "browse",
    });

    document.querySelector(".camera-map-follow-toggle").click();

    expect(widget.getNavigationState()).toMatchObject({
      followEnabled: false,
      navigationMode: "browse",
    });
    expect(document.querySelector(".camera-map-status").dataset.status).toBe("gps-unavailable");

    widget.destroy();
    manager.destroy();
  });

  it("updates the user position source with GPS heading", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    const feature = widget.updatePosition({
      latitude: 40.7,
      longitude: -73.9,
      heading: 92,
      speedMs: 8,
      timestampMs: 1000,
    }, { now: 1000 });
    const data = latestSourceData(map, "camera-map-user-position");

    expect(feature.properties).toMatchObject({ heading: 92, headingAvailable: true, stale: false });
    expect(data.features[0].geometry.coordinates).toEqual([-73.9, 40.7]);
    expect(data.features[0].properties.heading).toBe(92);

    widget.destroy();
    manager.destroy();
  });

  it("accepts the Speed provider headingDeg shape for heading-up follow", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    let position = {
      latitude: 40.7,
      longitude: -73.9,
      accuracy: 4,
      headingDeg: 123,
      speedMs: 8,
      timestampMs: 1000,
    };
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({
      shellManager: manager,
      restoreVisibility: false,
      getCurrentPosition: () => position,
    });
    const map = await openAndLoad(widget);
    map.easeTo.mockClear();

    position = { ...position, latitude: 40.7005, timestampMs: 2000 };
    widget.updatePosition(position, { now: 2000 });

    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 123 }));
    expect(latestSourceData(map, "camera-map-user-position").features[0].properties.heading).toBe(123);

    widget.destroy();
    manager.destroy();
  });

  it("uses the Speed shell global provider shape for heading-up follow", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    window.__vatioboardSpeedGetCurrentPosition = () => ({
      latitude: 40.7,
      longitude: -73.9,
      accuracy: 5,
      headingDeg: 123,
      speedMs: 8,
      timestampMs: 1000,
    });
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    try {
      const map = await openAndLoad(widget);
      map.easeTo.mockClear();

      widget.updatePosition(undefined, { now: 1000 });

      expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 123 }));
    } finally {
      widget.destroy();
      manager.destroy();
      delete window.__vatioboardSpeedGetCurrentPosition;
    }
  });

  it("receives GPS from an injected app GPS service without Speed mounted", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    const gpsListeners = new Set();
    let gpsPosition = {
      latitude: 40.7,
      longitude: -73.9,
      headingDeg: 30,
      speedMs: 7,
      timestampMs: Date.now(),
    };
    const gpsService = {
      getCurrentPosition: vi.fn(() => gpsPosition),
      startConsumer: vi.fn(() => vi.fn()),
      subscribe: vi.fn((listener) => {
        gpsListeners.add(listener);
        listener({ normalized: gpsPosition });
        return () => gpsListeners.delete(listener);
      }),
    };
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false, gpsService });
    const map = await openAndLoad(widget);
    map.easeTo.mockClear();

    gpsPosition = {
      latitude: 40.701,
      longitude: -73.901,
      headingDeg: 66,
      speedMs: 9,
      timestampMs: Date.now(),
    };
    for (const listener of gpsListeners) listener({ normalized: gpsPosition });

    expect(gpsService.startConsumer).toHaveBeenCalledWith("camera-map", expect.objectContaining({
      enableHighAccuracy: true,
    }));
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [-73.901, 40.701],
      bearing: expect.closeTo(46.56, 2),
    }));
    expect(latestSourceData(map, "camera-map-user-position").features[0].geometry.coordinates).toEqual([-73.901, 40.701]);

    widget.destroy();
    manager.destroy();
  });

  it("updates from gpsService when normalized timestampMs is old but receivedAtMs is fresh", async () => {
    vi.setSystemTime(12000);
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    const gpsListeners = new Set();
    let gpsPosition = {
      latitude: 40.7,
      longitude: -73.9,
      headingDeg: 90,
      speedMs: 8,
      timestampMs: 1000,
      receivedAtMs: 12000,
      lastCallbackAtMs: 12000,
    };
    const gpsService = {
      getCurrentPosition: vi.fn(() => gpsPosition),
      startConsumer: vi.fn(() => vi.fn()),
      subscribe: vi.fn((listener) => {
        gpsListeners.add(listener);
        listener({ normalized: gpsPosition });
        return () => gpsListeners.delete(listener);
      }),
    };
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false, gpsService });
    const map = await openAndLoad(widget);
    map.easeTo.mockClear();

    vi.setSystemTime(13000);
    gpsPosition = {
      latitude: 40.701,
      longitude: -73.901,
      headingDeg: 100,
      speedMs: 8,
      timestampMs: 1000,
      receivedAtMs: 13000,
      lastCallbackAtMs: 13000,
    };
    for (const listener of gpsListeners) listener({ normalized: gpsPosition });

    const feature = latestSourceData(map, "camera-map-user-position").features[0];
    expect(feature.properties.stale).toBe(false);
    expect(feature.geometry.coordinates).toEqual([-73.901, 40.701]);
    expect(document.querySelector(".camera-map-status").dataset.status).not.toBe("gps-stale");
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [-73.901, 40.701],
    }));

    widget.destroy();
    manager.destroy();
  });

  it("handles vatioboard:gps-position detail as normalized and as { normalized }", async () => {
    vi.setSystemTime(12000);
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    window.dispatchEvent(new CustomEvent("vatioboard:gps-position", {
      detail: {
        latitude: 40.71,
        longitude: -73.91,
        headingDeg: 80,
        speedMs: 7,
        timestampMs: 1000,
        receivedAtMs: 12000,
      },
    }));

    let feature = latestSourceData(map, "camera-map-user-position").features[0];
    expect(feature.geometry.coordinates).toEqual([-73.91, 40.71]);
    expect(feature.properties.stale).toBe(false);

    vi.setSystemTime(13000);
    window.dispatchEvent(new CustomEvent("vatioboard:gps-position", {
      detail: {
        normalized: {
          latitude: 40.72,
          longitude: -73.92,
          headingDeg: 95,
          speedMs: 8,
          timestampMs: 1000,
          receivedAtMs: 13000,
        },
      },
    }));

    feature = latestSourceData(map, "camera-map-user-position").features[0];
    expect(feature.geometry.coordinates).toEqual([-73.92, 40.72]);
    expect(feature.properties.stale).toBe(false);
    expect(document.querySelector(".camera-map-status").dataset.status).not.toBe("gps-stale");

    widget.destroy();
    manager.destroy();
  });

  it("does not leave heading-up follow GPS stale with Tesla-style timestamps", async () => {
    vi.setSystemTime(12000);
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    map.easeTo.mockClear();

    const feature = widget.updatePosition({
      latitude: 40.7,
      longitude: -73.9,
      headingDeg: 90,
      speedMs: 8,
      timestampMs: 1000,
      receivedAtMs: 12000,
    }, { now: 12000, source: "test" });

    expect(feature.properties.stale).toBe(false);
    expect(document.querySelector(".camera-map-status").dataset.status).toBe("following");
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [-73.9, 40.7],
      bearing: 90,
    }));

    widget.destroy();
    manager.destroy();
  });

  it("keeps the camera-map GPS consumer active while the panel is open", async () => {
    const stopConsumer = vi.fn();
    const gpsService = {
      getCurrentPosition: vi.fn(() => null),
      startConsumer: vi.fn(() => stopConsumer),
      subscribe: vi.fn(() => vi.fn()),
    };
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false, gpsService });
    await openAndLoad(widget);

    expect(gpsService.startConsumer).toHaveBeenCalledWith("camera-map", expect.objectContaining({
      enableHighAccuracy: true,
      reason: "camera-map-open",
    }));
    expect(stopConsumer).not.toHaveBeenCalled();

    widget.close();

    expect(stopConsumer).toHaveBeenCalledTimes(1);

    widget.destroy();
    manager.destroy();
  });

  it("derives user heading from movement when GPS heading is missing", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, timestampMs: 1000, speedMs: 4 }, { now: 1000 });
    widget.updatePosition({ latitude: 40.701, longitude: -73.9, timestampMs: 3000, speedMs: 4 }, { now: 3000 });
    const data = latestSourceData(map, "camera-map-user-position");

    expect(data.features[0].properties.headingAvailable).toBe(true);
    expect(data.features[0].properties.heading).toBeCloseTo(0, 0);

    widget.destroy();
    manager.destroy();
  });

  it("hides the heading arrow when heading is unavailable", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, timestampMs: 1000, speedMs: 0 }, { now: 20000 });
    const data = latestSourceData(map, "camera-map-user-position");

    expect(data.features[0].properties.headingAvailable).toBe(false);
    expect(map.getLayer("camera-map-user-heading-arrow").filter).toEqual(["==", ["get", "headingAvailable"], true]);

    widget.destroy();
    manager.destroy();
  });

  it("marks stale GPS and avoids follow movement", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    map.easeTo.mockClear();

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, heading: 90, timestampMs: 1000 }, { now: 12000 });
    const data = latestSourceData(map, "camera-map-user-position");

    expect(data.features[0].properties.stale).toBe(true);
    expect(document.querySelector(".camera-map-status").dataset.status).toBe("gps-stale");
    expect(map.easeTo).not.toHaveBeenCalled();

    widget.destroy();
    manager.destroy();
  });

  it("follows in north-up and heading-up modes", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "north-up");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    map.easeTo.mockClear();

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, heading: 123, speedMs: 6, timestampMs: 1000 }, { now: 1000 });
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 0 }));

    document.querySelector(".camera-map-orientation-toggle").click();
    map.easeTo.mockClear();
    widget.updatePosition({ latitude: 40.7005, longitude: -73.9, heading: 123, speedMs: 6, timestampMs: 2000 }, { now: 2000 });
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 123 }));

    widget.destroy();
    manager.destroy();
  });

  it("manual map movement pauses follow and the follow button resumes it", async () => {
    let position = { latitude: 40.7, longitude: -73.9, heading: 10, speedMs: 5, timestampMs: 1000 };
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({
      shellManager: manager,
      restoreVisibility: false,
      getCurrentPosition: () => position,
    });
    const map = await openAndLoad(widget);

    await vi.advanceTimersByTimeAsync(901);
    fireMapEvent(map, "dragstart");
    expect(widget.getNavigationState()).toMatchObject({ followEnabled: true, followPaused: true, navigationMode: "browse" });
    expect(document.querySelector(".camera-map-status").dataset.status).toBe("follow-paused");

    map.easeTo.mockClear();
    position = { latitude: 40.701, longitude: -73.9, heading: 15, speedMs: 5 };
    document.querySelector(".camera-map-follow-toggle").click();

    expect(widget.getNavigationState()).toMatchObject({ followEnabled: true, followPaused: false, navigationMode: "drive" });
    expect(map.easeTo).toHaveBeenCalled();

    widget.destroy();
    manager.destroy();
  });

  it("does not pause follow from programmatic navigation camera movement", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, heading: 20, speedMs: 6, timestampMs: 1000 }, { now: 1000 });
    fireMapEvent(map, "zoomstart");

    expect(map.easeTo).toHaveBeenCalled();
    expect(widget.getNavigationState()).toMatchObject({ followEnabled: true, followPaused: false, navigationMode: "drive" });

    widget.destroy();
    manager.destroy();
  });

  it("updates immediately from Speed position events without waiting for polling", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    map.easeTo.mockClear();

    window.dispatchEvent(new CustomEvent("vatioboard:speed-position", {
      detail: {
        latitude: 40.701,
        longitude: -73.901,
        headingDeg: 77,
        speedMs: 9,
        timestampMs: Date.now(),
      },
    }));

    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [-73.901, 40.701],
      bearing: 77,
    }));
    expect(latestSourceData(map, "camera-map-user-position").features[0].properties.heading).toBe(77);

    widget.destroy();
    manager.destroy();
  });

  it("keeps the previous heading-up bearing when heading becomes stale", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [],
      loadedCountries: [],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 0 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, headingDeg: 90, speedMs: 8, timestampMs: 1000 }, { now: 1000 });
    map.easeTo.mockClear();
    widget.updatePosition({ latitude: 40.7001, longitude: -73.9, speedMs: 0, timestampMs: 7000 }, { now: 7000 });

    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ bearing: 90 }));
    expect(widget.getNavigationState()).toMatchObject({
      latestBearingApplied: 90,
      lastCameraCommandReason: "heading-unavailable",
    });
    expect(document.querySelector(".camera-map-status").dataset.status).toBe("heading-unavailable");

    widget.destroy();
    manager.destroy();
  });

  it("frames the vehicle and a relevant camera without reloading data on GPS ticks", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [
        {
          type: "Feature",
          id: "ahead",
          geometry: { type: "Point", coordinates: [-73.9, 40.705] },
          properties: { country: "us" },
        },
      ],
      loadedCountries: ["us"],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 1 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    await widget.refresh();
    dataSourceDouble.loadViewport.mockClear();

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, heading: 0, speedMs: 8, timestampMs: 1000 }, { now: 1000 });

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [-73.9, 40.7],
      offset: expect.any(Array),
    }));
    expect(widget.getNavigationState().lastCameraCommandReason).toBe("camera-ahead");
    expect(dataSourceDouble.loadViewport).not.toHaveBeenCalled();

    widget.destroy();
    manager.destroy();
  });

  it("preserves heading-up bearing while framing a relevant camera", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    localStorage.setItem("vatioboard.cameraMap.orientation.v1", "heading-up");
    dataSourceDouble.loadViewport.mockImplementation(async () => ({
      features: [
        {
          type: "Feature",
          id: "east-ahead",
          geometry: { type: "Point", coordinates: [-73.895, 40.7] },
          properties: { country: "us" },
        },
      ],
      loadedCountries: ["us"],
      loadedTiles: [],
      skippedCountries: [],
      status: { status: "ready", featureCount: 1 },
    }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    await widget.refresh();
    map.fitBounds.mockClear();
    map.rotateTo.mockClear();
    map.easeTo.mockClear();

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, headingDeg: 90, speedMs: 8, timestampMs: 1000 }, { now: 1000 });

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.rotateTo).not.toHaveBeenCalled();
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      bearing: 90,
      offset: expect.any(Array),
    }));

    widget.destroy();
    manager.destroy();
  });

  it("uses the dark basemap by default when the browser is in dark mode", async () => {
    const colorScheme = createColorSchemeMatchMedia(true);
    globalThis.matchMedia = colorScheme.matchMedia;
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });

    expect(getLayerButton().dataset.layerId).toBe("auto");

    const map = await openAndLoad(widget);

    expect(map.options.style.sources["camera-map-basemap"].tiles[0]).toContain("dark_all");

    widget.destroy();
    manager.destroy();
  });

  it("tracks browser sunrise and sunset theme changes until the user picks a basemap", async () => {
    const { CAMERA_MAP_BASEMAP_STORAGE_KEY } = await import("../../src/speed/camera-map-layers.js");
    const colorScheme = createColorSchemeMatchMedia(false);
    globalThis.matchMedia = colorScheme.matchMedia;
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    const layerButton = getLayerButton();

    expect(layerButton.dataset.layerId).toBe("auto");
    expect(colorScheme.mediaQueryList.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    map.setStyle.mockClear();
    dataSourceDouble.loadViewport.mockClear();
    colorScheme.setMatches(true);

    expect(layerButton.dataset.layerId).toBe("auto");
    expect(localStorage.getItem(CAMERA_MAP_BASEMAP_STORAGE_KEY)).toBeNull();
    expect(map.setStyle).toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.objectContaining({
        "camera-map-basemap": expect.objectContaining({
          tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
        }),
      }),
    }), { diff: false });
    expect(dataSourceDouble.loadViewport).not.toHaveBeenCalled();

    fireMapEvent(map, "style.load");
    await Promise.resolve();

    map.setStyle.mockClear();
    chooseLayer("opentopomap");

    expect(localStorage.getItem(CAMERA_MAP_BASEMAP_STORAGE_KEY)).toBe("opentopomap");

    fireMapEvent(map, "style.load");
    await Promise.resolve();

    map.setStyle.mockClear();
    colorScheme.setMatches(false);

    expect(layerButton.dataset.layerId).toBe("opentopomap");
    expect(map.setStyle).not.toHaveBeenCalled();

    widget.destroy();

    expect(colorScheme.mediaQueryList.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    manager.destroy();
  });

  it("selecting Auto clears the stored basemap and restores theme-based switching", async () => {
    const { CAMERA_MAP_BASEMAP_STORAGE_KEY } = await import("../../src/speed/camera-map-layers.js");
    const colorScheme = createColorSchemeMatchMedia(false);
    globalThis.matchMedia = colorScheme.matchMedia;
    localStorage.setItem(CAMERA_MAP_BASEMAP_STORAGE_KEY, "opentopomap");
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    const layerButton = getLayerButton();

    expect(layerButton.dataset.layerId).toBe("opentopomap");

    map.setStyle.mockClear();
    chooseLayer("auto");

    expect(layerButton.dataset.layerId).toBe("auto");
    expect(localStorage.getItem(CAMERA_MAP_BASEMAP_STORAGE_KEY)).toBeNull();
    expect(map.setStyle).toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.objectContaining({
        "camera-map-basemap": expect.objectContaining({
          tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
        }),
      }),
    }), { diff: false });

    fireMapEvent(map, "style.load");
    await Promise.resolve();

    map.setStyle.mockClear();
    colorScheme.setMatches(true);

    expect(layerButton.dataset.layerId).toBe("auto");
    expect(map.setStyle).toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.objectContaining({
        "camera-map-basemap": expect.objectContaining({
          tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
        }),
      }),
    }), { diff: false });

    widget.destroy();
    manager.destroy();
  });

  it("close hides the panel without destroying the map", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    widget.close();

    expect(document.querySelector(".camera-map-panel").hidden).toBe(true);
    expect(map.remove).not.toHaveBeenCalled();

    widget.destroy();
    manager.destroy();
  });

  it("close and minimize stop live position polling", async () => {
    const getCurrentPosition = vi.fn(() => ({ latitude: 40.7, longitude: -73.9, timestampMs: Date.now() }));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false, getCurrentPosition });
    const map = await openAndLoad(widget);

    getCurrentPosition.mockClear();
    map.easeTo.mockClear();
    widget.close();
    window.dispatchEvent(new CustomEvent("vatioboard:speed-position", {
      detail: { latitude: 40.8, longitude: -73.8, headingDeg: 90, speedMs: 8, timestampMs: Date.now() },
    }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();

    widget.open();
    await flushTimers();
    getCurrentPosition.mockClear();
    map.easeTo.mockClear();
    widget.minimize();
    window.dispatchEvent(new CustomEvent("vatioboard:speed-position", {
      detail: { latitude: 40.8, longitude: -73.8, headingDeg: 90, speedMs: 8, timestampMs: Date.now() },
    }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();

    widget.destroy();
    manager.destroy();
  });

  it("destroy removes the map and data source", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    const source = dataSourceDouble.instances[0];

    widget.destroy();

    expect(map.remove).toHaveBeenCalled();
    expect(source.destroy).toHaveBeenCalled();
    expect(document.querySelector(".camera-map-panel")).toBeNull();
    manager.destroy();
  });

  it("clicking inside the map body does not start panel drag", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);
    const panel = document.querySelector(".camera-map-panel");
    const mapBody = document.querySelector(".camera-map-container");

    mapBody.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    mapBody.dispatchEvent(new Event("pointermove", { bubbles: true }));

    expect(panel.classList.contains("is-dragging")).toBe(false);

    widget.destroy();
    manager.destroy();
  });

  it("recenters from the latest GPS callback", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({
      shellManager: manager,
      restoreVisibility: false,
      getCurrentPosition: () => ({ latitude: 40.7, longitude: -73.9, accuracy: 5 }),
    });
    const map = await openAndLoad(widget);

    document.querySelector(".camera-map-follow-toggle").click();

    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [-73.9, 40.7],
    }));

    widget.destroy();
    manager.destroy();
  });

  it("refresh loads the current viewport and updates status text", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);

    await widget.refresh();

    expect(dataSourceDouble.loadViewport).toHaveBeenCalledWith(expect.objectContaining({
      bounds: expect.any(Object),
      zoom: 8,
    }));
    expect(document.querySelector(".camera-map-status").textContent).toBe("cameraMapReady:1");

    widget.destroy();
    manager.destroy();
  });

  it("wires the compact refresh control to reload the current viewport", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);

    dataSourceDouble.loadViewport.mockClear();
    document.querySelector(".camera-map-refresh").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(dataSourceDouble.loadViewport).toHaveBeenCalledWith(expect.objectContaining({
      bounds: expect.any(Object),
      zoom: 8,
    }));

    widget.destroy();
    manager.destroy();
  });

  it("switches basemaps without reloading camera data and reattaches camera layers above the basemap", async () => {
    const { CAMERA_MAP_BASEMAP_STORAGE_KEY } = await import("../../src/speed/camera-map-layers.js");
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);

    dataSourceDouble.loadViewport.mockClear();
    chooseLayer("opentopomap");

    expect(localStorage.getItem(CAMERA_MAP_BASEMAP_STORAGE_KEY)).toBe("opentopomap");
    expect(map.setStyle).toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.objectContaining({
        "camera-map-basemap": expect.objectContaining({
          tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        }),
      }),
    }), { diff: false });
    expect(document.querySelector(".camera-map-attribution").textContent).toBe("cameraMapAttributionOpenTopo");
    expect(dataSourceDouble.loadViewport).not.toHaveBeenCalled();

    fireMapEvent(map, "style.load");
    await Promise.resolve();

    const cameraSource = map.getSource("camera-map-cameras");
    const userSource = map.getSource("camera-map-user-position");
    const layerIds = map.layers.map((layer) => layer.id);
    const basemapIndex = layerIds.indexOf("camera-map-basemap-layer");
    const cameraLayerIds = layerIds.filter((id) => id.startsWith("camera-map-camera-"));

    expect(cameraSource).not.toBeNull();
    expect(userSource).not.toBeNull();
    expect(layerIds).toEqual(expect.arrayContaining([
      "camera-map-user-dot",
      "camera-map-user-heading-arrow",
    ]));
    expect(cameraSource.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: expect.arrayContaining([
        expect.objectContaining({
          geometry: expect.objectContaining({ coordinates: [-73.9, 40.7] }),
        }),
      ]),
    }));
    expect(cameraLayerIds).toEqual([
      "camera-map-camera-clusters",
      "camera-map-camera-cluster-count",
      "camera-map-camera-points",
    ]);
    expect(new Set(cameraLayerIds).size).toBe(cameraLayerIds.length);
    expect(cameraLayerIds.every((id) => layerIds.indexOf(id) > basemapIndex)).toBe(true);
    expect(dataSourceDouble.loadViewport).not.toHaveBeenCalled();

    widget.destroy();
    manager.destroy();
  });

  it("projection switching preserves camera and user-position layers", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    widget.updatePosition({ latitude: 40.7, longitude: -73.9, heading: 45, timestampMs: 1000 }, { now: 1000 });

    widget.setProjectionMode("globe");

    expect(map.setProjection).toHaveBeenCalledWith("globe");
    expect(map.getSource("camera-map-cameras")).not.toBeNull();
    expect(map.getSource("camera-map-user-position")).not.toBeNull();
    expect(map.getLayer("camera-map-user-dot")).not.toBeNull();
    expect(map.getLayer("camera-map-camera-points")).not.toBeNull();

    widget.destroy();
    manager.destroy();
  });

  it("preserves last camera features when refresh fails", async () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    const cameraSource = map.getSource("camera-map-cameras");
    dataSourceDouble.loadViewport.mockRejectedValueOnce(new TypeError("offline"));

    await widget.refresh();

    const lastData = cameraSource.setData.mock.calls.at(-1)[0];
    expect(lastData.features).toEqual(expect.arrayContaining([
      expect.objectContaining({
        geometry: expect.objectContaining({ coordinates: [-73.9, 40.7] }),
      }),
    ]));
    expect(document.querySelector(".camera-map-status").dataset.status).toBe("offline-cached");

    widget.destroy();
    manager.destroy();
  });

  it("keeps driving navigation status ahead of offline camera cache status", async () => {
    localStorage.setItem("vatioboard.cameraMap.follow.v1", "true");
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);

    widget.updatePosition({ latitude: 40.7, longitude: -73.9, heading: 45, speedMs: 6, timestampMs: 1000 }, { now: 1000 });
    expect(document.querySelector(".camera-map-status").dataset.status).toBe("following");

    dataSourceDouble.loadViewport.mockRejectedValueOnce(new TypeError("offline"));
    await widget.refresh();

    expect(document.querySelector(".camera-map-status").dataset.status).toBe("following");
    expect(document.querySelector(".camera-map-status").textContent).toBe("cameraMapFollowing");

    widget.destroy();
    manager.destroy();
  });

  it("restores the selected basemap from storage", async () => {
    const { CAMERA_MAP_BASEMAP_STORAGE_KEY } = await import("../../src/speed/camera-map-layers.js");
    localStorage.setItem(CAMERA_MAP_BASEMAP_STORAGE_KEY, "carto-dark-matter");
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });

    expect(getLayerButton().dataset.layerId).toBe("carto-dark-matter");

    const map = await openAndLoad(widget);

    expect(map.options.style.sources["camera-map-basemap"].tiles[0]).toContain("dark_all");

    widget.destroy();
    manager.destroy();
  });

  it("uses a fixed-window fullscreen fallback when native fullscreen is unavailable", async () => {
    HTMLElement.prototype.requestFullscreen = undefined;
    document.exitFullscreen = vi.fn(() => Promise.resolve());
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);
    const panel = document.querySelector(".camera-map-panel");
    const fullscreenBtn = document.querySelector(".camera-map-fullscreen");

    fullscreenBtn.click();
    await Promise.resolve();

    expect(panel.classList.contains("is-fullscreen")).toBe(true);
    expect(panel.classList.contains("is-window-fullscreen")).toBe(true);
    expect(fullscreenBtn.getAttribute("aria-label")).toBe("cameraMapExitFullscreen");
    expect(widget.isFullscreen()).toBe(true);

    fullscreenBtn.click();
    await Promise.resolve();

    expect(panel.classList.contains("is-fullscreen")).toBe(false);
    expect(panel.classList.contains("is-window-fullscreen")).toBe(false);
    expect(fullscreenBtn.getAttribute("aria-label")).toBe("cameraMapFullscreen");
    expect(widget.isFullscreen()).toBe(false);

    widget.destroy();
    manager.destroy();
  });

  it("falls back to fixed-window fullscreen when native fullscreen rejects", async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.reject(new Error("denied")));
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);
    const panel = document.querySelector(".camera-map-panel");

    document.querySelector(".camera-map-fullscreen").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled();
    expect(panel.classList.contains("is-fullscreen")).toBe(true);
    expect(panel.classList.contains("is-window-fullscreen")).toBe(true);

    widget.destroy();
    manager.destroy();
  });

  it("exits fallback fullscreen on close, minimize, and destroy", async () => {
    HTMLElement.prototype.requestFullscreen = undefined;
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    await openAndLoad(widget);
    const panel = document.querySelector(".camera-map-panel");
    const fullscreenBtn = document.querySelector(".camera-map-fullscreen");

    fullscreenBtn.click();
    await Promise.resolve();
    widget.close();

    expect(panel.hidden).toBe(true);
    expect(panel.classList.contains("is-fullscreen")).toBe(false);

    widget.open();
    await flushTimers();
    fullscreenBtn.click();
    await Promise.resolve();
    widget.minimize();

    expect(panel.hidden).toBe(true);
    expect(panel.classList.contains("is-fullscreen")).toBe(false);

    widget.restore();
    await flushTimers();
    fullscreenBtn.click();
    await Promise.resolve();
    widget.destroy();

    expect(document.querySelector(".camera-map-panel")).toBeNull();
    manager.destroy();
  });

  it("resizes the map after fullscreen transitions", async () => {
    HTMLElement.prototype.requestFullscreen = undefined;
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
    const map = await openAndLoad(widget);
    map.resize.mockClear();

    document.querySelector(".camera-map-fullscreen").click();
    await flushTimers();

    expect(map.resize).toHaveBeenCalled();

    widget.destroy();
    manager.destroy();
  });

  it("resizes from the bottom-right touch handle and updates the map", async () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn((callback) => {
      callback();
      return 1;
    });
    window.cancelAnimationFrame = vi.fn();

    let manager;
    let widget;
    try {
      manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
      widget = createCameraMapWidget({ shellManager: manager, restoreVisibility: false });
      const map = await openAndLoad(widget);
      const panel = document.querySelector(".camera-map-panel");
      const resizeHandle = document.querySelector(".camera-map-resize-handle");
      stubPanelRect(panel);
      map.resize.mockClear();

      resizeHandle.dispatchEvent(new PointerEvent("pointerdown", {
        clientX: 520,
        clientY: 420,
        pointerId: 11,
        pointerType: "touch",
        bubbles: true,
      }));
      resizeHandle.dispatchEvent(new PointerEvent("pointermove", {
        clientX: 610,
        clientY: 500,
        pointerId: 11,
        pointerType: "touch",
        bubbles: true,
      }));

      expect(panel.classList.contains("is-resizing")).toBe(true);

      resizeHandle.dispatchEvent(new PointerEvent("pointerup", {
        clientX: 610,
        clientY: 500,
        pointerId: 11,
        pointerType: "touch",
        bubbles: true,
      }));

      expect(Number.parseInt(panel.style.width, 10)).toBe(610);
      expect(Number.parseInt(panel.style.height, 10)).toBe(500);
      expect(panel.classList.contains("is-resizing")).toBe(false);
      expect(document.documentElement.classList.contains("vb-floating-drag-active")).toBe(false);
      expect(map.resize).toHaveBeenCalled();
      expect(manager.getWindow("camera-map").bounds).toMatchObject({
        left: 20,
        top: 24,
        width: 610,
        height: 500,
      });
    } finally {
      widget?.destroy();
      manager?.destroy();
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it("formats explicit popup speed limits in km/h", async () => {
    const { buildPopupHtml } = await import("../../src/speed/camera-map-widget.js");

    const html = buildPopupHtml({
      properties: {
        speedKph: 50,
        speedSource: "camera:maxspeed",
        country: "us",
      },
    }, { unit: "kmh" });

    expect(html).toContain("Speed limit");
    expect(html).toContain("50 km/h");
  });

  it("formats explicit popup speed limits in mph", async () => {
    const { buildPopupHtml } = await import("../../src/speed/camera-map-widget.js");

    const html = buildPopupHtml({
      properties: {
        speedKph: 48,
        speedSource: "camera:maxspeed",
        country: "us",
      },
    }, { unit: "mph" });

    expect(html).toContain("Speed limit");
    expect(html).toContain("30 mph");
    expect(html).not.toContain("48 km/h");
  });

  it("formats inferred popup speed limits and road distance with active units", async () => {
    const { buildPopupHtml } = await import("../../src/speed/camera-map-widget.js");

    const html = buildPopupHtml({
      properties: {
        speedKph: 48,
        speedSource: "nearest_road:maxspeed",
        distanceM: 18,
        country: "us",
      },
    }, { unit: "mph", distanceUnit: "ft" });

    expect(html).toContain("Estimated limit");
    expect(html).toContain("30 mph from nearby OSM road");
    expect(html).toContain("59 ft");
  });

  it("renders unknown popup speed status", async () => {
    const { buildPopupHtml } = await import("../../src/speed/camera-map-widget.js");

    expect(buildPopupHtml({
      properties: {
        speedKph: null,
        speedSource: "unknown",
        country: "us",
      },
    })).toContain("Unknown");
  });

  it("uses the current stored speed unit when popup options do not pass a unit", async () => {
    const { buildPopupHtml } = await import("../../src/speed/camera-map-widget.js");
    localStorage.setItem(
      "vatio_unit_bootstrap_v1",
      JSON.stringify({
        initializedAtMs: 100,
        updatedAtMs: 100,
        source: "manual",
        countryCode: "us",
        speedUnit: "mph",
        distanceUnit: "ft",
        tripDistanceUnit: "mi",
      }),
    );

    const html = buildPopupHtml({
      properties: {
        speedKph: 48,
        speedSource: "camera:maxspeed",
        country: "us",
      },
    });

    expect(html).toContain("30 mph");
  });

  it("shows compact official/local source labels in popup HTML", async () => {
    const { buildPopupHtml } = await import("../../src/speed/camera-map-widget.js");

    const html = buildPopupHtml({
      properties: {
        speedKph: null,
        speedSource: "unknown",
        cameraSources: ["osm", "nyc"],
        primarySource: "nyc",
        country: "us",
      },
    });

    expect(html).toContain("Source");
    expect(html).toContain("OSM + NYC local");
  });
});
