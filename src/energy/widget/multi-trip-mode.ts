/**
 * multi-trip-mode.js
 * Modo multi-trip del calculador de energía - editor, lista, totales
 */

import { el } from "../../calculator/dom.js";
import { t } from "../../i18n.js";
import { SLIDER_CONFIG } from "../energy-core.js";
import { saveMultiTrips, createNewTrip } from "../trip-cost-storage.js";

/**
 * initMultiTripMode - Inicializa el modo multi-trip
 * @param {Object} options
 * @param {EnergyCore} options.core - Instancia de EnergyCore
 * @param {Object} options.tripSettings - Settings de trip (unit)
 * @param {Array} options.multiTrips - Array de trips (mutable)
 * @param {HTMLElement} options.tripsContainer - Contenedor de trips
 * @param {HTMLElement} options.multiTotalValue - Elemento de total
 * @param {HTMLElement} options.resetAllBtn - Botón de reset all
 * @param {HTMLInputElement} options.multiTripNameInput - Input de nombre
 * @param {HTMLInputElement} options.multiDistanceInput - Input de distancia
 * @param {HTMLInputElement} options.multiDistanceSlider - Slider de distancia
 * @param {HTMLElement} options.multiDistanceLabel - Label de distancia
 * @param {HTMLInputElement} options.multiConsumptionInput - Input de consumo
 * @param {HTMLInputElement} options.multiConsumptionSlider - Slider de consumo
 * @param {HTMLElement} options.multiConsumptionLabel - Label de consumo
 * @param {HTMLInputElement} options.multiPriceInput - Input de precio
 * @param {HTMLInputElement} options.multiPriceSlider - Slider de precio
 * @param {HTMLElement} options.multiSaveBtn - Botón de guardar
 * @param {HTMLElement} options.multiCancelBtn - Botón de cancelar
 * @param {Function} options.onTripsChange - Callback cuando cambian trips
 * @param {Function} options.showModal - Función para mostrar modal
 * @returns {Object} API del modo multi-trip
 */
