import maplibregl from "maplibre-gl";

const PREVIEW_SOURCE_ID = "library-preview-route";
const PREVIEW_BASE_SATELLITE_SOURCE_ID = "library-satellite-base";
const SATELLITE_ATTRIBUTION = "Imagery © EOX, Sentinel-2, Esri";
const CLOSEUP_ZOOM = 12;

function getEmptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function getLineFeatureCollection(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return getEmptyFeatureCollection();
  }
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "LineString", coordinates },
    }],
  };
}

function computeBounds(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return [[minLon, minLat], [maxLon, maxLat]];
}

function getMidpoint(bounds) {
  if (!bounds) return [0, 18];
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

/**
 * Lightweight map preview for the Cloud Library detail panel.
 * Inspired by replay/map.js but stripped to a minimal static preview
 * with a one-shot approach animation.
 */
export function createLibraryMapPreview({ element }) {
  let map = null;
  let ready = false;
  let approachToken = 0;
  let currentCoordinates = null;
  let lastRouteSignature = "";

  function destroy() {
    approachToken += 1;
    if (map && typeof map.remove === "function") {
      map.remove();
    }
    map = null;
    ready = false;
    currentCoordinates = null;
    lastRouteSignature = "";
  }

  function init() {
    if (!element || map) return;

    try {
      map = new maplibregl.Map({
        container: element,
        antialias: true,
        attributionControl: false,
        interactive: false,
        center: [0, 18],
        zoom: 0.35,
        pitch: 0,
        bearing: 0,
        style: {
          version: 8,
          sources: {
            [PREVIEW_BASE_SATELLITE_SOURCE_ID]: {
              type: "raster",
              tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
              attribution: SATELLITE_ATTRIBUTION,
            },
            [PREVIEW_SOURCE_ID]: {
              type: "geojson",
              data: getEmptyFeatureCollection(),
            },
          },
          layers: [
            {
              id: "library-satellite-base",
              type: "raster",
              source: PREVIEW_BASE_SATELLITE_SOURCE_ID,
              paint: {
                "raster-brightness-min": 0.06,
                "raster-brightness-max": 1,
                "raster-contrast": 0.1,
              },
            },
            {
              id: "library-route-glow",
              type: "line",
              source: PREVIEW_SOURCE_ID,
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#34d399",
                "line-opacity": 0,
                "line-width": 8,
                "line-blur": 4,
              },
            },
            {
              id: "library-route-line",
              type: "line",
              source: PREVIEW_SOURCE_ID,
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#34d399",
                "line-opacity": 0,
                "line-width": 3.6,
              },
            },
          ],
        },
      });

      map.scrollZoom?.disable?.();
      map.boxZoom?.disable?.();
      map.doubleClickZoom?.disable?.();
      map.dragPan?.disable?.();
      map.dragRotate?.disable?.();
      map.keyboard?.disable?.();
      map.touchZoomRotate?.disable?.();

      map.addControl(new maplibregl.AttributionControl({ compact: true }));

      map.on("load", () => {
        ready = true;
        if (currentCoordinates) {
          updateRoute(currentCoordinates);
        }
        const attrCtrl = element?.querySelector(".maplibregl-ctrl-attrib");
        if (attrCtrl) {
          attrCtrl.classList.remove("maplibregl-compact-show");
          attrCtrl.removeAttribute("open");
        }
      });
    } catch (error) {
      console.error("Library map preview init failed", error);
      ready = false;
    }
  }

  function updateRoute(coordinates) {
    currentCoordinates = coordinates;
    if (!map || !ready) return;

    const source = map.getSource(PREVIEW_SOURCE_ID);
    if (source && typeof source.setData === "function") {
      source.setData(getLineFeatureCollection(coordinates));
    }
  }

  function fitRoute(coordinates, { duration = 0 } = {}) {
    if (!map || !ready) return;

    const bounds = computeBounds(coordinates);
    if (!bounds) {
      map.easeTo({ center: [0, 18], zoom: 0.35, pitch: 0, bearing: 0, duration: 0, essential: true });
      return;
    }

    map.fitBounds(bounds, {
      padding: { top: 48, right: 48, bottom: 48, left: 48 },
      pitch: 42,
      bearing: 8,
      maxZoom: 14,
      duration,
      essential: true,
    });
  }

  function revealRoute() {
    if (!map || !ready) return;

    map.setPaintProperty("library-route-glow", "line-opacity", 0.28);
    map.setPaintProperty("library-route-line", "line-opacity", 0.94);
  }

  function hideRoute() {
    if (!map || !ready) return;

    map.setPaintProperty("library-route-glow", "line-opacity", 0);
    map.setPaintProperty("library-route-line", "line-opacity", 0);
  }

  /**
   * Run the one-shot preview approach animation:
   * 1. Jump to globe view
   * 2. Ease toward route midpoint
   * 3. Fit route bounds
   * 4. Reveal route line
   */
  async function runPreviewAnimation(coordinates) {
    if (!map || !ready || !coordinates || coordinates.length < 2) return;

    const token = ++approachToken;
    const reduced = prefersReducedMotion();
    const bounds = computeBounds(coordinates);
    if (!bounds) return;

    const midpoint = getMidpoint(bounds);
    hideRoute();
    updateRoute(coordinates);

    if (reduced) {
      fitRoute(coordinates, { duration: 0 });
      revealRoute();
      return;
    }

    // 1. Start from globe overview
    map.jumpTo({ center: [0, 18], zoom: 0.35, pitch: 0, bearing: -10 });

    // 2. Ease toward midpoint
    map.easeTo({
      center: midpoint,
      zoom: 1.2,
      pitch: 6,
      bearing: -4,
      duration: 1200,
      essential: true,
    });

    await waitMs(1200);
    if (token !== approachToken || !map || !ready) return;

    // 3. Fit bounds with route reveal
    fitRoute(coordinates, { duration: 1800 });

    await waitMs(600);
    if (token !== approachToken || !map || !ready) return;

    revealRoute();

    await waitMs(1200);
    if (token !== approachToken || !map || !ready) return;

    // Collapse attribution after settle
    const attrCtrl = element?.querySelector(".maplibregl-ctrl-attrib");
    if (attrCtrl) {
      attrCtrl.classList.remove("maplibregl-compact-show");
      attrCtrl.removeAttribute("open");
    }
  }

  /**
   * Build a lightweight identity string for a coordinate array.
   * Used to skip redundant showRoute() calls for the same route.
   */
  function buildRouteSignature(coordinates) {
    if (!coordinates || coordinates.length < 2) return "";
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    return `${coordinates.length}:${first[0]},${first[1]}:${last[0]},${last[1]}`;
  }

  /**
   * Set route and animate. If map not init'd yet, init first.
   * No-op when the route signature matches the currently displayed route.
   */
  async function showRoute(coordinates) {
    if (!coordinates || coordinates.length < 2) {
      lastRouteSignature = "";
      if (map && ready) {
        hideRoute();
        updateRoute([]);
        map.easeTo({ center: [0, 18], zoom: 0.35, pitch: 0, bearing: 0, duration: 0, essential: true });
      }
      return;
    }

    const sig = buildRouteSignature(coordinates);
    if (sig && sig === lastRouteSignature) return;
    lastRouteSignature = sig;

    if (!map) {
      init();
      // Wait for load
      await new Promise((resolve) => {
        if (ready) return resolve();
        const check = setInterval(() => {
          if (ready) { clearInterval(check); resolve(); }
        }, 50);
        setTimeout(() => { clearInterval(check); resolve(); }, 3000);
      });
    }

    await runPreviewAnimation(coordinates);
  }

  function cancelAnimation() {
    approachToken += 1;
  }

  return {
    init,
    destroy,
    showRoute,
    cancelAnimation,
    get ready() { return ready; },
  };
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
