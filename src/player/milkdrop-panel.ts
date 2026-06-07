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

import { IconClose, IconFullscreen, IconFullscreenExit, IconMinimize } from "../icons.js";
import { t } from "../i18n.js";
import { acquireGraph, releaseGraph } from "../shared/audio-graph-registry.js";
import { isVisualizerSafeSource } from "../shared/audio-visualizer.js";
import * as runtime from "../shared/audio-runtime.js";
import { loadText, saveText } from "../shared/storage.js";
import {
  registerFloatingPanel,
} from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import {
  loadMilkdropPanelVisibility,
  saveMilkdropPanelVisibility,
} from "./milkdrop-panel-prefs.js";

export { loadMilkdropPanelVisibility };
import {
  makePanelDraggable,
  clampElementToViewport,
} from "../calculator/widget/drag.js";
import type { ShellLifecycleOptions, ShellRuntime } from "../types/shell";

// ── Storage keys ──────────────────────────────────────────────────

const POS_KEY = "milkdrop_panel_pos_v1";
const PRESET_KEY = "milkdrop_preset_name_v1";
const SIZE_KEY = "milkdrop_panel_size_v1";
const MILKDROP_WINDOW_ID = "milkdrop";

type MilkdropPosition = {
  panel?: {
    left?: string;
    top?: string;
  } | null;
};

type MilkdropSize = {
  w?: number;
  h?: number;
};

export type MilkdropPanelOptions = {
  mount?: HTMLElement;
  onOpen?: (() => void) | null;
  onClose?: (() => void) | null;
  restoreVisibility?: boolean;
  shellManager?: ShellRuntime;
  translate?: ((key: string) => string) | null;
};

export type MilkdropPanelApi = {
  open: (options?: ShellLifecycleOptions) => Promise<void>;
  close: (options?: ShellLifecycleOptions) => void;
  minimize: (options?: ShellLifecycleOptions) => void;
  toggle: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

type RectLike = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

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

function loadPos(): MilkdropPosition | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function savePos(pos: MilkdropPosition) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
}

function loadSize(): MilkdropSize | null {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSize(w: number, h: number) {
  try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h })); } catch { /* ignore */ }
}

