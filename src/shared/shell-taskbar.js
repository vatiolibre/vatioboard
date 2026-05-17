import { IconCalculator, IconCameraMap, IconEnergy, IconMedia, IconMusic, IconSpeed } from "../icons.js";

const TASKBAR_STATE_KEY = "vatioboard.shell.taskbar_fabs.v1";
const DRAG_THRESHOLD_PX = 6;
const RETURN_MARGIN_PX = 36;
const FAB_SIZE_PX = 52;
const VIEWPORT_MARGIN_PX = 8;

const DEFAULT_ICONS = {
  calculator: IconCalculator,
  "camera-map": IconCameraMap,
  energy: IconEnergy,
  milkdrop: IconMedia,
  player: IconMusic,
  "speed-alerts": IconSpeed,
};

const TOUCH_MOVE_OPTIONS = { capture: true, passive: false };
const CAPTURE_OPTIONS = { capture: true };

function getWindowState(record) {
  if (record.minimized || record.state === "minimized") return "minimized";
  if (record.state === "open" && !record.element?.hidden) return "open";
  return record.state || "closed";
}

function defaultLabel(record) {
  return record.title || record.id;
}

function getStorage(storage) {
  if (storage === null) return null;
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeStoredPosition(value, { requireDetached = true } = {}) {
  const left = Number.parseFloat(String(value?.left));
  const top = Number.parseFloat(String(value?.top));
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  if (requireDetached && value?.detached !== true) return null;
  return { detached: true, left, top };
}

function readTaskbarState(storage) {
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

function writeTaskbarState(storage, knownWindowIds, itemPositions, taskbarPosition) {
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

function getInitial(label) {
  return String(label || "?").trim().charAt(0).toUpperCase() || "?";
}

function getDetachedRoot(root) {
  return root?.appendChild ? root : document.body;
}

function getViewportSize() {
  return {
    width: globalThis.innerWidth || document.documentElement?.clientWidth || 1024,
    height: globalThis.innerHeight || document.documentElement?.clientHeight || 768,
  };
}

function clampPositionToViewport(position, width, height) {
  const viewport = getViewportSize();
  return {
    left: Math.min(
      Math.max(VIEWPORT_MARGIN_PX, position.left),
      Math.max(VIEWPORT_MARGIN_PX, viewport.width - width - VIEWPORT_MARGIN_PX)
    ),
    top: Math.min(
      Math.max(VIEWPORT_MARGIN_PX, position.top),
      Math.max(VIEWPORT_MARGIN_PX, viewport.height - height - VIEWPORT_MARGIN_PX)
    ),
  };
}

function clampElementPosition(position, element, fallbackWidth = FAB_SIZE_PX, fallbackHeight = FAB_SIZE_PX) {
  const rect = element?.getBoundingClientRect?.() || {};
  const width = rect.width || element?.offsetWidth || fallbackWidth;
  const height = rect.height || element?.offsetHeight || fallbackHeight;
  return clampPositionToViewport(position, width, height);
}

function applyDetachedStyle(item, position) {
  item.classList.add("is-detached");
  item.style.position = "fixed";
  item.style.left = `${Math.round(position.left)}px`;
  item.style.top = `${Math.round(position.top)}px`;
  item.style.right = "auto";
  item.style.bottom = "auto";
}

function clearDetachedStyle(item) {
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

function suppressNativeDrag(element) {
  element.draggable = false;
  element.setAttribute("draggable", "false");
  element.ondragstart = () => false;
}

function makePoint(clientX, clientY) {
  return { clientX, clientY, x: clientX, y: clientY };
}

function pointFromPointerEvent(event, fallback = null) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return makePoint(x, y);
}

function pointFromTouch(touch, fallback = null) {
  if (!touch) return fallback;
  const x = Number(touch.clientX);
  const y = Number(touch.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return makePoint(x, y);
}

function findTouch(event, identifier) {
  const touches = [
    ...Array.from(event?.changedTouches || []),
    ...Array.from(event?.touches || []),
  ];
  return touches.find((touch) => touch.identifier === identifier) || null;
}

function distanceBetween(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function buildDragPayload(sensor, point, event, type) {
  const dx = point.clientX - sensor.startPoint.clientX;
  const dy = point.clientY - sensor.startPoint.clientY;
  const movementX = point.clientX - sensor.lastPoint.clientX;
  const movementY = point.clientY - sensor.lastPoint.clientY;
  return {
    type,
    event,
    context: sensor.context,
    pointerType: sensor.pointerType,
    startX: sensor.startPoint.clientX,
    startY: sensor.startPoint.clientY,
    clientX: point.clientX,
    clientY: point.clientY,
    dx,
    dy,
    movementX,
    movementY,
    point,
  };
}

function createTouchDragSensor({
  source,
  canStart,
  onStart,
  onMove,
  onEnd,
  onCancel,
  preventDefaultOnStart = false,
}) {
  let active = null;

  function cleanup() {
    document.removeEventListener("touchmove", handleMove, TOUCH_MOVE_OPTIONS);
    document.removeEventListener("touchend", handleEnd, TOUCH_MOVE_OPTIONS);
    document.removeEventListener("touchcancel", handleCancel, TOUCH_MOVE_OPTIONS);
    window.removeEventListener("blur", handleHardCancel, CAPTURE_OPTIONS);
    document.removeEventListener("visibilitychange", handleVisibilityChange, CAPTURE_OPTIONS);
    active = null;
  }

  function finish(event, canceled = false) {
    const sensor = active;
    if (!sensor) return;
    cleanup();
    if (!sensor.started) {
      onCancel?.({ context: sensor.context, event, pointerType: sensor.pointerType });
      return;
    }
    const payload = buildDragPayload(sensor, sensor.lastPoint, event, canceled ? "cancel" : "end");
    if (canceled) {
      onEnd?.({ ...payload, canceled: true });
    } else {
      onEnd?.(payload);
    }
  }

  function handleStart(event) {
    if (active || event.touches?.length > 1) return;
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    const point = pointFromTouch(touch);
    if (!touch || !point) return;
    const context = canStart?.(event, point);
    if (!context) return;

    active = {
      context,
      identifier: touch.identifier,
      pointerType: "touch",
      startPoint: point,
      lastPoint: point,
      started: false,
    };

    document.addEventListener("touchmove", handleMove, TOUCH_MOVE_OPTIONS);
    document.addEventListener("touchend", handleEnd, TOUCH_MOVE_OPTIONS);
    document.addEventListener("touchcancel", handleCancel, TOUCH_MOVE_OPTIONS);
    window.addEventListener("blur", handleHardCancel, CAPTURE_OPTIONS);
    document.addEventListener("visibilitychange", handleVisibilityChange, CAPTURE_OPTIONS);
    if (preventDefaultOnStart) event.preventDefault?.();
  }

  function handleMove(event) {
    const sensor = active;
    if (!sensor) return;
    const touch = findTouch(event, sensor.identifier);
    const point = pointFromTouch(touch, sensor.lastPoint);
    if (!point) return;
    event.preventDefault?.();

    if (!sensor.started) {
      if (distanceBetween(sensor.startPoint, point) < DRAG_THRESHOLD_PX) {
        sensor.lastPoint = point;
        return;
      }
      sensor.started = true;
      onStart?.(buildDragPayload(sensor, point, event, "start"));
    }

    onMove?.(buildDragPayload(sensor, point, event, "move"));
    sensor.lastPoint = point;
  }

  function handleEnd(event) {
    const sensor = active;
    if (!sensor) return;
    const touch = findTouch(event, sensor.identifier);
    const point = pointFromTouch(touch, sensor.lastPoint);
    sensor.lastPoint = point;
    if (sensor.started) event.preventDefault?.();
    finish(event, false);
  }

  function handleCancel(event) {
    const sensor = active;
    if (!sensor) return;
    const touch = findTouch(event, sensor.identifier);
    sensor.lastPoint = pointFromTouch(touch, sensor.lastPoint);
    if (sensor.started) event.preventDefault?.();
    finish(event, true);
  }

  function handleHardCancel(event) {
    finish(event, true);
  }

  function handleVisibilityChange(event) {
    if (document.visibilityState === "hidden") finish(event, true);
  }

  source.addEventListener("touchstart", handleStart, { passive: false });
  return {
    destroy() {
      cleanup();
      source.removeEventListener("touchstart", handleStart, { passive: false });
    },
    cancel: cleanup,
  };
}

function createPointerDragSensor({
  source,
  canStart,
  onStart,
  onMove,
  onEnd,
  onCancel,
}) {
  let active = null;

  function cleanup() {
    window.removeEventListener("pointermove", handleMove, TOUCH_MOVE_OPTIONS);
    window.removeEventListener("pointerup", handleEnd, CAPTURE_OPTIONS);
    window.removeEventListener("pointercancel", handleCancel, CAPTURE_OPTIONS);
    source.removeEventListener("lostpointercapture", handleCancel, CAPTURE_OPTIONS);
    active = null;
  }

  function finish(event, canceled = false) {
    const sensor = active;
    if (!sensor) return;
    cleanup();
    if (!sensor.started) {
      onCancel?.({ context: sensor.context, event, pointerType: sensor.pointerType });
      return;
    }
    const point = pointFromPointerEvent(event, sensor.lastPoint);
    sensor.lastPoint = point;
    const payload = buildDragPayload(sensor, point, event, canceled ? "cancel" : "end");
    if (canceled) {
      onCancel?.({ ...payload, canceled: true });
    } else {
      onEnd?.(payload);
    }
  }

  function handleStart(event) {
    if (active || event.pointerType === "touch") return;
    if (event.button !== undefined && event.button !== 0) return;
    const point = pointFromPointerEvent(event);
    if (!point) return;
    const context = canStart?.(event, point);
    if (!context) return;

    active = {
      context,
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      startPoint: point,
      lastPoint: point,
      started: false,
    };

    window.addEventListener("pointermove", handleMove, TOUCH_MOVE_OPTIONS);
    window.addEventListener("pointerup", handleEnd, CAPTURE_OPTIONS);
    window.addEventListener("pointercancel", handleCancel, CAPTURE_OPTIONS);
    source.addEventListener("lostpointercapture", handleCancel, CAPTURE_OPTIONS);
    try {
      source.setPointerCapture?.(event.pointerId);
    } catch {
      // best effort for mouse/pen only
    }
  }

  function handleMove(event) {
    const sensor = active;
    if (!sensor) return;
    if (sensor.pointerId != null && event.pointerId != null && event.pointerId !== sensor.pointerId) return;
    const point = pointFromPointerEvent(event, sensor.lastPoint);
    if (!point) return;

    if (!sensor.started) {
      if (distanceBetween(sensor.startPoint, point) < DRAG_THRESHOLD_PX) {
        sensor.lastPoint = point;
        return;
      }
      sensor.started = true;
      onStart?.(buildDragPayload(sensor, point, event, "start"));
    }

    onMove?.(buildDragPayload(sensor, point, event, "move"));
    sensor.lastPoint = point;
    event.preventDefault?.();
  }

  function handleEnd(event) {
    const sensor = active;
    if (!sensor) return;
    if (sensor.pointerId != null && event.pointerId != null && event.pointerId !== sensor.pointerId) return;
    try {
      source.releasePointerCapture?.(sensor.pointerId);
    } catch {
      // ignore
    }
    finish(event, false);
  }

  function handleCancel(event) {
    const sensor = active;
    if (!sensor) return;
    if (sensor.pointerId != null && event.pointerId != null && event.pointerId !== sensor.pointerId) return;
    try {
      source.releasePointerCapture?.(sensor.pointerId);
    } catch {
      // ignore
    }
    finish(event, true);
  }

  source.addEventListener("pointerdown", handleStart);
  return {
    destroy() {
      cleanup();
      source.removeEventListener("pointerdown", handleStart);
    },
    cancel: cleanup,
  };
}

function createDragSensors(options) {
  const touchSensor = createTouchDragSensor(options);
  const pointerSensor = createPointerDragSensor(options);
  return {
    destroy() {
      touchSensor.destroy();
      pointerSensor.destroy();
    },
    cancel() {
      touchSensor.cancel();
      pointerSensor.cancel();
    },
  };
}

export function createShellTaskbar({
  shellManager,
  root = document.body,
  labels = {},
  icons = {},
  storage,
} = {}) {
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

  const dragHandle = document.createElement("div");
  dragHandle.className = "vb-shell-taskbar-drag-handle";
  dragHandle.setAttribute("data-vb-shell-taskbar-drag-handle", "");
  dragHandle.setAttribute("aria-hidden", "true");
  suppressNativeDrag(dragHandle);

  const trayElement = document.createElement("div");
  trayElement.className = "vb-shell-taskbar-tray";
  trayElement.setAttribute("data-vb-shell-taskbar-tray", "");
  element.append(dragHandle, trayElement);

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

  function applyTaskbarPosition() {
    if (taskbarPosition?.detached === true) {
      const position = clampElementPosition(taskbarPosition, element, 64, 64);
      taskbarPosition = { detached: true, ...position };
      setTaskbarFixedPosition(position);
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

  function rememberWindow(id) {
    if (!id || knownWindowIds.has(id)) return;
    knownWindowIds.add(id);
    saveState();
  }

  function closeWindowFromTaskbarTrash(record) {
    const id = record?.id;
    if (!id) return;
    knownWindowIds.delete(id);
    itemPositions.delete(id);
    saveState();
    shellManager.closeWindow?.(id, {
      taskbarTrash: true,
      ...(id === "player" ? { stopPlayback: true } : {}),
    });
  }

  function getTaskbarWindows() {
    const records = shellManager.listWindows()
      .filter((record) => record.kind !== "system")
      .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));

    for (const record of records) {
      const state = getWindowState(record);
      if (state === "open" || state === "minimized") rememberWindow(record.id);
    }

    return records.filter((record) => knownWindowIds.has(record.id));
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

    const position = element.getAttribute("data-vb-shell-taskbar-position") || "bottom";
    const viewport = getViewportSize();
    const edgeDistance = RETURN_MARGIN_PX + FAB_SIZE_PX;
    if (position === "left") return point.clientX <= edgeDistance;
    if (position === "right") return point.clientX >= viewport.width - edgeDistance;
    return point.clientY >= viewport.height - edgeDistance;
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

  function endTaskbarDrag(payload = {}) {
    const drag = activeTaskbarDrag;
    activeTaskbarDrag = null;
    if (!drag) return;
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = 0;
    }
    setTaskbarFixedPosition({ left: drag.nextLeft, top: drag.nextTop });
    clampTaskbarToViewport(drag.width, drag.height);
    element.classList.remove("is-dragging");
    document.documentElement.classList.remove("vb-floating-drag-active");
    element.style.willChange = "";
    saveState();
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

  function endItemDrag(payload = {}) {
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

  function cancelItemDrag(payload = {}) {
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

    const label = labels[record.id] || defaultLabel(record);
    item.setAttribute("aria-label", `${label} ${state}`);
    item.title = label;

    const icon = icons[record.id] || DEFAULT_ICONS[record.id];
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

  function render() {
    if (destroyed) return;

    destroyItemSensors();
    for (const item of itemElements.values()) item.remove();
    itemElements.clear();
    if (dragHandle.parentElement !== element || trayElement.parentElement !== element) {
      element.replaceChildren(dragHandle, trayElement);
    }
    trayElement.replaceChildren();

    const records = getTaskbarWindows();
    let dockedCount = 0;
    element.hidden = records.length === 0;

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

    element.setAttribute("data-vb-shell-taskbar-empty", dockedCount === 0 ? "true" : "false");
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
    destroyItemSensors();
    endTaskbarDrag();
    cancelItemDrag();
    unsubscribe?.();
    preferenceUnsubscribe?.();
    for (const item of itemElements.values()) item.remove();
    itemElements.clear();
    hideTrashTarget();
    dragLayerElement?.remove();
    dragLayerElement = null;
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
  unsubscribe = shellManager.subscribe(({ event, record }) => {
    if (record && ["opened", "restored", "minimized"].includes(event)) {
      rememberWindow(record.id);
    }
    render();
  });
  preferenceUnsubscribe = shellManager.subscribeShellPreferences?.((preferences) => {
    element.setAttribute("data-vb-shell-taskbar-position", preferences.taskbarPosition);
  });
  render();

  return {
    destroy,
    render,
    focusWindow,
    getElement: () => element,
  };
}
