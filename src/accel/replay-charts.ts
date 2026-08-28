function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeHeadingDegrees(value) {
  if (!Number.isFinite(value)) return null;
  return ((value % 360) + 360) % 360;
}

function getHeadingDeltaDegrees(leftHeadingDeg, rightHeadingDeg) {
  const left = normalizeHeadingDegrees(leftHeadingDeg);
  const right = normalizeHeadingDegrees(rightHeadingDeg);

  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  let delta = right - left;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function getAxisRange(axisMax, startRatio = 0, endRatio = 1) {
  const safeAxisMax = Number.isFinite(axisMax) && axisMax > 0 ? axisMax : 0;

  if (safeAxisMax <= 0) {
    return {
      startRatio: 0,
      endRatio: 1,
      min: 0,
      max: 1,
    };
  }

  let safeStartRatio = Number.isFinite(startRatio) ? startRatio : 0;
  let safeEndRatio = Number.isFinite(endRatio) ? endRatio : 1;

  safeStartRatio = clamp(safeStartRatio, 0, 1);
  safeEndRatio = clamp(safeEndRatio, 0, 1);

  if (safeStartRatio > safeEndRatio) {
    [safeStartRatio, safeEndRatio] = [safeEndRatio, safeStartRatio];
  }

  const minGapRatio = 0.02;
  if ((safeEndRatio - safeStartRatio) < minGapRatio) {
    if (safeEndRatio >= 1) {
      safeEndRatio = 1;
      safeStartRatio = Math.max(0, safeEndRatio - minGapRatio);
    } else {
      safeEndRatio = Math.min(1, safeStartRatio + minGapRatio);
      if ((safeEndRatio - safeStartRatio) < minGapRatio) {
        safeStartRatio = Math.max(0, safeEndRatio - minGapRatio);
      }
    }
  }

  return {
    startRatio: safeStartRatio,
    endRatio: safeEndRatio,
    min: safeAxisMax * safeStartRatio,
    max: safeAxisMax * safeEndRatio,
  };
}

const accelReplayCursorPlugin = {
  id: "accelReplayCursor",
  afterDatasetsDraw(chart) {
    if (!chart || !chart.chartArea || !chart.scales?.x || !Number.isFinite(chart.$accelReplayCursorValue)) {
      return;
    }

    const x = chart.scales.x.getPixelForValue(chart.$accelReplayCursorValue);
    if (!Number.isFinite(x)) return;

    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = chart.$accelReplayCursorColor || "rgba(16, 185, 129, 0.82)";
    ctx.lineWidth = chart.$accelReplayCursorWidth || 1.5;
    ctx.setLineDash(chart.$accelReplayCursorDash || [5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, chart.chartArea.top);
    ctx.lineTo(x, chart.chartArea.bottom);
    ctx.stroke();

    if (Number.isFinite(chart.$accelReplayCursorYValue) && chart.scales?.y) {
      const y = chart.scales.y.getPixelForValue(chart.$accelReplayCursorYValue);
      if (Number.isFinite(y)) {
        ctx.setLineDash([]);
        ctx.fillStyle = chart.$accelReplayCursorColor || "rgba(16, 185, 129, 0.82)";
        ctx.strokeStyle = chart.$accelReplayCursorOutline || "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
  },
};

type AccelReplayChartLike = {
  destroy(): void;
  [key: string]: any;
};

export function createAccelReplayChartsController({
  Chart,
  elements,
  convertDistanceMeasurement,
  formatNumber,
  getDistanceUnit,
  getDistanceUnitLabel,
  getSpeedUnit,
  getSpeedUnitLabel,
  isFiniteNumber,
  msToSpeedUnit,
}) {
  let activeSource = null;
  let activeAxisMode = "time";
  let activeRangeStartRatio = 0;
  let activeRangeEndRatio = 1;
  let renderKey = "";
  let activeCharts = {
    speedMs: null,
    altitudeM: null,
    headingDeg: null,
  };
  let activeSeries = {
    speedMs: null,
    altitudeM: null,
    headingDeg: null,
  };

  function getCssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function getPalette(metricKey) {
    const shared = {
      axis: getCssColor("--accel-border", "rgba(17, 24, 39, 0.14)"),
      label: getCssColor("--accel-muted", "#8d8f95"),
      cursor: getCssColor("--accel-accent", "#10b981"),
      cursorOutline: getCssColor("--accel-chip-fg", "#f7f8fa"),
    };

    if (metricKey === "altitudeM") {
      return {
        ...shared,
        line: getCssColor("--accel-replay-altitude-line", "#f97316"),
        fill: getCssColor("--accel-replay-altitude-fill", "rgba(249, 115, 22, 0.16)"),
      };
    }

    if (metricKey === "headingDeg") {
      return {
        ...shared,
        line: getCssColor("--accel-replay-heading-line", "#3b82f6"),
        fill: getCssColor("--accel-replay-heading-fill", "rgba(59, 130, 246, 0.16)"),
      };
    }

    return {
      ...shared,
      line: getCssColor("--accel-accent", "#10b981"),
      fill: getCssColor("--accel-accent-soft", "rgba(16, 185, 129, 0.16)"),
    };
  }

  function getAxisMaxValue() {
    if (!activeSource) return 1;
    if (activeAxisMode === "distance") {
      return Math.max(0.1, activeSource.totalDistanceM || 0);
    }
    return Math.max(0.1, (activeSource.durationMs || 0) / 1000);
  }

  function getCurrentAxisRange() {
    return getAxisRange(getAxisMaxValue(), activeRangeStartRatio, activeRangeEndRatio);
  }

  function formatDistanceAxisValue(distanceM) {
    const distanceUnit = getDistanceUnit();
    const convertedDistance = convertDistanceMeasurement(distanceM, distanceUnit);
    const decimals = convertedDistance >= 100 ? 0 : 1;
    return `${formatNumber(convertedDistance, decimals)} ${getDistanceUnitLabel(distanceUnit)}`;
  }

  function getAxisTickLabel(value) {
    if (activeAxisMode === "distance") {
      return formatDistanceAxisValue(Number(value));
    }

    const axisMax = getAxisMaxValue();
    const decimals = axisMax >= 10 ? 1 : 2;
    return `${formatNumber(Number(value), decimals)} s`;
  }

  function buildMetricSeries(metricKey) {
    if (activeSeries[metricKey]) return activeSeries[metricKey];
    if (!activeSource || !Array.isArray(activeSource.frames) || !activeSource.frames.length) {
      activeSeries[metricKey] = [];
      return activeSeries[metricKey];
    }

    const series = [];
    let previousHeadingValue = null;

    for (let index = 0; index < activeSource.frames.length; index += 1) {
      const frame = activeSource.frames[index];
      const elapsedSeconds = Math.max(0, frame.elapsedMs || 0) / 1000;
      const distanceM = isFiniteNumber(frame.distanceM) ? Math.max(0, frame.distanceM) : 0;
      const xValue = activeAxisMode === "distance" ? distanceM : elapsedSeconds;
      if (!isFiniteNumber(xValue)) continue;

      let value = null;
      if (metricKey === "speedMs") {
        value = isFiniteNumber(frame.speedMs) ? frame.speedMs : null;
      } else if (metricKey === "altitudeM") {
        value = isFiniteNumber(frame.altitudeM) ? frame.altitudeM : null;
      } else if (metricKey === "headingDeg") {
        const heading = normalizeHeadingDegrees(frame.headingDeg);
        if (isFiniteNumber(heading)) {
          if (!isFiniteNumber(previousHeadingValue)) {
            value = heading;
          } else {
            const previousHeading = normalizeHeadingDegrees(previousHeadingValue);
            const delta = getHeadingDeltaDegrees(previousHeading, heading);
            value = previousHeadingValue + (delta ?? 0);
          }
          previousHeadingValue = value;
        }
      }

      if (!isFiniteNumber(value)) continue;
      series.push({
        key: frame.key || `${metricKey}-${index + 1}`,
        xValue,
        value,
      });
    }

    activeSeries[metricKey] = series;
    return series;
  }

  function hasMetricData(metricKey) {
    return buildMetricSeries(metricKey).length >= 2;
  }

  function addInterpolatedDomainValue(values, series, targetX) {
    if (!Number.isFinite(targetX) || !series.length) return;

    if (targetX <= series[0].xValue) {
      values.push(series[0].value);
      return;
    }

    for (let index = 1; index < series.length; index += 1) {
      const left = series[index - 1];
      const right = series[index];

      if (targetX < left.xValue || targetX > right.xValue) continue;

      const span = right.xValue - left.xValue;
      if (span <= 0) {
        values.push(left.value);
        return;
      }

      const ratio = clamp((targetX - left.xValue) / span, 0, 1);
      values.push(left.value + ((right.value - left.value) * ratio));
      return;
    }

    values.push(series[series.length - 1].value);
  }

  function getMetricDomain(metricKey, axisRange) {
    const series = buildMetricSeries(metricKey);
    if (!series.length) return null;

    const globalMinX = series[0].xValue;
    const globalMaxX = series[series.length - 1].xValue;
    let rangeMin = Number.isFinite(axisRange?.min) ? axisRange.min : globalMinX;
    let rangeMax = Number.isFinite(axisRange?.max) ? axisRange.max : globalMaxX;

    rangeMin = clamp(rangeMin, globalMinX, globalMaxX);
    rangeMax = clamp(rangeMax, globalMinX, globalMaxX);

    if (rangeMin > rangeMax) {
      [rangeMin, rangeMax] = [rangeMax, rangeMin];
    }

    const values = [];
    addInterpolatedDomainValue(values, series, rangeMin);
    addInterpolatedDomainValue(values, series, rangeMax);

    for (let index = 0; index < series.length; index += 1) {
      const point = series[index];
      if (point.xValue < rangeMin || point.xValue > rangeMax) continue;
      values.push(point.value);
    }

    if (!values.length) return null;

    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  function getMetricTickFormatter(metricKey) {
    if (metricKey === "altitudeM") {
      const unit = getDistanceUnitLabel(getDistanceUnit());
      return (value) => `${formatNumber(convertDistanceMeasurement(Number(value), getDistanceUnit()), 0)} ${unit}`;
    }

    if (metricKey === "headingDeg") {
      return (value) => `${Math.round(normalizeHeadingDegrees(Number(value)) || 0)}°`;
    }

    const unit = getSpeedUnitLabel(getSpeedUnit());
    return (value) => `${formatNumber(msToSpeedUnit(Number(value), getSpeedUnit()), 0)} ${unit}`;
  }

  function getMetricBounds(metricKey, axisRange) {
    const domain = getMetricDomain(metricKey, axisRange);
    if (!domain) return null;

    let min = domain.min;
    let max = domain.max;

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

    if (metricKey === "speedMs") {
      min = 0;
    }

    if (max <= min) {
      const fallbackPadding = metricKey === "headingDeg"
        ? 4
        : Math.max(1, Math.abs(max || min) * 0.08);
      min -= fallbackPadding;
      max += fallbackPadding;
    } else if (metricKey !== "headingDeg") {
      const padding = Math.max(0.5, (max - min) * 0.08);
      min -= padding;
      max += padding;
      if (metricKey === "speedMs") min = Math.max(0, min);
    }

    return { min, max };
  }

  function createMetricChart(metricKey, canvas) {
    if (!canvas) return null;

    const series = buildMetricSeries(metricKey);
    if (series.length < 2) return null;

    const palette = getPalette(metricKey);
    const axisRange = getCurrentAxisRange();
    const bounds = getMetricBounds(metricKey, axisRange);

    return new Chart(canvas, {
      type: "line",
      plugins: [accelReplayCursorPlugin],
      data: {
        datasets: [
          {
            data: series.map((point) => ({
              x: point.xValue,
              y: point.value,
            })),
            parsing: false,
            normalized: true,
            borderColor: palette.line,
            backgroundColor: palette.fill,
            borderWidth: 2.4,
            clip: 10,
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
          legend: { display: false },
          tooltip: { enabled: false },
        },
        layout: {
          padding: {
            left: 0,
            right: 0,
            top: 4,
            bottom: 4,
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
              maxTicksLimit: 6,
              callback(value) {
                return getAxisTickLabel(value);
              },
            },
          },
          y: {
            min: bounds?.min,
            max: bounds?.max,
            grid: {
              color: palette.axis,
              drawBorder: false,
            },
            ticks: {
              color: palette.label,
              maxTicksLimit: 5,
              callback(value) {
                return getMetricTickFormatter(metricKey)(value);
              },
            },
          },
        },
      },
    });
  }

  function destroyChartMap(chartMap: Record<string, AccelReplayChartLike | null>) {
    for (const chart of Object.values(chartMap)) {
      if (chart) chart.destroy();
    }
  }

  function destroy() {
    destroyChartMap(activeCharts);
    activeCharts = {
      speedMs: null,
      altitudeM: null,
      headingDeg: null,
    };
    activeSeries = {
      speedMs: null,
      altitudeM: null,
      headingDeg: null,
    };
    renderKey = "";
  }

  function renderSource(
    source,
    axisMode = "time",
    startRatio = 0,
    endRatio = 1,
    selectedMetricKey = null
  ) {
    activeSource = source;
    activeAxisMode = axisMode === "distance" ? "distance" : "time";
    const axisRange = getAxisRange(1, startRatio, endRatio);
    activeRangeStartRatio = axisRange.startRatio;
    activeRangeEndRatio = axisRange.endRatio;

    if (!source) {
      destroy();
      return;
    }

    const nextRenderKey = [
      source.resultId || "unknown",
      source.durationMs || 0,
      source.totalDistanceM || 0,
      activeAxisMode,
      activeRangeStartRatio,
      activeRangeEndRatio,
      getSpeedUnit(),
      getDistanceUnit(),
      selectedMetricKey || "all",
    ].join(":");
    if (renderKey === nextRenderKey && (activeCharts.speedMs || activeCharts.altitudeM || activeCharts.headingDeg)) {
      return;
    }

    destroy();
    renderKey = nextRenderKey;

    if (!selectedMetricKey || selectedMetricKey === "speedMs") {
      activeCharts.speedMs = createMetricChart("speedMs", elements.replayDetailSpeedCanvas);
    }
    if (!selectedMetricKey || selectedMetricKey === "altitudeM") {
      activeCharts.altitudeM = createMetricChart("altitudeM", elements.replayDetailAltitudeCanvas);
    }
    if (!selectedMetricKey || selectedMetricKey === "headingDeg") {
      activeCharts.headingDeg = createMetricChart("headingDeg", elements.replayDetailHeadingCanvas);
    }
  }

  function getPlaybackCursorValue(frame) {
    if (!frame) return 0;
    if (activeAxisMode === "distance") {
      return isFiniteNumber(frame.distanceM) ? Math.max(0, frame.distanceM) : 0;
    }
    return Math.max(0, frame.elapsedMs || 0) / 1000;
  }

  function getPlaybackMetricValue(frame, metricKey) {
    if (!frame) return null;

    const series = buildMetricSeries(metricKey);
    if (!series.length) return null;

    const cursorValue = getPlaybackCursorValue(frame);
    if (cursorValue <= series[0].xValue) return series[0].value;

    for (let index = 1; index < series.length; index += 1) {
      const left = series[index - 1];
      const right = series[index];

      if (cursorValue > right.xValue) continue;

      const span = right.xValue - left.xValue;
      if (span <= 0) return left.value;
      const ratio = clamp((cursorValue - left.xValue) / span, 0, 1);
      return left.value + ((right.value - left.value) * ratio);
    }

    return series[series.length - 1].value;
  }

  function updatePlayback(frame) {
    const cursorValue = getPlaybackCursorValue(frame);

    for (const [metricKey, chart] of Object.entries(activeCharts)) {
      if (!chart) continue;
      const palette = getPalette(metricKey);
      chart.$accelReplayCursorValue = cursorValue;
      chart.$accelReplayCursorYValue = getPlaybackMetricValue(frame, metricKey);
      chart.$accelReplayCursorColor = palette.cursor;
      chart.$accelReplayCursorOutline = palette.cursorOutline;
      chart.$accelReplayCursorDash = [];
      chart.$accelReplayCursorWidth = 2;
      chart.draw();
    }
  }

  function getAxisValueFromClientX(metricKey, clientX) {
    const chart = activeCharts[metricKey];
    if (!chart?.canvas || !Number.isFinite(clientX)) return null;

    const xScale = chart.scales?.x;
    const rect = chart.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const axisRange = getCurrentAxisRange();

    if (typeof xScale?.getValueForPixel === "function") {
      const value = xScale.getValueForPixel(localX);
      return Number.isFinite(value) ? clamp(value, axisRange.min, axisRange.max) : null;
    }

    const chartArea = chart.chartArea || { left: 0, right: rect.width };
    const ratio = clamp((localX - chartArea.left) / Math.max(1, chartArea.right - chartArea.left), 0, 1);
    return axisRange.min + ((axisRange.max - axisRange.min) * ratio);
  }

  return {
    destroy,
    getAxisValueFromClientX,
    hasMetricData,
    renderSource,
    updatePlayback,
  };
}
