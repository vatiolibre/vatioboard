import { beforeEach, describe, expect, it, vi } from "vitest";

const mapLibreTestDouble = vi.hoisted(() => {
  const fakeMaps = [];

  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.paints = {};
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
      this.remove = vi.fn();
      fakeMaps.push(this);
    }

    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }

    addControl() {
      return this;
    }

    getSource(id) {
      if (!this.sources.has(id)) {
        this.sources.set(id, { setData: vi.fn() });
      }
      return this.sources.get(id);
    }

    setPaintProperty(layer, prop, value) {
      this.paints[`${layer}/${prop}`] = value;
    }
  }

  class FakeAttributionControl {}

  return {
    fakeMaps,
    module: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

const fakeMaps = mapLibreTestDouble.fakeMaps;

vi.mock("../../src/shared/maplibre-loader.js", () => ({
  loadMapLibre: vi.fn(() => Promise.resolve(mapLibreTestDouble.module)),
}));

function fireLoad(fakeMap) {
  for (const handler of fakeMap.handlers.load ?? []) handler();
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

async function startInit(preview) {
  const initPromise = preview.init();
  await flushAsyncWork();
  return { initPromise };
}

async function initAndLoad(preview, mapIndex = 0) {
  const { initPromise } = await startInit(preview);
  fireLoad(fakeMaps[mapIndex]);
  await initPromise;
}

describe("createLibraryMapPreview", () => {
  let createLibraryMapPreview;

  beforeEach(async () => {
    fakeMaps.length = 0;
    document.body.innerHTML = '<div id="mapContainer"></div>';
    vi.resetModules();
    ({ createLibraryMapPreview } = await import(
      "../../src/library/library-map-preview.js"
    ));
  });

  it("creates a map on init", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    const { initPromise } = await startInit(preview);

    expect(fakeMaps).toHaveLength(1);
    fireLoad(fakeMaps[0]);
    await initPromise;
  });

  it("disables all interactive controls", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    const { initPromise } = await startInit(preview);

    const map = fakeMaps[0];
    expect(map.scrollZoom.disable).toHaveBeenCalled();
    expect(map.boxZoom.disable).toHaveBeenCalled();
    expect(map.doubleClickZoom.disable).toHaveBeenCalled();
    expect(map.dragPan.disable).toHaveBeenCalled();
    expect(map.dragRotate.disable).toHaveBeenCalled();
    expect(map.keyboard.disable).toHaveBeenCalled();
    expect(map.touchZoomRotate.disable).toHaveBeenCalled();
    fireLoad(map);
    await initPromise;
  });

  it("does not create a map if element is null", async () => {
    const preview = createLibraryMapPreview({ element: null });
    await preview.init();
    expect(fakeMaps).toHaveLength(0);
  });

  it("does not create a second map on repeated init()", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    const firstInit = preview.init();
    const secondInit = preview.init();
    await flushAsyncWork();
    expect(fakeMaps).toHaveLength(1);
    fireLoad(fakeMaps[0]);
    await firstInit;
    await secondInit;
  });

  it("destroy removes the map", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);

    const map = fakeMaps[0];
    preview.destroy();
    expect(map.remove).toHaveBeenCalled();
  });

  it("can re-init after destroy", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);
    preview.destroy();
    const { initPromise: secondInit } = await startInit(preview);
    expect(fakeMaps).toHaveLength(2);
    fireLoad(fakeMaps[1]);
    await secondInit;
  });

  it("ready becomes true after load event", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    const { initPromise } = await startInit(preview);
    expect(preview.ready).toBe(false);

    fireLoad(fakeMaps[0]);
    await initPromise;
    expect(preview.ready).toBe(true);
  });

  it("showRoute with empty coordinates hides route", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);

    await preview.showRoute(null);
    // Should not throw, just return
  });

  it("showRoute with valid coordinates updates the source", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);
    vi.useFakeTimers();

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];
    const routePromise = preview.showRoute(coords);

    // Advance timers for animation awaits (1200 + 600 + 1200)
    await vi.advanceTimersByTimeAsync(4000);
    await routePromise;

    const source = fakeMaps[0].getSource("library-preview-route");
    expect(source.setData).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("cancelAnimation prevents later animation steps", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);
    vi.useFakeTimers();

    // Spy on the reduced-motion check: ensure animation path is taken
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false });

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];
    const routePromise = preview.showRoute(coords);

    // Advance 1300ms: the first waitMs(1200) resolves, code continues
    // synchronously to fitRoute + starts waitMs(600)
    await vi.advanceTimersByTimeAsync(1300);

    const map = fakeMaps[0];
    // Route was hidden initially by hideRoute
    // fitBounds should have fired (after the 1200ms wait)
    expect(map.fitBounds).toHaveBeenCalled();

    // Now cancel animation before the 600ms wait expires
    preview.cancelAnimation();

    // Flush remaining timers
    await vi.advanceTimersByTimeAsync(5000);
    await routePromise;

    // Since we cancelled during the 600ms wait, revealRoute should NOT have
    // run. The opacity was set to 0 by hideRoute at the start and should remain 0.
    expect(map.paints["library-route-line/line-opacity"]).toBe(0);

    matchMediaSpy.mockRestore();
    vi.useRealTimers();
  });

  it("showRoute auto-inits if map was not init'd", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];
    const routePromise = preview.showRoute(coords);

    // Map should have been created
    await flushAsyncWork();
    expect(fakeMaps).toHaveLength(1);

    // Fire load to unblock the wait
    fireLoad(fakeMaps[0]);
    vi.useFakeTimers();

    await vi.advanceTimersByTimeAsync(4000);
    await routePromise;

    vi.useRealTimers();
  });

  it("destroy during showRoute stops animation gracefully", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);
    vi.useFakeTimers();

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];
    const routePromise = preview.showRoute(coords);

    await vi.advanceTimersByTimeAsync(500);
    preview.destroy();

    await vi.advanceTimersByTimeAsync(4000);
    await routePromise;
    // Should not throw

    vi.useRealTimers();
  });

  it("does not restart animation when showRoute is called with the same coordinates", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);
    vi.useFakeTimers();

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];

    // First call: should animate
    const firstPromise = preview.showRoute(coords);
    await vi.advanceTimersByTimeAsync(4000);
    await firstPromise;

    const map = fakeMaps[0];
    const fitCallsAfterFirst = map.fitBounds.mock.calls.length;

    // Second call with identical coordinates: should be a no-op
    const secondPromise = preview.showRoute(coords);
    await vi.advanceTimersByTimeAsync(4000);
    await secondPromise;

    expect(map.fitBounds.mock.calls.length).toBe(fitCallsAfterFirst);

    vi.useRealTimers();
  });

  it("animates again when showRoute is called with different coordinates", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);
    vi.useFakeTimers();

    const coordsA = [[-74.0, 40.7], [-74.1, 40.8]];
    const coordsB = [[-73.9, 40.6], [-73.8, 40.5]];

    const firstPromise = preview.showRoute(coordsA);
    await vi.advanceTimersByTimeAsync(4000);
    await firstPromise;

    const map = fakeMaps[0];
    const fitCallsAfterFirst = map.fitBounds.mock.calls.length;

    const secondPromise = preview.showRoute(coordsB);
    await vi.advanceTimersByTimeAsync(4000);
    await secondPromise;

    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitCallsAfterFirst);

    vi.useRealTimers();
  });

  it("allows re-animation after destroy resets the route signature", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    await initAndLoad(preview);
    vi.useFakeTimers();

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];

    const firstPromise = preview.showRoute(coords);
    await vi.advanceTimersByTimeAsync(4000);
    await firstPromise;

    preview.destroy();
    vi.useRealTimers();
    const { initPromise: reinitPromise } = await startInit(preview);
    fireLoad(fakeMaps[1]);
    await reinitPromise;
    vi.useFakeTimers();

    const secondPromise = preview.showRoute(coords);
    await vi.advanceTimersByTimeAsync(4000);
    await secondPromise;

    // Both maps should have received animation calls (reduced-motion uses fitBounds)
    expect(fakeMaps[0].fitBounds).toHaveBeenCalled();
    expect(fakeMaps[1].fitBounds).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
