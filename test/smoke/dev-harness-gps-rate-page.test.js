import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitGeolocationSuccess, getBrowserMocks } from "../helpers/browser-mocks.js";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

vi.mock("../../src/shared/place-resolver.js", async () => {
  const actual = await vi.importActual("../../src/shared/place-resolver.js");
  return {
    ...actual,
    createPlaceResolver: () => ({
      reversePlace: vi.fn(async () => ({ place: null, data: null, meta: null })),
      reverseCountry: vi.fn(async () => ({
        place: null,
        data: null,
        meta: null,
        countryCode: "",
      })),
    }),
  };
});

function getSearchCalls() {
  return window.fetch.mock.calls.filter(([input]) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");
    return url.includes("https://nominatim.openstreetmap.org/search?");
  });
}

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

    expect(document.getElementById("gpsRateToolsMenuBtn")).toBeNull();
    expect(document.getElementById("gpsRateToolsMenuList")).toBeNull();
    expect(document.getElementById("gpsRateLangToggleMenu")).toBeNull();
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
    await vi.waitFor(() => {
      expect(getSearchCalls()).toHaveLength(1);
    }, { timeout: 2000, interval: 50 });
    await flushTasks();

    const searchCalls = getSearchCalls();
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0][0]).toContain("https://nominatim.openstreetmap.org/search?");
    expect(searchCalls[0][0]).toContain("q=Bogota");
    expect(document.getElementById("nominatimRequestSourceValue").textContent).toBe("Live request");
    expect(document.getElementById("nominatimResponseOutput").textContent).toContain("Bogota, Colombia");

    document.getElementById("nominatimSearchRun").click();
    await flushTasks();
    await vi.waitFor(() => {
      expect(document.getElementById("nominatimRequestSourceValue").textContent).toBe("Cached response");
    }, { timeout: 1000, interval: 25 });

    expect(getSearchCalls()).toHaveLength(1);
    expect(document.getElementById("nominatimRequestSourceValue").textContent).toBe("Cached response");
  });
});
