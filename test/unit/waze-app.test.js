import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCleanupStack } from "../../src/app/view-cleanup.js";
import wazeTemplate from "../../src/apps/waze/waze-template.js";
import {
  WAZE_REFRESH_MIN_INTERVAL_MS,
  createWazeRouteController,
  getWazeEmbedUrl,
  getWazeZoomLevel,
  shouldRefreshWazeEmbed,
  unmountWazeRoute,
} from "../../src/apps/waze/waze-app.js";

const CONSENT_KEY = "vatioboard.welcome_consent.v1";

function storeConsent(locationChoice = "enabled") {
  localStorage.setItem(CONSENT_KEY, JSON.stringify({
    accepted: true,
    acceptedAtMs: Date.now(),
    locationChoice,
    version: 1,
  }));
}

function makePosition(overrides = {}) {
  return {
    latitude: 40.7484,
    longitude: -73.9857,
    accuracy: 5,
    altitudeM: 10,
    altitudeAccuracyM: 4,
    speedMs: 10,
    heading: 12,
    headingDeg: 12,
    timestampMs: 1_000_000,
    receivedAtMs: 1_000_000,
    stale: false,
    ...overrides,
  };
}

function makeAlertSnapshot(overrides = {}) {
  return {
    status: "active",
    started: true,
    currentSpeedMs: 10,
    latestPosition: makePosition(),
    alertUiState: {
      enabled: true,
      limitDisplayValue: 30,
      deltaDisplayValue: 0,
      over: false,
      near: false,
      source: "manual",
      trapActive: false,
    },
    preferences: { unit: "mph" },
    ...overrides,
  };
}

function createRoot() {
  const root = document.createElement("main");
  root.innerHTML = wazeTemplate;
  document.body.append(root);
  return root;
}

function createContext({
  appRuntime = null,
  audioCueController = null,
  driveRecordingService = null,
  drivingAlertService = null,
  gpsService = null,
} = {}) {
  return {
    root: createRoot(),
    context: {},
    cleanup: createCleanupStack(),
    drivingAlertService,
    driveRecordingService,
    gpsService,
    appRuntime,
    audioCueController,
    translate: (_key, fallback) => fallback,
  };
}

