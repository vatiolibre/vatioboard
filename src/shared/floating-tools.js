import "../styles/calculator.less";
import "../styles/energy.less";

import { createCalculatorWidget } from "../calculator/calculator-widget.js";
import { createEnergyCalculatorWidget } from "../energy/energy-calculator-widget.js";
import { getDefaultShellWindowManager } from "./shell-window-manager.js";

const GLOBAL_TOOLS_KEY = "__vatioboardFloatingTools";
const CALC_VISIBILITY_KEY = "vatioboard.calc_panel.visible_v1";
const ENERGY_VISIBILITY_KEY = "vatioboard.energy_panel.visible_v1";

export function getFloatingTools() {
  return window[GLOBAL_TOOLS_KEY] || null;
}

export function initFloatingTools({ mount = document.body, shellManager = getDefaultShellWindowManager({ root: mount }) } = {}) {
  const existing = getFloatingTools();
  const existingCalculator = existing?.shellManager?.getWindow?.("calculator");
  if (existingCalculator?.element?.isConnected) return existing;
  if (existing) {
    delete window[GLOBAL_TOOLS_KEY];
  }

  const energyWidget = createEnergyCalculatorWidget({
    mount,
    persistVisibility: true,
    restoreVisibility: true,
    visibilityKey: ENERGY_VISIBILITY_KEY,
    shellManager,
  });

  const calcWidget = createCalculatorWidget({
    mount,
    floating: false,
    onOpenEnergy: () => shellManager.openWindow("energy"),
    persistVisibility: true,
    restoreVisibility: true,
    visibilityKey: CALC_VISIBILITY_KEY,
    shellManager,
  });

  const tools = {
    calcBtn: null,
    calcWidget,
    dock: null,
    energyWidget,
    shellManager,
    closeCalculator: () => shellManager.closeWindow("calculator"),
    closeEnergy: () => shellManager.closeWindow("energy"),
    openCalculator: () => shellManager.openWindow("calculator"),
    openEnergy: () => shellManager.openWindow("energy"),
    toggleCalculator: () => shellManager.toggleWindow("calculator"),
    toggleEnergy: () => shellManager.toggleWindow("energy"),
  };

  window[GLOBAL_TOOLS_KEY] = tools;
  return tools;
}
