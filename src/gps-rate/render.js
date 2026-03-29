import {
  ACCURACY_WARNING_M,
  MAX_LOG_ROWS,
  SPARKLINE_WINDOW,
  SPARSE_HZ_WARNING,
  SPARSE_INTERVAL_WARNING_MS,
} from "./constants.js";
import { hasSessionActivity } from "./session-state.js";
import { buildHistogram, isFiniteNumber } from "./summary.js";

export function createGpsRateRenderer({
  elements,
  state,
  t,
  getLang,
}) {
  function formatDecimal(value, decimals = 1) {
    if (!isFiniteNumber(value)) return "—";
    return new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  function formatSvgNumber(value) {
    if (!isFiniteNumber(value)) return "0";
    return String(Math.round(value * 10) / 10);
  }

  function formatInteger(value) {
    if (!isFiniteNumber(value)) return "—";
    return new Intl.NumberFormat(getLang(), {
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatCoordinate(value) {
    if (!isFiniteNumber(value)) return "—";
    return new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(value);
  }

  function formatMs(value) {
    if (!isFiniteNumber(value)) return "—";
    if (Math.abs(value) >= 1000) return `${formatInteger(value)} ms`;
    return `${formatDecimal(value, 1)} ms`;
  }

  function formatHz(value) {
    if (!isFiniteNumber(value) || value <= 0) return "—";
    const decimals = value >= 10 ? 1 : 2;
    return `${formatDecimal(value, decimals)} Hz`;
  }

  function formatMeters(value) {
    if (!isFiniteNumber(value)) return "—";
    return `${formatDecimal(value, value >= 100 ? 0 : 1)} m`;
  }

  function formatSpeed(value) {
    if (!isFiniteNumber(value)) return "—";
    return `${formatDecimal(value, 2)} m/s`;
  }

  function formatHeading(value) {
    if (!isFiniteNumber(value)) return "—";
    return `${formatDecimal(value, 1)}°`;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatLocalTimestamp(ms) {
    if (!isFiniteNumber(ms)) return "—";

    const date = new Date(ms);
    const formatted = new Intl.DateTimeFormat(getLang(), {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);

    return `${formatted}.${String(date.getMilliseconds()).padStart(3, "0")}`;
  }

  function formatPerfTimestamp(ms) {
    if (!isFiniteNumber(ms)) return "—";
    return `${formatDecimal(ms, 1)} ms`;
  }

  function getPermissionLabel(stateValue) {
    switch (stateValue) {
      case "granted":
        return t("gpsRatePermissionGranted");
      case "prompt":
        return t("gpsRatePermissionPrompt");
      case "denied":
        return t("gpsRatePermissionDenied");
      case "unsupported":
        return t("gpsRatePermissionUnavailable");
      default:
        return t("gpsRatePermissionUnknown");
    }
  }

  function getVisibilityLabel() {
    return document.hidden ? t("gpsRateVisibilityHidden") : t("gpsRateVisibilityVisible");
  }

  function getMotionStateLabel(value) {
    switch (value) {
      case "moving":
        return t("gpsRateMoving");
      case "stationary":
        return t("gpsRateStationary");
      default:
        return t("gpsRateUncertain");
    }
  }

  function getMotionSourceLabel(value) {
    switch (value) {
      case "reported":
        return t("gpsRateMotionReported");
      case "derived":
        return t("gpsRateMotionDerived");
      default:
        return t("gpsRateMotionUnknown");
    }
  }

  function getWakeLockStateLabel() {
    if (!state.wakeLockSupported) return t("gpsRateWakeUnsupported");
    return state.wakeLockSentinel ? t("gpsRateWakeActive") : t("gpsRateWakeInactive");
  }

  function getFieldLabel(field) {
    switch (field) {
      case "speed":
        return t("gpsRateSpeedField");
      case "heading":
        return t("gpsRateHeadingField");
      case "altitude":
        return t("gpsRateAltitudeField");
      case "altitudeAccuracy":
        return t("gpsRateAltitudeAccuracyField");
      case "accuracy":
        return t("gpsRateAccuracyField");
      default:
        return field;
    }
  }

  function getStatusText(status = state.status) {
    if (status.rawText) return status.rawText;
    return t(status.key, status.params || {});
  }

  function getStatusTone(status = state.status) {
    switch (status.key) {
      case "gpsRateRunning":
        return "running";
      case "gpsRatePermissionBlocked":
      case "gpsRateUnsupported":
      case "gpsRateError":
        return "error";
      case "gpsRateWaitingFix":
      case "gpsRateUnavailable":
      case "gpsRateTimeout":
        return "warning";
      default:
        return "neutral";
    }
  }

  function updatePageMeta() {
    document.documentElement.lang = getLang();
    document.title = t("gpsRatePageTitle");
    if (elements.pageDescriptionMeta) {
      elements.pageDescriptionMeta.setAttribute("content", t("gpsRatePageDescription"));
    }
  }

  function renderActionNotice() {
    if (!elements.actionNotice) return;
    if (!state.actionNotice) {
      elements.actionNotice.textContent = "";
      return;
    }

    elements.actionNotice.textContent = state.actionNotice.rawText
      ? state.actionNotice.rawText
      : t(state.actionNotice.key, state.actionNotice.params || {});
  }

  function buildWarnings(summary) {
    const warnings = [];

    if (
      isFiniteNumber(summary.latestAccuracyM) && summary.latestAccuracyM > ACCURACY_WARNING_M
      || isFiniteNumber(summary.averageAccuracyM) && summary.averageAccuracyM > ACCURACY_WARNING_M
    ) {
      warnings.push({
        kind: "accuracy",
        label: t("gpsRatePoorAccuracy"),
        detail: t("gpsRatePoorAccuracyDetail", {
          value: formatDecimal(summary.averageAccuracyM || summary.latestAccuracyM, 1),
        }),
      });
    }

    if (
      isFiniteNumber(summary.maxIntervalMs) && summary.maxIntervalMs >= SPARSE_INTERVAL_WARNING_MS
      || isFiniteNumber(summary.wholeSessionHz) && summary.wholeSessionHz < SPARSE_HZ_WARNING
      || isFiniteNumber(summary.fiveSecondHz) && summary.fiveSecondHz < SPARSE_HZ_WARNING
    ) {
      warnings.push({
        kind: "sparse",
        label: t("gpsRateSparseUpdates"),
        detail: t("gpsRateSparseUpdatesDetail", {
          value: formatInteger(summary.maxIntervalMs || 0),
        }),
      });
    }

    if (state.hiddenNow) {
      warnings.push({
        kind: "hidden",
        label: t("gpsRateHiddenBehavior"),
        detail: t("gpsRateHiddenNow"),
      });
    } else if (state.hiddenCount > 0) {
      warnings.push({
        kind: "hidden",
        label: t("gpsRateHiddenBehavior"),
        detail: t("gpsRateHiddenSeen"),
      });
    }

    if (summary.unsupportedFields.length) {
      warnings.push({
        kind: "unsupported",
        label: t("gpsRateUnsupportedFields"),
        detail: t("gpsRateUnsupportedFieldList", {
          fields: summary.unsupportedFields.map(getFieldLabel).join(", "),
        }),
      });
    }

    if (summary.staleSampleCount > 0) {
      warnings.push({
        kind: "stale",
        label: t("gpsRateStaleWarning"),
        detail: t("gpsRateStaleDetail", { count: summary.staleSampleCount }),
      });
    }

    if (!warnings.length) {
      warnings.push({
        kind: "ok",
        label: t("gpsRateNoWarnings"),
        detail: "",
      });
    }

    return warnings;
  }

  function decorateSummary(summary) {
    if (!summary) return null;
    return {
      ...summary,
      warnings: buildWarnings(summary),
    };
  }

  function buildStatusNotes(summary) {
    const parts = [];
    if (summary.statusText) parts.push(summary.statusText);
    if (summary.notes) parts.push(summary.notes);
    return parts.length ? parts.join(" · ") : "—";
  }

  function renderStatus(summaryForCard) {
    const statusText = getStatusText();
    const tone = getStatusTone();

    elements.headerStatusText.textContent = statusText;
    elements.statusBadge.textContent = statusText;
    elements.statusBadge.dataset.state = tone;

    elements.permissionChipValue.textContent = getPermissionLabel(state.permissionState);
    elements.permissionSummaryText.textContent = getPermissionLabel(state.permissionState);
    elements.visibilityChipValue.textContent = getVisibilityLabel();
    elements.visibilitySummaryText.textContent = getVisibilityLabel();

    if (!summaryForCard) {
      elements.summarySourcePill.textContent = t("gpsRateSourceCurrent");
      elements.summarySourcePill.dataset.state = tone;
    }
  }

  function renderControls(summaryForCard) {
    const hasCurrentSamples = state.samples.length > 0;
    const canCopy = Boolean(summaryForCard);

    elements.startTest.disabled = state.isRunning || !("geolocation" in navigator);
    elements.stopTest.disabled = !state.isRunning;
    elements.resetTest.disabled = !state.isRunning && !hasCurrentSamples;
    if (elements.startQuickTest) {
      elements.startQuickTest.disabled = elements.startTest.disabled;
    }
    if (elements.stopQuickTest) {
      elements.stopQuickTest.disabled = elements.stopTest.disabled;
    }
    if (elements.resetQuickTest) {
      elements.resetQuickTest.disabled = elements.resetTest.disabled;
    }
    elements.exportJson.disabled = !hasCurrentSamples;
    elements.exportCsv.disabled = !hasCurrentSamples;
    elements.copySummary.disabled = !canCopy;
    elements.clearLog.disabled = elements.eventLogBody.children.length === 0;
    elements.wakeLockToggle.disabled = !state.wakeLockSupported;
    elements.wakeLockToggle.setAttribute("aria-pressed", String(Boolean(state.wakeLockSentinel)));
    elements.wakeLockStateText.textContent = getWakeLockStateLabel();

    if (state.notes !== elements.sessionNotes.value) {
      elements.sessionNotes.value = state.notes;
    }
  }

  function renderKpis(summary) {
    const latestSample = state.samples.length ? state.samples[state.samples.length - 1] : null;
    elements.currentIntervalValue.textContent = formatMs(summary.currentIntervalMs);
    elements.effectiveHzValue.textContent = formatHz(latestSample ? latestSample.effectiveHz : null);
    elements.sampleCountValue.textContent = formatInteger(summary.sampleCount);
    elements.elapsedValue.textContent = formatDuration(summary.durationMs);
    elements.liveAccuracyValue.textContent = formatMeters(summary.latestAccuracyM);
    elements.movementValue.textContent = latestSample ? getMotionStateLabel(summary.motion.latestState) : "—";
  }

  function renderSummaryCard(summary) {
    const hasSummary = Boolean(summary);
    const showEmptyState = !hasSummary || (!summary.sampleCount && summary.source === "current" && !state.isRunning && summary.durationMs === 0);

    elements.summaryGrid.hidden = showEmptyState;
    elements.summaryEmptyState.hidden = !showEmptyState;

    if (!hasSummary) {
      elements.summarySourcePill.textContent = t("gpsRateSourceCurrent");
      elements.summarySavedAt.textContent = "";
      return;
    }

    elements.summarySourcePill.textContent = summary.source === "saved" ? t("gpsRateSourceSaved") : t("gpsRateSourceCurrent");
    elements.summarySourcePill.dataset.state = summary.source === "saved" ? "warning" : getStatusTone();
    elements.summarySavedAt.textContent = summary.source === "saved"
      ? t("gpsRateSummarySavedAt", { time: formatLocalTimestamp(summary.savedAtMs) })
      : "";

    elements.summaryDurationValue.textContent = formatDuration(summary.durationMs);
    elements.summarySampleCountValue.textContent = formatInteger(summary.sampleCount);
    elements.summaryBestIntervalValue.textContent = formatMs(summary.minIntervalMs);
    elements.summaryAverageIntervalValue.textContent = formatMs(summary.averageIntervalMs);
    elements.summaryMedianIntervalValue.textContent = formatMs(summary.medianIntervalMs);
    elements.summaryAverageHzValue.textContent = formatHz(summary.effectiveAverageHz);
    elements.summaryBestHzValue.textContent = formatHz(summary.bestObservedHz);
    elements.summarySpeedFieldValue.textContent = summary.fieldAvailability.speed ? t("gpsRateAvailable") : t("gpsRateNotSeen");
    elements.summaryHeadingFieldValue.textContent = summary.fieldAvailability.heading ? t("gpsRateAvailable") : t("gpsRateNotSeen");
    elements.summaryAltitudeFieldValue.textContent = summary.fieldAvailability.altitude ? t("gpsRateAvailable") : t("gpsRateNotSeen");
    elements.summaryAccuracyValue.textContent = formatMeters(summary.averageAccuracyM);
    elements.summaryStatusNotesValue.textContent = buildStatusNotes(summary);
  }

  function renderWarningBadges(summary) {
    elements.warningBadges.replaceChildren();
    const warnings = summary ? summary.warnings : [{ kind: "ok", label: t("gpsRateNoWarnings"), detail: "" }];

    for (let index = 0; index < warnings.length; index += 1) {
      const warning = warnings[index];
      const badge = document.createElement("span");
      badge.className = "gps-rate-warning-badge";
      badge.dataset.kind = warning.kind;
      badge.textContent = warning.detail ? `${warning.label} · ${warning.detail}` : warning.label;
      elements.warningBadges.appendChild(badge);
    }
  }

  function renderHistogram(summary) {
    elements.histogramList.replaceChildren();

    const histogram = summary ? summary.histogram : buildHistogram([]);
    const maxCount = histogram.reduce((largest, bucket) => Math.max(largest, bucket.count), 0);

    for (let index = 0; index < histogram.length; index += 1) {
      const bucket = histogram[index];
      const row = document.createElement("div");
      row.className = "gps-rate-histogram-row";

      const label = document.createElement("span");
      label.className = "gps-rate-histogram-label";
      label.textContent = `${bucket.label} ms`;

      const bar = document.createElement("div");
      bar.className = "gps-rate-histogram-bar";

      const fill = document.createElement("div");
      fill.className = "gps-rate-histogram-fill";
      fill.style.width = maxCount > 0 ? `${Math.max(2, (bucket.count / maxCount) * 100)}%` : "0%";
      bar.appendChild(fill);

      const value = document.createElement("span");
      value.className = "gps-rate-histogram-value";
      value.textContent = formatInteger(bucket.count);

      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(value);
      elements.histogramList.appendChild(row);
    }
  }

  function renderSparkline() {
    const intervals = state.samples
      .map((sample) => sample.intervalMs)
      .filter((value) => isFiniteNumber(value) && value > 0)
      .slice(-SPARKLINE_WINDOW);

    elements.sparklineRangeLabel.textContent = t("gpsRateLastIntervals", { count: SPARKLINE_WINDOW });

    if (!intervals.length) {
      elements.intervalSparklineLine.setAttribute("points", "");
      return;
    }

    const minValue = Math.min.apply(null, intervals);
    const maxValue = Math.max.apply(null, intervals);
    const range = Math.max(1, maxValue - minValue);
    const width = 240;
    const height = 80;
    const step = intervals.length > 1 ? width / (intervals.length - 1) : width;

    const points = intervals.map((value, index) => {
      const x = step * index;
      const normalized = (value - minValue) / range;
      const y = height - (normalized * (height - 12)) - 6;
      return `${formatSvgNumber(x)},${formatSvgNumber(y)}`;
    }).join(" ");

    elements.intervalSparklineLine.setAttribute("points", points);
  }

  function availabilityText(field, available) {
    if (!available) return t("gpsRateNotSeen");

    const count = state.samples.filter((sample) => {
      switch (field) {
        case "speed":
          return isFiniteNumber(sample.speedMps);
        case "heading":
          return isFiniteNumber(sample.headingDeg);
        case "altitude":
          return isFiniteNumber(sample.altitudeM);
        case "altitudeAccuracy":
          return isFiniteNumber(sample.altitudeAccuracyM);
        case "accuracy":
          return isFiniteNumber(sample.accuracyM);
        default:
          return false;
      }
    }).length;

    return `${t("gpsRateAvailable")} · ${formatInteger(count)}/${formatInteger(Math.max(state.samples.length, 1))}`;
  }

  function renderAvailability(summary) {
    const availability = summary ? summary.fieldAvailability : {
      speed: false,
      heading: false,
      altitude: false,
      altitudeAccuracy: false,
      accuracy: false,
    };

    elements.availabilitySpeedValue.textContent = availabilityText("speed", availability.speed);
    elements.availabilityHeadingValue.textContent = availabilityText("heading", availability.heading);
    elements.availabilityAltitudeValue.textContent = availabilityText("altitude", availability.altitude);
    elements.availabilityAltitudeAccuracyValue.textContent = availabilityText("altitudeAccuracy", availability.altitudeAccuracy);
    elements.availabilityAccuracyValue.textContent = availabilityText("accuracy", availability.accuracy);
  }

  function renderDiagnostics(summary) {
    renderWarningBadges(summary);
    renderHistogram(summary);
    renderSparkline();
    renderAvailability(summary);

    elements.jitterValue.textContent = summary && isFiniteNumber(summary.jitterMs)
      ? `${getJitterLabel(summary.jitterMs)} · ${formatMs(summary.jitterMs)}`
      : "—";
    elements.staleCountValue.textContent = summary ? formatInteger(summary.staleSampleCount) : "—";
    elements.nullSpeedValue.textContent = summary ? formatInteger(summary.nullSpeedCount) : "—";
    elements.nullHeadingValue.textContent = summary ? formatInteger(summary.nullHeadingCount) : "—";
    elements.missingAltitudeValue.textContent = summary ? formatInteger(summary.missingAltitudeCount) : "—";
    elements.bestObservedHzValue.textContent = summary ? formatHz(summary.bestObservedHz) : "—";
    elements.fiveSecondHzValue.textContent = summary ? formatHz(summary.fiveSecondHz) : "—";
    elements.wholeSessionHzValue.textContent = summary ? formatHz(summary.wholeSessionHz) : "—";
  }

  function getJitterLabel(jitterMs) {
    if (!isFiniteNumber(jitterMs)) return "—";
    if (jitterMs < 75) return t("gpsRateJitterLow");
    if (jitterMs < 200) return t("gpsRateJitterModerate");
    return t("gpsRateJitterHigh");
  }

  function renderLatestSample() {
    const latestSample = state.samples.length ? state.samples[state.samples.length - 1] : null;

    elements.latestLatitudeValue.textContent = latestSample ? formatCoordinate(latestSample.latitude) : "—";
    elements.latestLongitudeValue.textContent = latestSample ? formatCoordinate(latestSample.longitude) : "—";
    elements.latestSpeedValue.textContent = latestSample ? formatSpeed(latestSample.speedMps) : "—";
    elements.latestHeadingValue.textContent = latestSample ? formatHeading(latestSample.headingDeg) : "—";
    elements.latestAccuracyValue.textContent = latestSample ? formatMeters(latestSample.accuracyM) : "—";
    elements.latestAltitudeValue.textContent = latestSample ? formatMeters(latestSample.altitudeM) : "—";
    elements.latestAltitudeAccuracyValue.textContent = latestSample ? formatMeters(latestSample.altitudeAccuracyM) : "—";
    elements.latestGeoTimestampValue.textContent = latestSample ? formatLocalTimestamp(latestSample.positionTimestampMs) : "—";
    elements.latestPerfTimestampValue.textContent = latestSample ? formatPerfTimestamp(latestSample.performanceNowMs) : "—";
    elements.latestSampleAgeValue.textContent = latestSample
      ? formatMs(latestSample.sampleAgeMs)
      : "—";
    elements.latestCallbackDeltaValue.textContent = latestSample ? formatMs(latestSample.intervalMs) : "—";
    elements.latestGeoDeltaValue.textContent = latestSample ? formatMs(latestSample.geoTimestampDeltaMs) : "—";
  }

  function renderMotion(summary) {
    const motion = summary ? summary.motion : null;
    elements.motionStateValue.textContent = motion ? getMotionStateLabel(motion.latestState) : "—";
    elements.motionSourceValue.textContent = motion ? getMotionSourceLabel(motion.latestSource) : "—";
    elements.movingHzValue.textContent = motion ? formatHz(motion.movingHz) : "—";
    elements.stationaryHzValue.textContent = motion ? formatHz(motion.stationaryHz) : "—";
    elements.movingSamplesValue.textContent = motion ? formatInteger(motion.movingSamples) : "—";
    elements.stationarySamplesValue.textContent = motion ? formatInteger(motion.stationarySamples) : "—";
  }

  function renderLogVisibility() {
    const hasRows = elements.eventLogBody.children.length > 0;
    elements.logTableWrap.hidden = !hasRows;
    elements.logEmptyState.hidden = hasRows;
  }

  function renderSession() {
    const hasCurrentActivity = hasSessionActivity(state);
    const summaryForCard = hasCurrentActivity ? state.currentSummary : state.lastSavedSummary;

    renderStatus(summaryForCard);
    renderControls(summaryForCard);
    renderKpis(state.currentSummary);
    renderSummaryCard(summaryForCard);
    renderDiagnostics(state.samples.length ? state.currentSummary : null);
    renderLatestSample();
    renderMotion(state.samples.length ? state.currentSummary : null);
    renderLogVisibility();
  }

  function appendLogRow(sample) {
    const row = document.createElement("tr");
    const stateLabel = sample.isStale
      ? `${getMotionStateLabel(sample.movementState)} · ${t("gpsRateStaleWarning")}`
      : getMotionStateLabel(sample.movementState);

    row.innerHTML = [
      `<td>${formatInteger(sample.index)}</td>`,
      `<td>${formatMs(sample.intervalMs)}</td>`,
      `<td>${formatHz(sample.effectiveHz)}</td>`,
      `<td class="gps-rate-log-mono">${formatCoordinate(sample.latitude)}, ${formatCoordinate(sample.longitude)}</td>`,
      `<td>${formatSpeed(sample.speedMps)}</td>`,
      `<td>${formatHeading(sample.headingDeg)}</td>`,
      `<td>${formatMeters(sample.accuracyM)}</td>`,
      `<td class="gps-rate-log-state">${stateLabel}</td>`,
    ].join("");

    elements.eventLogBody.insertBefore(row, elements.eventLogBody.firstChild);

    while (elements.eventLogBody.children.length > MAX_LOG_ROWS) {
      elements.eventLogBody.removeChild(elements.eventLogBody.lastChild);
    }
  }

  function clearVisibleLog() {
    elements.eventLogBody.replaceChildren();
    renderLogVisibility();
  }

  return {
    decorateSummary,
    updatePageMeta,
    renderActionNotice,
    renderSession,
    appendLogRow,
    clearVisibleLog,
    getStatusText,
    formatDuration,
    formatInteger,
    formatMs,
    formatHz,
    formatMeters,
  };
}
