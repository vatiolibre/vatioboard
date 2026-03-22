import "../styles/analog-speedometer.less";

function toFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function createAnalogSpeedometer(options) {
  if (!options) return createNoopSpeedometer();

  const stageElement = options.stageElement;
  const stageInnerElement = options.stageInnerElement;
  const dialCanvas = options.dialCanvas;
  const needleCanvas = options.needleCanvas;
  const valueElement = options.valueElement || null;
  const unitElement = options.unitElement || null;
  const substatusElement = options.substatusElement || null;
  const resizeTarget = options.resizeTarget || stageElement;
  const styleSourceElement = options.styleSourceElement || stageElement || document.documentElement;

  if (!stageElement || !stageInnerElement || !dialCanvas || !needleCanvas) {
    return createNoopSpeedometer();
  }

  const dialContext = dialCanvas.getContext("2d");
  const needleContext = needleCanvas.getContext("2d");
  if (!dialContext || !needleContext) {
    return createNoopSpeedometer();
  }

  let canvasSize = 0;
  let resizeObserver = null;
  let model = {
    value: 0,
    valueText: "0",
    unitText: "",
    substatusText: "",
    maxValue: 100,
    tickStep: 10,
    markerValue: null,
    accentColor: null,
    markerColor: null,
    pivotInnerColor: null,
  };

  function getCssColor(name, fallback) {
    const value = getComputedStyle(styleSourceElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function syncStageSize() {
    const rect = stageElement.getBoundingClientRect();
    const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
    stageInnerElement.style.setProperty("--analog-speedometer-size", `${size}px`);
  }

  function resize() {
    syncStageSize();

    const rect = dialCanvas.getBoundingClientRect();
    const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
    const dpr = window.devicePixelRatio || 1;

    if (size === canvasSize && dialCanvas.width === Math.floor(size * dpr)) return;

    canvasSize = size;
    for (const canvas of [dialCanvas, needleCanvas]) {
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
    }

    dialContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    needleContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    if (canvasSize === 0) return;

    const size = canvasSize;
    const center = size / 2;
    const radius = size * 0.42;
    const ringRadius = radius * 0.84;
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;
    const angleRange = endAngle - startAngle;
    const displayValue = Math.max(0, toFiniteNumber(model.value, 0));
    const gaugeMax = Math.max(10, toFiniteNumber(model.maxValue, 100));
    const tickStep = Math.max(1, toFiniteNumber(model.tickStep, 10));
    const progress = Math.min(displayValue / gaugeMax, 1);
    const tickCount = Math.max(1, Math.floor(gaugeMax / tickStep));

    const bgColor = getCssColor("--analog-speedometer-surface", "rgba(255,255,255,0.92)");
    const mutedColor = getCssColor("--analog-speedometer-tick", "rgba(17,24,39,0.4)");
    const trackColor = getCssColor("--analog-speedometer-track", "rgba(17,24,39,0.12)");
    const accentColor = model.accentColor || getCssColor("--analog-speedometer-accent", "#10b981");
    const markerColor = model.markerColor || getCssColor("--analog-speedometer-marker", "#ff7a5c");
    const needleBaseColor = getCssColor("--analog-speedometer-needle-base", "#8f1622");
    const needleTipColor = getCssColor("--analog-speedometer-needle-tip", "#ff5a36");
    const pivotOuterColor = getCssColor("--analog-speedometer-pivot-outer", "#202633");
    const pivotInnerColor = model.pivotInnerColor || getCssColor("--analog-speedometer-pivot-inner", accentColor);
    const dialCoreColor = getCssColor("--analog-speedometer-dial-core", "#ffffff");
    const dialMidColor = getCssColor("--analog-speedometer-dial-mid", bgColor);
    const dialEdgeColor = getCssColor("--analog-speedometer-dial-edge", "#e7f0fb");
    const dialRimColor = getCssColor("--analog-speedometer-dial-rim", trackColor);
    const dialHighlightColor = getCssColor("--analog-speedometer-dial-highlight", "rgba(255,255,255,0.92)");
    const dialHighlightMidColor = getCssColor("--analog-speedometer-dial-highlight-mid", "rgba(255,255,255,0.18)");
    const dialHighlightFadeColor = getCssColor("--analog-speedometer-dial-highlight-fade", "rgba(255,255,255,0.05)");

    dialContext.clearRect(0, 0, size, size);
    needleContext.clearRect(0, 0, size, size);

    const backdrop = dialContext.createRadialGradient(
      center,
      center,
      radius * 0.06,
      center,
      center,
      radius,
    );
    backdrop.addColorStop(0, dialCoreColor);
    backdrop.addColorStop(0.62, dialMidColor);
    backdrop.addColorStop(1, dialEdgeColor);
    dialContext.fillStyle = backdrop;
    dialContext.beginPath();
    dialContext.arc(center, center, radius, 0, Math.PI * 2);
    dialContext.fill();

    const gloss = dialContext.createRadialGradient(
      center,
      center,
      radius * 0.14,
      center,
      center,
      radius * 0.92,
    );
    gloss.addColorStop(0, dialHighlightColor);
    gloss.addColorStop(0.28, dialHighlightMidColor);
    gloss.addColorStop(0.64, dialHighlightFadeColor);
    gloss.addColorStop(1, "transparent");
    dialContext.fillStyle = gloss;
    dialContext.beginPath();
    dialContext.arc(center, center, radius, 0, Math.PI * 2);
    dialContext.fill();

    dialContext.strokeStyle = dialRimColor;
    dialContext.lineWidth = Math.max(2, size * 0.004);
    dialContext.beginPath();
    dialContext.arc(center, center, radius - dialContext.lineWidth, 0, Math.PI * 2);
    dialContext.stroke();

    dialContext.strokeStyle = trackColor;
    dialContext.lineWidth = Math.max(8, size * 0.03);
    dialContext.beginPath();
    dialContext.arc(center, center, ringRadius, startAngle, endAngle);
    dialContext.stroke();

    if (Number.isFinite(model.markerValue)) {
      const markerAngle = startAngle + Math.min(Math.max(model.markerValue, 0) / gaugeMax, 1) * angleRange;
      const markerInnerRadius = ringRadius - Math.max(16, size * 0.032);
      const markerOuterRadius = ringRadius + Math.max(10, size * 0.02);

      dialContext.strokeStyle = markerColor;
      dialContext.lineWidth = Math.max(4, size * 0.007);
      dialContext.lineCap = "round";
      dialContext.beginPath();
      dialContext.moveTo(
        center + markerInnerRadius * Math.cos(markerAngle),
        center + markerInnerRadius * Math.sin(markerAngle),
      );
      dialContext.lineTo(
        center + markerOuterRadius * Math.cos(markerAngle),
        center + markerOuterRadius * Math.sin(markerAngle),
      );
      dialContext.stroke();
      dialContext.lineCap = "butt";
    }

    dialContext.strokeStyle = accentColor;
    dialContext.lineCap = "round";
    dialContext.beginPath();
    dialContext.arc(center, center, ringRadius, startAngle, startAngle + progress * angleRange);
    dialContext.stroke();
    dialContext.lineCap = "butt";

    const fontSize = Math.max(13, size * 0.024);
    dialContext.fillStyle = mutedColor;
    dialContext.strokeStyle = mutedColor;
    dialContext.font = `700 ${fontSize}px system-ui`;
    dialContext.textAlign = "center";
    dialContext.textBaseline = "middle";

    for (let index = 0; index <= tickCount; index += 1) {
      const tickValue = index * tickStep;
      const tickAngle = startAngle + (tickValue / gaugeMax) * angleRange;
      const innerRadius = radius * 0.78;
      const outerRadius = radius * 0.9;
      const labelRadius = radius * 0.64;

      dialContext.lineWidth = index % 2 === 0 ? 3 : 2;
      dialContext.beginPath();
      dialContext.moveTo(
        center + innerRadius * Math.cos(tickAngle),
        center + innerRadius * Math.sin(tickAngle),
      );
      dialContext.lineTo(
        center + outerRadius * Math.cos(tickAngle),
        center + outerRadius * Math.sin(tickAngle),
      );
      dialContext.stroke();

      dialContext.fillText(
        String(tickValue),
        center + labelRadius * Math.cos(tickAngle),
        center + labelRadius * Math.sin(tickAngle),
      );
    }

    const needleLength = radius * 0.86;
    const needleBack = radius * 0.16;
    const needleTailWidth = Math.max(6, size * 0.012);
    const needleTipWidth = Math.max(2.5, size * 0.0048);
    const needleAngle = startAngle + progress * angleRange + Math.PI / 2;

    needleContext.save();
    needleContext.translate(center, center);
    needleContext.rotate(needleAngle);
    const needleGradient = needleContext.createLinearGradient(0, needleBack, 0, -needleLength);
    needleGradient.addColorStop(0, needleBaseColor);
    needleGradient.addColorStop(1, needleTipColor);
    needleContext.shadowColor = "rgba(0, 0, 0, 0.24)";
    needleContext.shadowBlur = Math.max(8, size * 0.016);
    needleContext.shadowOffsetY = 2;
    needleContext.fillStyle = needleGradient;
    needleContext.beginPath();
    needleContext.moveTo(-needleTailWidth, needleBack);
    needleContext.lineTo(-needleTipWidth, -needleLength);
    needleContext.lineTo(needleTipWidth, -needleLength);
    needleContext.lineTo(needleTailWidth, needleBack);
    needleContext.closePath();
    needleContext.fill();

    needleContext.shadowColor = "transparent";
    needleContext.fillStyle = "rgba(255, 255, 255, 0.32)";
    needleContext.fillRect(-needleTipWidth * 0.4, -needleLength * 0.92, needleTipWidth * 0.8, needleLength * 0.95);
    needleContext.restore();

    needleContext.fillStyle = pivotOuterColor;
    needleContext.beginPath();
    needleContext.arc(center, center, Math.max(10, size * 0.018), 0, Math.PI * 2);
    needleContext.fill();

    needleContext.fillStyle = pivotInnerColor;
    needleContext.beginPath();
    needleContext.arc(center, center, Math.max(4, size * 0.008), 0, Math.PI * 2);
    needleContext.fill();
  }

  function render(nextModel) {
    model = Object.assign({}, model, nextModel || {});

    if (valueElement) {
      valueElement.textContent = model.valueText !== undefined
        ? String(model.valueText)
        : String(Math.round(toFiniteNumber(model.value, 0)));
    }

    if (unitElement) unitElement.textContent = model.unitText !== undefined ? String(model.unitText) : "";
    if (substatusElement) substatusElement.textContent = model.substatusText !== undefined ? String(model.substatusText) : "";

    draw();
  }

  function destroy() {
    if (resizeObserver) resizeObserver.disconnect();
  }

  if (resizeTarget && typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(function () {
      resize();
    });
    resizeObserver.observe(resizeTarget);
  }

  resize();

  return {
    destroy,
    render,
    resize,
  };
}

function createNoopSpeedometer() {
  return {
    destroy() {},
    render() {},
    resize() {},
  };
}
