import Chart from "chart.js/auto";
import {
  buildReplayMetricSeries,
  formatReplayDistanceValue,
  formatReplaySpeedValue,
  getReplaySummary,
} from "./logic.js";

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
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
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

export function createReplayChartsController({
  elements,
  getSpeedUnit,
  getDistanceUnit,
}) {
  let activeSession = null;
  let activeAxisMode = "time";
  let charts = {
    speed: null,
    altitude: null,
    heading: null,
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

    return `${formatAxisNumber(distanceValue, distanceUnit === "m" ? 0 : 0)} ${distanceUnit === "ft" ? "ft" : "m"}`;
  }

  function getCssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function getPalette() {
    return {
      line: getCssColor("--replay-accent-strong", "#10b981"),
      fill: getCssColor("--replay-accent-soft", "rgba(16, 185, 129, 0.16)"),
      axis: getCssColor("--replay-border", "rgba(17, 24, 39, 0.12)"),
      label: getCssColor("--replay-muted", "rgba(17, 24, 39, 0.66)"),
      cursor: getCssColor("--replay-track", "rgba(52, 211, 153, 0.82)"),
    };
  }

  function destroyCharts() {
    for (const chart of Object.values(charts)) {
      if (chart) chart.destroy();
    }
    charts = {
      speed: null,
      altitude: null,
      heading: null,
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

  function createMetricChart({
    canvas,
    metricKey,
    tickFormatter,
    min,
    max,
  }) {
    if (!canvas) return null;

    const palette = getPalette();

    return new Chart(canvas, {
      type: "line",
      plugins: [replayCursorPlugin],
      data: {
        datasets: [
          {
            data: buildMetricDataset(metricKey),
            parsing: false,
            normalized: true,
            borderColor: palette.line,
            backgroundColor: palette.fill,
            borderWidth: 2.5,
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
            top: 0,
            bottom: 0,
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: getAxisMax(),
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
              maxTicksLimit: 4,
            },
          },
          y: {
            min,
            max,
            grid: {
              color: palette.axis,
              drawBorder: false,
            },
            ticks: {
              color: palette.label,
              callback(value) {
                return tickFormatter(value);
              },
              maxTicksLimit: 5,
            },
          },
        },
      },
    });
  }

  function renderSession(session, axisMode = "time") {
    activeSession = session;
    activeAxisMode = axisMode === "distance" ? "distance" : "time";
    destroyCharts();

    if (!activeSession) return;

    const speedUnit = getSpeedUnit();
    const distanceUnit = getDistanceUnit();

    charts.speed = createMetricChart({
      canvas: elements.speedCanvas,
      metricKey: "speedMs",
      min: 0,
      tickFormatter: (value) => `${Math.round(formatReplaySpeedValue(value, speedUnit))} ${speedUnit === "mph" ? "mph" : "km/h"}`,
    });

    charts.altitude = createMetricChart({
      canvas: elements.altitudeCanvas,
      metricKey: "altitudeM",
      tickFormatter: (value) => `${Math.round(formatReplayDistanceValue(value, distanceUnit))} ${distanceUnit === "ft" ? "ft" : "m"}`,
    });

    charts.heading = createMetricChart({
      canvas: elements.headingCanvas,
      metricKey: "headingDeg",
      min: 0,
      max: 360,
      tickFormatter: (value) => `${Math.round(value)}°`,
    });

    updatePlayback({ elapsedMs: 0, totalDistanceM: 0 });
  }

  function updatePlayback(playbackPoint = {}) {
    const safePlaybackPoint = playbackPoint && typeof playbackPoint === "object"
      ? playbackPoint
      : {};
    const cursorValue = activeAxisMode === "distance"
      ? Math.max(0, safePlaybackPoint.totalDistanceM ?? 0)
      : (Math.max(0, safePlaybackPoint.elapsedMs ?? 0) / 1000);
    const palette = getPalette();

    for (const chart of Object.values(charts)) {
      if (!chart) continue;
      chart.$replayCursorValue = cursorValue;
      chart.$replayCursorColor = palette.cursor;
      chart.draw();
    }
  }

  return {
    destroy: destroyCharts,
    renderSession,
    updatePlayback,
  };
}
