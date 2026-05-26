import {
  type AccelDistanceUnit,
  type AccelPreset,
  type AccelRunPartial,
  type AccelSpeedUnit,
  type AccelSettings,
  DISTANCE_UNIT_CONFIG,
  SPEED_UNIT_CONFIG,
  normalizeDistanceUnit,
  normalizeSpeedUnit,
} from "./constants.js";

type Translator = (key: string, params?: Record<string, unknown>) => string;

interface AccelFormatterSettings extends Partial<AccelSettings> {
  speedUnit: AccelSpeedUnit;
  distanceUnit: AccelDistanceUnit;
}

export interface AccelFormatterDependencies {
  t: Translator;
  getLang: () => string | string[];
  getSettings: () => AccelFormatterSettings;
}

export interface AccelFormatters {
  msToSpeedUnit(speedMs: unknown, unit: unknown): number | null;
  speedUnitValueToMs(value: unknown, unit: unknown): number | null;
  convertSpeedInputValue(value: unknown, fromUnit: unknown, toUnit: unknown): number;
  getSpeedUnitLabel(unit: unknown): string;
  getDistanceUnitLabel(unit: unknown): string;
  convertDistanceMeasurement(valueM: unknown, unit: unknown): number | null;
  formatLiveSpeedNumber(speedMs: unknown, unit: unknown): string;
  formatSpeedValue(speedMs: unknown, unit: unknown): string;
  formatRunDistance(distanceM: unknown, unit?: unknown): string;
  getDistanceProgressLabel(currentDistanceM: unknown, targetDistanceM: unknown): string;
  getSpeedProgressLabel(currentSpeedMs: number | null | undefined, targetSpeedMs: unknown, unit: unknown, baselineMs?: unknown): string;
  getTargetProgressLabel(preset: AccelPreset, value: unknown): string;
  formatHeading(value: unknown): string;
  formatDebugCoordinate(value: unknown): string;
  formatDebugCoordinatePair(latitude: unknown, longitude: unknown): string;
  formatDebugMeters(value: unknown): string;
  formatDebugSpeedMs(value: unknown): string;
  formatDistanceMeasurement(valueM: unknown, unit?: unknown): string;
  formatSignedDistanceMeasurement(valueM: unknown, unit?: unknown): string;
  formatSlopePercent(value: unknown): string;
  formatHz(value: unknown): string;
  formatMs(value: unknown): string;
  formatInteger(value: unknown): string;
  formatNumber(value: unknown, decimals?: number): string;
  formatAdaptiveNumber(value: unknown): string;
  normalizeCustomSpeedInput(value: unknown, fallback: number): number;
  formatInputSpeedValue(value: unknown): string;
  formatThresholdOptionLabel(speedMs: unknown): string;
  isSameNumber(left: unknown, right: unknown): boolean;
  formatRunSeconds(durationMs: unknown): string;
  formatTimestamp(timestampMs: unknown): string;
  getPartialLabel(partial: Pick<AccelRunPartial, "labelKey"> | null | undefined): string;
  formatPartialValue(partial: AccelRunPartial | null | undefined, speedUnit?: unknown, runCompleted?: boolean): string;
  escapeHtml(value: unknown): string;
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

export function createAccelFormatters({ t, getLang, getSettings }: AccelFormatterDependencies): AccelFormatters {
  function msToSpeedUnit(speedMs: unknown, unit: unknown): number | null {
    if (!isFiniteNumber(speedMs)) return null;
    return speedMs * SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].factor;
  }

