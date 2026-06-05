import { createChunkedBlobStore, type ChunkedBlobRecord, type ChunkedBlobStore } from "../../shared/chunked-blob-store.js";
import { createIndexedJsonKeyValueStore } from "../../shared/indexed-storage.js";
import type { PiperVoiceId } from "./tts-resources.js";

export const TTS_ORT_WASM_VERSION = "1.22.0-dev.20250409-89f8206ba4";
export const TTS_ORT_WASM_FILE = "ort-wasm-simd-threaded.wasm";
export const TTS_ORT_WASM_URL =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${TTS_ORT_WASM_VERSION}/dist/${TTS_ORT_WASM_FILE}`;
export const PIPER_TTS_WEB_VERSION = "1.1.2";
export const PIPER_VOICES_MODEL_ID = "rhasspy/piper-voices";
export const PIPER_VOICES_REVISION = "b710b0ba0740da88dc36e1ab8fa6b310d43a3a48";
export const PIPER_PHONEMIZER_WASM_FILE = "piper_phonemize.wasm";
export const PIPER_PHONEMIZER_DATA_FILE = "piper_phonemize.data";
export const PIPER_PHONEMIZER_WASM_URL =
  `https://unpkg.com/piper-tts-web@${PIPER_TTS_WEB_VERSION}/dist/piper/${PIPER_PHONEMIZER_WASM_FILE}`;
export const PIPER_PHONEMIZER_DATA_URL =
  `https://unpkg.com/piper-tts-web@${PIPER_TTS_WEB_VERSION}/dist/piper/${PIPER_PHONEMIZER_DATA_FILE}`;

const TTS_DB_NAME = "vatioboard_tts_assets";
const TTS_STORE_NAME = "tts_assets";
const RANGE_CHUNK_BYTES = 5 * 1024 * 1024;
const SINGLE_RESPONSE_LIMIT_BYTES = 9.5 * 1024 * 1024;

export interface TtsAssetDescriptor {
  file: string;
  label: string;
  kind: "config" | "model" | "runtime" | "phonemizer";
  url: string;
}

export interface TtsAssetProgress {
  file: string;
  loadedBytes: number;
  totalBytes: number | null;
  rangeIndex?: number;
  rangeCount?: number;
}

interface TtsCacheRecord extends ChunkedBlobRecord {
  blob?: Blob;
  cached_at?: number;
  content_type?: string;
  headers?: Record<string, string>;
  source_url?: string;
}

interface AssetProbe {
  contentType: string;
  totalBytes: number | null;
  acceptsRanges: boolean;
}

const ttsAssetStore = createChunkedBlobStore(
  createIndexedJsonKeyValueStore({
    dbName: TTS_DB_NAME,
    storeName: TTS_STORE_NAME,
  }),
) as ChunkedBlobStore<TtsCacheRecord>;

function getPiperVoiceFileStem(voice: PiperVoiceId): string {
  const firstDashIndex = voice.indexOf("-");
  const lastDashIndex = voice.lastIndexOf("-");
  const locale = voice.slice(0, firstDashIndex);
  const dataset = voice.slice(firstDashIndex + 1, lastDashIndex);
  const quality = voice.slice(lastDashIndex + 1);
  const languageFamily = locale.split("_")[0];
  return `${languageFamily}/${locale}/${dataset}/${quality}/${voice}`;
}

export function piperVoiceUrl(file: string): string {
  return `https://huggingface.co/${PIPER_VOICES_MODEL_ID}/resolve/${PIPER_VOICES_REVISION}/${file}`;
}

export function getTtsRuntimeAsset(): TtsAssetDescriptor {
  return {
    file: TTS_ORT_WASM_FILE,
    label: "ONNX Runtime",
    kind: "runtime",
    url: TTS_ORT_WASM_URL,
  };
}

export function getPiperPhonemizerAssets(): TtsAssetDescriptor[] {
  return [
    {
      file: PIPER_PHONEMIZER_WASM_FILE,
      label: "Piper phonemizer WASM",
      kind: "phonemizer",
      url: PIPER_PHONEMIZER_WASM_URL,
    },
    {
      file: PIPER_PHONEMIZER_DATA_FILE,
      label: "Piper phonemizer data",
      kind: "phonemizer",
      url: PIPER_PHONEMIZER_DATA_URL,
    },
  ];
}

export function getPiperVoiceConfigAsset(voice: PiperVoiceId): TtsAssetDescriptor {
  const file = `${getPiperVoiceFileStem(voice)}.onnx.json`;
  return {
    file,
    label: `${voice} config`,
    kind: "config",
    url: piperVoiceUrl(file),
  };
}

export function getPiperVoiceModelAsset(voice: PiperVoiceId): TtsAssetDescriptor {
  const file = `${getPiperVoiceFileStem(voice)}.onnx`;
  return {
    file,
    label: `${voice} ONNX`,
    kind: "model",
    url: piperVoiceUrl(file),
  };
}

export function getPiperVoiceAssets(voice: PiperVoiceId): TtsAssetDescriptor[] {
  return [
    getPiperVoiceConfigAsset(voice),
    getPiperVoiceModelAsset(voice),
  ];
}

