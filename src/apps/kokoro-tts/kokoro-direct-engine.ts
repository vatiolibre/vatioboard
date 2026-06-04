import type * as OrtWeb from "onnxruntime-web/webgpu";
import {
  cacheKokoroAsset,
  cacheKokoroAssets,
  getKokoroDirectModelAsset,
  getKokoroOrtRuntimeAsset,
  getKokoroPhonemizerAsset,
  getKokoroVoiceAsset,
  KOKORO_ORT_WASM_MJS_URL,
  KOKORO_ORT_WEBGPU_MJS_URL,
  KOKORO_ORT_WASM_URL,
  KOKORO_ORT_WEBGPU_WASM_URL,
  readCachedKokoroAsset,
  type KokoroAssetDescriptor,
  type KokoroAssetProgress,
} from "./kokoro-model-cache.js";
import {
  KOKORO_LANG_BY_ID,
  KOKORO_MODEL_BY_ID,
  KOKORO_SAMPLE_RATE,
  isKokoroVoiceId,
  type KokoroAcceleration,
  type KokoroDirectModelId,
  type KokoroExecutionProvider,
  type KokoroLangId,
  type KokoroVoiceId,
} from "./kokoro-direct-resources.js";
import { tokenizeKokoroPhonemes } from "./kokoro-direct-tokenizer.js";
import createESpeakNg from "./vendor/espeak-ng.js";

const MODEL_CONTEXT_WINDOW = 512;
const VOICE_VECTOR_SIZE = 256;
const MAX_TEXT_CHARS = 900;
const VOICE_WEIGHT_EPSILON = 0.001;

type OrtModule = typeof OrtWeb;
type KokoroSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;
type StatusReporter = (status: string, progress?: string, ratio?: number | null) => void;
type AssetProgressReporter = (asset: KokoroAssetDescriptor, progress: KokoroAssetProgress) => void;

interface VoiceWeight {
  voiceId: KokoroVoiceId;
  weight: number;
}

interface TextChunk {
  type: "text";
  content: string;
  tokens: number[];
}

interface SilenceChunk {
  type: "silence";
  durationSeconds: number;
}

type TextProcessorChunk = TextChunk | SilenceChunk;

export interface KokoroDirectSettings {
  acceleration: KokoroAcceleration;
  lang: KokoroLangId;
  model: KokoroDirectModelId;
  voice: KokoroVoiceId;
  voiceFormula?: string;
  speed?: number;
}

export interface KokoroDirectSpeechResult {
  blob: Blob;
  provider: KokoroExecutionProvider;
  model: KokoroDirectModelId;
  durationMs: number;
  audioSeconds: number;
}

const ortModules = new Map<KokoroExecutionProvider, Promise<OrtModule>>();
const sessions = new Map<string, Promise<{ session: KokoroSession; provider: KokoroExecutionProvider }>>();
const voiceVectors = new Map<KokoroVoiceId, Promise<Float32Array[]>>();
const combinedVoices = new Map<string, Promise<Float32Array[]>>();
let phonemizerBinary: ArrayBuffer | null = null;

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

function getSettingsKey(settings: KokoroDirectSettings, provider: KokoroExecutionProvider): string {
  return `${settings.model}:${provider}`;
}

function getVoiceFormula(settings: KokoroDirectSettings): string {
  return settings.voiceFormula?.trim() || settings.voice;
}

function getProviderLabel(provider: KokoroExecutionProvider): string {
  return provider === "webgpu" ? "WebGPU" : "WASM";
}

function hasNavigatorWebGpu(): boolean {
  const maybeNavigator = typeof navigator === "undefined"
    ? null
    : navigator as Navigator & {
      gpu?: {
        requestAdapter?: () => Promise<unknown>;
      };
    };
  return Boolean(maybeNavigator?.gpu?.requestAdapter);
}