  function speedUnitValueToMs(value: unknown, unit: unknown): number | null {
    if (!isFiniteNumber(value)) return null;
    return value / SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].factor;
  }

  function getSpeedUnitLabel(unit: unknown): string {
    return t(SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].labelKey);
  }

  function getDistanceUnitLabel(unit: unknown): string {
    return DISTANCE_UNIT_CONFIG[normalizeDistanceUnit(unit)].label;
  }

  function convertDistanceMeasurement(valueM: unknown, unit: unknown): number | null {
    if (!isFiniteNumber(valueM)) return null;
    return valueM * DISTANCE_UNIT_CONFIG[normalizeDistanceUnit(unit)].factor;
  }

  function formatNumber(value: unknown, decimals?: number): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  function formatInteger(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(getLang(), { maximumFractionDigits: 0 }).format(value);
  }

  function formatAdaptiveNumber(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    const rounded = Math.round(value);
    const decimals = Math.abs(value - rounded) < 0.05 ? 0 : 1;
    return formatNumber(value, decimals);
  }

  function normalizeCustomSpeedInput(value: unknown, fallback: number): number {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
    const normalized = Math.max(0, numeric);
    return Math.round(normalized * 10) / 10;
  }

  function formatInputSpeedValue(value: unknown): string {
    if (!isFiniteNumber(value)) return "";
    const normalized = normalizeCustomSpeedInput(value, 0);
    if (Math.abs(normalized - Math.round(normalized)) < 0.001) return String(Math.round(normalized));
    return normalized.toFixed(1);
  }

  function convertSpeedInputValue(value: unknown, fromUnit: unknown, toUnit: unknown): number {
    if (!isFiniteNumber(value)) return 0;
    if (fromUnit === toUnit) return normalizeCustomSpeedInput(value, 0);
    return normalizeCustomSpeedInput(msToSpeedUnit(speedUnitValueToMs(value, fromUnit), toUnit), 0);
  }

  function formatLiveSpeedNumber(speedMs: unknown, unit: unknown): string {
    if (!isFiniteNumber(speedMs)) return "0";
    return formatNumber(msToSpeedUnit(speedMs, unit), 0);
  }

  function formatSpeedValue(speedMs: unknown, unit: unknown): string {
    if (!isFiniteNumber(speedMs)) return t("accelUnavailable");
    return `${formatNumber(msToSpeedUnit(speedMs, unit), 1)} ${getSpeedUnitLabel(unit)}`;
  }

  function formatRunDistance(distanceM: unknown, unit?: unknown): string {
    if (!isFiniteNumber(distanceM)) return t("accelUnavailable");
    const activeSettings = getSettings();
    const normalizedUnit = normalizeDistanceUnit(unit || activeSettings.distanceUnit);
    const converted = convertDistanceMeasurement(distanceM, normalizedUnit);
    const decimals = normalizedUnit === "m" ? 1 : 0;
    return `${formatNumber(converted, decimals)} ${getDistanceUnitLabel(normalizedUnit)}`;
  }

  function getDistanceProgressLabel(currentDistanceM: unknown, targetDistanceM: unknown): string {
    return `${formatRunDistance(currentDistanceM)} / ${formatRunDistance(targetDistanceM)}`;
  }

  function getSpeedProgressLabel(
    currentSpeedMs: number | null | undefined,
    targetSpeedMs: unknown,
    unit: unknown,
    baselineMs?: unknown,
  ): string {
    const baseline = isFiniteNumber(baselineMs) ? baselineMs : 0;
    const currentValue = Math.max(baseline, currentSpeedMs || 0);
    return `${formatNumber(msToSpeedUnit(currentValue, unit), 0)} / ${formatNumber(msToSpeedUnit(targetSpeedMs, unit), 0)} ${getSpeedUnitLabel(unit)}`;
  }

  function getTargetProgressLabel(preset: AccelPreset, value: unknown): string {
    const activeSettings = getSettings();
    if (preset.type === "distance") return getDistanceProgressLabel(value, preset.distanceTargetM);
    return getSpeedProgressLabel(0, preset.targetSpeedMs, activeSettings.speedUnit, preset.startSpeedMs);
  }

  function formatHeading(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, 0)}°`;
  }

  function formatDebugCoordinate(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(value);
  }

  function formatDebugCoordinatePair(latitude: unknown, longitude: unknown): string {
    if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return t("accelUnavailable");
    return `${formatDebugCoordinate(latitude)}, ${formatDebugCoordinate(longitude)}`;
  }

  function formatDebugMeters(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, Math.abs(value) >= 100 ? 0 : 1)} m`;
  }

  function formatDebugSpeedMs(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, 2)} m/s`;
  }

  function formatDistanceMeasurement(valueM: unknown, unit?: unknown): string {
    if (!isFiniteNumber(valueM)) return t("accelUnavailable");
    const activeSettings = getSettings();
    const normalizedUnit = normalizeDistanceUnit(unit || activeSettings.distanceUnit);
    const converted = convertDistanceMeasurement(valueM, normalizedUnit);
    const decimals = Math.abs(converted) >= 100 ? 0 : 1;
    return `${formatNumber(converted, decimals)} ${getDistanceUnitLabel(normalizedUnit)}`;
  }

  function formatSignedDistanceMeasurement(valueM: unknown, unit?: unknown): string {
    if (!isFiniteNumber(valueM)) return t("accelUnavailable");
    const activeSettings = getSettings();
    const normalizedUnit = normalizeDistanceUnit(unit || activeSettings.distanceUnit);
    const converted = convertDistanceMeasurement(Math.abs(valueM), normalizedUnit);
    const decimals = Math.abs(converted) >= 100 ? 0 : 1;
    const sign = Math.abs(valueM) < 0.05 ? "" : (valueM > 0 ? "+" : "-");
    return `${sign}${formatNumber(converted, decimals)} ${getDistanceUnitLabel(normalizedUnit)}`;
  }

  function formatSlopePercent(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    const sign = Math.abs(value) < 0.05 ? "" : (value > 0 ? "+" : "-");
    return `${sign}${formatNumber(Math.abs(value), 1)}%`;
  }

  function formatHz(value: unknown): string {
    if (!isFiniteNumber(value) || value <= 0) return t("accelUnavailable");
    const decimals = value >= 10 ? 1 : 2;
    return `${formatNumber(value, decimals)} Hz`;
  }

  function formatMs(value: unknown): string {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, value >= 100 ? 0 : 1)} ms`;
  }

  function isSameNumber(left: unknown, right: unknown): boolean {
    if (!isFiniteNumber(left) || !isFiniteNumber(right)) return false;
    return Math.abs(left - right) < 0.0001;
  }

  function formatRunSeconds(durationMs: unknown): string {
    if (!isFiniteNumber(durationMs)) return "0.000";
    return formatNumber(Math.max(0, durationMs) / 1000, 3);
  }

  function formatTimestamp(timestampMs: unknown): string {
    if (!isFiniteNumber(timestampMs)) return t("accelUnavailable");
    const date = new Date(timestampMs);
    return new Intl.DateTimeFormat(getLang(), {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  function formatThresholdOptionLabel(speedMs: unknown): string {
    const activeSettings = getSettings();
    return `${formatNumber(msToSpeedUnit(speedMs, activeSettings.speedUnit), 1)} ${getSpeedUnitLabel(activeSettings.speedUnit)}`;
  }

  function getPartialLabel(partial: Pick<AccelRunPartial, "labelKey"> | null | undefined): string {
    if (!partial) return t("accelUnavailable");
    return t(partial.labelKey);
  }

  function formatPartialValue(partial: AccelRunPartial | null | undefined, speedUnit?: unknown, runCompleted?: boolean): string {
    if (!partial) return t("accelUnavailable");
    const activeSettings = getSettings();
    const activeSpeedUnit = speedUnit || activeSettings.speedUnit;
    if (!isFiniteNumber(partial.elapsedMs)) {
      return runCompleted ? t("accelPartialNotCaptured") : t("accelPartialWaiting");
    }

    const elapsedText = `${formatRunSeconds(partial.elapsedMs)} s`;
    if (!partial.showTrapSpeed || !isFiniteNumber(partial.trapSpeedMs)) return elapsedText;
    return `${elapsedText} @ ${formatSpeedValue(partial.trapSpeedMs, activeSpeedUnit)}`;
  }

  function escapeHtml(value: unknown): string {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return {
    msToSpeedUnit,
    speedUnitValueToMs,
    convertSpeedInputValue,
    getSpeedUnitLabel,
    getDistanceUnitLabel,
    convertDistanceMeasurement,
    formatLiveSpeedNumber,
    formatSpeedValue,
    formatRunDistance,
    getDistanceProgressLabel,
    getSpeedProgressLabel,
    getTargetProgressLabel,
    formatHeading,
    formatDebugCoordinate,
    formatDebugCoordinatePair,
    formatDebugMeters,
    formatDebugSpeedMs,
    formatDistanceMeasurement,
    formatSignedDistanceMeasurement,
    formatSlopePercent,
    formatHz,
    formatMs,
    formatInteger,
    formatNumber,
    formatAdaptiveNumber,
    normalizeCustomSpeedInput,
    formatInputSpeedValue,
    formatThresholdOptionLabel,
    isSameNumber,
    formatRunSeconds,
    formatTimestamp,
    getPartialLabel,
    formatPartialValue,
    escapeHtml,
  };
}
