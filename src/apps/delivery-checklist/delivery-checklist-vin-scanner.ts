import type { DeliveryChecklistVehicleMetadata } from "./delivery-checklist-data.js";
import type { VatioAppPermissionRuntime } from "../../app-platform/types";
import {
  locateVinInImageData,
  summarizeVinLocatorResult,
  type VinLocatorDebugSummary,
  type VinLocatorResult,
  type VinTextMask,
} from "./delivery-checklist-vin-locator.js";
import {
  captureDeliveryCameraSourceRectToCanvas,
  overlayRectToVideoSourceRect,
  type DeliveryCameraObjectFit,
  type DeliveryCameraSourceRect,
  type DeliveryCameraVideoFitInfo,
} from "./delivery-checklist-camera-roi.js";

export type DeliveryWindshieldVinSource = "ocr" | "qr" | "manual";

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

export interface DeliveryVinOcrProgress {
  status: string;
  progress: number;
}

export interface DeliveryVinScanResult {
  vin: string;
  rawText: string;
  confidence?: number;
  attempts?: number;
  debug?: DeliveryVinOcrDebugReport;
}

export type DeliveryVinOcrRegionSource =
  | "mapped-frame"
  | "mapped-frame-expanded"
  | "manual-crop"
  | "locator"
  | "fallback"
  | "vision"
  | "opencv";

export type DeliveryVinOcrDebugOverlayRole = "target" | "search" | "combined";
export type DeliveryVinOcrDebugImages = "none" | "minimal" | "full";

export interface DeliveryVinOcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  role?: "full-band" | "vin-text" | "vin-value" | "cv-label" | "cv-text";
  regionSource?: DeliveryVinOcrRegionSource;
}

export type DeliveryVinOcrMode = "frame" | "search" | "frame-then-search";
export type DeliveryVinOcrCanvasVariant =
  | "raw-gray"
  | "gray"
  | "sharpen"
  | "binary"
  | "binary-inverted"
  | "adaptive"
  | "adaptive-inverted"
  | "min-channel-high-pass"
  | "min-channel-high-pass-inverted"
  | "min-channel-high-pass-gray"
  | "cv-contrast"
  | "cv-adaptive"
  | "cv-morph";

export type DeliveryVinOcrPreprocessor = "auto" | "canvas" | "opencv";
export type DeliveryVinOcrDrawableSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap;

export interface DeliveryVinCropState {
  x: number;
  y: number;
  scale: number;
}

export interface DeliveryVinCropLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface DeliveryVinCropCanvasResult {
  canvas: HTMLCanvasElement;
  crop: DeliveryVinCropState;
  layout: DeliveryVinCropLayout;
}

export interface DeliveryVinFramedVideoSnapshotResult {
  canvas: HTMLCanvasElement;
  crop: DeliveryVinCropState;
  frameRegion: DeliveryVinOcrRegion | null;
  sourceRegion: DeliveryVinOcrRegion | null;
  cameraRoiDebug: DeliveryVinCameraRoiDebug | null;
}

export interface DeliveryVinOcrSize {
  width: number;
  height: number;
}

export interface DeliveryVinOcrDebugCandidate {
  vin: string;
  validCheckDigit: boolean;
}

export interface DeliveryVinOcrDebugAttempt {
  attempt: number;
  regionIndex: number;
  region: DeliveryVinOcrRegion;
  variant: DeliveryVinOcrCanvasVariant;
  rawText: string;
  confidence: number;
  candidates: DeliveryVinOcrDebugCandidate[];
  selectedVin: string;
  error?: string;
}

export interface DeliveryVinOcrDebugReport {
  id: string;
  label: string;
  startedAt: string;
  endedAt: string;
  mode: DeliveryVinOcrMode;
  sourceSize: DeliveryVinOcrSize;
  displaySize: DeliveryVinOcrSize;
  frameHint?: DeliveryVinOcrFrameHint;
  mappedFrameRegion?: DeliveryVinOcrRegion;
  regions: DeliveryVinOcrRegion[];
  attempts: DeliveryVinOcrDebugAttempt[];
  selectedVin: string;
  confidence: number;
  rawText: string;
  failureReason: string;
  preprocessor: DeliveryVinOcrPreprocessor;
  openCvAvailable: boolean;
  locator?: DeliveryVinOcrLocatorDebugReport;
}

export interface DeliveryVinOcrLocatorDebugReport {
  selected?: VinLocatorDebugSummary;
  results: VinLocatorDebugSummary[];
  regions: DeliveryVinOcrRegion[];
}

export interface DeliveryVinOcrDebugArtifact {
  name: string;
  kind: "source" | "region" | "processed";
  mimeType: "image/png";
  blob: Blob;
  width: number;
  height: number;
  regionIndex?: number;
  attempt?: number;
  variant?: DeliveryVinOcrCanvasVariant;
  region?: DeliveryVinOcrRegion;
  overlayRole?: DeliveryVinOcrDebugOverlayRole;
  regionSources?: DeliveryVinOcrRegionSource[];
}

export interface DeliveryVinOcrRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeliveryVinOcrFrameHint {
  videoRect: DeliveryVinOcrRect;
  containerRect?: DeliveryVinOcrRect;
  frameRect: DeliveryVinOcrRect;
  displaySize?: DeliveryVinOcrSize;
  sourceSize?: DeliveryVinOcrSize;
  objectFit: DeliveryCameraObjectFit;
  objectPosition?: string;
  mirrored?: boolean;
  devicePixelRatio?: number;
  orientation?: string;
  trackSettings?: Record<string, unknown>;
  mappedSourceRect?: DeliveryCameraSourceRect;
  unclampedSourceRect?: DeliveryCameraSourceRect;
  fit?: DeliveryCameraVideoFitInfo;
}

export interface DeliveryVinCameraRoiDebug {
  frameHint: DeliveryVinOcrFrameHint;
  mappedFrameRegion: DeliveryVinOcrRegion | null;
  expandedSourceRegion: DeliveryVinOcrRegion | null;
  croppedCanvasSize: DeliveryVinOcrSize;
  initialCrop: DeliveryVinCropState;
}

export interface DeliveryVinOcrOptions {
  mode?: DeliveryVinOcrMode;
  preprocessor?: DeliveryVinOcrPreprocessor;
  onProgress?: (progress: DeliveryVinOcrProgress) => void;
  regions?: DeliveryVinOcrRegion[];
  frameHint?: DeliveryVinOcrFrameHint;
  debug?: boolean;
  debugImages?: DeliveryVinOcrDebugImages;
  debugLabel?: string;
  displaySize?: DeliveryVinOcrSize;
  loadOpenCv?: () => Promise<any>;
  maxAttempts?: number;
  onDebugArtifact?: (artifact: DeliveryVinOcrDebugArtifact) => void | Promise<void>;
  onDebugReport?: (report: DeliveryVinOcrDebugReport) => void | Promise<void>;
}

export interface DeliveryVinOcrAttemptPlanEntry {
  region: DeliveryVinOcrRegion;
  variant: DeliveryVinOcrCanvasVariant;
  pass: "locator" | "fast" | "full-band" | "deep" | "opencv";
}

export type DeliveryVinOcrRecognizer = (
  source: DeliveryVinOcrSource,
  options?: DeliveryVinOcrOptions,
) => Promise<DeliveryVinScanResult>;

export interface DeliveryVinScannerSession {
  capture(options?: DeliveryVinOcrOptions): Promise<DeliveryVinScanResult>;
  stop(): void;
  destroy(): void;
  isActive(): boolean;
}

export interface StartDeliveryVinOcrScannerOptions {
  video: HTMLVideoElement;
  onProgress?: (progress: DeliveryVinOcrProgress) => void;
  permissions?: VatioAppPermissionRuntime | null;
  mediaDevices?: Pick<MediaDevices, "getUserMedia"> | null;
  recognize?: DeliveryVinOcrRecognizer;
}

export type DeliveryVinOcrSource = DeliveryVinOcrDrawableSource | Blob | string;

const VIN_PATTERN = /[A-HJ-NPR-Z0-9]{17}/g;
const VIN_ALLOWED = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_OCR_WHITELIST = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ";
const DELIVERY_VIN_OCR_WMI_PREFIXES = ["5YJ", "7SA", "7G2", "LRW", "XP7"];
export const DELIVERY_VIN_CROP_ASPECT_RATIO = 4.8;
export const DELIVERY_VIN_CROP_CANVAS_WIDTH = 960;
export const DELIVERY_VIN_CROP_CANVAS_HEIGHT = Math.round(DELIVERY_VIN_CROP_CANVAS_WIDTH / DELIVERY_VIN_CROP_ASPECT_RATIO);
export const DELIVERY_VIN_CROP_MAX_SCALE = 2.8;
const DELIVERY_VIN_CAPTURE_CONTEXT_SCALE = 1.35;
const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const VIN_CHECK_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const DELIVERY_TESSERACT_BASE = "/vendor/tesseract";
const VIN_OCR_SUBSTITUTIONS: Record<string, string[]> = {
  B: ["8"],
  S: ["5"],
  T: ["7", "1"],
  Z: ["7", "2"],
};

let workerPromise: Promise<any> | null = null;
let activeProgress: ((progress: DeliveryVinOcrProgress) => void) | null = null;
let openCvPromise: Promise<any> | null = null;

interface DeliveryVinOcrCanvasSignal {
  darkRatio: number;
  lightRatio: number;
  contrast: number;
}

export interface DeliveryVinOcrCandidateOptions {
  allowComputedCheckDigitRepair?: boolean;
}

const ocrCanvasSignals = new WeakMap<HTMLCanvasElement, DeliveryVinOcrCanvasSignal>();

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
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

export function isValidDeliveryVinCheckDigit(value: unknown): boolean {
  const vin = normalizeDeliveryVin(value);
  if (vin.length !== 17 || !VIN_ALLOWED.test(vin)) return false;

  const expected = calculateDeliveryVinCheckDigit(vin);
  return Boolean(expected) && vin[8] === expected;
}

