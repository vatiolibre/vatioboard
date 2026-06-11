import type { ShellRuntime, ShellWindowRecord } from "../types/shell";
import type { StorageLike } from "../types/storage";
import { appControl, appRegistry, applyAppIconTheme } from "../app-platform/index.js";
import type { VatioAppManifest, VatioAppShellRuntime } from "../app-platform/types";
import { IconLogin, IconPages } from "../icons.js";
import { createDragSensors } from "./drag-sensors.js";
import { getToolDefinitionForShellWindow } from "./tool-registry.js";

const TASKBAR_STATE_KEY = "vatioboard.shell.taskbar_fabs.v1";
const BACKEND_AUTH_STATE_EVENT = "vatioboard:backend-auth-state";
const RETURN_MARGIN_PX = 36;
const FAB_SIZE_PX = 52;
const VIEWPORT_MARGIN_PX = 8;
const REDOCK_ZONE_WIDTH_PX = 280;
const REDOCK_ZONE_HEIGHT_PX = 136;
const TASKBAR_AVOID_BOTTOM_VAR = "--vb-shell-taskbar-avoid-bottom";

// TODO(ts-migration): drag sensors preserve the legacy JS payload shape while
// the taskbar callers are still mixed JS/TS.
type LegacyTaskbarOptions = Record<string, any>;

interface TaskbarAuthState {
  authenticated?: boolean | null;
  busy?: boolean;
  isGuest?: boolean | null;
  pendingLogout?: boolean;
  user?: string | null;
}

interface StoredPosition {
  detached: true;
  left: number;
  top: number;
}

interface TaskbarState {
  knownWindowIds: string[];
  positions: Record<string, StoredPosition>;
  taskbar: StoredPosition | null;
}

interface TaskbarOptions {
  shellManager?: ShellRuntime;
  root?: HTMLElement;
  labels?: Record<string, string>;
  icons?: Record<string, string>;
  startMenu?: VatioBoardStartMenu | null;
  appLauncher?: Pick<VatioAppShellRuntime, "openApp"> | null;
  accountPanel?: {
    open?: (options?: Record<string, unknown>) => void;
    toggle?: (options?: Record<string, unknown>) => void;
  } | null;
  storage?: StorageLike | null;
}

function getWindowState(record: ShellWindowRecord | LegacyTaskbarOptions) {
  if (record.minimized || record.state === "minimized") return "minimized";
  if (record.state === "open" && !record.element?.hidden) return "open";
  return record.state || "closed";
}

function defaultLabel(record: ShellWindowRecord | LegacyTaskbarOptions) {
  return record.title || record.id;
}

