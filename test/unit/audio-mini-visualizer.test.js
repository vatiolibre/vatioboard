import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMiniAudioVisualizer } from "../../src/shared/audio-mini-visualizer.js";

describe("createMiniAudioVisualizer", () => {
  let originalAudioContext;
  let originalWebkitAudioContext;
  let originalResizeObserver;
  let originalGlobalResizeObserver;
  let originalGetContext;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let originalGlobalRequestAnimationFrame;
  let originalGlobalCancelAnimationFrame;
  let fakeSourceNode;
  let fakeAnalyser;
  let fakeAudioContext;
  let fakeCanvasContext;

  beforeEach(() => {
    document.body.innerHTML = "";

    originalAudioContext = window.AudioContext;
    originalWebkitAudioContext = window.webkitAudioContext;
    originalResizeObserver = window.ResizeObserver;
    originalGlobalResizeObserver = globalThis.ResizeObserver;
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    originalGlobalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalGlobalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    fakeSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    fakeAnalyser = {
      fftSize: 256,
      frequencyBinCount: 128,
      smoothingTimeConstant: 0,
      minDecibels: 0,
      maxDecibels: 0,
      getByteFrequencyData: vi.fn((buffer) => buffer.fill(32)),
      getByteTimeDomainData: vi.fn((buffer) => buffer.fill(128)),
      disconnect: vi.fn(),
    };

    fakeAudioContext = {
      state: "running",
      destination: {},
      resume: vi.fn(async () => "running"),
      close: vi.fn(async () => undefined),
      createMediaElementSource: vi.fn(() => fakeSourceNode),
      createAnalyser: vi.fn(() => fakeAnalyser),
    };

    const MockAudioContext = vi.fn(function MockAudioContext() {
      return fakeAudioContext;
    });
    window.AudioContext = MockAudioContext;
    window.webkitAudioContext = undefined;
    const FakeResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    window.ResizeObserver = FakeResizeObserver;
    globalThis.ResizeObserver = FakeResizeObserver;
    fakeCanvasContext = {
      fillStyles: [],
      rects: [],
      clearRect: vi.fn(),
      fillRect: vi.fn(function fillRect(x, y, width, height) {
        this.rects.push({ x, y, width, height, fillStyle: this._fillStyle });
      }),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      set lineWidth(value) {
        this._lineWidth = value;
      },
      set strokeStyle(value) {
        this._strokeStyle = value;
      },
      set fillStyle(value) {
        this._fillStyle = value;
        this.fillStyles.push(value);
      },
      set lineJoin(value) {
        this._lineJoin = value;
      },
      set lineCap(value) {
        this._lineCap = value;
      },
      set shadowColor(value) {
        this._shadowColor = value;
      },
      set shadowBlur(value) {
        this._shadowBlur = value;
      },
    };
    HTMLCanvasElement.prototype.getContext = vi.fn((kind) => {
      if (kind !== "2d") return null;
      return fakeCanvasContext;
    });
    window.requestAnimationFrame = vi.fn(() => 17);
    window.cancelAnimationFrame = vi.fn();
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    window.webkitAudioContext = originalWebkitAudioContext;
    window.ResizeObserver = originalResizeObserver;
    globalThis.ResizeObserver = originalGlobalResizeObserver;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.requestAnimationFrame = originalGlobalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalGlobalCancelAnimationFrame;
    document.body.innerHTML = "";
  });

  it("returns an unavailable no-op controller when AudioContext is unsupported", async () => {
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;

    const mount = document.createElement("div");
    const media = document.createElement("audio");

    const controller = createMiniAudioVisualizer({ mediaElement: media, mount });

    expect(controller.isAvailable).toBe(false);
    await expect(controller.start()).resolves.toBe(false);
    controller.stop();
    controller.destroy();
  });

  it("creates a canvas visualizer and cleans up the audio graph on destroy", async () => {
    const mount = document.createElement("div");
    Object.defineProperty(mount, "getBoundingClientRect", {
      value: () => ({ width: 240, height: 72 }),
    });
    document.body.append(mount);

    const media = document.createElement("audio");
    const controller = createMiniAudioVisualizer({
      mediaElement: media,
      mount,
      mode: "spectrum",
    });

    expect(controller.isAvailable).toBe(true);
    expect(mount.querySelector("canvas")).not.toBeNull();

    await expect(controller.start()).resolves.toBe(true);
    expect(fakeAudioContext.createMediaElementSource).toHaveBeenCalledWith(media);
    expect(fakeSourceNode.connect).toHaveBeenCalledWith(fakeAudioContext.destination);
    expect(fakeAudioContext.createAnalyser).toHaveBeenCalled();
    expect(window.requestAnimationFrame).toHaveBeenCalled();

    controller.setMode("off");
    expect(window.cancelAnimationFrame).toHaveBeenCalled();

    controller.destroy();
    expect(fakeSourceNode.disconnect).toHaveBeenCalledWith(fakeAnalyser);
    expect(fakeAnalyser.disconnect).toHaveBeenCalled();
    expect(fakeAudioContext.close).toHaveBeenCalled();
    expect(mount.querySelector("canvas")).toBeNull();
  });

  it("renders 20 stacked spectrum bars with a delayed peak cap", async () => {
    const frameCallbacks = [];
    window.requestAnimationFrame = vi.fn((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    globalThis.requestAnimationFrame = window.requestAnimationFrame;

    const mount = document.createElement("div");
    mount.style.setProperty("--media-player-visualizer-bar-low", "rgb(1, 180, 80)");
    mount.style.setProperty("--media-player-visualizer-bar-mid", "rgb(180, 220, 60)");
    mount.style.setProperty("--media-player-visualizer-bar-high", "rgb(250, 130, 40)");
    mount.style.setProperty("--media-player-visualizer-peak", "rgb(214, 214, 206)");
    Object.defineProperty(mount, "getBoundingClientRect", {
      value: () => ({ width: 240, height: 72 }),
    });
    document.body.append(mount);

    fakeAnalyser.getByteFrequencyData.mockImplementation((buffer) => {
      buffer.fill(255);
    });

    const media = document.createElement("audio");
    const controller = createMiniAudioVisualizer({
      mediaElement: media,
      mount,
      mode: "spectrum",
    });

    await expect(controller.start()).resolves.toBe(true);
    frameCallbacks.shift()();

    expect(fakeCanvasContext.fillStyles).toEqual(expect.arrayContaining([
      "rgb(1, 180, 80)",
      "rgb(180, 220, 60)",
      "rgb(250, 130, 40)",
      "rgb(214, 214, 206)",
    ]));
    const firstFramePeakRects = fakeCanvasContext.rects.filter((rect) => rect.fillStyle === "rgb(214, 214, 206)");
    expect(firstFramePeakRects).toHaveLength(20);
    const firstPeakRect = firstFramePeakRects[0];
    const firstStackRects = fakeCanvasContext.rects
      .filter((rect) => rect.x === firstPeakRect.x && rect.width === firstPeakRect.width && rect.fillStyle !== "rgb(214, 214, 206)");
    const firstTopStackRect = firstStackRects.reduce((topRect, rect) => (rect.y < topRect.y ? rect : topRect));
    expect(firstTopStackRect.fillStyle).toBe("rgb(250, 130, 40)");
    expect(firstTopStackRect.y - (firstPeakRect.y + firstPeakRect.height)).toBeGreaterThanOrEqual(firstTopStackRect.height);

    fakeCanvasContext.fillStyles = [];
    fakeCanvasContext.rects = [];
    fakeAnalyser.getByteFrequencyData.mockImplementation((buffer) => {
      buffer.fill(0);
    });

    frameCallbacks.shift()();
    const secondFramePeakRects = fakeCanvasContext.rects.filter((rect) => rect.fillStyle === "rgb(214, 214, 206)");
    expect(secondFramePeakRects).toHaveLength(20);
    expect(secondFramePeakRects[0].y - firstPeakRect.y).toBeLessThanOrEqual(2);

    controller.destroy();
  });
});
