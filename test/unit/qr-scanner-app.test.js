import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import qrScannerTemplate from "../../src/apps/qr-scanner/qr-scanner-template.js";
import {
  calculateQrScannerScanRegion,
  getSafeQrScannerUrl,
  mountQrScannerRoute,
} from "../../src/apps/qr-scanner/qr-scanner-app.js";

function createRoot() {
  const root = document.createElement("main");
  root.innerHTML = qrScannerTemplate;
  document.body.append(root);
  return root;
}

function createRouteContext({ root, qrScannerService = null } = {}) {
  const cleanups = [];
  return {
    root,
    context: {},
    cleanup: {
      add(cleanup) {
        if (typeof cleanup === "function") cleanups.push(cleanup);
        return cleanup;
      },
      run() {
        while (cleanups.length) cleanups.pop()();
      },
    },
    signal: new AbortController().signal,
    appRuntime: null,
    appManifest: null,
    qrScannerService,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createQrScannerService({ cameraResult = "", imageResult = "", startReject = null } = {}) {
  let onResult;
  const stop = vi.fn();
  const destroy = vi.fn();
  const session = {
    start: vi.fn(async () => {
      if (startReject) throw startReject;
      if (cameraResult) onResult({ data: cameraResult });
    }),
    stop,
    destroy,
    setCamera: vi.fn(),
    isActive: vi.fn(() => true),
  };
  return {
    service: {
      hasCamera: vi.fn(async () => true),
      listCameras: vi.fn(async () => []),
      scanImage: vi.fn(async () => ({ data: imageResult })),
      createCameraSession: vi.fn(async (options) => {
        onResult = options.onResult;
        return session;
      }),
    },
    session,
    stop,
    destroy,
  };
}

describe("QR scanner app", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("calculates a large centered QR scan region", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 720,
    });

    expect(calculateQrScannerScanRegion(video)).toEqual({
      x: 338,
      y: 58,
      width: 605,
      height: 605,
      downScaledWidth: 480,
      downScaledHeight: 480,
    });
  });

  it("accepts only safe absolute HTTP URLs for open-link results", () => {
    expect(getSafeQrScannerUrl("https://example.com/qr")).toBe("https://example.com/qr");
    expect(getSafeQrScannerUrl("http://example.com/qr")).toBe("http://example.com/qr");
    expect(getSafeQrScannerUrl("javascript:alert(1)")).toBe("");
    expect(getSafeQrScannerUrl("example.com/qr")).toBe("");
  });

  it("starts a camera session, renders the first QR result, copies it, and does not persist it", async () => {
    const { service, session, stop, destroy } = createQrScannerService({
      cameraResult: "https://example.com/from-camera",
    });
    const root = createRoot();
    const mounted = mountQrScannerRoute(createRouteContext({ root, qrScannerService: service }));

    await flushPromises();

    expect(service.hasCamera).toHaveBeenCalled();
    expect(service.createCameraSession).toHaveBeenCalledWith(expect.objectContaining({
      video: document.querySelector("#qrScannerVideo"),
      preferredCamera: "environment",
      calculateScanRegion: calculateQrScannerScanRegion,
      highlightScanRegion: false,
      highlightCodeOutline: false,
      onResult: expect.any(Function),
    }));
    expect(session.start).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect(document.querySelector("#qrScannerResultText").textContent).toBe("https://example.com/from-camera");
    expect(document.querySelector("#qrScannerOpen").hidden).toBe(false);
    expect(document.querySelector("#qrScannerOpen").href).toBe("https://example.com/from-camera");
    expect(localStorage.length).toBe(0);

    document.querySelector("#qrScannerCopy").click();
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://example.com/from-camera");

    mounted.unmount();
  });

  it("scans again by clearing the prior result and creating a new session", async () => {
    let nextResult = "first-result";
    let onResult;
    const service = {
      hasCamera: vi.fn(async () => true),
      listCameras: vi.fn(async () => []),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async (options) => {
        onResult = options.onResult;
        return {
          start: vi.fn(async () => onResult({ data: nextResult })),
          stop: vi.fn(),
          destroy: vi.fn(),
          setCamera: vi.fn(),
          isActive: vi.fn(),
        };
      }),
    };
    const root = createRoot();
    const mounted = mountQrScannerRoute(createRouteContext({ root, qrScannerService: service }));

    await flushPromises();
    expect(document.querySelector("#qrScannerResultText").textContent).toBe("first-result");

    nextResult = "second-result";
    document.querySelector("#qrScannerAgain").click();
    await flushPromises();

    expect(service.createCameraSession).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#qrScannerResultText").textContent).toBe("second-result");

    mounted.unmount();
  });

  it("destroys an active camera session on unmount", async () => {
    const { service, session, stop, destroy } = createQrScannerService();
    const root = createRoot();
    const mounted = mountQrScannerRoute(createRouteContext({ root, qrScannerService: service }));

    await flushPromises();
    expect(session.start).toHaveBeenCalled();

    mounted.unmount();

    expect(stop).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it("shows fallback status when the scanner service is missing or camera startup fails", async () => {
    const missingRoot = createRoot();
    const missingMounted = mountQrScannerRoute(createRouteContext({ root: missingRoot }));

    await flushPromises();
    expect(missingRoot.querySelector("#qrScannerStatus").textContent).toContain("unavailable");
    missingMounted.unmount();
    missingRoot.remove();

    const { service } = createQrScannerService({ startReject: new Error("permission denied") });
    const root = createRoot();
    const mounted = mountQrScannerRoute(createRouteContext({ root, qrScannerService: service }));

    await flushPromises();
    expect(root.querySelector("#qrScannerStatus").textContent).toContain("Camera scan is unavailable");

    mounted.unmount();
  });

  it("scans image files through the QR scanner service", async () => {
    const { service } = createQrScannerService({ imageResult: "WIFI:T:WPA;S:Garage;P:secret;;" });
    service.hasCamera.mockResolvedValue(false);
    const root = createRoot();
    const mounted = mountQrScannerRoute(createRouteContext({ root, qrScannerService: service }));
    const file = new File(["fake"], "qr.png", { type: "image/png" });
    const input = document.querySelector("#qrScannerImageInput");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });

    await flushPromises();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    expect(service.scanImage).toHaveBeenCalledWith(file, { alsoTryWithoutScanRegion: true });
    expect(root.querySelector("#qrScannerResultText").textContent).toBe("WIFI:T:WPA;S:Garage;P:secret;;");
    expect(root.querySelector("#qrScannerOpen").hidden).toBe(true);

    mounted.unmount();
  });

  it("keeps the scanner shell constrained and uses the app-owned frame", () => {
    const stylesheet = readFileSync(
      join(process.cwd(), "src/apps/qr-scanner/qr-scanner.less"),
      "utf8",
    );
    const root = createRoot();

    expect(stylesheet).toContain("--qr-touch: var(--vb-touch-target-min, 44px)");
    expect(stylesheet).toContain("overflow-x: clip");
    expect(stylesheet).toContain(".qr-scanner-frame");
    expect(stylesheet).toContain("env(safe-area-inset-bottom");
    expect(stylesheet).not.toContain(".scan-region-highlight");
    expect(root.querySelector(".qr-scanner-preview .qr-scanner-frame")).not.toBeNull();

    root.remove();
  });
});