function saveVisibility(isOpen: boolean) {
  saveMilkdropPanelVisibility(isOpen);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function pxToNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPanelSize(root: HTMLElement) {
  const rect = root.getBoundingClientRect();
  return {
    width: Math.round(rect.width || pxToNumber(root.style.width, 480)),
    height: Math.round(rect.height || pxToNumber(root.style.height, 380)),
  };
}

function rectsOverlap(a: RectLike | null | undefined, b: RectLike | null | undefined, margin = 12): boolean {
  if (!a || !b) return false;
  return !(
    a.left > b.right + margin
    || a.right < b.left - margin
    || a.top > b.bottom + margin
    || a.bottom < b.top - margin
  );
}

function isSafeSource() {
  const el = runtime.getAudioElement();
  if (!el?.src) return true;
  return isVisualizerSafeSource(el.currentSrc || el.src);
}

function makeBtn(cls: string, icon: string, label: string) {
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
 * @param {Function|null} [options.onOpen]
 * @param {Function|null} [options.onClose]
 * @param {boolean} [options.restoreVisibility=true]
 * @returns {{
 *   open: () => void,
 *   close: () => void,
 *   toggle: () => void,
 *   isOpen: () => boolean,
 *   destroy: () => void,
 * }}
 */
export function createMilkdropPanel(options: MilkdropPanelOptions = {}): MilkdropPanelApi {
  const {
    mount = document.body,
    onOpen = null,
    onClose = null,
    restoreVisibility = true,
    shellManager = getDefaultShellWindowManager(),
    translate = null,
  } = options;
  const tr = typeof translate === "function" ? translate : t;

  // ── DOM ────────────────────────────────────────────────────────
  const root = document.createElement("section");
  root.className = "milkdrop-panel";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", tr("milkdropTitle"));
  let cleanupLayer = () => {};

  const header = document.createElement("div");
  header.className = "milkdrop-header";

  const titleEl = document.createElement("span");
  titleEl.className = "milkdrop-title";
  titleEl.textContent = tr("milkdropTitle");

  const presetPrevBtn = makeBtn("milkdrop-btn milkdrop-preset-prev", IconPresetPrev, tr("milkdropPresetPrev"));
  const presetLabel = document.createElement("span");
  presetLabel.className = "milkdrop-preset-label";
  presetLabel.textContent = "";
  const presetNextBtn = makeBtn("milkdrop-btn milkdrop-preset-next", IconPresetNext, tr("milkdropPresetNext"));
  const presetShuffleBtn = makeBtn("milkdrop-btn milkdrop-preset-shuffle", IconPresetShuffle, tr("milkdropPresetShuffle"));

  const spacer = document.createElement("div");
  spacer.className = "milkdrop-spacer";

  const fullscreenBtn = makeBtn("milkdrop-btn milkdrop-fullscreen-btn", IconFullscreen, tr("mediaPlayerFullscreen"));
  const minimizeBtn = makeBtn("milkdrop-btn milkdrop-minimize-btn", IconMinimize, tr("minimize"));
  const closeBtn = makeBtn("milkdrop-btn milkdrop-close-btn", IconClose, tr("close"));

  header.append(titleEl, presetPrevBtn, presetLabel, presetNextBtn, presetShuffleBtn, spacer, fullscreenBtn, minimizeBtn, closeBtn);

  const stage = document.createElement("div");
  stage.className = "milkdrop-stage";

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "milkdrop-resize-handle";
  resizeHandle.setAttribute("aria-hidden", "true");

  root.append(header, stage, resizeHandle);

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

  if (!(savedPos?.panel?.left && savedPos?.panel?.top)) {
    placeInitialPanel();
  }

  cleanupLayer = registerFloatingPanel(root, {
    id: MILKDROP_WINDOW_ID,
    kind: "visualizer",
    title: "Milkdrop",
    shellManager,
    storageKey: "milkdrop_panel_visible_v1",
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
      fullscreen: true,
      maximizable: true,
      snap: true,
    },
    lifecycle: {
      open: showPanel,
      close: hidePanel,
      minimize: minimizePanel,
      restore: showPanel,
    },
  });

  // ── Drag ────────────────────────────────────────────────────
  function savePanelPos(pos: MilkdropPosition) {
    savePos(pos);
    if (pos?.panel?.left && pos?.panel?.top) {
      shellManager.updateWindowBounds(MILKDROP_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
      }, {
        preserveSnap: Boolean(shellManager.getWindow(MILKDROP_WINDOW_ID)?.snap),
      });
    }
  }

  makePanelDraggable({
    panel: root,
    header,
    dragThresholdPx: 6,
    savePos: savePanelPos,
    loadPos,
    shellWindowId: MILKDROP_WINDOW_ID,
    shellManager,
    enableSnapPreview: shellManager.getShellPreference?.("snapEnabled") !== false,
  });

  function getVisiblePlayerRect() {
    const scope = mount instanceof Element ? mount : document;
    const player = scope.querySelector?.(".player-panel:not([hidden])")
      || document.querySelector(".player-panel:not([hidden])");
    if (!player || player === root) return null;
    const rect = player.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function placeInitialPanel() {
    const margin = 16;
    const { width, height } = getPanelSize(root);
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const fallbackLeft = clamp(vw - width - 24, margin, Math.max(margin, vw - width - margin));
    const fallbackTop = clamp(vh - height - 120, margin, Math.max(margin, vh - height - margin));
    const playerRect = getVisiblePlayerRect();

    let left = fallbackLeft;
    let top = fallbackTop;

    if (playerRect) {
      const leftCandidate = {
        left: margin,
        top: clamp(playerRect.top, margin, Math.max(margin, vh - height - margin)),
      };
      const rightCandidate = {
        left: clamp(vw - width - margin, margin, Math.max(margin, vw - width - margin)),
        top: clamp(playerRect.top, margin, Math.max(margin, vh - height - margin)),
      };
      const topCandidate = {
        left: clamp(playerRect.left, margin, Math.max(margin, vw - width - margin)),
        top: margin,
      };
      const bottomCandidate = {
        left: clamp(playerRect.left, margin, Math.max(margin, vw - width - margin)),
        top: clamp(vh - height - margin, margin, Math.max(margin, vh - height - margin)),
      };
      const preferRight = playerRect.left + (playerRect.width / 2) < vw / 2;
      const candidates = preferRight
        ? [rightCandidate, leftCandidate, topCandidate, bottomCandidate]
        : [leftCandidate, rightCandidate, topCandidate, bottomCandidate];
      const fit = candidates.find((candidate) => !rectsOverlap({
        left: candidate.left,
        top: candidate.top,
        right: candidate.left + width,
        bottom: candidate.top + height,
      }, playerRect));
      if (fit) {
        left = fit.left;
        top = fit.top;
      }
    }

    root.style.position = "fixed";
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

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

  function teardownAudioWiring() {
    stopRenderLoop();

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    if (graphEntry && audioElement) {
      releaseGraph(audioElement);
    }

    graphEntry = null;
    audioElement = null;
    visualizer = null;
    wired = false;
    gl = null;

    if (canvas) {
      canvas.remove();
      canvas = null;
    }
  }

  // ── Core wiring ─────────────────────────────────────────────
  async function wireButterchurn() {
    if (destroyed || failed || wired) return wired;

    const Butterchurn = await loadButterchurn();
    if (!Butterchurn || !_presetsModule || destroyed) { failed = true; return false; }

    const state = runtime.getState();
    const el = runtime.getAudioElement();
    if (!state.currentTrack || !state.sourceType || !el?.src) return false;
    if (!isSafeSource()) { failed = true; return false; }

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
      teardownAudioWiring();
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
      teardownAudioWiring();
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
    const el = runtime.getAudioElement();
    const hasPlayableSource = Boolean(s.currentTrack && s.sourceType && el?.src);

    if (!hasPlayableSource) {
      teardownAudioWiring();
      return;
    }

    if (audioElement && audioElement !== el) {
      teardownAudioWiring();
    }

    if (s.playing && wired) {
      startRenderLoop();
    } else if (s.playing && !failed) {
      void wireButterchurn().then((ready) => {
        if (ready && runtime.getState().playing && !root.hidden && !destroyed) {
          startRenderLoop();
        }
      });
    } else {
      stopRenderLoop();
    }
  }

  // ── Open / Close ────────────────────────────────────────────
  async function showPanel({ persist = true }: ShellLifecycleOptions = {}) {
    if (destroyed) return;
    const wasOpen = !root.hidden;
    root.hidden = false;
    if (persist) saveVisibility(true);

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

    if (!wasOpen && typeof onOpen === "function") {
      onOpen();
    }
  }

  function hidePanel({ persist = true }: ShellLifecycleOptions = {}) {
    const wasOpen = !root.hidden;
    endHandleResize();

    // Exit fullscreen first — hiding the fullscreen element without
    // exiting leaves the browser's fullscreen overlay active, which
    // blocks all UI interaction on the page underneath.
    if (isFallbackFullscreen) {
      exitFallbackFullscreen();
    }
    if (document.fullscreenElement === root) {
      document.exitFullscreen().catch(() => {});
      // onFullscreenChange will restore size/class; we still hide immediately
    }

    root.hidden = true;
    if (persist) saveVisibility(false);
    stopRenderLoop();

    // Unsubscribe while closed to avoid unnecessary work
    if (runtimeUnsub) {
      runtimeUnsub();
      runtimeUnsub = null;
    }
    // Playback continues — closing does NOT stop audio

    if (wasOpen && typeof onClose === "function") {
      onClose();
    }
  }

  function minimizePanel() {
    endHandleResize();
    root.hidden = true;
    stopRenderLoop();
    if (runtimeUnsub) {
      runtimeUnsub();
      runtimeUnsub = null;
    }
  }

  async function open(options: ShellLifecycleOptions = {}) {
    await showPanel(options);
    shellManager.openWindow(MILKDROP_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    hidePanel(options);
    shellManager.closeWindow(MILKDROP_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function minimize(options: ShellLifecycleOptions = {}) {
    minimizePanel();
    shellManager.minimizeWindow(MILKDROP_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function toggle() {
    root.hidden ? open() : close();
  }

  function isOpen() {
    return !root.hidden;
  }

  // ── Fullscreen ──────────────────────────────────────────────
  let isNativeFullscreen = false;
  let isFallbackFullscreen = false;
  let preFullscreenWidth = null;
  let preFullscreenHeight = null;
  let preFullscreenLeft = null;
  let preFullscreenTop = null;

  function isFullscreenActive() {
    return isNativeFullscreen || isFallbackFullscreen;
  }

  function updateFullscreenBtn() {
    const active = isFullscreenActive();
    fullscreenBtn.querySelector(".btn-icon").innerHTML = active ? IconFullscreenExit : IconFullscreen;
    fullscreenBtn.setAttribute("aria-label", active ? tr("mediaPlayerExitFullscreen") : tr("mediaPlayerFullscreen"));
  }

  function savePreFullscreenGeometry() {
    if (preFullscreenWidth && preFullscreenHeight) return;
    const rect = root.getBoundingClientRect();
    preFullscreenWidth = Math.round(rect.width || pxToNumber(root.style.width, 480));
    preFullscreenHeight = Math.round(rect.height || pxToNumber(root.style.height, 380));
    preFullscreenLeft = root.style.left || `${Math.round(rect.left || 24)}px`;
    preFullscreenTop = root.style.top || `${Math.round(rect.top || 80)}px`;
  }

  function restorePreFullscreenGeometry() {
    if (preFullscreenWidth && preFullscreenHeight) {
      root.style.width = `${preFullscreenWidth}px`;
      root.style.height = `${preFullscreenHeight}px`;
    }
    if (preFullscreenLeft && preFullscreenTop) {
      root.style.left = preFullscreenLeft;
      root.style.top = preFullscreenTop;
      root.style.right = "auto";
      root.style.bottom = "auto";
    }
    preFullscreenWidth = null;
    preFullscreenHeight = null;
    preFullscreenLeft = null;
    preFullscreenTop = null;
  }

  function enterFallbackFullscreen() {
    savePreFullscreenGeometry();
    shellManager.fullscreenWindow?.(MILKDROP_WINDOW_ID, { persist: false });
    isFallbackFullscreen = true;
    root.classList.add("is-fullscreen", "is-window-fullscreen");
    updateFullscreenBtn();
    resizeAfterFullscreenTransition();
  }

  function exitFallbackFullscreen({ restore = true }: { restore?: boolean } = {}) {
    if (!isFallbackFullscreen) return;
    isFallbackFullscreen = false;
    root.classList.remove("is-window-fullscreen");
    if (!isNativeFullscreen) {
      root.classList.remove("is-fullscreen");
      if (restore) {
        restorePreFullscreenGeometry();
        clampPanelToWindow();
      }
    }
    shellManager.exitFullscreenWindow?.(MILKDROP_WINDOW_ID, { persist: false });
    updateFullscreenBtn();
    resizeAfterFullscreenTransition();
  }

  async function enterFullscreen() {
    savePreFullscreenGeometry();
    if (typeof root.requestFullscreen === "function") {
      try {
        await root.requestFullscreen();
        if (document.fullscreenElement === root) {
          return;
        }
      } catch {
        // Fall back below.
      }
    }
    enterFallbackFullscreen();
  }

  async function exitFullscreenMode() {
    if (isFallbackFullscreen) {
      exitFallbackFullscreen();
      return;
    }
    if (document.fullscreenElement === root && typeof document.exitFullscreen === "function") {
      try {
        await document.exitFullscreen();
      } catch {
        isNativeFullscreen = false;
        root.classList.remove("is-fullscreen");
        restorePreFullscreenGeometry();
        clampPanelToWindow();
        updateFullscreenBtn();
      }
    }
  }

  async function toggleFullscreen() {
    if (isFullscreenActive() || document.fullscreenElement === root) {
      await exitFullscreenMode();
    } else {
      await enterFullscreen();
    }
  }

  function clampPanelToWindow() {
    // Defensive: ensure the panel never exceeds viewport bounds
    const maxW = Math.max(320, window.innerWidth - 16);
    const maxH = Math.max(260, window.innerHeight - 16);
    const rect = root.getBoundingClientRect();
    if (rect.width > maxW) root.style.width = `${maxW}px`;
    if (rect.height > maxH) root.style.height = `${maxH}px`;
    clampElementToViewport(root);
  }

  function resizeAfterFullscreenTransition() {
    if (!visualizer || !canvas) return;
    const w = stage.clientWidth || canvas.width;
    const h = stage.clientHeight || canvas.height;
    canvas.width = w;
    canvas.height = h;
    visualizer.setRendererSize(w, h);
  }

  function onFullscreenChange() {
    const wasFullscreen = isNativeFullscreen;
    isNativeFullscreen = document.fullscreenElement === root;
    if (isNativeFullscreen) {
      shellManager.fullscreenWindow?.(MILKDROP_WINDOW_ID, { persist: false });
    }
    root.classList.toggle("is-fullscreen", isNativeFullscreen || isFallbackFullscreen);
    updateFullscreenBtn();

    // Restore pre-fullscreen size when exiting fullscreen
    if (wasFullscreen && !isNativeFullscreen && !isFallbackFullscreen) {
      restorePreFullscreenGeometry();
      // Re-clamp position to keep panel inside viewport
      clampPanelToWindow();
      shellManager.exitFullscreenWindow?.(MILKDROP_WINDOW_ID, { persist: false });
    }

    // Resize canvas after fullscreen transition
    resizeAfterFullscreenTransition();
  }

  document.addEventListener("fullscreenchange", onFullscreenChange);

  // ── Panel resize (manual via CSS resize or drag) ────────────
  let panelResizeObserver = null;
  try {
    panelResizeObserver = new ResizeObserver(() => {
      if (destroyed || root.hidden || isFullscreenActive()) return;
      const rect = root.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) {
        saveSize(Math.round(rect.width), Math.round(rect.height));
      }
    });
    panelResizeObserver.observe(root);
  } catch { /* optional */ }

  // ── Touch resize handle ──────────────────────────────────────
  let resizing = false;
  let resizePointerId = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;
  let resizeRafId = 0;
  let resizeLastX = 0;
  let resizeLastY = 0;

  function applyHandleResize() {
    resizeRafId = 0;
    if (!resizing || isFullscreenActive()) return;
    const dx = resizeLastX - resizeStartX;
    const dy = resizeLastY - resizeStartY;
    const maxW = Math.max(320, (window.innerWidth || 1024) - 16);
    const maxH = Math.max(260, (window.innerHeight || 768) - 16);
    const nextW = clamp(resizeStartW + dx, 320, maxW);
    const nextH = clamp(resizeStartH + dy, 260, maxH);
    root.style.width = `${Math.round(nextW)}px`;
    root.style.height = `${Math.round(nextH)}px`;
    shellManager.updateWindowBounds(MILKDROP_WINDOW_ID, {
      left: parseFloat(root.style.left) || root.getBoundingClientRect().left || 0,
      top: parseFloat(root.style.top) || root.getBoundingClientRect().top || 0,
      width: Math.round(nextW),
      height: Math.round(nextH),
    });
    resizeAfterFullscreenTransition();
  }

  function scheduleHandleResize() {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(applyHandleResize);
  }

  function endHandleResize() {
    if (resizeRafId) {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = 0;
    }
    if (!resizing) return;
    resizing = false;
    root.classList.remove("is-resizing");
    document.documentElement.classList.remove("vb-floating-drag-active");
    clampPanelToWindow();
    const { width, height } = getPanelSize(root);
    saveSize(width, height);
    resizePointerId = null;
  }

  resizeHandle.addEventListener("pointerdown", (e) => {
    if (isFullscreenActive()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    resizing = true;
    resizePointerId = e.pointerId;
    resizeStartX = resizeLastX = e.clientX;
    resizeStartY = resizeLastY = e.clientY;
    const { width, height } = getPanelSize(root);
    resizeStartW = width;
    resizeStartH = height;
    root.classList.add("is-resizing");
    document.documentElement.classList.add("vb-floating-drag-active");

    try {
      resizeHandle.setPointerCapture(resizePointerId);
    } catch { /* ignore */ }
  }, { passive: false });

  resizeHandle.addEventListener("pointermove", (e) => {
    if (!resizing || e.pointerId !== resizePointerId) return;
    e.preventDefault();
    e.stopPropagation();
    resizeLastX = e.clientX;
    resizeLastY = e.clientY;
    scheduleHandleResize();
  }, { passive: false });

  resizeHandle.addEventListener("pointerup", (e) => {
    if (e.pointerId !== resizePointerId) return;
    e.preventDefault();
    e.stopPropagation();
    endHandleResize();
  });

  resizeHandle.addEventListener("pointercancel", endHandleResize);

  // ── Event wiring ────────────────────────────────────────────
  const stopProp = (e: Event) => e.stopPropagation();
  for (const btn of [presetPrevBtn, presetNextBtn, presetShuffleBtn, fullscreenBtn, minimizeBtn, closeBtn]) {
    btn.addEventListener("pointerdown", stopProp);
    btn.addEventListener("pointerup", stopProp);
  }

  presetPrevBtn.addEventListener("click", (e) => { e.stopPropagation(); prevPreset(); });
  presetNextBtn.addEventListener("click", (e) => { e.stopPropagation(); nextPreset(); });
  presetShuffleBtn.addEventListener("click", (e) => { e.stopPropagation(); randomPreset(); });
  fullscreenBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleFullscreen(); });
  minimizeBtn.addEventListener("click", (e) => { e.stopPropagation(); minimize(); });
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(); });

  if (restoreVisibility && loadMilkdropPanelVisibility()) {
    void open();
  }

  // ── Destroy ─────────────────────────────────────────────────
  function destroy() {
    if (destroyed) return;
    destroyed = true;

    // Exit fullscreen before teardown to avoid leaving the page stuck
    if (isFallbackFullscreen) {
      exitFallbackFullscreen({ restore: false });
    }
    if (document.fullscreenElement === root) {
      document.exitFullscreen().catch(() => {});
    }

    stopRenderLoop();
    endHandleResize();

    if (runtimeUnsub) { runtimeUnsub(); runtimeUnsub = null; }
    if (panelResizeObserver) { panelResizeObserver.disconnect(); panelResizeObserver = null; }
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    cleanupLayer();

    teardownAudioWiring();
    root.remove();
  }

  return { open, close, minimize, toggle, isOpen, destroy };
}
