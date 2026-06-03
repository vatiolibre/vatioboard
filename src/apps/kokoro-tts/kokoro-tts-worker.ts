import { env as transformersEnv } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import {
  cacheKokoroAsset,
  cacheKokoroAssets,
  createKokoroChunkedCache,
  getKokoroPrimeAssets,
  getKokoroRuntimeAsset,
  KOKORO_MODEL_ID,
  KOKORO_ORT_WASM_MJS_URL,
  KOKORO_ORT_WASM_URL,
  readCachedKokoroAsset,
  type KokoroAssetDescriptor,
  type KokoroAssetProgress,
  type KokoroDtype,
} from "./kokoro-model-cache.js";
import type { KokoroWorkerRequest, KokoroWorkerResponse } from "./kokoro-worker-protocol.js";

type KokoroTtsInstance = {
  generate(text: string, options?: { voice?: string; speed?: number }): Promise<{ toBlob(): Blob }>;
};

type OnnxWasmEnv = {
  numThreads?: number;
  proxy?: boolean;
  wasmBinary?: ArrayBuffer | Uint8Array;
  wasmPaths?: string | {
    mjs?: string | URL;
    wasm?: string | URL;
  };
};

let tts: KokoroTtsInstance | null = null;
let loadedDtype: KokoroDtype | null = null;
let loadingDtype: KokoroDtype | null = null;
let loadingPromise: Promise<KokoroTtsInstance> | null = null;

function post(message: KokoroWorkerResponse) {
  self.postMessage(message);
}

function postStatus(id: number, status: string, progress = "", ratio: number | null = null) {
  post({ id, type: "status", status, progress, ratio });
}

function formatBytes(value: number | null | undefined): string {
  if (!Number.isFinite(value || 0) || !value) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex++;
  }
  return `${scaled >= 10 || unitIndex === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unitIndex]}`;
}

function getOnnxWasmEnv(): OnnxWasmEnv {
  const onnxEnv = transformersEnv.backends.onnx as { wasm?: OnnxWasmEnv };
  onnxEnv.wasm ??= {};
  return onnxEnv.wasm;
}

function configureTransformersCache() {
  transformersEnv.useCustomCache = true;
  transformersEnv.customCache = createKokoroChunkedCache();
  transformersEnv.useBrowserCache = false;
  transformersEnv.allowLocalModels = false;
  transformersEnv.allowRemoteModels = true;
  const wasmEnv = getOnnxWasmEnv();
  wasmEnv.numThreads = 1;
  wasmEnv.proxy = false;
  wasmEnv.wasmPaths = {
    mjs: KOKORO_ORT_WASM_MJS_URL,
    wasm: KOKORO_ORT_WASM_URL,
  };
}

function handleAssetProgress(requestId: number, asset: KokoroAssetDescriptor, assetProgress: KokoroAssetProgress) {
  const total = assetProgress.totalBytes;
  const ratio = total ? assetProgress.loadedBytes / total : null;
  const range = assetProgress.rangeCount
    ? `, range ${assetProgress.rangeIndex}/${assetProgress.rangeCount}`
    : "";
  postStatus(
    requestId,
    "Priming cache",
    `${asset.label}: ${formatBytes(assetProgress.loadedBytes)} / ${formatBytes(total)}${range}`,
    ratio,
  );
}

async function prepareOnnxRuntimeBinary(requestId: number) {
  const wasmEnv = getOnnxWasmEnv();
  if (wasmEnv.wasmBinary) return;

  const runtimeAsset = getKokoroRuntimeAsset();
  let buffer = await readCachedKokoroAsset(runtimeAsset);
  if (!buffer) {
    await cacheKokoroAsset(runtimeAsset, (assetProgress) => handleAssetProgress(requestId, runtimeAsset, assetProgress));
    buffer = await readCachedKokoroAsset(runtimeAsset);
  }
  if (!buffer) throw new Error("ONNX Runtime WASM binary was not cached.");
  wasmEnv.wasmBinary = buffer;
  postStatus(requestId, "Runtime ready", `${formatBytes(buffer.byteLength)} ONNX Runtime WASM`, 1);
}

async function primeCache(requestId: number, dtype: KokoroDtype) {
  configureTransformersCache();
  const assets = getKokoroPrimeAssets(dtype);
  await cacheKokoroAssets(
    assets,
    (asset, assetProgress) => handleAssetProgress(requestId, asset, assetProgress),
    (asset, result) => {
      postStatus(requestId, "Priming cache", `${asset.label}: ${result === "hit" ? "cached" : "stored"}`, null);
    },
  );
  postStatus(requestId, "Cache ready", `Runtime + ${dtype.toUpperCase()} model cached`, 1);
}

async function loadEngine(requestId: number, dtype: KokoroDtype): Promise<KokoroTtsInstance> {
  configureTransformersCache();
  if (tts && loadedDtype === dtype) return tts;
  if (loadingPromise && loadingDtype === dtype) return loadingPromise;

  tts = null;
  loadedDtype = null;
  loadingDtype = dtype;
  postStatus(requestId, "Loading model", "Preparing chunk cache first", null);
  loadingPromise = (async () => {
    await primeCache(requestId, dtype);
    await prepareOnnxRuntimeBinary(requestId);
    postStatus(requestId, "Loading model", "Transformers.js is reading the cached ONNX file", null);
    const loaded = await (KokoroTTS as unknown as {
      from_pretrained(
        modelId: string,
        options: {
          dtype: KokoroDtype;
          device: "wasm";
          progress_callback?: (event: unknown) => void;
        },
      ): Promise<KokoroTtsInstance>;
    }).from_pretrained(KOKORO_MODEL_ID, {
      dtype,
      device: "wasm",
      progress_callback: (event: unknown) => {
        if (!event || typeof event !== "object") return;
        const detail = event as { status?: string; file?: string; progress?: number; loaded?: number; total?: number };
        if (detail.status === "progress") {
          postStatus(
            requestId,
            "Loading model",
            `${detail.file || "asset"}: ${Math.round(detail.progress || 0)}%`,
            typeof detail.progress === "number" ? detail.progress / 100 : null,
          );
        } else if (detail.status) {
          postStatus(requestId, "Loading model", detail.file ? `${detail.status}: ${detail.file}` : detail.status, null);
        }
      },
    });
    tts = loaded;
    loadedDtype = dtype;
    postStatus(requestId, "Model ready", `${dtype.toUpperCase()} model ready in worker`, 1);
    return loaded;
  })().finally(() => {
    loadingPromise = null;
    loadingDtype = null;
  });
  return loadingPromise;
}

async function handleRequest(request: KokoroWorkerRequest) {
  try {
    if (request.type === "prime") {
      await primeCache(request.id, request.dtype);
      post({ id: request.id, type: "primed", dtype: request.dtype });
      return;
    }

    if (request.type === "load") {
      await loadEngine(request.id, request.dtype);
      post({ id: request.id, type: "loaded", dtype: request.dtype });
      return;
    }

    const engine = await loadEngine(request.id, request.dtype);
    postStatus(request.id, "Generating", "Kokoro is synthesizing inside the worker", null);
    const startedAt = performance.now();
    const output = await engine.generate(request.text, { voice: request.voice, speed: request.speed ?? 1 });
    const blob = output.toBlob();
    post({
      id: request.id,
      type: "speech",
      dtype: request.dtype,
      blob,
      size: blob.size,
      durationMs: Math.max(0, performance.now() - startedAt),
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
