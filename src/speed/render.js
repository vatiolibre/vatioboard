import { DISTANCE_UNIT_CONFIG, UNIT_CONFIG } from "./constants.js";

export function tf(translate, key, values = {}) {
  return translate(key).replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? ""));
}

export function capitalizeText(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

export function truncateText(value, maxLength = 32) {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;
}

export function escapeSvgText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function convertSpeed(speedMs, unit) {
  return speedMs * UNIT_CONFIG[unit].factor;
}

export function convertDisplaySpeedToMs(value, unit) {
  return value / UNIT_CONFIG[unit].factor;
}

export function convertDistanceMeasurement(valueM, unit) {
  return valueM * DISTANCE_UNIT_CONFIG[unit].factor;
}

export function getElapsedTripSeconds(startTime, nowMs = Date.now()) {
  if (!Number.isFinite(startTime)) return 0;
  return Math.max(0, (nowMs - startTime) / 1000);
}

export function getAverageSpeedMs(totalDistanceM, startTime, nowMs = Date.now()) {
  const elapsedSeconds = getElapsedTripSeconds(startTime, nowMs);
  return elapsedSeconds > 0 ? totalDistanceM / elapsedSeconds : 0;
}

export function getDistanceDisplay(distanceM, unit) {
  if (unit === "m") {
    if (distanceM < 1000) return { value: Math.round(distanceM).toString(), unit: "m" };
    const kilometers = distanceM / 1000;
    if (kilometers < 10) return { value: kilometers.toFixed(1), unit: "km" };
    return { value: Math.round(kilometers).toString(), unit: "km" };
  }

  const miles = distanceM / 1609.344;
  if (miles < 10) return { value: miles.toFixed(1), unit: "mi" };
  return { value: Math.round(miles).toString(), unit: "mi" };
}

export function formatAltitude(altitudeM, unit) {
  if (!Number.isFinite(altitudeM)) return "—";
  return Math.round(convertDistanceMeasurement(altitudeM, unit)).toString();
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function describeAccuracy(accuracyM, distanceUnit, translate) {
  if (!Number.isFinite(accuracyM)) return translate("gpsLive");
  const accuracyValue = Math.round(convertDistanceMeasurement(accuracyM, distanceUnit));
  const accuracyUnit = DISTANCE_UNIT_CONFIG[distanceUnit].label;
  const rounded = Math.round(accuracyM);
  if (rounded <= 12) return tf(translate, "gpsLockedAccuracy", { value: accuracyValue, unit: accuracyUnit });
  if (rounded <= 40) return tf(translate, "gpsLiveAccuracy", { value: accuracyValue, unit: accuracyUnit });
  return tf(translate, "weakGpsAccuracy", { value: accuracyValue, unit: accuracyUnit });
}

export function getStatusText(kind, params, translate, distanceUnit) {
  switch (kind) {
    case "accuracy":
      return describeAccuracy(params?.accuracyM, distanceUnit, translate);
    case "notSupported":
      return translate("gpsNotSupported");
    case "blocked":
      return translate("gpsBlocked");
    case "unavailable":
      return translate("gpsUnavailable");
    case "waiting":
      return translate("waitingForGps");
    case "error":
      return params?.text || translate("gpsError");
    case "requesting":
    default:
      return translate("requestingGps");
  }
}

export function formatGlobeTimestamp(timestamp, lang) {
  try {
    return new Intl.DateTimeFormat(lang, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export function getCssColor(styleSourceElement, name, fallback) {
  const styleTarget = styleSourceElement || document.documentElement;
  const value = getComputedStyle(styleTarget).getPropertyValue(name).trim();
  return value || fallback;
}

export function getGaugeMaximum(displaySpeed, unit) {
  const config = UNIT_CONFIG[unit];
  const paddedValue = Math.max(config.baseMax, Math.ceil(displaySpeed / config.tickStep) * config.tickStep);
  return Math.max(config.baseMax, paddedValue);
}

export function createSpeedRenderer({
  state,
  elements,
  analogSpeedometer,
  t,
  getLang,
  getAlertUiState,
  isManualAlertActive,
  getAlertConfig,
  getAlertLimitDisplayValue,
  getConfiguredTrapAlertDistanceLabel,
  getTrapAlertPresets,
  formatTrapDistance,
  renderWazeUi,
  renderGlobeStatus,
  syncRuntimePagePresentation,
}) {
  function getCriticalAlertText(alertState = getAlertUiState()) {
    if (alertState.over) {
      return alertState.source === "trap"
        ? tf(t, "overTrapLimitBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
        : tf(t, "overSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
    }

    if (alertState.trapActive) {
      return alertState.trapSpeedLabel
        ? tf(t, "trapAheadWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
        : tf(t, "trapAhead", { distance: alertState.trapDistanceLabel });
    }

    return "";
  }

  function getSubStatusText(alertState = getAlertUiState()) {
    const isLiveStatus = state.lastFixAt > 0 && state.statusKind === "accuracy";

    if (!isLiveStatus) {
      return state.statusText;
    }

    if (alertState.over) {
      return alertState.source === "trap"
        ? tf(t, "overTrapLimitBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
        : tf(t, "overSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
    }

    if (alertState.trapActive) {
      return alertState.trapSpeedLabel
        ? tf(t, "trapAheadWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
        : tf(t, "trapAhead", { distance: alertState.trapDistanceLabel });
    }

    if (alertState.manualEnabled) {
      return tf(t, "manualAlertAt", {
        limit: `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`,
      });
    }

    if (state.trapAlertEnabled && state.trapLoadPending) {
      return t("loadingTrapData");
    }

    if (state.trapAlertEnabled && state.trapLoadError) {
      return t("trapDataUnavailable");
    }

    return state.statusText;
  }

  function renderSubStatus() {
    elements.subStatus.textContent = getSubStatusText();
  }

  function renderAlertPresets() {
    const unit = state.unit;
    if (elements.alertPresets.dataset.unit === unit) return;

    const fragment = document.createDocumentFragment();
    const currentValue = getAlertLimitDisplayValue(unit);

    for (const preset of getAlertConfig(unit).presets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "speed-alert-preset";
      button.dataset.alertPreset = String(preset);
      button.textContent = `${preset} ${UNIT_CONFIG[unit].label}`;
      button.setAttribute("aria-pressed", String(preset === currentValue));
      fragment.append(button);
    }

    elements.alertPresets.replaceChildren(fragment);
    elements.alertPresets.dataset.unit = unit;
  }

  function renderTrapDistancePresets() {
    const unit = state.distanceUnit;
    if (elements.trapDistancePresets.dataset.unit === unit) return;

    const fragment = document.createDocumentFragment();

    for (const preset of getTrapAlertPresets(unit)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "speed-alert-preset";
      button.dataset.trapDistance = String(preset.meters);
      button.textContent = preset.label;
      button.setAttribute("aria-pressed", String(Math.abs(preset.meters - state.trapAlertDistanceM) < 1));
      fragment.append(button);
    }

    elements.trapDistancePresets.replaceChildren(fragment);
    elements.trapDistancePresets.dataset.unit = unit;
  }

  function getAlertTriggerText(alertState) {
    if (alertState.over) {
      return tf(t, "alertOverShort", { delta: alertState.deltaDisplayValue });
    }

    if (alertState.trapActive) {
      return tf(t, "trapLabel", { distance: alertState.trapDistanceLabel });
    }

    if (alertState.manualEnabled) {
      return `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
    }

    if (state.trapAlertEnabled && state.trapLoadPending) {
      return t("loadingTraps");
    }

    if (state.trapAlertEnabled && state.trapLoadError) {
      return t("trapUnavailable");
    }

    if (state.trapAlertEnabled) {
      return tf(t, "trapLabel", { distance: getConfiguredTrapAlertDistanceLabel() });
    }

    return t("tapToConfigure");
  }

  function getAlertTriggerLabel(alertState) {
    if (alertState.over) {
      return alertState.source === "trap"
        ? tf(t, "overTrapSpeedLimitBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
        : tf(t, "overManualSpeedAlertBy", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
    }

    if (alertState.trapActive) {
      return alertState.trapSpeedLabel
        ? tf(t, "trapAlertActiveWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
        : tf(t, "trapAlertActive", { distance: alertState.trapDistanceLabel });
    }

    if (alertState.manualEnabled) {
      return tf(t, "manualSpeedAlertSetTo", { limit: `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}` });
    }

    if (state.trapAlertEnabled && state.trapLoadPending) {
      return t("loadingSpeedTrapData");
    }

    if (state.trapAlertEnabled && state.trapLoadError) {
      return t("trapAlertsEnabledUnavailable");
    }

    if (state.trapAlertEnabled) {
      return tf(t, "configureTrapAlertsAt", { distance: getConfiguredTrapAlertDistanceLabel() });
    }

    return t("tapToConfigureAlerts");
  }

  function getAlertPanelStatusText(alertState) {
    if (alertState.over) {
      return alertState.source === "trap"
        ? tf(t, "overTrapSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` })
        : tf(t, "overSummary", { delta: `${alertState.deltaDisplayValue} ${alertState.unitLabel}` });
    }

    if (alertState.trapActive) {
      return alertState.trapSpeedLabel
        ? tf(t, "trapAheadWithLimit", { distance: alertState.trapDistanceLabel, limit: alertState.trapSpeedLabel })
        : tf(t, "trapLabel", { distance: alertState.trapDistanceLabel });
    }

    if (alertState.manualEnabled) {
      return `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
    }

    if (state.trapAlertEnabled && state.trapLoadPending) {
      return t("loadingTrapData");
    }

    if (state.trapAlertEnabled && state.trapLoadError) {
      return t("trapDataUnavailable");
    }

    if (state.trapAlertEnabled) {
      return tf(t, "trapAlertsSummary", { distance: getConfiguredTrapAlertDistanceLabel() });
    }

    return t("off");
  }

  function drawGauge() {
    const alertState = getAlertUiState();
    const displaySpeed = convertSpeed(state.displayedSpeedMs, state.unit);
    const currentSpeed = Math.round(convertSpeed(state.currentSpeedMs, state.unit));
    const unitLabel = UNIT_CONFIG[state.unit].label;
    const gaugeMax = getGaugeMaximum(
      Math.max(
        displaySpeed,
        convertSpeed(state.maxSpeedMs, state.unit),
        alertState.enabled ? alertState.limitDisplayValue : 0,
      ),
      state.unit,
    );

    const trapAccentColor = getCssColor(elements.gaugeStage, "--speed-trap", "#f59e0b");
    const accentColor = alertState.over
      ? getCssColor(elements.gaugeStage, "--speed-alert", "#ef4444")
      : (alertState.trapActive ? trapAccentColor : getCssColor(elements.gaugeStage, "--speed-accent", "#10b981"));
    const alertMarkerColor = alertState.source === "trap"
      ? trapAccentColor
      : getCssColor(elements.gaugeStage, "--speed-alert-marker", "#ff7a5c");

    analogSpeedometer.render({
      value: displaySpeed,
      valueText: String(currentSpeed),
      unitText: unitLabel,
      substatusText: getSubStatusText(),
      maxValue: gaugeMax,
      tickStep: UNIT_CONFIG[state.unit].tickStep,
      markerValue: alertState.enabled ? alertState.limitDisplayValue : null,
      accentColor,
      markerColor: alertMarkerColor,
      pivotInnerColor: accentColor,
    });
  }

  function renderMetrics(syncAlertUi) {
    const currentSpeed = Math.round(convertSpeed(state.currentSpeedMs, state.unit));
    const maxSpeed = Math.round(convertSpeed(state.maxSpeedMs, state.unit));
    const averageSpeed = Math.round(getAverageSpeedMs(state.totalDistanceM, state.startTime));
    const distance = getDistanceDisplay(state.totalDistanceM, state.distanceUnit);
    const nearestTrap = formatTrapDistance(state.nearestTrapDistanceM, state.distanceUnit, t("away"));
    const unitLabel = UNIT_CONFIG[state.unit].label;
    const distanceUnitLabel = DISTANCE_UNIT_CONFIG[state.distanceUnit].label;

    elements.speedValue.textContent = String(currentSpeed);
    elements.speedUnit.textContent = unitLabel;
    elements.maxSpeed.textContent = String(maxSpeed);
    elements.maxSpeedUnit.textContent = unitLabel;
    elements.avgSpeed.textContent = String(averageSpeed);
    elements.avgSpeedUnit.textContent = unitLabel;
    elements.distanceValue.textContent = distance.value;
    elements.distanceUnit.textContent = distance.unit;
    elements.nearestTrapDistance.textContent = nearestTrap.value;
    elements.nearestTrapUnit.textContent = nearestTrap.unit;
    elements.durationValue.textContent = formatDuration(
      Number.isFinite(state.startTime) ? Date.now() - state.startTime : 0,
    );
    elements.altitudeValue.textContent = formatAltitude(state.currentAltitudeM, state.distanceUnit);
    elements.altitudeUnit.textContent = distanceUnitLabel;
    elements.maxAltitude.textContent = formatAltitude(state.maxAltitudeM, state.distanceUnit);
    elements.maxAltitudeUnit.textContent = distanceUnitLabel;
    elements.minAltitude.textContent = formatAltitude(state.minAltitudeM, state.distanceUnit);
    elements.minAltitudeUnit.textContent = distanceUnitLabel;
    syncAlertUi();
    renderWazeUi();
    syncRuntimePagePresentation();
  }

  function syncLanguage({ applyTranslations, renderPrimaryView, renderMetrics: rerenderMetrics }) {
    applyTranslations();
    state.statusText = getStatusText(state.statusKind, state.statusParams, t, state.distanceUnit);
    elements.status.textContent = state.statusText;

    if (!elements.notice.hidden && state.noticeKey) {
      elements.noticeText.textContent = tf(t, state.noticeKey, state.noticeParams ?? {});
    }

    renderGlobeStatus();
    renderPrimaryView();
    rerenderMetrics();
    drawGauge();
  }

  return {
    drawGauge,
    getAlertPanelStatusText,
    getAlertTriggerLabel,
    getAlertTriggerText,
    getCriticalAlertText,
    getStatusText: (kind = state.statusKind, params = state.statusParams) => getStatusText(kind, params, t, state.distanceUnit),
    getSubStatusText,
    renderAlertPresets,
    renderMetrics,
    renderSubStatus,
    renderTrapDistancePresets,
    syncLanguage,
  };
}
