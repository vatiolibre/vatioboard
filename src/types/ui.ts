import type { ShellRuntime } from "./shell";
import type { DrivingAlertService, GpsService } from "./services";

export type TouchTargetSize = number | "compact" | "comfortable" | "large";

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type UiDensity = "compact" | "comfortable" | "spacious";
export type InVehicleUiMode = "unknown" | "parked" | "driving" | "passenger";

export type VatioToolPlacement = "start-menu" | "floating-tools" | "taskbar" | "launcher";
export type ToolSurface = VatioToolPlacement;

export type VatioToolKind = "route" | "shell-window" | "command";

export interface ToolOpenContext {
  shellManager?: ShellRuntime;
  gpsService?: GpsService | null;
  drivingAlertService?: DrivingAlertService | null;
  navigate?: (href: string, options?: { replace?: boolean }) => boolean;
  event?: Event;
}

export interface VatioToolDefinition {
  id: string;
  kind: VatioToolKind;
  text: string;
  i18nKey?: string;
  icon?: string;
  href?: string;
  path?: string;
  pathAliases?: readonly string[];
  shellWindowId?: string;
  order?: number;
  surfaces: readonly ToolSurface[];
  open?: (context: ToolOpenContext) => void | boolean | Promise<void | boolean>;
}

export interface UiDesignContract {
  minTouchTargetPx: number;
  safeAreaTokens: readonly string[];
  shellClassNames: readonly string[];
}
