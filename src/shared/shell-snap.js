const SNAP_ZONES = new Set([
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

const DEFAULT_MARGIN = 16;
const SMALL_VIEWPORT_WIDTH = 560;
const SMALL_VIEWPORT_HEIGHT = 460;

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeViewport(viewport = {}) {
  const width = numberOr(viewport.width ?? viewport.viewportWidth, globalThis.innerWidth || 1024);
  const height = numberOr(viewport.height ?? viewport.viewportHeight, globalThis.innerHeight || 768);
  return {
    left: numberOr(viewport.left, 0),
    top: numberOr(viewport.top, 0),
    width,
    height,
  };
}

function getSafeMargin(options = {}) {
  return numberOr(options.safeMargin ?? options.margin, DEFAULT_MARGIN);
}

function isSmallViewport(viewport) {
  return viewport.width < SMALL_VIEWPORT_WIDTH || viewport.height < SMALL_VIEWPORT_HEIGHT;
}

export function getSnapZoneForPointer({
  x,
  y,
  viewportWidth,
  viewportHeight,
  thresholdPx = 32,
} = {}) {
  const width = numberOr(viewportWidth, globalThis.innerWidth || 1024);
  const height = numberOr(viewportHeight, globalThis.innerHeight || 768);
  const threshold = numberOr(thresholdPx, 32);
  const px = numberOr(x, width / 2);
  const py = numberOr(y, height / 2);

  const nearLeft = px <= threshold;
  const nearRight = px >= width - threshold;
  const nearTop = py <= threshold;
  const nearBottom = py >= height - threshold;

  if (width >= SMALL_VIEWPORT_WIDTH && height >= SMALL_VIEWPORT_HEIGHT) {
    if (nearLeft && nearTop) return "top-left";
    if (nearRight && nearTop) return "top-right";
    if (nearLeft && nearBottom) return "bottom-left";
    if (nearRight && nearBottom) return "bottom-right";
  }

  if (nearLeft) return "left";
  if (nearRight) return "right";
  if (nearTop) return "top";
  if (nearBottom) return "bottom";
  return "center";
}

export function clampBoundsToViewport(bounds, viewport, options = {}) {
  const vp = normalizeViewport(viewport);
  const margin = getSafeMargin(options);
  const width = Math.max(1, Math.min(numberOr(bounds?.width, 360), vp.width - (margin * 2)));
  const height = Math.max(1, Math.min(numberOr(bounds?.height, 260), vp.height - (margin * 2)));
  const minLeft = vp.left + margin;
  const minTop = vp.top + margin;
  const maxLeft = Math.max(minLeft, vp.left + vp.width - width - margin);
  const maxTop = Math.max(minTop, vp.top + vp.height - height - margin);

  return {
    left: Math.min(maxLeft, Math.max(minLeft, numberOr(bounds?.left, minLeft))),
    top: Math.min(maxTop, Math.max(minTop, numberOr(bounds?.top, minTop))),
    width,
    height,
  };
}

export function normalizeBoundsToViewport(bounds, viewport, options = {}) {
  const vp = normalizeViewport(viewport);
  const margin = getSafeMargin(options);
  const width = numberOr(bounds?.width, Math.min(420, vp.width - (margin * 2)));
  const height = numberOr(bounds?.height, Math.min(320, vp.height - (margin * 2)));
  const left = numberOr(bounds?.left, vp.left + Math.max(margin, (vp.width - width) / 2));
  const top = numberOr(bounds?.top, vp.top + Math.max(margin, (vp.height - height) / 2));
  return clampBoundsToViewport({ left, top, width, height }, vp, { safeMargin: margin });
}

export function getBoundsForSnapZone(zone, viewport, options = {}) {
  const vp = normalizeViewport(viewport);
  const margin = getSafeMargin(options);
  const safeWidth = Math.max(1, vp.width - (margin * 2));
  const safeHeight = Math.max(1, vp.height - (margin * 2));
  const left = vp.left + margin;
  const top = vp.top + margin;
  const safe = { left, top, width: safeWidth, height: safeHeight };
  const normalizedZone = SNAP_ZONES.has(zone) ? zone : "center";

  if (isSmallViewport(vp)) {
    const width = Math.min(numberOr(options.defaultWidth, 420), safeWidth);
    const height = Math.min(numberOr(options.defaultHeight, 320), safeHeight);
    if (normalizedZone === "center" || normalizedZone.includes("-")) {
      return normalizeBoundsToViewport({ width, height }, vp, { safeMargin: margin });
    }
    return safe;
  }

  const halfWidth = Math.round(safeWidth / 2);
  const halfHeight = Math.round(safeHeight / 2);

  switch (normalizedZone) {
    case "left":
      return { left, top, width: halfWidth, height: safeHeight };
    case "right":
      return { left: left + safeWidth - halfWidth, top, width: halfWidth, height: safeHeight };
    case "top":
      return { left, top, width: safeWidth, height: halfHeight };
    case "bottom":
      return { left, top: top + safeHeight - halfHeight, width: safeWidth, height: halfHeight };
    case "top-left":
      return { left, top, width: halfWidth, height: halfHeight };
    case "top-right":
      return { left: left + safeWidth - halfWidth, top, width: halfWidth, height: halfHeight };
    case "bottom-left":
      return { left, top: top + safeHeight - halfHeight, width: halfWidth, height: halfHeight };
    case "bottom-right":
      return {
        left: left + safeWidth - halfWidth,
        top: top + safeHeight - halfHeight,
        width: halfWidth,
        height: halfHeight,
      };
    case "center":
    default:
      return normalizeBoundsToViewport({
        width: numberOr(options.defaultWidth, Math.min(420, safeWidth)),
        height: numberOr(options.defaultHeight, Math.min(320, safeHeight)),
      }, vp, { safeMargin: margin });
  }
}

export function applySnapPreview(panelEl, zone) {
  if (!panelEl) return;
  const normalizedZone = SNAP_ZONES.has(zone) ? zone : "center";
  panelEl.setAttribute("data-vb-shell-snap-preview", normalizedZone);
  panelEl.setAttribute("data-vb-shell-snap-zone", normalizedZone);
}

export function clearSnapPreview(panelEl) {
  panelEl?.removeAttribute?.("data-vb-shell-snap-preview");
  panelEl?.removeAttribute?.("data-vb-shell-snap-zone");
}
