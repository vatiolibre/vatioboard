import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChunkedBlobStore } from "../../src/shared/chunked-blob-store.js";

// ── Fake in-memory IndexedDB store ─────────────────────────────────

function createFakeStore() {
  const data = new Map();
  return {
    getValue: vi.fn(async (key) => {
      const v = data.get(key);
      if (v === undefined) return undefined;
      // Shallow clone to simulate IDB isolation, preserving Blob instances.
      return { ...v };
    }),
    setValue: vi.fn(async (key, value) => {
      data.set(key, value);
      return true;
    }),
    deleteValue: vi.fn(async (key) => {
      data.delete(key);
      return true;
    }),
    hasSupport: () => true,
    openDatabase: vi.fn(async () => ({})),
    _data: data,
  };
}

function makeBlob(sizeBytes, type = "audio/mpeg") {
  const buf = new Uint8Array(sizeBytes);
  // Fill with a recognizable repeating pattern so reassembly can be verified.
  for (let i = 0; i < sizeBytes; i++) buf[i] = i % 256;
  return new Blob([buf], { type });
}

describe("chunked-blob-store", () => {
  let base;
  let store;

  beforeEach(() => {
    base = createFakeStore();
    // Use a small chunk size for testing (1 KB).
    store = createChunkedBlobStore(base, { chunkBytes: 1024 });
  });

  it("stores small blobs as a single record (no chunking)", async () => {
    const blob = makeBlob(512);
    const ok = await store.setValue("k1", { blob, content_hash: "abc" });
    expect(ok).toBe(true);

    // Only the main key should exist — no chunk keys.
    expect(base._data.size).toBe(1);
    expect(base._data.has("k1")).toBe(true);
    expect(base._data.get("k1").blob).toBeInstanceOf(Blob);
    expect(base._data.get("k1").__chunked).toBeUndefined();
  });

  it("retrieves a small blob unchanged", async () => {
    const blob = makeBlob(512);
    await store.setValue("k1", { blob, content_hash: "abc" });

    const result = await store.getValue("k1");
    expect(result.content_hash).toBe("abc");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBe(512);
  });

  it("splits a large blob into chunks", async () => {
    const blob = makeBlob(2560); // 2.5 KB → 3 chunks at 1 KB threshold
    const ok = await store.setValue("k1", { blob, content_hash: "xyz", pinned_at: 100 });
    expect(ok).toBe(true);

    // 1 manifest + 3 chunks = 4 records.
    expect(base._data.size).toBe(4);

    const manifest = base._data.get("k1");
    expect(manifest.__chunked).toBe(true);
    expect(manifest.chunkCount).toBe(3);
    expect(manifest.totalSize).toBe(2560);
    expect(manifest.contentType).toBe("audio/mpeg");
    expect(manifest.content_hash).toBe("xyz");
    expect(manifest.blob).toBeUndefined(); // blob not stored in manifest
  });

  it("reassembles a chunked blob on read", async () => {
    const original = makeBlob(2560);
    await store.setValue("k1", { blob: original, content_hash: "xyz" });

    const result = await store.getValue("k1");
    expect(result.content_hash).toBe("xyz");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBe(2560);

    // Verify byte-level correctness.
    const originalBytes = new Uint8Array(await original.arrayBuffer());
    const restoredBytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(restoredBytes).toEqual(originalBytes);
  });

  it("preserves blob content type after reassembly", async () => {
    const blob = makeBlob(2048, "audio/wav");
    await store.setValue("k1", { blob });

    const result = await store.getValue("k1");
    expect(result.blob.type).toBe("audio/wav");
  });

  it("preserves all metadata fields through chunking round-trip", async () => {
    const blob = makeBlob(2048);
    await store.setValue("k1", {
      blob,
      content_hash: "h1",
      pinned_at: 12345,
    });

    const result = await store.getValue("k1");
    expect(result.content_hash).toBe("h1");
    expect(result.pinned_at).toBe(12345);
    expect(result.__chunked).toBeUndefined();
    expect(result.chunkCount).toBeUndefined();
    expect(result.totalSize).toBeUndefined();
    expect(result.contentType).toBeUndefined();
  });

  it("deletes all chunks when deleting a chunked entry", async () => {
    const blob = makeBlob(2560);
    await store.setValue("k1", { blob });
    expect(base._data.size).toBe(4); // manifest + 3 chunks

    const ok = await store.deleteValue("k1");
    expect(ok).toBe(true);
    expect(base._data.size).toBe(0);
  });

  it("deletes a non-chunked entry normally", async () => {
    const blob = makeBlob(512);
    await store.setValue("k1", { blob });
    expect(base._data.size).toBe(1);

    await store.deleteValue("k1");
    expect(base._data.size).toBe(0);
  });

  it("returns undefined for missing keys", async () => {
    const result = await store.getValue("nonexistent");
    expect(result).toBeUndefined();
  });

  it("cleans up old chunks when re-writing with a smaller blob", async () => {
    // First write: 3 chunks.
    await store.setValue("k1", { blob: makeBlob(2560) });
    expect(base._data.size).toBe(4);

    // Overwrite with a smaller blob: 2 chunks.
    await store.setValue("k1", { blob: makeBlob(1536) });
    // manifest + 2 chunks = 3, old 3rd chunk should be cleaned up.
    expect(base._data.size).toBe(3);

    // The value should still round-trip correctly.
    const result = await store.getValue("k1");
    expect(result.blob.size).toBe(1536);
  });

  it("cleans up old chunks when overwriting chunked with a small blob", async () => {
    await store.setValue("k1", { blob: makeBlob(2560) });
    expect(base._data.size).toBe(4);

    // Overwrite with a small blob (no chunking).
    await store.setValue("k1", { blob: makeBlob(256) });
    expect(base._data.size).toBe(1);

    const result = await store.getValue("k1");
    expect(result.blob.size).toBe(256);
  });

  it("rolls back chunks when a chunk write fails mid-way", async () => {
    let writeCount = 0;
    base.setValue = vi.fn(async (key, value) => {
      writeCount++;
      // Fail on the 2nd chunk.
      if (writeCount === 2) return false;
      base._data.set(key, value);
      return true;
    });

    const blob = makeBlob(2560); // 3 chunks
    const ok = await store.setValue("k1", { blob });
    expect(ok).toBe(false);

    // The first chunk was written then should have been cleaned up.
    // Only the old manifest read may remain, but no chunk residue.
    expect(base._data.has("k1")).toBe(false);
  });

  it("returns undefined when a chunk is missing (corrupted store)", async () => {
    const blob = makeBlob(2048);
    await store.setValue("k1", { blob });

    // Simulate corruption: delete one chunk directly.
    base._data.delete("k1\0chunk\x001");

    const result = await store.getValue("k1");
    expect(result).toBeUndefined();
  });

  it("reads pre-chunking data transparently (backwards compatibility)", async () => {
    // Simulate data written by the old non-chunked store.
    const blob = makeBlob(5000);
    base._data.set("legacy", { blob, content_hash: "old" });

    const result = await store.getValue("legacy");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBe(5000);
    expect(result.content_hash).toBe("old");
  });

  it("stores values without a blob property as-is", async () => {
    const ok = await store.setValue("meta", { name: "test", count: 5 });
    expect(ok).toBe(true);

    const result = await store.getValue("meta");
    expect(result.name).toBe("test");
    expect(result.count).toBe(5);
  });

  // ── streamResponse ───────────────────────────────────────────────

  describe("streamResponse", () => {
    /**
     * Create a fake Response whose body is a ReadableStream that emits
     * `chunks` Uint8Arrays one at a time.
     */
    function fakeResponse(chunks, contentType = "audio/mpeg") {
      const body = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
      return {
        body,
        headers: { get: (h) => (h === "content-type" ? contentType : null) },
      };
    }

    /** Build a recognizable Uint8Array of `n` bytes. */
    function makeBytes(n, offset = 0) {
      const buf = new Uint8Array(n);
      for (let i = 0; i < n; i++) buf[i] = (i + offset) % 256;
      return buf;
    }

    it("streams a small response as a single record (no chunked manifest)", async () => {
      const data = makeBytes(500);
      const resp = fakeResponse([data]);
      const ok = await store.streamResponse("s1", resp);
      expect(ok).toBe(true);

      // Single record — no chunking overhead.
      expect(base._data.size).toBe(1);
      const record = base._data.get("s1");
      expect(record.blob).toBeInstanceOf(Blob);
      expect(record.blob.size).toBe(500);
      expect(record.__chunked).toBeUndefined();
    });

    it("streams a large response into chunks and creates a manifest", async () => {
      // 2.5 KB in three stream chunks → 3 store chunks at 1 KB threshold
      const resp = fakeResponse([makeBytes(1000), makeBytes(1000), makeBytes(560)]);
      const ok = await store.streamResponse("s2", resp);
      expect(ok).toBe(true);

      const manifest = base._data.get("s2");
      expect(manifest.__chunked).toBe(true);
      expect(manifest.chunkCount).toBe(3);
      expect(manifest.totalSize).toBe(2560);
    });

    it("reassembles a streamed entry identically via getValue", async () => {
      const a = makeBytes(1200);
      const b = makeBytes(800, 50);
      const combined = new Uint8Array(2000);
      combined.set(a, 0);
      combined.set(b, 1200);

      const resp = fakeResponse([a, b]);
      await store.streamResponse("s3", resp);

      const result = await store.getValue("s3");
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.size).toBe(2000);

      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      expect(bytes).toEqual(combined);
    });

    it("preserves metadata in the manifest", async () => {
      const resp = fakeResponse([makeBytes(2048)]);
      const ok = await store.streamResponse("s4", resp, {
        content_hash: "h1",
        pinned_at: 999,
      });
      expect(ok).toBe(true);

      const result = await store.getValue("s4");
      expect(result.content_hash).toBe("h1");
      expect(result.pinned_at).toBe(999);
    });

    it("preserves metadata for a single-chunk (non-manifest) write", async () => {
      const resp = fakeResponse([makeBytes(200)]);
      const ok = await store.streamResponse("s4b", resp, {
        content_hash: "small",
        pinned_at: 1,
      });
      expect(ok).toBe(true);

      const record = base._data.get("s4b");
      expect(record.content_hash).toBe("small");
      expect(record.pinned_at).toBe(1);
      expect(record.blob).toBeInstanceOf(Blob);
    });

    it("rolls back on chunk write failure", async () => {
      let writes = 0;
      base.setValue = vi.fn(async (key, value) => {
        writes++;
        if (writes === 2) return false; // fail second chunk
        base._data.set(key, value);
        return true;
      });

      const resp = fakeResponse([makeBytes(3000)]); // 3 chunks
      const ok = await store.streamResponse("s5", resp);
      expect(ok).toBe(false);

      // Everything should have been cleaned up.
      expect(base._data.has("s5")).toBe(false);
    });

    it("returns false for an empty response body", async () => {
      const resp = fakeResponse([]);
      const ok = await store.streamResponse("s6", resp);
      expect(ok).toBe(false);
    });

    it("falls back to blob path when response has no readable stream", async () => {
      const blob = makeBlob(512);
      const resp = {
        body: null,
        blob: async () => blob,
        headers: { get: () => null },
      };
      const ok = await store.streamResponse("s7", resp);
      expect(ok).toBe(true);

      const result = await store.getValue("s7");
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.size).toBe(512);
    });

    it("handles stream chunks smaller than the threshold", async () => {
      // Many tiny chunks that collectively exceed the threshold
      const chunks = [];
      for (let i = 0; i < 20; i++) chunks.push(makeBytes(100, i));
      const resp = fakeResponse(chunks); // 2000 bytes → 2 chunks
      await store.streamResponse("s8", resp);

      const result = await store.getValue("s8");
      expect(result.blob.size).toBe(2000);
    });

    it("cleans up pre-existing chunks before streaming", async () => {
      // Write a large blob first.
      await store.setValue("s9", { blob: makeBlob(3000) });
      expect(base._data.size).toBe(4); // manifest + 3 chunks

      // Overwrite with a streamed small file.
      const resp = fakeResponse([makeBytes(500)]);
      await store.streamResponse("s9", resp);

      // Should have only 1 record (single small blob, no leftover chunks).
      expect(base._data.size).toBe(1);
      const result = await store.getValue("s9");
      expect(result.blob.size).toBe(500);
    });

    it("falls back to blob path on Safari (unreliable ReadableStream)", async () => {
      const origUA = navigator.userAgent;
      try {
        Object.defineProperty(navigator, "userAgent", {
          value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
          configurable: true,
        });

        const data = makeBytes(500);
        const blob = new Blob([data], { type: "audio/mpeg" });
        // Provide both body (ReadableStream) and blob() — Safari detection
        // should skip the stream and use blob().
        const resp = {
          body: new ReadableStream({
            start(c) { c.enqueue(data); c.close(); },
          }),
          blob: async () => blob,
          headers: { get: (h) => (h === "content-type" ? "audio/mpeg" : null) },
        };

        const ok = await store.streamResponse("s10", resp);
        expect(ok).toBe(true);

        const result = await store.getValue("s10");
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.blob.size).toBe(500);
      } finally {
        Object.defineProperty(navigator, "userAgent", {
          value: origUA,
          configurable: true,
        });
      }
    });
  });
});
