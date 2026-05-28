import "../../styles/calculator.less";
import "./calculator-app.less";

import {
  createCalculatorWidget,
  type CalculatorSettingsStore,
  type CalculatorWidgetApi,
  type CalculatorWidgetOptions,
} from "../../calculator/calculator-widget.js";
import {
  loadSettings as loadLegacySettings,
  normalizeSettings,
  saveSettings as saveLegacySettings,
  type CalculatorSettings,
} from "../../calculator/storage.js";
import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const CALCULATOR_APP_ID = "vatio.calculator";
export const CALCULATOR_SETTINGS_KEY = "preferences";

export interface CalculatorAppOptions extends CalculatorWidgetOptions {
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
}

export interface CalculatorAppApi extends CalculatorWidgetApi {
  runtime: VatioAppRuntime | null;
}

export function resolveCalculatorRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<CalculatorAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === CALCULATOR_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(CALCULATOR_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(CALCULATOR_APP_ID)
    || null;
}

export function createCalculatorSettingsStore(runtime: VatioAppRuntime | null): CalculatorSettingsStore {
  function loadRuntimeSettings() {
    if (!runtime?.services.settings) return null;
    const stored = runtime.services.settings.getJson<Partial<CalculatorSettings> | null>(CALCULATOR_SETTINGS_KEY, null);
    return stored && typeof stored === "object" ? stored : null;
  }

  return {
    loadSettings() {
      const legacySettings = loadLegacySettings();
      const runtimeSettings = loadRuntimeSettings();
      return normalizeSettings(runtimeSettings ? { ...legacySettings, ...runtimeSettings } : legacySettings);
    },
    saveSettings(settings) {
      const normalized = normalizeSettings(settings);
      const saved = runtime?.services.settings?.setJson(CALCULATOR_SETTINGS_KEY, normalized) === true;
      if (!saved && runtime) {
        runtime.logger.warn("Calculator settings could not be saved through runtime settings; preserving legacy fallback.");
      }
      saveLegacySettings(normalized);
    },
  };
}

export function createCalculatorApp(options: CalculatorAppOptions = {}): CalculatorAppApi {
  const runtime = resolveCalculatorRuntime(options);
  const widget = createCalculatorWidget({
    ...options,
    settingsStore: createCalculatorSettingsStore(runtime),
    translate: runtime ? (key) => runtime.i18n.t(key) : null,
  });

  runtime?.logger.debug("Calculator app module mounted with scoped runtime settings.");

  return {
    ...widget,
    runtime,
  };
}
