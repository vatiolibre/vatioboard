import replayTemplate from "../../app/views/templates/replay-template.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const REPLAY_APP_ID = "vatio.replay";

interface ReplayRouteModule {
  mountReplayRoute?: (routeContext: RouteMountContext) => Promise<MountedView | void> | MountedView | void;
  unmountReplayRoute?: (routeContext: RouteMountContext) => void;
}

export type ReplayRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  settingsService?: VatioAppRuntime["services"]["settings"] | null;
  authService?: VatioAppRuntime["services"]["auth"] | null;
  cloudSyncService?: VatioAppRuntime["services"]["cloudSync"] | null;
  driveRecordingService?: VatioAppRuntime["services"]["driveRecording"] | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

function asReplayRouteModule(module: unknown): ReplayRouteModule {
  return module as ReplayRouteModule;
}

function resolveReplayRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === REPLAY_APP_ID ? runtime : null;
}

export function createReplayRouteMountContext(routeContext: RouteMountContext): ReplayRouteMountContext {
  const runtime = resolveReplayRuntime(routeContext);
  const context = routeContext.context || {};

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    appStorage: runtime?.storage || null,
    settingsService: runtime?.services.settings || null,
    authService: runtime?.services.auth || null,
    cloudSyncService: runtime?.services.cloudSync || null,
    driveRecordingService: runtime?.services.driveRecording || null,
    translate: runtime ? (key, fallback) => runtime.i18n.t(key, fallback) : null,
    logger: runtime?.logger || null,
  };
}

const view = createRouteView({
  pageName: "replay",
  template: replayTemplate,
  meta: {
    title: "Vatio Drive Replay - Replay your latest GPS drive on a 3D globe",
    description:
      "Replay your latest Vatio Speed drive with a hardware-accelerated 3D globe, route timeline, live playback metrics, and session highlights.",
    canonicalPath: "/replay",
    bodyClass: "replay-page",
    cleanupBodyClasses: ["replay-graph-sheet-open"],
  },
  loadModule: () => import("../../replay/replay.js"),
  mountController: (module, routeContext) => {
    const replayRouteContext = createReplayRouteMountContext(routeContext);
    replayRouteContext.appRuntime?.logger.debug("Replay route app mounted with scoped runtime services.");
    return asReplayRouteModule(module).mountReplayRoute?.(replayRouteContext);
  },
  unmountController: (module, routeContext) =>
    asReplayRouteModule(module).unmountReplayRoute?.(createReplayRouteMountContext(routeContext)),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
