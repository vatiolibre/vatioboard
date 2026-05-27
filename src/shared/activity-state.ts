export const ACTIVITY_STATE_CHANGE_EVENT = "vatioboard:activity-state-change";
export const ACTIVITY_OPEN_EVENT = "vatioboard:activity-open";

const GLOBAL_KEY = "__vatioboardActivityState";

export interface ActivityRecord {
  id: string;
  kind?: string;
  order?: number;
  route?: string;
  state?: string;
  label?: string;
  labelKey?: string;
  detail?: unknown;
  detailKey?: string;
  detailParams?: Record<string, unknown>;
  fallbackDetailKey?: string;
  openLabelKey?: string;
  startedAtMs?: number;
  sampleCount?: number;
  updatedAtMs: number;
  [key: string]: unknown;
}

export type ActivityInput = Partial<Omit<ActivityRecord, "id" | "updatedAtMs">> & {
  updatedAtMs?: unknown;
  [key: string]: unknown;
};

export type ActivityListener = (activities: ActivityRecord[]) => void;

interface ActivityStore {
  activities: Map<string, ActivityRecord>;
  listeners: Set<ActivityListener>;
}

type ActivityWindow = Window & {
  __vatioboardActivityState?: ActivityStore;
};

function createStore(): ActivityStore {
  return {
    activities: new Map(),
    listeners: new Set(),
  };
}

function getStore(): ActivityStore {
  if (typeof window === "undefined") return createStore();
  const activityWindow = window as ActivityWindow;
  if (!activityWindow[GLOBAL_KEY]) {
    activityWindow[GLOBAL_KEY] = createStore();
  }
  return activityWindow[GLOBAL_KEY]!;
}

function normalizeActivity(id: string, activity: unknown): ActivityRecord | null {
  if (!id || !activity || typeof activity !== "object") return null;
  const source = activity as ActivityInput;
  return {
    ...source,
    id,
    updatedAtMs: Number.isFinite(source.updatedAtMs) ? source.updatedAtMs as number : Date.now(),
  } as ActivityRecord;
}

function getSnapshot(store = getStore()): ActivityRecord[] {
  return Array.from(store.activities.values()).sort((left, right) => {
    const leftOrder = Number.isFinite(left.order) ? left.order : 0;
    const rightOrder = Number.isFinite(right.order) ? right.order : 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.id).localeCompare(String(right.id));
  });
}

function emitChange(store = getStore()): void {
  const activities = getSnapshot(store);

  for (const listener of store.listeners) {
    try {
      listener(activities);
    } catch {
      // Keep activity publishers isolated from one another.
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(ACTIVITY_STATE_CHANGE_EVENT, {
        detail: { activities },
      }),
    );
  }
}

export function setActivity(id: string, activity: unknown): void {
  const store = getStore();
  const normalized = normalizeActivity(id, activity);
  if (!normalized) return;
  store.activities.set(id, normalized);
  emitChange(store);
}

export function clearActivity(id: string): void {
  const store = getStore();
  if (!store.activities.delete(id)) return;
  emitChange(store);
}

export function getActivities(): ActivityRecord[] {
  return getSnapshot();
}

export function subscribeActivities(listener: ActivityListener): () => void {
  if (typeof listener !== "function") return () => {};
  const store = getStore();
  store.listeners.add(listener);
  listener(getSnapshot(store));
  return () => {
    store.listeners.delete(listener);
  };
}

export function clearAllActivities(): void {
  const store = getStore();
  if (!store.activities.size) return;
  store.activities.clear();
  emitChange(store);
}
