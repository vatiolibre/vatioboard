import type {
  KokoroAcceleration,
  KokoroDirectModelId,
  KokoroExecutionProvider,
  KokoroLangId,
  KokoroVoiceId,
} from "./kokoro-direct-resources.js";

export interface KokoroWorkerSettings {
  acceleration: KokoroAcceleration;
  lang: KokoroLangId;
  model: KokoroDirectModelId;
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
  | { id: number; type: "primed"; model: KokoroDirectModelId; provider: KokoroExecutionProvider }
  | { id: number; type: "loaded"; model: KokoroDirectModelId; provider: KokoroExecutionProvider }
  | {
    id: number;
    type: "speech";
    model: KokoroDirectModelId;
    provider: KokoroExecutionProvider;
    blob: Blob;
    size: number;
    durationMs: number;
    audioSeconds: number;
  }
  | { id: number; type: "error"; message: string };
