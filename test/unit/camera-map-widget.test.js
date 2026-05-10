import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mapLibreDouble = vi.hoisted(() => {
  const maps = [];

  class FakeMap {
    constructor(options = {}) {
      this.options = options;
      this.handlers = {};
      this.sources = new Map();
      this.layers = [];
      this.resize = vi.fn();
      this.remove = vi.fn();
      this.easeTo = vi.fn();
      this.jumpTo = vi.fn();
      this.addControl = vi.fn();
      this.getZoom = vi.fn(() => 8);
      this.getBounds = vi.fn(() => ({
        getWest: () => -75,
        getSouth: () => 39,
        getEast: () => -72,
        getNorth: () => 42,
      }));
      this.getCanvas = vi.fn(() => ({ style: {} }));
      maps.push(this);
    }

    on(event, layerOrHandler, maybeHandler) {
      const handler = typeof layerOrHandler === "function" ? layerOrHandler : maybeHandler;
      (this.handlers[event] ??= []).push(handler);
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

    addLayer(layer) {
      this.layers.push(layer);
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
  for (const handler of map.handlers.load || []) handler();
  await Promise.resolve();
  await Promise.resolve();
  return map;
}

describe("createCameraMapWidget", () => {
  let createCameraMapWidget;
  let createShellWindowManager;
  let loadMapLibre;

  beforeEach(async () => {
    vi.useFakeTimers();
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
    });

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
});