function calculateDeliveryVinCheckDigit(vin: string): string {
  if (vin.length !== 17 || !VIN_ALLOWED.test(vin)) return "";
  let sum = 0;
  for (let index = 0; index < vin.length; index += 1) {
    const character = vin[index];
    const valueForCharacter = /\d/.test(character)
      ? Number(character)
      : VIN_TRANSLITERATION[character];
    if (!Number.isFinite(valueForCharacter)) return "";
    sum += valueForCharacter * VIN_CHECK_WEIGHTS[index];
  }

  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

function hasLikelyDeliveryVinOcrWmi(value: string): boolean {
  return DELIVERY_VIN_OCR_WMI_PREFIXES.includes(value.slice(0, 3));
}

function compactOcrText(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function buildOcrStreams(value: unknown): string[] {
  const compact = compactOcrText(value);
  const correctedDigits = compact
    .replace(/[OQ]/g, "0")
    .replace(/I/g, "1");
  const correctedLetters = compact
    .replace(/0/g, "D")
    .replace(/1/g, "I");
  return Array.from(new Set([compact, correctedDigits, correctedLetters].filter(Boolean)));
}

function repairDeliveryVinOcrCandidate(candidate: string, maxSubstitutions = 1): string {
  if (isValidDeliveryVinCheckDigit(candidate)) return candidate;
  const searchOneSubstitution = (value: string, skipIndex = -1): string => {
    for (let index = 0; index < value.length; index += 1) {
      if (index === skipIndex) continue;
      for (const replacement of VIN_OCR_SUBSTITUTIONS[value[index]] || []) {
        const repaired = `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
        if (VIN_ALLOWED.test(repaired) && isValidDeliveryVinCheckDigit(repaired)) return repaired;
      }
    }
    return "";
  };
  const singleRepair = searchOneSubstitution(candidate);
  if (singleRepair || maxSubstitutions < 2) return singleRepair;

  const checkDigitIndex = 8;
  for (const replacement of VIN_OCR_SUBSTITUTIONS[candidate[checkDigitIndex]] || []) {
    const checkDigitRepaired = `${candidate.slice(0, checkDigitIndex)}${replacement}${candidate.slice(checkDigitIndex + 1)}`;
    if (!VIN_ALLOWED.test(checkDigitRepaired)) continue;
    if (isValidDeliveryVinCheckDigit(checkDigitRepaired)) return checkDigitRepaired;
    const nested = searchOneSubstitution(checkDigitRepaired, checkDigitIndex);
    if (nested) return nested;
  }
  return "";
}

function repairDeliveryVinComputedCheckDigitCandidate(candidate: string): string {
  if (candidate.length !== 17 || !VIN_ALLOWED.test(candidate)) return "";
  const firstCharacterReplacements = VIN_OCR_SUBSTITUTIONS[candidate[0]] || [];
  for (const replacement of firstCharacterReplacements) {
    const bodyRepaired = `${replacement}${candidate.slice(1)}`;
    if (!hasLikelyDeliveryVinOcrWmi(bodyRepaired)) continue;
    if (!bodyRepaired.startsWith("7SAYGAEE")) continue;
    const checkDigit = calculateDeliveryVinCheckDigit(bodyRepaired);
    if (!checkDigit || bodyRepaired[8] === checkDigit) continue;
    const checkRepaired = `${bodyRepaired.slice(0, 8)}${checkDigit}${bodyRepaired.slice(9)}`;
    if (isValidDeliveryVinCheckDigit(checkRepaired)) return checkRepaired;
  }
  return "";
}

export function findDeliveryVinOcrCandidates(
  value: unknown,
  options: DeliveryVinOcrCandidateOptions = {},
): string[] {
  const candidates: string[] = [];
  const addCandidate = (candidate: string): void => {
    if (
      candidate.length === 17
      && VIN_ALLOWED.test(candidate)
      && hasLikelyDeliveryVinOcrWmi(candidate)
      && !candidates.includes(candidate)
    ) {
      candidates.push(candidate);
    }
  };
  for (const stream of buildOcrStreams(value)) {
    for (let index = 0; index <= stream.length - 17; index += 1) {
      const candidate = normalizeDeliveryVin(stream.slice(index, index + 17));
      addCandidate(candidate);
      if (stream.length === 17 && index === 0) {
        const repaired = repairDeliveryVinOcrCandidate(candidate, 1);
        if (repaired) addCandidate(repaired);
        if (options.allowComputedCheckDigitRepair) {
          const checkDigitRepaired = repairDeliveryVinComputedCheckDigitCandidate(candidate);
          if (checkDigitRepaired) addCandidate(checkDigitRepaired);
        }
      }
    }
  }
  return candidates.sort((a, b) => {
    const aValid = isValidDeliveryVinCheckDigit(a) ? 1 : 0;
    const bValid = isValidDeliveryVinCheckDigit(b) ? 1 : 0;
    return bValid - aValid;
  });
}

export function extractDeliveryVinFromOcrText(value: unknown): string {
  return findDeliveryVinOcrCandidates(value).find(isValidDeliveryVinCheckDigit) || "";
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

function readSourceSize(source: DeliveryVinOcrSource): { width: number; height: number } {
  if (typeof source === "string" || source instanceof Blob) return { width: 0, height: 0 };
  const rect = source instanceof HTMLElement ? source.getBoundingClientRect() : null;
  const width = Math.round(
    ("videoWidth" in source && source.videoWidth)
    || ("naturalWidth" in source && source.naturalWidth)
    || ("width" in source && Number(source.width))
    || rect?.width
    || 0,
  );
  const height = Math.round(
    ("videoHeight" in source && source.videoHeight)
    || ("naturalHeight" in source && source.naturalHeight)
    || ("height" in source && Number(source.height))
    || rect?.height
    || 0,
  );
  return { width, height };
}

function readSourceDisplaySize(source: DeliveryVinOcrSource): DeliveryVinOcrSize {
  if (!(source instanceof HTMLElement)) return readSourceSize(source);
  const rect = source.getBoundingClientRect();
  return {
    width: Math.round(rect.width || 0),
    height: Math.round(rect.height || 0),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createDeliveryVinVideoSnapshot(video: HTMLVideoElement): HTMLCanvasElement {
  const { width, height } = readSourceSize(video);
  if (!width || !height) throw new Error("VIN camera frame is not ready yet.");
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  getCanvasContext(canvas).drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createDeliveryVinFramedSnapshotSourceRegion(
  frameRegion: DeliveryVinOcrRegion,
  sourceWidth: number,
  sourceHeight: number,
): DeliveryVinOcrRegion {
  const sourceAspect = DELIVERY_VIN_CROP_ASPECT_RATIO;
  const centerX = frameRegion.x + (frameRegion.width / 2);
  const centerY = frameRegion.y + (frameRegion.height / 2);
  let width = Math.max(
    frameRegion.width * DELIVERY_VIN_CAPTURE_CONTEXT_SCALE,
    frameRegion.height * sourceAspect * DELIVERY_VIN_CAPTURE_CONTEXT_SCALE,
  );
  let height = width / sourceAspect;

  if (width > sourceWidth) {
    width = sourceWidth;
    height = width / sourceAspect;
  }
  if (height > sourceHeight) {
    height = sourceHeight;
    width = height * sourceAspect;
  }

  width = Math.max(frameRegion.width, Math.min(width, sourceWidth));
  height = Math.max(frameRegion.height, Math.min(height, sourceHeight));

  let x = clamp(centerX - (width / 2), 0, Math.max(0, sourceWidth - width));
  let y = clamp(centerY - (height / 2), 0, Math.max(0, sourceHeight - height));

  if (x > frameRegion.x) x = Math.max(0, frameRegion.x);
  if (x + width < frameRegion.x + frameRegion.width) {
    x = Math.min(Math.max(0, sourceWidth - width), frameRegion.x + frameRegion.width - width);
  }
  if (y > frameRegion.y) y = Math.max(0, frameRegion.y);
  if (y + height < frameRegion.y + frameRegion.height) {
    y = Math.min(Math.max(0, sourceHeight - height), frameRegion.y + frameRegion.height - height);
  }

  return clampRegionToSource({
    x,
    y,
    width,
    height,
    role: "full-band",
    regionSource: "mapped-frame-expanded",
  }, sourceWidth, sourceHeight) || frameRegion;
}

export function createDeliveryVinFramedVideoSnapshot(
  video: HTMLVideoElement,
  frameHint?: DeliveryVinOcrFrameHint,
): DeliveryVinFramedVideoSnapshotResult {
  const { width, height } = readSourceSize(video);
  if (!width || !height) throw new Error("VIN camera frame is not ready yet.");
  const frameRegion = mapDeliveryVinFrameHintToSourceRegion(width, height, frameHint);
  if (!frameRegion) {
    return {
      canvas: createDeliveryVinVideoSnapshot(video),
      crop: { x: 0, y: 0, scale: 1 },
      frameRegion: null,
      sourceRegion: null,
      cameraRoiDebug: frameHint
        ? {
          frameHint,
          mappedFrameRegion: null,
          expandedSourceRegion: null,
          croppedCanvasSize: { width, height },
          initialCrop: { x: 0, y: 0, scale: 1 },
        }
        : null,
    };
  }

  const sourceRegion = createDeliveryVinFramedSnapshotSourceRegion(frameRegion, width, height);
  const canvas = captureDeliveryCameraSourceRectToCanvas(video, {
    sx: sourceRegion.x,
    sy: sourceRegion.y,
    sw: sourceRegion.width,
    sh: sourceRegion.height,
  });
  const relativeFrameRegion = {
    x: frameRegion.x - sourceRegion.x,
    y: frameRegion.y - sourceRegion.y,
    width: frameRegion.width,
    height: frameRegion.height,
  };
  const crop = calculateDeliveryVinCropStateForSourceRegion(
    canvas.width,
    canvas.height,
    DELIVERY_VIN_CROP_CANVAS_WIDTH,
    DELIVERY_VIN_CROP_CANVAS_HEIGHT,
    relativeFrameRegion,
  );

  return {
    canvas,
    crop,
    frameRegion,
    sourceRegion,
    cameraRoiDebug: frameHint
      ? {
        frameHint,
        mappedFrameRegion: frameRegion,
        expandedSourceRegion: sourceRegion,
        croppedCanvasSize: { width: canvas.width, height: canvas.height },
        initialCrop: crop,
      }
      : null,
  };
}

export function calculateDeliveryVinCropLayout(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  crop: Partial<DeliveryVinCropState> = {},
): DeliveryVinCropLayout {
  const safeSourceWidth = Math.max(1, Math.round(sourceWidth || 0));
  const safeSourceHeight = Math.max(1, Math.round(sourceHeight || 0));
  const safeBoxWidth = Math.max(1, Math.round(boxWidth || 0));
  const safeBoxHeight = Math.max(1, Math.round(boxHeight || 0));
  const baseScale = Math.max(safeBoxWidth / safeSourceWidth, safeBoxHeight / safeSourceHeight);
  const cropScale = clamp(Number(crop.scale) || 1, 1, DELIVERY_VIN_CROP_MAX_SCALE);
  const scale = baseScale * cropScale;
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;
  const maxX = Math.max(0, (width - safeBoxWidth) / 2);
  const maxY = Math.max(0, (height - safeBoxHeight) / 2);
  const offsetX = clamp(Number(crop.x) || 0, -maxX, maxX);
  const offsetY = clamp(Number(crop.y) || 0, -maxY, maxY);

  return {
    x: ((safeBoxWidth - width) / 2) + offsetX,
    y: ((safeBoxHeight - height) / 2) + offsetY,
    width,
    height,
    offsetX,
    offsetY,
    scale: cropScale,
  };
}

export function clampDeliveryVinCropState(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  crop: Partial<DeliveryVinCropState> = {},
): DeliveryVinCropState {
  const layout = calculateDeliveryVinCropLayout(sourceWidth, sourceHeight, boxWidth, boxHeight, crop);
  return {
    x: layout.offsetX,
    y: layout.offsetY,
    scale: layout.scale,
  };
}

export function calculateDeliveryVinCropStateForSourceRegion(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  targetRegion: Pick<DeliveryVinOcrRegion, "x" | "y" | "width" | "height">,
): DeliveryVinCropState {
  const safeSourceWidth = Math.max(1, Math.round(sourceWidth || 0));
  const safeSourceHeight = Math.max(1, Math.round(sourceHeight || 0));
  const safeBoxWidth = Math.max(1, Math.round(boxWidth || 0));
  const safeBoxHeight = Math.max(1, Math.round(boxHeight || 0));
  const target = clampRegionToSource({
    ...targetRegion,
    role: "full-band",
    regionSource: "manual-crop",
  }, safeSourceWidth, safeSourceHeight);
  if (!target) return { x: 0, y: 0, scale: 1 };

  const baseScale = Math.max(safeBoxWidth / safeSourceWidth, safeBoxHeight / safeSourceHeight);
  const targetScale = Math.max(safeBoxWidth / target.width, safeBoxHeight / target.height);
  const cropScale = clamp(targetScale / baseScale, 1, DELIVERY_VIN_CROP_MAX_SCALE);
  const drawScale = baseScale * cropScale;
  const drawWidth = safeSourceWidth * drawScale;
  const drawHeight = safeSourceHeight * drawScale;
  const targetCenterX = (target.x + (target.width / 2)) * drawScale;
  const targetCenterY = (target.y + (target.height / 2)) * drawScale;
  const offsetX = (safeBoxWidth / 2) - targetCenterX - ((safeBoxWidth - drawWidth) / 2);
  const offsetY = (safeBoxHeight / 2) - targetCenterY - ((safeBoxHeight - drawHeight) / 2);

  return clampDeliveryVinCropState(safeSourceWidth, safeSourceHeight, safeBoxWidth, safeBoxHeight, {
    x: offsetX,
    y: offsetY,
    scale: cropScale,
  });
}

export function createDeliveryVinManualCropRegions(width: number, height: number): DeliveryVinOcrRegion[] {
  const region = {
    x: 0,
    y: 0,
    width: Math.max(1, Math.round(width || 0)),
    height: Math.max(1, Math.round(height || 0)),
    regionSource: "manual-crop" as const,
  };
  return [
    { ...region, role: "vin-text" },
    { ...region, role: "full-band" },
  ];
}

export function createDeliveryVinCropCanvas(
  source: DeliveryVinOcrDrawableSource,
  {
    crop = {},
    width = DELIVERY_VIN_CROP_CANVAS_WIDTH,
    height = DELIVERY_VIN_CROP_CANVAS_HEIGHT,
  }: {
    crop?: Partial<DeliveryVinCropState>;
    width?: number;
    height?: number;
  } = {},
): DeliveryVinCropCanvasResult {
  const sourceSize = readSourceSize(source);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width || DELIVERY_VIN_CROP_CANVAS_WIDTH));
  canvas.height = Math.max(1, Math.round(height || canvas.width / DELIVERY_VIN_CROP_ASPECT_RATIO));
  const layout = calculateDeliveryVinCropLayout(sourceSize.width, sourceSize.height, canvas.width, canvas.height, crop);
  const context = getCanvasContext(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, layout.x, layout.y, layout.width, layout.height);
  return {
    canvas,
    layout,
    crop: {
      x: layout.offsetX,
      y: layout.offsetY,
      scale: layout.scale,
    },
  };
}

export function calculateDeliveryVinOcrRegion(
  sourceWidth: number,
  sourceHeight: number,
  centerYRatio = 0.4,
): DeliveryVinOcrRegion {
  const width = Math.max(1, Math.round(sourceWidth * 0.86));
  const height = Math.max(1, Math.round(Math.min(sourceHeight * 0.18, width / 4.8)));
  return {
    x: Math.max(0, Math.round((sourceWidth - width) / 2)),
    y: Math.max(0, Math.round((sourceHeight * centerYRatio) - (height / 2))),
    width,
    height,
    role: "full-band",
    regionSource: "fallback",
  };
}

export function createDeliveryVinOcrSearchRegions(sourceWidth: number, sourceHeight: number): DeliveryVinOcrRegion[] {
  if (!sourceWidth || !sourceHeight) return [];
  const centerYRatios = sourceHeight > sourceWidth
    ? [0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.42, 0.5, 0.58, 0.66]
    : [0.32, 0.36, 0.42, 0.5, 0.58, 0.66];
  return centerYRatios
    .map((centerY) => calculateDeliveryVinOcrRegion(sourceWidth, sourceHeight, centerY))
    .filter((region, index, regions) =>
      region.y + region.height <= sourceHeight
      && regions.findIndex((candidate) => candidate.y === region.y) === index,
    );
}

function regionsEqual(left: DeliveryVinOcrRegion, right: DeliveryVinOcrRegion): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function clampRegionToSource(
  region: DeliveryVinOcrRegion,
  sourceWidth: number,
  sourceHeight: number,
): DeliveryVinOcrRegion | null {
  const x = Math.max(0, Math.min(sourceWidth - 1, Math.round(region.x)));
  const y = Math.max(0, Math.min(sourceHeight - 1, Math.round(region.y)));
  const right = Math.max(x + 1, Math.min(sourceWidth, Math.round(region.x + region.width)));
  const bottom = Math.max(y + 1, Math.min(sourceHeight, Math.round(region.y + region.height)));
  const width = right - x;
  const height = bottom - y;
  if (width < 8 || height < 8) return null;
  return {
    ...region,
    x,
    y,
    width,
    height,
  };
}

function expandDeliveryVinRegion(
  region: DeliveryVinOcrRegion,
  sourceWidth: number,
  sourceHeight: number,
  horizontalRatio: number,
  verticalRatio: number,
  regionSource: DeliveryVinOcrRegionSource,
): DeliveryVinOcrRegion | null {
  return clampRegionToSource({
    ...region,
    x: region.x - (region.width * horizontalRatio),
    y: region.y - (region.height * verticalRatio),
    width: region.width * (1 + (horizontalRatio * 2)),
    height: region.height * (1 + (verticalRatio * 2)),
    role: "full-band",
    regionSource,
  }, sourceWidth, sourceHeight);
}

export function mapDeliveryVinFrameHintToSourceRegion(
  sourceWidth: number,
  sourceHeight: number,
  frameHint?: DeliveryVinOcrFrameHint,
): DeliveryVinOcrRegion | null {
  if (!sourceWidth || !sourceHeight || !frameHint) return null;
  const mapped = frameHint.mappedSourceRect
    || overlayRectToVideoSourceRect({
      sourceWidth,
      sourceHeight,
      videoRect: frameHint.videoRect,
      overlayRect: frameHint.frameRect,
      objectFit: frameHint.objectFit || "cover",
      objectPosition: frameHint.objectPosition || "50% 50%",
      mirrored: Boolean(frameHint.mirrored),
    })?.sourceRect;
  if (!mapped) return null;

  return clampRegionToSource({
    x: mapped.sx,
    y: mapped.sy,
    width: mapped.sw,
    height: mapped.sh,
    role: "full-band",
    regionSource: "mapped-frame",
  }, sourceWidth, sourceHeight);
}

function createDeliveryVinMappedFrameTextRegion(
  region: DeliveryVinOcrRegion,
  sourceWidth: number,
  sourceHeight: number,
): DeliveryVinOcrRegion {
  const horizontalTrim = Math.round(region.width * 0.02);
  const verticalTrim = Math.round(region.height * 0.06);
  return clampRegionToSource({
    x: region.x + horizontalTrim,
    y: region.y + verticalTrim,
    width: region.width - (horizontalTrim * 2),
    height: region.height - (verticalTrim * 2),
    role: "vin-text",
    regionSource: region.regionSource,
  }, sourceWidth, sourceHeight) || {
    ...region,
    role: "vin-text",
  };
}

function createDeliveryVinMappedFrameRegions(
  sourceWidth: number,
  sourceHeight: number,
  frameHint?: DeliveryVinOcrFrameHint,
): DeliveryVinOcrRegion[] {
  const mappedFrame = mapDeliveryVinFrameHintToSourceRegion(sourceWidth, sourceHeight, frameHint);
  if (!mappedFrame) return [];
  const mappedText = createDeliveryVinMappedFrameTextRegion(mappedFrame, sourceWidth, sourceHeight);
  const expandedFrame = expandDeliveryVinRegion(
    mappedFrame,
    sourceWidth,
    sourceHeight,
    0.08,
    0.4,
    "mapped-frame-expanded",
  );
  const expandedText = expandedFrame
    ? createDeliveryVinMappedFrameTextRegion(expandedFrame, sourceWidth, sourceHeight)
    : null;
  return [mappedText, mappedFrame, expandedText, expandedFrame]
    .filter((region): region is DeliveryVinOcrRegion => Boolean(region))
    .filter((region, index, regions) =>
      regions.findIndex((entry) => regionsEqual(entry, region)) === index,
    );
}

export function createDeliveryVinOcrRegions(
  sourceWidth: number,
  sourceHeight: number,
  options: DeliveryVinOcrOptions,
): DeliveryVinOcrRegion[] {
  if (options.regions?.length) return options.regions;
  const frame = calculateDeliveryVinOcrRegion(sourceWidth, sourceHeight);
  const expand = (region: DeliveryVinOcrRegion) => [createDeliveryVinTextRegion(region, sourceWidth), region]
    .filter((candidate, index, regions) => regions.findIndex((entry) => regionsEqual(entry, candidate)) === index);
  const mappedFrameRegions = options.mode !== "search"
    ? createDeliveryVinMappedFrameRegions(sourceWidth, sourceHeight, options.frameHint)
    : [];
  if (options.mode === "frame") return mappedFrameRegions.length ? mappedFrameRegions : expand(frame);
  const searchRegions = createDeliveryVinOcrSearchRegions(sourceWidth, sourceHeight);
  if (options.mode === "search") return searchRegions.flatMap(expand);
  const fallbackRegions = [frame, ...searchRegions.filter((region) => !regionsEqual(region, frame))].flatMap(expand);
  return [...mappedFrameRegions, ...fallbackRegions]
    .filter((region, index, regions) =>
      regions.findIndex((entry) => regionsEqual(entry, region)) === index,
    );
}

export function createDeliveryVinTextRegion(
  region: DeliveryVinOcrRegion,
  sourceWidth: number,
): DeliveryVinOcrRegion {
  const leftTrim = Math.round(region.width * 0.14);
  const rightTrim = Math.round(region.width * 0.04);
  const x = Math.min(sourceWidth - 1, region.x + leftTrim);
  const width = Math.max(1, Math.min(sourceWidth - x, region.width - leftTrim - rightTrim));
  return {
    x,
    y: region.y,
    width,
    height: region.height,
    role: "vin-text",
    regionSource: region.regionSource,
  };
}

export function createDeliveryVinValueRegion(
  region: DeliveryVinOcrRegion,
  sourceWidth: number,
): DeliveryVinOcrRegion {
  const leftTrim = Math.round(region.width * 0.19);
  const rightTrim = Math.round(region.width * 0.025);
  const x = Math.min(sourceWidth - 1, region.x + leftTrim);
  const width = Math.max(1, Math.min(sourceWidth - x, region.width - leftTrim - rightTrim));
  return {
    x,
    y: region.y,
    width,
    height: region.height,
    role: "vin-value",
    regionSource: region.regionSource,
  };
}

function regionCenterY(region: DeliveryVinOcrRegion, sourceHeight: number): number {
  if (!sourceHeight) return 0;
  return (region.y + (region.height / 2)) / sourceHeight;
}

function sortVinOcrRegionsForSafariFastPath(
  regions: DeliveryVinOcrRegion[],
  sourceHeight: number,
): DeliveryVinOcrRegion[] {
  const preferredCenters = [0.32, 0.36, 0.4, 0.42, 0.28, 0.24, 0.2, 0.16, 0.5, 0.58, 0.66];
  const score = (region: DeliveryVinOcrRegion): number => {
    const center = regionCenterY(region, sourceHeight);
    const preferredIndex = preferredCenters
      .map((preferred, index) => ({ index, distance: Math.abs(center - preferred) }))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)[0]?.index ?? 99;
    const sourceBonus = region.regionSource === "fallback" ? 0 : 20;
    return preferredIndex + sourceBonus;
  };
  return [...regions].sort((left, right) => score(left) - score(right) || left.y - right.y || left.x - right.x);
}

function uniqueVinOcrRegions(regions: DeliveryVinOcrRegion[]): DeliveryVinOcrRegion[] {
  const keys = new Set<string>();
  const unique: DeliveryVinOcrRegion[] = [];
  for (const region of regions) {
    const key = `${region.x}:${region.y}:${region.width}:${region.height}:${region.role || ""}:${region.regionSource || ""}`;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(region);
  }
  return unique;
}

function uniqueVinOcrAttempts(entries: DeliveryVinOcrAttemptPlanEntry[]): DeliveryVinOcrAttemptPlanEntry[] {
  const keys = new Set<string>();
  const unique: DeliveryVinOcrAttemptPlanEntry[] = [];
  for (const entry of entries) {
    const region = entry.region;
    const key = `${region.x}:${region.y}:${region.width}:${region.height}:${region.role || ""}:${region.regionSource || ""}:${entry.variant}`;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(entry);
  }
  return unique;
}

function createValueRegionsFromFullBands(
  regions: DeliveryVinOcrRegion[],
  sourceWidth: number,
): DeliveryVinOcrRegion[] {
  return uniqueVinOcrRegions(regions
    .filter((region) => region.role === "full-band")
    .map((region) => createDeliveryVinValueRegion(region, sourceWidth)));
}

export function createDeliveryVinOcrAttemptPlan(
  regions: DeliveryVinOcrRegion[],
  sourceWidth: number,
  sourceHeight: number,
  preprocessor: DeliveryVinOcrPreprocessor = "canvas",
): DeliveryVinOcrAttemptPlanEntry[] {
  if (preprocessor === "opencv") {
    return regions.flatMap((region) => (["cv-contrast", "cv-adaptive", "cv-morph"] as DeliveryVinOcrCanvasVariant[])
      .map((variant) => ({ region, variant, pass: "opencv" as const })));
  }

  const mappedRegions = regions.filter(isMappedFrameRegion);
  const fallbackRegions = regions.filter((region) => !isMappedFrameRegion(region));
  const visionRegions = regions.filter((region) => region.regionSource === "vision");
  const locatorRegions = regions.filter((region) => region.regionSource === "locator");
  const locatorVariants: DeliveryVinOcrCanvasVariant[] = [
    "min-channel-high-pass-gray",
    "min-channel-high-pass",
    "raw-gray",
    "gray",
    "sharpen",
    "binary",
    "binary-inverted",
    "adaptive",
    "adaptive-inverted",
  ];
  const mappedValueRegions = createValueRegionsFromFullBands(mappedRegions, sourceWidth);
  const fallbackValueRegions = sortVinOcrRegionsForSafariFastPath(
    createValueRegionsFromFullBands(fallbackRegions, sourceWidth),
    sourceHeight,
  );
  const fallbackTextRegions = sortVinOcrRegionsForSafariFastPath(
    fallbackRegions.filter((region) => region.role === "vin-text"),
    sourceHeight,
  );
  const mappedTextRegions = mappedRegions.filter((region) => region.role === "vin-text");
  const fullBandRegions = sortVinOcrRegionsForSafariFastPath(
    regions.filter((region) => region.role === "full-band"),
    sourceHeight,
  );
  const preferredFullBandRegions = fullBandRegions.slice(0, 4);
  const visionTextRegions = uniqueVinOcrRegions([
    ...visionRegions.filter((region) => region.role === "cv-text"),
    ...visionRegions.filter((region) => region.role === "cv-label"),
  ]);
  const fastRegions = uniqueVinOcrRegions([
    ...mappedValueRegions,
    ...fallbackValueRegions,
    ...fallbackTextRegions,
    ...mappedTextRegions,
  ]);
  const deepRegions = uniqueVinOcrRegions([
    ...visionTextRegions,
    ...fastRegions,
    ...fullBandRegions,
  ]);
  const fastVariants: DeliveryVinOcrCanvasVariant[] = ["raw-gray", "gray"];
  const deepVariants: DeliveryVinOcrCanvasVariant[] = [
    "sharpen",
    "adaptive-inverted",
    "binary-inverted",
    "adaptive",
    "binary",
  ];
  const visionAttempts = ["raw-gray", "sharpen", "gray"].flatMap((variant) =>
    visionTextRegions.map((region) => ({
      region,
      variant: variant as DeliveryVinOcrCanvasVariant,
      pass: "fast" as const,
    })),
  );
  const preferredFullBandAttempts = ["sharpen", "raw-gray", "gray"].flatMap((variant) =>
    preferredFullBandRegions.map((region) => ({
      region,
      variant: variant as DeliveryVinOcrCanvasVariant,
      pass: variant === "sharpen" ? "fast" as const : "full-band" as const,
    })),
  );
  const fastAttempts = fastVariants.flatMap((variant) =>
    fastRegions.map((region) => ({ region, variant, pass: "fast" as const })),
  );
  const fullBandAttempts = fullBandRegions.map((region) => ({
    region,
    variant: "raw-gray" as DeliveryVinOcrCanvasVariant,
    pass: "full-band" as const,
  }));
  const deepAttempts = deepVariants.flatMap((variant) =>
    deepRegions.map((region) => ({ region, variant, pass: "deep" as const })),
  );
  const locatorAttempts = locatorVariants.flatMap((variant) =>
    locatorRegions.map((region) => ({ region, variant, pass: "locator" as const })),
  );
  return uniqueVinOcrAttempts([
    ...locatorAttempts,
    ...visionAttempts,
    ...preferredFullBandAttempts,
    ...fastAttempts,
    ...fullBandAttempts,
    ...deepAttempts,
  ]);
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context is not available.");
  return context;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function findHistogramPercentile(histogram: Uint32Array, total: number, percentile: number): number {
  const target = Math.max(0, Math.min(total - 1, Math.floor(total * percentile)));
  let count = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value];
    if (count > target) return value;
  }
  return 255;
}

function normalizeLuminance(luminance: Uint8ClampedArray): Uint8ClampedArray {
  const histogram = new Uint32Array(256);
  for (const value of luminance) histogram[value] += 1;
  const low = findHistogramPercentile(histogram, luminance.length, 0.01);
  const high = findHistogramPercentile(histogram, luminance.length, 0.995);
  const range = Math.max(1, high - low);
  const normalized = new Uint8ClampedArray(luminance.length);
  for (let index = 0; index < luminance.length; index += 1) {
    normalized[index] = clampByte(((luminance[index] - low) / range) * 255);
  }
  return normalized;
}

function sharpenLuminance(
  luminance: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const sharpened = new Uint8ClampedArray(luminance.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sampleY = y + dy;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= width) continue;
          sum += luminance[(sampleY * width) + sampleX];
          count += 1;
        }
      }
      const index = (y * width) + x;
      const blur = sum / Math.max(1, count);
      sharpened[index] = clampByte(luminance[index] + ((luminance[index] - blur) * 1.35));
    }
  }
  return sharpened;
}

function calculateOtsuThreshold(luminance: Uint8ClampedArray): number {
  const histogram = new Uint32Array(256);
  for (const value of luminance) histogram[value] += 1;

  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 128;
  const total = luminance.length;

  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (!weightBackground) continue;
    const weightForeground = total - weightBackground;
    if (!weightForeground) break;

    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * ((meanBackground - meanForeground) ** 2);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = value;
    }
  }

  return threshold;
}

function adaptiveThresholdLuminance(
  luminance: Uint8ClampedArray,
  width: number,
  height: number,
  inverted: boolean,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(luminance.length);
  const radius = Math.max(12, Math.round(Math.min(width, height) / 18));
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += luminance[((y - 1) * width) + (x - 1)];
      integral[(y * (width + 1)) + x] = integral[((y - 1) * (width + 1)) + x] + rowSum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[((y2 + 1) * (width + 1)) + (x2 + 1)]
        - integral[(y1 * (width + 1)) + (x2 + 1)]
        - integral[((y2 + 1) * (width + 1)) + x1]
        + integral[(y1 * (width + 1)) + x1];
      const threshold = (sum / area) + 4;
      const isForeground = luminance[(y * width) + x] >= threshold;
      output[(y * width) + x] = isForeground
        ? (inverted ? 0 : 255)
        : (inverted ? 255 : 0);
    }
  }

  return output;
}

function highPassLuminance(
  luminance: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const radius = Math.max(10, Math.round(Math.min(width, height) / 18));
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += luminance[((y - 1) * width) + (x - 1)];
      integral[(y * (width + 1)) + x] = integral[((y - 1) * (width + 1)) + x] + rowSum;
    }
  }

  const output = new Uint8ClampedArray(luminance.length);
  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);
      const area = Math.max(1, (x2 - x1 + 1) * (y2 - y1 + 1));
      const sum = integral[((y2 + 1) * (width + 1)) + (x2 + 1)]
        - integral[(y1 * (width + 1)) + (x2 + 1)]
        - integral[((y2 + 1) * (width + 1)) + x1]
        + integral[(y1 * (width + 1)) + x1];
      const localMean = sum / area;
      const index = (y * width) + x;
      output[index] = clampByte((luminance[index] - localMean + 28) * 3.2);
    }
  }
  return output;
}

function applyLuminanceToImage(image: ImageData, luminance: Uint8ClampedArray): void {
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const value = luminance[index / 4];
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
}

function calculateLuminanceSignal(luminance: Uint8ClampedArray): DeliveryVinOcrCanvasSignal {
  if (!luminance.length) return { darkRatio: 0, lightRatio: 0, contrast: 0 };
  let dark = 0;
  let light = 0;
  let min = 255;
  let max = 0;
  for (const value of luminance) {
    if (value < 64) dark += 1;
    if (value > 192) light += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return {
    darkRatio: dark / luminance.length,
    lightRatio: light / luminance.length,
    contrast: max - min,
  };
}

function shouldCheckOcrCanvasSignal(variant: DeliveryVinOcrCanvasVariant): boolean {
  return variant === "binary"
    || variant === "binary-inverted"
    || variant === "adaptive"
    || variant === "adaptive-inverted"
    || variant === "min-channel-high-pass"
    || variant === "min-channel-high-pass-inverted"
    || variant === "min-channel-high-pass-gray"
    || variant === "cv-adaptive"
    || variant === "cv-morph";
}

function getOcrCanvasSignal(canvas: HTMLCanvasElement): DeliveryVinOcrCanvasSignal {
  const cached = ocrCanvasSignals.get(canvas);
  if (cached) return cached;
  const context = getCanvasContext(canvas);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const luminance = new Uint8ClampedArray(data.length / 4);
  for (let index = 0; index < data.length; index += 4) {
    luminance[index / 4] = Math.round((data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114));
  }
  const signal = calculateLuminanceSignal(luminance);
  ocrCanvasSignals.set(canvas, signal);
  return signal;
}

function getOcrCanvasSkipReason(canvas: HTMLCanvasElement, variant: DeliveryVinOcrCanvasVariant): string {
  if (!shouldCheckOcrCanvasSignal(variant)) return "";
  if (canvas.width < 32 || canvas.height < 32) return "skipped-low-signal: canvas too small";
  const signal = getOcrCanvasSignal(canvas);
  if (signal.contrast < 8) return "skipped-low-signal: low contrast";
  if (signal.darkRatio < 0.0015 && signal.lightRatio > 0.94) return "skipped-low-signal: too sparse";
  if (signal.darkRatio > 0.985 || signal.lightRatio > 0.995) return "skipped-low-signal: too dense";
  return "";
}

async function resolveOpenCvModule(candidate: any): Promise<any> {
  const resolved = await candidate;
  let cv = resolved?.default || resolved?.["module.exports"] || resolved?.cv || resolved;

  if (typeof cv?.then === "function") {
    const awaited = await Promise.race([
      Promise.resolve(cv).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    if (awaited?.Mat) return awaited;
    if (awaited) cv = awaited;
  }

  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (cv?.Mat && cv?.imread && cv?.imshow) return cv;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("OpenCV.js did not initialize.");
}

async function getOpenCv(options: DeliveryVinOcrOptions): Promise<any | null> {
  try {
    if (options.loadOpenCv) {
      return await resolveOpenCvModule(Promise.race([
        options.loadOpenCv(),
        rejectAfter(6000, "Timed out loading OpenCV.js."),
      ]));
    }
    if (!openCvPromise) {
      openCvPromise = Promise.race([
        import("@techstark/opencv-js"),
        rejectAfter(6000, "Timed out loading OpenCV.js."),
      ])
        .then(resolveOpenCvModule)
        .catch((error) => {
          openCvPromise = null;
          throw error;
        });
    }
    return await openCvPromise;
  } catch (error) {
    console.warn?.("[Delivery VIN OCR] OpenCV preprocessing unavailable; using Canvas fallback.", error);
    return null;
  }
}

function matToCanvas(cv: any, mat: any): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Number(mat.cols) || 1);
  canvas.height = Math.max(1, Number(mat.rows) || 1);
  cv.imshow(canvas, mat);
  return canvas;
}

function createOpenCvTextRegion(
  region: DeliveryVinOcrRegion,
  sourceWidth: number,
): DeliveryVinOcrRegion {
  const leftTrim = Math.round(region.width * 0.22);
  const rightTrim = Math.round(region.width * 0.025);
  const verticalTrim = Math.round(region.height * 0.12);
  const x = Math.min(sourceWidth - 1, region.x + leftTrim);
  const y = region.y + verticalTrim;
  const width = Math.max(1, Math.min(sourceWidth - x, region.width - leftTrim - rightTrim));
  const height = Math.max(1, region.height - (verticalTrim * 2));
  return {
    x,
    y,
    width,
    height,
    role: "cv-text",
    regionSource: region.regionSource,
  };
}

function createOpenCvCanvasFromRegion(
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  region: DeliveryVinOcrRegion,
): HTMLCanvasElement {
  const canvas = createRegionCanvas(source, region);
  const scaled = document.createElement("canvas");
  const scale = Math.max(1, Math.min(4, Math.round(1280 / Math.max(1, canvas.width))));
  scaled.width = Math.max(1, canvas.width * scale);
  scaled.height = Math.max(1, canvas.height * scale);
  const context = getCanvasContext(scaled);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled;
}

function detectVisionVinRegions(
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
): DeliveryVinOcrRegion[] {
  const sourceCanvas = createSourceCanvas(source);
  const { width, height } = readSourceSize(sourceCanvas);
  if (width < 160 || height < 120) return [];
  const context = getCanvasContext(sourceCanvas);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const luminance = new Uint8ClampedArray(width * height);
  for (let index = 0; index < data.length; index += 4) {
    luminance[index / 4] = Math.round((data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114));
  }

  const histogram = new Uint32Array(256);
  for (const value of luminance) histogram[value] += 1;
  const threshold = Math.max(145, Math.min(235, findHistogramPercentile(histogram, luminance.length, 0.86)));
  const xStart = Math.round(width * 0.03);
  const xEnd = Math.round(width * 0.97);
  const rowCounts = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    const offset = y * width;
    for (let x = xStart; x < xEnd; x += 1) {
      if (luminance[offset + x] >= threshold) count += 1;
    }
    rowCounts[y] = count;
  }

  const minRowBright = Math.max(24, Math.round((xEnd - xStart) * 0.16));
  const runs: Array<{ start: number; end: number; peak: number }> = [];
  let runStart = -1;
  let runPeak = 0;
  for (let y = 0; y < height; y += 1) {
    const nearby = (
      rowCounts[Math.max(0, y - 2)]
      + rowCounts[Math.max(0, y - 1)]
      + rowCounts[y]
      + rowCounts[Math.min(height - 1, y + 1)]
      + rowCounts[Math.min(height - 1, y + 2)]
    ) / 5;
    if (nearby >= minRowBright) {
      if (runStart < 0) runStart = y;
      runPeak = Math.max(runPeak, nearby);
    } else if (runStart >= 0) {
      runs.push({ start: runStart, end: y - 1, peak: runPeak });
      runStart = -1;
      runPeak = 0;
    }
  }
  if (runStart >= 0) runs.push({ start: runStart, end: height - 1, peak: runPeak });

  const candidates: Array<{ region: DeliveryVinOcrRegion; score: number }> = [];
  for (const run of runs) {
    const runHeight = run.end - run.start + 1;
    const centerY = (run.start + (runHeight / 2)) / height;
    if (runHeight < Math.max(16, height * 0.018) || runHeight > height * 0.26) continue;
    if (centerY < 0.06 || centerY > 0.72) continue;

    const columnCounts = new Uint32Array(width);
    for (let y = run.start; y <= run.end; y += 1) {
      const offset = y * width;
      for (let x = xStart; x < xEnd; x += 1) {
        if (luminance[offset + x] >= threshold) columnCounts[x] += 1;
      }
    }
    const minColumnBright = Math.max(2, Math.round(runHeight * 0.12));
    let left = -1;
    let right = -1;
    for (let x = xStart; x < xEnd; x += 1) {
      if (columnCounts[x] >= minColumnBright) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left < 0 || right <= left) continue;
    const labelWidth = right - left + 1;
    const aspect = labelWidth / Math.max(1, runHeight);
    const widthRatio = labelWidth / width;
    if (widthRatio < 0.28 || aspect < 3.0 || aspect > 24) continue;

    const marginX = Math.round(labelWidth * 0.035);
    const marginY = Math.round(runHeight * 0.36);
    const region = clampRegionToSource({
      x: left - marginX,
      y: run.start - marginY,
      width: labelWidth + (marginX * 2),
      height: runHeight + (marginY * 2),
      role: "cv-label",
      regionSource: "vision",
    }, width, height);
    if (!region) continue;

    const yScore = 1 / (1 + Math.abs(centerY - 0.32) * 4);
    candidates.push({
      region,
      score: (widthRatio * 4) + (run.peak / Math.max(1, xEnd - xStart)) + yScore,
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  const regions: DeliveryVinOcrRegion[] = [];
  for (const candidate of candidates.slice(0, 2)) {
    const textRegion = createOpenCvTextRegion(candidate.region, width);
    if (!regions.some((region) => regionsEqual(region, textRegion))) regions.push(textRegion);
    if (!regions.some((region) => regionsEqual(region, candidate.region))) regions.push(candidate.region);
  }
  return regions;
}

async function detectOpenCvVinRegions(
  cv: any,
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  options: DeliveryVinOcrOptions,
): Promise<DeliveryVinOcrRegion[]> {
  const sourceCanvas = createSourceCanvas(source);
  const sourceSize = readSourceSize(source);
  const mats: any[] = [];
  try {
    const src = cv.imread(sourceCanvas);
    const gray = new cv.Mat();
    const blur = new cv.Mat();
    const mask = new cv.Mat();
    const closed = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    mats.push(src, gray, blur, mask, closed, contours, hierarchy);

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.threshold(blur, mask, 145, 255, cv.THRESH_BINARY);
    const closeWidth = Math.max(21, Math.round(sourceSize.width * 0.055));
    const closeHeight = Math.max(5, Math.round(sourceSize.height * 0.012));
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeWidth, closeHeight));
    mats.push(kernel);
    cv.morphologyEx(mask, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates: Array<{ region: DeliveryVinOcrRegion; score: number }> = [];
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const rect = cv.boundingRect(contour);
      contour.delete?.();
      const widthRatio = rect.width / Math.max(1, sourceSize.width);
      const heightRatio = rect.height / Math.max(1, sourceSize.height);
      const aspect = rect.width / Math.max(1, rect.height);
      const centerY = (rect.y + (rect.height / 2)) / Math.max(1, sourceSize.height);
      if (widthRatio < 0.34 || heightRatio < 0.035 || heightRatio > 0.24) continue;
      if (aspect < 3.1 || aspect > 14) continue;
      if (centerY < 0.08 || centerY > 0.72) continue;

      const marginX = Math.round(rect.width * 0.035);
      const marginY = Math.round(rect.height * 0.18);
      const x = Math.max(0, rect.x - marginX);
      const y = Math.max(0, rect.y - marginY);
      const right = Math.min(sourceSize.width, rect.x + rect.width + marginX);
      const bottom = Math.min(sourceSize.height, rect.y + rect.height + marginY);
      const region: DeliveryVinOcrRegion = {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
        role: "cv-label",
        regionSource: "opencv",
      };
      const aspectScore = 1 / (1 + Math.abs(aspect - 7.2));
      const yScore = 1 / (1 + Math.abs(centerY - 0.34));
      candidates.push({ region, score: (widthRatio * 3) + aspectScore + yScore });
    }

    candidates.sort((left, right) => right.score - left.score);
    const regions: DeliveryVinOcrRegion[] = [];
    for (const candidate of candidates.slice(0, 2)) {
      const textRegion = createOpenCvTextRegion(candidate.region, sourceSize.width);
      if (!regions.some((region) => regionsEqual(region, textRegion))) regions.push(textRegion);
      if (!regions.some((region) => regionsEqual(region, candidate.region))) regions.push(candidate.region);
    }

    if (options.debug && regions.length) {
      const labelRegion = regions.find((region) => region.role === "cv-label");
      const textRegion = regions.find((region) => region.role === "cv-text");
      if (labelRegion) {
        await emitDebugCanvas(options, {
          name: "cv-label-roi.png",
          kind: "region",
          region: labelRegion,
          regionIndex: -1,
        }, createRegionCanvas(source, labelRegion));
      }
      if (textRegion) {
        await emitDebugCanvas(options, {
          name: "cv-text-roi.png",
          kind: "region",
          region: textRegion,
          regionIndex: -1,
        }, createRegionCanvas(source, textRegion));
      }
    }

    return regions;
  } catch (error) {
    console.warn?.("[Delivery VIN OCR] OpenCV label detection failed.", error);
    return [];
  } finally {
    for (const mat of mats.reverse()) mat?.delete?.();
  }
}

async function createOpenCvOcrCanvas(
  cv: any,
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  region: DeliveryVinOcrRegion,
  variant: DeliveryVinOcrCanvasVariant,
): Promise<HTMLCanvasElement | null> {
  if (!variant.startsWith("cv-")) return null;
  const sourceCanvas = createOpenCvCanvasFromRegion(source, region);
  const mats: any[] = [];
  try {
    const src = cv.imread(sourceCanvas);
    const gray = new cv.Mat();
    const contrast = new cv.Mat();
    mats.push(src, gray, contrast);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    if (typeof cv.equalizeHist === "function") {
      cv.equalizeHist(gray, contrast);
    } else {
      gray.copyTo(contrast);
    }

    if (variant === "cv-contrast") {
      return matToCanvas(cv, contrast);
    }

    const adaptive = new cv.Mat();
    mats.push(adaptive);
    const blockSize = Math.max(15, Math.floor(Math.min(contrast.cols, contrast.rows) / 7) | 1);
    cv.adaptiveThreshold(
      contrast,
      adaptive,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      blockSize % 2 === 1 ? blockSize : blockSize + 1,
      -2,
    );

    if (variant === "cv-adaptive") {
      return matToCanvas(cv, adaptive);
    }

    const morph = new cv.Mat();
    const opened = new cv.Mat();
    const eroded = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
    const closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 1));
    mats.push(morph, opened, eroded, kernel, closeKernel);
    cv.morphologyEx(adaptive, opened, cv.MORPH_OPEN, kernel);
    cv.erode(opened, eroded, kernel, new cv.Point(-1, -1), 1);
    cv.morphologyEx(eroded, morph, cv.MORPH_CLOSE, closeKernel);
    return matToCanvas(cv, morph);
  } catch (error) {
    console.warn?.("[Delivery VIN OCR] OpenCV variant failed.", error);
    return null;
  } finally {
    for (const mat of mats.reverse()) mat?.delete?.();
  }
}

function createOcrCanvas(
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  region: DeliveryVinOcrRegion,
  variant: DeliveryVinOcrCanvasVariant,
): HTMLCanvasElement {
  const scale = region.regionSource === "locator"
    ? clamp(104 / Math.max(1, region.height), 1, 2.8)
    : 4;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const context = getCanvasContext(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const luminance = new Uint8ClampedArray(data.length / 4);
  const minChannel = new Uint8ClampedArray(data.length / 4);

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round((data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114));
    luminance[index / 4] = gray;
    minChannel[index / 4] = Math.min(data[index], data[index + 1], data[index + 2]);
  }

  const normalized = normalizeLuminance(luminance);
  const sharpened = sharpenLuminance(normalized, canvas.width, canvas.height);
  let output: Uint8ClampedArray;

  switch (variant) {
    case "raw-gray":
      output = luminance;
      break;
    case "sharpen":
      output = sharpened;
      break;
    case "binary":
    case "binary-inverted": {
      const threshold = calculateOtsuThreshold(sharpened);
      output = new Uint8ClampedArray(sharpened.length);
      for (let index = 0; index < sharpened.length; index += 1) {
        const isForeground = sharpened[index] >= threshold;
        output[index] = isForeground
          ? (variant === "binary-inverted" ? 0 : 255)
          : (variant === "binary-inverted" ? 255 : 0);
      }
      break;
    }
    case "adaptive":
      output = adaptiveThresholdLuminance(sharpened, canvas.width, canvas.height, false);
      break;
    case "adaptive-inverted":
      output = adaptiveThresholdLuminance(sharpened, canvas.width, canvas.height, true);
      break;
    case "min-channel-high-pass-gray":
      output = normalizeLuminance(highPassLuminance(minChannel, canvas.width, canvas.height));
      break;
    case "min-channel-high-pass":
    case "min-channel-high-pass-inverted": {
      const highPass = highPassLuminance(minChannel, canvas.width, canvas.height);
      const threshold = calculateOtsuThreshold(highPass);
      output = new Uint8ClampedArray(highPass.length);
      for (let index = 0; index < highPass.length; index += 1) {
        const isForeground = highPass[index] >= threshold;
        output[index] = isForeground
          ? (variant === "min-channel-high-pass-inverted" ? 0 : 255)
          : (variant === "min-channel-high-pass-inverted" ? 255 : 0);
      }
      break;
    }
    case "gray":
    default:
      output = normalized;
      break;
  }

  applyLuminanceToImage(image, output);
  ocrCanvasSignals.set(canvas, calculateLuminanceSignal(output));
  context.putImageData(image, 0, 0);
  return canvas;
}

function createSourceCanvas(source: Exclude<DeliveryVinOcrSource, Blob | string>): HTMLCanvasElement {
  const { width, height } = readSourceSize(source);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  getCanvasContext(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createRegionCanvas(
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  region: DeliveryVinOcrRegion,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, region.width);
  canvas.height = Math.max(1, region.height);
  getCanvasContext(canvas).drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

interface DeliveryVinOcrLocatorDetection {
  regions: DeliveryVinOcrRegion[];
  summaries: VinLocatorDebugSummary[];
  selectedSummary?: VinLocatorDebugSummary;
  selectedResult?: VinLocatorResult;
  selectedSourceRegion?: DeliveryVinOcrRegion;
}

function isMappedFrameRegion(region: DeliveryVinOcrRegion): boolean {
  return Boolean(region.regionSource?.startsWith("mapped-frame"));
}

function isPreferredLocatorInputRegion(region: DeliveryVinOcrRegion): boolean {
  if (region.regionSource === "locator") return false;
  if (region.regionSource === "manual-crop") return true;
  if (isMappedFrameRegion(region)) return true;
  if (region.regionSource === "fallback") return region.role === "vin-text" || region.role === "full-band";
  return region.role === "cv-text" || region.role === "cv-label";
}

function sortLocatorInputRegions(
  regions: DeliveryVinOcrRegion[],
  sourceHeight: number,
): DeliveryVinOcrRegion[] {
  const sourcePriority = (region: DeliveryVinOcrRegion): number => {
    if (region.regionSource === "manual-crop") return 0;
    if (region.regionSource === "mapped-frame") return 1;
    if (region.regionSource === "mapped-frame-expanded") return 2;
    if (region.regionSource === "fallback") return 3;
    if (region.regionSource === "vision") return 4;
    if (region.regionSource === "opencv") return 5;
    return 9;
  };
  const rolePriority = (region: DeliveryVinOcrRegion): number => {
    if (region.role === "full-band") return 0;
    if (region.role === "vin-text" || region.role === "vin-value") return 1;
    return 2;
  };
  return uniqueVinOcrRegions(regions.filter(isPreferredLocatorInputRegion))
    .sort((left, right) =>
      sourcePriority(left) - sourcePriority(right)
      || rolePriority(left) - rolePriority(right)
      || Math.abs(regionCenterY(left, sourceHeight) - 0.36) - Math.abs(regionCenterY(right, sourceHeight) - 0.36)
      || left.y - right.y
      || left.x - right.x,
    );
}

function offsetLocatorSummary(
  summary: VinLocatorDebugSummary,
  sourceRegion: DeliveryVinOcrRegion,
): VinLocatorDebugSummary {
  return {
    ...summary,
    textBand: {
      ...summary.textBand,
      y: summary.textBand.y + sourceRegion.y,
    },
    selectedCrop: {
      ...summary.selectedCrop,
      x: summary.selectedCrop.x + sourceRegion.x,
      y: summary.selectedCrop.y + sourceRegion.y,
    },
    candidates: summary.candidates.map((candidate) => ({
      ...candidate,
      x: candidate.x + sourceRegion.x,
      y: candidate.y + sourceRegion.y,
    })),
    rejectedComponents: summary.rejectedComponents.map((component) => ({
      ...component,
      x: component.x + sourceRegion.x,
      y: component.y + sourceRegion.y,
    })),
  };
}

function createLocatorRegion(
  sourceRegion: DeliveryVinOcrRegion,
  result: VinLocatorResult,
  sourceWidth: number,
  sourceHeight: number,
): DeliveryVinOcrRegion | null {
  return clampRegionToSource({
    x: sourceRegion.x + result.crop.x,
    y: sourceRegion.y + result.crop.y,
    width: result.crop.width,
    height: result.crop.height,
    role: "vin-value",
    regionSource: "locator",
  }, sourceWidth, sourceHeight);
}

function detectLocatorVinRegions(
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  regions: DeliveryVinOcrRegion[],
  mode: DeliveryVinOcrMode,
): DeliveryVinOcrLocatorDetection {
  const sourceSize = readSourceSize(source);
  const inputLimit = mode === "search" ? 10 : 6;
  const inputRegions = sortLocatorInputRegions(regions, sourceSize.height).slice(0, inputLimit);
  const detections: Array<{
    region: DeliveryVinOcrRegion;
    result: VinLocatorResult;
    sourceRegion: DeliveryVinOcrRegion;
    summary: VinLocatorDebugSummary;
  }> = [];
  const locatorRegions: DeliveryVinOcrRegion[] = [];
  const summaries: VinLocatorDebugSummary[] = [];

  for (const inputRegion of inputRegions) {
    const compactStillCrop = sourceSize.height <= 320;
    const locatorVerticalExpansion = inputRegion.height < sourceSize.height * 0.45
      ? (compactStillCrop ? 2.55 : 1.05)
      : 0.12;
    const locatorInputRegion = expandDeliveryVinRegion(
      inputRegion,
      sourceSize.width,
      sourceSize.height,
      0.03,
      locatorVerticalExpansion,
      inputRegion.regionSource || "fallback",
    ) || inputRegion;
    if (locatorInputRegion.width < 80 || locatorInputRegion.height < 24) continue;
    const canvas = createRegionCanvas(source, locatorInputRegion);
    const context = getCanvasContext(canvas);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const results = locateVinInImageData(image, {
      maxBands: 3,
      maxCandidates: mode === "search" ? 8 : 8,
      minScore: inputRegion.regionSource === "manual-crop" ? 14 : 16,
    });

    for (const result of results) {
      const region = createLocatorRegion(locatorInputRegion, result, sourceSize.width, sourceSize.height);
      if (!region) continue;
      detections.push({
        region,
        result,
        sourceRegion: locatorInputRegion,
        summary: offsetLocatorSummary(summarizeVinLocatorResult(result), locatorInputRegion),
      });
    }
  }

  detections.sort((left, right) =>
    right.result.selected.score - left.result.selected.score
    || right.region.width - left.region.width
    || left.region.x - right.region.x,
  );

  let selectedResult: VinLocatorResult | undefined;
  let selectedSourceRegion: DeliveryVinOcrRegion | undefined;
  for (const detection of detections) {
    if (locatorRegions.some((candidate) => regionsEqual(candidate, detection.region))) continue;
    locatorRegions.push(detection.region);
    summaries.push(detection.summary);
    if (!selectedResult) {
      selectedResult = detection.result;
      selectedSourceRegion = detection.sourceRegion;
    }
    if (locatorRegions.length >= 4) break;
  }

  return {
    regions: locatorRegions,
    summaries,
    selectedSummary: summaries[0],
    selectedResult,
    selectedSourceRegion,
  };
}

function uniqueDeliveryVinRegionSources(regions: DeliveryVinOcrRegion[]): DeliveryVinOcrRegionSource[] {
  return Array.from(new Set(regions.map((region) => region.regionSource).filter(Boolean))) as DeliveryVinOcrRegionSource[];
}

function createRegionOverlayCanvas(
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  regions: DeliveryVinOcrRegion[],
  overlayRole: DeliveryVinOcrDebugOverlayRole,
): HTMLCanvasElement {
  const canvas = createSourceCanvas(source);
  const context = getCanvasContext(canvas);
  const baseLineWidth = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) * 0.003));
  const fontSize = Math.max(18, Math.round(canvas.width * 0.015));
  context.font = `${fontSize}px sans-serif`;
  context.textBaseline = "top";
  context.lineJoin = "round";
  context.lineCap = "round";

  const legendItems = overlayRole === "target"
    ? ["solid: visible VIN text crop", "thin: visible full frame", "dash: expanded retry"]
    : overlayRole === "search"
      ? ["cyan: fallback search bands"]
      : ["yellow: visible frame", "cyan: fallback search"];

  regions.forEach((region, index) => {
    const isMapped = isMappedFrameRegion(region);
    const isExpanded = region.regionSource === "mapped-frame-expanded";
    const isTextCrop = region.role === "vin-text" || region.role === "vin-value";
    const isFallbackOnly = overlayRole === "search";
    context.save?.();
    context.setLineDash?.(isExpanded ? [baseLineWidth * 3, baseLineWidth * 2] : []);
    context.lineWidth = isMapped
      ? isTextCrop ? baseLineWidth + 2 : baseLineWidth
      : Math.max(2, Math.round(baseLineWidth * 0.8));
    context.strokeStyle = isMapped
      ? isExpanded ? "rgba(255, 184, 48, 0.9)" : "rgba(255, 204, 34, 0.98)"
      : isFallbackOnly ? "rgba(80, 200, 255, 0.7)" : "rgba(80, 200, 255, 0.55)";
    context.strokeRect(region.x, region.y, region.width, region.height);
    context.restore?.();

    if (overlayRole !== "target" && index % 2 === 0) {
      context.fillStyle = isMapped ? "rgba(255, 204, 34, 0.95)" : "rgba(80, 200, 255, 0.82)";
      context.fillText(String(index + 1), region.x + 6, Math.max(4, region.y + 6));
    }
  });

  context.save?.();
  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  const legendPadding = Math.max(8, Math.round(fontSize * 0.5));
  const legendLineHeight = Math.round(fontSize * 1.25);
  const legendWidth = Math.min(
    canvas.width - legendPadding * 2,
    Math.max(...legendItems.map((item) => item.length)) * fontSize * 0.58 + legendPadding * 2,
  );
  const legendHeight = legendItems.length * legendLineHeight + legendPadding * 2;
  context.fillRect(0, 0, legendWidth, legendHeight);
  context.fillStyle = overlayRole === "search" ? "#50c8ff" : "#ffcc22";
  legendItems.forEach((item, index) => {
    context.fillText(item, legendPadding, legendPadding + index * legendLineHeight);
  });
  context.restore?.();
  return canvas;
}

function createVinLocatorMaskCanvas(mask: VinTextMask): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, mask.width);
  canvas.height = Math.max(1, mask.height);
  const context = getCanvasContext(canvas);
  const image = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < mask.data.length; index += 1) {
    const offset = index * 4;
    const value = mask.data[index] ? 255 : 0;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function createVinLocatorOverlayCanvas(
  sourceCanvas: HTMLCanvasElement,
  result: VinLocatorResult,
  mode: "band" | "candidate",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sourceCanvas.width);
  canvas.height = Math.max(1, sourceCanvas.height);
  const context = getCanvasContext(canvas);
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  const lineWidth = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.012));
  context.lineWidth = lineWidth;
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255, 204, 34, 0.96)";
  context.strokeRect(0, result.textBand.y, canvas.width, result.textBand.height);

  if (mode === "candidate") {
    context.strokeStyle = "rgba(80, 200, 255, 0.92)";
    for (const candidate of result.candidates.slice(0, 4)) {
      context.strokeRect(candidate.x, result.textBand.y, candidate.width, result.textBand.height);
    }
    context.strokeStyle = "rgba(46, 230, 136, 0.98)";
    context.strokeRect(result.crop.x, result.crop.y, result.crop.width, result.crop.height);
  }

  return canvas;
}

async function emitVinLocatorDebugArtifacts(
  options: DeliveryVinOcrOptions,
  source: Exclude<DeliveryVinOcrSource, Blob | string>,
  detection: DeliveryVinOcrLocatorDetection,
): Promise<void> {
  if (!detection.selectedResult || !detection.selectedSourceRegion || !detection.regions.length) return;
  const sourceRegionCanvas = createRegionCanvas(source, detection.selectedSourceRegion);
  await emitDebugCanvas(options, {
    name: "vin-locator-mask.png",
    kind: "processed",
  }, createVinLocatorMaskCanvas(detection.selectedResult.mask));
  await emitDebugCanvas(options, {
    name: "vin-locator-band-overlay.png",
    kind: "processed",
  }, createVinLocatorOverlayCanvas(sourceRegionCanvas, detection.selectedResult, "band"));
  await emitDebugCanvas(options, {
    name: "vin-locator-candidate-overlay.png",
    kind: "processed",
  }, createVinLocatorOverlayCanvas(sourceRegionCanvas, detection.selectedResult, "candidate"));
  await emitDebugCanvas(options, {
    name: "vin-locator-crop.png",
    kind: "region",
    region: detection.regions[0],
  }, createRegionCanvas(source, detection.regions[0]));
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/png");
    });
    if (blob) return blob;
  }

  if (typeof canvas.toDataURL === "function") {
    const response = await fetch(canvas.toDataURL("image/png"));
    return response.blob();
  }

  throw new Error("Canvas PNG export is not available.");
}

function getDeliveryVinOcrDebugImages(options: DeliveryVinOcrOptions): DeliveryVinOcrDebugImages {
  if (!options.debug) return "none";
  return options.debugImages || "full";
}

async function emitDebugCanvas(
  options: DeliveryVinOcrOptions,
  details: Omit<DeliveryVinOcrDebugArtifact, "blob" | "width" | "height" | "mimeType">,
  canvas: HTMLCanvasElement,
): Promise<void> {
  if (!options.debug || !options.onDebugArtifact) return;
  try {
    const blob = await canvasToPngBlob(canvas);
    await options.onDebugArtifact({
      ...details,
      blob,
      width: canvas.width,
      height: canvas.height,
      mimeType: "image/png",
    });
  } catch (error) {
    console.warn?.("[Delivery VIN OCR] Could not create debug image artifact.", error);
  }
}

function createDebugCandidates(
  rawText: string,
  options: DeliveryVinOcrCandidateOptions = {},
): DeliveryVinOcrDebugCandidate[] {
  return findDeliveryVinOcrCandidates(rawText, options).map((vin) => ({
    vin,
    validCheckDigit: isValidDeliveryVinCheckDigit(vin),
  }));
}

function createDeliveryVinRegionArtifactName(region: DeliveryVinOcrRegion, regionIndex: number): string {
  if (region.regionSource === "locator") {
    return `vin-locator-region-${String(regionIndex + 1).padStart(2, "0")}.png`;
  }
  if (region.regionSource === "manual-crop") {
    return region.role === "vin-text" ? "manual-crop-text.png" : "manual-crop-full.png";
  }
  if (region.regionSource === "mapped-frame") {
    if (region.role === "vin-value") return "mapped-frame-value.png";
    return region.role === "vin-text" ? "mapped-frame-text.png" : "mapped-frame-full.png";
  }
  if (region.regionSource === "mapped-frame-expanded") {
    if (region.role === "vin-value") return "mapped-frame-expanded-value.png";
    return region.role === "vin-text" ? "mapped-frame-expanded-text.png" : "mapped-frame-expanded-full.png";
  }
  return `region-${String(regionIndex + 1).padStart(2, "0")}.png`;
}

function publishDeliveryVinOcrDebugReport(report: DeliveryVinOcrDebugReport): void {
  if (typeof window !== "undefined") {
    (window as any).__deliveryVinOcrLastDebug = report;
  }

  const title = report.selectedVin
    ? `[Delivery VIN OCR] VIN ${report.selectedVin} (${report.attempts.length} attempts)`
    : `[Delivery VIN OCR] no valid VIN (${report.attempts.length} attempts)`;
  console.groupCollapsed?.(title);
  console.debug?.("source", {
    sourceSize: report.sourceSize,
    displaySize: report.displaySize,
    mode: report.mode,
    regions: report.regions,
    locator: report.locator,
    selectedVin: report.selectedVin,
    confidence: report.confidence,
    failureReason: report.failureReason,
  });
  console.table?.(report.attempts.map((attempt) => ({
    attempt: attempt.attempt,
    region: attempt.regionIndex + 1,
    variant: attempt.variant,
    confidence: Math.round(attempt.confidence),
    selectedVin: attempt.selectedVin,
    candidates: attempt.candidates.map((candidate) =>
      `${candidate.vin}${candidate.validCheckDigit ? " ok" : " bad-check"}`,
    ).join(", "),
    rawText: attempt.rawText.replace(/\s+/g, " ").trim().slice(0, 120),
    error: attempt.error || "",
  })));
  console.debug?.("report", report);
  console.groupEnd?.();
}

async function loadImageSource(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load VIN image: ${url}`));
    image.src = url;
  });
}

async function getTesseractWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await import("tesseract.js");
      const worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
        workerPath: `${DELIVERY_TESSERACT_BASE}/worker/worker.min.js`,
        corePath: `${DELIVERY_TESSERACT_BASE}/core`,
        langPath: `${DELIVERY_TESSERACT_BASE}/lang`,
        cacheMethod: "none",
        workerBlobURL: false,
        logger(message: { status?: string; progress?: number }) {
          activeProgress?.({
            status: String(message.status || "OCR"),
            progress: Number(message.progress) || 0,
          });
        },
      }, {
        load_system_dawg: "0",
        load_freq_dawg: "0",
        load_unambig_dawg: "0",
        load_punc_dawg: "0",
        load_number_dawg: "0",
        load_bigram_dawg: "0",
      });
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: VIN_OCR_WHITELIST,
        preserve_interword_spaces: "0",
        user_defined_dpi: "300",
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function preloadDeliveryVinOcrWorker(): Promise<void> {
  await getTesseractWorker();
}

