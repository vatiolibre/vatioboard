export const SHELL_NAMED_LAYOUTS_STORAGE_KEY = "vatioboard.shell.named_layouts.v1";

const NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeName(name) {
  const next = String(name ?? "").trim().slice(0, 48);
  if (!next || !NAME_PATTERN.test(next)) return null;
  return next;
}

function emptyStore() {
  return { version: 1, layouts: {} };
}

function readStore(storage) {
  const target = safeStorage(storage);
  if (!target) return emptyStore();
  try {
    const parsed = JSON.parse(target.getItem(SHELL_NAMED_LAYOUTS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || !parsed.layouts || typeof parsed.layouts !== "object") {
      return emptyStore();
    }
    return { version: 1, layouts: parsed.layouts };
  } catch {
    try {
      target.removeItem(SHELL_NAMED_LAYOUTS_STORAGE_KEY);
    } catch {
      // best effort
    }
    return emptyStore();
  }
}

function writeStore(storage, value) {
  const target = safeStorage(storage);
  if (!target) return false;
  try {
    target.setItem(SHELL_NAMED_LAYOUTS_STORAGE_KEY, JSON.stringify({
      version: 1,
      layouts: value.layouts || {},
    }));
    return true;
  } catch {
    return false;
  }
}

function serializeShellLayout(shellManager) {
  const activeWindowId = shellManager.getActiveWindow()?.id || null;
  const windows = {};
  for (const record of shellManager.listWindows()) {
    windows[record.id] = {
      state: record.state,
      previousState: record.previousState,
      bounds: record.bounds,
      restoreBounds: record.restoreBounds,
      zIndex: record.zIndex,
      minimized: record.minimized,
      snap: record.snap,
      updatedAt: Date.now(),
    };
  }
  return { version: 1, activeWindowId, windows };
}

function applyLayout(layout, shellManager) {
  if (!layout?.windows || typeof layout.windows !== "object") return false;

  for (const [id, record] of Object.entries(layout.windows)) {
    if (!shellManager.getWindow(id)) continue;
    if (record.bounds) {
      shellManager.updateWindowBounds(id, record.bounds, { persist: false, updateRestoreBounds: true });
    }
    if (record.snap?.zone) {
      shellManager.snapWindow(id, record.snap.zone, { ...record.snap, persist: false });
    } else {
      shellManager.unsnapWindow(id, { persist: false });
    }

    if (record.state === "open") {
      shellManager.openWindow(id, { persist: false });
    } else if (record.state === "minimized") {
      shellManager.minimizeWindow(id, { persist: false, invokeLifecycle: false });
    } else {
      shellManager.closeWindow(id, { persist: false, invokeLifecycle: false });
    }
  }

  if (layout.activeWindowId && shellManager.getWindow(layout.activeWindowId)) {
    shellManager.activateWindow(layout.activeWindowId, { persist: false });
  }
  shellManager.persistShellLayout({ flush: true });
  return true;
}

export function saveNamedLayout(name, { shellManager, storage } = {}) {
  const safeName = normalizeName(name);
  if (!safeName || !shellManager) return null;
  const store = readStore(storage);
  const now = Date.now();
  const existing = store.layouts[safeName];
  store.layouts[safeName] = {
    name: safeName,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    layout: serializeShellLayout(shellManager),
  };
  writeStore(storage, store);
  return store.layouts[safeName];
}

export function loadNamedLayout(name, { shellManager, storage } = {}) {
  const safeName = normalizeName(name);
  if (!safeName || !shellManager) return false;
  const entry = readStore(storage).layouts[safeName];
  if (!entry?.layout) return false;
  return applyLayout(entry.layout, shellManager);
}

export function deleteNamedLayout(name, { storage } = {}) {
  const safeName = normalizeName(name);
  if (!safeName) return false;
  const store = readStore(storage);
  if (!store.layouts[safeName]) return false;
  delete store.layouts[safeName];
  return writeStore(storage, store);
}

export function listNamedLayouts({ storage } = {}) {
  return Object.values(readStore(storage).layouts)
    .filter((entry) => entry?.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function renameNamedLayout(oldName, newName, { storage } = {}) {
  const safeOldName = normalizeName(oldName);
  const safeNewName = normalizeName(newName);
  if (!safeOldName || !safeNewName) return false;
  const store = readStore(storage);
  const entry = store.layouts[safeOldName];
  if (!entry) return false;
  delete store.layouts[safeOldName];
  store.layouts[safeNewName] = {
    ...entry,
    name: safeNewName,
    updatedAt: Date.now(),
  };
  return writeStore(storage, store);
}

export function exportNamedLayout(name, { storage } = {}) {
  const safeName = normalizeName(name);
  const entry = safeName ? readStore(storage).layouts[safeName] : null;
  return entry ? JSON.stringify({ version: 1, layout: entry }) : null;
}

export function importNamedLayout(payload, { storage } = {}) {
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const entry = parsed?.layout || parsed;
  const safeName = normalizeName(entry?.name);
  if (!safeName || !entry?.layout?.windows) return null;
  const store = readStore(storage);
  store.layouts[safeName] = {
    name: safeName,
    createdAt: Number(entry.createdAt) || Date.now(),
    updatedAt: Date.now(),
    layout: entry.layout,
  };
  writeStore(storage, store);
  return store.layouts[safeName];
}

