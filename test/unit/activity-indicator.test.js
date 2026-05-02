import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      activitySpeedRecording: "Recording drive",
      activitySpeedAlertsArmed: "Speed alerts armed",
      activitySpeedAlertsArming: "Arming speed alerts",
      activitySpeedAlertsSuppressed: "Speed alerts need rearm",
      activitySpeedAlertsBlocked: "Speed alert audio blocked",
      activitySpeedRecordingKeepAliveActive: "Background keep-alive active",
      activitySpeedRecordingKeepAliveArming: "Arming keep-alive",
      activitySpeedRecordingKeepAliveNeedsRearm: "Keep-alive needs rearm",
      activitySpeedRecordingMayNeedResume: "Recording may need resume",
      activityAccelArmed: "Accel armed",
      activityAccelRunning: "Accel running",
      activityOpenSpeedRecording: "Open speed recording",
      activityOpenSpeedAlerts: "Open speed alerts",
      activityOpenAccelTest: "Open acceleration test",
      activitySamplesShort: "{count} samples",
      activityGpsActive: "GPS active",
      activitySpeedAlertsReady: "Alert audio ready",
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
    expect(root.textContent).toContain("Recording drive");
    expect(root.textContent).toContain("3 samples");
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
    expect(document.body.textContent).toContain("Recording drive");
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
    expect(document.body.textContent).toContain("Speed alerts armed");
    expect(document.body.textContent).toContain("Alert audio ready");
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
    expect(document.body.textContent).toContain("Arming speed alerts");

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
    expect(document.body.textContent).toContain("Speed alerts need rearm");
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
});
