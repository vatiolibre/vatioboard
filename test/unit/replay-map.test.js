import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeMaps = [];

vi.mock("maplibre-gl", () => {
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
      this.stop = vi.fn();
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
  }

  class FakeAttributionControl {}

  return {
    default: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

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

  it("cancels an in-flight approach before it fits the route", async () => {
    vi.useFakeTimers();

    const { createReplayMapController } = await import("../../src/replay/map.js");
    const controller = createReplayMapController({
      element: document.getElementById("replayMap"),
      session: {
        samples: [
          { latitude: 4.61, longitude: -74.08 },
          { latitude: 4.62, longitude: -74.07 },
        ],
      },
    });

    const initPromise = controller.init();
    for (const handler of fakeMaps[0].handlers.load ?? []) {
      handler();
    }
    await initPromise;
    fakeMaps[0].fitBounds.mockClear();
    fakeMaps[0].stop.mockClear();

    const approachPromise = controller.runApproachAnimation();
    expect(fakeMaps[0].jumpTo).toHaveBeenCalledTimes(1);

    controller.cancelApproachAnimation();
    await vi.advanceTimersByTimeAsync(5000);
    await approachPromise;

    expect(fakeMaps[0].fitBounds).not.toHaveBeenCalled();
  });
});
