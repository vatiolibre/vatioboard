export const SHELL_LAYOUT_STORAGE_KEY = "vatioboard.shell.layout.v1";
export const SHELL_LAYOUT_VERSION = 1;

const VALID_STATES = new Set(["closed", "open", "minimized", "hidden"]);
const VALID_ZONES = new Set([
  "left",
  "right",
  "top",
  "bottom",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

const LEGACY_WINDOWS = {
  calculator: {
    posKeys: ["embeddable_calc_pos_v1"],
    visibilityKeys: ["vatioboard.calc_panel.visible_v1", "embeddable_calc_visibility_v1"],
    visibility: "openClosed",
  },
  energy: {
    posKeys: ["energy_calc_pos_v1"],
    visibilityKeys: ["vatioboard.energy_panel.visible_v1", "energy_calc_visibility_v1"],
    visibility: "openClosed",
  },
  player: {
    posKeys: ["player_widget_pos_v1"],
    visibilityKeys: ["player_widget_visible_v1"],
    visibility: "booleanString",
  },
  milkdrop: {
    posKeys: ["milkdrop_panel_pos_v1"],
    visibilityKeys: ["milkdrop_panel_visible_v1"],
    visibility: "booleanString",
  },
};

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBounds(bounds) {
  if (!isObject(bounds)) return null;
  const left = toNumber(bounds.left);
  const top = toNumber(bounds.top);
  if (left === null || top === null) return null;

  const next = { left, top };
  const width = toNumber(bounds.width);
  const height = toNumber(bounds.height);
  if (width !== null && width > 0) next.width = width;
  if (height !== null && height > 0) next.height = height;
  return next;
}

function normalizeSnap(snap) {
  if (!isObject(snap) || !VALID_ZONES.has(snap.zone)) return null;
  const next = { ...snap, zone: snap.zone };
  const ratio = Number(snap.ratio);
  if (Number.isFinite(ratio) && ratio > 0) next.ratio = ratio;
  return next;
}

function normalizeWindowLayout(value) {
  if (!isObject(value)) return null;
  const state = VALID_STATES.has(value.state) ? value.state : null;
  if (!state) return null;

  const previousState = VALID_STATES.has(value.previousState) ? value.previousState : undefined;
  const zIndex = Number.parseInt(String(value.zIndex ?? ""), 10);

  return {
    ...value,
    state,
    ...(previousState ? { previousState } : {}),
    bounds: normalizeBounds(value.bounds),
    restoreBounds: normalizeBounds(value.restoreBounds),
    zIndex: Number.isFinite(zIndex) ? zIndex : 1000,
    minimized: value.minimized === true || state === "minimized",
    snap: normalizeSnap(value.snap),
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now(),
  };
}

export function createEmptyShellLayout(extra = {}) {
  return {
    ...extra,
    version: SHELL_LAYOUT_VERSION,
    activeWindowId: typeof extra.activeWindowId === "string" ? extra.activeWindowId : null,
    windows: isObject(extra.windows) ? extra.windows : {},
  };
}

export function normalizeShellLayout(value) {
  if (!isObject(value)) return createEmptyShellLayout();

  const windows = {};
  if (isObject(value.windows)) {
    for (const [id, record] of Object.entries(value.windows)) {
      if (!id || typeof id !== "string") continue;
      const normalized = normalizeWindowLayout(record);
      if (normalized) windows[id] = normalized;
    }
  }

  const activeWindowId = typeof value.activeWindowId === "string" && windows[value.activeWindowId]
    ? value.activeWindowId
    : null;

  return {
    ...value,
    version: SHELL_LAYOUT_VERSION,
    activeWindowId,
    windows,
  };
}

function readRaw(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function removeRaw(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // best effort only
  }
}

function readJson(storage, key) {
  const raw = readRaw(storage, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    removeRaw(storage, key);
    return null;
  }
}

function getLegacyVisibility(storage, config) {
  for (const key of config.visibilityKeys) {
    const raw = readRaw(storage, key);
    if (raw === null) continue;

    if (config.visibility === "booleanString") {
      if (raw === "true") return "open";
      if (raw === "false") return "closed";
    } else {
      if (raw === "open") return "open";
      if (raw === "closed") return "closed";
    }
  }
  return null;
}

function getLegacyBounds(storage, config) {
  for (const key of config.posKeys) {
    const pos = readJson(storage, key);
    const bounds = normalizeBounds(pos?.panel);
    if (bounds) return bounds;
  }
  return null;
}

export function migrateLegacyShellLayout(options = {}) {
  const storage = safeStorage(options.storage);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const layout = createEmptyShellLayout();
  if (!storage) return layout;

  for (const [id, config] of Object.entries(LEGACY_WINDOWS)) {
    const bounds = getLegacyBounds(storage, config);
    const state = getLegacyVisibility(storage, config);
    if (!bounds && !state) continue;

    layout.windows[id] = {
      state: state || "closed",
      previousState: state || "closed",
      bounds,
      restoreBounds: bounds,
      zIndex: 1000,
      minimized: false,
      snap: null,
      updatedAt: now,
    };
    if (state === "open") layout.activeWindowId = id;
  }

  return layout;
}

export function readShellLayout(options = {}) {
  const storage = safeStorage(options.storage);
  const storageKey = options.storageKey || SHELL_LAYOUT_STORAGE_KEY;
  if (!storage) return createEmptyShellLayout();

  const raw = readRaw(storage, storageKey);
  if (!raw) {
    return options.migrateLegacy === false
      ? createEmptyShellLayout()
      : migrateLegacyShellLayout({ storage, now: options.now });
  }

  try {
    return normalizeShellLayout(JSON.parse(raw));
  } catch {
    removeRaw(storage, storageKey);
    return createEmptyShellLayout();
  }
}

export function writeShellLayout(layout, options = {}) {
  const storage = safeStorage(options.storage);
  const storageKey = options.storageKey || SHELL_LAYOUT_STORAGE_KEY;
  if (!storage) return false;

  try {
    storage.setItem(storageKey, JSON.stringify(normalizeShellLayout(layout)));
    return true;
  } catch {
    return false;
  }
}

export function createShellLayoutStore(options = {}) {
  const storage = safeStorage(options.storage);
  const storageKey = options.storageKey || SHELL_LAYOUT_STORAGE_KEY;
  let pendingLayout = null;
  let microtaskPending = false;
  let timeoutId = 0;

  function cancelPending() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    microtaskPending = false;
    timeoutId = 0;
  }

  function flush() {
    if (!pendingLayout) return false;
    const layout = pendingLayout;
    pendingLayout = null;
    cancelPending();
    return writeShellLayout(layout, { storage, storageKey });
  }

  function scheduleWrite(layout) {
    pendingLayout = normalizeShellLayout(layout);
    if (microtaskPending || timeoutId) return;

    if (typeof queueMicrotask === "function") {
      microtaskPending = true;
      queueMicrotask(() => {
        microtaskPending = false;
        flush();
      });
    } else {
      timeoutId = setTimeout(() => {
        timeoutId = 0;
        flush();
      }, options.debounceMs ?? 32);
    }
  }

  return {
    read() {
      return readShellLayout({ storage, storageKey, migrateLegacy: options.migrateLegacy, now: options.now });
    },
    write(layout) {
      return writeShellLayout(layout, { storage, storageKey });
    },
    scheduleWrite,
    flush,
    destroy() {
      pendingLayout = null;
      cancelPending();
    },
  };
}
