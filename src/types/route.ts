import type { DriveRecordingService, DrivingAlertService, GpsService, TtsService } from "./services";
import type { ShellRuntime } from "./shell";
import type {
  ShellAppRuntimeManager,
  VatioAppManifest,
  VatioAppRuntime,
  VatioBackgroundServiceManager,
} from "../app-platform/types";
import type { RecoveryCoordinator } from "../shared/recovery-coordinator";

export type RoutePath = string;
export type AppRouteUrl = string;

export interface ParsedAppRoute {
  path: RoutePath;
  query: URLSearchParams;
  url: AppRouteUrl;
  requestedPath?: string;
}

export interface AppRoute extends ParsedAppRoute {
  config?: RouteConfig;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  replace?: (href: string) => boolean;
}

export interface MountedView {
  unmount(): void;
}

export interface CleanupStack {
  add<T extends (() => void) | undefined | null>(cleanup: T): T;
  addEventListener(
    target: EventTarget | { addListener?(listener: EventListenerOrEventListenerObject): void; removeListener?(listener: EventListenerOrEventListenerObject): void } | null | undefined,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  setTimeout(handler: TimerHandler, timeout?: number, ...args: unknown[]): number;
  setInterval(handler: TimerHandler, timeout?: number, ...args: unknown[]): number;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  abortController(): AbortController;
  addDisposable<T extends object>(object: T, methodName?: keyof T & string): T;
  run(): void;
}

export interface RuntimeContext {
  audioRuntime: unknown;
  driveRecordingService: DriveRecordingService;
  drivingAlertService: DrivingAlertService;
  gpsService: GpsService;
  ttsService?: TtsService;
  recoveryCoordinator?: RecoveryCoordinator;
  shellManager?: ShellRuntime;
  shellAppRuntimeManager?: ShellAppRuntimeManager;
  backgroundServiceManager?: VatioBackgroundServiceManager;
}

export interface RouteContext extends RuntimeContext {
  route: AppRoute;
  routeSignal: AbortSignal;
  navigate: (href: string, options?: { replace?: boolean }) => boolean;
  emitRouteVisible: () => void;
  appManifest?: VatioAppManifest | null;
  appRuntime?: VatioAppRuntime | null;
}

export interface RouteMeta {
  title?: string;
  description?: string;
  keywords?: readonly string[];
  [key: string]: unknown;
}

export interface RouteMountContext {
  root: HTMLElement;
  context: Partial<RouteContext>;
  cleanup: CleanupStack;
  signal?: AbortSignal;
  pageName?: string;
}

export type RouteView = (
  root: HTMLElement,
  context: Partial<RouteContext>,
) => Promise<MountedView> | MountedView;

export interface RouteViewFactoryOptions extends RouteMountContext {
  route?: AppRoute;
}

export interface RouteModule {
  mount: RouteView;
  [key: string]: unknown;
}

export interface RouteConfig {
  path: RoutePath;
  aliases?: readonly string[];
  title: string;
  meta?: RouteMeta;
  load: () => Promise<RouteModule>;
}
