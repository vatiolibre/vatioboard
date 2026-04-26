import "../styles/calculator.less";
import "../styles/energy.less";
import "../styles/dock.less";

import { createCalculatorWidget } from "../calculator/calculator-widget.js";
import { createEnergyCalculatorWidget } from "../energy/energy-calculator-widget.js";
import { createFloatingDock } from "../dock/floating-dock.js";

const GLOBAL_TOOLS_KEY = "__vatioboardFloatingTools";
const CALC_VISIBILITY_KEY = "vatioboard.calc_panel.visible_v1";
const ENERGY_VISIBILITY_KEY = "vatioboard.energy_panel.visible_v1";

export function getFloatingTools() {
  return window[GLOBAL_TOOLS_KEY] || null;
}

export function initFloatingTools({ mount = document.body } = {}) {
  const existing = getFloatingTools();
  if (existing?.dock?.isConnected) return existing;
  if (existing) {
    delete window[GLOBAL_TOOLS_KEY];
  }

  const energyWidget = createEnergyCalculatorWidget({
    mount,
    persistVisibility: true,
    restoreVisibility: true,
    visibilityKey: ENERGY_VISIBILITY_KEY,
  });

  const calcWidget = createCalculatorWidget({
    mount,
    floating: false,
    onOpenEnergy: () => energyWidget.toggle(),
    persistVisibility: true,
    restoreVisibility: true,
    visibilityKey: CALC_VISIBILITY_KEY,
  });

  const { dock, calcBtn } = createFloatingDock({ mount });
  calcBtn?.addEventListener("click", () => calcWidget.toggle());

  const tools = {
    calcBtn,
    calcWidget,
    dock,
    energyWidget,
    closeCalculator: () => calcWidget.close(),
    closeEnergy: () => energyWidget.close(),
    openCalculator: () => calcWidget.open(),
    openEnergy: () => energyWidget.open(),
    toggleCalculator: () => calcWidget.toggle(),
    toggleEnergy: () => energyWidget.toggle(),
  };

  window[GLOBAL_TOOLS_KEY] = tools;
  return tools;
}
