import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserQrScannerService } from "../../src/app-platform/qr-scanner-service.js";

describe("browser QR scanner service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps camera sessions with detailed scan results and lifecycle controls", async () => {
    const start = vi.fn(async () => undefined);
    const stop = vi.fn();
    const destroy = vi.fn();
    const setCamera = vi.fn(async () => undefined);
    const hasFlash = vi.fn(async () => true);
    const isFlashOn = vi.fn(() => false);
    const turnFlashOn = vi.fn(async () => undefined);
    const turnFlashOff = vi.fn(async () => undefined);
    const toggleFlash = vi.fn(async () => undefined);
    let decode;
    let constructorArgs;

    class MockQrScanner {
      static hasCamera = vi.fn(async () => true);
      static listCameras = vi.fn(async () => [{ id: "camera-1", label: "Back camera" }]);
      static scanImage = vi.fn(async () => ({
        data: "file-result",
        cornerPoints: [{ x: 1, y: 2 }],
      }));

      constructor(video, onDecode, options) {
        constructorArgs = { video, options };
        decode = onDecode;
      }

      start = start;
      stop = stop;
      destroy = destroy;
      setCamera = setCamera;
      hasFlash = hasFlash;
      isFlashOn = isFlashOn;
      turnFlashOn = turnFlashOn;
      turnFlashOff = turnFlashOff;
      toggleFlash = toggleFlash;
    }

    const service = createBrowserQrScannerService({
      loadQrScanner: async () => MockQrScanner,
    });
    const video = document.createElement("video");
    const onResult = vi.fn();
    const onError = vi.fn();

    expect(await service.hasCamera()).toBe(true);
    expect(await service.listCameras(true)).toEqual([{ id: "camera-1", label: "Back camera" }]);

    const session = await service.createCameraSession({
      video,
      onResult,
      onError,
      preferredCamera: "environment",
      maxScansPerSecond: 8,
      highlightScanRegion: true,
      highlightCodeOutline: true,
    });

    expect(constructorArgs).toMatchObject({
      video,
      options: {
        preferredCamera: "environment",
        maxScansPerSecond: 8,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        onDecodeError: onError,
      },
    });

    await session.start();
    expect(session.isActive()).toBe(true);
    decode({
      data: "camera-result",
      cornerPoints: [{ x: "3", y: "4" }, { x: "nope", y: 5 }],
    });
    expect(onResult).toHaveBeenCalledWith({
      data: "camera-result",
      cornerPoints: [{ x: 3, y: 4 }],
    });

    await session.setCamera("camera-1");
    expect(setCamera).toHaveBeenCalledWith("camera-1");
    await expect(session.hasFlash?.()).resolves.toBe(true);
    expect(session.isFlashOn?.()).toBe(false);
    await session.turnFlashOn?.();
    await session.turnFlashOff?.();
    await session.toggleFlash?.();
    expect(turnFlashOn).toHaveBeenCalledOnce();
    expect(turnFlashOff).toHaveBeenCalledOnce();
    expect(toggleFlash).toHaveBeenCalledOnce();

    session.stop();
    expect(stop).toHaveBeenCalledOnce();
    expect(session.isActive()).toBe(false);
    session.destroy();
    expect(destroy).toHaveBeenCalledOnce();
    expect(session.isActive()).toBe(false);
    expect(() => session.stop()).not.toThrow();
  });

  it("normalizes simple string results and scans images", async () => {
    class MockQrScanner {
      static hasCamera = vi.fn(async () => false);
      static listCameras = vi.fn(async () => []);
      static scanImage = vi.fn(async () => "plain-result");

      constructor(_video, onDecode) {
        onDecode("string-camera-result");
      }

      start = vi.fn(async () => undefined);
      stop = vi.fn();
      destroy = vi.fn();
      setCamera = vi.fn();
      hasFlash = vi.fn();
      isFlashOn = vi.fn();
      turnFlashOn = vi.fn();
      turnFlashOff = vi.fn();
      toggleFlash = vi.fn();
    }

    const service = createBrowserQrScannerService({
      loadQrScanner: async () => MockQrScanner,
    });
    const onResult = vi.fn();
    await service.createCameraSession({
      video: document.createElement("video"),
      onResult,
    });
    const blob = new Blob(["qr"], { type: "image/png" });

    expect(onResult).toHaveBeenCalledWith({ data: "string-camera-result" });
    await expect(service.scanImage(blob, { alsoTryWithoutScanRegion: true })).resolves.toEqual({
      data: "plain-result",
    });
    expect(MockQrScanner.scanImage).toHaveBeenCalledWith(blob, {
      scanRegion: undefined,
      alsoTryWithoutScanRegion: true,
      returnDetailedScanResult: true,
    });
  });

  it("prevents using destroyed sessions", async () => {
    class MockQrScanner {
      constructor() {}
      start = vi.fn(async () => undefined);
      stop = vi.fn();
      destroy = vi.fn();
      setCamera = vi.fn();
      hasFlash = vi.fn();
      isFlashOn = vi.fn();
      turnFlashOn = vi.fn();
      turnFlashOff = vi.fn();
      toggleFlash = vi.fn();
    }
    const service = createBrowserQrScannerService({
      loadQrScanner: async () => MockQrScanner,
    });
    const session = await service.createCameraSession({
      video: document.createElement("video"),
      onResult: vi.fn(),
    });

    session.destroy();
    await expect(session.start()).rejects.toThrow("destroyed");
    await expect(session.setCamera("environment")).rejects.toThrow("destroyed");
  });
});
