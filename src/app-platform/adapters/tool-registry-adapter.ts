import { appRegistry } from "../app-registry.js";
import { appControl } from "../app-control.js";
import type { VatioToolDefinition, ToolSurface } from "../../types/ui";
import type { VatioAppManifest } from "../types";

const LEGACY_TOOL_IDS = {
  speed: "route:speed",
  board: "route:board",
  replay: "route:replay",
  accel: "route:accel",
  library: "route:library",
  appManager: "route:apps",
  calculator: "calculator",
  energy: "energy",
  cameraMap: "camera-map",
  speedAlerts: "speed-alerts",
  player: "player",
  milkdrop: "milkdrop",
} as const;

const VALID_TOOL_SURFACES = new Set<ToolSurface>([
  "start-menu",
  "floating-tools",
  "taskbar",
  "launcher",
]);

function routeHref(route: string, app: VatioAppManifest) {
  const legacyHref = app.metadata.legacyHref;
  if (typeof legacyHref === "string" && legacyHref) return legacyHref;
  return route === "/" ? "#/" : `#${route}`;
}

function getLegacyToolId(app: VatioAppManifest) {
  const legacyToolId = app.metadata.legacyToolId;
  if (typeof legacyToolId === "string" && legacyToolId) return legacyToolId;
  if (app.window?.shellWindowId) return app.window.shellWindowId;
  if (app.route) return `route:${app.route.replace(/^\/+/, "") || "home"}`;
  return app.id;
}

function getToolSurfaces(app: VatioAppManifest): ToolSurface[] {
  const surfaces = new Set<ToolSurface>();
  if (app.surfaces.includes("start-menu")) surfaces.add("start-menu");
  if (app.surfaces.includes("taskbar")) surfaces.add("taskbar");
  if (app.surfaces.includes("launcher")) surfaces.add("launcher");

  const legacySurfaces = app.metadata.legacyToolSurfaces;
  if (Array.isArray(legacySurfaces)) {
    for (const surface of legacySurfaces) {
      if (VALID_TOOL_SURFACES.has(surface)) surfaces.add(surface);
    }
  }

  return Array.from(surfaces);
}

function getToolKind(app: VatioAppManifest): VatioToolDefinition["kind"] {
  if (app.route) return "route";
  if (app.window?.shellWindowId) return "shell-window";
  return "command";
}

function mapAppToTool(app: VatioAppManifest): VatioToolDefinition | null {
  const surfaces = getToolSurfaces(app);
  if (!surfaces.length) return null;

  const kind = getToolKind(app);
  const shellWindowId = app.window?.shellWindowId;
  const href = app.route ? routeHref(app.route, app) : undefined;

  return {
    id: getLegacyToolId(app),
    kind,
    icon: app.icon,
    i18nKey: app.i18nKey,
    href,
    path: app.route,
    pathAliases: app.aliases,
    shellWindowId,
    text: app.shortTitle || app.title,
    order: app.order,
    surfaces,
    open(context = {}) {
      if (!appControl.isEnabled(app.id)) return false;
      if (kind === "route" && href) {
        return context.navigate?.(href) ?? false;
      }
      if (kind === "shell-window" && shellWindowId) {
        return Boolean(context.shellManager?.openWindow?.(shellWindowId));
      }
      return false;
    },
  };
}

export function getLegacyToolIds() {
  return LEGACY_TOOL_IDS;
}

export function getToolRegistryFromApps(): VatioToolDefinition[] {
  return appRegistry
    .listApps()
    .map(mapAppToTool)
    .filter(Boolean)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) as VatioToolDefinition[];
}

export function getToolDefinitionsForSurfaceFromApps(surface: ToolSurface): VatioToolDefinition[] {
  return getToolRegistryFromApps().filter((tool) => tool.surfaces.includes(surface));
}

export function getRouteToolDefinitionFromApps(path: string): VatioToolDefinition | null {
  return getToolRegistryFromApps().find((tool) =>
    tool.kind === "route" && (tool.path === path || tool.pathAliases?.includes(path))
  ) || null;
}

export function getToolDefinitionForShellWindowFromApps(shellWindowId: string): VatioToolDefinition | null {
  return getToolRegistryFromApps().find((tool) => tool.shellWindowId === shellWindowId) || null;
}
