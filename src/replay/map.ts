import {
  GLOBE_HORIZON_COLOR,
  GLOBE_NIGHT_SOURCE_ID,
  GLOBE_RASTER_BRIGHTNESS_MIN,
  GLOBE_RASTER_CONTRAST,
  GLOBE_SATELLITE_ATTRIBUTION,
  GLOBE_SKY_COLOR,
  GLOBE_SKY_HORIZON_BLEND,
  GLOBE_TERMINATOR_SOURCE_ID,
} from "../speed/constants.js";
import { loadMapLibre } from "../shared/maplibre-loader.js";
import { getSolarNightData, getSolarTerminatorData, getSunVectorAtTime } from "../speed/navigation.js";
import { getReplayBounds, getReplayPathCoordinates } from "./logic.js";

const REPLAY_SOURCE_ID = "replay-route-full";
const REPLAY_PLAYED_SOURCE_ID = "replay-route-played";
const REPLAY_POINT_SOURCE_ID = "replay-route-point";
const REPLAY_BASE_SATELLITE_SOURCE_ID = "replay-satellite-base";
const REPLAY_DETAIL_SATELLITE_SOURCE_ID = "replay-satellite-detail";
const REPLAY_DETAIL_SATELLITE_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics, and contributors";
const REPLAY_CLOSEUP_ZOOM = 12;

interface ReplayMapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ReplayMapFitOptions {
  duration?: number;
  padding?: ReplayMapPadding;
  pitch?: number;
  bearing?: number;
  maxZoom?: number;
  zoom?: number;
}

interface ReplayMapApproachOptions {
  finalDuration?: number;
  finalPitch?: number;
  finalBearing?: number;
  finalMaxZoom?: number;
  finalPadding?: ReplayMapPadding;
}

interface ReplayMapSetSessionOptions {
  resetCamera?: boolean;
  preservePlayback?: boolean;
}

function getEmptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function getLineFeatureCollection(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return getEmptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    ],
  };
}

function getPointFeatureCollection(sample) {
  if (!sample) return getEmptyFeatureCollection();

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [sample.longitude, sample.latitude],
        },
      },
    ],
  };
}

function collapseReplayAttributionControl(element) {
  const attributionControl = element?.querySelector(".maplibregl-ctrl-attrib");
  if (!attributionControl) return;

  attributionControl.classList.remove("maplibregl-compact-show");
  attributionControl.removeAttribute("open");
}

function shouldEnableWheelZoom() {
  return Boolean(window.matchMedia?.("(pointer: fine)").matches);
}

function shouldDebugReplayMap() {
  return Boolean(window.__VATIO_REPLAY_MAP_DEBUG || window.__VATIO_ACCEL_REPLAY_DEBUG);
}

function debugReplayMapSources(payload) {
  if (!shouldDebugReplayMap()) return;
  console.warn("[replay map sources]", payload);
}

