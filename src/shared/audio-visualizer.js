/**
 * Lazy-loaded Butterchurn audio visualizer.
 *
 * Uses a deferred-resume pattern: Butterchurn and the WebGL canvas are
 * loaded eagerly, but the AudioContext and createMediaElementSource() call
 * are deferred until resume() — which must be called from a user-gesture
 * handler (e.g. play button click) so the AudioContext starts in "running"
 * state and audio is never silently hijacked.
 *
 * IMPORTANT: Only use with sources that are safe for Web Audio routing
 * (blob: URLs, same-origin URLs, or CORS-enabled remote storage URLs with
 * crossOrigin="anonymous" set on the media element). Cross-origin media
 * elements WITHOUT proper CORS produce a tainted MediaElementAudioSourceNode
 * that silences audio output through the Web Audio graph.
 *
 * If Butterchurn, WebGL, AudioContext, or resume fails at any point, the
 * native <audio> playback path is preserved — the visualizer is a
 * progressive enhancement, never a prerequisite for hearing audio.
 *
 * @module audio-visualizer
 */

import { getEnvironmentConfig } from "./environment.js";

/**
 * Known object-storage hostname patterns that serve media with CORS headers
 * allowing Web Audio analysis when `crossOrigin = "anonymous"` is set on the
 * media element.
 *
 * Matches AWS S3 virtual-hosted-style bucket URLs:
 *   bucket.s3.amazonaws.com             (legacy global endpoint)
 *   bucket.s3.us-east-1.amazonaws.com   (regional)
 *   bucket.s3-us-west-2.amazonaws.com   (legacy regional with dash)
 *
 * Also matches the BFF API hosts (api.vatioboard.com, api.dev.vatioboard.com)
 * which stream media blobs or redirect to S3 with proper CORS headers.
 *
 * Extend this function if additional storage providers are added.
 */

/**
 * Check whether a remote URL points to an allowed CORS-safe object-storage
 * host. These sources are analyzable by Web Audio provided the media element
 * has `crossOrigin = "anonymous"` set before `src` is assigned.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isAllowedStorageHost(hostname) {
  const h = hostname.toLowerCase();
  // bucket.s3.amazonaws.com (legacy global)
  if (h.endsWith(".s3.amazonaws.com")) return true;
  // bucket.s3.us-east-1.amazonaws.com (regional) or
  // bucket.s3-us-west-2.amazonaws.com (legacy regional with dash)
  const s3Idx = h.lastIndexOf(".s3");
  if (s3Idx < 1) return false;
  const afterS3 = h.slice(s3Idx + 3);
  return /^[.-][a-z0-9-]+\.amazonaws\.com$/.test(afterS3);
}

/**
 * Check whether a hostname matches the BFF API host for this environment.
 * BFF media endpoints stream blobs or redirect to S3 with proper CORS
 * headers, so they are safe for Web Audio analysis.
 */
function isAllowedApiHost(hostname) {
  try {
    const { apiBase } = getEnvironmentConfig();
    const apiHost = new URL(apiBase).hostname.toLowerCase();
    return hostname.toLowerCase() === apiHost;
  } catch {
    return false;
  }
}

/**
 * Check whether a media source URL is safe for Web Audio routing via
 * createMediaElementSource().
 *
 * Returns `true` for:
 *  - `blob:` URLs (local, no CORS needed)
 *  - `data:` URLs (inline, no CORS needed)
 *  - Same-origin URLs (no CORS needed)
 *  - Allowed remote object-storage URLs with CORS (S3 presigned URLs) —
 *    these require `crossOrigin = "anonymous"` on the media element.
 *
 * Returns `false` for all other cross-origin URLs, which would produce
 * tainted MediaElementAudioSourceNodes that silence audio output.
 *
 * @param {string} src
 * @returns {boolean}
 */
export function isVisualizerSafeSource(src) {
  if (!src) return false;
  if (src.startsWith("blob:")) return true;
  if (src.startsWith("data:")) return true;

  try {
    const srcUrl = new URL(src, window.location.origin);
    if (srcUrl.origin === window.location.origin) return true;
    return isAllowedStorageHost(srcUrl.hostname) || isAllowedApiHost(srcUrl.hostname);
  } catch {
    return false;
  }
}

/**
 * Check whether a source URL requires `crossOrigin = "anonymous"` on the
 * media element for Web Audio analysis to work without tainting.
 *
 * blob:, data:, and same-origin URLs do NOT need crossOrigin.
 * Allowed remote storage URLs DO need it.
 *
 * @param {string} src
 * @returns {boolean}
 */
