export type DeliveryCameraObjectFit = "cover" | "contain" | "fill" | "none" | "scale-down";

export interface DeliveryCameraRoiSize {
  width: number;
  height: number;
}

export interface DeliveryCameraRoiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeliveryCameraSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface DeliveryCameraObjectPositionInfo {
  raw: string;
  x: string;
  y: string;
  offsetX: number;
  offsetY: number;
}

export interface DeliveryCameraVideoFitInfo {
  sourceWidth: number;
  sourceHeight: number;
  videoRect: DeliveryCameraRoiRect;
  objectFit: DeliveryCameraObjectFit;
  objectPosition: DeliveryCameraObjectPositionInfo;
  mirrored: boolean;
  renderedWidth: number;
  renderedHeight: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface DeliveryCameraRoiMapping {
  sourceRect: DeliveryCameraSourceRect;
  unclampedSourceRect: DeliveryCameraSourceRect;
  overlayRect: DeliveryCameraRoiRect;
  overlayIntersectionRect: DeliveryCameraRoiRect;
  fit: DeliveryCameraVideoFitInfo;
}

export interface DeliveryCameraRoiFrameHint {
  videoRect: DeliveryCameraRoiRect;
  containerRect?: DeliveryCameraRoiRect;
  frameRect: DeliveryCameraRoiRect;
  displaySize?: DeliveryCameraRoiSize;
  sourceSize?: DeliveryCameraRoiSize;
  objectFit: DeliveryCameraObjectFit;
  objectPosition?: string;
  mirrored?: boolean;
  devicePixelRatio?: number;
  orientation?: string;
  trackSettings?: Record<string, unknown>;
  mappedSourceRect?: DeliveryCameraSourceRect;
  unclampedSourceRect?: DeliveryCameraSourceRect;
  fit?: DeliveryCameraVideoFitInfo;
}

export interface CreateDeliveryCameraRoiFrameHintOptions {
  objectFit?: DeliveryCameraObjectFit | string | null;
  objectPosition?: string | null;
  mirrored?: boolean;
}

const HORIZONTAL_KEYWORDS = new Set(["left", "center", "right"]);
const VERTICAL_KEYWORDS = new Set(["top", "center", "bottom"]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readRect(rect: DOMRect | DeliveryCameraRoiRect): DeliveryCameraRoiRect {
  return {
    x: finiteNumber(rect.x),
    y: finiteNumber(rect.y),
    width: Math.max(0, finiteNumber(rect.width)),
    height: Math.max(0, finiteNumber(rect.height)),
  };
}

export function normalizeDeliveryCameraObjectFit(value: unknown): DeliveryCameraObjectFit {
  switch (String(value || "").trim()) {
    case "contain":
      return "contain";
    case "fill":
      return "fill";
    case "none":
      return "none";
    case "scale-down":
      return "scale-down";
    case "cover":
    default:
      return "cover";
  }
}

function tokenIsHorizontal(token: string): boolean {
  return HORIZONTAL_KEYWORDS.has(token.toLowerCase());
}

function tokenIsVertical(token: string): boolean {
  return VERTICAL_KEYWORDS.has(token.toLowerCase());
}

function resolveAxisKeyword(token: string, axis: "x" | "y"): number | null {
  const normalized = token.toLowerCase();
  if (normalized === "center") return 0.5;
  if (axis === "x") {
    if (normalized === "left") return 0;
    if (normalized === "right") return 1;
  } else {
    if (normalized === "top") return 0;
    if (normalized === "bottom") return 1;
  }
  return null;
}

function resolveLength(token: string): number {
  if (!token || token.endsWith("%")) return 0;
  const value = Number.parseFloat(token);
  return Number.isFinite(value) ? value : 0;
}

function resolveSingleAxisPosition(
  token: string | undefined,
  axis: "x" | "y",
  delta: number,
): number {
  if (!token) return delta * 0.5;
  const keyword = resolveAxisKeyword(token, axis);
  if (keyword !== null) return delta * keyword;
  if (token.endsWith("%")) {
    const percent = Number.parseFloat(token);
    return delta * (Number.isFinite(percent) ? percent / 100 : 0.5);
  }
  return resolveLength(token);
}

function resolveEdgeOffset(
  edge: string,
  offsetToken: string | undefined,
  axis: "x" | "y",
  delta: number,
): number {
  const keyword = resolveAxisKeyword(edge, axis);
  if (keyword === null) return resolveSingleAxisPosition(edge, axis, delta);
  const offset = resolveLength(offsetToken || "");
  return (delta * keyword) + (keyword === 1 ? -offset : offset);
}

function parseObjectPosition(
  rawPosition: string | undefined,
  containerWidth: number,
  containerHeight: number,
  renderedWidth: number,
  renderedHeight: number,
): DeliveryCameraObjectPositionInfo {
  const raw = String(rawPosition || "50% 50%").trim() || "50% 50%";
  const tokens = raw.split(/\s+/).filter(Boolean);
  const deltaX = containerWidth - renderedWidth;
  const deltaY = containerHeight - renderedHeight;

  let xToken = tokens[0] || "50%";
  let yToken = tokens.length > 1 ? tokens[1] : "50%";
  let offsetX: number;
  let offsetY: number;

  if (tokens.length >= 3) {
    const horizontalIndex = tokens.findIndex((token) => tokenIsHorizontal(token) && token.toLowerCase() !== "center");
    const verticalIndex = tokens.findIndex((token) => tokenIsVertical(token) && token.toLowerCase() !== "center");
    if (horizontalIndex >= 0) {
      xToken = tokens[horizontalIndex];
      offsetX = resolveEdgeOffset(xToken, tokens[horizontalIndex + 1], "x", deltaX);
    } else {
      offsetX = resolveSingleAxisPosition(xToken, "x", deltaX);
    }
    if (verticalIndex >= 0) {
      yToken = tokens[verticalIndex];
      offsetY = resolveEdgeOffset(yToken, tokens[verticalIndex + 1], "y", deltaY);
    } else {
      offsetY = resolveSingleAxisPosition(yToken, "y", deltaY);
    }
  } else {
    if (tokens.length === 2 && tokenIsVertical(tokens[0]) && tokenIsHorizontal(tokens[1])) {
      xToken = tokens[1];
      yToken = tokens[0];
    }
    offsetX = resolveSingleAxisPosition(xToken, "x", deltaX);
    offsetY = resolveSingleAxisPosition(yToken, "y", deltaY);
  }

  return {
    raw,
    x: xToken,
    y: yToken,
    offsetX,
    offsetY,
  };
}

export function getDeliveryCameraVideoFitInfo({
  sourceWidth,
  sourceHeight,
  videoRect,
  objectFit,
  objectPosition,
  mirrored = false,
}: {
  sourceWidth: number;
  sourceHeight: number;
  videoRect: DeliveryCameraRoiRect | DOMRect;
  objectFit: DeliveryCameraObjectFit | string;
  objectPosition?: string | null;
  mirrored?: boolean;
}): DeliveryCameraVideoFitInfo {
  const fit = normalizeDeliveryCameraObjectFit(objectFit);
  const rect = readRect(videoRect);
  const safeSourceWidth = Math.max(1, finiteNumber(sourceWidth, 1));
  const safeSourceHeight = Math.max(1, finiteNumber(sourceHeight, 1));
  const containerWidth = Math.max(1, rect.width);
  const containerHeight = Math.max(1, rect.height);
  let renderedWidth: number;
  let renderedHeight: number;
  let scaleX: number;
  let scaleY: number;

  if (fit === "fill") {
    renderedWidth = containerWidth;
    renderedHeight = containerHeight;
    scaleX = containerWidth / safeSourceWidth;
    scaleY = containerHeight / safeSourceHeight;
  } else if (fit === "none") {
    renderedWidth = safeSourceWidth;
    renderedHeight = safeSourceHeight;
    scaleX = 1;
    scaleY = 1;
  } else {
    const containScale = Math.min(containerWidth / safeSourceWidth, containerHeight / safeSourceHeight);
    const coverScale = Math.max(containerWidth / safeSourceWidth, containerHeight / safeSourceHeight);
    const scale = fit === "cover" ? coverScale : Math.min(1, containScale);
    scaleX = scale;
    scaleY = scale;
    renderedWidth = safeSourceWidth * scale;
    renderedHeight = safeSourceHeight * scale;
  }

  const position = parseObjectPosition(
    objectPosition || "50% 50%",
    containerWidth,
    containerHeight,
    renderedWidth,
    renderedHeight,
  );

  return {
    sourceWidth: safeSourceWidth,
    sourceHeight: safeSourceHeight,
    videoRect: rect,
    objectFit: fit,
    objectPosition: position,
    mirrored,
    renderedWidth,
    renderedHeight,
    scaleX,
    scaleY,
    offsetX: position.offsetX,
    offsetY: position.offsetY,
  };
}

function intersectRects(
  leftRect: DeliveryCameraRoiRect,
  rightRect: DeliveryCameraRoiRect,
): DeliveryCameraRoiRect | null {
  const left = Math.max(leftRect.x, rightRect.x);
  const top = Math.max(leftRect.y, rightRect.y);
  const right = Math.min(leftRect.x + leftRect.width, rightRect.x + rightRect.width);
  const bottom = Math.min(leftRect.y + leftRect.height, rightRect.y + rightRect.height);
  if (right <= left || bottom <= top) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function clampDeliveryCameraSourceRect(
  rect: DeliveryCameraSourceRect,
  sourceWidth: number,
  sourceHeight: number,
): DeliveryCameraSourceRect | null {
  const safeSourceWidth = Math.max(1, finiteNumber(sourceWidth, 1));
  const safeSourceHeight = Math.max(1, finiteNumber(sourceHeight, 1));
  const left = clamp(rect.sx, 0, safeSourceWidth);
  const top = clamp(rect.sy, 0, safeSourceHeight);
  const right = clamp(rect.sx + rect.sw, 0, safeSourceWidth);
  const bottom = clamp(rect.sy + rect.sh, 0, safeSourceHeight);
  if (right <= left || bottom <= top) return null;
  return {
    sx: left,
    sy: top,
    sw: right - left,
    sh: bottom - top,
  };
}

export function overlayRectToVideoSourceRect({
  sourceWidth,
  sourceHeight,
  videoRect,
  overlayRect,
  objectFit,
  objectPosition,
  mirrored = false,
}: {
  sourceWidth: number;
  sourceHeight: number;
  videoRect: DeliveryCameraRoiRect | DOMRect;
  overlayRect: DeliveryCameraRoiRect | DOMRect;
  objectFit: DeliveryCameraObjectFit | string;
  objectPosition?: string | null;
  mirrored?: boolean;
}): DeliveryCameraRoiMapping | null {
  const fit = getDeliveryCameraVideoFitInfo({
    sourceWidth,
    sourceHeight,
    videoRect,
    objectFit,
    objectPosition,
    mirrored,
  });
  const safeOverlayRect = readRect(overlayRect);
  const intersection = intersectRects(fit.videoRect, safeOverlayRect);
  if (!intersection) return null;

  const relativeX = intersection.x - fit.videoRect.x;
  const relativeY = intersection.y - fit.videoRect.y;
  const sourceX = (relativeX - fit.offsetX) / fit.scaleX;
  const sourceY = (relativeY - fit.offsetY) / fit.scaleY;
  const sourceWidthValue = intersection.width / fit.scaleX;
  const sourceHeightValue = intersection.height / fit.scaleY;
  const unmappedRect = {
    sx: fit.mirrored ? fit.sourceWidth - sourceX - sourceWidthValue : sourceX,
    sy: sourceY,
    sw: sourceWidthValue,
    sh: sourceHeightValue,
  };
  const sourceRect = clampDeliveryCameraSourceRect(unmappedRect, fit.sourceWidth, fit.sourceHeight);
  if (!sourceRect) return null;

  return {
    sourceRect,
    unclampedSourceRect: unmappedRect,
    overlayRect: safeOverlayRect,
    overlayIntersectionRect: intersection,
    fit,
  };
}

function isMirroredTransform(value: string): boolean {
  if (!value || value === "none") return false;
  if (/scaleX\(\s*-1\s*\)/i.test(value)) return true;
  const matrix = value.match(/^matrix\(([^)]+)\)$/i);
  if (matrix) {
    const [a] = matrix[1].split(",").map((part) => Number.parseFloat(part.trim()));
    return Number.isFinite(a) && a < 0;
  }
  const matrix3d = value.match(/^matrix3d\(([^)]+)\)$/i);
  if (matrix3d) {
    const [a] = matrix3d[1].split(",").map((part) => Number.parseFloat(part.trim()));
    return Number.isFinite(a) && a < 0;
  }
  return false;
}

function readTrackSettings(video: HTMLVideoElement): Record<string, unknown> | undefined {
  const source = video.srcObject;
  if (typeof MediaStream === "undefined") return undefined;
  if (!(source instanceof MediaStream)) return undefined;
  const track = source.getVideoTracks?.()[0];
  const settings = track?.getSettings?.();
  if (!settings) return undefined;
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) =>
      value === null
      || ["string", "number", "boolean"].includes(typeof value),
    ),
  );
}

