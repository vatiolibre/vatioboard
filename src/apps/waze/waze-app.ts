import "./waze.less";

import { t as globalTranslate } from "../../i18n.js";
import {
  markWelcomeLocationChoice,
  shouldDeferWelcomeLocationRequest,
} from "../../app/welcome-consent.js";
import type {
  DriveRecordingSnapshot,
  DrivingAlertSnapshot,
  GpsSnapshot,
  NormalizedGpsPosition,
} from "../../types/services";
import type { MountedView } from "../../types/route";
import type { WazeRouteMountContext } from "./waze-route-app";

export const WAZE_EMBED_BASE_URL = "https://embed.waze.com/iframe";
export const WAZE_REFRESH_MIN_INTERVAL_MS = 300_000;
export const WAZE_REFRESH_MIN_DISTANCE_M = 300;
export const WAZE_GPS_CONSUMER_ID = "vatio.waze.route";
export const WAZE_SPEED_ALERTS_APP_ID = "vatio.speedAlerts";

type AnyRecord = Record<string, any>;
type WazeCenter = {
  latitude: number;
  longitude: number;
  timestampMs: number;
};

export function getWazeZoomLevel(speedMs: number): number {
  const speedKmh = speedMs * 3.6;
  if (speedKmh < 15) return 15;
  if (speedKmh < 45) return 14;
  if (speedKmh < 90) return 13;
  return 12;
}

export function getWazeEmbedUrl(latitude: number, longitude: number, speedMs = 0): string {
  const params = new URLSearchParams({
    zoom: String(getWazeZoomLevel(speedMs)),
    lat: latitude.toFixed(6),
    lon: longitude.toFixed(6),
    ct: "livemap",
  });
  return `${WAZE_EMBED_BASE_URL}?${params.toString()}`;
}

export function getWazeDistanceM(
  first: Pick<NormalizedGpsPosition, "latitude" | "longitude">,
  second: Pick<NormalizedGpsPosition, "latitude" | "longitude">,
): number {
  const radius = 6_371_000;
  const lat1 = first.latitude * (Math.PI / 180);
  const lat2 = second.latitude * (Math.PI / 180);
  const deltaLat = (second.latitude - first.latitude) * (Math.PI / 180);
  const deltaLon = (second.longitude - first.longitude) * (Math.PI / 180);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function shouldRefreshWazeEmbed(
  center: WazeCenter | null,
  position: NormalizedGpsPosition | null,
): boolean {
  if (!center || !position) return false;
  const timestampMs = Number(position.timestampMs || position.receivedAtMs);
  if (!Number.isFinite(timestampMs) || timestampMs - center.timestampMs < WAZE_REFRESH_MIN_INTERVAL_MS) {
    return false;
  }
  return getWazeDistanceM(center, position) >= WAZE_REFRESH_MIN_DISTANCE_M;
}

function interpolate(value: string, params: Record<string, unknown>): string {
  return value.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? `{${key}}`));
}

function getUnitLabel(unit: string): string {
  return unit === "mph" ? "mph" : "km/h";
}

function convertSpeed(speedMs: number, unit: string): number {
  return speedMs * (unit === "mph" ? 2.2369362920544 : 3.6);
}

function getElements(root: ParentNode): AnyRecord {
  return {
    app: root.querySelector("[data-waze-app]"),
    frame: root.querySelector("#wazeFrame"),
    placeholder: root.querySelector("#wazePlaceholder"),
    placeholderText: root.querySelector("#wazePlaceholderText"),
    speedPill: root.querySelector("#wazeSpeedPill"),
    speedValue: root.querySelector("#wazeSpeedValue"),
    speedUnit: root.querySelector("#wazeSpeedUnit"),
    speedLimitLabel: root.querySelector("#wazeSpeedLimitLabel"),
    speedLimitValue: root.querySelector("#wazeSpeedLimitValue"),
    speedNote: root.querySelector("#wazeSpeedNote"),
    quickAudioToggle: root.querySelector("#quickAudioToggle"),
    quickAlertConfig: root.querySelector("#quickAlertConfig"),
    toggleRecording: root.querySelector("#toggleRecording"),
    stopRecording: root.querySelector("#stopRecording"),
    locationPrompt: root.querySelector("#wazeLocationPrompt"),
    recenter: root.querySelector("#wazeRecenter"),
  };
}

