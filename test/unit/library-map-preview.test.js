import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeMaps = [];

vi.mock("maplibre-gl", () => {
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
    default: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

function fireLoad(fakeMap) {
  for (const handler of fakeMap.handlers.load ?? []) handler();
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

  it("creates a map on init", () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();

    expect(fakeMaps).toHaveLength(1);
  });

  it("disables all interactive controls", () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();

    const map = fakeMaps[0];
    expect(map.scrollZoom.disable).toHaveBeenCalled();
    expect(map.boxZoom.disable).toHaveBeenCalled();
    expect(map.doubleClickZoom.disable).toHaveBeenCalled();
    expect(map.dragPan.disable).toHaveBeenCalled();
    expect(map.dragRotate.disable).toHaveBeenCalled();
    expect(map.keyboard.disable).toHaveBeenCalled();
    expect(map.touchZoomRotate.disable).toHaveBeenCalled();
  });

  it("does not create a map if element is null", () => {
    const preview = createLibraryMapPreview({ element: null });
    preview.init();
    expect(fakeMaps).toHaveLength(0);
  });

  it("does not create a second map on repeated init()", () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();
    preview.init();
    expect(fakeMaps).toHaveLength(1);
  });

  it("destroy removes the map", () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();

    const map = fakeMaps[0];
    preview.destroy();
    expect(map.remove).toHaveBeenCalled();
  });

  it("can re-init after destroy", () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();
    preview.destroy();
    preview.init();
    expect(fakeMaps).toHaveLength(2);
  });

  it("ready becomes true after load event", () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();
    expect(preview.ready).toBe(false);

    fireLoad(fakeMaps[0]);
    expect(preview.ready).toBe(true);
  });

  it("showRoute with empty coordinates hides route", async () => {
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();
    fireLoad(fakeMaps[0]);

    await preview.showRoute(null);
    // Should not throw, just return
  });

  it("showRoute with valid coordinates updates the source", async () => {
    vi.useFakeTimers();
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();
    fireLoad(fakeMaps[0]);

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
    vi.useFakeTimers();
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();
    fireLoad(fakeMaps[0]);

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
    vi.useFakeTimers();
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];
    const routePromise = preview.showRoute(coords);

    // Map should have been created
    expect(fakeMaps).toHaveLength(1);

    // Fire load to unblock the wait
    fireLoad(fakeMaps[0]);

    await vi.advanceTimersByTimeAsync(4000);
    await routePromise;

    vi.useRealTimers();
  });

  it("destroy during showRoute stops animation gracefully", async () => {
    vi.useFakeTimers();
    const element = document.getElementById("mapContainer");
    const preview = createLibraryMapPreview({ element });
    preview.init();
    fireLoad(fakeMaps[0]);

    const coords = [[-74.0, 40.7], [-74.1, 40.8]];
    const routePromise = preview.showRoute(coords);

    await vi.advanceTimersByTimeAsync(500);
    preview.destroy();

    await vi.advanceTimersByTimeAsync(4000);
    await routePromise;
    // Should not throw

    vi.useRealTimers();
  });
});
