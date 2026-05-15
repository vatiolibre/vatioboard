import "../styles/calculator.less";
import "../styles/camera-map.less";
import "../styles/energy.less";

import { createCalculatorWidget } from "../calculator/calculator-widget.js";
import { createEnergyCalculatorWidget } from "../energy/energy-calculator-widget.js";
import { createCameraMapWidget } from "../speed/camera-map-widget.js";
import { getDefaultShellWindowManager } from "./shell-window-manager.js";

const GLOBAL_TOOLS_KEY = "__vatioboardFloatingTools";
const CALC_VISIBILITY_KEY = "vatioboard.calc_panel.visible_v1";
const CAMERA_MAP_VISIBILITY_KEY = "vatioboard.camera_map_panel.visible_v1";
const ENERGY_VISIBILITY_KEY = "vatioboard.energy_panel.visible_v1";

export function getFloatingTools() {
  return window[GLOBAL_TOOLS_KEY] || null;
}

export function initFloatingTools({
  mount = document.body,
  shellManager = getDefaultShellWindowManager({ root: mount }),
  gpsService = window.__vatioboardGpsStore || null,
} = {}) {
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

  const cameraMapWidget = createCameraMapWidget({
    mount,
    floating: false,
    persistVisibility: true,
    restoreVisibility: true,
    visibilityKey: CAMERA_MAP_VISIBILITY_KEY,
    shellManager,
    gpsService,
    getCurrentPosition: () => window.__vatioboardGpsGetCurrentPosition?.()
      || window.__vatioboardSpeedGetCurrentPosition?.()
      || null,
  });

  const tools = {
    cameraMapWidget,
    calcBtn: null,
    calcWidget,
    dock: null,
    energyWidget,
    shellManager,
    closeCameraMap: () => shellManager.closeWindow("camera-map"),
    closeCalculator: () => shellManager.closeWindow("calculator"),
    closeEnergy: () => shellManager.closeWindow("energy"),
    openCameraMap: () => shellManager.openWindow("camera-map"),
    openCalculator: () => shellManager.openWindow("calculator"),
    openEnergy: () => shellManager.openWindow("energy"),
    toggleCameraMap: () => shellManager.toggleWindow("camera-map"),
    toggleCalculator: () => shellManager.toggleWindow("calculator"),
    toggleEnergy: () => shellManager.toggleWindow("energy"),
  };

  window[GLOBAL_TOOLS_KEY] = tools;
  return tools;
}
