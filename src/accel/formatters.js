import {
  DISTANCE_UNIT_CONFIG,
  SPEED_UNIT_CONFIG,
  normalizeDistanceUnit,
  normalizeSpeedUnit,
} from "./constants.js";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function createAccelFormatters({ t, getLang, getSettings }) {
  function msToSpeedUnit(speedMs, unit) {
    if (!isFiniteNumber(speedMs)) return null;
    return speedMs * SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].factor;
  }

  function speedUnitValueToMs(value, unit) {
    if (!isFiniteNumber(value)) return null;
    return value / SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].factor;
  }

  function getSpeedUnitLabel(unit) {
    return t(SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].labelKey);
  }

  function getDistanceUnitLabel(unit) {
    return DISTANCE_UNIT_CONFIG[normalizeDistanceUnit(unit)].label;
  }

  function convertDistanceMeasurement(valueM, unit) {
    if (!isFiniteNumber(valueM)) return null;
    return valueM * DISTANCE_UNIT_CONFIG[normalizeDistanceUnit(unit)].factor;
  }

  function formatNumber(value, decimals) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  function formatInteger(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(getLang(), { maximumFractionDigits: 0 }).format(value);
  }

  function formatAdaptiveNumber(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    const rounded = Math.round(value);
    const decimals = Math.abs(value - rounded) < 0.05 ? 0 : 1;
    return formatNumber(value, decimals);
  }

  function normalizeCustomSpeedInput(value, fallback) {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
    const normalized = Math.max(0, numeric);
    return Math.round(normalized * 10) / 10;
  }

  function formatInputSpeedValue(value) {
    if (!isFiniteNumber(value)) return "";
    const normalized = normalizeCustomSpeedInput(value, 0);
    if (Math.abs(normalized - Math.round(normalized)) < 0.001) return String(Math.round(normalized));
    return normalized.toFixed(1);
  }

  function convertSpeedInputValue(value, fromUnit, toUnit) {
    if (!isFiniteNumber(value)) return 0;
    if (fromUnit === toUnit) return normalizeCustomSpeedInput(value, 0);
    return normalizeCustomSpeedInput(msToSpeedUnit(speedUnitValueToMs(value, fromUnit), toUnit), 0);
  }

  function formatLiveSpeedNumber(speedMs, unit) {
    if (!isFiniteNumber(speedMs)) return "0";
    return formatNumber(msToSpeedUnit(speedMs, unit), 0);
  }

  function formatSpeedValue(speedMs, unit) {
    if (!isFiniteNumber(speedMs)) return t("accelUnavailable");
    return `${formatNumber(msToSpeedUnit(speedMs, unit), 1)} ${getSpeedUnitLabel(unit)}`;
  }

  function formatRunDistance(distanceM, unit) {
    if (!isFiniteNumber(distanceM)) return t("accelUnavailable");
    const activeSettings = getSettings();
    const normalizedUnit = normalizeDistanceUnit(unit || activeSettings.distanceUnit);
    const converted = convertDistanceMeasurement(distanceM, normalizedUnit);
    const decimals = normalizedUnit === "m" ? 1 : 0;
    return `${formatNumber(converted, decimals)} ${getDistanceUnitLabel(normalizedUnit)}`;
  }

  function getDistanceProgressLabel(currentDistanceM, targetDistanceM) {
    return `${formatRunDistance(currentDistanceM)} / ${formatRunDistance(targetDistanceM)}`;
  }

  function getSpeedProgressLabel(currentSpeedMs, targetSpeedMs, unit, baselineMs) {
    const baseline = isFiniteNumber(baselineMs) ? baselineMs : 0;
    const currentValue = Math.max(baseline, currentSpeedMs || 0);
    return `${formatNumber(msToSpeedUnit(currentValue, unit), 0)} / ${formatNumber(msToSpeedUnit(targetSpeedMs, unit), 0)} ${getSpeedUnitLabel(unit)}`;
  }

  function getTargetProgressLabel(preset, value) {
    const activeSettings = getSettings();
    if (preset.type === "distance") return getDistanceProgressLabel(value, preset.distanceTargetM);
    return getSpeedProgressLabel(0, preset.targetSpeedMs, activeSettings.speedUnit, preset.startSpeedMs);
  }

  function formatHeading(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, 0)}°`;
  }

  function formatDebugCoordinate(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(value);
  }

  function formatDebugCoordinatePair(latitude, longitude) {
    if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return t("accelUnavailable");
    return `${formatDebugCoordinate(latitude)}, ${formatDebugCoordinate(longitude)}`;
  }

  function formatDebugMeters(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, Math.abs(value) >= 100 ? 0 : 1)} m`;
  }

  function formatDebugSpeedMs(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, 2)} m/s`;
  }

  function formatDistanceMeasurement(valueM, unit) {
    if (!isFiniteNumber(valueM)) return t("accelUnavailable");
    const activeSettings = getSettings();
    const normalizedUnit = normalizeDistanceUnit(unit || activeSettings.distanceUnit);
    const converted = convertDistanceMeasurement(valueM, normalizedUnit);
    const decimals = Math.abs(converted) >= 100 ? 0 : 1;
    return `${formatNumber(converted, decimals)} ${getDistanceUnitLabel(normalizedUnit)}`;
  }

  function formatSignedDistanceMeasurement(valueM, unit) {
    if (!isFiniteNumber(valueM)) return t("accelUnavailable");
    const activeSettings = getSettings();
    const normalizedUnit = normalizeDistanceUnit(unit || activeSettings.distanceUnit);
    const converted = convertDistanceMeasurement(Math.abs(valueM), normalizedUnit);
    const decimals = Math.abs(converted) >= 100 ? 0 : 1;
    const sign = Math.abs(valueM) < 0.05 ? "" : (valueM > 0 ? "+" : "-");
    return `${sign}${formatNumber(converted, decimals)} ${getDistanceUnitLabel(normalizedUnit)}`;
  }

  function formatSlopePercent(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    const sign = Math.abs(value) < 0.05 ? "" : (value > 0 ? "+" : "-");
    return `${sign}${formatNumber(Math.abs(value), 1)}%`;
  }

  function formatHz(value) {
    if (!isFiniteNumber(value) || value <= 0) return t("accelUnavailable");
    const decimals = value >= 10 ? 1 : 2;
    return `${formatNumber(value, decimals)} Hz`;
  }

  function formatMs(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return `${formatNumber(value, value >= 100 ? 0 : 1)} ms`;
  }

  function isSameNumber(left, right) {
    if (!isFiniteNumber(left) || !isFiniteNumber(right)) return false;
    return Math.abs(left - right) < 0.0001;
  }

  function formatRunSeconds(durationMs) {
    if (!isFiniteNumber(durationMs)) return "0.000";
    return formatNumber(Math.max(0, durationMs) / 1000, 3);
  }

  function formatTimestamp(timestampMs) {
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

  function formatThresholdOptionLabel(speedMs) {
    const activeSettings = getSettings();
    return `${formatNumber(msToSpeedUnit(speedMs, activeSettings.speedUnit), 1)} ${getSpeedUnitLabel(activeSettings.speedUnit)}`;
  }

  function getPartialLabel(partial) {
    if (!partial) return t("accelUnavailable");
    return t(partial.labelKey);
  }

  function formatPartialValue(partial, speedUnit, runCompleted) {
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

  function escapeHtml(value) {
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
