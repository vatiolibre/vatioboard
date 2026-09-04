import "./tts.less";

import { clampElementToViewport, makePanelDraggable } from "../../calculator/widget/drag.js";
import { IconClose, IconDownload, IconMinimize, IconPlay, IconTrash, IconVolume } from "../../icons.js";
import { registerFloatingPanel } from "../../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../../shared/shell-window-manager.js";
import type { ShellBounds, ShellLifecycleOptions, ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";
import type { TtsSnapshot, TtsStatusUpdate } from "../../types/services";
import {
  PIPER_VOICE_BY_ID,
  PIPER_VOICES_BY_LANG,
  TTS_LANGS,
  getDefaultPiperVoiceForLang,
  getLangForPiperVoice,
  isPiperVoiceId,
  type PiperVoiceId,
  type TtsLangId,
  isTtsLangId,
} from "./tts-resources.js";
import { ttsWindowCapabilities } from "./manifest.js";

export const TTS_APP_ID = "vatio.tts";
export const TTS_WINDOW_ID = "tts";
export const TTS_SETTINGS_KEY = "preferences";

const DRAG_THRESHOLD_PX = 8;
const RESIZE_MIN_WIDTH = 320;
const RESIZE_MIN_HEIGHT = 360;
const RESIZE_MARGIN_PX = 12;
const DEFAULT_BOUNDS = {
  left: 52,
  top: 108,
  width: 456,
  height: 510,
};
const DEFAULT_LANG: TtsLangId = "en-us";
const DEFAULT_PIPER_VOICE: PiperVoiceId = getDefaultPiperVoiceForLang(DEFAULT_LANG);
const DEFAULT_VOLUME = 1;
const DEFAULT_TEXT_BY_LANG: Record<TtsLangId, string> = {
  "en-us": "The cabin clock says 10:15 and the route ahead looks clear.",
  "en-gb": "The cabin clock says 10:15 and the route ahead looks clear.",
  "es-419": "Hola. El reloj del auto marca las 10:15 y la ruta está despejada.",
  "es-es": "Hola. El reloj del coche marca las 10:15 y la ruta está despejada.",
  "pt-br": "Olá. O relógio do carro marca 10:15 e a rota está livre.",
  it: "Ciao. L'orologio dell'auto segna le 10:15 e il percorso è libero.",
  fr: "Bonjour. L'horloge de la voiture indique 10 h 15 et la route est dégagée.",
  de: "Hallo. Die Uhr im Auto zeigt 10:15, und die Route ist frei.",
};

export interface TtsAppOptions {
  mount?: HTMLElement;
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
  restoreVisibility?: boolean;
}

export interface TtsAppApi {
  open(options?: ShellLifecycleOptions): void;
  close(options?: ShellLifecycleOptions): void;
  minimize(options?: ShellLifecycleOptions): void;
  destroy(): void;
  runtime: VatioAppRuntime | null;
}

interface TtsPreferences {
  text?: string;
  piperVoice?: PiperVoiceId;
  lang?: TtsLangId;
  volume?: number;
  resumeRequested?: boolean;
}

interface TtsView {
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
  loadButton: HTMLButtonElement;
  speakButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  volumeSlider: HTMLInputElement;
  volumeValue: HTMLElement;
  resizeHandle: HTMLButtonElement;
  voiceSegments: HTMLElement;
}

export function resolveTtsRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<TtsAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === TTS_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(TTS_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(TTS_APP_ID)
    || null;
}

function getBrowserLanguageCandidates(): string[] {
  if (typeof navigator === "undefined") return [];
  const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
  return [...languages, navigator.language].filter((language): language is string => Boolean(language));
}

function resolveBrowserLanguageTag(language: string): TtsLangId | null {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("es")) return "es-419";
  if (normalized.startsWith("en")) return "en-us";
  if (normalized.startsWith("pt")) return "pt-br";
  if (normalized.startsWith("it")) return "it";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("de")) return "de";
  return null;
}

function detectInitialLang(): TtsLangId {
  for (const language of getBrowserLanguageCandidates()) {
    const lang = resolveBrowserLanguageTag(language);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}

function getDefaultTextForLang(lang: TtsLangId): string {
  return DEFAULT_TEXT_BY_LANG[lang] || DEFAULT_TEXT_BY_LANG[DEFAULT_LANG];
}

function clampVolume(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, parsed));
}

