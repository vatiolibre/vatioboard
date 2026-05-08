import { createShellLayoutStore } from "./shell-layout-store.js";
import { getBoundsForSnapZone } from "./shell-snap.js";

const BASE_Z_INDEX = 1000;
const MAX_Z_INDEX = 1900;
const VALID_STATES = new Set(["closed", "open", "minimized", "hidden"]);

let defaultShellWindowManager = null;

function isElement(value) {
  return Boolean(value?.nodeType === 1);
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const left = toNumber(bounds.left);
  const top = toNumber(bounds.top);
  if (left === null || top === null) return null;
  const next = { left, top };
  const width = toNumber(bounds.width);
  const height = toNumber(bounds.height);
  if (width !== null && width > 0) next.width = width;
  if (height !== null && height > 0) next.height = height;
  return next;
}

function normalizeCapabilities(capabilities = {}) {
  return {
    draggable: capabilities.draggable !== false,
    resizable: capabilities.resizable === true,
    minimizable: capabilities.minimizable !== false,
    closable: capabilities.closable !== false,
    restorable: capabilities.restorable !== false,
    ...(capabilities.pinnable !== undefined ? { pinnable: capabilities.pinnable === true } : {}),
    ...(capabilities.fullscreen !== undefined ? { fullscreen: capabilities.fullscreen === true } : {}),
  };
}

function getElementBounds(element) {
  if (!isElement(element)) return null;
  const rect = element.getBoundingClientRect?.() || {};
  const left = toNumber(element.style?.left) ?? toNumber(rect.left) ?? 0;
  const top = toNumber(element.style?.top) ?? toNumber(rect.top) ?? 0;
  const width = toNumber(element.style?.width) ?? toNumber(rect.width);
  const height = toNumber(element.style?.height) ?? toNumber(rect.height);
  return normalizeBounds({ left, top, width, height }) || { left, top };
}

function applyBounds(element, bounds) {
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

function getViewport() {
  return {
    left: 0,
    top: 0,
    width: globalThis.innerWidth || 1024,
    height: globalThis.innerHeight || 768,
  };
}

function sanitizeLifecycle(lifecycle = {}) {
  return {
    ...(typeof lifecycle.open === "function" ? { open: lifecycle.open } : {}),
    ...(typeof lifecycle.close === "function" ? { close: lifecycle.close } : {}),
    ...(typeof lifecycle.minimize === "function" ? { minimize: lifecycle.minimize } : {}),
    ...(typeof lifecycle.restore === "function" ? { restore: lifecycle.restore } : {}),
    ...(typeof lifecycle.destroy === "function" ? { destroy: lifecycle.destroy } : {}),
  };
}

function shallowRecord(record) {
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
    zIndex: record.zIndex,
    active: record.active,
    minimized: record.minimized,
    snap: record.snap,
    capabilities: record.capabilities,
    lifecycle: record.lifecycle,
    lazy: record.lazy,
    restoreOnBoot: record.restoreOnBoot,
    storageKey: record.storageKey,
    version: record.version,
  };
}

