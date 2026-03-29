import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitGeolocationSuccess, getBrowserMocks } from "../helpers/browser-mocks.js";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

describe("gps-rate.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("gps-rate.html");
  });

  it("boots the GPS lab and records a mocked sample", async () => {
    await import("../../src/gps-rate/gps-rate.js");
    await flushTasks();

    expectPageSeo({
      titleIncludes: "Vatio GPS Rate Lab",
      canonical: "https://vatioboard.com/gps-rate.html",
    });

    expect(document.getElementById("gpsRateToolsMenuBtn").getAttribute("aria-label")).toBe("Pages");
    expect(document.querySelector("#gpsRateToolsMenuBtn .btn-icon svg")).toBeTruthy();
    expect(document.querySelector("#gpsRateStartQuick .btn-icon svg")).toBeTruthy();

    document.getElementById("gpsRateStartQuick").click();
    expect(getBrowserMocks().geolocation.watchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      coords: {
        speed: 2.5,
        accuracy: 4,
        altitude: 20,
        heading: 90,
      },
    });
    await flushTasks();

    expect(document.getElementById("sampleCountValue").textContent).toBe("1");
    expect(document.getElementById("eventLogBody").children).toHaveLength(1);
  });
});
