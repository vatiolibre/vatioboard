function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function ensureFixedTopLeft(elm) {
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

export function clampElementToViewport(elm, margin = 8) {
  // Assumes fixed position with left/top set (or at least measurable via rect)
  const r = elm.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  ensureFixedTopLeft(elm);

  const curLeft = parseFloat(elm.style.left) || r.left;
  const curTop = parseFloat(elm.style.top) || r.top;

  const nextLeft = clamp(curLeft, margin, vw - r.width - margin);
  const nextTop = clamp(curTop, margin, vh - r.height - margin);

  elm.style.left = `${nextLeft}px`;
  elm.style.top = `${nextTop}px`;
}

export function makePanelDraggable({ panel, header, dragThresholdPx, savePos, loadPos }) {
  let pointerDown = false;
  let dragging = false;
  let pointerId = null;

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

  function startDragNow() {
    if (dragging) return;

    ensureFixedTopLeft(panel);

    const r = panel.getBoundingClientRect();
    boxW = r.width;
    boxH = r.height;

    originLeft = parseFloat(panel.style.left) || r.left;
    originTop = parseFloat(panel.style.top) || r.top;

    dragging = true;
    panel.classList.add("is-dragging");
  }

  function applyMove() {
    rafId = 0;
    if (!pointerDown || !dragging) return;

    const dx = lastX - startX;
    const dy = lastY - startY;

    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const nextLeft = clamp(originLeft + dx, margin, vw - boxW - margin);
    const nextTop = clamp(originTop + dy, margin, vh - boxH - margin);

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
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
      panel.classList.remove("is-dragging");
      clampElementToViewport(panel);

      savePos({
        ...(loadPos() || {}),
        panel: { left: panel.style.left, top: panel.style.top },
      });
    }

    pointerId = null;
  }

  header.addEventListener("pointerdown", (e) => {
    if (e.target?.closest?.(".calc-close, .calc-settings-btn")) return;

    // Mouse: left button only
    if (e.pointerType === "mouse" && e.button !== 0) return;

    pointerDown = true;
    pointerId = e.pointerId;

    startX = lastX = e.clientX;
    startY = lastY = e.clientY;

    try {
      header.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    // Mouse: start immediately (keep current perfect behavior)
    if (e.pointerType === "mouse") {
      startDragNow();
      return;
    }

    // Touch/Pen: wait until movement threshold, but prevent scroll jitter
    e.preventDefault();
  });

  header.addEventListener("pointermove", (e) => {
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

    // While dragging, keep it smooth and avoid excessive style writes
    if (e.pointerType !== "mouse") e.preventDefault();
    scheduleMove();
  }, { passive: false });

  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  // Keep in bounds on resize
  window.addEventListener("resize", () => {
    if (panel.hidden) return;
    clampElementToViewport(panel);
    savePos({
      ...(loadPos() || {}),
      panel: { left: panel.style.left, top: panel.style.top },
    });
  });
}

export function makeLauncherDraggable({ launcherEl, dragThresholdPx, savePos, loadPos }) {
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

      clampElementToViewport(launcherEl);

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

    // Touch/Pen: only begin after threshold to keep tap-to-open reliable
    e.preventDefault();
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

  // Return a function for checking if last interaction moved
  return () => moved;
}
