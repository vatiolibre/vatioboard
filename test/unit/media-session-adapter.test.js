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
  it("dispatches retained platform callbacks to the current owner and handlers", async () => {
    const adapter = await import("../../src/shared/media-session-adapter.js");
    const oldNext = vi.fn();
    const newNext = vi.fn();
    adapter.updateMediaSessionClient("old", { priority: 1, handlers: { nexttrack: oldNext } });
    const callback = navigator.mediaSession.setActionHandler.mock.calls.filter(([name]) => name === "nexttrack").at(-1)[1];
    adapter.updateMediaSessionClient("new", { priority: 10, handlers: { nexttrack: newNext } });
    callback({ action: "nexttrack" });
    expect(newNext).toHaveBeenCalledTimes(1);
    expect(oldNext).not.toHaveBeenCalled();
    adapter.clearMediaSessionClient("new");
    callback({ action: "nexttrack" });
    expect(oldNext).toHaveBeenCalledTimes(1);
  });

  it("clamps finite positions and clears stale position for invalid or live duration", async () => {
    const adapter = await import("../../src/shared/media-session-adapter.js");
    const setPosition = vi.fn();
    navigator.mediaSession.setPositionState = setPosition;
    adapter.updateMediaSessionClient("player", { positionState: { duration: 60, position: -5, playbackRate: 1 } });
    expect(setPosition).toHaveBeenLastCalledWith({ duration: 60, position: 0, playbackRate: 1 });
    adapter.updateMediaSessionClient("player", { positionState: { duration: Infinity, position: 5 } });
    expect(setPosition).toHaveBeenLastCalledWith();
    adapter.updateMediaSessionClient("player", { positionState: { duration: 60, position: 90 } });
    expect(setPosition).toHaveBeenLastCalledWith({ duration: 60, position: 60, playbackRate: 1 });
    adapter.updateMediaSessionClient("player", { positionState: { duration: 60, position: NaN } });
    expect(setPosition).toHaveBeenLastCalledWith();
  });

  it("continues installing supported actions when a Tesla action is unsupported", async () => {
    const adapter = await import("../../src/shared/media-session-adapter.js");
    navigator.mediaSession.setActionHandler.mockImplementation((name) => {
      if (name === "seekto") throw new Error("unsupported");
    });
    expect(() => adapter.updateMediaSessionClient("player", { handlers: {
      play: vi.fn(), pause: vi.fn(), nexttrack: vi.fn(), previoustrack: vi.fn(), seekto: vi.fn(),
    } })).not.toThrow();
    expect(navigator.mediaSession.setActionHandler.mock.calls.some(([name, handler]) => name === "previoustrack" && handler)).toBe(true);
  });

});
