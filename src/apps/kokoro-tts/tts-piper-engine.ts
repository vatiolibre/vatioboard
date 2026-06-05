import type * as OrtWasm from "onnxruntime-web/wasm";
import piperPhonemizeWorkerUrl from "piper-tts-web/dist/worker/PhonemizeWebWorker.js?url";
import {
  KOKORO_ORT_WASM_URL,
  cacheKokoroAsset,
  cacheKokoroAssets,
  getKokoroRuntimeAsset,
  getPiperPhonemizerAssets,
  getPiperVoiceAssets,
  getPiperVoiceConfigAsset,
  getPiperVoiceModelAsset,
  readCachedKokoroAsset,
  type KokoroAssetDescriptor,
  type KokoroAssetProgress,
} from "./kokoro-model-cache.js";
import {
  PIPER_VOICE_BY_ID,
  PIPER_VOICES_BY_LANG,
  getDefaultPiperVoiceForLang,
  isPiperVoiceId,
  type KokoroLangId,
  type PiperVoiceId,
} from "./kokoro-direct-resources.js";

export type PiperTtsStatusReporter = (status: string, progress?: string, ratio?: number | null) => void;

export interface PiperTtsSettings {
  lang: KokoroLangId;
  piperVoice: PiperVoiceId;
  speed?: number;
}

export interface PiperTtsSpeechResult {
  blob: Blob;
  model: PiperVoiceId;
  provider: "wasm";
  durationMs: number;
  audioSeconds: number;
}

type OrtModule = typeof OrtWasm;
type PiperSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;
type AssetProgressReporter = (asset: KokoroAssetDescriptor, progress: KokoroAssetProgress) => void;

interface PiperVoiceConfig {
  audio: {
    sample_rate: number;
    quality?: string;
  };
  espeak: {
    voice: string;
  };
  inference: {
    noise_scale: number;
    length_scale: number;
    noise_w: number;
  };
  num_speakers?: number;
  speaker_id_map?: Record<string, number>;
  phoneme_id_map: Record<string, [number]>;
}

interface PiperPhonemeData {
  phoneme_ids: number[];
  phonemes?: string[];
}

interface PiperSessionBundle {
  config: PiperVoiceConfig;
  runtime: OrtModule;
  session: PiperSession;
}

interface PendingPhonemizerRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
}

const PIPER_MAX_TEXT_CHARS = 700;
const PIPER_MIN_SPEED = 0.72;
const PIPER_MAX_SPEED = 1.35;

const sessions = new Map<PiperVoiceId, Promise<PiperSessionBundle>>();
const assetObjectUrls = new Map<string, string>();
let ortModulePromise: Promise<OrtModule> | null = null;
let phonemizerWorker: Worker | null = null;
let phonemizerReadyPromise: Promise<void> | null = null;
let pendingPhonemizerRequest: PendingPhonemizerRequest | null = null;

function formatBytes(value: number | null | undefined): string {
  if (!Number.isFinite(value || 0) || !value) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex++;
  }
  return `${scaled >= 10 || unitIndex === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unitIndex]}`;
}

function handleAssetProgress(reportStatus: PiperTtsStatusReporter): AssetProgressReporter {
  return (asset, progress) => {
    const total = progress.totalBytes;
    const range = progress.rangeCount ? `, range ${progress.rangeIndex}/${progress.rangeCount}` : "";
    reportStatus(
      "Priming Piper",
      `${asset.label}: ${formatBytes(progress.loadedBytes)} / ${formatBytes(total)}${range}`,
      total ? progress.loadedBytes / total : null,
    );
  };
}

function resolvePiperVoice(settings: PiperTtsSettings): PiperVoiceId {
  if (isPiperVoiceId(settings.piperVoice) && PIPER_VOICE_BY_ID[settings.piperVoice].lang === settings.lang) {
    return settings.piperVoice;
  }
  return getDefaultPiperVoiceForLang(settings.lang);
}

