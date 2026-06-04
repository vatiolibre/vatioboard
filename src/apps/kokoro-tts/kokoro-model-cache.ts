import { createChunkedBlobStore, type ChunkedBlobRecord, type ChunkedBlobStore } from "../../shared/chunked-blob-store.js";
import { createIndexedJsonKeyValueStore } from "../../shared/indexed-storage.js";
import type { KokoroDirectModelId, KokoroExecutionProvider } from "./kokoro-direct-resources.js";

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_REVISION = "main";
export const KOKORO_DIRECT_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
export const KOKORO_ORT_WASM_VERSION = "1.22.0-dev.20250409-89f8206ba4";
export const KOKORO_ORT_WASM_MJS_FILE = "ort-wasm-simd-threaded.mjs";
export const KOKORO_ORT_WASM_FILE = "ort-wasm-simd-threaded.wasm";
export const KOKORO_ORT_WEBGPU_MJS_FILE = "ort-wasm-simd-threaded.jsep.mjs";
export const KOKORO_ORT_WEBGPU_WASM_FILE = "ort-wasm-simd-threaded.jsep.wasm";
export const KOKORO_ORT_WASM_MJS_URL =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${KOKORO_ORT_WASM_VERSION}/dist/${KOKORO_ORT_WASM_MJS_FILE}`;
export const KOKORO_ORT_WASM_URL =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${KOKORO_ORT_WASM_VERSION}/dist/${KOKORO_ORT_WASM_FILE}`;
export const KOKORO_ORT_WEBGPU_MJS_URL =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${KOKORO_ORT_WASM_VERSION}/dist/${KOKORO_ORT_WEBGPU_MJS_FILE}`;
export const KOKORO_ORT_WEBGPU_WASM_URL =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${KOKORO_ORT_WASM_VERSION}/dist/${KOKORO_ORT_WEBGPU_WASM_FILE}`;
export const KOKORO_ESPEAK_VERSION = "1.0.2";
export const KOKORO_ESPEAK_WASM_FILE = "espeak-ng.wasm";
export const KOKORO_ESPEAK_WASM_URL =
  `https://cdn.jsdelivr.net/npm/espeak-ng@${KOKORO_ESPEAK_VERSION}/dist/${KOKORO_ESPEAK_WASM_FILE}`;

const KOKORO_DB_NAME = "vatioboard_kokoro_tts_assets";
const KOKORO_STORE_NAME = "kokoro_assets";
const RANGE_CHUNK_BYTES = 5 * 1024 * 1024;
const SINGLE_RESPONSE_LIMIT_BYTES = 9.5 * 1024 * 1024;

export type KokoroDtype = "q8" | "fp32" | "fp16" | "q4" | "q4f16";

export interface KokoroAssetDescriptor {
  file: string;
  label: string;
  kind: "config" | "tokenizer" | "model" | "runtime" | "voice" | "phonemizer";
  url?: string;
}

export interface KokoroAssetProgress {
  file: string;
  loadedBytes: number;
  totalBytes: number | null;
  rangeIndex?: number;
  rangeCount?: number;
}