export function createWazeRouteController(routeContext: WazeRouteMountContext) {
  const { cleanup, root } = routeContext;
  const elements = getElements(root);
  const drivingAlerts = routeContext.drivingAlertService || null;
  const driveRecording = routeContext.driveRecordingService || null;
  const gps = routeContext.gpsService || null;
  const i18n = routeContext.appRuntime?.i18n || null;
  const translate = (key: string, fallback?: string) =>
    routeContext.translate?.(key, fallback) || globalTranslate(key) || fallback || key;
  const state: AnyRecord = {
    destroyed: false,
    sourceStarted: false,
    ownsAlertSession: false,
    position: null,
    speedMs: 0,
    unit: "kmh",
    alertUiState: null,
    audioMuted: false,
    recordingSnapshot: driveRecording?.getSnapshot?.() || null,
    gpsStatus: "idle",
    online: navigator.onLine !== false,
    frameLoaded: false,
    frameLoadPending: false,
    center: null,
  };
  let sourceUnsubscribe: (() => void) | null = null;
  let recordingUnsubscribe: (() => void) | null = null;
  let gpsConsumerCleanup: (() => void) | null = null;

  function applyAlertSnapshot(snapshot: DrivingAlertSnapshot | null | undefined) {
    if (!snapshot || state.destroyed) return;
    state.gpsStatus = snapshot.status || state.gpsStatus;
    state.position = snapshot.latestPosition || state.position;
    state.speedMs = Number.isFinite(snapshot.currentSpeedMs) ? snapshot.currentSpeedMs : 0;
    state.alertUiState = snapshot.alertUiState || null;
    const preferences = snapshot.preferences as AnyRecord | null;
    const audio = snapshot.audio as AnyRecord | null;
    if (preferences?.unit === "mph" || preferences?.unit === "kmh") state.unit = preferences.unit;
    if (typeof preferences?.audioMuted === "boolean") state.audioMuted = preferences.audioMuted;
    else if (typeof audio?.muted === "boolean") state.audioMuted = audio.muted;
    if (state.position && !elements.frame?.getAttribute("src")) syncEmbed();
    render();
  }

  function applyRecordingSnapshot(snapshot: DriveRecordingSnapshot | null | undefined) {
    if (!snapshot || state.destroyed) return;
    state.recordingSnapshot = snapshot;
    render();
  }

  function applyGpsSnapshot(snapshot: GpsSnapshot | null | undefined) {
    if (!snapshot || state.destroyed) return;
    state.gpsStatus = snapshot.status || "idle";
    if (snapshot.normalized) {
      state.position = snapshot.normalized;
      state.speedMs = snapshot.normalized.stale ? 0 : Number(snapshot.normalized.speedMs || 0);
    }
    if (state.position && !elements.frame?.getAttribute("src")) syncEmbed();
    render();
  }

  function startSource({ fromUserGesture = false } = {}) {
    if (state.sourceStarted || state.destroyed) return;
    const existingAlertSnapshot = drivingAlerts?.getSnapshot?.() || null;
    const alertSessionStarted = existingAlertSnapshot?.started === true;
    if (shouldDeferWelcomeLocationRequest() && !fromUserGesture && !alertSessionStarted) {
      render();
      return;
    }

    state.sourceStarted = true;
    if (drivingAlerts) {
      const snapshot = alertSessionStarted
        ? existingAlertSnapshot
        : drivingAlerts.start?.({
          fromUserGesture,
          reason: fromUserGesture ? "waze-route-user" : "waze-route",
        });
      state.ownsAlertSession = !alertSessionStarted && snapshot?.started === true;
      applyAlertSnapshot(snapshot || existingAlertSnapshot);
      sourceUnsubscribe = drivingAlerts.subscribe?.(applyAlertSnapshot) || null;
      return;
    }

    if (gps) {
      gpsConsumerCleanup = gps.startConsumer?.(WAZE_GPS_CONSUMER_ID, {
        enableHighAccuracy: true,
        reason: "waze-route",
      }) || null;
      sourceUnsubscribe = gps.subscribe?.(applyGpsSnapshot) || null;
      const current = gps.getCurrentPosition?.();
      if (current) {
        applyGpsSnapshot({
          ...gps.getSnapshot(),
          normalized: current,
        });
      }
      return;
    }

    state.gpsStatus = "unsupported";
    render();
  }

  function getPermissionUrl(): string {
    const existing = elements.frame?.getAttribute("src");
    if (existing) return existing;
    if (state.position) {
      return getWazeEmbedUrl(state.position.latitude, state.position.longitude, state.speedMs);
    }
    return `${WAZE_EMBED_BASE_URL}?zoom=13&lat=40.7484&lon=-73.9857&ct=livemap`;
  }

  function syncEmbed({ force = false } = {}) {
    if (!elements.frame || !state.position || !state.online || state.frameLoadPending) {
      render();
      return;
    }
    const hasSource = Boolean(elements.frame.getAttribute("src"));
    if (hasSource && !force) {
      render();
      return;
    }
    const position = state.position as NormalizedGpsPosition;
    state.frameLoadPending = true;
    state.frameLoaded = false;
    state.center = {
      latitude: position.latitude,
      longitude: position.longitude,
      timestampMs: Number(position.timestampMs || position.receivedAtMs || Date.now()),
    } satisfies WazeCenter;
    elements.frame.src = getWazeEmbedUrl(position.latitude, position.longitude, state.speedMs);
    render();
  }

  function getPlaceholderText(hasSource: boolean): string {
    if (!state.online) return translate("wazeOffline", "Waze map requires an internet connection.");
    if (shouldDeferWelcomeLocationRequest() && !state.sourceStarted) {
      return translate("wazeLocationRequired", "Enable location to center the Waze map.");
    }
    if (state.frameLoadPending) return translate("loadingWazeMap", "Loading Waze live map...");
    if (state.gpsStatus === "unsupported") {
      return translate("wazeGpsUnsupported", "GPS is not available in this browser.");
    }
    if (state.gpsStatus === "error") {
      return translate("wazeGpsUnavailable", "Location is unavailable. Tap Enable location to retry.");
    }
    if (hasSource) return translate("enableWazeLocation", "Enable Waze location");
    return translate("liveMapWaitingGps", "Waiting for GPS to center the live map.");
  }

  function renderAlertUi() {
    const alertState = (state.alertUiState || {}) as AnyRecord;
    const unitLabel = getUnitLabel(state.unit);
    const currentSpeed = Math.round(convertSpeed(Number(state.speedMs || 0), state.unit));
    const enabled = Boolean(alertState.enabled);
    const limitLabel = enabled ? translate("speedLimit", "Limit") : translate("alerts", "Alerts");
    const limitValue = enabled && Number.isFinite(alertState.limitDisplayValue)
      ? `${alertState.limitDisplayValue} ${unitLabel}`
      : translate("off", "Off");
    let note = "";
    if (alertState.over) {
      note = interpolate(translate("alertOverShort", "Over by {delta}"), {
        delta: `${alertState.deltaDisplayValue} ${unitLabel}`,
      });
    } else if (alertState.near) {
      note = translate("nearLimit", "Near limit");
    } else if (alertState.source === "trap") {
      note = translate("trapCompact", "Trap");
    } else if (alertState.source === "manual") {
      note = translate("manualCompact", "Manual alert");
    }

    elements.speedValue.textContent = String(currentSpeed);
    elements.speedUnit.textContent = unitLabel;
    elements.speedLimitLabel.textContent = limitLabel;
    elements.speedLimitValue.textContent = limitValue;
    elements.speedNote.hidden = !note;
    elements.speedNote.textContent = note;
    elements.speedPill.classList.toggle("has-limit", enabled);
    elements.speedPill.classList.toggle("is-alert-near", Boolean(alertState.near));
    elements.speedPill.classList.toggle("is-alert-over", Boolean(alertState.over));
    elements.speedPill.classList.toggle("is-trap-active", Boolean(alertState.trapActive));
  }

  function renderToolbar() {
    const alertState = (state.alertUiState || {}) as AnyRecord;
    const recordingState = String(state.recordingSnapshot?.state || "idle");
    const isRecording = recordingState === "recording";
    const isPaused = recordingState === "paused";
    const isFinalizing = recordingState === "finalizing";
    const hasRecording = isRecording || isPaused || isFinalizing;
    const recordingLabel = isRecording
      ? translate("pauseRecording", "Pause recording")
      : isPaused
        ? translate("resumeRecording", "Resume recording")
        : translate("startRecording", "Start recording");
    const audioLabel = state.audioMuted
      ? translate("unmuteAlertAudio", "Unmute alert audio")
      : translate("muteAlertAudio", "Mute alert audio");

    elements.quickAudioToggle.classList.toggle("is-muted", state.audioMuted);
    elements.quickAudioToggle.setAttribute("aria-pressed", String(!state.audioMuted));
    elements.quickAudioToggle.setAttribute("aria-label", audioLabel);
    elements.quickAudioToggle.title = audioLabel;
    elements.quickAlertConfig.setAttribute("aria-pressed", String(Boolean(alertState.enabled)));
    elements.toggleRecording.dataset.recordingIcon = isRecording ? "pause" : "record";
    elements.toggleRecording.setAttribute("aria-pressed", String(isRecording));
    elements.toggleRecording.setAttribute("aria-label", recordingLabel);
    elements.toggleRecording.title = recordingLabel;
    elements.toggleRecording.disabled = isFinalizing || !driveRecording;
    elements.stopRecording.hidden = !hasRecording;
    elements.stopRecording.disabled = isFinalizing || !driveRecording;
  }

  function render() {
    if (state.destroyed || !elements.app) return;
    const hasSource = Boolean(elements.frame?.getAttribute("src"));
    const ready = state.online && hasSource && state.frameLoaded && !state.frameLoadPending;
    renderAlertUi();
    renderToolbar();
    elements.placeholderText.textContent = getPlaceholderText(hasSource);
    elements.placeholder.classList.toggle("is-hidden", ready);
    elements.app.classList.toggle("is-loading", state.frameLoadPending);
    elements.app.classList.toggle("is-ready", ready);
    elements.app.classList.toggle("is-offline", !state.online);
    elements.locationPrompt.disabled = state.frameLoadPending;
    elements.recenter.disabled = state.frameLoadPending || !state.position || !state.online;
    elements.recenter.classList.toggle(
      "is-stale",
      shouldRefreshWazeEmbed(state.center, state.position),
    );
    elements.frame.title = translate("wazeMap", "Waze map");
  }

  function handleLocationPrompt() {
    if (!state.position) {
      markWelcomeLocationChoice("enabled");
      state.sourceStarted = false;
      startSource({ fromUserGesture: true });
      return;
    }
    window.open(getPermissionUrl(), "_blank", "noopener,noreferrer");
  }

  function handleAudioToggle() {
    if (!drivingAlerts?.setMuted) return;
    const nextMuted = !state.audioMuted;
    const snapshot = drivingAlerts.setMuted(nextMuted, {
      fromUserGesture: true,
      startIfNeeded: false,
    });
    applyAlertSnapshot(snapshot);
    if (!nextMuted) void drivingAlerts.primeAudioFromUserGesture?.();
  }

  function handleAlertConfig() {
    if (routeContext.appRuntime?.shell.openApp(WAZE_SPEED_ALERTS_APP_ID, { focus: true })) return;
    window.__vatioboardFloatingTools?.openSpeedAlerts?.();
  }

  function handleRecordingToggle() {
    if (!driveRecording) return;
    const recordingState = String(state.recordingSnapshot?.state || "idle");
    const snapshot = recordingState === "recording"
      ? driveRecording.pauseRecording()
      : recordingState === "paused"
        ? driveRecording.resumeRecording()
        : driveRecording.startRecording({ source: "waze" });
    applyRecordingSnapshot(snapshot);
  }

  async function handleRecordingStop() {
    if (!driveRecording || elements.stopRecording.disabled) return;
    elements.stopRecording.disabled = true;
    try {
      applyRecordingSnapshot(await driveRecording.stopRecording());
    } catch (error) {
      routeContext.logger?.error("Unable to stop Waze route recording.", error);
      applyRecordingSnapshot(driveRecording.getSnapshot?.());
    }
  }

  cleanup.addEventListener(elements.quickAudioToggle, "click", handleAudioToggle);
  cleanup.addEventListener(elements.quickAlertConfig, "click", handleAlertConfig);
  cleanup.addEventListener(elements.toggleRecording, "click", handleRecordingToggle);
  cleanup.addEventListener(elements.stopRecording, "click", () => void handleRecordingStop());
  cleanup.addEventListener(elements.locationPrompt, "click", handleLocationPrompt);
  cleanup.addEventListener(elements.recenter, "click", () => syncEmbed({ force: true }));
  cleanup.addEventListener(elements.frame, "load", () => {
    state.frameLoadPending = false;
    state.frameLoaded = Boolean(elements.frame?.getAttribute("src"));
    render();
  });
  cleanup.addEventListener(window, "online", () => {
    state.online = true;
    if (state.position && !elements.frame?.getAttribute("src")) syncEmbed();
    else render();
  });
  cleanup.addEventListener(window, "offline", () => {
    state.online = false;
    render();
  });
  cleanup.add(i18n?.subscribe(() => {
    i18n.apply(root);
    render();
  }));

  i18n?.apply(root);
  recordingUnsubscribe = driveRecording?.subscribe?.(applyRecordingSnapshot) || null;
  startSource();
  render();

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    sourceUnsubscribe?.();
    sourceUnsubscribe = null;
    recordingUnsubscribe?.();
    recordingUnsubscribe = null;
    gpsConsumerCleanup?.();
    gpsConsumerCleanup = null;
    if (state.ownsAlertSession) {
      drivingAlerts?.stop?.({ reason: "waze-route-unmount" });
    }
    elements.frame?.removeAttribute("src");
  }

  return { destroy, render, startSource, syncEmbed };
}

let activeController: ReturnType<typeof createWazeRouteController> | null = null;

export function mountWazeRoute(routeContext: WazeRouteMountContext): MountedView {
  activeController?.destroy();
  const controller = createWazeRouteController(routeContext);
  activeController = controller;
  routeContext.cleanup.add(() => controller.destroy());
  return {
    unmount() {
      controller.destroy();
      if (activeController === controller) activeController = null;
    },
  };
}

export function unmountWazeRoute(): void {
  activeController?.destroy();
  activeController = null;
}
