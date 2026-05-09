import { IconCalculator, IconEnergy, IconMedia, IconMusic } from "../icons.js";

const TASKBAR_STATE_KEY = "vatioboard.shell.taskbar_fabs.v1";
const DRAG_THRESHOLD_PX = 6;
const RETURN_MARGIN_PX = 36;
const FAB_SIZE_PX = 52;
const VIEWPORT_MARGIN_PX = 8;

const DEFAULT_ICONS = {
  calculator: IconCalculator,
  energy: IconEnergy,
  milkdrop: IconMedia,
  player: IconMusic,
};

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

function clampFabPosition(position, item) {
  const width = item?.offsetWidth || FAB_SIZE_PX;
  const height = item?.offsetHeight || FAB_SIZE_PX;
  const viewportWidth = globalThis.innerWidth || document.documentElement?.clientWidth || 1024;
  const viewportHeight = globalThis.innerHeight || document.documentElement?.clientHeight || 768;
  const maxLeft = Math.max(VIEWPORT_MARGIN_PX, viewportWidth - width - VIEWPORT_MARGIN_PX);
  const maxTop = Math.max(VIEWPORT_MARGIN_PX, viewportHeight - height - VIEWPORT_MARGIN_PX);
  return {
    left: Math.min(Math.max(VIEWPORT_MARGIN_PX, position.left), maxLeft),
    top: Math.min(Math.max(VIEWPORT_MARGIN_PX, position.top), maxTop),
  };
}