function formatVolume(value: number): string {
  return `${Math.round(clampVolume(value) * 100)}%`;
}

function updateRangeVisualFill(input: HTMLInputElement) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const safeValue = Number.isFinite(value) ? value : safeMax;
  const span = safeMax - safeMin;
  const clampedValue = Math.min(safeMax, Math.max(safeMin, safeValue));
  const percent = span > 0 ? ((clampedValue - safeMin) / span) * 100 : 0;

  input.style.setProperty("--tts-range-percent", `${percent}%`);
}

function loadPreferences(runtime: VatioAppRuntime | null): Required<TtsPreferences> {
  const stored = runtime?.services.settings?.getJson<TtsPreferences | null>(TTS_SETTINGS_KEY, null) || null;
  const initialLang = stored ? DEFAULT_LANG : detectInitialLang();
  const storedLang = isTtsLangId(stored?.lang)
    ? stored.lang
    : isPiperVoiceId(stored?.piperVoice)
      ? getLangForPiperVoice(stored.piperVoice)
      : initialLang;
  const safeLang = PIPER_VOICES_BY_LANG[storedLang]?.length ? storedLang : initialLang;
  const storedPiperVoice = isPiperVoiceId(stored?.piperVoice) && PIPER_VOICE_BY_ID[stored.piperVoice].lang === safeLang
    ? stored.piperVoice
    : getDefaultPiperVoiceForLang(safeLang);
  const preferences = {
    text: typeof stored?.text === "string" && stored.text.trim() ? stored.text : getDefaultTextForLang(safeLang),
    piperVoice: storedPiperVoice || DEFAULT_PIPER_VOICE,
    lang: safeLang,
    volume: clampVolume(stored?.volume),
    resumeRequested: stored?.resumeRequested === true,
  };
  if (!stored) savePreferences(runtime, preferences);
  return preferences;
}

