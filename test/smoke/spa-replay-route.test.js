import { beforeEach, describe, expect, it } from "vitest";
import {
  expectRealSpaRouteRemount,
  getRealSpaSmokeMocks,
  navigateRealSpaSmoke,
  resetRealSpaSmoke,
  settleRealSpaSmoke,
} from "../helpers/real-spa-route-smoke.js";

async function saveReplaySmokeSession() {
  const {
    appendReplaySample,
    createReplaySession,
    saveActiveReplaySession,
  } = await import("../../src/replay/session.js");

  const firstTimestampMs = Date.UTC(2026, 3, 28, 12, 0, 0);
  const baseSession = createReplaySession({
    id: "replay-remount-session",
    startedAtMs: firstTimestampMs,
    unit: "kmh",
    distanceUnit: "m",
    recordingState: "stopped",
  });
  const sessionWithStart = appendReplaySample(baseSession, {
    timestampMs: firstTimestampMs,
    latitude: 40.7484,
    longitude: -73.9857,
    speedMs: 6,
    altitudeM: 12,
    headingDeg: 30,
    totalDistanceM: 0,
  });
  const sessionWithFinish = appendReplaySample(sessionWithStart, {
    timestampMs: firstTimestampMs + 1000,
    latitude: 40.749,
    longitude: -73.9848,
    speedMs: 12,
    altitudeM: 14,
    headingDeg: 35,
    totalDistanceM: 100,
  });

  await saveActiveReplaySession(sessionWithFinish);
}

describe("SPA Replay route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    await saveReplaySmokeSession();
    const { charts, maplibre } = getRealSpaSmokeMocks();

    const { snapshots, targetSnapshots } = await expectRealSpaRouteRemount({
      targetHash: "#/replay",
      targetSelector: "#replayShell:not([hidden]) #replayMap",
      sequence: ["#/board", "#/replay", "#/board", "#/replay"],
    });
    const firstReplay = targetSnapshots[0];
    const secondReplay = targetSnapshots[1];
    const boardAfterFirstReplay = snapshots[2];

    expect(
      document.querySelector("#replayRecordingsList [data-recording-id='replay-remount-session']")
    ).toBeTruthy();
    expect(maplibre.maps).toHaveLength(2);
    expect(maplibre.maps.filter((map) => !map.removed)).toHaveLength(1);
    expect(maplibre.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(boardAfterFirstReplay.activeMapCount).toBe(0);
    expect(boardAfterFirstReplay.activeChartCount).toBe(0);
    expect(boardAfterFirstReplay.activeRafCount).toBe(0);
    expect(boardAfterFirstReplay.activeResizeObserverCount).toBe(0);
    expect(secondReplay.activeMapCount).toBe(1);
    expect(secondReplay.activeChartCount).toBeLessThanOrEqual(firstReplay.activeChartCount);
    expect(secondReplay.listeners.windowRouteVisible).toBe(firstReplay.listeners.windowRouteVisible);
    expect(secondReplay.listeners.windowCloudSyncApplied).toBe(
      firstReplay.listeners.windowCloudSyncApplied
    );

    document.querySelector(".replay-graph-trigger")?.click();
    await settleRealSpaSmoke();
    expect(document.body.classList.contains("replay-graph-sheet-open")).toBe(true);
    expect(charts.charts.filter((chart) => !chart.destroyed).length).toBeGreaterThan(0);

    document.getElementById("replayRestart")?.click();
    await settleRealSpaSmoke();
    document.getElementById("replayPlayPause")?.click();
    await settleRealSpaSmoke();
    expect(getRealSpaSmokeMocks().lifecycle.activeRafIds.size).toBeGreaterThan(0);

    const boardAfterGraph = await navigateRealSpaSmoke("#/board");
    expect(boardAfterGraph.activeMapCount).toBe(0);
    expect(boardAfterGraph.activeChartCount).toBe(0);
    expect(boardAfterGraph.activeRafCount).toBe(0);
    expect(boardAfterGraph.activeResizeObserverCount).toBe(0);
    expect(document.body.classList.contains("replay-graph-sheet-open")).toBe(false);
  }, 40000);
});
