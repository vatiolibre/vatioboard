import { t } from "../i18n.js";
import {
  IconClose,
  IconGpsLab,
  IconRestart,
} from "../icons.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import { registerFloatingPanel } from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import { loadMapLibre } from "../shared/maplibre-loader.js";
import {
  createCameraMapDataSource,
} from "./camera-map-data-source.js";

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

const IconMinimize = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
`;

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

function buildPopupHtml(feature) {
  const props = feature?.properties || {};
  const speed = Number(props.speedKph);
  const rows = [
    ["Speed", Number.isFinite(speed) ? `${Math.round(speed)} km/h` : "Unknown"],
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

function buildPanel() {
  const title = createElement("span", {
    class: "camera-map-title",
    text: t("cameraMapTitle"),
    "data-i18n": "cameraMapTitle",
  });

  const minimizeBtn = createElement("button", {
    type: "button",
    class: "camera-map-action camera-map-minimize",
    "aria-label": t("minimizeCameraMap"),
    title: t("minimizeCameraMap"),
    "data-i18n-aria": "minimizeCameraMap",
    "data-i18n-title": "minimizeCameraMap",
    html: IconMinimize,
  });

  const closeBtn = createElement("button", {
    type: "button",
    class: "camera-map-action camera-map-close calc-close",
    "aria-label": t("closeCameraMap"),
    title: t("closeCameraMap"),
    "data-i18n-aria": "closeCameraMap",
    "data-i18n-title": "closeCameraMap",
    html: IconClose,
  });

  const actions = createElement("div", { class: "camera-map-actions" }, [minimizeBtn, closeBtn]);
  const header = createElement("div", { class: "camera-map-header" }, [
    createElement("span", { class: "camera-map-header-grip", "aria-hidden": "true" }),
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

  const toolbar = createElement("div", { class: "camera-map-toolbar" }, [
    recenterBtn,
    refreshBtn,
    statusEl,
  ]);
  const mapEl = createElement("div", {
    class: "camera-map-container",
    "aria-label": t("cameraMapTitle"),
  });
  const attribution = createElement("a", {
    class: "camera-map-attribution",
    href: "https://www.openstreetmap.org/copyright",
    target: "_blank",
    rel: "noopener noreferrer",
    text: t("cameraMapAttribution"),
    "data-i18n": "cameraMapAttribution",
  });
  const privacy = createElement("span", {
    class: "camera-map-privacy",
    text: t("cameraMapPrivacy"),
    "data-i18n": "cameraMapPrivacy",
  });
  const footer = createElement("div", { class: "camera-map-footer" }, [attribution, privacy]);
  const body = createElement("div", { class: "camera-map-body" }, [toolbar, mapEl, footer]);
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
    minimizeBtn,
    recenterBtn,
    refreshBtn,
    statusEl,
    mapEl,
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

  const refs = buildPanel();
  const {
    panel,
    header,
    closeBtn,
    minimizeBtn,
    recenterBtn,
    refreshBtn,
    statusEl,
    mapEl,
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

  function addCameraLayers() {
    if (!map || map.getSource?.(CAMERA_SOURCE_ID)) return;

    map.addSource?.(CAMERA_SOURCE_ID, {
      type: "geojson",
      data: getEmptyFeatureCollection(),
      cluster: true,
      clusterRadius: 45,
      clusterMaxZoom: 13,
    });

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

    map.on?.("click", CAMERA_POINT_LAYER_ID, (event) => {
      const feature = event?.features?.[0];
      const coordinates = feature?.geometry?.coordinates;
      if (!feature || !Array.isArray(coordinates) || !maplibregl?.Popup) return;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(coordinates)
        .setHTML(buildPopupHtml(feature))
        .addTo(map);
    });

    map.on?.("mouseenter", CAMERA_POINT_LAYER_ID, () => {
      if (map?.getCanvas?.()) map.getCanvas().style.cursor = "pointer";
    });
    map.on?.("mouseleave", CAMERA_POINT_LAYER_ID, () => {
      if (map?.getCanvas?.()) map.getCanvas().style.cursor = "";
    });
  }

  function setCameraFeatures(features) {
    const source = map?.getSource?.(CAMERA_SOURCE_ID);
    source?.setData?.({
      type: "FeatureCollection",
      features: Array.isArray(features) ? features : [],
    });
  }

  function queueRefresh() {
    if (destroyed || panel.hidden) return;
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
          style: {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            sources: {
              "camera-map-osm": {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [
              {
                id: "camera-map-osm-base",
                type: "raster",
                source: "camera-map-osm",
              },
            ],
          },
        });

        if (maplibregl.NavigationControl) {
          map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
        }
        if (maplibregl.AttributionControl) {
          map.addControl(new maplibregl.AttributionControl({ compact: true }));
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
    panel.hidden = true;
    if (persist) saveVisibility(false);
    window.clearTimeout(refreshTimer);
    refreshController?.abort();
  }

  function minimizePanel() {
    panel.hidden = true;
    window.clearTimeout(refreshTimer);
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
    window.clearTimeout(refreshTimer);
    window.removeEventListener("resize", resizeMap);
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

  minimizeBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  minimizeBtn.addEventListener("pointerup", (event) => event.stopPropagation());
  minimizeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    minimize();
  });

  recenterBtn.addEventListener("click", () => focusCurrentLocation());
  refreshBtn.addEventListener("click", () => {
    refresh().catch(() => {});
  });

  window.addEventListener("resize", resizeMap, { passive: true });

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
    refresh,
    focusCurrentLocation,
  };
}
