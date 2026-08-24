import { beforeEach, describe, expect, it } from "vitest";
import {
  applyShellLayoutMetrics,
  getShellLayoutMetrics,
  getShellViewportProfile,
} from "../../src/shared/shell-layout-metrics.js";

describe("shell layout metrics", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-vb-layout-profile");
  });

  it("classifies both Tesla viewports without consulting DPR", () => {
    expect(getShellViewportProfile(773, 601)).toBe("short-landscape");
    expect(getShellViewportProfile(804, 638)).toBe("short-landscape");
    expect(getShellViewportProfile(430, 932)).toBe("portrait");
    expect(getShellViewportProfile(1280, 800)).toBe("standard");
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
});
