import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadManager() {
  vi.resetModules();
  return import("../../src/shared/floating-layer-manager.js");
}

function makePanel() {
  const panel = document.createElement("section");
  document.body.appendChild(panel);
  return panel;
}

function zIndexOf(panel) {
  return Number.parseInt(panel.style.zIndex || "0", 10);
}

describe("floating-layer-manager", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("registerFloatingPanel returns cleanup", async () => {
    const { registerFloatingPanel } = await loadManager();
    const panel = makePanel();

    const cleanup = registerFloatingPanel(panel);

    expect(cleanup).toEqual(expect.any(Function));
    expect(panel.hasAttribute("data-vb-floating-panel")).toBe(true);

    cleanup();
    panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(panel.style.zIndex).toBe("");
  });

  it("pointerdown brings a panel above previously active panels", async () => {
    const { bringFloatingPanelToFront, registerFloatingPanel } = await loadManager();
    const first = makePanel();
    const second = makePanel();

    registerFloatingPanel(first);
    registerFloatingPanel(second);
    bringFloatingPanelToFront(first);

    second.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(zIndexOf(second)).toBeGreaterThan(zIndexOf(first));
    expect(second.getAttribute("data-vb-floating-active")).toBe("true");
    expect(first.getAttribute("data-vb-floating-active")).toBe("false");
  });

  it("focusin brings a panel above previously active panels", async () => {
    const { bringFloatingPanelToFront, registerFloatingPanel } = await loadManager();
    const first = makePanel();
    const second = makePanel();

    registerFloatingPanel(first);
    registerFloatingPanel(second);
    bringFloatingPanelToFront(first);

    second.dispatchEvent(new Event("focusin", { bubbles: true }));

    expect(zIndexOf(second)).toBeGreaterThan(zIndexOf(first));
  });

  it("z-index compaction never reaches the modal layer", async () => {
    const { bringFloatingPanelToFront, registerFloatingPanel } = await loadManager();
    const panels = Array.from({ length: 5 }, () => makePanel());
    panels.forEach((panel) => registerFloatingPanel(panel));

    for (let i = 0; i < 1200; i += 1) {
      bringFloatingPanelToFront(panels[i % panels.length]);
    }

    const maxZIndex = Math.max(...panels.map(zIndexOf));
    expect(maxZIndex).toBeLessThan(2000);
  });
});

