import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

describe("player.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("player.html");
  });

  it("boots the player page with correct SEO", async () => {
    // Mock the async catalog/runtime imports so boot completes
    vi.doMock("../../src/shared/media-cache.js", () => ({
      getCachedManifestSnapshot: vi.fn().mockResolvedValue({ assets: [] }),
      getCachedMediaManifest: vi.fn().mockResolvedValue([]),
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
    }));

    await import("../../src/player/player-demo.js");
    await flushTasks();

    expectPageSeo({
      title: "VatioBoard Audio Player",
      hasDescription: false,
    });

    const root = document.getElementById("player-root");
    expect(root).toBeTruthy();
    expect(root.querySelector(".player-shell")).toBeTruthy();
  });
});
