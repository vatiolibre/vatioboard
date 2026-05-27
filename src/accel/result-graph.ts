interface AccelResultGraphRenderOptions {
  axisMode?: string;
  markerPoints?: any[];
  playbackPoint?: any;
  [key: string]: any;
}

export function createAccelResultGraph({
  Chart,
  elements,
  getDisplayedResult,
  getLang,
  getState,
  isFiniteNumber,
  compactSpeedTrace,
  msToSpeedUnit,
  convertDistanceMeasurement,
  formatDistanceMeasurement,
  formatNumber,
  formatRunDistance,
  formatRunSeconds,
  formatSlopePercent,
  formatSpeedValue,
  getDistanceUnitLabel,
  getSpeedUnitLabel,
  t,
  resultGraphHeight,
}) {
  let resultGraphChart = null;
  let resultGraphResizeObserver = null;
  let resultGraphRefreshFrame = 0;
  let resultGraphRenderKey = "";
  let resultGraphRenderOptions: AccelResultGraphRenderOptions = {};
  let resultGraphSelectionResultId = "";
  let resultGraphSelectionPointKey = "";
  let resultGraphObservedPanelWidth = 0;

	  const resultGraphGuidePlugin = {
	    id: "resultGraphGuide",
	    afterDatasetsDraw(chart, args, options) {
	      if (!chart || !chart.tooltip || !chart.chartArea) return;

      const replayCursor = chart.$accelReplayCursor;
      const xScale = chart.scales && chart.scales.x ? chart.scales.x : null;
      if (replayCursor && xScale && isFiniteNumber(replayCursor.xValue)) {
        const x = xScale.getPixelForValue(replayCursor.xValue);
        if (isFiniteNumber(x)) {
          const chartArea = chart.chartArea;
          const ctx = chart.ctx;
          const yScale = chart.scales && chart.scales.y ? chart.scales.y : null;

          ctx.save();
          ctx.strokeStyle = options && options.replayColor ? options.replayColor : "rgba(16, 185, 129, 0.82)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();

          if (yScale && isFiniteNumber(replayCursor.yValue)) {
            const y = yScale.getPixelForValue(replayCursor.yValue);
            if (isFiniteNumber(y)) {
              ctx.fillStyle = options && options.replayColor ? options.replayColor : "rgba(16, 185, 129, 0.82)";
              ctx.strokeStyle = options && options.replayOutline ? options.replayOutline : "#ffffff";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(x, y, 4.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }

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
    const distanceUnit = getState().settings.distanceUnit;
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
        distanceDisplay: isFiniteNumber(distanceM) ? convertDistanceMeasurement(distanceM, distanceUnit) : null,
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

  function getGraphAxisMode(options) {
    return options && options.axisMode === "distance" ? "distance" : "time";
  }

  function getGraphPointAxisValue(point, axisMode) {
    if (!point) return null;
    return axisMode === "distance" ? point.distanceDisplay : point.elapsedSeconds;
  }

  function getGraphPointDisplayValue(point, axisMode) {
    if (!point) return null;
    return axisMode === "distance" ? point.distanceM : point.elapsedMs;
  }

  function buildMarkerDataset(markerPoints, axisMode) {
    if (!Array.isArray(markerPoints) || !markerPoints.length) return [];

    const speedUnit = getState().settings.speedUnit;
    const distanceUnit = getState().settings.distanceUnit;

    return markerPoints
      .filter(Boolean)
      .map((marker, index) => ({
        key: marker.id || `marker-${index}`,
        markerKind: marker.kind || "partial",
        markerLabel: marker.label || "",
        elapsedMs: Math.max(0, marker.elapsedMs || 0),
        elapsedSeconds: Math.max(0, marker.elapsedMs || 0) / 1000,
        distanceM: isFiniteNumber(marker.distanceM) ? Math.max(0, marker.distanceM) : null,
        distanceDisplay: isFiniteNumber(marker.distanceM) ? convertDistanceMeasurement(marker.distanceM, distanceUnit) : null,
        speedMs: isFiniteNumber(marker.speedMs) ? Math.max(0, marker.speedMs) : null,
        speedDisplay: isFiniteNumber(marker.speedMs) ? msToSpeedUnit(marker.speedMs, speedUnit) : null,
        axisValue: axisMode === "distance"
          ? (isFiniteNumber(marker.distanceM) ? convertDistanceMeasurement(marker.distanceM, distanceUnit) : null)
          : Math.max(0, marker.elapsedMs || 0) / 1000,
      }))
      .filter((marker) => isFiniteNumber(marker.axisValue) && isFiniteNumber(marker.speedDisplay));
  }

  function getGraphMaxValue(graphData, axisMode) {
    let maxValue = axisMode === "distance" ? 0 : 0.1;
    const key = axisMode === "distance" ? "distanceDisplay" : "elapsedSeconds";

    for (let index = 0; index < graphData.length; index += 1) {
      if (isFiniteNumber(graphData[index][key])) {
        maxValue = Math.max(maxValue, graphData[index][key]);
      }
    }

    return maxValue;
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

  function _getResultGraphSelectedIndex(selectedPoint, graphData) {
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

  function buildResultGraphConfig(result, graphData, selectedPoint, options) {
    const speedUnit = getState().settings.speedUnit;
    const distanceUnit = getState().settings.distanceUnit;
    const axisMode = getGraphAxisMode(options);
    const markerDataset = buildMarkerDataset(options && options.markerPoints, axisMode);
    const graphMaxAxisValue = getGraphMaxValue(graphData, axisMode);
    const speedTick = speedUnit === "kmh" ? 20 : 10;
    let maxSpeedDisplay = speedTick;

    for (let index = 0; index < graphData.length; index += 1) {
      maxSpeedDisplay = Math.max(maxSpeedDisplay, graphData[index].speedDisplay || 0);
    }

    const graphMaxSpeedDisplay = Math.max(speedTick, Math.ceil(maxSpeedDisplay / speedTick) * speedTick);
    const palette = getResultGraphPalette();
    const xAxisKey = axisMode === "distance" ? "distanceDisplay" : "elapsedSeconds";

    return {
      type: "line",
      plugins: [resultGraphGuidePlugin],
      data: {
        datasets: [
          {
            label: t("accelSpeedGraph"),
            data: graphData,
            parsing: {
              xAxisKey,
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
          {
            type: "scatter",
            label: t("accelPartials"),
            data: markerDataset,
            parsing: {
              xAxisKey,
              yAxisKey: "speedDisplay",
            },
            showLine: false,
            pointRadius(context) {
              return context && context.raw && context.raw.markerKind === "finish" ? 4.5 : 3.5;
            },
            pointHoverRadius(context) {
              return context && context.raw && context.raw.markerKind === "finish" ? 6 : 5;
            },
            pointHitRadius: 18,
            pointBackgroundColor(context) {
              return context && context.raw && context.raw.markerKind === "finish"
                ? palette.markerBackground
                : palette.markerOutline;
            },
            pointBorderColor(context) {
              return context && context.raw && context.raw.markerKind === "finish"
                ? palette.markerOutline
                : palette.line;
            },
            pointBorderWidth(context) {
              return context && context.raw && context.raw.markerKind === "finish" ? 2 : 1.5;
            },
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
            max: graphMaxAxisValue,
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
                if (axisMode === "distance") {
                  const decimals = distanceUnit === "m" ? (graphMaxAxisValue >= 100 ? 0 : 1) : 0;
                  return `${formatNumber(numericValue, decimals)} ${getDistanceUnitLabel(distanceUnit)}`;
                }
                const decimals = graphMaxAxisValue >= 10 ? 1 : 2;
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
                const rawPoint = items[0].raw;
                if (rawPoint.markerLabel) return rawPoint.markerLabel;
	                return `${formatRunSeconds(rawPoint.elapsedMs)} s`;
	              },
	              label(context) {
                if (!context || !context.raw) return "";
                const rawPoint = context.raw;
                if (isFiniteNumber(rawPoint.speedMs)) return formatSpeedValue(rawPoint.speedMs, getState().settings.speedUnit);
                return "";
	              },
	              afterLabel(context) {
                const rawPoint = context ? context.raw : null;
                if (rawPoint && rawPoint.markerLabel) {
                  return buildResultGraphTooltipLines(rawPoint);
                }
	                return buildResultGraphTooltipLines(rawPoint);
	              },
	            },
	          },
	          resultGraphGuide: {
	            color: palette.crosshair,
            replayColor: palette.line,
            replayOutline: palette.markerOutline,
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

  function setResultGraphActivePoint(chart, index, syncDetails = true) {
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
    if (syncDetails) handleResultGraphInteraction(chart, activeElements);
  }

  function handleResultGraphInteraction(chart, activeElements) {
    if (!chart || !activeElements || !activeElements.length) return;
    if (chart.$accelReplayLocked) return;

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

  function getNearestGraphPointIndex(graphData, point, axisMode) {
    if (!Array.isArray(graphData) || !graphData.length || !point) return -1;
    if (point.key) {
      for (let index = 0; index < graphData.length; index += 1) {
        if (graphData[index].key === point.key) return index;
      }
    }

    const targetValue = getGraphPointDisplayValue(point, axisMode);
    if (!isFiniteNumber(targetValue)) return graphData.length - 1;

    let nearestIndex = 0;
    let nearestDistance = Infinity;
    const key = axisMode === "distance" ? "distanceM" : "elapsedMs";
    for (let index = 0; index < graphData.length; index += 1) {
      if (!isFiniteNumber(graphData[index][key])) continue;
      const difference = Math.abs(graphData[index][key] - targetValue);
      if (difference < nearestDistance) {
        nearestDistance = difference;
        nearestIndex = index;
      }
    }

    return nearestIndex;
  }

  function destroy() {
    if (resultGraphRefreshFrame) {
      window.cancelAnimationFrame(resultGraphRefreshFrame);
      resultGraphRefreshFrame = 0;
    }
    if (resultGraphResizeObserver) {
      resultGraphResizeObserver.disconnect();
      resultGraphResizeObserver = null;
    }
    if (resultGraphChart) {
      resultGraphChart.destroy();
      resultGraphChart = null;
    }
    resultGraphRenderKey = "";
    resultGraphRenderOptions = {};
  }

  function mount(result, graphData, selectedPoint, options) {
    if (!elements.resultGraphCanvas || !elements.resultGraphFrame || !graphData || graphData.length < 2) return;

    const state = getState();
    const axisMode = getGraphAxisMode(options);
    const frameWidth = Math.floor(elements.resultGraphFrame.clientWidth || elements.resultGraphFrame.getBoundingClientRect().width || 0);
    if (frameWidth < 120) return;

    const renderKey = [
      result.id,
      axisMode,
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
    if (renderKey !== resultGraphRenderKey) {
      const config = buildResultGraphConfig(result, graphData, selectedPoint, options);
      destroy();
      resultGraphRenderKey = renderKey;
      resultGraphChart = new Chart(canvasElement, config);
    }
  }

  function syncReplayCursor(graphData, displayedPoint, options) {
    if (!resultGraphChart || !displayedPoint) return;

    const axisMode = getGraphAxisMode(options);
    resultGraphChart.$accelReplayLocked = Boolean(options && options.playbackPoint);
    resultGraphChart.$accelReplayCursor = options && options.playbackPoint
      ? {
        xValue: getGraphPointAxisValue(displayedPoint, axisMode),
        yValue: displayedPoint.speedDisplay,
      }
      : null;

    const index = getNearestGraphPointIndex(graphData, displayedPoint, axisMode);
    if (index >= 0) {
      setResultGraphActivePoint(resultGraphChart, index, !(options && options.playbackPoint));
    } else {
      resultGraphChart.update("none");
    }
  }

  function render(result, options: AccelResultGraphRenderOptions = {}) {
    if (!elements.resultGraphMeta || !elements.resultGraphEmptyState || !elements.resultGraphFrame) return;
    resultGraphRenderOptions = options;

    const speedUnit = getState().settings.speedUnit;
    const axisMode = getGraphAxisMode(options);
    const metaKey = axisMode === "distance" ? "accelSpeedGraphLeadDistance" : "accelSpeedGraphLead";
    elements.resultGraphMeta.textContent = `${t(metaKey)} · ${getSpeedUnitLabel(speedUnit)}`;

    if (!result || !Array.isArray(result.speedTrace) || result.speedTrace.length < 2) {
      elements.resultGraphEmptyState.hidden = false;
      elements.resultGraphFrame.hidden = true;
      resultGraphSelectionResultId = "";
      resultGraphSelectionPointKey = "";
      if (resultGraphChart) {
        resultGraphChart.$accelReplayCursor = null;
        resultGraphChart.$accelReplayLocked = false;
      }
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
    const displayedPoint = options && options.playbackPoint
      ? {
        ...options.playbackPoint,
        elapsedSeconds: options.playbackPoint.elapsedMs / 1000,
        speedDisplay: msToSpeedUnit(options.playbackPoint.speedMs, speedUnit),
        distanceDisplay: isFiniteNumber(options.playbackPoint.distanceM)
          ? convertDistanceMeasurement(options.playbackPoint.distanceM, getState().settings.distanceUnit)
          : null,
      }
      : getSelectedResultGraphPoint(result, graphData);
    renderResultGraphDetails(displayedPoint);

    if (getState().openPanel !== "results") return;
    mount(result, graphData, displayedPoint, options);
    syncReplayCursor(graphData, displayedPoint, options);
    if (options && options.playbackPoint) {
      renderResultGraphDetails(displayedPoint);
    }
  }

  function requestRefresh() {
    if (resultGraphRefreshFrame || getState().openPanel !== "results") return;

    resultGraphRefreshFrame = window.requestAnimationFrame(() => {
      resultGraphRefreshFrame = 0;
      render(getDisplayedResult(), resultGraphRenderOptions);
    });
  }

  function setupObservers() {
    if (!elements.resultsPanel || typeof ResizeObserver !== "function") return;
    if (resultGraphResizeObserver) resultGraphResizeObserver.disconnect();

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
