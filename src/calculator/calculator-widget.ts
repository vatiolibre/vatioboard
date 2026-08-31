import { el } from "./dom.js";
import { CalcCore } from "./calc-core.js";
import { loadHistory, clearHistory, loadSettings, saveSettings } from "./storage.js";
import type { CalculatorSettings } from "./storage";
import { t } from "../i18n.js";
import { buildPanel } from "./widget/panel.js";
import { initHistorySheet } from "./widget/history-sheet.js";
import { buildKeypad } from "./widget/keypad.js";
import { clampElementToViewport, makePanelDraggable, makeLauncherDraggable } from "./widget/drag.js";
import { initSettingsSheet } from "./widget/settings-sheet.js";
import { toRaw, toDisplay, mapCursorPosition } from "./widget/number-format.js";
import { normalizeCalculatorResult } from "./result-normalization.js";
import { IconCalculator } from "../icons.js";
import {
  registerFloatingPanel,
} from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import { isFocusedLandscapeProfile } from "../shared/shell-layout-metrics.js";
import type { ShellLifecycleOptions, ShellRuntime } from "../types/shell";

const CALCULATOR_WINDOW_ID = "calculator";

type CalculatorPosition = {
  panel?: {
    left?: string;
    top?: string;
  } | null;
  launcher?: {
    left?: string;
    top?: string;
  } | null;
};

export type CalculatorSettingsStore = {
  loadSettings?: (() => CalculatorSettings) | null;
  saveSettings?: ((settings: CalculatorSettings | Partial<CalculatorSettings>) => void) | null;
};

export type CalculatorTranslateFn = (key: string, params?: Record<string, unknown>) => string;

export type CalculatorWidgetOptions = {
  mount?: HTMLElement;
  floating?: boolean;
  button?: HTMLElement | null;
  onResult?: ((value: string) => void) | null;
  onOpenEnergy?: (() => void) | null;
  persistVisibility?: boolean;
  restoreVisibility?: boolean;
  visibilityKey?: string;
  shellManager?: ShellRuntime;
  settingsStore?: CalculatorSettingsStore | null;
  translate?: CalculatorTranslateFn | null;
};

type CalculatorShowOptions = ShellLifecycleOptions & {
  focus?: boolean;
};

