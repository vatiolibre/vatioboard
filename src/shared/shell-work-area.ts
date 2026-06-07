const DEFAULT_MARGIN = 16;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 260;

// TODO(ts-migration): narrow this legacy option bag once all shell callers are TS.
type LegacyWorkAreaOptions = Record<string, any>;

interface RectLike {
  left: number;
  top: number;
  right?: number;
  bottom?: number;
  width: number;
  height: number;
}

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hasDom() {
  return typeof document !== "undefined";
}

function getRootDocument(root: Document | Element | null | undefined) {
  if (!hasDom()) return null;
  return root?.ownerDocument || root || document;
}

function isElement(value: unknown): value is HTMLElement {
  return Boolean((value as Element | null)?.nodeType === 1);
}

function isHidden(element: unknown) {
  if (!isElement(element)) return true;
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;
  return false;
}

function getRect(element: Element): RectLike | null {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return null;
  const width = numberOr(rect.width, numberOr(rect.right, 0) - numberOr(rect.left, 0));
  const height = numberOr(rect.height, numberOr(rect.bottom, 0) - numberOr(rect.top, 0));
  if (width <= 0 || height <= 0) return null;
  return {
    left: numberOr(rect.left, 0),
    top: numberOr(rect.top, 0),
    right: numberOr(rect.right, numberOr(rect.left, 0) + width),
    bottom: numberOr(rect.bottom, numberOr(rect.top, 0) + height),
    width,
    height,
  };
}

function isShellSurface(element: Element) {
  return Boolean(element?.closest?.([
    "[data-vb-shell-window]",
    "[data-vb-floating-panel]",
    "[data-vb-shell-taskbar]",
    "[data-vb-shell-taskbar-item]",
    "[data-vb-shell-drag-layer]",
    "[data-vb-shell-taskbar-trash]",
    "#appStartMenuList",
    ".vb-confirm-backdrop",
    ".maplibregl-control-container",
    ".maplibregl-ctrl",
  ].join(",")));
}

