import { beforeEach, describe, expect, it } from "vitest";
import {
  expectRealSpaRouteRemount,
  getRealSpaSmokeMocks,
  navigateRealSpaSmoke,
  resetRealSpaSmoke,
  settleRealSpaSmoke,
} from "../helpers/real-spa-route-smoke.js";

const MPH_TO_MS = 0.44704;

function createAccelSmokeRun() {
  return {
    id: "accel-remount-run",
    savedAtMs: Date.UTC(2026, 3, 28, 12, 30, 0),
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
      { elapsedMs: 0, speedMs: 0, distanceM: 0, altitudeM: 100, accuracyM: 5 },
      { elapsedMs: 2500, speedMs: 30 * MPH_TO_MS, distanceM: 60, altitudeM: 101, accuracyM: 4 },
      { elapsedMs: 5000, speedMs: 60 * MPH_TO_MS, distanceM: 120, altitudeM: 102, accuracyM: 4 },
    ],
    sampleLog: [
      {
        elapsedFromStartMs: 0,
        speedMs: 0,
        distanceFromStartM: 0,
        altitudeM: 100,
        headingDeg: 10,
        accuracyM: 5,
        latitude: 40.7484,
        longitude: -73.9857,
      },
      {
        elapsedFromStartMs: 2500,
        speedMs: 30 * MPH_TO_MS,
        distanceFromStartM: 60,
        altitudeM: 101,
        headingDeg: 12,
        accuracyM: 4,
        latitude: 40.749,
        longitude: -73.9848,
      },
      {
        elapsedFromStartMs: 5000,
        speedMs: 60 * MPH_TO_MS,
        distanceFromStartM: 120,
        altitudeM: 102,
        headingDeg: 14,
        accuracyM: 4,
        latitude: 40.7496,
        longitude: -73.984,
      },
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
    startPlace: null,
    endPlace: null,
    notes: "",
  };
}

async function saveAccelSmokeRun() {
  const { saveRuns } = await import("../../src/accel/storage.js");
  await saveRuns([createAccelSmokeRun()]);
}

async function findAccelHistoryButton() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const button = document.querySelector(
      '[data-history-action="load"][data-run-id="accel-remount-run"]'
    );
    if (button) return button;
    await settleRealSpaSmoke(4);
  }
  return null;
}

describe("SPA Accel route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    await saveAccelSmokeRun();
    const { charts, maplibre } = getRealSpaSmokeMocks();

    const { snapshots, targetSnapshots } = await expectRealSpaRouteRemount({
      targetHash: "#/accel",
      targetSelector: "#presetGrid .accel-preset-btn",
      sequence: ["#/board", "#/accel", "#/board", "#/accel"],
    });
    const firstAccel = targetSnapshots[0];
    const secondAccel = targetSnapshots[1];
    const boardAfterFirstAccel = snapshots[2];

    expect(document.querySelector("#liveSpeedDial")?.width).toBeGreaterThan(0);
    expect(document.querySelectorAll("#presetGrid .accel-preset-btn").length).toBeGreaterThan(1);
    expect(boardAfterFirstAccel.activeWatchCount).toBe(0);
    expect(boardAfterFirstAccel.activeIntervalCount).toBe(0);
    expect(boardAfterFirstAccel.activeRafCount).toBe(0);
    expect(boardAfterFirstAccel.activeResizeObserverCount).toBe(0);
    expect(secondAccel.activeWatchCount).toBe(1);
    expect(secondAccel.activeIntervalCount).toBe(1);
    expect(secondAccel.activeResizeObserverCount).toBeLessThanOrEqual(
      firstAccel.activeResizeObserverCount
    );
    expect(secondAccel.listeners.windowRouteVisible).toBe(firstAccel.listeners.windowRouteVisible);
    expect(secondAccel.listeners.windowCloudSyncApplied).toBe(
      firstAccel.listeners.windowCloudSyncApplied
    );
    expect(secondAccel.listeners.windowSingleTabOwnership).toBe(
      firstAccel.listeners.windowSingleTabOwnership
    );

    const historyButton = await findAccelHistoryButton();
    expect(historyButton).toBeTruthy();
    historyButton.click();
    await settleRealSpaSmoke();
    expect(document.getElementById("resultsPanel")?.hidden).toBe(false);
    expect(maplibre.maps.filter((map) => !map.removed)).toHaveLength(1);
    const accelMap = maplibre.maps.find((map) => !map.removed);
    const routeSource = accelMap?.sources.get("replay-route-full");
    const pointSource = accelMap?.sources.get("replay-route-point");
    const routeData = routeSource?.setData.mock.calls.at(-1)?.[0];
    const pointData = pointSource?.setData.mock.calls.at(-1)?.[0];
    expect(routeData.features[0].geometry.coordinates).toHaveLength(3);
    expect(routeData.features[0].geometry.coordinates[0]).toEqual([-73.9857, 40.7484]);
    expect(pointData.features[0].geometry.coordinates).toEqual([-73.9857, 40.7484]);
    expect(charts.charts.filter((chart) => !chart.destroyed).length).toBeGreaterThan(0);

    document.getElementById("resultReplayChartsBtn")?.click();
    await settleRealSpaSmoke();
    expect(document.body.classList.contains("accel-replay-chart-sheet-open")).toBe(true);
    expect(charts.charts.filter((chart) => !chart.destroyed).length).toBeLessThanOrEqual(4);

    const boardAfterResults = await navigateRealSpaSmoke("#/board");
    expect(boardAfterResults.activeWatchCount).toBe(0);
    expect(boardAfterResults.activeIntervalCount).toBe(0);
    expect(boardAfterResults.activeRafCount).toBe(0);
    expect(boardAfterResults.activeResizeObserverCount).toBe(0);
    expect(boardAfterResults.activeMapCount).toBe(0);
    expect(boardAfterResults.activeChartCount).toBe(0);
    expect(document.body.classList.contains("accel-sheet-open")).toBe(false);
    expect(document.body.classList.contains("accel-replay-chart-sheet-open")).toBe(false);
  }, 40000);

  it("keeps an active run subscribed in the background without route DOM resources", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "#/accel",
      targetSelector: "#armRun",
      sequence: ["#/board", "#/accel"],
    });

    navigator.geolocation.success?.({
      timestamp: Date.now(),
      coords: {
        latitude: 40.7484,
        longitude: -73.9857,
        speed: 0,
        accuracy: 4,
        altitude: 12,
        heading: 0,
      },
    });
    await settleRealSpaSmoke();

    const armRun = document.getElementById("armRun");
    expect(armRun?.disabled).toBe(false);
    armRun?.click();
    await settleRealSpaSmoke();

    const boardWhileActive = await navigateRealSpaSmoke("#/board");
    expect(boardWhileActive.activeWatchCount).toBe(1);
    expect(boardWhileActive.activeIntervalCount).toBe(0);
    expect(boardWhileActive.activeMapCount).toBe(0);
    expect(boardWhileActive.activeChartCount).toBe(0);
    expect(boardWhileActive.activeResizeObserverCount).toBe(0);
    expect(document.body.classList.contains("accel-sheet-open")).toBe(false);
    expect(document.body.classList.contains("accel-replay-chart-sheet-open")).toBe(false);

    const accelAgain = await navigateRealSpaSmoke("#/accel");
    expect(accelAgain.activeWatchCount).toBe(1);
    document.getElementById("armRun")?.click();
    await settleRealSpaSmoke();

    const boardAfterCancel = await navigateRealSpaSmoke("#/board");
    expect(boardAfterCancel.activeWatchCount).toBe(0);
  }, 40000);
});