export async function terminateDeliveryVinOcrWorker(): Promise<void> {
  const worker = await workerPromise?.catch(() => null);
  workerPromise = null;
  activeProgress = null;
  await worker?.terminate?.();
}

export async function recognizeDeliveryVinFromImageSource(
  source: DeliveryVinOcrSource,
  options: DeliveryVinOcrOptions = {},
): Promise<DeliveryVinScanResult> {
  const resolvedSource = typeof source === "string" ? await loadImageSource(source) : source;
  if (resolvedSource instanceof Blob) {
    const url = URL.createObjectURL(resolvedSource);
    try {
      return await recognizeDeliveryVinFromImageSource(url, options);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const concreteSource = resolvedSource as Exclude<DeliveryVinOcrSource, Blob | string>;
  const sourceDisplaySize = options.displaySize || readSourceDisplaySize(concreteSource);
  const stableSource = concreteSource instanceof HTMLVideoElement
    ? createSourceCanvas(concreteSource)
    : concreteSource;
  const { width, height } = readSourceSize(stableSource);
  const mode: DeliveryVinOcrMode = options.mode || "frame-then-search";
  const regions = [...createDeliveryVinOcrRegions(width, height, { ...options, mode })];
  if (!options.regions?.length) {
    for (const region of detectVisionVinRegions(stableSource)) {
      if (!regions.some((candidate) => regionsEqual(candidate, region))) regions.push(region);
    }
  }
  if (!regions.length) throw new Error("VIN OCR source has no readable dimensions.");
  const locatorDetection = detectLocatorVinRegions(stableSource, regions, mode);
  for (const region of [...locatorDetection.regions].reverse()) {
    if (regions.some((candidate) => regionsEqual(candidate, region))) continue;
    regions.unshift(region);
  }
  const locatorReport: DeliveryVinOcrLocatorDebugReport | undefined = locatorDetection.summaries.length
    ? {
      selected: locatorDetection.selectedSummary,
      results: locatorDetection.summaries,
      regions: locatorDetection.regions,
    }
    : undefined;
  const mappedFrameRegion = regions.find((region) =>
    region.regionSource === "mapped-frame" && region.role === "full-band",
  );

  const worker = await getTesseractWorker();
  const preprocessor: DeliveryVinOcrPreprocessor = options.preprocessor || "canvas";
  const openCvVariants: DeliveryVinOcrCanvasVariant[] = ["cv-contrast", "cv-adaptive", "cv-morph"];
  const rawTexts: string[] = [];
  const debugAttempts: DeliveryVinOcrDebugAttempt[] = [];
  const startedAt = new Date().toISOString();
  const debugId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const emittedRegionIndexes = new Set<number>();
  let openCv: any | null | undefined;
  let openCvAvailable = false;
  let attempts = 0;
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts || Number.POSITIVE_INFINITY));
  let selectedVin = "";
  let selectedRawText = "";
  let selectedConfidence = 0;
  let failureReason = "";
  activeProgress = options.onProgress || null;
  const debugImages = getDeliveryVinOcrDebugImages(options);
  options.onProgress?.({ status: "Preparing VIN image", progress: 0 });

  try {
    if (debugImages !== "none") {
      await emitVinLocatorDebugArtifacts(options, stableSource, locatorDetection);
      const mappedOverlayRegions = regions.filter(isMappedFrameRegion);
      const searchOverlayRegions = regions.filter((region) => !isMappedFrameRegion(region));
      await emitDebugCanvas(options, {
        name: "source-frame.png",
        kind: "source",
      }, createSourceCanvas(stableSource));
      if (mappedOverlayRegions.length) {
        await emitDebugCanvas(options, {
          name: "ocr-target-overlay.png",
          kind: "source",
          overlayRole: "target",
          regionSources: uniqueDeliveryVinRegionSources(mappedOverlayRegions),
        }, createRegionOverlayCanvas(stableSource, mappedOverlayRegions, "target"));
      }
      if (searchOverlayRegions.length) {
        await emitDebugCanvas(options, {
          name: "ocr-search-overlay.png",
          kind: "source",
          overlayRole: "search",
          regionSources: uniqueDeliveryVinRegionSources(searchOverlayRegions),
        }, createRegionOverlayCanvas(stableSource, searchOverlayRegions, "search"));
      }
      await emitDebugCanvas(options, {
        name: "ocr-region-overlay.png",
        kind: "source",
        overlayRole: "combined",
        regionSources: uniqueDeliveryVinRegionSources(regions),
      }, createRegionOverlayCanvas(stableSource, regions, "combined"));
    }

    const ensureOpenCv = async (): Promise<any | null> => {
      if (preprocessor === "canvas") return null;
      if (openCv !== undefined) return openCv;
      openCv = await getOpenCv(options);
      openCvAvailable = Boolean(openCv);
      return openCv || null;
    };

    const appendRegions = (newRegions: DeliveryVinOcrRegion[]): DeliveryVinOcrRegion[] => {
      const added: DeliveryVinOcrRegion[] = [];
      for (const region of newRegions) {
        if (regions.some((candidate) => regionsEqual(candidate, region))) continue;
        regions.push(region);
        added.push(region);
      }
      return added;
    };

    const emitRegionArtifact = async (region: DeliveryVinOcrRegion, regionIndex: number): Promise<void> => {
      if (debugImages === "none" || emittedRegionIndexes.has(regionIndex)) return;
      emittedRegionIndexes.add(regionIndex);
      await emitDebugCanvas(options, {
        name: createDeliveryVinRegionArtifactName(region, regionIndex),
        kind: "region",
        regionIndex,
        region,
      }, createRegionCanvas(stableSource, region));
    };

    const getRegionIndex = (region: DeliveryVinOcrRegion): number => {
      let regionIndex = regions.findIndex((candidate) => regionsEqual(candidate, region));
      if (regionIndex < 0) {
        regions.push(region);
        regionIndex = regions.length - 1;
      }
      return regionIndex;
    };

    const runOcrAttempts = async (plan: DeliveryVinOcrAttemptPlanEntry[]): Promise<void> => {
      for (const entry of plan) {
        if (selectedVin) return;
        if (attempts >= maxAttempts) return;
        const { region, variant } = entry;
        const regionIndex = getRegionIndex(region);
        await emitRegionArtifact(region, regionIndex);

        let canvas: HTMLCanvasElement;
        if (variant.startsWith("cv-")) {
          const cv = await ensureOpenCv();
          if (!cv) continue;
          const openCvCanvas = await createOpenCvOcrCanvas(cv, stableSource, region, variant);
          if (!openCvCanvas) continue;
          canvas = openCvCanvas;
        } else {
          canvas = createOcrCanvas(stableSource, region, variant);
        }

        attempts += 1;
        if (debugImages === "full") {
          await emitDebugCanvas(options, {
            name: `attempt-${String(attempts).padStart(2, "0")}-${variant}.png`,
            kind: "processed",
            regionIndex,
            attempt: attempts,
            variant,
            region,
          }, canvas);
        }

        const skipReason = getOcrCanvasSkipReason(canvas, variant);
        if (skipReason) {
          debugAttempts.push({
            attempt: attempts,
            regionIndex,
            region,
            variant,
            rawText: "",
            confidence: 0,
            candidates: [],
            selectedVin: "",
            error: skipReason,
          });
          continue;
        }

        options.onProgress?.({ status: "Reading windshield VIN", progress: Math.min(0.92, attempts / 48) });
        try {
          const result = await worker.recognize(canvas, {}, { text: true });
          const rawText = String(result?.data?.text || "");
          const confidence = Number(result?.data?.confidence) || 0;
          const candidates = createDebugCandidates(rawText, {
            allowComputedCheckDigitRepair: region.regionSource === "locator"
              && (variant === "min-channel-high-pass-gray" || variant === "min-channel-high-pass"),
          });
          const vin = candidates.find((candidate) => candidate.validCheckDigit)?.vin || "";
          rawTexts.push(rawText);
          debugAttempts.push({
            attempt: attempts,
            regionIndex,
            region,
            variant,
            rawText,
            confidence,
            candidates,
            selectedVin: vin,
          });
          if (vin) {
            selectedVin = vin;
            selectedRawText = rawText;
            selectedConfidence = confidence;
            return;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failureReason = message || "OCR engine failed.";
          debugAttempts.push({
            attempt: attempts,
            regionIndex,
            region,
            variant,
            rawText: "",
            confidence: 0,
            candidates: [],
            selectedVin: "",
            error: failureReason,
          });
          return;
        }
      }
    };

    const addOpenCvDetectedRegions = async (): Promise<DeliveryVinOcrRegion[]> => {
      const cv = await ensureOpenCv();
      if (!cv) return [];
      return appendRegions(await detectOpenCvVinRegions(cv, stableSource, options));
    };

    if (preprocessor === "opencv") {
      const cvRegions = await addOpenCvDetectedRegions();
      const openCvPassRegions = cvRegions.length ? cvRegions : regions.slice(0, 4);
      await runOcrAttempts(openCvPassRegions.flatMap((region) =>
        openCvVariants.map((variant) => ({ region, variant, pass: "opencv" as const })),
      ));
      if (!selectedVin) await runOcrAttempts(createDeliveryVinOcrAttemptPlan(regions, width, height, "canvas"));
    } else {
      await runOcrAttempts(createDeliveryVinOcrAttemptPlan(regions, width, height, "canvas"));
      if (!selectedVin && preprocessor === "auto") {
        const cvRegions = await addOpenCvDetectedRegions();
        if (cvRegions.length) {
          await runOcrAttempts(cvRegions.flatMap((region) =>
            openCvVariants.map((variant) => ({ region, variant, pass: "opencv" as const })),
          ));
        }
      }
    }

    if (selectedVin) {
      options.onProgress?.({ status: "VIN found", progress: 1 });
    } else if (!failureReason) {
      failureReason = "No OCR attempt produced a 17-character VIN with a valid check digit.";
    }
  } finally {
    activeProgress = null;
  }

  const report: DeliveryVinOcrDebugReport = {
    id: debugId,
    label: options.debugLabel || "delivery-vin-ocr",
    startedAt,
    endedAt: new Date().toISOString(),
    mode,
    sourceSize: { width, height },
    displaySize: sourceDisplaySize,
    frameHint: options.frameHint,
    mappedFrameRegion,
    regions,
    attempts: debugAttempts,
    selectedVin,
    confidence: selectedConfidence,
    rawText: selectedRawText || rawTexts.join("\n").trim(),
    failureReason: selectedVin ? "" : failureReason,
    preprocessor,
    openCvAvailable,
    locator: locatorReport,
  };

  if (options.debug) {
    publishDeliveryVinOcrDebugReport(report);
    await options.onDebugReport?.(report);
  }

  if (selectedVin) {
    return {
      vin: selectedVin,
      rawText: selectedRawText,
      confidence: selectedConfidence,
      attempts,
      debug: options.debug ? report : undefined,
    };
  }

  return {
    vin: "",
    rawText: rawTexts.join("\n").trim(),
    confidence: 0,
    attempts,
    debug: options.debug ? report : undefined,
  };
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks?.() || []) {
    track.stop();
  }
}

