import { beforeEach, describe, expect, it, vi } from "vitest";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { createSpeedAlertPanel, SPEED_ALERT_PANEL_WINDOW_ID } from "../../src/speed/speed-alert-panel.js";

function createDrivingAlertServiceStub(overrides = {}) {
  let snapshot = {
    status: "idle",
    currentSpeedMs: 22.352,
    nearestTrapDistanceM: null,
    nearestTrapSpeedKph: null,
    cameraApproachState: "none",
    cameraApproachReason: "no-candidate",
    cameraDatabaseStatus: { status: "idle" },
    preferences: {
      unit: "kmh",
      distanceUnit: "m",
      alertEnabled: false,
      alertLimitMs: 27.7777777778,
      alertSoundEnabled: true,
      audioMuted: false,
      trapAlertEnabled: true,
      trapAlertDistanceM: 500,
      trapSoundEnabled: true,
    },
    audio: {},
    ...overrides,
  };
  const listeners = new Set();
  const service = {
    emit(next) {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener(snapshot);
    },
    getSnapshot: vi.fn(() => snapshot),
    primeAudioFromUserGesture: vi.fn(),
    setAlertSoundEnabled: vi.fn(),
    setManualAlertEnabled: vi.fn(),
    setManualAlertLimitMs: vi.fn(),
    setMuted: vi.fn(),
    setTrapAlertDistanceM: vi.fn(),
    setTrapAlertEnabled: vi.fn(),
    setTrapSoundEnabled: vi.fn(),
    setUnits: vi.fn(),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }),
  };
  return service;
}

describe("createSpeedAlertPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("registers as a shell window and opens through the manager", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const panel = createSpeedAlertPanel({
      shellManager: manager,
      restoreVisibility: false,
      drivingAlertService: createDrivingAlertServiceStub(),
    });

    expect(manager.listWindows().map((record) => record.id)).toContain(SPEED_ALERT_PANEL_WINDOW_ID);

    manager.openWindow(SPEED_ALERT_PANEL_WINDOW_ID);

    expect(panel.getElement().hidden).toBe(false);
    expect(manager.getWindow(SPEED_ALERT_PANEL_WINDOW_ID)).toMatchObject({
      active: true,
      state: "open",
    });
    expect(panel.getElement().getAttribute("role")).toBe("dialog");
    expect(panel.getElement().getAttribute("aria-labelledby")).toBe("speed-alerts-title");

    panel.destroy();
    manager.destroy();
  });

  it("binds controls to the shared driving alert service", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const service = createDrivingAlertServiceStub();
    const panel = createSpeedAlertPanel({
      shellManager: manager,
      restoreVisibility: false,
      drivingAlertService: service,
    });

    panel.open({ focus: false });
    const root = panel.getElement();

    root.querySelector(".speed-alert-window-manual-switch").click();
    root.querySelector(".speed-alert-window-alert-sound-switch").click();
    root.querySelector(".speed-alert-window-trap-switch").click();
    root.querySelector(".speed-alert-window-trap-distance-select").click();
    document.querySelector(".speed-alert-window-trap-distance-option[data-value='1000']").click();
    root.querySelector(".speed-alert-window-trap-sound-switch").click();
    root.querySelector("button[data-unit='mph']").click();
    root.querySelector("button[data-distance-unit='ft']").click();

    expect(service.setManualAlertEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setAlertSoundEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setTrapAlertEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setTrapAlertDistanceM).toHaveBeenCalledWith(1000, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setTrapSoundEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setUnits).toHaveBeenCalledWith({ unit: "mph" });
    expect(service.setUnits).toHaveBeenCalledWith({ distanceUnit: "ft" });
    expect(root.querySelector("select")).toBeNull();
    expect(document.querySelectorAll(".speed-alert-window-limit-option")).toHaveLength(27);

    panel.destroy();
    manager.destroy();
  });

  it("renders offline-safe status and opens Camera Map through the provided callback", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const onOpenCameraMap = vi.fn();
    const panel = createSpeedAlertPanel({
      shellManager: manager,
      restoreVisibility: false,
      drivingAlertService: createDrivingAlertServiceStub({
        cameraDatabaseStatus: { status: "offline", cacheHit: true, cameraCount: 12 },
      }),
      onOpenCameraMap,
    });

    panel.open({ focus: false });

    expect(panel.getElement().querySelector(".speed-alert-window-camera-status").textContent).toContain("cached");
    panel.getElement().querySelector(".speed-alert-window-map").click();
    expect(onOpenCameraMap).toHaveBeenCalledTimes(1);

    panel.destroy();
    manager.destroy();
  });

  it("rebuilds complete unit-specific options and exposes audio priming only when needed", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const service = createDrivingAlertServiceStub();
    const panel = createSpeedAlertPanel({
      shellManager: manager,
      restoreVisibility: false,
      drivingAlertService: service,
    });
    panel.open({ focus: false });

    service.emit({
      currentSpeedMs: 1,
      preferences: {
        unit: "mph",
        distanceUnit: "ft",
        alertEnabled: false,
        alertLimitMs: 55 / 2.2369362920544,
        alertSoundEnabled: true,
        audioMuted: true,
        trapAlertEnabled: false,
        trapAlertDistanceM: 609.6,
        trapSoundEnabled: true,
      },
      audio: { muted: true },
    });

    const root = panel.getElement();
    expect(document.querySelectorAll(".speed-alert-window-limit-option")).toHaveLength(35);
    expect(document.querySelectorAll(".speed-alert-window-trap-distance-option")).toHaveLength(4);
    expect(root.querySelector(".speed-alert-window-limit-select").textContent).toContain("55 mph");
    expect(root.querySelector(".speed-alert-window-use-current").disabled).toBe(true);
    expect(root.querySelector(".speed-alert-window-audio-switch").checked).toBe(false);
    expect(root.querySelector(".speed-alert-window-enable-audio").hidden).toBe(true);

    service.emit({ audio: { muted: false, backgroundAudioArmed: false }, preferences: {
      unit: "mph",
      distanceUnit: "ft",
      alertEnabled: false,
      alertLimitMs: 55 / 2.2369362920544,
      alertSoundEnabled: true,
      audioMuted: false,
      trapAlertEnabled: false,
      trapAlertDistanceM: 609.6,
      trapSoundEnabled: true,
    } });
    expect(root.querySelector(".speed-alert-window-enable-audio").hidden).toBe(false);

    root.querySelector(".speed-alert-window-limit-select").click();
    document.querySelector(".speed-alert-window-limit-option[data-value='65']").click();
    expect(service.setManualAlertLimitMs).toHaveBeenCalled();
    expect(service.setManualAlertEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ fromUserGesture: true }));

    panel.destroy();
    manager.destroy();
  });
});
