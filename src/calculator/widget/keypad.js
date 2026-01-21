import { el } from "../dom.js";

export function buildKeypad({ keysContainer, pushToken, act, doEval }) {
  const secondaryLayout = [
    { t: "√", cls: "op", on: () => act((core) => core.sqrtTrailingNumber()) },
    { t: "x²", cls: "op", on: () => act((core) => core.squareTrailingNumber()) },
    { t: "±", cls: "op", on: () => act((core) => core.toggleSign()) },
    { t: "⌫", cls: "", on: () => act((core) => core.backspace()) },
  ];

  const layout = [
    { t: "AC", cls: "danger", on: () => act((core) => core.clear()) },
    { t: "()", cls: "op", on: () => pushToken((core) => core.smartParen()) },
    { t: "%", cls: "op", on: () => pushToken(() => "%") },
    { t: "÷", cls: "op", on: () => pushToken(() => "÷") },

    { t: "7", on: () => pushToken(() => "7") },
    { t: "8", on: () => pushToken(() => "8") },
    { t: "9", on: () => pushToken(() => "9") },
    { t: "×", cls: "op", on: () => pushToken(() => "×") },

    { t: "4", on: () => pushToken(() => "4") },
    { t: "5", on: () => pushToken(() => "5") },
    { t: "6", on: () => pushToken(() => "6") },
    { t: "–", cls: "op", on: () => pushToken(() => "–") },

    { t: "1", on: () => pushToken(() => "1") },
    { t: "2", on: () => pushToken(() => "2") },
    { t: "3", on: () => pushToken(() => "3") },
    { t: "+", cls: "op", on: () => pushToken(() => "+") },

    { t: "0", cls: "zero", on: () => pushToken(() => "0") },
    { t: ".", on: () => pushToken(() => ".") },
    { t: "=", cls: "eq", on: () => doEval() },
  ];

  const secondaryKeys = el("div", { class: "calc-secondary-keys" });
  for (const k of secondaryLayout) {
    secondaryKeys.appendChild(
      el(
        "button",
        { type: "button", class: `calc-key calc-key-secondary ${k.cls || ""}`.trim(), onclick: k.on },
        k.t
      )
    );
  }
  keysContainer.before(secondaryKeys);

  for (const k of layout) {
    keysContainer.appendChild(
      el(
        "button",
        { type: "button", class: `calc-key ${k.cls || ""}`.trim(), onclick: k.on },
        k.t
      )
    );
  }
}
