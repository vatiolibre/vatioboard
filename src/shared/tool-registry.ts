import {
  IconAccel,
  IconBoard,
  IconCalculator,
  IconCameraMap,
  IconEnergy,
  IconMedia,
  IconMusic,
  IconReplay,
  IconSpeed,
  IconWorld,
} from "../icons.js";
import type { VatioToolDefinition, ToolSurface } from "../types/ui";
import { SHELL_WINDOW_IDS } from "./shell-window-registry.js";

export const TOOL_IDS = {
  speed: "route:speed",
  board: "route:board",
  replay: "route:replay",
  accel: "route:accel",
  library: "route:library",
  calculator: SHELL_WINDOW_IDS.calculator,
  energy: SHELL_WINDOW_IDS.energy,
  cameraMap: SHELL_WINDOW_IDS.cameraMap,
  speedAlerts: SHELL_WINDOW_IDS.speedAlerts,
  player: SHELL_WINDOW_IDS.player,
  milkdrop: SHELL_WINDOW_IDS.milkdrop,
} as const;

export function defineTool<const T extends VatioToolDefinition>(definition: T): T {
  return definition;
}

export const toolRegistry = [
  defineTool({
    id: TOOL_IDS.speed,
    kind: "route",
    icon: IconSpeed,
    i18nKey: "speedometer",
    href: "#/speed",
    path: "/",
    pathAliases: ["/speed"],
    text: "Speedometer",
    order: 10,
    surfaces: ["start-menu"],
  }),
  defineTool({
    id: TOOL_IDS.board,
    kind: "route",
    icon: IconBoard,
    i18nKey: "openBoard",
    href: "#/board",
    path: "/board",
    text: "Open board",
    order: 20,
    surfaces: ["start-menu"],
  }),
  defineTool({
    id: TOOL_IDS.replay,
    kind: "route",
    icon: IconReplay,
    i18nKey: "driveReplay",
    href: "#/replay",
    path: "/replay",
    text: "Drive Replay",
    order: 30,
    surfaces: ["start-menu"],
  }),
  defineTool({
    id: TOOL_IDS.accel,
    kind: "route",
    icon: IconAccel,
    i18nKey: "accelerationTest",
    href: "#/accel",
    path: "/accel",
    text: "Acceleration Test",
    order: 40,
    surfaces: ["start-menu"],
  }),
  defineTool({
    id: TOOL_IDS.library,
    kind: "route",
    icon: IconWorld,
    i18nKey: "cloudLibrary",
    href: "#/library",
    path: "/library",
    text: "Cloud library",
    order: 50,
    surfaces: ["start-menu"],
  }),
  defineTool({
    id: TOOL_IDS.calculator,
    kind: "shell-window",
    icon: IconCalculator,
    i18nKey: "calculator",
    shellWindowId: SHELL_WINDOW_IDS.calculator,
    text: "Calculator",
    order: 60,
    surfaces: ["start-menu", "floating-tools", "taskbar", "launcher"],
  }),
  defineTool({
    id: TOOL_IDS.energy,
    kind: "shell-window",
    icon: IconEnergy,
    i18nKey: "energy",
    shellWindowId: SHELL_WINDOW_IDS.energy,
    text: "Energy",
    order: 70,
    surfaces: ["start-menu", "floating-tools", "taskbar", "launcher"],
  }),
  defineTool({
    id: TOOL_IDS.cameraMap,
    kind: "shell-window",
    icon: IconCameraMap,
    i18nKey: "cameraMapTitle",
    shellWindowId: SHELL_WINDOW_IDS.cameraMap,
    text: "Camera Map",
    order: 80,
    surfaces: ["start-menu", "floating-tools", "taskbar", "launcher"],
  }),
  defineTool({
    id: TOOL_IDS.speedAlerts,
    kind: "shell-window",
    icon: IconSpeed,
    i18nKey: "speedAlertsTitle",
    shellWindowId: SHELL_WINDOW_IDS.speedAlerts,
    text: "Speed Alerts",
    order: 90,
    surfaces: ["start-menu", "floating-tools", "taskbar", "launcher"],
  }),
  defineTool({
    id: TOOL_IDS.player,
    kind: "shell-window",
    icon: IconMusic,
    shellWindowId: SHELL_WINDOW_IDS.player,
    text: "Player",
    order: 100,
    surfaces: ["taskbar", "launcher"],
  }),
  defineTool({
    id: TOOL_IDS.milkdrop,
    kind: "shell-window",
    icon: IconMedia,
    shellWindowId: SHELL_WINDOW_IDS.milkdrop,
    text: "Milkdrop",
    order: 110,
    surfaces: ["taskbar", "launcher"],
  }),
] satisfies readonly VatioToolDefinition[];

export function getToolDefinitionsForSurface(surface: ToolSurface): VatioToolDefinition[] {
  const registeredTools: readonly VatioToolDefinition[] = toolRegistry;
  return registeredTools
    .filter((tool) => tool.surfaces.includes(surface))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getStartMenuToolDefinitions(): VatioToolDefinition[] {
  return getToolDefinitionsForSurface("start-menu");
}

export function getRouteToolDefinition(path: string): VatioToolDefinition | null {
  const registeredTools: readonly VatioToolDefinition[] = toolRegistry;
  return registeredTools.find((tool) => tool.kind === "route" && (tool.path === path || tool.pathAliases?.includes(path))) || null;
}

export function getToolDefinitionForShellWindow(shellWindowId: string): VatioToolDefinition | null {
  const registeredTools: readonly VatioToolDefinition[] = toolRegistry;
  return registeredTools.find((tool) => tool.shellWindowId === shellWindowId) || null;
}
