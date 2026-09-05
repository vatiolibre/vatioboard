export const CAMERA_MAP_BASEMAP_STORAGE_KEY = "vatioboard:camera-map:basemap";
export const CAMERA_MAP_BASEMAP_AUTO_ID = "auto";
export const CAMERA_MAP_BASEMAP_SOURCE_ID = "camera-map-basemap";
export const CAMERA_MAP_BASEMAP_LAYER_ID = "camera-map-basemap-layer";
export const CAMERA_MAP_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
export const DEFAULT_CAMERA_MAP_BASEMAP_ID = "openfreemap-liberty";
export const DEFAULT_CAMERA_MAP_DARK_BASEMAP_ID = "openfreemap-dark";

interface CameraMapBasemapBase {
  id: string;
  label: string;
  labelKey: string;
  attribution: string;
  attributionKey: string;
  attributionUrl: string;
}

interface CameraMapVectorBasemap extends CameraMapBasemapBase {
  kind: "vector-style";
  styleUrl: string;
}

interface CameraMapRasterBasemap extends CameraMapBasemapBase {
  kind: "raster";
  type: "raster";
  tiles: string[];
  tileSize: number;
  maxzoom: number;
}

type CameraMapBasemap = CameraMapVectorBasemap | CameraMapRasterBasemap;
type CameraMapStyle = Record<string, any>;

const CAMERA_MAP_GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const MISSING_OPEN_FREE_MAP_IMAGES = new Set(["wood-pattern"]);
const NUMERIC_COMPARISONS = new Set(["<", "<=", ">", ">="]);
const LEGACY_CAMERA_MAP_BASEMAP_IDS: Record<string, string> = {
  "carto-voyager": "openfreemap-liberty",
  "carto-positron": "openfreemap-positron",
  "carto-dark-matter": "openfreemap-dark",
};
const openFreeMapStyleCache = new Map<string, Promise<CameraMapStyle | string>>();

export const CAMERA_MAP_BASEMAPS: CameraMapBasemap[] = [
  {
    id: "openfreemap-liberty",
    label: "Liberty",
    labelKey: "cameraMapLayerLiberty",
    kind: "vector-style",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
    attributionKey: "cameraMapAttributionOpenFreeMap",
    attributionUrl: "https://openfreemap.org/",
  },
  {
    id: "osm-standard",
    label: "Standard",
    labelKey: "cameraMapLayerStandard",
    kind: "raster",
    type: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 19,
    attribution: "© OpenStreetMap contributors",
    attributionKey: "cameraMapAttributionOsm",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
  {
    id: "openfreemap-positron",
    label: "Light",
    labelKey: "cameraMapLayerLight",
    kind: "vector-style",
    styleUrl: "https://tiles.openfreemap.org/styles/positron",
    attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
    attributionKey: "cameraMapAttributionOpenFreeMap",
    attributionUrl: "https://openfreemap.org/",
  },
  {
    id: "openfreemap-dark",
    label: "Dark",
    labelKey: "cameraMapLayerDark",
    kind: "vector-style",
    styleUrl: "https://tiles.openfreemap.org/styles/dark",
    attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
    attributionKey: "cameraMapAttributionOpenFreeMap",
    attributionUrl: "https://openfreemap.org/",
  },
  {
    id: "opentopomap",
    label: "Topo",
    labelKey: "cameraMapLayerTopo",
    kind: "raster",
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
    kind: "raster",
    type: "raster",
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    attributionKey: "cameraMapAttributionEsri",
    attributionUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
  },
];

export function normalizeCameraMapBasemapId(id) {
  if (typeof id !== "string") return null;
  const normalizedId = LEGACY_CAMERA_MAP_BASEMAP_IDS[id] || id;
  return CAMERA_MAP_BASEMAPS.some((basemap) => basemap.id === normalizedId)
    ? normalizedId
    : null;
}

export function getCameraMapBasemap(id) {
  const normalizedId = normalizeCameraMapBasemapId(id);
  return CAMERA_MAP_BASEMAPS.find((basemap) => basemap.id === normalizedId)
    || CAMERA_MAP_BASEMAPS.find((basemap) => basemap.id === getDefaultCameraMapBasemapId())
    || CAMERA_MAP_BASEMAPS[0];
}

export function isCameraMapBasemapId(id) {
  return normalizeCameraMapBasemapId(id) !== null;
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

function isGetExpression(value) {
  return Array.isArray(value) && value[0] === "get" && typeof value[1] === "string";
}

function sanitizeFilterExpression(value) {
  if (!Array.isArray(value)) return value;
  const expression = value.map((entry, index) => (
    index === 0 ? entry : sanitizeFilterExpression(entry)
  ));
  if (!NUMERIC_COMPARISONS.has(expression[0])) return expression;
  const numericGets = expression.slice(1, 3).filter(isGetExpression);
  if (!numericGets.length) return expression;
  const typeChecks = numericGets.map((entry) => ["==", ["typeof", entry], "number"]);
  const condition = typeChecks.length === 1 ? typeChecks[0] : ["all", ...typeChecks];
  return ["case", condition, expression, false];
}

function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style));
}

function sanitizeMissingStyleImages(layer) {
  const fillPattern = layer?.paint?.["fill-pattern"];
  if (!MISSING_OPEN_FREE_MAP_IMAGES.has(fillPattern)) return layer;
  const paint = { ...layer.paint };
  delete paint["fill-pattern"];
  return { ...layer, paint };
}

export function sanitizeOpenFreeMapStyle(style) {
  const cloned = style && typeof style === "object" && !Array.isArray(style)
    ? cloneStyle(style)
    : {};
  cloned.layers = Array.isArray(cloned.layers)
    ? cloned.layers.map((layer) => sanitizeMissingStyleImages({
        ...layer,
        ...(Array.isArray(layer?.filter)
          ? { filter: sanitizeFilterExpression(layer.filter) }
          : {}),
      }))
    : [];
  return cloned;
}

function isValidMapStyle(style) {
  return Boolean(
    style
    && typeof style === "object"
    && style.version === 8
    && style.sources
    && typeof style.sources === "object"
    && Array.isArray(style.layers),
  );
}

function createRasterCameraMapStyle(basemap) {
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

export function createCameraMapStyle(basemapInput) {
  const basemap = typeof basemapInput === "string"
    ? getCameraMapBasemap(basemapInput)
    : getCameraMapBasemap(basemapInput?.id);
  return basemap.kind === "vector-style"
    ? basemap.styleUrl
    : createRasterCameraMapStyle(basemap);
}

export async function loadCameraMapStyle(basemapInput) {
  const basemap = typeof basemapInput === "string"
    ? getCameraMapBasemap(basemapInput)
    : getCameraMapBasemap(basemapInput?.id);
  if (basemap.kind !== "vector-style") return createRasterCameraMapStyle(basemap);

  if (!openFreeMapStyleCache.has(basemap.styleUrl)) {
    const stylePromise = fetch(basemap.styleUrl, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Map style request failed (${response.status}).`);
      const style = sanitizeOpenFreeMapStyle(await response.json());
      if (!isValidMapStyle(style)) throw new Error("Map style response is invalid.");
      return style;
    }).catch(() => basemap.styleUrl);
    openFreeMapStyleCache.set(basemap.styleUrl, stylePromise);
  }

  const cachedStyle = await openFreeMapStyleCache.get(basemap.styleUrl);
  return typeof cachedStyle === "string" ? cachedStyle : cloneStyle(cachedStyle);
}
