import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOCUSED_VIEW_CHANGE_EVENT,
  initFocusedWorkspaces,
} from "../../src/shared/focused-workspace.js";

describe("focused workspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows one panel on narrow portrait and restores all panels outside it", async () => {
    let portrait = true;
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("matchMedia", vi.fn((query) => ({
      matches: query.includes("portrait") ? portrait : !portrait,
    })));
    document.body.innerHTML = `
      <section data-vb-focused-workspace data-vb-focused-default="gauge">
        <div data-vb-focused-view-nav role="tablist">
          <button data-vb-focused-view-target="gauge" role="tab">Gauge</button>
          <button data-vb-focused-view-target="globe" role="tab">Globe</button>
        </div>
        <div data-vb-focused-view-panel="gauge">Gauge panel</div>
        <div data-vb-focused-view-panel="globe">Globe panel</div>
      </section>`;

    const workspace = document.querySelector("[data-vb-focused-workspace]");
    const gauge = document.querySelector('[data-vb-focused-view-panel="gauge"]');
    const globe = document.querySelector('[data-vb-focused-view-panel="globe"]');
    const globeButton = document.querySelector('[data-vb-focused-view-target="globe"]');
    const changes = vi.fn();
    workspace.addEventListener(FOCUSED_VIEW_CHANGE_EVENT, changes);

    const controller = initFocusedWorkspaces(document);
    expect(gauge.hidden).toBe(false);
    expect(globe.hidden).toBe(true);
    expect(globe.inert).toBe(true);

    globeButton.click();
    expect(gauge.hidden).toBe(true);
    expect(globe.hidden).toBe(false);
    expect(globeButton.getAttribute("aria-selected")).toBe("true");
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: { activeView: "globe", focused: true },
    }));

    portrait = false;
    window.dispatchEvent(new Event("resize"));
    await Promise.resolve();
    expect(gauge.hidden).toBe(false);
    expect(globe.hidden).toBe(false);

    controller.destroy();
  });

  it("returns to the default view with Escape", () => {
    vi.stubGlobal("innerWidth", 375);
    vi.stubGlobal("innerHeight", 667);
    vi.stubGlobal("matchMedia", vi.fn((query) => ({ matches: query.includes("portrait") })));
    document.body.innerHTML = `
      <section data-vb-focused-workspace data-vb-focused-default="primary">
        <button data-vb-focused-view-target="primary">Primary</button>
        <button data-vb-focused-view-target="details">Details</button>
        <div data-vb-focused-view-panel="primary"></div>
        <div data-vb-focused-view-panel="details"></div>
      </section>`;
    const controller = initFocusedWorkspaces(document);
    document.querySelector('[data-vb-focused-view-target="details"]').click();
    document.querySelector("[data-vb-focused-workspace]").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector('[data-vb-focused-view-panel="primary"]').hidden).toBe(false);
    expect(document.querySelector('[data-vb-focused-view-panel="details"]').hidden).toBe(true);
    controller.destroy();
  });
});
