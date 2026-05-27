import "../styles/calculator.less";
import { applyTranslations } from "../i18n.js";
import { createCalculatorWidget } from "./calculator-widget.js";

interface CalculatorDemoWidget {
  toggle: () => void;
}

const createDemoCalculatorWidget = createCalculatorWidget as (options: {
  onResult?: (value: unknown) => void;
}) => CalculatorDemoWidget;

applyTranslations();

const widget = createDemoCalculatorWidget({
  onResult: (value) => {
    const out = document.getElementById("out");
    if (out) out.textContent = `Result: ${value}`;
  },
});

document
  .getElementById("openCalc")
  ?.addEventListener("click", () => widget.toggle());
