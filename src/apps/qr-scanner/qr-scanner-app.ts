import type {
  MountedView,
} from "../../types/route";
import type {
  VatioQrScanRegion,
  VatioQrScanResult,
  VatioQrScannerSession,
} from "../../app-platform/types";
import type { QrScannerRouteMountContext } from "./qr-scanner-route-app.js";

const QR_SCAN_REGION_RATIO = 0.84;
const QR_SCAN_DOWNSCALE_SIZE = 480;

interface QrScannerDom {
  app: HTMLElement;
  video: HTMLVideoElement;
  status: HTMLElement;
  againButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  imageInput: HTMLInputElement;
  resultPanel: HTMLElement;
  resultText: HTMLElement;
  openLink: HTMLAnchorElement;
}

function $(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`QR scanner element not found: ${selector}`);
  return element;
}

function bind(
  routeContext: QrScannerRouteMountContext,
  target: EventTarget,
  type: string,
  listener: EventListener,
): void {
  target.addEventListener(type, listener);
  routeContext.cleanup.add(() => target.removeEventListener(type, listener));
}

export function calculateQrScannerScanRegion(video: HTMLVideoElement): VatioQrScanRegion {
  const videoWidth = Math.max(0, Math.round(video.videoWidth || 0));
  const videoHeight = Math.max(0, Math.round(video.videoHeight || 0));
  const minDimension = Math.min(videoWidth, videoHeight);
  const size = Math.round(minDimension * QR_SCAN_REGION_RATIO);
  const downScaledSize = Math.max(1, Math.min(QR_SCAN_DOWNSCALE_SIZE, size || QR_SCAN_DOWNSCALE_SIZE));

  return {
    x: Math.max(0, Math.round((videoWidth - size) / 2)),
    y: Math.max(0, Math.round((videoHeight - size) / 2)),
    width: size,
    height: size,
    downScaledWidth: downScaledSize,
    downScaledHeight: downScaledSize,
  };
}

export function getSafeQrScannerUrl(payload: unknown): string {
  const value = String(payload || "").trim();
  if (!/^https?:\/\//i.test(value)) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function stopAndDestroy(session: VatioQrScannerSession | null): void {
  try {
    session?.stop();
  } finally {
    session?.destroy();
  }
}

function isExpectedNoQrError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error || "");
  return !message || /no qr code found/i.test(message);
}

function resolveQrScannerDom(root: ParentNode): QrScannerDom {
  return {
    app: $(root, "[data-qr-scanner-app]") as HTMLElement,
    video: $(root, "#qrScannerVideo") as HTMLVideoElement,
    status: $(root, "#qrScannerStatus") as HTMLElement,
    againButton: $(root, "#qrScannerAgain") as HTMLButtonElement,
    copyButton: $(root, "#qrScannerCopy") as HTMLButtonElement,
    imageInput: $(root, "#qrScannerImageInput") as HTMLInputElement,
    resultPanel: $(root, "#qrScannerResultPanel") as HTMLElement,
    resultText: $(root, "#qrScannerResultText") as HTMLElement,
    openLink: $(root, "#qrScannerOpen") as HTMLAnchorElement,
  };
}

