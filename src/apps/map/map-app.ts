import "../../styles/camera-map.less";
import "../../shared/driving-hud.less";
import "./map.less";

import { createDrivingHud } from "../../shared/driving-hud.js";
import type { MountedView } from "../../types/route";
import type { MapRouteMountContext } from "./map-route-app";
import { createMapRenderer } from "./map-renderer.js";
import { createMapSettingsStore } from "./map-settings.js";
import { migrateCameraMapToMapApp } from "./map-migration.js";

export type MapRuntimeStatus = "idle" | "loading-style" | "loading-cameras" | "ready" | "degraded" | "error";
export type MapPresentationMode = "2d" | "3d" | "globe";

const MAP_PRESENTATION_KEY = "vatioboard.map.presentation.v1";

function loadPresentationMode(): MapPresentationMode {
  try {
    const value = localStorage.getItem(MAP_PRESENTATION_KEY);
    if (value === "2d" || value === "3d" || value === "globe") return value;
    const legacy = localStorage.getItem("vatioboard.cameraMap.projection.v1");
    if (legacy === "globe") return "globe";
  } catch {
    // Use the driving-friendly default.
  }
  return "2d";
}

function savePresentationMode(mode: MapPresentationMode) {
  try {
    localStorage.setItem(MAP_PRESENTATION_KEY, mode);
  } catch {
    // Preference persistence is optional.
  }
}

function getRuntimeStatus(snapshot: Record<string, any> | null): MapRuntimeStatus {
  const cameraStatus = snapshot?.cameraStatus?.status;
  if (cameraStatus === "loading-manifest") return snapshot?.mapReady ? "loading-cameras" : "loading-style";
  if (cameraStatus === "loading-cameras" || cameraStatus === "waiting-zoom") return "loading-cameras";
  if (cameraStatus === "ready") return "ready";
  if (cameraStatus === "offline-cached") return "degraded";
  if (cameraStatus === "unavailable" || cameraStatus === "error") return snapshot?.mapReady ? "degraded" : "error";
  return "idle";
}

