import {
  loadKokoroDirectEngine,
  primeKokoroDirectAssets,
  synthesizeKokoroDirectSpeech,
  type KokoroDirectSettings,
} from "./kokoro-direct-engine.js";
import type { KokoroWorkerRequest, KokoroWorkerResponse } from "./kokoro-worker-protocol.js";
import {
  loadPiperTtsEngine,
  primePiperTtsAssets,
  synthesizePiperTtsSpeech,
  type PiperTtsSettings,
} from "./tts-piper-engine.js";
import {
  loadFastTtsEngine,
  primeFastTtsAssets,
  synthesizeFastTtsSpeech,
  type FastTtsSettings,
} from "./tts-fast-engine.js";

function post(message: KokoroWorkerResponse) {
  self.postMessage(message);
}

type SpeechResponse = Extract<KokoroWorkerResponse, { type: "speech" }>;
type CachedSpeechResponse = Omit<SpeechResponse, "id" | "durationMs"> & { durationMs: number };

const MAX_SPEECH_CACHE_ITEMS = 10;
const speechCache = new Map<string, CachedSpeechResponse>();

function postStatus(id: number, status: string, progress = "", ratio: number | null = null) {
  post({ id, type: "status", status, progress, ratio });
}

function getSpeechCacheKey(request: KokoroWorkerRequest): string {
  const speed = Number.isFinite(request.speed || 0) ? request.speed : 1;
  return [
    request.engine,
    request.lang,
    request.voice,
    request.piperVoice,
    request.model,
    request.acceleration,
    speed,
    "voiceFormula",
    request.voiceFormula || request.voice,
    "text",
    request.type === "speak" ? request.text.trim() : "",
  ].join("\u001f");
}

function postCachedSpeech(id: number, cached: CachedSpeechResponse) {
  postStatus(id, "Speaking", "Generated speech cache hit", 1);
  post({ ...cached, id, durationMs: 0 });
}

function rememberSpeech(key: string, message: SpeechResponse) {
  speechCache.delete(key);
  const { id: _id, ...cached } = message;
  speechCache.set(key, cached);
  while (speechCache.size > MAX_SPEECH_CACHE_ITEMS) {
    const oldestKey = speechCache.keys().next().value;
    if (!oldestKey) break;
    speechCache.delete(oldestKey);
  }
}

function getSettings(request: KokoroWorkerRequest): KokoroDirectSettings {
  return {
    acceleration: request.acceleration,
    lang: request.lang,
    model: request.model,
    voice: request.voice,
    voiceFormula: request.voiceFormula || request.voice,
    speed: request.speed ?? 1,
  };
}

function getFastSettings(request: KokoroWorkerRequest): FastTtsSettings {
  return {
    lang: request.lang,
    voice: request.voice,
    speed: request.speed ?? 1,
  };
}

function getPiperSettings(request: KokoroWorkerRequest): PiperTtsSettings {
  return {
    lang: request.lang,
    piperVoice: request.piperVoice,
    speed: request.speed ?? 1,
  };
}

async function handleRequest(request: KokoroWorkerRequest) {
  try {
    const settings = getSettings(request);
    const reportStatus = (status: string, progress = "", ratio: number | null = null) => {
      postStatus(request.id, status, progress, ratio);
    };

    if (request.engine === "espeak") {
      const fastSettings = getFastSettings(request);
      if (request.type === "prime") {
        const provider = await primeFastTtsAssets(reportStatus);
        post({ id: request.id, type: "primed", engine: request.engine, model: "espeak-ng", provider });
        return;
      }

      if (request.type === "load") {
        const provider = await loadFastTtsEngine(reportStatus);
        post({ id: request.id, type: "loaded", engine: request.engine, model: "espeak-ng", provider });
        return;
      }

      const cacheKey = getSpeechCacheKey(request);
      const cached = speechCache.get(cacheKey);
      if (cached) {
        speechCache.delete(cacheKey);
        speechCache.set(cacheKey, cached);
        postCachedSpeech(request.id, cached);
        return;
      }

      const speech = await synthesizeFastTtsSpeech(request.text, fastSettings, reportStatus);
      const response: SpeechResponse = {
        id: request.id,
        type: "speech",
        engine: request.engine,
        model: speech.model,
        provider: speech.provider,
        blob: speech.blob,
        size: speech.blob.size,
        durationMs: speech.durationMs,
        audioSeconds: speech.audioSeconds,
      };
      rememberSpeech(cacheKey, response);
      post(response);
      return;
    }

    if (request.engine === "piper") {
      const piperSettings = getPiperSettings(request);
      if (request.type === "prime") {
        const provider = await primePiperTtsAssets(piperSettings, reportStatus);
        post({ id: request.id, type: "primed", engine: request.engine, model: request.piperVoice, provider });
        return;
      }

      if (request.type === "load") {
        const provider = await loadPiperTtsEngine(piperSettings, reportStatus);
        post({ id: request.id, type: "loaded", engine: request.engine, model: request.piperVoice, provider });
        return;
      }

      const cacheKey = getSpeechCacheKey(request);
      const cached = speechCache.get(cacheKey);
      if (cached) {
        speechCache.delete(cacheKey);
        speechCache.set(cacheKey, cached);
        postCachedSpeech(request.id, cached);
        return;
      }

      const speech = await synthesizePiperTtsSpeech(request.text, piperSettings, reportStatus);
      const response: SpeechResponse = {
        id: request.id,
        type: "speech",
        engine: request.engine,
        model: speech.model,
        provider: speech.provider,
        blob: speech.blob,
        size: speech.blob.size,
        durationMs: speech.durationMs,
        audioSeconds: speech.audioSeconds,
      };
      rememberSpeech(cacheKey, response);
      post(response);
      return;
    }

    if (request.type === "prime") {
      const provider = await primeKokoroDirectAssets(settings, reportStatus);
      post({ id: request.id, type: "primed", engine: request.engine, model: request.model, provider });
      return;
    }

    if (request.type === "load") {
      const provider = await loadKokoroDirectEngine(settings, reportStatus);
      post({ id: request.id, type: "loaded", engine: request.engine, model: request.model, provider });
      return;
    }

    const cacheKey = getSpeechCacheKey(request);
    const cached = speechCache.get(cacheKey);
    if (cached) {
      speechCache.delete(cacheKey);
      speechCache.set(cacheKey, cached);
      postCachedSpeech(request.id, cached);
      return;
    }

    const speech = await synthesizeKokoroDirectSpeech(request.text, settings, reportStatus);
    const response: SpeechResponse = {
      id: request.id,
      type: "speech",
      engine: request.engine,
      model: speech.model,
      provider: speech.provider,
      blob: speech.blob,
      size: speech.blob.size,
      durationMs: speech.durationMs,
      audioSeconds: speech.audioSeconds,
    };
    rememberSpeech(cacheKey, response);
    post(response);
  } catch (error) {
    post({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : "TTS worker failed.",
    });
  }
}

self.onmessage = (event: MessageEvent<KokoroWorkerRequest>) => {
  void handleRequest(event.data);
};
