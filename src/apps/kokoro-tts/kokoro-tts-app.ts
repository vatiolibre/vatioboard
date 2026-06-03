import "./kokoro-tts.less";

import { env as transformersEnv } from "@huggingface/transformers";
import { clampElementToViewport, makePanelDraggable } from "../../calculator/widget/drag.js";
import { IconClose, IconDownload, IconMinimize, IconPlay, IconTrash, IconVolume } from "../../icons.js";
import { registerFloatingPanel } from "../../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../../shared/shell-window-manager.js";
import type { ShellLifecycleOptions, ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";
import {
  cacheKokoroAsset,
  cacheKokoroAssets,
  createKokoroChunkedCache,
  getKokoroPrimeAssets,
  getKokoroRuntimeAsset,
  KOKORO_MODEL_ID,
  KOKORO_ORT_WASM_MJS_URL,
  KOKORO_ORT_WASM_URL,
  readCachedKokoroAsset,
  type KokoroDtype,
  type KokoroAssetDescriptor,
  type KokoroAssetProgress,
} from "./kokoro-model-cache.js";
import { kokoroTtsWindowCapabilities } from "./manifest.js";

export const KOKORO_TTS_APP_ID = "vatio.kokoroTts";
export const KOKORO_TTS_WINDOW_ID = "kokoro-tts";
export const KOKORO_TTS_SETTINGS_KEY = "preferences";

const DRAG_THRESHOLD_PX = 8;
const DEFAULT_TEXT = "The cabin clock says 10:15 and the route ahead looks clear.";
const DEFAULT_VOICE = "af_heart";
const VOICES = [
  { id: "af_heart", label: "Heart" },
  { id: "af_bella", label: "Bella" },
  { id: "af_nicole", label: "Nicole" },
  { id: "am_michael", label: "Michael" },
  { id: "bf_emma", label: "Emma" },
] as const;
const DTYPES: KokoroDtype[] = ["q8", "q4"];

type KokoroTtsInstance = {
  generate(text: string, options?: { voice?: string; speed?: number }): Promise<{ toBlob(): Blob }>;
};

type OnnxWasmEnv = {
  numThreads?: number;
  proxy?: boolean;
  wasmBinary?: ArrayBuffer | Uint8Array;
  wasmPaths?: string | {
    mjs?: string | URL;
    wasm?: string | URL;
  };
};

export interface KokoroTtsAppOptions {
  mount?: HTMLElement;
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
  restoreVisibility?: boolean;
}

export interface KokoroTtsAppApi {
  open(options?: ShellLifecycleOptions): void;
  close(options?: ShellLifecycleOptions): void;
  minimize(options?: ShellLifecycleOptions): void;
  destroy(): void;
  runtime: VatioAppRuntime | null;
}

interface KokoroPreferences {
  text?: string;
  voice?: string;
  dtype?: KokoroDtype;
}

interface KokoroView {
  panel: HTMLElement;
  header: HTMLElement;
  minimizeButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  textInput: HTMLTextAreaElement;
  status: HTMLElement;
  progress: HTMLElement;
  progressBar: HTMLElement;
  diagnostics: HTMLElement;
  cacheButton: HTMLButtonElement;
  loadButton: HTMLButtonElement;
  speakButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  segmentButtons: HTMLButtonElement[];
}

export function resolveKokoroTtsRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<KokoroTtsAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === KOKORO_TTS_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(KOKORO_TTS_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(KOKORO_TTS_APP_ID)
    || null;
}

function isKokoroDtype(value: unknown): value is KokoroDtype {
  return typeof value === "string" && DTYPES.includes(value as KokoroDtype);
}

function isVoice(value: unknown): value is string {
  return typeof value === "string" && VOICES.some((voice) => voice.id === value);
}

function loadPreferences(runtime: VatioAppRuntime | null): Required<KokoroPreferences> {
  const stored = runtime?.services.settings?.getJson<KokoroPreferences | null>(KOKORO_TTS_SETTINGS_KEY, null) || null;
  return {
    text: typeof stored?.text === "string" && stored.text.trim() ? stored.text : DEFAULT_TEXT,
    voice: isVoice(stored?.voice) ? stored.voice : DEFAULT_VOICE,
    dtype: isKokoroDtype(stored?.dtype) ? stored.dtype : "q8",
  };
}

function savePreferences(runtime: VatioAppRuntime | null, preferences: Required<KokoroPreferences>) {
  runtime?.services.settings?.setJson(KOKORO_TTS_SETTINGS_KEY, preferences);
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
  button.toggleAttribute("aria-busy", busy);
}

function formatBytes(value: number | null | undefined): string {
  if (!Number.isFinite(value || 0) || !value) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex++;
  }
  return `${scaled >= 10 || unitIndex === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unitIndex]}`;
}

