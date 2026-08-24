import { navigateToAppRoute } from "../app/router.js";
import { clampElementToViewport, makeLauncherDraggable } from "../calculator/widget/drag.js";
import { IconAccel, IconSpeed } from "../icons.js";
import { t } from "../i18n.js";
import { ACTIVITY_OPEN_EVENT, subscribeActivities } from "./activity-state.js";
import type { ActivityRecord } from "./activity-state";

const POS_KEY = "vatioboard.activity_indicator_pos_v1";
const DRAG_THRESHOLD_PX = 6;

const translate = t as (key: string, params?: Record<string, unknown>) => string;

interface ActivityIndicatorPosition {
  launcher?: {
    left?: string;
    top?: string;
  };
  [key: string]: unknown;
}

interface LauncherDragState {
  (): boolean;
  destroy?: () => void;
}

interface ActivityIndicatorOptions {
  mount?: HTMLElement | null;
}

export interface ActivityIndicatorController {
  root: HTMLElement;
  destroy(): void;
}

const makeActivityLauncherDraggable = makeLauncherDraggable as (options: {
  launcherEl: HTMLElement;
  dragThresholdPx: number;
  savePos: (pos: ActivityIndicatorPosition) => void;
  loadPos: () => ActivityIndicatorPosition | null;
}) => LauncherDragState;
const clampActivityElementToViewport = clampElementToViewport as (
  element: HTMLElement,
  margin?: number,
  options?: { useShellWorkArea?: boolean; root?: Document | Element | null },
) => void;

function loadPos(): ActivityIndicatorPosition | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? JSON.parse(raw) as ActivityIndicatorPosition : null;
  } catch {
    return null;
  }
}

function savePos(pos: ActivityIndicatorPosition): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    // Best-effort position persistence, matching the floating widgets.
  }
}

