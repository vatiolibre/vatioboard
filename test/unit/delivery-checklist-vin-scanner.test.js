import { describe, expect, it, vi } from "vitest";

import {
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

  it("starts a camera QR session, saves the first VIN result, and stops tracks", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    const mediaDevices = {
      getUserMedia: vi.fn(async () => stream),
    };
    const controls = { stop: vi.fn() };
    const reader = {
      decodeFromVideoElement: vi.fn(async (_video, callback) => {
        callback({ getText: () => "windshield:5YJYGDEE0RF000001" });
        return controls;
      }),
      reset: vi.fn(),
    };
    const video = document.createElement("video");
    video.play = vi.fn(async () => undefined);
    video.pause = vi.fn();
    const onResult = vi.fn();

    const session = await startDeliveryVinQrScanner({
      video,
      mediaDevices,
      createReader: async () => reader,
      onResult,
    });

    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    expect(onResult).toHaveBeenCalledWith({
      vin: "5YJYGDEE0RF000001",
      rawText: "windshield:5YJYGDEE0RF000001",
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();

    session.stop();
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("falls back when camera access is unavailable and reports decoder errors", async () => {
    const video = document.createElement("video");
    await expect(startDeliveryVinQrScanner({
      video,
      mediaDevices: null,
      onResult: vi.fn(),
    })).rejects.toThrow("Camera access is not available");

    const onError = vi.fn();
    const mediaDevices = {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    };
    const reader = {
      decodeFromVideoElement: vi.fn(async (_video, callback) => {
        callback(null, { name: "DecodeError" });
      }),
    };
    video.play = vi.fn(async () => undefined);
    video.pause = vi.fn();

    const session = await startDeliveryVinQrScanner({
      video,
      mediaDevices,
      createReader: async () => reader,
      onResult: vi.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith({ name: "DecodeError" });
    session.stop();
  });
});
