import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("typed shell architecture contracts", () => {
  it("keeps routes declared through the typed route registry", () => {
    const routes = readProjectFile("src/app/routes.ts");
    const registry = readProjectFile("src/app/route-registry.ts");

    expect(routes).toContain("routeRegistry as routes");
    expect(registry).toContain("satisfies readonly RouteConfig[]");
    expect(registry).toContain("defineRoute");
  });

  it("keeps persistent shell windows declared in the typed registry", () => {
    const registry = readProjectFile("src/shared/shell-window-registry.ts");
    const floatingLayer = readProjectFile("src/shared/floating-layer-manager.ts");

    for (const id of ["calculator", "energy", "camera-map", "speed-alerts", "player", "milkdrop"]) {
      expect(registry, id).toContain(`id: SHELL_WINDOW_IDS.${id === "camera-map" ? "cameraMap" : id === "speed-alerts" ? "speedAlerts" : id}`);
    }
    expect(registry).toContain("satisfies readonly ShellWindowDefinition[]");
    expect(floatingLayer).toContain("getShellWindowDefinition");
  });

  it("keeps launchers, floating tools, and taskbar backed by typed app/tool contracts", () => {
    const registry = readProjectFile("src/shared/tool-registry.ts");
    const startMenu = readProjectFile("src/shared/start-menu.ts");
    const appLauncherMenu = readProjectFile("src/shared/app-launcher-menu.ts");
    const floatingTools = readProjectFile("src/shared/floating-tools.ts");
    const taskbar = readProjectFile("src/shared/shell-taskbar.ts");

    expect(registry).toContain("satisfies readonly VatioToolDefinition[]");
    expect(startMenu).toContain("createAppLauncherMenu");
    expect(appLauncherMenu).toContain("appRegistry.listApps");
    expect(appLauncherMenu).toContain("appControl.setFavorite");
    expect(appLauncherMenu).toContain("createAppLauncher");
    expect(floatingTools).toContain("SHELL_WINDOW_IDS");
    expect(taskbar).toContain("getToolDefinitionForShellWindow");
  });

  it("keeps touch target and safe-area tokens in the shared UI design contract", () => {
    const contract = readProjectFile("src/shared/ui-design-contract.ts");
    const appStyles = readProjectFile("src/styles/app.less");

    expect(contract).toContain("MIN_TOUCH_TARGET_PX = 44");
    expect(contract).toContain("--vb-touch-target-min");
    for (const token of ["--vb-safe-area-top", "--vb-safe-area-right", "--vb-safe-area-bottom", "--vb-safe-area-left"]) {
      expect(contract).toContain(token);
      expect(appStyles).toContain(token);
    }
    expect(appStyles).toContain("--vb-touch-target-min");
  });
});
