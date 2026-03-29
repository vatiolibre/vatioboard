import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

const fakeMaps = [];

vi.mock("chart.js/auto", () => ({
  default: class FakeChart {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.ctx = canvas.getContext("2d");
      this.chartArea = {
        top: 0,
        left: 0,
        right: 300,
        bottom: 220,
      };
      this.scales = {
        x: {
          getPixelForValue: (value) => value,
          getValueForPixel: (value) => value,
          min: config?.options?.scales?.x?.min ?? 0,
          max: config?.options?.scales?.x?.max ?? 300,
        },
      };
    }

    destroy() {}
    draw() {}
    update() {}
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

describe("replay.html smoke", () => {
  beforeEach(async () => {
    fakeMaps.length = 0;
    localStorage.clear();
    localStorage.setItem("vatio_speed_replay_active_v1", JSON.stringify({
      id: "active-session",
      version: 1,
      source: "speed",
      unit: "kmh",
      distanceUnit: "m",
      startedAtMs: 1000,
      updatedAtMs: 4000,
      endedAtMs: 4000,
      maxSpeedMs: 15,
      totalDistanceM: 680,
      minAltitudeM: 10,
      maxAltitudeM: 20,
      samples: [
        {
          timestampMs: 1000,
          latitude: 40.7128,
          longitude: -74.006,
          speedMs: 0,
          altitudeM: 10,
          accuracyM: 5,
          headingDeg: 180,
          totalDistanceM: 500,
        },
        {
          timestampMs: 2500,
          latitude: 40.7138,
          longitude: -74.005,
          speedMs: 10,
          altitudeM: 15,
          accuracyM: 4,
          headingDeg: 182,
          totalDistanceM: 580,
        },
        {
          timestampMs: 4000,
          latitude: 40.7148,
          longitude: -74.004,
          speedMs: 15,
          altitudeM: 20,
          accuracyM: 4,
          headingDeg: 184,
          totalDistanceM: 680,
        },
      ],
    }));
    localStorage.setItem("vatio_speed_replay_library_v1", JSON.stringify([
      {
        id: "saved-session",
        version: 1,
        source: "speed",
        unit: "kmh",
        distanceUnit: "m",
        startedAtMs: 5000,
        updatedAtMs: 7000,
        endedAtMs: 7000,
        maxSpeedMs: 11,
        totalDistanceM: 520,
        minAltitudeM: 8,
        maxAltitudeM: 18,
        recordingState: "stopped",
        samples: [
          {
            timestampMs: 5000,
            latitude: 40.72,
            longitude: -74.01,
            speedMs: 0,
            altitudeM: 8,
            accuracyM: 5,
            headingDeg: 160,
            totalDistanceM: 400,
          },
          {
            timestampMs: 7000,
            latitude: 40.721,
            longitude: -74.009,
            speedMs: 11,
            altitudeM: 18,
            accuracyM: 5,
            headingDeg: 170,
            totalDistanceM: 520,
          },
        ],
      },
    ]));
    window.confirm = vi.fn(() => true);

    vi.resetModules();
    await bootHtmlPage("replay.html");
  });

  it("boots the replay page and renders the stored session", async () => {
    const replayPage = await import("../../src/replay/replay.js");
    await replayPage.initPromise;
    await flushTasks();

    expectPageSeo({
      titleIncludes: "Vatio Drive Replay",
      canonical: "https://vatioboard.com/replay.html",
    });
    expect(document.getElementById("replayEmptyState").hidden).toBe(true);
    expect(document.getElementById("replayShell").hidden).toBe(false);
    expect(document.getElementById("replaySessionChip").textContent).toBe("Active session");
    expect(document.getElementById("replaySampleCountValue").textContent).toBe("3");
    expect(document.getElementById("replayPeakSpeedValue").textContent).toContain("54 km/h");
    expect(document.querySelector("#replayAxisTime .btn-icon svg")).toBeTruthy();
    expect(document.querySelector("#replayAxisDistance .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("replayToolsMenuBtn").getAttribute("aria-label")).toBe("Pages");
    expect(document.querySelector("#replayToolsMenuBtn .btn-icon svg")).toBeTruthy();
    expect(document.querySelector("#replayPlayPause .replay-action-icon svg")).toBeTruthy();
    expect(document.getElementById("replayPlayPause").getAttribute("aria-label")).toBe("Play");
    expect(document.querySelector("#replayRestart .replay-action-icon svg")).toBeTruthy();
    expect(document.querySelector("#replayApproach .replay-action-icon svg")).toBeTruthy();
    expect(document.getElementById("replayRestart").disabled).toBe(false);
    expect(document.getElementById("replayApproach").disabled).toBe(false);
    expect(document.querySelectorAll("#replayRecordingsList button[data-recording-id]")).toHaveLength(2);
    expect(document.querySelectorAll("#replayRecordingsList button[data-delete-recording-id]")).toHaveLength(1);
    expect(document.getElementById("replayGraphHeadingCurrent").textContent).toContain("180");
    expect(document.querySelector(".replay-live-grid")).toBeNull();
    expect(document.querySelector(".replay-map-head")).toBeNull();
    expect(document.getElementById("replayMap").hasAttribute("aria-hidden")).toBe(false);
    expect(document.getElementById("replayAxisTime").getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("replayProgress").max).toBe("3000");

    document.getElementById("replayAxisDistance").click();
    await flushTasks();

    expect(document.getElementById("replayAxisDistance").getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("replayDurationValue").textContent).toBe("180 m");
    expect(document.getElementById("replayProgress").max).toBe("180");

    document.getElementById("replayProgress").value = "80";
    document.getElementById("replayProgress").dispatchEvent(new Event("input", { bubbles: true }));
    await flushTasks();

    expect(document.getElementById("replayElapsedValue").textContent).toBe("80 m");

    document.getElementById("replayRestart").click();
    await flushTasks();

    expect(document.getElementById("replayElapsedValue").textContent).toBe("0 m");

    document.getElementById("replayApproach").click();
    await flushTasks();

    expect(fakeMaps[0]?.stop).toHaveBeenCalled();
    expect(fakeMaps[0]?.jumpTo).toHaveBeenCalled();
  });

  it("opens the expanded graph sheet with stacked charts and a dual-range filter", async () => {
    const replayPage = await import("../../src/replay/replay.js");
    await replayPage.initPromise;
    await flushTasks();

    document.querySelector('[data-graph-metric="headingDeg"]').click();
    await flushTasks();

    expect(document.getElementById("replayGraphSheet").hidden).toBe(false);
    expect(document.getElementById("replayGraphSheetTitle").textContent).toBe("Explore charts");
    expect(document.getElementById("replayExpandedSpeedCurrent").textContent).toContain("0");
    expect(document.getElementById("replayExpandedAltitudeCurrent").textContent).toContain("10");
    expect(document.getElementById("replayExpandedHeadingCurrent").textContent).toContain("180");
    expect(document.querySelector(".replay-graph-sheet-header .replay-sheet-axis-group")).toBeTruthy();
    expect(document.querySelector(".replay-graph-sheet-controls .replay-sheet-axis-group")).toBeNull();
    expect(document.querySelector(".replay-sheet-axis-group .replay-sheet-axis-label")?.textContent).toBe("Time");
    expect(document.querySelectorAll(".replay-sheet-axis-group .replay-sheet-axis-label")).toHaveLength(2);
    expect(document.querySelector(".replay-filter-row")).toBeTruthy();
    expect(document.querySelector(".replay-filter-row #replayFilterSlider")).toBeTruthy();
    expect(document.getElementById("replayFilterStart")).toBeTruthy();
    expect(document.getElementById("replayFilterEnd")).toBeTruthy();

    document.getElementById("replayFilterStart").value = "250";
    document.getElementById("replayFilterStart").dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("replayFilterEnd").value = "750";
    document.getElementById("replayFilterEnd").dispatchEvent(new Event("input", { bubbles: true }));
    await flushTasks();

    expect(document.getElementById("replayFilterStartValue").textContent).toBe("00:01");
    expect(document.getElementById("replayFilterEndValue").textContent).toBe("00:02");

    document.getElementById("closeReplayGraphSheet").click();
    await flushTasks();

    expect(document.getElementById("replayGraphSheet").hidden).toBe(true);
  });

  it("lets the user delete saved recordings while keeping the active session", async () => {
    const replayPage = await import("../../src/replay/replay.js");
    await replayPage.initPromise;
    const { loadReplayLibrary } = await import("../../src/replay/session.js");
    await flushTasks();

    document.querySelector('#replayRecordingsList button[data-delete-recording-id="saved-session"]').click();
    await replayPage.waitForReplaySelection();
    await loadReplayLibrary();
    await flushTasks();

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("#replayRecordingsList button[data-recording-id]")).toHaveLength(1);
    expect(document.querySelector('#replayRecordingsList button[data-delete-recording-id="saved-session"]')).toBeNull();
    expect(await loadReplayLibrary()).toEqual([]);
  });

  it("boots cleanly into the empty state when there are no replay recordings", async () => {
    localStorage.clear();
    vi.resetModules();
    await bootHtmlPage("replay.html");

    const replayPage = await import("../../src/replay/replay.js");
    await replayPage.initPromise;
    await flushTasks();

    expect(document.getElementById("replayEmptyState").hidden).toBe(false);
    expect(document.getElementById("replayShell").hidden).toBe(true);
  });
});
