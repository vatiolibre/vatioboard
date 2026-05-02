/**
 * Chunked blob store — transparent IndexedDB blob splitting.
 *
 * Wraps a {@link createIndexedJsonKeyValueStore} instance and automatically
 * splits blobs larger than a configurable threshold into multiple records.
 * The consumer API is identical to the base store (getValue/setValue/
 * deleteValue) so it can be swapped in without changing callers.
 *
 * **Why**: some browsers (Tesla Chromium, older iOS Safari) enforce a
 * per-record or per-transaction size limit on IndexedDB writes.  Splitting
 * a 20 MB MP3 into four 5 MB chunks keeps each individual write well
 * within those limits.
 *
 * Storage layout for a chunked entry (key = "user:asset"):
 *   "user:asset"             → { __chunked: true, chunkCount: 4, totalSize, contentType, ...meta }
 *   "user:asset\0chunk\x000" → { blob: Blob(5 MB) }
 *   "user:asset\0chunk\x001" → { blob: Blob(5 MB) }
 *   "user:asset\0chunk\x002" → { blob: Blob(5 MB) }
 *   "user:asset\0chunk\x003" → { blob: Blob(5 MB) }
 *
 * Small blobs (≤ threshold) are stored as a single record — no chunks,
 * no overhead, no migration needed for existing data.
 *
 * @module chunked-blob-store
 */

/** Default per-chunk size: 5 MB */
const DEFAULT_CHUNK_BYTES = 5 * 1024 * 1024;

/** Separator used between the main key and chunk index. */
const CHUNK_SEP = "\0chunk\0";

/**
 * Returns true when the browser can reliably stream a fetch Response body
 * via ReadableStream into IndexedDB chunks.
 *
 * Safari / WebKit may silently return an empty or broken ReadableStream for
 * cross-origin fetch responses (known in Safari < 16.4, with edge-cases in
 * later versions involving server-side redirects).  Since Safari does not
 * share the per-record IndexedDB size limits that motivated streaming
 * (those are a Tesla Chromium constraint), falling back to the simpler
 * `response.blob()` path is safe and avoids the issue entirely.
 */
