import { el } from "../calculator/dom.js";
import { t } from "../i18n.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import { IconSettings, IconClose } from "../icons.js";
import {
  loadTripCostSettings,
  saveTripCostSettings,
  loadTripCostValues,
  saveTripCostValues,
  loadMultiTrips,
  saveMultiTrips,
  createNewTrip,
  clearAllTrips,
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
  let multiTrips = loadMultiTrips();
  // Shared format settings (from calculator)
  let formatSettings = loadCalcSettings();

  // Multi-trip editing state
  let editingTripId = null;

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
    {
      class: "energy-panel",
      hidden: true,
      role: "dialog",
      "aria-label": t("energyTitle"),
      "data-i18n-aria": "energyTitle",
    },
    // Header
    el(
      "div",
      { class: "energy-header" },
      el("div", { class: "energy-title", "data-i18n": "energyTitle" }, t("energyTitle")),
      el("button", {
        class: "energy-icon-btn energy-settings-btn",
        type: "button",
        "aria-label": t("settings"),
        "data-i18n-aria": "settings",
        html: IconSettings,
      }),
      el("div", { class: "energy-spacer" }),
      el("button", {
        class: "energy-icon-btn energy-close",
        type: "button",
        "aria-label": t("close"),
        "data-i18n-aria": "close",
        html: IconClose,
      })
    ),
    // Mode switch
    el(
      "div",
      { class: "energy-mode-switch" },
      el("button", {
        class: "energy-mode-btn",
        type: "button",
        "data-mode": "simple",
        "data-i18n": "simple",
      }, t("simple") || "Simple"),
      el("button", {
        class: "energy-mode-btn",
        type: "button",
        "data-mode": "multi",
        "data-i18n": "multiTrip",
      }, t("multiTrip") || "Multi-tramo")
    ),
    // Simple mode view
    el("div", { class: "energy-simple-view" },
      // Body with inputs (for simple mode)
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
        el("label", { class: "energy-label", for: "energy-price", "data-i18n": "electricityPrice" }, t("electricityPrice")),
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
        el("span", { class: "energy-result-label", "data-i18n": "energyUsed" }, t("energyUsed")),
        el("span", { class: "energy-result-value", id: "energy-kwh-result" }, "—")
      ),
      el(
        "div",
        { class: "energy-result-row energy-result-total" },
        el("span", { class: "energy-result-label", "data-i18n": "estimatedCost" }, t("estimatedCost")),
        el("span", { class: "energy-result-value", id: "energy-cost-result" }, "—")
      )
      )
      )
    ),
    // Multi-trip mode view
    el("div", { class: "energy-multi-view", hidden: true },
      // Left sidebar (Editor)
      el("div", { class: "energy-multi-sidebar" },
        el("div", { class: "energy-multi-form-title", "data-i18n": "tripEditor" }, t("tripEditor") || "Trip Editor"),
        // Trip name input
        el(
          "div",
          { class: "energy-input-group" },
          el("label", { class: "energy-label", "data-i18n": "tripName" }, t("tripName") || "Trip name"),
          el("input", {
            class: "energy-input",
            id: "energy-multi-trip-name",
            type: "text",
            placeholder: t("tripPlaceholder"),
            spellcheck: "false",
          })
        ),
        // Distance input
        el(
          "div",
          { class: "energy-input-group" },
          el("label", { class: "energy-label", id: "energy-multi-distance-label" }),
          el("input", {
            class: "energy-input",
            id: "energy-multi-distance",
            type: "text",
            inputmode: "decimal",
            autocomplete: "off",
            spellcheck: "false",
            placeholder: "0",
          }),
          el("input", {
            class: "energy-slider",
            id: "energy-multi-distance-slider",
            type: "range",
          })
        ),
        // Consumption input
        el(
          "div",
          { class: "energy-input-group" },
          el("label", { class: "energy-label", id: "energy-multi-consumption-label" }),
          el("input", {
            class: "energy-input",
            id: "energy-multi-consumption",
            type: "text",
            inputmode: "decimal",
            autocomplete: "off",
            spellcheck: "false",
            placeholder: "0",
          }),
          el("input", {
            class: "energy-slider",
            id: "energy-multi-consumption-slider",
            type: "range",
          })
        ),
        // Price input
        el(
          "div",
          { class: "energy-input-group" },
          el("label", { class: "energy-label", "data-i18n": "electricityPrice" }, t("electricityPrice")),
          el("input", {
            class: "energy-input",
            id: "energy-multi-price",
            type: "text",
            inputmode: "decimal",
            autocomplete: "off",
            spellcheck: "false",
            placeholder: "0",
          }),
          el("input", {
            class: "energy-slider",
            id: "energy-multi-price-slider",
            type: "range",
          })
        ),
        // Action buttons
        el("div", { class: "energy-multi-actions" },
          el("button", {
            class: "energy-multi-save-btn",
            type: "button",
          }, t("addTrip") || "Add Trip"),
          el("button", {
            class: "energy-multi-cancel-btn",
            type: "button",
            hidden: true,
            "data-i18n": "cancel",
          }, t("cancel"))
        )
      ),
      // Right side: trips list + footer
      el("div", { class: "energy-multi-right" },
        el("div", { class: "energy-trips-container" }),
        el("div", { class: "energy-multi-footer" },
          el("div", { class: "energy-multi-total" },
            el("div", { class: "energy-multi-total-label", "data-i18n": "total" }, t("total") || "Total"),
            el("div", { class: "energy-multi-total-value", id: "energy-multi-total" }, "—")
          ),
          el("button", {
            class: "energy-reset-all-btn",
            type: "button",
            "data-i18n": "resetAll",
          }, t("resetAll") || "Reiniciar todo")
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
        el("span", { "data-i18n": "settings" }, t("settings")),
        el("button", {
          class: "energy-icon-btn energy-settings-close",
          type: "button",
          "aria-label": t("close"),
          "data-i18n-aria": "close",
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
          el("span", { class: "energy-settings-label", "data-i18n": "distanceUnit" }, t("distanceUnit")),
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
          el("span", { class: "energy-settings-label", "data-i18n": "thousandSeparator" }, t("thousandSeparator")),
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
    ),
    // Confirm modal
    el("div", { class: "energy-modal", hidden: true },
      el("div", { class: "energy-modal-overlay" }),
      el("div", { class: "energy-modal-content" },
        el("div", { class: "energy-modal-message", id: "energy-modal-message" }),
        el("div", { class: "energy-modal-actions" },
          el("button", {
            class: "energy-modal-btn energy-modal-cancel",
            type: "button",
            "data-i18n": "cancel",
          }, t("cancel")),
          el("button", {
            class: "energy-modal-btn energy-modal-confirm",
            type: "button",
          }, t("delete"))
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

  // Multi-trip elements
  const modeBtns = panel.querySelectorAll(".energy-mode-btn");
  const simpleView = panel.querySelector(".energy-simple-view");
  const multiView = panel.querySelector(".energy-multi-view");
  const tripsContainer = panel.querySelector(".energy-trips-container");
  const resetAllBtn = panel.querySelector(".energy-reset-all-btn");
  const multiTotalValue = panel.querySelector("#energy-multi-total");

  // Multi-trip form elements
  const multiTripNameInput = panel.querySelector("#energy-multi-trip-name");
  const multiDistanceInput = panel.querySelector("#energy-multi-distance");
  const multiConsumptionInput = panel.querySelector("#energy-multi-consumption");
  const multiPriceInput = panel.querySelector("#energy-multi-price");
  const multiDistanceSlider = panel.querySelector("#energy-multi-distance-slider");
  const multiConsumptionSlider = panel.querySelector("#energy-multi-consumption-slider");
  const multiPriceSlider = panel.querySelector("#energy-multi-price-slider");
  const multiDistanceLabel = panel.querySelector("#energy-multi-distance-label");
  const multiConsumptionLabel = panel.querySelector("#energy-multi-consumption-label");
  const multiSaveBtn = panel.querySelector(".energy-multi-save-btn");
  const multiCancelBtn = panel.querySelector(".energy-multi-cancel-btn");

  // Modal elements
  const modal = panel.querySelector(".energy-modal");
  const modalMessage = panel.querySelector("#energy-modal-message");
  const modalCancelBtn = panel.querySelector(".energy-modal-cancel");
  const modalConfirmBtn = panel.querySelector(".energy-modal-confirm");

  // Modal functions
  let modalCallback = null;

  function showModal(message, confirmText, onConfirm) {
    modalMessage.textContent = message;
    modalConfirmBtn.textContent = confirmText;
    modalCallback = onConfirm;
    modal.hidden = false;
  }

  function hideModal() {
    modal.hidden = true;
    modalCallback = null;
  }

  modalCancelBtn.addEventListener("click", () => {
    hideModal();
  });

  modalConfirmBtn.addEventListener("click", () => {
    if (modalCallback) {
      modalCallback();
    }
    hideModal();
  });

  // Close modal on overlay click
  modal.querySelector(".energy-modal-overlay").addEventListener("click", () => {
    hideModal();
  });

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

  // --- Multi-Trip Mode ---
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
          if (editingTripId === trip.id) {
            clearMultiForm();
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
    calculateMultiTotal();
  }

  // Setup multi-trip form sliders
  function updateMultiSliderRanges() {
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

  // Clear multi-trip form
  function clearMultiForm() {
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

  // Load trip to form for editing
  function loadTripToForm(tripId) {
    const trip = multiTrips.find(t => t.id === tripId);
    if (!trip) return;

    editingTripId = tripId;
    multiTripNameInput.value = trip.name;
    multiDistanceInput.value = formatInputValue(multiDistanceInput, trip.distance);
    multiConsumptionInput.value = formatInputValue(multiConsumptionInput, trip.consumption);
    multiPriceInput.value = formatInputValue(multiPriceInput, trip.price);

    const config = SLIDER_CONFIG[tripSettings.unit];
    multiDistanceSlider.value = Math.min(Math.max(parseFloat(trip.distance) || 0, config.distance.min), config.distance.max);
    multiConsumptionSlider.value = Math.min(Math.max(parseFloat(trip.consumption) || config.consumption.min, config.consumption.min), config.consumption.max);
    multiPriceSlider.value = Math.min(Math.max(parseFloat(trip.price) || config.price.min, config.price.min), config.price.max);

    multiSaveBtn.textContent = t("updateTrip");
    multiCancelBtn.hidden = false;
    validateMultiForm();

    renderTrips();
  }

  // Save/update trip from form
  function saveMultiForm() {
    const name = multiTripNameInput.value.trim() ||
      t("tripDefaultName").replace("{n}", multiTrips.length + 1);
    const distance = parseInputValue(multiDistanceInput);
    const consumption = parseInputValue(multiConsumptionInput);
    const price = parseInputValue(multiPriceInput);

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
    clearMultiForm();
    renderTrips();
  }

  // Validate multi-form fields
  function validateMultiForm() {
    const distance = parseInputValue(multiDistanceInput);
    const consumption = parseInputValue(multiConsumptionInput);
    const price = parseInputValue(multiPriceInput);

    const distanceNum = parseFloat(distance) || 0;
    const consumptionNum = parseFloat(consumption) || 0;
    const priceNum = parseFloat(price) || 0;

    const isValid = distanceNum > 0 && consumptionNum > 0 && priceNum > 0;

    multiSaveBtn.disabled = !isValid;

    return isValid;
  }

  // Multi-form input handlers
  function handleMultiInput(input, slider) {
    input.addEventListener("input", () => {
      const rawValue = parseInputValue(input);
      const numVal = parseFloat(rawValue) || 0;
      slider.value = numVal;
      validateMultiForm();
    });
    input.addEventListener("blur", () => {
      const rawValue = parseInputValue(input);
      if (rawValue && rawValue.trim() !== "") {
        input.value = formatInputValue(input, rawValue);
      }
    });
  }

  function handleMultiSlider(slider, input) {
    slider.addEventListener("input", () => {
      const rawValue = slider.value;
      input.value = formatInputValue(input, rawValue);
      validateMultiForm();
    });
  }

  handleMultiInput(multiDistanceInput, multiDistanceSlider);
  handleMultiInput(multiConsumptionInput, multiConsumptionSlider);
  handleMultiInput(multiPriceInput, multiPriceSlider);
  handleMultiSlider(multiDistanceSlider, multiDistanceInput);
  handleMultiSlider(multiConsumptionSlider, multiConsumptionInput);
  handleMultiSlider(multiPriceSlider, multiPriceInput);

  // Save button
  multiSaveBtn.addEventListener("click", () => {
    saveMultiForm();
  });

  // Cancel button
  multiCancelBtn.addEventListener("click", () => {
    clearMultiForm();
  });

  function calculateMultiTotal() {
    let total = 0;
    multiTrips.forEach((trip) => {
      const distance = parseNumber(trip.distance);
      const consumption = parseNumber(trip.consumption);
      const price = parseNumber(trip.price);

      if (distance !== null && consumption !== null && price !== null &&
          !Number.isNaN(distance) && !Number.isNaN(consumption) && !Number.isNaN(price)) {
        const kwhUsed = distance * (consumption / 100);
        const cost = kwhUsed * price;

        // Update trip subtotal in UI
        const tripEl = tripsContainer.querySelector(`[data-trip-id="${trip.id}"]`);
        if (tripEl) {
          const subtotalEl = tripEl.querySelector(".energy-trip-card-subtotal");
          subtotalEl.textContent = formatCost(cost);
        }

        total += cost;
      } else {
        // Update trip subtotal to show dash if incomplete
        const tripEl = tripsContainer.querySelector(`[data-trip-id="${trip.id}"]`);
        if (tripEl) {
          const subtotalEl = tripEl.querySelector(".energy-trip-card-subtotal");
          subtotalEl.textContent = "—";
        }
      }
    });

    multiTotalValue.textContent = total > 0 ? formatCost(total) : "—";
  }

  // Mode switch
  function setMode(mode) {
    tripSettings.mode = mode;
    saveTripCostSettings(tripSettings);

    // Update button states
    modeBtns.forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });

    if (mode === "simple") {
      simpleView.hidden = false;
      multiView.hidden = true;
      panel.classList.remove("is-multi-mode");
    } else {
      simpleView.hidden = true;
      multiView.hidden = false;
      panel.classList.add("is-multi-mode");
      // Initialize form
      updateMultiSliderRanges();
      clearMultiForm();
      renderTrips();
    }

    // Reposition panel to keep it in viewport after width change
    setTimeout(() => {
      if (panel.style.left && panel.style.top) {
        clampElementToViewport(panel);
      }
    }, 50);
  }

  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.mode);
    });
  });

  // Reset all
  resetAllBtn.addEventListener("click", () => {
    showModal(t("deleteAllTripsConfirm"), t("deleteAll"), () => {
      clearAllTrips();
      multiTrips = [];
      clearMultiForm();
      renderTrips();
    });
  });

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

    // If in multi-trip mode, update form and re-render trips
    if (tripSettings.mode === "multi") {
      updateMultiSliderRanges();
      renderTrips();
    }
  }

  function refreshI18n() {
    updateUnitUI();
    multiSaveBtn.textContent = editingTripId ? t("updateTrip") : t("addTrip");
    multiTripNameInput.placeholder = t("tripPlaceholder");
    calculate();
  }

  unitBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tripSettings.unit = btn.dataset.unit;
      saveTripCostSettings(tripSettings);

      // Reset price to 0 when switching units (simple mode)
      values.price = "0";
      saveTripCostValues(values);

      // Reset prices in multi-trip mode
      multiTrips.forEach(trip => {
        trip.price = "0";
      });
      saveMultiTrips(multiTrips);

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

    // Restore mode
    setMode(tripSettings.mode);
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
  setMode(tripSettings.mode);
  refreshI18n();

  document.addEventListener("i18n:change", refreshI18n);

  return {
    open,
    close,
    toggle,
  };
}
