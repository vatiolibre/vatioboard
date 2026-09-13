import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { resetRadioMediaWorkerForTesting, type Env } from "../src/index.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://dev.vatioboard.com";
const HOST = "https://radio-media.dev.vatioboard.com";
const ENV: Env = {
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5174`,
  SELF_HOSTNAME: "radio-media.dev.vatioboard.com",
  BUILD_VERSION: "test-build",
};

function request(path: string, options: RequestInit = {}): Request {
  return new Request(`${HOST}${path}`, {
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

function mockRadioFetch({
  station = (uuid: string) => stationResponse(uuid),
  upstream = () => new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), {
    headers: { "Content-Type": "audio/mpeg" },
  }),
}: {
  station?: (uuid: string, url: string) => Response | Promise<Response>;
  upstream?: (url: string, init?: RequestInit) => Response | Promise<Response>;
} = {}): void {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/json/servers")) return directoryResponse();
    const match = /\/json\/stations\/byuuid\/([^/?]+)/.exec(url);
    if (match) return station(decodeURIComponent(match[1]), url);
    return upstream(url, init);
  });
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

  it("rejects malformed routes, methods, and every missing or unknown Origin", async () => {
    expect((await worker.fetch(request("/v1/proxy?url=https://example.com"), ENV)).status).toBe(400);
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream?url=x`), ENV)).status).toBe(400);
    expect((await worker.fetch(request("/v1/stations/not-a-uuid/stream"), ENV)).status).toBe(400);
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`, { method: "POST" }), ENV)).status).toBe(405);
    expect((await worker.fetch(new Request(`${HOST}/v1/health`), ENV)).status).toBe(403);
    expect((await worker.fetch(new Request(`${HOST}/v1/stations/${UUID_A}/logo`, {
      headers: { Origin: "null" },
    }), ENV)).status).toBe(403);
    const rejectedProbe = await worker.fetch(new Request(`${HOST}/v1/stations/${UUID_A}/probe`, {
      headers: { Origin: "https://attacker.example" },
    }), ENV);
    expect(rejectedProbe.status).toBe(403);
    expect(rejectedProbe.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const rejectedHealth = await worker.fetch(new Request(`${HOST}/v1/health`, {
      headers: { Origin: "https://attacker.example" },
    }), ENV);
    expect(rejectedHealth.status).toBe(403);
    expect(rejectedHealth.headers.get("Access-Control-Allow-Origin")).toBe("https://attacker.example");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves versioned health with strict development CORS and security headers", async () => {
    const health = await worker.fetch(request("/v1/health"), ENV);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, status: "ready", version: "test-build" });
    expect(health.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(health.headers.get("Timing-Allow-Origin")).toBe(ORIGIN);
    expect(health.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(health.headers.get("Cache-Control")).toBe("no-store");
    const head = await worker.fetch(request("/v1/health", { method: "HEAD" }), ENV);
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });

  it("resolves two directory mirrors concurrently and forwards audio without buffering", async () => {
    let activeLookups = 0;
    let concurrentLookups = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    mockRadioFetch({
      station: async (uuid) => {
        activeLookups += 1;
        concurrentLookups = Math.max(concurrentLookups, activeLookups);
        await Promise.resolve();
        activeLookups -= 1;
        return stationResponse(uuid);
      },
      upstream: () => new Response(body, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Accept-Ranges": "bytes",
          "Content-Encoding": "identity",
        },
      }),
    });
    const result = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), ENV);
    expect(result.status).toBe(200);
    expect(concurrentLookups).toBe(2);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(result.headers.get("Content-Encoding")).toBe("identity");
    expect(result.headers.get("X-VatioBoard-Radio-Version")).toBe("test-build");
    expect(result.body).toBe(body);
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("keeps stream, probe, and logo rate limits independent", async () => {
    const streamLimit = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const probeLimit = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const logoLimit = { limit: vi.fn().mockResolvedValue({ success: false }) };
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), { ...ENV, STREAM_STARTS: streamLimit })).status).toBe(429);
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/probe`), { ...ENV, PROBE_REQUESTS: probeLimit })).status).toBe(429);
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/logo`), { ...ENV, LOGO_REQUESTS: logoLimit })).status).toBe(429);
    expect(streamLimit.limit).toHaveBeenCalledTimes(1);
    expect(probeLimit.limit).toHaveBeenCalledTimes(1);
    expect(logoLimit.limit).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles exact preflight policy for health, streams, and probes", async () => {
    for (const path of ["/v1/health", `/v1/stations/${UUID_A}/stream`, `/v1/stations/${UUID_A}/probe`]) {
      const accepted = await worker.fetch(request(path, {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Headers": path.endsWith("health") ? "Accept" : "Range, Accept" },
      }), ENV);
      expect(accepted.status).toBe(204);
      expect(accepted.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    }
    const rejected = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Headers": "Authorization" },
    }), ENV);
    expect(rejected.status).toBe(403);
  });

  it("supports HEAD while forwarding only Range and Accept upstream", async () => {
    let upstreamInit: RequestInit | undefined;
    mockRadioFetch({
      upstream: (_url, init) => {
        upstreamInit = init;
        return new Response(null, {
          status: 206,
          headers: { "Content-Type": "audio/aac", "Content-Range": "bytes 10-19/100", "Accept-Ranges": "bytes" },
        });
      },
    });
    const result = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`, {
      method: "HEAD",
      headers: { Range: "bytes=10-19", Accept: "audio/aac", Authorization: "secret" },
    }), ENV);
    expect(result.status).toBe(206);
    expect(result.body).toBeNull();
    const headers = new Headers(upstreamInit?.headers);
    expect(upstreamInit?.method).toBe("HEAD");
    expect(headers.get("Range")).toBe("bytes=10-19");
    expect(headers.get("Accept")).toBe("audio/aac");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("follows validated redirects and rejects redirect limits or unsafe targets", async () => {
    let upstreamCalls = 0;
    mockRadioFetch({
      upstream: (url) => {
        upstreamCalls += 1;
        return url.includes("stream.example.com")
          ? new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/live" } })
          : new Response(new Uint8Array([9]), { headers: { "Content-Type": "audio/ogg" } });
      },
    });
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), ENV)).status).toBe(200);
    expect(upstreamCalls).toBe(2);
    resetRadioMediaWorkerForTesting();
    mockRadioFetch({ upstream: () => new Response(null, { status: 302, headers: { Location: "https://loop.example/live" } }) });
    expect((await worker.fetch(request(`/v1/stations/${UUID_B}/stream`), ENV)).status).toBe(502);
    resetRadioMediaWorkerForTesting();
    mockRadioFetch({ station: (uuid) => stationResponse(uuid, { url_resolved: "http://127.0.0.1/private" }) });
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/probe`), ENV)).status).toBe(422);
  });

  it("rejects broken, HLS, HTML, playlist, and unsupported-status upstreams", async () => {
    mockRadioFetch({ station: (uuid) => stationResponse(uuid, { hls: 1 }) });
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), ENV)).status).toBe(404);
    for (const upstream of [
      () => new Response("<html>not audio</html>", { headers: { "Content-Type": "text/html" } }),
      () => new Response("#EXTM3U", { headers: { "Content-Type": "audio/x-mpegurl" } }),
      () => new Response(null, { status: 401 }),
    ]) {
      resetRadioMediaWorkerForTesting();
      mockRadioFetch({ upstream });
      expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), ENV)).status).toBe(502);
    }
  });

  it("sniffs safe generic audio and rejects generic non-audio", async () => {
    mockRadioFetch({
      upstream: () => new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2]), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    });
    const accepted = await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), ENV);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("Content-Type")).toBe("audio/mpeg");
    resetRadioMediaWorkerForTesting();
    mockRadioFetch({
      upstream: () => new Response(new TextEncoder().encode("not audio"), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    });
    expect((await worker.fetch(request(`/v1/stations/${UUID_A}/stream`), ENV)).status).toBe(502);
  });

  it("returns categorical probe results without exposing station URLs", async () => {
    mockRadioFetch();
    const ready = await worker.fetch(request(`/v1/stations/${UUID_A}/probe`), ENV);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, outcome: "ready", stage: "content", version: "test-build" });
    resetRadioMediaWorkerForTesting();
    mockRadioFetch({ upstream: () => new Response(new Uint8Array(), { headers: { "Content-Type": "audio/mpeg" } }) });
    const empty = await worker.fetch(request(`/v1/stations/${UUID_B}/probe`), ENV);
    expect(empty.status).toBe(502);
    expect(await empty.json()).toMatchObject({ ok: false, outcome: "empty-response", stage: "content" });
  });

  it("applies the 12-second upstream header timeout", async () => {
    vi.useFakeTimers();
    mockRadioFetch({
      upstream: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    });
    const pending = worker.fetch(request(`/v1/stations/${UUID_A}/stream`), ENV);
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await pending).status).toBe(504);
  });

  it("validates, caches, and size-limits artwork with strict CORS", async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
      put: vi.fn(async (key: Request, value: Response) => { entries.set(key.url, value.clone()); }),
    } as unknown as Cache;
    vi.stubGlobal("caches", { default: cache });
    mockRadioFetch({
      station: (uuid) => stationResponse(uuid, { favicon: "https://images.example.com/logo.png" }),
      upstream: () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
    });
    const path = `/v1/stations/${UUID_A}/logo`;
    const first = await worker.fetch(request(path), ENV);
    expect(first.status).toBe(200);
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([1, 2, 3]);
    const calls = vi.mocked(fetch).mock.calls.length;
    expect((await worker.fetch(request(path), ENV)).headers.get("Content-Type")).toBe("image/png");
    expect(fetch).toHaveBeenCalledTimes(calls);
    resetRadioMediaWorkerForTesting();
    entries.clear();
    mockRadioFetch({
      station: (uuid) => stationResponse(uuid, { favicon: "https://images.example.com/huge.png" }),
      upstream: () => new Response(new Uint8Array(), {
        headers: { "Content-Type": "image/png", "Content-Length": String(2 * 1024 * 1024 + 1) },
      }),
    });
    const fallback = await worker.fetch(request(`/v1/stations/${UUID_B}/logo`), ENV);
    expect(fallback.headers.get("Content-Type")).toContain("image/svg+xml");
  });
});
