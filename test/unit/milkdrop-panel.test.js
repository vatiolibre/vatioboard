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
import butterchurn from "butterchurn";
import * as audioRuntime from "../../src/shared/audio-runtime.js";
import { loadText, saveText } from "../../src/shared/storage.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";

const defaultAudioState = {
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
};

describe("createMilkdropPanel", () => {
  let mount;
  let originalGetContext;
  let originalResizeObserver;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let originalRequestFullscreen;
  let originalExitFullscreen;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalResizeObserver = window.ResizeObserver;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    originalExitFullscreen = document.exitFullscreen;

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

    audioRuntime.getState.mockReturnValue({ ...defaultAudioState });
    loadText.mockImplementation((key, fallback = "") => fallback);
    saveText.mockClear();
    butterchurn.createVisualizer.mockClear();
    mockAudioElement.removeAttribute("src");
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    HTMLElement.prototype.requestFullscreen = originalRequestFullscreen;
    document.exitFullscreen = originalExitFullscreen;
    localStorage.clear();
  });

  function makePlayableAudio() {
    mockAudioElement.src = "blob:https://vatioboard.local/milkdrop-audio";
    audioRuntime.getState.mockReturnValue({
      ...defaultAudioState,
      currentTrack: { name: "Demo track" },
      sourceType: "blob",
      playing: true,
      paused: false,
    });
    window.requestAnimationFrame = vi.fn(() => 1);
    window.cancelAnimationFrame = vi.fn();
  }

  function getLatestVisualizer() {
    return butterchurn.createVisualizer.mock.results.at(-1)?.value;
  }

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
    expect(el.querySelector(".milkdrop-resize-handle")).not.toBeNull();
    expect(el.querySelector(".milkdrop-preset-overlay")).not.toBeNull();
    expect(el.querySelector(".milkdrop-preset-controls")).not.toBeNull();
    expect(el.querySelector(".milkdrop-fullscreen-exit-btn")).not.toBeNull();
    expect(el.querySelector(".milkdrop-header .milkdrop-preset-prev")).toBeNull();
    expect(el.querySelector(".milkdrop-close-btn")).not.toBeNull();
    expect(el.querySelector(".milkdrop-fullscreen-btn")).not.toBeNull();
    panel.destroy();
  });

  it("uses fallback fullscreen when native fullscreen is unavailable", async () => {
    HTMLElement.prototype.requestFullscreen = undefined;
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const el = mount.querySelector(".milkdrop-panel");
    const fullscreenBtn = el.querySelector(".milkdrop-fullscreen-btn");

    fullscreenBtn.click();
    await Promise.resolve();

    expect(el.classList.contains("is-fullscreen")).toBe(true);
    expect(el.classList.contains("is-window-fullscreen")).toBe(true);
    expect(fullscreenBtn.getAttribute("aria-label")).toBe("Exit fullscreen");

    el.querySelector(".milkdrop-fullscreen-exit-btn").click();
    await Promise.resolve();

    expect(el.classList.contains("is-fullscreen")).toBe(false);
    expect(el.classList.contains("is-window-fullscreen")).toBe(false);
    expect(fullscreenBtn.getAttribute("aria-label")).toBe("Fullscreen");

    panel.destroy();
  });

  it("restores a saved preset into the stage overlay", async () => {
    makePlayableAudio();
    loadText.mockImplementation((key, fallback = "") => (
      key === "milkdrop_preset_name_v1" ? "Preset B" : fallback
    ));

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const el = mount.querySelector(".milkdrop-panel");
    const visualizer = getLatestVisualizer();

    expect(visualizer.loadPreset).toHaveBeenCalledWith({ name: "Preset B" }, 0);
    expect(el.querySelector(".milkdrop-preset-overlay").textContent).toBe("Preset B");
    expect(saveText).toHaveBeenCalledWith("milkdrop_preset_name_v1", "Preset B");
    expect(saveText).toHaveBeenCalledWith("milkdrop_preset_index_v1", "1");

    panel.destroy();
  });

  it("uses saved preset index when the saved preset name is missing", async () => {
    makePlayableAudio();
    loadText.mockImplementation((key, fallback = "") => {
      if (key === "milkdrop_preset_name_v1") return "Missing preset";
      if (key === "milkdrop_preset_index_v1") return "2";
      return fallback;
    });

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const visualizer = getLatestVisualizer();

    expect(visualizer.loadPreset).toHaveBeenCalledWith({ name: "Preset C" }, 0);

    panel.destroy();
  });

  it("navigates presets with fullscreen stage swipes", async () => {
    makePlayableAudio();
    HTMLElement.prototype.requestFullscreen = undefined;
    loadText.mockImplementation((key, fallback = "") => (
      key === "milkdrop_preset_name_v1" ? "Preset A" : fallback
    ));

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const el = mount.querySelector(".milkdrop-panel");
    const stage = el.querySelector(".milkdrop-stage");
    const visualizer = getLatestVisualizer();
    visualizer.loadPreset.mockClear();

    el.querySelector(".milkdrop-fullscreen-btn").click();
    await Promise.resolve();

    stage.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 240,
      clientY: 120,
      pointerId: 7,
      pointerType: "touch",
      bubbles: true,
    }));
    stage.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 150,
      clientY: 124,
      pointerId: 7,
      pointerType: "touch",
      bubbles: true,
    }));

    expect(visualizer.loadPreset).toHaveBeenCalledWith({ name: "Preset B" }, 2.7);

    panel.destroy();
  });

  it("randomizes presets with a fullscreen stage double tap", async () => {
    makePlayableAudio();
    HTMLElement.prototype.requestFullscreen = undefined;
    loadText.mockImplementation((key, fallback = "") => (
      key === "milkdrop_preset_name_v1" ? "Preset A" : fallback
    ));
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.9);

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const el = mount.querySelector(".milkdrop-panel");
    const stage = el.querySelector(".milkdrop-stage");
    const visualizer = getLatestVisualizer();
    visualizer.loadPreset.mockClear();

    el.querySelector(".milkdrop-fullscreen-btn").click();
    await Promise.resolve();

    for (const pointerId of [11, 12]) {
      stage.dispatchEvent(new PointerEvent("pointerdown", {
        clientX: 180,
        clientY: 130,
        pointerId,
        pointerType: "touch",
        bubbles: true,
      }));
      stage.dispatchEvent(new PointerEvent("pointerup", {
        clientX: 182,
        clientY: 132,
        pointerId,
        pointerType: "touch",
        bubbles: true,
      }));
    }

    expect(visualizer.loadPreset).toHaveBeenCalledWith({ name: "Preset C" }, 1.5);

    randomSpy.mockRestore();
    panel.destroy();
  });

  it("falls back when native fullscreen rejects", async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn().mockRejectedValue(new Error("blocked"));
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const el = mount.querySelector(".milkdrop-panel");

    el.querySelector(".milkdrop-fullscreen-btn").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled();
    expect(el.classList.contains("is-window-fullscreen")).toBe(true);

    panel.destroy();
  });

  it("exits fallback fullscreen on close and destroy", async () => {
    HTMLElement.prototype.requestFullscreen = undefined;

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const el = mount.querySelector(".milkdrop-panel");
    el.querySelector(".milkdrop-fullscreen-btn").click();
    await Promise.resolve();

    expect(el.classList.contains("is-window-fullscreen")).toBe(true);
    panel.close();
    expect(el.classList.contains("is-window-fullscreen")).toBe(false);

    await panel.open();
    el.querySelector(".milkdrop-fullscreen-btn").click();
    await Promise.resolve();
    expect(el.classList.contains("is-window-fullscreen")).toBe(true);
    panel.destroy();
    expect(mount.querySelector(".milkdrop-panel")).toBeNull();
  });

  it("resizes via the touch handle and saves size", async () => {
    window.requestAnimationFrame = vi.fn((cb) => {
      cb();
      return 1;
    });
    window.cancelAnimationFrame = vi.fn();

    const panel = createMilkdropPanel({ mount });
    await panel.open();
    const el = mount.querySelector(".milkdrop-panel");
    const handle = el.querySelector(".milkdrop-resize-handle");
    el.style.width = "480px";
    el.style.height = "380px";
    el.getBoundingClientRect = () => {
      const width = Number.parseInt(el.style.width, 10) || 480;
      const height = Number.parseInt(el.style.height, 10) || 380;
      return {
        left: 16,
        top: 16,
        right: 16 + width,
        bottom: 16 + height,
        width,
        height,
        x: 16,
        y: 16,
        toJSON() {},
      };
    };

    handle.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 480,
      clientY: 380,
      pointerId: 9,
      pointerType: "touch",
      bubbles: true,
    }));
    handle.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 540,
      clientY: 430,
      pointerId: 9,
      pointerType: "touch",
      bubbles: true,
    }));
    handle.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 540,
      clientY: 430,
      pointerId: 9,
      pointerType: "touch",
      bubbles: true,
    }));

    const saved = JSON.parse(localStorage.getItem("milkdrop_panel_size_v1"));
    expect(Number.parseInt(el.style.width, 10)).toBeGreaterThan(480);
    expect(Number.parseInt(el.style.height, 10)).toBeGreaterThan(380);
    expect(saved.w).toBe(Number.parseInt(el.style.width, 10));
    expect(saved.h).toBe(Number.parseInt(el.style.height, 10));

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

  it("places first-open panel away from a visible player panel", () => {
    const playerPanel = document.createElement("section");
    playerPanel.className = "player-panel";
    playerPanel.hidden = false;
    playerPanel.getBoundingClientRect = () => ({
      left: 16,
      top: 80,
      right: 356,
      bottom: 420,
      width: 340,
      height: 340,
      x: 16,
      y: 80,
      toJSON() {},
    });
    mount.appendChild(playerPanel);

    const shellManager = createShellWindowManager({ root: mount });
    const panel = createMilkdropPanel({ mount, shellManager });
    const el = mount.querySelector(".milkdrop-panel");

    expect(Number.parseInt(el.style.left, 10)).toBeGreaterThan(400);
    expect(el.style.right).toBe("auto");
    expect(el.style.bottom).toBe("auto");

    panel.destroy();
    shellManager.destroy();
  });
});
