import { describe, expect, it } from "vitest";
import {
  applySnapPreview,
  clearSnapPreview,
  clampBoundsToViewport,
  getBoundsForSnapZone,
  getSnapZoneForPointer,
} from "../../src/shared/shell-snap.js";

describe("shell-snap", () => {
  it("detects left/right/top/bottom snap zones", () => {
    expect(getSnapZoneForPointer({ x: 4, y: 300, viewportWidth: 800, viewportHeight: 600 })).toBe("left");
    expect(getSnapZoneForPointer({ x: 796, y: 300, viewportWidth: 800, viewportHeight: 600 })).toBe("right");
    expect(getSnapZoneForPointer({ x: 400, y: 4, viewportWidth: 800, viewportHeight: 600 })).toBe("top");
    expect(getSnapZoneForPointer({ x: 400, y: 596, viewportWidth: 800, viewportHeight: 600 })).toBe("bottom");
  });

  it("detects corner snap zones", () => {
    expect(getSnapZoneForPointer({ x: 3, y: 3, viewportWidth: 800, viewportHeight: 600 })).toBe("top-left");
    expect(getSnapZoneForPointer({ x: 797, y: 3, viewportWidth: 800, viewportHeight: 600 })).toBe("top-right");
    expect(getSnapZoneForPointer({ x: 3, y: 597, viewportWidth: 800, viewportHeight: 600 })).toBe("bottom-left");
    expect(getSnapZoneForPointer({ x: 797, y: 597, viewportWidth: 800, viewportHeight: 600 })).toBe("bottom-right");
  });

  it("uses center fallback away from edges", () => {
    expect(getSnapZoneForPointer({ x: 300, y: 260, viewportWidth: 800, viewportHeight: 600 })).toBe("center");
  });

  it("prefers non-tiny behavior on small viewports", () => {
    const bounds = getBoundsForSnapZone("top-left", { width: 360, height: 320 }, { safeMargin: 12 });

    expect(bounds.width).toBeGreaterThan(250);
    expect(bounds.height).toBeGreaterThan(200);
  });

  it("clamps bounds to the viewport", () => {
    expect(clampBoundsToViewport(
      { left: -50, top: 900, width: 500, height: 500 },
      { width: 800, height: 600 },
      { safeMargin: 16 },
    )).toEqual({
      left: 16,
      top: 84,
      width: 500,
      height: 500,
    });
  });

  it("snap bounds are deterministic", () => {
    const viewport = { width: 1000, height: 700 };
    const first = getBoundsForSnapZone("right", viewport);
    const second = getBoundsForSnapZone("right", viewport);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ left: 500, top: 16, width: 484, height: 668 });
  });

  it("sets and clears snap preview attributes", () => {
    const panel = document.createElement("section");
    applySnapPreview(panel, "left");
    expect(panel.getAttribute("data-vb-shell-snap-preview")).toBe("left");
    clearSnapPreview(panel);
    expect(panel.hasAttribute("data-vb-shell-snap-preview")).toBe(false);
  });
});

