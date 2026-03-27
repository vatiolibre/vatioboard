import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitGeolocationSuccess, getBrowserMocks } from "../helpers/browser-mocks.js";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

vi.mock("../../src/shared/analog-speedometer.js", () => ({
  createAnalogSpeedometer: () => ({
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.scrollZoom = { disable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
      queueMicrotask(() => {
        for (const handler of this.handlers.load ?? []) handler();
      });
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

    getCenter() {
      return { lng: 0, lat: 0 };
    }

    resize() {}
    jumpTo() {}
    easeTo() {}
    remove() {}
  }

  class FakeAttributionControl {}

  return {
    default: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

describe("speed.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("speed.html");
  });

  it("boots the speedometer and reacts to a mocked geolocation fix", async () => {
    await import("../../src/speed/speed.js");
    await flushTasks();

    expectPageSeo({
      titleIncludes: "Vatio Speed",
      canonical: "https://vatioboard.com/speed.html",
    });
    expect(getBrowserMocks().geolocation.watchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      coords: {
        speed: 10,
        accuracy: 5,
        altitude: 42,
      },
    });
    await flushTasks();

    expect(document.getElementById("speedValue").textContent).toBe("36");
    expect(document.getElementById("altitudeValue").textContent).toBe("42");
  });
});