export function createReplayMapController({
  element,
  session,
}) {
  let map = null;
  let ready = false;
  let activeSession = session;
  let playbackState = {
    sample: null,
    playedCoordinates: [],
  };
  let shouldAutoFitOnReady = true;
  let readyPromise = null;
  let resolveReadyPromise = null;
  let approachToken = 0;
  let approachActive = false;
  let initToken = 0;

  function createReadyPromise() {
    readyPromise = new Promise((resolve) => {
      resolveReadyPromise = resolve;
    });
    return readyPromise;
  }

  function resolveReady() {
    if (typeof resolveReadyPromise === "function") {
      resolveReadyPromise();
    }
    resolveReadyPromise = null;
    if (!readyPromise) {
      readyPromise = Promise.resolve();
    }
  }

  function syncMapVignetteMode() {
    if (!element) return;
    const currentZoom = typeof map?.getZoom === "function" ? map.getZoom() : 0;
    element.classList.toggle("replay-map-closeup", Number.isFinite(currentZoom) && currentZoom >= REPLAY_CLOSEUP_ZOOM);
  }

  function updateSolarLayers() {
    if (!map || !ready) return;

    const sunVector = getSunVectorAtTime().vector;
    const terminatorSource = map.getSource(GLOBE_TERMINATOR_SOURCE_ID);
    const nightSource = map.getSource(GLOBE_NIGHT_SOURCE_ID);

    if (terminatorSource && typeof terminatorSource.setData === "function") {
      terminatorSource.setData(getSolarTerminatorData(sunVector));
    }

    if (nightSource && typeof nightSource.setData === "function") {
      nightSource.setData(getSolarNightData(sunVector));
    }
  }

  function updateSources(playback = playbackState) {
    if (!map || !ready) return;

    const routeSource = map.getSource(REPLAY_SOURCE_ID);
    const playedSource = map.getSource(REPLAY_PLAYED_SOURCE_ID);
    const pointSource = map.getSource(REPLAY_POINT_SOURCE_ID);
    const routeData = getLineFeatureCollection(getReplayPathCoordinates(activeSession));
    const playedData = getLineFeatureCollection(playback.playedCoordinates);
    const pointData = getPointFeatureCollection(playback.sample);

    debugReplayMapSources({
      routeData,
      playedData,
      pointData,
    });

    if (routeSource && typeof routeSource.setData === "function") {
      routeSource.setData(routeData);
    }

    if (playedSource && typeof playedSource.setData === "function") {
      playedSource.setData(playedData);
    }

    if (pointSource && typeof pointSource.setData === "function") {
      pointSource.setData(pointData);
    }
  }

  function getSessionMidpoint() {
    const bounds = getReplayBounds(activeSession);
    if (!bounds) return [0, 18];

    return [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2,
    ];
  }

  function fitRoute(options: ReplayMapFitOptions = {}) {
    if (!map || !ready) return;

    const bounds = getReplayBounds(activeSession);
    if (!bounds) {
      if (typeof map.easeTo === "function") {
        map.easeTo({
          center: [0, 18],
          zoom: 0.35,
          pitch: 0,
          bearing: 0,
          duration: options.duration ?? 0,
          essential: true,
        });
      }
      return;
    }

    if (typeof map.fitBounds === "function") {
      map.fitBounds(bounds, {
        padding: options.padding ?? { top: 84, right: 84, bottom: 140, left: 84 },
        pitch: options.pitch ?? 46,
        bearing: options.bearing ?? 10,
        maxZoom: options.maxZoom ?? 15.5,
        duration: options.duration ?? 0,
        essential: true,
      } as any);
      return;
    }

    if (typeof map.easeTo === "function") {
      map.easeTo({
        center: getSessionMidpoint(),
        zoom: options.zoom ?? 4,
        pitch: options.pitch ?? 46,
        bearing: options.bearing ?? 10,
        duration: options.duration ?? 0,
        essential: true,
      });
    }
  }

  function resetCamera() {
    fitRoute({ duration: 0 });
  }

  function stopMapMotion() {
    if (typeof map?.stop === "function") {
      map.stop();
    }
  }

  function cancelApproachAnimation() {
    approachToken += 1;
    if (!approachActive) return;
    approachActive = false;
    stopMapMotion();
  }

  async function runApproachAnimation(options: ReplayMapApproachOptions = {}) {
    if (!map || !ready || !activeSession) return;

    const runToken = approachToken + 1;
    approachToken = runToken;
    approachActive = true;

    const bounds = getReplayBounds(activeSession);
    if (!bounds) {
      approachActive = false;
      resetCamera();
      return;
    }

    stopMapMotion();

    try {
      if (typeof map.jumpTo === "function") {
        map.jumpTo({
          center: [0, 18],
          zoom: 0.35,
          pitch: 0,
          bearing: -14,
        });
      }

      const midpoint = getSessionMidpoint();

      if (typeof map.easeTo === "function") {
        map.easeTo({
          center: midpoint,
          zoom: 1.3,
          pitch: 8,
          bearing: -6,
          duration: 1600,
          essential: true,
        });
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 1600);
      });

      if (runToken !== approachToken || !map || !ready || !activeSession) return;

      fitRoute({
        duration: options.finalDuration ?? 2200,
        pitch: options.finalPitch ?? 56,
        bearing: options.finalBearing ?? 12,
        maxZoom: options.finalMaxZoom ?? 13,
        padding: options.finalPadding,
      });

      await new Promise((resolve) => {
        window.setTimeout(resolve, options.finalDuration ?? 2200);
      });

      if (runToken !== approachToken || !map || !ready) return;

      collapseReplayAttributionControl(element);
    } finally {
      if (runToken === approachToken) {
        approachActive = false;
      }
    }
  }

  function renderPlaybackFrame({ sample = null, playedCoordinates = [] }: { sample?: any; playedCoordinates?: any[] } = {}) {
    playbackState = {
      sample,
      playedCoordinates: Array.isArray(playedCoordinates) ? playedCoordinates : [],
    };
    updateSources(playbackState);
  }

  function resize() {
    if (!map || typeof map.resize !== "function") return;
    map.resize();
    syncMapVignetteMode();
    collapseReplayAttributionControl(element);
  }

  function setSession(nextSession, options: ReplayMapSetSessionOptions = {}) {
    const shouldResetCamera = options.resetCamera !== false;
    const shouldPreservePlayback = options.preservePlayback === true;
    const sessionChanged = nextSession !== activeSession;
    cancelApproachAnimation();
    activeSession = nextSession;
    if (sessionChanged && !shouldPreservePlayback) {
      playbackState = {
        sample: null,
        playedCoordinates: [],
      };
    }
    shouldAutoFitOnReady = shouldResetCamera;

    if (!ready) return;
    updateSources();
    if (shouldResetCamera) {
      resetCamera();
    }
  }

  async function init() {
    if (!element) return Promise.resolve();
    if (ready) return Promise.resolve();
    if (map) return readyPromise ?? Promise.resolve();

    const token = initToken + 1;
    initToken = token;
    createReadyPromise();

    try {
      const maplibregl = await loadMapLibre();
      if (token !== initToken || map || !element) {
        resolveReady();
        return readyPromise ?? Promise.resolve();
      }

      const initialSunVector = getSunVectorAtTime().vector;

      map = new maplibregl.Map({
        container: element,
        antialias: true,
        attributionControl: false,
        center: [0, 18],
        zoom: 0.35,
        pitch: 0,
        bearing: -12,
        style: {
          version: 8,
          projection: {
            type: "globe",
          },
          sources: {
            [REPLAY_BASE_SATELLITE_SOURCE_ID]: {
              type: "raster",
              tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
              attribution: GLOBE_SATELLITE_ATTRIBUTION,
            },
            [REPLAY_DETAIL_SATELLITE_SOURCE_ID]: {
              type: "raster",
              tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              tileSize: 256,
              attribution: REPLAY_DETAIL_SATELLITE_ATTRIBUTION,
            },
            [REPLAY_SOURCE_ID]: {
              type: "geojson",
              data: getLineFeatureCollection(getReplayPathCoordinates(activeSession)) as any,
            },
            [REPLAY_PLAYED_SOURCE_ID]: {
              type: "geojson",
              data: getEmptyFeatureCollection() as any,
            },
            [REPLAY_POINT_SOURCE_ID]: {
              type: "geojson",
              data: getEmptyFeatureCollection() as any,
            },
            [GLOBE_TERMINATOR_SOURCE_ID]: {
              type: "geojson",
              data: getSolarTerminatorData(initialSunVector) as any,
            },
            [GLOBE_NIGHT_SOURCE_ID]: {
              type: "geojson",
              data: getSolarNightData(initialSunVector) as any,
            },
          },
          layers: [
            {
              id: "replay-satellite-base",
              type: "raster",
              source: REPLAY_BASE_SATELLITE_SOURCE_ID,
              paint: {
                "raster-brightness-min": GLOBE_RASTER_BRIGHTNESS_MIN,
                "raster-brightness-max": 1,
                "raster-contrast": GLOBE_RASTER_CONTRAST,
                "raster-opacity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  0, 1,
                  8, 1,
                  11, 0.58,
                  14, 0.1,
                ],
              },
            },
            {
              id: "replay-satellite-detail",
              type: "raster",
              source: REPLAY_DETAIL_SATELLITE_SOURCE_ID,
              paint: {
                "raster-brightness-min": GLOBE_RASTER_BRIGHTNESS_MIN,
                "raster-brightness-max": 1,
                "raster-contrast": GLOBE_RASTER_CONTRAST * 0.8,
                "raster-opacity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  0, 0,
                  8, 0,
                  10.5, 0.24,
                  12.5, 0.82,
                  15, 1,
                ],
              },
            },
            {
              id: "replay-night-fill",
              type: "fill",
              source: GLOBE_NIGHT_SOURCE_ID,
              layout: {
                "fill-sort-key": ["coalesce", ["get", "sortKey"], 0],
              },
              paint: {
                "fill-antialias": false,
                "fill-color": ["coalesce", ["get", "color"], "#050d18"],
                "fill-opacity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  0, ["coalesce", ["get", "opacity"], 0],
                  10.5, ["coalesce", ["get", "opacity"], 0],
                  REPLAY_CLOSEUP_ZOOM, 0,
                ],
              },
            },
            {
              id: "replay-terminator",
              type: "line",
              source: GLOBE_TERMINATOR_SOURCE_ID,
              layout: {
                "line-cap": "round",
                "line-join": "round",
              },
              paint: {
                "line-color": "#fef3c7",
                "line-opacity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  0, 0.55,
                  10.5, 0.55,
                  REPLAY_CLOSEUP_ZOOM, 0,
                ],
                "line-width": 1.2,
              },
            },
            {
              id: "replay-route-base",
              type: "line",
              source: REPLAY_SOURCE_ID,
              layout: {
                "line-cap": "round",
                "line-join": "round",
              },
              paint: {
                "line-color": "#fb7185",
                "line-opacity": 0.5,
                "line-width": 4.2,
              },
            },
            {
              id: "replay-route-played",
              type: "line",
              source: REPLAY_PLAYED_SOURCE_ID,
              layout: {
                "line-cap": "round",
                "line-join": "round",
              },
              paint: {
                "line-color": "#34d399",
                "line-opacity": 0.94,
                "line-width": 4.8,
              },
            },
            {
              id: "replay-point-glow",
              type: "circle",
              source: REPLAY_POINT_SOURCE_ID,
              paint: {
                "circle-radius": 15,
                "circle-color": "#34d399",
                "circle-opacity": 0.24,
                "circle-blur": 0.6,
              },
            },
            {
              id: "replay-point-core",
              type: "circle",
              source: REPLAY_POINT_SOURCE_ID,
              paint: {
                "circle-radius": 5.4,
                "circle-color": "#34d399",
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
              },
            },
          ],
          sky: {
            "sky-color": GLOBE_SKY_COLOR,
            "horizon-color": GLOBE_HORIZON_COLOR,
            "sky-horizon-blend": GLOBE_SKY_HORIZON_BLEND,
            "atmosphere-blend": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0, 1,
              5, 1,
              7, 0,
            ],
          },
        },
      } as any);

      if (shouldEnableWheelZoom()) {
        map.scrollZoom?.enable?.();
      } else {
        map.scrollZoom?.disable?.();
      }
      map.boxZoom.disable();
      map.doubleClickZoom.disable();
      map.keyboard.disable();
      map.addControl(new maplibregl.AttributionControl({ compact: true }));
      syncMapVignetteMode();

      map.on("load", () => {
        ready = true;
        updateSolarLayers();
        updateSources();
        if (shouldAutoFitOnReady) {
          resetCamera();
        }
        syncMapVignetteMode();
        collapseReplayAttributionControl(element);
        resolveReady();
      });

      map.on("move", () => {
        syncMapVignetteMode();
      });

      map.on("moveend", () => {
        syncMapVignetteMode();
        collapseReplayAttributionControl(element);
      });

      map.on("resize", () => {
        syncMapVignetteMode();
        collapseReplayAttributionControl(element);
      });
    } catch (error) {
      console.error("Failed to initialize replay map", error);
      ready = false;
      resolveReady();
    }

    return readyPromise ?? Promise.resolve();
  }

  function destroy() {
    initToken += 1;
    cancelApproachAnimation();
    resolveReady();
    if (!map) return;
    if (typeof map.remove === "function") {
      map.remove();
    }
    element?.classList.remove("replay-map-closeup");
    map = null;
    ready = false;
    readyPromise = null;
    resolveReadyPromise = null;
  }

  return {
    cancelApproachAnimation,
    destroy,
    fitRoute,
    init,
    renderPlaybackFrame,
    resetCamera,
    resize,
    runApproachAnimation,
    setSession,
  };
}
