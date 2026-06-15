import { describe, expect, it, vi } from "vitest";

import {
  calculateDeliveryVinOcrRegion,
  compareDeliveryWindshieldVin,
  createDeliveryVinOcrRegions,
  createDeliveryVinOcrSearchRegions,
  createDeliveryVinTextRegion,
  extractDeliveryVinFromOcrText,
  extractDeliveryVinFromQrPayload,
  findDeliveryVinOcrCandidates,
  isValidDeliveryVinCheckDigit,
  normalizeDeliveryVin,
  startDeliveryVinOcrScanner,
} from "../../src/apps/delivery-checklist/delivery-checklist-vin-scanner.js";

describe("delivery checklist VIN scanner helpers", () => {
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
    expect(extractDeliveryVinFromOcrText("5YJYGDEE0RF000001")).toBe("");

    expect(findDeliveryVinOcrCandidates("YEZ7SAYGAEE3RF178432")[0]).toBe("7SAYGAEE3RF178432");
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
    });

    expect(createDeliveryVinOcrSearchRegions(768, 1024).map((region) => region.y)).toEqual([
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
    });

    const frameThenSearch = createDeliveryVinOcrRegions(768, 1024, { mode: "frame-then-search" });
    expect(frameThenSearch[0].role).toBe("vin-text");
    expect(frameThenSearch[1]).toEqual(calculateDeliveryVinOcrRegion(768, 1024));
    expect(frameThenSearch.map((region) => region.y)).toEqual([
      341,
      341,
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
});
