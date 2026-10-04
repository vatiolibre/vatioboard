import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { resetRadioMediaWorkerForTesting, type Env } from "../src/index.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://dev.vatioboard.com";
const HOST = "https://radio-media.dev.vatioboard.com";
const ENV: Env = {
  ALLOWED_ORIGINS: ORIGIN,
  SELF_HOSTNAME: "radio-media.dev.vatioboard.com",
  BUILD_VERSION: "test-build",
};

function request(path: string, options: RequestInit = {}): Request {
  return new Request(`${HOST}${path}`, {
    ...options,
    headers: { Origin: ORIGIN, ...(options.headers || {}) },
  });
}

function stationResponse(uuid: string): Response {
  return Response.json([{
    stationuuid: uuid,
    url_resolved: "https://stream.example.com/live.mp3",
    lastcheckok: 1,
    hls: 0,
  }]);
}

function mockRadioFetch(upstream = () => new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), {
  headers: { "Content-Type": "audio/mpeg" },
})): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/json/servers")) return Response.json([{ name: "de1.api.radio-browser.info" }]);
    const match = /\/json\/stations\/byuuid\/([^/?]+)/.exec(url);
    if (match) return stationResponse(decodeURIComponent(match[1]));
    return upstream();
  });
}

describe("radio media Worker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    resetRadioMediaWorkerForTesting();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exposes only the CORS-safe station stream route", async () => {
    expect((await worker.fetch(request("/v1/health"), ENV)).status).toBe(404);
    expect((await worker.fetch(request(`/v1/stations/${UUID}/logo`), ENV)).status).toBe(404);
    expect((await worker.fetch(request(`/v1/stations/${UUID}/probe`), ENV)).status).toBe(404);
    expect((await worker.fetch(request(`/v1/stations/not-a-uuid/stream`), ENV)).status).toBe(400);
  });

  it("forwards one validated upstream audio stream with CORS", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    mockRadioFetch(() => new Response(body, { headers: { "Content-Type": "audio/mpeg" } }));
    const result = await worker.fetch(request(`/v1/stations/${UUID}/stream`), ENV);
    expect(result.status).toBe(200);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(result.headers.get("X-VatioBoard-Radio-Version")).toBe("test-build");
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("normalizes AAC+ MIME for WebKit without changing the stream bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xf1, 0x5e, 0x80, 1, 2, 3]);
    mockRadioFetch(() => new Response(bytes, { headers: { "Content-Type": "audio/aacp" } }));
    const result = await worker.fetch(request(`/v1/stations/${UUID}/stream`), ENV);
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("audio/aac");
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([...bytes]);
  });

  it("does not forward Safari Range requests to a live upstream", async () => {
    let streamInit: RequestInit | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/json/servers")) return Response.json([{ name: "de1.api.radio-browser.info" }]);
      const match = /\/json\/stations\/byuuid\/([^/?]+)/.exec(url);
      if (match) return stationResponse(decodeURIComponent(match[1]));
      streamInit = init;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    });
    const result = await worker.fetch(request(`/v1/stations/${UUID}/stream`, {
      headers: { Range: "bytes=0-1" },
    }), ENV);
    expect(result.status).toBe(200);
    expect(new Headers(streamInit?.headers).has("Range")).toBe(false);
  });

  it("allows Range preflight and rejects other request headers", async () => {
    const accepted = await worker.fetch(request(`/v1/stations/${UUID}/stream`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Headers": "Range, Accept" },
    }), ENV);
    expect(accepted.status).toBe(204);
    const rejected = await worker.fetch(request(`/v1/stations/${UUID}/stream`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Headers": "Authorization" },
    }), ENV);
    expect(rejected.status).toBe(403);
  });

  it("enforces the stream rate limit before directory work", async () => {
    const limit = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const result = await worker.fetch(request(`/v1/stations/${UUID}/stream`), { ...ENV, STREAM_STARTS: limit });
    expect(result.status).toBe(429);
    expect(limit.limit).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
