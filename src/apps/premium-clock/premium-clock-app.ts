import "./premium-clock.less";

import { IconClose, IconMinimize } from "../../icons.js";
import { clampElementToViewport, makePanelDraggable } from "../../calculator/widget/drag.js";
import { registerFloatingPanel } from "../../shared/floating-layer-manager.js";
import { isFocusedLandscapeProfile } from "../../shared/shell-layout-metrics.js";
import { getDefaultShellWindowManager } from "../../shared/shell-window-manager.js";
import {
  createSelectControl,
  createSettingsSwitch,
  type SelectControlController,
  type SettingsSwitchController,
} from "../../shared/ui/settings-controls.js";
import { premiumClockWindowCapabilities } from "./manifest.js";
import type {
  ShellAdaptiveWindowLayout,
  ShellLayoutMetrics,
  ShellLifecycleOptions,
  ShellRuntime,
} from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const PREMIUM_CLOCK_APP_ID = "vatio.premiumClock";
export const PREMIUM_CLOCK_WINDOW_ID = "premium-clock";

const POSITION_STORAGE_KEY = "premium_clock_pos_v1";
const ALARMS_STORAGE_KEY = "alarms.v1";
const FALLBACK_ALARMS_STORAGE_KEY = "premium_clock_alarms_v1";
const DRAG_THRESHOLD_PX = 6;
const DEFAULT_TIMER_DURATION_MS = 5 * 60 * 1000;
const ALARM_AUDIO_SRC = "/audio/alarm-clock.m4a";
const SNOOZE_DURATION_MS = 9 * 60 * 1000;
const CLOCK_TTS_DEDUPE_KEY = "premium-clock-time";
const CLOCK_TTS_WARMUP_DELAY_MS = 600;
const BACKGROUND_CHECK_INTERVAL_MS = 1000;
const MAX_ALARM_RECONCILE_WINDOW_MS = 36 * 60 * 60 * 1000;

const MODE_ICONS = {
  clock: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  timer: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="13" r="7" stroke="currentColor" stroke-width="1.7"/><path d="M9 3h6M12 6v2M17.5 7.5l1.5-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  stopwatch: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 3h6M12 6v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="14" r="7" stroke="currentColor" stroke-width="1.7"/><path d="M12 10v4l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  alarms: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 17h12l-1.5-2.5V11a4.5 4.5 0 0 0-9 0v3.5L6 17Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 19a2 2 0 0 0 4 0M5 6 3.5 8M19 6l1.5 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  world: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7"/><path d="M4 12h16M12 4c2.2 2.2 3.3 4.9 3.3 8S14.2 17.8 12 20M12 4C9.8 6.2 8.7 8.9 8.7 12S9.8 17.8 12 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
} as const;

const MODES = [
  { id: "clock", label: "Clock", icon: MODE_ICONS.clock },
  { id: "timer", label: "Timer", icon: MODE_ICONS.timer },
  { id: "stopwatch", label: "Stopwatch", icon: MODE_ICONS.stopwatch },
  { id: "alarms", label: "Alarms", icon: MODE_ICONS.alarms },
  { id: "world", label: "World", icon: MODE_ICONS.world },
] as const;

const WORLD_CLOCKS = [
  { label: "New York", zone: "America/New_York" },
  { label: "London", zone: "Europe/London" },
  { label: "Madrid", zone: "Europe/Madrid" },
  { label: "Tokyo", zone: "Asia/Tokyo" },
] as const;

type ClockMode = typeof MODES[number]["id"];
type TimerState = "idle" | "running" | "paused" | "complete";
type StopwatchState = "idle" | "running" | "paused";

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

type ActiveAlert = {
  alarmId?: string;
  kind: "alarm" | "timer";
  label?: string;
};

type SnoozedAlarm = {
  alarmId: string;
  fireAtMs: number;
  label: string;
};

export function resolvePremiumClockLayout(metrics: ShellLayoutMetrics): ShellAdaptiveWindowLayout | null {
  const { workArea } = metrics;
  if (metrics.profile === "portrait") {
    const width = Math.min(390, workArea.width);
    const height = workArea.height;
    return {
      mode: "portrait",
      left: workArea.left + Math.max(0, workArea.width - width) / 2,
      top: workArea.top,
      width,
      height,
      minWidth: Math.min(320, workArea.width),
      minHeight: Math.min(320, workArea.height),
      maxWidth: workArea.width,
      maxHeight: workArea.height,
    };
  }
  if (!isFocusedLandscapeProfile(metrics.profile)) return null;
  const width = Math.min(720, workArea.width);
  const height = Math.min(440, workArea.height);
  return {
    mode: "short-landscape",
    left: workArea.left + Math.max(0, workArea.width - width) / 2,
    top: workArea.top + Math.max(0, workArea.height - height) / 2,
    width,
    height,
    minWidth: Math.min(480, workArea.width),
    minHeight: Math.min(260, workArea.height),
    maxWidth: workArea.width,
    maxHeight: workArea.height,
  };
}

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

