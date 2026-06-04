import {
  loadKokoroDirectEngine,
  primeKokoroDirectAssets,
  synthesizeKokoroDirectSpeech,
  type KokoroDirectSettings,
} from "./kokoro-direct-engine.js";
import type { KokoroWorkerRequest, KokoroWorkerResponse } from "./kokoro-worker-protocol.js";

function post(message: KokoroWorkerResponse) {
  self.postMessage(message);
}

function postStatus(id: number, status: string, progress = "", ratio: number | null = null) {
  post({ id, type: "status", status, progress, ratio });
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

async function handleRequest(request: KokoroWorkerRequest) {
  try {
    const settings = getSettings(request);
    const reportStatus = (status: string, progress = "", ratio: number | null = null) => {
      postStatus(request.id, status, progress, ratio);
    };

    if (request.type === "prime") {
      const provider = await primeKokoroDirectAssets(settings, reportStatus);
      post({ id: request.id, type: "primed", model: request.model, provider });
      return;
    }

    if (request.type === "load") {
      const provider = await loadKokoroDirectEngine(settings, reportStatus);
      post({ id: request.id, type: "loaded", model: request.model, provider });
      return;
    }

    const speech = await synthesizeKokoroDirectSpeech(request.text, settings, reportStatus);
    post({
      id: request.id,
      type: "speech",
      model: speech.model,
      provider: speech.provider,
      blob: speech.blob,
      size: speech.blob.size,
      durationMs: speech.durationMs,
      audioSeconds: speech.audioSeconds,
    });
  } catch (error) {
    post({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : "Kokoro worker failed.",
    });
  }
}

self.onmessage = (event: MessageEvent<KokoroWorkerRequest>) => {
  void handleRequest(event.data);
};
