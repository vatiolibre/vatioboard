import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitGeolocationSuccess, getBrowserMocks } from "../helpers/browser-mocks.js";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";
import { MPH_TO_MS } from "../../src/accel/constants.js";

let createdChartCount = 0;
let destroyedChartCount = 0;
const fakeMaps = [];

vi.mock("../../src/shared/analog-speedometer.js", () => ({
  createAnalogSpeedometer: () => ({
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock("chart.js/auto", () => ({
  default: class FakeChart {
    constructor(canvas, config) {
      createdChartCount += 1;
      this.canvas = canvas;
      this.config = config;
      this.data = config.data;
      this.options = config.options;
      this.ctx = canvas.getContext("2d");
      this.chartArea = {
        top: 0,
        left: 0,
        right: 300,
        bottom: 200,
      };
      this.tooltip = {
        getActiveElements: () => [],
        setActiveElements: vi.fn(),
      };
      this.scales = {
        x: {
          getPixelForValue: (value) => value,
        },
        y: {
          getPixelForValue: (value) => value,
        },
      };
    }

    destroy() {
      destroyedChartCount += 1;
    }
    draw() {}
    resize() {}
    update() {}
    setActiveElements() {}
    getDatasetMeta(datasetIndex) {
      const dataset = this.data.datasets[datasetIndex];
      return {
        data: (dataset?.data ?? []).map((point, index) => ({
          x: index * 10,
          y: 100,
          getProps() {
            return { x: this.x, y: this.y };
          },
          point,
        })),
      };
    }
  },
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.scrollZoom = { disable: vi.fn(), enable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
      this.jumpTo = vi.fn();
      this.easeTo = vi.fn();
      this.fitBounds = vi.fn();
      this.stop = vi.fn();
      this.remove = vi.fn();
      fakeMaps.push(this);
      queueMicrotask(() => {
        for (const handler of this.handlers.load ?? []) {
          handler();
        }
      });
    }

    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }

    addControl() {
      return this;
    }

    getSource(id) {
      if (!this.sources.has(id)) {
        this.sources.set(id, { setData: vi.fn() });
      }
      return this.sources.get(id);
    }
  }

  class FakeAttributionControl {}

  return {
    default: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

function createStoredRun() {
  return {
    id: "run-1",
    savedAtMs: Date.UTC(2026, 2, 29, 10, 0, 0),
    presetId: "0-60-mph",
    presetSignature: "0-60-mph",
    comparisonSignature: "launch-4",
    presetKind: "speed",
    standingStart: true,
    customStart: null,
    customEnd: null,
    customUnit: null,
    startSpeedMs: 0,
    targetSpeedMs: 60 * MPH_TO_MS,
    distanceTargetM: null,
    displayUnit: "mph",
    distanceDisplay: "ft",
    elapsedMs: 5000,
    speedTrace: [
      { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5, speedSource: "reported" },
      { elapsedMs: 2500, speedMs: 30 * MPH_TO_MS, distanceM: 60, altitudeM: 101, accuracyM: 4.5, speedSource: "reported" },
      { elapsedMs: 5000, speedMs: 60 * MPH_TO_MS, distanceM: 120, altitudeM: 102, accuracyM: 4, speedSource: "reported" },
    ],
    sampleLog: [
      { elapsedFromStartMs: 1200, speedMs: 14 * MPH_TO_MS, distanceFromStartM: 18, altitudeM: 100.4, headingDeg: 14, accuracyM: 5, speedSource: "reported", latitude: 12, longitude: -77 },
      { elapsedFromStartMs: 3000, speedMs: 38 * MPH_TO_MS, distanceFromStartM: 72, altitudeM: 101.4, headingDeg: 18, accuracyM: 4.4, speedSource: "reported", latitude: 12.001, longitude: -77.001 },
      { elapsedFromStartMs: 4200, speedMs: 52 * MPH_TO_MS, distanceFromStartM: 102, altitudeM: 101.8, headingDeg: 22, accuracyM: 4.2, speedSource: "reported", latitude: 12.002, longitude: -77.002 },
    ],
    partials: [
      {
        id: "0-60-mph",
        kind: "speed",
        labelKey: "accelPreset0to60",
        startSpeedMs: 0,
        targetSpeedMs: 60 * MPH_TO_MS,
        elapsedMs: 5000,
      },
    ],
    finishSpeedMs: 60 * MPH_TO_MS,
    trapSpeedMs: null,
    rolloutApplied: false,
    launchThresholdMs: 0.5 * MPH_TO_MS,
    rolloutDistanceM: 0,
    averageAccuracyM: 4.5,
    runDistanceM: 120,
    finishDistanceM: 120,
    startAccuracyM: 5,
    startAltitudeM: 100,
    finishAltitudeM: 102,
    elevationDeltaM: 2,
    slopePercent: (2 / 120) * 100,
    averageHz: 10,
    averageIntervalMs: 100,
    jitterMs: 12,
    qualityGrade: "good",
    qualityScore: 90,
    warningKeys: [],
    sampleCount: 5,
    sparseCount: 0,
    staleCount: 0,
    nullSpeedCount: 0,
    derivedSpeedCount: 0,
    speedSource: "reported",
    startSpeedSource: "reported",
    notes: "Flat road",
  };
}

describe("accel.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    createdChartCount = 0;
    destroyedChartCount = 0;
    fakeMaps.length = 0;
    await bootHtmlPage("accel.html");
  });

  it("boots the acceleration page and enables the test after a mocked fix", async () => {
    const accelPage = await import("../../src/accel/accel.js");
    await accelPage.initPromise;
    await flushTasks();

    expectPageSeo({
      titleIncludes: "Vatio Accel",
      canonical: "https://vatioboard.com/accel.html",
    });
    expect(document.getElementById("armRun").getAttribute("aria-label")).toBe("Start test");
    expect(document.querySelector("#armRun .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("accelToolsMenuBtn").getAttribute("aria-label")).toBe("Pages");
    expect(document.querySelector("#accelToolsMenuBtn .btn-icon svg")).toBeTruthy();
    expect(document.querySelector("#accelToolbarSetup .btn-icon svg")).toBeTruthy();
    expect(document.querySelector("#accelToolbarResults .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("accelToolbarResults").disabled).toBe(true);
    expect(document.getElementById("accelToolsMenuList").hidden).toBe(true);
    document.getElementById("accelToolsMenuBtn").click();
    await flushTasks();
    expect(document.getElementById("accelToolsMenuList").hidden).toBe(false);
    expect(document.getElementById("accelToolsMenuBtn").getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("accelLangToggleMenu").textContent).toBe("EN");
    expect(document.querySelector("#accelToolsMenuList [data-backend-auth]")).toBeTruthy();
    expect(document.querySelector("#accelToolsMenuList [data-backend-auth-signup]")?.getAttribute("href")).toBe("https://www.vatiolibre.com/login#signup");
    expect(document.querySelector("#accelToolsMenuList [data-backend-auth-forgot]")?.getAttribute("href")).toBe("https://www.vatiolibre.com/login#forgot");
    document.getElementById("accelToolbarSetup").click();
    await flushTasks();
    expect(document.getElementById("setupPanel").hidden).toBe(false);
    expect(document.getElementById("accelToolbarSetup").getAttribute("aria-pressed")).toBe("true");
    document.getElementById("closeSetupPanel").click();
    await flushTasks();
    expect(document.activeElement).toBe(document.getElementById("accelToolbarSetup"));
    document.getElementById("setupTrigger").click();
    await flushTasks();
    expect(document.getElementById("setupPanel").hidden).toBe(false);
    document.getElementById("accelToolbarSetup").click();
    await flushTasks();
    expect(document.getElementById("setupPanel").hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById("accelToolbarSetup"));
    expect(getBrowserMocks().geolocation.watchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      coords: {
        speed: 0,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    expect(document.getElementById("latestAccuracyValue").textContent).not.toBe("—");
    expect(document.getElementById("armRun").disabled).toBe(false);

    document.getElementById("armRun").click();
    await flushTasks();

    expect(document.getElementById("armRun").getAttribute("aria-label")).toBe("Cancel test");
    expect(document.getElementById("armRun").disabled).toBe(false);

    document.getElementById("armRun").click();
    await flushTasks();

    expect(document.getElementById("armRun").getAttribute("aria-label")).toBe("Start test");
  });

  it("opens accel replay from history inside the results panel", async () => {
    const storage = await import("../../src/accel/storage.js");
    await storage.saveRuns([createStoredRun()]);

    const accelPage = await import("../../src/accel/accel.js");
    await accelPage.initPromise;
    await flushTasks();

    const replayButton = document.querySelector('[data-history-action="replay"][data-run-id="run-1"]');
    expect(replayButton).toBeTruthy();

    replayButton.click();
    await flushTasks();

    expect(document.getElementById("resultsPanel").hidden).toBe(false);
    expect(document.getElementById("resultReplayControls").hidden).toBe(false);
    expect(document.getElementById("resultReplayMapShell").hidden).toBe(false);
    expect(document.getElementById("resultReplayToggle").getAttribute("aria-label")).toBe("Pause replay");
    expect(Number(document.getElementById("resultReplayProgress").max)).toBeGreaterThan(0);
    expect(fakeMaps).toHaveLength(1);
    expect(fakeMaps[0].jumpTo).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0].fitBounds).not.toHaveBeenCalled();

    document.getElementById("resultReplayAxisDistance").click();
    await flushTasks();
    expect(document.getElementById("resultReplayAxisDistance").getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("resultGraphMeta").textContent).toContain("Distance");

    const progress = document.getElementById("resultReplayProgress");
    progress.value = progress.max;
    progress.dispatchEvent(new Event("input", { bubbles: true }));
    await flushTasks();

    expect(document.getElementById("resultReplayCurrentValue").textContent).toBe(document.getElementById("resultReplayMaxValue").textContent);
    expect(fakeMaps[0].jumpTo).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0].stop).toHaveBeenCalledTimes(2);

    document.getElementById("resultReplayChartsBtn").click();
    await flushTasks();

    expect(document.getElementById("resultReplayChartSheet").closest("#resultsPanel")).toBeNull();
    expect(document.getElementById("resultReplayChartSheet").hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("closeResultReplayChartSheet"));
    expect(document.getElementById("resultReplaySheetAltitudeStage").hidden).toBe(false);
    expect(document.getElementById("resultReplaySheetHeadingStage").hidden).toBe(false);
    expect(document.getElementById("resultReplaySheetSpeedValue").textContent).not.toBe("—");
    expect(document.getElementById("resultReplaySheetAltitudeValue").textContent).not.toBe("—");
    expect(document.getElementById("resultReplaySheetHeadingValue").textContent).not.toBe("—");

    const filterStartValue = document.getElementById("resultReplaySheetFilterStartValue");
    const initialFilterStartLabel = filterStartValue.textContent;
    const filterStart = document.getElementById("resultReplaySheetFilterStart");
    filterStart.value = "250";
    filterStart.dispatchEvent(new Event("input", { bubbles: true }));
    await flushTasks();
    expect(filterStartValue.textContent).not.toBe(initialFilterStartLabel);

    const speedCanvas = document.getElementById("resultReplaySheetSpeedCanvas");
    speedCanvas.getBoundingClientRect = () => ({
      left: 0,
      right: 300,
      width: 300,
      top: 0,
      bottom: 200,
      height: 200,
    });
    const initialSpeedValue = document.getElementById("resultReplaySheetSpeedValue").textContent;
    const pointerDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(pointerDown, "clientX", { value: 220 });
    speedCanvas.dispatchEvent(pointerDown);
    await flushTasks();
    expect(document.getElementById("resultReplaySheetSpeedValue").textContent).not.toBe(initialSpeedValue);

    document.getElementById("closeResultReplayChartSheet").click();
    await flushTasks();
    expect(document.getElementById("resultReplayChartSheet").hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById("resultReplayChartsBtn"));

    const destroyedAfterSheetClose = destroyedChartCount;
    document.getElementById("resultReplayChartsBtn").click();
    await flushTasks();
    expect(createdChartCount).toBeGreaterThan(destroyedAfterSheetClose);

    document.getElementById("closeResultsPanel").click();
    await flushTasks();
    expect(destroyedChartCount).toBe(createdChartCount);
    expect(document.activeElement).toBe(document.getElementById("resultsTrigger"));
  });

  it("opens the results panel from the toolbar results button when runs exist", async () => {
    const storage = await import("../../src/accel/storage.js");
    await storage.saveRuns([createStoredRun()]);

    const accelPage = await import("../../src/accel/accel.js");
    await accelPage.initPromise;
    await flushTasks();

    expect(document.getElementById("accelToolbarResults").disabled).toBe(false);
    document.getElementById("accelToolbarResults").click();
    await flushTasks();

    expect(document.getElementById("resultsPanel").hidden).toBe(false);
    expect(document.getElementById("resultReplayMapShell").hidden).toBe(false);
    expect(fakeMaps).toHaveLength(1);
    expect(fakeMaps[0].jumpTo).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0].fitBounds).not.toHaveBeenCalled();
    document.getElementById("closeResultsPanel").click();
    await flushTasks();
    expect(document.activeElement).toBe(document.getElementById("accelToolbarResults"));
  });

  it("tears down results replay state when switching from results to setup", async () => {
    const storage = await import("../../src/accel/storage.js");
    await storage.saveRuns([createStoredRun()]);

    const accelPage = await import("../../src/accel/accel.js");
    await accelPage.initPromise;
    await flushTasks();

    document.getElementById("accelToolbarResults").click();
    await flushTasks();
    document.getElementById("resultReplayChartsBtn").click();
    await flushTasks();

    expect(document.getElementById("resultsPanel").hidden).toBe(false);
    expect(document.getElementById("resultReplayChartSheet").hidden).toBe(false);
    expect(fakeMaps).toHaveLength(1);

    document.getElementById("accelToolbarSetup").click();
    await flushTasks();

    expect(document.getElementById("resultsPanel").hidden).toBe(true);
    expect(document.getElementById("setupPanel").hidden).toBe(false);
    expect(document.getElementById("resultReplayChartSheet").hidden).toBe(true);
    expect(fakeMaps[0].remove).toHaveBeenCalledTimes(1);
  });
});
