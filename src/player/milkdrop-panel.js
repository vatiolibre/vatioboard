/**
 * Milkdrop floating panel — premium Butterchurn audio visualizer.
 *
 * Draggable, resizable, fullscreen-capable floating panel that renders
 * Milkdrop-style presets via Butterchurn WebGL.  Shares the audio graph
 * with the inline mini-visualizer through audio-graph-registry.
 *
 * Closing the panel does NOT stop audio playback.
 *
 * @module milkdrop-panel
 */

import { IconClose, IconFullscreen, IconFullscreenExit } from "../icons.js";
import { t } from "../i18n.js";
import { acquireGraph, releaseGraph, getGraph } from "../shared/audio-graph-registry.js";
import { isVisualizerSafeSource } from "../shared/audio-visualizer.js";
import * as runtime from "../shared/audio-runtime.js";
import { loadText, saveText } from "../shared/storage.js";
import {
  makePanelDraggable,
  clampElementToViewport,
} from "../calculator/widget/drag.js";

// ── Storage keys ──────────────────────────────────────────────────

const POS_KEY = "milkdrop_panel_pos_v1";
const PRESET_KEY = "milkdrop_preset_name_v1";
const SIZE_KEY = "milkdrop_panel_size_v1";

// ── Icons ─────────────────────────────────────────────────────────

const IconPresetPrev = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

const IconPresetNext = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

const IconPresetShuffle = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

// ── Butterchurn lazy loader ───────────────────────────────────────

let _butterchurnModule = null;
let _presetsModule = null;
let _presetKeys = [];

async function loadButterchurn() {
  if (_butterchurnModule) return _butterchurnModule;
  try {
    const [bc, presets] = await Promise.all([
      import("butterchurn"),
      import("butterchurn-presets"),
    ]);
    _butterchurnModule = bc.default || bc;
    const presetLib = presets.default || presets;
    _presetsModule = typeof presetLib.getPresets === "function"
      ? presetLib.getPresets()
      : presetLib;
    _presetKeys = Object.keys(_presetsModule).sort();
    return _butterchurnModule;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function savePos(pos) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
}

function loadSize() {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSize(w, h) {
  try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h })); } catch { /* ignore */ }
}

function isSafeSource() {
  const el = runtime.getAudioElement();
  if (!el?.src) return true;
  return isVisualizerSafeSource(el.currentSrc || el.src);
}

function makeBtn(cls, icon, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.innerHTML = `<span class="btn-icon">${icon}</span>`;
  btn.setAttribute("aria-label", label);
  return btn;
}

// ── Panel factory ─────────────────────────────────────────────────

/**
 * Create a floating Milkdrop visualizer panel.
 *
 * @param {object} [options]
 * @param {HTMLElement} [options.mount=document.body]
 * @returns {{
 *   open: () => void,
 *   close: () => void,
 *   toggle: () => void,
 *   isOpen: () => boolean,
 *   destroy: () => void,
 * }}
 */
