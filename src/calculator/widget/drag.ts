import {
  applySnapPreview,
  clearSnapPreview,
  getSnapZoneForPointer,
} from "../../shared/shell-snap.js";
import { clampBoundsToWorkArea, getShellWorkArea } from "../../shared/shell-work-area.js";
import type { ShellBounds, ShellRuntime, ShellSnapZone } from "../../types/shell";

type DragPosition = {
  panel?: {
    left?: string;
    top?: string;
  } | null;
  launcher?: {
    left?: string;
    top?: string;
  } | null;
};

type ClampOptions = {
  useShellWorkArea?: boolean;
  preferVisibleBottom?: boolean;
  visibleBottomInset?: number;
  root?: Document | Element | null;
};

type DragPointer = {
  x: number;
  y: number;
  pointerId: number | null;
};

type DragCallbackPayload = {
  element: HTMLElement;
  pointer: DragPointer;
  bounds: ShellBounds;
  snapZone?: ShellSnapZone | null;
};

type DragCallback = (payload: DragCallbackPayload) => void;

type DraggablePanelOptions = {
  panel: HTMLElement;
  header: HTMLElement | Array<HTMLElement | null | undefined>;
  dragThresholdPx: number;
  savePos: (position: DragPosition) => void;
  loadPos: () => DragPosition | null;
  canStart?: ((event: PointerEvent) => boolean) | null;
  onDragStart?: DragCallback | null;
  onDragMove?: DragCallback | null;
  onDragEnd?: DragCallback | null;
  shellWindowId?: string | null;
  shellManager?: ShellRuntime | null;
  enableSnapPreview?: boolean;
};

type LauncherMovedChecker = (() => boolean) & {
  destroy?: () => void;
};

