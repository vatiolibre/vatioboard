import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHELL_Z_INDEX } from "../../src/shared/shell-layers.js";

const routerMock = vi.hoisted(() => ({
  navigateToAppRoute: vi.fn(),
}));

vi.mock("../../src/app/router.js", () => ({
  navigateToAppRoute: routerMock.navigateToAppRoute,
}));

vi.mock("../../src/i18n.js", () => ({
  t: (key, params) => {
    const translations = {
      activityStatusLabel: "Active driving activity",
      activitySpeedRecording: "Recording",
      activitySpeedAlertsArmed: "Alerts armed",
      activitySpeedAlertsArming: "Arming alerts",
      activitySpeedAlertsSuppressed: "Alerts need rearm",
      activitySpeedAlertsBlocked: "Alert audio blocked",
      activitySpeedRecordingKeepAliveActive: "Keep-alive on",
      activitySpeedRecordingKeepAliveArming: "Arming keep-alive",
      activitySpeedRecordingKeepAliveNeedsRearm: "Needs rearm",
      activitySpeedRecordingMayNeedResume: "Resume needed",
      activityAccelArmed: "Accel armed",
      activityAccelRunning: "Accel running",
      activityOpenSpeedRecording: "Open speed recording",
      activityOpenSpeedAlerts: "Open speed alerts",
      activityOpenAccelTest: "Open acceleration test",
      activitySamplesShort: "{count} pts",
      activityGpsActive: "GPS on",
      activitySpeedAlertsReady: "Audio ready",
      activitySpeedAlertsTapToRearm: "Tap to rearm",
      activitySpeedAlertsUserAction: "Audio requires user action",
      activitySpeedAlertsGpsRequired: "GPS required",
      accelPreset0to60: "0-60 mph",
    };
    return (translations[key] || key).replace(/\{(\w+)\}/g, (_match, token) =>
      Object.prototype.hasOwnProperty.call(params || {}, token) ? String(params[token]) : `{${token}}`
    );
  },
}));

