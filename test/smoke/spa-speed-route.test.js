import { beforeEach, describe, expect, it } from "vitest";
import {
  expectRealSpaRouteRemount,
  getRealSpaResourceSnapshot,
  getRealSpaSmokeMocks,
  navigateRealSpaSmoke,
  resetRealSpaSmoke,
  settleRealSpaSmoke,
} from "../helpers/real-spa-route-smoke.js";

const WELCOME_CONSENT_KEY = "vatioboard.welcome_consent.v1";

function storeWelcomeConsent(locationChoice) {
  localStorage.setItem(
    WELCOME_CONSENT_KEY,
    JSON.stringify({
      accepted: true,
      acceptedAtMs: Date.now(),
      locationChoice,
      version: 1,
    }),
  );
}

describe("SPA Speed route real-controller smoke", () => {
  beforeEach(resetRealSpaSmoke);

  it("stays usable after Board remount cycles", async () => {
    const { maplibre } = getRealSpaSmokeMocks();

    const { snapshots, targetSnapshots } = await expectRealSpaRouteRemount({
      targetHash: "/",
      targetSelector: ".gauge-card #speedValue",
      sequence: ["/board", "/", "/board", "/"],
    });
    const firstSpeed = targetSnapshots[0];
    const secondSpeed = targetSnapshots[1];
    const boardAfterFirstSpeed = snapshots[2];

    expect(document.querySelector("#gaugeStage")).toBeTruthy();
    expect(document.querySelector(".speed-view-switch")).toBeNull();
    expect(document.querySelector("#wazeStage")).toBeNull();
    expect(maplibre.maps).toHaveLength(2);
    expect(maplibre.maps.filter((map) => !map.removed)).toHaveLength(1);
    expect(maplibre.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(boardAfterFirstSpeed.activeWatchCount).toBe(0);
    expect(boardAfterFirstSpeed.activeRafCount).toBe(0);
    expect(boardAfterFirstSpeed.activeResizeObserverCount).toBe(0);
    expect(secondSpeed.activeWatchCount).toBe(1);
    expect(secondSpeed.activeIntervalCount).toBeLessThanOrEqual(firstSpeed.activeIntervalCount);
    expect(secondSpeed.activeRafCount).toBeLessThanOrEqual(firstSpeed.activeRafCount);
    expect(secondSpeed.activeResizeObserverCount).toBeLessThanOrEqual(
      firstSpeed.activeResizeObserverCount
    );
    expect(secondSpeed.audioInstanceCount).toBe(firstSpeed.audioInstanceCount);
    expect(secondSpeed.audioEventListenerCount).toBe(firstSpeed.audioEventListenerCount);
    expect(secondSpeed.mediaSessionActionHandlerCount).toBe(
      firstSpeed.mediaSessionActionHandlerCount
    );
    expect(secondSpeed.listeners.windowSingleTabOwnership).toBe(
      firstSpeed.listeners.windowSingleTabOwnership
    );

    document.getElementById("quickAlertConfig")?.click();
    await settleRealSpaSmoke();
    const speedAlerts = document.querySelector(".speed-alert-window");
    expect(speedAlerts?.hidden).toBe(false);
    expect(speedAlerts?.getAttribute("data-vb-shell-window")).toBe("speed-alerts");
    const boardAfterAlert = await navigateRealSpaSmoke("/board");
    expect(boardAfterAlert.activeWatchCount).toBe(0);
    expect(boardAfterAlert.activeRafCount).toBe(0);
    expect(boardAfterAlert.activeMapCount).toBe(0);
    expect(boardAfterAlert.activeResizeObserverCount).toBe(0);
    expect(document.querySelector(".speed-alert-window")).toBe(speedAlerts);
    expect(speedAlerts.hidden).toBe(false);
  }, 40000);

  it("does not start GPS after skipped welcome location until Retry GPS is clicked", async () => {
    storeWelcomeConsent("skipped");

    const { finalSnapshot } = await expectRealSpaRouteRemount({
      targetHash: "/",
      targetSelector: "#speedValue",
      sequence: ["/board", "/"],
    });

    expect(finalSnapshot.activeWatchCount).toBe(0);
    expect(document.getElementById("notice")?.hidden).toBe(false);
    expect(document.getElementById("noticeText")?.textContent).toBe(
      "Allow location access to measure speed.",
    );

    document.getElementById("retryGps")?.click();
    await settleRealSpaSmoke();

    expect(getRealSpaResourceSnapshot().activeWatchCount).toBe(1);
    expect(JSON.parse(localStorage.getItem(WELCOME_CONSENT_KEY))).toMatchObject({
      locationChoice: "enabled",
    });
  }, 40000);

  it("ignores the retired primary-view preference and remains gauge-only", async () => {
    localStorage.setItem("vatio_speed_primary_view", "waze");

    await expectRealSpaRouteRemount({
      targetHash: "/",
      targetSelector: "#gaugeStage #speedValue",
      sequence: ["/board", "/", "/board", "/"],
    });

    expect(document.querySelector("#gaugeStage")).toBeTruthy();
    expect(document.querySelector(".speed-view-switch")).toBeNull();
    expect(document.querySelector("#wazeStage")).toBeNull();
  }, 40000);

  it("keeps active recording GPS in the background without route DOM work", async () => {
    await expectRealSpaRouteRemount({
      targetHash: "/",
      targetSelector: "#speedValue",
      sequence: ["/board", "/"],
    });

    document.getElementById("toggleRecording")?.click();
    await settleRealSpaSmoke();
    navigator.geolocation.success?.({
      timestamp: Date.now(),
      coords: {
        latitude: 40.7484,
        longitude: -73.9857,
        speed: 8,
        accuracy: 5,
        altitude: 14,
        heading: 12,
      },
    });
    await settleRealSpaSmoke();

    const boardWhileRecording = await navigateRealSpaSmoke("/board");
    expect(boardWhileRecording.activeWatchCount).toBe(1);
    expect(boardWhileRecording.activeRafCount).toBe(0);
    expect(boardWhileRecording.activeMapCount).toBe(0);
    expect(boardWhileRecording.activeResizeObserverCount).toBe(0);
    expect(document.getElementById("speedValue")).toBeNull();

    navigator.geolocation.success?.({
      timestamp: Date.now() + 1000,
      coords: {
        latitude: 40.7488,
        longitude: -73.9852,
        speed: 9,
        accuracy: 5,
        altitude: 15,
        heading: 14,
      },
    });
    await settleRealSpaSmoke();
    expect(document.body.classList.contains("board-page")).toBe(true);
    expect(document.getElementById("speedValue")).toBeNull();

    const speedAgain = await navigateRealSpaSmoke("/");
    expect(speedAgain.activeWatchCount).toBe(1);
    document.getElementById("stopRecording")?.click();
    await settleRealSpaSmoke();

    const boardAfterStop = await navigateRealSpaSmoke("/board");
    expect(boardAfterStop.activeWatchCount).toBe(0);
  }, 40000);
});
