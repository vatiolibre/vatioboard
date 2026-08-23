import "./code-rain.less";

import {
  IconClose,
  IconFullscreen,
  IconFullscreenExit,
  IconPause,
  IconPlay,
  IconRepeat,
  IconRestart,
  IconSettings,
  IconShuffle,
  IconSkipBack,
  IconSkipForward,
} from "../../icons.js";
import { replaceAppRouteQuery } from "../../app/router.js";
import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const CODE_RAIN_APP_ID = "vatio.codeRain";
export const CODE_RAIN_VENDOR_BASE = "/vendor/rezmason-matrix/";

const STATE_STORAGE_KEY = "state.v1";
const STATUS_OVERLAY_VISIBLE_MS = 2600;
const SWIPE_DISTANCE_PX = 56;
const SWIPE_AXIS_RATIO = 1.35;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 28;
const BROWSER_FULLSCREEN_BODY_CLASS = "code-rain-browser-fullscreen-active";
const BROWSER_FULLSCREEN_APP_CLASS = "code-rain-app--browser-fullscreen";

const VERSION_OPTIONS = [
  { value: "3d", label: "Classic 3D" },
  { value: "classic", label: "Classic" },
  { value: "operator", label: "Operator" },
  { value: "resurrections", label: "Revival" },
  { value: "trinity", label: "Trinity" },
  { value: "megacity", label: "Megacity" },
  { value: "nightmare", label: "Night" },
  { value: "paradise", label: "Soft" },
] as const;

const EFFECT_OPTIONS = [
  { value: "palette", label: "Palette" },
  { value: "mirror", label: "Ripple" },
  { value: "plain", label: "Plain" },
  { value: "pride", label: "Pride" },
  { value: "trans", label: "Trans" },
  { value: "none", label: "Debug" },
] as const;

const FONT_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "matrixcode", label: "Classic" },
  { value: "resurrections", label: "Revival" },
  { value: "megacity", label: "Megacity" },
  { value: "coptic", label: "Coptic" },
  { value: "gothic", label: "Gothic" },
  { value: "huberfishA", label: "Huberfish A" },
] as const;

const PRESETS = [
  {
    id: "classic-3d",
    label: "Classic 3D",
    state: {
      version: "3d",
      effect: "palette",
      font: "",
      numColumns: "80",
      fallSpeed: "0.50",
      bloomStrength: "0.72",
      bloomSize: "0.42",
      resolution: "0.72",
      volumetric: "true",
    },
  },
  {
    id: "glass",
    label: "Glass",
    state: {
      version: "operator",
      effect: "mirror",
      font: "",
      numColumns: "108",
      fallSpeed: "0.55",
      bloomStrength: "0.82",
      bloomSize: "0.58",
      resolution: "0.70",
      volumetric: "false",
    },
  },
  {
    id: "tunnel",
    label: "Tunnel",
    state: {
      version: "trinity",
      effect: "palette",
      font: "",
      numColumns: "60",
      fallSpeed: "0.30",
      bloomStrength: "0.75",
      bloomSize: "0.48",
      resolution: "0.70",
      volumetric: "true",
    },
  },
  {
    id: "storm",
    label: "Storm",
    state: {
      version: "nightmare",
      effect: "palette",
      font: "",
      numColumns: "64",
      fallSpeed: "1.05",
      bloomStrength: "0.90",
      bloomSize: "0.68",
      resolution: "0.58",
      volumetric: "false",
    },
  },
  {
    id: "soft",
    label: "Soft",
    state: {
      version: "paradise",
      effect: "palette",
      font: "",
      numColumns: "42",
      fallSpeed: "0.06",
      bloomStrength: "0.95",
      bloomSize: "0.55",
      resolution: "0.80",
      volumetric: "false",
    },
  },
] as const;

type CodeRainState = {
  version: string;
  effect: string;
  font: string;
  numColumns: string;
  fallSpeed: string;
  bloomStrength: string;
  bloomSize: string;
  resolution: string;
  volumetric: string;
};

type CodeRainPointer = {
  id: number;
  x: number;
  y: number;
  time: number;
};

