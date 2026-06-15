import type { DeliveryChecklistVehicleMetadata } from "./delivery-checklist-data.js";
import type {
  VatioQrScanRegion,
  VatioQrScanResult,
  VatioQrScannerService,
  VatioQrScannerSession,
} from "../../app-platform/types";

export type DeliveryVinComparisonState =
  | "not-scanned"
  | "manual"
  | "match"
  | "mismatch"
  | "backend-unavailable";

export interface DeliveryVinComparison {
  state: DeliveryVinComparisonState;
  scannedVin: string;
  backendVin: string;
}

export interface DeliveryVinScanResult {
  vin: string;
  rawText: string;
}

export interface DeliveryVinScannerSession {
  stop(): void;
  destroy(): void;
}

export interface StartDeliveryVinQrScannerOptions {
  video: HTMLVideoElement;
  onResult: (result: DeliveryVinScanResult) => void;
  onError?: (error: unknown) => void;
  qrScannerService?: VatioQrScannerService | null;
}

const VIN_PATTERN = /[A-HJ-NPR-Z0-9]{17}/;
const DELIVERY_VIN_SCAN_REGION_RATIO = 0.84;
const DELIVERY_VIN_SCAN_DOWNSCALE_SIZE = 480;

export function normalizeDeliveryVin(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "")
    .slice(0, 17);
}

export function extractDeliveryVinFromQrPayload(payload: unknown): string {
  const text = String(payload || "").toUpperCase();
  return text.match(VIN_PATTERN)?.[0] || "";
}

export function compareDeliveryWindshieldVin(
  metadata: DeliveryChecklistVehicleMetadata = {},
  setupMode: "manual" | "vatiolibre" | "choice" = "choice",
): DeliveryVinComparison {
  const scannedVin = normalizeDeliveryVin(metadata.windshieldVin);
  const backendVin = normalizeDeliveryVin(metadata.vin);

  if (!scannedVin) {
    return { state: "not-scanned", scannedVin: "", backendVin };
  }

  if (setupMode !== "vatiolibre") {
    return { state: "manual", scannedVin, backendVin };
  }

  if (!backendVin) {
    return { state: "backend-unavailable", scannedVin, backendVin: "" };
  }

  return {
    state: scannedVin === backendVin ? "match" : "mismatch",
    scannedVin,
    backendVin,
  };
}

export function calculateDeliveryVinScanRegion(video: HTMLVideoElement): VatioQrScanRegion {
  const videoWidth = Math.max(0, Math.round(video.videoWidth || 0));
  const videoHeight = Math.max(0, Math.round(video.videoHeight || 0));
  const minDimension = Math.min(videoWidth, videoHeight);
  const size = Math.round(minDimension * DELIVERY_VIN_SCAN_REGION_RATIO);
  const downScaledSize = Math.max(1, Math.min(DELIVERY_VIN_SCAN_DOWNSCALE_SIZE, size || DELIVERY_VIN_SCAN_DOWNSCALE_SIZE));

  return {
    x: Math.max(0, Math.round((videoWidth - size) / 2)),
    y: Math.max(0, Math.round((videoHeight - size) / 2)),
    width: size,
    height: size,
    downScaledWidth: downScaledSize,
    downScaledHeight: downScaledSize,
  };
}

function isExpectedNoQrError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error || "");
  return !message || /no qr code found/i.test(message);
}

function stopAndDestroy(session: VatioQrScannerSession | null): void {
  try {
    session?.stop();
  } finally {
    session?.destroy();
  }
}

export async function startDeliveryVinQrScanner({
  video,
  onResult,
  onError,
  qrScannerService = null,
}: StartDeliveryVinQrScannerOptions): Promise<DeliveryVinScannerSession> {
  if (!qrScannerService) {
    throw new Error("QR scanner service is not available.");
  }

  let stopped = false;
  let scannerSession: VatioQrScannerSession | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopAndDestroy(scannerSession);
    scannerSession = null;
  };

  video.playsInline = true;
  video.muted = true;

  try {
    scannerSession = await qrScannerService.createCameraSession({
      video,
      preferredCamera: "environment",
      maxScansPerSecond: 12,
      calculateScanRegion: calculateDeliveryVinScanRegion,
      highlightScanRegion: false,
      highlightCodeOutline: false,
      onResult(result: VatioQrScanResult) {
        if (stopped) return;
        const rawText = result.data;
        const vin = extractDeliveryVinFromQrPayload(rawText);
        if (vin) {
          onResult({ vin, rawText });
          stop();
        }
      },
      onError(error) {
        if (!isExpectedNoQrError(error)) onError?.(error);
      },
    });
    await scannerSession.start();
  } catch (error) {
    stop();
    throw error;
  }

  return {
    stop,
    destroy: stop,
  };
}
