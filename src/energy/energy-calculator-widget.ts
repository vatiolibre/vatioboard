/**
 * energy-calculator-widget.js
 * Orquestador principal del calculador de energía
 */

import { t } from "../i18n.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import {
  loadTripCostSettings as loadLegacyTripCostSettings,
  saveTripCostSettings as saveLegacyTripCostSettings,
  loadTripCostValues,
  saveTripCostValues,
  loadMultiTrips,
  saveMultiTrips,
  type TripCostMode,
  type TripCostSettings,
} from "./trip-cost-storage.js";
import {
  loadSettings as loadCalcSettings,
  saveSettings as saveCalcSettings,
  type CalculatorSettings,
} from "../calculator/storage.js";
import {
  registerFloatingPanel,
} from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";

// Widget components
import { buildPanel } from "./widget/panel.js";
import { initModal } from "./widget/modal.js";
import { initSettingsSheet } from "./widget/settings-sheet.js";
import { initSimpleMode } from "./widget/simple-mode.js";
import { initMultiTripMode } from "./widget/multi-trip-mode.js";
import { EnergyCore, type NumberFormatSettings } from "./energy-core.js";
import type { ShellLifecycleOptions, ShellRuntime } from "../types/shell";

const DRAG_THRESHOLD_PX = 6;
const POS_KEY = "energy_calc_pos_v1";
const ENERGY_WINDOW_ID = "energy";

type EnergyPosition = {
  panel?: {
    left?: string;
    top?: string;
  } | null;
};

export type EnergySettingsStore = {
  loadTripCostSettings?: (() => TripCostSettings) | null;
  saveTripCostSettings?: ((settings: TripCostSettings | Partial<TripCostSettings>) => void) | null;
  loadNumberFormatSettings?: (() => NumberFormatSettings) | null;
  saveNumberFormatSettings?: ((settings: CalculatorSettings | Partial<CalculatorSettings>) => void) | null;
};

export type EnergyTranslateFn = (key: string, params?: Record<string, unknown>) => string;

export type EnergyCalculatorWidgetOptions = {
  mount?: HTMLElement;
  button?: HTMLElement | null;
  persistVisibility?: boolean;
  restoreVisibility?: boolean;
  visibilityKey?: string;
  shellManager?: ShellRuntime;
  settingsStore?: EnergySettingsStore | null;
  translate?: EnergyTranslateFn | null;
};

export type EnergyCalculatorWidgetApi = {
  open: (options?: ShellLifecycleOptions) => void;
  close: (options?: ShellLifecycleOptions) => void;
  minimize: (options?: ShellLifecycleOptions) => void;
  destroy: () => void;
  isOpen: () => boolean;
  toggle: () => void;
};

function loadNumberFormatSettings(): NumberFormatSettings {
  return { ...loadCalcSettings() };
}

/**
 * createEnergyCalculatorWidget(options)
 * - button: HTMLElement -> if provided, clicking it toggles the panel
 * - mount: HTMLElement -> where to append the panel (default document.body)
 */
