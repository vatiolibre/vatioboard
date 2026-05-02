import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock i18n
vi.mock("../../src/i18n.js", () => ({
  t: (key) => key,
  getLang: () => "en",
  toggleLang: vi.fn(),
  applyTranslations: vi.fn(),
}));

// Spy on createMediaPlayer to observe visualizer argument
const createMediaPlayerSpy = vi.fn();
vi.mock("../../src/shared/media-player.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createMediaPlayer(opts) {
      createMediaPlayerSpy(opts);
      return original.createMediaPlayer(opts);
    },
  };
});

const { createLibraryMediaPlayer } = await import("../../src/library/library-media-player.js");

describe("createLibraryMediaPlayer", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });

  it("creates a library media player instance", () => {
    const lmp = createLibraryMediaPlayer();
    expect(lmp).toHaveProperty("mount");
    expect(lmp).toHaveProperty("destroy");
    expect(lmp).toHaveProperty("isActive");
  });

  it("mounts a video player for video items", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "video-1",
      title: "Test Video",
      media_kind: "video",
      download_url: "https://example.com/video.mp4",
      image_url: "https://example.com/poster.jpg",
    };

    const result = lmp.mount({ container, item });
    expect(result).toBe(true);
    expect(lmp.isActive()).toBe(true);
    expect(container.querySelector(".media-player")).not.toBeNull();
    expect(container.querySelector("video")).not.toBeNull();

    lmp.destroy();
  });

  it("mounts an audio player for audio items", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-1",
      title: "Test Song",
      media_kind: "audio",
      download_url: "https://example.com/audio.mp3",
    };

    const result = lmp.mount({ container, item });
    expect(result).toBe(true);
    expect(container.querySelector(".media-player")).not.toBeNull();
    expect(container.querySelector("audio")).not.toBeNull();

    lmp.destroy();
  });

  it("returns false for image items", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "image-1",
      title: "Photo",
      media_kind: "image",
      image_url: "https://example.com/photo.jpg",
    };

    const result = lmp.mount({ container, item });
    expect(result).toBe(false);
    expect(lmp.isActive()).toBe(false);

    lmp.destroy();
  });

  it("returns false for unknown media kind", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "unknown-1",
      title: "Unknown",
      media_kind: "document",
      download_url: "https://example.com/file.pdf",
    };

    const result = lmp.mount({ container, item });
    expect(result).toBe(false);

    lmp.destroy();
  });

  it("returns false when no source URL available", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "empty-1",
      title: "No URL",
      media_kind: "video",
    };

    const result = lmp.mount({ container, item });
    expect(result).toBe(false);

    lmp.destroy();
  });

  it("prefers blobUrl over remote URL", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "video-2",
      title: "Local Video",
      media_kind: "video",
      download_url: "https://example.com/remote.mp4",
    };

    const blobUrl = "blob:https://vatioboard.com/12345";
    lmp.mount({ container, item, blobUrl });

    const video = container.querySelector("video");
    expect(video.src).toContain("blob:");

    lmp.destroy();
  });

  it("destroys previous player on re-mount", () => {
    const lmp = createLibraryMediaPlayer();
    const item1 = {
      name: "video-1",
      title: "First",
      media_kind: "video",
      download_url: "https://example.com/first.mp4",
    };
    const item2 = {
      name: "video-2",
      title: "Second",
      media_kind: "video",
      download_url: "https://example.com/second.mp4",
    };

    lmp.mount({ container, item: item1 });
    const firstPlayer = container.querySelector(".media-player");
    expect(firstPlayer).not.toBeNull();

    lmp.mount({ container, item: item2 });
    const players = container.querySelectorAll(".media-player");
    expect(players).toHaveLength(1);

    lmp.destroy();
  });

  it("isActive returns false after destroy", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "video-1",
      title: "Test",
      media_kind: "video",
      download_url: "https://example.com/video.mp4",
    };

    lmp.mount({ container, item });
    expect(lmp.isActive()).toBe(true);

    lmp.destroy();
    expect(lmp.isActive()).toBe(false);
  });

  it("can mount again after destroy", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "video-1",
      title: "Test",
      media_kind: "video",
      download_url: "https://example.com/video.mp4",
    };

    lmp.mount({ container, item });
    lmp.destroy();

    const result = lmp.mount({ container, item });
    expect(result).toBe(true);
    expect(lmp.isActive()).toBe(true);

    lmp.destroy();
  });

  it("uses downloadUrl as fallback when download_url missing", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-3",
      title: "Fallback",
      media_kind: "audio",
      downloadUrl: "https://example.com/fallback.mp3",
    };

    const result = lmp.mount({ container, item });
    expect(result).toBe(true);

    const audio = container.querySelector("audio");
    expect(audio.src).toContain("fallback.mp3");

    lmp.destroy();
  });

  it("uses image_url as last-resort source", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "video-4",
      title: "Image URL Only",
      media_kind: "video",
      image_url: "https://example.com/image-as-src.mp4",
    };

    const result = lmp.mount({ container, item });
    expect(result).toBe(true);

    lmp.destroy();
  });

  it("handles null item gracefully", () => {
    const lmp = createLibraryMediaPlayer();
    const result = lmp.mount({ container, item: null });
    expect(result).toBe(false);
  });

  it("revokes blob URL on destroy", () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-5",
      title: "Blob test",
      media_kind: "audio",
      download_url: "https://example.com/audio.mp3",
    };

    lmp.mount({ container, item, blobUrl: "blob:fake" });
    lmp.destroy();

    expect(revokeSpy).toHaveBeenCalledWith("blob:fake");
    revokeSpy.mockRestore();
  });

  it("prefers playback_url over download_url for media src", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-pb",
      title: "Playback URL test",
      media_kind: "audio",
      playback_url: "https://example.com/inline.mp3",
      download_url: "https://example.com/download.mp3",
    };

    lmp.mount({ container, item });
    const audio = container.querySelector("audio");
    expect(audio.src).toContain("inline.mp3");
    expect(audio.src).not.toContain("download.mp3");

    lmp.destroy();
  });

  it("falls back to download_url when playback_url is absent", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-fb",
      title: "Fallback test",
      media_kind: "audio",
      download_url: "https://example.com/fallback-dl.mp3",
    };

    lmp.mount({ container, item });
    const audio = container.querySelector("audio");
    expect(audio.src).toContain("fallback-dl.mp3");

    lmp.destroy();
  });

  it("getMediaElement returns the audio/video element when active", () => {
    const lmp = createLibraryMediaPlayer();
    expect(lmp.getMediaElement()).toBeNull();

    const item = {
      name: "audio-gme",
      title: "Element test",
      media_kind: "audio",
      download_url: "https://example.com/el.mp3",
    };

    lmp.mount({ container, item });
    const el = lmp.getMediaElement();
    expect(el).toBeInstanceOf(HTMLAudioElement);

    lmp.destroy();
    expect(lmp.getMediaElement()).toBeNull();
  });

  it("uses playback_url for audio src and ignores download_url", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-bff",
      title: "BFF playback preference",
      media_kind: "audio",
      playback_url: "https://api.dev.vatioboard.com/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=AUDIO-1",
      download_url: "https://example.com/download/audio-1.mp3",
    };

    lmp.mount({ container, item });
    const audio = container.querySelector("audio");
    expect(audio.src).toContain("api.dev.vatioboard.com");
    expect(audio.src).not.toContain("example.com/download");

    lmp.destroy();
  });

  // ── Visualizer safe-source gating ────────────────────────────────────

  it("does not enable visualizer for cross-origin BFF audio URLs", () => {
    createMediaPlayerSpy.mockClear();
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-remote",
      title: "Remote BFF audio",
      media_kind: "audio",
      playback_url: "https://api.dev.vatioboard.com/api/method/download?name=AUDIO-1",
    };

    lmp.mount({ container, item });
    expect(createMediaPlayerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ visualizer: false }),
    );

    // Audio element still works for native playback
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio.src).toContain("api.dev.vatioboard.com");

    lmp.destroy();
  });

  it("enables visualizer for blob: audio URLs", () => {
    createMediaPlayerSpy.mockClear();
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-blob",
      title: "Pinned audio",
      media_kind: "audio",
      download_url: "https://api.dev.vatioboard.com/api/method/download?name=AUDIO-2",
    };

    lmp.mount({ container, item, blobUrl: "blob:https://vatioboard.com/12345" });
    expect(createMediaPlayerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ visualizer: true }),
    );

    lmp.destroy();
  });

  it("enables visualizer for same-origin audio URLs", () => {
    createMediaPlayerSpy.mockClear();
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-local",
      title: "Local audio",
      media_kind: "audio",
      playback_url: `${window.location.origin}/audio/local.mp3`,
    };

    lmp.mount({ container, item });
    expect(createMediaPlayerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ visualizer: true }),
    );

    lmp.destroy();
  });

  it("never enables visualizer for video items regardless of source", () => {
    createMediaPlayerSpy.mockClear();
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "video-local",
      title: "Local video",
      media_kind: "video",
      playback_url: `${window.location.origin}/video/local.mp4`,
    };

    lmp.mount({ container, item });
    expect(createMediaPlayerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ visualizer: false }),
    );

    lmp.destroy();
  });

  it("plays remote BFF audio audibly without visualizer wiring", () => {
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-play",
      title: "Audible remote audio",
      media_kind: "audio",
      playback_url: "https://api.dev.vatioboard.com/api/method/download?name=AUDIO-3",
    };

    lmp.mount({ container, item });
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();

    // Verify the audio element can play natively
    audio.play = vi.fn(() => Promise.resolve());
    const playBtn = container.querySelector(".media-player-play-btn");
    playBtn.click();
    expect(audio.play).toHaveBeenCalled();

    lmp.destroy();
  });

  it("enables visualizer for presigned S3 audio URLs", () => {
    createMediaPlayerSpy.mockClear();
    const lmp = createLibraryMediaPlayer();
    const item = {
      name: "audio-s3",
      title: "S3 presigned audio",
      media_kind: "audio",
      playback_url: "https://my-bucket.s3.us-east-1.amazonaws.com/media/audio.mp3?X-Amz-Signature=abc123",
    };

    lmp.mount({ container, item });
    expect(createMediaPlayerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ visualizer: true }),
    );

    lmp.destroy();
  });
});