export function initMultiTripMode({
  core,
  tripSettings,
  multiTrips,
  tripsContainer,
  multiTotalValue,
  resetAllBtn,
  multiTripNameInput,
  multiDistanceInput,
  multiDistanceSlider,
  multiDistanceLabel,
  multiConsumptionInput,
  multiConsumptionSlider,
  multiConsumptionLabel,
  multiPriceInput,
  multiPriceSlider,
  multiSaveBtn,
  multiCancelBtn,
  onTripsChange,
  showModal,
}) {
  let editingTripId = null;

  function updateSliderRanges() {
    const config = SLIDER_CONFIG[tripSettings.unit];

    multiDistanceSlider.min = config.distance.min;
    multiDistanceSlider.max = config.distance.max;
    multiDistanceSlider.step = config.distance.step;

    multiConsumptionSlider.min = config.consumption.min;
    multiConsumptionSlider.max = config.consumption.max;
    multiConsumptionSlider.step = config.consumption.step;

    multiPriceSlider.min = config.price.min;
    multiPriceSlider.max = config.price.max;
    multiPriceSlider.step = config.price.step;

    // Update labels
    multiDistanceLabel.textContent = tripSettings.unit === "km" ? t("distanceKm") : t("distanceMi");
    multiConsumptionLabel.textContent = tripSettings.unit === "km" ? t("consumptionKm") : t("consumptionMi");
  }

  function clearForm() {
    editingTripId = null;
    multiTripNameInput.value = "";
    multiDistanceInput.value = "";
    multiConsumptionInput.value = "";
    multiPriceInput.value = "";
    multiDistanceSlider.value = 0;
    multiConsumptionSlider.value = SLIDER_CONFIG[tripSettings.unit].consumption.min;
    multiPriceSlider.value = SLIDER_CONFIG[tripSettings.unit].price.min;
    multiSaveBtn.textContent = t("addTrip") || "Add Trip";
    multiSaveBtn.disabled = true;
    multiCancelBtn.hidden = true;
    renderTrips();
  }

  function loadTripToForm(tripId) {
    const trip = multiTrips.find(t => t.id === tripId);
    if (!trip) return;

    editingTripId = tripId;
    multiTripNameInput.value = trip.name;
    multiDistanceInput.value = core.formatInputValue(trip.distance);
    multiConsumptionInput.value = core.formatInputValue(trip.consumption);
    multiPriceInput.value = core.formatInputValue(trip.price);

    const config = SLIDER_CONFIG[tripSettings.unit];
    multiDistanceSlider.value = Math.min(Math.max(parseFloat(trip.distance) || 0, config.distance.min), config.distance.max);
    multiConsumptionSlider.value = Math.min(Math.max(parseFloat(trip.consumption) || config.consumption.min, config.consumption.min), config.consumption.max);
    multiPriceSlider.value = Math.min(Math.max(parseFloat(trip.price) || config.price.min, config.price.min), config.price.max);

    multiSaveBtn.textContent = t("updateTrip");
    multiCancelBtn.hidden = false;
    validateForm();

    renderTrips();
  }

  function saveForm() {
    const name = multiTripNameInput.value.trim() ||
      t("tripDefaultName").replace("{n}", multiTrips.length + 1);
    const distance = core.parseInputValue(multiDistanceInput.value);
    const consumption = core.parseInputValue(multiConsumptionInput.value);
    const price = core.parseInputValue(multiPriceInput.value);

    if (editingTripId) {
      // Update existing trip
      const trip = multiTrips.find(t => t.id === editingTripId);
      if (trip) {
        trip.name = name;
        trip.distance = distance;
        trip.consumption = consumption;
        trip.price = price;
      }
    } else {
      // Create new trip
      if (multiTrips.length >= 5) {
        alert(t("maxTrips"));
        return;
      }
      const newTrip = createNewTrip(multiTrips.length + 1);
      newTrip.name = name;
      newTrip.distance = distance;
      newTrip.consumption = consumption;
      newTrip.price = price;
      multiTrips.push(newTrip);
    }

    saveMultiTrips(multiTrips);
    onTripsChange(multiTrips);
    clearForm();
    renderTrips();
  }

  function validateForm() {
    const distance = core.parseInputValue(multiDistanceInput.value);
    const consumption = core.parseInputValue(multiConsumptionInput.value);
    const price = core.parseInputValue(multiPriceInput.value);

    const distanceNum = parseFloat(distance) || 0;
    const consumptionNum = parseFloat(consumption) || 0;
    const priceNum = parseFloat(price) || 0;

    const isValid = distanceNum > 0 && consumptionNum > 0 && priceNum > 0;

    multiSaveBtn.disabled = !isValid;

    return isValid;
  }

  function handleMultiInput(input, slider) {
    input.addEventListener("input", () => {
      const rawValue = core.parseInputValue(input.value);
      const numVal = parseFloat(rawValue) || 0;
      slider.value = numVal;
      validateForm();
    });
    input.addEventListener("blur", () => {
      const rawValue = core.parseInputValue(input.value);
      if (rawValue && rawValue.trim() !== "") {
        input.value = core.formatInputValue(rawValue);
      }
    });
  }

  function handleMultiSlider(slider, input) {
    slider.addEventListener("input", () => {
      const rawValue = slider.value;
      input.value = core.formatInputValue(rawValue);
      validateForm();
    });
  }

  // Setup input/slider handlers
  handleMultiInput(multiDistanceInput, multiDistanceSlider);
  handleMultiInput(multiConsumptionInput, multiConsumptionSlider);
  handleMultiInput(multiPriceInput, multiPriceSlider);
  handleMultiSlider(multiDistanceSlider, multiDistanceInput);
  handleMultiSlider(multiConsumptionSlider, multiConsumptionInput);
  handleMultiSlider(multiPriceSlider, multiPriceInput);

  // Save button
  multiSaveBtn.addEventListener("click", () => {
    saveForm();
  });

  // Cancel button
  multiCancelBtn.addEventListener("click", () => {
    clearForm();
  });

  // Reset all button
  resetAllBtn.addEventListener("click", () => {
    showModal(t("deleteAllTripsConfirm"), t("deleteAll"), () => {
      multiTrips.length = 0; // Clear array in-place
      saveMultiTrips(multiTrips);
      onTripsChange(multiTrips);
      clearForm();
      renderTrips();
    });
  });

  function createTripElement(trip) {
    const tripEl = el(
      "div",
      { class: "energy-trip-item", "data-trip-id": trip.id },
      el(
        "div",
        { class: "energy-trip-card" },
        el("div", { class: "energy-trip-card-name" }, trip.name),
        el("div", { class: "energy-trip-card-subtotal" }, "—"),
        el("button", {
          class: "energy-trip-delete",
          type: "button",
          "aria-label": t("delete"),
          "data-i18n-aria": "delete",
        }, "✕")
      )
    );

    // Event listeners
    const card = tripEl.querySelector(".energy-trip-card");
    const deleteBtn = tripEl.querySelector(".energy-trip-delete");

    // Click to edit
    card.addEventListener("click", (e) => {
      if (e.target === deleteBtn) return;
      loadTripToForm(trip.id);
    });

    // Delete
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showModal(t("deleteTripConfirm").replace("{name}", trip.name), t("delete"), () => {
        const index = multiTrips.findIndex(t => t.id === trip.id);
        if (index !== -1) {
          multiTrips.splice(index, 1);
          saveMultiTrips(multiTrips);
          onTripsChange(multiTrips);
          if (editingTripId === trip.id) {
            clearForm();
          }
          renderTrips();
        }
      });
    });

    return tripEl;
  }

  function renderTrips() {
    tripsContainer.innerHTML = "";
    multiTrips.forEach((trip) => {
      const tripEl = createTripElement(trip);
      // Mark as active if editing
      if (editingTripId === trip.id) {
        tripEl.classList.add("is-active");
      }
      tripsContainer.appendChild(tripEl);
    });
    calculateTotal();
  }

  function calculateTotal() {
    const { total, tripCosts } = core.calculateMultiTotal(multiTrips);

    // Update trip subtotals in UI
    multiTrips.forEach((trip) => {
      const tripEl = tripsContainer.querySelector(`[data-trip-id="${trip.id}"]`);
      if (tripEl) {
        const subtotalEl = tripEl.querySelector(".energy-trip-card-subtotal");
        const costData = tripCosts.get(trip.id);
        subtotalEl.textContent = costData ? core.formatCost(costData.cost) : "—";
      }
    });

    multiTotalValue.textContent = total > 0 ? core.formatCost(total) : "—";
  }

  function refreshI18n() {
    multiSaveBtn.textContent = editingTripId ? t("updateTrip") : t("addTrip");
    multiTripNameInput.placeholder = t("tripPlaceholder");
    updateSliderRanges();
  }

  return {
    renderTrips,
    clearForm,
    updateSliderRanges,
    calculateTotal,
    refreshI18n,
    getEditingTripId: () => editingTripId,
  };
}
