import {
  CALCULATOR_SETTINGS_STORAGE_KEY,
  loadSettings as loadLegacyNumberFormatSettings,
  normalizeSettings,
  saveSettings as saveLegacyNumberFormatSettings,
  type CalculatorSettings,
} from "../../calculator/storage.js";
import { hasStoredValue } from "../../shared/storage.js";
import type { VatioAppRuntime } from "../../app-platform/types";

export interface NumberFormatSettingsMirror {
  runtime?: VatioAppRuntime | null;
  settingsKey: string;
  appName: string;
}

function loadRuntimeMirror(mirror?: NumberFormatSettingsMirror | null): Partial<CalculatorSettings> | null {
  if (!mirror?.runtime?.services.settings) return null;
  const stored = mirror.runtime.services.settings.getJson<Partial<CalculatorSettings> | null>(
    mirror.settingsKey,
    null,
  );
  return stored && typeof stored === "object" ? stored : null;
}

function saveRuntimeMirror(settings: CalculatorSettings, mirror?: NumberFormatSettingsMirror | null) {
  if (!mirror?.runtime) return;
  const saved = mirror.runtime.services.settings?.setJson(mirror.settingsKey, settings) === true;
  if (!saved) {
    mirror.runtime.logger.warn(`${mirror.appName} number-format settings could not be mirrored through runtime settings; preserving shared legacy source.`);
  }
}

export function loadSharedNumberFormatSettings(mirror?: NumberFormatSettingsMirror | null): CalculatorSettings {
  if (hasStoredValue(CALCULATOR_SETTINGS_STORAGE_KEY)) {
    return loadLegacyNumberFormatSettings();
  }

  const runtimeSettings = loadRuntimeMirror(mirror);
  if (runtimeSettings) {
    const normalized = normalizeSettings(runtimeSettings);
    saveLegacyNumberFormatSettings(normalized);
    return normalized;
  }

  return loadLegacyNumberFormatSettings();
}

export function saveSharedNumberFormatSettings(
  settings: CalculatorSettings | Partial<CalculatorSettings>,
  mirror?: NumberFormatSettingsMirror | null,
): CalculatorSettings {
  const normalized = normalizeSettings(settings);
  saveLegacyNumberFormatSettings(normalized);
  saveRuntimeMirror(normalized, mirror);
  return normalized;
}
