import "../../styles/player.less";
import "./player-app.less";

import {
  createPlayerWidget,
  type PlayerWidgetApi,
} from "../../player/player-widget.js";
import {
  VISUALIZER_MODE_STORAGE_KEY,
  VISUALIZER_VISIBLE_STORAGE_KEY,
  type PlayerShellSettingsStore,
} from "../../player/player-shell.js";
import { hasStoredValue, loadText, saveText } from "../../shared/storage.js";
import type { AudioRuntime } from "../../types/services";
import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const PLAYER_APP_ID = "vatio.player";
export const PLAYER_VISUALIZER_VISIBLE_SETTING_KEY = "visualizerVisible";
export const PLAYER_VISUALIZER_MODE_SETTING_KEY = "visualizerMode";

const PLAYER_SETTING_KEYS = new Map([
  [VISUALIZER_VISIBLE_STORAGE_KEY, PLAYER_VISUALIZER_VISIBLE_SETTING_KEY],
  [VISUALIZER_MODE_STORAGE_KEY, PLAYER_VISUALIZER_MODE_SETTING_KEY],
]);

export interface PlayerAppOptions extends Record<string, unknown> {
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
  audioRuntime?: AudioRuntime | null;
}

export interface PlayerAppApi extends PlayerWidgetApi {
  runtime: VatioAppRuntime | null;
}

export function resolvePlayerRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<PlayerAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === PLAYER_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(PLAYER_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(PLAYER_APP_ID)
    || null;
}

function createPlayerSettingsStore(runtime: VatioAppRuntime | null): PlayerShellSettingsStore | null {
  if (!runtime?.services.settings) return null;

  return {
    getText(key, fallback) {
      const settingKey = PLAYER_SETTING_KEYS.get(key);
      if (!settingKey) return loadText(key, fallback);

      if (hasStoredValue(key)) {
        const legacyValue = loadText(key, fallback);
        if (runtime.services.settings?.set(settingKey, legacyValue) !== true) {
          runtime.logger.warn("Player setting mirror could not be saved; preserving legacy value.", { key });
        }
        return legacyValue;
      }

      const runtimeValue = runtime.services.settings?.get<string | null>(settingKey, null);
      if (typeof runtimeValue === "string") {
        saveText(key, runtimeValue);
        return runtimeValue;
      }
      return fallback;
    },
    setText(key, value) {
      saveText(key, value);
      const settingKey = PLAYER_SETTING_KEYS.get(key);
      if (!settingKey) return true;
      const saved = runtime.services.settings?.set(settingKey, value) === true;
      if (!saved) {
        runtime.logger.warn("Player setting mirror could not be saved; preserving legacy value.", { key });
      }
      return saved;
    },
  };
}

function primeRuntimeAudioBoundary(runtime: VatioAppRuntime | null, audioRuntime?: AudioRuntime | null) {
  const audioService = runtime?.services.audio || audioRuntime || null;
  if (!audioService) return;
  try {
    audioService.setMediaSessionEnabled?.(true);
  } catch (error) {
    runtime?.logger.warn("Player runtime audio service could not be primed.", error);
  }
}

export function createPlayerApp(options: PlayerAppOptions = {}): PlayerAppApi {
  const runtime = resolvePlayerRuntime(options);
  primeRuntimeAudioBoundary(runtime, options.audioRuntime || null);
  const widget = createPlayerWidget({
    ...options,
    settingsStore: createPlayerSettingsStore(runtime),
  });

  runtime?.logger.debug("Player app module mounted with scoped runtime services.");

  return {
    ...widget,
    runtime,
  };
}

export const createShellWindowApp = createPlayerApp;
