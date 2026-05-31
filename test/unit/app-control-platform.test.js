import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appControl,
  appRegistry,
  clearAppPrivateStorage,
  createAppControlService,
  createAppLauncher,
  createAppPermissionRuntime,
  createAppRegistry,
  createAppRuntime,
  createBackgroundServiceManager,
  createShellAppRuntimeManager,
  sharedSettings,
  loadLegacyBackedDistanceUnit,
  loadLegacyBackedSpeedUnit,
} from "../../src/app-platform/index.js";
import { loadConfiguredSpeedUnit } from "../../src/shared/unit-bootstrap.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { initFloatingTools } from "../../src/shared/floating-tools.js";
import { initSharedStartMenu } from "../../src/shared/start-menu.js";
import { getStartMenuToolDefinitions } from "../../src/shared/tool-registry.js";
import appsTemplate from "../../src/app/views/templates/apps-template.js";
import { mountAppsRoute } from "../../src/apps/app-manager/app-manager.js";

function cleanupStack() {
  const callbacks = [];
  return {
    add(callback) {
      if (typeof callback === "function") callbacks.push(callback);
      return callback;
    },
    addEventListener(target, type, listener, options) {
      target?.addEventListener?.(type, listener, options);
      callbacks.push(() => target?.removeEventListener?.(type, listener, options));
    },
    run() {
      while (callbacks.length) callbacks.pop()?.();
    },
  };
}

function mountAppManagerRoute(extraContext = {}) {
  const root = document.createElement("main");
  root.innerHTML = appsTemplate;
  document.body.append(root);
  const cleanup = cleanupStack();
  const runtime = createAppRuntime({
    manifest: appRegistry.getApp("vatio.appManager"),
    baseContext: {},
  });

  mountAppsRoute({
    root,
    context: {
      appRuntime: runtime,
      navigate: vi.fn(() => true),
      ...extraContext,
    },
    cleanup,
  });

  return { root, cleanup, runtime };
}

function createAudioRuntimeMock() {
  return {
    getState: vi.fn(() => ({
      queue: [],
      playedHistory: [],
      currentIndex: 0,
      paused: false,
      volume: 0.8,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: true,
      sourceType: null,
      currentTrack: null,
      loading: false,
      error: null,
      remoteSessionActive: false,
      currentTime: 0,
      duration: 0,
      playing: true,
    })),
    subscribe: vi.fn(() => vi.fn()),
    setMediaSessionEnabled: vi.fn(),
    primeAudio: vi.fn(async () => true),
    play: vi.fn(() => true),
    pause: vi.fn(),
    stopPlayback: vi.fn(),
  };
}

function createDrivingAlertServiceMock() {
  const snapshot = {
    status: "active",
    started: true,
    currentSpeedMs: 12,
    latestPosition: null,
    alertUiState: {},
    audio: {},
    preferences: {},
  };
  return {
    start: vi.fn(() => snapshot),
    stop: vi.fn(() => snapshot),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => snapshot),
    primeAudioFromUserGesture: vi.fn(async () => true),
    setMuted: vi.fn(() => snapshot),
    destroy: vi.fn(),
  };
}

