import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Media Session adapter platform writes", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not recreate metadata, playback state, or handlers for equivalent updates", async () => {
    const metadataWrites = vi.fn();
    const playbackWrites = vi.fn();
    let metadata = null;
    let playbackState = "none";
    Object.defineProperty(navigator.mediaSession, "metadata", {
      configurable: true,
      get: () => metadata,
      set: (value) => { metadata = value; metadataWrites(value); },
    });
    Object.defineProperty(navigator.mediaSession, "playbackState", {
      configurable: true,
      get: () => playbackState,
      set: (value) => { playbackState = value; playbackWrites(value); },
    });
    navigator.mediaSession.setActionHandler.mockClear();

    const adapter = await import("../../src/shared/media-session-adapter.js");
    const play = vi.fn();
    const handlers = { play };
    const metadataPayload = {
      title: "Station",
      artwork: [{ src: "/station.png", sizes: "512x512", type: "image/png" }],
    };
    adapter.updateMediaSessionClient("player", {
      active: true,
      priority: 10,
      playbackState: "playing",
      metadata: metadataPayload,
      handlers,
    });
    expect(metadataWrites).toHaveBeenCalledTimes(1);
    expect(playbackWrites).toHaveBeenCalledTimes(1);
    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledTimes(8);

    adapter.updateMediaSessionClient("player", { playbackState: "playing" });
    adapter.updateMediaSessionClient("player", {
      metadata: {
        title: "Station",
        artwork: [{ src: "/station.png", sizes: "512x512", type: "image/png" }],
      },
      handlers: { play },
    });
    expect(metadataWrites).toHaveBeenCalledTimes(1);
    expect(playbackWrites).toHaveBeenCalledTimes(1);
    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledTimes(8);

    adapter.updateMediaSessionClient("player", { playbackState: "paused" });
    expect(playbackWrites).toHaveBeenCalledTimes(2);
    adapter.updateMediaSessionClient("player", {
      metadata: { ...metadataPayload, title: "Another station" },
    });
    expect(metadataWrites).toHaveBeenCalledTimes(2);
  });
});
