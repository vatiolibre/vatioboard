import { ALERT_CONFIG, UNIT_CONFIG } from "./constants.js";

export function getAlertConfig(unit) {
  return ALERT_CONFIG[unit];
}

export function normalizeAlertDisplayValue(value, unit) {
  const { step, min, max } = getAlertConfig(unit);
  const roundedValue = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, roundedValue));
}

export function getAlertLimitDisplayValue(alertLimitMs, unit, convertSpeed) {
  return Math.max(0, Math.round(convertSpeed(alertLimitMs, unit)));
}

export function isManualAlertActive(alertEnabled, alertLimitMs) {
  return alertEnabled && Number.isFinite(alertLimitMs) && alertLimitMs > 0;
}

export function isTrapDataReady(trapLoadPending, trapLoadError) {
  return !trapLoadPending && !trapLoadError;
}

function getSpeedMetaSource(meta) {
  if (!meta || typeof meta !== "object") return "";
  const source = String(meta.source ?? "").trim();
  if (source) return source;
  if (meta.s === "road") return "nearest_road:maxspeed";
  if (meta.s === "camera") return "camera:maxspeed";
  return "";
}

function getSpeedMetaConfidence(meta) {
  if (!meta || typeof meta !== "object") return "";
  return String(meta.confidence ?? meta.c ?? "").trim();
}

function canUseTrapSpeedForOverspeed(meta) {
  const source = getSpeedMetaSource(meta);
  if (!source.startsWith("nearest_road:")) return true;
  const confidence = getSpeedMetaConfidence(meta);
  return confidence === "high" || confidence === "medium";
}

export function getActiveTrapAlert(input) {
  if (!isTrapDataReady(input.trapLoadPending, input.trapLoadError)) return null;
  if (!input.trapAlertEnabled) return null;
  if (!Number.isFinite(input.nearestTrapDistanceM) || !Number.isFinite(input.trapAlertDistanceM)) return null;
  if (input.nearestTrapDistanceM > input.trapAlertDistanceM) return null;

  const speedKph = input.nearestTrapSpeedKph;
  const speedCanOverride = Number.isFinite(speedKph)
    && speedKph > 0
    && canUseTrapSpeedForOverspeed(input.nearestTrapSpeedMeta);

  return {
    id: input.nearestTrapId,
    distanceM: input.nearestTrapDistanceM,
    speedKph,
    speedMeta: input.nearestTrapSpeedMeta || null,
    speedMs: speedCanOverride
      ? speedKph / 3.6
      : null,
  };
}

export function getAlertUiState(input) {
  const manualEnabled = isManualAlertActive(input.alertEnabled, input.alertLimitMs);
  const trapAlert = getActiveTrapAlert(input);
  const unitLabel = UNIT_CONFIG[input.unit].label;
  const source = trapAlert?.speedMs
    ? "trap"
    : (manualEnabled ? "manual" : null);
  const limitMs = source === "trap"
    ? trapAlert.speedMs
    : (source === "manual" ? input.alertLimitMs : null);
  const enabled = Number.isFinite(limitMs) && limitMs > 0;
  const limitDisplayValue = enabled
    ? Math.max(0, Math.round(input.convertSpeed(limitMs, input.unit)))
    : getAlertLimitDisplayValue(input.alertLimitMs, input.unit, input.convertSpeed);
  const over = enabled && input.currentSpeedMs > limitMs;
  const deltaDisplayValue = over
    ? Math.max(1, Math.round(input.convertSpeed(input.currentSpeedMs - limitMs, input.unit)))
    : 0;
  const near = enabled && !over && input.currentSpeedMs >= limitMs * 0.92;

  return {
    source,
    enabled,
    manualEnabled,
    trapEnabled: input.trapAlertEnabled,
    trapActive: Boolean(trapAlert),
    trapDistanceM: trapAlert?.distanceM ?? null,
    trapDistanceLabel: trapAlert ? input.getTrapAlertDistanceLabel(trapAlert.distanceM) : null,
    trapSpeedKph: trapAlert?.speedKph ?? null,
    trapSpeedMeta: trapAlert?.speedMeta ?? null,
    trapSpeedLabel: trapAlert && Number.isFinite(trapAlert.speedKph)
      ? input.formatTrapSpeed(trapAlert.speedKph)
      : null,
    limitMs,
    over,
    near,
    unitLabel,
    limitDisplayValue,
    deltaDisplayValue,
  };
}

export function shouldPlayOverspeedSound(alertUiState, alertSoundEnabled, audioMuted) {
  return alertUiState.over && alertSoundEnabled && !audioMuted;
}
