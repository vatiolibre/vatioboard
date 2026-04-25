import { beforeEach, describe, expect, it, vi } from "vitest";

describe("audio-system background leases", () => {
  let audioSystem;

  beforeEach(async () => {
    vi.resetModules();
    audioSystem = await import("../../src/shared/audio-system.js");
  });

  it("shares one keep-alive audio element across independent leases", async () => {
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();

    await audioSystem.acquireBackgroundAudioLease("speed", {
      shouldContinue: () => true,
    });

    expect(audioSystem.getBackgroundKeepAliveAudio()).toBe(keepAliveAudio);
    expect(keepAliveAudio.paused).toBe(false);
    expect(audioSystem.isBackgroundAudioLeaseActive("speed")).toBe(true);

    await audioSystem.acquireBackgroundAudioLease("player", {
      shouldContinue: () => true,
    });
    audioSystem.releaseBackgroundAudioLease("speed");

    expect(keepAliveAudio.paused).toBe(false);
    expect(audioSystem.isBackgroundAudioLeaseActive("player")).toBe(true);

    audioSystem.releaseBackgroundAudioLease("player");

    expect(keepAliveAudio.paused).toBe(true);
  });

  it("drops stale leases before arming the keep-alive", async () => {
    const keepAliveAudio = audioSystem.getBackgroundKeepAliveAudio();

    const armed = await audioSystem.acquireBackgroundAudioLease("stale", {
      shouldContinue: () => false,
    });

    expect(armed).toBe(false);
    expect(audioSystem.hasBackgroundAudioLease("stale")).toBe(false);
    expect(keepAliveAudio.paused).toBe(true);
  });
});

describe("media-session-adapter clients", () => {
  let adapter;

  beforeEach(async () => {
    vi.resetModules();
    adapter = await import("../../src/shared/media-session-adapter.js");
  });

  it("applies the highest-priority media session client and restores the previous one", () => {
    adapter.updateMediaSessionClient("player", {
      active: true,
      priority: 10,
      playbackState: "playing",
      metadata: {
        title: "Player Track",
        artist: "Player",
        album: "VatioBoard",
      },
    });

    expect(navigator.mediaSession.playbackState).toBe("playing");
    expect(navigator.mediaSession.metadata.title).toBe("Player Track");

    adapter.updateMediaSessionClient("speed", {
      active: true,
      priority: 50,
      playbackState: "paused",
      metadata: {
        title: "88 km/h",
        artist: "GPS live",
        album: "Vatio Speed",
      },
    });

    expect(navigator.mediaSession.playbackState).toBe("paused");
    expect(navigator.mediaSession.metadata.title).toBe("88 km/h");

    adapter.clearMediaSessionClient("speed");

    expect(navigator.mediaSession.playbackState).toBe("playing");
    expect(navigator.mediaSession.metadata.title).toBe("Player Track");
  });
});
