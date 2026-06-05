import "./kokoro-tts.less";

import { clampElementToViewport, makePanelDraggable } from "../../calculator/widget/drag.js";
import { IconClose, IconDownload, IconMinimize, IconPlay, IconTrash, IconVolume } from "../../icons.js";
import { registerFloatingPanel } from "../../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../../shared/shell-window-manager.js";
import type { ShellBounds, ShellLifecycleOptions, ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";
import {
  KOKORO_MODEL_ID,
} from "./kokoro-model-cache.js";
import {
  KOKORO_ACCELERATIONS,
  KOKORO_LANGS,
  KOKORO_MODEL_BY_ID,
  KOKORO_MODELS,
  KOKORO_VOICE_BY_ID,
  KOKORO_VOICES_BY_LANG,
  PIPER_VOICE_BY_ID,
  PIPER_VOICES_BY_LANG,
  TTS_ENGINES,
  getDefaultPiperVoiceForLang,
  getDefaultVoiceForLang,
  getLangForVoice,
  getLangForPiperVoice,
  isKokoroAcceleration,
  isKokoroDirectModelId,
  isKokoroLangId,
  isKokoroVoiceId,
  isPiperVoiceId,
  isTtsEngineId,
  type KokoroAcceleration,
  type KokoroDirectModelId,
  type KokoroLangId,
  type KokoroVoiceId,
  type PiperVoiceId,
  type TtsEngineId,
} from "./kokoro-direct-resources.js";
import type { KokoroWorkerRequest, KokoroWorkerRequestPayload, KokoroWorkerResponse } from "./kokoro-worker-protocol.js";
import { kokoroTtsWindowCapabilities } from "./manifest.js";

export const KOKORO_TTS_APP_ID = "vatio.kokoroTts";
export const KOKORO_TTS_WINDOW_ID = "kokoro-tts";
export const KOKORO_TTS_SETTINGS_KEY = "preferences";

const DRAG_THRESHOLD_PX = 8;
const RESIZE_MIN_WIDTH = 320;
const RESIZE_MIN_HEIGHT = 360;
const RESIZE_MARGIN_PX = 12;
const DEFAULT_BOUNDS = {
  left: 52,
  top: 108,
  width: 456,
  height: 560,
};
const DEFAULT_TEXT = "Hola. The cabin clock says 10:15 and the route ahead looks clear.";
const DEFAULT_LANG: KokoroLangId = "en-us";
const DEFAULT_VOICE: KokoroVoiceId = "af_heart";
const DEFAULT_PIPER_VOICE: PiperVoiceId = "en_US-lessac-medium";
const DEFAULT_MODEL: KokoroDirectModelId = "model_q8f16";
const DEFAULT_ACCELERATION: KokoroAcceleration = "auto";
const DEFAULT_ENGINE: TtsEngineId = "piper";

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
  engine?: TtsEngineId;
  piperVoice?: PiperVoiceId;
  voice?: KokoroVoiceId;
  lang?: KokoroLangId;
  model?: KokoroDirectModelId;
  acceleration?: KokoroAcceleration;
}

