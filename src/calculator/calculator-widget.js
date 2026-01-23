import { el } from "./dom.js";
import { CalcCore } from "./calc-core.js";
import { loadHistory, clearHistory, loadSettings, saveSettings } from "./storage.js";
import { t } from "../i18n.js";
import { buildPanel } from "./widget/panel.js";
import { initHistorySheet } from "./widget/history-sheet.js";
import { buildKeypad } from "./widget/keypad.js";
import { clampElementToViewport, makePanelDraggable, makeLauncherDraggable } from "./widget/drag.js";
import { initSettingsSheet } from "./widget/settings-sheet.js";
import { toRaw, toDisplay, mapCursorPosition } from "./widget/number-format.js";
import { IconCalculator } from "../icons.js";

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
  const settings = loadSettings();

  // -----------------------
  // Drag / position helpers
  // -----------------------
  const POS_KEY = "embeddable_calc_pos_v1";
  const DRAG_THRESHOLD_PX = 6;

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

  const {
    panel,
    exprInput,
    historyEl,
    historyBtn,
    historySheet,
    historyList,
    historyClearBtn,
    historyCloseBtn,
    settingsBtn,
    settingsSheet,
    settingsCloseBtn,
    settingsDecimalsMinus,
    settingsDecimalsPlus,
    settingsDecimalsValue,
    settingsThousandsToggle,
    closeBtn,
    keys,
    header,
  } = buildPanel({ t, isTouchLike });

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
  makePanelDraggable({
    panel,
    header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
  });

  function keepInputEndVisible(input) {
    // Put caret at end (so the browser scroll logic is consistent)
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch {}

    // Force scroll to the far right
    input.scrollLeft = input.scrollWidth;
  }

  let isEditing = false;

  const historyApi = initHistorySheet({
    panel,
    core,
    historySheet,
    historyBtn,
    historyList,
    historyClearBtn,
    historyCloseBtn,
    render,
    settings,
    onOpen: () => settingsApi?.setSettingsSheetOpen(false),
    t,
    loadHistory,
    clearHistory,
  });

  const settingsApi = initSettingsSheet({
    panel,
    settings,
    settingsBtn,
    settingsSheet,
    settingsCloseBtn,
    settingsDecimalsMinus,
    settingsDecimalsPlus,
    settingsDecimalsValue,
    settingsThousandsToggle,
    saveSettings,
    onOpen: () => historyApi?.setHistorySheetOpen(false),
    onChange: () => {
      render({ keepEnd: true, force: true });
      historyApi?.refreshHistoryList();
    },
  });

  document.addEventListener("i18n:change", () => {
    historyApi?.refreshHistoryList();
  });

  function render({ keepEnd = false, force = false } = {}) {
    const rawExpr = core.expr ?? "";

    const displayExpr = toDisplay(rawExpr, settings);

    if (exprInput.value !== displayExpr) {
      const oldCursorPos = exprInput.selectionStart ?? 0;
      const oldValue = exprInput.value;

      exprInput.value = displayExpr;

      if (isEditing && settings.thousandSeparator) {
        const newCursorPos = mapCursorPosition(oldValue, displayExpr, oldCursorPos);
        try {
          exprInput.setSelectionRange(newCursorPos, newCursorPos);
        } catch {}
      }
    }

    historyEl.textContent = toDisplay(core.status, settings) ?? "";

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

  exprInput.addEventListener("focus", () => {
    if (isTouchLike) return;
    isEditing = true;
    // Sync core with normalized value but keep formatted display
    const normalized = toRaw(exprInput.value, settings);
    core.setExpr(normalized);
  });

  exprInput.addEventListener("blur", () => {
    if (isTouchLike) return;
    isEditing = false;
    render({ keepEnd: true, force: true });
  });

  exprInput.addEventListener("input", () => {
    if (isTouchLike) return;
    core.setExpr(toRaw(exprInput.value, settings));
    // If caret is at end, keep end visible (don’t fight user editing mid-string)
    const atEnd = exprInput.selectionStart === exprInput.value.length;
    render({ keepEnd: atEnd });
  });

  let evaluating = false;

  async function doEval() {
    if (evaluating) return;
    evaluating = true;
    try {
      core.setExpr(toRaw(exprInput.value, settings));

      const res = await core.evaluate();
      isEditing = false;
      render({ keepEnd: false, force: true }); // left side stays visible

      if (res.ok && typeof onResult === "function") onResult(res.result);
    } finally {
      evaluating = false;
    }
  }

  function pushToken(tokenOrFn) {
    core.setExpr(toRaw(exprInput.value, settings));
    const tok = typeof tokenOrFn === "function" ? tokenOrFn(core) : tokenOrFn;
    core.append(tok);
    isEditing = false;
    render({ keepEnd: true, force: true });
    if (!isTouchLike) exprInput.focus({ preventScroll: true });
  }

  function act(fn) {
    core.setExpr(toRaw(exprInput.value, settings));
    if (typeof fn === "function") fn(core);
    isEditing = false;
    render({ keepEnd: true, force: true });
    if (!isTouchLike) exprInput.focus({ preventScroll: true });
  }

  buildKeypad({
    keysContainer: keys,
    pushToken,
    act,
    doEval,
  });

  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  closeBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });

  // launcher (floating button) unless user provided their own button
  let launcher = null;

  if (floating) {
    launcher = el("button", {
      type: "button",
      class: "calc-fab",
      "aria-label": t("openCalculator"),
      html: IconCalculator,
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
    const launcherMoved = makeLauncherDraggable({
      launcherEl: launcher,
      dragThresholdPx: DRAG_THRESHOLD_PX,
      savePos,
      loadPos,
    });

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
