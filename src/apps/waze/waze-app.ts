import "./waze.less";
import "../../shared/driving-hud.less";

import { t as globalTranslate } from "../../i18n.js";
import { shouldDeferWelcomeLocationRequest } from "../../app/welcome-consent.js";
import { createDrivingHud } from "../../shared/driving-hud.js";
import type { NormalizedGpsPosition } from "../../types/services";
import type { MountedView } from "../../types/route";
import type { WazeRouteMountContext } from "./waze-route-app";

export const WAZE_EMBED_BASE_URL = "https://embed.waze.com/iframe";
export const WAZE_REFRESH_MIN_INTERVAL_MS = 300_000;
export const WAZE_REFRESH_MIN_DISTANCE_M = 300;
export const WAZE_GPS_CONSUMER_ID = "vatio.waze.route";
export const WAZE_SPEED_ALERTS_APP_ID = "vatio.speedAlerts";

type WazeCenter = {
  latitude: number;
  longitude: number;
  timestampMs: number;
};

type WazeElements = {
  app: HTMLElement;
  frame: HTMLIFrameElement;
  hudMount: HTMLElement;
  placeholder: HTMLElement;
  placeholderText: HTMLElement;
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

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Waze route is missing ${selector}`);
  return element;
}

function getElements(root: ParentNode): WazeElements {
  return {
    app: requireElement(root, "[data-waze-app]"),
    frame: requireElement(root, "#wazeFrame"),
    hudMount: requireElement(root, "#wazeDrivingHud"),
    placeholder: requireElement(root, "#wazePlaceholder"),
    placeholderText: requireElement(root, "#wazePlaceholderText"),
  };
}

function applyLegacyWazeHooks(mount: HTMLElement, translate: (key: string, fallback?: string) => string) {
  const hook = (selector: string, id: string, classes: string[] = []) => {
    const element = requireElement<HTMLElement>(mount, selector);
    element.id = id;
    element.classList.add(...classes);
    return element;
  };
  hook(".driving-status-pill", "wazeSpeedPill");
  hook("[data-driving-speed]", "wazeSpeedValue");
  hook("[data-driving-speed-unit]", "wazeSpeedUnit");
  hook("[data-driving-limit-label]", "wazeSpeedLimitLabel");
  hook("[data-driving-limit]", "wazeSpeedLimitValue");
  const actions = hook(".driving-actions", "wazeDrivingActions", ["waze-hud-actions"]);
  actions.setAttribute("aria-label", translate("wazeDrivingControls", "Waze driving controls"));
  hook("[data-driving-action='audio']", "quickAudioToggle", ["waze-toolbar-btn", "waze-toolbar-btn-audio"]);
  hook("[data-driving-action='alerts']", "quickAlertConfig", ["waze-toolbar-btn", "waze-toolbar-btn-alerts"]);
  hook("[data-driving-action='record']", "toggleRecording", ["waze-toolbar-btn", "waze-toolbar-btn-recording"]);
  hook("[data-driving-action='stop']", "stopRecording", ["waze-toolbar-btn", "waze-toolbar-btn-stop"]);
  const location = hook("[data-driving-action='location']", "wazeLocationPrompt", ["waze-toolbar-btn", "waze-location-prompt"]);
  location.setAttribute("aria-label", translate("enableWazeLocation", "Enable Waze location"));
  location.title = location.getAttribute("aria-label") || "";
  const recenter = hook("[data-driving-action='recenter']", "wazeRecenter", ["waze-toolbar-btn", "waze-recenter"]);
  recenter.setAttribute("aria-label", translate("recenterMap", "Refresh map"));
  recenter.title = recenter.getAttribute("aria-label") || "";
}

export function createWazeRouteController(routeContext: WazeRouteMountContext) {
  const { cleanup, root } = routeContext;
  const elements = getElements(root);
  const translate = (key: string, fallback?: string) =>
    routeContext.translate?.(key, fallback) || globalTranslate(key) || fallback || key;
  const state = {
    destroyed: false,
    position: null as NormalizedGpsPosition | null,
    online: navigator.onLine !== false,
    frameLoaded: false,
    frameLoadPending: false,
    center: null as WazeCenter | null,
  };

  function currentSpeedMs(): number {
    const alertSpeed = routeContext.drivingAlertService?.getSnapshot?.()?.currentSpeedMs;
    if (Number.isFinite(alertSpeed)) return Number(alertSpeed);
    return state.position?.stale ? 0 : Number(state.position?.speedMs || 0);
  }

  function syncEmbed({ force = false } = {}) {
    if (!state.position || !state.online || state.frameLoadPending) {
      render();
      return;
    }
    const hasSource = Boolean(elements.frame.getAttribute("src"));
    if (hasSource && !force) {
      render();
      return;
    }
    state.frameLoadPending = true;
    state.frameLoaded = false;
    state.center = {
      latitude: state.position.latitude,
      longitude: state.position.longitude,
      timestampMs: Number(state.position.timestampMs || state.position.receivedAtMs || Date.now()),
    };
    elements.frame.src = getWazeEmbedUrl(
      state.position.latitude,
      state.position.longitude,
      currentSpeedMs(),
    );
    render();
  }

  function applyPosition(position: NormalizedGpsPosition | null) {
    if (state.destroyed) return;
    state.position = position;
    if (position && !elements.frame.getAttribute("src")) syncEmbed();
    else render();
  }

  function getPlaceholderText(hasSource: boolean): string {
    if (!state.online) return translate("wazeOffline", "Waze map requires an internet connection.");
    if (shouldDeferWelcomeLocationRequest() && !state.position) {
      return translate("wazeLocationRequired", "Enable location to center the Waze map.");
    }
    if (state.frameLoadPending) return translate("loadingWazeMap", "Loading Waze live map...");
    if (hasSource) return translate("enableWazeLocation", "Enable Waze location");
    return translate("liveMapWaitingGps", "Waiting for GPS to center the live map.");
  }

  function render() {
    if (state.destroyed) return;
    const hasSource = Boolean(elements.frame.getAttribute("src"));
    const ready = state.online && hasSource && state.frameLoaded && !state.frameLoadPending;
    elements.placeholderText.textContent = getPlaceholderText(hasSource);
    elements.placeholder.classList.toggle("is-hidden", ready);
    elements.app.classList.toggle("is-loading", state.frameLoadPending);
    elements.app.classList.toggle("is-ready", ready);
    elements.app.classList.toggle("is-offline", !state.online);
    const recenter = root.querySelector<HTMLButtonElement>("#wazeRecenter");
    if (recenter) {
      recenter.disabled = state.frameLoadPending || !state.position || !state.online;
      recenter.classList.toggle("is-stale", shouldRefreshWazeEmbed(state.center, state.position));
    }
    elements.frame.title = translate("wazeMap", "Waze map");
  }

  const hud = createDrivingHud({
    mount: elements.hudMount,
    consumerId: WAZE_GPS_CONSUMER_ID,
    recordingSource: "waze",
    drivingAlerts: routeContext.drivingAlertService,
    driveRecording: routeContext.driveRecordingService,
    gps: routeContext.gpsService,
    translate,
    audioCueController: routeContext.audioCueController,
    onPosition: applyPosition,
    onLocationRequest: () => {
      const position = hud.getPosition();
      if (position) applyPosition(position);
    },
    onRecenter: () => syncEmbed({ force: true }),
    onOpenAlertSettings: () => {
      if (routeContext.appRuntime?.shell.openApp(WAZE_SPEED_ALERTS_APP_ID, { focus: true })) return;
      window.__vatioboardFloatingTools?.openSpeedAlerts?.();
    },
  });
  applyLegacyWazeHooks(elements.hudMount, translate);

  cleanup.addEventListener(elements.frame, "load", () => {
    state.frameLoadPending = false;
    state.frameLoaded = Boolean(elements.frame.getAttribute("src"));
    render();
  });
  cleanup.addEventListener(window, "online", () => {
    state.online = true;
    if (state.position && !elements.frame.getAttribute("src")) syncEmbed();
    else render();
  });
  cleanup.addEventListener(window, "offline", () => {
    state.online = false;
    render();
  });
  cleanup.add(routeContext.appRuntime?.i18n?.subscribe(() => {
    routeContext.appRuntime?.i18n.apply(root);
    hud.render();
    render();
  }));

  routeContext.appRuntime?.i18n?.apply(root);
  applyPosition(hud.getPosition());
  render();

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    hud.destroy();
    elements.frame.removeAttribute("src");
  }

  return {
    destroy,
    render,
    startSource: (options: { fromUserGesture?: boolean } = {}) => hud.startSource(options.fromUserGesture),
    syncEmbed,
  };
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
