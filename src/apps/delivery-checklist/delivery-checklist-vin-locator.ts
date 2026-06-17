export type VinTextMaskVariant =
  | "grayscale"
  | "min-channel"
  | "neutral-bright"
  | "min-channel-high-pass";

export interface VinLocatorImageDataLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface VinTextMask {
  width: number;
  height: number;
  data: Uint8Array;
  variant: VinTextMaskVariant;
  threshold: number;
}

export interface VinTextBand {
  y: number;
  height: number;
  score: number;
  peak: number;
  ink: number;
}

export interface VinConnectedComponent {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
  density: number;
  aspectRatio: number;
  qrLike: boolean;
}

export interface VinCandidateWindow {
  x: number;
  width: number;
  pitch: number;
  right: number;
  score: number;
  activeSlots: number;
  slotInk: number[];
  gapDensity: number;
  qrPenalty: number;
}

export interface VinLocatorCandidateSummary {
  x: number;
  y: number;
  width: number;
  height: number;
  pitch: number;
  score: number;
  activeSlots: number;
  gapDensity: number;
  qrPenalty: number;
}

export interface VinLocatorDebugSummary {
  maskVariant: VinTextMaskVariant;
  threshold: number;
  textBand: VinTextBand;
  selectedCrop: VinLocatorRect;
  candidates: VinLocatorCandidateSummary[];
  rejectedComponents: VinConnectedComponent[];
}

export interface VinLocatorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VinLocatorResult {
  mask: VinTextMask;
  textBand: VinTextBand;
  selected: VinCandidateWindow;
  crop: VinLocatorRect;
  candidates: VinCandidateWindow[];
  components: VinConnectedComponent[];
}

export interface VinLocatorOptions {
  variants?: VinTextMaskVariant[];
  maxBands?: number;
  maxCandidates?: number;
  minScore?: number;
}

const DEFAULT_MASK_VARIANTS: VinTextMaskVariant[] = [
  "min-channel-high-pass",
  "neutral-bright",
  "min-channel",
  "grayscale",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampByte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

function percentile(values: Uint8ClampedArray, ratio: number): number {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  const target = Math.max(0, Math.min(values.length - 1, Math.floor(values.length * ratio)));
  let count = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value];
    if (count > target) return value;
  }
  return 255;
}

function smooth(values: ArrayLike<number>, radius: number): Float64Array {
  const output = new Float64Array(values.length);
  const safeRadius = Math.max(0, Math.round(radius));
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
      const sample = index + offset;
      if (sample < 0 || sample >= values.length) continue;
      sum += Number(values[sample]) || 0;
      count += 1;
    }
    output[index] = sum / Math.max(1, count);
  }
  return output;
}

function createBoxMean(values: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += values[((y - 1) * width) + (x - 1)];
      integral[(y * (width + 1)) + x] = integral[((y - 1) * (width + 1)) + x] + rowSum;
    }
  }

  const output = new Uint8ClampedArray(values.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = Math.max(1, (right - left + 1) * (bottom - top + 1));
      const sum = integral[((bottom + 1) * (width + 1)) + (right + 1)]
        - integral[(top * (width + 1)) + (right + 1)]
        - integral[((bottom + 1) * (width + 1)) + left]
        + integral[(top * (width + 1)) + left];
      output[(y * width) + x] = clampByte(sum / area);
    }
  }
  return output;
}

export function generateTextLikelihoodMask(
  image: VinLocatorImageDataLike,
  variant: VinTextMaskVariant = "min-channel-high-pass",
): VinTextMask {
  const width = Math.max(1, Math.round(image.width || 0));
  const height = Math.max(1, Math.round(image.height || 0));
  const data = image.data;
  const scores = new Uint8ClampedArray(width * height);
  const minChannel = new Uint8ClampedArray(width * height);
  const spread = new Uint8ClampedArray(width * height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3] ?? 255;
    if (alpha <= 12) continue;
    const red = data[offset] || 0;
    const green = data[offset + 1] || 0;
    const blue = data[offset + 2] || 0;
    const minRgb = Math.min(red, green, blue);
    const maxRgb = Math.max(red, green, blue);
    const gray = Math.round((red * 0.299) + (green * 0.587) + (blue * 0.114));
    minChannel[pixel] = minRgb;
    spread[pixel] = maxRgb - minRgb;

    if (variant === "grayscale") {
      scores[pixel] = gray;
    } else if (variant === "min-channel") {
      scores[pixel] = minRgb;
    } else if (variant === "neutral-bright") {
      scores[pixel] = clampByte(minRgb - Math.max(0, spread[pixel] - 58) * 2);
    } else {
      scores[pixel] = minRgb;
    }
  }

  if (variant === "min-channel-high-pass") {
    const radius = Math.max(7, Math.round(Math.min(width, height) / 16));
    const background = createBoxMean(minChannel, width, height, radius);
    for (let index = 0; index < scores.length; index += 1) {
      const highPass = minChannel[index] - background[index];
      scores[index] = clampByte((highPass + 30) * 3 + minChannel[index] * 0.26);
    }
  }

  const threshold = Math.max(
    variant === "min-channel-high-pass" ? 72 : 104,
    Math.min(226, percentile(scores, variant === "neutral-bright" ? 0.82 : 0.86)),
  );
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < scores.length; index += 1) {
    if (scores[index] < threshold) continue;
    if (variant === "neutral-bright" && (minChannel[index] < 88 || spread[index] > 112)) continue;
    if (variant === "min-channel-high-pass" && minChannel[index] < 56) continue;
    mask[index] = 1;
  }

  return {
    width,
    height,
    data: mask,
    variant,
    threshold,
  };
}