function normalizeText(text: string): string {
  return text
    .slice(0, PIPER_MAX_TEXT_CHARS)
    .replaceAll("‘", "'")
    .replaceAll("’", "'")
    .replaceAll("«", "(")
    .replaceAll("»", ")")
    .replaceAll("“", "\"")
    .replaceAll("”", "\"")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replaceAll("\n", ". ")
    .replaceAll("\t", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampSpeed(speed: number | undefined): number {
  const normalized = Number.isFinite(speed || 0) && speed ? speed : 1;
  return Math.max(PIPER_MIN_SPEED, Math.min(PIPER_MAX_SPEED, normalized));
}

async function ensureAssetBuffer(
  asset: KokoroAssetDescriptor,
  reportStatus: PiperTtsStatusReporter,
): Promise<ArrayBuffer> {
  let buffer = await readCachedKokoroAsset(asset);
  if (buffer) return buffer;

  await cacheKokoroAsset(asset, (progress) => handleAssetProgress(reportStatus)(asset, progress));
  buffer = await readCachedKokoroAsset(asset);
  if (!buffer) throw new Error(`${asset.label} was not cached.`);
  return buffer;
}

async function ensureAssetObjectUrl(
  asset: KokoroAssetDescriptor,
  mimeType: string,
  reportStatus: PiperTtsStatusReporter,
): Promise<string> {
  const key = asset.url || asset.file;
  const cached = assetObjectUrls.get(key);
  if (cached) return cached;

  const buffer = await ensureAssetBuffer(asset, reportStatus);
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  assetObjectUrls.set(key, url);
  return url;
}

async function loadPiperVoiceConfig(
  voice: PiperVoiceId,
  reportStatus: PiperTtsStatusReporter,
): Promise<PiperVoiceConfig> {
  const buffer = await ensureAssetBuffer(getPiperVoiceConfigAsset(voice), reportStatus);
  return JSON.parse(new TextDecoder().decode(buffer)) as PiperVoiceConfig;
}

async function getOrtModule(wasmBinary: ArrayBuffer): Promise<OrtModule> {
  if (!ortModulePromise) {
    ortModulePromise = (async () => {
      const runtime = await import("onnxruntime-web/wasm");
      runtime.env.logLevel = "error";
      runtime.env.wasm.numThreads = 1;
      runtime.env.wasm.proxy = false;
      runtime.env.wasm.wasmBinary = wasmBinary;
      runtime.env.wasm.wasmPaths = KOKORO_ORT_WASM_URL;
      return runtime as OrtModule;
    })();
  }

  const runtime = await ortModulePromise;
  runtime.env.logLevel = "error";
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = false;
  runtime.env.wasm.wasmBinary = wasmBinary;
  runtime.env.wasm.wasmPaths = KOKORO_ORT_WASM_URL;
  return runtime;
}

function getPhonemizerWorker(): Worker {
  if (phonemizerWorker) return phonemizerWorker;
  phonemizerWorker = new Worker(piperPhonemizeWorkerUrl, { type: "module" });
  phonemizerWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const pending = pendingPhonemizerRequest;
    pendingPhonemizerRequest = null;
    pending?.resolve(event.data);
  });
  phonemizerWorker.addEventListener("error", (event) => {
    const message = event.message || "Piper phonemizer worker failed.";
    const pending = pendingPhonemizerRequest;
    pendingPhonemizerRequest = null;
    pending?.reject(new Error(message));
    phonemizerReadyPromise = null;
    phonemizerWorker?.terminate();
    phonemizerWorker = null;
  });
  phonemizerWorker.postMessage({ type: "constructor", data: null });
  return phonemizerWorker;
}

function sendPhonemizerRequest(type: string, data: unknown): Promise<unknown> {
  if (pendingPhonemizerRequest) {
    return Promise.reject(new Error("Piper phonemizer is busy."));
  }

  const worker = getPhonemizerWorker();
  return new Promise((resolve, reject) => {
    pendingPhonemizerRequest = { resolve, reject };
    worker.postMessage({ type, data });
  });
}

async function ensurePhonemizerModule(reportStatus: PiperTtsStatusReporter): Promise<void> {
  if (!phonemizerReadyPromise) {
    phonemizerReadyPromise = (async () => {
      const [wasmAsset, dataAsset] = getPiperPhonemizerAssets();
      const wasmUrl = await ensureAssetObjectUrl(wasmAsset, "application/wasm", reportStatus);
      const dataUrl = await ensureAssetObjectUrl(dataAsset, "application/octet-stream", reportStatus);
      reportStatus("Loading Piper", "Preparing phonemizer", null);
      await sendPhonemizerRequest("loadModule", [wasmUrl, dataUrl]);
    })();
    phonemizerReadyPromise.catch(() => {
      phonemizerReadyPromise = null;
    });
  }
  await phonemizerReadyPromise;
}

async function phonemize(
  text: string,
  config: PiperVoiceConfig,
  reportStatus: PiperTtsStatusReporter,
): Promise<PiperPhonemeData> {
  await ensurePhonemizerModule(reportStatus);
  reportStatus("Phonemizing", config.espeak.voice, null);
  const result = await sendPhonemizerRequest("phonemize", [text, [config, ""]]);
  const phonemeData = result as PiperPhonemeData;
  if (!Array.isArray(phonemeData.phoneme_ids) || !phonemeData.phoneme_ids.length) {
    throw new Error("Piper phonemizer did not return speech tokens.");
  }
  return phonemeData;
}

