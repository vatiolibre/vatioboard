import { IconCameraMap, IconClose } from "../icons.js";
import { t } from "../i18n.js";
import { createDrivingAlertService } from "../app/services/driving-alert-service.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import { registerFloatingPanel } from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import {
  ALERT_CONFIG,
  DEFAULT_ALERT_LIMIT_MS,
  DISTANCE_UNIT_CONFIG,
  TRAP_ALERT_PRESETS,
  UNIT_CONFIG,
} from "./constants.js";
import {
  getAlertLimitDisplayValue,
  isManualAlertActive,
  normalizeAlertDisplayValue,
} from "./alerts.js";
import { normalizeTrapAlertDistance } from "./preferences.js";
import { convertDisplaySpeedToMs, convertSpeed, tf } from "./render.js";
import { formatTrapDistance, formatTrapSpeed } from "./traps.js";

export const SPEED_ALERT_PANEL_WINDOW_ID = "speed-alerts";

const VISIBILITY_KEY = "vatioboard.speed_alerts_panel.visible_v1";
const POS_KEY = "vatioboard.speed_alerts_panel.pos_v1";
const DRAG_THRESHOLD_PX = 6;
const RESIZE_MIN_WIDTH = 320;
const RESIZE_MIN_HEIGHT = 420;
const RESIZE_MARGIN_PX = 12;
const DEFAULT_BOUNDS = {
  left: 24,
  top: 86,
  width: 430,
  height: 620,
};

function createElement(tagName, attrs = {}, children = []) {
  const element = document.createElement(tagName);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "html") element.innerHTML = value;
    else if (key.startsWith("data-")) element.setAttribute(key, String(value));
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined) continue;
    element.append(child);
  }
  return element;
}

function createActionButton({
  className,
  label,
  labelKey = "",
  icon = "",
  text = "",
} = {}) {
  const button = createElement("button", {
    type: "button",
    class: className,
    "aria-label": label,
    title: label,
  });
  if (labelKey) {
    button.dataset.i18nAria = labelKey;
    button.dataset.i18nTitle = labelKey;
  }
  if (icon) {
    button.append(createElement("span", {
      class: "speed-alert-window-icon",
      html: icon,
      "aria-hidden": "true",
    }));
  }
  if (text) {
    button.append(createElement("span", { text }));
  }
  return button;
}

function createSegmentedButton(label, value, key, className) {
  const button = createElement("button", {
    type: "button",
    class: className,
    text: label,
    "aria-pressed": "false",
  });
  button.dataset[key] = String(value);
  return button;
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Panel placement is convenience state only.
  }
}

function loadPos() {
  return readJsonStorage(POS_KEY);
}

function savePos(pos) {
  writeJsonStorage(POS_KEY, pos || {});
}

