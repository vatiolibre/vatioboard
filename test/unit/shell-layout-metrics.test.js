import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyShellLayoutMetrics,
  getShellLayoutMetrics,
  getShellViewportProfile,
  isFocusedLandscapeProfile,
  observeShellLayoutMetrics,
} from "../../src/shared/shell-layout-metrics.js";

describe("shell layout metrics", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-vb-layout-profile");
  });

  it("classifies both Tesla viewports without consulting DPR", () => {
    expect(getShellViewportProfile(773, 601)).toBe("short-landscape");
    expect(getShellViewportProfile(804, 638)).toBe("short-landscape");
    expect(getShellViewportProfile(1256, 706)).toBe("wide-landscape");
    expect(getShellViewportProfile(1307, 747)).toBe("wide-landscape");
    expect(getShellViewportProfile(932, 430)).toBe("short-landscape");
    expect(getShellViewportProfile(430, 932)).toBe("portrait");
    expect(getShellViewportProfile(1280, 800)).toBe("standard");
    expect(isFocusedLandscapeProfile("short-landscape")).toBe(true);
    expect(isFocusedLandscapeProfile("wide-landscape")).toBe(true);
    expect(isFocusedLandscapeProfile("portrait")).toBe(false);
  });

  it("classifies from the usable work area", () => {
    const metrics = getShellLayoutMetrics({
      root: document,
      safeMargin: 0,
      viewport: { left: 0, top: 0, width: 1307, height: 747 },
    });
    expect(metrics.profile).toBe("wide-landscape");
  });

  it("publishes viewport and work-area CSS variables", () => {
    const metrics = getShellLayoutMetrics({
      root: document,
      safeMargin: 0,
      viewport: { left: 0, top: 0, width: 773, height: 601 },
    });
    applyShellLayoutMetrics(metrics, document);

    expect(metrics.profile).toBe("short-landscape");
    expect(metrics.devicePixelRatio).toBeGreaterThan(0);
    expect(document.documentElement.dataset.vbLayoutProfile).toBe("short-landscape");
    expect(document.documentElement.style.getPropertyValue("--vb-viewport-width")).toBe("773px");
    expect(document.documentElement.style.getPropertyValue("--vb-work-area-height")).toBe("601px");
    expect(document.documentElement.style.getPropertyValue("--vb-touch-target-min")).toBe("44px");
  });

  it("coalesces viewport events without animation frames or timers", async () => {
    const callback = vi.fn();
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    const setTimeout = vi.spyOn(window, "setTimeout");
    const viewport = { left: 0, top: 0, width: 773, height: 601 };
    const cleanup = observeShellLayoutMetrics(callback, {
      root: document,
      safeMargin: 0,
      viewport,
    });

    expect(callback).toHaveBeenCalledTimes(1);
    viewport.width = 774;
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("orientationchange"));
    window.dispatchEvent(new Event("resize"));
    expect(callback).toHaveBeenCalledTimes(1);

    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();

    cleanup();
    window.dispatchEvent(new Event("resize"));
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("suppresses a queued publication when observation stops", async () => {
    const callback = vi.fn();
    const cleanup = observeShellLayoutMetrics(callback, { root: document });

    window.dispatchEvent(new Event("resize"));
    cleanup();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