export function rowProjection(mask: VinTextMask): Uint32Array {
  const projection = new Uint32Array(mask.height);
  for (let y = 0; y < mask.height; y += 1) {
    let count = 0;
    const offset = y * mask.width;
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[offset + x]) count += 1;
    }
    projection[y] = count;
  }
  return projection;
}

export function findTextBands(mask: VinTextMask, maxBands = 3): VinTextBand[] {
  const projection = rowProjection(mask);
  const smoothed = smooth(projection, Math.max(1, Math.round(mask.height * 0.012)));
  let peak = 0;
  for (const value of smoothed) peak = Math.max(peak, value);
  if (peak <= 0) return [];

  const threshold = Math.max(2, Math.min(mask.width * 0.18, peak * 0.24));
  const minHeight = Math.max(8, Math.round(mask.height * 0.14));
  const maxHeight = Math.max(minHeight + 1, Math.round(mask.height * 0.58));
  const runs: VinTextBand[] = [];
  let start = -1;
  let runPeak = 0;
  let ink = 0;

  const closeRun = (end: number): void => {
    if (start < 0) return;
    const height = end - start + 1;
    if (height >= minHeight && height <= maxHeight) {
      const density = ink / Math.max(1, height * mask.width);
      runs.push({
        y: start,
        height,
        peak: runPeak,
        ink,
        score: (runPeak / Math.max(1, mask.width)) + density * 4 + Math.min(1, height / Math.max(1, mask.height * 0.18)),
      });
    }
    start = -1;
    runPeak = 0;
    ink = 0;
  };

  for (let y = 0; y < mask.height; y += 1) {
    if (smoothed[y] >= threshold) {
      if (start < 0) start = y;
      runPeak = Math.max(runPeak, smoothed[y]);
      ink += projection[y];
    } else {
      closeRun(y - 1);
    }
  }
  closeRun(mask.height - 1);

  return runs
    .sort((left, right) => right.score - left.score || left.y - right.y)
    .slice(0, Math.max(1, maxBands));
}

export function verticalProjection(mask: VinTextMask, band: VinTextBand): Uint32Array {
  const projection = new Uint32Array(mask.width);
  const top = clamp(Math.round(band.y), 0, mask.height - 1);
  const bottom = clamp(Math.round(band.y + band.height), top + 1, mask.height);
  for (let y = top; y < bottom; y += 1) {
    const offset = y * mask.width;
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[offset + x]) projection[x] += 1;
    }
  }
  return projection;
}