describe("Waze route app", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    storeConsent();
  });

  afterEach(() => {
    unmountWazeRoute();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("derives stable Waze zoom levels and embed URLs", () => {
    expect(getWazeZoomLevel(2)).toBe(15);
    expect(getWazeZoomLevel(20 / 3.6)).toBe(14);
    expect(getWazeZoomLevel(60 / 3.6)).toBe(13);
    expect(getWazeZoomLevel(120 / 3.6)).toBe(12);

    const url = getWazeEmbedUrl(40.7484, -73.9857, 60 / 3.6);
    expect(url).toContain("zoom=13");
    expect(url).toContain("lat=40.748400");
    expect(url).toContain("lon=-73.985700");
  });

  it("uses icon-only Waze and driving toolbar controls with accessible names", () => {
    const root = createRoot();
    expect(root.querySelector(".waze-placeholder-icon svg")?.getAttribute("viewBox")).toBe("0 0 640 640");
    expect(root.querySelector(".waze-brand-icon svg")?.getAttribute("viewBox")).toBe("0 0 640 640");
    expect(root.querySelector(".waze-hud-actions")?.getAttribute("role")).toBe("toolbar");
    expect(root.querySelectorAll(".waze-toolbar-btn")).toHaveLength(6);
    expect(root.querySelector("#wazeLocationPrompt svg")).toBeTruthy();
    expect(root.querySelector("#wazeLocationPrompt")?.getAttribute("aria-label")).toBe("Enable Waze location");
    expect(root.querySelector("#wazeRecenter svg")).toBeTruthy();
    expect(root.querySelector("#wazeRecenter")?.getAttribute("aria-label")).toBe("Refresh map");
    expect(root.querySelector("#stopRecording")?.hidden).toBe(true);
    root.remove();
  });

  it("reuses shared alert audio and launches the Speed Alerts window", () => {
    const setMuted = vi.fn((_muted) => makeAlertSnapshot({
      preferences: { unit: "mph", audioMuted: true },
      audio: { muted: true },
    }));
    const openApp = vi.fn(() => true);
    const service = {
      getSnapshot: vi.fn(() => makeAlertSnapshot({ preferences: { unit: "mph", audioMuted: false } })),
      start: vi.fn(() => makeAlertSnapshot({ preferences: { unit: "mph", audioMuted: false } })),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      setMuted,
      primeAudioFromUserGesture: vi.fn(async () => true),
    };
    const context = createContext({
      drivingAlertService: service,
      appRuntime: { shell: { openApp } },
    });
    const controller = createWazeRouteController(context);

    context.root.querySelector("#quickAudioToggle").click();
    expect(setMuted).toHaveBeenCalledWith(true, {
      fromUserGesture: true,
      startIfNeeded: false,
    });
    expect(context.root.querySelector("#quickAudioToggle").classList.contains("is-muted")).toBe(true);
    expect(context.root.querySelector("#quickAudioToggle").getAttribute("aria-label")).toBe("Unmute alert audio");

    context.root.querySelector("#quickAlertConfig").click();
    expect(openApp).toHaveBeenCalledWith("vatio.speedAlerts", { focus: true });

    controller.destroy();
    context.cleanup.run();
  });

  it("arms enabled alert audio and plays its confirmation cue from an unmute gesture", async () => {
    let snapshot = makeAlertSnapshot({
      preferences: {
        unit: "mph",
        alertEnabled: true,
        alertLimitMs: 30,
        alertSoundEnabled: true,
        audioMuted: true,
        trapAlertEnabled: false,
        trapSoundEnabled: true,
      },
      audio: {
        muted: true,
        primed: false,
        backgroundAudioArmed: false,
      },
    });
    const setMuted = vi.fn((muted) => {
      snapshot = {
        ...snapshot,
        preferences: { ...snapshot.preferences, audioMuted: muted },
        audio: { ...snapshot.audio, muted },
      };
      return snapshot;
    });
    const primeAudioFromUserGesture = vi.fn(async () => {
      snapshot = {
        ...snapshot,
        audio: {
          ...snapshot.audio,
          muted: false,
          primed: true,
          backgroundAudioArmed: true,
        },
      };
      return true;
    });
    const playAlertsArmedCue = vi.fn(() => true);
    const audioCueController = {
      destroy: vi.fn(),
      getSnapshot: vi.fn(() => ({
        alertsArmedBlocked: false,
        recordingStartedBlocked: false,
      })),
      playAlertsArmedCue,
      playRecordingStartedCue: vi.fn(() => true),
    };
    const service = {
      getSnapshot: vi.fn(() => snapshot),
      start: vi.fn(() => snapshot),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      setMuted,
      primeAudioFromUserGesture,
    };
    const context = createContext({ drivingAlertService: service, audioCueController });
    const controller = createWazeRouteController(context);

    context.root.querySelector("#quickAudioToggle").click();
    expect(primeAudioFromUserGesture).toHaveBeenCalledTimes(1);
    expect(playAlertsArmedCue).toHaveBeenCalledTimes(1);
    expect(context.root.querySelector("#quickAudioToggle").dataset.audioState).toBe("arming");
    await vi.waitFor(() => {
      expect(context.root.querySelector("#quickAudioToggle").dataset.audioState).toBe("armed");
    });

    controller.destroy();
    expect(audioCueController.destroy).not.toHaveBeenCalled();
    context.cleanup.run();
  });

  it("rearms an enabled unmuted session instead of muting it on the first audio tap", async () => {
    let snapshot = makeAlertSnapshot({
      preferences: {
        unit: "mph",
        alertEnabled: true,
        alertLimitMs: 30,
        alertSoundEnabled: true,
        audioMuted: false,
        trapAlertEnabled: false,
        trapSoundEnabled: true,
      },
      audio: {
        muted: false,
        primed: false,
        backgroundAudioArmed: false,
      },
    });
    const setMuted = vi.fn();
    const primeAudioFromUserGesture = vi.fn(async () => {
      snapshot = {
        ...snapshot,
        audio: { ...snapshot.audio, primed: true, backgroundAudioArmed: true },
      };
      return true;
    });
    const playAlertsArmedCue = vi.fn(() => true);
    const context = createContext({
      audioCueController: {
        destroy: vi.fn(),
        getSnapshot: vi.fn(() => ({
          alertsArmedBlocked: false,
          recordingStartedBlocked: false,
        })),
        playAlertsArmedCue,
        playRecordingStartedCue: vi.fn(() => true),
      },
      drivingAlertService: {
        getSnapshot: vi.fn(() => snapshot),
        start: vi.fn(() => snapshot),
        stop: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        setMuted,
        primeAudioFromUserGesture,
      },
    });
    const controller = createWazeRouteController(context);
    const audioToggle = context.root.querySelector("#quickAudioToggle");

    expect(audioToggle.dataset.audioState).toBe("unarmed");
    expect(audioToggle.getAttribute("aria-label")).toBe("Enable driving alerts");
    audioToggle.click();
    expect(setMuted).not.toHaveBeenCalled();
    expect(primeAudioFromUserGesture).toHaveBeenCalledTimes(1);
    expect(playAlertsArmedCue).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(audioToggle.dataset.audioState).toBe("armed"));

    controller.destroy();
    context.cleanup.run();
  });

  it("starts, pauses, resumes, and stops a shared route recording", async () => {
    let snapshot = { state: "idle", sampleCount: 0 };
    let listener = () => {};
    const update = (state) => {
      snapshot = { ...snapshot, state };
      listener(snapshot);
      return snapshot;
    };
    const unsubscribe = vi.fn();
    const service = {
      getSnapshot: vi.fn(() => snapshot),
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        listener(snapshot);
        return unsubscribe;
      }),
      startRecording: vi.fn(() => update("recording")),
      pauseRecording: vi.fn(() => update("paused")),
      resumeRecording: vi.fn(() => update("recording")),
      stopRecording: vi.fn(async () => update("idle")),
    };
    const playRecordingStartedCue = vi.fn(() => true);
    const audioCueController = {
      destroy: vi.fn(),
      getSnapshot: vi.fn(() => ({
        alertsArmedBlocked: false,
        recordingStartedBlocked: false,
      })),
      playAlertsArmedCue: vi.fn(() => true),
      playRecordingStartedCue,
    };
    const context = createContext({ driveRecordingService: service, audioCueController });
    const controller = createWazeRouteController(context);
    const toggle = context.root.querySelector("#toggleRecording");
    const stop = context.root.querySelector("#stopRecording");

    expect(stop.hidden).toBe(true);
    toggle.click();
    expect(service.startRecording).toHaveBeenCalledWith({ source: "waze" });
    expect(playRecordingStartedCue).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-label")).toBe("Pause recording");
    expect(stop.hidden).toBe(false);
    toggle.click();
    expect(service.pauseRecording).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-label")).toBe("Resume recording");
    toggle.click();
    expect(service.resumeRecording).toHaveBeenCalledTimes(1);
    expect(playRecordingStartedCue).toHaveBeenCalledTimes(1);
    stop.click();
    await vi.waitFor(() => expect(stop.hidden).toBe(true));
    expect(service.stopRecording).toHaveBeenCalledTimes(1);

    controller.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    context.cleanup.run();
  });

  it("marks recentering stale only after both time and distance thresholds", () => {
    const center = { latitude: 40.7484, longitude: -73.9857, timestampMs: 1_000_000 };
    expect(shouldRefreshWazeEmbed(center, makePosition({
      latitude: 40.752,
      timestampMs: 1_000_000 + WAZE_REFRESH_MIN_INTERVAL_MS - 1,
    }))).toBe(false);
    expect(shouldRefreshWazeEmbed(center, makePosition({
      latitude: 40.7485,
      timestampMs: 1_000_000 + WAZE_REFRESH_MIN_INTERVAL_MS,
    }))).toBe(false);
    expect(shouldRefreshWazeEmbed(center, makePosition({
      latitude: 40.752,
      timestampMs: 1_000_000 + WAZE_REFRESH_MIN_INTERVAL_MS,
    }))).toBe(true);
  });

  it("renders the shared alert snapshot and releases only its alert consumer lease", () => {
    const releaseConsumer = vi.fn();
    const initial = makeAlertSnapshot({ started: false, status: "idle", latestPosition: null });
    const started = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => initial),
      acquireConsumer: vi.fn(() => releaseConsumer),
      start: vi.fn(() => started),
      stop: vi.fn(),
      subscribe: vi.fn((listener) => {
        listener(started);
        return vi.fn();
      }),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.acquireConsumer).toHaveBeenCalledWith("vatio.waze.route", {
      fromUserGesture: false,
      reason: "waze-route",
    });
    expect(service.start).not.toHaveBeenCalled();
    expect(context.root.querySelector("#wazeFrame").src).toContain("embed.waze.com/iframe");
    expect(context.root.querySelector("#wazeSpeedValue").textContent).toBe("22");
    expect(context.root.querySelector("#wazeSpeedUnit").textContent).toBe("mph");
    expect(context.root.querySelector("#wazeSpeedLimitValue").textContent).toBe("30 mph");

    controller.destroy();
    expect(releaseConsumer).toHaveBeenCalledTimes(1);
    expect(service.stop).not.toHaveBeenCalled();
    context.cleanup.run();
  });

  it("moves from the loading placeholder to the ready iframe state", () => {
    const snapshot = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => ({ ...snapshot, started: false })),
      start: vi.fn(() => snapshot),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);
    const app = context.root.querySelector("[data-waze-app]");
    const frame = context.root.querySelector("#wazeFrame");
    const placeholder = context.root.querySelector("#wazePlaceholder");

    expect(app.classList.contains("is-loading")).toBe(true);
    expect(placeholder.classList.contains("is-hidden")).toBe(false);
    frame.dispatchEvent(new Event("load"));
    expect(app.classList.contains("is-loading")).toBe(false);
    expect(app.classList.contains("is-ready")).toBe(true);
    expect(placeholder.classList.contains("is-hidden")).toBe(true);

    controller.destroy();
    context.cleanup.run();
  });

  it("preserves a driving-alert session that was already active", () => {
    const snapshot = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => snapshot),
      start: vi.fn(() => snapshot),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.start).not.toHaveBeenCalled();
    controller.destroy();
    expect(service.stop).not.toHaveBeenCalled();
    context.cleanup.run();
  });

  it("uses a pre-existing alert session without bypassing skipped location consent", () => {
    storeConsent("skipped");
    const snapshot = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => snapshot),
      start: vi.fn(() => snapshot),
      stop: vi.fn(),
      subscribe: vi.fn((listener) => {
        listener(snapshot);
        return vi.fn();
      }),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.start).not.toHaveBeenCalled();
    expect(context.root.querySelector("#wazeFrame").src).toContain("embed.waze.com/iframe");
    controller.destroy();
    expect(service.stop).not.toHaveBeenCalled();
    context.cleanup.run();
  });

  it("defers GPS after skipped consent and starts it from the location action", () => {
    storeConsent("skipped");
    const started = makeAlertSnapshot();
    const service = {
      getSnapshot: vi.fn(() => makeAlertSnapshot({ started: false, latestPosition: null })),
      start: vi.fn(() => started),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const context = createContext({ drivingAlertService: service });
    const controller = createWazeRouteController(context);

    expect(service.start).not.toHaveBeenCalled();
    expect(context.root.querySelector("#wazePlaceholderText").textContent).toContain("Enable location");
    context.root.querySelector("#wazeLocationPrompt").click();
    expect(service.start).toHaveBeenCalledWith({ fromUserGesture: true, reason: "waze-route-user" });
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY))).toMatchObject({ locationChoice: "enabled" });

    controller.destroy();
    context.cleanup.run();
  });

  it("falls back to the shared GPS service and releases its consumer", () => {
    const releaseConsumer = vi.fn();
    const unsubscribe = vi.fn();
    const position = makePosition();
    const gpsService = {
      startConsumer: vi.fn(() => releaseConsumer),
      subscribe: vi.fn((listener) => {
        listener({ status: "active", normalized: position });
        return unsubscribe;
      }),
      getCurrentPosition: vi.fn(() => position),
      getSnapshot: vi.fn(() => ({ status: "active", normalized: position })),
    };
    const context = createContext({ gpsService });
    const controller = createWazeRouteController(context);

    expect(gpsService.startConsumer).toHaveBeenCalledWith("vatio.waze.route", {
      enableHighAccuracy: true,
      reason: "waze-route",
    });
    expect(context.root.querySelector("#wazeFrame").src).toContain("embed.waze.com/iframe");
    controller.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(releaseConsumer).toHaveBeenCalledTimes(1);
    context.cleanup.run();
  });
});
