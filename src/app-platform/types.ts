import type { AppRoute } from "../types/route";
import type {
  AudioRuntime,
  DriveRecordingService,
  DrivingAlertService,
  GpsService,
  TtsService,
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
  | "settings.write"
  | "tts.speak";

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
  | "settings"
  | "tts";

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

export interface VatioAppTheme {
  color: string;
  color2?: string;
  foreground?: string;
}

export interface VatioAppManifest {
  id: VatioAppId;
  title: string;
  shortTitle: string;
  description: string;
  kind: VatioAppKind;
  version: string;
  icon: string;
  theme?: VatioAppTheme;
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

export type VatioAppStoragePolicy = "default" | "local-only" | "clear-on-close";

export interface VatioAppControlState {
  appId: VatioAppId;
  enabled: boolean;
  pinned?: boolean;
  hiddenFromStartMenu?: boolean;
  favorite?: boolean;
  lastOpenedAt?: string | null;
  openCount?: number;
  grantedPermissions?: VatioAppPermission[];
  deniedPermissions?: VatioAppPermission[];
  storagePolicy?: VatioAppStoragePolicy;
  updatedAt: string;
}

export interface VatioAppControlService {
  getState(appId: VatioAppId): VatioAppControlState;
  listStates(): VatioAppControlState[];
  isEnabled(appId: VatioAppId): boolean;
  setEnabled(appId: VatioAppId, enabled: boolean): boolean;
  isPinned(appId: VatioAppId): boolean;
  setPinned(appId: VatioAppId, pinned: boolean): boolean;
  isFavorite(appId: VatioAppId): boolean;
  setFavorite(appId: VatioAppId, favorite: boolean): boolean;
  isHiddenFromStartMenu(appId: VatioAppId): boolean;
  setHiddenFromStartMenu(appId: VatioAppId, hidden: boolean): boolean;
  grantPermission(appId: VatioAppId, permission: VatioAppPermission): boolean;
  revokePermission(appId: VatioAppId, permission: VatioAppPermission): boolean;
  hasGrantedPermission(appId: VatioAppId, permission: VatioAppPermission): boolean;
  getEffectivePermissions(appId: VatioAppId): VatioAppPermission[];
  recordLaunch(appId: VatioAppId): void;
  resetAppControlState(appId: VatioAppId): boolean;
  isProtected(appId: VatioAppId): boolean;
  isProtectedPermission(appId: VatioAppId, permission: VatioAppPermission): boolean;
  getProtectedCriticalPermissions(appId: VatioAppId): VatioAppPermission[];
  subscribe?(listener: (state: VatioAppControlState) => void): Unsubscribe;
}

export interface VatioAppStorageUsage {
  appId: VatioAppId;
  keyCount: number;
  bytes: number;
  available: boolean;
}

export interface VatioStorageDriver {
  getItem(key: string): string | null;
  setItem(key: string, value: string): boolean | Promise<boolean>;
  removeItem(key: string): boolean | Promise<boolean>;
  listKeys(prefix: string): string[] | Promise<string[]>;
  estimate(prefix: string): VatioAppStorageUsage | Promise<VatioAppStorageUsage>;
}

export interface VatioAppStorageExport {
  appId: VatioAppId;
  exportedAt: string;
  keys: Record<string, string>;
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

export interface VatioAppLifecycleLogEntry {
  state: VatioAppLifecycleState;
  at: string;
}

export interface VatioAppLifecycleDiagnostics {
  state: VatioAppLifecycleState;
  createdAt: string;
  mountedAt: string | null;
  activatedAt: string | null;
  lastStateChangeAt: string;
  log: VatioAppLifecycleLogEntry[];
}

export interface VatioAppLifecycleRuntime {
  getState(): VatioAppLifecycleState;
  mount(): VatioAppLifecycleState;
  unmount(): VatioAppLifecycleState;
  activate(): VatioAppLifecycleState;
  deactivate(): VatioAppLifecycleState;
  suspend(): VatioAppLifecycleState;
  resume(): VatioAppLifecycleState;
  getDiagnostics(): VatioAppLifecycleDiagnostics;
  getLog(): VatioAppLifecycleLogEntry[];
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

export interface VatioAppSettingsService {
  get<T = unknown>(key: string, fallback?: T): string | T | null;
  set(key: string, value: string): boolean;
  remove(key: string): boolean;
  getJson<T = JsonValue>(key: string, fallback: T): T;
  setJson(key: string, value: unknown): boolean;
  subscribe?(listener: (key: string, value: unknown) => void): Unsubscribe;
}

export type VatioSharedSettingsKey =
  | "speedUnit"
  | "distanceUnit"
  | "tripDistanceUnit"
  | "decimalPrecision"
  | "thousandsSeparator"
  | "language"
  | "uiDensity"
  | "inVehicleMode"
  | "audioMuted"
  | "defaultVolume"
  | "cameraAlertDistanceM";

export interface VatioSharedSettingsSnapshot {
  speedUnit?: "kmh" | "mph";
  distanceUnit?: "m" | "ft";
  tripDistanceUnit?: "km" | "mi";
  decimalPrecision?: number;
  thousandsSeparator?: boolean;
  language?: string;
  uiDensity?: "compact" | "comfortable" | "spacious";
  inVehicleMode?: "unknown" | "parked" | "driving" | "passenger";
  audioMuted?: boolean;
  defaultVolume?: number;
  cameraAlertDistanceM?: number;
  updatedAt?: string;
}

export interface VatioSharedSettingsService {
  getAll(): VatioSharedSettingsSnapshot;
  get<K extends VatioSharedSettingsKey>(key: K): VatioSharedSettingsSnapshot[K] | null;
  set<K extends VatioSharedSettingsKey>(key: K, value: VatioSharedSettingsSnapshot[K]): boolean;
  reset(key?: VatioSharedSettingsKey): boolean;
  subscribe(listener: (settings: VatioSharedSettingsSnapshot) => void): Unsubscribe;
}

export interface VatioAppServices {
  gps: GpsService | null;
  audio: AudioRuntime | null;
  driveRecording: DriveRecordingService | null;
  drivingAlerts: DrivingAlertService | null;
  tts: TtsService | null;
  auth: VatioAuthService | null;
  cloudSync: VatioCloudSyncService | null;
  settings: VatioAppSettingsService | null;
  sharedSettings: VatioSharedSettingsService | null;
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
  openAppAsync?(appId: VatioAppId, options?: VatioAppLaunchOptions): Promise<boolean>;
  closeApp(appId: VatioAppId, options?: VatioAppLaunchOptions): boolean;
  focusApp(appId: VatioAppId, options?: VatioAppLaunchOptions): boolean;
  getAppRuntime?(appId: VatioAppId): VatioAppRuntime | null;
  listApps(): VatioAppManifest[];
  getInstalledApps(): VatioAppManifest[];
  getRunningApps(): VatioRunningApp[];
  shellManager: ShellRuntime | null;
}

export interface VatioShellWindowAppOptions {
  mount?: HTMLElement | null;
  shellManager?: ShellRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  runtime?: VatioAppRuntime | null;
  [key: string]: unknown;
}

export interface VatioShellWindowAppModule {
  createShellWindowApp(options?: VatioShellWindowAppOptions): unknown;
}

export interface VatioBackgroundServiceApp {
  start?(): void | Promise<void>;
  suspend?(): void | Promise<void>;
  resume?(): void | Promise<void>;
  stop?(): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface VatioBackgroundServiceAppModule {
  createBackgroundServiceApp?: (options: {
    runtime: VatioAppRuntime;
    signal?: AbortSignal;
  }) => VatioBackgroundServiceApp | Promise<VatioBackgroundServiceApp>;
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
  launcher?: Pick<VatioAppShellRuntime, "openApp" | "openAppAsync" | "closeApp" | "focusApp" | "getAppRuntime" | "getInstalledApps" | "getRunningApps"> | null;
}

export interface ShellAppRuntimeManager {
  ensureRuntime(appId: VatioAppId): VatioAppRuntime | null;
  getRuntime(appId: VatioAppId): VatioAppRuntime | null;
  getRuntimeForShellWindow(shellWindowId: string): VatioAppRuntime | null;
  listRuntimes(): VatioAppRuntime[];
  setLauncher(launcher: Pick<VatioAppShellRuntime, "openApp" | "openAppAsync" | "closeApp" | "focusApp" | "getAppRuntime" | "getInstalledApps" | "getRunningApps"> | null): void;
  destroy(): void;
}

export interface VatioBackgroundServiceRecord {
  appId: VatioAppId;
  title: string;
  state: VatioAppLifecycleState;
  autostart: boolean;
  runtime: VatioAppRuntime;
}

export interface VatioBackgroundServiceManager {
  start(appId: VatioAppId): boolean;
  startAsync(appId: VatioAppId): Promise<boolean>;
  suspend(appId: VatioAppId): boolean;
  resume(appId: VatioAppId): boolean;
  stop(appId: VatioAppId): boolean;
  stopAsync(appId: VatioAppId): Promise<boolean>;
  startAutostartServices(): VatioBackgroundServiceRecord[];
  getRuntime(appId: VatioAppId): VatioAppRuntime | null;
  listServices(): VatioBackgroundServiceRecord[];
  destroy(): void;
}