export function mountQrScannerRoute(routeContext: QrScannerRouteMountContext): MountedView {
  const dom = resolveQrScannerDom(routeContext.root);
  const qrScannerService = routeContext.qrScannerService || routeContext.appRuntime?.services.qrScanner || null;
  let scannerSession: VatioQrScannerSession | null = null;
  let destroyed = false;
  let lastResult = "";

  function setStatus(message: string, state: string): void {
    dom.status.textContent = message;
    dom.app.dataset.state = state;
  }

  function setScanningControls(scanning: boolean): void {
    dom.againButton.disabled = scanning;
    dom.againButton.textContent = scanning ? "Scanning..." : (lastResult ? "Scan again" : "Start scan");
  }

  function stopSession(): void {
    stopAndDestroy(scannerSession);
    scannerSession = null;
    setScanningControls(false);
  }

  function renderResult(result: string): void {
    lastResult = result;
    stopSession();
    dom.resultText.textContent = result;
    dom.resultPanel.hidden = false;
    dom.copyButton.hidden = !result;
    const safeUrl = getSafeQrScannerUrl(result);
    dom.openLink.hidden = !safeUrl;
    if (safeUrl) dom.openLink.href = safeUrl;
    setStatus("QR code scanned.", "result");
  }

  function resetResult(): void {
    lastResult = "";
    dom.resultText.textContent = "";
    dom.resultPanel.hidden = true;
    dom.copyButton.hidden = true;
    dom.openLink.hidden = true;
    dom.openLink.removeAttribute("href");
  }

  async function startScan({ auto = false } = {}): Promise<void> {
    if (destroyed) return;
    resetResult();
    stopSession();

    if (!qrScannerService) {
      setStatus("QR scanner is unavailable. Scan an image instead.", "fallback");
      return;
    }

    setStatus(auto ? "Checking camera..." : "Starting camera...", "starting");
    setScanningControls(true);

    if (auto) {
      const hasCamera = await qrScannerService.hasCamera().catch(() => true);
      if (destroyed) return;
      if (!hasCamera) {
        setStatus("No camera detected. Scan an image instead.", "fallback");
        setScanningControls(false);
        return;
      }
    }

    dom.video.playsInline = true;
    dom.video.muted = true;

    try {
      scannerSession = await qrScannerService.createCameraSession({
        video: dom.video,
        preferredCamera: "environment",
        maxScansPerSecond: 12,
        calculateScanRegion: calculateQrScannerScanRegion,
        highlightScanRegion: false,
        highlightCodeOutline: false,
        onResult(result: VatioQrScanResult) {
          if (destroyed) return;
          const data = String(result.data || "").trim();
          if (data) renderResult(data);
        },
        onError(error) {
          if (!isExpectedNoQrError(error)) {
            routeContext.logger?.warn("QR scanner decode error.", error);
          }
        },
      });
      await scannerSession.start();
      if (destroyed) {
        stopSession();
        return;
      }
      if (!scannerSession || lastResult) return;
      setStatus("Scanning for QR code.", "scanning");
    } catch (error) {
      routeContext.logger?.warn("QR scanner camera failed.", error);
      stopSession();
      setStatus("Camera scan is unavailable. Scan an image instead.", "fallback");
    }
  }

  async function scanImage(file: File): Promise<void> {
    if (!qrScannerService) {
      setStatus("QR scanner is unavailable.", "fallback");
      return;
    }
    resetResult();
    stopSession();
    setStatus("Scanning image...", "starting");
    try {
      const result = await qrScannerService.scanImage(file, { alsoTryWithoutScanRegion: true });
      const data = String(result.data || "").trim();
      if (data) {
        renderResult(data);
      } else {
        setStatus("No QR code found in that image.", "fallback");
      }
    } catch (error) {
      routeContext.logger?.warn("QR image scan failed.", error);
      setStatus("No QR code found in that image.", "fallback");
    } finally {
      dom.imageInput.value = "";
    }
  }

  bind(routeContext, dom.againButton, "click", () => void startScan());
  bind(routeContext, dom.copyButton, "click", () => {
    if (!lastResult) return;
    const copy = navigator.clipboard?.writeText?.(lastResult);
    if (!copy) {
      setStatus("Copy is unavailable in this browser.", "result");
      return;
    }
    void copy
      .then(() => setStatus("Copied QR result.", "result"))
      .catch(() => setStatus("Copy is unavailable in this browser.", "result"));
  });
  bind(routeContext, dom.imageInput, "change", () => {
    const file = dom.imageInput.files?.[0];
    if (file) void scanImage(file);
  });

  void startScan({ auto: true });

  return {
    unmount() {
      destroyed = true;
      stopSession();
    },
  };
}

export function unmountQrScannerRoute(_routeContext: QrScannerRouteMountContext): void {
  // RouteView owns controller teardown through the MountedView returned above.
}