export type CodeRainRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  logger?: VatioAppRuntime["logger"] | null;
};

const DEFAULT_STATE: CodeRainState = {
  ...PRESETS[0].state,
};

const NUMERIC_LIMITS = {
  numColumns: { min: 24, max: 140, precision: 0 },
  fallSpeed: { min: 0, max: 1.5, precision: 2 },
  bloomStrength: { min: 0, max: 1, precision: 2 },
  bloomSize: { min: 0, max: 1, precision: 2 },
  resolution: { min: 0.35, max: 1, precision: 2 },
} as const;

function renderChoiceGroup(
  legend: string,
  key: keyof CodeRainState,
  options: readonly { value: string; label: string }[],
) {
  return `
    <fieldset class="code-rain-choice-group" data-code-rain-group="${key}">
      <legend>${legend}</legend>
      <div class="code-rain-choice-grid">
        ${options.map((option) => `
          <button type="button" data-code-rain-choice="${key}" data-code-rain-value="${option.value}">
            ${option.label}
          </button>
        `).join("")}
      </div>
    </fieldset>
  `;
}

const template = `
  <section class="code-rain-app" data-code-rain-app>
    <div class="code-rain-stage" data-code-rain-stage>
      <iframe
        class="code-rain-frame"
        data-code-rain-frame
        title="Code Rain renderer"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen"
        allowfullscreen
        referrerpolicy="no-referrer"
      ></iframe>
      <div class="code-rain-scanline" aria-hidden="true"></div>
      <div class="code-rain-status-overlay" data-code-rain-status aria-live="polite">Classic 3D</div>
      <div class="code-rain-gesture-layer" data-code-rain-gesture-layer aria-hidden="true"></div>
      <div class="code-rain-dismiss-layer" data-code-rain-dismiss-layer aria-hidden="true"></div>
      <div class="code-rain-toolbar" data-code-rain-toolbar>
        <div class="code-rain-toolbar__buttons">
          <button type="button" class="code-rain-icon-button" data-code-rain-action="previous-preset" title="Previous preset" aria-label="Previous preset">
            ${IconSkipBack}
          </button>
          <button type="button" class="code-rain-icon-button" data-code-rain-action="pause" title="Pause" aria-label="Pause">
            <span data-code-rain-pause-icon>${IconPause}</span>
          </button>
          <button type="button" class="code-rain-icon-button" data-code-rain-action="randomize" title="Randomize" aria-label="Randomize">
            ${IconShuffle}
          </button>
          <button type="button" class="code-rain-icon-button" data-code-rain-action="next-preset" title="Next preset" aria-label="Next preset">
            ${IconSkipForward}
          </button>
          <button type="button" class="code-rain-icon-button" data-code-rain-action="fullscreen" title="Fullscreen" aria-label="Fullscreen">
            <span data-code-rain-fullscreen-icon>${IconFullscreen}</span>
          </button>
          <button type="button" class="code-rain-icon-button code-rain-icon-button--primary" data-code-rain-action="settings" title="Settings" aria-label="Settings">
            ${IconSettings}
          </button>
        </div>
      </div>
      <aside class="code-rain-panel" data-code-rain-panel aria-label="Code Rain settings" aria-hidden="true">
        <div class="code-rain-panel__header">
          <div>
            <h2>Code Rain</h2>
            <p data-code-rain-panel-summary>Classic 3D</p>
          </div>
          <button type="button" class="code-rain-icon-button" data-code-rain-action="close-settings" title="Close" aria-label="Close settings">
            ${IconClose}
          </button>
        </div>
        <div class="code-rain-panel__body">
          <div class="code-rain-settings-section">
            <h3>Presets</h3>
            <fieldset class="code-rain-choice-group">
              <legend>Preset</legend>
              <div class="code-rain-choice-grid code-rain-choice-grid--presets" data-code-rain-presets>
                ${PRESETS.map((preset) => `
                  <button type="button" data-code-rain-preset="${preset.id}">${preset.label}</button>
                `).join("")}
              </div>
            </fieldset>
          </div>
          <div class="code-rain-settings-section">
            <h3>Look</h3>
            ${renderChoiceGroup("Version", "version", VERSION_OPTIONS)}
            ${renderChoiceGroup("Effect", "effect", EFFECT_OPTIONS)}
            ${renderChoiceGroup("Glyphs", "font", FONT_OPTIONS)}
          </div>
          <div class="code-rain-settings-section">
            <h3>Motion</h3>
            <div class="code-rain-sliders">
              <label>
                <span>Speed <output data-code-rain-output="fallSpeed"></output></span>
                <input type="range" min="0" max="1.5" step="0.05" data-code-rain-field="fallSpeed" />
              </label>
              <label>
                <span>Density <output data-code-rain-output="numColumns"></output></span>
                <input type="range" min="24" max="140" step="1" data-code-rain-field="numColumns" />
              </label>
            </div>
          </div>
          <div class="code-rain-settings-section">
            <h3>Render</h3>
            <div class="code-rain-sliders">
              <label>
                <span>Glow <output data-code-rain-output="bloomStrength"></output></span>
                <input type="range" min="0" max="1" step="0.05" data-code-rain-field="bloomStrength" />
              </label>
              <label>
                <span>Sharpness <output data-code-rain-output="resolution"></output></span>
                <input type="range" min="0.35" max="1" step="0.05" data-code-rain-field="resolution" />
              </label>
              <div class="code-rain-toggle-row">
                <span>Depth</span>
                <label class="code-rain-toggle">
                  <input type="checkbox" data-code-rain-field="volumetric" />
                  <span>3D</span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div class="code-rain-panel__footer">
          <button type="button" class="code-rain-text-button" data-code-rain-action="reset">Reset</button>
          <button type="button" class="code-rain-text-button" data-code-rain-action="reload">
            <span class="code-rain-text-button__icon">${IconRestart}</span>
            Reload
          </button>
          <button type="button" class="code-rain-text-button" data-code-rain-action="share">
            <span class="code-rain-text-button__icon">${IconRepeat}</span>
            Link
          </button>
        </div>
      </aside>
      <a class="code-rain-credit" href="https://github.com/Rezmason/matrix" target="_blank" rel="noopener noreferrer">
        Rezmason/matrix MIT
      </a>
    </div>
  </section>
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asOption(value: unknown, options: readonly { value: string }[], fallback: string) {
  const candidate = String(value ?? "");
  return options.some((option) => option.value === candidate) ? candidate : fallback;
}

function clampNumber(value: unknown, key: keyof typeof NUMERIC_LIMITS) {
  const limits = NUMERIC_LIMITS[key];
  const parsed = Number.parseFloat(String(value ?? ""));
  const safe = Number.isFinite(parsed) ? parsed : Number(DEFAULT_STATE[key]);
  const clamped = Math.min(limits.max, Math.max(limits.min, safe));
  return limits.precision === 0 ? String(Math.round(clamped)) : clamped.toFixed(limits.precision);
}

function normalizeBooleanString(value: unknown, fallback = "false") {
  if (value === true || value === "true" || value === "1") return "true";
  if (value === false || value === "false" || value === "0") return "false";
  return fallback;
}

function sanitizeState(input: unknown): CodeRainState {
  const source = isRecord(input) ? input : {};

  return {
    version: asOption(source.version, VERSION_OPTIONS, DEFAULT_STATE.version),
    effect: asOption(source.effect, EFFECT_OPTIONS, DEFAULT_STATE.effect),
    font: asOption(source.font, FONT_OPTIONS, DEFAULT_STATE.font),
    numColumns: clampNumber(source.numColumns, "numColumns"),
    fallSpeed: clampNumber(source.fallSpeed, "fallSpeed"),
    bloomStrength: clampNumber(source.bloomStrength, "bloomStrength"),
    bloomSize: clampNumber(source.bloomSize, "bloomSize"),
    resolution: clampNumber(source.resolution, "resolution"),
    volumetric: normalizeBooleanString(source.volumetric, DEFAULT_STATE.volumetric),
  };
}

function stateFromQuery(query: URLSearchParams | null | undefined): Partial<CodeRainState> {
  if (!query) return {};
  const state: Partial<CodeRainState> = {};
  for (const key of Object.keys(DEFAULT_STATE) as Array<keyof CodeRainState>) {
    const value = query.get(key);
    if (value !== null) state[key] = value;
  }
  return state;
}

function stateToParams(state: CodeRainState) {
  const params = new URLSearchParams();
  params.set("version", state.version);
  params.set("effect", state.effect);
  if (state.font) params.set("font", state.font);
  params.set("numColumns", state.numColumns);
  params.set("fallSpeed", state.fallSpeed);
  params.set("bloomStrength", state.bloomStrength);
  params.set("bloomSize", state.bloomSize);
  params.set("resolution", state.resolution);
  params.set("volumetric", state.volumetric);
  params.set("skipIntro", "true");
  params.set("suppressWarnings", "true");
  return params;
}

function getRouteQuery(routeContext: RouteMountContext) {
  const routeQuery = routeContext.context.route?.query;
  if (routeQuery) return routeQuery;
  const hash = window.location.hash || "";
  const queryIndex = hash.indexOf("?");
  return new URLSearchParams(queryIndex === -1 ? "" : hash.slice(queryIndex + 1));
}

function resolveCodeRainRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === CODE_RAIN_APP_ID ? runtime : null;
}

export function createCodeRainRouteMountContext(routeContext: RouteMountContext): CodeRainRouteMountContext {
  const runtime = resolveCodeRainRuntime(routeContext);
  const context = routeContext.context || {};

  return {
    ...routeContext,
    appRuntime: runtime,
    appManifest: runtime?.manifest || context.appManifest || null,
    appStorage: runtime?.storage || null,
    logger: runtime?.logger || null,
  };
}

function optionLabel(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label || value;
}

function stateSummary(state: CodeRainState) {
  const version = optionLabel(VERSION_OPTIONS, state.version);
  const effect = optionLabel(EFFECT_OPTIONS, state.effect);
  return state.volumetric === "true" && !version.includes("3D") ? `${version} 3D` : `${version} · ${effect}`;
}

function findPresetIndex(state: CodeRainState) {
  return PRESETS.findIndex((preset) => Object.entries(preset.state).every(([key, value]) =>
    state[key as keyof CodeRainState] === value
  ));
}

function presetStateAtOffset(state: CodeRainState, direction: 1 | -1) {
  const currentIndex = findPresetIndex(state);
  const baseIndex = currentIndex === -1
    ? direction > 0 ? -1 : 0
    : currentIndex;
  const nextIndex = ((baseIndex + direction) % PRESETS.length + PRESETS.length) % PRESETS.length;
  return sanitizeState({
    ...state,
    ...PRESETS[nextIndex].state,
  });
}

function setStatus(status: Element | null, message: string) {
  if (status) status.textContent = message;
}

function setSettingsOpen(root: HTMLElement, open: boolean) {
  root.classList.toggle("code-rain-app--settings-open", open);
  const panel = root.querySelector("[data-code-rain-panel]");
  panel?.setAttribute("aria-hidden", open ? "false" : "true");
}

function isSettingsOpen(root: HTMLElement) {
  return root.classList.contains("code-rain-app--settings-open");
}

function getFullscreenElement() {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

function isStageFullscreen(stage: HTMLElement) {
  return getFullscreenElement() === stage;
}

function syncFullscreenState(root: HTMLElement, stage: HTMLElement, fallbackFullscreen = false) {
  const fullscreen = isStageFullscreen(stage) || fallbackFullscreen;
  root.classList.toggle("code-rain-app--fullscreen", fullscreen);
  if (fullscreen) setSettingsOpen(root, false);

  const button = root.querySelector('[data-code-rain-action="fullscreen"]');
  const icon = root.querySelector("[data-code-rain-fullscreen-icon]");
  const label = fullscreen ? "Exit fullscreen" : "Fullscreen";

  button?.setAttribute("aria-label", label);
  button?.setAttribute("title", label);
  if (icon) icon.innerHTML = fullscreen ? IconFullscreenExit : IconFullscreen;
}

function updateUrlState(state: CodeRainState) {
  const query: Record<string, string | null> = {
    camera: null,
    reload: null,
    url: null,
  };
  for (const [key, value] of stateToParams(state).entries()) {
    query[key] = value;
  }
  replaceAppRouteQuery(query);
}

function setButtonActive(root: HTMLElement, selector: string, activeValue: string) {
  for (const button of root.querySelectorAll(selector)) {
    button.setAttribute("aria-pressed", button.getAttribute("data-code-rain-value") === activeValue ? "true" : "false");
  }
}

function setControlValues(root: HTMLElement, state: CodeRainState, paused: boolean) {
  for (const field of root.querySelectorAll("[data-code-rain-field]")) {
    const key = field.getAttribute("data-code-rain-field") as keyof CodeRainState | null;
    if (!key) continue;
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      field.checked = state[key] === "true";
    } else if (field instanceof HTMLInputElement) {
      field.value = state[key];
    }
  }

  for (const [key, value] of Object.entries(state)) {
    const output = root.querySelector(`[data-code-rain-output="${key}"]`);
    if (!output) continue;
    output.textContent = key === "numColumns" ? value : Number(value).toFixed(2);
  }

  setButtonActive(root, '[data-code-rain-choice="version"]', state.version);
  setButtonActive(root, '[data-code-rain-choice="effect"]', state.effect);
  setButtonActive(root, '[data-code-rain-choice="font"]', state.font);

  for (const button of root.querySelectorAll("[data-code-rain-preset]")) {
    const presetId = button.getAttribute("data-code-rain-preset");
    const preset = PRESETS.find((entry) => entry.id === presetId);
    const active = Boolean(preset && Object.entries(preset.state).every(([key, value]) =>
      state[key as keyof CodeRainState] === value
    ));
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }

  const pauseButton = root.querySelector('[data-code-rain-action="pause"]');
  const pauseIcon = root.querySelector("[data-code-rain-pause-icon]");
  const summary = stateSummary(state);
  const status = root.querySelector("[data-code-rain-status]");
  const panelSummary = root.querySelector("[data-code-rain-panel-summary]");
  const volumetricToggle = root.querySelector(".code-rain-toggle");

  volumetricToggle?.classList.toggle("code-rain-toggle--active", state.volumetric === "true");
  if (pauseButton) {
    pauseButton.setAttribute("aria-label", paused ? "Resume" : "Pause");
    pauseButton.setAttribute("title", paused ? "Resume" : "Pause");
  }
  if (pauseIcon) pauseIcon.innerHTML = paused ? IconPlay : IconPause;
  if (!paused) setStatus(status, summary);
  if (panelSummary) panelSummary.textContent = summary;
}

function loadFrame(frame: HTMLIFrameElement, state: CodeRainState, nonce = "") {
  const params = stateToParams(state);
  if (nonce) params.set("reload", nonce);
  frame.src = `${CODE_RAIN_VENDOR_BASE}index.html?${params.toString()}`;
}

function saveState(runtime: VatioAppRuntime | null, state: CodeRainState) {
  runtime?.storage.setJson(STATE_STORAGE_KEY, state);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(min: number, max: number, precision = 2) {
  return (min + Math.random() * (max - min)).toFixed(precision);
}

function createRandomState(): CodeRainState {
  const preset = pick(PRESETS);
  const effect = pick(EFFECT_OPTIONS.filter((option) => option.value !== "none")).value;
  return sanitizeState({
    ...preset.state,
    version: pick(VERSION_OPTIONS).value,
    effect,
    font: Math.random() > 0.72 ? pick(FONT_OPTIONS).value : "",
    numColumns: String(Math.round(36 + Math.random() * 94)),
    fallSpeed: randomBetween(0.05, 1.25),
    bloomStrength: randomBetween(0.35, 1),
    bloomSize: randomBetween(0.18, 0.75),
    resolution: randomBetween(0.45, 0.9),
    volumetric: Math.random() > 0.55 ? "true" : "false",
  });
}

async function requestNativeFullscreen(stage: HTMLElement) {
  const element = stage as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  const requestFullscreen = stage.requestFullscreen || element.webkitRequestFullscreen;
  if (typeof requestFullscreen !== "function") return false;

  await requestFullscreen.call(stage);
  return isStageFullscreen(stage);
}

async function exitNativeFullscreen() {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  const exitFullscreen = document.exitFullscreen || doc.webkitExitFullscreen;
  if (typeof exitFullscreen === "function") await exitFullscreen.call(document);
}

function mountCodeRain(routeContext: RouteMountContext): MountedView {
  const codeRainContext = createCodeRainRouteMountContext(routeContext);
  const runtime = codeRainContext.appRuntime || null;
  const root = routeContext.root.querySelector("[data-code-rain-app]") as HTMLElement | null;
  const stage = routeContext.root.querySelector("[data-code-rain-stage]") as HTMLElement | null;
  const frame = routeContext.root.querySelector("[data-code-rain-frame]") as HTMLIFrameElement | null;
  const gestureLayer = routeContext.root.querySelector("[data-code-rain-gesture-layer]") as HTMLElement | null;
  const status = routeContext.root.querySelector("[data-code-rain-status]");

  if (!root || !stage || !frame || !gestureLayer) {
    runtime?.logger.warn("Code Rain route could not find its frame root.");
    return { unmount() {} };
  }

  const stored = runtime?.storage.getJson<Partial<CodeRainState>>(STATE_STORAGE_KEY, {}) || {};
  let state = sanitizeState({
    ...DEFAULT_STATE,
    ...stored,
    ...stateFromQuery(getRouteQuery(routeContext)),
  });
  let paused = false;
  let statusRevealTimer = 0;
  let gesturePointer: CodeRainPointer | null = null;
  let lastGestureTap: Omit<CodeRainPointer, "id"> | null = null;
  let isFallbackFullscreen = false;

  function setFallbackFullscreenClasses(active: boolean) {
    root.classList.toggle(BROWSER_FULLSCREEN_APP_CLASS, active);
    document.body.classList.toggle(BROWSER_FULLSCREEN_BODY_CLASS, active);
  }

  function isFullscreenActive() {
    return isStageFullscreen(stage) || isFallbackFullscreen;
  }

  function syncFullscreenUi() {
    if (isStageFullscreen(stage) && isFallbackFullscreen) {
      isFallbackFullscreen = false;
      setFallbackFullscreenClasses(false);
    }
    syncFullscreenState(root, stage, isFallbackFullscreen);
  }

  function revealStatus() {
    root.classList.add("code-rain-app--status-visible");
    window.clearTimeout(statusRevealTimer);
    if (isFullscreenActive()) {
      statusRevealTimer = window.setTimeout(() => {
        root.classList.remove("code-rain-app--status-visible");
      }, STATUS_OVERLAY_VISIBLE_MS);
    }
  }

  function clearStatusReveal() {
    window.clearTimeout(statusRevealTimer);
    statusRevealTimer = 0;
    root.classList.remove("code-rain-app--status-visible");
  }

  function showStatus(message: string) {
    setStatus(status, message);
    revealStatus();
  }

  function applyState({ persist = true, updateRoute = true, reload = true } = {}) {
    state = sanitizeState(state);
    setControlValues(routeContext.root, state, paused);
    revealStatus();
    if (persist) saveState(runtime, state);
    if (updateRoute) updateUrlState(state);
    if (reload && !paused) loadFrame(frame, state);
  }

  function resumeFrame() {
    paused = false;
    loadFrame(frame, state);
    setControlValues(routeContext.root, state, paused);
    showStatus(stateSummary(state));
  }

  function applyPresetOffset(direction: 1 | -1) {
    state = presetStateAtOffset(state, direction);
    if (paused) resumeFrame();
    applyState();
  }

  function randomizeVisual() {
    state = createRandomState();
    if (paused) resumeFrame();
    applyState();
  }

  function reloadVisual() {
    paused = false;
    loadFrame(frame, state, String(Date.now()));
    setControlValues(routeContext.root, state, paused);
    showStatus("Reloaded");
  }

  function enterFallbackFullscreen() {
    isFallbackFullscreen = true;
    setFallbackFullscreenClasses(true);
    syncFullscreenUi();
    revealStatus();
  }

  function exitFallbackFullscreen({ clearStatus = true } = {}) {
    if (!isFallbackFullscreen) return;
    isFallbackFullscreen = false;
    setFallbackFullscreenClasses(false);
    syncFullscreenUi();
    if (clearStatus) clearStatusReveal();
  }

  async function enterFullscreen() {
    if (isFullscreenActive()) return;

    try {
      if (await requestNativeFullscreen(stage)) {
        syncFullscreenUi();
        revealStatus();
        return;
      }
    } catch {
      // Fall back to a fixed browser-viewport fullscreen experience below.
    }

    enterFallbackFullscreen();
  }

  async function exitFullscreenMode() {
    if (isFallbackFullscreen) {
      exitFallbackFullscreen();
      return;
    }
    if (isStageFullscreen(stage)) {
      await exitNativeFullscreen();
    }
    syncFullscreenUi();
    if (!isFullscreenActive()) clearStatusReveal();
  }

  async function toggleFullscreenMode() {
    if (isFullscreenActive() || getFullscreenElement() === stage) {
      await exitFullscreenMode();
      return;
    }
    await enterFullscreen();
  }

  applyState({ updateRoute: true, reload: true });
  syncFullscreenUi();
  runtime?.logger.debug("Code Rain route app mounted with an isolated renderer iframe.");

  for (const field of routeContext.root.querySelectorAll("[data-code-rain-field]")) {
    routeContext.cleanup.addEventListener(field, "input", () => {
      const key = field.getAttribute("data-code-rain-field") as keyof CodeRainState | null;
      if (!key) return;
      if (field instanceof HTMLInputElement && field.type === "checkbox") {
        state[key] = field.checked ? "true" : "false";
      } else if (field instanceof HTMLInputElement) {
        state[key] = field.value;
      }
      if (paused) resumeFrame();
      applyState();
    });
  }

  for (const button of routeContext.root.querySelectorAll("[data-code-rain-choice]")) {
    routeContext.cleanup.addEventListener(button, "click", () => {
      const key = button.getAttribute("data-code-rain-choice") as keyof CodeRainState | null;
      const value = button.getAttribute("data-code-rain-value");
      if (!key || value === null) return;
      state[key] = value;
      if (key === "version" && value === "3d") state.volumetric = "true";
      if (paused) resumeFrame();
      applyState();
    });
  }

  for (const button of routeContext.root.querySelectorAll("[data-code-rain-preset]")) {
    routeContext.cleanup.addEventListener(button, "click", () => {
      const preset = PRESETS.find((entry) => entry.id === button.getAttribute("data-code-rain-preset"));
      if (!preset) return;
      state = sanitizeState({
        ...state,
        ...preset.state,
      });
      if (paused) resumeFrame();
      applyState();
    });
  }

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="settings"]'), "click", () => {
    setSettingsOpen(root, !isSettingsOpen(root));
  });

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="close-settings"]'), "click", () => {
    setSettingsOpen(root, false);
  });

  routeContext.cleanup.addEventListener(document, "pointerdown", (event) => {
    if (!isSettingsOpen(root)) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-code-rain-panel]")) return;
    if (event.target.closest('[data-code-rain-action="settings"]')) return;
    setSettingsOpen(root, false);
  });

  routeContext.cleanup.addEventListener(document, "fullscreenchange", () => {
    syncFullscreenUi();
    if (isFullscreenActive()) revealStatus();
    else clearStatusReveal();
  });

  routeContext.cleanup.addEventListener(document, "webkitfullscreenchange", () => {
    syncFullscreenUi();
    if (isFullscreenActive()) revealStatus();
    else clearStatusReveal();
  });

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="previous-preset"]'), "click", () => applyPresetOffset(-1));
  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="next-preset"]'), "click", () => applyPresetOffset(1));
  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="randomize"]'), "click", randomizeVisual);

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="pause"]'), "click", () => {
    paused = !paused;
    frame.src = paused ? "about:blank" : "";
    if (!paused) loadFrame(frame, state);
    setControlValues(routeContext.root, state, paused);
    showStatus(paused ? "Paused" : stateSummary(state));
  });

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="reload"]'), "click", reloadVisual);

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="fullscreen"]'), "click", () => {
    void toggleFullscreenMode()
      .then(() => {
        syncFullscreenUi();
        if (isFullscreenActive()) revealStatus();
        else clearStatusReveal();
      })
      .catch((error) => runtime?.logger.warn("Code Rain fullscreen request failed.", error));
  });

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="reset"]'), "click", () => {
    state = sanitizeState(DEFAULT_STATE);
    if (paused) resumeFrame();
    applyState();
  });

  routeContext.cleanup.addEventListener(routeContext.root.querySelector('[data-code-rain-action="share"]'), "click", () => {
    const params = stateToParams(state);
    const url = new URL(window.location.href);
    url.hash = `/code-rain?${params.toString()}`;
    const copy = navigator.clipboard?.writeText?.(url.href);
    if (!copy) {
      showStatus("Link ready");
      return;
    }
    void copy.then(
      () => showStatus("Copied"),
      () => showStatus("Link ready"),
    );
  });

  routeContext.cleanup.addEventListener(gestureLayer, "pointerdown", (event) => {
    const pointerEvent = event as PointerEvent;
    if (!isFullscreenActive()) return;
    if (pointerEvent.pointerType === "mouse" && pointerEvent.button !== 0) return;
    pointerEvent.preventDefault();
    gesturePointer = {
      id: pointerEvent.pointerId,
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
      time: Date.now(),
    };
    try {
      gestureLayer.setPointerCapture(pointerEvent.pointerId);
    } catch {
      // ignore
    }
  }, { passive: false });

  routeContext.cleanup.addEventListener(gestureLayer, "pointerup", (event) => {
    const pointerEvent = event as PointerEvent;
    if (!isFullscreenActive() || !gesturePointer || pointerEvent.pointerId !== gesturePointer.id) return;
    pointerEvent.preventDefault();
    const dx = pointerEvent.clientX - gesturePointer.x;
    const dy = pointerEvent.clientY - gesturePointer.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const now = Date.now();

    if (absX >= SWIPE_DISTANCE_PX && absX >= absY * SWIPE_AXIS_RATIO) {
      applyPresetOffset(dx < 0 ? 1 : -1);
      lastGestureTap = null;
      gesturePointer = null;
      return;
    }

    if (Math.hypot(dx, dy) <= DOUBLE_TAP_DISTANCE_PX) {
      if (
        lastGestureTap
        && now - lastGestureTap.time <= DOUBLE_TAP_MS
        && Math.hypot(pointerEvent.clientX - lastGestureTap.x, pointerEvent.clientY - lastGestureTap.y) <= DOUBLE_TAP_DISTANCE_PX
      ) {
        randomizeVisual();
        lastGestureTap = null;
      } else {
        lastGestureTap = { x: pointerEvent.clientX, y: pointerEvent.clientY, time: now };
      }
    }
    gesturePointer = null;
  }, { passive: false });

  routeContext.cleanup.addEventListener(gestureLayer, "pointercancel", () => {
    gesturePointer = null;
  });

  routeContext.cleanup.add(() => {
    window.clearTimeout(statusRevealTimer);
    exitFallbackFullscreen({ clearStatus: false });
    if (isStageFullscreen(stage)) {
      exitNativeFullscreen().catch(() => {});
    }
    setFallbackFullscreenClasses(false);
    frame.src = "about:blank";
  });

  return {
    unmount() {
      exitFallbackFullscreen({ clearStatus: false });
      if (isStageFullscreen(stage)) {
        exitNativeFullscreen().catch(() => {});
      }
      setFallbackFullscreenClasses(false);
      frame.src = "about:blank";
    },
  };
}

const view = createRouteView({
  pageName: "code-rain",
  template,
  meta: {
    title: "Code Rain - VatioLibre",
    description: "Animated code rain visualizer for VatioLibre with local presets and offline static assets.",
    canonicalPath: "/code-rain",
    bodyClass: "code-rain-page",
  },
  loadModule: () => Promise.resolve({}),
  mountController: (_module, routeContext) => mountCodeRain(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
