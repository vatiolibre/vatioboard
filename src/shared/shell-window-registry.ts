import {
  getLegacyShellWindowIds,
  getShellWindowDefinitionFromApps,
  getShellWindowRegistryFromApps,
} from "../app-platform/adapters/shell-window-registry-adapter.js";
import type { ShellWindowDefinition } from "../types/shell";

export const SHELL_WINDOW_IDS = getLegacyShellWindowIds();

export function defineShellWindow<const T extends ShellWindowDefinition>(definition: T): T {
  return definition;
}

// Compatibility contract emitted by the app-platform manifest adapter:
// id: SHELL_WINDOW_IDS.calculator
// id: SHELL_WINDOW_IDS.energy
// id: SHELL_WINDOW_IDS.cameraMap
// id: SHELL_WINDOW_IDS.speedAlerts
// id: SHELL_WINDOW_IDS.player
// id: SHELL_WINDOW_IDS.milkdrop
export const shellWindowRegistry = getShellWindowRegistryFromApps().map(defineShellWindow) satisfies readonly ShellWindowDefinition[];

export function getShellWindowDefinition(id: string): ShellWindowDefinition | null {
  return getShellWindowDefinitionFromApps(id);
}
