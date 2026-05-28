import { appRegistry } from "../app-registry.js";
import type { ShellWindowDefinition } from "../../types/shell";
import type { VatioAppManifest } from "../types";

const LEGACY_SHELL_WINDOW_IDS = {
  calculator: "calculator",
  energy: "energy",
  cameraMap: "camera-map",
  speedAlerts: "speed-alerts",
  player: "player",
  milkdrop: "milkdrop",
} as const;

function getShellKind(app: VatioAppManifest) {
  const legacyShellKind = app.metadata.legacyShellKind;
  if (typeof legacyShellKind === "string" && legacyShellKind) return legacyShellKind;
  if (app.kind === "media-app") return "media";
  if (app.kind === "visualizer-app") return "visualizer";
  return "tool";
}

function mapAppToShellWindow(app: VatioAppManifest): ShellWindowDefinition | null {
  if (!app.window?.shellWindowId) return null;
  return {
    id: app.window.shellWindowId,
    kind: getShellKind(app),
    title: app.title,
    lazy: app.window.lazy,
    restoreOnBoot: app.window.restoreOnBoot,
    capabilities: app.window.capabilities,
  };
}

export function getLegacyShellWindowIds() {
  return LEGACY_SHELL_WINDOW_IDS;
}

export function getShellWindowRegistryFromApps(): ShellWindowDefinition[] {
  return appRegistry
    .listApps()
    .map(mapAppToShellWindow)
    .filter(Boolean)
    .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id))) as ShellWindowDefinition[];
}

export function getShellWindowDefinitionFromApps(id: string): ShellWindowDefinition | null {
  return getShellWindowRegistryFromApps().find((definition) => definition.id === id) || null;
}
