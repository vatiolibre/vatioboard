import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calculateDeliveryVinCropLayout,
  calculateDeliveryVinCropStateForSourceRegion,
  calculateDeliveryVinOcrRegion,
  clampDeliveryVinCropState,
  compareDeliveryWindshieldVin,
  createDeliveryVinCropCanvas,
  createDeliveryVinFramedVideoSnapshot,
  createDeliveryVinManualCropRegions,
  createDeliveryVinOcrAttemptPlan,
  createDeliveryVinOcrRegions,
  createDeliveryVinOcrSearchRegions,
  createDeliveryVinTextRegion,
  createDeliveryVinValueRegion,
  createDeliveryVinVideoSnapshot,
  extractDeliveryVinFromOcrText,
  extractDeliveryVinFromQrPayload,
  findDeliveryVinOcrCandidates,
  isValidDeliveryVinCheckDigit,
  mapDeliveryVinFrameHintToSourceRegion,
  normalizeDeliveryVin,
  recognizeDeliveryVinFromImageSource,
  startDeliveryVinOcrScanner,
  terminateDeliveryVinOcrWorker,
} from "../../src/apps/delivery-checklist/delivery-checklist-vin-scanner.js";
import {
  findConnectedComponents,
  findTextBands,
  generateTextLikelihoodMask,
  createPaddedVinCrop,
  locateVinRightToLeft,
  rejectQrLikeComponents,
  scoreVinCandidateWindow,
} from "../../src/apps/delivery-checklist/delivery-checklist-vin-locator.js";
import {
  getDeliveryCameraVideoFitInfo,
  overlayRectToVideoSourceRect,
} from "../../src/apps/delivery-checklist/delivery-checklist-camera-roi.js";

const tesseractMock = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  setParameters: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  OEM: {
    LSTM_ONLY: "lstm-only",
  },
  PSM: {
    SINGLE_LINE: "single-line",
  },
  createWorker: tesseractMock.createWorker,
}));

function createMockCanvasContext() {
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x, _y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    lineWidth: 1,
    font: "",
    textBaseline: "",
    strokeStyle: "",
    fillStyle: "",
  };
}

function createSyntheticMask(width, height) {
  return {
    width,
    height,
    data: new Uint8Array(width * height),
    variant: "min-channel-high-pass",
    threshold: 128,
  };
}

function fillMaskRect(mask, x, y, width, height) {
  for (let row = Math.max(0, y); row < Math.min(mask.height, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(mask.width, x + width); column += 1) {
      mask.data[(row * mask.width) + column] = 1;
    }
  }
}

function expectSourceRectClose(rect, expected) {
  expect(rect.sx).toBeCloseTo(expected.sx, 3);
  expect(rect.sy).toBeCloseTo(expected.sy, 3);
  expect(rect.sw).toBeCloseTo(expected.sw, 3);
  expect(rect.sh).toBeCloseTo(expected.sh, 3);
}

function createSyntheticVinMask({ includeQr = true, irregular = false } = {}) {
  const mask = createSyntheticMask(260, 72);
  if (includeQr) fillMaskRect(mask, 12, 19, 30, 30);
  const top = 18;
  const pitch = 11;
  const start = irregular ? 28 : 58;
  for (let index = 0; index < 17; index += 1) {
    const x = Math.round(start + index * pitch + (pitch - 4) / 2);
    fillMaskRect(mask, x, top, irregular && index < 3 ? 8 : 4, 28);
  }
  return mask;
}

