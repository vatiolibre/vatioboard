import type { KokoroDtype } from "./kokoro-model-cache.js";

export type KokoroWorkerRequest =
  | { id: number; type: "prime"; dtype: KokoroDtype }
  | { id: number; type: "load"; dtype: KokoroDtype }
  | { id: number; type: "speak"; dtype: KokoroDtype; voice: string; text: string; speed?: number };

export type KokoroWorkerRequestPayload =
  | { type: "prime"; dtype: KokoroDtype }
  | { type: "load"; dtype: KokoroDtype }
  | { type: "speak"; dtype: KokoroDtype; voice: string; text: string; speed?: number };

export type KokoroWorkerResponse =
  | { id: number; type: "status"; status: string; progress?: string; ratio?: number | null }
  | { id: number; type: "primed"; dtype: KokoroDtype }
  | { id: number; type: "loaded"; dtype: KokoroDtype }
  | { id: number; type: "speech"; dtype: KokoroDtype; blob: Blob; size: number; durationMs: number }
  | { id: number; type: "error"; message: string };