function createModeButton(mode: ClockMode, label: string, icon: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "premium-clock-mode";
  element.id = `premium-clock-mode-${mode}`;
  element.dataset.premiumClockModeButton = mode;
  element.setAttribute("role", "tab");
  element.setAttribute("aria-label", label);
  element.setAttribute("aria-controls", "premium-clock-workspace");
  element.title = label;
  element.innerHTML = `
    <span class="premium-clock-mode__icon" aria-hidden="true">${icon}</span>
    <span class="premium-clock-mode__label">${label}</span>
  `;
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
  dragZone.tabIndex = 0;
  dragZone.setAttribute("role", "button");
  dragZone.setAttribute("aria-label", "Touch clock to hear the time and date");
  dragZone.title = "Touch clock to hear the time and date";

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
  modeDock.setAttribute("role", "tablist");
  for (const mode of MODES) modeDock.append(createModeButton(mode.id, mode.label, mode.icon));

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
      <div class="premium-clock-alarm-setup" aria-label="Alarm time">
        <div data-premium-clock-alarm-hour-control></div>
        <span class="premium-clock-alarm-separator" aria-hidden="true">:</span>
        <div data-premium-clock-alarm-minute-control></div>
        <output class="sr-only" data-premium-clock-alarm-draft>07:30</output>
        <button type="button" class="premium-clock-alarm-add" data-premium-clock-alarm-add>Add Alarm</button>
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
  notice.innerHTML = `
    <span class="premium-clock-notice__message" data-premium-clock-notice-message></span>
    <span class="premium-clock-notice__actions" data-premium-clock-notice-actions hidden>
      <button type="button" data-premium-clock-alert-stop>Stop</button>
      <button type="button" data-premium-clock-alert-snooze>Snooze</button>
      <button type="button" data-premium-clock-alert-enable-sound hidden>Enable sound</button>
    </span>
  `;

  const workspace = document.createElement("div");
  workspace.id = "premium-clock-workspace";
  workspace.className = "premium-clock-workspace";
  workspace.setAttribute("role", "tabpanel");
  workspace.append(dragZone, details);

  panel.append(controls, workspace, modeDock, notice);

  return {
    panel,
    dragZone,
    minimizeButton,
    closeButton,
    modeDock,
    workspace,
    details,
    faceLabel: panel.querySelector("[data-premium-clock-face-label]") as HTMLElement,
    label: panel.querySelector("[data-premium-clock-label]") as HTMLElement,
    digital: panel.querySelector("[data-premium-clock-digital]") as HTMLElement,
    date: panel.querySelector("[data-premium-clock-date]") as HTMLElement,
    notice,
    noticeActions: panel.querySelector("[data-premium-clock-notice-actions]") as HTMLElement,
    noticeMessage: panel.querySelector("[data-premium-clock-notice-message]") as HTMLElement,
    alertSnoozeButton: panel.querySelector("[data-premium-clock-alert-snooze]") as HTMLButtonElement,
    alertEnableSoundButton: panel.querySelector("[data-premium-clock-alert-enable-sound]") as HTMLButtonElement,
    timerDuration: panel.querySelector("[data-premium-clock-timer-duration]") as HTMLElement,
    timerToggle: panel.querySelector("[data-premium-clock-timer-toggle]") as HTMLButtonElement,
    stopwatchToggle: panel.querySelector("[data-premium-clock-stopwatch-toggle]") as HTMLButtonElement,
    alarmDraft: panel.querySelector("[data-premium-clock-alarm-draft]") as HTMLElement,
    alarmHourControlMount: panel.querySelector("[data-premium-clock-alarm-hour-control]") as HTMLElement,
    alarmMinuteControlMount: panel.querySelector("[data-premium-clock-alarm-minute-control]") as HTMLElement,
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
  const locale = document.documentElement.lang || undefined;
  const parts = new Intl.DateTimeFormat(locale, {
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

function formatSpokenDateTime(value: Date) {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(value);
  return `The time is ${time}. Today is ${day}.`;
}

function getSpokenMinuteKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}-${value.getHours()}-${value.getMinutes()}`;
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
    workspace,
    details,
    faceLabel,
    label,
    digital,
    date,
    notice,
    noticeActions,
    noticeMessage,
    alertSnoozeButton,
    alertEnableSoundButton,
    timerDuration,
    timerToggle,
    stopwatchToggle,
    alarmDraft,
    alarmHourControlMount,
    alarmMinuteControlMount,
    alarmList,
    worldList,
  } = view;

  let mode: ClockMode = "clock";
  let timerDurationMs = DEFAULT_TIMER_DURATION_MS;
  let timerRemainingMs = DEFAULT_TIMER_DURATION_MS;
  let timerStartedAt = 0;
  let timerState: TimerState = "idle";
  let stopwatchElapsedMs = 0;
  let stopwatchStartedAt = 0;
  let stopwatchState: StopwatchState = "idle";
  let alarmDraftHour = 7;
  let alarmDraftMinute = 30;
  let selectedWorldIndex = 0;
  let activeNotice = "";
  let activeAlert: ActiveAlert | null = null;
  let alarmAudio: HTMLAudioElement | null = null;
  let alarmAudioUnlocked = false;
  let alarmAudioBlocked = false;
  let alarms = loadAlarms(runtime);
  let snoozedAlarms: SnoozedAlarm[] = [];
  let speechPointer: { x: number; y: number; pointerId: number } | null = null;
  let clockTtsWarmupId: number | null = null;
  let clockTtsVoiceWarmupPromise: Promise<unknown> | null = null;
  let clockTtsSpeechWarmupPromise: Promise<unknown> | null = null;
  let clockTtsPreparedMinuteKey = "";
  let clockTtsPreparingMinuteKey = "";
  const firedAlarmKeys = new Set<string>();
  const alarmSwitches: SettingsSwitchController[] = [];
  const worldRows: Array<{
    button: HTMLButtonElement;
    city: HTMLElement;
    day: HTMLElement;
    time: HTMLElement;
  }> = [];
  let hourControl: SelectControlController | null = null;
  let minuteControl: SelectControlController | null = null;
  let backgroundCheckId: number | null = null;
  let lastAlarmCheckMs = Date.now() - 60_000;
  let destroyed = false;

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
    return stopwatchElapsedMs + (stopwatchState === "running" ? nowMs - stopwatchStartedAt : 0);
  }

  function getTimerRemaining(nowMs = Date.now()) {
    return timerState === "running" ? Math.max(0, timerRemainingMs - (nowMs - timerStartedAt)) : timerRemainingMs;
  }

  function setMode(nextMode: ClockMode) {
    mode = nextMode;
    panel.dataset.premiumClockMode = mode;
    workspace.setAttribute("aria-labelledby", `premium-clock-mode-${mode}`);
    render();
  }

  function getAlarmAudio() {
    if (alarmAudio) return alarmAudio;
    alarmAudio = new Audio(ALARM_AUDIO_SRC);
    alarmAudio.loop = true;
    alarmAudio.preload = "auto";
    alarmAudio.volume = 1;
    return alarmAudio;
  }

  function stopAlarmSound() {
    if (!alarmAudio) return;
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
  }

  function setAudioBlocked(blocked: boolean) {
    alarmAudioBlocked = blocked;
    alertEnableSoundButton.hidden = !blocked || !activeAlert;
  }

  async function playAlarmSound() {
    const audio = getAlarmAudio();
    audio.muted = false;
    audio.volume = 1;
    audio.currentTime = 0;
    try {
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === "function") {
        await playResult;
      }
      alarmAudioUnlocked = true;
      setAudioBlocked(false);
    } catch (error) {
      setAudioBlocked(true);
      runtime?.logger.warn("Premium Clock alarm audio could not start automatically.");
      runtime?.logger.debug("Premium Clock alarm audio failure details.", error);
    }
  }

  async function primeAlarmSound() {
    if (alarmAudioUnlocked && !alarmAudioBlocked) return;
    const audio = getAlarmAudio();
    const previousMuted = audio.muted;
    audio.muted = true;
    try {
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = previousMuted;
      setAudioBlocked(false);
      audio.muted = previousMuted;
      alarmAudioUnlocked = true;
    } catch {
      audio.muted = previousMuted;
      alarmAudioUnlocked = false;
    }
  }

  function showNotice(message: string, alert: ActiveAlert | null = null) {
    activeNotice = message;
    activeAlert = alert;
    noticeMessage.textContent = message;
    notice.hidden = false;
    noticeActions.hidden = !alert;
    alertSnoozeButton.hidden = alert?.kind !== "alarm";
    alertEnableSoundButton.hidden = !alert || !alarmAudioBlocked;
    if (alert) {
      notice.dataset.premiumClockAlert = alert.kind;
      void playAlarmSound();
    } else {
      delete notice.dataset.premiumClockAlert;
    }
    panel.classList.add("premium-clock-panel--notice");
  }

  function clearNotice() {
    activeNotice = "";
    activeAlert = null;
    notice.hidden = true;
    noticeActions.hidden = true;
    alertSnoozeButton.hidden = true;
    alertEnableSoundButton.hidden = true;
    delete notice.dataset.premiumClockAlert;
    panel.classList.remove("premium-clock-panel--notice");
    stopAlarmSound();
  }

  function clearVoiceNotice() {
    if (!activeAlert && activeNotice === "Voice time unavailable") clearNotice();
  }

  function snoozeActiveAlarm() {
    if (activeAlert?.kind !== "alarm") return;
    const label = activeAlert.label || activeNotice.replace(/^Alarm\s+/, "") || "alarm";
    snoozedAlarms = [
      ...snoozedAlarms.filter((alarm) => alarm.alarmId !== activeAlert.alarmId),
      {
        alarmId: activeAlert.alarmId || `snooze-${Date.now()}`,
        fireAtMs: Date.now() + SNOOZE_DURATION_MS,
        label,
      },
    ];
    clearNotice();
  }

  function preloadClockTtsVoice() {
    const tts = runtime?.services.tts || null;
    if (!tts) return Promise.resolve();
    if (!clockTtsVoiceWarmupPromise) {
      clockTtsVoiceWarmupPromise = tts.preloadVoice()
        .catch((error) => {
          runtime?.logger.debug("Premium Clock TTS voice preload did not complete.", error);
        })
        .finally(() => {
          clockTtsVoiceWarmupPromise = null;
        });
    }
    return clockTtsVoiceWarmupPromise;
  }

  function prepareClockTtsSpeech(value = new Date()) {
    const tts = runtime?.services.tts || null;
    if (!tts || panel.hidden) return Promise.resolve();
    const minuteKey = getSpokenMinuteKey(value);
    if (clockTtsPreparedMinuteKey === minuteKey || clockTtsPreparingMinuteKey === minuteKey) {
      return clockTtsSpeechWarmupPromise || Promise.resolve();
    }
    const snapshot = tts.getSnapshot();
    if (snapshot.speaking || snapshot.generating || snapshot.loading) return Promise.resolve();

    clockTtsPreparingMinuteKey = minuteKey;
    clockTtsSpeechWarmupPromise = tts.prepareSpeech({
      text: formatSpokenDateTime(value),
      priority: "info",
      dedupeKey: `${CLOCK_TTS_DEDUPE_KEY}:${minuteKey}`,
    })
      .then(() => {
        clockTtsPreparedMinuteKey = minuteKey;
      })
      .catch((error) => {
        runtime?.logger.debug("Premium Clock TTS speech warmup did not complete.", error);
      })
      .finally(() => {
        if (clockTtsPreparingMinuteKey === minuteKey) clockTtsPreparingMinuteKey = "";
        clockTtsSpeechWarmupPromise = null;
      });
    return clockTtsSpeechWarmupPromise;
  }

  function scheduleClockTtsWarmup(delayMs = CLOCK_TTS_WARMUP_DELAY_MS) {
    if (!runtime?.services.tts || panel.hidden) return;
    if (clockTtsWarmupId !== null) {
      if (delayMs > 0) return;
      window.clearTimeout(clockTtsWarmupId);
    }
    clockTtsWarmupId = window.setTimeout(() => {
      clockTtsWarmupId = null;
      void preloadClockTtsVoice().then(() => prepareClockTtsSpeech());
    }, Math.max(0, delayMs));
  }

  function speakCurrentTime() {
    const now = new Date();
    const text = formatSpokenDateTime(now);
    const tts = runtime?.services.tts || null;
    if (tts) {
      clearVoiceNotice();
      tts.speak({
        text,
        dedupeKey: CLOCK_TTS_DEDUPE_KEY,
        priority: "system",
        volume: 1,
      }).then(() => {
        clockTtsPreparedMinuteKey = getSpokenMinuteKey(now);
        scheduleClockTtsWarmup();
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "";
        runtime?.logger.warn("Premium Clock voice announcement failed.", error);
        if (!activeAlert && !message.includes("Duplicate TTS announcement suppressed")) {
          showNotice("Voice time unavailable");
        }
      });
      return;
    }

    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      if (!activeAlert) showNotice("Voice time unavailable");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 0.96;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }

  function persistAlarms() {
    saveAlarms(runtime, alarms);
  }

  function destroyAlarmSwitches() {
    while (alarmSwitches.length) alarmSwitches.pop()?.destroy();
  }

  function renderAlarms() {
    destroyAlarmSwitches();
    alarmList.replaceChildren();
    if (alarms.length === 0) {
      const empty = document.createElement("p");
      empty.className = "premium-clock-empty";
      empty.textContent = "No alarms set";
      alarmList.append(empty);
      return;
    }

    const sorted = alarms
      .slice()
      .sort((first, second) => (first.hour * 60 + first.minute) - (second.hour * 60 + second.minute));
    for (const alarm of sorted) {
      const row = document.createElement("div");
      row.className = "premium-clock-alarm";
      row.dataset.premiumClockAlarm = alarm.id;
      const time = document.createElement("strong");
      time.textContent = alarmLabel(alarm);
      const toggleMount = document.createElement("div");
      toggleMount.className = "premium-clock-alarm-toggle-mount";
      const toggle = createSettingsSwitch({
        label: `Enable alarm ${alarmLabel(alarm)}`,
        checked: alarm.enabled,
        classNames: { root: "premium-clock-alarm-switch" },
        onChange(checked) {
          alarms = alarms.map((entry) => entry.id === alarm.id ? { ...entry, enabled: checked } : entry);
          persistAlarms();
          renderAlarms();
          scheduleBackgroundCheck(0);
        },
      });
      toggle.input.dataset.premiumClockAlarmToggle = alarm.id;
      alarmSwitches.push(toggle);
      toggleMount.append(toggle.element);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "premium-clock-alarm-remove";
      remove.dataset.premiumClockAlarmRemove = alarm.id;
      remove.setAttribute("aria-label", `Remove alarm ${alarmLabel(alarm)}`);
      remove.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 7h12M10 7V5h4v2M9 10v7M12 10v7M15 10v7M8 7l1 12h6l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      row.append(time, toggleMount, remove);
      alarmList.append(row);
    }
  }

  function buildWorldClocks() {
    worldList.replaceChildren();
    WORLD_CLOCKS.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "premium-clock-world";
      button.dataset.premiumClockWorldIndex = String(index);
      button.setAttribute("aria-label", entry.label);
      button.innerHTML = `
        <span class="premium-clock-world__dial" aria-hidden="true"></span>
        <span class="premium-clock-world__copy"><strong></strong><em></em></span>
        <b></b>
      `;
      const city = button.querySelector("strong") as HTMLElement;
      const day = button.querySelector("em") as HTMLElement;
      const time = button.querySelector("b") as HTMLElement;
      city.textContent = entry.label;
      worldRows.push({ button, city, day, time });
      worldList.append(button);
    });
  }

  function updateWorldClocks(now: Date) {
    WORLD_CLOCKS.forEach((entry, index) => {
      const parts = getTimeZoneParts(entry.zone, now);
      const seconds = parts.second;
      const minutes = parts.minute + seconds / 60;
      const hours = (parts.hour % 12) + minutes / 60;
      const row = worldRows[index];
      if (!row) return;
      const active = selectedWorldIndex === index;
      row.button.classList.toggle("premium-clock-world--active", active);
      row.button.setAttribute("aria-pressed", String(active));
      row.button.style.setProperty("--world-hour", `${hours * 30}deg`);
      row.button.style.setProperty("--world-minute", `${minutes * 6}deg`);
      row.day.textContent = parts.dayLabel || entry.zone;
      row.time.textContent = `${twoDigits(parts.hour)}:${twoDigits(parts.minute)}:${twoDigits(parts.second)}`;
    });
  }

  function updateTimer(nowMs: number) {
    if (timerState !== "running") return false;
    const remaining = getTimerRemaining(nowMs);
    if (remaining > 0) return false;
    timerState = "complete";
    timerRemainingMs = 0;
    showNotice("Timer complete", { kind: "timer" });
    return true;
  }

  function checkSnoozedAlarms(nowMs: number) {
    const dueAlarm = snoozedAlarms
      .filter((alarm) => alarm.fireAtMs <= nowMs)
      .sort((first, second) => second.fireAtMs - first.fireAtMs)[0];
    if (!dueAlarm) return false;
    snoozedAlarms = snoozedAlarms.filter((alarm) => alarm !== dueAlarm);
    showNotice(`Alarm ${dueAlarm.label}`, {
      alarmId: dueAlarm.alarmId,
      kind: "alarm",
      label: dueAlarm.label,
    });
    setMode("alarms");
    return true;
  }

  function getAlarmOccurrences(alarm: Alarm, fromMs: number, toMs: number) {
    const occurrences: Date[] = [];
    const cursor = new Date(fromMs);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(toMs);
    end.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime()) {
      const occurrence = new Date(cursor);
      occurrence.setHours(alarm.hour, alarm.minute, 0, 0);
      const occurrenceMs = occurrence.getTime();
      if (occurrenceMs > fromMs && occurrenceMs <= toMs) occurrences.push(occurrence);
      cursor.setDate(cursor.getDate() + 1);
    }
    return occurrences;
  }

  function checkAlarms(now: Date) {
    const nowMs = now.getTime();
    const fromMs = Math.max(lastAlarmCheckMs, nowMs - MAX_ALARM_RECONCILE_WINDOW_MS);
    const due = alarms
      .filter((alarm) => alarm.enabled)
      .flatMap((alarm) => getAlarmOccurrences(alarm, fromMs, nowMs).map((occurrence) => ({ alarm, occurrence })))
      .sort((first, second) => second.occurrence.getTime() - first.occurrence.getTime());
    lastAlarmCheckMs = nowMs;
    const next = due.find(({ alarm, occurrence }) => (
      !firedAlarmKeys.has(`${alarm.id}:${getDateKey(occurrence)}:${alarm.hour}:${alarm.minute}`)
    ));
    if (!next) return false;
    const key = `${next.alarm.id}:${getDateKey(next.occurrence)}:${next.alarm.hour}:${next.alarm.minute}`;
    firedAlarmKeys.add(key);
    showNotice(`Alarm ${alarmLabel(next.alarm)}`, {
      alarmId: next.alarm.id,
      kind: "alarm",
      label: alarmLabel(next.alarm),
    });
    setMode("alarms");
    return true;
  }

  function reconcileTemporalState(now = new Date()) {
    const nowMs = now.getTime();
    const timerCompleted = updateTimer(nowMs);
    const snoozeFired = checkSnoozedAlarms(nowMs);
    const alarmFired = checkAlarms(now);
    return timerCompleted || snoozeFired || alarmFired;
  }

  function hasBackgroundWork() {
    return timerState === "running"
      || stopwatchState === "running"
      || snoozedAlarms.length > 0
      || alarms.some((alarm) => alarm.enabled)
      || Boolean(activeAlert);
  }

  function stopBackgroundCheck() {
    if (backgroundCheckId === null) return;
    window.clearTimeout(backgroundCheckId);
    backgroundCheckId = null;
  }

  function scheduleBackgroundCheck(delayMs = BACKGROUND_CHECK_INTERVAL_MS) {
    stopBackgroundCheck();
    if (destroyed || !hasBackgroundWork()) return;
    backgroundCheckId = window.setTimeout(() => {
      backgroundCheckId = null;
      const changed = reconcileTemporalState();
      if (!panel.hidden || changed) render({ reconcile: false });
      scheduleBackgroundCheck();
    }, Math.max(0, delayMs));
  }

  function render({ reconcile = true } = {}) {
    const now = new Date();
    const nowMs = now.getTime();
    if (reconcile) reconcileTemporalState(now);

    for (const button of modeDock.querySelectorAll("[data-premium-clock-mode-button]")) {
      const active = button.getAttribute("data-premium-clock-mode-button") === mode;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("aria-selected", active ? "true" : "false");
      (button as HTMLElement).tabIndex = active ? 0 : -1;
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
      label.textContent = timerState === "running" ? "Timer Running" : "Timer";
      digital.textContent = formatDuration(currentTimerRemaining);
      date.textContent = timerState === "running"
        ? "Counting down"
        : timerState === "paused" ? "Paused" : timerState === "complete" ? "Complete" : "Ready";
    } else if (mode === "stopwatch") {
      const elapsedParts = {
        hour: Math.floor(currentStopwatchElapsed / 3600000),
        minute: Math.floor((currentStopwatchElapsed % 3600000) / 60000),
        second: Math.floor((currentStopwatchElapsed % 60000) / 1000),
      };
      setFaceAngles(panel, elapsedParts, (currentStopwatchElapsed % 60000) / 60000);
      faceLabel.textContent = "RUN";
      label.textContent = stopwatchState === "running" ? "Stopwatch Running" : "Stopwatch";
      digital.textContent = formatDuration(currentStopwatchElapsed, true);
      date.textContent = stopwatchState === "running"
        ? "Live elapsed time"
        : stopwatchState === "paused" ? "Paused" : "Ready";
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
      if (clockTtsPreparedMinuteKey !== getSpokenMinuteKey(now) && !clockTtsPreparingMinuteKey) {
        scheduleClockTtsWarmup();
      }
    }

    timerDuration.textContent = formatShortDuration(timerDurationMs);
    timerToggle.textContent = timerState === "running" ? "Pause" : timerState === "paused" ? "Resume" : "Start";
    stopwatchToggle.textContent = stopwatchState === "running" ? "Pause" : stopwatchState === "paused" ? "Resume" : "Start";
    for (const adjuster of details.querySelectorAll<HTMLButtonElement>("[data-premium-clock-timer-adjust]")) {
      adjuster.disabled = timerState === "running";
    }
    alarmDraft.textContent = alarmLabel({ hour: alarmDraftHour, minute: alarmDraftMinute });
    hourControl?.setValue(String(alarmDraftHour));
    minuteControl?.setValue(String(alarmDraftMinute));
    updateWorldClocks(now);
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
    scheduleBackgroundCheck();
  }

  function showPanel() {
    panel.hidden = false;
    if (panel.style.left && panel.style.top) clampElementToViewport(panel, 8, { useShellWorkArea: true });
    reconcileTemporalState();
    startTicker();
    scheduleClockTtsWarmup();
  }

  function hidePanel() {
    panel.hidden = true;
    stopTicker();
    hourControl?.close();
    minuteControl?.close();
    if (clockTtsWarmupId !== null) {
      window.clearTimeout(clockTtsWarmupId);
      clockTtsWarmupId = null;
    }
    scheduleBackgroundCheck(0);
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
    resolveLayout: resolvePremiumClockLayout,
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

  panel.addEventListener("pointerdown", () => {
    void primeAlarmSound();
    void runtime?.services.tts?.primeFromUserGesture({ keepAlive: true });
    scheduleClockTtsWarmup(0);
  });

  const preventClockDoubleClickZoom = (event: MouseEvent) => {
    if (event.cancelable) event.preventDefault();
  };
  const preventClockOverscroll = (event: TouchEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const scrollRegion = target?.closest<HTMLElement>(".premium-clock-alarm-list");
    if (scrollRegion && scrollRegion.scrollHeight > scrollRegion.clientHeight + 1) return;
    if (event.cancelable) event.preventDefault();
  };
  let lastClockTap: { at: number; target: EventTarget | null; x: number; y: number } | null = null;
  const preventClockDoubleTapZoom = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    const now = Date.now();
    const repeatedTap = lastClockTap
      && now - lastClockTap.at < 350
      && lastClockTap.target === event.target
      && Math.hypot(touch.clientX - lastClockTap.x, touch.clientY - lastClockTap.y) < 24;
    lastClockTap = { at: now, target: event.target, x: touch.clientX, y: touch.clientY };
    if (repeatedTap && event.cancelable) event.preventDefault();
  };
  panel.addEventListener("dblclick", preventClockDoubleClickZoom);
  panel.addEventListener("touchmove", preventClockOverscroll, { passive: false });
  panel.addEventListener("touchend", preventClockDoubleTapZoom, { passive: false });

  const handleTemporalResume = () => {
    const changed = reconcileTemporalState();
    if (!panel.hidden || changed) render({ reconcile: false });
    scheduleBackgroundCheck(0);
  };
  const handleVisibilityChange = () => {
    if (!document.hidden) handleTemporalResume();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", handleTemporalResume);
  window.addEventListener("focus", handleTemporalResume);

  dragZone.addEventListener("pointerdown", (event) => {
    speechPointer = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  });

  dragZone.addEventListener("pointerup", (event) => {
    if (!speechPointer || speechPointer.pointerId !== event.pointerId) return;
    const moved = Math.max(
      Math.abs(event.clientX - speechPointer.x),
      Math.abs(event.clientY - speechPointer.y)
    );
    speechPointer = null;
    if (moved > DRAG_THRESHOLD_PX) return;
    speakCurrentTime();
  });

  dragZone.addEventListener("pointercancel", () => {
    speechPointer = null;
  });

  dragZone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    speakCurrentTime();
  });

  notice.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-premium-clock-alert-stop]")) {
      clearNotice();
      render();
      return;
    }
    if (target.closest("[data-premium-clock-alert-snooze]")) {
      snoozeActiveAlarm();
      render();
      scheduleBackgroundCheck(0);
      return;
    }
    if (target.closest("[data-premium-clock-alert-enable-sound]")) {
      void primeAlarmSound().then(() => {
        if (activeAlert) void playAlarmSound();
      });
    }
  });

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

  modeDock.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(modeDock.querySelectorAll<HTMLButtonElement>("[data-premium-clock-mode-button]"));
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    const nextMode = next?.dataset.premiumClockModeButton as ClockMode | undefined;
    if (!next || !nextMode) return;
    event.preventDefault();
    next.focus();
    setMode(nextMode);
  });

  details.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const timerAdjust = target.closest("[data-premium-clock-timer-adjust]");
    if (timerAdjust) {
      if (timerState === "running") return;
      const seconds = Number.parseInt(timerAdjust.getAttribute("data-premium-clock-timer-adjust") || "0", 10);
      const previousDuration = timerDurationMs;
      timerDurationMs = Math.max(60 * 1000, Math.min(99 * 60 * 1000, timerDurationMs + seconds * 1000));
      if (timerState === "paused") {
        timerRemainingMs = Math.max(0, Math.min(timerDurationMs, timerRemainingMs + (timerDurationMs - previousDuration)));
      } else {
        timerRemainingMs = timerDurationMs;
        timerState = "idle";
      }
      clearNotice();
      render();
      return;
    }

    if (target.closest("[data-premium-clock-timer-toggle]")) {
      if (timerState === "running") {
        timerRemainingMs = getTimerRemaining();
        timerState = "paused";
      } else {
        if (timerState === "complete" || timerRemainingMs <= 0) timerRemainingMs = timerDurationMs;
        timerStartedAt = Date.now();
        timerState = "running";
      }
      clearNotice();
      render();
      scheduleBackgroundCheck(0);
      return;
    }

    if (target.closest("[data-premium-clock-timer-reset]")) {
      timerState = "idle";
      timerRemainingMs = timerDurationMs;
      clearNotice();
      render();
      scheduleBackgroundCheck(0);
      return;
    }

    if (target.closest("[data-premium-clock-stopwatch-toggle]")) {
      if (stopwatchState === "running") {
        stopwatchElapsedMs = getStopwatchElapsed();
        stopwatchState = "paused";
      } else {
        stopwatchStartedAt = Date.now();
        stopwatchState = "running";
      }
      render();
      scheduleBackgroundCheck(0);
      return;
    }

    if (target.closest("[data-premium-clock-stopwatch-reset]")) {
      stopwatchState = "idle";
      stopwatchElapsedMs = 0;
      render();
      scheduleBackgroundCheck(0);
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
      renderAlarms();
      render();
      scheduleBackgroundCheck(0);
      return;
    }

    const removeAlarm = target.closest("[data-premium-clock-alarm-remove]");
    if (removeAlarm) {
      const id = removeAlarm.getAttribute("data-premium-clock-alarm-remove");
      alarms = alarms.filter((alarm) => alarm.id !== id);
      persistAlarms();
      renderAlarms();
      render();
      scheduleBackgroundCheck(0);
      return;
    }

    const worldButton = target.closest("[data-premium-clock-world-index]");
    if (worldButton) {
      selectedWorldIndex = clampInteger(worldButton.getAttribute("data-premium-clock-world-index"), 0, WORLD_CLOCKS.length - 1);
      render();
    }
  });

  mount.append(panel);
  hourControl = createSelectControl({
    label: "Hour",
    value: String(alarmDraftHour),
    options: Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: twoDigits(hour) })),
    classNames: { root: "premium-clock-alarm-time-control" },
    onChange(value) {
      alarmDraftHour = clampInteger(value, 0, 23);
      render();
    },
  });
  minuteControl = createSelectControl({
    label: "Minute",
    value: String(alarmDraftMinute),
    options: Array.from({ length: 12 }, (_, index) => ({ value: String(index * 5), label: twoDigits(index * 5) })),
    classNames: { root: "premium-clock-alarm-time-control" },
    onChange(value) {
      alarmDraftMinute = clampInteger(value, 0, 55);
      render();
    },
  });
  alarmHourControlMount.append(hourControl.element);
  alarmMinuteControlMount.append(minuteControl.element);
  buildWorldClocks();
  renderAlarms();
  setMode("clock");
  scheduleBackgroundCheck(0);

  if (restoreVisibility) open({ persist: false });

  runtime?.logger.debug("Premium Clock shell-window app mounted.");

  return {
    open,
    close,
    minimize,
    destroy() {
      destroyed = true;
      stopTicker();
      stopBackgroundCheck();
      stopAlarmSound();
      if (clockTtsWarmupId !== null) window.clearTimeout(clockTtsWarmupId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handleTemporalResume);
      window.removeEventListener("focus", handleTemporalResume);
      panel.removeEventListener("dblclick", preventClockDoubleClickZoom);
      panel.removeEventListener("touchmove", preventClockOverscroll);
      panel.removeEventListener("touchend", preventClockDoubleTapZoom);
      hourControl?.destroy();
      minuteControl?.destroy();
      hourControl = null;
      minuteControl = null;
      destroyAlarmSwitches();
      cleanupLayer();
      panel.remove();
    },
    isOpen: () => !panel.hidden,
    runtime,
  };
}

export const createShellWindowApp = createPremiumClockApp;
