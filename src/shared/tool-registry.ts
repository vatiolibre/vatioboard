import {
  getLegacyToolIds,
  getRouteToolDefinitionFromApps,
  getToolDefinitionForShellWindowFromApps,
  getToolDefinitionsForSurfaceFromApps,
  getToolRegistryFromApps,
} from "../app-platform/adapters/tool-registry-adapter.js";
import type { VatioToolDefinition, ToolSurface } from "../types/ui";

export const TOOL_IDS = getLegacyToolIds();

export function defineTool<const T extends VatioToolDefinition>(definition: T): T {
  return definition;
}

export const toolRegistry = getToolRegistryFromApps().map(defineTool) satisfies readonly VatioToolDefinition[];

export function getToolDefinitionsForSurface(surface: ToolSurface): VatioToolDefinition[] {
  return getToolDefinitionsForSurfaceFromApps(surface);
}

export function getStartMenuToolDefinitions(): VatioToolDefinition[] {
  return getToolDefinitionsForSurface("start-menu");
}

export function getRouteToolDefinition(path: string): VatioToolDefinition | null {
  return getRouteToolDefinitionFromApps(path);
}

export function getToolDefinitionForShellWindow(shellWindowId: string): VatioToolDefinition | null {
  return getToolDefinitionForShellWindowFromApps(shellWindowId);
}