describe("VatioBoard OS app control plane", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;
    vi.restoreAllMocks();
  });

  it("recovers corrupt app control storage and protects core system apps", () => {
    localStorage.setItem("vatioboard.os.appControl.v1", "{");

    expect(appControl.getState("vatio.calculator")).toMatchObject({
      appId: "vatio.calculator",
      enabled: true,
    });
    expect(appControl.setEnabled("vatio.speed", false)).toBe(false);
    expect(appControl.isEnabled("vatio.speed")).toBe(true);

    expect(appControl.setEnabled("vatio.calculator", false)).toBe(true);
    expect(appControl.isEnabled("vatio.calculator")).toBe(false);
  });

  it("enforces declared and granted permissions", () => {
    const warn = vi.fn();
    const manifest = appRegistry.getApp("vatio.calculator");
    expect(manifest).toBeTruthy();

    appControl.revokePermission("vatio.calculator", "settings.write");
    const permissions = createAppPermissionRuntime(manifest, { warn });

    expect(permissions.has("settings.read")).toBe(true);
    expect(permissions.require("settings.write")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Grant it in App Manager"));
    expect(appControl.grantPermission("vatio.calculator", "gps.read")).toBe(false);

    const runtime = createAppRuntime({ manifest, baseContext: {} });
    expect(runtime.services.settings?.setJson("preferences", { decimals: 4 })).toBe(false);
  });

  it("denies already-created audio services after playback permission is revoked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const audioRuntime = createAudioRuntimeMock();
    const runtime = createAppRuntime({
      manifest: appRegistry.getApp("vatio.player"),
      baseContext: { audioRuntime },
    });

    expect(runtime.services.audio).toBeTruthy();
    expect(runtime.services.audio?.play()).toBe(true);

    expect(appControl.revokePermission("vatio.player", "audio.playback")).toBe(true);
    expect(runtime.services.audio?.play()).toBe(false);
    await expect(runtime.services.audio?.primeAudio()).resolves.toBe(false);
    expect(runtime.services.audio?.getState()).toMatchObject({
      paused: true,
      muted: true,
      error: "permission-denied",
    });
    expect(audioRuntime.play).toHaveBeenCalledTimes(1);
    expect(audioRuntime.primeAudio).not.toHaveBeenCalled();
    expect(audioRuntime.stopPlayback).not.toHaveBeenCalled();
    expect(audioRuntime.pause).not.toHaveBeenCalled();
  });

  it("denies already-created driving alert services after speed alert permission is revoked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const drivingAlertService = createDrivingAlertServiceMock();
    const runtime = createAppRuntime({
      manifest: appRegistry.getApp("vatio.speedAlerts"),
      baseContext: { drivingAlertService },
    });

    expect(runtime.services.drivingAlerts).toBeTruthy();
    expect(runtime.services.drivingAlerts?.start()).toMatchObject({ status: "active" });

    expect(appControl.revokePermission("vatio.speedAlerts", "alerts.speed")).toBe(true);
    expect(runtime.services.drivingAlerts?.start()).toMatchObject({ status: "permission-denied" });
    expect(runtime.services.drivingAlerts?.setMuted?.(true)).toMatchObject({ status: "permission-denied" });
    await expect(runtime.services.drivingAlerts?.primeAudioFromUserGesture?.()).resolves.toBe(false);
    expect(drivingAlertService.start).toHaveBeenCalledTimes(1);
    expect(drivingAlertService.setMuted).not.toHaveBeenCalled();
    expect(drivingAlertService.stop).not.toHaveBeenCalled();
    expect(drivingAlertService.destroy).not.toHaveBeenCalled();
  });

  it("denies already-created auth, cloud sync, settings, and shared settings services after revocation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = createAppRuntime({
      manifest: appRegistry.getApp("vatio.board"),
      baseContext: {},
    });

    expect(runtime.services.auth).toBeTruthy();
    expect(runtime.services.cloudSync).toBeTruthy();
    expect(runtime.services.settings).toBeTruthy();
    expect(runtime.services.sharedSettings).toBeTruthy();

    appControl.revokePermission("vatio.board", "auth.session");
    appControl.revokePermission("vatio.board", "cloud.sync");
    appControl.revokePermission("vatio.board", "settings.read");
    appControl.revokePermission("vatio.board", "settings.write");

    await expect(runtime.services.auth?.getSessionState()).resolves.toBeNull();
    await expect(runtime.services.auth?.getFeatureAccessState()).resolves.toBeNull();
    await expect(runtime.services.cloudSync?.getStatus()).resolves.toBeNull();
    await expect(runtime.services.cloudSync?.request()).resolves.toBeNull();
    expect(runtime.services.settings?.get("inkRaw", "fallback")).toBe("fallback");
    expect(runtime.services.settings?.set("inkRaw", "#fff")).toBe(false);
    expect(runtime.services.sharedSettings?.get("distanceUnit")).toBeNull();
    expect(runtime.services.sharedSettings?.getAll()).toEqual({});
    expect(runtime.services.sharedSettings?.set("distanceUnit", "ft")).toBe(false);
  });

  it("protects critical permissions on protected apps while leaving non-critical permissions controllable", () => {
    expect(appControl.revokePermission("vatio.speed", "gps.read")).toBe(false);
    expect(appControl.hasGrantedPermission("vatio.speed", "gps.read")).toBe(true);
    expect(appControl.revokePermission("vatio.appManager", "settings.read")).toBe(false);
    expect(appControl.hasGrantedPermission("vatio.appManager", "settings.read")).toBe(true);

    expect(appControl.revokePermission("vatio.speed", "audio.playback")).toBe(true);
    expect(appControl.hasGrantedPermission("vatio.speed", "audio.playback")).toBe(false);
    expect(appControl.resetAppControlState("vatio.speed")).toBe(true);
    expect(appControl.hasGrantedPermission("vatio.speed", "audio.playback")).toBe(true);
  });

  it("blocks disabled launcher and start-menu launches", () => {
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const shellAppRuntimeManager = createShellAppRuntimeManager({ shellManager, baseContext: {} });
    const launcher = createAppLauncher({ shellManager, shellAppRuntimeManager });
    shellAppRuntimeManager.setLauncher(launcher);
    const floatingTools = initFloatingTools({ mount: document.body, shellManager, shellAppRuntimeManager });

    appControl.setEnabled("vatio.calculator", false);
    expect(launcher.openApp("vatio.calculator")).toBe(false);

    const startMenu = initSharedStartMenu({ floatingTools, mount: document.body, shellAppRuntimeManager });
    startMenu.setOpen(true);
    startMenu.list.querySelector("[data-start-action='calculator']").click();
    expect(shellManager.getWindow("calculator")?.state).not.toBe("open");

    appControl.setEnabled("vatio.calculator", true);
    expect(launcher.openApp("vatio.calculator")).toBe(true);
    expect(shellManager.getWindow("calculator")?.state).toBe("open");

    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps app-private storage reset isolated from app control state", () => {
    appControl.setPinned("vatio.calculator", true);
    localStorage.setItem("vatioboard.app.vatio.calculator.settings.preferences", JSON.stringify({ decimals: 5 }));

    expect(clearAppPrivateStorage("vatio.calculator")).toBe(true);
    expect(localStorage.getItem("vatioboard.app.vatio.calculator.settings.preferences")).toBeNull();
    expect(appControl.isPinned("vatio.calculator")).toBe(true);
  });

  it("uses legacy speed unit preferences as canonical while mirroring shared settings", () => {
    sharedSettings.set("speedUnit", "mph");
    localStorage.setItem("vatio_speed_unit", "kmh");

    expect(loadConfiguredSpeedUnit("mph")).toBe("kmh");
    expect(sharedSettings.get("speedUnit")).toBe("kmh");

    localStorage.removeItem("vatio_speed_unit");
    sharedSettings.set("speedUnit", "mph");
    expect(loadConfiguredSpeedUnit("kmh")).toBe("mph");
    expect(localStorage.getItem("vatio_speed_unit")).toBe("mph");
  });

  it("does not seed legacy unit keys from default-filled shared settings", () => {
    expect(loadLegacyBackedSpeedUnit("legacy_speed", "mph")).toBe("mph");
    expect(localStorage.getItem("legacy_speed")).toBeNull();
    expect(loadLegacyBackedDistanceUnit("legacy_distance", "ft")).toBe("ft");
    expect(localStorage.getItem("legacy_distance")).toBeNull();
  });

  it("seeds legacy unit keys only from explicit shared settings and lets legacy values win", () => {
    sharedSettings.set("speedUnit", "mph");
    sharedSettings.set("distanceUnit", "ft");

    expect(loadLegacyBackedSpeedUnit("legacy_speed", "kmh")).toBe("mph");
    expect(localStorage.getItem("legacy_speed")).toBe("mph");
    expect(loadLegacyBackedDistanceUnit("legacy_distance", "m")).toBe("ft");
    expect(localStorage.getItem("legacy_distance")).toBe("ft");

    localStorage.setItem("legacy_speed", "kmh");
    localStorage.setItem("legacy_distance", "m");
    expect(loadLegacyBackedSpeedUnit("legacy_speed", "mph")).toBe("kmh");
    expect(loadLegacyBackedDistanceUnit("legacy_distance", "ft")).toBe("m");
    expect(sharedSettings.get("speedUnit")).toBe("kmh");
    expect(sharedSettings.get("distanceUnit")).toBe("m");
  });

  it("autostarts conservative internal background services", () => {
    const manager = createBackgroundServiceManager({ baseContext: {} });
    const services = manager.startAutostartServices();

    expect(services.map((service) => service.appId)).toContain("vatio.offlineReadiness");
    expect(manager.getRuntime("vatio.offlineReadiness")?.lifecycle.getState()).toBe("active");
    expect(manager.suspend("vatio.offlineReadiness")).toBe(true);
    expect(manager.getRuntime("vatio.offlineReadiness")?.lifecycle.getState()).toBe("suspended");
    expect(manager.resume("vatio.offlineReadiness")).toBe(true);
    expect(manager.getRuntime("vatio.offlineReadiness")?.lifecycle.getState()).toBe("active");
    expect(manager.stop("vatio.offlineReadiness")).toBe(true);
    expect(manager.getRuntime("vatio.offlineReadiness")).toBeNull();

    manager.destroy();
    expect(manager.listServices()).toEqual([]);
  });

  it("does not autostart disabled non-protected background services and stops them when disabled", () => {
    const registry = createAppRegistry({ logger: { warn: vi.fn() } });
    const backgroundManifest = {
      ...appRegistry.getApp("vatio.offlineReadiness"),
      id: "test.background",
      title: "Test Background",
      shortTitle: "Test BG",
      order: 1,
      metadata: {},
    };
    registry.registerApp(backgroundManifest);
    const control = createAppControlService({ registry, storage: localStorage });
    const manager = createBackgroundServiceManager({ registry, control, baseContext: {} });

    control.setEnabled("test.background", false);
    expect(manager.startAutostartServices()).toEqual([]);
    expect(manager.getRuntime("test.background")).toBeNull();

    control.setEnabled("test.background", true);
    expect(manager.start("test.background")).toBe(true);
    expect(manager.getRuntime("test.background")?.lifecycle.getState()).toBe("active");

    control.setEnabled("test.background", false);
    expect(manager.getRuntime("test.background")).toBeNull();
    manager.destroy();
  });

  it("renders App Manager controls and persists enable state changes", () => {
    const { root, cleanup } = mountAppManagerRoute();

    const calculatorCard = root.querySelector("[data-app-id='vatio.calculator']");
    expect(calculatorCard).toBeTruthy();
    expect(calculatorCard.dataset.enabled).toBe("true");

    calculatorCard.querySelector(".vb-app-manager-toggle").click();
    const disabledCard = root.querySelector("[data-app-id='vatio.calculator']");
    expect(appControl.isEnabled("vatio.calculator")).toBe(false);
    expect(disabledCard.dataset.enabled).toBe("false");
    expect(disabledCard.querySelector(".vb-app-manager-launch").disabled).toBe(true);
    expect(root.querySelector("[data-app-id='vatio.speed'] .vb-app-manager-toggle").disabled).toBe(true);
    expect(root.querySelector("[data-app-id='vatio.speed'] [data-protected-permission='true'] button").disabled).toBe(true);

    cleanup.run();
  });

  it("sorts pinned and favorite apps ahead in App Manager", () => {
    appControl.setPinned("vatio.energy", true);
    appControl.setFavorite("vatio.calculator", true);

    const { root, cleanup } = mountAppManagerRoute();
    const appIds = Array.from(root.querySelectorAll("[data-app-id]")).map((card) => card.dataset.appId);

    expect(appControl.getState("vatio.energy").pinned).toBe(true);
    expect(appControl.getState("vatio.calculator").favorite).toBe(true);
    expect(getStartMenuToolDefinitions()[0].id).toBe("energy");
    expect(appIds[0]).toBe("vatio.energy");
    expect(appIds[1]).toBe("vatio.calculator");
    cleanup.run();
  });

  it("hides non-protected apps from Start Menu without removing them from App Manager", () => {
    expect(appControl.setHiddenFromStartMenu("vatio.calculator", true)).toBe(true);
    expect(getStartMenuToolDefinitions().map((tool) => tool.id)).not.toContain("calculator");
    expect(appControl.setHiddenFromStartMenu("vatio.speed", true)).toBe(false);

    const { root, cleanup } = mountAppManagerRoute();
    expect(root.querySelector("[data-app-id='vatio.calculator']")).toBeTruthy();
    expect(root.querySelector("[data-app-id='vatio.calculator']").textContent).toContain("Hidden from Start");
    cleanup.run();
  });

  it("shows background service running state and controls in App Manager", () => {
    const backgroundServiceManager = createBackgroundServiceManager({ baseContext: {} });
    backgroundServiceManager.start("vatio.offlineReadiness");

    const { root, cleanup } = mountAppManagerRoute({ backgroundServiceManager });
    const backgroundCard = root.querySelector("[data-app-id='vatio.offlineReadiness']");

    expect(backgroundCard).toBeTruthy();
    expect(backgroundCard.textContent).toContain("Running: Active");
    expect(Array.from(backgroundCard.querySelectorAll("button")).map((button) => button.textContent)).toEqual(
      expect.arrayContaining(["Start", "Suspend", "Resume", "Stop"]),
    );

    cleanup.run();
    backgroundServiceManager.destroy();
  });

  it("requires confirmation before resetting app-private storage from App Manager", () => {
    appControl.setPinned("vatio.calculator", true);
    localStorage.setItem("vatioboard.app.vatio.calculator.settings.preferences", JSON.stringify({ decimals: 5 }));
    localStorage.setItem("vatio_legacy_player_queue", "keep");

    const { root, cleanup } = mountAppManagerRoute();
    const calculatorCard = root.querySelector("[data-app-id='vatio.calculator']");
    const resetButton = Array.from(calculatorCard.querySelectorAll("button"))
      .find((button) => button.textContent === "Reset app-private storage");

    resetButton.click();
    expect(localStorage.getItem("vatioboard.app.vatio.calculator.settings.preferences")).not.toBeNull();
    expect(document.querySelector(".vb-confirm-dialog, .vb-confirm-backdrop")).toBeTruthy();

    const confirmButton = document.querySelector(".vb-confirm-btn--confirm");
    confirmButton.click();

    expect(localStorage.getItem("vatioboard.app.vatio.calculator.settings.preferences")).toBeNull();
    expect(localStorage.getItem("vatio_legacy_player_queue")).toBe("keep");
    expect(appControl.isPinned("vatio.calculator")).toBe(true);
    cleanup.run();
  });
});
