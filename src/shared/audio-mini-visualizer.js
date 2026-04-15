const VALID_MODES = new Set(["spectrum", "scope", "off"]);
const MEDIA_GRAPH_BY_ELEMENT = new WeakMap();
const SPECTRUM_BAR_COUNT = 20;

function normalizeMode(mode) {
  const value = String(mode || "").toLowerCase();
  return VALID_MODES.has(value) ? value : "spectrum";
}

function createUnavailableController() {
  return {
    get isAvailable() {
      return false;
    },
    setMode() {},
    resize() {},
    start: async () => false,
    stop() {},
    destroy() {},
  };
}

function getAudioContextCtor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function teardownGraphEntry(graphEntry) {
  if (!graphEntry) return;

  try {
    graphEntry.sourceNode?.disconnect?.();
  } catch {
    // Best-effort cleanup for already-disconnected graphs.
  }

  if (graphEntry.analysers instanceof Set) {
    for (const analyserNode of graphEntry.analysers) {
      try {
        analyserNode?.disconnect?.();
      } catch {
        // Best-effort cleanup for already-disconnected analysers.
      }
    }
    graphEntry.analysers.clear();
  }

  try {
    const closeResult = graphEntry.audioContext?.close?.();
    closeResult?.catch?.(() => {});
  } catch {
    // Ignore close errors during teardown.
  }
}

export function destroyVisualizerGraphForElement(mediaElement) {
  if (!mediaElement || (typeof mediaElement !== "object" && typeof mediaElement !== "function")) {
    return false;
  }

  const graphEntry = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement);
  if (!graphEntry) return false;

  MEDIA_GRAPH_BY_ELEMENT.delete(mediaElement);
  teardownGraphEntry(graphEntry);
  return true;
}

function readVisualizerPalette(target) {
  const styles = target ? window.getComputedStyle(target) : null;
  const spectrumBar = styles?.getPropertyValue("--media-player-visualizer-bar").trim() || "rgba(34, 197, 94, 0.90)";
  return {
    spectrumLow: styles?.getPropertyValue("--media-player-visualizer-bar-low").trim() || spectrumBar,
    spectrumMid: styles?.getPropertyValue("--media-player-visualizer-bar-mid").trim() || "rgba(190, 242, 100, 0.90)",
    spectrumHigh: styles?.getPropertyValue("--media-player-visualizer-bar-high").trim() || "rgba(251, 146, 60, 0.94)",
    spectrumPeak: styles?.getPropertyValue("--media-player-visualizer-peak").trim() || "rgba(214, 214, 206, 0.96)",
    spectrumPeakGlow: styles?.getPropertyValue("--media-player-visualizer-peak-glow").trim() || "rgba(226, 226, 216, 0.30)",
    spectrumGlow: styles?.getPropertyValue("--media-player-visualizer-glow").trim() || "rgba(16, 185, 129, 0.20)",
    waveform: styles?.getPropertyValue("--media-player-visualizer-line").trim() || "rgba(16, 185, 129, 0.92)",
    grid: styles?.getPropertyValue("--media-player-visualizer-grid").trim() || "rgba(148, 163, 184, 0.14)",
    baseline: styles?.getPropertyValue("--media-player-visualizer-baseline").trim() || "rgba(148, 163, 184, 0.22)",
  };
}

function getSpectrumCellColor(palette, segmentIndex, segmentCount) {
  const ratio = segmentCount <= 1 ? 0 : segmentIndex / (segmentCount - 1);
  if (ratio > 0.68) return palette.spectrumHigh;
  if (ratio > 0.42) return palette.spectrumMid;
  return palette.spectrumLow;
}

function resetSpectrumState(state) {
  state.peaks = [];
}

