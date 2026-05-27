/**
 * simple-mode.js
 * Modo simple del calculador de energía - inputs, sliders, cálculo
 */

import { t } from "../../i18n.js";
import { SLIDER_CONFIG } from "../energy-core.js";

/**
 * initSimpleMode - Inicializa el modo simple
 * @param {Object} options
 * @param {EnergyCore} options.core - Instancia de EnergyCore
 * @param {Object} options.tripSettings - Settings de trip (unit)
 * @param {Object} options.values - Valores guardados (distance, consumption, price)
 * @param {HTMLElement} options.distanceLabel - Label de distancia
 * @param {HTMLInputElement} options.distanceInput - Input de distancia
 * @param {HTMLInputElement} options.distanceSlider - Slider de distancia
 * @param {HTMLElement} options.distanceError - Error de distancia
 * @param {HTMLElement} options.consumptionLabel - Label de consumo
 * @param {HTMLInputElement} options.consumptionInput - Input de consumo
 * @param {HTMLInputElement} options.consumptionSlider - Slider de consumo
 * @param {HTMLElement} options.consumptionError - Error de consumo
 * @param {HTMLInputElement} options.priceInput - Input de precio
 * @param {HTMLInputElement} options.priceSlider - Slider de precio
 * @param {HTMLElement} options.priceError - Error de precio
 * @param {HTMLElement} options.kwhResult - Elemento de resultado kWh
 * @param {HTMLElement} options.costResult - Elemento de resultado costo
 * @param {Function} options.onValuesChange - Callback cuando cambian valores
 * @returns {Object} API del modo simple
 */
export function initSimpleMode({
  core,
  tripSettings,
  values,
  distanceLabel,
  distanceInput,
  distanceSlider,
  distanceError,
  consumptionLabel,
  consumptionInput,
  consumptionSlider,
  consumptionError,
  priceInput,
  priceSlider,
  priceError,
  kwhResult,
  costResult,
  onValuesChange,
}) {
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

    const distVal = parseFloat(values.distance) || 0;
    const consVal = parseFloat(values.consumption) || config.consumption.min;
    const priceVal = parseFloat(values.price) || config.price.min;

    distanceSlider.value = Math.min(Math.max(distVal, config.distance.min), config.distance.max);
    consumptionSlider.value = Math.min(Math.max(consVal, config.consumption.min), config.consumption.max);
    priceSlider.value = Math.min(Math.max(priceVal, config.price.min), config.price.max);
  }

  function restoreValues() {
    distanceInput.value = core.formatInputValue(values.distance);
    consumptionInput.value = core.formatInputValue(values.consumption);
    priceInput.value = core.formatInputValue(values.price);
    syncSlidersFromValues();
  }

  function reformatAllInputs() {
    distanceInput.value = core.formatInputValue(values.distance);
    consumptionInput.value = core.formatInputValue(values.consumption);
    priceInput.value = core.formatInputValue(values.price);
  }

  function updateUnitUI() {
    const unit = tripSettings.unit;

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

  function validateInput(input, errorEl, rawValue) {
    const result = core.validateInput(rawValue);

    if (!rawValue || rawValue.trim() === "") {
      errorEl.textContent = "";
      input.classList.remove("is-invalid");
      return null;
    }

    if (!result.valid) {
      errorEl.textContent = result.error || "";
      input.classList.add("is-invalid");
      return NaN;
    }

    errorEl.textContent = "";
    input.classList.remove("is-invalid");
    return result.value;
  }

  function calculate() {
    // Validate inputs
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

    // Calculate
    const { kwhUsed, cost } = core.calculateTrip(distance, consumption, price);
    kwhResult.textContent = core.formatKwh(kwhUsed);
    costResult.textContent = core.formatCost(cost);
  }

  // Input event handlers
  function handleInputChange(input, slider, valueKey) {
    return () => {
      const rawValue = core.parseInputValue(input.value);
      values[valueKey] = rawValue;
      onValuesChange(values);

      // Sync slider
      const numVal = parseFloat(rawValue) || 0;
      slider.value = numVal;

      calculate();
    };
  }

  function handleInputBlur(valueKey) {
    return () => {
      const rawValue = values[valueKey];
      if (rawValue && rawValue.trim() !== "") {
        if (valueKey === "distance") {
          distanceInput.value = core.formatInputValue(rawValue);
        } else if (valueKey === "consumption") {
          consumptionInput.value = core.formatInputValue(rawValue);
        } else if (valueKey === "price") {
          priceInput.value = core.formatInputValue(rawValue);
        }
      }
    };
  }

  function handleSliderChange(slider, input, valueKey) {
    return () => {
      const rawValue = slider.value;
      values[valueKey] = rawValue;
      onValuesChange(values);

      input.value = core.formatInputValue(rawValue);

      calculate();
    };
  }

  // Setup event listeners
  distanceInput.addEventListener("input", handleInputChange(distanceInput, distanceSlider, "distance"));
  distanceInput.addEventListener("blur", handleInputBlur("distance"));
  distanceSlider.addEventListener("input", handleSliderChange(distanceSlider, distanceInput, "distance"));

  consumptionInput.addEventListener("input", handleInputChange(consumptionInput, consumptionSlider, "consumption"));
  consumptionInput.addEventListener("blur", handleInputBlur("consumption"));
  consumptionSlider.addEventListener("input", handleSliderChange(consumptionSlider, consumptionInput, "consumption"));

  priceInput.addEventListener("input", handleInputChange(priceInput, priceSlider, "price"));
  priceInput.addEventListener("blur", handleInputBlur("price"));
  priceSlider.addEventListener("input", handleSliderChange(priceSlider, priceInput, "price"));

  return {
    updateSliderRanges,
    syncSlidersFromValues,
    restoreValues,
    reformatAllInputs,
    updateUnitUI,
    calculate,
  };
}
