import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppPermissionRuntime,
  createAppRegistry,
  createAppRuntime,
  createAppStorage,
} from "../../src/app-platform/index.js";
import { getRouteRegistryFromApps } from "../../src/app-platform/adapters/route-registry-adapter.js";
import {
  getRouteToolDefinitionFromApps,
  getToolDefinitionForShellWindowFromApps,
  getToolDefinitionsForSurfaceFromApps,
} from "../../src/app-platform/adapters/tool-registry-adapter.js";
import { getShellWindowDefinitionFromApps } from "../../src/app-platform/adapters/shell-window-registry-adapter.js";

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
      makeManifest({ id: "test.second", order: 20, route: "/second" }),
      makeManifest({ id: "test.first", order: 10, route: "/first" }),
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