function applyInitialBounds(panel, shellManager) {
  const storedWindow = shellManager?.getWindow?.(SPEED_ALERT_PANEL_WINDOW_ID);
  const storedBounds = storedWindow?.bounds;
  const legacyPos = loadPos()?.panel;
  const bounds = storedBounds || {
    ...DEFAULT_BOUNDS,
    ...(legacyPos?.left ? { left: Number.parseFloat(legacyPos.left) } : {}),
    ...(legacyPos?.top ? { top: Number.parseFloat(legacyPos.top) } : {}),
  };

  panel.style.position = "fixed";
  panel.style.left = `${Math.round(bounds.left ?? DEFAULT_BOUNDS.left)}px`;
  panel.style.top = `${Math.round(bounds.top ?? DEFAULT_BOUNDS.top)}px`;
  panel.style.width = `${Math.round(bounds.width ?? DEFAULT_BOUNDS.width)}px`;
  panel.style.height = `${Math.round(bounds.height ?? DEFAULT_BOUNDS.height)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function formatCameraDatabaseDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatCameraDatabaseCount(value) {
  const count = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  try {
    return count.toLocaleString();
  } catch {
    return String(count);
  }
}

function getCameraDatabaseStatusText(cameraStatus = {}) {
  const country = cameraStatus.activeCountryName || cameraStatus.activeCountryCode?.toUpperCase?.() || "";
  const count = formatCameraDatabaseCount(cameraStatus.cameraCount);
  const date = formatCameraDatabaseDate(cameraStatus.lastUpdated);

  if (cameraStatus.status === "loading" || (cameraStatus.updating && !cameraStatus.cameraCount)) {
    return t("cameraDatabaseUpdating");
  }
  if (cameraStatus.status === "offline" && cameraStatus.cacheHit) {
    return date
      ? tf(t, "cameraDatabaseOfflineCachedDate", { date })
      : t("cameraDatabaseOfflineCached");
  }
  if (cameraStatus.status === "ready" || cameraStatus.status === "stale") {
    if (country && cameraStatus.cameraCount > 0) {
      return cameraStatus.cacheHit
        ? tf(t, "cameraDatabaseSummaryCached", { country, count })
        : tf(t, "cameraDatabaseSummary", { country, count });
    }
    return cameraStatus.updating ? t("cameraDatabaseUpdating") : t("cameraDatabaseUnavailableRegion");
  }
  if (cameraStatus.unavailable || cameraStatus.status === "error") {
    return t("cameraDatabaseUnavailableRegion");
  }
  return t("cameraDatabaseWaitingGps");
}

function getTrapAlertDistanceLabel(distanceM, distanceUnit) {
  const formatted = formatTrapDistance(distanceM, distanceUnit, t("away"));
  if (formatted.value === "—") return "—";
  return `${formatted.value} ${formatted.unit}`;
}

function getStatusLabel(snapshot = {}) {
  const audio = snapshot.audio || {};
  const preferences = snapshot.preferences || {};
  if (preferences.audioMuted || audio.muted) return t("muted");
  if (snapshot.status === "active") return t("active");
  if (snapshot.status === "camera-loading") return t("loadingTrapData");
  if (snapshot.status === "camera-unavailable") return t("trapDataUnavailable");
  if (snapshot.status === "gps-stale") return t("waitingForGps");
  if (audio.backgroundAudioArmPending || audio.pending) return t("activitySpeedAlertsArming");
  if (audio.blocked) return t("activitySpeedAlertsBlocked");
  if (audio.backgroundAudioArmed || audio.primed) return t("activitySpeedAlertsArmed");
  return t("off");
}

function getAudioStatusText(snapshot = {}) {
  const audio = snapshot.audio || {};
  const preferences = snapshot.preferences || {};
  if (preferences.audioMuted || audio.muted) return t("speedAlertsAudioMuted");
  if (audio.blocked) return t("activitySpeedAlertsUserAction");
  if (audio.backgroundAudioArmPending || audio.pending) return t("activitySpeedAlertsArming");
  if (audio.backgroundAudioArmed || audio.primed) return t("activitySpeedAlertsReady");
  return t("speedAlertsAudioNeedsTap");
}

function buildPanel() {
  const titleId = "speed-alerts-title";
  const title = createElement("strong", {
    id: titleId,
    class: "speed-alert-window-title",
    text: t("alertSettingsTitle"),
  });
  title.dataset.i18n = "alertSettingsTitle";

  const statusChip = createElement("span", {
    class: "speed-alert-window-status",
    role: "status",
    "aria-live": "polite",
    text: t("off"),
  });

  const closeBtn = createActionButton({
    className: "speed-alert-window-action speed-alert-window-close",
    label: t("closeSpeedAlerts"),
    labelKey: "closeSpeedAlerts",
    icon: IconClose,
  });

  const header = createElement("div", { class: "speed-alert-window-header" }, [
    createElement("div", { class: "speed-alert-window-heading" }, [
      title,
    ]),
    statusChip,
    createElement("div", { class: "speed-alert-window-actions" }, [closeBtn]),
  ]);

  const manualToggle = createElement("button", {
    type: "button",
    class: "speed-alert-window-primary",
    text: t("turnOn"),
    "aria-pressed": "false",
  });
  const useCurrent = createElement("button", {
    type: "button",
    class: "speed-alert-window-secondary",
    text: t("useCurrentSpeed"),
  });
  const decrease = createElement("button", {
    type: "button",
    class: "speed-alert-window-step",
    text: "-",
    "aria-label": t("decreaseSpeedAlert"),
  });
  const increase = createElement("button", {
    type: "button",
    class: "speed-alert-window-step",
    text: "+",
    "aria-label": t("increaseSpeedAlert"),
  });
  const limitValue = createElement("span", { class: "speed-alert-window-limit-value", text: "100" });
  const limitUnit = createElement("span", { class: "speed-alert-window-limit-unit", text: "km/h" });
  const speedPresets = createElement("div", {
    class: "speed-alert-window-presets",
    role: "group",
    "aria-label": t("quickSpeedAlertPresets"),
  });
  const alertSoundButtons = createElement("div", {
    class: "speed-alert-window-segmented",
    role: "group",
    "aria-label": t("overspeedSound"),
  }, [
    createSegmentedButton(t("off"), "off", "alertSound", "speed-alert-window-segment"),
    createSegmentedButton(t("on"), "on", "alertSound", "speed-alert-window-segment"),
  ]);

  const manualSection = createElement("section", {
    class: "speed-alert-window-section",
    "aria-label": t("speedAlertSettings"),
  }, [
    createElement("span", { class: "speed-alert-window-section-title", text: t("manualSpeed") }),
    createElement("div", { class: "speed-alert-window-button-row" }, [manualToggle, useCurrent]),
    createElement("div", {
      class: "speed-alert-window-stepper",
      role: "group",
      "aria-label": t("setAlertSpeedLimit"),
    }, [
      decrease,
      createElement("div", { class: "speed-alert-window-limit" }, [limitValue, limitUnit]),
      increase,
    ]),
    speedPresets,
    createElement("div", { class: "speed-alert-window-setting" }, [
      createElement("span", { class: "speed-alert-window-label", text: t("overspeedSound") }),
      alertSoundButtons,
    ]),
    createElement("p", { class: "speed-alert-window-note", text: t("nearbyTrapOverrides") }),
  ]);

  const trapAlertButtons = createElement("div", {
    class: "speed-alert-window-segmented",
    role: "group",
    "aria-label": t("trapAlerts"),
  }, [
    createSegmentedButton(t("off"), "off", "trapAlert", "speed-alert-window-segment"),
    createSegmentedButton(t("on"), "on", "trapAlert", "speed-alert-window-segment"),
  ]);
  const trapDistancePresets = createElement("div", {
    class: "speed-alert-window-presets",
    role: "group",
    "aria-label": t("trapAlertDistancePresets"),
  });
  const trapSoundButtons = createElement("div", {
    class: "speed-alert-window-segmented",
    role: "group",
    "aria-label": t("trapSound"),
  }, [
    createSegmentedButton(t("off"), "off", "trapSound", "speed-alert-window-segment"),
    createSegmentedButton(t("on"), "on", "trapSound", "speed-alert-window-segment"),
  ]);
  const nearestTrap = createElement("p", { class: "speed-alert-window-note", text: t("speedAlertsNoNearbyCamera") });
  const cameraApproach = createElement("p", { class: "speed-alert-window-note", text: "" });
  const cameraDatabaseStatus = createElement("p", {
    class: "speed-alert-window-camera-status",
    text: t("cameraDatabaseWaitingGps"),
  });
  const openCameraMap = createElement("button", {
    type: "button",
    class: "speed-alert-window-map",
  }, [
    createElement("span", { class: "speed-alert-window-icon", html: IconCameraMap, "aria-hidden": "true" }),
    createElement("span", { text: t("openCameraMap") }),
  ]);

  const cameraSection = createElement("section", {
    class: "speed-alert-window-section",
    "aria-label": t("trapAlertSettings"),
  }, [
    createElement("span", { class: "speed-alert-window-section-title", text: t("trapAlerts") }),
    createElement("div", { class: "speed-alert-window-setting" }, [
      createElement("span", { class: "speed-alert-window-label", text: t("trapAlerts") }),
      trapAlertButtons,
    ]),
    createElement("div", { class: "speed-alert-window-setting speed-alert-window-setting--stack" }, [
      createElement("span", { class: "speed-alert-window-label", text: t("alertDistance") }),
      trapDistancePresets,
    ]),
    createElement("div", { class: "speed-alert-window-setting" }, [
      createElement("span", { class: "speed-alert-window-label", text: t("trapSound") }),
      trapSoundButtons,
    ]),
    nearestTrap,
    cameraApproach,
    createElement("div", { class: "speed-alert-window-camera-row" }, [
      cameraDatabaseStatus,
      openCameraMap,
      createElement("a", {
        class: "speed-alert-window-attribution",
        href: "https://www.openstreetmap.org/copyright",
        target: "_blank",
        rel: "noopener noreferrer",
        text: t("cameraDatabaseAttribution"),
      }),
    ]),
  ]);

  const muteToggle = createElement("button", {
    type: "button",
    class: "speed-alert-window-secondary",
    text: t("muteAlertAudio"),
    "aria-pressed": "false",
  });
  const primeAudio = createElement("button", {
    type: "button",
    class: "speed-alert-window-primary",
    text: t("enableDrivingAlerts"),
  });
  const audioStatus = createElement("p", {
    class: "speed-alert-window-note",
    text: t("speedAlertsAudioNeedsTap"),
  });

  const audioSection = createElement("section", {
    class: "speed-alert-window-section speed-alert-window-section--compact",
    "aria-label": t("audio"),
  }, [
    createElement("span", { class: "speed-alert-window-section-title", text: t("audio") }),
    createElement("div", { class: "speed-alert-window-button-row" }, [muteToggle, primeAudio]),
    audioStatus,
  ]);

  const unitButtons = createElement("div", {
    class: "speed-alert-window-segmented",
    role: "group",
    "aria-label": t("speedUnit"),
  }, [
    createSegmentedButton("km/h", "kmh", "unit", "speed-alert-window-segment"),
    createSegmentedButton("mph", "mph", "unit", "speed-alert-window-segment"),
  ]);
  const distanceUnitButtons = createElement("div", {
    class: "speed-alert-window-segmented",
    role: "group",
    "aria-label": t("distanceUnit"),
  }, [
    createSegmentedButton("m", "m", "distanceUnit", "speed-alert-window-segment"),
    createSegmentedButton("ft", "ft", "distanceUnit", "speed-alert-window-segment"),
  ]);

  const unitsSection = createElement("section", {
    class: "speed-alert-window-section speed-alert-window-units",
    "aria-label": t("units"),
  }, [
    createElement("span", { class: "speed-alert-window-section-title", text: t("units") }),
    createElement("div", { class: "speed-alert-window-setting" }, [
      createElement("span", { class: "speed-alert-window-label", text: t("speed") }),
      unitButtons,
    ]),
    createElement("div", { class: "speed-alert-window-setting" }, [
      createElement("span", { class: "speed-alert-window-label", text: t("distance") }),
      distanceUnitButtons,
    ]),
  ]);

  const footer = createElement("p", {
    class: "speed-alert-window-footer",
    text: t("speedAlertsLocalFirst"),
  });

  const resizeHandle = createElement("button", {
    type: "button",
    class: "speed-alert-window-resize",
    "aria-label": t("resizeSpeedAlerts"),
    title: t("resizeSpeedAlerts"),
  });

  const panel = createElement("section", {
    class: "speed-alert-window",
    hidden: true,
    role: "dialog",
    "aria-labelledby": titleId,
  }, [
    header,
    createElement("div", { class: "speed-alert-window-body" }, [
      manualSection,
      cameraSection,
      audioSection,
      unitsSection,
      footer,
    ]),
    resizeHandle,
  ]);

  return {
    alertSoundButtons,
    audioStatus,
    cameraApproach,
    cameraDatabaseStatus,
    closeBtn,
    decrease,
    distanceUnitButtons,
    header,
    increase,
    limitUnit,
    limitValue,
    manualToggle,
    muteToggle,
    nearestTrap,
    openCameraMap,
    panel,
    primeAudio,
    resizeHandle,
    speedPresets,
    statusChip,
    trapAlertButtons,
    trapDistancePresets,
    trapSoundButtons,
    unitButtons,
    useCurrent,
  };
}

function getPanelBounds(panel) {
  const rect = panel.getBoundingClientRect();
  return {
    left: Number.parseFloat(panel.style.left) || rect.left || DEFAULT_BOUNDS.left,
    top: Number.parseFloat(panel.style.top) || rect.top || DEFAULT_BOUNDS.top,
    width: Math.round(rect.width || panel.offsetWidth || Number.parseFloat(panel.style.width) || DEFAULT_BOUNDS.width),
    height: Math.round(rect.height || panel.offsetHeight || Number.parseFloat(panel.style.height) || DEFAULT_BOUNDS.height),
  };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampResizeBounds(width, height, bounds = {}) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
  const maxWidth = Math.max(RESIZE_MIN_WIDTH, viewportWidth - bounds.left - RESIZE_MARGIN_PX);
  const maxHeight = Math.max(RESIZE_MIN_HEIGHT, viewportHeight - bounds.top - RESIZE_MARGIN_PX);
  return {
    ...bounds,
    width: Math.round(clampNumber(width, Math.min(RESIZE_MIN_WIDTH, maxWidth), maxWidth)),
    height: Math.round(clampNumber(height, Math.min(RESIZE_MIN_HEIGHT, maxHeight), maxHeight)),
  };
}

export function createSpeedAlertPanel(options = {}) {
  const {
    mount = document.body,
    shellManager = getDefaultShellWindowManager({ root: mount }),
    gpsService = window.__vatioboardGpsStore || null,
    drivingAlertService = window.__vatioboardDrivingAlerts || null,
    restoreVisibility = true,
    initialOpen = false,
    onOpenCameraMap = null,
  } = options;

  const ownedService = drivingAlertService
    ? null
    : createDrivingAlertService({ gpsService });
  const service = drivingAlertService || ownedService;
  const refs = buildPanel();
  const { panel } = refs;
  let latestSnapshot = service.getSnapshot?.() || {};
  let cleanupLayer = () => {};
  let unsubscribeService = () => {};
  let destroyed = false;
  let resizePointerId = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeLastX = 0;
  let resizeLastY = 0;
  let resizeRafId = 0;
  let resizing = false;
  const handleI18nChange = () => syncFromService(service.getSnapshot?.() || latestSnapshot);

  applyInitialBounds(panel, shellManager);

  function saveVisibility(isOpen) {
    try {
      localStorage.setItem(VISIBILITY_KEY, isOpen ? "open" : "closed");
    } catch {
      // Shell layout remains the durable source when storage is unavailable.
    }
  }

  function loadVisibility() {
    if (!restoreVisibility) return false;
    try {
      return localStorage.getItem(VISIBILITY_KEY) === "open";
    } catch {
      return false;
    }
  }

  function updateShellBounds(bounds, shellOptions = {}) {
    shellManager.updateWindowBounds?.(SPEED_ALERT_PANEL_WINDOW_ID, bounds, shellOptions);
  }

  function applyPanelResize(width, height, shellOptions = {}) {
    const bounds = clampResizeBounds(width, height, getPanelBounds(panel));
    panel.style.position = "fixed";
    panel.style.left = `${Math.round(bounds.left)}px`;
    panel.style.top = `${Math.round(bounds.top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${bounds.width}px`;
    panel.style.height = `${bounds.height}px`;
    updateShellBounds(bounds, shellOptions);
  }

  function applyHandleResize() {
    resizeRafId = 0;
    if (!resizing) return;
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
      if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(resizeRafId);
      else window.clearTimeout(resizeRafId);
      resizeRafId = 0;
      applyHandleResize();
    }
    if (!resizing) return;
    resizing = false;
    resizePointerId = null;
    panel.classList.remove("is-resizing");
    document.documentElement.classList.remove("vb-floating-drag-active");
    updateShellBounds(getPanelBounds(panel), { flush: true });
  }

  function resizePanelBy(deltaWidth, deltaHeight) {
    const bounds = getPanelBounds(panel);
    applyPanelResize(bounds.width + deltaWidth, bounds.height + deltaHeight, { flush: true });
  }

  function renderSpeedPresets(unit, currentValue) {
    if (refs.speedPresets.dataset.unit !== unit) {
      const fragment = document.createDocumentFragment();
      for (const preset of ALERT_CONFIG[unit].presets) {
        fragment.append(createSegmentedButton(
          `${preset} ${UNIT_CONFIG[unit].label}`,
          preset,
          "alertPreset",
          "speed-alert-window-preset",
        ));
      }
      refs.speedPresets.replaceChildren(fragment);
      refs.speedPresets.dataset.unit = unit;
    }
    for (const button of refs.speedPresets.querySelectorAll("button[data-alert-preset]")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.alertPreset) === currentValue));
    }
  }

  function renderTrapDistancePresets(distanceUnit, currentDistance) {
    if (refs.trapDistancePresets.dataset.unit !== distanceUnit) {
      const fragment = document.createDocumentFragment();
      for (const preset of TRAP_ALERT_PRESETS[distanceUnit]) {
        fragment.append(createSegmentedButton(
          preset.label,
          preset.meters,
          "trapDistance",
          "speed-alert-window-preset",
        ));
      }
      refs.trapDistancePresets.replaceChildren(fragment);
      refs.trapDistancePresets.dataset.unit = distanceUnit;
    }
    for (const button of refs.trapDistancePresets.querySelectorAll("button[data-trap-distance]")) {
      button.setAttribute("aria-pressed", String(Math.abs(Number(button.dataset.trapDistance) - currentDistance) < 1));
    }
  }

  function setSegmentedPressed(container, key, value) {
    const attr = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    for (const button of container.querySelectorAll(`button[data-${attr}]`)) {
      button.setAttribute("aria-pressed", String(button.dataset[key] === String(value)));
    }
  }

  function syncFromService(snapshot = service.getSnapshot?.() || latestSnapshot) {
    latestSnapshot = snapshot || {};
    const preferences = latestSnapshot.preferences || {};
    const unit = UNIT_CONFIG[preferences.unit] ? preferences.unit : "kmh";
    const distanceUnit = DISTANCE_UNIT_CONFIG[preferences.distanceUnit] ? preferences.distanceUnit : "m";
    const alertLimitMs = Number.isFinite(preferences.alertLimitMs)
      ? preferences.alertLimitMs
      : DEFAULT_ALERT_LIMIT_MS;
    const currentLimitDisplay = getAlertLimitDisplayValue(alertLimitMs, unit, convertSpeed);
    const normalizedLimit = normalizeAlertDisplayValue(currentLimitDisplay, unit);
    const manualActive = isManualAlertActive(preferences.alertEnabled, alertLimitMs);
    const currentSpeedDisplay = Math.round(convertSpeed(latestSnapshot.currentSpeedMs || 0, unit));
    const canUseCurrentSpeed = currentSpeedDisplay >= ALERT_CONFIG[unit].min;
    const trapDistanceM = normalizeTrapAlertDistance(
      Number.isFinite(preferences.trapAlertDistanceM) ? preferences.trapAlertDistanceM : 500,
      distanceUnit,
    );
    const audio = latestSnapshot.audio || {};
    const cameraStatus = latestSnapshot.cameraDatabaseStatus || {};
    const nearestDistance = latestSnapshot.nearestTrapDistanceM;
    const nearestSpeed = latestSnapshot.nearestTrapSpeedKph;

    refs.statusChip.textContent = getStatusLabel(latestSnapshot);
    refs.statusChip.dataset.status = latestSnapshot.status || "idle";
    refs.manualToggle.textContent = manualActive ? t("turnOff") : t("turnOn");
    refs.manualToggle.setAttribute("aria-pressed", String(manualActive));
    refs.useCurrent.disabled = !canUseCurrentSpeed;
    refs.limitValue.textContent = String(currentLimitDisplay);
    refs.limitUnit.textContent = UNIT_CONFIG[unit].label;
    refs.decrease.disabled = currentLimitDisplay <= ALERT_CONFIG[unit].min;
    refs.increase.disabled = currentLimitDisplay >= ALERT_CONFIG[unit].max;
    renderSpeedPresets(unit, normalizedLimit);

    setSegmentedPressed(refs.alertSoundButtons, "alertSound", preferences.alertSoundEnabled ? "on" : "off");
    setSegmentedPressed(refs.trapAlertButtons, "trapAlert", preferences.trapAlertEnabled ? "on" : "off");
    renderTrapDistancePresets(distanceUnit, trapDistanceM);
    setSegmentedPressed(refs.trapSoundButtons, "trapSound", preferences.trapSoundEnabled ? "on" : "off");
    setSegmentedPressed(refs.unitButtons, "unit", unit);
    setSegmentedPressed(refs.distanceUnitButtons, "distanceUnit", distanceUnit);

    refs.muteToggle.textContent = preferences.audioMuted || audio.muted ? t("unmuteAlertAudio") : t("muteAlertAudio");
    refs.muteToggle.setAttribute("aria-pressed", String(Boolean(preferences.audioMuted || audio.muted)));
    refs.primeAudio.disabled = Boolean(preferences.audioMuted || audio.backgroundAudioArmed);
    refs.audioStatus.textContent = getAudioStatusText(latestSnapshot);

    if (Number.isFinite(nearestDistance)) {
      const distanceLabel = getTrapAlertDistanceLabel(nearestDistance, distanceUnit);
      const speedLabel = formatTrapSpeed(nearestSpeed, unit);
      refs.nearestTrap.textContent = speedLabel
        ? `${t("nearestTrap")}: ${distanceLabel} · ${speedLabel}`
        : `${t("nearestTrap")}: ${distanceLabel}`;
    } else {
      refs.nearestTrap.textContent = t("speedAlertsNoNearbyCamera");
    }

    const approachState = latestSnapshot.cameraApproachState || "none";
    const approachReason = latestSnapshot.cameraApproachReason || "";
    refs.cameraApproach.textContent = approachState === "none"
      ? t("speedAlertsNoApproach")
      : `${t("speedAlertsApproach")}: ${approachState}${approachReason ? ` · ${approachReason}` : ""}`;

    refs.cameraDatabaseStatus.textContent = getCameraDatabaseStatusText(cameraStatus);
    refs.cameraDatabaseStatus.dataset.status = cameraStatus.status || "idle";
    refs.cameraDatabaseStatus.classList.toggle("is-offline", Boolean(cameraStatus.offline));
    refs.cameraDatabaseStatus.classList.toggle("is-updating", Boolean(cameraStatus.updating));
  }

  function showPanel({ persist = true, focus = true } = {}) {
    panel.hidden = false;
    if (persist) saveVisibility(true);
    syncFromService();
    if (panel.style.left && panel.style.top) clampElementToViewport(panel);
    if (focus) {
      window.setTimeout(() => refs.manualToggle.focus({ preventScroll: true }), 0);
    }
  }

  function hidePanel({ persist = true } = {}) {
    panel.hidden = true;
    if (persist) saveVisibility(false);
  }

  function minimizePanel() {
    panel.hidden = true;
  }

  function open(openOptions = {}) {
    showPanel(openOptions);
    shellManager.openWindow?.(SPEED_ALERT_PANEL_WINDOW_ID, { ...openOptions, invokeLifecycle: false });
  }

  function close(closeOptions = {}) {
    hidePanel(closeOptions);
    shellManager.closeWindow?.(SPEED_ALERT_PANEL_WINDOW_ID, { ...closeOptions, invokeLifecycle: false });
  }

  function toggle(toggleOptions = {}) {
    const record = shellManager.getWindow?.(SPEED_ALERT_PANEL_WINDOW_ID);
    if (record?.state === "open" && !panel.hidden) close(toggleOptions);
    else open(toggleOptions);
  }

  function openCameraMap() {
    if (typeof onOpenCameraMap === "function") {
      onOpenCameraMap();
      return;
    }
    window.__vatioboardFloatingTools?.openCameraMap?.();
  }

  function setManualLimitDisplay(value, { enable = true } = {}) {
    const preferences = latestSnapshot.preferences || {};
    const unit = UNIT_CONFIG[preferences.unit] ? preferences.unit : "kmh";
    const normalizedValue = normalizeAlertDisplayValue(value, unit);
    const limitMs = convertDisplaySpeedToMs(normalizedValue, unit);
    service.setManualAlertLimitMs?.(limitMs, { fromUserGesture: true });
    if (enable) service.setManualAlertEnabled?.(true, { fromUserGesture: true });
  }

  function adjustManualLimit(direction) {
    const preferences = latestSnapshot.preferences || {};
    const unit = UNIT_CONFIG[preferences.unit] ? preferences.unit : "kmh";
    const limitMs = Number.isFinite(preferences.alertLimitMs) ? preferences.alertLimitMs : DEFAULT_ALERT_LIMIT_MS;
    const currentValue = normalizeAlertDisplayValue(
      getAlertLimitDisplayValue(limitMs, unit, convertSpeed),
      unit,
    );
    setManualLimitDisplay(currentValue + direction * ALERT_CONFIG[unit].step);
  }

  function addEventListeners() {
    refs.closeBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
    refs.closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      close();
    });
    refs.manualToggle.addEventListener("click", () => {
      const preferences = latestSnapshot.preferences || {};
      service.setManualAlertEnabled?.(
        !isManualAlertActive(preferences.alertEnabled, preferences.alertLimitMs),
        { fromUserGesture: true },
      );
    });
    refs.useCurrent.addEventListener("click", () => {
      const preferences = latestSnapshot.preferences || {};
      const unit = UNIT_CONFIG[preferences.unit] ? preferences.unit : "kmh";
      setManualLimitDisplay(Math.round(convertSpeed(latestSnapshot.currentSpeedMs || 0, unit)));
    });
    refs.decrease.addEventListener("click", () => adjustManualLimit(-1));
    refs.increase.addEventListener("click", () => adjustManualLimit(1));
    refs.speedPresets.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-alert-preset]");
      if (!button) return;
      setManualLimitDisplay(Number(button.dataset.alertPreset));
    });
    refs.alertSoundButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-alert-sound]");
      if (!button) return;
      service.setAlertSoundEnabled?.(button.dataset.alertSound === "on", { fromUserGesture: true });
    });
    refs.trapAlertButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-trap-alert]");
      if (!button) return;
      service.setTrapAlertEnabled?.(button.dataset.trapAlert === "on", { fromUserGesture: true });
    });
    refs.trapDistancePresets.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-trap-distance]");
      if (!button) return;
      service.setTrapAlertDistanceM?.(Number(button.dataset.trapDistance), { fromUserGesture: true });
      service.setTrapAlertEnabled?.(true, { fromUserGesture: true });
    });
    refs.trapSoundButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-trap-sound]");
      if (!button) return;
      service.setTrapSoundEnabled?.(button.dataset.trapSound === "on", { fromUserGesture: true });
    });
    refs.unitButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-unit]");
      if (!button) return;
      service.setUnits?.({ unit: button.dataset.unit });
    });
    refs.distanceUnitButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-distance-unit]");
      if (!button) return;
      service.setUnits?.({ distanceUnit: button.dataset.distanceUnit });
    });
    refs.muteToggle.addEventListener("click", () => {
      const preferences = latestSnapshot.preferences || {};
      service.setMuted?.(!preferences.audioMuted, { fromUserGesture: true });
    });
    refs.primeAudio.addEventListener("click", () => {
      service.primeAudioFromUserGesture?.();
    });
    refs.openCameraMap.addEventListener("click", openCameraMap);
    refs.resizeHandle.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (shellManager.getWindow?.(SPEED_ALERT_PANEL_WINDOW_ID)?.snap) {
        shellManager.unsnapWindow?.(SPEED_ALERT_PANEL_WINDOW_ID, { preserveSnap: false });
      }
      const bounds = getPanelBounds(panel);
      resizing = true;
      resizePointerId = event.pointerId;
      resizeStartX = resizeLastX = event.clientX;
      resizeStartY = resizeLastY = event.clientY;
      resizeStartWidth = bounds.width;
      resizeStartHeight = bounds.height;
      panel.classList.add("is-resizing");
      document.documentElement.classList.add("vb-floating-drag-active");
      try {
        refs.resizeHandle.setPointerCapture?.(resizePointerId);
      } catch {
        // Pointer capture is best effort.
      }
    }, { passive: false });
    refs.resizeHandle.addEventListener("pointermove", (event) => {
      if (!resizing || event.pointerId !== resizePointerId) return;
      event.preventDefault();
      event.stopPropagation();
      resizeLastX = event.clientX;
      resizeLastY = event.clientY;
      scheduleHandleResize();
    }, { passive: false });
    refs.resizeHandle.addEventListener("pointerup", endHandleResize);
    refs.resizeHandle.addEventListener("pointercancel", endHandleResize);
    refs.resizeHandle.addEventListener("lostpointercapture", endHandleResize);
    refs.resizeHandle.addEventListener("keydown", (event) => {
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
  }

  cleanupLayer = registerFloatingPanel(panel, {
    id: SPEED_ALERT_PANEL_WINDOW_ID,
    kind: "tool",
    title: t("alertSettingsTitle"),
    shellManager,
    storageKey: VISIBILITY_KEY,
    bounds: DEFAULT_BOUNDS,
    restoreBounds: DEFAULT_BOUNDS,
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
      destroy: () => {},
    },
  });

  makePanelDraggable({
    panel,
    header: refs.header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
    shellWindowId: SPEED_ALERT_PANEL_WINDOW_ID,
    shellManager,
    enableSnapPreview: shellManager.getShellPreference?.("snapEnabled") !== false,
  });

  addEventListeners();
  unsubscribeService = service.subscribe?.(syncFromService) || (() => {});
  document.addEventListener("i18n:change", handleI18nChange);
  mount.append(panel);
  syncFromService(latestSnapshot);

  if (initialOpen || loadVisibility()) {
    open({ focus: false });
  }

  return {
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("i18n:change", handleI18nChange);
      endHandleResize();
      unsubscribeService();
      cleanupLayer();
      ownedService?.destroy?.();
      panel.remove();
    },
    getElement: () => panel,
    isOpen: () => !panel.hidden,
    open,
    syncFromService,
    toggle,
  };
}
