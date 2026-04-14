import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const visualizerMockState = vi.hoisted(() => {
  let factory = null;

  function makeController({ available = true, startResult = available } = {}) {
    let isAvailable = available;
    return {
      get isAvailable() {
        return isAvailable;
      },
      setMode: vi.fn(),
      resize: vi.fn(),
      start: vi.fn(() => Promise.resolve(Boolean(startResult && isAvailable))),
      stop: vi.fn(),
      destroy: vi.fn(),
      __setAvailable(nextValue) {
        isAvailable = Boolean(nextValue);
      },
    };
  }

  const calls = [];
  const createVisualizerSpy = vi.fn((options) => {
    const controller = typeof factory === "function" ? factory(options) : makeController();
    calls.push({ options, controller });
    return controller;
  });

  return {
    calls,
    createVisualizerSpy,
    makeController,
    setFactory(nextFactory) {
      factory = nextFactory;
    },
    reset() {
      factory = null;
      calls.length = 0;
      createVisualizerSpy.mockClear();
    },
  };
});

// Provide minimal i18n mock before importing media-player
vi.mock("../../src/i18n.js", () => ({
  t: (key) => key,
  getLang: () => "en",
  toggleLang: vi.fn(),
  applyTranslations: vi.fn(),
}));

vi.mock("../../src/shared/audio-mini-visualizer.js", () => ({
  createMiniAudioVisualizer: visualizerMockState.createVisualizerSpy,
}));

const {
  createMediaPlayer,
  formatTime,
  VISUALIZER_MODE_STORAGE_KEY,
} = await import("../../src/shared/media-player.js");

describe("formatTime", () => {
  it("formats zero seconds", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatTime(42)).toBe("0:42");
  });

  it("formats whole minutes", () => {
    expect(formatTime(120)).toBe("2:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(185)).toBe("3:05");
  });

  it("formats an hour or more as h:mm:ss", () => {
    expect(formatTime(3661)).toBe("1:01:01");
  });

  it("handles NaN gracefully", () => {
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("handles Infinity gracefully", () => {
    expect(formatTime(Infinity)).toBe("0:00");
  });

  it("handles negative values gracefully", () => {
    expect(formatTime(-5)).toBe("0:00");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(62.9)).toBe("1:02");
  });
});