interface KokoroView {
  panel: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
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
  resizeHandle: HTMLButtonElement;
  voiceSegments: HTMLElement;
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

function loadPreferences(runtime: VatioAppRuntime | null): Required<KokoroPreferences> {
  const stored = runtime?.services.settings?.getJson<KokoroPreferences | null>(KOKORO_TTS_SETTINGS_KEY, null) || null;
  const storedEngine = isTtsEngineId(stored?.engine) ? stored.engine : DEFAULT_ENGINE;
  const storedLang = isKokoroLangId(stored?.lang)
    ? stored.lang
    : isPiperVoiceId(stored?.piperVoice)
      ? getLangForPiperVoice(stored.piperVoice)
    : isKokoroVoiceId(stored?.voice)
      ? getLangForVoice(stored.voice)
      : DEFAULT_LANG;
  const safeLang = storedEngine === "piper" && !PIPER_VOICES_BY_LANG[storedLang]?.length ? DEFAULT_LANG : storedLang;
  const storedVoice = isKokoroVoiceId(stored?.voice) && KOKORO_VOICE_BY_ID[stored.voice].lang === safeLang
    ? stored.voice
    : getDefaultVoiceForLang(safeLang);
  const storedPiperVoice = isPiperVoiceId(stored?.piperVoice) && PIPER_VOICE_BY_ID[stored.piperVoice].lang === safeLang
    ? stored.piperVoice
    : getDefaultPiperVoiceForLang(safeLang);
  return {
    text: typeof stored?.text === "string" && stored.text.trim() ? stored.text : DEFAULT_TEXT,
    engine: storedEngine,
    piperVoice: storedPiperVoice || DEFAULT_PIPER_VOICE,
    voice: storedVoice || DEFAULT_VOICE,
    lang: safeLang,
    model: isKokoroDirectModelId(stored?.model) ? stored.model : DEFAULT_MODEL,
    acceleration: isKokoroAcceleration(stored?.acceleration) ? stored.acceleration : DEFAULT_ACCELERATION,
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

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPanelBounds(panel: HTMLElement): ShellBounds {
  const rect = panel.getBoundingClientRect();
  return {
    left: Number.parseFloat(panel.style.left) || rect.left || DEFAULT_BOUNDS.left,
    top: Number.parseFloat(panel.style.top) || rect.top || DEFAULT_BOUNDS.top,
    width: Math.round(rect.width || panel.offsetWidth || Number.parseFloat(panel.style.width) || DEFAULT_BOUNDS.width),
    height: Math.round(rect.height || panel.offsetHeight || Number.parseFloat(panel.style.height) || DEFAULT_BOUNDS.height),
  };
}

function clampResizeBounds(width: number, height: number, bounds: ShellBounds): Required<ShellBounds> {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
  const left = Number.isFinite(bounds.left) ? bounds.left : DEFAULT_BOUNDS.left;
  const top = Number.isFinite(bounds.top) ? bounds.top : DEFAULT_BOUNDS.top;
  const maxWidth = Math.max(RESIZE_MIN_WIDTH, viewportWidth - left - RESIZE_MARGIN_PX);
  const maxHeight = Math.max(RESIZE_MIN_HEIGHT, viewportHeight - top - RESIZE_MARGIN_PX);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(clampNumber(width, Math.min(RESIZE_MIN_WIDTH, maxWidth), maxWidth)),
    height: Math.round(clampNumber(height, Math.min(RESIZE_MIN_HEIGHT, maxHeight), maxHeight)),
  };
}

function applyInitialBounds(panel: HTMLElement, shellManager: ShellRuntime) {
  const storedBounds = shellManager.getWindow(KOKORO_TTS_WINDOW_ID)?.bounds;
  const bounds = {
    ...DEFAULT_BOUNDS,
    ...(storedBounds || {}),
  };

  panel.style.position = "fixed";
  panel.style.left = `${Math.round(bounds.left ?? DEFAULT_BOUNDS.left)}px`;
  panel.style.top = `${Math.round(bounds.top ?? DEFAULT_BOUNDS.top)}px`;
  panel.style.width = `${Math.round(bounds.width ?? DEFAULT_BOUNDS.width)}px`;
  panel.style.height = `${Math.round(bounds.height ?? DEFAULT_BOUNDS.height)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function buildSegmentGroup(
  name: string,
  values: readonly { id: string; label: string; detail?: string; title?: string }[],
  selected: string,
): string {
  return `
    <div class="kokoro-tts-segments" role="group" aria-label="${name}">
      ${values.map((value) => `
        <button
          type="button"
          class="kokoro-tts-segment"
          data-kokoro-field="${name}"
          data-kokoro-value="${value.id}"
          ${value.title ? `title="${value.title}"` : ""}
          aria-pressed="${value.id === selected ? "true" : "false"}"
        ><span>${value.label}</span>${value.detail ? `<small>${value.detail}</small>` : ""}</button>
      `).join("")}
    </div>
  `;
}

function buildPanel(preferences: Required<KokoroPreferences>): KokoroView {
  const panel = document.createElement("section");
  panel.className = "kokoro-tts-panel";
  panel.dataset.ttsEngine = preferences.engine;
  panel.setAttribute("aria-label", "TTS");
  panel.innerHTML = `
    <header class="kokoro-tts-header">
      <div class="kokoro-tts-title">
        <span class="kokoro-tts-mark" aria-hidden="true">${IconVolume}</span>
        <span>TTS</span>
      </div>
      <div class="kokoro-tts-window-actions">
        <button type="button" class="kokoro-tts-window-button" data-kokoro-minimize aria-label="Minimize">${IconMinimize}</button>
        <button type="button" class="kokoro-tts-window-button" data-kokoro-close aria-label="Close">${IconClose}</button>
      </div>
    </header>

    <div class="kokoro-tts-body">
      <label class="kokoro-tts-field">
        <span>Text</span>
        <textarea data-kokoro-text rows="3" spellcheck="true"></textarea>
      </label>

      <div class="kokoro-tts-grid">
        <div>
          <span class="kokoro-tts-label">Engine</span>
          ${buildSegmentGroup("engine", TTS_ENGINES.map((engine) => ({
            id: engine.id,
            label: engine.label,
            detail: engine.detail,
            title: engine.title,
          })), preferences.engine)}
        </div>
        <div>
          <span class="kokoro-tts-label">Language</span>
          ${buildSegmentGroup("lang", KOKORO_LANGS.map((lang) => ({
            id: lang.id,
            label: lang.label,
            title: lang.name,
          })), preferences.lang)}
        </div>
        <div>
          <span class="kokoro-tts-label">Voice</span>
          <div class="kokoro-tts-segments kokoro-tts-segments--voices" data-kokoro-voice-segments role="group" aria-label="voice"></div>
        </div>
        <div data-tts-premium>
          <span class="kokoro-tts-label">Lab model</span>
          ${buildSegmentGroup("model", KOKORO_MODELS.map((model) => ({
            id: model.id,
            label: model.label,
            detail: model.detail,
            title: model.quantization,
          })), preferences.model)}
        </div>
        <div data-tts-premium>
          <span class="kokoro-tts-label">Acceleration</span>
          ${buildSegmentGroup("acceleration", KOKORO_ACCELERATIONS.map((item) => ({
            id: item.id,
            label: item.label,
            detail: item.detail,
          })), preferences.acceleration)}
        </div>
      </div>

      <div class="kokoro-tts-actions">
        <button type="button" class="kokoro-tts-action" data-kokoro-cache>${IconDownload}<span>Prime</span></button>
        <button type="button" class="kokoro-tts-action" data-kokoro-load><span>Load</span></button>
        <button type="button" class="kokoro-tts-action kokoro-tts-action--primary" data-kokoro-speak>${IconPlay}<span>Speak</span></button>
        <button type="button" class="kokoro-tts-action" data-kokoro-stop>${IconTrash}<span>Stop</span></button>
      </div>

      <div class="kokoro-tts-status" aria-live="polite">
        <div>
          <strong data-kokoro-status>Ready</strong>
          <span data-kokoro-progress>Chunk cache idle</span>
        </div>
        <div class="kokoro-tts-progress" aria-hidden="true">
          <span data-kokoro-progress-bar></span>
        </div>
      </div>

      <dl class="kokoro-tts-diagnostics" data-kokoro-diagnostics>
        <div><dt>Engine</dt><dd>Neural Piper</dd></div>
        <div><dt>Cache</dt><dd>5 MB chunks</dd></div>
        <div><dt>Lab</dt><dd>Kokoro ONNX</dd></div>
      </dl>
    </div>
    <button type="button" class="kokoro-tts-resize" data-kokoro-resize aria-label="Resize TTS" title="Resize TTS"></button>
  `;

  const textInput = panel.querySelector("[data-kokoro-text]") as HTMLTextAreaElement;
  textInput.value = preferences.text;

  return {
    panel,
    header: panel.querySelector(".kokoro-tts-header") as HTMLElement,
    body: panel.querySelector(".kokoro-tts-body") as HTMLElement,
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
    resizeHandle: panel.querySelector("[data-kokoro-resize]") as HTMLButtonElement,
    voiceSegments: panel.querySelector("[data-kokoro-voice-segments]") as HTMLElement,
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
    resizeHandle,
    voiceSegments,
  } = view;

  let engine: TtsEngineId = preferences.engine;
  let acceleration: KokoroAcceleration = preferences.acceleration;
  let lang: KokoroLangId = preferences.lang;
  let model: KokoroDirectModelId = preferences.model;
  let piperVoice: PiperVoiceId = preferences.piperVoice;
  let voice: KokoroVoiceId = preferences.voice;
  let worker: Worker | null = null;
  let workerRequestId = 0;
  const pendingWorkerRequests = new Map<number, {
    resolve: (message: KokoroWorkerResponse) => void;
    reject: (error: Error) => void;
  }>();
  let modelReady = false;
  let loadingPromise: Promise<void> | null = null;
  let generating = false;
  let audio: HTMLAudioElement | null = null;
  let audioUrl = "";
  let destroyed = false;
  let resizePointerId: number | null = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeLastX = 0;
  let resizeLastY = 0;
  let resizeRafId = 0;
  let resizing = false;

  function persist() {
    savePreferences(runtime, {
      text: textInput.value,
      engine,
      piperVoice,
      voice,
      lang,
      model,
      acceleration,
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

  function normalizeSelectionForEngine() {
    if (engine === "piper") {
      if (!PIPER_VOICES_BY_LANG[lang]?.length) {
        lang = DEFAULT_LANG;
      }
      if (!PIPER_VOICES_BY_LANG[lang]?.some((item) => item.id === piperVoice)) {
        piperVoice = getDefaultPiperVoiceForLang(lang);
      }
      return;
    }

    if (!KOKORO_VOICES_BY_LANG[lang]?.some((item) => item.id === voice)) {
      voice = getDefaultVoiceForLang(lang);
    }
  }

  function renderVoiceSegments() {
    normalizeSelectionForEngine();
    const voices = engine === "piper" ? PIPER_VOICES_BY_LANG[lang] || [] : KOKORO_VOICES_BY_LANG[lang] || [];
    const activeVoice = engine === "piper" ? piperVoice : voice;
    voiceSegments.replaceChildren(...voices.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kokoro-tts-segment";
      button.dataset.kokoroField = "voice";
      button.dataset.kokoroValue = item.id;
      button.setAttribute("aria-pressed", item.id === activeVoice ? "true" : "false");
      button.title = item.id;
      const label = document.createElement("span");
      label.textContent = item.name;
      button.append(label);
      if ("detail" in item) {
        const detail = document.createElement("small");
        detail.textContent = item.detail;
        button.append(detail);
      }
      return button;
    }));
  }

  function renderSegments() {
    normalizeSelectionForEngine();
    panel.dataset.ttsEngine = engine;
    renderVoiceSegments();
    for (const button of Array.from(panel.querySelectorAll("[data-kokoro-field]")) as HTMLButtonElement[]) {
      const field = button.getAttribute("data-kokoro-field");
      const value = button.getAttribute("data-kokoro-value");
      const languageAvailable = field !== "lang"
        || engine !== "piper"
        || (isKokoroLangId(value) && Boolean(PIPER_VOICES_BY_LANG[value]?.length));
      const active = (field === "voice" && value === voice)
        || (field === "voice" && engine === "piper" && value === piperVoice)
        || (field === "engine" && value === engine)
        || (field === "lang" && value === lang)
        || (field === "model" && value === model)
        || (field === "acceleration" && value === acceleration);
      button.disabled = !languageAvailable;
      button.toggleAttribute("aria-disabled", !languageAvailable);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function renderDiagnostics(extra = "") {
    const selectedModel = KOKORO_MODEL_BY_ID[model];
    const items = engine === "piper"
      ? [
        ["Engine", "Neural Piper"],
        ["Cache", "5 MB chunks"],
        ["Voice", `${PIPER_VOICE_BY_ID[piperVoice]?.name || piperVoice} / ${lang.toUpperCase()}`],
        ["Runtime", "ONNX WASM"],
      ]
      : engine === "espeak"
        ? [
        ["Engine", "Fast eSpeak NG"],
        ["Cache", "5 MB chunks"],
        ["Voice", `${lang.toUpperCase()} utility voice`],
        ["Model", "Tiny WASM voice"],
      ]
        : [
        ["Engine", "Premium Kokoro"],
        ["Model", KOKORO_MODEL_ID],
        ["Voice", `${KOKORO_VOICE_BY_ID[voice]?.name || voice} / ${lang.toUpperCase()}`],
        ["Runtime", `${selectedModel.label} ${selectedModel.detail} / ${acceleration.toUpperCase()}`],
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

  function handleWorkerMessage(message: KokoroWorkerResponse) {
    if (message.type === "status") {
      setStatus(message.status, message.progress || "");
      setProgressRatio(message.ratio ?? null);
      return;
    }

    const pending = pendingWorkerRequests.get(message.id);
    if (!pending) return;
    pendingWorkerRequests.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.message));
      return;
    }
    pending.resolve(message);
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./kokoro-tts-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<KokoroWorkerResponse>) => {
      handleWorkerMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "TTS worker failed.");
      for (const pending of pendingWorkerRequests.values()) pending.reject(error);
      pendingWorkerRequests.clear();
      setStatus("Worker failed", error.message);
      renderDiagnostics(error.message);
      modelReady = false;
      loadingPromise = null;
      generating = false;
      worker?.terminate();
      worker = null;
    });
    return worker;
  }

  function resetWorker(reason = "Worker reset") {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    const error = new Error(reason);
    for (const pending of pendingWorkerRequests.values()) pending.reject(error);
    pendingWorkerRequests.clear();
    modelReady = false;
    loadingPromise = null;
    generating = false;
    setButtonBusy(cacheButton, false);
    setButtonBusy(loadButton, false);
    setButtonBusy(speakButton, false);
  }

  function sendWorkerRequest(request: KokoroWorkerRequestPayload): Promise<KokoroWorkerResponse> {
    const id = ++workerRequestId;
    const nextRequest = { ...request, id } as KokoroWorkerRequest;
    const targetWorker = ensureWorker();
    return new Promise((resolve, reject) => {
      pendingWorkerRequests.set(id, { resolve, reject });
      targetWorker.postMessage(nextRequest);
    });
  }

  function getWorkerSettings() {
    return {
      acceleration,
      engine,
      lang,
      model,
      piperVoice,
      voice,
      voiceFormula: voice,
      speed: 1,
    };
  }

  async function primeCache() {
    const requestedSettings = getWorkerSettings();
    setButtonBusy(cacheButton, true);
    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
    setProgressRatio(null);
    try {
      const message = await sendWorkerRequest({ type: "prime", ...requestedSettings });
      setProgressRatio(1);
      const engineName = message.type === "primed" && message.engine === "piper"
        ? "Piper voice"
        : message.type === "primed" && message.engine === "espeak"
          ? "Tiny voice"
          : "Kokoro model";
      setStatus("Cache ready", `${engineName} cached on ${message.type === "primed" ? message.provider.toUpperCase() : "WASM"}`);
      renderDiagnostics(`${engineName.toLowerCase()} cached`);
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

  async function loadEngine(): Promise<void> {
    if (modelReady) return;
    if (loadingPromise) return loadingPromise;

    const requestedSettings = getWorkerSettings();
    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
    setStatus(
      engine === "piper" ? "Loading Piper" : engine === "espeak" ? "Loading voice" : "Loading model",
      "Preparing chunk cache first",
    );
    loadingPromise = (async () => {
      const message = await sendWorkerRequest({ type: "load", ...requestedSettings });
      if (
        requestedSettings.engine !== engine
        || (requestedSettings.engine === "piper" && requestedSettings.piperVoice !== piperVoice)
        || (requestedSettings.engine === "kokoro" && (
          requestedSettings.model !== model
          || requestedSettings.acceleration !== acceleration
        ))
        || requestedSettings.lang !== lang
        || requestedSettings.voice !== voice
      ) {
        modelReady = false;
        setStatus("Ready", "Load again after changing engine settings");
        renderDiagnostics("settings changed");
        return;
      }
      modelReady = true;
      const provider = message.type === "loaded" ? message.provider.toUpperCase() : acceleration.toUpperCase();
      setStatus(
        engine === "piper" ? "Piper ready" : engine === "espeak" ? "Tiny voice ready" : "Model ready",
        engine === "piper"
          ? `${PIPER_VOICE_BY_ID[piperVoice]?.name || piperVoice} on ${provider}`
          : engine === "espeak"
            ? `eSpeak NG on ${provider}`
            : `${KOKORO_VOICE_BY_ID[voice]?.name || voice} on ${provider}`,
      );
      setProgressRatio(1);
      renderDiagnostics(engine === "piper" ? "piper voice ready" : engine === "espeak" ? "tiny voice ready" : "model ready");
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
    const requestedSettings = getWorkerSettings();
    setButtonBusy(cacheButton, true);
    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
    generating = true;
    setStatus(
      "Generating",
      engine === "piper"
        ? "Piper neural voice is synthesizing in a worker"
        : engine === "espeak"
          ? "Tiny voice is synthesizing in a worker"
          : "Kokoro is synthesizing in a worker",
    );
    setProgressRatio(null);
    try {
      const message = await sendWorkerRequest({
        type: "speak",
        text,
        ...requestedSettings,
      });
      if (message.type !== "speech") throw new Error("TTS worker returned an unexpected response.");
      modelReady = requestedSettings.engine === engine
        && requestedSettings.lang === lang
        && requestedSettings.voice === voice
        && (requestedSettings.engine !== "piper" || requestedSettings.piperVoice === piperVoice)
        && (
          requestedSettings.engine === "piper"
          || requestedSettings.engine === "espeak"
          || (requestedSettings.model === model && requestedSettings.acceleration === acceleration)
        );
      stopAudio();
      const blob = message.blob;
      audioUrl = URL.createObjectURL(blob);
      audio = new Audio(audioUrl);
      await audio.play();
      const seconds = Math.max(0.1, message.durationMs / 1000);
      setStatus("Speaking", `${formatBytes(blob.size)} WAV in ${seconds.toFixed(1)}s; audio ${message.audioSeconds.toFixed(1)}s`);
      renderDiagnostics(
        `${message.engine === "piper" ? "piper" : message.engine === "espeak" ? "tiny" : message.provider.toUpperCase()} speech generated`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speech generation failed";
      if (message !== "Generation stopped") {
        setStatus("Generation failed", message);
        renderDiagnostics(message);
      }
    } finally {
      generating = false;
      setButtonBusy(cacheButton, false);
      setButtonBusy(loadButton, false);
      setButtonBusy(speakButton, false);
    }
  }

  function updateShellBounds(bounds: ShellBounds, shellOptions: ShellLifecycleOptions = {}) {
    shellManager.updateWindowBounds(KOKORO_TTS_WINDOW_ID, bounds, shellOptions);
  }

  function applyPanelResize(width: number, height: number, shellOptions: ShellLifecycleOptions = {}) {
    const bounds = clampResizeBounds(width, height, getPanelBounds(panel));
    panel.style.position = "fixed";
    panel.style.left = `${bounds.left}px`;
    panel.style.top = `${bounds.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${bounds.width}px`;
    panel.style.height = `${bounds.height}px`;
    updateShellBounds(bounds, shellOptions);
  }

  function applyHandleResize() {
    resizeRafId = 0;
    if (!resizing) return;
    const dx = resizeLastX - resizeStartX;
    const dy = resizeLastY - resizeStartY;
    applyPanelResize(resizeStartWidth + dx, resizeStartHeight + dy);
  }

  function scheduleHandleResize() {
    if (resizeRafId) return;
    resizeRafId = window.requestAnimationFrame?.(applyHandleResize) || window.setTimeout(applyHandleResize, 0);
  }

  function endHandleResize(event: PointerEvent | Event | null = null) {
    if (event instanceof PointerEvent && resizePointerId !== null && event.pointerId !== resizePointerId) return;
    if (resizeRafId) {
      if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(resizeRafId);
      else window.clearTimeout(resizeRafId);
      resizeRafId = 0;
      applyHandleResize();
    }
    if (!resizing) return;
    resizing = false;
    resizePointerId = null;
    panel.classList.remove("is-resizing");
    document.documentElement.classList.remove("vb-floating-drag-active");
    updateShellBounds(getPanelBounds(panel), { flush: true });
  }

  function resizePanelBy(deltaWidth: number, deltaHeight: number) {
    const bounds = getPanelBounds(panel);
    applyPanelResize(
      (bounds.width || DEFAULT_BOUNDS.width) + deltaWidth,
      (bounds.height || DEFAULT_BOUNDS.height) + deltaHeight,
      { flush: true },
    );
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

  applyInitialBounds(panel, shellManager);
  mount.append(panel);
  renderSegments();
  renderDiagnostics();
  panel.hidden = !restoreVisibility;

  const cleanupLayer = registerFloatingPanel(panel, {
    id: KOKORO_TTS_WINDOW_ID,
    kind: "tool",
    title: "TTS",
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
    onDragEnd: ({ bounds }) => updateShellBounds(bounds, { flush: true }),
    shellWindowId: KOKORO_TTS_WINDOW_ID,
    shellManager,
    enableSnapPreview: false,
  });

  for (const control of [minimizeButton, closeButton, resizeHandle]) stopControlPropagation(control);

  minimizeButton.addEventListener("click", () => minimize({ fromUserGesture: true }));
  closeButton.addEventListener("click", () => close({ fromUserGesture: true }));
  resizeHandle.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (shellManager.getWindow(KOKORO_TTS_WINDOW_ID)?.snap) {
      shellManager.unsnapWindow(KOKORO_TTS_WINDOW_ID, { preserveSnap: false });
    }
    const bounds = getPanelBounds(panel);
    resizing = true;
    resizePointerId = event.pointerId;
    resizeStartX = resizeLastX = event.clientX;
    resizeStartY = resizeLastY = event.clientY;
    resizeStartWidth = bounds.width || DEFAULT_BOUNDS.width;
    resizeStartHeight = bounds.height || DEFAULT_BOUNDS.height;
    panel.classList.add("is-resizing");
    document.documentElement.classList.add("vb-floating-drag-active");
    try {
      resizeHandle.setPointerCapture?.(resizePointerId);
    } catch {
      // Pointer capture is best effort.
    }
  }, { passive: false });
  resizeHandle.addEventListener("pointermove", (event) => {
    if (!resizing || event.pointerId !== resizePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeLastX = event.clientX;
    resizeLastY = event.clientY;
    scheduleHandleResize();
  }, { passive: false });
  resizeHandle.addEventListener("pointerup", endHandleResize);
  resizeHandle.addEventListener("pointercancel", endHandleResize);
  resizeHandle.addEventListener("lostpointercapture", endHandleResize);
  resizeHandle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 80 : 32;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      resizePanelBy(step, 0);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizePanelBy(-step, 0);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      resizePanelBy(0, step);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      resizePanelBy(0, -step);
    }
  });
  cacheButton.addEventListener("click", () => {
    primeCache().catch((error) => runtime?.logger.warn("TTS cache prime failed.", error));
  });
  loadButton.addEventListener("click", () => {
    loadEngine().catch((error) => runtime?.logger.warn("TTS engine load failed.", error));
  });
  speakButton.addEventListener("click", () => {
    speak().catch((error) => runtime?.logger.warn("TTS speech failed.", error));
  });
  stopButton.addEventListener("click", () => {
    stopAudio();
    if (generating || loadingPromise) {
      resetWorker("Generation stopped");
      setStatus("Stopped", "Generation worker reset");
      renderDiagnostics("worker reset");
    } else {
      setStatus("Stopped", "Audio output cleared");
    }
  });
  textInput.addEventListener("change", persist);
  textInput.addEventListener("blur", persist);

  panel.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-kokoro-field]") : null;
    if (!(target instanceof HTMLButtonElement)) return;
    const field = target.getAttribute("data-kokoro-field");
    const value = target.getAttribute("data-kokoro-value");
    if (field === "voice" && engine === "piper" && isPiperVoiceId(value)) {
      piperVoice = value;
      lang = PIPER_VOICE_BY_ID[value].lang;
    } else if (field === "voice" && isKokoroVoiceId(value)) {
      voice = value;
      lang = KOKORO_VOICE_BY_ID[value].lang;
    }
    if (field === "engine" && isTtsEngineId(value)) {
      engine = value;
      normalizeSelectionForEngine();
    }
    if (field === "lang" && isKokoroLangId(value)) {
      lang = value;
      if (engine === "piper") {
        piperVoice = getDefaultPiperVoiceForLang(lang);
      } else if (KOKORO_VOICE_BY_ID[voice]?.lang !== lang) {
        voice = getDefaultVoiceForLang(lang);
      }
    }
    if (field === "model" && isKokoroDirectModelId(value)) model = value;
    if (field === "acceleration" && isKokoroAcceleration(value)) acceleration = value;
    modelReady = false;
    renderSegments();
    renderDiagnostics("settings changed");
    persist();
    setStatus("Ready", "Load again after changing engine settings");
  });

  if (restoreVisibility) open({ invokeLifecycle: false });

  runtime?.logger.debug("TTS app mounted with Piper, tiny, and lab local engines.");

  return {
    open,
    close,
    minimize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopAudio();
      resetWorker("TTS app destroyed");
      if (resizeRafId) {
        if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(resizeRafId);
        else window.clearTimeout(resizeRafId);
        resizeRafId = 0;
      }
      cleanupLayer();
      panel.remove();
    },
    runtime,
  };
}

export const createShellWindowApp = createKokoroTtsApp;
