import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheTtsAsset,
  createTeslaSafeAssetResponse,
  probeTtsAsset,
  readCachedTtsAsset,
} from "../../src/apps/tts/tts-asset-cache.js";

function makeAsset(url, file = "test.bin") {
  return {
    file,
    label: file,
    kind: "runtime",
    url,
  };
}

function byteResponse(bytes, init = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  }), init);
}

function byteFetchResponse(bytes, headers = {}) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
    headers: new Headers(headers),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

describe("tts-asset-cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("actively detects range support when large assets do not advertise Accept-Ranges", async () => {
    const asset = makeAsset("https://example.test/model.onnx", "model.onnx");
    const fetchMock = vi.fn(async (_url, options = {}) => {
      if (options.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(63 * 1024 * 1024),
            "content-type": "application/octet-stream",
          },
        });
      }

      if (options.headers?.Range === "bytes=0-0") {
        return byteResponse([1], {
          status: 206,
          headers: {
            "content-range": `bytes 0-0/${63 * 1024 * 1024}`,
          },
        });
      }

      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await probeTtsAsset(asset);

    expect(probe).toMatchObject({
      acceptsRanges: true,
      totalBytes: 63 * 1024 * 1024,
      contentType: "application/octet-stream",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to volatile cache when persistent IndexedDB cache is unavailable", async () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      configurable: true,
    });
    try {
      const asset = makeAsset("https://example.test/phonemizer.data", "phonemizer.data");
      const bytes = [80, 73, 80, 69, 82];
      const fetchMock = vi.fn(async (_url, options = {}) => {
        if (options.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "content-length": String(bytes.length),
              "content-type": "application/octet-stream",
            },
          });
        }

        return byteFetchResponse(bytes, {
          "content-length": String(bytes.length),
          "content-type": "application/octet-stream",
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(cacheTtsAsset(asset)).resolves.toBe("stored");

      const cached = await readCachedTtsAsset(asset);
      expect(Array.from(new Uint8Array(cached))).toEqual(bytes);

      await expect(cacheTtsAsset(asset)).resolves.toBe("hit");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(navigator, "userAgent", {
        value: originalUserAgent,
        configurable: true,
      });
    }
  });

  it("falls back to a full response in Safari when the first range request is ignored", async () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      configurable: true,
    });
    try {
      const asset = makeAsset("https://example.test/piper_phonemize.data", "piper_phonemize.data");
      const bytes = [1, 2, 3, 4];
      const fetchMock = vi.fn(async (_url, options = {}) => {
        expect(options.headers?.Range).toBe("bytes=0-5242879");
        return byteFetchResponse(bytes, {
          "content-length": String(18 * 1024 * 1024),
          "content-type": "application/octet-stream",
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = createTeslaSafeAssetResponse(asset, {
        acceptsRanges: true,
        contentType: "application/octet-stream",
        totalBytes: 18 * 1024 * 1024,
      });

      const actualBytes = Array.from(new Uint8Array(await response.arrayBuffer()));
      expect(actualBytes).toEqual(bytes);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "userAgent", {
        value: originalUserAgent,
        configurable: true,
      });
    }
  });
});