describe("createMediaPlayer", () => {
  let container;

  beforeEach(() => {
    localStorage.clear();
    visualizerMockState.reset();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("returns null when container is missing", () => {
    const result = createMediaPlayer({ container: null, src: "test.mp4", kind: "video" });
    expect(result).toBeNull();
  });

  it("returns null when src is missing", () => {
    const result = createMediaPlayer({ container, src: "", kind: "video" });
    expect(result).toBeNull();
  });

  it("creates a video player with correct structure", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video", title: "Test" });
    expect(player).not.toBeNull();

    const root = container.querySelector(".media-player");
    expect(root).not.toBeNull();
    expect(root.dataset.mediaKind).toBe("video");

    const video = root.querySelector("video");
    expect(video).not.toBeNull();
    expect(video.src).toContain("test.mp4");
    expect(video.title).toBe("Test");
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute("crossorigin")).toBe(false);

    player.destroy();
  });

  it("creates an audio player with visual and hidden audio element", () => {
    const player = createMediaPlayer({ container, src: "test.mp3", kind: "audio", title: "Song" });
    expect(player).not.toBeNull();

    const root = container.querySelector(".media-player");
    expect(root.dataset.mediaKind).toBe("audio");

    const audioVisual = root.querySelector(".media-player-audio-visual");
    expect(audioVisual).not.toBeNull();

    const audioEl = root.querySelector("audio");
    expect(audioEl).not.toBeNull();
    expect(audioEl.style.display).toBe("none");
    expect(audioEl.src).toContain("test.mp3");

    const label = root.querySelector(".media-player-audio-label");
    expect(label.textContent).toBe("Song");

    player.destroy();
  });

  it("renders visualizer controls only for audio players with visualizer enabled", () => {
    const audioPlayer = createMediaPlayer({
      container,
      src: "test.mp3",
      kind: "audio",
      title: "Song",
      visualizer: true,
    });

    expect(container.querySelector(".media-player-audio-visualizer-modes")).not.toBeNull();
    expect([...container.querySelectorAll(".media-player-audio-mode-btn")].map((button) => button.dataset.mode)).toEqual([
      "spectrum",
      "scope",
      "off",
    ]);
    expect(visualizerMockState.createVisualizerSpy).toHaveBeenCalledTimes(1);

    audioPlayer.destroy();

    const secondContainer = document.createElement("div");
    document.body.append(secondContainer);
    visualizerMockState.reset();

    const plainAudioPlayer = createMediaPlayer({
      container: secondContainer,
      src: "test.mp3",
      kind: "audio",
      title: "Song",
      visualizer: false,
    });

    expect(secondContainer.querySelector(".media-player-audio-visualizer-modes")).toBeNull();
    expect(visualizerMockState.createVisualizerSpy).not.toHaveBeenCalled();
    plainAudioPlayer.destroy();
  });

  it("renders transport controls", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const root = container.querySelector(".media-player");

    expect(root.querySelector(".media-player-play-btn")).not.toBeNull();
    expect(root.querySelector(".media-player-progress")).not.toBeNull();
    expect(root.querySelector(".media-player-time")).not.toBeNull();
    expect(root.querySelector(".media-player-mute-btn")).not.toBeNull();
    expect(root.querySelector(".media-player-volume")).not.toBeNull();

    player.destroy();
  });

  it("toggles play/pause on button click", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const playBtn = container.querySelector(".media-player-play-btn");

    // Mock play (returns promise in real browsers)
    player.mediaElement.play = vi.fn(() => Promise.resolve());
    player.mediaElement.pause = vi.fn();

    // Click to play (paused=true by default in jsdom)
    playBtn.click();
    expect(player.mediaElement.play).toHaveBeenCalled();

    // Simulate the media element firing play event and being not-paused
    Object.defineProperty(player.mediaElement, "paused", { value: false, writable: true, configurable: true });
    player.mediaElement.dispatchEvent(new Event("play"));

    // Click to pause
    playBtn.click();
    expect(player.mediaElement.pause).toHaveBeenCalled();

    player.destroy();
  });

  it("updates mute state on mute button click", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const muteBtn = container.querySelector(".media-player-mute-btn");

    expect(player.mediaElement.muted).toBe(false);
    muteBtn.click();
    expect(player.mediaElement.muted).toBe(true);
    muteBtn.click();
    expect(player.mediaElement.muted).toBe(false);

    player.destroy();
  });

  it("updates volume on slider input", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const volumeSlider = container.querySelector(".media-player-volume");

    volumeSlider.value = "50";
    volumeSlider.dispatchEvent(new Event("input"));
    expect(player.mediaElement.volume).toBe(0.5);

    player.destroy();
  });

  it("unmutes when volume slider goes above zero", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const volumeSlider = container.querySelector(".media-player-volume");

    player.mediaElement.muted = true;
    volumeSlider.value = "30";
    volumeSlider.dispatchEvent(new Event("input"));
    expect(player.mediaElement.muted).toBe(false);

    player.destroy();
  });

  it("seeks via progress slider input event", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const progressSlider = container.querySelector(".media-player-progress");

    // Simulate loaded metadata with duration
    Object.defineProperty(player.mediaElement, "duration", { value: 100, writable: true });
    player.mediaElement.dispatchEvent(new Event("loadedmetadata"));

    progressSlider.value = "500"; // 50%
    progressSlider.dispatchEvent(new Event("input"));
    expect(player.mediaElement.currentTime).toBe(50);

    player.destroy();
  });

  it("completes seek on progress change event", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const progressSlider = container.querySelector(".media-player-progress");

    Object.defineProperty(player.mediaElement, "duration", { value: 200, writable: true });

    progressSlider.value = "250"; // 25%
    progressSlider.dispatchEvent(new Event("change"));
    expect(player.mediaElement.currentTime).toBe(50);

    player.destroy();
  });

  it("displays correct time on loadedmetadata", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const timeDisplay = container.querySelector(".media-player-time");

    Object.defineProperty(player.mediaElement, "duration", { value: 185, writable: true });
    player.mediaElement.currentTime = 0;
    player.mediaElement.dispatchEvent(new Event("loadedmetadata"));

    expect(timeDisplay.textContent).toBe("0:00 / 3:05");

    player.destroy();
  });

  it("cleans up on destroy", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    expect(container.querySelector(".media-player")).not.toBeNull();

    player.mediaElement.pause = vi.fn();
    player.destroy();

    expect(container.querySelector(".media-player")).toBeNull();
    expect(player.mediaElement.pause).toHaveBeenCalled();
  });

  it("does not interact after destroy", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const playBtn = container.querySelector(".media-player-play-btn");

    player.mediaElement.play = vi.fn(() => Promise.resolve());
    player.destroy();

    // Re-append playBtn for clicking (it was removed from DOM)
    document.body.append(playBtn);
    playBtn.click();
    expect(player.mediaElement.play).not.toHaveBeenCalled();
  });

  it("sets poster on video when posterUrl is provided", () => {
    const player = createMediaPlayer({
      container,
      src: "test.mp4",
      kind: "video",
      posterUrl: "poster.jpg",
    });

    const video = container.querySelector("video");
    expect(video.poster).toContain("poster.jpg");

    player.destroy();
  });

  it("replaces container children on mount", () => {
    container.innerHTML = "<p>old content</p>";
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });

    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector(".media-player")).not.toBeNull();

    player.destroy();
  });

  it("handles ended event", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const playBtn = container.querySelector(".media-player-play-btn");

    // Simulate play then ended
    player.mediaElement.dispatchEvent(new Event("play"));
    player.mediaElement.dispatchEvent(new Event("ended"));

    // Play icon should be restored (not pause)
    const icon = playBtn.querySelector(".btn-icon");
    expect(icon.innerHTML).toContain("svg");

    player.destroy();
  });

  it("does not set crossOrigin on audio elements", () => {
    const player = createMediaPlayer({ container, src: "test.mp3", kind: "audio" });
    const audio = container.querySelector("audio");
    expect(audio.hasAttribute("crossorigin")).toBe(false);
    player.destroy();
  });

  it("renders fullscreen button for video", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const fsBtn = container.querySelector(".media-player-fullscreen-btn");
    expect(fsBtn).not.toBeNull();
    player.destroy();
  });

  it("does not render fullscreen button for audio", () => {
    const player = createMediaPlayer({ container, src: "test.mp3", kind: "audio" });
    const fsBtn = container.querySelector(".media-player-fullscreen-btn");
    expect(fsBtn).toBeNull();
    player.destroy();
  });

  it("does not render visualizer controls for video players", () => {
    const player = createMediaPlayer({
      container,
      src: "test.mp4",
      kind: "video",
      visualizer: true,
    });

    expect(container.querySelector(".media-player-audio-visualizer-modes")).toBeNull();
    expect(visualizerMockState.createVisualizerSpy).not.toHaveBeenCalled();
    player.destroy();
  });

  it("sets playbackError attribute when play rejects with non-AbortError", async () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const root = container.querySelector(".media-player");
    const playBtn = container.querySelector(".media-player-play-btn");

    player.mediaElement.play = vi.fn(() =>
      Promise.reject(new DOMException("Not supported", "NotSupportedError")),
    );

    playBtn.click();
    await new Promise((r) => queueMicrotask(r));

    expect(root.dataset.playbackError).toBe("true");
    player.destroy();
  });

  it("does not set playbackError for AbortError", async () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const root = container.querySelector(".media-player");
    const playBtn = container.querySelector(".media-player-play-btn");

    player.mediaElement.play = vi.fn(() =>
      Promise.reject(new DOMException("Aborted", "AbortError")),
    );

    playBtn.click();
    await new Promise((r) => queueMicrotask(r));

    expect(root.dataset.playbackError).toBeUndefined();
    player.destroy();
  });

  it("clears playbackError on successful play", () => {
    const player = createMediaPlayer({ container, src: "test.mp4", kind: "video" });
    const root = container.querySelector(".media-player");

    root.dataset.playbackError = "true";
    player.mediaElement.dispatchEvent(new Event("play"));

    expect(root.dataset.playbackError).toBeUndefined();
    player.destroy();
  });

  it("audio playback works when visualizer is enabled but unavailable", () => {
    visualizerMockState.setFactory(() =>
      visualizerMockState.makeController({ available: false, startResult: false }));

    const player = createMediaPlayer({
      container, src: "test.mp3", kind: "audio", visualizer: true,
    });
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio.src).toContain("test.mp3");
    expect(container.querySelector(".media-player-audio-canvas-wrap")?.dataset.visualizerState).toBe("error");

    player.mediaElement.play = vi.fn(() => Promise.resolve());
    container.querySelector(".media-player-play-btn").click();
    expect(player.mediaElement.play).toHaveBeenCalled();

    player.destroy();
  });

  it("reads and applies the persisted visualizer mode", () => {
    localStorage.setItem(VISUALIZER_MODE_STORAGE_KEY, "scope");

    const player = createMediaPlayer({
      container,
      src: "test.mp3",
      kind: "audio",
      visualizer: true,
    });

    expect(visualizerMockState.createVisualizerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "scope" }),
    );
    expect(
      container.querySelector('.media-player-audio-mode-btn[data-mode="scope"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.querySelector(".media-player-audio-canvas-wrap")?.dataset.visualizerMode).toBe("scope");

    player.destroy();
  });

  it("switching the mode to off stops visualizer rendering", async () => {
    const player = createMediaPlayer({
      container,
      src: "test.mp3",
      kind: "audio",
      visualizer: true,
    });
    const controller = visualizerMockState.calls[0]?.controller;

    player.mediaElement.dispatchEvent(new Event("play"));
    await new Promise((resolve) => queueMicrotask(resolve));

    container
      .querySelector('.media-player-audio-mode-btn[data-mode="off"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(controller?.setMode).toHaveBeenCalledWith("off");
    expect(controller?.stop).toHaveBeenCalled();
    expect(localStorage.getItem(VISUALIZER_MODE_STORAGE_KEY)).toBe("off");
    expect(container.querySelector(".media-player-audio-canvas-wrap")?.dataset.visualizerState).toBe("disabled");

    player.destroy();
  });

  it("touching the visualizer area cycles the mode and persists it", () => {
    const player = createMediaPlayer({
      container,
      src: "test.mp3",
      kind: "audio",
      visualizer: true,
    });
    const controller = visualizerMockState.calls[0]?.controller;

    container
      .querySelector(".media-player-audio-canvas-wrap")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(controller?.setMode).toHaveBeenCalledWith("scope");
    expect(localStorage.getItem(VISUALIZER_MODE_STORAGE_KEY)).toBe("scope");
    expect(container.querySelector(".media-player-audio-canvas-wrap")?.dataset.visualizerMode).toBe("scope");

    player.destroy();
  });

  it("destroys the mini visualizer with the player", () => {
    const player = createMediaPlayer({
      container,
      src: "test.mp3",
      kind: "audio",
      visualizer: true,
    });
    const controller = visualizerMockState.calls[0]?.controller;

    player.destroy();

    expect(controller?.destroy).toHaveBeenCalled();
  });
});