export function requiresCrossOriginForAnalysis(src) {
  if (!src) return false;
  if (src.startsWith("blob:") || src.startsWith("data:")) return false;

  try {
    const srcUrl = new URL(src, window.location.origin);
    if (srcUrl.origin === window.location.origin) return false;
    return isAllowedStorageHost(srcUrl.hostname) || isAllowedApiHost(srcUrl.hostname);
  } catch {
    return false;
  }
}

let butterchurnModule = null;
let presetsModule = null;

async function loadButterchurn() {
  if (butterchurnModule) return butterchurnModule;
  try {
    const [bc, presets] = await Promise.all([
      import("butterchurn"),
      import("butterchurn-presets"),
    ]);
    butterchurnModule = bc.default || bc;
    const presetLib = presets.default || presets;
    presetsModule = typeof presetLib.getPresets === "function"
      ? presetLib.getPresets()
      : presetLib;
    return butterchurnModule;
  } catch {
    return null;
  }
}

/**
 * Create an audio visualizer controller. Loads Butterchurn and sets up a
 * WebGL canvas, but does NOT create an AudioContext or wire audio until
 * resume() is called from a user-gesture handler.
 *
 * @param {object} options
 * @param {HTMLElement} options.stage - Container to mount the canvas in
 * @param {HTMLAudioElement} options.audioElement - The audio element to visualize
 * @returns {Promise<{ resume: () => Promise<boolean>, destroy: () => void } | null>}
 *   null if Butterchurn or WebGL is unavailable.
 */
export async function createAudioVisualizer({ stage, audioElement }) {
  if (!stage || !audioElement) return null;

  const Butterchurn = await loadButterchurn();
  if (!Butterchurn || !presetsModule) return null;

  const canvas = document.createElement("canvas");
  canvas.className = "media-player-visualizer";
  canvas.width = stage.clientWidth || 300;
  canvas.height = stage.clientHeight || 200;

  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return null;

  // Audio wiring state — deferred until resume()
  let audioCtx = null;
  let source = null;
  let visualizer = null;
  let wired = false;
  let failed = false;
  let destroyed = false;
  let rafId = null;
  let observer = null;

  function startRenderLoop() {
    if (rafId || destroyed || !visualizer) return;
    function render() {
      if (destroyed) return;
      visualizer.render();
      rafId = requestAnimationFrame(render);
    }
    rafId = requestAnimationFrame(render);
  }

  /**
   * Wire the AudioContext and start the visualizer. Call from a user-gesture
   * handler (e.g. play button click) so the AudioContext starts in "running"
   * state. Idempotent: subsequent calls re-resume a suspended context.
   *
   * @returns {Promise<boolean>} true if visualizer is active, false on failure.
   *   On failure the native <audio> playback path is preserved.
   */
  async function resume() {
    if (destroyed || failed) return false;

    // Already wired — just ensure context is running
    if (wired) {
      if (audioCtx?.state === "suspended") {
        try { await audioCtx.resume(); } catch { /* best effort */ }
      }
      return audioCtx?.state === "running";
    }

    try {
      // 1. Create AudioContext from user gesture for autoplay-policy compat
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      // 2. Verify context is running before wiring — protects native audio path
      if (audioCtx.state !== "running") {
        audioCtx.close().catch(() => {});
        audioCtx = null;
        failed = true;
        return false;
      }

      // 3. Create Butterchurn visualizer
      visualizer = Butterchurn.createVisualizer(audioCtx, canvas, {
        width: canvas.width,
        height: canvas.height,
      });

      // 4. Wire audio source — point of no return for audio routing.
      //    Only reached when AudioContext is confirmed "running".
      source = audioCtx.createMediaElementSource(audioElement);
      source.connect(audioCtx.destination);
      wired = true;

      visualizer.connectAudio(source);

      // 5. Load a random preset
      const presetKeys = Object.keys(presetsModule);
      if (presetKeys.length > 0) {
        const key = presetKeys[Math.floor(Math.random() * presetKeys.length)];
        visualizer.loadPreset(presetsModule[key], 0);
      }

      // 6. Mount canvas and start rendering
      stage.prepend(canvas);
      startRenderLoop();

      // 7. Responsive resize
      try {
        observer = new ResizeObserver(([entry]) => {
          if (destroyed) return;
          const { width, height } = entry.contentRect;
          const w = Math.round(width) || 300;
          const h = Math.round(height) || 200;
          canvas.width = w;
          canvas.height = h;
          visualizer.setRendererSize(w, h);
        });
        observer.observe(stage);
      } catch {
        // ResizeObserver not available — canvas stays fixed-size
      }

      return true;
    } catch {
      failed = true;
      // If audio was already wired, keep AudioContext alive so audio continues
      if (!wired && audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
      canvas.remove();
      return false;
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (observer) observer.disconnect();
    if (source) {
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
    }
    canvas.remove();
  }

  return { resume, destroy };
}
