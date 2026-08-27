import { beforeEach, describe, expect, it, vi } from "vitest";

const mapLibreTestDouble = vi.hoisted(() => {
  const fakeMaps = [];

  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.scrollZoom = { disable: vi.fn(), enable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
      this.jumpTo = vi.fn();
      this.easeTo = vi.fn();
      this.fitBounds = vi.fn();
      this.resize = vi.fn();
      this.stop = vi.fn();
      this.remove = vi.fn();
      this.getZoom = vi.fn(() => 10);
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

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("replay map controller", () => {
  beforeEach(() => {
    fakeMaps.length = 0;
    vi.useRealTimers();
    document.body.innerHTML = '<div id="replayMap"></div>';
  });

  it("resolves pending init when destroyed before the map load event fires", async () => {
    const { createReplayMapController } = await import("../../src/replay/map.js");
    const controller = createReplayMapController({
      element: document.getElementById("replayMap"),
      session: null,
    });

    const initPromise = controller.init();
    controller.destroy();

    await expect(initPromise).resolves.toBeUndefined();
  });

  it("uses a non-blocking route overview instead of a world approach", async () => {
    const { createReplayMapController } = await import("../../src/replay/map.js");
    const controller = createReplayMapController({
      element: document.getElementById("replayMap"),
      approachMode: "overview",
      session: {
        samples: [
          { latitude: 4.61, longitude: -74.08 },
          { latitude: 4.62, longitude: -74.07 },
        ],
      },
    });

    const initPromise = controller.init();
    await flushAsyncWork();
    for (const handler of fakeMaps[0].handlers.load ?? []) {
      handler();
    }
    await initPromise;
    fakeMaps[0].fitBounds.mockClear();
    await controller.runApproachAnimation();

    expect(fakeMaps[0].jumpTo).not.toHaveBeenCalled();
    expect(fakeMaps[0].fitBounds).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0].fitBounds.mock.calls[0][1]).toMatchObject({ duration: 320 });
  });

  it("fits the first session loaded while MapLibre is still initializing", async () => {
    const { createReplayMapController } = await import("../../src/replay/map.js");
    const controller = createReplayMapController({
      element: document.getElementById("replayMap"),
      fitOnFirstLoad: true,
      session: null,
    });

    const initPromise = controller.init();
    await flushAsyncWork();
    controller.setSession({
      id: "first-cloud-session",
      samples: [
        { timestampMs: 1, latitude: 40.8, longitude: -73.9 },
        { timestampMs: 2, latitude: 40.9, longitude: -73.8 },
      ],
    }, { resetCamera: false });
    for (const handler of fakeMaps.at(-1).handlers.load ?? []) handler();
    await initPromise;

    expect(fakeMaps.at(-1).fitBounds).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      sessionId: "first-cloud-session",
      routeReady: true,
    });
  });

  it("bounds route padding to the measured map surface", async () => {
    const { getReplayMapPadding } = await import("../../src/replay/map.js");
    const element = {
      clientWidth: 405,
      clientHeight: 179,
      getBoundingClientRect: () => ({ width: 405, height: 179 }),
    };
    const transport = {
      clientHeight: 64,
      getBoundingClientRect: () => ({ height: 64 }),
    };

    const padding = getReplayMapPadding(element, transport);
    expect(padding.left + padding.right).toBeLessThanOrEqual(405 * 0.5);
    expect(padding.top + padding.bottom).toBeLessThanOrEqual(179 * 0.5);
    expect(padding.bottom).toBeGreaterThan(padding.top);
  });

  it("keeps route playback available when raster imagery is degraded", async () => {
    const snapshots = [];
    const { createReplayMapController } = await import("../../src/replay/map.js");
    const controller = createReplayMapController({
      element: document.getElementById("replayMap"),
      session: {
        id: "degraded-session",
        samples: [
          { latitude: 4.61, longitude: -74.08 },
          { latitude: 4.62, longitude: -74.07 },
        ],
      },
      onStatusChange: (snapshot) => snapshots.push(snapshot),
    });

    const initPromise = controller.init();
    await flushAsyncWork();
    const map = fakeMaps.at(-1);
    for (const handler of map.handlers.load ?? []) handler();
    await initPromise;
    for (const handler of map.handlers.error ?? []) {
      handler({ sourceId: "replay-satellite-detail", error: new Error("offline") });
    }

    expect(snapshots.at(-1)).toMatchObject({
      status: "degraded",
      routeReady: true,
    });
  });

  it("lazily throttles played-route allocations while updating the marker", async () => {
    const { createReplayMapController } = await import("../../src/replay/map.js");
    const session = {
      id: "large-session",
      samples: Array.from({ length: 9340 }, (_, index) => ({
        timestampMs: index * 1000,
        latitude: 40 + (index * 0.00001),
        longitude: -74 + (index * 0.00001),
      })),
    };
    const controller = createReplayMapController({
      element: document.getElementById("replayMap"),
      session,
    });
    const initPromise = controller.init();
    await flushAsyncWork();
    const map = fakeMaps.at(-1);
    for (const handler of map.handlers.load ?? []) handler();
    await initPromise;
    const firstFactory = vi.fn(() => [[-74, 40]]);
    const throttledFactory = vi.fn(() => [[-74, 40], [-73.9, 40.1]]);

    controller.renderPlaybackFrame({
      sample: { sampleIndex: 0, longitude: -74, latitude: 40 },
      playedCoordinates: firstFactory,
    });
    controller.renderPlaybackFrame({
      sample: { sampleIndex: 1, longitude: -73.99, latitude: 40.01 },
      playedCoordinates: throttledFactory,
    });

    expect(firstFactory).toHaveBeenCalledTimes(1);
    expect(throttledFactory).not.toHaveBeenCalled();
    expect(map.getSource("replay-route-point").setData).toHaveBeenCalledTimes(3);
  });

  it("recreates a failed map when retry is requested", async () => {
    const { createReplayMapController } = await import("../../src/replay/map.js");
    const controller = createReplayMapController({
      element: document.getElementById("replayMap"),
      fitOnFirstLoad: true,
      session: {
        id: "retry-session",
        samples: [
          { latitude: 40.8, longitude: -73.9 },
          { latitude: 40.9, longitude: -73.8 },
        ],
      },
    });
    const firstInit = controller.init();
    await flushAsyncWork();
    const firstMap = fakeMaps.at(-1);
    for (const handler of firstMap.handlers.load ?? []) handler();
    await firstInit;

    const retryPromise = controller.retry();
    await flushAsyncWork();
    const replacementMap = fakeMaps.at(-1);
    expect(replacementMap).not.toBe(firstMap);
    for (const handler of replacementMap.handlers.load ?? []) handler();
    await retryPromise;

    expect(firstMap.remove).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ status: "ready", routeReady: true });
    expect(replacementMap.fitBounds).toHaveBeenCalled();
  });
});
