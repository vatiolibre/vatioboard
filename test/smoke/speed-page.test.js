import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitGeolocationSuccess, getBrowserMocks } from "../helpers/browser-mocks.js";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

const saveActiveReplaySessionSpy = vi.fn();

vi.mock("../../src/shared/analog-speedometer.js", () => ({
  createAnalogSpeedometer: () => ({
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock("../../src/replay/session.js", async () => {
  const actual = await vi.importActual("../../src/replay/session.js");
  saveActiveReplaySessionSpy.mockImplementation(actual.saveActiveReplaySession);
  return {
    ...actual,
    saveActiveReplaySession: saveActiveReplaySessionSpy,
  };
});

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
    saveActiveReplaySessionSpy.mockClear();
    await bootHtmlPage("speed.html");
  });

  it("boots the speedometer and reacts to a mocked geolocation fix", async () => {
    const speedPage = await import("../../src/speed/speed.js");
    await speedPage.initPromise;
    await flushTasks();

    expectPageSeo({
      titleIncludes: "Vatio Speed",
      canonical: "https://vatioboard.com/speed.html",
    });
    expect(getBrowserMocks().geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(document.getElementById("toggleRecording").textContent).toBe("Pause recording");

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

  it("coalesces replay persistence under high-frequency recording bursts", async () => {
    const speedPage = await import("../../src/speed/speed.js");
    await speedPage.initPromise;
    await flushTasks();

    for (let index = 0; index < 205; index += 1) {
      emitGeolocationSuccess({
        timestamp: 1000 + (index * 100),
        coords: {
          latitude: 40.7128 + (index / 100000),
          longitude: -74.006 + (index / 100000),
          speed: 10,
          accuracy: 5,
          altitude: 42,
        },
      });
    }

    await flushTasks();
    await flushTasks();
    await flushTasks();

    expect(saveActiveReplaySessionSpy.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
