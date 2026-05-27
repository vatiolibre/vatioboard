import type { ShellWindowDefinition } from "../types/shell";

export const SHELL_WINDOW_IDS = {
  calculator: "calculator",
  energy: "energy",
  cameraMap: "camera-map",
  speedAlerts: "speed-alerts",
  player: "player",
  milkdrop: "milkdrop",
} as const;

export function defineShellWindow<const T extends ShellWindowDefinition>(definition: T): T {
  return definition;
}

export const shellWindowRegistry = [
  defineShellWindow({
    id: SHELL_WINDOW_IDS.calculator,
    kind: "tool",
    title: "Calculator",
    capabilities: {
      draggable: true,
      resizable: false,
      minimizable: true,
      closable: true,
      restorable: true,
      maximizable: false,
      snap: false,
      preserveIntrinsicWidth: true,
      maxWidth: 320,
    },
  }),
  defineShellWindow({
    id: SHELL_WINDOW_IDS.energy,
    kind: "tool",
    title: "Energy",
    capabilities: {
      draggable: true,
      resizable: false,
      minimizable: true,
      closable: true,
      restorable: true,
      maximizable: false,
      snap: false,
      preserveIntrinsicWidth: true,
      maxWidth: 640,
    },
  }),
  defineShellWindow({
    id: SHELL_WINDOW_IDS.cameraMap,
    kind: "tool",
    title: "Camera Map",
    lazy: true,
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
      fullscreen: true,
      maximizable: true,
      snap: true,
      snapZones: ["left", "right", "top", "bottom", "center", "top-left", "top-right", "bottom-left", "bottom-right"],
    },
  }),
  defineShellWindow({
    id: SHELL_WINDOW_IDS.speedAlerts,
    kind: "tool",
    title: "Speed Alerts",
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
    },
  }),
  defineShellWindow({
    id: SHELL_WINDOW_IDS.player,
    kind: "media",
    title: "Player",
    capabilities: {
      draggable: true,
      resizable: false,
      minimizable: true,
      closable: true,
      restorable: true,
      maximizable: false,
      fullscreen: false,
      snap: false,
      preserveIntrinsicWidth: true,
      maxWidth: 340,
    },
  }),
  defineShellWindow({
    id: SHELL_WINDOW_IDS.milkdrop,
    kind: "visualizer",
    title: "Milkdrop",
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
      fullscreen: true,
      maximizable: true,
      snap: true,
    },
  }),
] satisfies readonly ShellWindowDefinition[];

export function getShellWindowDefinition(id: string): ShellWindowDefinition | null {
  return shellWindowRegistry.find((definition) => definition.id === id) || null;
}
