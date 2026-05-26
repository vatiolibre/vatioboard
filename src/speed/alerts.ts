import {
  ALERT_CONFIG,
  type AlertConfig,
  type SpeedUnit,
  UNIT_CONFIG,
} from "./constants.js";

export interface SpeedTrapMeta {
  source?: unknown;
  confidence?: unknown;
  s?: unknown;
  c?: unknown;
  [key: string]: unknown;
}

export interface TrapAlertInput {
  trapLoadPending: boolean;
  trapLoadError: unknown;
  trapAlertEnabled: boolean;
  nearestTrapId: string | number | null | undefined;
  nearestTrapDistanceM: number | null | undefined;
  nearestTrapSpeedKph: number | null | undefined;
  nearestTrapSpeedMeta?: SpeedTrapMeta | null;
  trapAlertDistanceM: number | null | undefined;
}

export interface ActiveTrapAlert {
  id: string | number;
  distanceM: number;
  speedKph: number | null | undefined;
  speedMeta: SpeedTrapMeta | null;
  speedMs: number | null;
}

export interface AlertUiStateInput extends TrapAlertInput {
  unit: SpeedUnit;
  currentSpeedMs: number;
  alertEnabled: boolean;
  alertLimitMs: number | null | undefined;
  convertSpeed: (speedMs: number | null | undefined, unit: SpeedUnit) => number;
  getTrapAlertDistanceLabel: (distanceM: number) => string | null;
  formatTrapSpeed: (speedKph: number) => string | null;
  cameraApproachState?: string | null;
  cameraApproachConfidence?: string | null;
  cameraApproachReason?: string | null;
  cameraApproachDetails?: unknown;
}

export interface AlertUiState {
  source: "trap" | "manual" | null;
  enabled: boolean;
  manualEnabled: boolean;
  trapEnabled: boolean;
  trapActive: boolean;
  trapDistanceM: number | null;
  trapDistanceLabel: string | null;
  trapSpeedKph: number | null;
  trapSpeedMeta: SpeedTrapMeta | null;
  trapSpeedLabel: string | null;
  cameraApproachState: string;
  cameraApproachConfidence: string;
  cameraApproachReason: string;
  cameraApproachDetails: unknown;
  limitMs: number | null;
  over: boolean;
  near: boolean;
  unitLabel: string;
  limitDisplayValue: number;
  deltaDisplayValue: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

export function getAlertConfig(unit: SpeedUnit): AlertConfig {
  return ALERT_CONFIG[unit];
}

export function normalizeAlertDisplayValue(value: number, unit: SpeedUnit): number {
  const { step, min, max } = getAlertConfig(unit);
  const roundedValue = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, roundedValue));
}

export function getAlertLimitDisplayValue(
  alertLimitMs: number | null | undefined,
  unit: SpeedUnit,
  convertSpeed: (speedMs: number | null | undefined, unit: SpeedUnit) => number,
): number {
  return Math.max(0, Math.round(convertSpeed(alertLimitMs, unit)));
}

export function isManualAlertActive(alertEnabled: boolean, alertLimitMs: unknown): boolean {
  return alertEnabled && isFiniteNumber(alertLimitMs) && alertLimitMs > 0;
}

export function isTrapDataReady(trapLoadPending: boolean, trapLoadError: unknown): boolean {
  return !trapLoadPending && !trapLoadError;
}

function getSpeedMetaSource(meta: unknown): string {
  if (!isRecord(meta)) return "";
  const source = String(meta.source ?? "").trim();
  if (source) return source;
  if (meta.s === "road") return "nearest_road:maxspeed";
  if (meta.s === "camera") return "camera:maxspeed";
  return "";
}

function getSpeedMetaConfidence(meta: unknown): string {
  if (!isRecord(meta)) return "";
  return String(meta.confidence ?? meta.c ?? "").trim();
}

function canUseTrapSpeedForOverspeed(meta: unknown): boolean {
  const source = getSpeedMetaSource(meta);
  if (!source.startsWith("nearest_road:")) return true;
  const confidence = getSpeedMetaConfidence(meta);
  return confidence === "high" || confidence === "medium";
}

export function getActiveTrapAlert(input: TrapAlertInput): ActiveTrapAlert | null {
  if (!isTrapDataReady(input.trapLoadPending, input.trapLoadError)) return null;
  if (!input.trapAlertEnabled) return null;
  if (input.nearestTrapId === null || input.nearestTrapId === undefined || input.nearestTrapId === "") return null;
  if (!isFiniteNumber(input.nearestTrapDistanceM) || !isFiniteNumber(input.trapAlertDistanceM)) return null;
  if (input.nearestTrapDistanceM > input.trapAlertDistanceM) return null;

  const speedKph = input.nearestTrapSpeedKph;
  const speedCanOverride = isFiniteNumber(speedKph)
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

export function getAlertUiState(input: AlertUiStateInput): AlertUiState {
  const manualEnabled = isManualAlertActive(input.alertEnabled, input.alertLimitMs);
  const trapAlert = getActiveTrapAlert(input);
  const unitLabel = UNIT_CONFIG[input.unit].label;
  const source = trapAlert?.speedMs
    ? "trap"
    : (manualEnabled ? "manual" : null);
  const limitMs = source === "trap"
    ? trapAlert.speedMs
    : (source === "manual" ? input.alertLimitMs : null);
  const enabled = isFiniteNumber(limitMs) && limitMs > 0;
  const limitDisplayValue = enabled
    ? Math.max(0, Math.round(input.convertSpeed(limitMs as number, input.unit)))
    : getAlertLimitDisplayValue(input.alertLimitMs, input.unit, input.convertSpeed);
  const over = enabled && input.currentSpeedMs > (limitMs as number);
  const deltaDisplayValue = over
    ? Math.max(1, Math.round(input.convertSpeed(input.currentSpeedMs - (limitMs as number), input.unit)))
    : 0;
  const near = enabled && !over && input.currentSpeedMs >= (limitMs as number) * 0.92;
  const trapSpeedKph = trapAlert?.speedKph ?? null;

  return {
    source,
    enabled,
    manualEnabled,
    trapEnabled: input.trapAlertEnabled,
    trapActive: Boolean(trapAlert),
    trapDistanceM: trapAlert?.distanceM ?? null,
    trapDistanceLabel: trapAlert ? input.getTrapAlertDistanceLabel(trapAlert.distanceM) : null,
    trapSpeedKph,
    trapSpeedMeta: trapAlert?.speedMeta ?? null,
    trapSpeedLabel: trapAlert && isFiniteNumber(trapSpeedKph)
      ? input.formatTrapSpeed(trapSpeedKph)
      : null,
    cameraApproachState: input.cameraApproachState || "none",
    cameraApproachConfidence: input.cameraApproachConfidence || "none",
    cameraApproachReason: input.cameraApproachReason || "",
    cameraApproachDetails: input.cameraApproachDetails || null,
    limitMs,
    over,
    near,
    unitLabel,
    limitDisplayValue,
    deltaDisplayValue,
  };
}

export function shouldPlayOverspeedSound(
  alertUiState: Pick<AlertUiState, "over">,
  alertSoundEnabled: boolean,
  audioMuted: boolean,
): boolean {
  return alertUiState.over && alertSoundEnabled && !audioMuted;
}
