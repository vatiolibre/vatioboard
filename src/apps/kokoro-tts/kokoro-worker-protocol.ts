import type {
  KokoroAcceleration,
  KokoroDirectModelId,
  KokoroExecutionProvider,
  KokoroLangId,
  KokoroVoiceId,
  PiperVoiceId,
  TtsEngineId,
} from "./kokoro-direct-resources.js";

export type TtsWorkerModelId = KokoroDirectModelId | PiperVoiceId | "espeak-ng";
export type TtsWorkerProvider = KokoroExecutionProvider | "wasm";

export interface KokoroWorkerSettings {
  acceleration: KokoroAcceleration;
  engine: TtsEngineId;
  lang: KokoroLangId;
  model: KokoroDirectModelId;
  piperVoice: PiperVoiceId;
  voice: KokoroVoiceId;
  voiceFormula?: string;
  speed?: number;
}

export type KokoroWorkerRequest =
  | ({ id: number; type: "prime" } & KokoroWorkerSettings)
  | ({ id: number; type: "load" } & KokoroWorkerSettings)
  | ({ id: number; type: "speak"; text: string } & KokoroWorkerSettings);

export type KokoroWorkerRequestPayload =
  | ({ type: "prime" } & KokoroWorkerSettings)
  | ({ type: "load" } & KokoroWorkerSettings)
  | ({ type: "speak"; text: string } & KokoroWorkerSettings);

export type KokoroWorkerResponse =
  | { id: number; type: "status"; status: string; progress?: string; ratio?: number | null }
  | { id: number; type: "primed"; engine: TtsEngineId; model: TtsWorkerModelId; provider: TtsWorkerProvider }
  | { id: number; type: "loaded"; engine: TtsEngineId; model: TtsWorkerModelId; provider: TtsWorkerProvider }
  | {
    id: number;
    type: "speech";
    engine: TtsEngineId;
    model: TtsWorkerModelId;
    provider: TtsWorkerProvider;
    blob: Blob;
    size: number;
    durationMs: number;
    audioSeconds: number;
  }
  | { id: number; type: "error"; message: string };
