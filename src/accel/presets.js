import {
  DISTANCE_UNIT_CONFIG,
  EIGHTH_MILE_M,
  FT_TO_M,
  KMH_TO_MS,
  MPH_TO_MS,
  QUARTER_MILE_M,
  distancePartialDefinitions,
  normalizeDistanceUnit,
  normalizeSpeedUnit,
  presetDefinitions,
  speedPartialDefinitions,
} from "./constants.js";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function findPresetDefinition(presetId) {
  for (let index = 0; index < presetDefinitions.length; index += 1) {
    if (presetDefinitions[index].id === presetId) return presetDefinitions[index];
  }
  return null;
}

export function isPresetAvailableForUnits(preset, speedUnit, distanceUnit) {
  if (!preset) return false;
  if (preset.id === "custom") return true;
  if (preset.type === "speed") return preset.speedSystem === normalizeSpeedUnit(speedUnit);
  if (preset.type === "distance") return preset.distanceSystem === normalizeDistanceUnit(distanceUnit);
  return false;
}

export function getAvailablePresetDefinitions(speedUnit, distanceUnit) {
  const normalizedSpeedUnit = normalizeSpeedUnit(speedUnit);
  const normalizedDistanceUnit = normalizeDistanceUnit(distanceUnit);
  const available = [];

  for (let index = 0; index < presetDefinitions.length; index += 1) {
    const preset = presetDefinitions[index];
    if (isPresetAvailableForUnits(preset, normalizedSpeedUnit, normalizedDistanceUnit)) available.push(preset);
  }

  return available;
}

export function getDefaultSpeedPresetId(speedUnit) {
  return normalizeSpeedUnit(speedUnit) === "kmh" ? "0-100-kmh" : "0-60-mph";
}

export function getDefaultDistancePresetId(distanceUnit) {
  return normalizeDistanceUnit(distanceUnit) === "m" ? "400-m" : "quarter-mile";
}

export function resolvePresetIdForUnits(presetId, speedUnit, distanceUnit) {
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

export function copyPreset(preset) {
  return {
    id: preset.id,
    type: preset.type,
    labelKey: preset.labelKey,
    standingStart: Boolean(preset.standingStart),
    startSpeedMs: isFiniteNumber(preset.startSpeedMs) ? preset.startSpeedMs : 0,
    targetSpeedMs: isFiniteNumber(preset.targetSpeedMs) ? preset.targetSpeedMs : null,
    distanceTargetM: isFiniteNumber(preset.distanceTargetM) ? preset.distanceTargetM : null,
    speedSystem: preset.speedSystem || null,
    distanceSystem: preset.distanceSystem || null,
    variantGroup: preset.variantGroup || preset.id,
    customStart: null,
    customEnd: null,
    customUnit: null,
  };
}

export function buildCustomPreset(settings) {
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

export function getSelectedPreset(settings) {
  const selectedPresetId = resolvePresetIdForUnits(
    settings.selectedPresetId,
    settings.speedUnit,
    settings.distanceUnit,
  );

  if (selectedPresetId === "custom") return buildCustomPreset(settings);

  for (let index = 0; index < presetDefinitions.length; index += 1) {
    if (presetDefinitions[index].id === selectedPresetId) return copyPreset(presetDefinitions[index]);
  }

  return copyPreset(findPresetDefinition(getDefaultSpeedPresetId(settings.speedUnit)));
}

export function shouldIncludeDistancePartials(preset, speedUnit) {
  if (!preset) return false;
  if (preset.type === "distance") return true;
  if (!preset.standingStart) return false;
  if (!isFiniteNumber(preset.targetSpeedMs)) return false;
  return preset.targetSpeedMs >= getLongRunSpeedThreshold(speedUnit);
}

export function getLongRunSpeedThreshold(speedUnit) {
  return normalizeSpeedUnit(speedUnit) === "kmh" ? (200 * KMH_TO_MS) : (130 * MPH_TO_MS);
}

export function createDistancePartial(definition) {
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

export function createSpeedPartial(definition) {
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

export function buildRunPartials(preset, settings) {
  const partials = [];
  const speedUnit = normalizeSpeedUnit(settings.speedUnit);
  const distanceUnit = normalizeDistanceUnit(settings.distanceUnit);
  const minimumStartSpeedMs = preset && !preset.standingStart && isFiniteNumber(preset.startSpeedMs) ? preset.startSpeedMs : 0;
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

export function presetKeyFromId(presetId) {
  for (let index = 0; index < presetDefinitions.length; index += 1) {
    if (presetDefinitions[index].id === presetId) return presetDefinitions[index].labelKey;
  }
  return "accelPresetCustom";
}

export function formatSignatureNumber(value) {
  if (!isFiniteNumber(value)) return "0";
  return String(Math.round(value * 1000000) / 1000000);
}

export function getCustomPresetSignature(startSpeedMs, targetSpeedMs) {
  return `custom:${formatSignatureNumber(startSpeedMs)}:${formatSignatureNumber(targetSpeedMs)}`;
}

export function getPresetSignature(preset) {
  if (preset.id === "custom") {
    return getCustomPresetSignature(preset.startSpeedMs, preset.targetSpeedMs);
  }
  return preset.id;
}

export function buildComparisonSignature(presetLike) {
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
