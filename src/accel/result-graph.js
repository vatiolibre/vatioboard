export function createAccelResultGraph({
  Chart,
  elements,
  getDisplayedResult,
  getLang,
  getState,
  isFiniteNumber,
  compactSpeedTrace,
  msToSpeedUnit,
  formatDistanceMeasurement,
  formatNumber,
  formatRunDistance,
  formatRunSeconds,
  formatSlopePercent,
  formatSpeedValue,
  getSpeedUnitLabel,
  t,
  resultGraphHeight,
}) {
  let resultGraphChart = null;
  let resultGraphResizeObserver = null;
  let resultGraphRefreshFrame = 0;
  let resultGraphRenderKey = "";
  let resultGraphSelectionResultId = "";
  let resultGraphSelectionPointKey = "";
  let resultGraphObservedPanelWidth = 0;

  const resultGraphGuidePlugin = {
    id: "resultGraphGuide",
    afterDatasetsDraw(chart, args, options) {
      if (!chart || !chart.tooltip || !chart.chartArea) return;

      const activeElements = chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!activeElements || !activeElements.length) return;

      const activeElement = activeElements[0].element;
      if (!activeElement || !isFiniteNumber(activeElement.x) || !isFiniteNumber(activeElement.y)) return;

      const chartArea = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = options && options.color ? options.color : "rgba(128, 128, 128, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(activeElement.x, chartArea.top);
      ctx.lineTo(activeElement.x, chartArea.bottom);
      ctx.moveTo(chartArea.left, activeElement.y);
      ctx.lineTo(chartArea.right, activeElement.y);
      ctx.stroke();
      ctx.restore();
    },
  };

  function getTraceSlopePercent(startAltitudeM, altitudeM, distanceM) {
    if (!isFiniteNumber(startAltitudeM) || !isFiniteNumber(altitudeM) || !isFiniteNumber(distanceM) || distanceM < 1) return null;
    return ((altitudeM - startAltitudeM) / distanceM) * 100;
  }

  function buildGraphDataFromTraceSource(source) {
    if (!source || !Array.isArray(source.speedTrace) || !source.speedTrace.length) return [];

    const trace = compactSpeedTrace(source.speedTrace);
    const speedUnit = getState().settings.speedUnit;
    const graphData = [];

    for (let index = 0; index < trace.length; index += 1) {
      const point = trace[index];
      const distanceM = isFiniteNumber(point.distanceM) ? point.distanceM : null;
      const altitudeM = isFiniteNumber(point.altitudeM) ? point.altitudeM : null;

      graphData.push({
        key: `${String(index)}-${String(point.elapsedMs)}`,
        elapsedMs: point.elapsedMs,
        elapsedSeconds: point.elapsedMs / 1000,
        speedMs: point.speedMs,
        speedDisplay: msToSpeedUnit(point.speedMs, speedUnit),
        distanceM,
        altitudeM,
        accuracyM: isFiniteNumber(point.accuracyM) ? point.accuracyM : null,
        speedSource: typeof point.speedSource === "string" ? point.speedSource : null,
        slopePercent: getTraceSlopePercent(source.startAltitudeM, altitudeM, distanceM),
      });
    }

    return graphData;
  }

  function buildResultGraphData(result) {
    return buildGraphDataFromTraceSource(result);
  }

  function renderResultGraphDetails(point) {
    if (!elements.resultGraphTimeValue) return;

    elements.resultGraphTimeValue.textContent = point ? `${formatRunSeconds(point.elapsedMs)} s` : "—";
    elements.resultGraphSpeedValue.textContent = point && isFiniteNumber(point.speedMs) ? formatSpeedValue(point.speedMs, getState().settings.speedUnit) : "—";
    elements.resultGraphDistanceValue.textContent = point && isFiniteNumber(point.distanceM) ? formatRunDistance(point.distanceM) : "—";
    elements.resultGraphAltitudeValue.textContent = point && isFiniteNumber(point.altitudeM) ? formatDistanceMeasurement(point.altitudeM) : "—";
    elements.resultGraphAccuracyValue.textContent = point && isFiniteNumber(point.accuracyM) ? formatDistanceMeasurement(point.accuracyM) : "—";
    elements.resultGraphSlopeValue.textContent = point && isFiniteNumber(point.slopePercent) ? formatSlopePercent(point.slopePercent) : "—";
  }

  function getPreferredResultGraphFallbackPoint(graphData) {
    if (!Array.isArray(graphData) || !graphData.length) return null;

    for (let index = graphData.length - 1; index >= 0; index -= 1) {
      if (isFiniteNumber(graphData[index].slopePercent)) return graphData[index];
    }

    for (let detailIndex = graphData.length - 1; detailIndex >= 0; detailIndex -= 1) {
      const point = graphData[detailIndex];
      if (isFiniteNumber(point.distanceM) || isFiniteNumber(point.altitudeM) || isFiniteNumber(point.accuracyM)) {
        return point;
      }
    }

    return graphData[graphData.length - 1];
  }

  function getSelectedResultGraphPoint(result, graphData) {
    if (result && result.id === resultGraphSelectionResultId && resultGraphSelectionPointKey) {
      for (let index = 0; index < graphData.length; index += 1) {
        if (graphData[index].key === resultGraphSelectionPointKey) return graphData[index];
      }
    }

    const fallbackPoint = getPreferredResultGraphFallbackPoint(graphData);
    resultGraphSelectionResultId = result ? result.id : "";
    resultGraphSelectionPointKey = fallbackPoint ? fallbackPoint.key : "";
    return fallbackPoint;
  }

  function getResultGraphSelectedIndex(selectedPoint, graphData) {
    if (!selectedPoint || !graphData || !graphData.length) return -1;

    for (let index = 0; index < graphData.length; index += 1) {
      if (graphData[index].key === selectedPoint.key) return index;
    }

    return graphData.length - 1;
  }

  function buildResultGraphTooltipLines(rawPoint) {
    if (!rawPoint) return [];

    return [
      `${t("accelGraphPointDistance")}: ${isFiniteNumber(rawPoint.distanceM) ? formatRunDistance(rawPoint.distanceM) : "—"}`,
      `${t("altitude")}: ${isFiniteNumber(rawPoint.altitudeM) ? formatDistanceMeasurement(rawPoint.altitudeM) : "—"}`,
      `${t("accelGraphPointAccuracy")}: ${isFiniteNumber(rawPoint.accuracyM) ? formatDistanceMeasurement(rawPoint.accuracyM) : "—"}`,
      `${t("accelGraphPointSlope")}: ${isFiniteNumber(rawPoint.slopePercent) ? formatSlopePercent(rawPoint.slopePercent) : "—"}`,
    ];
  }

  function getCssColorValue(name, fallback) {
    const sourceElement = elements.resultGraphFrame || elements.liveSpeedGaugeStage || document.documentElement;
    const value = getComputedStyle(sourceElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function getResultGraphPalette() {
    return {
      line: getCssColorValue("--accel-accent", "#10b981"),
      area: getCssColorValue("--accel-accent-soft", "rgba(16, 185, 129, 0.18)"),
      axis: getCssColorValue("--accel-border", "rgba(17, 24, 39, 0.22)"),
      grid: getCssColorValue("--accel-border", "rgba(17, 24, 39, 0.14)"),
      label: getCssColorValue("--accel-muted", "#8d8f95"),
      crosshair: getCssColorValue("--accel-muted", "rgba(141, 143, 149, 0.64)"),
      markerBackground: getCssColorValue("--accel-surface-strong", "#181a20"),
      markerOutline: getCssColorValue("--accel-chip-fg", "#f7f8fa"),
    };
  }

  function buildResultGraphConfig(result, graphData, selectedPoint) {
    const speedUnit = getState().settings.speedUnit;
    const speedTick = speedUnit === "kmh" ? 20 : 10;
    let maxSpeedDisplay = speedTick;
    let maxElapsedSeconds = 0.1;

    for (let index = 0; index < graphData.length; index += 1) {
      maxSpeedDisplay = Math.max(maxSpeedDisplay, graphData[index].speedDisplay || 0);
      maxElapsedSeconds = Math.max(maxElapsedSeconds, graphData[index].elapsedSeconds || 0);
    }

    const graphMaxSpeedDisplay = Math.max(speedTick, Math.ceil(maxSpeedDisplay / speedTick) * speedTick);
    const palette = getResultGraphPalette();

    return {
      type: "line",
      plugins: [resultGraphGuidePlugin],
      data: {
        datasets: [
          {
            label: t("accelSpeedGraph"),
            data: graphData,
            parsing: {
              xAxisKey: "elapsedSeconds",
              yAxisKey: "speedDisplay",
            },
            normalized: true,
            borderColor: palette.line,
            backgroundColor: palette.area,
            fill: true,
            borderWidth: 3,
            cubicInterpolationMode: "monotone",
            tension: 0.24,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 18,
            pointHoverBorderWidth: 2,
            pointHoverBackgroundColor: palette.line,
            pointHoverBorderColor: palette.markerOutline,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 60,
        events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
        interaction: {
          mode: "nearest",
          intersect: false,
          axis: "xy",
        },
        layout: {
          padding: {
            top: 12,
            right: 14,
            bottom: 8,
            left: 6,
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: maxElapsedSeconds,
            grid: {
              color: palette.grid,
              drawTicks: false,
            },
            border: {
              color: palette.axis,
            },
            ticks: {
              color: palette.label,
              maxTicksLimit: 5,
              padding: 8,
              callback(value) {
                const numericValue = Number(value);
                const decimals = maxElapsedSeconds >= 10 ? 1 : 2;
                return `${formatNumber(numericValue, decimals)} s`;
              },
            },
          },
          y: {
            min: 0,
            max: graphMaxSpeedDisplay,
            grid: {
              color: palette.grid,
              drawTicks: false,
            },
            border: {
              color: palette.axis,
            },
            ticks: {
              color: palette.label,
              maxTicksLimit: 5,
              padding: 8,
              callback(value) {
                return formatNumber(Number(value), 0);
              },
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            displayColors: false,
            backgroundColor: palette.markerBackground,
            titleColor: palette.markerOutline,
            bodyColor: palette.markerOutline,
            borderColor: palette.axis,
            borderWidth: 1,
            cornerRadius: 12,
            padding: 12,
            caretSize: 6,
            caretPadding: 10,
            bodySpacing: 4,
            titleSpacing: 6,
            callbacks: {
              title(items) {
                if (!items || !items.length || !items[0].raw) return "";
                return `${formatRunSeconds(items[0].raw.elapsedMs)} s`;
              },
              label(context) {
                return context && context.raw ? formatSpeedValue(context.raw.speedMs, getState().settings.speedUnit) : "";
              },
              afterLabel(context) {
                return buildResultGraphTooltipLines(context ? context.raw : null);
              },
            },
          },
          resultGraphGuide: {
            color: palette.crosshair,
          },
        },
        onHover(event, activeElements, chart) {
          handleResultGraphInteraction(chart, activeElements);
        },
        onClick(event, activeElements, chart) {
          handleResultGraphInteraction(chart, activeElements);
        },
      },
    };
  }

  function setResultGraphActivePoint(chart, index) {
    if (!chart || index < 0) return;

    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data[index]) return;

    const pointElement = meta.data[index];
    const pointPosition = pointElement.getProps
      ? pointElement.getProps(["x", "y"], true)
      : { x: pointElement.x, y: pointElement.y };
    const activeElements = [{ datasetIndex: 0, index }];

    chart.setActiveElements(activeElements);
    if (chart.tooltip && typeof chart.tooltip.setActiveElements === "function") {
      chart.tooltip.setActiveElements(activeElements, pointPosition);
    }
    chart.update("none");
    handleResultGraphInteraction(chart, activeElements);
  }

  function handleResultGraphInteraction(chart, activeElements) {
    if (!chart || !activeElements || !activeElements.length) return;

    const activePoint = activeElements[0];
    const dataset = chart.data && chart.data.datasets && chart.data.datasets[activePoint.datasetIndex]
      ? chart.data.datasets[activePoint.datasetIndex]
      : null;
    const rawPoint = dataset && Array.isArray(dataset.data) ? dataset.data[activePoint.index] : null;
    if (!rawPoint) return;

    const displayedResult = getDisplayedResult();
    resultGraphSelectionResultId = displayedResult ? displayedResult.id : "";
    resultGraphSelectionPointKey = rawPoint.key || "";
    renderResultGraphDetails(rawPoint);
  }

  function destroy() {
    if (resultGraphRefreshFrame) {
      window.cancelAnimationFrame(resultGraphRefreshFrame);
      resultGraphRefreshFrame = 0;
    }
    if (resultGraphChart) {
      resultGraphChart.destroy();
      resultGraphChart = null;
    }
    resultGraphRenderKey = "";
  }

  function mount(result, graphData, selectedPoint) {
    if (!elements.resultGraphCanvas || !elements.resultGraphFrame || !graphData || graphData.length < 2) return;

    const state = getState();
    const frameWidth = Math.floor(elements.resultGraphFrame.clientWidth || elements.resultGraphFrame.getBoundingClientRect().width || 0);
    if (frameWidth < 120) return;

    const renderKey = [
      result.id,
      state.settings.speedUnit,
      state.settings.distanceUnit,
      getLang(),
      frameWidth,
      resultGraphHeight,
    ].join(":");
    if (renderKey === resultGraphRenderKey) return;

    const canvasElement = elements.resultGraphCanvas;
    canvasElement.style.width = "100%";
    canvasElement.style.height = `${resultGraphHeight}px`;
    const config = buildResultGraphConfig(result, graphData, selectedPoint);
    destroy();
    resultGraphRenderKey = renderKey;
    resultGraphChart = new Chart(canvasElement, config);
    setResultGraphActivePoint(resultGraphChart, getResultGraphSelectedIndex(selectedPoint, graphData));
  }

  function render(result) {
    if (!elements.resultGraphMeta || !elements.resultGraphEmptyState || !elements.resultGraphFrame) return;

    const speedUnit = getState().settings.speedUnit;
    elements.resultGraphMeta.textContent = `${t("accelSpeedGraphLead")} · ${getSpeedUnitLabel(speedUnit)}`;

    if (!result || !Array.isArray(result.speedTrace) || result.speedTrace.length < 2) {
      elements.resultGraphEmptyState.hidden = false;
      elements.resultGraphFrame.hidden = true;
      resultGraphSelectionResultId = "";
      resultGraphSelectionPointKey = "";
      renderResultGraphDetails(null);
      destroy();
      return;
    }

    const graphData = buildResultGraphData(result);
    if (graphData.length < 2) {
      elements.resultGraphEmptyState.hidden = false;
      elements.resultGraphFrame.hidden = true;
      resultGraphSelectionResultId = "";
      resultGraphSelectionPointKey = "";
      renderResultGraphDetails(null);
      destroy();
      return;
    }

    elements.resultGraphEmptyState.hidden = true;
    elements.resultGraphFrame.hidden = false;
    const selectedPoint = getSelectedResultGraphPoint(result, graphData);
    renderResultGraphDetails(selectedPoint);

    if (getState().openPanel !== "results") return;
    mount(result, graphData, selectedPoint);
  }

  function requestRefresh() {
    if (resultGraphRefreshFrame || getState().openPanel !== "results") return;

    resultGraphRefreshFrame = window.requestAnimationFrame(() => {
      resultGraphRefreshFrame = 0;
      render(getDisplayedResult());
    });
  }

  function setupObservers() {
    if (!elements.resultsPanel || typeof ResizeObserver !== "function") return;

    resultGraphResizeObserver = new ResizeObserver(() => {
      const panelWidth = Math.floor(elements.resultsPanel.clientWidth || elements.resultsPanel.getBoundingClientRect().width || 0);
      if (panelWidth < 120 || panelWidth === resultGraphObservedPanelWidth) return;
      resultGraphObservedPanelWidth = panelWidth;
      requestRefresh();
    });
    resultGraphResizeObserver.observe(elements.resultsPanel);
  }

  function noteResultsPanelWidth() {
    if (!elements.resultsPanel) return;
    resultGraphObservedPanelWidth = Math.floor(elements.resultsPanel.clientWidth || elements.resultsPanel.getBoundingClientRect().width || 0);
  }

  return {
    buildGraphDataFromTraceSource,
    destroy,
    noteResultsPanelWidth,
    render,
    requestRefresh,
    setupObservers,
  };
}