function canStreamFetchBody() {
  if (typeof ReadableStream === "undefined") return false;
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent || "";
  // Safari / Mobile Safari (not Chrome or Chromium on iOS, which use their
  // own engine and stream reliably).
  if (/Safari\//i.test(ua) && !/Chrom(e|ium)\//i.test(ua)) return false;
  return true;
}

function chunkKey(baseKey, index) {
  return `${baseKey}${CHUNK_SEP}${index}`;
}

/**
 * Wrap a base IndexedDB key-value store with transparent blob chunking.
 *
 * @param {object} baseStore - Store returned by createIndexedJsonKeyValueStore
 * @param {{ chunkBytes?: number }} [opts]
 * @returns {typeof baseStore} Same API (getValue, setValue, deleteValue, …)
 */
export function createChunkedBlobStore(baseStore, { chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
  const threshold = Math.max(1024, chunkBytes);

  /**
   * Retrieve a value.  If the record is a chunked manifest, reassemble
   * the original blob from its chunk records.
   */
  async function getValue(key) {
    const record = await baseStore.getValue(key);
    if (record === undefined || record === null) return record;

    // Not chunked — return as-is (backwards-compatible with pre-chunking data).
    if (!record.__chunked) return record;

    const { chunkCount, contentType, ...meta } = record;
    if (!chunkCount || chunkCount <= 0) return undefined;

    const parts = new Array(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = await baseStore.getValue(chunkKey(key, i));
      if (!chunk?.blob) return undefined;          // corrupted / partial
      parts[i] = chunk.blob;
    }

    const blob = new Blob(parts, contentType ? { type: contentType } : undefined);

    // Strip internal fields, restore the blob into the original shape.
    const restored = { ...meta };
    delete restored.__chunked;
    delete restored.chunkCount;
    delete restored.totalSize;
    delete restored.contentType;
    restored.blob = blob;
    return restored;
  }

  /**
   * Store a value.  When the value contains a `blob` property larger than
   * the chunk threshold, split it into chunk records + a manifest.
   */
  async function setValue(key, value) {
    const blob = value?.blob;

    // No blob or small blob — store as a single record.
    if (!(blob instanceof Blob) || blob.size <= threshold) {
      // Clean up any old chunks that may exist from a previous chunked write.
      await deleteChunks(key);
      return baseStore.setValue(key, value);
    }

    // Split the blob into chunks.
    const totalSize = blob.size;
    const contentType = blob.type || "";
    const chunkCount = Math.ceil(totalSize / threshold);

    // Write chunks first so the manifest never references missing data.
    for (let i = 0; i < chunkCount; i++) {
      const start = i * threshold;
      const end = Math.min(start + threshold, totalSize);
      const chunkBlob = blob.slice(start, end, contentType);
      const ok = await baseStore.setValue(chunkKey(key, i), { blob: chunkBlob });
      if (!ok) {
        // Roll back chunks written so far.
        for (let j = 0; j < i; j++) {
          await baseStore.deleteValue(chunkKey(key, j)).catch(() => {});
        }
        return false;
      }
    }

    // Write the manifest (metadata without the blob itself).
    const manifest = { ...value, __chunked: true, chunkCount, totalSize, contentType };
    delete manifest.blob;
    const manifestOk = await baseStore.setValue(key, manifest);

    if (!manifestOk) {
      // Roll back all chunks.
      for (let i = 0; i < chunkCount; i++) {
        await baseStore.deleteValue(chunkKey(key, i)).catch(() => {});
      }
      return false;
    }

    // Clean up stale chunks from a previous write that may have had more
    // chunks (e.g. re-pinning with a smaller file).
    await cleanupStaleChunks(key, chunkCount);

    return true;
  }

  /** Delete the main record and any associated chunks. */
  async function deleteValue(key) {
    await deleteChunks(key);
    return baseStore.deleteValue(key);
  }

  /** Delete all chunk records for a key. */
  async function deleteChunks(key) {
    // Read the manifest to find out how many chunks exist.
    const record = await baseStore.getValue(key);
    if (!record?.__chunked) return;

    const count = record.chunkCount || 0;
    for (let i = 0; i < count; i++) {
      await baseStore.deleteValue(chunkKey(key, i)).catch(() => {});
    }
  }

  /** Remove leftover chunks beyond `validCount` (after a re-write with fewer chunks). */
  async function cleanupStaleChunks(key, validCount) {
    // Try a few extra indices in case a previous write had more chunks.
    for (let i = validCount; i < validCount + 20; i++) {
      const ck = chunkKey(key, i);
      const exists = await baseStore.getValue(ck);
      if (exists === undefined || exists === null) break;
      await baseStore.deleteValue(ck).catch(() => {});
    }
  }

  /**
   * Stream a fetch Response body directly into chunked IndexedDB records.
   *
   * Instead of `response.blob()` (materialises the entire file in memory)
   * this reads the body via ReadableStream, accumulates bytes up to
   * `threshold`, and flushes each full buffer as a separate IndexedDB
   * record **immediately**.  The only in-memory object at any time is a
   * single chunk-sized buffer — ideal for browsers with tight per-object
   * or per-transaction limits (Tesla Chromium, older iOS Safari).
   *
   * On success the key is left in the same chunked-manifest layout as
   * `setValue()` so `getValue()` reads it back identically.
   *
   * @param {string}   key       Store key (user-scoped).
   * @param {Response} response  Fetch Response whose body has not been consumed.
   * @param {object}   [meta]    Extra metadata fields to include in the manifest.
   * @returns {Promise<boolean>}
   */
  async function streamResponse(key, response, meta = {}) {
    if (!response?.body || !canStreamFetchBody()) {
      // No readable stream, or browser known to have unreliable fetch
      // ReadableStream (Safari/WebKit) — fall back to the blob path.
      try {
        const blob = await response.blob();
        return setValue(key, { ...meta, blob });
      } catch {
        return false;
      }
    }

    const contentType = response.headers?.get("content-type") || "";
    const reader = response.body.getReader();

    let chunkIndex = 0;
    let totalSize = 0;
    let buffer = [];       // array of Uint8Arrays for current chunk
    let bufferBytes = 0;

    /** Flush the current buffer as one IndexedDB chunk record. */
    async function flushChunk() {
      if (bufferBytes === 0) return true;
      const merged = mergeUint8Arrays(buffer, bufferBytes);
      const blob = new Blob([merged], contentType ? { type: contentType } : undefined);
      buffer = [];
      bufferBytes = 0;
      const ok = await baseStore.setValue(chunkKey(key, chunkIndex), { blob });
      if (!ok) return false;
      chunkIndex++;
      return true;
    }

    try {
      // Clean up any pre-existing chunks from a previous write.
      await deleteChunks(key);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer.push(value);
        bufferBytes += value.byteLength;
        totalSize += value.byteLength;

        // Flush whenever we have accumulated a full chunk.
        while (bufferBytes >= threshold) {
          // Split across threshold boundary if necessary.
          const overflow = bufferBytes - threshold;
          if (overflow > 0) {
            // The last buffer entry may need splitting.
            const last = buffer[buffer.length - 1];
            const splitAt = last.byteLength - overflow;
            buffer[buffer.length - 1] = last.subarray(0, splitAt);
            bufferBytes = threshold;
            const ok = await flushChunk();
            if (!ok) {
              reader.cancel().catch(() => {});
              await rollbackChunks(key, chunkIndex);
              return false;
            }
            buffer = [last.subarray(splitAt)];
            bufferBytes = overflow;
          } else {
            const ok = await flushChunk();
            if (!ok) {
              reader.cancel().catch(() => {});
              await rollbackChunks(key, chunkIndex);
              return false;
            }
          }
        }
      }

      // Flush any remaining bytes as a final (smaller) chunk.
      if (bufferBytes > 0) {
        const ok = await flushChunk();
        if (!ok) {
          await rollbackChunks(key, chunkIndex);
          return false;
        }
      }

      if (chunkIndex === 0) {
        // Empty body — nothing to store.
        return false;
      }

      // Single chunk — no need for chunked manifest, store as a plain record
      // to keep the common (small file) path identical to setValue().
      if (chunkIndex === 1) {
        const singleChunk = await baseStore.getValue(chunkKey(key, 0));
        if (!singleChunk?.blob) {
          await rollbackChunks(key, 1);
          return false;
        }
        await baseStore.deleteValue(chunkKey(key, 0)).catch(() => {});
        return baseStore.setValue(key, { ...meta, blob: singleChunk.blob });
      }

      // Multiple chunks — write the manifest.
      const manifest = {
        ...meta,
        __chunked: true,
        chunkCount: chunkIndex,
        totalSize,
        contentType,
      };
      delete manifest.blob;

      const manifestOk = await baseStore.setValue(key, manifest);
      if (!manifestOk) {
        await rollbackChunks(key, chunkIndex);
        return false;
      }

      // Clean up stale chunks from a previous larger write.
      await cleanupStaleChunks(key, chunkIndex);
      return true;
    } catch {
      reader.cancel().catch(() => {});
      await rollbackChunks(key, chunkIndex);
      return false;
    }
  }

  /** Roll back chunk records 0..count-1. */
  async function rollbackChunks(key, count) {
    for (let i = 0; i < count; i++) {
      await baseStore.deleteValue(chunkKey(key, i)).catch(() => {});
    }
  }

  return {
    deleteValue,
    getValue,
    hasSupport: baseStore.hasSupport,
    openDatabase: baseStore.openDatabase,
    setValue,
    streamResponse,
  };
}

/**
 * Merge an array of Uint8Arrays into a single Uint8Array.
 * @param {Uint8Array[]} arrays
 * @param {number} totalLength
 * @returns {Uint8Array}
 */
function mergeUint8Arrays(arrays, totalLength) {
  if (arrays.length === 1) return arrays[0];
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  return result;
}
