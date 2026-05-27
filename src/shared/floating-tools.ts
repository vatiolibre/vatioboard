import "../styles/calculator.less";
import "../styles/camera-map.less";
import "../styles/energy.less";
import "../styles/speed-alert-panel.less";

import { createCalculatorWidget } from "../calculator/calculator-widget.js";
import { createEnergyCalculatorWidget } from "../energy/energy-calculator-widget.js";
import { createCameraMapWidget } from "../speed/camera-map-widget.js";
import { createSpeedAlertPanel } from "../speed/speed-alert-panel.js";
import { getDefaultShellWindowManager } from "./shell-window-manager.js";
import type { DrivingAlertService, GpsService } from "../types/services";
import type { ShellRuntime } from "../types/shell";
import { SHELL_WINDOW_IDS } from "./shell-window-registry.js";

const GLOBAL_TOOLS_KEY = "__vatioboardFloatingTools";
const CALC_VISIBILITY_KEY = "vatioboard.calc_panel.visible_v1";
const CAMERA_MAP_VISIBILITY_KEY = "vatioboard.camera_map_panel.visible_v1";
const ENERGY_VISIBILITY_KEY = "vatioboard.energy_panel.visible_v1";

export interface FloatingToolsRuntime {
  [key: string]: unknown;
  cameraMapWidget: unknown;
  calcBtn: HTMLElement | null;
  calcWidget: unknown;
  dock: HTMLElement | null;
  energyWidget: unknown;
  shellManager: ShellRuntime;
  speedAlertPanel: unknown;
  taskbar?: unknown;
  closeCameraMap(): unknown;
  closeCalculator(): unknown;
  closeEnergy(): unknown;
  closeSpeedAlerts(): unknown;
  openCameraMap(): unknown;
  openCalculator(): unknown;
  openEnergy(): unknown;
  openSpeedAlerts(): unknown;
  toggleCameraMap(): unknown;
  toggleCalculator(): unknown;
  toggleEnergy(): unknown;
  toggleSpeedAlerts(): unknown;
}

interface FloatingToolsOptions {
  mount?: HTMLElement;
  shellManager?: ShellRuntime;
  gpsService?: GpsService | null;
  drivingAlertService?: DrivingAlertService | null;
}

export function getFloatingTools(): FloatingToolsRuntime | null {
  return (window[GLOBAL_TOOLS_KEY] as FloatingToolsRuntime | undefined) || null;
}

export function initFloatingTools({
  mount = document.body,
  shellManager = getDefaultShellWindowManager({ root: mount }),
  gpsService = window.__vatioboardGpsStore || null,
  drivingAlertService = window.__vatioboardDrivingAlerts || null,
}: FloatingToolsOptions = {}): FloatingToolsRuntime {
  const existing = getFloatingTools();
  const existingCalculator = existing?.shellManager?.getWindow?.(SHELL_WINDOW_IDS.calculator);
  const existingSpeedAlerts = existing?.shellManager?.getWindow?.(SHELL_WINDOW_IDS.speedAlerts);
  if (existingCalculator?.element?.isConnected && existingSpeedAlerts?.element?.isConnected) return existing;
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
    onOpenEnergy: () => shellManager.openWindow(SHELL_WINDOW_IDS.energy),
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

  const speedAlertPanel = createSpeedAlertPanel({
    mount,
    shellManager,
    gpsService,
    drivingAlertService,
    restoreVisibility: true,
    onOpenCameraMap: () => shellManager.openWindow(SHELL_WINDOW_IDS.cameraMap),
  });

  const tools: FloatingToolsRuntime = {
    cameraMapWidget,
    calcBtn: null,
    calcWidget,
    dock: null,
    energyWidget,
    shellManager,
    speedAlertPanel,
    closeCameraMap: () => shellManager.closeWindow(SHELL_WINDOW_IDS.cameraMap),
    closeCalculator: () => shellManager.closeWindow(SHELL_WINDOW_IDS.calculator),
    closeEnergy: () => shellManager.closeWindow(SHELL_WINDOW_IDS.energy),
    closeSpeedAlerts: () => shellManager.closeWindow(SHELL_WINDOW_IDS.speedAlerts),
    openCameraMap: () => shellManager.openWindow(SHELL_WINDOW_IDS.cameraMap),
    openCalculator: () => shellManager.openWindow(SHELL_WINDOW_IDS.calculator),
    openEnergy: () => shellManager.openWindow(SHELL_WINDOW_IDS.energy),
    openSpeedAlerts: () => shellManager.openWindow(SHELL_WINDOW_IDS.speedAlerts),
    toggleCameraMap: () => shellManager.toggleWindow(SHELL_WINDOW_IDS.cameraMap),
    toggleCalculator: () => shellManager.toggleWindow(SHELL_WINDOW_IDS.calculator),
    toggleEnergy: () => shellManager.toggleWindow(SHELL_WINDOW_IDS.energy),
    toggleSpeedAlerts: () => shellManager.toggleWindow(SHELL_WINDOW_IDS.speedAlerts),
  };

  window[GLOBAL_TOOLS_KEY] = tools;
  return tools;
}