type DraggableLauncherOptions = {
  launcherEl: HTMLElement;
  dragThresholdPx: number;
  savePos: (position: DragPosition) => void;
  loadPos: () => DragPosition | null;
  manageResize?: boolean;
  onDragEnd?: (() => void) | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function firstPositiveNumber(...values: Array<number | undefined>): number {
  return values.find((value) => Number.isFinite(value) && value > 0) ?? 0;
}

function getElementBoxSize(elm: HTMLElement, rect = elm.getBoundingClientRect()) {
  const style = typeof getComputedStyle === "function" ? getComputedStyle(elm) : null;
  return {
    width: firstPositiveNumber(rect.width, elm.offsetWidth, parseFloat(style?.width)),
    height: firstPositiveNumber(rect.height, elm.offsetHeight, parseFloat(style?.height)),
  };
}

function getElementMinimumSize(elm: HTMLElement) {
  const style = typeof getComputedStyle === "function" ? getComputedStyle(elm) : null;
  return {
    width: firstPositiveNumber(parseFloat(elm.style.minWidth), parseFloat(style?.minWidth)),
    height: firstPositiveNumber(parseFloat(elm.style.minHeight), parseFloat(style?.minHeight)),
  };
}

function getElementVisibleBottomInset(elm: HTMLElement) {
  const style = typeof getComputedStyle === "function" ? getComputedStyle(elm) : null;
  return firstPositiveNumber(
    parseFloat(elm.style.getPropertyValue("--vb-shell-visible-bottom-inset")),
    parseFloat(style?.getPropertyValue("--vb-shell-visible-bottom-inset")),
  );
}

function ensureFixedTopLeft(elm: HTMLElement): void {
  // Convert an element to fixed top/left positioning (from right/bottom)
  const r = elm.getBoundingClientRect();
  const left = elm.style.left ? parseFloat(elm.style.left) : r.left;
  const top = elm.style.top ? parseFloat(elm.style.top) : r.top;

  elm.style.position = "fixed";
  elm.style.left = `${left}px`;
  elm.style.top = `${top}px`;
  elm.style.right = "auto";
  elm.style.bottom = "auto";
}

function shouldUseShellWorkArea(elm: HTMLElement, options: ClampOptions = {}): boolean {
  return options.useShellWorkArea === true || Boolean(elm?.hasAttribute?.("data-vb-shell-window"));
}

export function clampElementToViewport(elm: HTMLElement, margin = 8, options: ClampOptions = {}): void {
  // Assumes fixed position with left/top set (or at least measurable via rect)
  const r = elm.getBoundingClientRect();
  const box = getElementBoxSize(elm, r);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  ensureFixedTopLeft(elm);

  const curLeft = parseFloat(elm.style.left) || r.left;
  const curTop = parseFloat(elm.style.top) || r.top;

  if (shouldUseShellWorkArea(elm, options)) {
    const minSize = getElementMinimumSize(elm);
    const effectiveMinWidth = Math.max(minSize.width || 0, box.width || 0);
    const effectiveMinHeight = Math.max(minSize.height || 0, box.height || 0);
    const visibleBottomInset = options.visibleBottomInset ?? getElementVisibleBottomInset(elm);
    const next = clampBoundsToWorkArea({
      left: curLeft,
      top: curTop,
      width: box.width,
      height: box.height,
    }, {
      root: options.root,
      safeMargin: margin,
      forceSize: true,
      minWidth: effectiveMinWidth || undefined,
      minHeight: effectiveMinHeight || undefined,
      preferVisibleBottom: options.preferVisibleBottom === true,
      visibleBottomInset,
    });
    elm.style.left = `${next.left}px`;
    elm.style.top = `${next.top}px`;
    if (next.width) elm.style.width = `${next.width}px`;
    if (next.height) elm.style.height = `${next.height}px`;
    return;
  }

  const nextLeft = clamp(curLeft, margin, vw - box.width - margin);
  const nextTop = clamp(curTop, margin, vh - box.height - margin);

  elm.style.left = `${nextLeft}px`;
  elm.style.top = `${nextTop}px`;
}

function getDragBounds(panel: HTMLElement): ShellBounds {
  const rect = panel.getBoundingClientRect();
  return {
    left: parseFloat(panel.style.left) || rect.left || 0,
    top: parseFloat(panel.style.top) || rect.top || 0,
    width: rect.width || panel.offsetWidth || parseFloat(getComputedStyle(panel).width) || 0,
    height: rect.height || panel.offsetHeight || parseFloat(getComputedStyle(panel).height) || 0,
  };
}

export function makePanelDraggable({
  panel,
  header,
  dragThresholdPx,
  savePos,
  loadPos,
  canStart = null,
  onDragStart = null,
  onDragMove = null,
  onDragEnd = null,
  shellWindowId = null,
  shellManager = null,
  enableSnapPreview = false,
}: DraggablePanelOptions): void {
  const handles = (Array.isArray(header) ? header : [header]).filter(
    (handle): handle is HTMLElement => Boolean(handle)
  );
  let pointerDown = false;
  let dragging = false;
  let pointerId: number | null = null;
  let activeSnapZone: ShellSnapZone | null = null;

  for (const handle of handles) {
    handle.classList.add("vb-floating-drag-handle");
  }

  let startX = 0,
    startY = 0;
  let lastX = 0,
    lastY = 0;
  let originLeft = 0,
    originTop = 0;

  // Cache size to avoid layout thrash during move
  let boxW = 0,
    boxH = 0;

  let rafId = 0;
  let activeWorkArea: ReturnType<typeof getShellWorkArea> | null = null;

  function startDragNow(e?: PointerEvent) {
    if (dragging) return;
    if (e && canStart && !canStart(e)) {
      endDrag(e);
      return;
    }

    if (shellWindowId && shellManager?.getWindow(shellWindowId)?.snap) {
      shellManager.unsnapWindow(shellWindowId, { preserveSnap: false });
    }

    ensureFixedTopLeft(panel);

    const r = panel.getBoundingClientRect();
    boxW = r.width;
    boxH = r.height;
    activeWorkArea = shellWindowId ? getShellWorkArea({ safeMargin: 8 }) : null;

    originLeft = parseFloat(panel.style.left) || r.left;
    originTop = parseFloat(panel.style.top) || r.top;

    dragging = true;
    panel.classList.add("is-dragging");
    document.documentElement.classList.add("vb-floating-drag-active");
    onDragStart?.({
      element: panel,
      pointer: { x: lastX, y: lastY, pointerId },
      bounds: getDragBounds(panel),
    });
  }

  function applyMove() {
    rafId = 0;
    if (!pointerDown || !dragging) return;

    const dx = lastX - startX;
    const dy = lastY - startY;

    const margin = 8;
    let nextLeft: number;
    let nextTop: number;
    if (activeWorkArea) {
      const next = clampBoundsToWorkArea({
        left: originLeft + dx,
        top: originTop + dy,
        width: boxW,
        height: boxH,
      }, {
        workArea: activeWorkArea,
        safeMargin: margin,
        forceSize: true,
      });
      nextLeft = next.left;
      nextTop = next.top;
    } else {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      nextLeft = clamp(originLeft + dx, margin, vw - boxW - margin);
      nextTop = clamp(originTop + dy, margin, vh - boxH - margin);
    }

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    onDragMove?.({
      element: panel,
      pointer: { x: lastX, y: lastY, pointerId },
      bounds: getDragBounds(panel),
    });
  }

  function scheduleMove() {
    if (rafId) return;
    rafId = requestAnimationFrame(applyMove);
  }

  function updateSnapPreview() {
    if (!enableSnapPreview || !shellWindowId || !shellManager) return;
    const zone = getSnapZoneForPointer({
      x: lastX,
      y: lastY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }) as ShellSnapZone;
    const supported = zone !== "center" && shellManager.canSnapWindow(shellWindowId, zone) !== false;
    activeSnapZone = supported ? zone : null;
    if (activeSnapZone) {
      applySnapPreview(panel, activeSnapZone);
    } else {
      clearSnapPreview(panel);
    }
  }

  function clearDragAffordances() {
    panel.classList.remove("is-dragging");
    document.documentElement.classList.remove("vb-floating-drag-active");
    clearSnapPreview(panel);
  }

  function endDrag(e: Event | null = null) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (!pointerDown) {
      clearDragAffordances();
      activeSnapZone = null;
      pointerId = null;
      return;
    }

    pointerDown = false;

    if (dragging) {
      dragging = false;
      clearDragAffordances();

      if (activeSnapZone && shellWindowId && shellManager) {
        shellManager.snapWindow(shellWindowId, activeSnapZone);
      } else {
        clampElementToViewport(panel, 8, { useShellWorkArea: Boolean(shellWindowId) });
      }

      savePos({
        ...(loadPos() || {}),
        panel: { left: panel.style.left, top: panel.style.top },
      });
      const pointerEvent = e as PointerEvent | null;
      onDragEnd?.({
        element: panel,
        pointer: { x: pointerEvent?.clientX ?? lastX, y: pointerEvent?.clientY ?? lastY, pointerId },
        bounds: getDragBounds(panel),
        snapZone: activeSnapZone,
      });
    }

    activeSnapZone = null;
    activeWorkArea = null;
    pointerId = null;
  }

  function onPointerDown(e: PointerEvent) {
    const target = e.target as Element | null;
    if (target?.closest?.(".calc-minimize, .calc-close, .calc-settings-btn")) return;

    // Mouse: left button only
    if (e.pointerType === "mouse" && e.button !== 0) return;

    if (pointerDown) endDrag(e);
    if (canStart && !canStart(e)) return;
    clearSnapPreview(panel);
    activeSnapZone = null;

    pointerDown = true;
    pointerId = e.pointerId;

    startX = lastX = e.clientX;
    startY = lastY = e.clientY;

    try {
      (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    // Mouse: start immediately (keep current perfect behavior)
    if (e.pointerType === "mouse") {
      startDragNow(e);
      return;
    }

    // Touch/Pen: the handle's touch-action keeps the page from stealing
    // this pointer before the drag threshold is crossed.
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointerDown) return;

    lastX = e.clientX;
    lastY = e.clientY;

    if (!dragging) {
      const dx = Math.abs(lastX - startX);
      const dy = Math.abs(lastY - startY);
      if (dx > dragThresholdPx || dy > dragThresholdPx) {
        startDragNow(e);
      } else {
        return;
      }
    }

    // While dragging, keep it smooth and avoid excessive style writes
    if (e.pointerType !== "mouse") e.preventDefault();
    updateSnapPreview();
    scheduleMove();
  }

  for (const handle of handles) {
    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove, { passive: false });
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("lostpointercapture", endDrag);
    handle.addEventListener("touchcancel", endDrag, { passive: true });
  }

  // Keep in bounds on resize
  window.addEventListener("resize", () => {
    if (panel.hidden) return;
    clampElementToViewport(panel, 8, {
      useShellWorkArea: Boolean(shellWindowId),
      preferVisibleBottom: Boolean(shellWindowId),
    });
    savePos({
      ...(loadPos() || {}),
      panel: { left: panel.style.left, top: panel.style.top },
    });
  });
}

