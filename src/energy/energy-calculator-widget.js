/**
 * energy-calculator-widget.js
 * Orquestador principal del calculador de energía
 */

import { t } from "../i18n.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import {
  loadTripCostSettings,
  saveTripCostSettings,
  loadTripCostValues,
  saveTripCostValues,
  loadMultiTrips,
  saveMultiTrips,
} from "./trip-cost-storage.js";
import {
  loadSettings as loadCalcSettings,
} from "../calculator/storage.js";

// Widget components
import { buildPanel } from "./widget/panel.js";
import { initModal } from "./widget/modal.js";
import { initSettingsSheet } from "./widget/settings-sheet.js";
import { initSimpleMode } from "./widget/simple-mode.js";
import { initMultiTripMode } from "./widget/multi-trip-mode.js";
import { EnergyCore } from "./energy-core.js";

const DRAG_THRESHOLD_PX = 6;
const POS_KEY = "energy_calc_pos_v1";

/**
 * createEnergyCalculatorWidget(options)
 * - button: HTMLElement -> if provided, clicking it toggles the panel
 * - mount: HTMLElement -> where to append the panel (default document.body)
 */
export function createEnergyCalculatorWidget(options = {}) {
  const {
    mount = document.body,
    button = null,
  } = options;

  // Load persisted state
  const tripSettings = loadTripCostSettings();
  const values = loadTripCostValues();
  let multiTrips = loadMultiTrips();
  let formatSettings = loadCalcSettings();

  // Position helpers
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

  // Build panel and get all refs
  const refs = buildPanel();
  const { panel, header, closeBtn } = refs;

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

  // Make panel draggable
  makePanelDraggable({
    panel,
    header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
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
    onUnitChange: (newUnit) => {
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
  });

  // Mode switch
  function setMode(mode) {
    tripSettings.mode = mode;
    saveTripCostSettings(tripSettings);

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
      setMode(btn.dataset.mode);
    });
  });

  // i18n refresh
  function refreshI18n() {
    simpleApi.updateUnitUI();
    multiApi.refreshI18n();
    simpleApi.calculate();
  }

  // Open / Close
  function open() {
    // Reload format settings in case they changed in calculator
    formatSettings = loadCalcSettings();
    core.setFormatSettings(formatSettings);

    panel.hidden = false;
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel);
    }
    simpleApi.updateUnitUI();
    simpleApi.restoreValues();
    simpleApi.calculate();

    // Restore mode
    setMode(tripSettings.mode);
  }

  function close() {
    panel.hidden = true;
    settingsApi.setSettingsSheetOpen(false);
  }

  function toggle() {
    panel.hidden ? open() : close();
  }

  // Close button
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

  document.addEventListener("i18n:change", refreshI18n);

  return {
    open,
    close,
    toggle,
  };
}