export function createMilkdropPanel(options = {}) {
  const { mount = document.body } = options;

  // ── DOM ────────────────────────────────────────────────────────
  const root = document.createElement("section");
  root.className = "milkdrop-panel";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", t("milkdropTitle"));

  const header = document.createElement("div");
  header.className = "milkdrop-header";

  const titleEl = document.createElement("span");
  titleEl.className = "milkdrop-title";
  titleEl.textContent = t("milkdropTitle");

  const presetPrevBtn = makeBtn("milkdrop-btn milkdrop-preset-prev", IconPresetPrev, t("milkdropPresetPrev"));
  const presetLabel = document.createElement("span");
  presetLabel.className = "milkdrop-preset-label";
  presetLabel.textContent = "";
  const presetNextBtn = makeBtn("milkdrop-btn milkdrop-preset-next", IconPresetNext, t("milkdropPresetNext"));
  const presetShuffleBtn = makeBtn("milkdrop-btn milkdrop-preset-shuffle", IconPresetShuffle, t("milkdropPresetShuffle"));

  const spacer = document.createElement("div");
  spacer.className = "milkdrop-spacer";

  const fullscreenBtn = makeBtn("milkdrop-btn milkdrop-fullscreen-btn", IconFullscreen, t("mediaPlayerFullscreen"));
  const closeBtn = makeBtn("milkdrop-btn milkdrop-close-btn", IconClose, t("close"));

  header.append(titleEl, presetPrevBtn, presetLabel, presetNextBtn, presetShuffleBtn, spacer, fullscreenBtn, closeBtn);

  const stage = document.createElement("div");
  stage.className = "milkdrop-stage";

  root.append(header, stage);

  // Restore saved size
  const savedSize = loadSize();
  if (savedSize?.w && savedSize?.h) {
    root.style.width = `${savedSize.w}px`;
    root.style.height = `${savedSize.h}px`;
  }

  // Restore saved position
  const savedPos = loadPos();
  if (savedPos?.panel?.left && savedPos?.panel?.top) {
    root.style.position = "fixed";
    root.style.left = savedPos.panel.left;
    root.style.top = savedPos.panel.top;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  mount.appendChild(root);

  // ── Drag ────────────────────────────────────────────────────
  makePanelDraggable({
    panel: root,
    header,
    dragThresholdPx: 6,
    savePos,
    loadPos,
  });

  // ── Resize observer for canvas ─────────────────────────────
  let resizeObserver = null;

  // ── Butterchurn state ───────────────────────────────────────
  let canvas = null;
  let gl = null;
  let visualizer = null;
  let graphEntry = null;
  let audioElement = null;
  let wired = false;
  let failed = false;
  let destroyed = false;
  let rafId = null;
  let currentPresetIndex = -1;
  let runtimeUnsub = null;

  // ── Preset navigation ──────────────────────────────────────
  function setPresetByIndex(index, blendTime = 2.7) {
    if (!visualizer || !_presetsModule || _presetKeys.length === 0) return;
    const idx = ((index % _presetKeys.length) + _presetKeys.length) % _presetKeys.length;
    const key = _presetKeys[idx];
    currentPresetIndex = idx;
    visualizer.loadPreset(_presetsModule[key], blendTime);
    presetLabel.textContent = key;
    saveText(PRESET_KEY, key);
  }

  function nextPreset() {
    setPresetByIndex(currentPresetIndex + 1);
  }

  function prevPreset() {
    setPresetByIndex(currentPresetIndex - 1);
  }

  function randomPreset() {
    if (_presetKeys.length === 0) return;
    setPresetByIndex(Math.floor(Math.random() * _presetKeys.length), 1.5);
  }

  function restorePreset() {
    const saved = loadText(PRESET_KEY, "");
    if (saved && _presetKeys.length > 0) {
      const idx = _presetKeys.indexOf(saved);
      if (idx !== -1) {
        setPresetByIndex(idx, 0);
        return;
      }
    }
    randomPreset();
  }

  // ── Render loop ─────────────────────────────────────────────
  function startRenderLoop() {
    if (rafId || destroyed || !visualizer) return;
    function render() {
      if (destroyed) return;
      try { visualizer.render(); } catch { /* ignore frame errors */ }
      rafId = requestAnimationFrame(render);
    }
    rafId = requestAnimationFrame(render);
  }

  function stopRenderLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ── Core wiring ─────────────────────────────────────────────
  async function wireButterchurn() {
    if (destroyed || failed || wired) return wired;

    const Butterchurn = await loadButterchurn();
    if (!Butterchurn || !_presetsModule || destroyed) { failed = true; return false; }

    const el = runtime.getAudioElement();
    if (!el || !isSafeSource()) { failed = true; return false; }

    // Create WebGL canvas
    canvas = document.createElement("canvas");
    canvas.className = "milkdrop-canvas";
    const w = stage.clientWidth || 480;
    const h = stage.clientHeight || 320;
    canvas.width = w;
    canvas.height = h;

    gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) { failed = true; return false; }

    // Acquire shared audio graph
    graphEntry = await acquireGraph(el);
    if (!graphEntry || destroyed) {
      failed = true;
      return false;
    }
    audioElement = el;

    try {
      visualizer = Butterchurn.createVisualizer(graphEntry.audioContext, canvas, {
        width: canvas.width,
        height: canvas.height,
      });

      visualizer.connectAudio(graphEntry.sourceNode);
      wired = true;
    } catch {
      failed = true;
      if (graphEntry) releaseGraph(el);
      graphEntry = null;
      return false;
    }

    stage.replaceChildren(canvas);

    // Responsive resize
    try {
      resizeObserver = new ResizeObserver(([entry]) => {
        if (destroyed || !visualizer) return;
        const { width: rw, height: rh } = entry.contentRect;
        const nw = Math.round(rw) || 480;
        const nh = Math.round(rh) || 320;
        canvas.width = nw;
        canvas.height = nh;
        visualizer.setRendererSize(nw, nh);
      });
      resizeObserver.observe(stage);
    } catch { /* ResizeObserver optional */ }

    restorePreset();
    startRenderLoop();
    return true;
  }

  // ── Playback sync ───────────────────────────────────────────
  function syncWithPlayback() {
    if (destroyed || root.hidden) return;
    const s = runtime.getState();
    if (s.playing && wired) {
      startRenderLoop();
    } else {
      stopRenderLoop();
    }
  }

  // ── Open / Close ────────────────────────────────────────────
  async function open() {
    if (destroyed) return;
    root.hidden = false;

    // Always clamp to viewport on open to prevent overflow
    clampPanelToWindow();

    if (!wired && !failed) {
      await wireButterchurn();
    }
    syncWithPlayback();

    // Subscribe to runtime state changes while open
    if (!runtimeUnsub) {
      runtimeUnsub = runtime.subscribe(() => syncWithPlayback());
    }
  }

  function close() {
    // Exit fullscreen first — hiding the fullscreen element without
    // exiting leaves the browser's fullscreen overlay active, which
    // blocks all UI interaction on the page underneath.
    if (document.fullscreenElement === root) {
      document.exitFullscreen().catch(() => {});
      // onFullscreenChange will restore size/class; we still hide immediately
    }

    root.hidden = true;
    stopRenderLoop();

    // Unsubscribe while closed to avoid unnecessary work
    if (runtimeUnsub) {
      runtimeUnsub();
      runtimeUnsub = null;
    }
    // Playback continues — closing does NOT stop audio
  }

  function toggle() {
    root.hidden ? open() : close();
  }

  function isOpen() {
    return !root.hidden;
  }

  // ── Fullscreen ──────────────────────────────────────────────
  let isFullscreen = false;
  let preFullscreenWidth = null;
  let preFullscreenHeight = null;

  function updateFullscreenBtn() {
    fullscreenBtn.querySelector(".btn-icon").innerHTML = isFullscreen ? IconFullscreenExit : IconFullscreen;
    fullscreenBtn.setAttribute("aria-label", isFullscreen ? t("mediaPlayerExitFullscreen") : t("mediaPlayerFullscreen"));
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        // Save current panel size before entering fullscreen
        const rect = root.getBoundingClientRect();
        preFullscreenWidth = Math.round(rect.width);
        preFullscreenHeight = Math.round(rect.height);
        await root.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch { /* Fullscreen API may be blocked */ }
  }

  function clampPanelToWindow() {
    // Defensive: ensure the panel never exceeds viewport bounds
    const maxW = window.innerWidth - 16;
    const maxH = window.innerHeight - 16;
    const rect = root.getBoundingClientRect();
    if (rect.width > maxW) root.style.width = `${maxW}px`;
    if (rect.height > maxH) root.style.height = `${maxH}px`;
    clampElementToViewport(root);
  }

  function onFullscreenChange() {
    const wasFullscreen = isFullscreen;
    isFullscreen = document.fullscreenElement === root;
    root.classList.toggle("is-fullscreen", isFullscreen);
    updateFullscreenBtn();

    // Restore pre-fullscreen size when exiting fullscreen
    if (wasFullscreen && !isFullscreen && preFullscreenWidth && preFullscreenHeight) {
      root.style.width = `${preFullscreenWidth}px`;
      root.style.height = `${preFullscreenHeight}px`;
      preFullscreenWidth = null;
      preFullscreenHeight = null;
      // Re-clamp position to keep panel inside viewport
      clampPanelToWindow();
    }

    // Resize canvas after fullscreen transition
    if (visualizer && canvas) {
      const w = stage.clientWidth || canvas.width;
      const h = stage.clientHeight || canvas.height;
      canvas.width = w;
      canvas.height = h;
      visualizer.setRendererSize(w, h);
    }
  }

  document.addEventListener("fullscreenchange", onFullscreenChange);

  // ── Panel resize (manual via CSS resize or drag) ────────────
  let panelResizeObserver = null;
  try {
    panelResizeObserver = new ResizeObserver(() => {
      if (destroyed || root.hidden || isFullscreen) return;
      const rect = root.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) {
        saveSize(Math.round(rect.width), Math.round(rect.height));
      }
    });
    panelResizeObserver.observe(root);
  } catch { /* optional */ }

  // ── Event wiring ────────────────────────────────────────────
  const stopProp = (e) => e.stopPropagation();
  for (const btn of [presetPrevBtn, presetNextBtn, presetShuffleBtn, fullscreenBtn, closeBtn]) {
    btn.addEventListener("pointerdown", stopProp);
    btn.addEventListener("pointerup", stopProp);
  }

  presetPrevBtn.addEventListener("click", (e) => { e.stopPropagation(); prevPreset(); });
  presetNextBtn.addEventListener("click", (e) => { e.stopPropagation(); nextPreset(); });
  presetShuffleBtn.addEventListener("click", (e) => { e.stopPropagation(); randomPreset(); });
  fullscreenBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleFullscreen(); });
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });

  // ── Destroy ─────────────────────────────────────────────────
  function destroy() {
    if (destroyed) return;
    destroyed = true;

    // Exit fullscreen before teardown to avoid leaving the page stuck
    if (document.fullscreenElement === root) {
      document.exitFullscreen().catch(() => {});
    }

    stopRenderLoop();

    if (runtimeUnsub) { runtimeUnsub(); runtimeUnsub = null; }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (panelResizeObserver) { panelResizeObserver.disconnect(); panelResizeObserver = null; }
    document.removeEventListener("fullscreenchange", onFullscreenChange);

    if (graphEntry && audioElement) {
      releaseGraph(audioElement);
      graphEntry = null;
    }

    if (canvas) canvas.remove();
    root.remove();
  }

  return { open, close, toggle, isOpen, destroy };
}