describe("activity indicator", () => {
  let indicator;
  let initActivityIndicator;
  let setActivity;
  let clearActivity;
  let clearAllActivities;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    localStorage.clear();
    routerMock.navigateToAppRoute.mockClear();

    const indicatorModule = await import("../../src/shared/activity-indicator.js");
    const stateModule = await import("../../src/shared/activity-state.js");
    initActivityIndicator = indicatorModule.initActivityIndicator;
    setActivity = stateModule.setActivity;
    clearActivity = stateModule.clearActivity;
    clearAllActivities = stateModule.clearAllActivities;
    clearAllActivities();

    indicator = initActivityIndicator({ mount: document.getElementById("mount") });
  });

  afterEach(() => {
    indicator?.destroy();
    clearAllActivities?.();
  });

  it("stays hidden until an activity is active and never renders a dismiss control", () => {
    const root = document.querySelector(".activity-indicator");
    expect(root.hidden).toBe(true);

    setActivity("speed.recording", {
      kind: "speed",
      order: 10,
      route: "#/speed",
      state: "recording",
      labelKey: "activitySpeedRecording",
      sampleCount: 3,
    });

    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain("Recording");
    expect(root.textContent).toContain("3 pts");
    expect(root.querySelector(".activity-indicator-close")).toBeNull();
    expect(root.querySelector("[aria-label='Close']")).toBeNull();

    clearActivity("speed.recording");
    expect(root.hidden).toBe(true);
  });

  it("renders simultaneous speed and acceleration activities", () => {
    setActivity("speed.recording", {
      kind: "speed",
      route: "#/speed",
      state: "recording",
      labelKey: "activitySpeedRecording",
      sampleCount: 7,
    });
    setActivity("accel.run", {
      kind: "accel",
      order: 20,
      route: "#/accel",
      state: "armed",
      labelKey: "activityAccelArmed",
      detailKey: "accelPreset0to60",
    });

    const rows = Array.from(document.querySelectorAll(".activity-indicator-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.activityId).toBe("speed.recording");
    expect(rows[1].dataset.activityId).toBe("accel.run");
    expect(document.body.textContent).toContain("Recording");
    expect(document.body.textContent).toContain("Accel armed");
    expect(document.body.textContent).toContain("0-60 mph");
  });

  it("renders speed alert audio state alongside speed recording", () => {
    setActivity("speed.recording", {
      kind: "speed",
      order: 10,
      route: "#/speed",
      state: "recording",
      labelKey: "activitySpeedRecording",
      sampleCount: 7,
    });
    setActivity("speed.alerts", {
      kind: "speed",
      order: 11,
      route: "#/speed",
      state: "armed",
      labelKey: "activitySpeedAlertsArmed",
      detailKey: "activitySpeedAlertsReady",
      openLabelKey: "activityOpenSpeedAlerts",
    });

    const rows = Array.from(document.querySelectorAll(".activity-indicator-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.activityId).toBe("speed.recording");
    expect(rows[1].dataset.activityId).toBe("speed.alerts");
    expect(rows[1].dataset.activityState).toBe("armed");
    expect(rows[1].getAttribute("aria-label")).toContain("Open speed alerts");
    expect(document.body.textContent).toContain("Alerts armed");
    expect(document.body.textContent).toContain("Audio ready");
  });

  it("shows speed alert arming and suppressed states", () => {
    setActivity("speed.alerts", {
      kind: "speed",
      route: "#/speed",
      state: "arming",
      labelKey: "activitySpeedAlertsArming",
      detailKey: "activitySpeedAlertsReady",
      openLabelKey: "activityOpenSpeedAlerts",
    });

    let row = document.querySelector('[data-activity-id="speed.alerts"]');
    expect(row.dataset.activityState).toBe("arming");
    expect(document.body.textContent).toContain("Arming alerts");

    setActivity("speed.alerts", {
      kind: "speed",
      route: "#/speed",
      state: "suppressed",
      labelKey: "activitySpeedAlertsSuppressed",
      detailKey: "activitySpeedAlertsTapToRearm",
      openLabelKey: "activityOpenSpeedAlerts",
    });

    row = document.querySelector('[data-activity-id="speed.alerts"]');
    expect(row.dataset.activityState).toBe("suppressed");
    expect(document.body.textContent).toContain("Alerts need rearm");
    expect(document.body.textContent).toContain("Tap to rearm");
  });

  it("routes each activity row to its owning view", () => {
    setActivity("speed.recording", {
      kind: "speed",
      route: "#/speed",
      state: "recording",
      labelKey: "activitySpeedRecording",
    });
    setActivity("accel.run", {
      kind: "accel",
      route: "#/accel",
      state: "running",
      labelKey: "activityAccelRunning",
      detailKey: "accelPreset0to60",
    });

    document.querySelector('[data-activity-id="speed.recording"]').click();
    document.querySelector('[data-activity-id="accel.run"]').click();

    expect(routerMock.navigateToAppRoute).toHaveBeenNthCalledWith(1, "#/speed");
    expect(routerMock.navigateToAppRoute).toHaveBeenNthCalledWith(2, "#/accel");
  });

  it("routes the speed alert row to the Speed view", () => {
    setActivity("speed.alerts", {
      kind: "speed",
      route: "#/speed",
      state: "blocked",
      labelKey: "activitySpeedAlertsBlocked",
      detailKey: "activitySpeedAlertsUserAction",
      openLabelKey: "activityOpenSpeedAlerts",
    });

    document.querySelector('[data-activity-id="speed.alerts"]').click();

    expect(routerMock.navigateToAppRoute).toHaveBeenCalledWith("#/speed");
  });

  it("uses the shell activity layer above normal windows and below start menu/fullscreen/modal", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/activity-indicator.less"), "utf8");

    expect(SHELL_Z_INDEX.activity).toBeGreaterThan(SHELL_Z_INDEX.windowMax);
    expect(SHELL_Z_INDEX.activity).toBeGreaterThan(SHELL_Z_INDEX.taskbar);
    expect(SHELL_Z_INDEX.activity).toBeLessThan(SHELL_Z_INDEX.startMenu);
    expect(SHELL_Z_INDEX.activity).toBeLessThan(SHELL_Z_INDEX.fullscreen);
    expect(SHELL_Z_INDEX.activity).toBeLessThan(SHELL_Z_INDEX.modal);
    expect(css).toContain("--vb-z-activity: 1955;");
    expect(css).toContain("z-index: var(--vb-z-activity, 1955)");
  });

  it("ignores legacy auto-saved coordinates and keeps the default CSS corner anchor on resize", () => {
    indicator.destroy();
    localStorage.setItem("vatioboard.activity_indicator_pos_v1", JSON.stringify({
      launcher: { left: "711px", top: "463px" },
    }));
    indicator = initActivityIndicator({ mount: document.getElementById("mount") });
    const root = indicator.root;

    setActivity("speed.alerts", {
      kind: "speed",
      route: "#/speed",
      state: "armed",
      labelKey: "activitySpeedAlertsArmed",
    });
    window.dispatchEvent(new Event("resize"));

    expect(root.style.left).toBe("");
    expect(root.style.top).toBe("");
    expect(root.style.right).toBe("");
    expect(root.style.bottom).toBe("");
  });

  it("restores only explicitly user-positioned coordinates", () => {
    indicator.destroy();
    localStorage.setItem("vatioboard.activity_indicator_pos_v1", JSON.stringify({
      launcher: { left: "320px", top: "180px", userPositioned: true },
    }));
    indicator = initActivityIndicator({ mount: document.getElementById("mount") });

    expect(indicator.root.style.left).toBe("320px");
    expect(indicator.root.style.top).toBe("180px");
  });

  it("anchors the compact short-landscape indicator to the viewport bottom-right", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/activity-indicator.less"), "utf8");
    expect(css).toContain('html[data-vb-layout-profile="short-landscape"] .activity-indicator');
    expect(css).toContain("right: env(safe-area-inset-right, 0px);");
    expect(css).toContain("bottom: env(safe-area-inset-bottom, 0px);");
    expect(css).toContain("top: auto;");
  });

  it("drags within the viewport and persists the indicator position", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const root = document.querySelector(".activity-indicator");
    root.getBoundingClientRect = () => ({
      left: Number.parseFloat(root.style.left) || 16,
      top: Number.parseFloat(root.style.top) || 84,
      right: (Number.parseFloat(root.style.left) || 16) + 240,
      bottom: (Number.parseFloat(root.style.top) || 84) + 72,
      width: 240,
      height: 72,
      x: Number.parseFloat(root.style.left) || 16,
      y: Number.parseFloat(root.style.top) || 84,
      toJSON() {},
    });
    setActivity("speed.recording", {
      kind: "speed",
      route: "#/speed",
      state: "recording",
      labelKey: "activitySpeedRecording",
    });

    root.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 24,
      clientY: 96,
      pointerId: 71,
      pointerType: "mouse",
      button: 0,
      bubbles: true,
    }));
    root.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 180,
      clientY: 190,
      pointerId: 71,
      pointerType: "mouse",
      bubbles: true,
    }));
    root.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 180,
      clientY: 190,
      pointerId: 71,
      pointerType: "mouse",
      bubbles: true,
    }));

    const stored = JSON.parse(localStorage.getItem("vatioboard.activity_indicator_pos_v1"));
    expect(stored.launcher.left).toBe(root.style.left);
    expect(stored.launcher.top).toBe(root.style.top);
    expect(stored.launcher.userPositioned).toBe(true);
    expect(Number.parseFloat(root.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(root.style.top)).toBeGreaterThanOrEqual(8);
  });
});
