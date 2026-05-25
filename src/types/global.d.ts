type VatioBoardAppRoute = import("./route").AppRoute;
type VatioBoardRuntimeContext = import("./route").RuntimeContext;
type VatioBoardDriveRecordingService = import("./services").DriveRecordingService;
type VatioBoardDrivingAlertService = import("./services").DrivingAlertService;
type VatioBoardGpsService = import("./services").GpsService;
type VatioBoardGpsPosition = import("./services").NormalizedGpsPosition;
type VatioBoardShellRuntime = import("./shell").ShellRuntime;

type VatioBoardRouter = {
  getRoute(): VatioBoardAppRoute | null;
  destroy(): void;
};

type VatioBoardFloatingTools = {
  shellManager?: VatioBoardShellRuntime;
  taskbar?: unknown;
  openCalculator?(): unknown;
  closeCalculator?(): unknown;
  toggleCalculator?(): unknown;
  openEnergy?(): unknown;
  closeEnergy?(): unknown;
  toggleEnergy?(): unknown;
  openCameraMap?(): unknown;
  closeCameraMap?(): unknown;
  toggleCameraMap?(): unknown;
  openSpeedAlerts?(): unknown;
  closeSpeedAlerts?(): unknown;
  toggleSpeedAlerts?(): unknown;
  [key: string]: unknown;
};

type VatioBoardStartMenu = {
  bindTrigger(button: HTMLElement): VatioBoardStartMenu;
  close(): void;
  list: HTMLElement;
  setOpen(isOpen: boolean, trigger?: HTMLElement | null): void;
};

declare module "*.css" {
  const stylesheet: string;
  export default stylesheet;
}

declare module "*.less" {
  const stylesheet: string;
  export default stylesheet;
}

interface Navigator {
  connection?: NetworkInformation;
  mozConnection?: NetworkInformation;
  webkitConnection?: NetworkInformation;
  deviceMemory?: number;
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

interface ImportMeta {
  env?: {
    DEV?: boolean;
    MODE?: string;
    [key: string]: string | boolean | undefined;
  };
}

interface Window {
  __vatioboardActivityState?: unknown;
  __vatioboardCameraMapApproach?: unknown;
  __vatioboardCanLeaveAccel?: () => boolean;
  __vatioboardDriveRecording?: VatioBoardDriveRecordingService;
  __vatioboardDrivingAlerts?: VatioBoardDrivingAlertService;
  __vatioboardFloatingTools?: VatioBoardFloatingTools;
  __vatioboardGpsGetCurrentPosition?: () => VatioBoardGpsPosition | null;
  __vatioboardGpsStore?: VatioBoardGpsService;
  __vatioboardPlayerWidget?: unknown;
  __vatioboardRouter?: VatioBoardRouter;
  __vatioboardRuntimeContext?: Partial<VatioBoardRuntimeContext> | Record<string, unknown>;
  __vatioboardShell?: VatioBoardShellRuntime;
  __vatioboardSpa?: boolean;
  __vatioboardSpeedAlerts?: VatioBoardDrivingAlertService | Record<string, unknown>;
  __vatioboardSpeedGetCurrentPosition?: () => VatioBoardGpsPosition | null;
  __vatioboardSpeedRuntimeLifecycleCleanup?: unknown;
  __vatioboardStartMenu?: VatioBoardStartMenu;
  __lang?: string;
}

interface Geolocation {
  __vatioboardGpsServiceShim?: boolean;
  watchPosition: VatioBoardGpsService["watchPosition"];
  clearWatch: VatioBoardGpsService["clearWatch"];
}
