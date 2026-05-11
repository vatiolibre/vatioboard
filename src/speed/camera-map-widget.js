import { t } from "../i18n.js";
import {
  IconClose,
  IconFullscreen,
  IconFullscreenExit,
  IconGpsLab,
  IconRestart,
  IconWorld,
} from "../icons.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import { registerFloatingPanel } from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import { loadMapLibre } from "../shared/maplibre-loader.js";
import {
  createCameraMapDataSource,
} from "./camera-map-data-source.js";
import {
  CAMERA_MAP_BASEMAP_AUTO_ID,
  CAMERA_MAP_BASEMAP_STORAGE_KEY,
  CAMERA_MAP_BASEMAPS,
  CAMERA_MAP_COLOR_SCHEME_QUERY,
  createCameraMapStyle,
  getDefaultCameraMapBasemapId,
  getCameraMapBasemap,
  isCameraMapBasemapId,
} from "./camera-map-layers.js";
import { loadDistanceUnitPreference, loadUnitPreference } from "./preferences.js";
import { formatCameraLimitSpeed } from "./render.js";
import { formatTrapDistance } from "./traps.js";

export const CAMERA_MAP_WINDOW_ID = "camera-map";

const CAMERA_SOURCE_ID = "camera-map-cameras";
const CAMERA_CLUSTER_LAYER_ID = "camera-map-camera-clusters";
const CAMERA_CLUSTER_COUNT_LAYER_ID = "camera-map-camera-cluster-count";
const CAMERA_POINT_LAYER_ID = "camera-map-camera-points";
const POS_KEY = "camera_map_widget_pos_v1";
const VISIBILITY_KEY = "camera_map_widget_visible_v1";
const DRAG_THRESHOLD_PX = 6;
const DEFAULT_CENTER = [0, 20];
const DEFAULT_ZOOM = 1.5;

function getEmptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function createElement(tagName, attributes = {}, children = []) {
  const element = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "html") element.innerHTML = value;
    else if (value !== null && value !== undefined) element.setAttribute(key, String(value));
  }
  element.append(...children.filter(Boolean));
  return element;
}

function normalizePosition(value) {
  const coords = value?.coords || value || {};
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readPopupNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPopupDistance(distanceM, distanceUnit) {
  if (!Number.isFinite(distanceM)) return null;
  const distance = formatTrapDistance(distanceM, distanceUnit, "");
  return `${distance.value} ${distance.unit}`.trim();
}

function parsePopupSources(value) {
  if (Array.isArray(value)) return value.map((source) => String(source).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsePopupSources(parsed);
    } catch {
      return [];
    }
  }
  return String(value || "")
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean);
}

function getPopupSourceLabel(props = {}) {
  const sourceMeta = props.sourceMeta && typeof props.sourceMeta === "object" ? props.sourceMeta : null;
  const sources = parsePopupSources(props.cameraSources?.length ? props.cameraSources : sourceMeta?.sources);
  const labels = [];
  if (sources.includes("osm")) labels.push("OSM");
  if (sources.includes("ansv")) labels.push("ANSV official");
  if (sources.includes("nyc")) labels.push("NYC local");
  if (!labels.length) {
    const primary = String(props.primarySource || sourceMeta?.primarySource || "").trim();
    if (primary === "ansv") labels.push("ANSV official");
    else if (primary === "nyc") labels.push("NYC local");
    else if (primary === "osm") labels.push("OSM");
  }
  return labels.length ? labels.join(" + ") : null;
}

export function buildPopupHtml(feature, options = {}) {
  const {
    unit = loadUnitPreference(),
    distanceUnit = loadDistanceUnitPreference(),
  } = options;
  const props = feature?.properties || {};
  const speed = readPopupNumber(props.speedKph);
  const speedSource = String(props.speedSource || "");
  const isInferred = speedSource.startsWith("nearest_road:");
  const distanceM = readPopupNumber(props.distanceM);
  const speedLabel = formatCameraLimitSpeed(speed, unit);
  const roadDistanceLabel = formatPopupDistance(distanceM, distanceUnit);
  const sourceLabel = getPopupSourceLabel(props);
  const speedRow = Number.isFinite(speed)
    ? [
      isInferred ? "Estimated limit" : "Speed limit",
      isInferred
        ? `${speedLabel} from nearby OSM road`
        : speedLabel,
    ]
    : ["Speed limit", "Unknown"];
  const rows = [
    speedRow,
    ...(Number.isFinite(speed) && isInferred && roadDistanceLabel
      ? [["Road distance", roadDistanceLabel]]
      : []),
    ...(sourceLabel ? [["Source", sourceLabel]] : []),
    ["Country", props.countryName || props.country || "Unknown"],
    ["Tile", props.tile || "country"],
    ["OSM id", props.osmId || "unknown"],
  ];
  return `
    <div class="camera-map-popup">
      <strong>Speed camera</strong>
      ${rows.map(([label, value]) => `
        <span>
          <b>${escapeHtml(label)}</b>
          <em>${escapeHtml(value)}</em>
        </span>
      `).join("")}
    </div>
  `;
}