async function detectWebGpu(): Promise<boolean> {
  if (!hasNavigatorWebGpu()) return false;
  try {
    const adapter = await (navigator as Navigator & {
      gpu: { requestAdapter: () => Promise<unknown> };
    }).gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function resolveProvider(acceleration: KokoroAcceleration, reportStatus: StatusReporter): Promise<KokoroExecutionProvider> {
  if (acceleration === "wasm") return "wasm";

  const webGpuReady = await detectWebGpu();
  if (webGpuReady) return "webgpu";

  if (acceleration === "webgpu") {
    throw new Error("WebGPU is not available in this browser.");
  }

  reportStatus("CPU fallback", "WebGPU was not available; using WASM", null);
  return "wasm";
}

function handleAssetProgress(reportStatus: StatusReporter): AssetProgressReporter {
  return (asset, progress) => {
    const total = progress.totalBytes;
    const range = progress.rangeCount ? `, range ${progress.rangeIndex}/${progress.rangeCount}` : "";
    reportStatus(
      "Priming cache",
      `${asset.label}: ${formatBytes(progress.loadedBytes)} / ${formatBytes(total)}${range}`,
      total ? progress.loadedBytes / total : null,
    );
  };
}

async function ensureAssetBuffer(
  asset: KokoroAssetDescriptor,
  reportStatus: StatusReporter,
): Promise<ArrayBuffer> {
  let buffer = await readCachedKokoroAsset(asset);
  if (buffer) return buffer;

  await cacheKokoroAsset(asset, (progress) => handleAssetProgress(reportStatus)(asset, progress));
  buffer = await readCachedKokoroAsset(asset);
  if (!buffer) throw new Error(`${asset.label} was not cached.`);
  return buffer;
}

function getRuntimeUrls(provider: KokoroExecutionProvider) {
  if (provider === "webgpu") {
    return {
      mjs: KOKORO_ORT_WEBGPU_MJS_URL,
      wasm: KOKORO_ORT_WEBGPU_WASM_URL,
    };
  }

  return {
    mjs: KOKORO_ORT_WASM_MJS_URL,
    wasm: KOKORO_ORT_WASM_URL,
  };
}

async function getOrtModule(provider: KokoroExecutionProvider, wasmBinary: ArrayBuffer): Promise<OrtModule> {
  if (!ortModules.has(provider)) {
    ortModules.set(provider, (async () => {
      const runtime = provider === "webgpu"
        ? await import("onnxruntime-web/webgpu")
        : await import("onnxruntime-web/wasm");
      runtime.env.logLevel = "error";
      runtime.env.wasm.numThreads = 1;
      runtime.env.wasm.proxy = false;
      runtime.env.wasm.wasmPaths = getRuntimeUrls(provider);
      runtime.env.wasm.wasmBinary = wasmBinary;
      return runtime as OrtModule;
    })());
  }

  const runtime = await ortModules.get(provider)!;
  runtime.env.logLevel = "error";
  runtime.env.wasm.wasmBinary = wasmBinary;
  runtime.env.wasm.wasmPaths = getRuntimeUrls(provider);
  return runtime;
}

function parseVoiceFormula(formula: string): VoiceWeight[] {
  const normalized = formula.replace(/\s+/g, "");
  if (!normalized) throw new Error("Choose at least one voice.");
  if (!/^[A-Za-z0-9_\-.*+]+$/.test(normalized)) {
    throw new Error("Voice formula contains unsupported characters.");
  }

  const terms = normalized.split("+").filter(Boolean);
  if (terms.length === 1 && !terms[0].includes("*")) {
    if (!isKokoroVoiceId(terms[0])) throw new Error(`Unknown voice ${terms[0]}.`);
    return [{ voiceId: terms[0], weight: 1 }];
  }

  const voices = terms.map((term) => {
    const [voiceId, weightRaw, extra] = term.split("*");
    if (!voiceId || !weightRaw || extra !== undefined) {
      throw new Error(`Invalid voice blend term: ${term}.`);
    }
    if (!isKokoroVoiceId(voiceId)) throw new Error(`Unknown voice ${voiceId}.`);
    const weight = Number.parseFloat(weightRaw);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(`Invalid voice weight for ${voiceId}.`);
    }
    return { voiceId, weight };
  });

  const totalWeight = voices.reduce((total, voice) => total + voice.weight, 0);
  if (Math.abs(totalWeight - 1) > VOICE_WEIGHT_EPSILON) {
    throw new Error(`Voice blend must total 100%; it totals ${Math.round(totalWeight * 100)}%.`);
  }
  return voices;
}

function getVoiceIds(settings: KokoroDirectSettings): KokoroVoiceId[] {
  return parseVoiceFormula(getVoiceFormula(settings)).map((voice) => voice.voiceId);
}

async function primeKokoroAssetsForProvider(
  settings: KokoroDirectSettings,
  provider: KokoroExecutionProvider,
  reportStatus: StatusReporter,
): Promise<void> {
  const assets = [
    getKokoroOrtRuntimeAsset(provider),
    getKokoroDirectModelAsset(settings.model),
    getKokoroPhonemizerAsset(),
    ...getVoiceIds(settings).map(getKokoroVoiceAsset),
  ];

  await cacheKokoroAssets(
    assets,
    handleAssetProgress(reportStatus),
    (asset, result) => reportStatus(
      "Priming cache",
      `${asset.label}: ${result === "hit" ? "cached" : "stored"}`,
      null,
    ),
  );

  reportStatus("Cache ready", `${getProviderLabel(provider)} runtime + ${KOKORO_MODEL_BY_ID[settings.model].detail} model cached`, 1);
}

export async function primeKokoroDirectAssets(
  settings: KokoroDirectSettings,
  reportStatus: StatusReporter,
): Promise<KokoroExecutionProvider> {
  const provider = await resolveProvider(settings.acceleration, reportStatus);
  await primeKokoroAssetsForProvider(settings, provider, reportStatus);
  return provider;
}

async function loadVoiceVector(voiceId: KokoroVoiceId, reportStatus: StatusReporter): Promise<Float32Array[]> {
  if (!voiceVectors.has(voiceId)) {
    voiceVectors.set(voiceId, (async () => {
      const asset = getKokoroVoiceAsset(voiceId);
      const buffer = await ensureAssetBuffer(asset, reportStatus);
      const raw = new Float32Array(buffer);
      const chunks: Float32Array[] = [];
      for (let from = 0; from < raw.length; from += VOICE_VECTOR_SIZE) {
        chunks.push(raw.slice(from, Math.min(raw.length, from + VOICE_VECTOR_SIZE)));
      }
      return chunks;
    })());
  }
  return voiceVectors.get(voiceId)!;
}

async function combineVoices(formula: string, reportStatus: StatusReporter): Promise<Float32Array[]> {
  const weights = parseVoiceFormula(formula);
  const cacheKey = weights.map((voice) => `${voice.voiceId}*${voice.weight}`).join("+");
  if (!combinedVoices.has(cacheKey)) {
    combinedVoices.set(cacheKey, (async () => {
      const voiceArrays = await Promise.all(weights.map((voice) => loadVoiceVector(voice.voiceId, reportStatus)));
      const baseChunks = voiceArrays[0]?.length || 0;
      if (!baseChunks) throw new Error("Voice file was empty.");
      const combined = Array.from({ length: baseChunks }, () => new Float32Array(VOICE_VECTOR_SIZE));

      for (let voiceIndex = 0; voiceIndex < voiceArrays.length; voiceIndex++) {
        const voice = voiceArrays[voiceIndex];
        if (voice.length !== baseChunks) throw new Error("Voice files have incompatible shapes.");
        const weight = weights[voiceIndex].weight;
        for (let chunkIndex = 0; chunkIndex < baseChunks; chunkIndex++) {
          const source = voice[chunkIndex];
          const target = combined[chunkIndex];
          if (source.length !== VOICE_VECTOR_SIZE) throw new Error("Voice file has an invalid vector size.");
          for (let valueIndex = 0; valueIndex < VOICE_VECTOR_SIZE; valueIndex++) {
            target[valueIndex] += source[valueIndex] * weight;
          }
        }
      }
      return combined;
    })());
  }
  return combinedVoices.get(cacheKey)!;
}

function normalizeText(text: string): string {
  return text
    .slice(0, MAX_TEXT_CHARS)
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
    .replaceAll("\n", "  ")
    .replaceAll("\t", "  ")
    .trim();
}

function sanitizeText(rawText: string): string {
  return rawText
    .replace(/\.\s+/g, "[0.4s]")
    .replace(/,\s+/g, "[0.2s]")
    .replace(/;\s+/g, "[0.4s]")
    .replace(/:\s+/g, "[0.3s]")
    .replace(/!\s+/g, "![0.1s]")
    .replace(/\?\s+/g, "?[0.1s]")
    .replace(/\n+/g, "[0.4s]")
    .trim();
}

function segmentText(text: string): string[] {
  return text
    .split(/(\[[0-9]+(?:\.[0-9]+)?s\])/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isSilenceMarker(segment: string): boolean {
  return /^\[[0-9]+(?:\.[0-9]+)?s\]$/.test(segment);
}

function extractSilenceDuration(segment: string): number {
  const match = segment.match(/^\[([0-9]+(?:\.[0-9]+)?)s\]$/);
  return match ? Math.max(0, Number.parseFloat(match[1])) : 0;
}

function splitPhonemes(phonemes: string, tokensPerChunk: number): string[] {
  if (phonemes.length <= tokensPerChunk) return [phonemes];

  const chunks: string[] = [];
  let currentChunk = "";
  for (const phoneme of phonemes) {
    if (currentChunk.length >= tokensPerChunk) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    currentChunk += phoneme;
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

async function phonemize(text: string, lang: KokoroLangId, reportStatus: StatusReporter): Promise<string> {
  const asset = getKokoroPhonemizerAsset();
  phonemizerBinary ??= await ensureAssetBuffer(asset, reportStatus);
  const normalized = normalizeText(text);
  const espeak = await createESpeakNg({
    wasmBinary: phonemizerBinary,
    arguments: [
      "--phonout",
      "generated",
      "-q",
      "--ipa",
      "-v",
      KOKORO_LANG_BY_ID[lang].id,
      normalized,
    ],
  });
  return espeak.FS.readFile("generated", { encoding: "utf8" }).split("\n").join(" ").trim();
}

async function preprocessText(
  text: string,
  lang: KokoroLangId,
  tokensPerChunk: number,
  reportStatus: StatusReporter,
): Promise<TextProcessorChunk[]> {
  const chunks: TextProcessorChunk[] = [];
  const segments = segmentText(sanitizeText(text));
  for (const segment of segments) {
    if (isSilenceMarker(segment)) {
      chunks.push({ type: "silence", durationSeconds: extractSilenceDuration(segment) });
      continue;
    }

    reportStatus("Phonemizing", segment.slice(0, 64), null);
    const phonemized = await phonemize(segment, lang, reportStatus);
    for (const phonemeChunk of splitPhonemes(phonemized, tokensPerChunk)) {
      const tokens = tokenizeKokoroPhonemes(phonemeChunk);
      if (tokens.length) chunks.push({ type: "text", content: phonemeChunk, tokens });
    }
  }
  return chunks;
}

function trimWaveform(waveform: Float32Array): Float32Array {
  const windowSize = 256;
  const bufferSamples = 256;
  const numWindows = Math.ceil(waveform.length / windowSize);
  const windowAmplitudes = new Float32Array(numWindows);
  let maxWindowAmp = 0;

  for (let i = 0; i < numWindows; i++) {
    const start = i * windowSize;
    const end = Math.min(start + windowSize, waveform.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += Math.abs(waveform[j]);
    const avg = sum / (end - start);
    windowAmplitudes[i] = avg;
    if (avg > maxWindowAmp) maxWindowAmp = avg;
  }

  const threshold = maxWindowAmp * 0.05;
  let startSample = 0;
  for (let i = 0; i < numWindows; i++) {
    if (windowAmplitudes[i] <= threshold) continue;
    const winStart = i * windowSize;
    const winEnd = Math.min(winStart + windowSize, waveform.length);
    for (let j = winStart; j < winEnd; j++) {
      if (Math.abs(waveform[j]) > threshold) {
        startSample = j;
        break;
      }
    }
    break;
  }

  let endSample = waveform.length;
  for (let i = numWindows - 1; i >= 0; i--) {
    if (windowAmplitudes[i] <= threshold) continue;
    const winStart = i * windowSize;
    const winEnd = Math.min(winStart + windowSize, waveform.length);
    for (let j = winEnd - 1; j >= winStart; j--) {
      if (Math.abs(waveform[j]) > threshold) {
        endSample = j + 1;
        break;
      }
    }
    break;
  }

  startSample = Math.max(0, startSample - bufferSamples);
  endSample = Math.min(waveform.length, endSample + bufferSamples);
  return waveform.slice(startSample, endSample);
}

function encodeWavPcm16(waveform: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = waveform.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
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

async function createSession(
  settings: KokoroDirectSettings,
  provider: KokoroExecutionProvider,
  reportStatus: StatusReporter,
) {
  const key = getSettingsKey(settings, provider);
  if (!sessions.has(key)) {
    const sessionPromise = (async () => {
      const runtimeAsset = getKokoroOrtRuntimeAsset(provider);
      const runtimeBinary = await ensureAssetBuffer(runtimeAsset, reportStatus);
      const runtime = await getOrtModule(provider, runtimeBinary);
      const modelAsset = getKokoroDirectModelAsset(settings.model);
      const modelBuffer = await ensureAssetBuffer(modelAsset, reportStatus);
      reportStatus("Loading model", `${KOKORO_MODEL_BY_ID[settings.model].label} on ${getProviderLabel(provider)}`, null);
      const session = await runtime.InferenceSession.create(modelBuffer, {
        executionProviders: [provider],
        logSeverityLevel: 3,
      });
      return { session, provider };
    })();
    sessionPromise.catch(() => sessions.delete(key));
    sessions.set(key, sessionPromise);
  }
  return sessions.get(key)!;
}

export async function loadKokoroDirectEngine(
  settings: KokoroDirectSettings,
  reportStatus: StatusReporter,
): Promise<KokoroExecutionProvider> {
  const provider = await primeKokoroDirectAssets(settings, reportStatus);
  try {
    await createSession(settings, provider, reportStatus);
    reportStatus("Model ready", `${KOKORO_MODEL_BY_ID[settings.model].label} ready on ${getProviderLabel(provider)}`, 1);
    return provider;
  } catch (error) {
    if (settings.acceleration !== "auto" || provider !== "webgpu") throw error;
    reportStatus("CPU fallback", "WebGPU load failed; retrying WASM", null);
    await primeKokoroAssetsForProvider(settings, "wasm", reportStatus);
    await createSession(settings, "wasm", reportStatus);
    reportStatus("Model ready", `${KOKORO_MODEL_BY_ID[settings.model].label} ready on WASM`, 1);
    return "wasm";
  }
}

export async function synthesizeKokoroDirectSpeech(
  text: string,
  settings: KokoroDirectSettings,
  reportStatus: StatusReporter,
): Promise<KokoroDirectSpeechResult> {
  const startedAt = performance.now();
  let provider = await primeKokoroDirectAssets(settings, reportStatus);
  try {
    await createSession(settings, provider, reportStatus);
  } catch (error) {
    if (settings.acceleration !== "auto" || provider !== "webgpu") throw error;
    reportStatus("CPU fallback", "WebGPU generation failed; retrying WASM", null);
    provider = "wasm";
    await primeKokoroAssetsForProvider(settings, provider, reportStatus);
    await createSession(settings, provider, reportStatus);
  }
  const runtimeAsset = getKokoroOrtRuntimeAsset(provider);
  const runtimeBinary = await ensureAssetBuffer(runtimeAsset, reportStatus);
  const runtime = await getOrtModule(provider, runtimeBinary);
  const { session } = await createSession(settings, provider, reportStatus);
  const voice = await combineVoices(getVoiceFormula(settings), reportStatus);
  const chunks = await preprocessText(text, settings.lang, MODEL_CONTEXT_WINDOW - 2, reportStatus);
  const waveforms: Float32Array[] = [];
  let totalLength = 0;

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    reportStatus("Generating", `Chunk ${index + 1} of ${chunks.length}`, chunks.length ? index / chunks.length : null);
    if (chunk.type === "silence") {
      const silence = new Float32Array(Math.floor(chunk.durationSeconds * KOKORO_SAMPLE_RATE));
      waveforms.push(silence);
      totalLength += silence.length;
      continue;
    }

    const tokens = chunk.tokens;
    if (!tokens.length) continue;
    const refS = voice[Math.min(tokens.length - 1, voice.length - 1)];
    const paddedTokens = [0, ...tokens, 0].map(BigInt);
    const inputIds = new runtime.Tensor("int64", BigInt64Array.from(paddedTokens), [1, paddedTokens.length]);
    const style = new runtime.Tensor("float32", refS, [1, refS.length]);
    const speed = new runtime.Tensor("float32", [settings.speed || 1], [1]);
    const result = await session.run({ input_ids: inputIds, style, speed });
    const waveform = trimWaveform(await result.waveform.getData() as Float32Array);
    waveforms.push(waveform);
    totalLength += waveform.length;
  }

  if (!waveforms.length) throw new Error("No speech was generated.");

  const finalWaveform = new Float32Array(totalLength);
  let offset = 0;
  for (const waveform of waveforms) {
    finalWaveform.set(waveform, offset);
    offset += waveform.length;
  }

  const wavBuffer = encodeWavPcm16(finalWaveform, KOKORO_SAMPLE_RATE);
  return {
    blob: new Blob([wavBuffer], { type: "audio/wav" }),
    provider,
    model: settings.model,
    durationMs: Math.max(0, performance.now() - startedAt),
    audioSeconds: finalWaveform.length / KOKORO_SAMPLE_RATE,
  };
}
