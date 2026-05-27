export const CAMERA_MAP_BASEMAP_STORAGE_KEY = "vatioboard:camera-map:basemap";
export const CAMERA_MAP_BASEMAP_AUTO_ID = "auto";
export const CAMERA_MAP_BASEMAP_SOURCE_ID = "camera-map-basemap";
export const CAMERA_MAP_BASEMAP_LAYER_ID = "camera-map-basemap-layer";
export const CAMERA_MAP_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
export const DEFAULT_CAMERA_MAP_BASEMAP_ID = "carto-voyager";
export const DEFAULT_CAMERA_MAP_DARK_BASEMAP_ID = "carto-dark-matter";

const CAMERA_MAP_GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

export const CAMERA_MAP_BASEMAPS = [
  {
    id: "carto-voyager",
    label: "Voyager",
    labelKey: "cameraMapLayerVoyager",
    type: "raster",
    tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 20,
    attribution: "© OpenStreetMap contributors © CARTO",
    attributionKey: "cameraMapAttributionCarto",
    attributionUrl: "https://carto.com/attribution",
  },
  {
    id: "osm-standard",
    label: "Standard",
    labelKey: "cameraMapLayerStandard",
    type: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 19,
    attribution: "© OpenStreetMap contributors",
    attributionKey: "cameraMapAttributionOsm",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
  {
    id: "carto-positron",
    label: "Light",
    labelKey: "cameraMapLayerLight",
    type: "raster",
    tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 20,
    attribution: "© OpenStreetMap contributors © CARTO",
    attributionKey: "cameraMapAttributionCarto",
    attributionUrl: "https://carto.com/attribution",
  },
  {
    id: "carto-dark-matter",
    label: "Dark",
    labelKey: "cameraMapLayerDark",
    type: "raster",
    tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 20,
    attribution: "© OpenStreetMap contributors © CARTO",
    attributionKey: "cameraMapAttributionCarto",
    attributionUrl: "https://carto.com/attribution",
  },
  {
    id: "opentopomap",
    label: "Topo",
    labelKey: "cameraMapLayerTopo",
    type: "raster",
    tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 17,
    attribution: "© OpenStreetMap contributors, SRTM | style © OpenTopoMap",
    attributionKey: "cameraMapAttributionOpenTopo",
    attributionUrl: "https://opentopomap.org/about",
  },
  {
    id: "esri-world-imagery",
    label: "Imagery",
    labelKey: "cameraMapLayerImagery",
    type: "raster",
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    attributionKey: "cameraMapAttributionEsri",
    attributionUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
  },
];

export function getCameraMapBasemap(id) {
  return CAMERA_MAP_BASEMAPS.find((basemap) => basemap.id === id)
    || CAMERA_MAP_BASEMAPS.find((basemap) => basemap.id === getDefaultCameraMapBasemapId())
    || CAMERA_MAP_BASEMAPS[0];
}

export function isCameraMapBasemapId(id) {
  return CAMERA_MAP_BASEMAPS.some((basemap) => basemap.id === id);
}

export function getDefaultCameraMapBasemapId() {
  try {
    if (typeof globalThis.matchMedia === "function"
      && globalThis.matchMedia(CAMERA_MAP_COLOR_SCHEME_QUERY).matches) {
      return DEFAULT_CAMERA_MAP_DARK_BASEMAP_ID;
    }
  } catch {
    // Fall through to the light default if media queries are unavailable.
  }
  return DEFAULT_CAMERA_MAP_BASEMAP_ID;
}

export function createCameraMapStyle(basemapInput) {
  const basemap = typeof basemapInput === "string"
    ? getCameraMapBasemap(basemapInput)
    : getCameraMapBasemap(basemapInput?.id);

  return {
    version: 8,
    glyphs: CAMERA_MAP_GLYPHS_URL,
    sources: {
      [CAMERA_MAP_BASEMAP_SOURCE_ID]: {
        type: basemap.type,
        tiles: basemap.tiles,
        tileSize: basemap.tileSize,
        attribution: basemap.attribution,
        maxzoom: basemap.maxzoom,
      },
    },
    layers: [
      {
        id: CAMERA_MAP_BASEMAP_LAYER_ID,
        type: "raster",
        source: CAMERA_MAP_BASEMAP_SOURCE_ID,
      },
    ],
  };
}