function stopControlPropagation(element: HTMLElement) {
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("pointerup", (event) => event.stopPropagation());
}

function buildSegmentGroup(name: string, values: readonly { id: string; label: string }[], selected: string): string {
  return `
    <div class="kokoro-tts-segments" role="group" aria-label="${name}">
      ${values.map((value) => `
        <button
          type="button"
          class="kokoro-tts-segment"
          data-kokoro-field="${name}"
          data-kokoro-value="${value.id}"
          aria-pressed="${value.id === selected ? "true" : "false"}"
        >${value.label}</button>
      `).join("")}
    </div>
  `;
}

function buildPanel(preferences: Required<KokoroPreferences>): KokoroView {
  const panel = document.createElement("section");
  panel.className = "kokoro-tts-panel";
  panel.setAttribute("aria-label", "Kokoro TTS Lab");
  panel.innerHTML = `
    <header class="kokoro-tts-header">
      <div class="kokoro-tts-title">
        <span class="kokoro-tts-mark" aria-hidden="true">${IconVolume}</span>
        <span>Kokoro TTS</span>
      </div>
      <div class="kokoro-tts-window-actions">
        <button type="button" class="kokoro-tts-window-button" data-kokoro-minimize aria-label="Minimize">${IconMinimize}</button>
        <button type="button" class="kokoro-tts-window-button" data-kokoro-close aria-label="Close">${IconClose}</button>
      </div>
    </header>

    <div class="kokoro-tts-body">
      <div class="kokoro-tts-meter" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>

      <label class="kokoro-tts-field">
        <span>Text</span>
        <textarea data-kokoro-text rows="4" spellcheck="true"></textarea>
      </label>

      <div class="kokoro-tts-grid">
        <div>
          <span class="kokoro-tts-label">Voice</span>
          ${buildSegmentGroup("voice", VOICES, preferences.voice)}
        </div>
        <div>
          <span class="kokoro-tts-label">Model</span>
          ${buildSegmentGroup("dtype", DTYPES.map((id) => ({ id, label: id.toUpperCase() })), preferences.dtype)}
        </div>
      </div>

      <div class="kokoro-tts-actions">
        <button type="button" class="kokoro-tts-action" data-kokoro-cache>${IconDownload}<span>Prime</span></button>
        <button type="button" class="kokoro-tts-action" data-kokoro-load><span>Load</span></button>
        <button type="button" class="kokoro-tts-action kokoro-tts-action--primary" data-kokoro-speak>${IconPlay}<span>Speak</span></button>
        <button type="button" class="kokoro-tts-action" data-kokoro-stop>${IconTrash}<span>Stop</span></button>
      </div>

      <div class="kokoro-tts-status">
        <div>
          <strong data-kokoro-status>Ready</strong>
          <span data-kokoro-progress>Chunk cache idle</span>
        </div>
        <div class="kokoro-tts-progress" aria-hidden="true">
          <span data-kokoro-progress-bar></span>
        </div>
      </div>

      <dl class="kokoro-tts-diagnostics" data-kokoro-diagnostics>
        <div><dt>Model</dt><dd>${KOKORO_MODEL_ID}</dd></div>
        <div><dt>Cache</dt><dd>5 MB chunks</dd></div>
        <div><dt>Runtime</dt><dd>WASM</dd></div>
      </dl>
    </div>
  `;

  const textInput = panel.querySelector("[data-kokoro-text]") as HTMLTextAreaElement;
  textInput.value = preferences.text;

  return {
    panel,
    header: panel.querySelector(".kokoro-tts-header") as HTMLElement,
    minimizeButton: panel.querySelector("[data-kokoro-minimize]") as HTMLButtonElement,
    closeButton: panel.querySelector("[data-kokoro-close]") as HTMLButtonElement,
    textInput,
    status: panel.querySelector("[data-kokoro-status]") as HTMLElement,
    progress: panel.querySelector("[data-kokoro-progress]") as HTMLElement,
    progressBar: panel.querySelector("[data-kokoro-progress-bar]") as HTMLElement,
    diagnostics: panel.querySelector("[data-kokoro-diagnostics]") as HTMLElement,
    cacheButton: panel.querySelector("[data-kokoro-cache]") as HTMLButtonElement,
    loadButton: panel.querySelector("[data-kokoro-load]") as HTMLButtonElement,
    speakButton: panel.querySelector("[data-kokoro-speak]") as HTMLButtonElement,
    stopButton: panel.querySelector("[data-kokoro-stop]") as HTMLButtonElement,
    segmentButtons: Array.from(panel.querySelectorAll("[data-kokoro-field]")) as HTMLButtonElement[],
  };
}

