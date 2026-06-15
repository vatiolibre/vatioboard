import type { DeliveryChecklistVehicleMetadata } from "./delivery-checklist-data.js";

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
}

export interface StartDeliveryVinQrScannerOptions {
  video: HTMLVideoElement;
  onResult: (result: DeliveryVinScanResult) => void;
  onError?: (error: unknown) => void;
  mediaDevices?: Pick<MediaDevices, "getUserMedia"> | null;
  createReader?: (() => Promise<DeliveryVinQrReader>) | null;
}

export interface DeliveryVinQrReader {
  decodeFromVideoElement(video: HTMLVideoElement, callback: (result: unknown, error?: unknown) => void): Promise<DeliveryVinQrControls | unknown> | DeliveryVinQrControls | unknown;
  reset?: () => void;
}

export interface DeliveryVinQrControls {
  stop?: () => void;
}

const VIN_PATTERN = /[A-HJ-NPR-Z0-9]{17}/;

function readResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const source = result as { getText?: () => unknown; text?: unknown };
    if (typeof source.getText === "function") return String(source.getText() || "");
    if (typeof source.text === "string") return source.text;
  }
  return "";
}

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

async function createDefaultQrReader(): Promise<DeliveryVinQrReader> {
  const module = await import("@zxing/browser");
  return new module.BrowserQRCodeReader();
}

export async function startDeliveryVinQrScanner({
  video,
  onResult,
  onError,
  mediaDevices = globalThis.navigator?.mediaDevices || null,
  createReader = createDefaultQrReader,
}: StartDeliveryVinQrScannerOptions): Promise<DeliveryVinScannerSession> {
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not available in this browser.");
  }

  const stream = await mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
    },
    audio: false,
  });
  let stopped = false;
  let reader: DeliveryVinQrReader | null = null;
  let controls: DeliveryVinQrControls | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      controls?.stop?.();
    } catch {
      // Decoder controls can already be disposed after a successful scan.
    }
    try {
      reader?.reset?.();
    } catch {
      // Some browser implementations throw if reset races decode cleanup.
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    video.pause();
    video.srcObject = null;
  };

  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);

  try {
    reader = await createReader();
    const decodeControls = await reader.decodeFromVideoElement(video, (result, error) => {
      if (stopped) return;
      if (result) {
        const rawText = readResultText(result);
        const vin = extractDeliveryVinFromQrPayload(rawText);
        if (vin) {
          onResult({ vin, rawText });
          stop();
        }
      } else if (error) {
        const name = String((error as { name?: unknown })?.name || "");
        if (name && !/notfound/i.test(name)) onError?.(error);
      }
    });
    controls = decodeControls && typeof decodeControls === "object"
      ? decodeControls as DeliveryVinQrControls
      : null;
  } catch (error) {
    stop();
    throw error;
  }

  return { stop };
}
