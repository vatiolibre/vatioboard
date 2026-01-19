import { el } from "./dom.js";
import { CalcCore } from "./calc-core.js";
import { t } from "../i18n.js";

/**
 * createCalculatorWidget(options)
 * - floating: true -> creates floating button + panel
 * - button: HTMLElement -> if provided, no floating button created; you control toggling
 * - mount: HTMLElement -> where to append the panel (default document.body)
 * - onResult: (value: string) => void
 * - Draggable panel (drag by header)
 *   - Mouse: click + drag (immediate)
 *   - Touch/Pen: drag after small movement threshold (smooth)
 * - Optional draggable floating launcher
 * - Persist positions in localStorage
 *
 * Behavior:
 * - Clicking outside DOES NOT close the calculator.
 * - It only closes via the close buttons ("Close" in header and "Close" key).
 */
export function createCalculatorWidget(options = {}) {
  const {
    mount = document.body,
    floating = options.button ? false : true,
    button = null,
    onResult = null,
  } = options;

  const isTouchLike =
    window.matchMedia?.("(pointer: coarse)")?.matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0;

  const core = new CalcCore();

  // -----------------------
  // Drag / position helpers
  // -----------------------
  const POS_KEY = "embeddable_calc_pos_v1";
  const DRAG_THRESHOLD_PX = 6;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

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

  function clampElementToViewport(elm, margin = 8) {
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

  const iconSvg = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.6"/>
      <path d="M7 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M8 11h2M12 11h2M16 11h0M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2M16 17h0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
  `;

  const panel = el(
    "section",
    { class: "calc-panel", hidden: true, role: "dialog", "aria-label": t("calcTitle") },
    el(
      "div",
      { class: "calc-header" },
      el("div", { class: "calc-title" }, t("calcTitle")),
      el("div", { class: "calc-spacer" }),
      el("button", { class: "calc-close", type: "button" }, t("close"))
    ),
    el(
      "div",
      { class: "calc-display" },
      el("input", {
        class: "calc-expr",
        type: "text",
        inputmode: isTouchLike ? "none" : "decimal",
        autocomplete: "off",
        spellcheck: "false",
      }),
      el(
        "div",
        { class: "calc-subrow" },
        el("div", { class: "calc-status" }),
        el("div", { class: "calc-result" })
      )
    ),
    el("div", { class: "calc-keys" })
  );

  const exprInput = panel.querySelector(".calc-expr");

  if (isTouchLike) {
    exprInput.setAttribute("readonly", "");
    exprInput.setAttribute("inputmode", "none");

    // Prevent focus entirely (stronger than blur)
    const blockFocus = (e) => {
      e.preventDefault();
      e.stopPropagation();
      exprInput.blur();
    };

    exprInput.addEventListener("pointerdown", blockFocus, { passive: false });
    exprInput.addEventListener("touchstart", blockFocus, { passive: false });
    exprInput.addEventListener("mousedown", blockFocus);
    exprInput.addEventListener("click", blockFocus);
    exprInput.addEventListener("focus", () => exprInput.blur());
  }

  const statusEl = panel.querySelector(".calc-status");
  const resultEl = panel.querySelector(".calc-result");
  const closeBtn = panel.querySelector(".calc-close");
  const keys = panel.querySelector(".calc-keys");
  const header = panel.querySelector(".calc-header");

  // Apply stored panel position (if any)
  {
    const pos = loadPos();
    if (pos?.panel?.left && pos?.panel?.top) {
      panel.style.position = "fixed";
      panel.style.left = pos.panel.left;
      panel.style.top = pos.panel.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  }

  // -------------------------
  // Panel drag implementation
  // -------------------------
  function makePanelDraggable() {
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

    function startDragNow(e) {
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
      if (e.target?.closest?.(".calc-close")) return;

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
        startDragNow(e);
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
        if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
          startDragNow(e);
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

  function keepInputEndVisible(input) {
    // Put caret at end (so the browser scroll logic is consistent)
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch {}

    // Force scroll to the far right
    input.scrollLeft = input.scrollWidth;
  }


  makePanelDraggable();

  function render({ keepEnd = false } = {}) {
    exprInput.value = core.expr ?? "";
    statusEl.textContent = core.status ?? "";
    resultEl.textContent = core.lastResult ? `Ans: ${core.lastResult}` : "";

    if (keepEnd) keepInputEndVisible(exprInput);
  }

  function open() {
    panel.hidden = false;
    render({ keepEnd: true });

    // If user dragged panel previously, ensure it stays visible
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel);
    }

    if (!isTouchLike) {
      setTimeout(() => exprInput.focus({ preventScroll: true }), 0);
    }
  }

  function close() {
    panel.hidden = true;
  }

  function toggle() {
    panel.hidden ? open() : close();
  }

  // Keyboard in input
  exprInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await doEval();
      return;
    }

    // IMPORTANT: do NOT close on Escape (only close buttons should close it)
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  });

  exprInput.addEventListener("input", () => {
    if (isTouchLike) return;
    core.setExpr(exprInput.value);
    // If caret is at end, keep end visible (don’t fight user editing mid-string)
    const atEnd = exprInput.selectionStart === exprInput.value.length;
    render({ keepEnd: atEnd });
  });

  let evaluating = false;

  async function doEval() {
    if (evaluating) return;
    evaluating = true;
    try {
      core.setExpr(exprInput.value);

      const res = await core.evaluate();
      render({ keepEnd: false }); // left side stays visible

      if (res.ok && typeof onResult === "function") onResult(res.result);
    } finally {
      evaluating = false;
    }
  }

  function pushToken(tok) {
    core.setExpr(exprInput.value);
    core.append(tok);
    render({ keepEnd: true });
    if (!isTouchLike) exprInput.focus({ preventScroll: true });
  }

  function act(fn) {
    core.setExpr(exprInput.value);
    fn();
    render({ keepEnd: true });
    if (!isTouchLike) exprInput.focus({ preventScroll: true });
  }

  const layout = [
    { t: "C", cls: "danger", on: () => act(() => core.clear()) },
    { t: "⌫", cls: "", on: () => act(() => core.backspace()) },
    { t: "±", cls: "op", on: () => act(() => core.toggleSign()) },
    { t: "÷", cls: "op", on: () => pushToken("÷") },

    { t: "7", on: () => pushToken("7") },
    { t: "8", on: () => pushToken("8") },
    { t: "9", on: () => pushToken("9") },
    { t: "×", cls: "op", on: () => pushToken("×") },

    { t: "4", on: () => pushToken("4") },
    { t: "5", on: () => pushToken("5") },
    { t: "6", on: () => pushToken("6") },
    { t: "–", cls: "op", on: () => pushToken("–") },

    { t: "1", on: () => pushToken("1") },
    { t: "2", on: () => pushToken("2") },
    { t: "3", on: () => pushToken("3") },
    { t: "+", cls: "op", on: () => pushToken("+") },

    { t: "0", on: () => pushToken("0") },
    { t: ".", on: () => pushToken(".") },
    { t: "%", cls: "op", on: () => pushToken("%") },
    { t: "=", cls: "eq", on: () => doEval() },

    { t: "√", cls: "op", on: () => act(() => core.sqrtTrailingNumber()) },
    { t: "(", cls: "op", on: () => pushToken("(") },
    { t: ")", cls: "op", on: () => pushToken(")") },
    { t: t("close"), cls: "", on: () => close() },
  ];

  // build keys
  for (const k of layout) {
    keys.appendChild(
      el(
        "button",
        { type: "button", class: `calc-key ${k.cls || ""}`.trim(), onclick: k.on },
        k.t
      )
    );
  }

  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  closeBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });

  // launcher (floating button) unless user provided their own button
  let launcher = null;

  // Launcher draggable helper (smooth touch, perfect mouse)
  function makeLauncherDraggable(launcherEl) {
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

        if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
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

  if (floating) {
    launcher = el("button", {
      type: "button",
      class: "calc-fab",
      "aria-label": t("openCalculator"),
      html: iconSvg,
    });

    // Apply stored launcher position (if any)
    {
      const pos = loadPos();
      if (pos?.launcher?.left && pos?.launcher?.top) {
        launcher.style.position = "fixed";
        launcher.style.left = pos.launcher.left;
        launcher.style.top = pos.launcher.top;
        launcher.style.right = "auto";
        launcher.style.bottom = "auto";
      }
    }

    // Make launcher draggable and guard toggle on drag
    const launcherMoved = makeLauncherDraggable(launcher);

    launcher.addEventListener("click", (e) => {
      // If the last interaction was a drag, skip toggle
      if (launcherMoved()) {
        e.preventDefault();
        return;
      }
      toggle();
    });

    mount.appendChild(launcher);
  }

  // user-provided button hook
  if (button) {
    button.addEventListener("click", toggle);
  }

  mount.appendChild(panel);
  render();

  return {
    open,
    close,
    toggle,
    setExpression: (s) => {
      core.setExpr(String(s ?? ""));
      render();
    },
    getExpression: () => core.expr,
  };
}
