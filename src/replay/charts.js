import Chart from "chart.js/auto";
import {
  buildReplayMetricSeries,
  formatReplayDistanceValue,
  formatReplaySpeedValue,
  getReplayAxisRange,
  getReplayMetricDomain,
  getReplaySummary,
} from "./logic.js";

const DETAIL_METRIC_KEYS = ["speedMs", "altitudeM", "headingDeg"];

const replayCursorPlugin = {
  id: "replayCursor",
  afterDatasetsDraw(chart) {
    if (!chart || !chart.chartArea || !chart.scales?.x || !Number.isFinite(chart.$replayCursorValue)) {
      return;
    }

    const xScale = chart.scales.x;
    const ctx = chart.ctx;
    const x = xScale.getPixelForValue(chart.$replayCursorValue);

    if (!Number.isFinite(x)) return;

    ctx.save();
    ctx.strokeStyle = chart.$replayCursorColor || "rgba(52, 211, 153, 0.82)";
    ctx.lineWidth = chart.$replayCursorWidth || 1.5;
    ctx.setLineDash(chart.$replayCursorDash || [5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, chart.chartArea.top);
    ctx.lineTo(x, chart.chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function formatPlaybackDuration(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDetailMetricKey(metricKey) {
  return DETAIL_METRIC_KEYS.includes(metricKey) ? metricKey : "speedMs";
}

function normalizeHeadingTickValue(value) {
  if (!Number.isFinite(value)) return value;
  return ((value % 360) + 360) % 360;
}

export function createReplayChartsController({
  elements,
  getSpeedUnit,
  getDistanceUnit,
}) {
  let activeSession = null;
  let activeAxisMode = "time";
  let detailOpen = false;
  let detailRangeStartRatio = 0;
  let detailRangeEndRatio = 1;
  let lastPlaybackPoint = {
    elapsedMs: 0,
    totalDistanceM: 0,
  };
  let overviewCharts = {
    speedMs: null,
    altitudeM: null,
    headingDeg: null,
  };
  let detailCharts = {
    speedMs: null,
    altitudeM: null,
    headingDeg: null,
  };

  function formatAxisNumber(value, decimals = 0) {
    return new Intl.NumberFormat(document.documentElement.lang || undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  function formatDistanceLabel(distanceM) {
    const distanceUnit = getDistanceUnit();
    const distanceValue = formatReplayDistanceValue(distanceM, distanceUnit);

    if (distanceUnit === "ft" && distanceValue >= 5280) {
      const miles = distanceM / 1609.344;
      return `${formatAxisNumber(miles, miles < 10 ? 1 : 0)} mi`;
    }

    if (distanceUnit === "m" && distanceValue >= 1000) {
      const kilometers = distanceM / 1000;
      return `${formatAxisNumber(kilometers, kilometers < 10 ? 1 : 0)} km`;
    }

    return `${formatAxisNumber(distanceValue, 0)} ${distanceUnit === "ft" ? "ft" : "m"}`;
  }

  function getCssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function getSharedPalette() {
    return {
      axis: getCssColor("--replay-border", "rgba(17, 24, 39, 0.12)"),
      label: getCssColor("--replay-muted", "rgba(17, 24, 39, 0.66)"),
      cursor: getCssColor("--replay-track", "rgba(52, 211, 153, 0.82)"),
    };
  }

  function getMetricPalette(metricKey) {
    const shared = getSharedPalette();

    if (metricKey === "altitudeM") {
      return {
        ...shared,
        line: getCssColor("--replay-altitude-line", "#f97316"),
        fill: getCssColor("--replay-altitude-fill", "rgba(249, 115, 22, 0.16)"),
      };
    }

    if (metricKey === "headingDeg") {
      return {
        ...shared,
        line: getCssColor("--replay-heading-line", "#3b82f6"),
        fill: getCssColor("--replay-heading-fill", "rgba(59, 130, 246, 0.16)"),
      };
    }

    return {
      ...shared,
      line: getCssColor("--replay-speed-line", "#10b981"),
      fill: getCssColor("--replay-speed-fill", "rgba(16, 185, 129, 0.16)"),
    };
  }

  function getMetricConfig(metricKey) {
    const speedUnit = getSpeedUnit();
    const distanceUnit = getDistanceUnit();

    if (metricKey === "altitudeM") {
      return {
        metricKey,
        min: undefined,
        max: undefined,
        tickFormatter: (value) => `${Math.round(formatReplayDistanceValue(value, distanceUnit))} ${distanceUnit === "ft" ? "ft" : "m"}`,
      };
    }

    if (metricKey === "headingDeg") {
      return {
        metricKey,
        min: undefined,
        max: undefined,
        tickFormatter: (value) => `${Math.round(normalizeHeadingTickValue(value))}°`,
      };
    }

    return {
      metricKey: "speedMs",
      min: 0,
      max: undefined,
      tickFormatter: (value) => `${Math.round(formatReplaySpeedValue(value, speedUnit))} ${speedUnit === "mph" ? "mph" : "km/h"}`,
    };
  }

  function getMetricYGrace(metricKey, detailMode) {
    if (metricKey === "headingDeg") return 0;
    return detailMode ? "8%" : "4%";
  }

  function getDetailMetricBounds(metricKey, axisRange) {
    const domain = getReplayMetricDomain(activeSession, metricKey, activeAxisMode, axisRange);
    if (!domain) return null;

    let min = domain.min;
    let max = domain.max;

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

    if (max <= min) {
      const pad = metricKey === "headingDeg"
        ? 2
        : Math.max(0.5, Math.abs(max || min) * 0.08, 1);
      min -= pad;
      max += pad;
    }

    if (metricKey === "speedMs") {
      min = Math.max(0, min);
    }

    if (metricKey === "headingDeg") {
      if (max <= min) {
        max = min + 4;
      }
    }

    return { min, max };
  }

  function destroyChartMap(chartMap) {
    for (const chart of Object.values(chartMap)) {
      if (chart) chart.destroy();
    }
  }

  function destroyCharts() {
    destroyChartMap(overviewCharts);
    destroyChartMap(detailCharts);
    overviewCharts = {
      speedMs: null,
      altitudeM: null,
      headingDeg: null,
    };
    detailCharts = {
      speedMs: null,
      altitudeM: null,
      headingDeg: null,
    };
  }

  function buildMetricDataset(metricKey) {
    const series = buildReplayMetricSeries(activeSession, metricKey, activeAxisMode);
    return series.map((point) => ({
      x: point.xValue,
      y: point.value,
    }));
  }

  function getAxisMax() {
    const summary = getReplaySummary(activeSession);
    if (activeAxisMode === "distance") {
      return Math.max(0, summary.totalDistanceM);
    }
    return Math.max(0, summary.durationMs / 1000);
  }

  function getOverviewAxisRange() {
    return getReplayAxisRange(getAxisMax(), 0, 1);
  }

  function getDetailAxisRange() {
    return getReplayAxisRange(getAxisMax(), detailRangeStartRatio, detailRangeEndRatio);
  }

  function createMetricChart({
    canvas,
    metricKey,
    axisRange,
    detailMode = false,
  }) {
    if (!canvas || !activeSession) return null;

    const metricConfig = getMetricConfig(metricKey);
    const palette = getMetricPalette(metricConfig.metricKey);
    const detailBounds = detailMode ? getDetailMetricBounds(metricConfig.metricKey, axisRange) : null;
    const yMin = detailBounds?.min ?? metricConfig.min;
    const yMax = detailBounds?.max ?? metricConfig.max;

    return new Chart(canvas, {
      type: "line",
      plugins: [replayCursorPlugin],
      data: {
        datasets: [
          {
            data: buildMetricDataset(metricConfig.metricKey),
            parsing: false,
            normalized: true,
            borderColor: palette.line,
            backgroundColor: palette.fill,
            borderWidth: detailMode ? 2.5 : 2.25,
            clip: detailMode ? 10 : 4,
            tension: 0.28,
            cubicInterpolationMode: "monotone",
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: false,
          },
        },
        layout: {
          padding: {
            left: 0,
            right: 0,
            top: detailMode ? 4 : 0,
            bottom: detailMode ? 4 : 0,
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
        scales: {
          x: {
            type: "linear",
            min: axisRange.min,
            max: axisRange.max,
            bounds: "data",
            offset: false,
            grid: {
              color: palette.axis,
              drawBorder: false,
            },
            ticks: {
              color: palette.label,
              callback(value) {
                return activeAxisMode === "distance"
                  ? formatDistanceLabel(value)
                  : formatPlaybackDuration(value);
              },
              maxTicksLimit: detailMode ? 6 : 4,
            },
          },
          y: {
            min: yMin,
            max: yMax,
            grace: detailMode ? 0 : getMetricYGrace(metricConfig.metricKey, detailMode),
            grid: {
              color: palette.axis,
              drawBorder: false,
            },
            ticks: {
              color: palette.label,
              callback(value) {
                return metricConfig.tickFormatter(value);
              },
              maxTicksLimit: detailMode ? 6 : 5,
            },
          },
        },
      },
    });
  }

  function applyPlaybackCursor(chart, cursorValue, palette, detailMode = false) {
    if (!chart) return;
    chart.$replayCursorValue = cursorValue;
    chart.$replayCursorColor = palette.cursor;
    chart.$replayCursorWidth = detailMode ? 2 : 1.5;
    chart.$replayCursorDash = detailMode ? [] : [5, 5];
    chart.draw();
  }

  function getCursorValue(playbackPoint) {
    return activeAxisMode === "distance"
      ? Math.max(0, playbackPoint.totalDistanceM ?? 0)
      : (Math.max(0, playbackPoint.elapsedMs ?? 0) / 1000);
  }

  function renderOverviewCharts() {
    destroyChartMap(overviewCharts);
    overviewCharts = {
      speedMs: null,
      altitudeM: null,
      headingDeg: null,
    };

    if (!activeSession) return;

    const axisRange = getOverviewAxisRange();
    overviewCharts.speedMs = createMetricChart({
      canvas: elements.speedCanvas,
      metricKey: "speedMs",
      axisRange,
    });
    overviewCharts.altitudeM = createMetricChart({
      canvas: elements.altitudeCanvas,
      metricKey: "altitudeM",
      axisRange,
    });
    overviewCharts.headingDeg = createMetricChart({
      canvas: elements.headingCanvas,
      metricKey: "headingDeg",
      axisRange,
    });
  }

  function renderDetailCharts() {
    destroyChartMap(detailCharts);
    detailCharts = {
      speedMs: null,
      altitudeM: null,
      headingDeg: null,
    };

    if (!detailOpen || !activeSession) return;

    const axisRange = getDetailAxisRange();
    detailCharts.speedMs = createMetricChart({
      canvas: elements.detailSpeedCanvas,
      metricKey: "speedMs",
      axisRange,
      detailMode: true,
    });
    detailCharts.altitudeM = createMetricChart({
      canvas: elements.detailAltitudeCanvas,
      metricKey: "altitudeM",
      axisRange,
      detailMode: true,
    });
    detailCharts.headingDeg = createMetricChart({
      canvas: elements.detailHeadingCanvas,
      metricKey: "headingDeg",
      axisRange,
      detailMode: true,
    });
  }

  function renderSession(session, axisMode = "time") {
    activeSession = session;
    activeAxisMode = axisMode === "distance" ? "distance" : "time";
    renderOverviewCharts();
    renderDetailCharts();
    updatePlayback(lastPlaybackPoint);
  }

  function updatePlayback(playbackPoint = {}) {
    const safePlaybackPoint = playbackPoint && typeof playbackPoint === "object"
      ? playbackPoint
      : {};
    const palette = getSharedPalette();
    const cursorValue = getCursorValue(safePlaybackPoint);

    lastPlaybackPoint = {
      elapsedMs: Math.max(0, safePlaybackPoint.elapsedMs ?? 0),
      totalDistanceM: Math.max(0, safePlaybackPoint.totalDistanceM ?? 0),
    };

    for (const chart of Object.values(overviewCharts)) {
      applyPlaybackCursor(chart, cursorValue, palette, false);
    }

    for (const chart of Object.values(detailCharts)) {
      applyPlaybackCursor(chart, cursorValue, palette, true);
    }
  }

  function setDetailOpen(nextOpen) {
    const normalizedOpen = Boolean(nextOpen);
    if (detailOpen === normalizedOpen && (!detailOpen || detailCharts.speedMs)) {
      return;
    }

    detailOpen = normalizedOpen;
    renderDetailCharts();
    updatePlayback(lastPlaybackPoint);
  }

  function setDetailRange(startRatio, endRatio) {
    const normalizedRange = getReplayAxisRange(1, startRatio, endRatio);
    if (
      detailRangeStartRatio === normalizedRange.startRatio
      && detailRangeEndRatio === normalizedRange.endRatio
    ) {
      return;
    }

    detailRangeStartRatio = normalizedRange.startRatio;
    detailRangeEndRatio = normalizedRange.endRatio;
    renderDetailCharts();
    updatePlayback(lastPlaybackPoint);
  }

  function getDetailAxisValueFromClientX(metricKey, clientX) {
    const normalizedMetricKey = normalizeDetailMetricKey(metricKey);
    const chart = detailCharts[normalizedMetricKey];
    if (!chart?.canvas || !Number.isFinite(clientX)) return null;

    const xScale = chart.scales?.x;
    const axisRange = getDetailAxisRange();
    const rect = chart.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;

    if (typeof xScale?.getValueForPixel === "function") {
      const value = xScale.getValueForPixel(localX);
      return Number.isFinite(value)
        ? clamp(value, axisRange.min, axisRange.max)
        : null;
    }

    const chartArea = chart.chartArea || {
      left: 0,
      right: rect.width,
    };
    const ratio = clamp(
      (localX - chartArea.left) / Math.max(1, chartArea.right - chartArea.left),
      0,
      1,
    );
    return axisRange.min + ((axisRange.max - axisRange.min) * ratio);
  }

  return {
    destroy: destroyCharts,
    getDetailAxisValueFromClientX,
    renderSession,
    setDetailOpen,
    setDetailRange,
    updatePlayback,
  };
}
