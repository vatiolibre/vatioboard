export const ACTIVITY_STATE_CHANGE_EVENT = "vatioboard:activity-state-change";
export const ACTIVITY_OPEN_EVENT = "vatioboard:activity-open";

const GLOBAL_KEY = "__vatioboardActivityState";

function createStore() {
  return {
    activities: new Map(),
    listeners: new Set(),
  };
}

function getStore() {
  if (typeof window === "undefined") return createStore();
  if (!window[GLOBAL_KEY]) {
    window[GLOBAL_KEY] = createStore();
  }
  return window[GLOBAL_KEY];
}

function normalizeActivity(id, activity) {
  if (!id || !activity || typeof activity !== "object") return null;
  return {
    ...activity,
    id,
    updatedAtMs: Number.isFinite(activity.updatedAtMs) ? activity.updatedAtMs : Date.now(),
  };
}

function getSnapshot(store = getStore()) {
  return Array.from(store.activities.values()).sort((left, right) => {
    const leftOrder = Number.isFinite(left.order) ? left.order : 0;
    const rightOrder = Number.isFinite(right.order) ? right.order : 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.id).localeCompare(String(right.id));
  });
}

function emitChange(store = getStore()) {
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
      })
    );
  }
}

export function setActivity(id, activity) {
  const store = getStore();
  const normalized = normalizeActivity(id, activity);
  if (!normalized) return;
  store.activities.set(id, normalized);
  emitChange(store);
}

export function clearActivity(id) {
  const store = getStore();
  if (!store.activities.delete(id)) return;
  emitChange(store);
}

export function getActivities() {
  return getSnapshot();
}

export function subscribeActivities(listener) {
  if (typeof listener !== "function") return () => {};
  const store = getStore();
  store.listeners.add(listener);
  listener(getSnapshot(store));
  return () => {
    store.listeners.delete(listener);
  };
}

export function clearAllActivities() {
  const store = getStore();
  if (!store.activities.size) return;
  store.activities.clear();
  emitChange(store);
}