export function createKokoroTtsApp(options: KokoroTtsAppOptions = {}): KokoroTtsAppApi {
  const {
    mount = document.body,
    shellManager = getDefaultShellWindowManager(),
    restoreVisibility = false,
  } = options;
  const runtime = resolveKokoroTtsRuntime(options);
  const preferences = loadPreferences(runtime);
  const view = buildPanel(preferences);
  const {
    panel,
    header,
    minimizeButton,
    closeButton,
    textInput,
    status,
    progress,
    progressBar,
    diagnostics,
    cacheButton,
    loadButton,
    speakButton,
    stopButton,
    segmentButtons,
  } = view;

  let dtype: KokoroDtype = preferences.dtype;
  let voice = preferences.voice;
  let tts: KokoroTtsInstance | null = null;
  let loadingPromise: Promise<KokoroTtsInstance> | null = null;
  let audio: HTMLAudioElement | null = null;
  let audioUrl = "";
  let destroyed = false;

  function persist() {
    savePreferences(runtime, {
      text: textInput.value,
      voice,
      dtype,
    });
  }

  function setStatus(nextStatus: string, nextProgress = "") {
    status.textContent = nextStatus;
    if (nextProgress) progress.textContent = nextProgress;
  }

  function setProgressRatio(ratio: number | null) {
    if (ratio === null) {
      progressBar.style.width = "0%";
      return;
    }
    progressBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  function renderSegments() {
    for (const button of segmentButtons) {
      const field = button.getAttribute("data-kokoro-field");
      const value = button.getAttribute("data-kokoro-value");
      const active = (field === "voice" && value === voice)
        || (field === "dtype" && value === dtype);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function renderDiagnostics(extra = "") {
    const items = [
      ["Model", KOKORO_MODEL_ID],
      ["Cache", "5 MB chunks"],
      ["Runtime", `WASM / ${dtype.toUpperCase()}`],
      ["ORT", "chunked binary"],
    ];
    if (extra) items.push(["Last", extra]);
    diagnostics.replaceChildren(...items.map(([term, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }));
  }

  function getOnnxWasmEnv(): OnnxWasmEnv {
    const onnxEnv = transformersEnv.backends.onnx as { wasm?: OnnxWasmEnv };
    onnxEnv.wasm ??= {};
    return onnxEnv.wasm;
  }

  function configureTransformersCache() {
    transformersEnv.useCustomCache = true;
    transformersEnv.customCache = createKokoroChunkedCache();
    transformersEnv.useBrowserCache = false;
    transformersEnv.allowLocalModels = false;
    transformersEnv.allowRemoteModels = true;
    const wasmEnv = getOnnxWasmEnv();
    wasmEnv.numThreads = 1;
    wasmEnv.proxy = false;
    wasmEnv.wasmPaths = {
      mjs: KOKORO_ORT_WASM_MJS_URL,
      wasm: KOKORO_ORT_WASM_URL,
    };
  }

  async function prepareOnnxRuntimeBinary() {
    const wasmEnv = getOnnxWasmEnv();
    if (wasmEnv.wasmBinary) return;

    const runtimeAsset = getKokoroRuntimeAsset();
    let buffer = await readCachedKokoroAsset(runtimeAsset);
    if (!buffer) {
      await cacheKokoroAsset(runtimeAsset, (assetProgress) => handleAssetProgress(runtimeAsset, assetProgress));
      buffer = await readCachedKokoroAsset(runtimeAsset);
    }
    if (!buffer) throw new Error("ONNX Runtime WASM binary was not cached.");
    wasmEnv.wasmBinary = buffer;
    setStatus("Runtime ready", `${formatBytes(buffer.byteLength)} ONNX Runtime WASM`);
  }

  function handleAssetProgress(asset: KokoroAssetDescriptor, assetProgress: KokoroAssetProgress) {
    const total = assetProgress.totalBytes;
    const ratio = total ? assetProgress.loadedBytes / total : null;
    const range = assetProgress.rangeCount
      ? `, range ${assetProgress.rangeIndex}/${assetProgress.rangeCount}`
      : "";
    setStatus("Priming cache", `${asset.label}: ${formatBytes(assetProgress.loadedBytes)} / ${formatBytes(total)}${range}`);
    setProgressRatio(ratio);
  }

  async function primeCache() {
    configureTransformersCache();
    const assets = getKokoroPrimeAssets(dtype);
    setButtonBusy(cacheButton, true);
    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
    setProgressRatio(null);
    try {
      await cacheKokoroAssets(
        assets,
        handleAssetProgress,
        (asset, result) => {
          setStatus("Priming cache", `${asset.label}: ${result === "hit" ? "cached" : "stored"}`);
        },
      );
      setProgressRatio(1);
      setStatus("Cache ready", `Runtime + ${dtype.toUpperCase()} model cached`);
      renderDiagnostics("runtime + model cached");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cache priming failed";
      setStatus("Cache failed", message);
      renderDiagnostics(message);
      throw error;
    } finally {
      setButtonBusy(cacheButton, false);
      setButtonBusy(loadButton, false);
      setButtonBusy(speakButton, false);
    }
  }

  async function loadEngine(): Promise<KokoroTtsInstance> {
    configureTransformersCache();
    if (tts) return tts;
    if (loadingPromise) return loadingPromise;

    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
    setStatus("Loading model", "Preparing chunk cache first");
    loadingPromise = (async () => {
      await primeCache();
      await prepareOnnxRuntimeBinary();
      setStatus("Loading model", "Transformers.js is reading the cached ONNX file");
      setProgressRatio(null);
      const module = await import("kokoro-js");
      const loaded = await module.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        dtype,
        device: "wasm",
        progress_callback: (event: unknown) => {
          if (!event || typeof event !== "object") return;
          const detail = event as { status?: string; file?: string; progress?: number; loaded?: number; total?: number };
          if (detail.status === "progress") {
            setStatus("Loading model", `${detail.file || "asset"}: ${Math.round(detail.progress || 0)}%`);
            setProgressRatio(typeof detail.progress === "number" ? detail.progress / 100 : null);
          } else if (detail.status) {
            setStatus("Loading model", detail.file ? `${detail.status}: ${detail.file}` : detail.status);
          }
        },
      }) as KokoroTtsInstance;
      tts = loaded;
      setStatus("Model ready", `${voice} on WASM`);
      setProgressRatio(1);
      renderDiagnostics("model ready");
      return loaded;
    })().finally(() => {
      loadingPromise = null;
      setButtonBusy(loadButton, false);
      setButtonBusy(speakButton, false);
    });
    return loadingPromise;
  }

  function stopAudio() {
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = "";
    }
  }

  async function speak() {
    const text = textInput.value.trim();
    if (!text) {
      setStatus("Text needed", "Add a short sentence first");
      return;
    }
    persist();
    setButtonBusy(speakButton, true);
    setStatus("Generating", "Kokoro is synthesizing locally");
    setProgressRatio(null);
    try {
      const engine = await loadEngine();
      const startedAt = performance.now();
      const output = await engine.generate(text, { voice, speed: 1 });
      stopAudio();
      const blob = output.toBlob();
      audioUrl = URL.createObjectURL(blob);
      audio = new Audio(audioUrl);
      await audio.play();
      const seconds = Math.max(0.1, (performance.now() - startedAt) / 1000);
      setStatus("Speaking", `${formatBytes(blob.size)} WAV generated in ${seconds.toFixed(1)}s`);
      renderDiagnostics("speech generated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speech generation failed";
      setStatus("Generation failed", message);
      renderDiagnostics(message);
    } finally {
      setButtonBusy(speakButton, false);
    }
  }

  function showPanel() {
    panel.hidden = false;
    if (panel.style.left && panel.style.top) clampElementToViewport(panel, 8, { useShellWorkArea: true });
  }

  function hidePanel() {
    panel.hidden = true;
    stopAudio();
  }

  function open(options: ShellLifecycleOptions = {}) {
    showPanel();
    shellManager.openWindow(KOKORO_TTS_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    hidePanel();
    shellManager.closeWindow(KOKORO_TTS_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function minimize(options: ShellLifecycleOptions = {}) {
    hidePanel();
    shellManager.minimizeWindow(KOKORO_TTS_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  mount.append(panel);
  renderSegments();
  renderDiagnostics();
  panel.hidden = !restoreVisibility;

  const cleanupLayer = registerFloatingPanel(panel, {
    id: KOKORO_TTS_WINDOW_ID,
    kind: "tool",
    title: "Kokoro TTS",
    shellManager,
    capabilities: kokoroTtsWindowCapabilities,
    lifecycle: {
      open: showPanel,
      close: hidePanel,
      minimize: hidePanel,
      restore: showPanel,
      destroy: hidePanel,
    },
  });

  makePanelDraggable({
    panel,
    header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos: () => {},
    loadPos: () => null,
    shellWindowId: KOKORO_TTS_WINDOW_ID,
    shellManager,
    enableSnapPreview: false,
  });

  for (const control of [minimizeButton, closeButton]) stopControlPropagation(control);

  minimizeButton.addEventListener("click", () => minimize({ fromUserGesture: true }));
  closeButton.addEventListener("click", () => close({ fromUserGesture: true }));
  cacheButton.addEventListener("click", () => {
    primeCache().catch((error) => runtime?.logger.warn("Kokoro cache prime failed.", error));
  });
  loadButton.addEventListener("click", () => {
    loadEngine().catch((error) => runtime?.logger.warn("Kokoro model load failed.", error));
  });
  speakButton.addEventListener("click", () => {
    speak().catch((error) => runtime?.logger.warn("Kokoro speech failed.", error));
  });
  stopButton.addEventListener("click", () => {
    stopAudio();
    setStatus("Stopped", "Audio output cleared");
  });
  textInput.addEventListener("change", persist);
  textInput.addEventListener("blur", persist);

  panel.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-kokoro-field]") : null;
    if (!(target instanceof HTMLButtonElement)) return;
    const field = target.getAttribute("data-kokoro-field");
    const value = target.getAttribute("data-kokoro-value");
    if (field === "voice" && isVoice(value)) voice = value;
    if (field === "dtype" && isKokoroDtype(value)) dtype = value;
    tts = null;
    renderSegments();
    renderDiagnostics("settings changed");
    persist();
    setStatus("Ready", "Load again after changing engine settings");
  });

  if (restoreVisibility) open({ invokeLifecycle: false });

  runtime?.logger.debug("Kokoro TTS lab mounted with chunked model cache.");

  return {
    open,
    close,
    minimize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopAudio();
      cleanupLayer();
      panel.remove();
    },
    runtime,
  };
}

export const createShellWindowApp = createKokoroTtsApp;
