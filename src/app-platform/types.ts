import type { AppRoute } from "../types/route";
import type {
  AudioRuntime,
  DriveRecordingService,
  DrivingAlertService,
  GpsService,
  Unsubscribe,
} from "../types/services";
import type {
  ShellBounds,
  ShellRuntime,
  ShellWindowCapabilities,
} from "../types/shell";
import type { JsonValue } from "../types/storage";

export type VatioAppId = string;

export type VatioAppKind =
  | "core-app"
  | "tool-app"
  | "media-app"
  | "visualizer-app"
  | "background-service"
  | "system-app";

export type VatioAppSurface =
  | "main-route"
  | "shell-window"
  | "start-menu"
  | "taskbar"
  | "launcher"
  | "background"
  | "app-manager";

export type VatioAppPermission =
  | "gps.read"
  | "gps.highAccuracy"
  | "storage.app"
  | "storage.media"
  | "audio.playback"
  | "audio.background"
  | "cloud.sync"
  | "auth.session"
  | "alerts.speed"
  | "driveRecording.read"
  | "driveRecording.write"
  | "shell.window"
  | "shell.launchApp"
  | "network.backend"
  | "i18n.read"
  | "settings.read"
  | "settings.write";

export type VatioAppStatus = "stable" | "beta" | "experimental" | "internal";

export type VatioAppWindowMode = "floating" | "fullscreen" | "panel";

export type VatioAppServiceId =
  | "gps"
  | "audio"
  | "driveRecording"
  | "drivingAlerts"
  | "auth"
  | "cloudSync"
  | "shell"
  | "storage"
  | "i18n"
  | "settings";

export interface VatioAppWindowManifest {
  shellWindowId: string;
  mode: VatioAppWindowMode;
  defaultBounds: ShellBounds;
  capabilities: ShellWindowCapabilities;
  restoreOnBoot: boolean;
  lazy: boolean;
}

export interface VatioAppLifecycleManifest {
  autostart?: boolean;
  keepAlive?: boolean;
  restoreOnBoot?: boolean;
}

export interface VatioAppMetadata {
  [key: string]: unknown;
}

export type VatioAppEntryLoader = () => Promise<unknown>;

export interface VatioAppManifest {
  id: VatioAppId;
  title: string;
  shortTitle: string;
  description: string;
  kind: VatioAppKind;
  version: string;
  icon: string;
  i18nKey: string;
  route?: string;
  aliases?: readonly string[];
  entry?: VatioAppEntryLoader;
  surfaces: readonly VatioAppSurface[];
  order: number;
  permissions: readonly VatioAppPermission[];
  services: readonly VatioAppServiceId[];
  window?: VatioAppWindowManifest;
  lifecycle?: VatioAppLifecycleManifest;
  tags?: readonly string[];
  localFirst: boolean;
  teslaOptimized: boolean;
  offlineCapable: boolean;
  status: VatioAppStatus;
  metadata: VatioAppMetadata;
}

export interface VatioAppManifestValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface VatioAppRegistry {
  registerApp(manifest: VatioAppManifest): boolean;
  registerApps(manifests: readonly VatioAppManifest[]): VatioAppManifest[];
  getApp(id: VatioAppId): VatioAppManifest | null;
  listApps(): VatioAppManifest[];
  listAppsForSurface(surface: VatioAppSurface): VatioAppManifest[];
  getAppByRoute(path: string): VatioAppManifest | null;
  getAppsForPermission(permission: VatioAppPermission): VatioAppManifest[];
  validateAppManifest(manifest: VatioAppManifest): VatioAppManifestValidationResult;
}

export interface VatioAppPermissionRuntime {
  has(permission: VatioAppPermission): boolean;
  require(permission: VatioAppPermission): boolean;
  list(): VatioAppPermission[];
}

export interface VatioAppStorageUsage {
  appId: VatioAppId;
  keyCount: number;
  bytes: number;
  available: boolean;
}