function clampElementPosition(position, element, fallbackWidth = FAB_SIZE_PX, fallbackHeight = FAB_SIZE_PX) {
  const rect = element?.getBoundingClientRect?.() || {};
  const width = rect.width || element?.offsetWidth || fallbackWidth;
  const height = rect.height || element?.offsetHeight || fallbackHeight;
  const viewportWidth = globalThis.innerWidth || document.documentElement?.clientWidth || 1024;
  const viewportHeight = globalThis.innerHeight || document.documentElement?.clientHeight || 768;
  return {
    left: Math.min(
      Math.max(VIEWPORT_MARGIN_PX, position.left),
      Math.max(VIEWPORT_MARGIN_PX, viewportWidth - width - VIEWPORT_MARGIN_PX)
    ),
    top: Math.min(
      Math.max(VIEWPORT_MARGIN_PX, position.top),
      Math.max(VIEWPORT_MARGIN_PX, viewportHeight - height - VIEWPORT_MARGIN_PX)
    ),
  };
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
  item.classList.remove("is-detached", "is-dragging");
  item.style.position = "";
  item.style.left = "";
  item.style.top = "";
  item.style.right = "";
  item.style.bottom = "";
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
  const suppressedClicks = new Set();

  const element = document.createElement("nav");
  element.className = "vb-shell-taskbar";
  element.setAttribute("data-vb-shell-taskbar", "");
  element.setAttribute("aria-label", labels.taskbar || "Shell windows");

  let unsubscribe = null;
  let preferenceUnsubscribe = null;
  let destroyed = false;
  let dragCleanup = null;

  function saveState() {
    writeTaskbarState(storageTarget, knownWindowIds, itemPositions, taskbarPosition);
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
    setTaskbarFixedPosition({ left, top }, { transform: "none", dragging: false });
    return { rect, left, top };
  }

  function clampTaskbarToViewport(width = 64, height = 64) {
    const viewportWidth = globalThis.innerWidth || document.documentElement?.clientWidth || 1024;
    const viewportHeight = globalThis.innerHeight || document.documentElement?.clientHeight || 768;
    const currentLeft = parseFloat(element.style.left) || 0;
    const currentTop = parseFloat(element.style.top) || 0;
    const nextLeft = Math.min(
      Math.max(VIEWPORT_MARGIN_PX, currentLeft),
      Math.max(VIEWPORT_MARGIN_PX, viewportWidth - width - VIEWPORT_MARGIN_PX)
    );
    const nextTop = Math.min(
      Math.max(VIEWPORT_MARGIN_PX, currentTop),
      Math.max(VIEWPORT_MARGIN_PX, viewportHeight - height - VIEWPORT_MARGIN_PX)
    );
    setTaskbarFixedPosition({ left: nextLeft, top: nextTop });
    taskbarPosition = { detached: true, left: nextLeft, top: nextTop };
  }

  function rememberWindow(id) {
    if (!id || knownWindowIds.has(id)) return;
    knownWindowIds.add(id);
    saveState();
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

  function isPointerNearTaskbar(event) {
    const rect = element.getBoundingClientRect();
    const width = rect.width || rect.right - rect.left;
    const height = rect.height || rect.bottom - rect.top;
    if (width || height) {
      const isNearMeasuredRect = event.clientX >= rect.left - RETURN_MARGIN_PX
        && event.clientX <= rect.right + RETURN_MARGIN_PX
        && event.clientY >= rect.top - RETURN_MARGIN_PX
        && event.clientY <= rect.bottom + RETURN_MARGIN_PX;
      if (isNearMeasuredRect) return true;
    }

    const position = element.getAttribute("data-vb-shell-taskbar-position") || "bottom";
    const viewportWidth = globalThis.innerWidth || document.documentElement?.clientWidth || 1024;
    const viewportHeight = globalThis.innerHeight || document.documentElement?.clientHeight || 768;
    const edgeDistance = RETURN_MARGIN_PX + FAB_SIZE_PX;
    if (position === "left") return event.clientX <= edgeDistance;
    if (position === "right") return event.clientX >= viewportWidth - edgeDistance;
    return event.clientY >= viewportHeight - edgeDistance;
  }

  function detachItemForDrag(record, item, startLeft, startTop) {
    if (item.parentElement !== getDetachedRoot(root)) {
      getDetachedRoot(root).append(item);
    }
    const position = clampFabPosition({ left: startLeft, top: startTop }, item);
    item.setAttribute("data-vb-shell-taskbar-docked", "false");
    itemPositions.set(record.id, { detached: true, ...position });
    applyDetachedStyle(item, position);
  }

  function beginItemDrag(event, record, item) {
    if (event.button !== undefined && event.button !== 0) return;
    if (dragCleanup) dragCleanup();

    const saved = itemPositions.get(record.id);
    const rect = item.getBoundingClientRect();
    const startLeft = saved?.detached ? saved.left : rect.left;
    const startTop = saved?.detached ? saved.top : rect.top;
    const drag = {
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      startLeft,
      startTop,
      lastLeft: startLeft,
      lastTop: startTop,
    };

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      drag.moved = true;
      item.classList.add("is-dragging");
      detachItemForDrag(record, item, drag.startLeft, drag.startTop);
      const position = clampFabPosition({
        left: drag.startLeft + dx,
        top: drag.startTop + dy,
      }, item);
      drag.lastLeft = position.left;
      drag.lastTop = position.top;
      itemPositions.set(record.id, { detached: true, ...position });
      applyDetachedStyle(item, position);
      moveEvent.preventDefault?.();
    };

    const onEnd = (endEvent) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      dragCleanup = null;

      if (!drag.moved) return;

      suppressedClicks.add(record.id);
      setTimeout(() => suppressedClicks.delete(record.id), 0);

      if (isPointerNearTaskbar(endEvent)) {
        itemPositions.delete(record.id);
      } else {
        itemPositions.set(record.id, {
          detached: true,
          left: drag.lastLeft,
          top: drag.lastTop,
        });
      }
      saveState();
      render();
      endEvent.preventDefault?.();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onEnd, true);
    dragCleanup = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
    };

    item.setPointerCapture?.(event.pointerId);
  }

  function beginTaskbarDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target?.closest?.("[data-vb-shell-taskbar-item]")) return;
    if (element.hidden) return;
    if (dragCleanup) dragCleanup();

    let pointerDown = true;
    let dragging = false;
    let rafId = 0;
    let boxW = 64;
    let boxH = 64;
    const drag = {
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      originLeft: 0,
      originTop: 0,
      nextLeft: 0,
      nextTop: 0,
    };

    const startDragNow = () => {
      if (dragging) return;

      const { rect, left, top } = ensureTaskbarFixedTopLeft();
      boxW = rect.width || element.offsetWidth || 64;
      boxH = rect.height || element.offsetHeight || 64;
      drag.originLeft = parseFloat(element.style.left) || left;
      drag.originTop = parseFloat(element.style.top) || top;
      drag.nextLeft = drag.originLeft;
      drag.nextTop = drag.originTop;
      dragging = true;
      element.classList.add("is-dragging");
      document.documentElement.classList.add("vb-floating-drag-active");
      element.style.willChange = "transform";
    };

    const applyMove = () => {
      rafId = 0;
      if (!pointerDown || !dragging) return;
      const tx = Math.round(drag.nextLeft - drag.originLeft);
      const ty = Math.round(drag.nextTop - drag.originTop);
      element.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    };

    const scheduleMove = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(applyMove);
    };

    const updateNextPosition = () => {
      const dx = drag.lastX - drag.startX;
      const dy = drag.lastY - drag.startY;
      const viewportWidth = globalThis.innerWidth || document.documentElement?.clientWidth || 1024;
      const viewportHeight = globalThis.innerHeight || document.documentElement?.clientHeight || 768;
      drag.nextLeft = Math.min(
        Math.max(VIEWPORT_MARGIN_PX, drag.originLeft + dx),
        Math.max(VIEWPORT_MARGIN_PX, viewportWidth - boxW - VIEWPORT_MARGIN_PX)
      );
      drag.nextTop = Math.min(
        Math.max(VIEWPORT_MARGIN_PX, drag.originTop + dy),
        Math.max(VIEWPORT_MARGIN_PX, viewportHeight - boxH - VIEWPORT_MARGIN_PX)
      );
    };

    const finishDrag = (endEvent = null) => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }

      if (!pointerDown) return;
      pointerDown = false;
      dragCleanup = null;

      if (dragging) {
        updateNextPosition();
        setTaskbarFixedPosition({ left: drag.nextLeft, top: drag.nextTop });
        element.classList.remove("is-dragging");
        document.documentElement.classList.remove("vb-floating-drag-active");
        element.style.willChange = "";
        clampTaskbarToViewport(boxW, boxH);
        saveState();
        endEvent?.preventDefault?.();
      }
    };

    const onMove = (moveEvent) => {
      if (!pointerDown) return;

      drag.lastX = moveEvent.clientX;
      drag.lastY = moveEvent.clientY;

      if (!dragging) {
        const dx = Math.abs(drag.lastX - drag.startX);
        const dy = Math.abs(drag.lastY - drag.startY);
        if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
          startDragNow();
        } else {
          return;
        }
      }

      drag.moved = true;
      updateNextPosition();
      if (moveEvent.pointerType !== "mouse") moveEvent.preventDefault();
      scheduleMove();
    };

    const onEnd = (endEvent) => {
      finishDrag(endEvent);
      element.removeEventListener("pointermove", onMove, { passive: false });
      element.removeEventListener("pointerup", onEnd);
      element.removeEventListener("pointercancel", onEnd);
    };

    element.addEventListener("pointermove", onMove, { passive: false });
    element.addEventListener("pointerup", onEnd);
    element.addEventListener("pointercancel", onEnd);
    dragCleanup = () => {
      finishDrag();
      element.removeEventListener("pointermove", onMove, { passive: false });
      element.removeEventListener("pointerup", onEnd);
      element.removeEventListener("pointercancel", onEnd);
    };

    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }

    if (event.pointerType === "mouse") startDragNow();
  }

  function createTaskbarItem(record, state, docked) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vb-shell-taskbar-item vb-shell-taskbar-fab dock-btn";
    item.setAttribute("data-vb-shell-taskbar-item", record.id);
    item.setAttribute("data-vb-shell-taskbar-state", state);
    item.setAttribute("data-vb-shell-taskbar-active", record.active ? "true" : "false");
    item.setAttribute("data-vb-shell-taskbar-docked", docked ? "true" : "false");

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

    item.addEventListener("pointerdown", (event) => beginItemDrag(event, record, item));
    item.addEventListener("click", (event) => handleItemClick(record, event));
    return item;
  }

  function render() {
    if (destroyed) return;

    for (const item of itemElements.values()) item.remove();
    itemElements.clear();
    element.replaceChildren();

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
        element.append(item);
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
    dragCleanup?.();
    unsubscribe?.();
    preferenceUnsubscribe?.();
    for (const item of itemElements.values()) item.remove();
    itemElements.clear();
    element.remove();
  }

  root.appendChild(element);
  element.addEventListener("pointerdown", beginTaskbarDrag);
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
