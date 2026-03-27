import Chart from "chart.js/auto";
import { buildReplayMetricSeries, formatReplayDistanceValue, formatReplaySpeedValue } from "./logic.js";

const replayCursorPlugin = {
  id: "replayCursor",
  afterDatasetsDraw(chart) {
    if (!chart || !chart.chartArea || !chart.scales?.x || !Number.isFinite(chart.$replayCursorValueSeconds)) {
      return;
    }

    const xScale = chart.scales.x;
    const ctx = chart.ctx;
    const x = xScale.getPixelForValue(chart.$replayCursorValueSeconds);

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
  let charts = {
    speed: null,
    altitude: null,
    heading: null,
  };

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
    const series = buildReplayMetricSeries(activeSession, metricKey);
    return series.map((point) => ({
      x: point.elapsedSeconds,
      y: point.value,
    }));
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
            grid: {
              color: palette.axis,
              drawBorder: false,
            },
            ticks: {
              color: palette.label,
              callback(value) {
                return formatPlaybackDuration(value);
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

  function renderSession(session) {
    activeSession = session;
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

    updatePlayback(0);
  }

  function updatePlayback(elapsedMs) {
    const cursorValueSeconds = Math.max(0, elapsedMs) / 1000;
    const palette = getPalette();

    for (const chart of Object.values(charts)) {
      if (!chart) continue;
      chart.$replayCursorValueSeconds = cursorValueSeconds;
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
