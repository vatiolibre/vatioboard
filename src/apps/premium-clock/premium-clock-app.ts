import "./premium-clock.less";

import { IconClose, IconMinimize } from "../../icons.js";
import { clampElementToViewport, makePanelDraggable } from "../../calculator/widget/drag.js";
import { registerFloatingPanel } from "../../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../../shared/shell-window-manager.js";
import { premiumClockWindowCapabilities } from "./manifest.js";
import type { ShellLifecycleOptions, ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const PREMIUM_CLOCK_APP_ID = "vatio.premiumClock";
export const PREMIUM_CLOCK_WINDOW_ID = "premium-clock";

const POSITION_STORAGE_KEY = "premium_clock_pos_v1";
const ALARMS_STORAGE_KEY = "alarms.v1";
const FALLBACK_ALARMS_STORAGE_KEY = "premium_clock_alarms_v1";
const DRAG_THRESHOLD_PX = 6;
const DEFAULT_TIMER_DURATION_MS = 5 * 60 * 1000;

const MODES = [
  { id: "clock", label: "Clock" },
  { id: "timer", label: "Timer" },
  { id: "stopwatch", label: "Stopwatch" },
  { id: "alarms", label: "Alarms" },
  { id: "world", label: "World" },
] as const;

const WORLD_CLOCKS = [
  { label: "New York", zone: "America/New_York" },
  { label: "London", zone: "Europe/London" },
  { label: "Madrid", zone: "Europe/Madrid" },
  { label: "Tokyo", zone: "Asia/Tokyo" },
] as const;

type ClockMode = typeof MODES[number]["id"];

type ClockPosition = {
  panel?: {
    left?: string;
    top?: string;
  } | null;
};

type Alarm = {
  enabled: boolean;
  hour: number;
  id: string;
  minute: number;
};

type TimeParts = {
  dayLabel?: string;
  hour: number;
  minute: number;
  second: number;
};

export interface PremiumClockAppOptions {
  mount?: HTMLElement;
  runtime?: VatioAppRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  shellManager?: ShellRuntime;
  restoreVisibility?: boolean;
}

export interface PremiumClockAppApi {
  open(options?: ShellLifecycleOptions): void;
  close(options?: ShellLifecycleOptions): void;
  minimize(options?: ShellLifecycleOptions): void;
  destroy(): void;
  isOpen(): boolean;
  runtime: VatioAppRuntime | null;
}

function resolvePremiumClockRuntime({
  runtime = null,
  shellAppRuntimeManager = null,
}: Pick<PremiumClockAppOptions, "runtime" | "shellAppRuntimeManager"> = {}): VatioAppRuntime | null {
  if (runtime?.appId === PREMIUM_CLOCK_APP_ID) return runtime;
  return shellAppRuntimeManager?.getRuntime(PREMIUM_CLOCK_APP_ID)
    || shellAppRuntimeManager?.ensureRuntime(PREMIUM_CLOCK_APP_ID)
    || null;
}

function loadPos(): ClockPosition | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePos(shellManager: ShellRuntime, position: ClockPosition) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Position persistence is a convenience only.
  }

  if (position.panel?.left && position.panel?.top) {
    shellManager.updateWindowBounds(PREMIUM_CLOCK_WINDOW_ID, {
      left: Number.parseFloat(position.panel.left),
      top: Number.parseFloat(position.panel.top),
    }, { preserveSnap: false });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clampInteger(value: unknown, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeAlarm(value: unknown): Alarm | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id ? value.id : `alarm-${Date.now()}`;
  return {
    enabled: value.enabled !== false,
    hour: clampInteger(value.hour, 0, 23),
    id,
    minute: clampInteger(value.minute, 0, 59),
  };
}

function loadAlarms(runtime: VatioAppRuntime | null): Alarm[] {
  const stored = runtime?.storage.getJson<unknown>(ALARMS_STORAGE_KEY, null);
  const source = Array.isArray(stored) ? stored : (() => {
    try {
      const raw = localStorage.getItem(FALLBACK_ALARMS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();

  return Array.isArray(source)
    ? source.map(normalizeAlarm).filter((alarm): alarm is Alarm => Boolean(alarm))
    : [];
}

function saveAlarms(runtime: VatioAppRuntime | null, alarms: Alarm[]) {
  if (runtime?.storage.setJson(ALARMS_STORAGE_KEY, alarms)) return;
  try {
    localStorage.setItem(FALLBACK_ALARMS_STORAGE_KEY, JSON.stringify(alarms));
  } catch {
    // Alarm persistence is non-critical.
  }
}

function button({
  label,
  icon,
  className = "",
}: {
  label: string;
  icon: string;
  className?: string;
}) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `premium-clock-control ${className}`.trim();
  element.setAttribute("aria-label", label);
  element.title = label;
  element.innerHTML = icon;
  return element;
}

function createClockMarks() {
  const marks = document.createElement("div");
  marks.className = "premium-clock-marks";

  for (let index = 0; index < 60; index += 1) {
    const mark = document.createElement("i");
    mark.className = index % 5 === 0 ? "premium-clock-mark premium-clock-mark--major" : "premium-clock-mark";
    mark.style.setProperty("--premium-clock-mark-index", String(index));
    marks.append(mark);
  }

  return marks;
}

function createModeButton(mode: ClockMode, label: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "premium-clock-mode";
  element.dataset.premiumClockModeButton = mode;
  element.textContent = label;
  return element;
}

function buildPanel() {
  const panel = document.createElement("section");
  panel.className = "premium-clock-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Premium Clock");

  const controls = document.createElement("div");
  controls.className = "premium-clock-controls";
  const minimizeButton = button({ label: "Minimize clock", icon: IconMinimize });
  const closeButton = button({ label: "Close clock", icon: IconClose });
  controls.append(minimizeButton, closeButton);

  const dragZone = document.createElement("div");
  dragZone.className = "premium-clock-drag-zone";

  const face = document.createElement("div");
  face.className = "premium-clock-face";
  face.setAttribute("aria-hidden", "true");
  face.append(createClockMarks());
  face.innerHTML += `
    <div class="premium-clock-progress"></div>
    <div class="premium-clock-glass"></div>
    <div class="premium-clock-face-label" data-premium-clock-face-label>LOCAL</div>
    <div class="premium-clock-hand premium-clock-hand--hour"></div>
    <div class="premium-clock-hand premium-clock-hand--minute"></div>
    <div class="premium-clock-hand premium-clock-hand--second"></div>
    <div class="premium-clock-pin"></div>
  `;

  const meta = document.createElement("div");
  meta.className = "premium-clock-meta";
  meta.innerHTML = `
    <span class="premium-clock-meta__label" data-premium-clock-label>Local Time</span>
    <strong data-premium-clock-digital>--:--:--</strong>
    <span data-premium-clock-date>--</span>
  `;

  dragZone.append(face, meta);

  const modeDock = document.createElement("nav");
  modeDock.className = "premium-clock-modes";
  modeDock.setAttribute("aria-label", "Clock modes");
  for (const mode of MODES) modeDock.append(createModeButton(mode.id, mode.label));

  const details = document.createElement("div");
  details.className = "premium-clock-details";
  details.innerHTML = `
    <section class="premium-clock-pane" data-premium-clock-pane="timer">
      <div class="premium-clock-adjuster" aria-label="Timer duration">
        <button type="button" data-premium-clock-timer-adjust="-60">-1m</button>
        <output data-premium-clock-timer-duration>05:00</output>
        <button type="button" data-premium-clock-timer-adjust="60">+1m</button>
      </div>
      <div class="premium-clock-actions">
        <button type="button" data-premium-clock-timer-toggle>Start</button>
        <button type="button" data-premium-clock-timer-reset>Reset</button>
      </div>
    </section>
    <section class="premium-clock-pane" data-premium-clock-pane="stopwatch">
      <div class="premium-clock-actions">
        <button type="button" data-premium-clock-stopwatch-toggle>Start</button>
        <button type="button" data-premium-clock-stopwatch-reset>Reset</button>
      </div>
    </section>
    <section class="premium-clock-pane" data-premium-clock-pane="alarms">
      <div class="premium-clock-adjuster" aria-label="Alarm time">
        <button type="button" data-premium-clock-alarm-adjust="hour:-1">-h</button>
        <output data-premium-clock-alarm-draft>07:30</output>
        <button type="button" data-premium-clock-alarm-adjust="hour:1">+h</button>
        <button type="button" data-premium-clock-alarm-adjust="minute:5">+5</button>
      </div>
      <div class="premium-clock-actions">
        <button type="button" data-premium-clock-alarm-add>Add Alarm</button>
        <button type="button" data-premium-clock-alarm-dismiss>Silence</button>
      </div>
      <div class="premium-clock-alarm-list" data-premium-clock-alarm-list></div>
    </section>
    <section class="premium-clock-pane" data-premium-clock-pane="world">
      <div class="premium-clock-world-list" data-premium-clock-world-list></div>
    </section>
  `;

  const notice = document.createElement("div");
  notice.className = "premium-clock-notice";
  notice.hidden = true;
  notice.dataset.premiumClockNotice = "";

  panel.append(controls, dragZone, modeDock, details, notice);

  return {
    panel,
    dragZone,
    minimizeButton,
    closeButton,
    modeDock,
    details,
    faceLabel: panel.querySelector("[data-premium-clock-face-label]") as HTMLElement,
    label: panel.querySelector("[data-premium-clock-label]") as HTMLElement,
    digital: panel.querySelector("[data-premium-clock-digital]") as HTMLElement,
    date: panel.querySelector("[data-premium-clock-date]") as HTMLElement,
    notice,
    timerDuration: panel.querySelector("[data-premium-clock-timer-duration]") as HTMLElement,
    timerToggle: panel.querySelector("[data-premium-clock-timer-toggle]") as HTMLButtonElement,
    stopwatchToggle: panel.querySelector("[data-premium-clock-stopwatch-toggle]") as HTMLButtonElement,
    alarmDraft: panel.querySelector("[data-premium-clock-alarm-draft]") as HTMLElement,
    alarmList: panel.querySelector("[data-premium-clock-alarm-list]") as HTMLElement,
    worldList: panel.querySelector("[data-premium-clock-world-list]") as HTMLElement,
  };
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function formatClockTime(value: Date) {
  return `${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}:${twoDigits(value.getSeconds())}`;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
}

function formatDuration(valueMs: number, showCentiseconds = false) {
  const safeMs = Math.max(0, Math.floor(valueMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const base = `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  if (!showCentiseconds) return base;
  return `${base}.${twoDigits(Math.floor((safeMs % 1000) / 10))}`;
}

function formatShortDuration(valueMs: number) {
  const safeMs = Math.max(0, Math.floor(valueMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

function alarmLabel(alarm: Pick<Alarm, "hour" | "minute">) {
  return `${twoDigits(alarm.hour)}:${twoDigits(alarm.minute)}`;
}

function getDateKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
}

function getTimeZoneParts(zone: string, now: Date): TimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
    timeZone: zone,
    weekday: "short",
  }).formatToParts(now);

  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return {
    dayLabel: `${lookup.get("weekday") || ""} ${lookup.get("month") || ""} ${lookup.get("day") || ""}`.trim(),
    hour: Number.parseInt(lookup.get("hour") || "0", 10),
    minute: Number.parseInt(lookup.get("minute") || "0", 10),
    second: Number.parseInt(lookup.get("second") || "0", 10),
  };
}

function setFaceAngles(panel: HTMLElement, parts: TimeParts, progress = 0) {
  const seconds = parts.second;
  const minutes = parts.minute + seconds / 60;
  const hours = (parts.hour % 12) + minutes / 60;

  panel.style.setProperty("--premium-clock-second", `${seconds * 6}deg`);
  panel.style.setProperty("--premium-clock-minute", `${minutes * 6}deg`);
  panel.style.setProperty("--premium-clock-hour", `${hours * 30}deg`);
  panel.style.setProperty("--premium-clock-progress", `${Math.max(0, Math.min(1, progress)) * 360}deg`);
}

function stopControlPropagation(element: HTMLElement) {
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("pointerup", (event) => event.stopPropagation());
}

export function createPremiumClockApp(options: PremiumClockAppOptions = {}): PremiumClockAppApi {
  const {
    mount = document.body,
    shellManager = getDefaultShellWindowManager(),
    restoreVisibility = false,
  } = options;
  const runtime = resolvePremiumClockRuntime(options);
  const view = buildPanel();
  const {
    panel,
    dragZone,
    minimizeButton,
    closeButton,
    modeDock,
    details,
    faceLabel,
    label,
    digital,
    date,
    notice,
    timerDuration,
    timerToggle,
    stopwatchToggle,
    alarmDraft,
    alarmList,
    worldList,
  } = view;

  let mode: ClockMode = "clock";
  let timerDurationMs = DEFAULT_TIMER_DURATION_MS;
  let timerRemainingMs = DEFAULT_TIMER_DURATION_MS;
  let timerStartedAt = 0;
  let timerRunning = false;
  let stopwatchElapsedMs = 0;
  let stopwatchStartedAt = 0;
  let stopwatchRunning = false;
  let alarmDraftHour = 7;
  let alarmDraftMinute = 30;
  let selectedWorldIndex = 0;
  let activeNotice = "";
  let alarms = loadAlarms(runtime);
  const firedAlarmKeys = new Set<string>();

  const storedPosition = loadPos();
  if (storedPosition?.panel?.left && storedPosition?.panel?.top) {
    panel.style.position = "fixed";
    panel.style.left = storedPosition.panel.left;
    panel.style.top = storedPosition.panel.top;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  let tickerId: number | null = null;

  function getStopwatchElapsed(nowMs = Date.now()) {
    return stopwatchElapsedMs + (stopwatchRunning ? nowMs - stopwatchStartedAt : 0);
  }

  function getTimerRemaining(nowMs = Date.now()) {
    return timerRunning ? Math.max(0, timerRemainingMs - (nowMs - timerStartedAt)) : timerRemainingMs;
  }

  function setMode(nextMode: ClockMode) {
    mode = nextMode;
    panel.dataset.premiumClockMode = mode;
    render();
  }

  function showNotice(message: string) {
    activeNotice = message;
    notice.textContent = message;
    notice.hidden = false;
    panel.classList.add("premium-clock-panel--notice");
  }

  function clearNotice() {
    activeNotice = "";
    notice.hidden = true;
    panel.classList.remove("premium-clock-panel--notice");
  }

  function persistAlarms() {
    saveAlarms(runtime, alarms);
  }

  function renderAlarms() {
    if (alarms.length === 0) {
      alarmList.innerHTML = `<p class="premium-clock-empty">No alarms set</p>`;
      return;
    }

    alarmList.innerHTML = alarms
      .slice()
      .sort((first, second) => (first.hour * 60 + first.minute) - (second.hour * 60 + second.minute))
      .map((alarm) => `
        <div class="premium-clock-alarm" data-premium-clock-alarm="${alarm.id}">
          <strong>${alarmLabel(alarm)}</strong>
          <span>${alarm.enabled ? "Armed" : "Off"}</span>
          <button type="button" data-premium-clock-alarm-toggle="${alarm.id}">${alarm.enabled ? "Disable" : "Enable"}</button>
          <button type="button" data-premium-clock-alarm-remove="${alarm.id}" aria-label="Remove alarm">x</button>
        </div>
      `)
      .join("");
  }

  function renderWorldClocks(now: Date) {
    worldList.innerHTML = WORLD_CLOCKS.map((entry, index) => {
      const parts = getTimeZoneParts(entry.zone, now);
      const seconds = parts.second;
      const minutes = parts.minute + seconds / 60;
      const hours = (parts.hour % 12) + minutes / 60;
      return `
        <button
          type="button"
          class="premium-clock-world ${selectedWorldIndex === index ? "premium-clock-world--active" : ""}"
          data-premium-clock-world-index="${index}"
          style="--world-hour:${hours * 30}deg;--world-minute:${minutes * 6}deg;"
        >
          <span class="premium-clock-world__dial" aria-hidden="true"></span>
          <span><strong>${entry.label}</strong><em>${parts.dayLabel || entry.zone}</em></span>
          <b>${twoDigits(parts.hour)}:${twoDigits(parts.minute)}:${twoDigits(parts.second)}</b>
        </button>
      `;
    }).join("");
  }

  function updateTimer(nowMs: number) {
    if (!timerRunning) return;
    const remaining = getTimerRemaining(nowMs);
    if (remaining > 0) return;
    timerRunning = false;
    timerRemainingMs = 0;
    showNotice("Timer complete");
  }

  function checkAlarms(now: Date) {
    for (const alarm of alarms) {
      if (!alarm.enabled) continue;
      if (alarm.hour !== now.getHours() || alarm.minute !== now.getMinutes()) continue;
      const key = `${alarm.id}:${getDateKey(now)}:${alarm.hour}:${alarm.minute}`;
      if (firedAlarmKeys.has(key)) continue;
      firedAlarmKeys.add(key);
      showNotice(`Alarm ${alarmLabel(alarm)}`);
      setMode("alarms");
    }
  }

  function render() {
    const now = new Date();
    const nowMs = now.getTime();
    updateTimer(nowMs);
    checkAlarms(now);

    for (const button of modeDock.querySelectorAll("[data-premium-clock-mode-button]")) {
      const active = button.getAttribute("data-premium-clock-mode-button") === mode;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }

    details.hidden = mode === "clock";
    for (const pane of details.querySelectorAll("[data-premium-clock-pane]")) {
      pane.toggleAttribute("hidden", pane.getAttribute("data-premium-clock-pane") !== mode);
    }

    const currentTimerRemaining = getTimerRemaining(nowMs);
    const currentStopwatchElapsed = getStopwatchElapsed(nowMs);
    const selectedWorld = WORLD_CLOCKS[selectedWorldIndex];
    const selectedWorldParts = getTimeZoneParts(selectedWorld.zone, now);

    if (mode === "timer") {
      const remainingParts = {
        hour: Math.floor(currentTimerRemaining / 3600000),
        minute: Math.floor((currentTimerRemaining % 3600000) / 60000),
        second: Math.floor((currentTimerRemaining % 60000) / 1000),
      };
      setFaceAngles(panel, remainingParts, timerDurationMs > 0 ? currentTimerRemaining / timerDurationMs : 0);
      faceLabel.textContent = "TIMER";
      label.textContent = timerRunning ? "Timer Running" : "Timer";
      digital.textContent = formatDuration(currentTimerRemaining);
      date.textContent = timerRunning ? "Counting down" : "Ready";
    } else if (mode === "stopwatch") {
      const elapsedParts = {
        hour: Math.floor(currentStopwatchElapsed / 3600000),
        minute: Math.floor((currentStopwatchElapsed % 3600000) / 60000),
        second: Math.floor((currentStopwatchElapsed % 60000) / 1000),
      };
      setFaceAngles(panel, elapsedParts, (currentStopwatchElapsed % 60000) / 60000);
      faceLabel.textContent = "RUN";
      label.textContent = stopwatchRunning ? "Stopwatch Running" : "Stopwatch";
      digital.textContent = formatDuration(currentStopwatchElapsed, true);
      date.textContent = stopwatchRunning ? "Live elapsed time" : "Paused";
    } else if (mode === "alarms") {
      setFaceAngles(panel, { hour: alarmDraftHour, minute: alarmDraftMinute, second: 0 }, 0);
      faceLabel.textContent = "ALARM";
      label.textContent = "Alarm Time";
      digital.textContent = alarmLabel({ hour: alarmDraftHour, minute: alarmDraftMinute });
      date.textContent = activeNotice || `${alarms.filter((alarm) => alarm.enabled).length} armed`;
    } else if (mode === "world") {
      setFaceAngles(panel, selectedWorldParts, 0);
      faceLabel.textContent = selectedWorld.label.slice(0, 3).toUpperCase();
      label.textContent = selectedWorld.label;
      digital.textContent = `${twoDigits(selectedWorldParts.hour)}:${twoDigits(selectedWorldParts.minute)}:${twoDigits(selectedWorldParts.second)}`;
      date.textContent = selectedWorldParts.dayLabel || selectedWorld.zone;
    } else {
      setFaceAngles(panel, {
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
      }, 0);
      faceLabel.textContent = "LOCAL";
      label.textContent = "Local Time";
      digital.textContent = formatClockTime(now);
      date.textContent = formatDate(now);
    }

    timerDuration.textContent = formatShortDuration(timerDurationMs);
    timerToggle.textContent = timerRunning ? "Pause" : "Start";
    stopwatchToggle.textContent = stopwatchRunning ? "Pause" : "Start";
    alarmDraft.textContent = alarmLabel({ hour: alarmDraftHour, minute: alarmDraftMinute });
    renderAlarms();
    renderWorldClocks(now);
  }

  function stopTicker() {
    if (tickerId === null) return;
    window.clearInterval(tickerId);
    tickerId = null;
  }

  function startTicker() {
    render();
    if (tickerId !== null) return;
    tickerId = window.setInterval(render, 250);
  }

  function showPanel() {
    panel.hidden = false;
    if (panel.style.left && panel.style.top) clampElementToViewport(panel, 8, { useShellWorkArea: true });
    startTicker();
  }

  function hidePanel() {
    panel.hidden = true;
    stopTicker();
  }

  function open(options: ShellLifecycleOptions = {}) {
    showPanel();
    shellManager.openWindow(PREMIUM_CLOCK_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    hidePanel();
    shellManager.closeWindow(PREMIUM_CLOCK_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function minimize(options: ShellLifecycleOptions = {}) {
    hidePanel();
    shellManager.minimizeWindow(PREMIUM_CLOCK_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  const cleanupLayer = registerFloatingPanel(panel, {
    id: PREMIUM_CLOCK_WINDOW_ID,
    kind: "tool",
    title: "Premium Clock",
    shellManager,
    capabilities: premiumClockWindowCapabilities,
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
    header: dragZone,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos: (position) => savePos(shellManager, position),
    loadPos,
    shellWindowId: PREMIUM_CLOCK_WINDOW_ID,
    shellManager,
    enableSnapPreview: false,
  });

  for (const control of [minimizeButton, closeButton]) stopControlPropagation(control);

  minimizeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    minimize();
  });
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  modeDock.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("[data-premium-clock-mode-button]")
      : null;
    const nextMode = button?.getAttribute("data-premium-clock-mode-button") as ClockMode | null;
    if (!nextMode || !MODES.some((entry) => entry.id === nextMode)) return;
    setMode(nextMode);
  });

  details.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const timerAdjust = target.closest("[data-premium-clock-timer-adjust]");
    if (timerAdjust) {
      const seconds = Number.parseInt(timerAdjust.getAttribute("data-premium-clock-timer-adjust") || "0", 10);
      timerDurationMs = Math.max(60 * 1000, Math.min(99 * 60 * 1000, timerDurationMs + seconds * 1000));
      if (!timerRunning) timerRemainingMs = timerDurationMs;
      clearNotice();
      render();
      return;
    }

    if (target.closest("[data-premium-clock-timer-toggle]")) {
      if (timerRunning) {
        timerRemainingMs = getTimerRemaining();
        timerRunning = false;
      } else {
        if (timerRemainingMs <= 0) timerRemainingMs = timerDurationMs;
        timerStartedAt = Date.now();
        timerRunning = true;
      }
      clearNotice();
      render();
      return;
    }

    if (target.closest("[data-premium-clock-timer-reset]")) {
      timerRunning = false;
      timerRemainingMs = timerDurationMs;
      clearNotice();
      render();
      return;
    }

    if (target.closest("[data-premium-clock-stopwatch-toggle]")) {
      if (stopwatchRunning) {
        stopwatchElapsedMs = getStopwatchElapsed();
        stopwatchRunning = false;
      } else {
        stopwatchStartedAt = Date.now();
        stopwatchRunning = true;
      }
      render();
      return;
    }

    if (target.closest("[data-premium-clock-stopwatch-reset]")) {
      stopwatchRunning = false;
      stopwatchElapsedMs = 0;
      render();
      return;
    }

    const alarmAdjust = target.closest("[data-premium-clock-alarm-adjust]");
    if (alarmAdjust) {
      const [unit, rawDelta] = (alarmAdjust.getAttribute("data-premium-clock-alarm-adjust") || "").split(":");
      const delta = Number.parseInt(rawDelta || "0", 10);
      if (unit === "hour") alarmDraftHour = (alarmDraftHour + delta + 24) % 24;
      if (unit === "minute") alarmDraftMinute = (alarmDraftMinute + delta + 60) % 60;
      render();
      return;
    }

    if (target.closest("[data-premium-clock-alarm-add]")) {
      alarms = [
        ...alarms,
        {
          enabled: true,
          hour: alarmDraftHour,
          id: `alarm-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          minute: alarmDraftMinute,
        },
      ];
      persistAlarms();
      clearNotice();
      render();
      return;
    }

    if (target.closest("[data-premium-clock-alarm-dismiss]")) {
      clearNotice();
      render();
      return;
    }

    const toggleAlarm = target.closest("[data-premium-clock-alarm-toggle]");
    if (toggleAlarm) {
      const id = toggleAlarm.getAttribute("data-premium-clock-alarm-toggle");
      alarms = alarms.map((alarm) => alarm.id === id ? { ...alarm, enabled: !alarm.enabled } : alarm);
      persistAlarms();
      render();
      return;
    }

    const removeAlarm = target.closest("[data-premium-clock-alarm-remove]");
    if (removeAlarm) {
      const id = removeAlarm.getAttribute("data-premium-clock-alarm-remove");
      alarms = alarms.filter((alarm) => alarm.id !== id);
      persistAlarms();
      render();
      return;
    }

    const worldButton = target.closest("[data-premium-clock-world-index]");
    if (worldButton) {
      selectedWorldIndex = clampInteger(worldButton.getAttribute("data-premium-clock-world-index"), 0, WORLD_CLOCKS.length - 1);
      render();
    }
  });

  mount.append(panel);
  setMode("clock");

  if (restoreVisibility) open({ persist: false });

  runtime?.logger.debug("Premium Clock shell-window app mounted.");

  return {
    open,
    close,
    minimize,
    destroy() {
      stopTicker();
      cleanupLayer();
      panel.remove();
    },
    isOpen: () => !panel.hidden,
    runtime,
  };
}

export const createShellWindowApp = createPremiumClockApp;