export function createShellWindowManager(options = {}) {
  const store = options.store || createShellLayoutStore(options.storeOptions || {});
  const eventTarget = options.eventTarget || document;
  const root = options.root || document;
  const windows = new Map();
  const elementToId = new WeakMap();
  const listenerCleanups = new Map();
  const subscribers = new Set();
  let layout = store.read();
  let activeWindowId = layout.activeWindowId || null;
  let nextZIndex = Math.max(BASE_Z_INDEX, ...Object.values(layout.windows || {}).map((entry) => entry?.zIndex || 0));
  let destroyed = false;

  function emit(type, detail = {}) {
    try {
      eventTarget?.dispatchEvent?.(new CustomEvent(type, { detail }));
    } catch {
      // DOM events are observability only.
    }
  }

  function notify(event, record) {
    const snapshot = record ? shallowRecord(record) : null;
    for (const listener of subscribers) {
      try {
        listener({ event, record: snapshot, manager: api });
      } catch {
        // Subscriber errors should not break shell state.
      }
    }
  }

  function persist(options = {}) {
    if (options.persist === false) return;
    persistShellLayout({ flush: options.flush === true });
  }

  function invokeLifecycle(record, name, options = {}) {
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

  function setWindowAttributes(record) {
    if (!isElement(record.element)) return;
    record.element.setAttribute("data-vb-shell-window", record.id);
    record.element.setAttribute("data-vb-shell-window-active", record.active ? "true" : "false");
    record.element.setAttribute("data-vb-shell-window-state", record.state);
    record.element.setAttribute("data-vb-floating-panel", "");
    record.element.setAttribute("data-vb-floating-active", record.active ? "true" : "false");
    record.element.style.zIndex = String(Math.min(record.zIndex, MAX_Z_INDEX));
  }

  function setActiveRecord(record) {
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
      if (record.state === "open" && !record.element.hidden) {
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

  function applyStoredLayout(record, stored) {
    if (!stored) return record;
    record.state = VALID_STATES.has(stored.state) ? stored.state : record.state;
    record.previousState = VALID_STATES.has(stored.previousState) ? stored.previousState : record.previousState;
    record.bounds = normalizeBounds(stored.bounds) || record.bounds;
    record.restoreBounds = normalizeBounds(stored.restoreBounds) || record.restoreBounds;
    record.zIndex = Math.min(Number.parseInt(String(stored.zIndex || record.zIndex), 10) || record.zIndex, MAX_Z_INDEX);
    record.minimized = stored.minimized === true || record.state === "minimized";
    record.snap = stored.snap || null;
    if (record.bounds) applyBounds(record.element, record.bounds);
    return record;
  }

  function registerWindow(config = {}) {
    if (destroyed || !config.id || !isElement(config.element)) return null;

    const existing = windows.get(config.id);
    const stored = layout.windows?.[config.id];
    const wasExistingElement = existing?.element === config.element;
    const record = existing || {};
    const elementBounds = getElementBounds(config.element);

    Object.assign(record, {
      id: config.id,
      kind: config.kind || record.kind || "tool",
      title: config.title || record.title || config.id,
      element: config.element,
      launcherElement: config.launcherElement || record.launcherElement || null,
      state: VALID_STATES.has(config.state) ? config.state : (record.state || (config.element.hidden ? "closed" : "open")),
      previousState: VALID_STATES.has(config.previousState) ? config.previousState : (record.previousState || "closed"),
      bounds: normalizeBounds(config.bounds) || record.bounds || elementBounds,
      restoreBounds: normalizeBounds(config.restoreBounds) || record.restoreBounds || elementBounds,
      zIndex: Math.min(Number.parseInt(String(config.zIndex || record.zIndex || BASE_Z_INDEX), 10) || BASE_Z_INDEX, MAX_Z_INDEX),
      active: record.active === true,
      minimized: config.minimized === true || record.minimized === true,
      snap: config.snap || record.snap || null,
      capabilities: normalizeCapabilities({ ...record.capabilities, ...config.capabilities }),
      lifecycle: sanitizeLifecycle({ ...record.lifecycle, ...config.lifecycle }),
      lazy: config.lazy === true || record.lazy === true,
      restoreOnBoot: config.restoreOnBoot !== undefined ? config.restoreOnBoot !== false : record.restoreOnBoot !== false,
      storageKey: config.storageKey || record.storageKey || null,
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

  function unregisterWindow(id) {
    const record = windows.get(id);
    if (!record) return null;
    listenerCleanups.get(id)?.();
    listenerCleanups.delete(id);
    record.lifecycle?.destroy?.();
    record.element?.removeAttribute?.("data-vb-shell-window");
    record.element?.removeAttribute?.("data-vb-shell-window-active");
    record.element?.removeAttribute?.("data-vb-shell-window-state");
    windows.delete(id);
    if (activeWindowId === id) activeWindowId = null;
    emit("vatioboard:shell-window-unregistered", { id });
    notify("unregistered", record);
    persist({});
    return shallowRecord(record);
  }

  function getWindow(id) {
    return shallowRecord(windows.get(id));
  }

  function getWindowIdForElement(element) {
    if (!isElement(element)) return null;
    return elementToId.get(element) || element.getAttribute("data-vb-shell-window") || null;
  }

  function listWindows() {
    return Array.from(windows.values(), shallowRecord);
  }

  function getActiveWindow() {
    return getWindow(activeWindowId);
  }

  function activateWindow(id, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    record.zIndex = nextLayer();
    record.active = true;
    setActiveRecord(record);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-activated", { id, record: shallowRecord(record) });
    notify("activated", record);
    persist(options);
    return shallowRecord(record);
  }

  function showRecord(record) {
    record.element.hidden = false;
    record.minimized = false;
    record.state = "open";
    if (record.snap?.zone) {
      const snapBounds = getBoundsForSnapZone(record.snap.zone, getViewport(), record.snap);
      record.bounds = snapBounds;
      applyBounds(record.element, snapBounds);
    } else if (record.bounds) {
      applyBounds(record.element, record.bounds);
    }
    setWindowAttributes(record);
  }

  function openWindow(id, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    invokeLifecycle(record, "open", options);
    showRecord(record);
    activateWindow(id, { ...options, persist: false });
    emit("vatioboard:shell-window-opened", { id, record: shallowRecord(record) });
    notify("opened", record);
    persist(options);
    return shallowRecord(record);
  }

  function closeWindow(id, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    record.bounds = getElementBounds(record.element) || record.bounds;
    record.restoreBounds = record.bounds || record.restoreBounds;
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

  function minimizeWindow(id, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    record.bounds = getElementBounds(record.element) || record.bounds;
    record.restoreBounds = record.bounds || record.restoreBounds;
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

  function restoreWindow(id, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    invokeLifecycle(record, "restore", options);
    record.state = "open";
    record.minimized = false;
    record.bounds = record.restoreBounds || record.bounds;
    showRecord(record);
    activateWindow(id, { ...options, persist: false });
    emit("vatioboard:shell-window-restored", { id, record: shallowRecord(record) });
    notify("restored", record);
    persist(options);
    return shallowRecord(record);
  }

  function toggleWindow(id, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    if (record.state === "open" && !record.element.hidden) return closeWindow(id, options);
    if (record.state === "minimized") return restoreWindow(id, options);
    return openWindow(id, options);
  }

  function updateWindowBounds(id, bounds, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    const next = normalizeBounds(bounds);
    if (!next) return shallowRecord(record);
    record.bounds = next;
    if (options.updateRestoreBounds !== false) record.restoreBounds = next;
    if (options.preserveSnap !== true) record.snap = null;
    applyBounds(record.element, next);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record) });
    notify("layout-changed", record);
    persist(options);
    return shallowRecord(record);
  }

  function snapWindow(id, zone, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    if (!record.snap && record.state === "open") {
      record.restoreBounds = getElementBounds(record.element) || record.bounds;
    }
    const bounds = getBoundsForSnapZone(zone, options.viewport || getViewport(), options);
    record.snap = { zone, ...(options.ratio ? { ratio: options.ratio } : {}) };
    record.bounds = bounds;
    applyBounds(record.element, bounds);
    setWindowAttributes(record);
    emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record) });
    notify("snapped", record);
    persist(options);
    return shallowRecord(record);
  }

  function unsnapWindow(id, options = {}) {
    const record = windows.get(id);
    if (!record) return null;
    record.snap = null;
    if (record.restoreBounds) {
      record.bounds = record.restoreBounds;
      applyBounds(record.element, record.restoreBounds);
    }
    setWindowAttributes(record);
    emit("vatioboard:shell-window-layout-changed", { id, record: shallowRecord(record) });
    notify("unsnapped", record);
    persist(options);
    return shallowRecord(record);
  }

  function restoreShellLayout(options = {}) {
    layout = store.read();
    activeWindowId = layout.activeWindowId || activeWindowId;
    for (const record of windows.values()) {
      const stored = layout.windows?.[record.id];
      if (!stored) continue;
      applyStoredLayout(record, stored);
      if (stored.state === "open" && record.restoreOnBoot !== false) {
        openWindow(record.id, { ...options, persist: false });
      } else if (stored.state === "minimized") {
        minimizeWindow(record.id, { ...options, invokeLifecycle: false, persist: false });
      } else if (stored.state === "closed") {
        closeWindow(record.id, { ...options, invokeLifecycle: false, persist: false });
      }
    }
    if (layout.activeWindowId && windows.has(layout.activeWindowId)) {
      activateWindow(layout.activeWindowId, { ...options, persist: false });
    }
    persist(options);
    return listWindows();
  }

  function persistShellLayout(options = {}) {
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
        state: record.state,
        previousState: record.previousState,
        bounds: record.bounds,
        restoreBounds: record.restoreBounds,
        zIndex: Math.min(record.zIndex, MAX_Z_INDEX),
        minimized: record.minimized,
        snap: record.snap,
        updatedAt: now,
      };
    }
    layout = nextLayout;
    if (options.flush) return store.write(nextLayout);
    store.scheduleWrite(nextLayout);
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function destroy() {
    destroyed = true;
    for (const cleanup of listenerCleanups.values()) cleanup();
    listenerCleanups.clear();
    subscribers.clear();
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
    snapWindow,
    unsnapWindow,
    restoreShellLayout,
    persistShellLayout,
    subscribe,
    destroy,
    get root() {
      return root;
    },
  };

  return api;
}

export function getDefaultShellWindowManager(options = {}) {
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

export function snapWindow(id, zone, options = {}) {
  return getDefaultShellWindowManager().snapWindow(id, zone, options);
}

export function unsnapWindow(id, options = {}) {
  return getDefaultShellWindowManager().unsnapWindow(id, options);
}

export function restoreShellLayout(options = {}) {
  return getDefaultShellWindowManager().restoreShellLayout(options);
}

export function persistShellLayout(options = {}) {
  return getDefaultShellWindowManager().persistShellLayout(options);
}

export function subscribe(listener) {
  return getDefaultShellWindowManager().subscribe(listener);
}

export function destroy() {
  return getDefaultShellWindowManager().destroy();
}

