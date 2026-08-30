import { createShellLayoutStore } from "./shell-layout-store.js";
import { getBoundsForSnapZone } from "./shell-snap.js";
import { SHELL_Z_INDEX } from "./shell-layers.js";
import { clampBoundsToWorkArea, getShellWorkArea, getViewportRect } from "./shell-work-area.js";
import {
  getShellLayoutMetrics,
  isFocusedLandscapeProfile,
  observeShellLayoutMetrics,
} from "./shell-layout-metrics.js";
import type {
  ShellBounds,
  ShellLayoutMetrics,
  ShellPreferences,
  ShellRuntime,
  ShellSnapZone,
  ShellWindowCapabilities,
  ShellWindowLifecycle,
  ShellWindowRecord,
} from "../types/shell";

export const SHELL_WINDOW_BASE_Z_INDEX = SHELL_Z_INDEX.windowBase;
export const SHELL_WINDOW_MAX_Z_INDEX = SHELL_Z_INDEX.windowMax;

const BASE_Z_INDEX = SHELL_WINDOW_BASE_Z_INDEX;
const MAX_Z_INDEX = SHELL_WINDOW_MAX_Z_INDEX;
const VALID_STATES = new Set(["closed", "open", "minimized", "hidden", "fullscreen"]);
const SNAP_ZONES = new Set([
  "left",
  "right",
  "top",
  "bottom",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);
const MAXIMIZE_ZONES = new Set(["top"]);
// These capabilities are deliberately separate: a panel may resize inside
// design-safe bounds without supporting snap, top maximize, or fullscreen.
const SHELL_PREFERENCES_STORAGE_KEY = "vatioboard.shell.preferences.v1";
const DEFAULT_SHELL_PREFERENCES = {
  taskbarPosition: "bottom",
  windowDensity: "comfortable",
  snapEnabled: true,
  restoreOnBoot: true,
  reduceMotion: "system",
} as const satisfies ShellPreferences;
const PREFERENCE_VALIDATORS = {
  taskbarPosition: (value) => ["bottom", "left", "right"].includes(value),
  windowDensity: (value) => ["comfortable", "compact"].includes(value),
  snapEnabled: (value) => typeof value === "boolean",
  restoreOnBoot: (value) => typeof value === "boolean",
  reduceMotion: (value) => value === "system" || value === true || value === false,
};

// TODO(ts-migration): this manager still accepts legacy JS window records and
// option bags. Keep the public ShellRuntime typed while narrowing internals in
// follow-up feature conversions.
type LegacyShellOptions = Record<string, any>;
type MutableShellWindowRecord = Record<string, any>;

let defaultShellWindowManager: ShellRuntime | null = null;

function isElement(value: unknown): value is HTMLElement {
  return Boolean((value as Element | null)?.nodeType === 1);
}

function toNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBounds(bounds: unknown): ShellBounds | null {
  if (!bounds || typeof bounds !== "object") return null;
  const source = bounds as LegacyShellOptions;
  const left = toNumber(source.left);
  const top = toNumber(source.top);
  if (left === null || top === null) return null;
  const next: ShellBounds = { left, top };
  const width = toNumber(source.width);
  const height = toNumber(source.height);
  if (width !== null && width > 0) next.width = width;
  if (height !== null && height > 0) next.height = height;
  return next;
}

function normalizeCapabilities(capabilities: LegacyShellOptions = {}): ShellWindowCapabilities {
  const snapZones = Array.isArray(capabilities.snapZones)
    ? capabilities.snapZones.filter((zone) => SNAP_ZONES.has(zone))
    : null;
  const minWidth = toNumber(capabilities.minWidth);
  const minHeight = toNumber(capabilities.minHeight);
  const maxWidth = toNumber(capabilities.maxWidth);
  const maxHeight = toNumber(capabilities.maxHeight);
  const normalizedMinWidth = minWidth !== null && minWidth > 0 ? minWidth : null;
  const normalizedMinHeight = minHeight !== null && minHeight > 0 ? minHeight : null;
  return {
    draggable: capabilities.draggable !== false,
    resizable: capabilities.resizable === true,
    minimizable: capabilities.minimizable !== false,
    closable: capabilities.closable !== false,
    restorable: capabilities.restorable !== false,
    maximizable: capabilities.maximizable !== false,
    snap: capabilities.snap !== false,
    snapZones,
    preserveIntrinsicWidth: capabilities.preserveIntrinsicWidth === true,
    minWidth: normalizedMinWidth,
    minHeight: normalizedMinHeight,
    maxWidth: maxWidth !== null && maxWidth > 0
      ? Math.max(maxWidth, normalizedMinWidth || 0)
      : null,
    maxHeight: maxHeight !== null && maxHeight > 0
      ? Math.max(maxHeight, normalizedMinHeight || 0)
      : null,
    ...(capabilities.pinnable !== undefined ? { pinnable: capabilities.pinnable === true } : {}),
    ...(capabilities.fullscreen !== undefined ? { fullscreen: capabilities.fullscreen === true } : {}),
  };
}

function getCapabilitySizeConstraints(record: MutableShellWindowRecord | null | undefined) {
  const capabilities = record?.presentationLayout || record?.capabilities;
  const minWidth = toNumber(capabilities?.minWidth);
  const minHeight = toNumber(capabilities?.minHeight);
  const maxWidth = toNumber(capabilities?.maxWidth);
  const maxHeight = toNumber(capabilities?.maxHeight);
  return {
    minWidth: minWidth !== null && minWidth > 0 ? minWidth : undefined,
    minHeight: minHeight !== null && minHeight > 0 ? minHeight : undefined,
    maxWidth: maxWidth !== null && maxWidth > 0 ? maxWidth : undefined,
    maxHeight: maxHeight !== null && maxHeight > 0 ? maxHeight : undefined,
  };
}

function getElementBounds(element: unknown): ShellBounds | null {
  if (!isElement(element)) return null;
  const rect = (element.getBoundingClientRect?.() || {}) as DOMRect;
  const left = toNumber(element.style?.left) ?? toNumber(rect.left) ?? 0;
  const top = toNumber(element.style?.top) ?? toNumber(rect.top) ?? 0;
  const width = toNumber(element.style?.width) ?? toNumber(rect.width);
  const height = toNumber(element.style?.height) ?? toNumber(rect.height);
  return normalizeBounds({ left, top, width, height }) || { left, top };
}

function getElementVisibleBottomInset(element: unknown) {
  if (!isElement(element)) return 0;
  const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  const inline = Number.parseFloat(element.style.getPropertyValue("--vb-shell-visible-bottom-inset"));
  if (Number.isFinite(inline) && inline > 0) return inline;
  const computed = Number.parseFloat(style?.getPropertyValue("--vb-shell-visible-bottom-inset") || "");
  return Number.isFinite(computed) && computed > 0 ? computed : 0;
}

function applyBounds(element: unknown, bounds: unknown) {
  const next = normalizeBounds(bounds);
  if (!isElement(element) || !next) return;
  element.style.position = "fixed";
  element.style.left = `${Math.round(next.left)}px`;
  element.style.top = `${Math.round(next.top)}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
  if (next.width) element.style.width = `${Math.round(next.width)}px`;
  if (next.height) element.style.height = `${Math.round(next.height)}px`;
}

function applyElementSizeConstraints(record: MutableShellWindowRecord) {
  if (!isElement(record.element)) return;
  const fullscreen = isFullscreenRecord(record);
  const capabilities = record.presentationLayout || record.capabilities;
  const area = getShellWorkArea({ root: record.element.ownerDocument || document });
  const minWidth = toNumber(capabilities?.minWidth);
  const minHeight = toNumber(capabilities?.minHeight);
  const maxWidth = toNumber(capabilities?.maxWidth);
  const maxHeight = toNumber(capabilities?.maxHeight);

  record.element.style.minWidth = !fullscreen && minWidth !== null && minWidth > 0
    ? `${Math.round(Math.min(minWidth, area.width))}px`
    : "";
  record.element.style.minHeight = !fullscreen && minHeight !== null && minHeight > 0
    ? `${Math.round(Math.min(minHeight, area.height))}px`
    : "";
  record.element.style.maxWidth = fullscreen
    ? "none"
    : maxWidth !== null && maxWidth > 0
      ? `${Math.round(maxWidth)}px`
      : "";
  record.element.style.maxHeight = fullscreen
    ? "none"
    : maxHeight !== null && maxHeight > 0
      ? `${Math.round(maxHeight)}px`
      : "";
}

function applyCapabilityConstraints(
  bounds: unknown,
  record: MutableShellWindowRecord | null | undefined,
  options: LegacyShellOptions = {},
): ShellBounds | null {
  const next = normalizeBounds(bounds);
  if (!next || !record?.capabilities) return next;
  const constrained = { ...next };
  const minWidth = toNumber(record.capabilities.minWidth);
  const minHeight = toNumber(record.capabilities.minHeight);
  const maxWidth = toNumber(record.capabilities.maxWidth);
  const maxHeight = toNumber(record.capabilities.maxHeight);
  if (maxWidth !== null && maxWidth > 0 && constrained.width) {
    constrained.width = Math.min(constrained.width, maxWidth);
  }
  if (maxHeight !== null && maxHeight > 0 && constrained.height) {
    constrained.height = Math.min(constrained.height, maxHeight);
  }
  if (options.snap === true && record.capabilities.preserveIntrinsicWidth === true && constrained.width) {
    const currentWidth = toNumber(options.currentBounds?.width)
      ?? toNumber(record.bounds?.width)
      ?? toNumber(record.restoreBounds?.width)
      ?? maxWidth;
    if (currentWidth !== null && currentWidth > 0) {
      constrained.width = Math.min(constrained.width, currentWidth);
    }
  }
  if (minWidth !== null && minWidth > 0 && constrained.width) {
    constrained.width = Math.max(constrained.width, minWidth);
  }
  if (minHeight !== null && minHeight > 0 && constrained.height) {
    constrained.height = Math.max(constrained.height, minHeight);
  }
  return constrained;
}

function getViewport() {
  return getViewportRect();
}

function isFullscreenRecord(record: MutableShellWindowRecord | null | undefined) {
  return record?.state === "fullscreen";
}

function getFullscreenBounds(options: LegacyShellOptions = {}) {
  return getShellWorkArea({ ...options, fullscreen: true });
}

function sanitizeNormalBounds(bounds: unknown, options: LegacyShellOptions = {}) {
  const next = normalizeBounds(bounds);
  if (!next) return null;
  if (options.rawBounds === true) return next;
  return clampBoundsToWorkArea(next, {
    root: options.root,
    viewport: options.viewport,
    workArea: options.workArea,
    currentBounds: options.currentBounds,
    safeMargin: options.safeMargin,
    margin: options.margin,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
  });
}

function sanitizeRecordBounds(record: MutableShellWindowRecord | null | undefined, bounds: unknown, options: LegacyShellOptions = {}) {
  if (isFullscreenRecord(record) && options.fullscreen !== false) {
    return getFullscreenBounds({ root: options.root, viewport: options.viewport });
  }
  const constrained = applyCapabilityConstraints(bounds, record, options);
  return sanitizeNormalBounds(constrained, {
    ...options,
    ...getCapabilitySizeConstraints(record),
    currentBounds: options.currentBounds || record?.bounds || record?.restoreBounds,
  });
}

function canSnapRecord(record: MutableShellWindowRecord | null | undefined, zone: ShellSnapZone | string) {
  if (!record || record.capabilities?.snap === false) return false;
  if (!SNAP_ZONES.has(zone)) return false;
  if (MAXIMIZE_ZONES.has(zone) && record.capabilities?.maximizable !== true) return false;
  if (Array.isArray(record.capabilities?.snapZones) && !record.capabilities.snapZones.includes(zone)) return false;
  return true;
}

function getRecordZIndex(record: MutableShellWindowRecord) {
  return isFullscreenRecord(record)
    ? SHELL_Z_INDEX.fullscreen
    : Math.min(record.zIndex, MAX_Z_INDEX);
}

function sanitizeLifecycle(lifecycle: LegacyShellOptions = {}): ShellWindowLifecycle {
  return {
    ...(typeof lifecycle.open === "function" ? { open: lifecycle.open } : {}),
    ...(typeof lifecycle.close === "function" ? { close: lifecycle.close } : {}),
    ...(typeof lifecycle.minimize === "function" ? { minimize: lifecycle.minimize } : {}),
    ...(typeof lifecycle.restore === "function" ? { restore: lifecycle.restore } : {}),
    ...(typeof lifecycle.destroy === "function" ? { destroy: lifecycle.destroy } : {}),
  };
}

function shallowRecord(record: MutableShellWindowRecord | null | undefined): ShellWindowRecord | null {
  if (!record) return null;
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    element: record.element,
    launcherElement: record.launcherElement,
    state: record.state,
    previousState: record.previousState,
    bounds: record.bounds,
    restoreBounds: record.restoreBounds,
    fullscreenRestoreBounds: record.fullscreenRestoreBounds,
    fullscreenRestoreSnap: record.fullscreenRestoreSnap,
    zIndex: record.zIndex,
    active: record.active,
    minimized: record.minimized,
    snap: record.snap,
    capabilities: record.capabilities,
    resolveLayout: record.resolveLayout,
    lifecycle: record.lifecycle,
    lazy: record.lazy,
    restoreOnBoot: record.restoreOnBoot,
    storageKey: record.storageKey,
    defaultBounds: record.defaultBounds,
    version: record.version,
  } as ShellWindowRecord;
}

function getPreferenceStorage(storage: LegacyShellOptions | null | undefined) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeShellPreferences(value: LegacyShellOptions = {}): ShellPreferences {
  const next = { ...DEFAULT_SHELL_PREFERENCES };
  if (!value || typeof value !== "object") return next;
  for (const key of Object.keys(DEFAULT_SHELL_PREFERENCES)) {
    if (PREFERENCE_VALIDATORS[key]?.(value[key])) {
      next[key] = value[key];
    }
  }
  return next;
}

function readShellPreferences(storage: LegacyShellOptions | null | undefined): ShellPreferences {
  const target = getPreferenceStorage(storage);
  if (!target) return { ...DEFAULT_SHELL_PREFERENCES };
  try {
    const parsed = JSON.parse(target.getItem(SHELL_PREFERENCES_STORAGE_KEY) || "{}");
    return normalizeShellPreferences(parsed.preferences || parsed);
  } catch {
    try {
      target.removeItem(SHELL_PREFERENCES_STORAGE_KEY);
    } catch {
      // best effort only
    }
    return { ...DEFAULT_SHELL_PREFERENCES };
  }
}

function writeShellPreferences(storage: LegacyShellOptions | null | undefined, preferences: ShellPreferences) {
  const target = getPreferenceStorage(storage);
  if (!target) return false;
  try {
    target.setItem(SHELL_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 1,
      preferences: normalizeShellPreferences(preferences),
    }));
    return true;
  } catch {
    return false;
  }
}

function getPreferenceAttributeTarget(root: unknown) {
  if (isElement(root)) return root;
  return document?.documentElement || null;
}

function applyShellPreferenceAttributes(root: unknown, preferences: ShellPreferences) {
  const target = getPreferenceAttributeTarget(root);
  if (!target) return;
  target.setAttribute("data-vb-shell-taskbar-position", preferences.taskbarPosition);
  target.setAttribute("data-vb-shell-density", preferences.windowDensity);
  target.setAttribute("data-vb-shell-reduce-motion", String(preferences.reduceMotion));
}

export function createShellWindowManager(options: LegacyShellOptions = {}): ShellRuntime {
  const store = options.store || createShellLayoutStore(options.storeOptions || {});
  const eventTarget = options.eventTarget || document;
  const root = options.root || document;
  const windows = new Map<string, MutableShellWindowRecord>();
  const elementToId = new WeakMap<Element, string>();
  const listenerCleanups = new Map<string, () => void>();
  const subscribers = new Set<(event: LegacyShellOptions) => void>();
  const preferenceSubscribers = new Set<(preferences: ShellPreferences) => void>();
  const preferenceStorage = getPreferenceStorage(options.preferenceStorage || options.storage);
  let preferences = readShellPreferences(preferenceStorage);
  let layout = store.read();
  let activeWindowId = layout.activeWindowId || null;
  let nextZIndex = Math.min(
    MAX_Z_INDEX,
    Math.max(BASE_Z_INDEX, ...Object.values(layout.windows || {}).map((entry: LegacyShellOptions) => entry?.zIndex || 0))
  );
  let destroyed = false;
  let cleanupLayoutMetrics = () => {};
  applyShellPreferenceAttributes(root, preferences);

  function emit(type: string, detail: LegacyShellOptions = {}) {
    try {
      eventTarget?.dispatchEvent?.(new CustomEvent(type, { detail }));
    } catch {
      // DOM events are observability only.
    }
  }

  function notify(event: string, record: MutableShellWindowRecord | null) {
    const snapshot = record ? shallowRecord(record) : null;
    for (const listener of subscribers) {
      try {
        listener({ event, record: snapshot, manager: api });
      } catch {
        // Subscriber errors should not break shell state.
      }
    }
  }

  function notifyPreferences() {
    const snapshot = { ...preferences };
    for (const listener of preferenceSubscribers) {
      try {
        listener(snapshot);
      } catch {
        // Preference observers are optional UI hooks.
      }
    }
  }

  function persist(options: LegacyShellOptions = {}) {
    if (options.persist === false) return;
    persistShellLayout({ flush: options.flush === true });
  }

  function invokeLifecycle(record: MutableShellWindowRecord, name: keyof ShellWindowLifecycle, options: LegacyShellOptions = {}) {
    if (options.invokeLifecycle === false) return;
    const fn = record.lifecycle?.[name];
    if (typeof fn !== "function") return;
    try {
      const result = fn(options);
      if (result?.catch) result.catch(() => {});
    } catch {
      // Lifecycle errors should not strand shell state.
    }
  }

  function setWindowAttributes(record: MutableShellWindowRecord) {
    if (!isElement(record.element)) return;
    record.element.setAttribute("data-vb-shell-window", record.id);
    record.element.setAttribute("data-vb-shell-window-active", record.active ? "true" : "false");
    record.element.setAttribute("data-vb-shell-window-state", record.state);
    record.element.setAttribute("data-vb-shell-window-fullscreen", isFullscreenRecord(record) ? "true" : "false");
    record.element.setAttribute("data-vb-floating-panel", "");
    record.element.setAttribute("data-vb-floating-active", record.active ? "true" : "false");
    if (record.presentationLayout?.mode) {
      record.element.setAttribute("data-vb-shell-layout-mode", record.presentationLayout.mode);
    } else {
      record.element.removeAttribute("data-vb-shell-layout-mode");
    }
    applyElementSizeConstraints(record);
    record.element.style.zIndex = String(getRecordZIndex(record));
  }

  function setActiveRecord(record: MutableShellWindowRecord | null) {
    for (const candidate of windows.values()) {
      candidate.active = candidate.id === record?.id;
      setWindowAttributes(candidate);
    }
    activeWindowId = record?.id || null;
  }

  function compactZOrder() {
    const ordered = Array.from(windows.values())
      .filter((record) => record.state === "open" && !record.element.hidden)
      .sort((a, b) => (a.zIndex - b.zIndex) || a.id.localeCompare(b.id));

    ordered.forEach((record, index) => {
      record.zIndex = Math.min(BASE_Z_INDEX + index + 1, MAX_Z_INDEX);
      setWindowAttributes(record);
    });

    nextZIndex = ordered.length > 0
      ? Math.min(BASE_Z_INDEX + ordered.length + 1, MAX_Z_INDEX)
      : BASE_Z_INDEX;
  }

  function nextLayer() {
    if (nextZIndex >= MAX_Z_INDEX) compactZOrder();
    nextZIndex = Math.min(nextZIndex + 1, MAX_Z_INDEX);
    return nextZIndex;
  }

  function attachActivation(record) {
    if (!isElement(record.element)) return;
    const existing = listenerCleanups.get(record.id);
    existing?.();

    const activate = () => {
      if ((record.state === "open" || record.state === "fullscreen") && !record.element.hidden) {
        activateWindow(record.id);
      }
    };

    record.element.addEventListener("pointerdown", activate, true);
    record.element.addEventListener("focusin", activate, true);
    listenerCleanups.set(record.id, () => {
      record.element.removeEventListener("pointerdown", activate, true);
      record.element.removeEventListener("focusin", activate, true);
    });
  }

  function applyStoredLayout(record: MutableShellWindowRecord, stored: LegacyShellOptions | null | undefined) {
    if (!stored) return record;
    const storedState = VALID_STATES.has(stored.state) ? stored.state : record.state;
    record.state = storedState === "fullscreen" ? "open" : storedState;
    record.previousState = VALID_STATES.has(stored.previousState) ? stored.previousState : record.previousState;
    record.bounds = sanitizeRecordBounds(record, stored.bounds, { root }) || record.bounds;
    record.restoreBounds = sanitizeRecordBounds(record, stored.restoreBounds, { root, fullscreen: false }) || record.restoreBounds;
    record.fullscreenRestoreBounds = sanitizeRecordBounds(record, stored.fullscreenRestoreBounds, { root, fullscreen: false }) || null;
    record.fullscreenRestoreSnap = stored.fullscreenRestoreSnap || null;
    record.zIndex = Math.min(Number.parseInt(String(stored.zIndex || record.zIndex), 10) || record.zIndex, MAX_Z_INDEX);
    record.minimized = stored.minimized === true || record.state === "minimized";
    record.snap = stored.snap && canSnapRecord(record, stored.snap.zone) ? stored.snap : null;
    if (record.bounds) applyBounds(record.element, record.bounds);
    return record;
  }

  function registerWindow(config: LegacyShellOptions = {}) {
    if (destroyed || !config.id || !isElement(config.element)) return null;

    const existing = windows.get(config.id);
    const stored = layout.windows?.[config.id];
    const wasExistingElement = existing?.element === config.element;
    const record: MutableShellWindowRecord = existing || {};
    const elementBounds = getElementBounds(config.element);

    const configuredState = VALID_STATES.has(config.state) ? config.state : (record.state || (config.element.hidden ? "closed" : "open"));
    const configuredDefaultBounds = normalizeBounds(config.defaultBounds) || normalizeBounds(config.bounds) || record.defaultBounds || elementBounds;
    const configuredBounds = normalizeBounds(config.bounds) || record.bounds || elementBounds;
    const configuredRestoreBounds = normalizeBounds(config.restoreBounds) || record.restoreBounds || elementBounds;
    const configuredCapabilities = normalizeCapabilities({ ...record.capabilities, ...config.capabilities });
    const constraintRecord = {
      ...record,
      capabilities: configuredCapabilities,
      bounds: configuredBounds,
      restoreBounds: configuredRestoreBounds,
    };

    Object.assign(record, {
      id: config.id,
      kind: config.kind || record.kind || "tool",
      title: config.title || record.title || config.id,
      element: config.element,
      launcherElement: config.launcherElement || record.launcherElement || null,
      state: configuredState === "fullscreen" ? "open" : configuredState,
      previousState: VALID_STATES.has(config.previousState) ? config.previousState : (record.previousState || "closed"),
      bounds: sanitizeRecordBounds(constraintRecord, configuredBounds, { root, fullscreen: false }) || configuredBounds,
      restoreBounds: sanitizeRecordBounds(constraintRecord, configuredRestoreBounds, { root, fullscreen: false }) || configuredRestoreBounds,
      fullscreenRestoreBounds: sanitizeRecordBounds(
        constraintRecord,
        config.fullscreenRestoreBounds || record.fullscreenRestoreBounds,
        { root, fullscreen: false },
      ),
      fullscreenRestoreSnap: config.fullscreenRestoreSnap || record.fullscreenRestoreSnap || null,
      zIndex: Math.min(Number.parseInt(String(config.zIndex || record.zIndex || BASE_Z_INDEX), 10) || BASE_Z_INDEX, MAX_Z_INDEX),
      active: record.active === true,
      minimized: config.minimized === true || record.minimized === true,
      snap: config.snap || record.snap || null,
      capabilities: configuredCapabilities,
      lifecycle: sanitizeLifecycle({ ...record.lifecycle, ...config.lifecycle }),
      resolveLayout: typeof config.resolveLayout === "function" ? config.resolveLayout : record.resolveLayout,
      lazy: config.lazy === true || record.lazy === true,
      restoreOnBoot: config.restoreOnBoot !== undefined ? config.restoreOnBoot !== false : record.restoreOnBoot !== false,
      storageKey: config.storageKey || record.storageKey || null,
      defaultBounds: sanitizeRecordBounds(
        constraintRecord,
        configuredDefaultBounds,
        { root, fullscreen: false },
      ) || configuredDefaultBounds,
      version: 1,
    });

    applyStoredLayout(record, stored);
    windows.set(record.id, record);
    elementToId.set(record.element, record.id);
    if (!wasExistingElement) attachActivation(record);
    setWindowAttributes(record);

    emit(existing ? "vatioboard:shell-window-layout-changed" : "vatioboard:shell-window-registered", { id: record.id, record: shallowRecord(record) });
    notify(existing ? "updated" : "registered", record);
    persist({ persist: config.persist, flush: config.flush });
    return shallowRecord(record);
  }

  function unregisterWindow(id: string) {
    const record = windows.get(id);
    if (!record) return null;
    listenerCleanups.get(id)?.();
    listenerCleanups.delete(id);
    record.lifecycle?.destroy?.();
    record.element?.removeAttribute?.("data-vb-shell-window");
    record.element?.removeAttribute?.("data-vb-shell-window-active");
    record.element?.removeAttribute?.("data-vb-shell-window-state");
    record.element?.removeAttribute?.("data-vb-shell-window-fullscreen");
    windows.delete(id);
    if (activeWindowId === id) activeWindowId = null;
    emit("vatioboard:shell-window-unregistered", { id });
    notify("unregistered", record);
    persist({});
    return shallowRecord(record);
  }

  function getWindow(id: string) {
    return shallowRecord(windows.get(id));
  }

  function getWindowIdForElement(element: Element) {
    if (!isElement(element)) return null;
    return elementToId.get(element) || element.getAttribute("data-vb-shell-window") || null;
  }

  function listWindows() {
    return Array.from(windows.values(), shallowRecord);
  }

  function getActiveWindow() {
    return getWindow(activeWindowId);
  }

  function activateWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    if (record.active === true && activeWindowId === id) {
      return shallowRecord(record);
    }
    record.zIndex = nextLayer();
    record.active = true;
    setActiveRecord(record);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-activated", { id, record: shallowRecord(record) });
    notify("activated", record);
    persist(options);
    return shallowRecord(record);
  }

  function showRecord(record: MutableShellWindowRecord) {
    record.element.hidden = false;
    record.minimized = false;
    if (record.state !== "fullscreen") record.state = "open";
    if (record.snap?.zone) {
      if (!canSnapRecord(record, record.snap.zone)) {
        record.snap = null;
      }
    }
    if (record.snap?.zone) {
      const snapBounds = getBoundsForSnapZone(record.snap.zone, getViewport(), {
        ...record.snap,
        useWorkArea: true,
        root,
      });
      record.bounds = applyCapabilityConstraints(snapBounds, record, {
        snap: true,
        currentBounds: record.restoreBounds || record.bounds,
      }) || snapBounds;
      applyBounds(record.element, record.bounds);
    } else if (record.state === "fullscreen") {
      const fullscreenBounds = getFullscreenBounds({ root });
      record.bounds = fullscreenBounds;
      applyBounds(record.element, fullscreenBounds);
    } else if (record.bounds) {
      const bounds = sanitizeRecordBounds(record, record.bounds, {
        root,
        preferVisibleBottom: true,
        visibleBottomInset: getElementVisibleBottomInset(record.element),
      }) || record.bounds;
      record.bounds = bounds;
      applyBounds(record.element, bounds);
    }
    setWindowAttributes(record);
  }

  function openWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    invokeLifecycle(record, "open", options);
    showRecord(record);
    activateWindow(id, { ...options, persist: false });
    emit("vatioboard:shell-window-opened", { id, record: shallowRecord(record) });
    notify("opened", record);
    reflowWindowsToWorkArea({ persist: false });
    persist(options);
    return shallowRecord(record);
  }

  function closeWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    const normalBounds = isFullscreenRecord(record)
      ? sanitizeRecordBounds(record, record.fullscreenRestoreBounds || record.restoreBounds, { root, fullscreen: false })
      : sanitizeRecordBounds(record, getElementBounds(record.element) || record.bounds, { root });
    record.bounds = normalBounds || record.bounds;
    record.restoreBounds = normalBounds || record.restoreBounds;
    record.fullscreenRestoreBounds = null;
    record.fullscreenRestoreSnap = null;
    record.previousState = record.state;
    record.state = "closed";
    record.minimized = false;
    invokeLifecycle(record, "close", options);
    record.element.hidden = true;
    if (activeWindowId === id) setActiveRecord(null);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-closed", { id, record: shallowRecord(record) });
    notify("closed", record);
    persist(options);
    return shallowRecord(record);
  }

  function minimizeWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    const normalBounds = isFullscreenRecord(record)
      ? sanitizeRecordBounds(record, record.fullscreenRestoreBounds || record.restoreBounds, { root, fullscreen: false })
      : sanitizeRecordBounds(record, getElementBounds(record.element) || record.bounds, { root });
    record.bounds = normalBounds || record.bounds;
    record.restoreBounds = normalBounds || record.restoreBounds;
    record.fullscreenRestoreBounds = null;
    record.fullscreenRestoreSnap = null;
    record.previousState = record.state;
    record.state = "minimized";
    record.minimized = true;
    invokeLifecycle(record, "minimize", options);
    record.element.hidden = true;
    if (activeWindowId === id) setActiveRecord(null);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-minimized", { id, record: shallowRecord(record) });
    notify("minimized", record);
    persist(options);
    return shallowRecord(record);
  }

  function restoreWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    invokeLifecycle(record, "restore", options);
    record.state = "open";
    record.minimized = false;
    record.bounds = sanitizeRecordBounds(record, record.restoreBounds || record.bounds, {
      root,
      preferVisibleBottom: true,
      visibleBottomInset: getElementVisibleBottomInset(record.element),
    }) || record.restoreBounds || record.bounds;
    record.restoreBounds = record.bounds || record.restoreBounds;
    showRecord(record);
    activateWindow(id, { ...options, persist: false });
    emit("vatioboard:shell-window-restored", { id, record: shallowRecord(record) });
    notify("restored", record);
    persist(options);
    return shallowRecord(record);
  }

  function toggleWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    if (record.state === "open" && !record.element.hidden) return closeWindow(id, options);
    if (record.state === "minimized") return restoreWindow(id, options);
    return openWindow(id, options);
  }

  function updateWindowBounds(id: string, bounds: unknown, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    const next = normalizeBounds(bounds);
    if (!next) return shallowRecord(record);
    if (record.presentationLayout && options.adaptivePresentation !== false) {
      const metrics = getShellLayoutMetrics({ root });
      const constraints = getCapabilitySizeConstraints(record);
      const sanitizedPresentation = clampBoundsToWorkArea(next, {
        root,
        workArea: metrics.workArea,
        currentBounds: record.presentationBounds,
        ...constraints,
      });
      record.presentationBounds = sanitizedPresentation;
      applyBounds(record.element, sanitizedPresentation);
      setWindowAttributes(record);
      emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record), adaptive: true });
      notify("layout-changed", record);
      return shallowRecord(record);
    }
    const sanitized = sanitizeRecordBounds(record, next, {
      root,
      rawBounds: options.rawBounds === true,
      fullscreen: options.fullscreen,
      currentBounds: record.bounds,
    }) || next;
    record.bounds = sanitized;
    if (options.updateRestoreBounds !== false && !isFullscreenRecord(record)) record.restoreBounds = sanitized;
    if (options.preserveSnap !== true) record.snap = null;
    applyBounds(record.element, sanitized);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record) });
    notify("layout-changed", record);
    persist(options);
    return shallowRecord(record);
  }

  function resetWindowGeometry(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    const fallbackBounds = getElementBounds(record.element) || record.restoreBounds || record.bounds;
    const defaultBounds = normalizeBounds(record.defaultBounds) || fallbackBounds;
    if (!defaultBounds) return shallowRecord(record);
    const sanitized = sanitizeRecordBounds(record, defaultBounds, {
      root,
      fullscreen: false,
      currentBounds: record.bounds,
      preferVisibleBottom: true,
      visibleBottomInset: getElementVisibleBottomInset(record.element),
    }) || defaultBounds;

    if (isFullscreenRecord(record)) {
      record.state = "open";
      record.minimized = false;
      record.element.hidden = false;
    }
    record.snap = null;
    record.bounds = sanitized;
    record.restoreBounds = sanitized;
    record.fullscreenRestoreBounds = null;
    record.fullscreenRestoreSnap = null;
    applyBounds(record.element, sanitized);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record) });
    notify("layout-changed", record);
    persist(options);
    return shallowRecord(record);
  }

  function snapWindow(id: string, zone: ShellSnapZone | string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    if (!canSnapRecord(record, zone)) return shallowRecord(record);
    if (!record.snap && record.state === "open") {
      record.restoreBounds = getElementBounds(record.element) || record.bounds;
    }
    const snapBounds = getBoundsForSnapZone(zone, options.viewport || getViewport(), {
      ...options,
      useWorkArea: options.useWorkArea !== false,
      root,
    });
    const bounds = applyCapabilityConstraints(snapBounds, record, {
      snap: true,
      currentBounds: record.restoreBounds || record.bounds,
    }) || snapBounds;
    record.snap = { zone, ...(options.ratio ? { ratio: options.ratio } : {}) };
    record.bounds = bounds;
    applyBounds(record.element, bounds);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record) });
    notify("snapped", record);
    persist(options);
    return shallowRecord(record);
  }

  function unsnapWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    record.snap = null;
    if (record.restoreBounds) {
      record.bounds = sanitizeRecordBounds(record, record.restoreBounds, { root }) || record.restoreBounds;
      record.restoreBounds = record.bounds;
      applyBounds(record.element, record.bounds);
    }
    setWindowAttributes(record);
    emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record) });
    notify("unsnapped", record);
    persist(options);
    return shallowRecord(record);
  }

  function fullscreenWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    if (record.capabilities?.fullscreen !== true && options.force !== true) return shallowRecord(record);
    if (!isFullscreenRecord(record)) {
      const currentBounds = getElementBounds(record.element) || record.bounds || record.restoreBounds;
      record.fullscreenRestoreBounds = sanitizeRecordBounds(record, currentBounds, { root, fullscreen: false })
        || record.restoreBounds
        || record.bounds;
      record.fullscreenRestoreSnap = record.snap || null;
      record.previousState = record.state;
    }
    record.element.hidden = false;
    record.minimized = false;
    record.state = "fullscreen";
    record.snap = null;
    record.bounds = getFullscreenBounds({ root, viewport: options.viewport });
    applyBounds(record.element, record.bounds);
    record.active = true;
    setActiveRecord(record);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-fullscreen", { id, record: shallowRecord(record) });
    notify("fullscreen", record);
    persist(options);
    return shallowRecord(record);
  }

  function exitFullscreenWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    if (!isFullscreenRecord(record)) return shallowRecord(record);
    const restoreBounds = sanitizeRecordBounds(record, record.fullscreenRestoreBounds || record.restoreBounds || record.bounds, {
      root,
      fullscreen: false,
    })
      || record.restoreBounds
      || record.bounds;
    const restoreSnap = record.fullscreenRestoreSnap || null;
    record.state = "open";
    record.minimized = false;
    record.bounds = restoreBounds;
    record.restoreBounds = restoreBounds;
    record.fullscreenRestoreBounds = null;
    record.fullscreenRestoreSnap = null;
    record.snap = restoreSnap;
    if (record.snap?.zone) {
      if (!canSnapRecord(record, record.snap.zone)) {
        record.snap = null;
      }
    }
    if (record.snap?.zone) {
      const snapBounds = getBoundsForSnapZone(record.snap.zone, options.viewport || getViewport(), {
        ...record.snap,
        useWorkArea: options.useWorkArea !== false,
        root,
      });
      record.bounds = applyCapabilityConstraints(snapBounds, record, {
        snap: true,
        currentBounds: record.restoreBounds || record.bounds,
      }) || snapBounds;
    }
    applyBounds(record.element, record.bounds);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-fullscreen-exited", { id, record: shallowRecord(record) });
    notify("fullscreen-exited", record);
    persist(options);
    return shallowRecord(record);
  }

  function toggleFullscreenWindow(id: string, options: LegacyShellOptions = {}) {
    const record = windows.get(id);
    if (!record) return null;
    return isFullscreenRecord(record)
      ? exitFullscreenWindow(id, options)
      : fullscreenWindow(id, options);
  }

  function canSnapWindow(id: string, zone: ShellSnapZone) {
    return canSnapRecord(windows.get(id), zone);
  }

  function restoreShellLayout(options: LegacyShellOptions = {}) {
    layout = store.read();
    activeWindowId = layout.activeWindowId || activeWindowId;
    for (const record of windows.values()) {
      const stored = layout.windows?.[record.id];
      if (!stored) continue;
      applyStoredLayout(record, stored);
      if (
        record.restoreOnBoot === false
        && (stored.state === "open" || stored.state === "fullscreen" || stored.state === "minimized")
      ) {
        closeWindow(record.id, { ...options, invokeLifecycle: false, persist: false });
      } else if ((stored.state === "open" || stored.state === "fullscreen") && record.restoreOnBoot !== false) {
        openWindow(record.id, { ...options, persist: false });
      } else if (stored.state === "minimized") {
        minimizeWindow(record.id, { ...options, invokeLifecycle: false, persist: false });
      } else if (stored.state === "closed") {
        closeWindow(record.id, { ...options, invokeLifecycle: false, persist: false });
      }
    }
    const activeRecord = layout.activeWindowId ? windows.get(layout.activeWindowId) : null;
    if (activeRecord && activeRecord.state !== "closed" && activeRecord.state !== "hidden") {
      activateWindow(activeRecord.id, { ...options, persist: false });
    }
    persist(options);
    return listWindows();
  }

  function reflowWindowsToWorkArea(options: LegacyShellOptions = {}) {
    const metrics: ShellLayoutMetrics = options.metrics || getShellLayoutMetrics({ root });
    const usesGenericPresentation = metrics.profile === "portrait"
      || (metrics.profile === "short-landscape" && metrics.viewport.width < 1000);

    for (const record of windows.values()) {
      if (record.state === "fullscreen") {
        record.bounds = metrics.viewport;
        applyBounds(record.element, metrics.viewport);
        continue;
      }
      if (record.state !== "open" || record.element.hidden) continue;

      let resolvedLayout: LegacyShellOptions | null = null;
      const hasLayoutResolver = typeof record.resolveLayout === "function";
      if (hasLayoutResolver) {
        try {
          resolvedLayout = record.resolveLayout(metrics, shallowRecord(record)) || null;
        } catch {
          // A window-specific layout must not prevent the rest of the shell reflow.
        }
      }

      if ((hasLayoutResolver && !resolvedLayout) || (!usesGenericPresentation && !resolvedLayout)) {
        if (record.presentationBounds || record.presentationLayout) {
          record.presentationBounds = null;
          record.presentationLayout = null;
          const restored = sanitizeRecordBounds(record, record.bounds || record.restoreBounds, {
            root,
            workArea: metrics.workArea,
            fullscreen: false,
          });
          if (restored) applyBounds(record.element, restored);
          setWindowAttributes(record);
        }
        continue;
      }

      const current = record.presentationBounds
        || getElementBounds(record.element)
        || record.bounds
        || record.restoreBounds;
      const layout: LegacyShellOptions = {
        mode: isFocusedLandscapeProfile(metrics.profile) ? "short-landscape" : metrics.profile,
        minWidth: record.capabilities?.minWidth,
        minHeight: record.capabilities?.minHeight,
        maxWidth: Math.min(
          toNumber(record.capabilities?.maxWidth) || metrics.workArea.width,
          metrics.workArea.width,
        ),
        maxHeight: Math.min(
          toNumber(record.capabilities?.maxHeight) || metrics.workArea.height,
          metrics.workArea.height,
        ),
        ...(resolvedLayout || {}),
      };
      record.presentationLayout = layout;
      const constraints = getCapabilitySizeConstraints(record);
      const requested = {
        ...current,
        ...(toNumber(layout.left) !== null ? { left: layout.left } : {}),
        ...(toNumber(layout.top) !== null ? { top: layout.top } : {}),
        ...(toNumber(layout.width) !== null ? { width: layout.width } : {}),
        ...(toNumber(layout.height) !== null ? { height: layout.height } : {}),
      };
      const next = clampBoundsToWorkArea(requested, {
        root,
        workArea: metrics.workArea,
        currentBounds: current,
        forceSize: true,
        ...constraints,
      });
      record.presentationBounds = next;
      applyBounds(record.element, next);
      setWindowAttributes(record);
    }
    emit("vatioboard:shell-work-area-reflowed", { metrics });
    return listWindows();
  }

  function persistShellLayout(options: LegacyShellOptions = {}) {
    const nextLayout = {
      ...layout,
      version: 1,
      activeWindowId,
      windows: { ...(layout.windows || {}) },
    };
    const now = Date.now();
    for (const record of windows.values()) {
      nextLayout.windows[record.id] = {
        ...(nextLayout.windows[record.id] || {}),
        state: isFullscreenRecord(record) ? "open" : record.state,
        previousState: record.previousState,
        bounds: isFullscreenRecord(record) ? (record.fullscreenRestoreBounds || record.restoreBounds) : record.bounds,
        restoreBounds: isFullscreenRecord(record) ? (record.fullscreenRestoreBounds || record.restoreBounds) : record.restoreBounds,
        zIndex: Math.min(record.zIndex, MAX_Z_INDEX),
        minimized: record.minimized,
        snap: isFullscreenRecord(record) ? (record.fullscreenRestoreSnap || null) : record.snap,
        updatedAt: now,
      };
    }
    layout = nextLayout;
    if (options.flush) return store.write(nextLayout);
    store.scheduleWrite(nextLayout);
    return true;
  }

  function subscribe(listener: (event: LegacyShellOptions) => void) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function setShellPreference(key: keyof ShellPreferences, value: ShellPreferences[keyof ShellPreferences]) {
    if (!PREFERENCE_VALIDATORS[key]?.(value)) return getShellPreference(key);
    preferences = normalizeShellPreferences({ ...preferences, [key]: value });
    writeShellPreferences(preferenceStorage, preferences);
    applyShellPreferenceAttributes(root, preferences);
    notifyPreferences();
    return preferences[key];
  }

  function getShellPreference(key?: keyof ShellPreferences) {
    if (!key) return { ...preferences };
    return preferences[key];
  }

  function subscribeShellPreferences(listener: (preferences: ShellPreferences) => void) {
    if (typeof listener !== "function") return () => {};
    preferenceSubscribers.add(listener);
    listener({ ...preferences });
    return () => preferenceSubscribers.delete(listener);
  }

  function destroy() {
    destroyed = true;
    cleanupLayoutMetrics();
    for (const cleanup of listenerCleanups.values()) cleanup();
    listenerCleanups.clear();
    subscribers.clear();
    preferenceSubscribers.clear();
    windows.clear();
    store.flush?.();
    store.destroy?.();
    if (defaultShellWindowManager === api) defaultShellWindowManager = null;
  }

  const api = {
    registerWindow,
    unregisterWindow,
    getWindow,
    getWindowIdForElement,
    listWindows,
    getActiveWindow,
    activateWindow,
    openWindow,
    closeWindow,
    minimizeWindow,
    restoreWindow,
    toggleWindow,
    updateWindowBounds,
    resetWindowGeometry,
    snapWindow,
    unsnapWindow,
    canSnapWindow,
    fullscreenWindow,
    exitFullscreenWindow,
    toggleFullscreenWindow,
    restoreShellLayout,
    reflowWindowsToWorkArea,
    persistShellLayout,
    subscribe,
    setShellPreference,
    getShellPreference,
    subscribeShellPreferences,
    destroy,
    get root() {
      return root;
    },
  };

  cleanupLayoutMetrics = observeShellLayoutMetrics(
    (metrics) => reflowWindowsToWorkArea({ metrics, persist: false }),
    { root },
  );

  return api as ShellRuntime;
}

export function getDefaultShellWindowManager(options: LegacyShellOptions = {}): ShellRuntime {
  if (!defaultShellWindowManager) {
    defaultShellWindowManager = createShellWindowManager(options);
  }
  return defaultShellWindowManager;
}

export function registerWindow(config) {
  return getDefaultShellWindowManager().registerWindow(config);
}

export function unregisterWindow(id) {
  return getDefaultShellWindowManager().unregisterWindow(id);
}

export function getWindow(id) {
  return getDefaultShellWindowManager().getWindow(id);
}

export function listWindows() {
  return getDefaultShellWindowManager().listWindows();
}

export function getActiveWindow() {
  return getDefaultShellWindowManager().getActiveWindow();
}

export function activateWindow(id) {
  return getDefaultShellWindowManager().activateWindow(id);
}

export function openWindow(id, options = {}) {
  return getDefaultShellWindowManager().openWindow(id, options);
}

export function closeWindow(id, options = {}) {
  return getDefaultShellWindowManager().closeWindow(id, options);
}

export function minimizeWindow(id, options = {}) {
  return getDefaultShellWindowManager().minimizeWindow(id, options);
}

export function restoreWindow(id, options = {}) {
  return getDefaultShellWindowManager().restoreWindow(id, options);
}

export function toggleWindow(id, options = {}) {
  return getDefaultShellWindowManager().toggleWindow(id, options);
}

export function updateWindowBounds(id, bounds, options = {}) {
  return getDefaultShellWindowManager().updateWindowBounds(id, bounds, options);
}

export function resetWindowGeometry(id, options = {}) {
  return getDefaultShellWindowManager().resetWindowGeometry(id, options);
}

export function snapWindow(id, zone, options = {}) {
  return getDefaultShellWindowManager().snapWindow(id, zone, options);
}

export function unsnapWindow(id, options = {}) {
  return getDefaultShellWindowManager().unsnapWindow(id, options);
}

export function canSnapWindow(id, zone) {
  return getDefaultShellWindowManager().canSnapWindow(id, zone);
}

export function fullscreenWindow(id, options = {}) {
  return getDefaultShellWindowManager().fullscreenWindow(id, options);
}

export function exitFullscreenWindow(id, options = {}) {
  return getDefaultShellWindowManager().exitFullscreenWindow(id, options);
}

export function toggleFullscreenWindow(id, options = {}) {
  return getDefaultShellWindowManager().toggleFullscreenWindow(id, options);
}

export function restoreShellLayout(options = {}) {
  return getDefaultShellWindowManager().restoreShellLayout(options);
}

export function reflowWindowsToWorkArea(options = {}) {
  return getDefaultShellWindowManager().reflowWindowsToWorkArea(options);
}

export function persistShellLayout(options = {}) {
  return getDefaultShellWindowManager().persistShellLayout(options);
}

export function subscribe(listener) {
  return getDefaultShellWindowManager().subscribe(listener);
}

export function setShellPreference(key, value) {
  return getDefaultShellWindowManager().setShellPreference(key, value);
}

export function getShellPreference(key) {
  return getDefaultShellWindowManager().getShellPreference(key);
}

export function subscribeShellPreferences(listener) {
  return getDefaultShellWindowManager().subscribeShellPreferences(listener);
}

export function destroy() {
  return getDefaultShellWindowManager().destroy();
}
