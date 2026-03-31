import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitGeolocationSuccess, getBrowserMocks } from "../helpers/browser-mocks.js";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

describe("gps-rate.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("gps-rate.html");
  });

  it("boots the GPS lab and records a mocked sample", async () => {
    window.fetch.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");

      if (url.includes("/search?")) {
        return new Response(JSON.stringify([
          { display_name: "Bogota, Colombia" },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await import("../../src/gps-rate/gps-rate.js");
    await flushTasks();

    expectPageSeo({
      titleIncludes: "Vatio GPS Rate Lab",
      canonical: "https://vatioboard.com/gps-rate.html",
    });

    expect(document.getElementById("gpsRateToolsMenuBtn").getAttribute("aria-label")).toBe("Pages");
    expect(document.querySelector("#gpsRateToolsMenuBtn .btn-icon svg")).toBeTruthy();
    document.getElementById("gpsRateToolsMenuBtn").click();
    await flushTasks();
    expect(document.getElementById("gpsRateToolsMenuList").hidden).toBe(false);
    expect(document.getElementById("gpsRateLangToggleMenu").textContent).toBe("EN");
    expect(document.querySelector("#gpsRateToolsMenuList [data-backend-auth]")).toBeTruthy();
    expect(document.querySelector("#gpsRateToolsMenuList [data-backend-auth-signup]")?.getAttribute("href")).toBe("https://www.vatiolibre.com/login#signup");
    expect(document.querySelector("#gpsRateToolsMenuList [data-backend-auth-forgot]")?.getAttribute("href")).toBe("https://www.vatiolibre.com/login#forgot");
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

    expect(document.getElementById("nominatimApiDetails").disabled).toBe(true);

    const searchQuery = document.getElementById("nominatimSearchQuery");
    searchQuery.value = "Bogota";
    searchQuery.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("nominatimSearchRun").click();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await flushTasks();
    }

    const searchCalls = window.fetch.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      return url.includes("https://nominatim.openstreetmap.org/search?");
    });
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0][0]).toContain("https://nominatim.openstreetmap.org/search?");
    expect(searchCalls[0][0]).toContain("q=Bogota");
    expect(document.getElementById("nominatimRequestSourceValue").textContent).toBe("Live request");
    expect(document.getElementById("nominatimResponseOutput").textContent).toContain("Bogota, Colombia");

    document.getElementById("nominatimSearchRun").click();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await flushTasks();
    }

    expect(window.fetch.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      return url.includes("https://nominatim.openstreetmap.org/search?");
    })).toHaveLength(1);
    expect(document.getElementById("nominatimRequestSourceValue").textContent).toBe("Cached response");
  });
});
