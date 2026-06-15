import type {
  VatioQrCamera,
  VatioQrCameraSessionOptions,
  VatioQrImageScanOptions,
  VatioQrImageSource,
  VatioQrScanResult,
  VatioQrScannerService,
  VatioQrScannerSession,
} from "./types";

type QrScannerConstructor = typeof import("qr-scanner").default;
type QrScannerInstance = InstanceType<QrScannerConstructor>;
type LoadQrScanner = () => Promise<QrScannerConstructor>;

interface CreateBrowserQrScannerServiceOptions {
  loadQrScanner?: LoadQrScanner;
}

function normalizeScanResult(result: unknown): VatioQrScanResult {
  if (typeof result === "string") return { data: result };
  if (result && typeof result === "object") {
    const source = result as {
      data?: unknown;
      cornerPoints?: unknown;
    };
    const cornerPoints = Array.isArray(source.cornerPoints)
      ? source.cornerPoints
          .map((point) => {
            const nextPoint = point as { x?: unknown; y?: unknown };
            const x = Number(nextPoint.x);
            const y = Number(nextPoint.y);
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
          })
          .filter((point): point is { x: number; y: number } => Boolean(point))
      : undefined;
    return {
      data: String(source.data || ""),
      ...(cornerPoints?.length ? { cornerPoints } : {}),
    };
  }
  return { data: "" };
}

async function loadDefaultQrScanner(): Promise<QrScannerConstructor> {
  const module = await import("qr-scanner");
  return module.default;
}

export function createBrowserQrScannerService({
  loadQrScanner = loadDefaultQrScanner,
}: CreateBrowserQrScannerServiceOptions = {}): VatioQrScannerService {
  async function getQrScanner(): Promise<QrScannerConstructor> {
    return loadQrScanner();
  }

  return {
    async hasCamera() {
      const QrScanner = await getQrScanner();
      return QrScanner.hasCamera();
    },

    async listCameras(requestLabels = false): Promise<VatioQrCamera[]> {
      const QrScanner = await getQrScanner();
      return QrScanner.listCameras(requestLabels);
    },

    async createCameraSession(options: VatioQrCameraSessionOptions): Promise<VatioQrScannerSession> {
      const QrScanner = await getQrScanner();
      const scanner = new QrScanner(
        options.video,
        (result) => options.onResult(normalizeScanResult(result)),
        {
          onDecodeError: options.onError,
          preferredCamera: options.preferredCamera || "environment",
          maxScansPerSecond: options.maxScansPerSecond,
          highlightScanRegion: options.highlightScanRegion,
          highlightCodeOutline: options.highlightCodeOutline,
          overlay: options.overlay,
          returnDetailedScanResult: true,
        },
      );
      let active = false;
      let destroyed = false;

      const requireLiveScanner = (): QrScannerInstance => {
        if (destroyed) throw new Error("QR scanner session is destroyed.");
        return scanner;
      };

      return {
        async start() {
          await requireLiveScanner().start();
          active = true;
        },
        stop() {
          if (destroyed) return;
          scanner.stop();
          active = false;
        },
        destroy() {
          if (destroyed) return;
          scanner.destroy();
          active = false;
          destroyed = true;
        },
        async setCamera(facingModeOrDeviceId) {
          await requireLiveScanner().setCamera(facingModeOrDeviceId);
        },
        hasFlash: () => requireLiveScanner().hasFlash(),
        isFlashOn: () => requireLiveScanner().isFlashOn(),
        turnFlashOn: () => requireLiveScanner().turnFlashOn(),
        turnFlashOff: () => requireLiveScanner().turnFlashOff(),
        toggleFlash: () => requireLiveScanner().toggleFlash(),
        isActive: () => active && !destroyed,
      };
    },

    async scanImage(source: VatioQrImageSource, options: VatioQrImageScanOptions = {}) {
      const QrScanner = await getQrScanner();
      const scanImage = QrScanner.scanImage as (
        imageOrFileOrBlobOrUrl: unknown,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
      const result = await scanImage(source, {
        scanRegion: options.scanRegion || undefined,
        alsoTryWithoutScanRegion: options.alsoTryWithoutScanRegion,
        returnDetailedScanResult: true,
      });
      return normalizeScanResult(result);
    },
  };
}
