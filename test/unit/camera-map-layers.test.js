import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Camera Map basemap styles", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses token-free OpenFreeMap styles for the replaced provider choices", async () => {
    const {
      CAMERA_MAP_BASEMAPS,
      DEFAULT_CAMERA_MAP_BASEMAP_ID,
      DEFAULT_CAMERA_MAP_DARK_BASEMAP_ID,
    } = await import("../../src/apps/map/map-layers.js");
    const vectorStyles = CAMERA_MAP_BASEMAPS.filter((basemap) => basemap.kind === "vector-style");

    expect(DEFAULT_CAMERA_MAP_BASEMAP_ID).toBe("openfreemap-liberty");
    expect(DEFAULT_CAMERA_MAP_DARK_BASEMAP_ID).toBe("openfreemap-dark");
    expect(vectorStyles.map(({ id, styleUrl }) => [id, styleUrl])).toEqual([
      ["openfreemap-liberty", "https://tiles.openfreemap.org/styles/liberty"],
      ["openfreemap-positron", "https://tiles.openfreemap.org/styles/positron"],
      ["openfreemap-dark", "https://tiles.openfreemap.org/styles/dark"],
    ]);
  });

  it("normalizes legacy stored IDs without treating unknown values as preferences", async () => {
    const {
      getCameraMapBasemap,
      isCameraMapBasemapId,
      normalizeCameraMapBasemapId,
    } = await import("../../src/apps/map/map-layers.js");

    expect(normalizeCameraMapBasemapId("carto-voyager")).toBe("openfreemap-liberty");
    expect(normalizeCameraMapBasemapId("carto-positron")).toBe("openfreemap-positron");
    expect(normalizeCameraMapBasemapId("carto-dark-matter")).toBe("openfreemap-dark");
    expect(getCameraMapBasemap("carto-dark-matter").id).toBe("openfreemap-dark");
    expect(isCameraMapBasemapId("carto-voyager")).toBe(true);
    expect(isCameraMapBasemapId("unknown-provider")).toBe(false);
  });

  it("guards nullable numeric filters without mutating the provider style", async () => {
    const { sanitizeOpenFreeMapStyle } = await import("../../src/apps/map/map-layers.js");
    const style = {
      version: 8,
      sources: {},
      layers: [{
        id: "poi",
        filter: ["all", [">=", ["get", "rank"], 7], ["==", ["get", "class"], "park"]],
      }],
    };

    const sanitized = sanitizeOpenFreeMapStyle(style);

    expect(style.layers[0].filter[1]).toEqual([">=", ["get", "rank"], 7]);
    expect(sanitized.layers[0].filter[1]).toEqual([
      "case",
      ["==", ["typeof", ["get", "rank"]], "number"],
      [">=", ["get", "rank"], 7],
      false,
    ]);
    expect(sanitized.layers[0].filter[2]).toEqual(["==", ["get", "class"], "park"]);
  });

  it("falls back to the existing fill color when OpenFreeMap references an unpublished sprite", async () => {
    const { sanitizeOpenFreeMapStyle } = await import("../../src/apps/map/map-layers.js");
    const style = {
      version: 8,
      sources: {},
      layers: [{
        id: "landcover_wood",
        type: "fill",
        paint: {
          "fill-color": "rgb(32,32,32)",
          "fill-opacity": 0.4,
          "fill-pattern": "wood-pattern",
        },
      }],
    };

    const sanitized = sanitizeOpenFreeMapStyle(style);

    expect(style.layers[0].paint["fill-pattern"]).toBe("wood-pattern");
    expect(sanitized.layers[0].paint).toEqual({
      "fill-color": "rgb(32,32,32)",
      "fill-opacity": 0.4,
    });
  });

  it("fetches and caches pristine style documents while returning independent clones", async () => {
    const providerStyle = {
      version: 8,
      sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
      layers: [{ id: "background", type: "background" }],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(providerStyle), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadCameraMapStyle } = await import("../../src/apps/map/map-layers.js");

    const first = await loadCameraMapStyle("openfreemap-liberty");
    first.layers[0].id = "mutated";
    const second = await loadCameraMapStyle("openfreemap-liberty");

    expect(second.layers[0].id).toBe("background");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://tiles.openfreemap.org/styles/liberty", {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
  });

  it("falls back to the direct style URL when fetching or validation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    const { loadCameraMapStyle } = await import("../../src/apps/map/map-layers.js");

    await expect(loadCameraMapStyle("openfreemap-dark"))
      .resolves.toBe("https://tiles.openfreemap.org/styles/dark");
  });

  it("keeps raster alternatives synchronous with the existing style contract", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { loadCameraMapStyle } = await import("../../src/apps/map/map-layers.js");

    const style = await loadCameraMapStyle("opentopomap");

    expect(style.sources["camera-map-basemap"].tiles).toEqual([
      "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
