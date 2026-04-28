import { beforeEach, describe, expect, it } from "vitest";
import {
  expectRealSpaRouteRemount,
  getRealSpaSmokeMocks,
  resetRealSpaSmoke,
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
    const { maplibre } = getRealSpaSmokeMocks();

    await expectRealSpaRouteRemount({
      targetHash: "#/replay",
      targetSelector: "#replayShell:not([hidden]) #replayMap",
      sequence: ["#/board", "#/replay", "#/board", "#/replay"],
    });

    expect(
      document.querySelector("#replayRecordingsList [data-recording-id='replay-remount-session']")
    ).toBeTruthy();
    expect(maplibre.maps).toHaveLength(2);
  }, 40000);
});