export function findConnectedComponents(
  mask: VinTextMask,
  bounds: Partial<VinLocatorRect> = {},
): VinConnectedComponent[] {
  const left = clamp(Math.round(bounds.x ?? 0), 0, mask.width - 1);
  const top = clamp(Math.round(bounds.y ?? 0), 0, mask.height - 1);
  const right = clamp(Math.round((bounds.x ?? 0) + (bounds.width ?? mask.width)), left + 1, mask.width);
  const bottom = clamp(Math.round((bounds.y ?? 0) + (bounds.height ?? mask.height)), top + 1, mask.height);
  const visited = new Uint8Array(mask.width * mask.height);
  const stack = new Int32Array(mask.width * mask.height);
  const components: VinConnectedComponent[] = [];

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const startIndex = (y * mask.width) + x;
      if (!mask.data[startIndex] || visited[startIndex]) continue;

      let stackLength = 0;
      let pixels = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      visited[startIndex] = 1;
      stack[stackLength] = startIndex;
      stackLength += 1;

      while (stackLength > 0) {
        stackLength -= 1;
        const index = stack[stackLength];
        const currentX = index % mask.width;
        const currentY = Math.floor(index / mask.width);
        pixels += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        const neighbors = [
          currentX > left ? index - 1 : -1,
          currentX + 1 < right ? index + 1 : -1,
          currentY > top ? index - mask.width : -1,
          currentY + 1 < bottom ? index + mask.width : -1,
        ];
        for (const neighbor of neighbors) {
          if (neighbor < 0 || visited[neighbor] || !mask.data[neighbor]) continue;
          visited[neighbor] = 1;
          stack[stackLength] = neighbor;
          stackLength += 1;
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const density = pixels / Math.max(1, width * height);
      const aspectRatio = width / Math.max(1, height);
      const area = width * height;
      const qrLike = density >= 0.18
        && aspectRatio >= 0.72
        && aspectRatio <= 1.38
        && area >= Math.max(520, ((bottom - top) ** 2) * 0.55)
        && width >= Math.max(10, (bottom - top) * 0.58)
        && height >= Math.max(10, (bottom - top) * 0.58);
      components.push({
        x: minX,
        y: minY,
        width,
        height,
        pixels,
        density,
        aspectRatio,
        qrLike,
      });
    }
  }

  return components;
}

export function rejectQrLikeComponents(components: VinConnectedComponent[]): VinConnectedComponent[] {
  return components.filter((component) => component.qrLike);
}

function projectionPrefix(projection: Uint32Array): Uint32Array {
  const prefix = new Uint32Array(projection.length + 1);
  for (let index = 0; index < projection.length; index += 1) {
    prefix[index + 1] = prefix[index] + projection[index];
  }
  return prefix;
}

function sumProjection(prefix: Uint32Array, left: number, right: number): number {
  const safeLeft = clamp(Math.floor(left), 0, prefix.length - 1);
  const safeRight = clamp(Math.ceil(right), safeLeft, prefix.length - 1);
  return prefix[safeRight] - prefix[safeLeft];
}

function intersectsX(component: VinConnectedComponent, left: number, right: number): boolean {
  return component.x < right && component.x + component.width > left;
}

export function scoreVinCandidateWindow(
  mask: VinTextMask,
  band: VinTextBand,
  candidate: Pick<VinCandidateWindow, "x" | "width" | "pitch" | "right">,
  components: VinConnectedComponent[] = findConnectedComponents(mask, { y: band.y, height: band.height }),
  projection = verticalProjection(mask, band),
): VinCandidateWindow {
  const pitch = Math.max(1, candidate.pitch);
  const slotWidth = Math.max(2, pitch * 0.62);
  const prefix = projectionPrefix(projection);
  const slotInk: number[] = [];
  let activeSlots = 0;
  let slotDensitySum = 0;
  let gapInk = 0;
  let gapArea = 0;

  for (let slot = 0; slot < 17; slot += 1) {
    const center = candidate.x + (slot + 0.5) * pitch;
    const left = center - slotWidth / 2;
    const right = center + slotWidth / 2;
    const ink = sumProjection(prefix, left, right);
    const density = ink / Math.max(1, slotWidth * band.height);
    slotInk.push(density);
    slotDensitySum += density;
    if (density >= 0.028) activeSlots += 1;

    if (slot < 16) {
      const gapLeft = right;
      const gapRight = candidate.x + (slot + 1.5) * pitch - slotWidth / 2;
      gapInk += sumProjection(prefix, gapLeft, gapRight);
      gapArea += Math.max(1, gapRight - gapLeft) * band.height;
    }
  }

  const meanSlotDensity = slotDensitySum / 17;
  let variance = 0;
  for (const density of slotInk) variance += (density - meanSlotDensity) ** 2;
  variance /= 17;
  const regularity = Math.max(0, 1 - (Math.sqrt(variance) / Math.max(0.01, meanSlotDensity))) * 5;
  const gapDensity = gapInk / Math.max(1, gapArea);
  let qrPenalty = 0;
  const left = candidate.x;
  const right = candidate.x + candidate.width;

  for (const component of components) {
    if (!intersectsX(component, left, right)) continue;
    const largeForCharacter = component.width > pitch * 1.35 || component.height > band.height * 0.9;
    if (component.qrLike) qrPenalty += 8 + component.density * 8;
    if (largeForCharacter && component.density > 0.12) qrPenalty += 3;
  }

  const boundaryPenalty = (candidate.x < 0 || right > mask.width) ? 18 : 0;
  const rightBoundaryInk = sumProjection(prefix, right - pitch * 0.18, right + pitch * 0.25)
    / Math.max(1, pitch * 0.43 * band.height);
  const widthRatio = candidate.width / Math.max(1, mask.width);
  const startRatio = candidate.x / Math.max(1, mask.width);
  const shortWindowPenalty = widthRatio < 0.52 ? (0.52 - widthRatio) * 26 : 0;
  const leftNoisePenalty = widthRatio > 0.62 && startRatio < 0.12 ? (0.12 - startRatio) * 90 : 0;
  const rightEdgePenalty = widthRatio > 0.72 && right > mask.width - pitch * 0.35
    ? 2 + (widthRatio - 0.72) * 28
    : 0;
  const score = (activeSlots * 1.75)
    + (meanSlotDensity * 34)
    + regularity
    + Math.min(4, rightBoundaryInk * 10)
    + Math.min(10, widthRatio * 11)
    - (gapDensity * 24)
    - qrPenalty
    - shortWindowPenalty
    - leftNoisePenalty
    - rightEdgePenalty
    - boundaryPenalty;

  return {
    ...candidate,
    score,
    activeSlots,
    slotInk,
    gapDensity,
    qrPenalty,
  };
}