async function waitForDeliveryVinVideoMetadata(video: HTMLVideoElement, timeoutMs = 2500): Promise<void> {
  if (video.videoWidth && video.videoHeight) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", finish);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      video.removeEventListener("playing", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    video.addEventListener("loadedmetadata", finish, { once: true });
    video.addEventListener("loadeddata", finish, { once: true });
    video.addEventListener("canplay", finish, { once: true });
    video.addEventListener("playing", finish, { once: true });
  });
}

export async function startDeliveryVinOcrScanner({
  video,
  onProgress,
  permissions = null,
  mediaDevices = navigator.mediaDevices,
  recognize = recognizeDeliveryVinFromImageSource,
}: StartDeliveryVinOcrScannerOptions): Promise<DeliveryVinScannerSession> {
  if (permissions && !permissions.require("media.camera")) {
    throw new Error("VIN OCR camera permission denied.");
  }
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Camera is not available in this browser.");
  }

  let active = true;
  let busy = false;
  let stream: MediaStream | null = null;
  video.playsInline = true;
  video.muted = true;

  try {
    stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    video.srcObject = stream;
    const playResult = video.play?.();
    await playResult?.catch?.(() => undefined);
    await waitForDeliveryVinVideoMetadata(video);
  } catch (error) {
    stopStream(stream);
    throw error;
  }

  const stop = () => {
    if (!active) return;
    active = false;
    stopStream(stream);
    stream = null;
    video.pause?.();
    video.removeAttribute("src");
    video.srcObject = null;
  };

  return {
    async capture(captureOptions: DeliveryVinOcrOptions = {}) {
      if (!active) throw new Error("VIN OCR scanner is not active.");
      if (busy) throw new Error("VIN OCR is already running.");
      busy = true;
      try {
        onProgress?.({ status: "Capturing windshield VIN", progress: 0 });
        const rect = video.getBoundingClientRect();
        return await recognize(video, {
          ...captureOptions,
          mode: captureOptions.mode || "frame-then-search",
          displaySize: captureOptions.displaySize || {
            width: Math.round(rect.width || 0),
            height: Math.round(rect.height || 0),
          },
          onProgress,
        });
      } finally {
        busy = false;
      }
    },
    stop,
    destroy: stop,
    isActive() {
      return active;
    },
  };
}
