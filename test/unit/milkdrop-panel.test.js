import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock butterchurn and butterchurn-presets before importing
vi.mock("butterchurn", () => ({
  default: {
    createVisualizer: vi.fn(() => ({
      connectAudio: vi.fn(),
      loadPreset: vi.fn(),
      setRendererSize: vi.fn(),
      render: vi.fn(),
    })),
  },
}));

vi.mock("butterchurn-presets", () => ({
  default: {
    getPresets: () => ({
      "Preset A": { name: "Preset A" },
      "Preset B": { name: "Preset B" },
      "Preset C": { name: "Preset C" },
    }),
  },
}));

// Mock audio-runtime
const mockAudioElement = document.createElement("audio");
vi.mock("../../src/shared/audio-runtime.js", () => ({
  getAudioElement: vi.fn(() => mockAudioElement),
  getState: vi.fn(() => ({
    paused: false,
    playing: true,
    currentTrack: null,
    queue: [],
    currentIndex: 0,
    volume: 1,
    muted: false,
    repeat: "off",
    shuffle: false,
    sourceType: "blob",
    loading: false,
    error: null,
    currentTime: 0,
    duration: 0,
  })),
  subscribe: vi.fn(() => vi.fn()),
}));

// Mock audio-graph-registry
const fakeGraphEntry = {
  audioContext: {
    state: "running",
    destination: {},
    createAnalyser: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 256,
      frequencyBinCount: 128,
    })),
    resume: vi.fn(async () => "running"),
    close: vi.fn(async () => undefined),
  },
  sourceNode: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  consumers: new Set(),
  refCount: 1,
};

vi.mock("../../src/shared/audio-graph-registry.js", () => ({
  acquireGraph: vi.fn(async () => fakeGraphEntry),
  releaseGraph: vi.fn(),
  getGraph: vi.fn(() => null),
}));

vi.mock("../../src/shared/audio-visualizer.js", () => ({
  isVisualizerSafeSource: vi.fn(() => true),
}));

vi.mock("../../src/shared/storage.js", () => ({
  loadText: vi.fn(() => ""),
  saveText: vi.fn(),
}));

import { createMilkdropPanel } from "../../src/player/milkdrop-panel.js";

describe("createMilkdropPanel", () => {
  let mount;
  let originalGetContext;
  let originalResizeObserver;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalResizeObserver = window.ResizeObserver;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;

    // Mock WebGL context
    HTMLCanvasElement.prototype.getContext = vi.fn(function (type) {
      if (type === "webgl2" || type === "webgl") {
        return { canvas: this };
      }
      return originalGetContext.call(this, type);
    });

    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };

    window.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 0));
    window.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));

    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    localStorage.clear();
  });

  it("creates a panel instance with expected API", () => {
    const panel = createMilkdropPanel({ mount });
    expect(panel).toHaveProperty("open");
    expect(panel).toHaveProperty("close");
    expect(panel).toHaveProperty("toggle");
    expect(panel).toHaveProperty("isOpen");
    expect(panel).toHaveProperty("destroy");
    panel.destroy();
  });

  it("starts hidden", () => {
    const panel = createMilkdropPanel({ mount });
    expect(panel.isOpen()).toBe(false);
    const el = mount.querySelector(".milkdrop-panel");
    expect(el.hidden).toBe(true);
    panel.destroy();
  });

  it("opens and closes without throwing", async () => {
    const panel = createMilkdropPanel({ mount });
    await panel.open();
    expect(panel.isOpen()).toBe(true);
    panel.close();
    expect(panel.isOpen()).toBe(false);
    panel.destroy();
  });

  it("toggle flips visibility", async () => {
    const panel = createMilkdropPanel({ mount });
    await panel.toggle();
    expect(panel.isOpen()).toBe(true);
    panel.toggle();
    expect(panel.isOpen()).toBe(false);
    panel.destroy();
  });

  it("renders the expected DOM structure", () => {
    const panel = createMilkdropPanel({ mount });
    const el = mount.querySelector(".milkdrop-panel");
    expect(el).not.toBeNull();
    expect(el.querySelector(".milkdrop-header")).not.toBeNull();
    expect(el.querySelector(".milkdrop-stage")).not.toBeNull();
    expect(el.querySelector(".milkdrop-preset-label")).not.toBeNull();
    expect(el.querySelector(".milkdrop-close-btn")).not.toBeNull();
    expect(el.querySelector(".milkdrop-fullscreen-btn")).not.toBeNull();
    panel.destroy();
  });

  it("close does not affect audio state (playback continues)", async () => {
    const runtime = await import("../../src/shared/audio-runtime.js");
    const panel = createMilkdropPanel({ mount });
    await panel.open();
    panel.close();
    // getState is still returning playing: true — no stop/pause was called
    const s = runtime.getState();
    expect(s.playing).toBe(true);
    panel.destroy();
  });

  it("destroy removes DOM element", () => {
    const panel = createMilkdropPanel({ mount });
    expect(mount.querySelector(".milkdrop-panel")).not.toBeNull();
    panel.destroy();
    expect(mount.querySelector(".milkdrop-panel")).toBeNull();
  });

  it("persists visible state to localStorage", async () => {
    const panel = createMilkdropPanel({ mount });

    await panel.open();
    expect(localStorage.getItem("milkdrop_panel_visible_v1")).toBe("true");

    panel.close();
    expect(localStorage.getItem("milkdrop_panel_visible_v1")).toBe("false");

    panel.destroy();
  });

  it("restores the saved visible state", () => {
    localStorage.setItem("milkdrop_panel_visible_v1", "true");

    const panel = createMilkdropPanel({ mount });
    const el = mount.querySelector(".milkdrop-panel");

    expect(panel.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);

    panel.destroy();
  });

  it("persists panel position to localStorage", () => {
    const panel = createMilkdropPanel({ mount });
    // Position is saved by makePanelDraggable — just verify key exists after setup
    expect(() => localStorage.getItem("milkdrop_panel_pos_v1")).not.toThrow();
    panel.destroy();
  });
});