function findColumnRuns(projection: Uint32Array, bandHeight: number): Array<{ start: number; end: number; peak: number }> {
  const smoothed = smooth(projection, 2);
  let peak = 0;
  for (const value of smoothed) peak = Math.max(peak, value);
  if (peak <= 0) return [];
  const threshold = Math.max(1, Math.min(bandHeight * 0.22, peak * 0.16));
  const runs: Array<{ start: number; end: number; peak: number }> = [];
  let start = -1;
  let runPeak = 0;
  for (let x = 0; x < smoothed.length; x += 1) {
    if (smoothed[x] >= threshold) {
      if (start < 0) start = x;
      runPeak = Math.max(runPeak, smoothed[x]);
    } else if (start >= 0) {
      if (x - start >= 1) runs.push({ start, end: x - 1, peak: runPeak });
      start = -1;
      runPeak = 0;
    }
  }
  if (start >= 0) runs.push({ start, end: smoothed.length - 1, peak: runPeak });
  return runs;
}

export function locateVinRightToLeft(
  mask: VinTextMask,
  band: VinTextBand,
  maxCandidates = 8,
): VinCandidateWindow[] {
  const projection = verticalProjection(mask, band);
  const components = findConnectedComponents(mask, { y: band.y, height: band.height });
  const characterComponents = components
    .filter((component) =>
      component.pixels >= 12
      && component.height >= Math.max(4, band.height * 0.38)
      && component.width <= Math.max(8, band.height * 2.35)
      && component.x + component.width >= mask.width * 0.08,
    )
    .sort((left, right) => left.x - right.x || left.y - right.y);
  const runs = findColumnRuns(projection, band.height)
    .filter((run) => run.end >= mask.width * 0.36)
    .sort((left, right) => right.end - left.end || right.peak - left.peak)
    .slice(0, 10);
  if (!runs.length) return [];

  const pitchMin = Math.max(6, Math.round(band.height * 0.28));
  const pitchMax = Math.max(
    pitchMin + 2,
    Math.min(mask.width / 8.2, Math.max(band.height * 2.15, mask.width / 13)),
  );
  const pitchStep = Math.max(1, Math.round((pitchMax - pitchMin) / 42));
  const candidates: VinCandidateWindow[] = [];

  for (const run of runs) {
    for (let pitch = pitchMin; pitch <= pitchMax; pitch += pitchStep) {
      const rightOffsets = [-0.12, 0, 0.12].map((offset) => offset * pitch);
      for (const offset of rightOffsets) {
        const right = run.end + 1 + offset;
        const width = pitch * 17;
        if (width < mask.width * 0.32) continue;
        const x = right - width;
        const scored = scoreVinCandidateWindow(mask, band, { x, width, pitch, right }, components, projection);
        if (scored.activeSlots < 10) continue;
        candidates.push(scored);
      }
    }
  }

  for (let endIndex = characterComponents.length - 1; endIndex >= 0; endIndex -= 1) {
    const end = characterComponents[endIndex];
    const spanRight = end.x + end.width;
    if (spanRight < mask.width * 0.42) continue;
    const minCount = Math.min(17, endIndex + 1);
    const maxCount = Math.min(23, endIndex + 1);
    for (let count = minCount; count <= maxCount; count += 1) {
      const start = characterComponents[endIndex - count + 1];
      if (!start) continue;
      const spanLeft = start.x;
      const span = spanRight - spanLeft;
      const pitch = span / 17;
      if (pitch < pitchMin || pitch > pitchMax) continue;
      const width = pitch * 17;
      if (width < mask.width * 0.32) continue;
      const scored = scoreVinCandidateWindow(
        mask,
        band,
        { x: spanRight - width, width, pitch, right: spanRight },
        components,
        projection,
      );
      if (scored.activeSlots < 11) continue;
      candidates.push({
        ...scored,
        score: scored.score + Math.min(12, 4 + count / 3),
      });
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score || right.activeSlots - left.activeSlots)
    .slice(0, Math.max(1, maxCandidates));
}

export function createPaddedVinCrop(
  mask: VinTextMask,
  band: VinTextBand,
  candidate: VinCandidateWindow,
): VinLocatorRect {
  const leftPadding = Math.max(3, Math.round(candidate.pitch * 0.36));
  const rightPaddingRatio = candidate.pitch >= 16 ? 1.05 : 0.72;
  const rightPadding = Math.max(3, Math.round(candidate.pitch * rightPaddingRatio));
  const topPadding = Math.max(6, Math.round(band.height * 0.62));
  const bottomPadding = Math.max(12, Math.round(band.height * 2.45));
  const rejectedLeftBlockRight = rejectQrLikeComponents(findConnectedComponents(mask, { y: band.y, height: band.height }))
    .filter((component) =>
      component.x < candidate.x
      && component.x + component.width <= candidate.x + candidate.pitch * 0.55,
    )
    .reduce((right, component) => Math.max(right, component.x + component.width), -Infinity);
  const cropLeft = Math.max(
    candidate.x - leftPadding,
    Number.isFinite(rejectedLeftBlockRight)
      ? rejectedLeftBlockRight + Math.max(2, Math.round(candidate.pitch * 0.08))
      : -Infinity,
  );
  const x = clamp(Math.round(cropLeft), 0, mask.width - 1);
  const y = clamp(Math.round(band.y - topPadding), 0, mask.height - 1);
  const right = clamp(Math.round(candidate.x + candidate.width + rightPadding), x + 1, mask.width);
  const bottom = clamp(Math.round(band.y + band.height + bottomPadding), y + 1, mask.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function locateVinInImageData(
  image: VinLocatorImageDataLike,
  options: VinLocatorOptions = {},
): VinLocatorResult[] {
  const variants = options.variants?.length ? options.variants : DEFAULT_MASK_VARIANTS;
  const maxBands = Math.max(1, options.maxBands || 3);
  const maxCandidates = Math.max(1, options.maxCandidates || 4);
  const minScore = options.minScore ?? 18;
  const results: VinLocatorResult[] = [];

  for (const variant of variants) {
    const mask = generateTextLikelihoodMask(image, variant);
    for (const textBand of findTextBands(mask, maxBands)) {
      const candidates = locateVinRightToLeft(mask, textBand, maxCandidates);
      const components = findConnectedComponents(mask, { y: textBand.y, height: textBand.height });
      for (const selected of candidates) {
        if (selected.score < minScore) continue;
        const crop = createPaddedVinCrop(mask, textBand, selected);
        results.push({
          mask,
          textBand,
          selected,
          crop,
          candidates,
          components,
        });
      }
    }
  }

  return results
    .sort((left, right) => right.selected.score - left.selected.score)
    .slice(0, maxCandidates);
}

export function summarizeVinLocatorResult(result: VinLocatorResult): VinLocatorDebugSummary {
  const toCandidateSummary = (candidate: VinCandidateWindow): VinLocatorCandidateSummary => ({
    x: Math.round(candidate.x),
    y: result.textBand.y,
    width: Math.round(candidate.width),
    height: result.textBand.height,
    pitch: Math.round(candidate.pitch * 100) / 100,
    score: Math.round(candidate.score * 100) / 100,
    activeSlots: candidate.activeSlots,
    gapDensity: Math.round(candidate.gapDensity * 1000) / 1000,
    qrPenalty: Math.round(candidate.qrPenalty * 100) / 100,
  });

  return {
    maskVariant: result.mask.variant,
    threshold: result.mask.threshold,
    textBand: result.textBand,
    selectedCrop: result.crop,
    candidates: result.candidates.slice(0, 6).map(toCandidateSummary),
    rejectedComponents: rejectQrLikeComponents(result.components),
  };
}
