import { el } from "../calculator/dom.js";
import { IconCalculator, IconEnergy } from "../icons.js";
import { t } from "../i18n.js";

/**
 * createFloatingDock()
 * Creates a draggable dock that contains multiple tool buttons.
 * Returns the dock element and methods to get button references.
 */
export function createFloatingDock({ mount = document.body } = {}) {
  const DRAG_THRESHOLD_PX = 6;
  const POS_KEY = "floating_dock_pos_v1";

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
      // ignore
    }
  }

  // Create dock container
  const dock = el(
    "div",
    { class: "floating-dock" },
    el("button", {
      type: "button",
      class: "dock-btn dock-btn-calc",
      "aria-label": t("openCalculator"),
      "data-i18n-aria": "openCalculator",
      html: IconCalculator,
    }),
    el("button", {
      type: "button",
      class: "dock-btn dock-btn-energy",
      "aria-label": t("openEnergy"),
      "data-i18n-aria": "openEnergy",
      html: IconEnergy,
    })
  );

  const calcBtn = dock.querySelector(".dock-btn-calc");
  const energyBtn = dock.querySelector(".dock-btn-energy");

  // Apply stored position
  {
    const pos = loadPos();
    if (pos?.left && pos?.top) {
      dock.style.position = "fixed";
      dock.style.left = pos.left;
      dock.style.top = pos.top;
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    }
  }

  // Drag implementation
  let pointerDown = false;
  let dragging = false;
  let moved = false;

  let startX = 0, startY = 0;
  let lastX = 0, lastY = 0;
  let originLeft = 0, originTop = 0;
  let boxW = 0, boxH = 0;
  let rafId = 0;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function ensureFixedTopLeft() {
    const r = dock.getBoundingClientRect();
    const left = dock.style.left ? parseFloat(dock.style.left) : r.left;
    const top = dock.style.top ? parseFloat(dock.style.top) : r.top;

    dock.style.position = "fixed";
    dock.style.left = `${left}px`;
    dock.style.top = `${top}px`;
    dock.style.right = "auto";
    dock.style.bottom = "auto";
  }

  function clampToViewport(margin = 8) {
    const r = dock.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    ensureFixedTopLeft();

    const curLeft = parseFloat(dock.style.left) || r.left;
    const curTop = parseFloat(dock.style.top) || r.top;

    const nextLeft = clamp(curLeft, margin, vw - r.width - margin);
    const nextTop = clamp(curTop, margin, vh - r.height - margin);

    dock.style.left = `${nextLeft}px`;
    dock.style.top = `${nextTop}px`;
  }

  function startDragNow() {
    if (dragging) return;

    ensureFixedTopLeft();

    const r = dock.getBoundingClientRect();
    boxW = r.width;
    boxH = r.height;

    originLeft = parseFloat(dock.style.left) || r.left;
    originTop = parseFloat(dock.style.top) || r.top;

    dragging = true;
    dock.classList.add("is-dragging");
  }

  function applyMove() {
    rafId = 0;
    if (!pointerDown || !dragging) return;

    const dx = lastX - startX;
    const dy = lastY - startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const nextLeft = clamp(originLeft + dx, margin, vw - boxW - margin);
    const nextTop = clamp(originTop + dy, margin, vh - boxH - margin);

    dock.style.left = `${nextLeft}px`;
    dock.style.top = `${nextTop}px`;
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
      dock.classList.remove("is-dragging");
      clampToViewport();

      savePos({ left: dock.style.left, top: dock.style.top });
    }
  }

  dock.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // Don't start drag from button clicks - let them handle their own clicks
    const isButtonClick = e.target.closest(".dock-btn");

    pointerDown = true;
    moved = false;

    startX = lastX = e.clientX;
    startY = lastY = e.clientY;

    // Only capture pointer if not clicking a button
    if (!isButtonClick) {
      try {
        dock.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (e.pointerType === "mouse") {
        startDragNow();
      }
    }
  });

  dock.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;

    lastX = e.clientX;
    lastY = e.clientY;

    if (!dragging) {
      const dx = Math.abs(lastX - startX);
      const dy = Math.abs(lastY - startY);

      if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
        // Capture pointer now that we're actually dragging
        try {
          dock.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        startDragNow();
        moved = true;
      } else {
        return;
      }
    }

    if (e.pointerType !== "mouse") e.preventDefault();
    scheduleMove();
  }, { passive: false });

  dock.addEventListener("pointerup", (e) => {
    const wasMoved = moved;
    endDrag();

    // If dragged, prevent click on buttons
    if (wasMoved) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  dock.addEventListener("pointercancel", endDrag);

  // Prevent button clicks when dragging
  function guardClick(btn) {
    btn.addEventListener("click", (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    }, { capture: true });
  }

  guardClick(calcBtn);
  guardClick(energyBtn);

  // Keep in bounds on resize
  window.addEventListener("resize", () => {
    clampToViewport();
    savePos({ left: dock.style.left, top: dock.style.top });
  });

  mount.appendChild(dock);

  return {
    dock,
    calcBtn,
    energyBtn,
  };
}