function drawSpectrum(ctx, analyser, data, palette, state, width, height) {
  analyser.getByteFrequencyData(data);
  ctx.clearRect(0, 0, width, height);

  const bottomPadding = Math.max(4, Math.round(height * 0.08));
  const topPadding = Math.max(4, Math.round(height * 0.06));
  const baselineY = height - bottomPadding;
  ctx.fillStyle = palette.baseline;
  ctx.fillRect(0, baselineY, width, 1);

  const barCount = SPECTRUM_BAR_COUNT;
  const gap = Math.max(2, Math.floor(width / 220));
  const totalGap = gap * (barCount - 1);
  const barWidth = Math.max(4, Math.floor((width - totalGap) / barCount));
  const cellGap = Math.max(1, Math.floor(height / 54));
  const cellHeight = Math.max(2, Math.floor(height / 18));
  const cellStride = cellHeight + cellGap;
  const peakHeight = Math.max(3, Math.round(cellHeight * 0.9));
  const peakLift = cellStride;
  const usableHeight = Math.max(10, baselineY - topPadding - peakHeight - peakLift);
  const cellCount = Math.max(5, Math.floor((usableHeight + cellGap) / cellStride));
  const peakFall = Math.max(0.35, height * 0.016);
  const maxBin = Math.max(1, Math.floor(data.length * 0.88));

  if (state.peaks.length !== barCount) {
    state.peaks = new Array(barCount).fill(0);
  }

  ctx.shadowColor = palette.spectrumGlow;
  ctx.shadowBlur = Math.max(2, Math.round(height * 0.035));

  for (let index = 0; index < barCount; index += 1) {
    let peak = 0;
    let sum = 0;
    let sampleCount = 0;
    const start = Math.floor(Math.pow(index / barCount, 1.55) * maxBin);
    const end = Math.max(start + 1, Math.floor(Math.pow((index + 1) / barCount, 1.55) * maxBin));
    for (let bucket = start; bucket < end; bucket += 1) {
      if (data[bucket] > peak) peak = data[bucket];
      sum += data[bucket];
      sampleCount += 1;
    }

    const average = sampleCount ? sum / sampleCount : 0;
    const blended = Math.min(1, ((peak * 0.76) + (average * 0.34)) / 255);
    const amplitude = Math.pow(blended, 0.72);
    const activeCells = amplitude > 0.025 ? Math.max(1, Math.round(amplitude * cellCount)) : 0;
    const x = index * (barWidth + gap);
    const drawnCells = Math.min(cellCount, activeCells);

    for (let cellIndex = 0; cellIndex < drawnCells; cellIndex += 1) {
      const y = baselineY - ((cellIndex + 1) * cellHeight) - (cellIndex * cellGap);
      ctx.fillStyle = getSpectrumCellColor(palette, cellIndex, cellCount);
      ctx.fillRect(x, y, barWidth, cellHeight);
    }

    const liveHeight = drawnCells > 0
      ? (drawnCells * cellHeight) + ((drawnCells - 1) * cellGap)
      : 0;
    const previousPeak = state.peaks[index] || 0;
    const nextPeak = liveHeight >= previousPeak
      ? liveHeight
      : Math.max(0, previousPeak - peakFall);
    state.peaks[index] = Math.min(usableHeight, nextPeak);

    if (state.peaks[index] > 0.5) {
      const y = Math.max(topPadding, Math.round(baselineY - state.peaks[index] - peakHeight - peakLift));
      ctx.shadowColor = palette.spectrumPeakGlow;
      ctx.shadowBlur = Math.max(4, Math.round(height * 0.07));
      ctx.fillStyle = palette.spectrumPeak;
      ctx.fillRect(x, y, barWidth, peakHeight);
      ctx.shadowColor = palette.spectrumGlow;
      ctx.shadowBlur = Math.max(2, Math.round(height * 0.035));
    }
  }

  ctx.shadowBlur = 0;
}

