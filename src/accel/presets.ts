import {
  type AccelDistancePartialDefinition,
  type AccelDistanceRunPartial,
  type AccelDistanceUnit,
  type AccelPreset,
  type AccelPresetDefinition,
  type AccelRunPartial,
  type AccelSettings,
  type AccelSpeedPartialDefinition,
  type AccelSpeedRunPartial,
  type AccelSpeedUnit,
  KMH_TO_MS,
  MPH_TO_MS,
  distancePartialDefinitions,
  normalizeDistanceUnit,
  normalizeSpeedUnit,
  presetDefinitions,
  speedPartialDefinitions,
} from "./constants.js";

type AccelPresetSettings = Pick<
  AccelSettings,
  "selectedPresetId" | "speedUnit" | "distanceUnit" | "customStart" | "customEnd"
>;

export interface AccelPresetSignatureLike {
  id: string;
  startSpeedMs?: unknown;
  targetSpeedMs?: unknown;
}

export interface AccelComparisonSignatureLike {
  id?: string | null;
  presetId?: string | null;
  presetSignature?: string | null;
  variantGroup?: string | null;
  startSpeedMs?: unknown;
  targetSpeedMs?: unknown;
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

function getPresetStartSpeedMs(preset: AccelPresetDefinition): number | undefined {
  return preset.type === "speed" ? preset.startSpeedMs : undefined;
}

function getPresetTargetSpeedMs(preset: AccelPresetDefinition): number | undefined {
  return preset.type === "speed" ? preset.targetSpeedMs : undefined;
}

function getPresetDistanceTargetM(preset: AccelPresetDefinition): number | undefined {
  return preset.type === "distance" ? preset.distanceTargetM : undefined;
}

function getPresetSpeedSystem(preset: AccelPresetDefinition): AccelSpeedUnit | undefined {
  return preset.type === "speed" ? preset.speedSystem : undefined;
}

function getPresetDistanceSystem(preset: AccelPresetDefinition): AccelDistanceUnit | undefined {
  return preset.type === "distance" ? preset.distanceSystem : undefined;
}

function getPresetLikeStartSpeedMs(preset: AccelPreset | AccelPresetDefinition): number | null | undefined {
  return "startSpeedMs" in preset ? preset.startSpeedMs : undefined;
}

function getPresetLikeTargetSpeedMs(preset: AccelPreset | AccelPresetDefinition): number | null | undefined {
  return "targetSpeedMs" in preset ? preset.targetSpeedMs : undefined;
}

export function findPresetDefinition(presetId: unknown): AccelPresetDefinition | null {
  for (let index = 0; index < presetDefinitions.length; index += 1) {
    if (presetDefinitions[index].id === presetId) return presetDefinitions[index];
  }
  return null;
}

export function isPresetAvailableForUnits(
  preset: AccelPresetDefinition | AccelPreset | null | undefined,
  speedUnit: unknown,
  distanceUnit: unknown,
): boolean {
  if (!preset) return false;
  if (preset.id === "custom") return true;
  if (preset.type === "speed") return preset.speedSystem === normalizeSpeedUnit(speedUnit);
  if (preset.type === "distance") return preset.distanceSystem === normalizeDistanceUnit(distanceUnit);
  return false;
}

export function getAvailablePresetDefinitions(speedUnit: unknown, distanceUnit: unknown): AccelPresetDefinition[] {
  const normalizedSpeedUnit = normalizeSpeedUnit(speedUnit);
  const normalizedDistanceUnit = normalizeDistanceUnit(distanceUnit);
  const available: AccelPresetDefinition[] = [];

  for (let index = 0; index < presetDefinitions.length; index += 1) {
    const preset = presetDefinitions[index];
    if (isPresetAvailableForUnits(preset, normalizedSpeedUnit, normalizedDistanceUnit)) available.push(preset);
  }

  return available;
}

export function getDefaultSpeedPresetId(speedUnit: unknown): string {
  return normalizeSpeedUnit(speedUnit) === "kmh" ? "0-100-kmh" : "0-60-mph";
}

export function getDefaultDistancePresetId(distanceUnit: unknown): string {
  return normalizeDistanceUnit(distanceUnit) === "m" ? "400-m" : "quarter-mile";
}

export function resolvePresetIdForUnits(presetId: unknown, speedUnit: unknown, distanceUnit: unknown): string {
  if (presetId === "custom") return "custom";

  const preset = findPresetDefinition(presetId);
  if (!preset) return getDefaultSpeedPresetId(speedUnit);
  if (isPresetAvailableForUnits(preset, speedUnit, distanceUnit)) return preset.id;

  for (let index = 0; index < presetDefinitions.length; index += 1) {
    const candidate = presetDefinitions[index];
    if (candidate.variantGroup !== preset.variantGroup) continue;
    if (isPresetAvailableForUnits(candidate, speedUnit, distanceUnit)) return candidate.id;
  }

  if (preset.type === "distance") return getDefaultDistancePresetId(distanceUnit);
  return getDefaultSpeedPresetId(speedUnit);
}

export function copyPreset(preset: AccelPresetDefinition): AccelPreset {
  const startSpeedMs = getPresetStartSpeedMs(preset);
  const targetSpeedMs = getPresetTargetSpeedMs(preset);
  const distanceTargetM = getPresetDistanceTargetM(preset);

  return {
    id: preset.id,
    type: preset.type,
    labelKey: preset.labelKey,
    standingStart: Boolean(preset.standingStart),
    startSpeedMs: isFiniteNumber(startSpeedMs) ? startSpeedMs : 0,
    targetSpeedMs: isFiniteNumber(targetSpeedMs) ? targetSpeedMs : null,
    distanceTargetM: isFiniteNumber(distanceTargetM) ? distanceTargetM : null,
    speedSystem: getPresetSpeedSystem(preset) || null,
    distanceSystem: getPresetDistanceSystem(preset) || null,
    variantGroup: preset.variantGroup || preset.id,
    customStart: null,
    customEnd: null,
    customUnit: null,
  };
}

export function buildCustomPreset(settings: AccelPresetSettings): AccelPreset {
  const start = Math.max(0, Number(settings.customStart) || 0);
  const end = Math.max(0, Number(settings.customEnd) || 0);
  const unit = settings.speedUnit;
  const factor = unit === "kmh" ? KMH_TO_MS : MPH_TO_MS;

  return {
    id: "custom",
    type: "speed",
    labelKey: "accelPresetCustom",
    standingStart: start <= 0,
    startSpeedMs: start * factor,
    targetSpeedMs: end * factor,
    distanceTargetM: null,
    customStart: start,
    customEnd: end,
    customUnit: unit,
  };
}

export function getSelectedPreset(settings: AccelPresetSettings): AccelPreset {
  const selectedPresetId = resolvePresetIdForUnits(
    settings.selectedPresetId,
    settings.speedUnit,
    settings.distanceUnit,
  );

  if (selectedPresetId === "custom") return buildCustomPreset(settings);

  for (let index = 0; index < presetDefinitions.length; index += 1) {
    if (presetDefinitions[index].id === selectedPresetId) return copyPreset(presetDefinitions[index]);
  }

  return copyPreset(findPresetDefinition(getDefaultSpeedPresetId(settings.speedUnit))!);
}

export function shouldIncludeDistancePartials(
  preset: AccelPreset | AccelPresetDefinition | null | undefined,
  speedUnit: unknown,
): boolean {
  if (!preset) return false;
  if (preset.type === "distance") return true;
  if (!preset.standingStart) return false;
  const targetSpeedMs = getPresetLikeTargetSpeedMs(preset);
  if (!isFiniteNumber(targetSpeedMs)) return false;
  return targetSpeedMs >= getLongRunSpeedThreshold(speedUnit);
}

export function getLongRunSpeedThreshold(speedUnit: unknown): number {
  return normalizeSpeedUnit(speedUnit) === "kmh" ? (200 * KMH_TO_MS) : (130 * MPH_TO_MS);
}

export function createDistancePartial(definition: AccelDistancePartialDefinition): AccelDistanceRunPartial {
  return {
    id: definition.id,
    kind: "distance",
    labelKey: definition.labelKey,
    distanceM: definition.distanceM,
    showTrapSpeed: Boolean(definition.showTrapSpeed),
    elapsedMs: null,
    trapSpeedMs: null,
  };
}

export function createSpeedPartial(definition: AccelSpeedPartialDefinition): AccelSpeedRunPartial {
  return {
    id: definition.id,
    kind: "speed",
    labelKey: definition.labelKey,
    startSpeedMs: definition.startSpeedMs,
    targetSpeedMs: definition.targetSpeedMs,
    startCrossPerfMs: null,
    elapsedMs: null,
  };
}

export function buildRunPartials(
  preset: AccelPreset | AccelPresetDefinition,
  settings: Pick<AccelSettings, "speedUnit" | "distanceUnit">,
): AccelRunPartial[] {
  const partials: AccelRunPartial[] = [];
  const speedUnit = normalizeSpeedUnit(settings.speedUnit);
  const distanceUnit = normalizeDistanceUnit(settings.distanceUnit);
  const presetStartSpeedMs = getPresetLikeStartSpeedMs(preset);
  const minimumStartSpeedMs = preset && !preset.standingStart && isFiniteNumber(presetStartSpeedMs) ? presetStartSpeedMs : 0;
  const distanceDefinitions = distancePartialDefinitions[distanceUnit] || [];
  const speedDefinitions = speedPartialDefinitions[speedUnit] || [];

  if (shouldIncludeDistancePartials(preset, speedUnit)) {
    for (let distanceIndex = 0; distanceIndex < distanceDefinitions.length; distanceIndex += 1) {
      const distanceDefinition = distanceDefinitions[distanceIndex];
      if (preset.type === "distance" && isFiniteNumber(preset.distanceTargetM) && distanceDefinition.distanceM > (preset.distanceTargetM + 0.01)) {
        continue;
      }
      partials.push(createDistancePartial(distanceDefinition));
    }
  }

  for (let speedIndex = 0; speedIndex < speedDefinitions.length; speedIndex += 1) {
    const speedDefinition = speedDefinitions[speedIndex];
    if (speedDefinition.startSpeedMs + 0.01 < minimumStartSpeedMs) continue;
    if (preset.type === "speed" && isFiniteNumber(preset.targetSpeedMs) && speedDefinition.targetSpeedMs > (preset.targetSpeedMs + 0.01)) continue;
    partials.push(createSpeedPartial(speedDefinition));
  }

  return partials;
}

export function presetKeyFromId(presetId: unknown): string {
  for (let index = 0; index < presetDefinitions.length; index += 1) {
    if (presetDefinitions[index].id === presetId) return presetDefinitions[index].labelKey;
  }
  return "accelPresetCustom";
}

export function formatSignatureNumber(value: unknown): string {
  if (!isFiniteNumber(value)) return "0";
  return String(Math.round(value * 1000000) / 1000000);
}

export function getCustomPresetSignature(startSpeedMs: unknown, targetSpeedMs: unknown): string {
  return `custom:${formatSignatureNumber(startSpeedMs)}:${formatSignatureNumber(targetSpeedMs)}`;
}

export function getPresetSignature(preset: AccelPresetSignatureLike): string {
  if (preset.id === "custom") {
    return getCustomPresetSignature(preset.startSpeedMs, preset.targetSpeedMs);
  }
  return preset.id;
}

export function buildComparisonSignature(presetLike: AccelComparisonSignatureLike | null | undefined): string {
  if (!presetLike) return "unknown";

  const presetId = presetLike.id || presetLike.presetId || "";
  if (presetId === "custom") {
    return getCustomPresetSignature(presetLike.startSpeedMs, presetLike.targetSpeedMs);
  }

  const definition = findPresetDefinition(presetId);
  if (definition && definition.variantGroup) return definition.variantGroup;

  if (typeof presetLike.variantGroup === "string" && presetLike.variantGroup) return presetLike.variantGroup;
  if (typeof presetLike.presetSignature === "string" && presetLike.presetSignature) return presetLike.presetSignature;
  return presetId || "unknown";
}