describe("delivery checklist VIN scanner helpers", () => {
  beforeEach(() => {
    tesseractMock.createWorker.mockReset();
    tesseractMock.recognize.mockReset();
    tesseractMock.setParameters.mockReset();
    tesseractMock.terminate.mockReset();
    tesseractMock.createWorker.mockResolvedValue({
      setParameters: tesseractMock.setParameters,
      recognize: tesseractMock.recognize,
      terminate: tesseractMock.terminate,
    });
  });

  afterEach(async () => {
    await terminateDeliveryVinOcrWorker();
    vi.restoreAllMocks();
  });

  it("normalizes VIN values and preserves legacy QR VIN extraction", () => {
    expect(normalizeDeliveryVin(" 7saygaee3rf178432 ")).toBe("7SAYGAEE3RF178432");
    expect(normalizeDeliveryVin("5YJYGDIEOQRF000001")).toBe("5YJYGDERF000001");

    expect(extractDeliveryVinFromQrPayload("tesla://delivery?vin=5yjygdee0rf000001")).toBe("5YJYGDEE0RF000001");
    expect(extractDeliveryVinFromQrPayload("not-a-vin")).toBe("");
  });

  it("validates VIN check digits and extracts a valid VIN from noisy OCR text", () => {
    expect(isValidDeliveryVinCheckDigit("7SAYGAEE3RF178432")).toBe(true);
    expect(isValidDeliveryVinCheckDigit("7SAYGAEE0RF178432")).toBe(false);

    expect(extractDeliveryVinFromOcrText("YEZ7SAYGAEE3RF178432")).toBe("7SAYGAEE3RF178432");
    expect(extractDeliveryVinFromOcrText("Tesla 7SAYGAEE3RFI78432")).toBe("7SAYGAEE3RF178432");
    expect(extractDeliveryVinFromOcrText("ZSAYGAEE3RF178432")).toBe("7SAYGAEE3RF178432");
    expect(extractDeliveryVinFromOcrText("TSAYGAEESRF178432")).toBe("");
    expect(extractDeliveryVinFromOcrText("TSAYGREESRF178432")).toBe("");
    expect(extractDeliveryVinFromOcrText("SAVGAEERF178432303")).toBe("");
    expect(extractDeliveryVinFromOcrText("5YJYGDEE0RF000001")).toBe("");

    expect(findDeliveryVinOcrCandidates("YEZ7SAYGAEE3RF178432")[0]).toBe("7SAYGAEE3RF178432");
    expect(findDeliveryVinOcrCandidates("ZSAYGAEE3RF178432")[0]).toBe("7SAYGAEE3RF178432");
    expect(findDeliveryVinOcrCandidates("TSAYGAEESRF178432", {
      allowComputedCheckDigitRepair: true,
    })[0]).toBe("7SAYGAEE3RF178432");
    expect(findDeliveryVinOcrCandidates("TSAYGREESRF178432", {
      allowComputedCheckDigitRepair: true,
    })).toEqual([]);
  });

  it("compares scanned windshield VINs based on the selected setup mode", () => {
    expect(compareDeliveryWindshieldVin({}, "choice")).toMatchObject({
      state: "not-scanned",
      scannedVin: "",
    });

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "7SAYGAEE3RF178432",
      vin: "5YJYGDEE0RF000001",
    }, "manual")).toMatchObject({
      state: "manual",
      scannedVin: "7SAYGAEE3RF178432",
      backendVin: "5YJYGDEE0RF000001",
    });

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "7SAYGAEE3RF178432",
      vin: "7saygaee3rf178432",
    }, "vatiolibre").state).toBe("match");

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "7SAYGAEE3RF178432",
      vin: "5YJYGDEE0RF000001",
    }, "vatiolibre").state).toBe("mismatch");

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "7SAYGAEE3RF178432",
    }, "vatiolibre").state).toBe("backend-unavailable");
  });

  it("generates a neutral text-likelihood mask that suppresses colorful reflections", () => {
    const width = 12;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      data[offset] = 35;
      data[offset + 1] = 170;
      data[offset + 2] = 45;
      data[offset + 3] = 255;
    }
    for (let y = 1; y <= 2; y += 1) {
      for (let x = 7; x <= 9; x += 1) {
        const offset = ((y * width) + x) * 4;
        data[offset] = 230;
        data[offset + 1] = 232;
        data[offset + 2] = 226;
      }
    }

    const mask = generateTextLikelihoodMask({ width, height, data }, "neutral-bright");

    expect(mask.data[(1 * width) + 8]).toBe(1);
    expect(mask.data[(1 * width) + 2]).toBe(0);
  });

  it("selects the horizontal VIN text band from a binary text mask", () => {
    const mask = createSyntheticMask(180, 80);
    for (let index = 0; index < 17; index += 1) {
      fillMaskRect(mask, 20 + index * 8, 30, 3, 22);
    }
    fillMaskRect(mask, 16, 4, 4, 4);
    fillMaskRect(mask, 146, 70, 4, 4);

    const [band] = findTextBands(mask, 2);

    expect(band.y).toBeGreaterThanOrEqual(28);
    expect(band.y + band.height).toBeLessThanOrEqual(54);
    expect(band.score).toBeGreaterThan(0);
  });

  it("rejects QR-like square components before scoring VIN candidates", () => {
    const mask = createSyntheticVinMask();
    const [band] = findTextBands(mask, 1);
    const components = findConnectedComponents(mask, { y: band.y, height: band.height });
    const rejected = rejectQrLikeComponents(components);

    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0]).toMatchObject({
      x: 12,
      width: 30,
      qrLike: true,
    });
  });

  it("scores the regular right-to-left 17-slot candidate above a QR-contaminated window", () => {
    const mask = createSyntheticVinMask();
    const [band] = findTextBands(mask, 1);
    const components = findConnectedComponents(mask, { y: band.y, height: band.height });
    const [regular] = locateVinRightToLeft(mask, band, 4);
    const contaminated = scoreVinCandidateWindow(
      mask,
      band,
      { x: 12, width: 17 * 11, pitch: 11, right: 12 + 17 * 11 },
      components,
    );

    expect(regular.activeSlots).toBe(17);
    expect(contaminated.qrPenalty).toBeGreaterThan(0);
    expect(regular.score).toBeGreaterThan(contaminated.score + 4);
  });

  it("locates a right-to-left VIN crop that excludes the left QR/DataMatrix block", () => {
    const mask = createSyntheticVinMask();
    const [band] = findTextBands(mask, 1);
    const [candidate] = locateVinRightToLeft(mask, band, 4);
    const crop = createPaddedVinCrop(mask, band, candidate);

    expect(candidate.activeSlots).toBe(17);
    expect(crop.x).toBeGreaterThan(42);
    expect(crop.x + crop.width).toBeGreaterThan(238);
  });

  it("calculates wide horizontal OCR scan regions", () => {
    expect(calculateDeliveryVinOcrRegion(1920, 1080)).toEqual({
      x: 135,
      y: 335,
      width: 1651,
      height: 194,
      role: "full-band",
      regionSource: "fallback",
    });

    expect(createDeliveryVinOcrSearchRegions(768, 1024).map((region) => region.y)).toEqual([
      95,
      136,
      177,
      218,
      259,
      300,
      361,
      443,
      525,
      607,
    ]);

    expect(createDeliveryVinTextRegion({
      x: 90,
      y: 259,
      width: 1101,
      height: 173,
      role: "full-band",
    }, 1280)).toEqual({
      x: 244,
      y: 259,
      width: 903,
      height: 173,
      role: "vin-text",
      regionSource: undefined,
    });

    const frameThenSearch = createDeliveryVinOcrRegions(768, 1024, { mode: "frame-then-search" });
    expect(frameThenSearch[0].role).toBe("vin-text");
    expect(frameThenSearch[1]).toEqual(calculateDeliveryVinOcrRegion(768, 1024));
    expect(frameThenSearch.map((region) => region.y)).toEqual([
      341,
      341,
      95,
      95,
      136,
      136,
      177,
      177,
      218,
      218,
      259,
      259,
      300,
      300,
      361,
      361,
      443,
      443,
      525,
      525,
      607,
      607,
    ]);
  });

  it("clamps VIN crop pan and zoom and renders a manual crop canvas", () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const layout = calculateDeliveryVinCropLayout(2000, 1000, 960, 200, {
      x: 9999,
      y: -9999,
      scale: 2,
    });
    const clamped = clampDeliveryVinCropState(2000, 1000, 960, 200, {
      x: 9999,
      y: -9999,
      scale: 3.5,
    });
    const source = document.createElement("canvas");
    source.width = 2000;
    source.height = 1000;
    const result = createDeliveryVinCropCanvas(source, {
      crop: { x: 64, y: -24, scale: 1.4 },
      width: 960,
      height: 200,
    });
    const regions = createDeliveryVinManualCropRegions(result.canvas.width, result.canvas.height);

    expect(layout).toMatchObject({
      offsetX: 480,
      offsetY: -380,
      scale: 2,
    });
    expect(clamped.scale).toBe(2.8);
    expect(clamped.x).toBeLessThanOrEqual(864);
    expect(result.canvas.width).toBe(960);
    expect(result.canvas.height).toBe(200);
    expect(result.crop).toMatchObject({ x: 64, y: -24, scale: 1.4 });
    expect(context.drawImage).toHaveBeenCalledWith(source, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
    expect(regions).toEqual([
      { x: 0, y: 0, width: 960, height: 200, role: "vin-text", regionSource: "manual-crop" },
      { x: 0, y: 0, width: 960, height: 200, role: "full-band", regionSource: "manual-crop" },
    ]);
  });

  it("snapshots a video frame into a stable canvas for crop editing", () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });

    const snapshot = createDeliveryVinVideoSnapshot(video);

    expect(snapshot.width).toBe(1280);
    expect(snapshot.height).toBe(720);
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
  });

  it("snapshots the yellow scanner frame from object-fit cover video into the crop editor alignment", () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1080 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1920 });
    const frameHint = {
      videoRect: { x: 0, y: 0, width: 374, height: 665 },
      frameRect: { x: 22, y: 132, width: 329, height: 69 },
      displaySize: { width: 374, height: 665 },
      objectFit: "cover",
    };

    const snapshot = createDeliveryVinFramedVideoSnapshot(video, frameHint);

    expect(snapshot.frameRegion).toEqual({
      x: 64,
      y: 381,
      width: 950,
      height: 199,
      role: "full-band",
      regionSource: "mapped-frame",
    });
    expect(snapshot.sourceRegion).toMatchObject({
      x: 0,
      y: 368,
      width: 1080,
      height: 225,
      regionSource: "mapped-frame-expanded",
    });
    expect(snapshot.canvas.width).toBe(1080);
    expect(snapshot.canvas.height).toBe(225);
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 368, 1080, 225, 0, 0, 1080, 225);
    expect(snapshot.crop.scale).toBeGreaterThan(1);

    const focusedLayout = calculateDeliveryVinCropLayout(1080, 225, 960, 200, snapshot.crop);
    const drawScale = Math.max(960 / 1080, 200 / 225) * snapshot.crop.scale;
    const frameCenterX = focusedLayout.x + ((snapshot.frameRegion.x - snapshot.sourceRegion.x + (snapshot.frameRegion.width / 2)) * drawScale);
    const frameCenterY = focusedLayout.y + ((snapshot.frameRegion.y - snapshot.sourceRegion.y + (snapshot.frameRegion.height / 2)) * drawScale);
    expect(frameCenterX).toBeCloseTo(480, 0);
    expect(frameCenterY).toBeCloseTo(100, 0);
  });

  it("calculates a crop state that centers a source sub-region in the VIN crop box", () => {
    const crop = calculateDeliveryVinCropStateForSourceRegion(1080, 225, 960, 200, {
      x: 64,
      y: 13,
      width: 950,
      height: 199,
    });
    const layout = calculateDeliveryVinCropLayout(1080, 225, 960, 200, crop);
    const drawScale = Math.max(960 / 1080, 200 / 225) * crop.scale;

    expect(crop.scale).toBeGreaterThan(1);
    expect(layout.x + ((64 + 475) * drawScale)).toBeCloseTo(480, 0);
    expect(layout.y + ((13 + 99.5) * drawScale)).toBeCloseTo(100, 0);
  });

  it("maps the visible scanner frame to source pixels for iPhone object-fit cover video", () => {
    const frameHint = {
      videoRect: { x: 0, y: 0, width: 374, height: 665 },
      frameRect: { x: 22, y: 132, width: 329, height: 69 },
      displaySize: { width: 374, height: 665 },
      objectFit: "cover",
    };

    expect(mapDeliveryVinFrameHintToSourceRegion(1080, 1920, frameHint)).toEqual({
      x: 64,
      y: 381,
      width: 950,
      height: 199,
      role: "full-band",
      regionSource: "mapped-frame",
    });

    const regions = createDeliveryVinOcrRegions(1080, 1920, {
      mode: "frame-then-search",
      frameHint,
    });
    expect(regions.slice(0, 4).map((region) => region.regionSource)).toEqual([
      "mapped-frame",
      "mapped-frame",
      "mapped-frame-expanded",
      "mapped-frame-expanded",
    ]);
    expect(regions[0]).toMatchObject({
      role: "vin-text",
      regionSource: "mapped-frame",
    });
  });

  it("maps letterboxed object-fit contain video from overlay pixels to source pixels", () => {
    const mapping = overlayRectToVideoSourceRect({
      sourceWidth: 1920,
      sourceHeight: 1080,
      videoRect: { x: 0, y: 0, width: 400, height: 400 },
      overlayRect: { x: 100, y: 150, width: 200, height: 50 },
      objectFit: "contain",
      objectPosition: "50% 50%",
    });

    expect(mapping).not.toBeNull();
    expectSourceRectClose(mapping.sourceRect, {
      sx: 480,
      sy: 300,
      sw: 960,
      sh: 240,
    });
    expect(mapping.fit).toMatchObject({
      objectFit: "contain",
      renderedWidth: 400,
      renderedHeight: 225,
      offsetY: 87.5,
    });
  });

  it("maps fill, object-position, mirrored, and clipped overlay ROI variants", () => {
    const fillMapping = overlayRectToVideoSourceRect({
      sourceWidth: 1000,
      sourceHeight: 500,
      videoRect: { x: 0, y: 0, width: 400, height: 400 },
      overlayRect: { x: 100, y: 100, width: 200, height: 100 },
      objectFit: "fill",
    });
    const positionedMapping = overlayRectToVideoSourceRect({
      sourceWidth: 1000,
      sourceHeight: 500,
      videoRect: { x: 0, y: 0, width: 300, height: 300 },
      overlayRect: { x: 0, y: 120, width: 150, height: 60 },
      objectFit: "cover",
      objectPosition: "right bottom",
    });
    const mirroredMapping = overlayRectToVideoSourceRect({
      sourceWidth: 1000,
      sourceHeight: 500,
      videoRect: { x: 0, y: 0, width: 500, height: 250 },
      overlayRect: { x: 50, y: 25, width: 100, height: 50 },
      objectFit: "cover",
      mirrored: true,
    });
    const clippedMapping = overlayRectToVideoSourceRect({
      sourceWidth: 1000,
      sourceHeight: 500,
      videoRect: { x: 0, y: 0, width: 500, height: 250 },
      overlayRect: { x: -50, y: 0, width: 150, height: 50 },
      objectFit: "cover",
    });

    expectSourceRectClose(fillMapping.sourceRect, {
      sx: 250,
      sy: 125,
      sw: 500,
      sh: 125,
    });
    expectSourceRectClose(positionedMapping.sourceRect, {
      sx: 500,
      sy: 200,
      sw: 250,
      sh: 100,
    });
    expectSourceRectClose(mirroredMapping.sourceRect, {
      sx: 700,
      sy: 50,
      sw: 200,
      sh: 100,
    });
    expectSourceRectClose(clippedMapping.sourceRect, {
      sx: 0,
      sy: 0,
      sw: 200,
      sh: 100,
    });
  });

  it("keeps fit info tied to the capture-time video rect for responsive resizes", () => {
    const initialFit = getDeliveryCameraVideoFitInfo({
      sourceWidth: 1280,
      sourceHeight: 720,
      videoRect: { x: 0, y: 0, width: 640, height: 360 },
      objectFit: "cover",
    });
    const resizedFit = getDeliveryCameraVideoFitInfo({
      sourceWidth: 1280,
      sourceHeight: 720,
      videoRect: { x: 0, y: 0, width: 360, height: 640 },
      objectFit: "cover",
    });

    expect(initialFit.renderedWidth).toBe(640);
    expect(initialFit.renderedHeight).toBe(360);
    expect(resizedFit.renderedWidth).toBeCloseTo(1137.778, 3);
    expect(resizedFit.offsetX).toBeCloseTo(-388.889, 3);
  });

  it("maps a smaller mobile VIN target while preserving expanded crop context", () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1080 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1920 });
    const frameHint = {
      videoRect: { x: 0, y: 0, width: 374, height: 665 },
      frameRect: { x: 71, y: 142, width: 232, height: 48 },
      displaySize: { width: 374, height: 665 },
      objectFit: "cover",
    };

    expect(mapDeliveryVinFrameHintToSourceRegion(1080, 1920, frameHint)).toEqual({
      x: 205,
      y: 410,
      width: 670,
      height: 139,
      role: "full-band",
      regionSource: "mapped-frame",
    });

    const snapshot = createDeliveryVinFramedVideoSnapshot(video, frameHint);

    expect(snapshot.sourceRegion).toMatchObject({
      x: 88,
      y: 385,
      width: 904,
      height: 189,
      regionSource: "mapped-frame-expanded",
    });
    expect(snapshot.canvas.width).toBe(904);
    expect(snapshot.canvas.height).toBe(189);
    expect(context.drawImage).toHaveBeenCalledWith(video, 88, 385, 904, 189, 0, 0, 904, 189);
    expect(snapshot.sourceRegion?.width).toBeGreaterThan(snapshot.frameRegion?.width || 0);
    expect(snapshot.sourceRegion?.height).toBeGreaterThan(snapshot.frameRegion?.height || 0);
  });

  it("plans Safari-friendly OCR attempts before expensive processed variants", () => {
    const frameHint = {
      videoRect: { x: 0, y: 0, width: 574, height: 323 },
      frameRect: { x: 44, y: 54, width: 492, height: 76 },
      displaySize: { width: 574, height: 323 },
      objectFit: "cover",
    };
    const regions = createDeliveryVinOcrRegions(1920, 1080, {
      mode: "frame-then-search",
      frameHint,
    });
    const plan = createDeliveryVinOcrAttemptPlan(regions, 1920, 1080, "canvas");
    const firstAdaptiveIndex = plan.findIndex((entry) => entry.variant === "adaptive-inverted");
    const upperFallbackRawIndex = plan.findIndex((entry) =>
      entry.variant === "raw-gray"
      && entry.region.role === "vin-text"
      && entry.region.regionSource === "fallback"
      && Math.abs(((entry.region.y + (entry.region.height / 2)) / 1080) - 0.32) < 0.02,
    );

    expect(plan[0]).toMatchObject({
      variant: "sharpen",
      pass: "fast",
      region: expect.objectContaining({
        role: "full-band",
        regionSource: "fallback",
      }),
    });
    expect(upperFallbackRawIndex).toBeGreaterThan(0);
    expect(firstAdaptiveIndex).toBeGreaterThan(upperFallbackRawIndex);
  });

  it("creates a VIN value crop without replacing existing fallback regions", () => {
    const full = calculateDeliveryVinOcrRegion(1920, 1080, 0.32);
    const text = createDeliveryVinTextRegion(full, 1920);
    const value = createDeliveryVinValueRegion(full, 1920);
    const regions = createDeliveryVinOcrRegions(1920, 1080, { mode: "frame-then-search" });
    const plan = createDeliveryVinOcrAttemptPlan(regions, 1920, 1080, "canvas");

    expect(value).toMatchObject({
      role: "vin-value",
      regionSource: "fallback",
    });
    expect(value.x).toBeGreaterThan(text.x);
    expect(value.width).toBeLessThan(text.width);
    expect(regions.some((region) => region.role === "full-band" && region.regionSource === "fallback")).toBe(true);
    expect(regions.some((region) => region.role === "vin-text" && region.regionSource === "fallback")).toBe(true);
    expect(plan.some((entry) => entry.region.role === "vin-value" && entry.region.regionSource === "fallback")).toBe(true);
  });

  it("plans deterministic locator crops before fallback OCR regions", () => {
    const locatorRegion = {
      x: 54,
      y: 48,
      width: 430,
      height: 70,
      role: "vin-value",
      regionSource: "locator",
    };
    const fallback = calculateDeliveryVinOcrRegion(960, 200, 0.5);
    const plan = createDeliveryVinOcrAttemptPlan([fallback, locatorRegion], 960, 200, "canvas");

    expect(plan[0]).toMatchObject({
      variant: "min-channel-high-pass-gray",
      pass: "locator",
      region: locatorRegion,
    });
    expect(plan.findIndex((entry) => entry.region.regionSource === "fallback")).toBeGreaterThan(0);
  });

  it("emits separated OCR debug overlays for target, search, and combined regions", async () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    tesseractMock.recognize.mockResolvedValue({
      data: {
        text: "Tesla 7SAYGAEE3RF178432",
        confidence: 86,
      },
    });
    const source = document.createElement("canvas");
    source.width = 800;
    source.height = 320;
    const artifacts = [];

    const result = await recognizeDeliveryVinFromImageSource(source, {
      mode: "frame-then-search",
      debug: true,
      debugLabel: "unit-overlays",
      frameHint: {
        videoRect: { x: 0, y: 0, width: 400, height: 200 },
        frameRect: { x: 60, y: 40, width: 280, height: 58 },
        displaySize: { width: 400, height: 200 },
        objectFit: "cover",
      },
      onDebugArtifact(artifact) {
        artifacts.push(artifact);
      },
    });

    const targetOverlay = artifacts.find((artifact) => artifact.name === "ocr-target-overlay.png");
    const searchOverlay = artifacts.find((artifact) => artifact.name === "ocr-search-overlay.png");
    const combinedOverlay = artifacts.find((artifact) => artifact.name === "ocr-region-overlay.png");

    expect(result.vin).toBe("7SAYGAEE3RF178432");
    expect(targetOverlay).toMatchObject({
      kind: "source",
      overlayRole: "target",
      width: 800,
      height: 320,
      regionSources: ["mapped-frame", "mapped-frame-expanded"],
    });
    expect(searchOverlay).toMatchObject({
      kind: "source",
      overlayRole: "search",
      width: 800,
      height: 320,
      regionSources: ["fallback"],
    });
    expect(combinedOverlay).toMatchObject({
      kind: "source",
      overlayRole: "combined",
      width: 800,
      height: 320,
    });
    expect(combinedOverlay.regionSources).toContain("mapped-frame");
    expect(combinedOverlay.regionSources).toContain("fallback");
  });

  it("snapshots live video once before running OCR attempts", async () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    tesseractMock.recognize.mockResolvedValue({
      data: {
        text: "7SAYGAEE3RF178432",
        confidence: 88,
      },
    });
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
    video.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 574,
      height: 323,
      top: 0,
      left: 0,
      right: 574,
      bottom: 323,
      toJSON: vi.fn(),
    }));

    const result = await recognizeDeliveryVinFromImageSource(video, {
      mode: "frame-then-search",
      debug: true,
      debugImages: "none",
    });

    expect(result.vin).toBe("7SAYGAEE3RF178432");
    expect(context.drawImage.mock.calls.some((call) => call[0] === video)).toBe(true);
    expect(tesseractMock.recognize.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);
    expect(tesseractMock.recognize.mock.calls[0][0]).not.toBe(video);
  });

  it("finds the Safari console VIN in the fast pass instead of the old deep attempt order", async () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    tesseractMock.recognize.mockImplementation(async () => ({
      data: {
        text: tesseractMock.recognize.mock.calls.length === 4
          ? "YB27SAYGAEE3RF178432"
          : "",
        confidence: 0,
      },
    }));
    const source = document.createElement("canvas");
    source.width = 1920;
    source.height = 1080;

    const result = await recognizeDeliveryVinFromImageSource(source, {
      mode: "frame-then-search",
      debug: true,
      debugImages: "none",
      frameHint: {
        videoRect: { x: 0, y: 0, width: 574, height: 323 },
        frameRect: { x: 44, y: 54, width: 492, height: 76 },
        displaySize: { width: 574, height: 323 },
        objectFit: "cover",
      },
    });

    expect(result.vin).toBe("7SAYGAEE3RF178432");
    expect(result.attempts).toBeLessThan(10);
  });

  it("records skipped low-signal processed attempts without calling Tesseract for them", async () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    tesseractMock.recognize.mockResolvedValue({
      data: {
        text: "",
        confidence: 0,
      },
    });
    const source = document.createElement("canvas");
    source.width = 640;
    source.height = 260;

    const result = await recognizeDeliveryVinFromImageSource(source, {
      mode: "frame",
      debug: true,
      debugImages: "none",
    });

    const skipped = result.debug.attempts.filter((attempt) =>
      attempt.error?.startsWith("skipped-low-signal"),
    );
    expect(skipped.length).toBeGreaterThan(0);
    expect(tesseractMock.recognize.mock.calls.length).toBeLessThan(result.attempts);
  });

  it("keeps per-attempt PNGs out of minimal debug images but preserves them in full mode", async () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    tesseractMock.recognize.mockResolvedValue({
      data: {
        text: "7SAYGAEE3RF178432",
        confidence: 90,
      },
    });
    const source = document.createElement("canvas");
    source.width = 800;
    source.height = 320;
    const minimalArtifacts = [];
    const fullArtifacts = [];

    await recognizeDeliveryVinFromImageSource(source, {
      mode: "frame",
      debug: true,
      debugImages: "minimal",
      onDebugArtifact(artifact) {
        minimalArtifacts.push(artifact);
      },
    });
    await recognizeDeliveryVinFromImageSource(source, {
      mode: "frame",
      debug: true,
      debugImages: "full",
      onDebugArtifact(artifact) {
        fullArtifacts.push(artifact);
      },
    });

    expect(minimalArtifacts.some((artifact) => artifact.name.startsWith("attempt-"))).toBe(false);
    expect(fullArtifacts.some((artifact) => artifact.name.startsWith("attempt-"))).toBe(true);
  });

  it("starts an OCR camera session, captures a frame, and stops tracks", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: vi.fn(() => [{ stop: stopTrack }]),
    };
    const mediaDevices = {
      getUserMedia: vi.fn(async () => stream),
    };
    const permissions = {
      has: vi.fn(() => true),
      require: vi.fn(() => true),
      list: vi.fn(() => ["media.camera"]),
    };
    const recognize = vi.fn(async () => ({
      vin: "7SAYGAEE3RF178432",
      rawText: "YEZ7SAYGAEE3RF178432",
      attempts: 1,
    }));
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
    video.play = vi.fn(async () => {});
    video.pause = vi.fn();
    const onProgress = vi.fn();

    const session = await startDeliveryVinOcrScanner({
      video,
      mediaDevices,
      permissions,
      recognize,
      onProgress,
    });
    const result = await session.capture({
      debug: true,
      debugLabel: "unit-camera",
      onDebugArtifact: vi.fn(),
      onDebugReport: vi.fn(),
    });

    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: expect.objectContaining({
        facingMode: { ideal: "environment" },
      }),
    });
    expect(permissions.require).toHaveBeenCalledWith("media.camera");
    expect(video.srcObject).toBe(stream);
    expect(recognize).toHaveBeenCalledWith(video, expect.objectContaining({
      mode: "frame-then-search",
      debug: true,
      debugLabel: "unit-camera",
      displaySize: expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
      onDebugArtifact: expect.any(Function),
      onDebugReport: expect.any(Function),
      onProgress,
    }));
    expect(result.vin).toBe("7SAYGAEE3RF178432");

    session.destroy();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(session.isActive()).toBe(false);
  });

  it("falls back when camera permission or browser media support is unavailable", async () => {
    await expect(startDeliveryVinOcrScanner({
      video: document.createElement("video"),
      mediaDevices: null,
      permissions: null,
      recognize: vi.fn(),
    })).rejects.toThrow("Camera is not available");

    await expect(startDeliveryVinOcrScanner({
      video: document.createElement("video"),
      mediaDevices: { getUserMedia: vi.fn() },
      permissions: {
        has: vi.fn(() => false),
        require: vi.fn(() => false),
        list: vi.fn(() => []),
      },
      recognize: vi.fn(),
    })).rejects.toThrow("VIN OCR camera permission denied");
  });

  it("keeps Canvas OCR working when optional OpenCV preprocessing is unavailable", async () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    tesseractMock.recognize.mockResolvedValue({
      data: {
        text: "Tesla 7SAYGAEE3RF178432",
        confidence: 82,
      },
    });
    const source = document.createElement("canvas");
    source.width = 800;
    source.height = 320;
    const reports = [];
    const frameHint = {
      videoRect: { x: 0, y: 0, width: 400, height: 200 },
      frameRect: { x: 60, y: 40, width: 280, height: 58 },
      displaySize: { width: 400, height: 200 },
      objectFit: "cover",
    };

    const result = await recognizeDeliveryVinFromImageSource(source, {
      mode: "frame",
      preprocessor: "opencv",
      debug: true,
      debugLabel: "unit-opencv-fallback",
      frameHint,
      loadOpenCv: async () => {
        throw new Error("OpenCV unavailable");
      },
      onDebugReport(report) {
        reports.push(report);
      },
    });

    expect(result.vin).toBe("7SAYGAEE3RF178432");
    expect(tesseractMock.recognize).toHaveBeenCalled();
    expect(reports[0]).toMatchObject({
      label: "unit-opencv-fallback",
      preprocessor: "opencv",
      openCvAvailable: false,
      selectedVin: "7SAYGAEE3RF178432",
      frameHint,
      mappedFrameRegion: expect.objectContaining({
        regionSource: "mapped-frame",
      }),
    });
    expect(reports[0].attempts[0].region.regionSource).toMatch(/^mapped-frame/);
  });

  it("does not load OpenCV in auto mode when the first Canvas pass succeeds", async () => {
    const context = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    tesseractMock.recognize.mockResolvedValue({
      data: {
        text: "7SAYGAEE3RF178432",
        confidence: 90,
      },
    });
    const source = document.createElement("canvas");
    source.width = 800;
    source.height = 320;
    const loadOpenCv = vi.fn();

    const result = await recognizeDeliveryVinFromImageSource(source, {
      mode: "frame",
      preprocessor: "auto",
      loadOpenCv,
    });

    expect(result.vin).toBe("7SAYGAEE3RF178432");
    expect(loadOpenCv).not.toHaveBeenCalled();
    expect(tesseractMock.recognize).toHaveBeenCalledOnce();
  });
});
