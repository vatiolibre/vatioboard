import "../styles/calculator.less";
import { applyTranslations } from "../i18n.js";
import { initSupportPanel } from "../shared/support-panel.js";
import { createCalculatorWidget } from "./calculator-widget.js";

applyTranslations();
initSupportPanel();

const widget = createCalculatorWidget({
  onResult: (value) => {
    const out = document.getElementById("out");
    if (out) out.textContent = `Result: ${value}`;
  },
});

document
  .getElementById("openCalc")
  ?.addEventListener("click", () => widget.toggle());
