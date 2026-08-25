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
import { codeRainAppManifest } from "../../src/apps/code-rain/manifest.js";
import { premiumClockAppManifest } from "../../src/apps/premium-clock/manifest.js";
import { qrScannerAppManifest } from "../../src/apps/qr-scanner/manifest.js";
import { speedAppManifest } from "../../src/apps/speed/manifest.js";
import { wazeAppManifest } from "../../src/apps/waze/manifest.js";
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

  it("accepts camera media permissions for scanner-style apps", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const manifest = makeManifest({
      id: "test.camera",
      permissions: ["storage.app", "i18n.read", "media.camera"],
    });
    const validation = registry.validateAppManifest(manifest);
    const permissions = createAppPermissionRuntime(manifest);

    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(permissions.require("media.camera")).toBe(true);
  });

  it("accepts the QR scanner service and warns when camera permission is missing", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const withCamera = registry.validateAppManifest(makeManifest({
      id: "test.qr",
      permissions: ["storage.app", "i18n.read", "media.camera"],
      services: ["storage", "i18n", "qrScanner"],
    }));
    const withoutCamera = registry.validateAppManifest(makeManifest({
      id: "test.qr.no-camera",
      permissions: ["storage.app", "i18n.read"],
      services: ["storage", "i18n", "qrScanner"],
    }));

    expect(withCamera.ok).toBe(true);
    expect(withCamera.warnings).toEqual([]);
    expect(withoutCamera.ok).toBe(true);
    expect(withoutCamera.warnings).toContain('service "qrScanner" requires permission "media.camera".');
  });

  it("exposes the QR scanner service through a media.camera-gated runtime gateway", async () => {
    const createCameraSession = vi.fn(async () => ({
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
      setCamera: vi.fn(),
      isActive: vi.fn(() => false),
    }));
    const qrScannerService = {
      hasCamera: vi.fn(async () => true),
      listCameras: vi.fn(async () => [{ id: "environment", label: "Back camera" }]),
      createCameraSession,
      scanImage: vi.fn(async () => ({ data: "qr-data" })),
    };
    const runtime = createAppRuntime({
      manifest: makeManifest({
        id: "test.qr.runtime",
        permissions: ["media.camera"],
        services: ["qrScanner"],
      }),
      baseContext: { qrScannerService },
    });
    const deniedRuntime = createAppRuntime({
      manifest: makeManifest({
        id: "test.qr.denied",
        permissions: [],
        services: ["qrScanner"],
      }),
      baseContext: { qrScannerService },
    });

    expect(await runtime.services.qrScanner?.hasCamera()).toBe(true);
    expect(await runtime.services.qrScanner?.listCameras()).toEqual([{ id: "environment", label: "Back camera" }]);
    await expect(runtime.services.qrScanner?.scanImage(new Blob(["qr"]))).resolves.toEqual({ data: "qr-data" });
    await runtime.services.qrScanner?.createCameraSession({
      video: document.createElement("video"),
      onResult: vi.fn(),
    });
    expect(createCameraSession).toHaveBeenCalled();

    expect(await deniedRuntime.services.qrScanner?.hasCamera()).toBe(false);
    expect(await deniedRuntime.services.qrScanner?.listCameras()).toEqual([]);
    await expect(deniedRuntime.services.qrScanner?.createCameraSession({
      video: document.createElement("video"),
      onResult: vi.fn(),
    })).rejects.toThrow("permission denied");
    await expect(deniedRuntime.services.qrScanner?.scanImage(new Blob(["qr"]))).resolves.toEqual({ data: "qr-data" });
  });

  it("imports representative app-owned manifests into the built-in registry", () => {
    expect(BUILTIN_APP_MANIFESTS).toEqual(expect.arrayContaining([
      speedAppManifest,
      wazeAppManifest,
      boardAppManifest,
      calculatorAppManifest,
      codeRainAppManifest,
      premiumClockAppManifest,
      qrScannerAppManifest,
    ]));
    expect(appRegistry.getApp("vatio.speed")).toBe(speedAppManifest);
    expect(appRegistry.getApp("vatio.waze")).toBe(wazeAppManifest);
    expect(appRegistry.getApp("vatio.board")).toBe(boardAppManifest);
    expect(appRegistry.getApp("vatio.calculator")).toBe(calculatorAppManifest);
    expect(appRegistry.getApp("vatio.codeRain")).toBe(codeRainAppManifest);
    expect(appRegistry.getApp("vatio.premiumClock")).toBe(premiumClockAppManifest);
    expect(appRegistry.getApp("vatio.qrScanner")).toBe(qrScannerAppManifest);
    expect(appRegistry.getAppsForPermission("media.camera").map((app) => app.id)).toContain("vatio.qrScanner");
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

  it("requires shell service declaration as well as shell permissions before launching apps", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const launcher = {
      openApp: vi.fn(() => true),
      openAppAsync: vi.fn(async () => true),
      closeApp: vi.fn(() => true),
      focusApp: vi.fn(() => true),
      getInstalledApps: vi.fn(() => []),
      getRunningApps: vi.fn(() => []),
    };
    const shellManager = {
      listWindows: vi.fn(() => []),
    };
    const withoutShellService = createAppRuntime({
      manifest: makeManifest({
        id: "test.shell.permission.only",
        permissions: ["shell.launchApp"],
        services: [],
      }),
      launcher,
      shellManager,
    });

    expect(withoutShellService.shell.openApp("vatio.speed")).toBe(false);
    await expect(withoutShellService.shell.openAppAsync?.("vatio.speed")).resolves.toBe(false);
    expect(withoutShellService.shell.focusApp("vatio.speed")).toBe(false);
    expect(withoutShellService.shell.closeApp("vatio.calculator")).toBe(false);
    expect(withoutShellService.shell.shellManager).toBeNull();
    expect(launcher.openApp).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[vatioboard:app:test.shell.permission.only]"),
      expect.stringContaining('service "shell" is not declared'),
    );

    const withShellService = createAppRuntime({
      manifest: makeManifest({
        id: "test.shell.permission.and.service",
        permissions: ["shell.launchApp"],
        services: ["shell"],
      }),
      launcher,
      shellManager,
    });

    expect(withShellService.shell.openApp("vatio.speed")).toBe(true);
    await expect(withShellService.shell.openAppAsync?.("vatio.speed")).resolves.toBe(true);
    expect(withShellService.shell.focusApp("vatio.speed")).toBe(true);
    expect(withShellService.shell.closeApp("vatio.calculator")).toBe(true);
    expect(withShellService.shell.shellManager).toBeNull();
  });

  it("exposes raw shellManager only with shell service and shell.window permission", () => {
    const shellManager = {
      listWindows: vi.fn(() => []),
    };

    const withoutShellWindow = createAppRuntime({
      manifest: makeManifest({
        id: "test.shell.launch.only",
        permissions: ["shell.launchApp"],
        services: ["shell"],
      }),
      shellManager,
    });
    expect(withoutShellWindow.shell.shellManager).toBeNull();

    const withShellWindow = createAppRuntime({
      manifest: makeManifest({
        id: "test.shell.window",
        permissions: ["shell.window"],
        services: ["shell"],
      }),
      shellManager,
    });
    expect(withShellWindow.shell.shellManager).toBe(shellManager);
  });

  it("keeps raw shellManager available for built-in shell-window apps", () => {
    const shellManager = {
      listWindows: vi.fn(() => []),
    };
    const shellWindowApps = appRegistry.listApps().filter((manifest) =>
      manifest.surfaces.includes("shell-window")
    );

    expect(shellWindowApps.length).toBeGreaterThan(0);
    for (const manifest of shellWindowApps) {
      expect(manifest.services).toContain("shell");
      expect(manifest.permissions).toContain("shell.window");
      const runtime = createAppRuntime({ manifest, shellManager });
      expect(runtime.shell.shellManager).toBe(shellManager);
    }
  });

  it("requires network.backend for backend auth and cloud sync gateways", () => {
    const withoutNetwork = createAppRuntime({
      manifest: makeManifest({
        id: "test.backend.without.network",
        permissions: ["auth.session", "cloud.sync"],
        services: ["auth", "cloudSync"],
      }),
      baseContext: {},
    });

    expect(withoutNetwork.services.auth).toBeNull();
    expect(withoutNetwork.services.cloudSync).toBeNull();

    const withNetwork = createAppRuntime({
      manifest: makeManifest({
        id: "test.backend.with.network",
        permissions: ["auth.session", "cloud.sync", "network.backend"],
        services: ["auth", "cloudSync"],
      }),
      baseContext: {},
    });

    expect(withNetwork.services.auth).not.toBeNull();
    expect(withNetwork.services.cloudSync).not.toBeNull();
  });

  it("exposes backend services for built-in manifests that declare backend access", () => {
    const manifests = appRegistry.listApps();
    const backendApps = manifests.filter((manifest) =>
      manifest.services.includes("auth") || manifest.services.includes("cloudSync")
    );

    expect(backendApps.length).toBeGreaterThan(0);
    for (const manifest of backendApps) {
      expect(manifest.permissions).toContain("network.backend");
      const runtime = createAppRuntime({ manifest, baseContext: {} });
      if (manifest.services.includes("auth")) expect(runtime.services.auth).not.toBeNull();
      if (manifest.services.includes("cloudSync")) expect(runtime.services.cloudSync).not.toBeNull();
    }
  });

  it("warns for manifest permission and service dependency gaps", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const validation = registry.validateAppManifest(makeManifest({
      surfaces: ["main-route", "shell-window"],
      permissions: ["shell.launchApp"],
      services: ["auth", "cloudSync", "shell", "storage", "i18n"],
      window: {
        shellWindowId: "dependency-test",
        mode: "floating",
        defaultBounds: { left: 0, top: 0, width: 100 },
        capabilities: {},
        restoreOnBoot: true,
        lazy: false,
      },
    }));

    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual(expect.arrayContaining([
      'service "auth" requires permission "auth.session".',
      'service "auth" requires permission "network.backend".',
      'service "cloudSync" requires permission "cloud.sync".',
      'service "cloudSync" requires permission "network.backend".',
      'surface "shell-window" requires permission "shell.window".',
      'service "storage" requires permission "storage.app".',
      'service "i18n" requires permission "i18n.read".',
    ]));
  });

  it("warns when shell permissions or surfaces omit the shell service", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const withShellPermissionOnly = registry.validateAppManifest(makeManifest({
      permissions: ["storage.app", "i18n.read", "shell.launchApp"],
      services: ["storage", "i18n"],
    }));
    expect(withShellPermissionOnly.warnings).toContain('shell permissions are declared without service "shell".');

    const withShellWindowSurfaceOnly = registry.validateAppManifest(makeManifest({
      route: undefined,
      aliases: [],
      surfaces: ["shell-window"],
      permissions: ["storage.app", "i18n.read", "shell.window"],
      services: ["storage", "i18n"],
      window: {
        shellWindowId: "missing-shell-service",
        mode: "floating",
        defaultBounds: { left: 0, top: 0, width: 100 },
        capabilities: {},
        restoreOnBoot: true,
        lazy: false,
      },
    }));
    expect(withShellWindowSurfaceOnly.warnings).toEqual(expect.arrayContaining([
      'surface "shell-window" requires service "shell".',
      'shell permissions are declared without service "shell".',
    ]));
  });

  it("warns when shell service has no shell capability permission", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const validation = registry.validateAppManifest(makeManifest({
      permissions: ["storage.app", "i18n.read"],
      services: ["shell", "storage", "i18n"],
    }));

    expect(validation.warnings).toContain('service "shell" requires permission "shell.launchApp" or "shell.window".');
  });

  it("built-in manifests have no platform dependency warnings", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });

    for (const manifest of appRegistry.listApps()) {
      expect(registry.validateAppManifest(manifest).warnings).toEqual([]);
    }
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

  it("preloads persisted restorable shell-window apps before layout restore", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const createShellWindowApp = vi.fn(({ mount, shellManager }) => {
      const panel = document.createElement("section");
      panel.hidden = true;
      mount.append(panel);
      shellManager.registerWindow({
        id: "restore-window",
        title: "Restore Window",
        element: panel,
        restoreOnBoot: true,
        capabilities: { minWidth: 120, minHeight: 100 },
        defaultBounds: { left: 10, top: 10, width: 220, height: 160 },
        lifecycle: {
          open: () => {
            panel.hidden = false;
          },
          close: () => {
            panel.hidden = true;
          },
          minimize: () => {
            panel.hidden = true;
          },
          restore: () => {
            panel.hidden = false;
          },
        },
      });
    });
    const openEntry = vi.fn(async () => ({ createShellWindowApp }));
    const closedEntry = vi.fn(async () => ({ createShellWindowApp: vi.fn() }));
    const optOutEntry = vi.fn(async () => ({ createShellWindowApp: vi.fn() }));

    registry.registerApps([
      makeManifest({
        id: "test.restore.open",
        route: undefined,
        aliases: [],
        entry: openEntry,
        surfaces: ["shell-window"],
        permissions: ["storage.app", "shell.window"],
        services: ["storage", "shell"],
        window: {
          shellWindowId: "restore-window",
          mode: "floating",
          defaultBounds: { left: 10, top: 10, width: 220, height: 160 },
          capabilities: { minWidth: 120, minHeight: 100 },
          restoreOnBoot: true,
          lazy: true,
        },
      }),
      makeManifest({
        id: "test.restore.closed",
        route: undefined,
        aliases: [],
        entry: closedEntry,
        surfaces: ["shell-window"],
        permissions: ["storage.app", "shell.window"],
        services: ["storage", "shell"],
        window: {
          shellWindowId: "closed-window",
          mode: "floating",
          defaultBounds: { left: 20, top: 20, width: 200, height: 120 },
          capabilities: {},
          restoreOnBoot: true,
          lazy: true,
        },
      }),
      makeManifest({
        id: "test.restore.optout",
        route: undefined,
        aliases: [],
        entry: optOutEntry,
        surfaces: ["shell-window"],
        permissions: ["storage.app", "shell.window"],
        services: ["storage", "shell"],
        window: {
          shellWindowId: "optout-window",
          mode: "floating",
          defaultBounds: { left: 30, top: 30, width: 200, height: 120 },
          capabilities: {},
          restoreOnBoot: false,
          lazy: true,
        },
      }),
    ]);
    localStorage.setItem("vatioboard.shell.layout.v1", JSON.stringify({
      version: 1,
      activeWindowId: "restore-window",
      windows: {
        "restore-window": {
          state: "open",
          previousState: "closed",
          bounds: { left: 42, top: 64, width: 260, height: 180 },
          restoreBounds: { left: 42, top: 64, width: 260, height: 180 },
          zIndex: 1200,
          minimized: false,
          snap: null,
          updatedAt: 1,
        },
        "closed-window": {
          state: "closed",
          previousState: "open",
          bounds: { left: 20, top: 20, width: 200, height: 120 },
          restoreBounds: { left: 20, top: 20, width: 200, height: 120 },
          zIndex: 1000,
          minimized: false,
          snap: null,
          updatedAt: 1,
        },
        "optout-window": {
          state: "open",
          previousState: "closed",
          bounds: { left: 30, top: 30, width: 200, height: 120 },
          restoreBounds: { left: 30, top: 30, width: 200, height: 120 },
          zIndex: 1000,
          minimized: false,
          snap: null,
          updatedAt: 1,
        },
      },
    }));

    const shellManager = createShellWindowManager({ root });
    const launcher = createAppLauncher({ shellManager, registry });

    await expect(launcher.restorePersistedShellWindows()).resolves.toEqual(["test.restore.open"]);
    expect(openEntry).toHaveBeenCalledTimes(1);
    expect(closedEntry).not.toHaveBeenCalled();
    expect(optOutEntry).not.toHaveBeenCalled();

    const registered = shellManager.getWindow("restore-window");
    expect(registered).toMatchObject({
      state: "open",
      bounds: { left: 42, top: 64, width: 260, height: 180 },
    });
    expect(registered.element.hidden).toBe(true);

    shellManager.restoreShellLayout();
    expect(shellManager.getWindow("restore-window").element.hidden).toBe(false);

    shellManager.destroy();
    root.remove();
  });

  it("adapters expose route, tool, and shell-window definitions for legacy code", () => {
    const routes = getRouteRegistryFromApps();
    expect(routes.find((route) => route.path === "/apps")?.title).toBe("App Manager");
    expect(routes.find((route) => route.path === "/")?.aliases).toContain("/speed");
    expect(routes.find((route) => route.path === "/waze")?.title).toBe("Waze Map");
    expect(routes.find((route) => route.path === "/qr-scanner")?.title).toBe("QR Scanner");

    const startMenuTools = getToolDefinitionsForSurfaceFromApps("start-menu");
    expect(startMenuTools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(["route:speed", "route:waze", "route:apps", "route:qr-scanner", "calculator"]),
    );
    expect(getToolDefinitionsForSurfaceFromApps("launcher").map((tool) => tool.id)).toContain("route:qr-scanner");
    expect(getRouteToolDefinitionFromApps("/speed")?.id).toBe("route:speed");
    expect(getRouteToolDefinitionFromApps("/waze")?.id).toBe("route:waze");
    expect(getRouteToolDefinitionFromApps("/qr-scanner")?.id).toBe("route:qr-scanner");
    expect(getToolDefinitionForShellWindowFromApps("calculator")?.id).toBe("calculator");

    const calculatorWindow = getShellWindowDefinitionFromApps("calculator");
    expect(calculatorWindow).toMatchObject({
      id: "calculator",
      title: "Calculator",
      capabilities: expect.objectContaining({
        draggable: true,
        minWidth: 320,
        minHeight: 320,
        maxWidth: 620,
        maxHeight: 548,
      }),
    });
  });
});
