import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUILTIN_APP_MANIFESTS,
  appRegistry,
  createAppPermissionRuntime,
  createAppRegistry,
  createAppLauncher,
  createAppRuntime,
  createAppStorage,
  createShellAppRuntimeManager,
} from "../../src/app-platform/index.js";
import { boardAppManifest } from "../../src/apps/board/manifest.js";
import { calculatorAppManifest } from "../../src/apps/calculator/manifest.js";
import { speedAppManifest } from "../../src/apps/speed/manifest.js";
import { getRouteRegistryFromApps } from "../../src/app-platform/adapters/route-registry-adapter.js";
import {
  getRouteToolDefinitionFromApps,
  getToolDefinitionForShellWindowFromApps,
  getToolDefinitionsForSurfaceFromApps,
} from "../../src/app-platform/adapters/tool-registry-adapter.js";
import { getShellWindowDefinitionFromApps } from "../../src/app-platform/adapters/shell-window-registry-adapter.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";

function makeManifest(overrides = {}) {
  return {
    id: "test.app",
    title: "Test App",
    shortTitle: "Test",
    description: "A test app manifest.",
    kind: "core-app",
    version: "1.0.0",
    icon: "<svg></svg>",
    i18nKey: "testApp",
    route: "/test",
    aliases: ["/test-alias"],
    entry: () => Promise.resolve({ mount() {} }),
    surfaces: ["main-route", "start-menu"],
    order: 1,
    permissions: ["storage.app", "i18n.read"],
    services: ["storage", "i18n"],
    localFirst: true,
    teslaOptimized: true,
    offlineCapable: true,
    status: "stable",
    metadata: {},
    ...overrides,
  };
}

