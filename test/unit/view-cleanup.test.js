import { describe, expect, it, vi } from "vitest";

import { createCleanupStack } from "../../src/app/view-cleanup.js";

describe("createCleanupStack", () => {
  it("runs cleanup functions once in reverse order", () => {
    const cleanup = createCleanupStack();
    const calls = [];

    cleanup.add(() => calls.push("first"));
    cleanup.add(() => calls.push("second"));
    cleanup.run();
    cleanup.run();

    expect(calls).toEqual(["second", "first"]);
  });

  it("removes registered event listeners", () => {
    const cleanup = createCleanupStack();
    const handler = vi.fn();

    cleanup.addEventListener(window, "resize", handler);
    window.dispatchEvent(new Event("resize"));
    cleanup.run();
    window.dispatchEvent(new Event("resize"));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("clears timers, animation frames, and abort controllers", () => {
    vi.useFakeTimers();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 16);
    window.cancelAnimationFrame = (frameId) => window.clearTimeout(frameId);

    const cleanup = createCleanupStack();
    const timeoutCallback = vi.fn();
    const intervalCallback = vi.fn();
    const frameCallback = vi.fn();
    const controller = cleanup.abortController();

    cleanup.setTimeout(timeoutCallback, 10);
    cleanup.setInterval(intervalCallback, 10);
    cleanup.requestAnimationFrame(frameCallback);
    cleanup.run();
    vi.advanceTimersByTime(50);

    expect(timeoutCallback).not.toHaveBeenCalled();
    expect(intervalCallback).not.toHaveBeenCalled();
    expect(frameCallback).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(true);

    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });
});
