import {
  cacheKokoroAsset,
  getKokoroPhonemizerAsset,
  readCachedKokoroAsset,
} from "./kokoro-model-cache.js";
import {
  KOKORO_LANG_BY_ID,
  type KokoroLangId,
  type KokoroVoiceId,
} from "./kokoro-direct-resources.js";
import createESpeakNg from "./vendor/espeak-ng.js";

export type FastTtsStatusReporter = (status: string, progress?: string, ratio?: number | null) => void;

export interface FastTtsSettings {
  lang: KokoroLangId;
  voice: KokoroVoiceId;
  speed?: number;
}

export interface FastTtsSpeechResult {
  blob: Blob;
  model: "espeak-ng";
  provider: "wasm";
  durationMs: number;
  audioSeconds: number;
}

const ESPEAK_MODEL_ID = "espeak-ng";
const ESPEAK_DEFAULT_WPM = 168;
const ESPEAK_MIN_WPM = 120;
const ESPEAK_MAX_WPM = 240;
const ESPEAK_MAX_TEXT_CHARS = 1800;

let espeakBinary: ArrayBuffer | null = null;

function normalizeText(text: string): string {
  return text
    .slice(0, ESPEAK_MAX_TEXT_CHARS)
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

function getEspeakVoice(settings: FastTtsSettings): string {
  const lang = KOKORO_LANG_BY_ID[settings.lang]?.id || "en-us";
  if (/^[a-z]m_/.test(settings.voice)) return `${lang}+m3`;
  if (/^[a-z]f_/.test(settings.voice)) return `${lang}+f3`;
  return lang;
}

function getWordsPerMinute(speed: number | undefined): number {
  const normalized = Number.isFinite(speed || 0) && speed ? speed : 1;
  return Math.round(Math.max(ESPEAK_MIN_WPM, Math.min(ESPEAK_MAX_WPM, ESPEAK_DEFAULT_WPM * normalized)));
}

function getWavDurationSeconds(bytes: Uint8Array): number {
  if (bytes.byteLength < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  const dataSize = view.getUint32(40, true);
  if (!byteRate || !Number.isFinite(byteRate)) return 0;
  return dataSize / byteRate;
}

async function ensureEspeakBinary(reportStatus: FastTtsStatusReporter): Promise<ArrayBuffer> {
  if (espeakBinary) return espeakBinary;
  const asset = getKokoroPhonemizerAsset();
  let buffer = await readCachedKokoroAsset(asset);
  if (!buffer) {
    reportStatus("Priming fast voice", `${asset.label}: downloading`, null);
    await cacheKokoroAsset(asset, (progress) => {
      const ratio = progress.totalBytes ? progress.loadedBytes / progress.totalBytes : null;
      reportStatus("Priming fast voice", `${asset.label}: ${progress.rangeIndex || 1}/${progress.rangeCount || 1}`, ratio);
    });
    buffer = await readCachedKokoroAsset(asset);
  }
  if (!buffer) throw new Error("Fast TTS runtime was not cached.");
  espeakBinary = buffer;
  return espeakBinary;
}

export async function primeFastTtsAssets(reportStatus: FastTtsStatusReporter): Promise<"wasm"> {
  await ensureEspeakBinary(reportStatus);
  reportStatus("Fast voice ready", "eSpeak NG cached", 1);
  return "wasm";
}

export async function loadFastTtsEngine(reportStatus: FastTtsStatusReporter): Promise<"wasm"> {
  await ensureEspeakBinary(reportStatus);
  reportStatus("Fast voice ready", "eSpeak NG WASM ready", 1);
  return "wasm";
}

export async function synthesizeFastTtsSpeech(
  text: string,
  settings: FastTtsSettings,
  reportStatus: FastTtsStatusReporter,
): Promise<FastTtsSpeechResult> {
  const startedAt = performance.now();
  const wasmBinary = await ensureEspeakBinary(reportStatus);
  const normalized = normalizeText(text);
  if (!normalized) throw new Error("No text was provided.");

  const outputFile = "generated.wav";
  reportStatus("Generating", "Fast eSpeak voice", null);
  const espeak = await createESpeakNg({
    wasmBinary,
    arguments: [
      "-v",
      getEspeakVoice(settings),
      "-s",
      String(getWordsPerMinute(settings.speed)),
      "-p",
      "46",
      "-a",
      "155",
      "-w",
      outputFile,
      normalized,
    ],
  });
  const wavBytes = new Uint8Array(espeak.FS.readFile(outputFile));
  return {
    blob: new Blob([wavBytes], { type: "audio/wav" }),
    model: ESPEAK_MODEL_ID,
    provider: "wasm",
    durationMs: Math.max(0, performance.now() - startedAt),
    audioSeconds: getWavDurationSeconds(wavBytes),
  };
}