export function createEnergyCalculatorWidget(options: EnergyCalculatorWidgetOptions = {}): EnergyCalculatorWidgetApi {
  const {
    mount = document.body,
    button = null,
    persistVisibility = false,
    restoreVisibility = false,
    visibilityKey = "energy_calc_visibility_v1",
    shellManager = getDefaultShellWindowManager(),
    settingsStore = null,
    translate = null,
  } = options;

  const loadEnergyTripCostSettings = settingsStore?.loadTripCostSettings || loadLegacyTripCostSettings;
  const saveEnergyTripCostSettings = settingsStore?.saveTripCostSettings || saveLegacyTripCostSettings;
  const loadEnergyNumberFormatSettings = settingsStore?.loadNumberFormatSettings || loadNumberFormatSettings;
  const saveEnergyNumberFormatSettings = settingsStore?.saveNumberFormatSettings || saveCalcSettings;
  const translateEnergy = translate || t;

  // Load persisted state
  const tripSettings = loadEnergyTripCostSettings();
  const values = loadTripCostValues();
  const multiTrips = loadMultiTrips();
  let formatSettings = loadEnergyNumberFormatSettings();

  // Position helpers
  function loadPos(): EnergyPosition | null {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePos(pos: EnergyPosition) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore
    }
    if (pos?.panel?.left && pos?.panel?.top) {
      shellManager.updateWindowBounds(ENERGY_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
      }, {
        preserveSnap: Boolean(shellManager.getWindow(ENERGY_WINDOW_ID)?.snap),
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

  // Build panel and get all refs
  const refs = buildPanel({ t: translateEnergy });
  const { panel, header, minimizeBtn, closeBtn } = refs;
  let cleanupLayer = () => {};

  // Apply stored panel position
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
    id: ENERGY_WINDOW_ID,
    kind: "tool",
    title: "Energy",
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
      preserveIntrinsicWidth: true,
      maxWidth: 640,
    },
    lifecycle: {
      open: showPanel,
      close: hidePanel,
      minimize: minimizePanel,
      restore: showPanel,
    },
  });

  // Make panel draggable
  makePanelDraggable({
    panel,
    header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
    shellWindowId: ENERGY_WINDOW_ID,
    shellManager,
    enableSnapPreview: shellManager.getShellPreference?.("snapEnabled") !== false,
  });

  // Initialize core
  const core = new EnergyCore(formatSettings);

  // Initialize modal
  const modalApi = initModal({
    modal: refs.modal,
    modalMessage: refs.modalMessage,
    modalCancelBtn: refs.modalCancelBtn,
    modalConfirmBtn: refs.modalConfirmBtn,
  });

  // Initialize simple mode
  const simpleApi = initSimpleMode({
    core,
    tripSettings,
    values,
    distanceLabel: refs.distanceLabel,
    distanceInput: refs.distanceInput,
    distanceSlider: refs.distanceSlider,
    distanceError: refs.distanceError,
    consumptionLabel: refs.consumptionLabel,
    consumptionInput: refs.consumptionInput,
    consumptionSlider: refs.consumptionSlider,
    consumptionError: refs.consumptionError,
    priceInput: refs.priceInput,
    priceSlider: refs.priceSlider,
    priceError: refs.priceError,
    kwhResult: refs.kwhResult,
    costResult: refs.costResult,
    onValuesChange: (v) => saveTripCostValues(v),
  });

  // Initialize multi-trip mode
  const multiApi = initMultiTripMode({
    core,
    tripSettings,
    multiTrips,
    tripsContainer: refs.tripsContainer,
    multiTotalValue: refs.multiTotalValue,
    resetAllBtn: refs.resetAllBtn,
    multiTripNameInput: refs.multiTripNameInput,
    multiDistanceInput: refs.multiDistanceInput,
    multiDistanceSlider: refs.multiDistanceSlider,
    multiDistanceLabel: refs.multiDistanceLabel,
    multiConsumptionInput: refs.multiConsumptionInput,
    multiConsumptionSlider: refs.multiConsumptionSlider,
    multiConsumptionLabel: refs.multiConsumptionLabel,
    multiPriceInput: refs.multiPriceInput,
    multiPriceSlider: refs.multiPriceSlider,
    multiSaveBtn: refs.multiSaveBtn,
    multiCancelBtn: refs.multiCancelBtn,
    onTripsChange: () => {}, // Already saved inside multi-trip-mode
    showModal: modalApi.showModal,
  });

  // Initialize settings sheet
  const settingsApi = initSettingsSheet({
    panel,
    tripSettings,
    formatSettings,
    settingsBtn: refs.settingsBtn,
    settingsSheet: refs.settingsSheet,
    settingsCloseBtn: refs.settingsCloseBtn,
    unitBtns: refs.unitBtns,
    thousandsToggle: refs.thousandsToggle,
    onUnitChange: () => {
      // Reset price to 0 when switching units (simple mode)
      values.price = "0";
      saveTripCostValues(values);

      // Reset prices in multi-trip mode
      multiTrips.forEach(trip => {
        trip.price = "0";
      });
      saveMultiTrips(multiTrips);

      // Update UI
      simpleApi.updateUnitUI();
      simpleApi.restoreValues();
      simpleApi.calculate();

      if (tripSettings.mode === "multi") {
        multiApi.updateSliderRanges();
        multiApi.renderTrips();
      }
    },
    onThousandsChange: (newSettings) => {
      core.setFormatSettings(newSettings);
      simpleApi.reformatAllInputs();
      simpleApi.calculate();
    },
    onOpen: () => {}, // No other sheets to close
    saveTripCostSettings: saveEnergyTripCostSettings,
    saveFormatSettings: saveEnergyNumberFormatSettings,
  });

  // Mode switch
  function setMode(mode: TripCostMode) {
    tripSettings.mode = mode;
    saveEnergyTripCostSettings(tripSettings);

    // Update button states
    refs.modeBtns.forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });

    if (mode === "simple") {
      refs.simpleView.hidden = false;
      refs.multiView.hidden = true;
      panel.classList.remove("is-multi-mode");
    } else {
      refs.simpleView.hidden = true;
      refs.multiView.hidden = false;
      panel.classList.add("is-multi-mode");
      // Initialize form
      multiApi.updateSliderRanges();
      multiApi.clearForm();
      multiApi.renderTrips();
    }

    // Reposition panel to keep it in viewport after width change
    setTimeout(() => {
      if (panel.style.left && panel.style.top) {
        clampElementToViewport(panel);
      }
    }, 50);
  }

  refs.modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.mode as TripCostMode);
    });
  });

  // i18n refresh
  function refreshI18n() {
    simpleApi.updateUnitUI();
    multiApi.refreshI18n();
    simpleApi.calculate();
  }

  // Open / Close
  function showPanel({ persist = true }: ShellLifecycleOptions = {}) {
    // Reload format settings in case they changed in calculator
    formatSettings = loadEnergyNumberFormatSettings();
    core.setFormatSettings(formatSettings);

    panel.hidden = false;
    if (persist) saveVisibility(true);
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel);
    }
    simpleApi.updateUnitUI();
    simpleApi.restoreValues();
    simpleApi.calculate();

    // Restore mode
    setMode(tripSettings.mode);
  }

  function hidePanel({ persist = true }: ShellLifecycleOptions = {}) {
    panel.hidden = true;
    if (persist) saveVisibility(false);
    settingsApi.setSettingsSheetOpen(false);
  }

  function minimizePanel() {
    panel.hidden = true;
  }

  function open(options: ShellLifecycleOptions = {}) {
    showPanel(options);
    shellManager.openWindow(ENERGY_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    hidePanel(options);
    shellManager.closeWindow(ENERGY_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function minimize(options: ShellLifecycleOptions = {}) {
    minimizePanel();
    shellManager.minimizeWindow(ENERGY_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function toggle() {
    panel.hidden ? open() : close();
  }

  // Window controls
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

  // User-provided button hook
  if (button) {
    button.addEventListener("click", toggle);
  }

  mount.appendChild(panel);

  // Initial UI setup
  simpleApi.updateSliderRanges();
  simpleApi.updateUnitUI();
  simpleApi.restoreValues();
  simpleApi.calculate();
  setMode(tripSettings.mode);
  refreshI18n();

  if (loadVisibility()) {
    open();
  }

  document.addEventListener("i18n:change", refreshI18n);

  return {
    open,
    close,
    minimize,
    destroy: () => {
      cleanupLayer();
      document.removeEventListener("i18n:change", refreshI18n);
      if (button) button.removeEventListener("click", toggle);
      panel.remove();
    },
    isOpen: () => !panel.hidden,
    toggle,
  };
}
