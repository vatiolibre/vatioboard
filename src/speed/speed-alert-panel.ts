import { IconCameraMap, IconClose, IconMinimize } from "../icons.js";
import { t } from "../i18n.js";
import { createDrivingAlertService } from "../app/services/driving-alert-service.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import { registerFloatingPanel } from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import { isFocusedLandscapeProfile } from "../shared/shell-layout-metrics.js";
import {
  createSegmentedControl,
  createSelectControl,
  createSettingsSwitch,
  type SettingsControlOption,
} from "../shared/ui/settings-controls.js";
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

type AnyRecord = Record<string, any>;

export const SPEED_ALERT_PANEL_WINDOW_ID = "speed-alerts";

export interface SpeedAlertPanelApi {
  close(options?: AnyRecord): void;
  destroy(): void;
  getElement(): HTMLElement;
  isOpen(): boolean;
  minimize(options?: AnyRecord): void;
  open(options?: AnyRecord): void;
  syncFromService(snapshot?: AnyRecord): void;
  toggle(options?: AnyRecord): void;
}

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
  height: 540,
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
}: AnyRecord = {}) {
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

function loadPos(): any {
  return readJsonStorage(POS_KEY);
}

function savePos(pos) {
  writeJsonStorage(POS_KEY, pos || {});
}

function applyInitialBounds(panel, shellManager) {
  const storedWindow = shellManager?.getWindow?.(SPEED_ALERT_PANEL_WINDOW_ID);
  const storedBounds: any = storedWindow?.bounds;
  const legacyPos = loadPos()?.panel;
  const bounds: any = storedBounds || {
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

function getCameraDatabaseStatusText(cameraStatus: AnyRecord = {}) {
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

function getStatusLabel(snapshot: AnyRecord = {}) {
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

function getAudioStatusText(snapshot: AnyRecord = {}) {
  const audio = snapshot.audio || {};
  const preferences = snapshot.preferences || {};
  if (preferences.audioMuted || audio.muted) return t("speedAlertsAudioMuted");
  if (audio.blocked) return t("activitySpeedAlertsUserAction");
  if (audio.backgroundAudioArmPending || audio.pending) return t("activitySpeedAlertsArming");
  if (audio.backgroundAudioArmed || audio.primed) return t("activitySpeedAlertsReady");
  return t("speedAlertsAudioNeedsTap");
}

function getSpeedLimitOptions(unit: string): SettingsControlOption[] {
  const normalizedUnit = UNIT_CONFIG[unit] ? unit : "kmh";
  const config = ALERT_CONFIG[normalizedUnit];
  const result: SettingsControlOption[] = [];
  for (let value = config.min; value <= config.max; value += config.step) {
    result.push({ value: String(value), label: `${value} ${UNIT_CONFIG[normalizedUnit].label}` });
  }
  return result;
}

function getTrapDistanceOptions(distanceUnit: string): SettingsControlOption[] {
  const normalizedUnit = DISTANCE_UNIT_CONFIG[distanceUnit] ? distanceUnit : "m";
  return TRAP_ALERT_PRESETS[normalizedUnit].map((preset) => ({
    value: String(preset.meters),
    label: preset.label,
  }));
}

function buildPanel(actions: AnyRecord = {}) {
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
  const minimizeBtn = createActionButton({
    className: "speed-alert-window-action speed-alert-window-minimize",
    label: t("minimizeSpeedAlerts"),
    labelKey: "minimizeSpeedAlerts",
    icon: IconMinimize,
  });
  const header = createElement("div", { class: "speed-alert-window-header" }, [
    createElement("div", { class: "speed-alert-window-heading" }, [title]),
    statusChip,
    createElement("div", { class: "speed-alert-window-actions" }, [minimizeBtn, closeBtn]),
  ]);

  const manualControl = createSettingsSwitch({
    label: t("manualSpeed"),
    labelKey: "manualSpeed",
    classNames: {
      root: "speed-alert-window-control speed-alert-window-manual-control",
      input: "speed-alert-window-manual-switch",
    },
    onChange: actions.onManualEnabledChange,
  });
  const speedLimitControl = createSelectControl({
    label: t("alertSpeedLimit"),
    labelKey: "alertSpeedLimit",
    value: "100",
    options: getSpeedLimitOptions("kmh"),
    classNames: {
      root: "speed-alert-window-control speed-alert-window-limit-control",
      control: "speed-alert-window-limit-select",
      option: "speed-alert-window-limit-option",
    },
    onChange: actions.onSpeedLimitChange,
  });
  const useCurrent = createElement("button", {
    type: "button",
    class: "speed-alert-window-secondary speed-alert-window-use-current",
    text: t("useCurrent"),
    "aria-label": t("useCurrentSpeed"),
    "data-i18n-aria": "useCurrentSpeed",
  });
  useCurrent.dataset.i18n = "useCurrent";
  const alertSoundControl = createSettingsSwitch({
    label: t("overspeedSound"),
    labelKey: "overspeedSound",
    classNames: {
      root: "speed-alert-window-control speed-alert-window-alert-sound-control",
      input: "speed-alert-window-alert-sound-switch",
    },
    onChange: actions.onAlertSoundChange,
  });
  const manualSection = createElement("section", {
    class: "speed-alert-window-section speed-alert-window-manual-section",
    "aria-label": t("speedAlertSettings"),
  }, [
    manualControl.element,
    createElement("div", { class: "speed-alert-window-select-action" }, [
      speedLimitControl.element,
      useCurrent,
    ]),
    alertSoundControl.element,
    createElement("p", { class: "speed-alert-window-note", text: t("nearbyTrapOverrides") }),
  ]);

  const trapAlertControl = createSettingsSwitch({
    label: t("trapAlerts"),
    labelKey: "trapAlerts",
    classNames: {
      root: "speed-alert-window-control speed-alert-window-trap-control",
      input: "speed-alert-window-trap-switch",
    },
    onChange: actions.onTrapAlertChange,
  });
  const trapDistanceControl = createSelectControl({
    label: t("alertDistance"),
    labelKey: "alertDistance",
    value: "500",
    options: getTrapDistanceOptions("m"),
    classNames: {
      root: "speed-alert-window-control speed-alert-window-trap-distance-control",
      control: "speed-alert-window-trap-distance-select",
      option: "speed-alert-window-trap-distance-option",
    },
    onChange: actions.onTrapDistanceChange,
  });
  const trapSoundControl = createSettingsSwitch({
    label: t("trapSound"),
    labelKey: "trapSound",
    classNames: {
      root: "speed-alert-window-control speed-alert-window-trap-sound-control",
      input: "speed-alert-window-trap-sound-switch",
    },
    onChange: actions.onTrapSoundChange,
  });
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
    createElement("span", { text: t("openCameraMap"), "data-i18n": "openCameraMap" }),
  ]);
  const cameraSection = createElement("section", {
    class: "speed-alert-window-section",
    "aria-label": t("trapAlertSettings"),
  }, [
    trapAlertControl.element,
    trapDistanceControl.element,
    trapSoundControl.element,
    createElement("div", { class: "speed-alert-window-camera-summary" }, [
      nearestTrap,
      cameraApproach,
      cameraDatabaseStatus,
    ]),
    createElement("div", { class: "speed-alert-window-camera-row" }, [
      openCameraMap,
      createElement("a", {
        class: "speed-alert-window-attribution",
        href: "https://www.openstreetmap.org/copyright",
        target: "_blank",
        rel: "noopener noreferrer",
        text: t("cameraDatabaseAttribution"),
        "data-i18n": "cameraDatabaseAttribution",
      }),
    ]),
  ]);

  const audioControl = createSettingsSwitch({
    label: t("alertAudio"),
    labelKey: "alertAudio",
    classNames: {
      root: "speed-alert-window-control speed-alert-window-audio-control",
      input: "speed-alert-window-audio-switch",
    },
    onChange: actions.onAudioChange,
  });
  const primeAudio = createElement("button", {
    type: "button",
    class: "speed-alert-window-primary speed-alert-window-enable-audio",
    text: t("enableDrivingAlerts"),
    "data-i18n": "enableDrivingAlerts",
  });
  const audioStatus = createElement("p", {
    class: "speed-alert-window-note",
    text: t("speedAlertsAudioNeedsTap"),
  });
  const audioSection = createElement("section", {
    class: "speed-alert-window-section speed-alert-window-section--compact",
    "aria-label": t("audio"),
  }, [audioControl.element, primeAudio, audioStatus]);

  const speedUnitControl = createSegmentedControl({
    label: t("speedUnit"),
    labelKey: "speedUnit",
    value: "kmh",
    options: [{ value: "kmh", label: "km/h" }, { value: "mph", label: "mph" }],
    optionDataAttribute: "unit",
    classNames: {
      root: "speed-alert-window-control speed-alert-window-speed-unit-control",
      control: "speed-alert-window-segmented",
      option: "speed-alert-window-segment",
    },
    onChange: actions.onSpeedUnitChange,
  });
  const distanceUnitControl = createSegmentedControl({
    label: t("distanceUnit"),
    labelKey: "distanceUnit",
    value: "m",
    options: [{ value: "m", label: "m" }, { value: "ft", label: "ft" }],
    optionDataAttribute: "distance-unit",
    classNames: {
      root: "speed-alert-window-control speed-alert-window-distance-unit-control",
      control: "speed-alert-window-segmented",
      option: "speed-alert-window-segment",
    },
    onChange: actions.onDistanceUnitChange,
  });
  const unitsSection = createElement("section", {
    class: "speed-alert-window-section speed-alert-window-units",
    "aria-label": t("units"),
  }, [speedUnitControl.element, distanceUnitControl.element]);

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
      createElement("div", { class: "speed-alert-window-column" }, [manualSection, unitsSection]),
      createElement("div", { class: "speed-alert-window-column" }, [cameraSection, audioSection]),
    ]),
    resizeHandle,
  ]);

  return {
    alertSoundControl,
    audioControl,
    audioStatus,
    cameraApproach,
    cameraDatabaseStatus,
    closeBtn,
    distanceUnitControl,
    header,
    manualControl,
    minimizeBtn,
    nearestTrap,
    openCameraMap,
    panel,
    primeAudio,
    resizeHandle,
    speedLimitControl,
    speedUnitControl,
    statusChip,
    trapAlertControl,
    trapDistanceControl,
    trapSoundControl,
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

function clampResizeBounds(width, height, bounds: AnyRecord = {}): AnyRecord {
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

export function createSpeedAlertPanel(options: AnyRecord = {}): SpeedAlertPanelApi {
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
  let latestSnapshot = service.getSnapshot?.() || {};
  const refs = buildPanel({
    onManualEnabledChange: (checked) => service.setManualAlertEnabled?.(checked, { fromUserGesture: true }),
    onSpeedLimitChange: (value) => setManualLimitDisplay(Number(value)),
    onAlertSoundChange: (checked) => service.setAlertSoundEnabled?.(checked, { fromUserGesture: true }),
    onTrapAlertChange: (checked) => service.setTrapAlertEnabled?.(checked, { fromUserGesture: true }),
    onTrapDistanceChange: (value) => {
      service.setTrapAlertDistanceM?.(Number(value), { fromUserGesture: true });
      service.setTrapAlertEnabled?.(true, { fromUserGesture: true });
    },
    onTrapSoundChange: (checked) => service.setTrapSoundEnabled?.(checked, { fromUserGesture: true }),
    onAudioChange: (checked) => service.setMuted?.(!checked, { fromUserGesture: true }),
    onSpeedUnitChange: (unit) => service.setUnits?.({ unit }),
    onDistanceUnitChange: (distanceUnit) => service.setUnits?.({ distanceUnit }),
  });
  const { panel } = refs;
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
  const handleI18nChange = () => {
    refs.manualControl.setLabel(t("manualSpeed"), "manualSpeed");
    refs.speedLimitControl.setLabel(t("alertSpeedLimit"), "alertSpeedLimit");
    refs.alertSoundControl.setLabel(t("overspeedSound"), "overspeedSound");
    refs.trapAlertControl.setLabel(t("trapAlerts"), "trapAlerts");
    refs.trapDistanceControl.setLabel(t("alertDistance"), "alertDistance");
    refs.trapSoundControl.setLabel(t("trapSound"), "trapSound");
    refs.audioControl.setLabel(t("alertAudio"), "alertAudio");
    refs.speedUnitControl.setLabel(t("speedUnit"), "speedUnit");
    refs.distanceUnitControl.setLabel(t("distanceUnit"), "distanceUnit");
    syncFromService(service.getSnapshot?.() || latestSnapshot);
  };

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
    refs.manualControl.setChecked(manualActive);
    refs.useCurrent.disabled = !canUseCurrentSpeed;
    if (refs.speedLimitControl.element.dataset.optionUnit !== unit) {
      refs.speedLimitControl.setOptions(getSpeedLimitOptions(unit));
      refs.speedLimitControl.element.dataset.optionUnit = unit;
    }
    refs.speedLimitControl.setValue(String(normalizedLimit));
    refs.alertSoundControl.setChecked(Boolean(preferences.alertSoundEnabled));
    refs.trapAlertControl.setChecked(Boolean(preferences.trapAlertEnabled));
    if (refs.trapDistanceControl.element.dataset.optionUnit !== distanceUnit) {
      refs.trapDistanceControl.setOptions(getTrapDistanceOptions(distanceUnit));
      refs.trapDistanceControl.element.dataset.optionUnit = distanceUnit;
    }
    refs.trapDistanceControl.setValue(String(trapDistanceM));
    refs.trapSoundControl.setChecked(Boolean(preferences.trapSoundEnabled));
    refs.speedUnitControl.setValue(unit);
    refs.distanceUnitControl.setValue(distanceUnit);

    const audioEnabled = !(preferences.audioMuted || audio.muted);
    const audioReady = Boolean(audio.backgroundAudioArmed || audio.primed);
    refs.audioControl.setChecked(audioEnabled);
    refs.primeAudio.hidden = !audioEnabled || audioReady;
    refs.primeAudio.disabled = Boolean(audio.backgroundAudioArmPending || audio.pending);
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
      window.setTimeout(() => refs.manualControl.focus(), 0);
    }
  }

  function hidePanel({ persist = true } = {}) {
    refs.speedLimitControl.close();
    refs.trapDistanceControl.close();
    panel.hidden = true;
    if (persist) saveVisibility(false);
  }

  function minimizePanel() {
    refs.speedLimitControl.close();
    refs.trapDistanceControl.close();
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

  function minimize(minimizeOptions = {}) {
    minimizePanel();
    shellManager.minimizeWindow?.(SPEED_ALERT_PANEL_WINDOW_ID, { ...minimizeOptions, invokeLifecycle: false });
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

  function addEventListeners() {
    refs.minimizeBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
    refs.minimizeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      minimize();
    });
    refs.closeBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
    refs.closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      close();
    });
    refs.useCurrent.addEventListener("click", () => {
      const preferences = latestSnapshot.preferences || {};
      const unit = UNIT_CONFIG[preferences.unit] ? preferences.unit : "kmh";
      setManualLimitDisplay(Math.round(convertSpeed(latestSnapshot.currentSpeedMs || 0, unit)));
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
    resolveLayout(metrics) {
      if (isFocusedLandscapeProfile(metrics.profile)) {
        const width = Math.min(560, metrics.workArea.width);
        const height = Math.min(420, metrics.workArea.height);
        return {
          mode: "short-landscape",
          left: metrics.workArea.left + Math.max(0, metrics.workArea.width - width) / 2,
          top: metrics.workArea.top + Math.max(0, metrics.workArea.height - height) / 2,
          width,
          height,
          minWidth: Math.min(320, metrics.workArea.width),
          minHeight: Math.min(320, metrics.workArea.height),
          maxWidth: metrics.workArea.width,
          maxHeight: metrics.workArea.height,
        };
      }
      if (metrics.profile === "portrait") {
        const width = metrics.workArea.width;
        const height = metrics.workArea.height;
        return {
          mode: "portrait",
          left: metrics.workArea.left,
          top: metrics.workArea.top,
          width,
          height,
          minWidth: Math.min(320, width),
          minHeight: Math.min(320, height),
          maxWidth: width,
          maxHeight: height,
        };
      }
      return null;
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
      refs.manualControl.destroy();
      refs.speedLimitControl.destroy();
      refs.alertSoundControl.destroy();
      refs.trapAlertControl.destroy();
      refs.trapDistanceControl.destroy();
      refs.trapSoundControl.destroy();
      refs.audioControl.destroy();
      refs.speedUnitControl.destroy();
      refs.distanceUnitControl.destroy();
      cleanupLayer();
      ownedService?.destroy?.();
      panel.remove();
    },
    getElement: () => panel,
    isOpen: () => !panel.hidden,
    minimize,
    open,
    syncFromService,
    toggle,
  };
}