function requestToKey(request: RequestInfo | URL): string {
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

function headersToRecord(headers: Headers | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  headers?.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readIntoController(
  response: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
  onBytes: (byteLength: number) => void,
): Promise<void> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    controller.enqueue(bytes);
    onBytes(bytes.byteLength);
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      controller.enqueue(value);
      onBytes(value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function probeTtsAsset(asset: TtsAssetDescriptor): Promise<AssetProbe> {
  const response = await fetch(asset.url, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(`Unable to inspect ${asset.file} (${response.status}).`);
  }

  return {
    contentType: response.headers.get("content-type") || "application/octet-stream",
    totalBytes: parseContentLength(response.headers.get("content-length")),
    acceptsRanges: /bytes/i.test(response.headers.get("accept-ranges") || ""),
  };
}

export function createTeslaSafeAssetResponse(
  asset: TtsAssetDescriptor,
  probe: AssetProbe,
  onProgress?: (progress: TtsAssetProgress) => void,
): Response {
  const total = probe.totalBytes;
  const useRanges = Boolean(total && total > SINGLE_RESPONSE_LIMIT_BYTES && probe.acceptsRanges);
  const rangeCount = useRanges && total ? Math.ceil(total / RANGE_CHUNK_BYTES) : 1;
  let loadedBytes = 0;

  if (total && total > SINGLE_RESPONSE_LIMIT_BYTES && !probe.acceptsRanges) {
    throw new Error(`${asset.file} is larger than 10 MB and the server did not advertise byte ranges.`);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!useRanges || !total) {
          const response = await fetch(asset.url);
          if (!response.ok) throw new Error(`Download failed for ${asset.file} (${response.status}).`);
          await readIntoController(response, controller, (byteLength) => {
            loadedBytes += byteLength;
            onProgress?.({ file: asset.file, loadedBytes, totalBytes: total });
          });
          controller.close();
          return;
        }

        for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex++) {
          const start = rangeIndex * RANGE_CHUNK_BYTES;
          const end = Math.min(start + RANGE_CHUNK_BYTES - 1, total - 1);
          const response = await fetch(asset.url, {
            headers: {
              Range: `bytes=${start}-${end}`,
            },
          });
          if (response.status !== 206) {
            throw new Error(`Range request failed for ${asset.file} (${response.status}).`);
          }
          await readIntoController(response, controller, (byteLength) => {
            loadedBytes += byteLength;
            onProgress?.({
              file: asset.file,
              loadedBytes,
              totalBytes: total,
              rangeIndex: rangeIndex + 1,
              rangeCount,
            });
          });
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const headers = new Headers({
    "content-type": probe.contentType,
  });
  if (total !== null) headers.set("content-length", String(total));

  return new Response(stream, { status: 200, headers });
}

export function createTtsChunkedCache() {
  return {
    async match(request: RequestInfo | URL): Promise<Response | undefined> {
      const key = requestToKey(request);
      const entry = await ttsAssetStore.getValue(key).catch(() => null);
      if (!entry?.blob) return undefined;

      const headers = new Headers(entry.headers || {});
      if (entry.content_type && !headers.has("content-type")) headers.set("content-type", entry.content_type);
      if (!headers.has("content-length")) headers.set("content-length", String(entry.blob.size || 0));
      return new Response(entry.blob, { status: 200, headers });
    },

    async put(request: RequestInfo | URL, response: Response): Promise<void> {
      const key = requestToKey(request);
      const headers = headersToRecord(response.headers);
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const ok = await ttsAssetStore.streamResponse(key, response, {
        cached_at: Date.now(),
        content_type: contentType,
        headers,
        source_url: key,
      });
      if (!ok) throw new Error(`Unable to cache ${key}.`);
    },
  };
}

export async function cacheTtsAsset(
  asset: TtsAssetDescriptor,
  onProgress?: (progress: TtsAssetProgress) => void,
): Promise<"hit" | "stored"> {
  const cache = createTtsChunkedCache();
  const cached = await cache.match(asset.url);
  if (cached) return "hit";

  const probe = await probeTtsAsset(asset);
  const response = createTeslaSafeAssetResponse(asset, probe, onProgress);
  await cache.put(asset.url, response);
  return "stored";
}

export async function readCachedTtsAsset(asset: TtsAssetDescriptor): Promise<ArrayBuffer | null> {
  const response = await createTtsChunkedCache().match(asset.url);
  if (!response) return null;
  return response.arrayBuffer();
}

export async function cacheTtsAssets(
  assets: TtsAssetDescriptor[],
  onProgress?: (asset: TtsAssetDescriptor, progress: TtsAssetProgress) => void,
  onAssetDone?: (asset: TtsAssetDescriptor, result: "hit" | "stored") => void,
): Promise<void> {
  for (const asset of assets) {
    try {
      const result = await cacheTtsAsset(asset, (progress) => onProgress?.(asset, progress));
      onAssetDone?.(asset, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "asset preparation failed";
      throw new Error(`${asset.label} failed: ${message}`, { cause: error });
    }
  }
}