export interface VatioAppStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): boolean;
  removeItem(key: string): boolean;
  getJson<T = JsonValue>(key: string, fallback: T): T;
  setJson(key: string, value: unknown): boolean;
  listKeys(): string[];
  clearAppStorage(): boolean;
  estimateUsage(): VatioAppStorageUsage;
}

export interface VatioAppI18n {
  getLanguage(): string;
  t(key: string, fallback?: string): string;
  apply(root?: ParentNode | null): void;
  subscribe(listener: (language: string) => void): Unsubscribe;
  toggleLanguage?(): string;
}

export type VatioAppLifecycleState =
  | "registered"
  | "mounting"
  | "mounted"
  | "active"
  | "inactive"
  | "suspended"
  | "unmounted";

export interface VatioAppLifecycleRuntime {
  getState(): VatioAppLifecycleState;
  mount(): VatioAppLifecycleState;
  unmount(): VatioAppLifecycleState;
  activate(): VatioAppLifecycleState;
  deactivate(): VatioAppLifecycleState;
  suspend(): VatioAppLifecycleState;
  resume(): VatioAppLifecycleState;
  subscribe(listener: (state: VatioAppLifecycleState) => void): Unsubscribe;
}

export interface VatioAppLogger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export interface VatioAuthService {
  getSessionState(options?: Record<string, unknown>): Promise<unknown>;
  getFeatureAccessState(options?: Record<string, unknown>): Promise<unknown>;
}

export interface VatioCloudSyncService {
  getStatus(): unknown;
  request(options?: Record<string, unknown>): unknown;
}

export interface VatioAppServices {
  gps: GpsService | null;
  audio: AudioRuntime | null;
  driveRecording: DriveRecordingService | null;
  drivingAlerts: DrivingAlertService | null;
  auth: VatioAuthService | null;
  cloudSync: VatioCloudSyncService | null;
}

export interface VatioAppLaunchOptions {
  replace?: boolean;
  focus?: boolean;
  sourceAppId?: VatioAppId;
  [key: string]: unknown;
}

export interface VatioRunningApp {
  appId: VatioAppId;
  title: string;
  surface: "route" | "shell-window" | "background";
  state: string;
}

export interface VatioAppShellRuntime {
  openApp(appId: VatioAppId, options?: VatioAppLaunchOptions): boolean;
  closeApp(appId: VatioAppId, options?: VatioAppLaunchOptions): boolean;
  focusApp(appId: VatioAppId, options?: VatioAppLaunchOptions): boolean;
  listApps(): VatioAppManifest[];
  getInstalledApps(): VatioAppManifest[];
  getRunningApps(): VatioRunningApp[];
  shellManager: ShellRuntime | null;
}

export interface VatioAppRuntime {
  appId: VatioAppId;
  manifest: VatioAppManifest;
  permissions: VatioAppPermissionRuntime;
  services: VatioAppServices;
  shell: VatioAppShellRuntime;
  storage: VatioAppStorage;
  i18n: VatioAppI18n;
  lifecycle: VatioAppLifecycleRuntime;
  logger: VatioAppLogger;
  route?: AppRoute | null;
  routeSignal?: AbortSignal | null;
}

export interface VatioAppModule {
  mount(root: HTMLElement, runtime: VatioAppRuntime): Promise<void> | void;
  unmount?(): Promise<void> | void;
  activate?(): Promise<void> | void;
  deactivate?(): Promise<void> | void;
  suspend?(): Promise<void> | void;
  resume?(): Promise<void> | void;
}

export interface CreateAppRuntimeOptions {
  manifest: VatioAppManifest;
  shellManager?: ShellRuntime | null;
  baseContext?: Record<string, unknown> | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  route?: AppRoute | null;
  routeSignal?: AbortSignal | null;
  launcher?: Pick<VatioAppShellRuntime, "openApp" | "closeApp" | "focusApp" | "getInstalledApps" | "getRunningApps"> | null;
}