export function makeLauncherDraggable({
  launcherEl,
  dragThresholdPx,
  savePos,
  loadPos,
  manageResize = true,
  onDragEnd = null,
}: DraggableLauncherOptions): LauncherMovedChecker {
  let pointerDown = false;
  let dragging = false;

  let startX = 0,
    startY = 0;
  let lastX = 0,
    lastY = 0;
  let originLeft = 0,
    originTop = 0;

  let boxW = 0,
    boxH = 0;

  let moved = false;
  let rafId = 0;

  launcherEl.classList.add("vb-floating-drag-handle");

  function startDragNow() {
    if (dragging) return;

    ensureFixedTopLeft(launcherEl);

    const r = launcherEl.getBoundingClientRect();
    boxW = r.width;
    boxH = r.height;

    originLeft = parseFloat(launcherEl.style.left) || r.left;
    originTop = parseFloat(launcherEl.style.top) || r.top;

    dragging = true;
    launcherEl.classList.add("is-dragging");
    document.documentElement.classList.add("vb-floating-drag-active");
  }

  function applyMove() {
    rafId = 0;
    if (!pointerDown || !dragging) return;

    const dx = lastX - startX;
    const dy = lastY - startY;

    // moved flag used to suppress toggle click
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const nextLeft = clamp(originLeft + dx, margin, vw - boxW - margin);
    const nextTop = clamp(originTop + dy, margin, vh - boxH - margin);

    launcherEl.style.left = `${nextLeft}px`;
    launcherEl.style.top = `${nextTop}px`;
  }

  function scheduleMove() {
    if (rafId) return;
    rafId = requestAnimationFrame(applyMove);
  }

  function endDrag() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (!pointerDown) return;
    pointerDown = false;

    if (dragging) {
      dragging = false;
      launcherEl.classList.remove("is-dragging");
      document.documentElement.classList.remove("vb-floating-drag-active");

      clampElementToViewport(launcherEl);

      onDragEnd?.();

      savePos({
        ...(loadPos() || {}),
        launcher: { left: launcherEl.style.left, top: launcherEl.style.top },
      });
    }
  }

  launcherEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    pointerDown = true;
    moved = false;

    startX = lastX = e.clientX;
    startY = lastY = e.clientY;

    try {
      launcherEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    // Mouse: begin immediately (keep perfect behavior)
    if (e.pointerType === "mouse") {
      startDragNow();
      return;
    }

    // Touch/Pen: only begin after threshold to keep tap-to-open reliable.
  });

  launcherEl.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;

    lastX = e.clientX;
    lastY = e.clientY;

    if (!dragging) {
      const dx = Math.abs(lastX - startX);
      const dy = Math.abs(lastY - startY);

      if (dx > dragThresholdPx || dy > dragThresholdPx) {
        startDragNow();
      } else {
        return;
      }
    }

    if (e.pointerType !== "mouse") e.preventDefault();
    scheduleMove();
  }, { passive: false });

  launcherEl.addEventListener("pointerup", (e) => {
    endDrag();
    // if user dragged, don't treat it as a click
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  launcherEl.addEventListener("pointercancel", endDrag);

  function handleResize() {
    if (!launcherEl.isConnected) return;
    if (launcherEl.hidden && (!launcherEl.style.left || !launcherEl.style.top)) return;

    clampElementToViewport(launcherEl);
    savePos({
      ...(loadPos() || {}),
      launcher: { left: launcherEl.style.left, top: launcherEl.style.top },
    });
  }

  if (manageResize) window.addEventListener("resize", handleResize);

  // Return a function for checking if last interaction moved
  const wasMoved = function wasMoved() {
    return moved;
  } as LauncherMovedChecker;

  wasMoved.destroy = function destroyLauncherDrag() {
    if (manageResize) window.removeEventListener("resize", handleResize);
  };

  return wasMoved;
}
