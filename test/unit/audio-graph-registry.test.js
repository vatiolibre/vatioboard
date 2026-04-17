import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireGraph,
  releaseGraph,
  getGraph,
  destroyGraphForElement,
} from "../../src/shared/audio-graph-registry.js";

describe("audio-graph-registry", () => {
  let originalAudioContext;
  let fakeSourceNode;
  let fakeAudioContext;
  let mediaElement;

  beforeEach(() => {
    originalAudioContext = window.AudioContext;

    fakeSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    fakeAudioContext = {
      state: "running",
      destination: {},
      resume: vi.fn(async () => "running"),
      close: vi.fn(async () => undefined),
      createMediaElementSource: vi.fn(() => fakeSourceNode),
    };

    window.AudioContext = vi.fn(function MockAudioContext() {
      return fakeAudioContext;
    });

    mediaElement = document.createElement("audio");
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    // Force cleanup
    destroyGraphForElement(mediaElement);
  });

  describe("acquireGraph", () => {
    it("creates a new graph for a media element", async () => {
      const entry = await acquireGraph(mediaElement);
      expect(entry).not.toBeNull();
      expect(entry.audioContext).toBe(fakeAudioContext);
      expect(entry.sourceNode).toBe(fakeSourceNode);
      expect(entry.refCount).toBe(1);
      expect(fakeSourceNode.connect).toHaveBeenCalledWith(fakeAudioContext.destination);
    });

    it("returns null when AudioContext is unavailable", async () => {
      window.AudioContext = undefined;
      window.webkitAudioContext = undefined;
      const entry = await acquireGraph(mediaElement);
      expect(entry).toBeNull();
    });

    it("returns null when AudioContext cannot reach running state", async () => {
      fakeAudioContext.state = "suspended";
      fakeAudioContext.resume = vi.fn(async () => {});
      // state stays "suspended"
      const entry = await acquireGraph(mediaElement);
      expect(entry).toBeNull();
    });

    it("increments refCount on subsequent calls for same element", async () => {
      const entry1 = await acquireGraph(mediaElement);
      const entry2 = await acquireGraph(mediaElement);
      expect(entry1).toBe(entry2);
      expect(entry2.refCount).toBe(2);
      // Should NOT have created a second source
      expect(fakeAudioContext.createMediaElementSource).toHaveBeenCalledTimes(1);
    });

    it("returns null when createMediaElementSource throws", async () => {
      fakeAudioContext.createMediaElementSource = vi.fn(() => {
        throw new Error("CORS tainted");
      });
      const entry = await acquireGraph(mediaElement);
      expect(entry).toBeNull();
    });
  });

  describe("getGraph", () => {
    it("returns null for unknown elements", () => {
      expect(getGraph(mediaElement)).toBeNull();
    });

    it("returns the graph after acquire", async () => {
      await acquireGraph(mediaElement);
      expect(getGraph(mediaElement)).not.toBeNull();
    });
  });

  describe("releaseGraph", () => {
    it("decrements refCount without destroying when refs remain", async () => {
      await acquireGraph(mediaElement);
      await acquireGraph(mediaElement); // refCount = 2
      releaseGraph(mediaElement);
      expect(getGraph(mediaElement)).not.toBeNull();
      expect(getGraph(mediaElement).refCount).toBe(1);
    });

    it("tears down graph when last ref is released", async () => {
      await acquireGraph(mediaElement);
      releaseGraph(mediaElement);
      expect(getGraph(mediaElement)).toBeNull();
      expect(fakeAudioContext.close).toHaveBeenCalled();
      expect(fakeSourceNode.disconnect).toHaveBeenCalled();
    });

    it("disconnects consumer node when provided", async () => {
      const entry = await acquireGraph(mediaElement);
      const fakeConsumer = { disconnect: vi.fn() };
      entry.consumers.add(fakeConsumer);
      releaseGraph(mediaElement, fakeConsumer);
      expect(fakeConsumer.disconnect).toHaveBeenCalled();
    });

    it("is safe to call on unknown elements", () => {
      expect(() => releaseGraph(mediaElement)).not.toThrow();
    });
  });

  describe("destroyGraphForElement", () => {
    it("returns false for unknown elements", () => {
      expect(destroyGraphForElement(mediaElement)).toBe(false);
    });

    it("force-destroys regardless of refCount", async () => {
      await acquireGraph(mediaElement);
      await acquireGraph(mediaElement); // refCount = 2
      const result = destroyGraphForElement(mediaElement);
      expect(result).toBe(true);
      expect(getGraph(mediaElement)).toBeNull();
      expect(fakeAudioContext.close).toHaveBeenCalled();
    });
  });
});
