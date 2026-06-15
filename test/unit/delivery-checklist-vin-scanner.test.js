import { describe, expect, it, vi } from "vitest";

import {
  calculateDeliveryVinScanRegion,
  compareDeliveryWindshieldVin,
  extractDeliveryVinFromQrPayload,
  normalizeDeliveryVin,
  startDeliveryVinQrScanner,
} from "../../src/apps/delivery-checklist/delivery-checklist-vin-scanner.js";

describe("delivery checklist VIN scanner helpers", () => {
  it("normalizes VIN values and extracts a windshield VIN from noisy QR payloads", () => {
    expect(normalizeDeliveryVin(" 5yjygdee0rf000001 ")).toBe("5YJYGDEE0RF000001");
    expect(normalizeDeliveryVin("5YJYGDIEOQRF000001")).toBe("5YJYGDERF000001");

    expect(extractDeliveryVinFromQrPayload("tesla://delivery?vin=5yjygdee0rf000001")).toBe("5YJYGDEE0RF000001");
    expect(extractDeliveryVinFromQrPayload("QR: 7G2CEHED0RA000001; delivery")).toBe("7G2CEHED0RA000001");
    expect(extractDeliveryVinFromQrPayload("not-a-vin")).toBe("");
    expect(extractDeliveryVinFromQrPayload("5YJYGDIEOQRF000001")).toBe("");
  });

  it("compares scanned windshield VINs based on the selected setup mode", () => {
    expect(compareDeliveryWindshieldVin({}, "choice")).toMatchObject({
      state: "not-scanned",
      scannedVin: "",
    });

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "5YJYGDEE0RF000001",
      vin: "7G2CEHED0RA000001",
    }, "manual")).toMatchObject({
      state: "manual",
      scannedVin: "5YJYGDEE0RF000001",
      backendVin: "7G2CEHED0RA000001",
    });

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "5YJYGDEE0RF000001",
      vin: "5yjygdee0rf000001",
    }, "vatiolibre").state).toBe("match");

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "5YJYGDEE0RF000001",
      vin: "7G2CEHED0RA000001",
    }, "vatiolibre").state).toBe("mismatch");

    expect(compareDeliveryWindshieldVin({
      windshieldVin: "5YJYGDEE0RF000001",
    }, "vatiolibre").state).toBe("backend-unavailable");
  });

  it("calculates a large centered VIN QR scan region matching the visible frame", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 1080,
    });

    expect(calculateDeliveryVinScanRegion(video)).toEqual({
      x: 507,
      y: 87,
      width: 907,
      height: 907,
      downScaledWidth: 480,
      downScaledHeight: 480,
    });
  });

  it("starts a camera QR session, saves the first VIN result, and stops tracks", async () => {
    const stop = vi.fn();
    const destroy = vi.fn();
    let onQrResult;
    const session = {
      start: vi.fn(async () => {
        onQrResult({ data: "windshield:5YJYGDEE0RF000001" });
      }),
      stop,
      destroy,
      setCamera: vi.fn(),
      isActive: vi.fn(() => true),
    };
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async (options) => {
        onQrResult = options.onResult;
        return session;
      }),
    };
    const video = document.createElement("video");
    const onResult = vi.fn();

    const vinSession = await startDeliveryVinQrScanner({
      video,
      qrScannerService,
      onResult,
    });

    expect(qrScannerService.createCameraSession).toHaveBeenCalledWith(expect.objectContaining({
      video,
      preferredCamera: "environment",
      maxScansPerSecond: 12,
      calculateScanRegion: calculateDeliveryVinScanRegion,
      highlightScanRegion: false,
      highlightCodeOutline: false,
      onResult: expect.any(Function),
      onError: expect.any(Function),
    }));
    expect(session.start).toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith({
      vin: "5YJYGDEE0RF000001",
      rawText: "windshield:5YJYGDEE0RF000001",
    });
    expect(stop).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();

    vinSession.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("ignores non-VIN QR payloads while keeping the scanner active", async () => {
    let onQrResult;
    const session = {
      start: vi.fn(async () => {
        onQrResult({ data: "https://vatioboard.com" });
      }),
      stop: vi.fn(),
      destroy: vi.fn(),
      setCamera: vi.fn(),
      isActive: vi.fn(() => true),
    };
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async (options) => {
        onQrResult = options.onResult;
        return session;
      }),
    };
    const onResult = vi.fn();

    const vinSession = await startDeliveryVinQrScanner({
      video: document.createElement("video"),
      qrScannerService,
      onResult,
    });

    expect(onResult).not.toHaveBeenCalled();
    expect(session.stop).not.toHaveBeenCalled();
    expect(session.destroy).not.toHaveBeenCalled();

    vinSession.destroy();
    expect(session.stop).toHaveBeenCalledOnce();
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it("falls back when the QR scanner service is unavailable and reports decoder errors", async () => {
    const video = document.createElement("video");
    await expect(startDeliveryVinQrScanner({
      video,
      qrScannerService: null,
      onResult: vi.fn(),
    })).rejects.toThrow("QR scanner service is not available");

    let onQrError;
    const onError = vi.fn();
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async (options) => {
        onQrError = options.onError;
        return {
          start: vi.fn(async () => {
            onQrError(new Error("Camera stream ended"));
          }),
          stop: vi.fn(),
          destroy: vi.fn(),
          setCamera: vi.fn(),
          isActive: vi.fn(),
        };
      }),
    };

    const vinSession = await startDeliveryVinQrScanner({
      video,
      qrScannerService,
      onResult: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    vinSession.destroy();
  });

  it("ignores expected no-QR decode errors from the scanner library", async () => {
    let onQrError;
    const onError = vi.fn();
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async (options) => {
        onQrError = options.onError;
        return {
          start: vi.fn(async () => {
            onQrError("No QR code found");
          }),
          stop: vi.fn(),
          destroy: vi.fn(),
          setCamera: vi.fn(),
          isActive: vi.fn(),
        };
      }),
    };

    const vinSession = await startDeliveryVinQrScanner({
      video: document.createElement("video"),
      qrScannerService,
      onResult: vi.fn(),
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    vinSession.destroy();
  });

  it("propagates session start failures after cleanup", async () => {
    const stop = vi.fn();
    const destroy = vi.fn();
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async () => ({
        start: vi.fn(async () => {
          throw new Error("Camera rejected");
        }),
        stop,
        destroy,
        setCamera: vi.fn(),
        isActive: vi.fn(),
      })),
    };

    await expect(startDeliveryVinQrScanner({
      video: document.createElement("video"),
      qrScannerService,
      onResult: vi.fn(),
    })).rejects.toThrow("Camera rejected");

    expect(stop).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("accepts raw scanner service results with VIN payloads", async () => {
    let onQrResult;
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async (options) => {
        onQrResult = options.onResult;
        return {
          start: vi.fn(async () => {
            onQrResult({ data: "QR: 5YJYGDEE0RF000001" });
          }),
          stop: vi.fn(),
          destroy: vi.fn(),
          setCamera: vi.fn(),
          isActive: vi.fn(),
        };
      }),
    };
    const onResult = vi.fn();

    await startDeliveryVinQrScanner({
      video: document.createElement("video"),
      qrScannerService,
      onResult,
    });

    expect(onResult).toHaveBeenCalledWith({
      vin: "5YJYGDEE0RF000001",
      rawText: "QR: 5YJYGDEE0RF000001",
    });
  });
});
