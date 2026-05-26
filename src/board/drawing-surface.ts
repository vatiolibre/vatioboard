type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type ViewportMeasureOptions = {
  doc?: Document;
  win?: Window & typeof globalThis;
};

type DrawableSurfaceOptions = ViewportMeasureOptions & {
  canvas?: Element | null;
  frame?: Element | null;
};

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstPositiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number > 0) return number;
  }
  return 0;
}

function readRect(element: Element | null | undefined): RectLike | null {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const left = finiteNumber(rect.left);
  const top = finiteNumber(rect.top);
  const width = Math.max(0, finiteNumber(rect.width));
  const height = Math.max(0, finiteNumber(rect.height));

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function hasUsableRect(rect: RectLike | null): boolean {
  return Boolean(rect && (rect.width > 0 || rect.height > 0));
}

export function measureVisibleViewport({
  doc = globalThis.document,
  win = globalThis.window,
}: ViewportMeasureOptions = {}): RectLike {
  const viewport = win?.visualViewport;
  const root = doc?.documentElement;
  const width = firstPositiveNumber(viewport?.width, win?.innerWidth, root?.clientWidth);
  const height = firstPositiveNumber(viewport?.height, win?.innerHeight, root?.clientHeight);

  return {
    left: finiteNumber(viewport?.offsetLeft),
    top: finiteNumber(viewport?.offsetTop),
    width,
    height,
    right: finiteNumber(viewport?.offsetLeft) + width,
    bottom: finiteNumber(viewport?.offsetTop) + height,
  };
}

export function measureDrawableSurface({
  canvas,
  frame = null,
  doc = globalThis.document,
  win = globalThis.window,
}: DrawableSurfaceOptions = {}): RectLike {
  const canvasRect = readRect(canvas);
  const frameRect = readRect(frame);
  const originRect = hasUsableRect(canvasRect) ? canvasRect : frameRect;

  if (!originRect) {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
    };
  }

  const viewport = measureVisibleViewport({ doc, win });
  const width = Math.max(originRect.width, finiteNumber(frameRect?.width), finiteNumber(canvasRect?.width));
  const height = Math.max(0, viewport.bottom - originRect.top);

  return {
    left: originRect.left,
    top: originRect.top,
    width,
    height,
    right: originRect.left + width,
    bottom: originRect.top + height,
  };
}

export function pointFromPointerEvent(event: PointerEvent | MouseEvent | TouchEvent | null | undefined, surface: Partial<RectLike> | null | undefined) {
  return {
    x: finiteNumber((event as PointerEvent | MouseEvent | undefined)?.clientX) - finiteNumber(surface?.left),
    y: finiteNumber((event as PointerEvent | MouseEvent | undefined)?.clientY) - finiteNumber(surface?.top),
  };
}
