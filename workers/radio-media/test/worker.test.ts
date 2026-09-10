import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { resetRadioMediaWorkerForTesting, type Env } from "../src/index.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://vatioboard.com";

function request(path: string, options: RequestInit = {}): Request {
  return new Request(`https://radio-media.vatioboard.com${path}`, {
    ...options,
    headers: { Origin: ORIGIN, ...(options.headers || {}) },
  });
}

function directoryResponse(): Response {
  return Response.json([{ name: "de1.api.radio-browser.info" }]);
}

function stationResponse(uuid: string, overrides: Record<string, unknown> = {}): Response {
  return Response.json([{
    stationuuid: uuid,
    url_resolved: "https://stream.example.com/live.mp3",
    favicon: "",
    lastcheckok: 1,
    hls: 0,
    ...overrides,
  }]);
}

describe("radio media Worker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRadioMediaWorkerForTesting();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects arbitrary URLs, query strings, malformed UUIDs, and unknown methods", async () => {
    expect((await worker.fetch(request("/v1/proxy?url=https://example.com"), {})).status).toBe(400);
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream?url=x`), {})).status).toBe(400);
    expect((await worker.fetch(request("/v1/stations/not-a-uuid/stream"), {})).status).toBe(400);
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`, { method: "POST" }), {})).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires an allowed Origin for streams and allows no-Origin artwork", async () => {
    const forbidden = await worker.fetch(new Request(`https://radio-media.vatioboard.com/v1/stations/${UUID_A}/stream`), {});
    expect(forbidden.status).toBe(403);

    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_B));
    const logo = await worker.fetch(new Request(`https://radio-media.vatioboard.com/v1/stations/${UUID_B}/logo`), {});
    expect(logo.status).toBe(200);
    expect(logo.headers.get("Content-Type")).toContain("image/svg+xml");
  });

  it("resolves UUID metadata and forwards the upstream stream without buffering", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_A))
      .mockResolvedValueOnce(new Response(body, { headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes" } }));

    const result = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), {});
    expect(result.status).toBe(200);
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("manual");
    expect(vi.mocked(fetch).mock.calls[1][1]?.redirect).toBe("manual");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("Accept-Ranges")).toBe("bytes");
    expect(result.body).toBe(body);
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("rejects redirects to private or local destinations", async () => {
    const uuid = "33333333-3333-4333-8333-333333333333";
    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(uuid))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }));
    const result = await worker.fetch(request(`/v1/stations/${uuid}/stream`), {});
    expect(result.status).toBe(502);
  });

  it("returns 429 with Retry-After when a rate-limit binding rejects a start", async () => {
    const env: Env = { STREAM_STARTS: { limit: vi.fn().mockResolvedValue({ success: false }) } };
    const result = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), env);
    expect(result.status).toBe(429);
    expect(result.headers.get("Retry-After")).toBe("60");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles exact CORS preflight and rejects disallowed origins or headers", async () => {
    const accepted = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Headers": "Range, Accept" },
    }), {});
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(accepted.headers.get("Access-Control-Allow-Headers")).toBe("Accept, Range");
    expect(accepted.headers.get("Vary")).toBe("Origin");

    const badHeader = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Headers": "Authorization" },
    }), {});
    expect(badHeader.status).toBe(403);
    const badOrigin = await worker.fetch(new Request(
      `https://radio-media.vatioboard.com/v1/stations/${UUID_A}/logo`,
      { headers: { Origin: "https://attacker.example" } },
    ), {});
    expect(badOrigin.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports HEAD and forwards only Range and Accept to the audio upstream", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_A))
      .mockResolvedValueOnce(new Response(null, {
        status: 206,
        headers: {
          "Content-Type": "audio/aac",
          "Content-Range": "bytes 10-19/100",
          "Accept-Ranges": "bytes",
        },
      }));
    const result = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`, {
      method: "HEAD",
      headers: { Range: "bytes=10-19", Accept: "audio/aac", Authorization: "secret" },
    }), {});
    expect(result.status).toBe(206);
    expect(result.body).toBeNull();
    expect(result.headers.get("Content-Range")).toBe("bytes 10-19/100");
    const [, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("HEAD");
    expect(headers.get("Range")).toBe("bytes=10-19");
    expect(headers.get("Accept")).toBe("audio/aac");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("follows validated redirects but rejects redirect loops and unsafe station targets", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_A))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/live" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { headers: { "Content-Type": "audio/ogg" } }));
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), {})).status).toBe(200);
    expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toBe("https://cdn.example.com/live");

    resetRadioMediaWorkerForTesting();
    vi.mocked(fetch).mockReset()
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_B))
      .mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://loop.example/live" } }));
    expect((await worker.fetch(request(`/v1/stations/${UUID_B}/stream`), {})).status).toBe(502);

    resetRadioMediaWorkerForTesting();
    vi.mocked(fetch).mockReset().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/json/servers")) return directoryResponse();
      return stationResponse(UUID_A, { url_resolved: "https://user:pass@stream.example.com/live" });
    });
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), {})).status).toBe(404);
  });

  it("rejects broken, HLS, duplicate, HTML, and unsupported-status upstreams", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/json/servers")) return directoryResponse();
      return stationResponse(UUID_A, { hls: 1 });
    });
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), {})).status).toBe(404);

    resetRadioMediaWorkerForTesting();
    vi.mocked(fetch).mockReset()
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(Response.json([
        ...(await stationResponse(UUID_A).json() as object[]),
        ...(await stationResponse(UUID_A).json() as object[]),
      ]))
      .mockResolvedValue(Response.json([]));
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), {})).status).toBe(404);

    resetRadioMediaWorkerForTesting();
    vi.mocked(fetch).mockReset()
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_B))
      .mockResolvedValueOnce(new Response("<html>not audio</html>", { headers: { "Content-Type": "text/html" } }));
    expect((await worker.fetch(request(`/v1/stations/${UUID_B}/stream`), {})).status).toBe(502);

    resetRadioMediaWorkerForTesting();
    vi.mocked(fetch).mockReset()
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_B))
      .mockResolvedValueOnce(new Response("#EXTM3U", { headers: { "Content-Type": "audio/x-mpegurl" } }));
    expect((await worker.fetch(request(`/v1/stations/${UUID_B}/stream`), {})).status).toBe(502);
  });

  it("applies the 12-second upstream header timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_A))
      .mockImplementationOnce(async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    const pending = worker.fetch(request(`/v1/stations/${UUID_A}/stream`), {});
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;
    expect(result.status).toBe(504);
  });

  it("validates, size-limits, caches, and serves artwork with Media Session-compatible CORS", async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
      put: vi.fn(async (key: Request, value: Response) => { entries.set(key.url, value.clone()); }),
    } as unknown as Cache;
    vi.stubGlobal("caches", { default: cache });
    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_A, { favicon: "https://images.example.com/logo.png" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }));
    const url = `https://radio-media.vatioboard.com/v1/stations/${UUID_A}/logo`;
    const first = await worker.fetch(new Request(url), {});
    expect(first.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(first.headers.get("CDN-Cache-Control")).toBe("public, max-age=604800");
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([1, 2, 3]);
    const calls = vi.mocked(fetch).mock.calls.length;
    expect((await worker.fetch(new Request(url), {})).headers.get("Content-Type")).toBe("image/png");
    expect(fetch).toHaveBeenCalledTimes(calls);

    resetRadioMediaWorkerForTesting();
    entries.clear();
    vi.mocked(fetch).mockReset()
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_B, { favicon: "https://images.example.com/logo.svg" }))
      .mockResolvedValueOnce(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
    const fallback = await worker.fetch(request(`/v1/stations/${UUID_B}/logo`), {});
    expect(fallback.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(fallback.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("rate-limits logo cache misses and falls back when declared artwork exceeds 2 MB", async () => {
    const denied: Env = { LOGO_REQUESTS: { limit: vi.fn().mockResolvedValue({ success: false }) } };
    const limited = await worker.fetch(request(`/v1/stations/${UUID_A}/logo`), denied);
    expect(limited.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();

    vi.mocked(fetch)
      .mockResolvedValueOnce(directoryResponse())
      .mockResolvedValueOnce(stationResponse(UUID_B, { favicon: "https://images.example.com/huge.png" }))
      .mockResolvedValueOnce(new Response(new Uint8Array(), {
        headers: { "Content-Type": "image/png", "Content-Length": String(2 * 1024 * 1024 + 1) },
      }));
    const fallback = await worker.fetch(request(`/v1/stations/${UUID_B}/logo`), {});
    expect(fallback.headers.get("Content-Type")).toContain("image/svg+xml");
  });
});
