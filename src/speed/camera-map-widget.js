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
  angularDifferenceDegrees,
  bearingDegrees,
  buildUserPositionFeature,
  computeNavigationCameraUpdate,
  createNavigationCameraState,
  distanceMeters,
  normalizeLivePosition,
  shouldShowHeading,
  shouldUseNavigationCamera,
} from "./camera-map-navigation.js";
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
const USER_POSITION_SOURCE_ID = "camera-map-user-position";
const USER_POSITION_ACCURACY_LAYER_ID = "camera-map-user-accuracy";
const USER_POSITION_GLOW_LAYER_ID = "camera-map-user-glow";
const USER_POSITION_DOT_LAYER_ID = "camera-map-user-dot";
const USER_POSITION_HEADING_LAYER_ID = "camera-map-user-heading-arrow";
const POS_KEY = "camera_map_widget_pos_v1";
const VISIBILITY_KEY = "camera_map_widget_visible_v1";
const FOLLOW_STORAGE_KEY = "vatioboard.cameraMap.follow.v1";
const ORIENTATION_STORAGE_KEY = "vatioboard.cameraMap.orientation.v1";
const PROJECTION_STORAGE_KEY = "vatioboard.cameraMap.projection.v1";
const DRAG_THRESHOLD_PX = 6;
const DEFAULT_CENTER = [0, 20];
const DEFAULT_ZOOM = 1.5;
const RESIZE_MARGIN_PX = 8;
const RESIZE_MIN_WIDTH = 320;
const RESIZE_MIN_HEIGHT = 320;
const POSITION_POLL_MS = 1000;
const CAMERA_LOOKAHEAD_M = 1400;
const CAMERA_AHEAD_ANGLE_DEGREES = 60;

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
  if (status.status === "gps-live") return t("cameraMapGpsLive");
  if (status.status === "gps-stale") return t("cameraMapGpsStale");
  if (status.status === "gps-unavailable") return t("cameraMapGpsUnavailable");
  if (status.status === "following") return t("cameraMapFollowing");
  if (status.status === "follow-paused") return t("cameraMapFollowPaused");
  if (status.status === "heading-unavailable") return t("cameraMapHeadingUnavailable");
  if (status.status === "camera-ahead") return t("cameraMapCameraAhead", { distance: status.distance || "" });
  if (status.status === "ready") return t("cameraMapReady", { count: status.featureCount || 0 });
  if (status.status === "unavailable" || status.status === "error") return t("cameraMapUnavailable");
  return t("cameraMapLoading");
}

function getInitialView(getCurrentPosition) {
  const currentPosition = normalizePosition(
    getCurrentPosition?.() || window.__vatioboardSpeedGetCurrentPosition?.()
  );
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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function loadBooleanPreference(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // Preference persistence is convenience only.
  }
  return fallback;
}

function hasStoredPreference(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function saveBooleanPreference(key, value) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Preference persistence is convenience only.
  }
}

function loadEnumPreference(key, allowedValues, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (allowedValues.includes(value)) return value;
  } catch {
    // Preference persistence is convenience only.
  }
  return fallback;
}

function saveEnumPreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference persistence is convenience only.
  }
}

function createLayerOption({ id, labelKey, selected = false }) {
  return createElement("button", {
    type: "button",
    class: `camera-map-layer-option${selected ? " is-active" : ""}`,
    role: "option",
    "aria-selected": selected ? "true" : "false",
    "data-layer-id": id,
  }, [
    createElement("span", {
      class: "camera-map-layer-option-label",
      text: t(labelKey),
      "data-i18n": labelKey,
    }),
  ]);
}

