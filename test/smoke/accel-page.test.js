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

vi.mock("chart.js/auto", () => ({
  default: class FakeChart {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.ctx = canvas.getContext("2d");
      this.chartArea = {
        top: 0,
        left: 0,
        right: 300,
        bottom: 200,
      };
      this.tooltip = {
        getActiveElements: () => [],
      };
    }

    destroy() {}
    resize() {}
    update() {}
    setActiveElements() {}
  },
}));

describe("accel.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("accel.html");
  });

  it("boots the acceleration page and enables the test after a mocked fix", async () => {
    const accelPage = await import("../../src/accel/accel.js");
    await accelPage.initPromise;
    await flushTasks();

    expectPageSeo({
      titleIncludes: "Vatio Accel",
      canonical: "https://vatioboard.com/accel.html",
    });
    expect(document.getElementById("armRun").getAttribute("aria-label")).toBe("Start test");
    expect(document.querySelector("#armRun .btn-icon svg")).toBeTruthy();
    expect(document.querySelector("#cancelRun .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("accelToolsMenuBtn").getAttribute("aria-label")).toBe("Tools");
    expect(document.querySelector("#accelToolsMenuBtn .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("accelToolsMenuList").hidden).toBe(true);
    document.getElementById("accelToolsMenuBtn").click();
    await flushTasks();
    expect(document.getElementById("accelToolsMenuList").hidden).toBe(false);
    expect(document.getElementById("accelToolsMenuBtn").getAttribute("aria-expanded")).toBe("true");
    expect(getBrowserMocks().geolocation.watchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      coords: {
        speed: 0,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    expect(document.getElementById("latestAccuracyValue").textContent).not.toBe("—");
    expect(document.getElementById("armRun").disabled).toBe(false);
  });
});