function getStorage(storage?: StorageLike | null) {
  if (storage === null) return null;
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeStoredPosition(value: LegacyTaskbarOptions, { requireDetached = true }: { requireDetached?: boolean } = {}): StoredPosition | null {
  const left = Number.parseFloat(String(value?.left));
  const top = Number.parseFloat(String(value?.top));
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  if (requireDetached && value?.detached !== true) return null;
  return { detached: true, left, top };
}

function readTaskbarState(storage: StorageLike | null): TaskbarState {
  if (!storage) return { knownWindowIds: [], positions: {}, taskbar: null };
  try {
    const parsed = JSON.parse(storage.getItem(TASKBAR_STATE_KEY) || "{}");
    const knownWindowIds = Array.isArray(parsed.knownWindowIds)
      ? parsed.knownWindowIds.filter((id) => typeof id === "string" && id)
      : [];
    const positions = {};
    if (parsed.positions && typeof parsed.positions === "object") {
      for (const [id, value] of Object.entries(parsed.positions)) {
        const position = normalizeStoredPosition(value);
        if (typeof id === "string" && position) positions[id] = position;
      }
    }
    return {
      knownWindowIds,
      positions,
      taskbar: normalizeStoredPosition(parsed.taskbar),
    };
  } catch {
    try {
      storage.removeItem(TASKBAR_STATE_KEY);
    } catch {
      // best effort only
    }
    return { knownWindowIds: [], positions: {}, taskbar: null };
  }
}

function writeTaskbarState(
  storage: StorageLike | null,
  knownWindowIds: Set<string>,
  itemPositions: Map<string, StoredPosition>,
  taskbarPosition: StoredPosition | null,
) {
  if (!storage) return;
  try {
    const positions = {};
    for (const [id, position] of itemPositions) {
      if (position?.detached === true) {
        positions[id] = {
          detached: true,
          left: Math.round(position.left),
          top: Math.round(position.top),
        };
      }
    }
    storage.setItem(TASKBAR_STATE_KEY, JSON.stringify({
      version: 1,
      knownWindowIds: Array.from(knownWindowIds),
      positions,
      taskbar: taskbarPosition?.detached === true
        ? {
            detached: true,
            left: Math.round(taskbarPosition.left),
            top: Math.round(taskbarPosition.top),
          }
        : null,
    }));
  } catch {
    // taskbar placement is convenience state only
  }
}

function getInitial(label: unknown) {
  return String(label || "?").trim().charAt(0).toUpperCase() || "?";
}

function getAppLabel(app: VatioAppManifest) {
  return app.shortTitle || app.title || app.id;
}

function isLaunchableFavoriteApp(app: VatioAppManifest) {
  return appControl.isFavorite(app.id)
    && appControl.isEnabled(app.id)
    && Boolean(app.route || app.window?.shellWindowId);
}

function getFavoriteApps() {
  return appRegistry.listApps()
    .filter(isLaunchableFavoriteApp)
    .sort((a, b) => (
      a.order - b.order
      || getAppLabel(a).localeCompare(getAppLabel(b))
      || a.id.localeCompare(b.id)
    ));
}

function getAppShellWindowId(app: VatioAppManifest) {
  return app.window?.shellWindowId || "";
}

function getAppForShellWindowId(shellWindowId: string) {
  return appRegistry.listApps().find((app) => app.window?.shellWindowId === shellWindowId) || null;
}

function isVisibleTaskbarState(state: string) {
  return state === "open" || state === "minimized";
}

function getDetachedRoot(root: HTMLElement | Document | null | undefined) {
  return root?.appendChild ? root : document.body;
}

function getViewportSize() {
  const viewport = globalThis.visualViewport;
  return {
    width: viewport?.width || globalThis.innerWidth || document.documentElement?.clientWidth || 1024,
    height: viewport?.height || globalThis.innerHeight || document.documentElement?.clientHeight || 768,
  };
}

function getViewportBounds() {
  const viewport = globalThis.visualViewport;
  const size = getViewportSize();
  return {
    left: viewport?.offsetLeft || 0,
    top: viewport?.offsetTop || 0,
    width: size.width,
    height: size.height,
  };
}

function clampPositionToViewport(position: LegacyTaskbarOptions, width: number, height: number) {
  const viewport = getViewportBounds();
  const minLeft = viewport.left + VIEWPORT_MARGIN_PX;
  const minTop = viewport.top + VIEWPORT_MARGIN_PX;
  const maxLeft = viewport.left + viewport.width - width - VIEWPORT_MARGIN_PX;
  const maxTop = viewport.top + viewport.height - height - VIEWPORT_MARGIN_PX;
  return {
    left: Math.min(
      Math.max(minLeft, position.left),
      Math.max(minLeft, maxLeft)
    ),
    top: Math.min(
      Math.max(minTop, position.top),
      Math.max(minTop, maxTop)
    ),
  };
}

function clampElementPosition(
  position: LegacyTaskbarOptions,
  element: HTMLElement,
  fallbackWidth = FAB_SIZE_PX,
  fallbackHeight = FAB_SIZE_PX,
) {
  const rect = (element?.getBoundingClientRect?.() || {}) as DOMRect;
  const width = rect.width || element?.offsetWidth || fallbackWidth;
  const height = rect.height || element?.offsetHeight || fallbackHeight;
  return clampPositionToViewport(position, width, height);
}

function applyDetachedStyle(item: HTMLElement, position: StoredPosition) {
  item.classList.add("is-detached");
  item.style.position = "fixed";
  item.style.left = `${Math.round(position.left)}px`;
  item.style.top = `${Math.round(position.top)}px`;
  item.style.right = "auto";
  item.style.bottom = "auto";
}

function clearDetachedStyle(item: HTMLElement) {
  item.classList.remove("is-detached", "is-dragging", "is-drag-source");
  item.removeAttribute("data-vb-shell-taskbar-drag-source");
  item.style.position = "";
  item.style.left = "";
  item.style.top = "";
  item.style.right = "";
  item.style.bottom = "";
  item.style.transform = "";
  item.style.willChange = "";
}

function suppressNativeDrag(element: HTMLElement) {
  element.draggable = false;
  element.setAttribute("draggable", "false");
  element.ondragstart = () => false;
}

function makePoint(clientX: number, clientY: number) {
  return { clientX, clientY, x: clientX, y: clientY };
}

export function createShellTaskbar({
  shellManager,
  root = document.body,
  labels = {},
  icons = {},
  startMenu = null,
  appLauncher = null,
  accountPanel = null,
  storage,
}: TaskbarOptions = {}) {
  if (!shellManager) throw new Error("createShellTaskbar requires a shellManager.");

  const storageTarget = getStorage(storage);
  const savedState = readTaskbarState(storageTarget);
  const knownWindowIds = new Set(savedState.knownWindowIds);
  const itemPositions = new Map(Object.entries(savedState.positions));
  let taskbarPosition = savedState.taskbar;
  const itemElements = new Map();
  const itemSensors = new Map();
  const suppressedClicks = new Set();

  const element = document.createElement("nav");
  element.className = "vb-shell-taskbar";
  element.setAttribute("data-vb-shell-taskbar", "");
  element.setAttribute("aria-label", labels.taskbar || "Shell windows");
  suppressNativeDrag(element);

  const favoritesElement = document.createElement("div");
  favoritesElement.className = "vb-shell-taskbar-favorites";
  favoritesElement.setAttribute("data-vb-shell-taskbar-favorites", "");
  favoritesElement.setAttribute("aria-label", labels.favoriteApps || "Favorite apps");
  suppressNativeDrag(favoritesElement);

  const dragHandle = document.createElement("div");
  dragHandle.className = "vb-shell-taskbar-drag-handle";
  dragHandle.setAttribute("data-vb-shell-taskbar-drag-handle", "");
  dragHandle.setAttribute("aria-hidden", "true");
  suppressNativeDrag(dragHandle);

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "vb-shell-taskbar-start vb-shell-taskbar-fab dock-btn";
  startButton.setAttribute("data-vb-shell-start-button", "");
  startButton.setAttribute("aria-label", labels.startMenu || "Start menu");
  startButton.setAttribute("aria-haspopup", "true");
  startButton.setAttribute("aria-expanded", "false");
  startButton.title = labels.startMenu || "Start menu";
  suppressNativeDrag(startButton);
  applyAppIconTheme(startButton, appRegistry.getApp("vatio.appManager"));

  const startIcon = document.createElement("span");
  startIcon.className = "vb-shell-taskbar-icon";
  startIcon.setAttribute("aria-hidden", "true");
  startIcon.innerHTML = icons.startMenu || IconPages;
  startButton.append(startIcon);

  const startLabel = document.createElement("span");
  startLabel.className = "vb-shell-taskbar-label";
  startLabel.textContent = labels.startMenu || "Start menu";
  startButton.append(startLabel);
  startMenu?.bindTrigger?.(startButton);

  const accountButton = document.createElement("button");
  accountButton.type = "button";
  accountButton.className = "vb-shell-taskbar-account vb-shell-taskbar-fab dock-btn";
  accountButton.setAttribute("data-vb-shell-account-button", "");
  accountButton.setAttribute("aria-label", labels.account || "Account");
  accountButton.title = labels.account || "Account";
  suppressNativeDrag(accountButton);

  const accountIcon = document.createElement("span");
  accountIcon.className = "vb-shell-taskbar-icon";
  accountIcon.setAttribute("aria-hidden", "true");
  accountIcon.innerHTML = icons.account || IconLogin;
  accountButton.append(accountIcon);

  const accountStatus = document.createElement("span");
  accountStatus.className = "vb-shell-taskbar-account-status";
  accountStatus.setAttribute("aria-hidden", "true");
  accountButton.append(accountStatus);

  const accountLabel = document.createElement("span");
  accountLabel.className = "vb-shell-taskbar-label";
  accountLabel.textContent = labels.account || "Account";
  accountButton.append(accountLabel);

  const trayElement = document.createElement("div");
  trayElement.className = "vb-shell-taskbar-tray";
  trayElement.setAttribute("data-vb-shell-taskbar-tray", "");
  element.append(startButton, favoritesElement, trayElement, accountButton, dragHandle);

  const trashElement = document.createElement("div");
  trashElement.className = "vb-shell-taskbar-trash";
  trashElement.setAttribute("data-vb-shell-taskbar-trash", "");
  trashElement.setAttribute("data-vb-shell-taskbar-trash-active", "false");
  trashElement.setAttribute("aria-hidden", "true");
  trashElement.setAttribute("aria-label", labels.removeFromTaskbar || "Remove from taskbar");
  trashElement.hidden = true;

  const trashIcon = document.createElement("span");
  trashIcon.className = "vb-shell-taskbar-trash-icon";
  trashIcon.setAttribute("aria-hidden", "true");
  trashElement.append(trashIcon);

  const trashLabel = document.createElement("span");
  trashLabel.className = "vb-shell-taskbar-trash-label";
  trashLabel.textContent = labels.removeFromTaskbar || "Remove";
  trashElement.append(trashLabel);

  let unsubscribe = null;
  let preferenceUnsubscribe = null;
  let appControlUnsubscribe = null;
  let authStateListener: ((event: Event) => void) | null = null;
  let destroyed = false;
  let taskbarSensor = null;
  let activeTaskbarDrag = null;
  let activeItemDrag = null;
  let dragLayerElement = null;

  function saveState() {
    writeTaskbarState(storageTarget, knownWindowIds, itemPositions, taskbarPosition);
  }

  function ensureDragLayer() {
    if (dragLayerElement?.isConnected) return dragLayerElement;
    dragLayerElement = document.createElement("div");
    dragLayerElement.className = "vb-shell-drag-layer";
    dragLayerElement.setAttribute("data-vb-shell-drag-layer", "");
    dragLayerElement.setAttribute("aria-hidden", "true");
    document.body.append(dragLayerElement);
    return dragLayerElement;
  }

  function removeDragLayerIfEmpty() {
    if (!dragLayerElement) return;
    if (dragLayerElement.childElementCount > 0) return;
    dragLayerElement.remove();
    dragLayerElement = null;
  }

  function createItemGhost(item, rect) {
    const layer = ensureDragLayer();
    const ghost = item.cloneNode(true);
    ghost.classList.add("vb-shell-drag-ghost", "is-dragging");
    ghost.classList.remove("is-drag-source");
    ghost.removeAttribute("data-vb-shell-taskbar-item");
    ghost.setAttribute("data-vb-shell-drag-ghost", item.getAttribute("data-vb-shell-taskbar-item") || "");
    ghost.setAttribute("aria-hidden", "true");
    suppressNativeDrag(ghost);
    ghost.style.left = `${Math.round(rect.left)}px`;
    ghost.style.top = `${Math.round(rect.top)}px`;
    ghost.style.width = `${Math.round(rect.width || FAB_SIZE_PX)}px`;
    ghost.style.height = `${Math.round(rect.height || FAB_SIZE_PX)}px`;
    layer.append(ghost);
    return ghost;
  }

  function removeItemGhost(ghost) {
    ghost?.remove();
    removeDragLayerIfEmpty();
  }

  function prepareTrashTarget() {
    const detachedRoot = getDetachedRoot(root);
    if (trashElement.parentElement !== detachedRoot) detachedRoot.append(trashElement);
    trashElement.classList.remove("is-visible");
    trashElement.setAttribute("data-vb-shell-taskbar-trash-active", "false");
    trashElement.setAttribute("aria-hidden", "true");
    trashElement.hidden = true;
  }

  function showTrashTarget() {
    if (!trashElement.isConnected) prepareTrashTarget();
    trashElement.hidden = false;
    trashElement.setAttribute("aria-hidden", "false");
    trashElement.classList.add("is-visible");
  }

  function hideTrashTarget() {
    trashElement.classList.remove("is-visible");
    trashElement.setAttribute("data-vb-shell-taskbar-trash-active", "false");
    trashElement.setAttribute("aria-hidden", "true");
    trashElement.hidden = true;
    trashElement.remove();
  }

  function isPointOverTrashTarget(point) {
    if (!point || trashElement.hidden) return false;
    const rect = trashElement.getBoundingClientRect();
    const width = rect.width || rect.right - rect.left;
    const height = rect.height || rect.bottom - rect.top;
    if (!width || !height) return false;
    return point.clientX >= rect.left
      && point.clientX <= rect.right
      && point.clientY >= rect.top
      && point.clientY <= rect.bottom;
  }

  function updateTrashTarget(point) {
    const overTrash = isPointOverTrashTarget(point);
    trashElement.setAttribute("data-vb-shell-taskbar-trash-active", overTrash ? "true" : "false");
    return overTrash;
  }

  function getTaskbarDockPosition() {
    return element.getAttribute("data-vb-shell-taskbar-position") || "bottom";
  }

  function setTaskbarBottomAvoidance(value: number) {
    document.documentElement.style.setProperty(TASKBAR_AVOID_BOTTOM_VAR, `${Math.max(0, Math.ceil(value))}px`);
  }

  function clearTaskbarBottomAvoidance() {
    document.documentElement.style.removeProperty(TASKBAR_AVOID_BOTTOM_VAR);
  }

  function syncTaskbarBottomAvoidance() {
    if (
      destroyed
      || element.hidden
      || taskbarPosition?.detached === true
      || element.classList.contains("is-detached")
      || element.getAttribute("data-vb-shell-taskbar-floating") === "true"
      || getTaskbarDockPosition() !== "bottom"
    ) {
      setTaskbarBottomAvoidance(0);
      return;
    }

    const rect = element.getBoundingClientRect();
    const viewport = getViewportBounds();
    const viewportBottom = viewport.top + viewport.height;
    const height = rect.height || element.offsetHeight || 0;
    const top = Number.isFinite(rect.top) && (rect.top || height) ? rect.top : viewportBottom - height;
    setTaskbarBottomAvoidance(Math.max(0, viewportBottom - top));
  }

  function applyTaskbarPosition() {
    if (taskbarPosition?.detached === true) {
      const previous = taskbarPosition;
      const position = clampElementPosition(taskbarPosition, element, 64, 64);
      taskbarPosition = { detached: true, ...position };
      setTaskbarFixedPosition(position);
      if (previous.left !== position.left || previous.top !== position.top) {
        saveState();
      }
      return;
    }

    element.classList.remove("is-detached", "is-dragging");
    element.setAttribute("data-vb-shell-taskbar-floating", "false");
    element.style.position = "";
    element.style.left = "";
    element.style.top = "";
    element.style.right = "";
    element.style.bottom = "";
    element.style.transform = "";
    element.style.willChange = "";
    syncTaskbarBottomAvoidance();
  }

  function setTaskbarFixedPosition(position, { transform = "none", dragging = false } = {}) {
    element.classList.add("is-detached");
    element.setAttribute("data-vb-shell-taskbar-floating", "true");
    element.style.position = "fixed";
    element.style.left = `${Math.round(position.left)}px`;
    element.style.top = `${Math.round(position.top)}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    element.style.transform = transform;
    element.style.willChange = dragging ? "transform" : "";
    syncTaskbarBottomAvoidance();
  }

  function ensureTaskbarFixedTopLeft() {
    const rect = element.getBoundingClientRect();
    const left = element.style.left ? parseFloat(element.style.left) : rect.left;
    const top = element.style.top ? parseFloat(element.style.top) : rect.top;
    setTaskbarFixedPosition({ left, top }, { transform: "none", dragging: true });
    return { rect, left, top };
  }

  function clampTaskbarToViewport(width = 64, height = 64) {
    const currentLeft = parseFloat(element.style.left) || 0;
    const currentTop = parseFloat(element.style.top) || 0;
    const position = clampPositionToViewport({ left: currentLeft, top: currentTop }, width, height);
    setTaskbarFixedPosition(position);
    taskbarPosition = { detached: true, ...position };
    return position;
  }

  function clampDetachedItemsToViewport() {
    let changed = false;
    for (const [id, position] of itemPositions) {
      if (position?.detached !== true) continue;
      const item = itemElements.get(id)
        || Array.from(document.querySelectorAll("[data-vb-shell-taskbar-item]"))
          .find((candidate) => candidate.getAttribute("data-vb-shell-taskbar-item") === id);
      const next = clampElementPosition(position, item, FAB_SIZE_PX, FAB_SIZE_PX);
      if (next.left !== position.left || next.top !== position.top) {
        const clampedPosition: StoredPosition = {
          detached: true,
          left: next.left,
          top: next.top,
        };
        itemPositions.set(id, clampedPosition);
        if (item instanceof HTMLElement) applyDetachedStyle(item, clampedPosition);
        changed = true;
      }
    }
    return changed;
  }

  function clampFloatingSurfaces() {
    if (destroyed) return;
    const previousTaskbarPosition = taskbarPosition;
    applyTaskbarPosition();
    const taskbarChanged = Boolean(
      previousTaskbarPosition?.detached === true
      && taskbarPosition?.detached === true
      && (
        previousTaskbarPosition.left !== taskbarPosition.left
        || previousTaskbarPosition.top !== taskbarPosition.top
      )
    );
    const itemsChanged = clampDetachedItemsToViewport();
    if (taskbarChanged || itemsChanged) saveState();
    syncTaskbarBottomAvoidance();
  }

  function scheduleViewportClamp() {
    clampFloatingSurfaces();
  }

  function rememberWindow(id) {
    if (!id || knownWindowIds.has(id)) return;
    knownWindowIds.add(id);
    saveState();
  }

  function forgetWindow(id) {
    if (!id || !knownWindowIds.has(id)) return;
    knownWindowIds.delete(id);
    itemPositions.delete(id);
    saveState();
  }

  function closeWindowFromTaskbarTrash(record) {
    const id = record?.id;
    if (!id) return;
    forgetWindow(id);
    shellManager.closeWindow?.(id, {
      taskbarTrash: true,
      ...(id === "player" ? { stopPlayback: true } : {}),
    });
  }

  function getTaskbarWindows(excludedWindowIds = new Set<string>()) {
    const records = shellManager.listWindows()
      .filter((record) => record.kind !== "system")
      .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));

    for (const record of records) {
      const state = getWindowState(record);
      if (isVisibleTaskbarState(state)) rememberWindow(record.id);
      else forgetWindow(record.id);
    }

    return records.filter((record) => knownWindowIds.has(record.id) && !excludedWindowIds.has(record.id));
  }

  function handleItemClick(record, event) {
    if (suppressedClicks.has(record.id)) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }

    const current = shellManager.getWindow(record.id);
    if (!current) return;
    const state = getWindowState(current);

    if (state === "minimized") {
      shellManager.restoreWindow(record.id);
      return;
    }

    if (state === "open" && current.active) {
      if (current.capabilities?.minimizable !== false) {
        shellManager.minimizeWindow(record.id);
      }
      return;
    }

    if (state === "open") {
      shellManager.activateWindow(record.id);
      return;
    }

    shellManager.openWindow(record.id);
  }

  function isPointNearRect(point, rect) {
    const width = rect.width || rect.right - rect.left;
    const height = rect.height || rect.bottom - rect.top;
    if (!width && !height) return false;
    return point.clientX >= rect.left - RETURN_MARGIN_PX
      && point.clientX <= rect.right + RETURN_MARGIN_PX
      && point.clientY >= rect.top - RETURN_MARGIN_PX
      && point.clientY <= rect.bottom + RETURN_MARGIN_PX;
  }

  function isPointNearTaskbar(point) {
    if (!point) return false;
    if (isPointNearRect(point, trayElement.getBoundingClientRect())) return true;
    if (isPointNearRect(point, element.getBoundingClientRect())) return true;

    const position = getTaskbarDockPosition();
    const viewport = getViewportSize();
    const edgeDistance = RETURN_MARGIN_PX + FAB_SIZE_PX;
    if (position === "left") return point.clientX <= edgeDistance;
    if (position === "right") return point.clientX >= viewport.width - edgeDistance;
    return point.clientY >= viewport.height - edgeDistance;
  }

  function isPointInTaskbarRedockZone(point, drag) {
    if (!point) return false;
    const viewport = getViewportBounds();
    const position = getTaskbarDockPosition();
    const width = Math.max(REDOCK_ZONE_WIDTH_PX, (drag?.width || FAB_SIZE_PX) + RETURN_MARGIN_PX);
    const height = Math.max(REDOCK_ZONE_HEIGHT_PX, (drag?.height || FAB_SIZE_PX) + RETURN_MARGIN_PX);
    if (position === "left") {
      return point.clientX <= viewport.left + height;
    }
    if (position === "right") {
      return point.clientX >= viewport.left + viewport.width - height;
    }
    return point.clientX <= viewport.left + width
      && point.clientY >= viewport.top + viewport.height - height;
  }

  function beginTaskbarDrag(payload) {
    if (destroyed || element.hidden) return;
    const { rect, left, top } = ensureTaskbarFixedTopLeft();
    activeTaskbarDrag = {
      width: rect.width || element.offsetWidth || 64,
      height: rect.height || element.offsetHeight || 64,
      originLeft: left,
      originTop: top,
      nextLeft: left,
      nextTop: top,
      rafId: 0,
    };
    element.classList.add("is-dragging");
    document.documentElement.classList.add("vb-floating-drag-active");
    element.style.willChange = "transform";
    payload.event?.preventDefault?.();
  }

  function scheduleTaskbarMove() {
    const drag = activeTaskbarDrag;
    if (!drag || drag.rafId) return;
    drag.rafId = requestAnimationFrame(() => {
      drag.rafId = 0;
      if (!activeTaskbarDrag) return;
      const tx = Math.round(drag.nextLeft - drag.originLeft);
      const ty = Math.round(drag.nextTop - drag.originTop);
      element.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    });
  }

  function moveTaskbarDrag(payload) {
    const drag = activeTaskbarDrag;
    if (!drag) return;
    const position = clampPositionToViewport({
      left: drag.originLeft + payload.dx,
      top: drag.originTop + payload.dy,
    }, drag.width, drag.height);
    drag.nextLeft = position.left;
    drag.nextTop = position.top;
    scheduleTaskbarMove();
    payload.event?.preventDefault?.();
  }

  function endTaskbarDrag(payload: LegacyTaskbarOptions = {}) {
    const drag = activeTaskbarDrag;
    activeTaskbarDrag = null;
    if (!drag) return;
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = 0;
    }
    const point = payload.point || makePoint(payload.clientX ?? drag.nextLeft, payload.clientY ?? drag.nextTop);
    if (isPointInTaskbarRedockZone(point, drag)) {
      taskbarPosition = null;
      applyTaskbarPosition();
    } else {
      setTaskbarFixedPosition({ left: drag.nextLeft, top: drag.nextTop });
      clampTaskbarToViewport(drag.width, drag.height);
    }
    element.classList.remove("is-dragging");
    document.documentElement.classList.remove("vb-floating-drag-active");
    element.style.willChange = "";
    saveState();
    syncTaskbarBottomAvoidance();
    payload.event?.preventDefault?.();
  }

  function canStartTaskbarDrag(event) {
    if (element.hidden || destroyed) return null;
    if (!event.target?.closest?.("[data-vb-shell-taskbar-drag-handle]")) return null;
    return {};
  }

  function beginItemDrag(payload) {
    const { record, item } = payload.context;
    if (!record || !item || destroyed) return;
    suppressNativeDrag(item);
    prepareTrashTarget();

    const saved = itemPositions.get(record.id);
    const rect = item.getBoundingClientRect();
    const width = rect.width || item.offsetWidth || FAB_SIZE_PX;
    const height = rect.height || item.offsetHeight || FAB_SIZE_PX;
    const startLeft = saved?.detached === true ? saved.left : rect.left;
    const startTop = saved?.detached === true ? saved.top : rect.top;
    const position = clampPositionToViewport({ left: startLeft, top: startTop }, width, height);
    const ghost = createItemGhost(item, {
      left: position.left,
      top: position.top,
      width,
      height,
    });

    activeItemDrag = {
      record,
      item,
      ghost,
      dockedAtStart: saved?.detached !== true,
      startLeft: position.left,
      startTop: position.top,
      currentLeft: position.left,
      currentTop: position.top,
      width,
      height,
      overTrash: false,
      rafId: 0,
      moved: false,
      lastPoint: makePoint(payload.clientX, payload.clientY),
    };

    item.classList.add("is-dragging", "is-drag-source");
    item.setAttribute("data-vb-shell-taskbar-drag-source", "true");
    document.documentElement.classList.add("vb-floating-drag-active");
    showTrashTarget();
    payload.event?.preventDefault?.();
  }

  function scheduleItemGhostMove() {
    const drag = activeItemDrag;
    if (!drag || drag.rafId) return;
    drag.rafId = requestAnimationFrame(() => {
      drag.rafId = 0;
      if (!activeItemDrag) return;
      const tx = Math.round(drag.currentLeft - drag.startLeft);
      const ty = Math.round(drag.currentTop - drag.startTop);
      drag.ghost.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    });
  }

  function moveItemDrag(payload) {
    const drag = activeItemDrag;
    if (!drag) return;
    const position = clampPositionToViewport({
      left: drag.startLeft + payload.dx,
      top: drag.startTop + payload.dy,
    }, drag.width, drag.height);
    drag.currentLeft = position.left;
    drag.currentTop = position.top;
    drag.lastPoint = makePoint(payload.clientX, payload.clientY);
    drag.moved = true;
    drag.overTrash = updateTrashTarget(drag.lastPoint);
    scheduleItemGhostMove();
    payload.event?.preventDefault?.();
  }

  function cleanupItemDragVisuals(drag) {
    if (!drag) return;
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = 0;
    }
    drag.item.classList.remove("is-dragging", "is-drag-source");
    drag.item.removeAttribute("data-vb-shell-taskbar-drag-source");
    removeItemGhost(drag.ghost);
    hideTrashTarget();
    document.documentElement.classList.remove("vb-floating-drag-active");
  }

  function endItemDrag(payload: LegacyTaskbarOptions = {}) {
    const drag = activeItemDrag;
    activeItemDrag = null;
    if (!drag) return;
    cleanupItemDragVisuals(drag);

    if (!drag.moved) return;

    suppressedClicks.add(drag.record.id);
    setTimeout(() => suppressedClicks.delete(drag.record.id), 0);

    const point = payload.point || drag.lastPoint;
    if (drag.overTrash || isPointOverTrashTarget(point)) {
      closeWindowFromTaskbarTrash(drag.record);
      render();
      payload.event?.preventDefault?.();
      return;
    }

    if (isPointNearTaskbar(point)) {
      itemPositions.delete(drag.record.id);
    } else {
      itemPositions.set(drag.record.id, {
        detached: true,
        left: drag.currentLeft,
        top: drag.currentTop,
      });
    }
    saveState();
    render();
    payload.event?.preventDefault?.();
  }

  function cancelItemDrag(payload: LegacyTaskbarOptions = {}) {
    if (payload.canceled && activeItemDrag?.moved) {
      endItemDrag(payload);
      return;
    }
    const drag = activeItemDrag;
    activeItemDrag = null;
    cleanupItemDragVisuals(drag);
  }

  function setupItemSensor(item, record) {
    const sensor = createDragSensors({
      source: item,
      canStart: () => ({ record, item }),
      onStart: beginItemDrag,
      onMove: moveItemDrag,
      onEnd: endItemDrag,
      onCancel: cancelItemDrag,
    });
    itemSensors.set(record.id, sensor);
  }

  function destroyItemSensors() {
    for (const sensor of itemSensors.values()) sensor.destroy();
    itemSensors.clear();
  }

  function createTaskbarItem(record, state, docked) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vb-shell-taskbar-item vb-shell-taskbar-fab dock-btn";
    item.setAttribute("data-vb-shell-taskbar-item", record.id);
    item.setAttribute("data-vb-shell-taskbar-state", state);
    item.setAttribute("data-vb-shell-taskbar-active", record.active ? "true" : "false");
    item.setAttribute("data-vb-shell-taskbar-docked", docked ? "true" : "false");
    suppressNativeDrag(item);
    applyAppIconTheme(item, getAppForShellWindowId(record.id));

    const label = labels[record.id] || defaultLabel(record);
    item.setAttribute("aria-label", `${label} ${state}`);
    item.title = label;

    const icon = icons[record.id] || getToolDefinitionForShellWindow(record.id)?.icon || "";
    const iconEl = document.createElement("span");
    iconEl.className = "vb-shell-taskbar-icon";
    iconEl.setAttribute("aria-hidden", "true");
    if (icon) {
      iconEl.innerHTML = icon;
    } else {
      iconEl.textContent = getInitial(label);
    }
    item.append(iconEl);

    const text = document.createElement("span");
    text.className = "vb-shell-taskbar-label";
    text.textContent = label;
    item.append(text);

    item.addEventListener("dragstart", (event) => event.preventDefault());
    item.addEventListener("click", (event) => handleItemClick(record, event));
    setupItemSensor(item, record);
    return item;
  }

  function createFavoriteAppButton(app: VatioAppManifest) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vb-shell-taskbar-favorite-app vb-shell-taskbar-fab dock-btn";
    item.setAttribute("data-vb-shell-taskbar-favorite-app", app.id);
    suppressNativeDrag(item);

    const label = getAppLabel(app);
    const shellWindowId = getAppShellWindowId(app);
    const record = shellWindowId ? shellManager.getWindow(shellWindowId) : null;
    const state = record ? getWindowState(record) : "closed";
    const running = Boolean(record && isVisibleTaskbarState(state));

    item.setAttribute("data-vb-shell-taskbar-state", running ? state : "closed");
    item.setAttribute("data-vb-shell-taskbar-active", running && record?.active ? "true" : "false");
    item.setAttribute("data-vb-shell-taskbar-running", running ? "true" : "false");
    item.setAttribute("aria-label", running ? `${label} ${state}` : label);
    item.title = label;
    applyAppIconTheme(item, app);

    const iconEl = document.createElement("span");
    iconEl.className = "vb-shell-taskbar-icon";
    iconEl.setAttribute("aria-hidden", "true");
    if (app.icon) {
      iconEl.innerHTML = app.icon;
    } else {
      iconEl.textContent = getInitial(label);
    }
    item.append(iconEl);

    const text = document.createElement("span");
    text.className = "vb-shell-taskbar-label";
    text.textContent = label;
    item.append(text);

    item.addEventListener("dragstart", (event) => event.preventDefault());
    item.addEventListener("click", (event) => {
      event.preventDefault();
      if (record && running) {
        handleItemClick(record, event);
      } else {
        appLauncher?.openApp(app.id, { focus: true, source: "taskbar-favorite" });
      }
      startMenu?.close?.();
    });

    return item;
  }

  function renderFavoriteApps() {
    favoritesElement.replaceChildren();
    const favoriteApps = appLauncher ? getFavoriteApps() : [];
    favoritesElement.hidden = favoriteApps.length === 0;
    for (const app of favoriteApps) {
      favoritesElement.append(createFavoriteAppButton(app));
    }
    return favoriteApps;
  }

  function syncAccountState(detail: TaskbarAuthState = {}) {
    const authenticated = detail?.authenticated === true;
    const busy = detail?.busy === true;
    const label = authenticated
      ? (detail?.user ? `Account signed in as ${detail.user}` : "Account signed in")
      : busy
        ? "Account checking session"
        : "Account signed out";

    accountButton.dataset.authState = authenticated ? "authenticated" : "guest";
    accountButton.dataset.authBusy = busy ? "true" : "false";
    accountButton.setAttribute("aria-label", label);
    accountButton.title = label;
  }

  function render() {
    if (destroyed) return;

    destroyItemSensors();
    for (const item of itemElements.values()) item.remove();
    itemElements.clear();
    if (
      startButton.parentElement !== element
      || favoritesElement.parentElement !== element
      || accountButton.parentElement !== element
      || trayElement.parentElement !== element
      || dragHandle.parentElement !== element
    ) {
      element.replaceChildren(startButton, favoritesElement, trayElement, accountButton, dragHandle);
    }
    syncAccountState();
    const favoriteApps = renderFavoriteApps();
    const favoriteWindowIds = new Set(
      favoriteApps.map(getAppShellWindowId).filter(Boolean),
    );
    trayElement.replaceChildren();

    const records = getTaskbarWindows(favoriteWindowIds);
    let dockedCount = 0;
    element.hidden = false;

    for (const record of records) {
      const state = getWindowState(record);
      const position = itemPositions.get(record.id);
      const isDetached = position?.detached === true;
      const item = createTaskbarItem(record, state, !isDetached);
      itemElements.set(record.id, item);

      if (isDetached) {
        getDetachedRoot(root).append(item);
        applyDetachedStyle(item, position);
      } else {
        clearDetachedStyle(item);
        trayElement.append(item);
        dockedCount += 1;
      }
    }

    element.setAttribute("data-vb-shell-taskbar-empty", dockedCount === 0 && favoriteApps.length === 0 ? "true" : "false");
    applyTaskbarPosition();
  }

  function focusWindow(id) {
    const item = itemElements.get(id)
      || Array.from(element.querySelectorAll("[data-vb-shell-taskbar-item]"))
        .find((candidate) => candidate.getAttribute("data-vb-shell-taskbar-item") === id)
      || Array.from(root.querySelectorAll?.("[data-vb-shell-taskbar-item]") || [])
        .find((candidate) => candidate.getAttribute("data-vb-shell-taskbar-item") === id);
    item?.focus?.();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    taskbarSensor?.destroy();
    window.removeEventListener("resize", scheduleViewportClamp);
    window.removeEventListener("orientationchange", scheduleViewportClamp);
    globalThis.visualViewport?.removeEventListener?.("resize", scheduleViewportClamp);
    globalThis.visualViewport?.removeEventListener?.("scroll", scheduleViewportClamp);
    destroyItemSensors();
    endTaskbarDrag();
    cancelItemDrag();
    unsubscribe?.();
    preferenceUnsubscribe?.();
    appControlUnsubscribe?.();
    if (authStateListener) {
      window.removeEventListener(BACKEND_AUTH_STATE_EVENT, authStateListener);
    }
    for (const item of itemElements.values()) item.remove();
    itemElements.clear();
    hideTrashTarget();
    dragLayerElement?.remove();
    dragLayerElement = null;
    clearTaskbarBottomAvoidance();
    element.remove();
  }

  taskbarSensor = createDragSensors({
    source: dragHandle,
    canStart: canStartTaskbarDrag,
    onStart: beginTaskbarDrag,
    onMove: moveTaskbarDrag,
    onEnd: endTaskbarDrag,
    onCancel: endTaskbarDrag,
    preventDefaultOnStart: true,
  });

  root.appendChild(element);
  window.addEventListener("resize", scheduleViewportClamp);
  window.addEventListener("orientationchange", scheduleViewportClamp);
  globalThis.visualViewport?.addEventListener?.("resize", scheduleViewportClamp);
  globalThis.visualViewport?.addEventListener?.("scroll", scheduleViewportClamp);
  unsubscribe = shellManager.subscribe(({ event, record }) => {
    if (record && ["opened", "restored", "minimized"].includes(event)) {
      rememberWindow(record.id);
    } else if (record && ["closed", "unregistered"].includes(event)) {
      forgetWindow(record.id);
    }
    render();
  });
  preferenceUnsubscribe = shellManager.subscribeShellPreferences?.((preferences) => {
    element.setAttribute("data-vb-shell-taskbar-position", preferences.taskbarPosition);
    clampFloatingSurfaces();
  });
  appControlUnsubscribe = appControl.subscribe?.(() => {
    render();
  });
  authStateListener = (event: Event) => {
    syncAccountState((event as CustomEvent).detail || undefined);
  };
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, authStateListener);
  accountButton.addEventListener("click", (event) => {
    event.preventDefault();
    accountPanel?.open?.({ focus: true, source: "taskbar-account" });
    startMenu?.close?.();
  });
  render();

  return {
    destroy,
    render,
    focusWindow,
    getElement: () => element,
    getStartButton: () => startButton,
    getAccountButton: () => accountButton,
  };
}