function savePreferences(runtime: VatioAppRuntime | null, preferences: Required<TtsPreferences>) {
  runtime?.services.settings?.setJson(TTS_SETTINGS_KEY, preferences);
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
  const storedBounds = shellManager.getWindow(TTS_WINDOW_ID)?.bounds;
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
    <div class="tts-segments" role="group" aria-label="${name}">
      ${values.map((value) => `
        <button
          type="button"
          class="tts-segment"
          data-tts-field="${name}"
          data-tts-value="${value.id}"
          ${value.title ? `title="${value.title}"` : ""}
          aria-pressed="${value.id === selected ? "true" : "false"}"
        ><span>${value.label}</span>${value.detail ? `<small>${value.detail}</small>` : ""}</button>
      `).join("")}
    </div>
  `;
}

function buildPanel(preferences: Required<TtsPreferences>): TtsView {
  const panel = document.createElement("section");
  panel.className = "tts-panel";
  panel.dataset.ttsEngine = "piper";
  panel.setAttribute("aria-label", "TTS");
  panel.innerHTML = `
    <header class="tts-header">
      <div class="tts-title">
        <span class="tts-mark" aria-hidden="true">${IconVolume}</span>
        <span>TTS</span>
      </div>
      <div class="tts-window-actions">
        <button type="button" class="tts-window-button" data-tts-minimize aria-label="Minimize">${IconMinimize}</button>
        <button type="button" class="tts-window-button" data-tts-close aria-label="Close">${IconClose}</button>
      </div>
    </header>

    <div class="tts-body">
      <label class="tts-field">
        <span>Text</span>
        <textarea data-tts-text rows="3" spellcheck="true"></textarea>
      </label>

      <div class="tts-grid">
        <div>
          <span class="tts-label">Language</span>
          ${buildSegmentGroup("lang", TTS_LANGS.map((lang) => ({
            id: lang.id,
            label: lang.label,
            title: lang.name,
          })), preferences.lang)}
        </div>
        <div>
          <span class="tts-label">Voice</span>
          <div class="tts-segments tts-segments--voices" data-tts-voice-segments role="group" aria-label="voice"></div>
        </div>
      </div>

      <div class="tts-actions">
        <button type="button" class="tts-action" data-tts-load>${IconDownload}<span>Load</span></button>
        <button type="button" class="tts-action tts-action--primary" data-tts-speak>${IconPlay}<span>Speak</span></button>
        <button type="button" class="tts-action" data-tts-stop>${IconTrash}<span>Stop</span></button>
      </div>

      <div class="tts-volume-row">
        <span class="tts-volume-icon" aria-hidden="true">${IconVolume}</span>
        <input
          type="range"
          class="tts-volume"
          data-tts-volume
          min="0"
          max="100"
          step="1"
          value="${Math.round(preferences.volume * 100)}"
          aria-label="TTS volume"
        />
        <output class="tts-volume-value" data-tts-volume-value>${formatVolume(preferences.volume)}</output>
      </div>

      <div class="tts-status" aria-live="polite">
        <div>
          <strong data-tts-status>Ready</strong>
          <span data-tts-progress>Chunk cache idle</span>
        </div>
        <div class="tts-progress" aria-hidden="true">
          <span data-tts-progress-bar></span>
        </div>
      </div>

      <dl class="tts-diagnostics" data-tts-diagnostics>
        <div><dt>Engine</dt><dd>Piper ONNX</dd></div>
        <div><dt>Cache</dt><dd>5 MB chunks</dd></div>
        <div><dt>Voices</dt><dd>On demand</dd></div>
      </dl>
    </div>
    <button type="button" class="tts-resize" data-tts-resize aria-label="Resize TTS" title="Resize TTS"></button>
  `;

  const textInput = panel.querySelector("[data-tts-text]") as HTMLTextAreaElement;
  textInput.value = preferences.text;
  const volumeSlider = panel.querySelector("[data-tts-volume]") as HTMLInputElement;
  updateRangeVisualFill(volumeSlider);

  return {
    panel,
    header: panel.querySelector(".tts-header") as HTMLElement,
    body: panel.querySelector(".tts-body") as HTMLElement,
    minimizeButton: panel.querySelector("[data-tts-minimize]") as HTMLButtonElement,
    closeButton: panel.querySelector("[data-tts-close]") as HTMLButtonElement,
    textInput,
    status: panel.querySelector("[data-tts-status]") as HTMLElement,
    progress: panel.querySelector("[data-tts-progress]") as HTMLElement,
    progressBar: panel.querySelector("[data-tts-progress-bar]") as HTMLElement,
    diagnostics: panel.querySelector("[data-tts-diagnostics]") as HTMLElement,
    loadButton: panel.querySelector("[data-tts-load]") as HTMLButtonElement,
    speakButton: panel.querySelector("[data-tts-speak]") as HTMLButtonElement,
    stopButton: panel.querySelector("[data-tts-stop]") as HTMLButtonElement,
    volumeSlider,
    volumeValue: panel.querySelector("[data-tts-volume-value]") as HTMLElement,
    resizeHandle: panel.querySelector("[data-tts-resize]") as HTMLButtonElement,
    voiceSegments: panel.querySelector("[data-tts-voice-segments]") as HTMLElement,
  };
}

export function createTtsApp(options: TtsAppOptions = {}): TtsAppApi {
  const {
    mount = document.body,
    shellManager = getDefaultShellWindowManager(),
    restoreVisibility = false,
  } = options;
  const runtime = resolveTtsRuntime(options);
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
    loadButton,
    speakButton,
    stopButton,
    volumeSlider,
    volumeValue,
    resizeHandle,
    voiceSegments,
  } = view;

  let lang: TtsLangId = preferences.lang;
  let piperVoice: PiperVoiceId = preferences.piperVoice;
  let volume = preferences.volume;
  let resumeRequested = preferences.resumeRequested;
  const ttsService = runtime?.services.tts || null;
  let modelReady = ttsService?.getSnapshot().loadedVoice === piperVoice;
  let loadingPromise: Promise<void> | null = null;
  let generating = false;
  let destroyed = false;
  let unsubscribeTts: (() => void) | null = null;
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
      piperVoice,
      lang,
      volume,
      resumeRequested,
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

  function handleTtsStatus(update: TtsStatusUpdate) {
    setStatus(update.status, update.progress || "");
    setProgressRatio(update.ratio ?? null);
  }

  function syncTtsSnapshot(snapshot: TtsSnapshot) {
    modelReady = snapshot.loadedVoice === piperVoice;
    if (snapshot.status === "error" && snapshot.error) {
      renderDiagnostics(snapshot.error);
    }
  }

  function normalizeSelectionForEngine() {
    if (!PIPER_VOICES_BY_LANG[lang]?.length) {
      lang = DEFAULT_LANG;
    }
    if (!PIPER_VOICES_BY_LANG[lang]?.some((item) => item.id === piperVoice)) {
      piperVoice = getDefaultPiperVoiceForLang(lang);
    }
  }

  function renderVoiceSegments() {
    normalizeSelectionForEngine();
    const voices = PIPER_VOICES_BY_LANG[lang] || [];
    voiceSegments.replaceChildren(...voices.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tts-segment";
      button.dataset.ttsField = "voice";
      button.dataset.ttsValue = item.id;
      button.setAttribute("aria-pressed", item.id === piperVoice ? "true" : "false");
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
    renderVoiceSegments();
    for (const button of Array.from(panel.querySelectorAll("[data-tts-field]")) as HTMLButtonElement[]) {
      const field = button.getAttribute("data-tts-field");
      const value = button.getAttribute("data-tts-value");
      const languageAvailable = field !== "lang"
        || (isTtsLangId(value) && Boolean(PIPER_VOICES_BY_LANG[value]?.length));
      const active = (field === "voice" && value === piperVoice)
        || (field === "lang" && value === lang);
      button.disabled = !languageAvailable;
      button.toggleAttribute("aria-disabled", !languageAvailable);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function renderDiagnostics(extra = "") {
    const items = [
      ["Engine", "Piper ONNX"],
      ["Cache", "5 MB chunks"],
      ["Voice", `${PIPER_VOICE_BY_ID[piperVoice]?.name || piperVoice} / ${lang.toUpperCase()}`],
      ["Runtime", "WASM worker"],
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

  function getVoiceSettings() {
    return {
      lang,
      voice: piperVoice,
      speed: 1,
    };
  }

  function renderVolume() {
    const volumePercent = Math.round(volume * 100);
    volumeSlider.value = String(volumePercent);
    volumeValue.textContent = formatVolume(volume);
    updateRangeVisualFill(volumeSlider);
    ttsService?.setVolume(volume);
  }

  async function loadEngine(): Promise<void> {
    if (!ttsService) {
      setStatus("Unavailable", "The OS TTS service is not available");
      renderDiagnostics("service unavailable");
      return;
    }
    if (modelReady) return;
    if (loadingPromise) return loadingPromise;

    const requestedSettings = getVoiceSettings();
    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
    setStatus("Loading Piper", "Preparing chunk cache first");
    loadingPromise = (async () => {
      const message = await ttsService.loadVoice({
        ...requestedSettings,
        onStatus: handleTtsStatus,
      });
      if (
        requestedSettings.voice !== piperVoice
        || requestedSettings.lang !== lang
      ) {
        modelReady = false;
        setStatus("Ready", "Load again after changing voice settings");
        renderDiagnostics("settings changed");
        return;
      }
      modelReady = true;
      const provider = message.provider.toUpperCase();
      setStatus(
        "Piper ready",
        `${PIPER_VOICE_BY_ID[piperVoice]?.name || piperVoice} on ${provider}`,
      );
      setProgressRatio(1);
      renderDiagnostics("voice ready");
    })().finally(() => {
      loadingPromise = null;
      setButtonBusy(loadButton, false);
      setButtonBusy(speakButton, false);
    });
    return loadingPromise;
  }

  function stopAudio() {
    ttsService?.stop({ reason: "TTS test stopped" });
  }

  async function speak() {
    if (!ttsService) {
      setStatus("Unavailable", "The OS TTS service is not available");
      renderDiagnostics("service unavailable");
      return;
    }
    const text = textInput.value.trim();
    if (!text) {
      setStatus("Text needed", "Add a short sentence first");
      return;
    }
    resumeRequested = true;
    persist();
    const requestedSettings = getVoiceSettings();
    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
    generating = true;
    setStatus("Generating", "Piper voice is synthesizing in a worker");
    setProgressRatio(null);
    try {
      const message = await ttsService.speak({
        text,
        volume,
        priority: "system",
        interrupt: true,
        onStatus: handleTtsStatus,
        ...requestedSettings,
      });
      modelReady = requestedSettings.lang === lang
        && requestedSettings.voice === piperVoice;
      const seconds = Math.max(0.1, message.durationMs / 1000);
      setStatus("Speech complete", `${formatBytes(message.size)} WAV in ${seconds.toFixed(1)}s; audio ${message.audioSeconds.toFixed(1)}s`);
      resumeRequested = false;
      persist();
      renderDiagnostics("speech generated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speech generation failed";
      if (message !== "Generation stopped" && message !== "TTS test stopped") {
        setStatus("Generation failed", message);
        renderDiagnostics(message);
      }
    } finally {
      generating = false;
      setButtonBusy(loadButton, false);
      setButtonBusy(speakButton, false);
    }
  }

  function updateShellBounds(bounds: ShellBounds, shellOptions: ShellLifecycleOptions = {}) {
    shellManager.updateWindowBounds(TTS_WINDOW_ID, bounds, shellOptions);
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
    shellManager.openWindow(TTS_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    hidePanel();
    shellManager.closeWindow(TTS_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function minimize(options: ShellLifecycleOptions = {}) {
    hidePanel();
    shellManager.minimizeWindow(TTS_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  applyInitialBounds(panel, shellManager);
  mount.append(panel);
  renderSegments();
  renderVolume();
  renderDiagnostics();
  if (!ttsService) {
    setStatus("Unavailable", "The OS TTS service is not available");
    setButtonBusy(loadButton, true);
    setButtonBusy(speakButton, true);
  } else {
    unsubscribeTts = ttsService.subscribe(syncTtsSnapshot);
    if (resumeRequested) setStatus("Speech interrupted", "Tap Speak to resume");
  }
  panel.hidden = !restoreVisibility;

  const cleanupLayer = registerFloatingPanel(panel, {
    id: TTS_WINDOW_ID,
    kind: "tool",
    title: "TTS",
    shellManager,
    capabilities: ttsWindowCapabilities,
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
    shellWindowId: TTS_WINDOW_ID,
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
    if (shellManager.getWindow(TTS_WINDOW_ID)?.snap) {
      shellManager.unsnapWindow(TTS_WINDOW_ID, { preserveSnap: false });
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
  loadButton.addEventListener("click", () => {
    loadEngine().catch((error) => runtime?.logger.warn("TTS engine load failed.", error));
  });
  speakButton.addEventListener("click", () => {
    speak().catch((error) => runtime?.logger.warn("TTS speech failed.", error));
  });
  volumeSlider.addEventListener("input", () => {
    volume = clampVolume(Number(volumeSlider.value) / 100);
    renderVolume();
    persist();
  });
  stopButton.addEventListener("click", () => {
    resumeRequested = false;
    persist();
    if (generating || loadingPromise) {
      ttsService?.cancel({ reason: "Generation stopped" });
      modelReady = false;
      generating = false;
      loadingPromise = null;
      setButtonBusy(loadButton, false);
      setButtonBusy(speakButton, false);
      setStatus("Stopped", "Voice service reset");
      renderDiagnostics("service reset");
    } else {
      stopAudio();
      setStatus("Stopped", "Audio output cleared");
    }
  });
  textInput.addEventListener("change", persist);
  textInput.addEventListener("blur", persist);

  panel.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tts-field]") : null;
    if (!(target instanceof HTMLButtonElement)) return;
    const field = target.getAttribute("data-tts-field");
    const value = target.getAttribute("data-tts-value");
    if (field === "voice" && isPiperVoiceId(value)) {
      piperVoice = value;
      lang = PIPER_VOICE_BY_ID[value].lang;
    }
    if (field === "lang" && isTtsLangId(value)) {
      lang = value;
      piperVoice = getDefaultPiperVoiceForLang(lang);
    }
    modelReady = false;
    renderSegments();
    renderDiagnostics("settings changed");
    persist();
    setStatus("Ready", "Load again after changing voice settings");
  });

  if (restoreVisibility) open({ invokeLifecycle: false });

  runtime?.logger.debug("TTS app mounted with Piper local engine.");

  return {
    open,
    close,
    minimize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopAudio();
      unsubscribeTts?.();
      unsubscribeTts = null;
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

export const createShellWindowApp = createTtsApp;
