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

function readTaskbarState(storage) {
  if (!storage) return { knownWindowIds: [], positions: {} };
  try {
    const parsed = JSON.parse(storage.getItem(TASKBAR_STATE_KEY) || "{}");
    const knownWindowIds = Array.isArray(parsed.knownWindowIds)
      ? parsed.knownWindowIds.filter((id) => typeof id === "string" && id)
      : [];
    const positions = {};
    if (parsed.positions && typeof parsed.positions === "object") {
      for (const [id, value] of Object.entries(parsed.positions)) {
        const left = Number.parseFloat(String(value?.left));
        const top = Number.parseFloat(String(value?.top));
        if (typeof id === "string" && value?.detached === true && Number.isFinite(left) && Number.isFinite(top)) {
          positions[id] = { detached: true, left, top };
        }
      }
    }
    return { knownWindowIds, positions };
  } catch {
    try {
      storage.removeItem(TASKBAR_STATE_KEY);
    } catch {
      // best effort only
    }
    return { knownWindowIds: [], positions: {} };
  }
}

function writeTaskbarState(storage, knownWindowIds, itemPositions) {
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
    writeTaskbarState(storageTarget, knownWindowIds, itemPositions);
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