export function mountMapRoute(context: MapRouteMountContext): MountedView {
  activeView?.unmount();
  migrateCameraMapToMapApp();
  const { root, cleanup, appRuntime, translate } = context;
  const app = root.querySelector<HTMLElement>("[data-map-app]")!;
  const surface = root.querySelector<HTMLElement>("#mapSurface")!;
  const hudMount = root.querySelector<HTMLElement>("#mapDrivingHud")!;
  const presentationButton = root.querySelector<HTMLButtonElement>("#mapPresentation")!;
  const presentationLabel = root.querySelector<HTMLElement>("#mapPresentationLabel")!;
  const presentationMenu = root.querySelector<HTMLElement>("#mapPresentationMenu")!;
  const orientationButton = root.querySelector<HTMLButtonElement>("#mapOrientation")!;
  const refreshButton = root.querySelector<HTMLButtonElement>("#mapRefresh")!;
  const moreButton = root.querySelector<HTMLButtonElement>("#mapMore")!;
  const moreSheet = root.querySelector<HTMLElement>("#mapMoreSheet")!;
  const routeStatus = root.querySelector<HTMLElement>("#mapRouteStatus");
  const routeStatusText = root.querySelector<HTMLElement>("#mapRouteStatusText");
  const retryButton = root.querySelector<HTMLButtonElement>("#mapRetry")!;
  const modeNotice = root.querySelector<HTMLElement>("#mapModeNotice");
  let presentationMode = loadPresentationMode();
  let destroyed = false;

  const widget = createMapRenderer({
    mount: surface,
    routeMode: true,
    restoreVisibility: false,
    persistVisibility: false,
    gpsService: context.gpsService,
    settingsStore: createMapSettingsStore(appRuntime),
    navigationDefaultMode: "auto",
    initialSessionState: mapSessionState,
  });

  function updateStatus() {
    const snapshot = widget.getApproachSnapshot?.() || null;
    const status = getRuntimeStatus(snapshot);
    app.dataset.mapStatus = status;
    const error = status === "error";
    if (routeStatus) routeStatus.hidden = !error;
    if (error && routeStatusText) routeStatusText.textContent = translate("mapUnavailable", "Map unavailable. Camera data may still be available offline.");
    const presentation = (snapshot?.presentation || {}) as Record<string, any>;
    const rasterThreeD = presentation.mode === "3d" && presentation.buildingsAvailable === false;
    const cameraDataDegraded = status === "degraded" && snapshot?.cameraStatus?.status === "unavailable";
    if (modeNotice) modeNotice.hidden = !rasterThreeD && !cameraDataDegraded;
    if (rasterThreeD && modeNotice) {
      modeNotice.textContent = translate("mapBuildingsUnavailable", "3D tilt is active. This map style does not include 3D buildings.");
    } else if (cameraDataDegraded && modeNotice) {
      modeNotice.textContent = translate("mapCameraDataUnavailable", "The map is available, but camera data could not be refreshed.");
    }
    hud.render();
  }

  const hud = createDrivingHud({
    mount: hudMount,
    consumerId: "vatio.map.route",
    recordingSource: "map",
    drivingAlerts: context.drivingAlertService,
    driveRecording: context.driveRecordingService,
    gps: context.gpsService,
    translate,
    getContext: () => {
      const decision = widget.getApproachSnapshot?.()?.decision || null;
      return {
        nearestCameraDistanceM: decision?.distanceM !== null
          && decision?.distanceM !== undefined
          && Number.isFinite(Number(decision.distanceM))
          ? Number(decision.distanceM)
          : null,
        cameraState: decision?.state || null,
      };
    },
    onPosition: (position) => widget.updatePosition?.(position),
    onLocationRequest: () => widget.focusCurrentLocation?.(),
    onRecenter: () => widget.resumeFollow?.() || widget.focusCurrentLocation?.(),
    onOpenAlertSettings: () => {
      if (appRuntime?.shell.openApp("vatio.speedAlerts", { focus: true })) return;
      window.__vatioboardFloatingTools?.openSpeedAlerts?.();
    },
  });

  function setPresentation(mode: MapPresentationMode) {
    presentationMode = mode;
    savePresentationMode(mode);
    app.dataset.mapPresentation = mode;
    presentationLabel.textContent = mode === "globe" ? translate("mapGlobe", "Globe") : mode.toUpperCase();
    widget.setPresentationMode?.(mode);
    for (const option of presentationMenu.querySelectorAll<HTMLElement>("[data-map-presentation-option]")) {
      option.setAttribute("aria-checked", String(option.dataset.mapPresentationOption === mode));
    }
    presentationMenu.hidden = true;
    presentationButton.setAttribute("aria-expanded", "false");
  }

  function setMoreOpen(open: boolean) {
    moreSheet.hidden = !open;
    moreButton.setAttribute("aria-expanded", String(open));
    if (open) moreSheet.querySelector<HTMLElement>("button")?.focus();
    else moreButton.focus();
  }

  cleanup.addEventListener(presentationButton, "click", () => {
    presentationMenu.hidden = !presentationMenu.hidden;
    presentationButton.setAttribute("aria-expanded", String(!presentationMenu.hidden));
  });
  cleanup.addEventListener(presentationMenu, "click", (event) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>("[data-map-presentation-option]");
    const mode = option?.dataset.mapPresentationOption;
    if (mode === "2d" || mode === "3d" || mode === "globe") setPresentation(mode);
  });
  cleanup.addEventListener(orientationButton, "click", () => {
    const mode = widget.cycleOrientationMode?.();
    orientationButton.textContent = mode === "heading-up" ? "HDG" : "N";
  });
  cleanup.addEventListener(refreshButton, "click", () => void widget.refresh?.().then(updateStatus));
  cleanup.addEventListener(moreButton, "click", () => setMoreOpen(true));
  cleanup.addEventListener(root.querySelector("#mapMoreClose"), "click", () => setMoreOpen(false));
  cleanup.addEventListener(root.querySelector("#mapSheetFollow"), "click", () => {
    widget.resumeFollow?.();
    setMoreOpen(false);
  });
  cleanup.addEventListener(root.querySelector("#mapSheetRefresh"), "click", () => {
    void widget.refresh?.().then(updateStatus);
    setMoreOpen(false);
  });
  cleanup.addEventListener(root.querySelector("#mapSheetLayers"), "click", () => {
    surface.querySelector<HTMLButtonElement>(".camera-map-layer-button")?.click();
    setMoreOpen(false);
  });
  cleanup.addEventListener(retryButton, "click", () => void widget.retry?.().then(updateStatus));
  cleanup.addEventListener(document, "pointerdown", (event) => {
    const target = event.target as Node;
    if (!presentationMenu.hidden && !presentationMenu.contains(target) && !presentationButton.contains(target)) {
      presentationMenu.hidden = true;
      presentationButton.setAttribute("aria-expanded", "false");
    }
  }, true);
  cleanup.addEventListener(document, "keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    if (!moreSheet.hidden) setMoreOpen(false);
    else if (!presentationMenu.hidden) {
      presentationMenu.hidden = true;
      presentationButton.setAttribute("aria-expanded", "false");
      presentationButton.focus();
    }
  });

  const unsubscribeStatus = widget.subscribeStatus?.(updateStatus) || (() => {});
  cleanup.add(unsubscribeStatus);
  cleanup.add(appRuntime?.i18n.subscribe(() => {
    appRuntime.i18n.apply(root);
    updateStatus();
  }));
  cleanup.add(() => hud.destroy());
  cleanup.add(() => {
    mapSessionState = widget.getSessionState?.() || mapSessionState;
    widget.destroy();
  });

  appRuntime?.i18n.apply(root);
  setPresentation(presentationMode);
  updateStatus();

  const mountedView: MountedView = {
    unmount() {
      if (destroyed) return;
      destroyed = true;
      cleanup.run();
      if (activeView === mountedView) activeView = null;
    },
  };
  activeView = mountedView;
  return mountedView;
}

let activeView: MountedView | null = null;
let mapSessionState: Record<string, unknown> | null = null;

export function unmountMapRoute() {
  activeView?.unmount();
  activeView = null;
}