function collectElements(root: ParentNode | null | undefined, selector: string): Element[] {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

function getToolbarRects(root: Document | Element | null | undefined, viewport: RectLike) {
  const doc = getRootDocument(root);
  if (!doc) return [];
  const explicit = collectElements(doc, "[data-vb-shell-toolbar], [data-vb-app-toolbar]");
  const fixedCandidates = collectElements(doc, "header, [role='banner'], [role='toolbar'], .toolbar")
    .filter((element) => {
      if (explicit.includes(element)) return true;
      const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
      if (!["fixed", "sticky"].includes(style?.position)) return false;
      return numberOr(style?.top, 0) <= 4;
    });
  const candidates = [...new Set([...explicit, ...fixedCandidates])];
  return candidates
    .filter((element) => !isHidden(element) && !isShellSurface(element))
    .map(getRect)
    .filter(Boolean)
    .filter((rect) => rect.bottom > viewport.top && rect.top < viewport.top + Math.max(180, viewport.height * 0.33));
}

function getTaskbarRects(root: Document | Element | null | undefined) {
  const doc = getRootDocument(root);
  if (!doc) return [];
  return collectElements(doc, "[data-vb-shell-taskbar]:not([hidden])")
    .filter((element) => !isHidden(element))
    .map((element) => ({ element, rect: getRect(element) }))
    .filter((entry) => entry.rect);
}

function isBottomTaskbar({ element, rect }: { element: Element; rect: RectLike }, viewport: RectLike) {
  const position = element.getAttribute("data-vb-shell-taskbar-position")
    || element.closest?.("[data-vb-shell-taskbar-position]")?.getAttribute?.("data-vb-shell-taskbar-position")
    || "bottom";
  if (element.classList?.contains("is-detached")) return false;
  if (position !== "bottom") return false;
  return rect.bottom >= viewport.top + viewport.height - Math.max(96, rect.height * 1.5);
}

export function getViewportRect(viewport: LegacyWorkAreaOptions = {}) {
  const visualViewport = globalThis.visualViewport;
  const width = numberOr(viewport.width ?? viewport.viewportWidth, numberOr(visualViewport?.width, globalThis.innerWidth || 1024));
  const height = numberOr(viewport.height ?? viewport.viewportHeight, numberOr(visualViewport?.height, globalThis.innerHeight || 768));
  return {
    left: numberOr(viewport.left, numberOr(visualViewport?.offsetLeft, 0)),
    top: numberOr(viewport.top, numberOr(visualViewport?.offsetTop, 0)),
    width,
    height,
  };
}

export function getShellChromeRects(options: LegacyWorkAreaOptions = {}) {
  const viewport = getViewportRect(options.viewport);
  return {
    viewport,
    toolbars: getToolbarRects(options.root, viewport),
    taskbars: options.includeTaskbar === false ? [] : getTaskbarRects(options.root),
  };
}

export function getShellWorkArea(options: LegacyWorkAreaOptions = {}) {
  const viewport = getViewportRect(options.viewport);
  if (options.fullscreen === true) return viewport;

  const margin = numberOr(options.safeMargin ?? options.margin, DEFAULT_MARGIN);
  const chrome = getShellChromeRects({ ...options, viewport });
  const toolbarBottom = chrome.toolbars.reduce((bottom, rect) => Math.max(bottom, rect.bottom), viewport.top);
  const taskbarTop = chrome.taskbars
    .filter((entry) => isBottomTaskbar(entry, viewport))
    .reduce((top, entry) => Math.min(top, entry.rect.top), viewport.top + viewport.height);

  const left = viewport.left + margin;
  const top = Math.max(viewport.top + margin, toolbarBottom > viewport.top ? toolbarBottom + margin : viewport.top + margin);
  const right = viewport.left + viewport.width - margin;
  const bottom = Math.min(viewport.top + viewport.height - margin, taskbarTop < viewport.top + viewport.height ? taskbarTop - margin : viewport.top + viewport.height - margin);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function clampBoundsToWorkArea(bounds: LegacyWorkAreaOptions, options: LegacyWorkAreaOptions = {}) {
  const area = options.workArea || getShellWorkArea(options);
  const current = options.currentBounds || {};
  const source = { ...current, ...(bounds || {}) };
  const minWidth = positiveNumberOr(options.minWidth, 1);
  const minHeight = positiveNumberOr(options.minHeight, 1);
  const maxWidth = Math.max(minWidth, positiveNumberOr(options.maxWidth, area.width));
  const maxHeight = Math.max(minHeight, positiveNumberOr(options.maxHeight, area.height));
  const widthLimit = Math.min(maxWidth, Math.max(minWidth, area.width));
  const heightLimit = Math.min(maxHeight, Math.max(minHeight, area.height));
  const requestedWidth = numberOr(source.width, numberOr(options.defaultWidth, DEFAULT_WIDTH));
  const requestedHeight = numberOr(source.height, numberOr(options.defaultHeight, DEFAULT_HEIGHT));
  const width = Math.max(minWidth, Math.min(requestedWidth, widthLimit));
  const height = Math.max(minHeight, Math.min(requestedHeight, heightLimit));
  const minLeft = width > area.width ? area.left + area.width - width : area.left;
  const minTop = height > area.height ? area.top + area.height - height : area.top;
  const maxLeft = width > area.width ? area.left : area.left + area.width - width;
  const maxTop = height > area.height ? area.top : area.top + area.height - height;
  const sourceTop = numberOr(source.top, minTop);
  const visibleBottomInset = Math.max(0, Math.min(height - 1, numberOr(options.visibleBottomInset, 0)));
  const visibleBottomTop = area.top + area.height - height + visibleBottomInset;
  const preferredTop = options.preferVisibleBottom === true && height > area.height
    ? Math.min(sourceTop, visibleBottomTop)
    : sourceTop;
  const clamped: LegacyWorkAreaOptions = {
    left: clampNumber(numberOr(source.left, minLeft), minLeft, maxLeft),
    top: clampNumber(preferredTop, minTop, maxTop),
  };
  const hasWidth = source.width !== undefined || options.forceSize === true;
  const hasHeight = source.height !== undefined || options.forceSize === true;
  if (hasWidth) clamped.width = width;
  if (hasHeight) clamped.height = height;
  return clamped;
}
