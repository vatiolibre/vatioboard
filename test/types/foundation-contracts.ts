import type {
  AppRoute,
  AppRouteUrl,
  CleanupStack,
  MountedView,
  ParsedAppRoute,
  RouteConfig,
  RouteContext,
  RouteMeta,
  RouteModule,
  RoutePath,
  RouteView,
  RouteViewFactoryOptions,
} from "../../src/types/route";
import type {
  ShellBounds,
  ShellLayoutPreset,
  ShellLayoutSnapshot,
  ShellRuntime,
  ShellSize,
  ShellSnapZone,
  ShellWindowCapabilities,
  ShellWindowDefinition,
  ShellWindowManagerOptions,
  ShellWindowRecord,
  ShellWindowState,
} from "../../src/types/shell";
import type {
  AudioRuntime,
  DrivingAlertService,
  DrivingAlertSnapshot,
  GpsCoordinates,
  GpsPermissionState,
  GpsPositionSnapshot,
  GpsService,
  Subscription,
  Unsubscribe,
} from "../../src/types/services";
import type {
  InVehicleUiMode,
  SafeAreaInsets,
  ToolOpenContext,
  TouchTargetSize,
  UiDensity,
  VatioToolDefinition,
  VatioToolPlacement,
} from "../../src/types/ui";
import type {
  JsonObject,
  JsonValue,
  PersistedRecord,
  RepositoryResult,
  StorageLike,
} from "../../src/types/storage";

type RouteFoundation =
  | RoutePath
  | AppRouteUrl
  | ParsedAppRoute
  | AppRoute
  | RouteConfig
  | RouteModule
  | MountedView
  | CleanupStack
  | RouteContext
  | RouteView
  | RouteMeta
  | RouteViewFactoryOptions;

type ShellFoundation =
  | ShellBounds
  | ShellSize
  | ShellSnapZone
  | ShellWindowState
  | ShellWindowCapabilities
  | ShellWindowDefinition
  | ShellWindowRecord
  | ShellRuntime
  | ShellLayoutSnapshot
  | ShellLayoutPreset
  | ShellWindowManagerOptions;

type ServiceFoundation =
  | GpsCoordinates
  | GpsPositionSnapshot
  | GpsPermissionState
  | GpsService
  | DrivingAlertSnapshot
  | DrivingAlertService
  | AudioRuntime
  | Subscription
  | Unsubscribe;

type UiFoundation =
  | TouchTargetSize
  | SafeAreaInsets
  | UiDensity
  | InVehicleUiMode
  | VatioToolPlacement
  | VatioToolDefinition
  | ToolOpenContext;

type StorageFoundation =
  | StorageLike
  | PersistedRecord
  | RepositoryResult
  | JsonValue
  | JsonObject;

type WindowGlobalFoundation = Pick<
  Window,
  | "__vatioboardCanLeaveAccel"
  | "__vatioboardFloatingTools"
  | "__vatioboardShell"
  | "__vatioboardSpeedAlerts"
  | "__vatioboardRuntimeContext"
  | "__lang"
>;

export type TypeFoundationSmoke =
  | RouteFoundation
  | ShellFoundation
  | ServiceFoundation
  | UiFoundation
  | StorageFoundation
  | WindowGlobalFoundation;