describe("VatioBoard OS app platform", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("registers and lists apps sorted by order", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    registry.registerApps([
      makeManifest({ id: "test.second", order: 20, route: "/second", aliases: ["/second-alias"] }),
      makeManifest({ id: "test.first", order: 10, route: "/first", aliases: ["/first-alias"] }),
    ]);

    expect(registry.listApps().map((app) => app.id)).toEqual(["test.first", "test.second"]);
  });

  it("handles duplicate app IDs safely", () => {
    const warn = vi.fn();
    const registry = createAppRegistry({ logger: { warn } });

    expect(registry.registerApp(makeManifest())).toBe(true);
    expect(registry.registerApp(makeManifest({ title: "Duplicate" }))).toBe(false);

    expect(registry.listApps()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Duplicate app id"));
  });

  it("rejects duplicate routes, aliases, shell window IDs, and legacy tool IDs", () => {
    const warn = vi.fn();
    const registry = createAppRegistry({ logger: { warn } });

    expect(registry.registerApp(makeManifest())).toBe(true);
    expect(registry.registerApp(makeManifest({ id: "test.route", route: "/test", aliases: [] }))).toBe(false);
    expect(registry.registerApp(makeManifest({ id: "test.alias", route: "/other", aliases: ["/test-alias"] }))).toBe(false);

    expect(registry.registerApp(makeManifest({
      id: "test.window",
      route: undefined,
      aliases: [],
      surfaces: ["shell-window"],
      window: {
        shellWindowId: "window-one",
        mode: "floating",
        defaultBounds: { left: 0, top: 0, width: 100 },
        capabilities: {},
        restoreOnBoot: true,
        lazy: false,
      },
      metadata: { legacyToolId: "window-one" },
    }))).toBe(true);
    expect(registry.registerApp(makeManifest({
      id: "test.window.duplicate",
      route: undefined,
      aliases: [],
      surfaces: ["shell-window"],
      window: {
        shellWindowId: "window-one",
        mode: "floating",
        defaultBounds: { left: 0, top: 0, width: 100 },
        capabilities: {},
        restoreOnBoot: true,
        lazy: false,
      },
      metadata: { legacyToolId: "window-two" },
    }))).toBe(false);
    expect(registry.registerApp(makeManifest({
      id: "test.legacy.duplicate",
      route: "/legacy-other",
      aliases: [],
      metadata: { legacyToolId: "window-one" },
    }))).toBe(false);

    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("conflicts");
  });

  it("lists apps for a surface and finds apps by route aliases", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    registry.registerApp(makeManifest());

    expect(registry.listAppsForSurface("start-menu").map((app) => app.id)).toEqual(["test.app"]);
    expect(registry.getAppByRoute("/test")?.id).toBe("test.app");
    expect(registry.getAppByRoute("/test-alias")?.id).toBe("test.app");
  });

  it("lists apps that request a permission", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    registry.registerApp(makeManifest());

    expect(registry.getAppsForPermission("storage.app").map((app) => app.id)).toEqual(["test.app"]);
    expect(registry.getAppsForPermission("gps.read")).toEqual([]);
  });

  it("rejects unknown service IDs during manifest validation", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const validation = registry.validateAppManifest(makeManifest({ services: ["storage", "telepathy"] }));

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain('service "telepathy" is not supported');
  });

  it("imports representative app-owned manifests into the built-in registry", () => {
    expect(BUILTIN_APP_MANIFESTS).toEqual(expect.arrayContaining([
      speedAppManifest,
      boardAppManifest,
      calculatorAppManifest,
    ]));
    expect(appRegistry.getApp("vatio.speed")).toBe(speedAppManifest);
    expect(appRegistry.getApp("vatio.board")).toBe(boardAppManifest);
    expect(appRegistry.getApp("vatio.calculator")).toBe(calculatorAppManifest);
  });

  it("namespaces app storage by app ID and handles JSON safely", () => {
    const first = createAppStorage({ appId: "test.one" });
    const second = createAppStorage({ appId: "test.two" });

    expect(first.setItem("setting", "one")).toBe(true);
    expect(second.setItem("setting", "two")).toBe(true);
    expect(first.setJson("json", { ok: true })).toBe(true);
    localStorage.setItem("vatioboard.app.test.one.bad", "{");

    expect(localStorage.getItem("vatioboard.app.test.one.setting")).toBe("one");
    expect(first.getItem("setting")).toBe("one");
    expect(second.getItem("setting")).toBe("two");
    expect(first.getJson("json", null)).toEqual({ ok: true });
    expect(first.getJson("bad", { fallback: true })).toEqual({ fallback: true });
    expect(first.listKeys()).toEqual(["bad", "json", "setting"]);
    expect(first.estimateUsage()).toMatchObject({ appId: "test.one", keyCount: 3, available: true });
  });

  it("allows declared permissions and denies undeclared permissions without throwing", () => {
    const warn = vi.fn();
    const permissions = createAppPermissionRuntime(makeManifest(), { warn });

    expect(permissions.has("storage.app")).toBe(true);
    expect(permissions.require("storage.app")).toBe(true);
    expect(permissions.has("gps.read")).toBe(false);
    expect(permissions.require("gps.read")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
  });

  it("creates a scoped runtime for a manifest", () => {
    const manifest = makeManifest({
      id: "test.runtime",
      permissions: ["storage.app", "i18n.read", "shell.launchApp"],
      services: ["storage", "i18n", "shell"],
    });
    const runtime = createAppRuntime({
      manifest,
      baseContext: {},
      navigate: vi.fn(() => true),
    });

    expect(runtime.appId).toBe("test.runtime");
    expect(runtime.manifest).toBe(manifest);
    expect(runtime.permissions.has("storage.app")).toBe(true);
    expect(runtime.services.gps).toBeNull();
    expect(runtime.storage.setItem("ready", "yes")).toBe(true);
    expect(localStorage.getItem("vatioboard.app.test.runtime.ready")).toBe("yes");
    expect(runtime.lifecycle.getState()).toBe("registered");
  });

  it("gates storage and i18n runtime APIs behind declared permissions", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: "test.gated",
        permissions: [],
        services: ["storage", "i18n"],
      }),
      baseContext: {},
    });

    expect(runtime.storage.setItem("secret", "nope")).toBe(false);
    expect(runtime.storage.getItem("secret")).toBeNull();
    expect(localStorage.getItem("vatioboard.app.test.gated.secret")).toBeNull();
    expect(runtime.storage.getJson("json", { fallback: true })).toEqual({ fallback: true });
    expect(runtime.i18n.t("brand", "Fallback Brand")).toBe("Fallback Brand");
    expect(runtime.i18n.getLanguage()).toBe("en");
    expect(runtime.i18n.subscribe(() => {
      throw new Error("listener should not run");
    })).toEqual(expect.any(Function));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[vatioboard:app:test.gated]"),
      expect.stringContaining("Permission denied"),
    );
  });

  it("requires service declarations as well as permissions before exposing services", () => {
    const gpsService = {
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
      startConsumer: vi.fn(),
      stopConsumer: vi.fn(),
      requestHighAccuracy: vi.fn(),
      releaseHighAccuracy: vi.fn(),
    };
    const withoutDeclaredService = createAppRuntime({
      manifest: makeManifest({
        id: "test.permission.only",
        permissions: ["gps.read", "storage.app", "i18n.read", "settings.read"],
        services: [],
      }),
      baseContext: { gpsService },
    });

    expect(withoutDeclaredService.services.gps).toBeNull();
    expect(withoutDeclaredService.services.settings).toBeNull();
    expect(withoutDeclaredService.storage.setItem("enabled", "no")).toBe(false);
    expect(withoutDeclaredService.i18n.t("brand", "Fallback Brand")).toBe("Fallback Brand");

    const withDeclaredService = createAppRuntime({
      manifest: makeManifest({
        id: "test.permission.and.service",
        permissions: ["gps.read", "storage.app", "i18n.read", "settings.read"],
        services: ["gps", "storage", "i18n", "settings"],
      }),
      baseContext: { gpsService },
    });

    expect(withDeclaredService.services.gps).not.toBeNull();
    expect(withDeclaredService.services.settings).not.toBeNull();
    expect(withDeclaredService.storage.setItem("enabled", "yes")).toBe(true);
    expect(localStorage.getItem("vatioboard.app.test.permission.and.service.enabled")).toBe("yes");
    expect(withDeclaredService.i18n.t("brand", "Fallback Brand")).toEqual(expect.any(String));
  });

  it("exposes app-scoped settings with read/write permissions", () => {
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: "test.settings",
        permissions: ["settings.read", "settings.write", "i18n.read"],
        services: ["settings", "i18n"],
      }),
      baseContext: {},
    });

    expect(runtime.storage.setItem("direct", "blocked")).toBe(false);
    expect(runtime.services.settings?.set("theme", "night")).toBe(true);
    expect(runtime.services.settings?.get("theme", "day")).toBe("night");
    expect(runtime.services.settings?.setJson("panel", { compact: true })).toBe(true);
    expect(runtime.services.settings?.getJson("panel", null)).toEqual({ compact: true });
    expect(localStorage.getItem("vatioboard.app.test.settings.settings.theme")).toBe("night");
  });

  it("denies settings writes without settings.write", () => {
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: "test.settings.readonly",
        permissions: ["settings.read"],
        services: ["settings"],
      }),
      baseContext: {},
    });

    expect(runtime.services.settings?.set("theme", "night")).toBe(false);
    expect(runtime.services.settings?.get("theme", "day")).toBe("day");
  });

  it("creates and tracks shell-window app runtimes through the launcher", () => {
    const subscribers = new Set();
    const windows = new Map([[
      "calculator",
      {
        id: "calculator",
        title: "Calculator",
        state: "closed",
        element: { hidden: true },
      },
    ]]);
    const emit = (event, record) => {
      for (const listener of subscribers) listener({ event, record, manager: shellManager });
    };
    const shellManager = {
      getWindow: vi.fn((id) => windows.get(id) || null),
      listWindows: vi.fn(() => Array.from(windows.values())),
      openWindow: vi.fn((id) => {
        const record = windows.get(id);
        record.state = "open";
        record.element.hidden = false;
        emit("opened", record);
        return record;
      }),
      restoreWindow: vi.fn((id) => {
        const record = windows.get(id);
        record.state = "open";
        record.element.hidden = false;
        emit("restored", record);
        return record;
      }),
      activateWindow: vi.fn((id) => {
        const record = windows.get(id);
        emit("activated", record);
        return record;
      }),
      closeWindow: vi.fn((id) => {
        const record = windows.get(id);
        record.state = "closed";
        record.element.hidden = true;
        emit("closed", record);
        return record;
      }),
      subscribe: vi.fn((listener) => {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      }),
    };
    const manager = createShellAppRuntimeManager({ shellManager, baseContext: {} });
    const launcher = createAppLauncher({ shellManager, shellAppRuntimeManager: manager });
    manager.setLauncher(launcher);

    expect(launcher.openApp("vatio.calculator")).toBe(true);
    const runtime = manager.getRuntime("vatio.calculator");
    expect(runtime?.appId).toBe("vatio.calculator");
    expect(runtime?.lifecycle.getState()).toBe("active");

    windows.get("calculator").state = "minimized";
    windows.get("calculator").element.hidden = true;
    expect(launcher.openApp("vatio.calculator")).toBe(true);
    expect(shellManager.restoreWindow).toHaveBeenCalledWith("calculator", {});
    expect(runtime?.lifecycle.getState()).toBe("active");

    expect(launcher.closeApp("vatio.calculator")).toBe(true);
    expect(runtime?.lifecycle.getState()).toBe("unmounted");
    expect(launcher.getAppRuntime?.("vatio.calculator")).toBe(runtime);

    manager.destroy();
  });

  it("lazy-loads shell-window entries that export createShellWindowApp", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const shellManager = createShellWindowManager({ root });
    const manager = createShellAppRuntimeManager({ shellManager, baseContext: {} });
    const launcher = createAppLauncher({ shellManager, shellAppRuntimeManager: manager });
    manager.setLauncher(launcher);

    expect(shellManager.getWindow("calculator")).toBeNull();
    await expect(launcher.openAppAsync("vatio.calculator")).resolves.toBe(true);
    expect(shellManager.getWindow("calculator")).toMatchObject({
      id: "calculator",
      title: "Calculator",
    });

    manager.destroy();
    shellManager.destroy();
    root.remove();
  });

  it("adapters expose route, tool, and shell-window definitions for legacy code", () => {
    const routes = getRouteRegistryFromApps();
    expect(routes.find((route) => route.path === "/apps")?.title).toBe("App Manager");
    expect(routes.find((route) => route.path === "/")?.aliases).toContain("/speed");

    const startMenuTools = getToolDefinitionsForSurfaceFromApps("start-menu");
    expect(startMenuTools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(["route:speed", "route:apps", "calculator"]),
    );
    expect(getRouteToolDefinitionFromApps("/speed")?.id).toBe("route:speed");
    expect(getToolDefinitionForShellWindowFromApps("calculator")?.id).toBe("calculator");

    const calculatorWindow = getShellWindowDefinitionFromApps("calculator");
    expect(calculatorWindow).toMatchObject({
      id: "calculator",
      title: "Calculator",
      capabilities: expect.objectContaining({ draggable: true, maxWidth: 320 }),
    });
  });
});
