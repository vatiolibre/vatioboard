export type ShellWindowState = "closed" | "open" | "minimized" | "hidden" | "fullscreen";

export type ShellSnapZone =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface ShellBounds {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

export type ShellViewportProfile = "standard" | "short-landscape" | "portrait";

export interface ShellLayoutMetrics {
  viewport: ShellBounds & { width: number; height: number };
  workArea: ShellBounds & { width: number; height: number };
  safeArea: { top: number; right: number; bottom: number; left: number };
  reserved: { top: number; right: number; bottom: number; left: number };
  orientation: "landscape" | "portrait";
  profile: ShellViewportProfile;
  devicePixelRatio: number;
}

export interface ShellAdaptiveWindowLayout extends Partial<ShellBounds> {
  mode?: string;
  minWidth?: number | null;
  minHeight?: number | null;
  maxWidth?: number | null;
  maxHeight?: number | null;
}

export type ShellAdaptiveLayoutResolver = (
  metrics: ShellLayoutMetrics,
  record: ShellWindowRecord,
) => ShellAdaptiveWindowLayout | null | undefined;

export interface ShellSize {
  width: number;
  height: number;
}

export interface ShellSnap {
  zone: ShellSnapZone;
  ratio?: number;
}

export interface ShellWindowCapabilities {
  draggable?: boolean;
  resizable?: boolean;
  minimizable?: boolean;
  closable?: boolean;
  restorable?: boolean;
  maximizable?: boolean;
  snap?: boolean;
  snapZones?: readonly ShellSnapZone[] | null;
  preserveIntrinsicWidth?: boolean;
  minWidth?: number | null;
  minHeight?: number | null;
  maxWidth?: number | null;
  maxHeight?: number | null;
  pinnable?: boolean;
  fullscreen?: boolean;
}

export interface ShellLifecycleOptions {
  persist?: boolean;
  flush?: boolean;
  invokeLifecycle?: boolean;
  fromUserGesture?: boolean;
  [key: string]: unknown;
}

export interface ShellWindowLifecycle {
  open?(options?: ShellLifecycleOptions): void | Promise<void>;
  close?(options?: ShellLifecycleOptions): void | Promise<void>;
  minimize?(options?: ShellLifecycleOptions): void | Promise<void>;
  restore?(options?: ShellLifecycleOptions): void | Promise<void>;
  destroy?(options?: ShellLifecycleOptions): void | Promise<void>;
}

export interface ShellWindowDefinition {
  id: string;
  kind?: string;
  title: string;
  storageKey?: string | null;
  restoreOnBoot?: boolean;
  lazy?: boolean;
  defaultBounds?: ShellBounds;
  bounds?: ShellBounds;
  restoreBounds?: ShellBounds;
  capabilities?: ShellWindowCapabilities;
}

export interface ShellWindowRecord extends ShellWindowDefinition {
  element: HTMLElement;
  launcherElement?: HTMLElement | null;
  state: ShellWindowState;
  previousState?: ShellWindowState;
  bounds?: ShellBounds | null;
  restoreBounds?: ShellBounds | null;
  fullscreenRestoreBounds?: ShellBounds | null;
  fullscreenRestoreSnap?: ShellSnap | null;
  zIndex: number;
  active: boolean;
  minimized: boolean;
  snap?: ShellSnap | null;
  capabilities: ShellWindowCapabilities;
  lifecycle?: ShellWindowLifecycle;
  resolveLayout?: ShellAdaptiveLayoutResolver;
  version?: number;
}

export interface ShellLayoutSnapshot {
  version: number;
  activeWindowId: string | null;
  windows: Record<string, {
    state: ShellWindowState;
    previousState?: ShellWindowState;
    bounds?: ShellBounds | null;
    restoreBounds?: ShellBounds | null;
    zIndex?: number;
    minimized?: boolean;
    snap?: ShellSnap | null;
    updatedAt?: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface ShellLayoutPreset {
  id?: string;
  name: string;
  createdAt?: number;
  updatedAt?: number;
  layout: ShellLayoutSnapshot;
  [key: string]: unknown;
}

export interface ShellWindowRegistration extends Partial<ShellWindowDefinition> {
  id: string;
  element: HTMLElement;
  launcherElement?: HTMLElement | null;
  state?: ShellWindowState;
  previousState?: ShellWindowState;
  fullscreenRestoreBounds?: ShellBounds | null;
  fullscreenRestoreSnap?: ShellSnap | null;
  zIndex?: number;
  minimized?: boolean;
  snap?: ShellSnap | null;
  capabilities?: ShellWindowCapabilities;
  lifecycle?: ShellWindowLifecycle;
  resolveLayout?: ShellAdaptiveLayoutResolver;
  persist?: boolean;
  flush?: boolean;
}

export type ShellWindowEventName =
  | "registered"
  | "updated"
  | "unregistered"
  | "activated"
  | "opened"
  | "closed"
  | "minimized"
  | "restored"
  | "layout-changed"
  | "snapped"
  | "unsnapped"
  | "fullscreen"
  | "fullscreen-exited";

export interface ShellWindowSubscriptionEvent {
  event: ShellWindowEventName;
  record: ShellWindowRecord | null;
  manager: ShellRuntime;
}

export interface ShellPreferences {
  taskbarPosition: "bottom" | "left" | "right";
  windowDensity: "comfortable" | "compact";
  snapEnabled: boolean;
  restoreOnBoot: boolean;
  reduceMotion: "system" | boolean;
}

export interface ShellRuntime {
  registerWindow(config: ShellWindowRegistration): ShellWindowRecord | null;
  unregisterWindow(id: string): ShellWindowRecord | null;
  getWindow(id: string): ShellWindowRecord | null;
  getWindowIdForElement(element: Element): string | null;
  listWindows(): ShellWindowRecord[];
  getActiveWindow(): ShellWindowRecord | null;
  activateWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  openWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  closeWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  minimizeWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  restoreWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  toggleWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  updateWindowBounds(id: string, bounds: ShellBounds, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  resetWindowGeometry(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  snapWindow(id: string, zone: ShellSnapZone, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  unsnapWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  canSnapWindow(id: string, zone: ShellSnapZone): boolean;
  fullscreenWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  exitFullscreenWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  toggleFullscreenWindow(id: string, options?: ShellLifecycleOptions): ShellWindowRecord | null;
  restoreShellLayout(options?: ShellLifecycleOptions): ShellWindowRecord[];
  reflowWindowsToWorkArea(options?: ShellLifecycleOptions & { metrics?: ShellLayoutMetrics }): ShellWindowRecord[];
  persistShellLayout(options?: ShellLifecycleOptions): boolean;
  subscribe(listener: (event: ShellWindowSubscriptionEvent) => void): () => void;
  setShellPreference<K extends keyof ShellPreferences>(key: K, value: ShellPreferences[K]): ShellPreferences[K];
  getShellPreference(): ShellPreferences;
  getShellPreference<K extends keyof ShellPreferences>(key: K): ShellPreferences[K];
  subscribeShellPreferences(listener: (preferences: ShellPreferences) => void): () => void;
  destroy(): void;
  readonly root: Document | Element;
}

export interface ShellWindowManagerOptions {
  root?: Document | Element;
  storage?: Storage | null;
  preferenceStorage?: Storage | null;
  eventTarget?: EventTarget;
  store?: {
    read(): ShellLayoutSnapshot;
    write(layout: ShellLayoutSnapshot, options?: Record<string, unknown>): boolean | void;
  };
  storeOptions?: Record<string, unknown>;
  [key: string]: unknown;
}
