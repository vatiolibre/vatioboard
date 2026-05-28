import "../../styles/energy.less";
import "./energy-app.less";

import {
  createEnergyCalculatorWidget,
  type EnergyCalculatorWidgetApi,
  type EnergyCalculatorWidgetOptions,
  type EnergySettingsStore,
} from "../../energy/energy-calculator-widget.js";
import {
  loadTripCostSettings as loadLegacyTripCostSettings,
  normalizeTripCostSettings,
  saveTripCostSettings as saveLegacyTripCostSettings,
  type TripCostSettings,
} from "../../energy/trip-cost-storage.js";
import {
  loadSettings as loadLegacyNumberFormatSettings,
  normalizeSettings as normalizeNumberFormatSettings,
  saveSettings as saveLegacyNumberFormatSettings,
  type CalculatorSettings,
} from "../../calculator/storage.js";
import type { NumberFormatSettings } from "../../energy/energy-core.js";
import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const ENERGY_APP_ID = "vatio.energy";
export const ENERGY_TRIP_SETTINGS_KEY = "tripCostSettings";
export const ENERGY_NUMBER_FORMAT_SETTINGS_KEY = "numberFormat";

export interface EnergyAppOptions extends EnergyCalculatorWidgetOptions {
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
}

export interface EnergyAppApi extends EnergyCalculatorWidgetApi {
  runtime: VatioAppRuntime | null;
}

export function resolveEnergyRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<EnergyAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === ENERGY_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(ENERGY_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(ENERGY_APP_ID)
    || null;
}

export function createEnergySettingsStore(runtime: VatioAppRuntime | null): EnergySettingsStore {
  function loadRuntimeTripSettings() {
    if (!runtime?.services.settings) return null;
    const stored = runtime.services.settings.getJson<Partial<TripCostSettings> | null>(ENERGY_TRIP_SETTINGS_KEY, null);
    return stored && typeof stored === "object" ? stored : null;
  }

  function loadRuntimeNumberFormatSettings() {
    if (!runtime?.services.settings) return null;
    const stored = runtime.services.settings.getJson<Partial<CalculatorSettings> | null>(
      ENERGY_NUMBER_FORMAT_SETTINGS_KEY,
      null,
    );
    return stored && typeof stored === "object" ? stored : null;
  }

  return {
    loadTripCostSettings() {
      const legacySettings = loadLegacyTripCostSettings();
      const runtimeSettings = loadRuntimeTripSettings();
      return normalizeTripCostSettings(runtimeSettings ? { ...legacySettings, ...runtimeSettings } : legacySettings);
    },
    saveTripCostSettings(settings) {
      const normalized = normalizeTripCostSettings(settings);
      const saved = runtime?.services.settings?.setJson(ENERGY_TRIP_SETTINGS_KEY, normalized) === true;
      if (!saved && runtime) {
        runtime.logger.warn("Energy trip settings could not be saved through runtime settings; preserving legacy fallback.");
      }
      saveLegacyTripCostSettings(normalized);
    },
    loadNumberFormatSettings() {
      const legacySettings = loadLegacyNumberFormatSettings();
      const runtimeSettings = loadRuntimeNumberFormatSettings();
      return { ...normalizeNumberFormatSettings(runtimeSettings ? { ...legacySettings, ...runtimeSettings } : legacySettings) };
    },
    saveNumberFormatSettings(settings: NumberFormatSettings | Partial<NumberFormatSettings>) {
      const normalized = normalizeNumberFormatSettings(settings);
      const saved = runtime?.services.settings?.setJson(ENERGY_NUMBER_FORMAT_SETTINGS_KEY, normalized) === true;
      if (!saved && runtime) {
        runtime.logger.warn("Energy number-format settings could not be saved through runtime settings; preserving legacy fallback.");
      }
      saveLegacyNumberFormatSettings(normalized);
    },
  };
}

export function createEnergyApp(options: EnergyAppOptions = {}): EnergyAppApi {
  const runtime = resolveEnergyRuntime(options);
  const widget = createEnergyCalculatorWidget({
    ...options,
    settingsStore: createEnergySettingsStore(runtime),
    translate: runtime ? (key) => runtime.i18n.t(key) : null,
  });

  runtime?.logger.debug("Energy app module mounted with scoped runtime settings.");

  return {
    ...widget,
    runtime,
  };
}