function isFiniteTimestamp(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

function getActivityIcon(activity: ActivityRecord): string {
  return activity.kind === "accel" ? IconAccel : IconSpeed;
}

function getActivityLabel(activity: ActivityRecord): string {
  return activity.labelKey ? translate(activity.labelKey) : activity.label || "";
}

function getActivityDetail(activity: ActivityRecord, nowMs = Date.now()): string {
  const parts: string[] = [];

  if (activity.detailKey) {
    parts.push(translate(activity.detailKey, activity.detailParams));
  } else if (activity.detail) {
    parts.push(String(activity.detail));
  }

  if (isFiniteTimestamp(activity.startedAtMs)) {
    parts.push(formatElapsed(nowMs - activity.startedAtMs));
  }

  if (Number.isFinite(activity.sampleCount) && activity.sampleCount > 0) {
    parts.push(translate("activitySamplesShort", { count: Math.max(0, Math.round(activity.sampleCount)) }));
  }

  if (!parts.length && activity.fallbackDetailKey) {
    parts.push(translate(activity.fallbackDetailKey));
  }

  return parts.join(" · ");
}

function getActivityAriaLabel(activity: ActivityRecord, label: string, detail: string): string {
  const openLabel = activity.openLabelKey
    ? translate(activity.openLabelKey)
    : activity.kind === "accel"
      ? translate("activityOpenAccelTest")
      : translate("activityOpenSpeedRecording");
  return detail ? `${openLabel}: ${label}, ${detail}` : `${openLabel}: ${label}`;
}

function getLiveSignature(activities: ActivityRecord[]): string {
  return activities
    .map((activity) => {
      const detail = activity.detailKey || activity.detail || "";
      return `${activity.id}:${activity.state || ""}:${activity.labelKey || ""}:${detail}`;
    })
    .join("|");
}

function getLiveText(activities: ActivityRecord[]): string {
  if (!activities.length) return "";
  return activities
    .map((activity) => {
      const label = getActivityLabel(activity);
      const detail = getActivityDetail(activity);
      return detail ? `${label}, ${detail}` : label;
    })
    .join(". ");
}

export function initActivityIndicator({ mount = document.body }: ActivityIndicatorOptions = {}): ActivityIndicatorController {
  const root = document.createElement("section");
  root.className = "activity-indicator";
  root.hidden = true;
  root.setAttribute("aria-label", translate("activityStatusLabel"));

  const list = document.createElement("div");
  list.className = "activity-indicator-list";

  const live = document.createElement("span");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");

  root.append(list, live);

  const pos = loadPos();
  if (pos?.launcher?.left && pos?.launcher?.top) {
    root.style.position = "fixed";
    root.style.left = pos.launcher.left;
    root.style.top = pos.launcher.top;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  const rootMoved = makeActivityLauncherDraggable({
    launcherEl: root,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
  });

  let activities: ActivityRecord[] = [];
  let liveSignature = "";
  let renderTimerId: number | null = null;

  function clearRenderTimer(): void {
    if (renderTimerId === null) return;
    window.clearInterval(renderTimerId);
    renderTimerId = null;
  }

  function syncRenderTimer(): void {
    clearRenderTimer();
    const needsTicks = activities.some((activity) => isFiniteTimestamp(activity.startedAtMs));
    if (!needsTicks) return;
    renderTimerId = window.setInterval(() => render({ announce: false }), 1000);
  }

  function render({ announce = true }: { announce?: boolean } = {}): void {
    const hasActivities = activities.length > 0;
    root.hidden = !hasActivities;

    if (!hasActivities) {
      list.replaceChildren();
      if (announce && liveSignature) {
        live.textContent = "";
        liveSignature = "";
      }
      clearRenderTimer();
      return;
    }

    const nowMs = Date.now();
    const fragment = document.createDocumentFragment();

    for (const activity of activities) {
      const label = getActivityLabel(activity);
      const detail = getActivityDetail(activity, nowMs);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activity-indicator-row";
      button.dataset.activityId = activity.id;
      button.dataset.activityKind = activity.kind || "speed";
      button.dataset.activityState = activity.state || "active";
      button.setAttribute("aria-label", getActivityAriaLabel(activity, label, detail));

      const icon = document.createElement("span");
      icon.className = "activity-indicator-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = getActivityIcon(activity);

      const copy = document.createElement("span");
      copy.className = "activity-indicator-copy";

      const title = document.createElement("span");
      title.className = "activity-indicator-title";
      title.textContent = label;

      const meta = document.createElement("span");
      meta.className = "activity-indicator-meta";
      meta.textContent = detail || translate("activityGpsActive");

      copy.append(title, meta);

      const dot = document.createElement("span");
      dot.className = "activity-indicator-dot";
      dot.setAttribute("aria-hidden", "true");

      button.append(icon, copy, dot);
      fragment.append(button);
    }

    list.replaceChildren(fragment);

    if (root.style.left && root.style.top) {
      clampActivityElementToViewport(root, 8, { useShellWorkArea: true, root: document });
    }

    if (!announce) return;
    const nextLiveSignature = getLiveSignature(activities);
    if (nextLiveSignature !== liveSignature) {
      liveSignature = nextLiveSignature;
      live.textContent = getLiveText(activities);
    }
  }

  const unsubscribe = subscribeActivities((nextActivities) => {
    activities = nextActivities;
    render();
    syncRenderTimer();
  });

  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest(".activity-indicator-row") as HTMLElement | null;
    if (!button) return;
    if (rootMoved()) {
      event.preventDefault();
      return;
    }

    const activity = activities.find((entry) => entry.id === button.dataset.activityId);
    if (!activity?.route) return;
    window.dispatchEvent(
      new CustomEvent(ACTIVITY_OPEN_EVENT, {
        detail: { activity },
      }),
    );
    navigateToAppRoute(activity.route);
  });

  function handleI18nChange(): void {
    root.setAttribute("aria-label", translate("activityStatusLabel"));
    render();
  }

  document.addEventListener("i18n:change", handleI18nChange);

  const handleViewportChange = () => {
    if (!root.hidden && root.style.left && root.style.top) {
      clampActivityElementToViewport(root, 8, { useShellWorkArea: true, root: document });
    }
  };
  window.addEventListener("resize", handleViewportChange);
  window.visualViewport?.addEventListener("resize", handleViewportChange);

  mount.appendChild(root);

  return {
    root,
    destroy() {
      clearRenderTimer();
      unsubscribe();
      document.removeEventListener("i18n:change", handleI18nChange);
      window.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      rootMoved.destroy?.();
      root.remove();
    },
  };
}
