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
      activityAccelArmed: "Accel armed",
      activityAccelRunning: "Accel running",
      activityOpenSpeedRecording: "Open speed recording",
      activityOpenAccelTest: "Open acceleration test",
      activitySamplesShort: "{count} samples",
      activityGpsActive: "GPS active",
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
});