function createBasemapLayerControl(selectedBasemapId, { auto = false } = {}) {
  const selectedBasemap = getCameraMapBasemap(selectedBasemapId);
  const selectedLabelKey = auto ? "cameraMapLayerAuto" : selectedBasemap.labelKey;
  const layerButtonText = createElement("span", {
    class: "camera-map-layer-button-text",
    text: t(selectedLabelKey),
    "data-i18n": selectedLabelKey,
  });
  const layerButton = createElement("button", {
    type: "button",
    class: "camera-map-layer-button",
    "aria-label": t("cameraMapLayers"),
    title: t("cameraMapLayers"),
    "data-i18n-aria": "cameraMapLayers",
    "data-i18n-title": "cameraMapLayers",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "data-layer-id": auto ? CAMERA_MAP_BASEMAP_AUTO_ID : selectedBasemap.id,
  }, [
    createElement("span", {
      class: "camera-map-layer-icon",
      "aria-hidden": "true",
      html: IconWorld,
    }),
    layerButtonText,
  ]);

  const layerMenu = createElement("div", {
    class: "camera-map-layer-menu",
    role: "listbox",
    "aria-label": t("cameraMapLayers"),
    "data-i18n-aria": "cameraMapLayers",
  });
  layerMenu.hidden = true;
  layerMenu.appendChild(createLayerOption({
    id: CAMERA_MAP_BASEMAP_AUTO_ID,
    labelKey: "cameraMapLayerAuto",
    selected: auto,
  }));

  for (const basemap of CAMERA_MAP_BASEMAPS) {
    layerMenu.appendChild(createLayerOption({
      id: basemap.id,
      labelKey: basemap.labelKey,
      selected: !auto && basemap.id === selectedBasemap.id,
    }));
  }

  const layerControl = createElement("div", {
    class: "camera-map-layer-control",
    title: t("cameraMapLayers"),
    "data-i18n-title": "cameraMapLayers",
  }, [
    layerButton,
    layerMenu,
  ]);

  return {
    layerControl,
    layerButton,
    layerButtonText,
    layerMenu,
  };
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
    class: "camera-map-toolbar-btn camera-map-follow-toggle",
    "aria-label": t("cameraMapFollow"),
    title: t("cameraMapFollow"),
    "data-i18n-aria": "cameraMapFollow",
    "data-i18n-title": "cameraMapFollow",
    html: IconGpsLab,
  });

  const orientationBtn = createElement("button", {
    type: "button",
    class: "camera-map-toolbar-btn camera-map-orientation-toggle",
    "aria-label": t("cameraMapNorthUp"),
    title: t("cameraMapNorthUp"),
    "data-i18n-aria": "cameraMapNorthUp",
    "data-i18n-title": "cameraMapNorthUp",
    text: "N",
  });

  const refreshBtn = createElement("button", {
    type: "button",
    class: "camera-map-toolbar-btn camera-map-refresh",
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
  const {
    layerControl,
    layerButton,
    layerButtonText,
    layerMenu,
  } = createBasemapLayerControl(selectedBasemapId, { auto: autoBasemap });
  const overlayControls = createElement("div", { class: "camera-map-overlay-controls camera-map-nav-controls" }, [
    recenterBtn,
    orientationBtn,
    refreshBtn,
    layerControl,
  ]);
  const topOverlay = createElement("div", {
    class: "camera-map-overlay camera-map-overlay--top",
  }, [
    statusEl,
  ]);
  const navOverlay = createElement("div", {
    class: "camera-map-overlay camera-map-overlay--nav",
  }, [
    overlayControls,
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
  const body = createElement("div", { class: "camera-map-body" }, [mapEl, topOverlay, navOverlay, bottomOverlay]);
  const resizeHandle = createElement("button", {
    type: "button",
    class: "camera-map-resize-handle",
    "aria-label": t("cameraMapResize"),
    title: t("cameraMapResize"),
    "data-i18n-aria": "cameraMapResize",
    "data-i18n-title": "cameraMapResize",
  });
  const panel = createElement("section", {
    class: "camera-map-panel",
    "aria-label": t("cameraMapTitle"),
    "data-vb-floating-panel": "",
  }, [header, body, resizeHandle]);
  panel.hidden = true;

  return {
    panel,
    header,
    closeBtn,
    fullscreenBtn,
    recenterBtn,
    orientationBtn,
    refreshBtn,
    statusEl,
    mapEl,
    layerButton,
    layerButtonText,
    layerMenu,
    resizeHandle,
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
    navigationDefaultMode = "auto",
    autoEnableFollowFromSpeed = true,
    autoFrameCamera = true,
  } = options;

  const storedBasemapId = loadBasemapPreference();
  let hasUserBasemapPreference = isCameraMapBasemapId(storedBasemapId);
  let hasUserFollowPreference = hasStoredPreference(FOLLOW_STORAGE_KEY);
  let hasUserOrientationPreference = hasStoredPreference(ORIENTATION_STORAGE_KEY);
  let activeBasemap = getCameraMapBasemap(hasUserBasemapPreference
    ? storedBasemapId
    : getDefaultCameraMapBasemapId());
  const initialNavigationDefaultMode = ["drive", "browse", "auto"].includes(navigationDefaultMode)
    ? navigationDefaultMode
    : "auto";
  let followEnabled = loadBooleanPreference(FOLLOW_STORAGE_KEY, false);
  let followPaused = false;
  let navigationMode = followEnabled ? "drive" : "browse";
  let orientationMode = loadEnumPreference(ORIENTATION_STORAGE_KEY, ["north-up", "heading-up"], "north-up");
  let projectionMode = loadEnumPreference(PROJECTION_STORAGE_KEY, ["auto", "flat", "globe"], "auto");
  let activeProjection = null;
  const refs = buildPanel(activeBasemap.id, { autoBasemap: !hasUserBasemapPreference });
  const {
    panel,
    header,
    closeBtn,
    fullscreenBtn,
    recenterBtn,
    orientationBtn,
    refreshBtn,
    statusEl,
    mapEl,
    layerButton,
    layerButtonText,
    layerMenu,
    resizeHandle,
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
  let positionPollTimer = 0;
  let isNativeFullscreen = false;
  let isFallbackFullscreen = false;
  let currentCameraFeatures = [];
  let cameraStatus = { status: "idle", featureCount: 0 };
  let navigationStatus = null;
  let previousLivePosition = null;
  let currentLivePosition = null;
  let lastHeadingState = null;
  let currentUserPositionFeature = null;
  let navigationCameraState = createNavigationCameraState();
  let lastCameraCommand = null;
  let basemapErrorCount = 0;
  let cameraLayerEventsBound = false;
  let basemapSwitchInProgress = false;
  let basemapStyleVersion = 0;
  let suppressViewportRefresh = false;
  let resizeObserver = null;
  let resizePointerId = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeLastX = 0;
  let resizeLastY = 0;
  let resizeRafId = 0;
  let resizeInProgress = false;
  let colorSchemeMediaQuery = null;
  let cleanupColorSchemeListener = () => {};
  let preFullscreenWidth = null;
  let preFullscreenHeight = null;
  let preFullscreenLeft = null;
  let preFullscreenTop = null;
  let programmaticCameraMoveDepth = 0;
  let suppressManualPauseUntilMs = 0;
  let speedPositionListenerActive = false;

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
      const bounds = getPanelBounds();
      shellManager.updateWindowBounds(CAMERA_MAP_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
        width: bounds.width,
        height: bounds.height,
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

  function renderStatusChip() {
    const navStatus = navigationStatus?.status || "";
    const cameraDataStatus = cameraStatus?.status || "";
    const highPriorityNav = navStatus === "camera-ahead"
      || navStatus === "follow-paused"
      || navStatus === "following"
      || navStatus === "heading-unavailable"
      || (followEnabled && (navStatus === "gps-stale" || navStatus === "gps-unavailable"));
    const safeStatus = highPriorityNav
      ? navigationStatus
      : (cameraDataStatus === "offline-cached" ? cameraStatus : (navigationStatus || cameraStatus || {}));
    statusEl.textContent = getStatusMessage(safeStatus);
    statusEl.dataset.status = safeStatus.status || "idle";
  }

  function updateStatus(nextStatus = cameraDataSource.getStatus?.()) {
    cameraStatus = nextStatus || {};
    renderStatusChip();
  }

  function setNavigationStatus(nextStatus = null) {
    navigationStatus = nextStatus;
    renderStatusChip();
  }

  function updateNavigationButtons() {
    recenterBtn.classList.toggle("is-active", followEnabled && !followPaused);
    recenterBtn.classList.toggle("is-paused", followEnabled && followPaused);
    recenterBtn.dataset.follow = followEnabled ? (followPaused ? "paused" : "on") : "off";
    recenterBtn.dataset.navigationMode = navigationMode;
    orientationBtn.dataset.mode = orientationMode;
    orientationBtn.textContent = orientationMode === "heading-up" ? "HDG" : "N";
    const orientationLabel = orientationMode === "heading-up" ? t("cameraMapHeadingUp") : t("cameraMapNorthUp");
    orientationBtn.setAttribute("aria-label", orientationLabel);
    orientationBtn.setAttribute("title", orientationLabel);
    orientationBtn.dataset.i18nAria = orientationMode === "heading-up" ? "cameraMapHeadingUp" : "cameraMapNorthUp";
    orientationBtn.dataset.i18nTitle = orientationMode === "heading-up" ? "cameraMapHeadingUp" : "cameraMapNorthUp";
  }

  function getMapSize() {
    const panelBounds = getPanelBounds();
    return {
      width: Math.round(mapEl.clientWidth || panelBounds.width || 720),
      height: Math.round(mapEl.clientHeight || Math.max(320, panelBounds.height - 52) || 520),
    };
  }

  function runProgrammaticCameraMove(callback) {
    programmaticCameraMoveDepth += 1;
    suppressManualPauseUntilMs = Date.now() + 900;
    try {
      return callback();
    } finally {
      window.setTimeout(() => {
        programmaticCameraMoveDepth = Math.max(0, programmaticCameraMoveDepth - 1);
      }, 0);
    }
  }

  function setLayerMenuOpen(open) {
    layerMenu.hidden = !open;
    layerButton.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function getLayerOptionElements() {
    return Array.from(layerMenu.querySelectorAll(".camera-map-layer-option"));
  }

  function getSelectedLayerValue() {
    return hasUserBasemapPreference ? activeBasemap.id : CAMERA_MAP_BASEMAP_AUTO_ID;
  }

  function focusLayerOption(value = getSelectedLayerValue()) {
    const options = getLayerOptionElements();
    const selectedOption = options.find((option) => option.dataset.layerId === value) || options[0];
    selectedOption?.focus();
  }

  function moveLayerOptionFocus(delta) {
    const options = getLayerOptionElements();
    if (!options.length) return;
    const currentIndex = Math.max(0, options.indexOf(document.activeElement));
    const nextIndex = (currentIndex + delta + options.length) % options.length;
    options[nextIndex]?.focus();
  }

  function updateLayerControlSelection(value = getSelectedLayerValue()) {
    const labelKey = value === CAMERA_MAP_BASEMAP_AUTO_ID
      ? "cameraMapLayerAuto"
      : getCameraMapBasemap(value).labelKey;
    layerButton.dataset.layerId = value;
    layerButtonText.textContent = t(labelKey);
    layerButtonText.dataset.i18n = labelKey;
    for (const option of getLayerOptionElements()) {
      const active = option.dataset.layerId === value;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  function updateBasemapUi(basemap = activeBasemap) {
    updateLayerControlSelection(hasUserBasemapPreference ? basemap.id : CAMERA_MAP_BASEMAP_AUTO_ID);
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

  function getPanelBounds() {
    const rect = panel.getBoundingClientRect?.() || {};
    const width = Math.round(rect.width || panel.offsetWidth || pxToNumber(panel.style.width, 720));
    const height = Math.round(rect.height || panel.offsetHeight || pxToNumber(panel.style.height, 520));
    const left = pxToNumber(panel.style.left, Number.isFinite(rect.left) ? rect.left : 0);
    const top = pxToNumber(panel.style.top, Number.isFinite(rect.top) ? rect.top : 0);
    return {
      left,
      top,
      width,
      height,
    };
  }

  function clampResizeBounds(width, height, bounds = getPanelBounds()) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    const maxWidth = Math.max(240, viewportWidth - bounds.left - RESIZE_MARGIN_PX);
    const maxHeight = Math.max(240, viewportHeight - bounds.top - RESIZE_MARGIN_PX);
    const minWidth = Math.min(RESIZE_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(RESIZE_MIN_HEIGHT, maxHeight);
    return {
      left: bounds.left,
      top: bounds.top,
      width: Math.round(clampNumber(width, minWidth, maxWidth)),
      height: Math.round(clampNumber(height, minHeight, maxHeight)),
    };
  }

  function applyPanelResize(width, height, { flush = false } = {}) {
    if (isFullscreenActive()) return;
    const bounds = clampResizeBounds(width, height);
    panel.style.position = "fixed";
    panel.style.left = `${Math.round(bounds.left)}px`;
    panel.style.top = `${Math.round(bounds.top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${bounds.width}px`;
    panel.style.height = `${bounds.height}px`;
    shellManager.updateWindowBounds(CAMERA_MAP_WINDOW_ID, bounds, { flush });
    resizeMap();
  }

  function applyHandleResize() {
    resizeRafId = 0;
    if (!resizeInProgress || isFullscreenActive()) return;
    const dx = resizeLastX - resizeStartX;
    const dy = resizeLastY - resizeStartY;
    applyPanelResize(resizeStartWidth + dx, resizeStartHeight + dy);
  }

  function scheduleHandleResize() {
    if (resizeRafId) return;
    resizeRafId = window.requestAnimationFrame?.(applyHandleResize) || window.setTimeout(applyHandleResize, 0);
  }

  function endHandleResize(event = null) {
    if (event && resizePointerId !== null && event.pointerId !== resizePointerId) return;
    if (resizeRafId) {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(resizeRafId);
      } else {
        window.clearTimeout(resizeRafId);
      }
      resizeRafId = 0;
      applyHandleResize();
    }
    if (!resizeInProgress) return;
    resizeInProgress = false;
    resizePointerId = null;
    panel.classList.remove("is-resizing");
    document.documentElement.classList.remove("vb-floating-drag-active");
    const bounds = getPanelBounds();
    shellManager.updateWindowBounds(CAMERA_MAP_WINDOW_ID, bounds, { flush: true });
    resizeMap();
  }

  function resizePanelBy(deltaWidth, deltaHeight) {
    const bounds = getPanelBounds();
    applyPanelResize(bounds.width + deltaWidth, bounds.height + deltaHeight, { flush: true });
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

  function getUserPositionFeatureCollection() {
    return {
      type: "FeatureCollection",
      features: currentUserPositionFeature ? [currentUserPositionFeature] : [],
    };
  }

  function addUserPositionLayers() {
    if (!map) return;

    if (!map.getSource?.(USER_POSITION_SOURCE_ID)) {
      map.addSource?.(USER_POSITION_SOURCE_ID, {
        type: "geojson",
        data: getUserPositionFeatureCollection(),
      });
    }

    if (!hasMapLayer(USER_POSITION_ACCURACY_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_ACCURACY_LAYER_ID,
        type: "circle",
        source: USER_POSITION_SOURCE_ID,
        paint: {
          "circle-color": ["case", ["get", "stale"], "#f59e0b", "#22c55e"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "accuracy"], 24],
            0,
            18,
            50,
            26,
            200,
            44,
            1000,
            72,
          ],
          "circle-opacity": ["case", ["get", "stale"], 0.12, 0.16],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.42,
          "circle-stroke-width": 1,
        },
      });
    }

    if (!hasMapLayer(USER_POSITION_GLOW_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_GLOW_LAYER_ID,
        type: "circle",
        source: USER_POSITION_SOURCE_ID,
        paint: {
          "circle-color": ["case", ["get", "stale"], "#f59e0b", "#22c55e"],
          "circle-radius": ["case", ["get", "stale"], 18, 20],
          "circle-opacity": ["case", ["get", "stale"], 0.34, 0.5],
          "circle-blur": 0.45,
        },
      });
    }

    if (!hasMapLayer(USER_POSITION_DOT_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_DOT_LAYER_ID,
        type: "circle",
        source: USER_POSITION_SOURCE_ID,
        paint: {
          "circle-color": ["case", ["get", "stale"], "#9ca3af", "#19e36a"],
          "circle-radius": 8.5,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": ["case", ["get", "stale"], 0.72, 1],
        },
      });
    }

    if (!hasMapLayer(USER_POSITION_HEADING_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_HEADING_LAYER_ID,
        type: "symbol",
        source: USER_POSITION_SOURCE_ID,
        filter: ["==", ["get", "headingAvailable"], true],
        layout: {
          "text-field": "▲",
          "text-size": 28,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-rotation-alignment": "map",
          "text-pitch-alignment": "map",
          "text-rotate": ["get", "heading"],
          "text-offset": [0, -0.68],
          "text-anchor": "center",
        },
        paint: {
          "text-color": "#19e36a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2.2,
          "text-opacity": ["case", ["get", "headingAvailable"], 1, 0],
        },
      });
    }

    map.getSource?.(USER_POSITION_SOURCE_ID)?.setData?.(getUserPositionFeatureCollection());
  }

  function setUserPositionFeature(feature) {
    currentUserPositionFeature = feature;
    const source = map?.getSource?.(USER_POSITION_SOURCE_ID);
    source?.setData?.(getUserPositionFeatureCollection());
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

  function readCurrentPosition(now = Date.now()) {
    const reader = getCurrentPosition || (() => window.__vatioboardSpeedGetCurrentPosition?.() || null);
    return normalizeLivePosition(reader?.(), now);
  }

  function maybeEnableDriveNavigationFromCurrentPosition({ force = false } = {}) {
    if (initialNavigationDefaultMode === "browse" && !force) return false;
    if (!autoEnableFollowFromSpeed && !force) return false;
    if (hasUserFollowPreference && !followEnabled && !force && initialNavigationDefaultMode !== "drive") return false;
    const position = readCurrentPosition();
    if (!position) {
      if (initialNavigationDefaultMode === "drive" || force) setNavigationStatus({ status: "gps-unavailable" });
      return false;
    }
    navigationMode = "drive";
    followEnabled = true;
    followPaused = false;
    updateNavigationButtons();
    return true;
  }

  function handleSpeedPositionEvent(event) {
    if (destroyed || panel.hidden) return;
    updatePosition(event.detail, { now: Date.now(), source: "speed-event" });
  }

  function startSpeedPositionEvents() {
    if (speedPositionListenerActive) return;
    speedPositionListenerActive = true;
    window.addEventListener("vatioboard:speed-position", handleSpeedPositionEvent);
  }

  function stopSpeedPositionEvents() {
    if (!speedPositionListenerActive) return;
    speedPositionListenerActive = false;
    window.removeEventListener("vatioboard:speed-position", handleSpeedPositionEvent);
  }

  function featurePosition(feature) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return { longitude, latitude };
  }

  function cameraFeatureKey(feature, index = 0) {
    return String(feature?.id || feature?.properties?.osmId || `${feature?.properties?.country || "camera"}:${index}`);
  }

  function findRelevantCamera(position, headingState) {
    if (!position || currentCameraFeatures.length === 0) return null;
    const origin = { latitude: position.latitude, longitude: position.longitude };
    const heading = headingState?.headingAvailable ? headingState.heading : null;
    const candidates = currentCameraFeatures
      .map((feature, index) => {
        const cameraPosition = featurePosition(feature);
        if (!cameraPosition) return null;
        const target = { latitude: cameraPosition.latitude, longitude: cameraPosition.longitude };
        const distance = distanceMeters(origin, target);
        const bearing = bearingDegrees(origin, target);
        const headingDelta = heading === null ? Infinity : angularDifferenceDegrees(heading, bearing);
        return {
          feature,
          index,
          key: cameraFeatureKey(feature, index),
          coordinates: [cameraPosition.longitude, cameraPosition.latitude],
          distance,
          bearing,
          ahead: heading !== null && headingDelta <= CAMERA_AHEAD_ANGLE_DEGREES,
          headingDelta,
        };
      })
      .filter(Boolean)
      .filter((candidate) => Number.isFinite(candidate.distance));

    const ahead = candidates
      .filter((candidate) => candidate.ahead && candidate.distance >= 25 && candidate.distance <= CAMERA_LOOKAHEAD_M)
      .sort((a, b) => a.distance - b.distance)[0];
    if (ahead) return ahead;

    return candidates
      .filter((candidate) => candidate.distance >= 25 && candidate.distance <= CAMERA_LOOKAHEAD_M)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

  function executeNavigationCameraCommand(command) {
    if (!map || !command || command.method === "none") return command;
    lastCameraCommand = command;
    navigationCameraState = {
      ...navigationCameraState,
      latestBearingApplied: Number.isFinite(command.bearing) ? command.bearing : navigationCameraState.latestBearingApplied,
      latestHeading: command.latestHeading ?? navigationCameraState.latestHeading,
      headingAvailable: command.headingAvailable === true,
      headingSource: command.headingSource || "none",
      lastCameraCommandReason: command.reason || "following",
      lastCommandAtMs: Date.now(),
      lastCameraKey: command.relevantCameraKey || navigationCameraState.lastCameraKey,
      lastCameraDistance: Number.isFinite(command.relevantCameraDistance)
        ? command.relevantCameraDistance
        : navigationCameraState.lastCameraDistance,
    };

    const movement = {
      center: command.center,
      zoom: command.zoom,
      bearing: command.bearing,
      pitch: command.pitch ?? 0,
      offset: command.offset,
      duration: command.duration,
      essential: true,
      ...(command.padding ? { padding: command.padding } : {}),
    };

    runProgrammaticCameraMove(() => {
      if (command.method === "jumpTo" && map.jumpTo) {
        map.jumpTo(movement);
      } else if (map.easeTo) {
        map.easeTo(movement);
      } else if (map.jumpTo) {
        map.jumpTo(movement);
      }
    });

    if (command.reason === "heading-unavailable") {
      setNavigationStatus({ status: "heading-unavailable" });
    } else if (command.reason === "camera-ahead") {
      setNavigationStatus({ status: "camera-ahead", distance: `${Math.round(command.relevantCameraDistance || 0)} m` });
    } else {
      setNavigationStatus({ status: "following" });
    }

    if (command.shouldRefreshViewport) queueRefresh();
    return command;
  }

  function maybeAutoSelectHeadingUp(position, headingState) {
    if (hasUserOrientationPreference || orientationMode === "heading-up") return;
    if (navigationMode !== "drive" || !followEnabled || followPaused) return;
    if (headingState?.headingAvailable !== true) return;
    if ((position?.speedMs ?? 0) < 1.5) return;
    orientationMode = "heading-up";
    updateNavigationButtons();
  }

  function applyFollowCamera(position, headingState, { now = Date.now() } = {}) {
    if (!map || currentUserPositionFeature?.properties?.stale) return null;
    if (!shouldUseNavigationCamera({
      followEnabled,
      followPaused,
      panelVisible: !panel.hidden,
      mapReady,
      position,
      navigationMode,
    })) return null;

    const relevantCamera = autoFrameCamera ? findRelevantCamera(position, headingState) : null;
    const command = computeNavigationCameraUpdate({
      position,
      headingState,
      previousCameraState: navigationCameraState,
      orientationMode,
      navigationMode,
      relevantCamera,
      mapSize: getMapSize(),
      currentZoom: map.getZoom?.(),
      currentBearing: map.getBearing?.(),
      currentPitch: map.getPitch?.(),
      now,
    });
    return executeNavigationCameraCommand(command);
  }

  function updatePosition(input, { now = Date.now(), source = "manual" } = {}) {
    const position = normalizeLivePosition(input === undefined ? readCurrentPosition(now) : input, now);
    if (!position) {
      if (followEnabled) setNavigationStatus({ status: "gps-unavailable" });
      return null;
    }

    const headingState = shouldShowHeading(position, previousLivePosition, lastHeadingState, now);
    if (headingState.headingAvailable) lastHeadingState = headingState;
    const feature = buildUserPositionFeature(position, headingState, now);
    previousLivePosition = currentLivePosition || position;
    currentLivePosition = position;
    setUserPositionFeature(feature);
    maybeAutoSelectHeadingUp(position, headingState);

    if (feature?.properties?.stale) {
      setNavigationStatus({ status: "gps-stale" });
      return feature;
    }

    if (followEnabled && !followPaused) {
      applyFollowCamera(position, headingState, { now });
    } else if (!navigationStatus || ["gps-stale", "gps-unavailable", "following", "heading-unavailable"].includes(navigationStatus.status)) {
      setNavigationStatus({ status: "gps-live" });
    }
    return feature;
  }

  function applyProjection() {
    if (!map?.setProjection) return;
    const zoom = Number(map.getZoom?.());
    let nextProjection = activeProjection || "mercator";
    if (projectionMode === "globe") nextProjection = "globe";
    else if (projectionMode === "flat") nextProjection = "mercator";
    else if (Number.isFinite(zoom)) {
      if (zoom <= 3.5) nextProjection = "globe";
      else if (zoom >= 4.5) nextProjection = "mercator";
    }
    if (nextProjection === activeProjection) return;
    activeProjection = nextProjection;
    try {
      map.setProjection(nextProjection);
      addCameraLayers();
      setCameraFeatures(currentCameraFeatures, { cache: false });
      addUserPositionLayers();
    } catch {
      // Projection support varies by MapLibre build; navigation remains usable.
    }
  }

  function restoreCameraLayersAfterStyle(version, view) {
    if (destroyed || version !== basemapStyleVersion || !map) return;
    basemapSwitchInProgress = false;
    addCameraLayers();
    setCameraFeatures(currentCameraFeatures, { cache: false });
    addUserPositionLayers();
    restoreMapView(view);
    applyProjection();
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
      addUserPositionLayers();
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

  function selectLayerValue(layerId) {
    setLayerMenuOpen(false);
    if (layerId === CAMERA_MAP_BASEMAP_AUTO_ID) {
      hasUserBasemapPreference = false;
      clearBasemapPreference();
      switchBasemap(getDefaultCameraMapBasemapId(), { persist: false });
      layerButton.focus();
      return;
    }

    hasUserBasemapPreference = true;
    switchBasemap(layerId);
    layerButton.focus();
  }

  function queueRefresh() {
    if (destroyed || panel.hidden || basemapSwitchInProgress || suppressViewportRefresh) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refresh().catch(() => {});
    }, 220);
  }

  function stopPositionPolling() {
    window.clearTimeout(positionPollTimer);
    positionPollTimer = 0;
  }

  function schedulePositionPoll() {
    if (destroyed || panel.hidden || positionPollTimer) return;
    positionPollTimer = window.setTimeout(() => {
      positionPollTimer = 0;
      updatePosition(readCurrentPosition(), { now: Date.now(), source: "poll" });
      schedulePositionPoll();
    }, POSITION_POLL_MS);
  }

  function startPositionPolling() {
    if (destroyed || panel.hidden) return;
    updatePosition(readCurrentPosition(), { now: Date.now(), source: "poll" });
    schedulePositionPoll();
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
          addUserPositionLayers();
          applyProjection();
          updatePosition(readCurrentPosition(), { now: Date.now(), source: "load" });
          resizeMap();
          refresh().catch(() => {});
          resolveReady();
        });

        map.on?.("moveend", queueRefresh);
        map.on?.("zoomend", () => {
          applyProjection();
          queueRefresh();
        });
        const pauseFollowForManualMove = () => {
          if (programmaticCameraMoveDepth > 0 || Date.now() < suppressManualPauseUntilMs) return;
          if (!followEnabled || followPaused) return;
          followPaused = true;
          navigationMode = "browse";
          updateNavigationButtons();
          setNavigationStatus({ status: "follow-paused" });
        };
        map.on?.("dragstart", pauseFollowForManualMove);
        map.on?.("rotatestart", pauseFollowForManualMove);
        map.on?.("pitchstart", pauseFollowForManualMove);
        map.on?.("zoomstart", pauseFollowForManualMove);
        map.on?.("error", () => {
          basemapErrorCount += 1;
          if (basemapErrorCount >= 3) {
            updateStatus({
              ...(cameraStatus || {}),
              status: "offline-cached",
              featureCount: currentCameraFeatures.length,
              cacheHit: currentCameraFeatures.length > 0,
              offline: true,
            });
          }
        });
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
      const nextStatus = result?.status || cameraDataSource.getStatus?.();
      const nextFeatures = Array.isArray(result?.features) ? result.features : [];
      const shouldPreserveExisting = currentCameraFeatures.length > 0
        && nextFeatures.length === 0
        && (nextStatus?.offline || nextStatus?.status === "offline-cached" || nextStatus?.status === "unavailable");
      if (!shouldPreserveExisting) {
        setCameraFeatures(nextFeatures);
      }
      updateStatus(nextStatus);
      return result;
    } catch (error) {
      if (error?.name !== "AbortError") {
        updateStatus({
          status: currentCameraFeatures.length > 0 ? "offline-cached" : "unavailable",
          featureCount: currentCameraFeatures.length,
          cacheHit: currentCameraFeatures.length > 0,
          offline: true,
          error,
        });
      }
      return null;
    }
  }

  function focusCurrentLocation() {
    const currentPosition = readCurrentPosition();
    if (!currentPosition) {
      setNavigationStatus({ status: "gps-unavailable" });
      return false;
    }

    if (!map) {
      open();
    }

    const center = [currentPosition.longitude, currentPosition.latitude];
    const currentZoom = Number(map?.getZoom?.());
    const zoom = Number.isFinite(currentZoom) ? Math.max(currentZoom, 12) : 12;

    runProgrammaticCameraMove(() => {
      if (map?.easeTo) {
        map.easeTo({ center, zoom, duration: 450, essential: true });
      } else if (map?.jumpTo) {
        map.jumpTo({ center, zoom });
      }
    });
    queueRefresh();
    return true;
  }

  function resumeFollow() {
    const position = readCurrentPosition();
    if (!position) {
      setNavigationStatus({ status: "gps-unavailable" });
      return false;
    }
    navigationMode = "drive";
    followEnabled = true;
    followPaused = false;
    hasUserFollowPreference = true;
    saveBooleanPreference(FOLLOW_STORAGE_KEY, true);
    updateNavigationButtons();
    updatePosition(position, { now: Date.now(), source: "follow" });
    return true;
  }

  function toggleFollow() {
    if (!followEnabled || followPaused) {
      resumeFollow();
      return;
    }
    followEnabled = false;
    followPaused = false;
    navigationMode = "browse";
    hasUserFollowPreference = true;
    saveBooleanPreference(FOLLOW_STORAGE_KEY, false);
    navigationCameraState = createNavigationCameraState();
    updateNavigationButtons();
    setNavigationStatus(currentLivePosition ? { status: "gps-live" } : null);
  }

  function cycleOrientationMode() {
    orientationMode = orientationMode === "heading-up" ? "north-up" : "heading-up";
    hasUserOrientationPreference = true;
    saveEnumPreference(ORIENTATION_STORAGE_KEY, orientationMode);
    updateNavigationButtons();
    if (followEnabled && currentLivePosition) {
      updatePosition(currentLivePosition, { now: Date.now(), source: "orientation" });
    }
  }

  function setProjectionMode(nextMode) {
    if (!["auto", "flat", "globe"].includes(nextMode)) return projectionMode;
    projectionMode = nextMode;
    saveEnumPreference(PROJECTION_STORAGE_KEY, projectionMode);
    activeProjection = null;
    applyProjection();
    return projectionMode;
  }

  function showPanel({ persist = true } = {}) {
    panel.hidden = false;
    startResizeObserver();
    maybeEnableDriveNavigationFromCurrentPosition();
    startSpeedPositionEvents();
    startPositionPolling();
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
    stopPositionPolling();
    stopSpeedPositionEvents();
    refreshController?.abort();
  }

  function minimizePanel() {
    exitFullscreenBeforeHide();
    panel.hidden = true;
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    stopResizeObserver();
    stopPositionPolling();
    stopSpeedPositionEvents();
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

  function closeLayerMenuOnDocumentPointerDown(event) {
    if (!layerMenu.hidden && !layerMenu.parentElement?.contains?.(event.target)) {
      setLayerMenuOpen(false);
    }
  }

  function destroy() {
    destroyed = true;
    exitFullscreenBeforeHide({ restore: false });
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    stopPositionPolling();
    stopSpeedPositionEvents();
    endHandleResize();
    window.removeEventListener("resize", resizeMap);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    document.removeEventListener("pointerdown", closeLayerMenuOnDocumentPointerDown, true);
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

  recenterBtn.addEventListener("click", () => toggleFollow());
  orientationBtn.addEventListener("click", () => cycleOrientationMode());
  refreshBtn.addEventListener("click", () => {
    refresh().catch(() => {});
  });

  layerButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  layerButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setLayerMenuOpen(layerMenu.hidden);
  });
  layerButton.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setLayerMenuOpen(true);
      focusLayerOption();
    } else if (event.key === "Escape") {
      setLayerMenuOpen(false);
    }
  });
  layerMenu.addEventListener("pointerdown", (event) => event.stopPropagation());
  layerMenu.addEventListener("click", (event) => {
    const option = event.target?.closest?.(".camera-map-layer-option");
    if (!option) return;
    event.stopPropagation();
    selectLayerValue(option.dataset.layerId);
  });
  layerMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setLayerMenuOpen(false);
      layerButton.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveLayerOptionFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveLayerOptionFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      getLayerOptionElements()[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      getLayerOptionElements().at(-1)?.focus();
    }
  });

  resizeHandle.addEventListener("pointerdown", (event) => {
    if (isFullscreenActive()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    if (shellManager.getWindow(CAMERA_MAP_WINDOW_ID)?.snap) {
      shellManager.unsnapWindow?.(CAMERA_MAP_WINDOW_ID, { preserveSnap: false });
    }
    setLayerMenuOpen(false);

    const bounds = getPanelBounds();
    resizeInProgress = true;
    resizePointerId = event.pointerId;
    resizeStartX = resizeLastX = event.clientX;
    resizeStartY = resizeLastY = event.clientY;
    resizeStartWidth = bounds.width;
    resizeStartHeight = bounds.height;
    panel.classList.add("is-resizing");
    document.documentElement.classList.add("vb-floating-drag-active");

    try {
      resizeHandle.setPointerCapture?.(resizePointerId);
    } catch {
      // Pointer capture is best effort on older Chromium builds.
    }
  }, { passive: false });

  resizeHandle.addEventListener("pointermove", (event) => {
    if (!resizeInProgress || event.pointerId !== resizePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeLastX = event.clientX;
    resizeLastY = event.clientY;
    scheduleHandleResize();
  }, { passive: false });

  resizeHandle.addEventListener("pointerup", (event) => {
    if (event.pointerId !== resizePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    endHandleResize(event);
  });
  resizeHandle.addEventListener("pointercancel", endHandleResize);
  resizeHandle.addEventListener("lostpointercapture", endHandleResize);
  resizeHandle.addEventListener("keydown", (event) => {
    if (isFullscreenActive()) return;
    const step = event.shiftKey ? 80 : 32;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      resizePanelBy(step, 0);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizePanelBy(-step, 0);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      resizePanelBy(0, step);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      resizePanelBy(0, -step);
    }
  });

  window.addEventListener("resize", resizeMap, { passive: true });
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("pointerdown", closeLayerMenuOnDocumentPointerDown, true);
  startColorSchemeListener();

  if (button) {
    button.addEventListener("click", toggle);
  }

  mount.appendChild(panel);
  updateNavigationButtons();
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
    updatePosition,
    setProjectionMode,
    getNavigationState: () => ({
      followEnabled,
      followPaused,
      navigationMode,
      orientationMode,
      projectionMode,
      currentLivePosition,
      position: currentLivePosition,
      latestHeading: navigationCameraState.latestHeading ?? lastHeadingState?.heading ?? null,
      headingAvailable: navigationCameraState.headingAvailable || lastHeadingState?.headingAvailable === true,
      headingSource: navigationCameraState.headingSource || lastHeadingState?.source || "none",
      latestBearingApplied: navigationCameraState.latestBearingApplied,
      lastCameraCommandReason: navigationCameraState.lastCameraCommandReason,
      lastCameraCommand,
      heading: lastHeadingState,
    }),
  };
}
