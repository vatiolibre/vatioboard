import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calculateDeliveryVinOcrRegion,
  compareDeliveryWindshieldVin,
  createDeliveryVinOcrAttemptPlan,
  createDeliveryVinOcrRegions,
  createDeliveryVinOcrSearchRegions,
  createDeliveryVinTextRegion,
  createDeliveryVinValueRegion,
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
    expect(extractDeliveryVinFromOcrText("5YJYGDEE0RF000001")).toBe("");

    expect(findDeliveryVinOcrCandidates("YEZ7SAYGAEE3RF178432")[0]).toBe("7SAYGAEE3RF178432");
    expect(findDeliveryVinOcrCandidates("ZSAYGAEE3RF178432")[0]).toBe("7SAYGAEE3RF178432");
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
