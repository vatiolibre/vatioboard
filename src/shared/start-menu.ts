import type { ShellAppRuntimeManager } from "../app-platform/types";
import { createAppLauncherMenu } from "./app-launcher-menu.js";
import type { FloatingToolsRuntime } from "./floating-tools";

const START_MENU_KEY = "__vatioboardStartMenu";

interface StartMenuOptions {
  floatingTools?: FloatingToolsRuntime | null;
  mount?: HTMLElement;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
}

export function getSharedStartMenu(): VatioBoardStartMenu | null {
  return window[START_MENU_KEY] || null;
}

export function initSharedStartMenu(options: StartMenuOptions = {}): VatioBoardStartMenu {
  const existing = getSharedStartMenu();
  if (existing?.list?.isConnected) return existing;
  if (existing) delete window[START_MENU_KEY];

  const startMenu = createAppLauncherMenu(options);
  window[START_MENU_KEY] = startMenu;
  return startMenu;
}
