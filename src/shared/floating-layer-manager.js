const FLOATING_PANEL_SELECTOR = "[data-vb-floating-panel]";
const ACTIVE_ATTR = "data-vb-floating-active";
const BASE_Z_INDEX = 1000;
const MAX_Z_INDEX = 1900;

let nextZIndex = BASE_Z_INDEX;
const registrations = new WeakMap();

function isElement(value) {
  return value instanceof Element;
}

function isVisiblePanel(panel) {
  return isElement(panel) && panel.isConnected && !panel.hidden && !panel.hasAttribute("hidden");
}

function readZIndex(panel) {
  const inline = Number.parseInt(panel.style?.zIndex || "", 10);
  if (Number.isFinite(inline)) return inline;

  const computed = Number.parseInt(panel.ownerDocument?.defaultView?.getComputedStyle?.(panel)?.zIndex || "", 10);
  if (Number.isFinite(computed)) return computed;

  return BASE_Z_INDEX;
}

function getVisiblePanels(root = document) {
  return Array.from(root.querySelectorAll?.(FLOATING_PANEL_SELECTOR) || [])
    .filter(isVisiblePanel);
}

function setActivePanel(panel) {
  const scope = panel.ownerDocument || document;
  for (const candidate of getVisiblePanels(scope)) {
    candidate.setAttribute(ACTIVE_ATTR, candidate === panel ? "true" : "false");
  }
}

function prepareZIndex(root = document) {
  if (nextZIndex < MAX_Z_INDEX) return;
  compactFloatingPanelZOrder(root);
}

export function compactFloatingPanelZOrder(root = document) {
  const visiblePanels = getVisiblePanels(root)
    .map((panel, index) => ({ panel, index, zIndex: readZIndex(panel) }))
    .sort((a, b) => (a.zIndex - b.zIndex) || (a.index - b.index));

  visiblePanels.forEach(({ panel }, index) => {
    panel.style.zIndex = String(Math.min(BASE_Z_INDEX + index, MAX_Z_INDEX));
  });

  const highestZIndex = visiblePanels.length > 0
    ? Math.min(BASE_Z_INDEX + visiblePanels.length - 1, MAX_Z_INDEX)
    : BASE_Z_INDEX;
  nextZIndex = Math.min(highestZIndex + 1, MAX_Z_INDEX);
}

export function bringFloatingPanelToFront(panelEl) {
  if (!isElement(panelEl)) return;

  panelEl.setAttribute("data-vb-floating-panel", "");
  prepareZIndex(panelEl.ownerDocument || document);
  nextZIndex = Math.min(nextZIndex + 1, MAX_Z_INDEX);
  panelEl.style.zIndex = String(nextZIndex);
  setActivePanel(panelEl);
}

export function registerFloatingPanel(panelEl, options = {}) {
  if (!isElement(panelEl)) return () => {};

  const existing = registrations.get(panelEl);
  if (existing) {
    existing.count += 1;
    return () => {
      existing.count -= 1;
      if (existing.count <= 0) {
        existing.cleanup();
        registrations.delete(panelEl);
      }
    };
  }

  panelEl.setAttribute("data-vb-floating-panel", "");

  const activate = () => {
    if (!options.disabled && isVisiblePanel(panelEl)) {
      bringFloatingPanelToFront(panelEl);
    }
  };

  panelEl.addEventListener("pointerdown", activate, true);
  panelEl.addEventListener("focusin", activate, true);

  const cleanup = () => {
    panelEl.removeEventListener("pointerdown", activate, true);
    panelEl.removeEventListener("focusin", activate, true);
    panelEl.removeAttribute(ACTIVE_ATTR);
  };

  registrations.set(panelEl, { cleanup, count: 1 });
  return () => {
    const current = registrations.get(panelEl);
    if (!current) return;
    current.count -= 1;
    if (current.count <= 0) {
      current.cleanup();
      registrations.delete(panelEl);
    }
  };
}

