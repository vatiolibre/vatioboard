function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const closest = target.closest?.("input, textarea, select, [contenteditable='true'], .calc-expr");
  return Boolean(closest);
}

function isBackquoteShortcut(event) {
  return (event.altKey || event.ctrlKey)
    && !event.metaKey
    && (event.code === "Backquote" || event.key === "`");
}

function getCycleWindows(shellManager, { includeMinimized = false } = {}) {
  return shellManager.listWindows()
    .filter((record) => record.kind !== "system")
    .filter((record) => record.state === "open" || (includeMinimized && record.state === "minimized"))
    .filter((record) => includeMinimized || !record.element?.hidden)
    .sort((a, b) => (b.zIndex - a.zIndex) || String(a.id).localeCompare(String(b.id)));
}

export function installShellKeyboardShortcuts({
  shellManager,
  target = window,
  restoreMinimizedOnCycle = false,
} = {}) {
  if (!shellManager) throw new Error("installShellKeyboardShortcuts requires a shellManager.");

  let destroyed = false;

  function activateRecord(record) {
    if (!record) return null;
    if (record.state === "minimized") return shellManager.restoreWindow(record.id);
    return shellManager.activateWindow(record.id);
  }

  function cycle(delta) {
    const windows = getCycleWindows(shellManager, { includeMinimized: restoreMinimizedOnCycle });
    if (windows.length === 0) return null;
    const activeId = shellManager.getActiveWindow()?.id;
    const activeIndex = Math.max(0, windows.findIndex((record) => record.id === activeId));
    const nextIndex = activeId
      ? (activeIndex + delta + windows.length) % windows.length
      : 0;
    return activateRecord(windows[nextIndex]);
  }

  function cycleNextWindow() {
    return cycle(1);
  }

  function cyclePreviousWindow() {
    return cycle(-1);
  }

  function minimizeActiveWindow() {
    const active = shellManager.getActiveWindow();
    if (!active || active.capabilities?.minimizable === false) return null;
    return shellManager.minimizeWindow(active.id);
  }

  function restoreMostRecentMinimizedWindow() {
    const minimized = shellManager.listWindows()
      .filter((record) => record.state === "minimized")
      .sort((a, b) => (b.zIndex - a.zIndex) || String(a.id).localeCompare(String(b.id)));
    if (!minimized[0]) return null;
    return shellManager.restoreWindow(minimized[0].id);
  }

  function clearSnapPreviews() {
    const previews = Array.from(document.querySelectorAll("[data-vb-shell-snap-preview]"));
    previews.forEach((panel) => {
      panel.removeAttribute("data-vb-shell-snap-preview");
      panel.removeAttribute("data-vb-shell-snap-zone");
    });
    return previews.length > 0;
  }

  function onKeyDown(event) {
    if (isEditableTarget(event.target)) return;

    if (isBackquoteShortcut(event)) {
      event.preventDefault();
      if (event.shiftKey) {
        cyclePreviousWindow();
      } else {
        cycleNextWindow();
      }
      return;
    }

    if (event.key === "Escape") {
      if (clearSnapPreviews()) event.preventDefault();
      return;
    }

    if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key?.toLowerCase?.() === "m") {
      const handled = minimizeActiveWindow();
      if (handled) event.preventDefault();
      return;
    }

    if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key?.toLowerCase?.() === "r") {
      const handled = restoreMostRecentMinimizedWindow();
      if (handled) event.preventDefault();
    }
  }

  target.addEventListener("keydown", onKeyDown);

  return {
    uninstall() {
      if (destroyed) return;
      destroyed = true;
      target.removeEventListener("keydown", onKeyDown);
    },
    cycleNextWindow,
    cyclePreviousWindow,
  };
}

