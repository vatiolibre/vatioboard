import type { TtsWorkerRequest, TtsWorkerResponse } from "./tts-worker-protocol.js";
import {
  loadPiperTtsEngine,
  synthesizePiperTtsSpeech,
  type PiperTtsSettings,
} from "./tts-piper-engine.js";

function post(message: TtsWorkerResponse) {
  self.postMessage(message);
}

type SpeechResponse = Extract<TtsWorkerResponse, { type: "speech" }>;
type CachedSpeechResponse = Omit<SpeechResponse, "id" | "durationMs"> & { durationMs: number };

const MAX_SPEECH_CACHE_ITEMS = 10;
const speechCache = new Map<string, CachedSpeechResponse>();

function postStatus(id: number, status: string, progress = "", ratio: number | null = null) {
  post({ id, type: "status", status, progress, ratio });
}

function getSpeechCacheKey(request: TtsWorkerRequest): string {
  const speed = Number.isFinite(request.speed || 0) ? request.speed : 1;
  return [
    request.lang,
    request.piperVoice,
    speed,
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

function getPiperSettings(request: TtsWorkerRequest): PiperTtsSettings {
  return {
    lang: request.lang,
    piperVoice: request.piperVoice,
    speed: request.speed ?? 1,
  };
}

async function handleRequest(request: TtsWorkerRequest) {
  try {
    const piperSettings = getPiperSettings(request);
    const reportStatus = (status: string, progress = "", ratio: number | null = null) => {
      postStatus(request.id, status, progress, ratio);
    };

    if (request.type === "load") {
      const provider = await loadPiperTtsEngine(piperSettings, reportStatus);
      post({ id: request.id, type: "loaded", model: request.piperVoice, provider });
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

self.onmessage = (event: MessageEvent<TtsWorkerRequest>) => {
  void handleRequest(event.data);
};