interface KokoroCacheRecord extends ChunkedBlobRecord {
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

const kokoroAssetStore = createChunkedBlobStore(
  createIndexedJsonKeyValueStore({
    dbName: KOKORO_DB_NAME,
    storeName: KOKORO_STORE_NAME,
  }),
) as ChunkedBlobStore<KokoroCacheRecord>;

const MODEL_FILE_BY_DTYPE: Record<KokoroDtype, string> = {
  q8: "onnx/model_quantized.onnx",
  fp32: "onnx/model.onnx",
  fp16: "onnx/model_fp16.onnx",
  q4: "onnx/model_q4.onnx",
  q4f16: "onnx/model_q4f16.onnx",
};

const MODEL_FILE_BY_DIRECT_MODEL: Record<KokoroDirectModelId, string> = {
  model_q8f16: "onnx/model_q8f16.onnx",
  model_quantized: "onnx/model_quantized.onnx",
  model_uint8f16: "onnx/model_uint8f16.onnx",
  model_q4f16: "onnx/model_q4f16.onnx",
};

export function kokoroModelUrl(file: string): string {
  return `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/${KOKORO_REVISION}/${file}`;
}

export function kokoroDirectModelUrl(file: string): string {
  return `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/${KOKORO_DIRECT_REVISION}/${file}`;
}

export function getKokoroRuntimeAsset(): KokoroAssetDescriptor {
  return {
    file: KOKORO_ORT_WASM_FILE,
    label: "ONNX Runtime",
    kind: "runtime",
    url: KOKORO_ORT_WASM_URL,
  };
}

export function getKokoroOrtRuntimeAsset(provider: KokoroExecutionProvider): KokoroAssetDescriptor {
  if (provider === "webgpu") {
    return {
      file: KOKORO_ORT_WEBGPU_WASM_FILE,
      label: "ONNX Runtime WebGPU",
      kind: "runtime",
      url: KOKORO_ORT_WEBGPU_WASM_URL,
    };
  }

  return getKokoroRuntimeAsset();
}

export function getKokoroCoreAssets(dtype: KokoroDtype): KokoroAssetDescriptor[] {
  return [
    { file: "config.json", label: "Model config", kind: "config" },
    { file: "tokenizer.json", label: "Tokenizer", kind: "tokenizer" },
    { file: "tokenizer_config.json", label: "Tokenizer config", kind: "tokenizer" },
    { file: MODEL_FILE_BY_DTYPE[dtype] || MODEL_FILE_BY_DTYPE.q8, label: `${dtype.toUpperCase()} ONNX`, kind: "model" },
  ];
}

export function getKokoroDirectModelAsset(model: KokoroDirectModelId): KokoroAssetDescriptor {
  const file = MODEL_FILE_BY_DIRECT_MODEL[model] || MODEL_FILE_BY_DIRECT_MODEL.model_q8f16;
  return {
    file,
    label: `${model.replace(/^model_/, "").toUpperCase()} ONNX`,
    kind: "model",
    url: kokoroDirectModelUrl(file),
  };
}

export function getKokoroVoiceAsset(voice: string): KokoroAssetDescriptor {
  return {
    file: `voices/${voice}.bin`,
    label: `${voice} voice`,
    kind: "voice",
    url: kokoroDirectModelUrl(`voices/${voice}.bin`),
  };
}

export function getKokoroPhonemizerAsset(): KokoroAssetDescriptor {
  return {
    file: KOKORO_ESPEAK_WASM_FILE,
    label: "eSpeak NG phonemizer",
    kind: "phonemizer",
    url: KOKORO_ESPEAK_WASM_URL,
  };
}

export function getKokoroPrimeAssets(dtype: KokoroDtype): KokoroAssetDescriptor[] {
  return [
    getKokoroRuntimeAsset(),
    ...getKokoroCoreAssets(dtype),
  ];
}

function assetUrl(asset: KokoroAssetDescriptor): string {
  return asset.url || kokoroModelUrl(asset.file);
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

export async function probeKokoroAsset(asset: KokoroAssetDescriptor): Promise<AssetProbe> {
  const url = assetUrl(asset);
  const response = await fetch(url, { method: "HEAD" });
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
  asset: KokoroAssetDescriptor,
  probe: AssetProbe,
  onProgress?: (progress: KokoroAssetProgress) => void,
): Response {
  const url = assetUrl(asset);
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
          const response = await fetch(url);
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
          const response = await fetch(url, {
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

export function createKokoroChunkedCache() {
  return {
    async match(request: RequestInfo | URL): Promise<Response | undefined> {
      const key = requestToKey(request);
      const entry = await kokoroAssetStore.getValue(key).catch(() => null);
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
      const ok = await kokoroAssetStore.streamResponse(key, response, {
        cached_at: Date.now(),
        content_type: contentType,
        headers,
        source_url: key,
      });
      if (!ok) throw new Error(`Unable to cache ${key}.`);
    },
  };
}

export async function isKokoroAssetCached(file: string): Promise<boolean> {
  const cached = await createKokoroChunkedCache().match(kokoroModelUrl(file));
  return Boolean(cached);
}

export async function cacheKokoroAsset(
  asset: KokoroAssetDescriptor,
  onProgress?: (progress: KokoroAssetProgress) => void,
): Promise<"hit" | "stored"> {
  const cache = createKokoroChunkedCache();
  const url = assetUrl(asset);
  const cached = await cache.match(url);
  if (cached) return "hit";

  const probe = await probeKokoroAsset(asset);
  const response = createTeslaSafeAssetResponse(asset, probe, onProgress);
  await cache.put(url, response);
  return "stored";
}

export async function readCachedKokoroAsset(asset: KokoroAssetDescriptor): Promise<ArrayBuffer | null> {
  const response = await createKokoroChunkedCache().match(assetUrl(asset));
  if (!response) return null;
  return response.arrayBuffer();
}

export async function cacheKokoroAssets(
  assets: KokoroAssetDescriptor[],
  onProgress?: (asset: KokoroAssetDescriptor, progress: KokoroAssetProgress) => void,
  onAssetDone?: (asset: KokoroAssetDescriptor, result: "hit" | "stored") => void,
): Promise<void> {
  for (const asset of assets) {
    const result = await cacheKokoroAsset(asset, (progress) => onProgress?.(asset, progress));
    onAssetDone?.(asset, result);
  }
}