function readOrientation(): string | undefined {
  if (typeof screen !== "undefined" && screen.orientation) {
    const type = screen.orientation.type || "unknown";
    return `${type}:${screen.orientation.angle || 0}`;
  }
  if (typeof window === "undefined") return undefined;
  const orientation = (window as any).orientation;
  return Number.isFinite(orientation) ? `legacy:${orientation}` : undefined;
}

export function createDeliveryCameraRoiFrameHint(
  video: HTMLVideoElement,
  container: HTMLElement,
  overlay: HTMLElement,
  options: CreateDeliveryCameraRoiFrameHintOptions = {},
): DeliveryCameraRoiFrameHint {
  const sourceWidth = Math.round(video.videoWidth || 0);
  const sourceHeight = Math.round(video.videoHeight || 0);
  if (!sourceWidth || !sourceHeight) throw new Error("Video metadata is not ready.");

  const computedStyle = window.getComputedStyle?.(video);
  const objectFit = normalizeDeliveryCameraObjectFit(options.objectFit || computedStyle?.objectFit || "cover");
  const objectPosition = String(options.objectPosition || computedStyle?.objectPosition || "50% 50%").trim() || "50% 50%";
  const transform = `${computedStyle?.transform || ""} ${video.style.transform || ""}`;
  const mirrored = options.mirrored ?? isMirroredTransform(transform);
  const videoRect = readRect(video.getBoundingClientRect());
  const containerRect = readRect(container.getBoundingClientRect());
  const frameRect = readRect(overlay.getBoundingClientRect());
  const mapping = overlayRectToVideoSourceRect({
    sourceWidth,
    sourceHeight,
    videoRect,
    overlayRect: frameRect,
    objectFit,
    objectPosition,
    mirrored,
  });

  return {
    videoRect,
    containerRect,
    frameRect,
    displaySize: {
      width: Math.round(videoRect.width || 0),
      height: Math.round(videoRect.height || 0),
    },
    sourceSize: {
      width: sourceWidth,
      height: sourceHeight,
    },
    objectFit,
    objectPosition,
    mirrored,
    devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : undefined,
    orientation: readOrientation(),
    trackSettings: readTrackSettings(video),
    mappedSourceRect: mapping?.sourceRect,
    unclampedSourceRect: mapping?.unclampedSourceRect,
    fit: mapping?.fit,
  };
}

export function captureDeliveryCameraSourceRectToCanvas(
  video: HTMLVideoElement,
  sourceRect: DeliveryCameraSourceRect,
  outputWidth = Math.round(sourceRect.sw),
  outputHeight = Math.round(sourceRect.sh),
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(outputWidth || sourceRect.sw || 1));
  canvas.height = Math.max(1, Math.round(outputHeight || sourceRect.sh || 1));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context is not available.");
  context.drawImage(
    video,
    sourceRect.sx,
    sourceRect.sy,
    sourceRect.sw,
    sourceRect.sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}