async function createSession(
  voice: PiperVoiceId,
  reportStatus: PiperTtsStatusReporter,
): Promise<PiperSessionBundle> {
  if (!sessions.has(voice)) {
    const sessionPromise = (async () => {
      const runtimeBinary = await ensureAssetBuffer(getKokoroRuntimeAsset(), reportStatus);
      const runtime = await getOrtModule(runtimeBinary);
      const config = await loadPiperVoiceConfig(voice, reportStatus);
      const modelBuffer = await ensureAssetBuffer(getPiperVoiceModelAsset(voice), reportStatus);
      reportStatus("Loading Piper", `${PIPER_VOICE_BY_ID[voice].name} voice on WASM`, null);
      const session = await runtime.InferenceSession.create(modelBuffer, {
        executionProviders: ["wasm"],
        logSeverityLevel: 3,
      });
      return { config, runtime, session };
    })();
    sessionPromise.catch(() => sessions.delete(voice));
    sessions.set(voice, sessionPromise);
  }
  return sessions.get(voice)!;
}

function encodeWavPcm16(waveform: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = waveform.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of waveform) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

export async function primePiperTtsAssets(
  settings: PiperTtsSettings,
  reportStatus: PiperTtsStatusReporter,
): Promise<"wasm"> {
  const voice = resolvePiperVoice(settings);
  const assets = [
    getKokoroRuntimeAsset(),
    ...getPiperPhonemizerAssets(),
    ...getPiperVoiceAssets(voice),
  ];
  await cacheKokoroAssets(
    assets,
    handleAssetProgress(reportStatus),
    (asset, result) => reportStatus(
      "Priming Piper",
      `${asset.label}: ${result === "hit" ? "cached" : "stored"}`,
      null,
    ),
  );
  reportStatus("Piper ready", `${PIPER_VOICE_BY_ID[voice].name} voice cached`, 1);
  return "wasm";
}

export async function loadPiperTtsEngine(
  settings: PiperTtsSettings,
  reportStatus: PiperTtsStatusReporter,
): Promise<"wasm"> {
  const voice = resolvePiperVoice(settings);
  await primePiperTtsAssets(settings, reportStatus);
  await ensurePhonemizerModule(reportStatus);
  await createSession(voice, reportStatus);
  reportStatus("Piper ready", `${PIPER_VOICE_BY_ID[voice].name} neural voice ready`, 1);
  return "wasm";
}

export async function synthesizePiperTtsSpeech(
  text: string,
  settings: PiperTtsSettings,
  reportStatus: PiperTtsStatusReporter,
): Promise<PiperTtsSpeechResult> {
  const startedAt = performance.now();
  const normalized = normalizeText(text);
  if (!normalized) throw new Error("No text was provided.");

  const voice = resolvePiperVoice(settings);
  if (!PIPER_VOICES_BY_LANG[settings.lang]?.some((item) => item.id === voice)) {
    throw new Error("Choose a Piper voice for the selected language.");
  }

  await primePiperTtsAssets(settings, reportStatus);
  const { config, runtime, session } = await createSession(voice, reportStatus);
  const phonemeData = await phonemize(normalized, config, reportStatus);
  const phonemeIds = BigInt64Array.from(phonemeData.phoneme_ids.map((id) => BigInt(id)));
  const speed = clampSpeed(settings.speed);
  const lengthScale = Math.max(0.35, Math.min(2.4, (config.inference.length_scale || 1) / speed));
  const feeds: Record<string, OrtWasm.Tensor> = {
    input: new runtime.Tensor("int64", phonemeIds, [1, phonemeIds.length]),
    input_lengths: new runtime.Tensor("int64", BigInt64Array.from([BigInt(phonemeIds.length)]), [1]),
    scales: new runtime.Tensor("float32", Float32Array.from([
      config.inference.noise_scale,
      lengthScale,
      config.inference.noise_w,
    ]), [3]),
  };
  if (Object.keys(config.speaker_id_map || {}).length) {
    feeds.sid = new runtime.Tensor("int64", BigInt64Array.from([0n]), [1]);
  }

  reportStatus("Generating", `${PIPER_VOICE_BY_ID[voice].name} neural voice`, null);
  const result = await session.run(feeds);
  const output = result.output || Object.values(result)[0];
  if (!output) throw new Error("Piper model did not return audio.");

  const pcm = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data as Iterable<number>);
  const sampleRate = config.audio.sample_rate || 22050;
  const wavBuffer = encodeWavPcm16(pcm, sampleRate);
  return {
    blob: new Blob([wavBuffer], { type: "audio/wav" }),
    model: voice,
    provider: "wasm",
    durationMs: Math.max(0, performance.now() - startedAt),
    audioSeconds: pcm.length / sampleRate,
  };
}