function drawScope(ctx, analyser, data, palette, width, height) {
  analyser.getByteTimeDomainData(data);
  ctx.clearRect(0, 0, width, height);

  const centerY = height / 2;
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  ctx.strokeStyle = palette.waveform;
  ctx.lineWidth = Math.max(1.5, height * 0.045);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = palette.spectrumGlow;
  ctx.shadowBlur = Math.max(4, Math.round(height * 0.08));
  ctx.beginPath();

  for (let index = 0; index < data.length; index += 1) {
    const x = (index / Math.max(1, data.length - 1)) * width;
    const normalized = (data[index] - 128) / 128;
    const y = centerY + normalized * (height * 0.32);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

/**
 * Lightweight canvas visualizer for the inline media player.
 *
 * The audio graph is created lazily inside start() so user gesture timing
 * remains compatible with autoplay policies and native audio is preserved
 * until Web Audio routing is actually available.
 *
 * @param {object} options
 * @param {HTMLMediaElement} options.mediaElement
 * @param {HTMLElement} options.mount
 * @param {"spectrum"|"scope"|"off"} [options.mode]
 * @returns {{
 *   readonly isAvailable: boolean,
 *   setMode: (nextMode: string) => void,
 *   resize: () => void,
 *   start: () => Promise<boolean>,
 *   stop: () => void,
 *   destroy: () => void,
 * }}
 */
export function createMiniAudioVisualizer({ mediaElement, mount, mode = "spectrum" }) {
  if (!(mediaElement instanceof HTMLMediaElement) || !(mount instanceof HTMLElement)) {
    return createUnavailableController();
  }

  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    return createUnavailableController();
  }

  const canvas = document.createElement("canvas");
  canvas.className = "media-player-audio-canvas";
  canvas.setAttribute("aria-hidden", "true");
  mount.replaceChildren(canvas);

  const context2d = canvas.getContext("2d");
  if (!context2d) {
    canvas.remove();
    return createUnavailableController();
  }

  let available = true;
  let destroyed = false;
  let running = false;
  let animationFrameId = 0;
  let modeValue = normalizeMode(mode);
  let graphEntry = null;
  let analyser = null;
  let frequencyData = null;
  let timeDomainData = null;
  let resizeObserver = null;
  let lastWidth = 0;
  let lastHeight = 0;
  let palette = readVisualizerPalette(mount);
  const spectrumState = { peaks: [] };

  function resize() {
    if (destroyed) return;

    const rect = mount.getBoundingClientRect();
    const cssWidth = Math.max(0, Math.round(rect.width || mount.clientWidth || 0));
    const cssHeight = Math.max(0, Math.round(rect.height || mount.clientHeight || 0));
    if (!cssWidth || !cssHeight) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.round(cssWidth * pixelRatio);
    const nextHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width === nextWidth && canvas.height === nextHeight) return;

    canvas.width = nextWidth;
    canvas.height = nextHeight;
    lastWidth = nextWidth;
    lastHeight = nextHeight;
    palette = readVisualizerPalette(mount);
    resetSpectrumState(spectrumState);
  }

  function stop() {
    running = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  }

  function markUnavailable() {
    available = false;
    stop();
  }

  async function ensureAnalyser() {
    if (destroyed || !available) return false;
    if (analyser) return true;

    let currentGraph = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement) || null;

    if (!currentGraph) {
      const audioContext = new AudioContextCtor();

      try {
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
      } catch {
        try { await audioContext.close(); } catch { /* ignore */ }
        markUnavailable();
        return false;
      }

      if (audioContext.state !== "running") {
        try { await audioContext.close(); } catch { /* ignore */ }
        markUnavailable();
        return false;
      }

      let sourceNode = null;
      try {
        sourceNode = audioContext.createMediaElementSource(mediaElement);
        sourceNode.connect(audioContext.destination);
      } catch {
        try { await audioContext.close(); } catch { /* ignore */ }
        markUnavailable();
        return false;
      }

      currentGraph = { audioContext, sourceNode, analysers: new Set() };
      MEDIA_GRAPH_BY_ELEMENT.set(mediaElement, currentGraph);
    } else if (currentGraph.audioContext?.state === "suspended") {
      try {
        await currentGraph.audioContext.resume();
      } catch {
        markUnavailable();
        return false;
      }
    }

    try {
      analyser = currentGraph.audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.62;
      analyser.minDecibels = -88;
      analyser.maxDecibels = -20;
      currentGraph.sourceNode.connect(analyser);
      currentGraph.analysers?.add(analyser);
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      timeDomainData = new Uint8Array(analyser.fftSize);
      graphEntry = currentGraph;
      return true;
    } catch {
      graphEntry = currentGraph;
      markUnavailable();
      return false;
    }
  }

  function renderFrame() {
    if (destroyed) return;
    if (!running || !available || modeValue === "off") {
      animationFrameId = 0;
      return;
    }

    resize();
    const width = canvas.width || lastWidth;
    const height = canvas.height || lastHeight;
    if (!width || !height || !analyser) {
      animationFrameId = requestAnimationFrame(renderFrame);
      return;
    }

    if (modeValue === "scope") {
      drawScope(context2d, analyser, timeDomainData, palette, width, height);
    } else {
      drawSpectrum(context2d, analyser, frequencyData, palette, spectrumState, width, height);
    }

    animationFrameId = requestAnimationFrame(renderFrame);
  }

  function setMode(nextMode) {
    modeValue = normalizeMode(nextMode);
    if (modeValue === "off") {
      stop();
      context2d.clearRect(0, 0, canvas.width, canvas.height);
      resetSpectrumState(spectrumState);
      return;
    }

    if (running && !animationFrameId) {
      animationFrameId = requestAnimationFrame(renderFrame);
    }
  }

  async function start() {
    if (destroyed || !available) return false;
    resize();

    if (modeValue === "off") {
      stop();
      return true;
    }

    const ready = await ensureAnalyser();
    if (!ready || destroyed || !available) return false;

    running = true;
    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(renderFrame);
    }
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    if (analyser) {
      try { analyser.disconnect(); } catch { /* ignore */ }
    }

    if (graphEntry?.audioContext) {
      if (graphEntry.analysers && analyser) {
        graphEntry.analysers.delete(analyser);
      }
      MEDIA_GRAPH_BY_ELEMENT.delete(mediaElement);
      teardownGraphEntry(graphEntry);
    } else if (analyser) {
      try { analyser.disconnect(); } catch { /* ignore */ }
    }

    graphEntry = null;
    analyser = null;
    frequencyData = null;
    timeDomainData = null;
    canvas.remove();
  }

  try {
    resizeObserver = new ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(mount);
  } catch {
    // ResizeObserver is optional for this progressive enhancement.
  }

  resize();

  return {
    get isAvailable() {
      return available;
    },
    setMode,
    resize,
    start,
    stop,
    destroy,
  };
}
