import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Media Session artwork normalization", () => {
  let toBlobSpy;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: vi.fn().mockResolvedValue({ width: 120, height: 60, close: vi.fn() }),
    });
    toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["normalized"], { type: "image/png" }));
    });
  });

  afterEach(async () => {
    const module = await import("../../src/shared/media-session-artwork.js");
    module.clearMediaSessionArtworkCache();
    toBlobSpy.mockRestore();
  });

  it("converts small non-square JPEG artwork into a truthful 512px PNG and caches it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new Blob(["jpeg"], { type: "image/jpeg" }),
      { status: 200, headers: { "Content-Type": "image/jpeg" } },
    ));
    URL.createObjectURL.mockReturnValueOnce("blob:normalized-artwork");
    const module = await import("../../src/shared/media-session-artwork.js");

    const first = await module.getNormalizedMediaSessionArtwork("station-1", "https://logo.example/one.jpg");
    const second = await module.getNormalizedMediaSessionArtwork("station-1", "https://logo.example/one.jpg");

    expect(first).toEqual([{ src: "blob:normalized-artwork", sizes: "512x512", type: "image/png" }]);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg" }));
  });

  it.each([
    ["failed response", () => new Response("", { status: 404 })],
    ["non-image response", () => new Response("not image", { status: 200, headers: { "Content-Type": "text/plain" } })],
    ["oversized response", () => new Response(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: "image/png" }))],
  ])("returns no artwork for a %s", async (_label, responseFactory) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(responseFactory());
    const module = await import("../../src/shared/media-session-artwork.js");
    await expect(module.getNormalizedMediaSessionArtwork("bad", "https://logo.example/bad")).resolves.toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects malformed images and revokes normalized URLs on disposal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new Blob(["broken"], { type: "image/png" }),
      { headers: { "Content-Type": "image/png" } },
    ));
    createImageBitmap.mockRejectedValueOnce(new Error("decode failed"));
    const module = await import("../../src/shared/media-session-artwork.js");
    await expect(module.getNormalizedMediaSessionArtwork("broken", "https://logo.example/broken")).resolves.toBeNull();

    fetch.mockResolvedValue(new Response(
      new Blob(["valid"], { type: "image/png" }),
      { headers: { "Content-Type": "image/png" } },
    ));
    createImageBitmap.mockResolvedValueOnce({ width: 200, height: 200, close: vi.fn() });
    URL.createObjectURL.mockReturnValueOnce("blob:dispose-me");
    await module.getNormalizedMediaSessionArtwork("good", "https://logo.example/good");
    module.clearMediaSessionArtworkCache();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:dispose-me");
  });
});
