import { el } from "../dom.js";
import { IconHistory, IconSettings, IconClose, IconEnergy, IconMinimize } from "../../icons.js";
import { createSettingsSwitch } from "../../shared/ui/settings-controls.js";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

type UtilityButtonOptions = {
  className: string;
  icon: string;
  ariaLabel: string;
  ariaKey: string;
  label: string;
  labelKey: string;
};

type PanelOptions = {
  t: TranslateFn;
  isTouchLike: boolean;
  showEnergyTool?: boolean;
};

function makeUtilityBtn({ className, icon, ariaLabel, ariaKey, label, labelKey }: UtilityButtonOptions) {
  return el(
    "button",
    {
      class: `calc-utility-btn ${className}`,
      type: "button",
      "aria-label": ariaLabel,
      "data-i18n-aria": ariaKey,
    },
    el("span", { class: "calc-utility-btn-icon", "aria-hidden": "true", html: icon }),
    el("span", { class: "calc-utility-btn-label", "data-i18n": labelKey }, label)
  );
}

export function buildPanel({ t, isTouchLike, showEnergyTool = false }: PanelOptions) {
  const historyBtn = makeUtilityBtn({
    className: "calc-history-btn",
    icon: IconHistory,
    ariaLabel: t("history"),
    ariaKey: "history",
    label: t("history"),
    labelKey: "history",
  });

  const energyBtn = showEnergyTool
    ? makeUtilityBtn({
      className: "calc-energy-btn",
      icon: IconEnergy,
      ariaLabel: t("openEnergy"),
      ariaKey: "openEnergy",
      label: t("energy"),
      labelKey: "energy",
    })
    : null;

  const settingsBtn = makeUtilityBtn({
    className: "calc-settings-btn",
    icon: IconSettings,
    ariaLabel: t("settings"),
    ariaKey: "settings",
    label: t("settings"),
    labelKey: "settings",
  });
  const settingsThousandsControl = createSettingsSwitch({
    label: t("thousandSeparator"),
    labelKey: "thousandSeparator",
    classNames: {
      root: "calc-settings-row calc-settings-row-inline",
      input: "calc-settings-thousands",
    },
  });

  const panel = el(
    "section",
    {
      class: "calc-panel",
      hidden: true,
      role: "dialog",
      "aria-label": t("calcTitle"),
      "data-i18n-aria": "calcTitle",
    },
    el(
      "div",
      { class: "calc-header" },
      el(
        "div",
        { class: "calc-header-main" },
        el("div", { class: "calc-header-grip", "aria-hidden": "true" })
      ),
      el("button", {
        class: "calc-minimize",
        type: "button",
        "aria-label": t("minimize"),
        "data-i18n-aria": "minimize",
        title: t("minimize"),
        html: IconMinimize,
      }),
      el("button", {
        class: "calc-close",
        type: "button",
        "aria-label": t("close"),
        "data-i18n-aria": "close",
        title: t("close"),
        html: IconClose,
      })
    ),
    el(
      "div",
      { class: "calc-display" },
      el("div", { class: "calc-history-text" }),
      el("input", {
        class: "calc-expr",
        type: "text",
        inputmode: isTouchLike ? "none" : "decimal",
        autocomplete: "off",
        spellcheck: "false",
      })
    ),
    el(
      "div",
      {
        class: showEnergyTool
          ? "calc-utility-row"
          : "calc-utility-row calc-utility-row-two",
      },
      historyBtn,
      energyBtn,
      settingsBtn
    ),
    el(
      "div",
      { class: "calc-history-sheet", hidden: true, "aria-hidden": "true" },
      el("div", { class: "calc-history-sheet-header" },
        el("span", { "data-i18n": "history" }, t("history")),
        el("div", { class: "calc-history-sheet-actions" },
          el("button", { class: "calc-history-clear", type: "button", "data-i18n": "clear" }, t("clear")),
          el("button", {
            class: "calc-history-close",
            type: "button",
            "aria-label": t("close"),
            "data-i18n-aria": "close",
            html: IconClose,
          })
        )
      ),
      el("div", { class: "calc-history-list" })
    ),
    el(
      "div",
      { class: "calc-settings-sheet", hidden: true, "aria-hidden": "true" },
      el("div", { class: "calc-settings-sheet-header" },
        el("span", { "data-i18n": "settings" }, t("settings")),
        el("button", {
          class: "calc-icon-btn calc-settings-close",
          type: "button",
          "aria-label": t("close"),
          "data-i18n-aria": "close",
          html: IconClose,
        })
      ),
      el("div", { class: "calc-settings-body" },
        el(
          "div",
          { class: "calc-settings-row calc-settings-row-inline calc-settings-row-box" },
          el("span", { class: "calc-settings-label", "data-i18n": "decimalPlaces" }, t("decimalPlaces")),
          el(
            "div",
            { class: "calc-settings-stepper" },
            el("button", { class: "calc-settings-decimals-minus", type: "button" }, "-"),
            el("span", { class: "calc-settings-decimals-value" }, "0"),
            el("button", { class: "calc-settings-decimals-plus", type: "button" }, "+")
          )
        ),
        settingsThousandsControl.element
      )
    ),
    el("div", { class: "calc-keys" })
  );

  const exprInput = panel.querySelector<HTMLInputElement>(".calc-expr");

  if (isTouchLike) {
    exprInput.setAttribute("readonly", "");
    exprInput.setAttribute("inputmode", "none");

    // Prevent focus entirely (stronger than blur)
    const blockFocus = (e: Event) => {
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

  return {
    panel,
    exprInput,
    historyEl: panel.querySelector<HTMLElement>(".calc-history-text"),
    historyBtn: panel.querySelector<HTMLButtonElement>(".calc-history-btn"),
    energyBtn: panel.querySelector<HTMLButtonElement>(".calc-energy-btn"),
    historySheet: panel.querySelector<HTMLElement>(".calc-history-sheet"),
    historyList: panel.querySelector<HTMLElement>(".calc-history-list"),
    historyClearBtn: panel.querySelector<HTMLButtonElement>(".calc-history-clear"),
    historyCloseBtn: panel.querySelector<HTMLButtonElement>(".calc-history-close"),
    settingsBtn: panel.querySelector<HTMLButtonElement>(".calc-settings-btn"),
    settingsSheet: panel.querySelector<HTMLElement>(".calc-settings-sheet"),
    settingsCloseBtn: panel.querySelector<HTMLButtonElement>(".calc-settings-close"),
    settingsDecimalsMinus: panel.querySelector<HTMLButtonElement>(".calc-settings-decimals-minus"),
    settingsDecimalsPlus: panel.querySelector<HTMLButtonElement>(".calc-settings-decimals-plus"),
    settingsDecimalsValue: panel.querySelector<HTMLElement>(".calc-settings-decimals-value"),
    settingsThousandsToggle: panel.querySelector<HTMLInputElement>(".calc-settings-thousands"),
    settingsThousandsControl,
    minimizeBtn: panel.querySelector<HTMLButtonElement>(".calc-minimize"),
    closeBtn: panel.querySelector<HTMLButtonElement>(".calc-close"),
    keys: panel.querySelector<HTMLElement>(".calc-keys"),
    header: panel.querySelector<HTMLElement>(".calc-header"),
  };
}
