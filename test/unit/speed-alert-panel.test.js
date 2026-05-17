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

    root.querySelector(".speed-alert-window-primary").click();
    root.querySelector("button[data-alert-sound='off']").click();
    root.querySelector("button[data-trap-alert='off']").click();
    root.querySelector("button[data-trap-distance='1000']").click();
    root.querySelector("button[data-trap-sound='off']").click();
    root.querySelector("button[data-unit='mph']").click();
    root.querySelector("button[data-distance-unit='ft']").click();

    expect(service.setManualAlertEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setAlertSoundEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setTrapAlertEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setTrapAlertDistanceM).toHaveBeenCalledWith(1000, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setTrapSoundEnabled).toHaveBeenCalledWith(false, expect.objectContaining({ fromUserGesture: true }));
    expect(service.setUnits).toHaveBeenCalledWith({ unit: "mph" });
    expect(service.setUnits).toHaveBeenCalledWith({ distanceUnit: "ft" });

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
});
