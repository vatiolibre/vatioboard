import { beforeEach, describe, expect, it } from "vitest";
import { expectRealSpaRouteRemount, resetRealSpaSmoke } from "../helpers/real-spa-route-smoke.js";

describe("SPA Library route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    const { finalSnapshot, snapshots, targetSnapshots } = await expectRealSpaRouteRemount({
      targetHash: "#/library",
      targetSelector: "#libraryList",
      sequence: ["#/board", "#/library", "#/replay", "#/accel", "#/board", "#/library"],
    });
    const firstLibrary = targetSnapshots[0];
    const secondLibrary = targetSnapshots[1];
    const boardBeforeSecondLibrary = snapshots.at(-2);

    expect(boardBeforeSecondLibrary.activeWatchCount).toBe(0);
    expect(finalSnapshot.activeWatchCount).toBe(0);
    expect(finalSnapshot.activeIntervalCount).toBe(0);
    expect(finalSnapshot.activeRafCount).toBe(0);
    expect(finalSnapshot.activeResizeObserverCount).toBe(0);
    expect(finalSnapshot.activeMapCount).toBe(0);
    expect(finalSnapshot.activeChartCount).toBe(0);
    expect(secondLibrary.listeners.windowRouteVisible).toBe(
      firstLibrary.listeners.windowRouteVisible
    );
    expect(secondLibrary.listeners.windowBackendAuth).toBe(firstLibrary.listeners.windowBackendAuth);
  }, 40000);

  it("keeps the mixed Speed to Library to Replay to Accel to Board route chain stable", async () => {
    const { finalSnapshot } = await expectRealSpaRouteRemount({
      targetHash: "#/board",
      targetSelector: "#pad",
      sequence: ["#/board", "#/speed", "#/library", "#/replay", "#/accel", "#/board"],
    });

    expect(finalSnapshot.activeWatchCount).toBe(0);
    expect(finalSnapshot.activeIntervalCount).toBe(0);
    expect(finalSnapshot.activeRafCount).toBe(0);
    expect(finalSnapshot.activeResizeObserverCount).toBe(0);
    expect(finalSnapshot.activeMapCount).toBe(0);
    expect(finalSnapshot.activeChartCount).toBe(0);
    expect(document.querySelectorAll(".floating-dock")).toHaveLength(1);
    expect(document.querySelectorAll(".player-panel")).toHaveLength(1);
    expect(document.querySelectorAll(".player-fab")).toHaveLength(1);
  }, 40000);
});
