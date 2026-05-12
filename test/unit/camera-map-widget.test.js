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
      this.resize = vi.fn();
      this.remove = vi.fn();
      this.easeTo = vi.fn();
      this.jumpTo = vi.fn();
      this.addControl = vi.fn();
      this.getZoom = vi.fn(() => 8);
      this.getCenter = vi.fn(() => ({ lng: -73.9, lat: 40.7 }));
      this.getBearing = vi.fn(() => 0);
      this.getPitch = vi.fn(() => 0);
      this.getBounds = vi.fn(() => ({
        getWest: () => -75,
        getSouth: () => 39,
        getEast: () => -72,
        getNorth: () => 42,
      }));
      this.getCanvas = vi.fn(() => ({ style: {} }));
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
    localStorage.clear();
    mapLibreDouble.maps.length = 0;
    dataSourceDouble.instances.length = 0;
    dataSourceDouble.loadViewport.mockClear();
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
    const bottomOverlay = document.querySelector(".camera-map-overlay--bottom");

    expect(body).not.toBeNull();
    expect(mapContainer.parentElement).toBe(body);
    expect(topOverlay).not.toBeNull();
    expect(bottomOverlay).not.toBeNull();
    expect(topOverlay.contains(document.querySelector(".camera-map-status"))).toBe(true);
    expect(topOverlay.contains(document.querySelector(".camera-map-layer-button"))).toBe(true);
    expect(topOverlay.contains(document.querySelector(".camera-map-layer-menu"))).toBe(true);
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

    document.querySelector(".camera-map-toolbar-btn").click();

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
    const layerIds = map.layers.map((layer) => layer.id);
    const basemapIndex = layerIds.indexOf("camera-map-basemap-layer");
    const cameraLayerIds = layerIds.filter((id) => id.startsWith("camera-map-camera-"));

    expect(cameraSource).not.toBeNull();
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
