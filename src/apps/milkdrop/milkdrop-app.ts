import "../../styles/player.less";
import "./milkdrop-app.less";

import {
  createMilkdropPanel,
  type MilkdropPanelApi,
  type MilkdropPanelOptions,
} from "../../player/milkdrop-panel.js";
import {
  MILKDROP_PANEL_VISIBILITY_KEY,
  loadMilkdropPanelVisibility,
  saveMilkdropPanelVisibility,
} from "../../player/milkdrop-panel-prefs.js";
import { hasStoredValue } from "../../shared/storage.js";
import type { AudioRuntime } from "../../types/services";
import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const MILKDROP_APP_ID = "vatio.milkdrop";
export const MILKDROP_VISIBILITY_SETTING_KEY = "visible";

export interface MilkdropAppOptions extends MilkdropPanelOptions {
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
  audioRuntime?: AudioRuntime | null;
}

export interface MilkdropAppApi extends MilkdropPanelApi {
  runtime: VatioAppRuntime | null;
}

export function resolveMilkdropRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<MilkdropAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === MILKDROP_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(MILKDROP_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(MILKDROP_APP_ID)
    || null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function seedLegacyVisibility(runtime: VatioAppRuntime | null) {
  if (!runtime?.services.settings) return;

  if (hasStoredValue(MILKDROP_PANEL_VISIBILITY_KEY)) {
    const legacyVisible = loadMilkdropPanelVisibility();
    const mirrored = runtime.services.settings.set(MILKDROP_VISIBILITY_SETTING_KEY, legacyVisible ? "true" : "false");
    if (!mirrored) {
      runtime.logger.warn("Milkdrop visibility mirror could not be saved; preserving legacy visibility.");
    }
    return;
  }

  const runtimeVisible = normalizeBoolean(
    runtime.services.settings.get<string | null>(MILKDROP_VISIBILITY_SETTING_KEY, null),
  );
  if (runtimeVisible !== null) saveMilkdropPanelVisibility(runtimeVisible);
}

function mirrorVisibility(runtime: VatioAppRuntime | null, visible: boolean) {
  if (!runtime) return;
  const mirrored = runtime.services.settings?.set(MILKDROP_VISIBILITY_SETTING_KEY, visible ? "true" : "false") === true;
  if (!mirrored) {
    runtime.logger.warn("Milkdrop visibility could not be saved through runtime settings; preserving legacy fallback.");
  }
}

function acknowledgeRuntimeAudioBoundary(runtime: VatioAppRuntime | null, audioRuntime?: AudioRuntime | null) {
  const audioService = runtime?.services.audio || audioRuntime || null;
  if (!audioService) return;

  try {
    audioService.getState?.();
  } catch (error) {
    runtime?.logger.warn("Milkdrop runtime audio service could not be inspected.", error);
  }
}

export function createMilkdropApp(options: MilkdropAppOptions = {}): MilkdropAppApi {
  const runtime = resolveMilkdropRuntime(options);
  seedLegacyVisibility(runtime);
  acknowledgeRuntimeAudioBoundary(runtime, options.audioRuntime || null);

  const onOpen = options.onOpen || null;
  const onClose = options.onClose || null;
  const panel = createMilkdropPanel({
    ...options,
    onOpen() {
      mirrorVisibility(runtime, true);
      onOpen?.();
    },
    onClose() {
      mirrorVisibility(runtime, false);
      onClose?.();
    },
    translate: runtime ? (key) => runtime.i18n.t(key) : options.translate,
  });

  runtime?.logger.debug("Milkdrop app module mounted with scoped runtime audio and visibility settings.");

  return {
    ...panel,
    runtime,
  };
}

export const createShellWindowApp = createMilkdropApp;