function getStatusMessage(status = {}) {
  if (status.status === "loading-manifest") return t("cameraMapLoading");
  if (status.status === "loading-cameras") return t("cameraMapLoadingCameras");
  if (status.status === "waiting-zoom") return t("cameraMapZoomIn");
  if (status.status === "offline-cached") return t("cameraMapOfflineCached");
  if (status.status === "ready") return t("cameraMapReady", { count: status.featureCount || 0 });
  if (status.status === "unavailable" || status.status === "error") return t("cameraMapUnavailable");
  return t("cameraMapLoading");
}

function getInitialView(getCurrentPosition) {
  const currentPosition = normalizePosition(getCurrentPosition?.());
  if (currentPosition) {
    return {
      center: [currentPosition.longitude, currentPosition.latitude],
      zoom: 12,
    };
  }
  return {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  };
}

function pxToNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadBasemapPreference() {
  try {
    return localStorage.getItem(CAMERA_MAP_BASEMAP_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveBasemapPreference(basemapId) {
  try {
    localStorage.setItem(CAMERA_MAP_BASEMAP_STORAGE_KEY, basemapId);
  } catch {
    // Basemap persistence is convenience only.
  }
}

function clearBasemapPreference() {
  try {
    localStorage.removeItem(CAMERA_MAP_BASEMAP_STORAGE_KEY);
  } catch {
    // Basemap persistence is convenience only.
  }
}

function createBasemapSelect(selectedBasemapId, { auto = false } = {}) {
  const select = createElement("select", {
    class: "camera-map-layer-select",
    "aria-label": t("cameraMapLayers"),
    title: t("cameraMapLayers"),
    "data-i18n-aria": "cameraMapLayers",
    "data-i18n-title": "cameraMapLayers",
  });

  const autoOption = createElement("option", {
    value: CAMERA_MAP_BASEMAP_AUTO_ID,
    text: t("cameraMapLayerAuto"),
    "data-i18n": "cameraMapLayerAuto",
  });
  autoOption.selected = auto;
  select.appendChild(autoOption);

  for (const basemap of CAMERA_MAP_BASEMAPS) {
    const option = createElement("option", {
      value: basemap.id,
      text: t(basemap.labelKey),
      "data-i18n": basemap.labelKey,
    });
    option.selected = !auto && basemap.id === selectedBasemapId;
    select.appendChild(option);
  }

  return select;
}

function buildPanel(selectedBasemapId, { autoBasemap = false } = {}) {
  const title = createElement("span", {
    class: "camera-map-title",
    text: t("cameraMapTitle"),
    "data-i18n": "cameraMapTitle",
  });

  const fullscreenBtn = createElement("button", {
    type: "button",
    class: "camera-map-action camera-map-fullscreen",
    "aria-label": t("cameraMapFullscreen"),
    title: t("cameraMapFullscreen"),
    "data-i18n-aria": "cameraMapFullscreen",
    "data-i18n-title": "cameraMapFullscreen",
    html: `<span class="btn-icon">${IconFullscreen}</span>`,
  });

  const closeBtn = createElement("button", {
    type: "button",
    class: "camera-map-action camera-map-close",
    "aria-label": t("closeCameraMap"),
    title: t("closeCameraMap"),
    "data-i18n-aria": "closeCameraMap",
    "data-i18n-title": "closeCameraMap",
    html: IconClose,
  });

  const actions = createElement("div", { class: "camera-map-actions" }, [
    fullscreenBtn,
    closeBtn,
  ]);
  const header = createElement("div", { class: "camera-map-header" }, [
    title,
    actions,
  ]);

  const recenterBtn = createElement("button", {
    type: "button",
    class: "camera-map-toolbar-btn",
    "aria-label": t("cameraMapRecenter"),
    title: t("cameraMapRecenter"),
    "data-i18n-aria": "cameraMapRecenter",
    "data-i18n-title": "cameraMapRecenter",
    html: IconGpsLab,
  });

  const refreshBtn = createElement("button", {
    type: "button",
    class: "camera-map-toolbar-btn",
    "aria-label": t("cameraMapRefreshArea"),
    title: t("cameraMapRefreshArea"),
    "data-i18n-aria": "cameraMapRefreshArea",
    "data-i18n-title": "cameraMapRefreshArea",
    html: IconRestart,
  });

  const statusEl = createElement("p", {
    class: "camera-map-status",
    role: "status",
    "aria-live": "polite",
    text: t("cameraMapLoading"),
  });

  const mapEl = createElement("div", {
    class: "camera-map-container",
    "aria-label": t("cameraMapTitle"),
  });
  const layerSelect = createBasemapSelect(selectedBasemapId, { auto: autoBasemap });
  const layerControl = createElement("div", {
    class: "camera-map-layer-control",
    title: t("cameraMapLayers"),
    "data-i18n-title": "cameraMapLayers",
  }, [
    createElement("span", {
      class: "camera-map-layer-icon",
      "aria-hidden": "true",
      html: IconWorld,
    }),
    layerSelect,
  ]);
  const overlayControls = createElement("div", { class: "camera-map-overlay-controls" }, [
    recenterBtn,
    refreshBtn,
    layerControl,
  ]);
  const topOverlay = createElement("div", {
    class: "camera-map-overlay camera-map-overlay--top",
  }, [
    overlayControls,
    statusEl,
  ]);
  const activeBasemap = getCameraMapBasemap(selectedBasemapId);
  const attribution = createElement("a", {
    class: "camera-map-attribution",
    href: activeBasemap.attributionUrl,
    target: "_blank",
    rel: "noopener noreferrer",
    text: t(activeBasemap.attributionKey),
    "data-i18n": activeBasemap.attributionKey,
  });
  const privacy = createElement("span", {
    class: "camera-map-privacy",
    text: t("cameraMapLocalLookup"),
    "data-i18n": "cameraMapLocalLookup",
  });
  const bottomOverlay = createElement("div", {
    class: "camera-map-overlay camera-map-overlay--bottom",
  }, [
    attribution,
    privacy,
  ]);
  const body = createElement("div", { class: "camera-map-body" }, [mapEl, topOverlay, bottomOverlay]);
  const panel = createElement("section", {
    class: "camera-map-panel",
    "aria-label": t("cameraMapTitle"),
    "data-vb-floating-panel": "",
  }, [header, body]);
  panel.hidden = true;

  return {
    panel,
    header,
    closeBtn,
    fullscreenBtn,
    recenterBtn,
    refreshBtn,
    statusEl,
    mapEl,
    layerSelect,
    attribution,
  };
}

export function createCameraMapWidget(options = {}) {
  const {
    mount = document.body,
    floating = false,
    button = null,
    restoreVisibility = false,
    persistVisibility = false,
    visibilityKey = VISIBILITY_KEY,
    shellManager = getDefaultShellWindowManager(),
    getCurrentPosition = null,
    getCameraDatabase = null,
    dataSource = null,
  } = options;

  const storedBasemapId = loadBasemapPreference();
  let hasUserBasemapPreference = isCameraMapBasemapId(storedBasemapId);
  let activeBasemap = getCameraMapBasemap(hasUserBasemapPreference
    ? storedBasemapId
    : getDefaultCameraMapBasemapId());
  const refs = buildPanel(activeBasemap.id, { autoBasemap: !hasUserBasemapPreference });
  const {
    panel,
    header,
    closeBtn,
    fullscreenBtn,
    recenterBtn,
    refreshBtn,
    statusEl,
    mapEl,
    layerSelect,
    attribution,
  } = refs;

  const cameraDataSource = dataSource || createCameraMapDataSource({
    getCameraDatabase,
    onStatusChange: (nextStatus) => updateStatus(nextStatus),
  });

  let cleanupLayer = () => {};
  let maplibregl = null;
  let map = null;
  let mapReady = false;
  let initPromise = null;
  let resolveReadyPromise = null;
  let readyPromise = null;
  let destroyed = false;
  let refreshController = null;
  let refreshTimer = 0;
  let fullscreenResizeTimer = 0;
  let isNativeFullscreen = false;
  let isFallbackFullscreen = false;
  let currentCameraFeatures = [];
  let cameraLayerEventsBound = false;
  let basemapSwitchInProgress = false;
  let basemapStyleVersion = 0;
  let suppressViewportRefresh = false;
  let resizeObserver = null;
  let colorSchemeMediaQuery = null;
  let cleanupColorSchemeListener = () => {};
  let preFullscreenWidth = null;
  let preFullscreenHeight = null;
  let preFullscreenLeft = null;
  let preFullscreenTop = null;

  function loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePos(pos) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // Position persistence is convenience only.
    }
    if (pos?.panel?.left && pos?.panel?.top) {
      shellManager.updateWindowBounds(CAMERA_MAP_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
      }, {
        preserveSnap: Boolean(shellManager.getWindow(CAMERA_MAP_WINDOW_ID)?.snap),
      });
    }
  }

  function loadVisibility() {
    if (!restoreVisibility) return false;
    try {
      return localStorage.getItem(visibilityKey) === "open";
    } catch {
      return false;
    }
  }

  function saveVisibility(open) {
    if (!persistVisibility) return;
    try {
      localStorage.setItem(visibilityKey, open ? "open" : "closed");
    } catch {
      // ignore
    }
  }

  function updateStatus(nextStatus = cameraDataSource.getStatus?.()) {
    const safeStatus = nextStatus || {};
    statusEl.textContent = getStatusMessage(safeStatus);
    statusEl.dataset.status = safeStatus.status || "idle";
  }

  function updateBasemapUi(basemap = activeBasemap) {
    const layerSelectValue = hasUserBasemapPreference
      ? basemap.id
      : CAMERA_MAP_BASEMAP_AUTO_ID;
    if (layerSelect.value !== layerSelectValue) {
      layerSelect.value = layerSelectValue;
    }
    attribution.href = basemap.attributionUrl;
    attribution.textContent = t(basemap.attributionKey);
    attribution.dataset.i18n = basemap.attributionKey;
  }

  function createReadyPromise() {
    readyPromise = new Promise((resolve) => {
      resolveReadyPromise = resolve;
    });
    return readyPromise;
  }

  function resolveReady() {
    resolveReadyPromise?.();
    resolveReadyPromise = null;
    if (!readyPromise) readyPromise = Promise.resolve();
  }

  function resizeMap() {
    if (!map || panel.hidden) return;
    try {
      map.resize?.();
    } catch {
      // Resize is best effort across synthetic test maps.
    }
  }

  function readMapView() {
    if (!map) return null;
    const centerValue = map.getCenter?.();
    const center = Array.isArray(centerValue)
      ? centerValue
      : Number.isFinite(Number(centerValue?.lng)) && Number.isFinite(Number(centerValue?.lat))
        ? [Number(centerValue.lng), Number(centerValue.lat)]
        : null;
    const zoom = Number(map.getZoom?.());
    const bearing = Number(map.getBearing?.());
    const pitch = Number(map.getPitch?.());
    return {
      ...(center ? { center } : {}),
      ...(Number.isFinite(zoom) ? { zoom } : {}),
      ...(Number.isFinite(bearing) ? { bearing } : {}),
      ...(Number.isFinite(pitch) ? { pitch } : {}),
    };
  }

  function restoreMapView(view) {
    if (!map?.jumpTo || !view || Object.keys(view).length === 0) return;
    suppressViewportRefresh = true;
    try {
      map.jumpTo(view);
    } catch {
      // The map will usually preserve camera state across setStyle anyway.
    } finally {
      window.setTimeout(() => {
        suppressViewportRefresh = false;
      }, 0);
    }
  }

  function onceMapEvent(eventName, handler) {
    if (!map?.on) return;
    if (typeof map.once === "function") {
      map.once(eventName, handler);
      return;
    }
    const wrapped = (...args) => {
      map?.off?.(eventName, wrapped);
      handler(...args);
    };
    map.on(eventName, wrapped);
  }

  function startResizeObserver() {
    if (resizeObserver || typeof ResizeObserver !== "function") return;
    resizeObserver = new ResizeObserver(() => resizeMap());
    resizeObserver.observe(panel);
    resizeObserver.observe(mapEl);
  }

  function stopResizeObserver() {
    resizeObserver?.disconnect?.();
    resizeObserver = null;
  }

  function startColorSchemeListener() {
    if (typeof globalThis.matchMedia !== "function") return;

    try {
      colorSchemeMediaQuery = globalThis.matchMedia(CAMERA_MAP_COLOR_SCHEME_QUERY);
    } catch {
      colorSchemeMediaQuery = null;
      return;
    }

    const handleColorSchemeChange = () => {
      if (destroyed || hasUserBasemapPreference) return;
      switchBasemap(getDefaultCameraMapBasemapId(), { persist: false });
    };

    if (typeof colorSchemeMediaQuery.addEventListener === "function") {
      colorSchemeMediaQuery.addEventListener("change", handleColorSchemeChange);
      cleanupColorSchemeListener = () => {
        colorSchemeMediaQuery?.removeEventListener?.("change", handleColorSchemeChange);
        colorSchemeMediaQuery = null;
      };
      return;
    }

    if (typeof colorSchemeMediaQuery.addListener === "function") {
      colorSchemeMediaQuery.addListener(handleColorSchemeChange);
      cleanupColorSchemeListener = () => {
        colorSchemeMediaQuery?.removeListener?.(handleColorSchemeChange);
        colorSchemeMediaQuery = null;
      };
    }
  }

  function isFullscreenActive() {
    return isNativeFullscreen || isFallbackFullscreen;
  }

  function updateFullscreenButton() {
    const active = isFullscreenActive();
    const label = active ? t("cameraMapExitFullscreen") : t("cameraMapFullscreen");
    const iconEl = fullscreenBtn.querySelector(".btn-icon");
    if (iconEl) iconEl.innerHTML = active ? IconFullscreenExit : IconFullscreen;
    fullscreenBtn.setAttribute("aria-label", label);
    fullscreenBtn.setAttribute("title", label);
    fullscreenBtn.dataset.fullscreen = active ? "true" : "false";
  }

  function savePreFullscreenGeometry() {
    if (preFullscreenWidth && preFullscreenHeight) return;
    const rect = panel.getBoundingClientRect();
    preFullscreenWidth = Math.round(rect.width || pxToNumber(panel.style.width, 720));
    preFullscreenHeight = Math.round(rect.height || pxToNumber(panel.style.height, 520));
    preFullscreenLeft = panel.style.left || `${Math.round(rect.left || 18)}px`;
    preFullscreenTop = panel.style.top || `${Math.round(rect.top || 78)}px`;
  }

  function restorePreFullscreenGeometry() {
    if (preFullscreenWidth && preFullscreenHeight) {
      panel.style.width = `${preFullscreenWidth}px`;
      panel.style.height = `${preFullscreenHeight}px`;
    }
    if (preFullscreenLeft && preFullscreenTop) {
      panel.style.left = preFullscreenLeft;
      panel.style.top = preFullscreenTop;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    preFullscreenWidth = null;
    preFullscreenHeight = null;
    preFullscreenLeft = null;
    preFullscreenTop = null;
  }

  function resizeAfterFullscreenTransition() {
    resizeMap();
    window.clearTimeout(fullscreenResizeTimer);
    fullscreenResizeTimer = window.setTimeout(() => {
      resizeMap();
      queueRefresh();
    }, 120);
  }

  function enterFallbackFullscreen() {
    savePreFullscreenGeometry();
    isFallbackFullscreen = true;
    panel.classList.add("is-fullscreen", "is-window-fullscreen");
    updateFullscreenButton();
    resizeAfterFullscreenTransition();
  }

  function exitFallbackFullscreen({ restore = true } = {}) {
    if (!isFallbackFullscreen) return;
    isFallbackFullscreen = false;
    panel.classList.remove("is-window-fullscreen");
    if (!isNativeFullscreen) {
      panel.classList.remove("is-fullscreen");
      if (restore) restorePreFullscreenGeometry();
    }
    updateFullscreenButton();
    resizeAfterFullscreenTransition();
  }

  async function enterFullscreen() {
    savePreFullscreenGeometry();
    if (typeof panel.requestFullscreen === "function") {
      try {
        await panel.requestFullscreen();
        if (document.fullscreenElement === panel) {
          isNativeFullscreen = true;
          isFallbackFullscreen = false;
          panel.classList.add("is-fullscreen");
          panel.classList.remove("is-window-fullscreen");
          updateFullscreenButton();
          resizeAfterFullscreenTransition();
          return;
        }
      } catch {
        // Fall back to a fixed viewport-sized shell window.
      }
    }
    enterFallbackFullscreen();
  }

  async function exitFullscreenMode() {
    if (isFallbackFullscreen) {
      exitFallbackFullscreen();
      return;
    }
    if (document.fullscreenElement === panel && typeof document.exitFullscreen === "function") {
      try {
        await document.exitFullscreen();
      } catch {
        // Manual state reset below keeps the shell usable if the browser rejects.
      }
    }
    if (isNativeFullscreen) {
      isNativeFullscreen = false;
      panel.classList.remove("is-fullscreen");
      restorePreFullscreenGeometry();
      updateFullscreenButton();
      resizeAfterFullscreenTransition();
    }
  }

  async function toggleFullscreen() {
    if (isFullscreenActive() || document.fullscreenElement === panel) {
      await exitFullscreenMode();
      return;
    }
    await enterFullscreen();
  }

  function onFullscreenChange() {
    const wasNativeFullscreen = isNativeFullscreen;
    isNativeFullscreen = document.fullscreenElement === panel;
    if (isNativeFullscreen) {
      isFallbackFullscreen = false;
      panel.classList.remove("is-window-fullscreen");
    }
    panel.classList.toggle("is-fullscreen", isNativeFullscreen || isFallbackFullscreen);
    if (wasNativeFullscreen && !isNativeFullscreen && !isFallbackFullscreen) {
      restorePreFullscreenGeometry();
    }
    updateFullscreenButton();
    resizeAfterFullscreenTransition();
  }

  function exitFullscreenBeforeHide({ restore = true } = {}) {
    if (isFallbackFullscreen) {
      exitFallbackFullscreen({ restore });
    }
    if (document.fullscreenElement === panel && typeof document.exitFullscreen === "function") {
      document.exitFullscreen().catch(() => {});
    } else if (isNativeFullscreen) {
      isNativeFullscreen = false;
      panel.classList.remove("is-fullscreen");
      if (restore) restorePreFullscreenGeometry();
      updateFullscreenButton();
      resizeAfterFullscreenTransition();
    }
  }

  function hasMapLayer(id) {
    return Boolean(map?.getLayer?.(id));
  }

  function bindCameraLayerEvents() {
    if (cameraLayerEventsBound || !map?.on) return;
    cameraLayerEventsBound = true;

    map.on("click", CAMERA_POINT_LAYER_ID, (event) => {
      const feature = event?.features?.[0];
      const coordinates = feature?.geometry?.coordinates;
      if (!feature || !Array.isArray(coordinates) || !maplibregl?.Popup) return;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(coordinates)
        .setHTML(buildPopupHtml(feature))
        .addTo(map);
    });

    map.on("mouseenter", CAMERA_POINT_LAYER_ID, () => {
      if (map?.getCanvas?.()) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", CAMERA_POINT_LAYER_ID, () => {
      if (map?.getCanvas?.()) map.getCanvas().style.cursor = "";
    });
  }

  function addCameraLayers() {
    if (!map) return;

    if (!map.getSource?.(CAMERA_SOURCE_ID)) {
      map.addSource?.(CAMERA_SOURCE_ID, {
        type: "geojson",
        data: getEmptyFeatureCollection(),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 13,
      });
    }

    if (!hasMapLayer(CAMERA_CLUSTER_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CLUSTER_LAYER_ID,
        type: "circle",
        source: CAMERA_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#fbbf24",
            50,
            "#fb923c",
            200,
            "#ef4444",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            17,
            50,
            22,
            200,
            28,
          ],
          "circle-opacity": 0.9,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1.5,
        },
      });
    }

    if (!hasMapLayer(CAMERA_CLUSTER_COUNT_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: CAMERA_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#111827",
        },
      });
    }

    if (!hasMapLayer(CAMERA_POINT_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_POINT_LAYER_ID,
        type: "circle",
        source: CAMERA_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#f59e0b",
          "circle-radius": 6,
          "circle-opacity": 0.95,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1.4,
        },
      });
    }

    bindCameraLayerEvents();
  }

  function setCameraFeatures(features, { cache = true } = {}) {
    const safeFeatures = Array.isArray(features) ? features : [];
    if (cache) currentCameraFeatures = safeFeatures;
    const source = map?.getSource?.(CAMERA_SOURCE_ID);
    source?.setData?.({
      type: "FeatureCollection",
      features: safeFeatures,
    });
  }

  function restoreCameraLayersAfterStyle(version, view) {
    if (destroyed || version !== basemapStyleVersion || !map) return;
    basemapSwitchInProgress = false;
    addCameraLayers();
    setCameraFeatures(currentCameraFeatures, { cache: false });
    restoreMapView(view);
    resizeMap();
  }

  function switchBasemap(nextBasemapId, { persist = true } = {}) {
    const nextBasemap = getCameraMapBasemap(nextBasemapId);
    if (nextBasemap.id === activeBasemap.id) {
      updateBasemapUi(nextBasemap);
      return;
    }

    activeBasemap = nextBasemap;
    updateBasemapUi(nextBasemap);
    if (persist) saveBasemapPreference(nextBasemap.id);

    if (!map) return;

    const view = readMapView();
    const version = ++basemapStyleVersion;

    if (typeof map.setStyle !== "function") {
      addCameraLayers();
      setCameraFeatures(currentCameraFeatures, { cache: false });
      resizeMap();
      return;
    }

    basemapSwitchInProgress = true;
    onceMapEvent("style.load", () => restoreCameraLayersAfterStyle(version, view));

    try {
      map.setStyle(createCameraMapStyle(nextBasemap), { diff: false });
    } catch (error) {
      basemapSwitchInProgress = false;
      updateStatus({ status: "unavailable", error });
    }
  }

  function queueRefresh() {
    if (destroyed || panel.hidden || basemapSwitchInProgress || suppressViewportRefresh) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refresh().catch(() => {});
    }, 220);
  }

  async function initMap() {
    if (destroyed || !mapEl) return Promise.resolve();
    if (mapReady) return Promise.resolve();
    if (initPromise) return initPromise;
    if (panel.hidden) return Promise.resolve();

    startResizeObserver();
    createReadyPromise();
    updateStatus({ status: "loading-manifest" });

    initPromise = (async () => {
      try {
        maplibregl = await loadMapLibre();
        if (destroyed || panel.hidden || map) {
          resolveReady();
          return;
        }

        const initialView = getInitialView(getCurrentPosition);
        map = new maplibregl.Map({
          container: mapEl,
          antialias: true,
          attributionControl: false,
          center: initialView.center,
          zoom: initialView.zoom,
          style: createCameraMapStyle(activeBasemap),
        });

        if (maplibregl.NavigationControl) {
          map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
        }

        map.on?.("load", () => {
          if (destroyed || !map) {
            resolveReady();
            return;
          }
          mapReady = true;
          addCameraLayers();
          resizeMap();
          refresh().catch(() => {});
          resolveReady();
        });

        map.on?.("moveend", queueRefresh);
        map.on?.("zoomend", queueRefresh);
      } catch (error) {
        if (!destroyed) {
          updateStatus({ status: "unavailable", error });
        }
        resolveReady();
      }
    })().finally(() => {
      initPromise = null;
    });

    return readyPromise ?? initPromise;
  }

  async function refresh() {
    if (destroyed) return null;
    if (basemapSwitchInProgress) return null;
    if (!map) {
      await initMap();
    }
    if (!map || !mapReady) return null;

    refreshController?.abort();
    refreshController = new AbortController();

    try {
      const result = await cameraDataSource.loadViewport({
        bounds: map.getBounds?.(),
        zoom: map.getZoom?.() ?? 0,
        signal: refreshController.signal,
      });
      setCameraFeatures(result?.features || []);
      updateStatus(result?.status || cameraDataSource.getStatus?.());
      return result;
    } catch (error) {
      if (error?.name !== "AbortError") {
        updateStatus({ status: "unavailable", error });
      }
      return null;
    }
  }

  function focusCurrentLocation() {
    const currentPosition = normalizePosition(getCurrentPosition?.());
    if (!currentPosition) {
      updateStatus({ status: "unavailable" });
      return false;
    }

    if (!map) {
      open();
    }

    const center = [currentPosition.longitude, currentPosition.latitude];
    const currentZoom = Number(map?.getZoom?.());
    const zoom = Number.isFinite(currentZoom) ? Math.max(currentZoom, 12) : 12;

    if (map?.easeTo) {
      map.easeTo({ center, zoom, duration: 450, essential: true });
    } else if (map?.jumpTo) {
      map.jumpTo({ center, zoom });
    }
    queueRefresh();
    return true;
  }

  function showPanel({ persist = true } = {}) {
    panel.hidden = false;
    startResizeObserver();
    if (persist) saveVisibility(true);
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel);
    }
    window.setTimeout(() => {
      resizeMap();
      initMap().then(() => {
        resizeMap();
        refresh().catch(() => {});
      });
    }, 0);
  }

  function hidePanel({ persist = true } = {}) {
    exitFullscreenBeforeHide();
    panel.hidden = true;
    if (persist) saveVisibility(false);
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    stopResizeObserver();
    refreshController?.abort();
  }

  function minimizePanel() {
    exitFullscreenBeforeHide();
    panel.hidden = true;
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    stopResizeObserver();
    refreshController?.abort();
  }

  function open(openOptions = {}) {
    showPanel(openOptions);
    shellManager.openWindow(CAMERA_MAP_WINDOW_ID, { ...openOptions, invokeLifecycle: false });
  }

  function close(closeOptions = {}) {
    hidePanel(closeOptions);
    shellManager.closeWindow(CAMERA_MAP_WINDOW_ID, { ...closeOptions, invokeLifecycle: false });
  }

  function minimize(minimizeOptions = {}) {
    minimizePanel(minimizeOptions);
    shellManager.minimizeWindow(CAMERA_MAP_WINDOW_ID, { ...minimizeOptions, invokeLifecycle: false });
  }

  function restore(restoreOptions = {}) {
    showPanel(restoreOptions);
    shellManager.restoreWindow(CAMERA_MAP_WINDOW_ID, { ...restoreOptions, invokeLifecycle: false });
  }

  function toggle() {
    panel.hidden ? open() : close();
  }

  function destroy() {
    destroyed = true;
    exitFullscreenBeforeHide({ restore: false });
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    window.removeEventListener("resize", resizeMap);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    stopResizeObserver();
    cleanupColorSchemeListener();
    cleanupColorSchemeListener = () => {};
    refreshController?.abort();
    cleanupLayer();
    if (button) button.removeEventListener("click", toggle);
    cameraDataSource.destroy?.();
    map?.remove?.();
    map = null;
    mapReady = false;
    panel.remove();
  }

  {
    const pos = loadPos();
    panel.style.position = "fixed";
    if (pos?.panel?.left && pos?.panel?.top) {
      panel.style.left = pos.panel.left;
      panel.style.top = pos.panel.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.right = "18px";
      panel.style.bottom = "78px";
    }
  }

  cleanupLayer = registerFloatingPanel(panel, {
    id: CAMERA_MAP_WINDOW_ID,
    kind: "tool",
    title: "Camera Map",
    shellManager,
    storageKey: visibilityKey,
    lazy: true,
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
      fullscreen: true,
    },
    lifecycle: {
      open: showPanel,
      close: hidePanel,
      minimize: minimizePanel,
      restore: showPanel,
    },
  });

  makePanelDraggable({
    panel,
    header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
    shellWindowId: CAMERA_MAP_WINDOW_ID,
    shellManager,
    enableSnapPreview: shellManager.getShellPreference?.("snapEnabled") !== false,
  });

  closeBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  closeBtn.addEventListener("pointerup", (event) => event.stopPropagation());
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  fullscreenBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  fullscreenBtn.addEventListener("pointerup", (event) => event.stopPropagation());
  fullscreenBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFullscreen().catch(() => {});
  });

  recenterBtn.addEventListener("click", () => focusCurrentLocation());
  refreshBtn.addEventListener("click", () => {
    refresh().catch(() => {});
  });

  layerSelect.addEventListener("change", () => {
    if (layerSelect.value === CAMERA_MAP_BASEMAP_AUTO_ID) {
      hasUserBasemapPreference = false;
      clearBasemapPreference();
      switchBasemap(getDefaultCameraMapBasemapId(), { persist: false });
      return;
    }
    hasUserBasemapPreference = true;
    switchBasemap(layerSelect.value);
  });

  window.addEventListener("resize", resizeMap, { passive: true });
  document.addEventListener("fullscreenchange", onFullscreenChange);
  startColorSchemeListener();

  if (button) {
    button.addEventListener("click", toggle);
  }

  mount.appendChild(panel);
  updateStatus({ status: "idle" });

  if (floating) {
    // The shell taskbar/start menu owns launchers in the SPA.  Keeping this
    // branch intentionally empty preserves the calculator-style option without
    // introducing a second dock.
  }

  if (loadVisibility()) {
    open({ persist: false });
  }

  return {
    open,
    close,
    minimize,
    restore,
    destroy,
    isOpen: () => !panel.hidden,
    isFullscreen: isFullscreenActive,
    toggleFullscreen,
    refresh,
    focusCurrentLocation,
  };
}
