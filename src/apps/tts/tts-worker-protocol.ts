import type { PiperVoiceId, TtsLangId } from "./tts-resources.js";

export interface TtsWorkerSettings {
  lang: TtsLangId;
  piperVoice: PiperVoiceId;
  speed?: number;
}

export type TtsWorkerRequest =
  | ({ id: number; type: "load" } & TtsWorkerSettings)
  | ({ id: number; type: "speak"; text: string } & TtsWorkerSettings);

export type TtsWorkerRequestPayload =
  | ({ type: "load" } & TtsWorkerSettings)
  | ({ type: "speak"; text: string } & TtsWorkerSettings);

export type TtsWorkerResponse =
  | { id: number; type: "status"; status: string; progress?: string; ratio?: number | null }
  | { id: number; type: "loaded"; model: PiperVoiceId; provider: "wasm" }
  | {
    id: number;
    type: "speech";
    model: PiperVoiceId;
    provider: "wasm";
    blob: Blob;
    size: number;
    durationMs: number;
    audioSeconds: number;
  }
  | { id: number; type: "error"; message: string };
