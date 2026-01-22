import { el } from "../calculator/dom.js";
import { t } from "../i18n.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import { IconSettings, IconClose } from "../icons.js";
import {
  loadTripCostSettings,
  saveTripCostSettings,
  loadTripCostValues,
  saveTripCostValues,
} from "./trip-cost-storage.js";
// Shared formatting utilities from calculator
import {
  toDisplay,
  toRaw,
} from "../calculator/widget/number-format.js";
import {
  loadSettings as loadCalcSettings,
  saveSettings as saveCalcSettings,
} from "../calculator/storage.js";

// Slider ranges based on unit (km = Colombia/Latam, mi = USA)
const SLIDER_CONFIG = {
  km: {
    distance: { min: 0, max: 1000, step: 1 },
    consumption: { min: 5, max: 40, step: 0.1 },
    price: { min: 100, max: 2000, step: 10 },
  },
  mi: {
    distance: { min: 0, max: 600, step: 1 },
    consumption: { min: 5, max: 40, step: 0.1 },
    price: { min: 0.05, max: 2.00, step: 0.01 },
  },
};

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

  const DRAG_THRESHOLD_PX = 6;
  const POS_KEY = "energy_calc_pos_v1";

  // Load persisted state
  const tripSettings = loadTripCostSettings();
  const values = loadTripCostValues();
  // Shared format settings (from calculator)
  let formatSettings = loadCalcSettings();

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

  // Build panel
  const panel = el(
    "section",
    { class: "energy-panel", hidden: true, role: "dialog", "aria-label": t("energyTitle") },
    // Header
    el(
      "div",
      { class: "energy-header" },
      el("div", { class: "energy-title" }, t("energyTitle")),
      el("button", {
        class: "energy-icon-btn energy-settings-btn",
        type: "button",
        "aria-label": t("settings"),
        html: IconSettings,
      }),
      el("div", { class: "energy-spacer" }),
      el("button", {
        class: "energy-icon-btn energy-close",
        type: "button",
        "aria-label": t("close"),
        html: IconClose,
      })
    ),
    // Subheader
    el("div", { class: "energy-subheader" }, "Trip A → Trip B"),
    // Body with inputs
    el(
      "div",
      { class: "energy-body" },
      // Distance input
      el(
        "div",
        { class: "energy-input-group" },
        el("label", { class: "energy-label", for: "energy-distance" }),
        el("input", {
          class: "energy-input",
          id: "energy-distance",
          type: "text",
          inputmode: "decimal",
          autocomplete: "off",
          spellcheck: "false",
          placeholder: "0",
        }),
        el("input", {
          class: "energy-slider",
          id: "energy-distance-slider",
          type: "range",
        }),
        el("span", { class: "energy-input-error" })
      ),
      // Consumption input
      el(
        "div",
        { class: "energy-input-group" },
        el("label", { class: "energy-label", for: "energy-consumption" }),
        el("input", {
          class: "energy-input",
          id: "energy-consumption",
          type: "text",
          inputmode: "decimal",
          autocomplete: "off",
          spellcheck: "false",
          placeholder: "0",
        }),
        el("input", {
          class: "energy-slider",
          id: "energy-consumption-slider",
          type: "range",
        }),
        el("span", { class: "energy-input-error" })
      ),
      // Price input
      el(
        "div",
        { class: "energy-input-group" },
        el("label", { class: "energy-label", for: "energy-price" }, t("electricityPrice")),
        el("input", {
          class: "energy-input",
          id: "energy-price",
          type: "text",
          inputmode: "decimal",
          autocomplete: "off",
          spellcheck: "false",
          placeholder: "0",
        }),
        el("input", {
          class: "energy-slider",
          id: "energy-price-slider",
          type: "range",
        }),
        el("span", { class: "energy-input-error" })
      ),
      // Results
      el(
        "div",
        { class: "energy-results" },
        el(
          "div",
          { class: "energy-result-row" },
          el("span", { class: "energy-result-label" }, t("energyUsed")),
          el("span", { class: "energy-result-value", id: "energy-kwh-result" }, "—")
        ),
        el(
          "div",
          { class: "energy-result-row energy-result-total" },
          el("span", { class: "energy-result-label" }, t("estimatedCost")),
          el("span", { class: "energy-result-value", id: "energy-cost-result" }, "—")
        )
      )
    ),
    // Settings sheet
    el(
      "div",
      { class: "energy-settings-sheet", hidden: true, "aria-hidden": "true" },
      el(
        "div",
        { class: "energy-settings-sheet-header" },
        el("span", {}, t("settings")),
        el("button", {
          class: "energy-icon-btn energy-settings-close",
          type: "button",
          "aria-label": t("close"),
          html: IconClose,
        })
      ),
      el(
        "div",
        { class: "energy-settings-body" },
        // Unit toggle (km/mi)
        el(
          "div",
          { class: "energy-settings-row energy-settings-row-box" },
          el("span", { class: "energy-settings-label" }, t("distanceUnit")),
          el(
            "div",
            { class: "energy-unit-toggle" },
            el("button", {
              class: "energy-unit-btn",
              type: "button",
              "data-unit": "km",
            }, "km"),
            el("button", {
              class: "energy-unit-btn",
              type: "button",
              "data-unit": "mi",
            }, "mi")
          )
        ),
        // Thousand separator toggle
        el(
          "label",
          { class: "energy-settings-row" },
          el("span", { class: "energy-settings-label" }, t("thousandSeparator")),
          el(
            "span",
            { class: "energy-settings-switch" },
            el("input", {
              class: "energy-settings-thousands",
              type: "checkbox",
            }),
            el("span", { class: "energy-settings-slider", "aria-hidden": "true" })
          )
        )
      )
    )
  );

  // Query elements
  const header = panel.querySelector(".energy-header");
  const closeBtn = panel.querySelector(".energy-close");
  const settingsBtn = panel.querySelector(".energy-settings-btn");
  const settingsSheet = panel.querySelector(".energy-settings-sheet");
  const settingsCloseBtn = panel.querySelector(".energy-settings-close");
  const unitBtns = panel.querySelectorAll(".energy-unit-btn");
  const thousandsToggle = panel.querySelector(".energy-settings-thousands");

  const distanceLabel = panel.querySelector('label[for="energy-distance"]');
  const consumptionLabel = panel.querySelector('label[for="energy-consumption"]');
  const distanceInput = panel.querySelector("#energy-distance");
  const consumptionInput = panel.querySelector("#energy-consumption");
  const priceInput = panel.querySelector("#energy-price");
  const distanceSlider = panel.querySelector("#energy-distance-slider");
  const consumptionSlider = panel.querySelector("#energy-consumption-slider");
  const priceSlider = panel.querySelector("#energy-price-slider");
  const distanceError = distanceInput.parentElement.querySelector(".energy-input-error");
  const consumptionError = consumptionInput.parentElement.querySelector(".energy-input-error");
  const priceError = priceInput.parentElement.querySelector(".energy-input-error");

  const kwhResult = panel.querySelector("#energy-kwh-result");
  const costResult = panel.querySelector("#energy-cost-result");

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

  // --- Slider Configuration ---
  function updateSliderRanges() {
    const config = SLIDER_CONFIG[tripSettings.unit];

    distanceSlider.min = config.distance.min;
    distanceSlider.max = config.distance.max;
    distanceSlider.step = config.distance.step;

    consumptionSlider.min = config.consumption.min;
    consumptionSlider.max = config.consumption.max;
    consumptionSlider.step = config.consumption.step;

    priceSlider.min = config.price.min;
    priceSlider.max = config.price.max;
    priceSlider.step = config.price.step;
  }

  function syncSlidersFromValues() {
    const config = SLIDER_CONFIG[tripSettings.unit];

    // Clamp values to slider ranges
    const distVal = parseFloat(values.distance) || 0;
    const consVal = parseFloat(values.consumption) || config.consumption.min;
    const priceVal = parseFloat(values.price) || config.price.min;

    distanceSlider.value = Math.min(Math.max(distVal, config.distance.min), config.distance.max);
    consumptionSlider.value = Math.min(Math.max(consVal, config.consumption.min), config.consumption.max);
    priceSlider.value = Math.min(Math.max(priceVal, config.price.min), config.price.max);
  }

  // --- Settings Sheet ---
  function setSettingsSheetOpen(isOpen) {
    if (isOpen) {
      settingsSheet.hidden = false;
      settingsSheet.setAttribute("aria-hidden", "false");
      syncSettingsForm();
      requestAnimationFrame(() => settingsSheet.classList.add("is-open"));
      return;
    }
    settingsSheet.classList.remove("is-open");
    settingsSheet.setAttribute("aria-hidden", "true");
  }

  settingsSheet.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "transform") return;
    if (!settingsSheet.classList.contains("is-open")) {
      settingsSheet.hidden = true;
    }
  });

  // Prevent drag from capturing settings button clicks
  settingsBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  settingsBtn.addEventListener("click", () => {
    const isOpen = settingsSheet.classList.contains("is-open");
    setSettingsSheetOpen(!isOpen);
  });

  settingsCloseBtn.addEventListener("click", () => {
    setSettingsSheetOpen(false);
  });

  panel.addEventListener("click", (e) => {
    if (!settingsSheet.classList.contains("is-open")) return;
    if (!settingsSheet.contains(e.target) && !settingsBtn.contains(e.target)) {
      setSettingsSheetOpen(false);
    }
  });

  // --- Sync settings form ---
  function syncSettingsForm() {
    // Unit buttons
    unitBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.unit === tripSettings.unit);
    });
    // Thousands toggle
    thousandsToggle.checked = (formatSettings.thousandSeparator ?? "") !== "";
  }

  // --- Unit Toggle ---
  function updateUnitUI() {
    const unit = tripSettings.unit;

    // Update toggle buttons
    unitBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.unit === unit);
    });

    // Update labels
    if (unit === "km") {
      distanceLabel.textContent = t("distanceKm");
      consumptionLabel.textContent = t("consumptionKm");
    } else {
      distanceLabel.textContent = t("distanceMi");
      consumptionLabel.textContent = t("consumptionMi");
    }

    // Update slider ranges
    updateSliderRanges();
    syncSlidersFromValues();
  }

  unitBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tripSettings.unit = btn.dataset.unit;
      saveTripCostSettings(tripSettings);

      // Reset price to 0 when switching units
      values.price = "0";
      saveTripCostValues(values);

      updateUnitUI();
      syncSettingsForm();
      restoreValues();
      calculate();
    });
  });

  // --- Thousands separator toggle ---
  thousandsToggle.addEventListener("change", () => {
    formatSettings.thousandSeparator = thousandsToggle.checked ? "." : "";
    saveCalcSettings(formatSettings);
    // Re-format all inputs with new setting
    reformatAllInputs();
    calculate();
  });

  // --- Input Formatting ---
  function formatInputValue(input, rawValue) {
    if (!rawValue && rawValue !== "0") return "";
    return toDisplay(rawValue, formatSettings);
  }

  function parseInputValue(input) {
    const displayValue = input.value;
    if (!displayValue || displayValue.trim() === "") return "";
    return toRaw(displayValue, formatSettings);
  }

  function reformatAllInputs() {
    // Get raw values
    const rawDistance = values.distance;
    const rawConsumption = values.consumption;
    const rawPrice = values.price;

    // Re-format with new settings
    distanceInput.value = formatInputValue(distanceInput, rawDistance);
    consumptionInput.value = formatInputValue(consumptionInput, rawConsumption);
    priceInput.value = formatInputValue(priceInput, rawPrice);
  }

  // --- Input Validation & Calculation ---
  function parseNumber(rawStr) {
    if (!rawStr || rawStr.trim() === "") return null;
    const num = parseFloat(rawStr);
    if (!Number.isFinite(num)) return NaN;
    return num;
  }

  function validateInput(input, errorEl, rawValue) {
    const val = parseNumber(rawValue);

    if (!rawValue || rawValue.trim() === "") {
      errorEl.textContent = "";
      input.classList.remove("is-invalid");
      return null; // Empty is valid but no value
    }

    if (Number.isNaN(val)) {
      errorEl.textContent = t("invalidNumber");
      input.classList.add("is-invalid");
      return NaN;
    }

    if (val < 0) {
      errorEl.textContent = t("mustBePositive");
      input.classList.add("is-invalid");
      return NaN;
    }

    errorEl.textContent = "";
    input.classList.remove("is-invalid");
    return val;
  }

  function formatResultNumber(value, decimals = 2) {
    if (value === null || Number.isNaN(value)) return "—";
    // Format with fixed decimals then apply thousand separator
    const fixed = value.toFixed(decimals);
    return toDisplay(fixed, formatSettings);
  }

  function formatKwh(value) {
    if (value === null || Number.isNaN(value)) return "—";
    return formatResultNumber(value, 2) + " kWh";
  }

  function formatCost(value) {
    if (value === null || Number.isNaN(value)) return "—";
    return "$ " + formatResultNumber(value, 2);
  }

  function calculate() {
    // Parse raw values from stored data
    const distance = validateInput(distanceInput, distanceError, values.distance);
    const consumption = validateInput(consumptionInput, consumptionError, values.consumption);
    const price = validateInput(priceInput, priceError, values.price);

    // Check if we can calculate
    if (
      distance === null || consumption === null || price === null ||
      Number.isNaN(distance) || Number.isNaN(consumption) || Number.isNaN(price)
    ) {
      kwhResult.textContent = "—";
      costResult.textContent = "—";
      return;
    }

    // Formula: kWh = distance * (consumption / 100)
    // Works for both km and mi since consumption is per 100 units
    const kwhUsed = distance * (consumption / 100);
    const cost = kwhUsed * price;

    kwhResult.textContent = formatKwh(kwhUsed);
    costResult.textContent = formatCost(cost);
  }

  // --- Input event listeners ---
  function handleInputChange(input, slider, valueKey) {
    return () => {
      // Convert display value to raw
      const rawValue = parseInputValue(input);
      values[valueKey] = rawValue;
      saveTripCostValues(values);

      // Sync slider
      const numVal = parseFloat(rawValue) || 0;
      slider.value = numVal;

      calculate();
    };
  }

  function handleInputBlur(input, valueKey) {
    return () => {
      // On blur, reformat the input to ensure consistent display
      const rawValue = values[valueKey];
      if (rawValue && rawValue.trim() !== "") {
        input.value = formatInputValue(input, rawValue);
      }
    };
  }

  function handleSliderChange(slider, input, valueKey) {
    return () => {
      const rawValue = slider.value;
      values[valueKey] = rawValue;
      saveTripCostValues(values);

      // Update input display
      input.value = formatInputValue(input, rawValue);

      calculate();
    };
  }

  // Distance
  distanceInput.addEventListener("input", handleInputChange(distanceInput, distanceSlider, "distance"));
  distanceInput.addEventListener("blur", handleInputBlur(distanceInput, "distance"));
  distanceSlider.addEventListener("input", handleSliderChange(distanceSlider, distanceInput, "distance"));

  // Consumption
  consumptionInput.addEventListener("input", handleInputChange(consumptionInput, consumptionSlider, "consumption"));
  consumptionInput.addEventListener("blur", handleInputBlur(consumptionInput, "consumption"));
  consumptionSlider.addEventListener("input", handleSliderChange(consumptionSlider, consumptionInput, "consumption"));

  // Price
  priceInput.addEventListener("input", handleInputChange(priceInput, priceSlider, "price"));
  priceInput.addEventListener("blur", handleInputBlur(priceInput, "price"));
  priceSlider.addEventListener("input", handleSliderChange(priceSlider, priceInput, "price"));

  // --- Restore saved values ---
  function restoreValues() {
    distanceInput.value = formatInputValue(distanceInput, values.distance);
    consumptionInput.value = formatInputValue(consumptionInput, values.consumption);
    priceInput.value = formatInputValue(priceInput, values.price);
    syncSlidersFromValues();
  }

  // --- Open / Close ---
  function open() {
    // Reload format settings in case they changed in calculator
    formatSettings = loadCalcSettings();

    panel.hidden = false;
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel);
    }
    updateUnitUI();
    restoreValues();
    calculate();
  }

  function close() {
    panel.hidden = true;
    setSettingsSheetOpen(false);
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
  updateSliderRanges();
  updateUnitUI();
  restoreValues();
  calculate();

  return {
    open,
    close,
    toggle,
  };
}
