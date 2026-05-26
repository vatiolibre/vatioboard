/**
 * panel.js
 * Construcción del DOM para el panel de energía
 */

import { el } from "../../calculator/dom.js";
import { t } from "../../i18n.js";
import { IconSettings, IconClose } from "../../icons.js";

type ToolbarButtonOptions = {
  className: string;
  icon?: string;
  ariaLabel?: string;
  ariaKey?: string;
  label: string;
  labelKey: string;
  mode?: string | null;
};

function makeToolbarButton({
  className,
  icon = "",
  ariaLabel,
  ariaKey,
  label,
  labelKey,
  mode = null,
}: ToolbarButtonOptions) {
  const attrs: Record<string, string> = {
    class: `energy-toolbar-btn ${className}`,
    type: "button",
  };

  if (ariaLabel) {
    attrs["aria-label"] = ariaLabel;
  }

  if (ariaKey) {
    attrs["data-i18n-aria"] = ariaKey;
  }

  if (mode) {
    attrs["data-mode"] = mode;
  }

  return el(
    "button",
    attrs,
    icon
      ? el("span", { class: "energy-toolbar-btn-icon", "aria-hidden": "true", html: icon })
      : null,
    el("span", { class: "energy-toolbar-btn-label", "data-i18n": labelKey }, label)
  );
}

/**
 * buildPanel - Construye el panel completo y retorna referencias a elementos
 * @returns {Object} Referencias a todos los elementos del panel
 */
export function buildPanel() {
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
      el(
        "div",
        { class: "energy-header-main" },
        el("div", { class: "energy-header-grip", "aria-hidden": "true" })
      ),
      el("button", {
        class: "energy-close",
        type: "button",
        "aria-label": t("close"),
        "data-i18n-aria": "close",
        title: t("close"),
        html: IconClose,
      })
    ),
    // Toolbar row
    el(
      "div",
      { class: "energy-toolbar-row" },
      makeToolbarButton({
        className: "energy-mode-btn",
        label: t("simple") || "Simple",
        labelKey: "simple",
        mode: "simple",
      }),
      makeToolbarButton({
        className: "energy-mode-btn",
        label: t("multiTrip") || "Multi-tramo",
        labelKey: "multiTrip",
        mode: "multi",
      }),
      makeToolbarButton({
        className: "energy-settings-btn",
        icon: IconSettings,
        ariaLabel: t("settings"),
        ariaKey: "settings",
        label: t("settings"),
        labelKey: "settings",
      })
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

  // Query all elements and return refs
  const distanceInput = panel.querySelector<HTMLInputElement>("#energy-distance");
  const consumptionInput = panel.querySelector<HTMLInputElement>("#energy-consumption");
  const priceInput = panel.querySelector<HTMLInputElement>("#energy-price");

  return {
    panel,
    header: panel.querySelector<HTMLElement>(".energy-header"),
    closeBtn: panel.querySelector<HTMLButtonElement>(".energy-close"),
    settingsBtn: panel.querySelector<HTMLButtonElement>(".energy-settings-btn"),

    // Settings sheet refs
    settingsSheet: panel.querySelector<HTMLElement>(".energy-settings-sheet"),
    settingsCloseBtn: panel.querySelector<HTMLButtonElement>(".energy-settings-close"),
    unitBtns: panel.querySelectorAll<HTMLButtonElement>(".energy-unit-btn"),
    thousandsToggle: panel.querySelector<HTMLInputElement>(".energy-settings-thousands"),

    // Mode switch
    modeBtns: panel.querySelectorAll<HTMLButtonElement>(".energy-mode-btn"),
    simpleView: panel.querySelector<HTMLElement>(".energy-simple-view"),
    multiView: panel.querySelector<HTMLElement>(".energy-multi-view"),

    // Simple mode refs
    distanceLabel: panel.querySelector<HTMLLabelElement>('label[for="energy-distance"]'),
    distanceInput,
    distanceSlider: panel.querySelector<HTMLInputElement>("#energy-distance-slider"),
    distanceError: distanceInput.parentElement.querySelector<HTMLElement>(".energy-input-error"),

    consumptionLabel: panel.querySelector<HTMLLabelElement>('label[for="energy-consumption"]'),
    consumptionInput,
    consumptionSlider: panel.querySelector<HTMLInputElement>("#energy-consumption-slider"),
    consumptionError: consumptionInput.parentElement.querySelector<HTMLElement>(".energy-input-error"),

    priceInput,
    priceSlider: panel.querySelector<HTMLInputElement>("#energy-price-slider"),
    priceError: priceInput.parentElement.querySelector<HTMLElement>(".energy-input-error"),

    kwhResult: panel.querySelector<HTMLElement>("#energy-kwh-result"),
    costResult: panel.querySelector<HTMLElement>("#energy-cost-result"),

    // Multi-trip refs
    tripsContainer: panel.querySelector<HTMLElement>(".energy-trips-container"),
    resetAllBtn: panel.querySelector<HTMLButtonElement>(".energy-reset-all-btn"),
    multiTotalValue: panel.querySelector<HTMLElement>("#energy-multi-total"),

    multiTripNameInput: panel.querySelector<HTMLInputElement>("#energy-multi-trip-name"),
    multiDistanceInput: panel.querySelector<HTMLInputElement>("#energy-multi-distance"),
    multiDistanceSlider: panel.querySelector<HTMLInputElement>("#energy-multi-distance-slider"),
    multiDistanceLabel: panel.querySelector<HTMLLabelElement>("#energy-multi-distance-label"),

    multiConsumptionInput: panel.querySelector<HTMLInputElement>("#energy-multi-consumption"),
    multiConsumptionSlider: panel.querySelector<HTMLInputElement>("#energy-multi-consumption-slider"),
    multiConsumptionLabel: panel.querySelector<HTMLLabelElement>("#energy-multi-consumption-label"),

    multiPriceInput: panel.querySelector<HTMLInputElement>("#energy-multi-price"),
    multiPriceSlider: panel.querySelector<HTMLInputElement>("#energy-multi-price-slider"),

    multiSaveBtn: panel.querySelector<HTMLButtonElement>(".energy-multi-save-btn"),
    multiCancelBtn: panel.querySelector<HTMLButtonElement>(".energy-multi-cancel-btn"),

    // Modal refs
    modal: panel.querySelector<HTMLElement>(".energy-modal"),
    modalMessage: panel.querySelector<HTMLElement>("#energy-modal-message"),
    modalCancelBtn: panel.querySelector<HTMLButtonElement>(".energy-modal-cancel"),
    modalConfirmBtn: panel.querySelector<HTMLButtonElement>(".energy-modal-confirm"),
  };
}