export type CalculatorWidgetApi = {
  open: (options?: CalculatorShowOptions) => void;
  close: (options?: ShellLifecycleOptions) => void;
  minimize: (options?: ShellLifecycleOptions) => void;
  toggle: () => void;
  destroy: () => void;
  isOpen: () => boolean;
  setExpression: (value: unknown) => void;
  getExpression: () => string;
};

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
export function createCalculatorWidget(options: CalculatorWidgetOptions = {}): CalculatorWidgetApi {
  const {
    mount = document.body,
    floating = options.button ? false : true,
    button = null,
    onResult = null,
    onOpenEnergy = null,
    persistVisibility = false,
    restoreVisibility = false,
    visibilityKey = "embeddable_calc_visibility_v1",
    shellManager = getDefaultShellWindowManager(),
    settingsStore = null,
    translate = null,
  } = options;

  const isTouchLike =
    window.matchMedia?.("(pointer: coarse)")?.matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0;

  const core = new CalcCore();
  const loadCalculatorSettings = settingsStore?.loadSettings || loadSettings;
  const saveCalculatorSettings = settingsStore?.saveSettings || saveSettings;
  const translateCalculator = translate || t;
  const settings = loadCalculatorSettings();

  // -----------------------
  // Drag / position helpers
  // -----------------------
  const POS_KEY = "embeddable_calc_pos_v1";
  const DRAG_THRESHOLD_PX = 6;

  function loadPos(): CalculatorPosition | null {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePos(pos: CalculatorPosition) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore
    }
    if (pos?.panel?.left && pos?.panel?.top) {
      shellManager.updateWindowBounds(CALCULATOR_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
      }, {
        preserveSnap: Boolean(shellManager.getWindow(CALCULATOR_WINDOW_ID)?.snap),
      });
    }
  }

  function loadVisibility() {
    if (!restoreVisibility) return false;
    try {
      return localStorage.getItem(visibilityKey) === "open";
    } catch {
      return false;
    }
  }

  function saveVisibility(isOpen: boolean) {
    if (!persistVisibility) return;
    try {
      localStorage.setItem(visibilityKey, isOpen ? "open" : "closed");
    } catch {
      // ignore
    }
  }

  const {
    panel,
    exprInput,
    historyEl,
    historyBtn,
    energyBtn,
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
    minimizeBtn,
    closeBtn,
    keys,
    header,
  } = buildPanel({
    t: translateCalculator,
    isTouchLike,
    showEnergyTool: typeof onOpenEnergy === "function",
  });
  let cleanupLayer = () => {};

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

  cleanupLayer = registerFloatingPanel(panel, {
    id: CALCULATOR_WINDOW_ID,
    kind: "tool",
    title: "Calculator",
    shellManager,
    storageKey: visibilityKey,
    capabilities: {
      draggable: true,
      resizable: false,
      minimizable: true,
      closable: true,
      restorable: true,
      maximizable: false,
      snap: false,
      preserveIntrinsicWidth: false,
      minWidth: 320,
      minHeight: 320,
      maxWidth: 620,
      maxHeight: 548,
    },
    resolveLayout(metrics) {
      if (metrics.profile === "portrait" && metrics.workArea.width <= 600) {
        const width = Math.min(360, metrics.workArea.width);
        const keyHeight = Math.min(64, Math.max(44, metrics.viewport.width * 0.16));
        const displayHeight = Math.min(72, Math.max(64, metrics.viewport.width * 0.18));
        const height = Math.min(
          metrics.workArea.height,
          Math.ceil(164 + displayHeight + (keyHeight * 5)),
        );
        return {
          mode: "portrait",
          left: metrics.workArea.left + Math.max(0, metrics.workArea.width - width) / 2,
          top: metrics.workArea.top,
          width,
          height,
          minWidth: Math.min(320, metrics.workArea.width),
          minHeight: Math.min(400, metrics.workArea.height),
          maxWidth: metrics.workArea.width,
          maxHeight: metrics.workArea.height,
        };
      }
      if (!isFocusedLandscapeProfile(metrics.profile)) return null;
      const width = Math.min(520, metrics.workArea.width);
      const height = Math.min(440, metrics.workArea.height);
      return {
        mode: "short-landscape",
        left: metrics.workArea.left + Math.max(0, metrics.workArea.width - width) / 2,
        top: metrics.workArea.top + Math.max(0, metrics.workArea.height - height) / 2,
        width,
        height,
        minWidth: Math.min(480, metrics.workArea.width),
        minHeight: Math.min(400, metrics.workArea.height),
        maxWidth: metrics.workArea.width,
        maxHeight: metrics.workArea.height,
      };
    },
    lifecycle: {
      open: showPanel,
      close: hidePanel,
      minimize: minimizePanel,
      restore: showPanel,
    },
  });

  // -------------------------
  // Panel drag implementation
  // -------------------------
  makePanelDraggable({
    panel,
    header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
    shellWindowId: CALCULATOR_WINDOW_ID,
    shellManager,
    enableSnapPreview: shellManager.getShellPreference?.("snapEnabled") !== false,
  });

  function keepInputEndVisible(input: HTMLInputElement) {
    // Put caret at end (so the browser scroll logic is consistent)
    const len = input.value.length;
    try {
      input.setSelectionRange(len, len);
    } catch {
      // Some browsers reject selection updates on non-editable inputs.
    }

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
    t: translateCalculator,
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
    saveSettings: saveCalculatorSettings,
    onOpen: () => historyApi?.setHistorySheetOpen(false),
    onChange: () => {
      render({ keepEnd: true, force: true });
      historyApi?.refreshHistoryList();
    },
  });

  function refreshCalculatorI18n() {
    historyApi?.refreshHistoryList();
  }

  document.addEventListener("i18n:change", refreshCalculatorI18n);

  function render({ keepEnd = false, force = false } = {}) {
    const rawExpr = core.expr ?? "";
    const normalizedExpr = rawExpr === core.lastResult
      ? normalizeCalculatorResult(rawExpr, settings.decimals)
      : rawExpr;

    const displayExpr = toDisplay(normalizedExpr, settings);

    if (exprInput.value !== displayExpr) {
      const oldCursorPos = exprInput.selectionStart ?? 0;
      const oldValue = exprInput.value;

      exprInput.value = displayExpr;

      if (isEditing && settings.thousandSeparator) {
        const newCursorPos = mapCursorPosition(oldValue, displayExpr, oldCursorPos);
        try {
          exprInput.setSelectionRange(newCursorPos, newCursorPos);
        } catch {
          // Cursor restoration can fail on transient browser selection states.
        }
      }
    }

    historyEl.textContent = toDisplay(core.status, settings) ?? "";

    if (keepEnd) keepInputEndVisible(exprInput);
  }

  function showPanel({ persist = true, focus = true }: CalculatorShowOptions = {}) {
    panel.hidden = false;
    if (persist) saveVisibility(true);
    render({ keepEnd: true });

    // If user dragged panel previously, ensure it stays visible
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel, 8, {
        useShellWorkArea: true,
        preferVisibleBottom: true,
      });
    }

    if (focus && !isTouchLike) {
      setTimeout(() => exprInput.focus({ preventScroll: true }), 0);
    }
  }

  function hidePanel({ persist = true }: ShellLifecycleOptions = {}) {
    panel.hidden = true;
    if (persist) saveVisibility(false);
  }

  function minimizePanel() {
    panel.hidden = true;
  }

  function open(options: CalculatorShowOptions = {}) {
    showPanel(options);
    shellManager.openWindow(CALCULATOR_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    hidePanel(options);
    shellManager.closeWindow(CALCULATOR_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function minimize(options: ShellLifecycleOptions = {}) {
    minimizePanel();
    shellManager.minimizeWindow(CALCULATOR_WINDOW_ID, { ...options, invokeLifecycle: false });
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

      const res = await core.evaluate(settings.decimals);
      isEditing = false;
      render({ keepEnd: false, force: true }); // left side stays visible

      if (res.ok && typeof onResult === "function") onResult(res.result);
    } finally {
      evaluating = false;
    }
  }

  function pushToken(tokenOrFn: string | ((core: CalcCore) => string)) {
    core.setExpr(toRaw(exprInput.value, settings));
    const tok = typeof tokenOrFn === "function" ? tokenOrFn(core) : tokenOrFn;
    core.append(tok);
    isEditing = false;
    render({ keepEnd: true, force: true });
    if (!isTouchLike) exprInput.focus({ preventScroll: true });
  }

  function act(fn: ((core: CalcCore) => void) | null | undefined) {
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

  minimizeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  minimizeBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    minimize();
  });

  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  closeBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });

  if (energyBtn && typeof onOpenEnergy === "function") {
    energyBtn.addEventListener("click", () => {
      historyApi?.setHistorySheetOpen(false);
      settingsApi?.setSettingsSheetOpen(false);
      onOpenEnergy();
    });
  }

  // launcher (floating button) unless user provided their own button
  let launcher;
  let launcherMoved = null;

  if (floating) {
    launcher = el("button", {
      type: "button",
      class: "calc-fab",
      "aria-label": translateCalculator("openCalculator"),
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
    launcherMoved = makeLauncherDraggable({
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

  if (loadVisibility()) {
    open();
  }

  return {
    open,
    close,
    minimize,
    toggle,
    destroy: () => {
      cleanupLayer();
      launcherMoved?.destroy?.();
      document.removeEventListener("i18n:change", refreshCalculatorI18n);
      if (button) button.removeEventListener("click", toggle);
      panel.remove();
      launcher?.remove();
    },
    isOpen: () => !panel.hidden,
    setExpression: (s) => {
      core.setExpr(String(s ?? ""));
      render();
    },
    getExpression: () => core.expr,
  };
}
