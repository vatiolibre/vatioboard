import { el } from "../dom.js";
import { IconHistory, IconSettings, IconClose } from "../../icons.js";

export function buildPanel({ t, isTouchLike }) {
  const panel = el(
    "section",
    { class: "calc-panel", hidden: true, role: "dialog", "aria-label": t("calcTitle") },
    el(
      "div",
      { class: "calc-header" },
      el("div", { class: "calc-title" }, t("calcTitle")),
      el("button", {
        class: "calc-icon-btn calc-settings-btn",
        type: "button",
        "aria-label": t("settings"),
        html: IconSettings,
      }),
      el("div", { class: "calc-spacer" }),
      el("button", { class: "calc-close", type: "button" }, t("close"))
    ),
    el(
      "div",
      { class: "calc-display" },
      el(
        "div",
        { class: "calc-history-row" },
        el("button", {
          class: "calc-icon-btn calc-history-btn",
          type: "button",
          "aria-label": t("history"),
          html: IconHistory,
        }),
        el("div", { class: "calc-history-text" })
      ),
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
      { class: "calc-history-sheet", hidden: true, "aria-hidden": "true" },
      el("div", { class: "calc-history-sheet-header" },
        el("span", {}, t("history")),
        el("div", { class: "calc-history-sheet-actions" },
          el("button", { class: "calc-history-clear", type: "button" }, t("clear")),
          el("button", {
            class: "calc-history-close",
            type: "button",
            "aria-label": t("close"),
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
        el("span", {}, t("settings")),
        el("button", {
          class: "calc-icon-btn calc-settings-close",
          type: "button",
          "aria-label": t("close"),
          html: IconClose,
        })
      ),
      el("div", { class: "calc-settings-body" },
        el(
          "div",
          { class: "calc-settings-row calc-settings-row-inline calc-settings-row-box" },
          el("span", { class: "calc-settings-label" }, t("decimalPlaces")),
          el(
            "div",
            { class: "calc-settings-stepper" },
            el("button", { class: "calc-settings-decimals-minus", type: "button" }, "-"),
            el("span", { class: "calc-settings-decimals-value" }, "0"),
            el("button", { class: "calc-settings-decimals-plus", type: "button" }, "+")
          )
        ),
        el(
          "label",
          { class: "calc-settings-row calc-settings-row-inline" },
          el("span", { class: "calc-settings-label" }, t("thousandSeparator")),
          el(
            "span",
            { class: "calc-settings-switch" },
            el("input", {
              class: "calc-settings-thousands",
              type: "checkbox",
            }),
            el("span", { class: "calc-settings-slider", "aria-hidden": "true" })
          )
        )
      )
    ),
    el("div", { class: "calc-keys" })
  );

  const exprInput = panel.querySelector(".calc-expr");

  if (isTouchLike) {
    exprInput.setAttribute("readonly", "");
    exprInput.setAttribute("inputmode", "none");

    // Prevent focus entirely (stronger than blur)
    const blockFocus = (e) => {
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
    historyEl: panel.querySelector(".calc-history-text"),
    historyBtn: panel.querySelector(".calc-history-btn"),
    historySheet: panel.querySelector(".calc-history-sheet"),
    historyList: panel.querySelector(".calc-history-list"),
    historyClearBtn: panel.querySelector(".calc-history-clear"),
    historyCloseBtn: panel.querySelector(".calc-history-close"),
    settingsBtn: panel.querySelector(".calc-settings-btn"),
    settingsSheet: panel.querySelector(".calc-settings-sheet"),
    settingsCloseBtn: panel.querySelector(".calc-settings-close"),
    settingsDecimalsMinus: panel.querySelector(".calc-settings-decimals-minus"),
    settingsDecimalsPlus: panel.querySelector(".calc-settings-decimals-plus"),
    settingsDecimalsValue: panel.querySelector(".calc-settings-decimals-value"),
    settingsThousandsToggle: panel.querySelector(".calc-settings-thousands"),
    closeBtn: panel.querySelector(".calc-close"),
    keys: panel.querySelector(".calc-keys"),
    header: panel.querySelector(".calc-header"),
  };
}
