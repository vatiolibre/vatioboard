import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupRouteAppTestDom,
  createRouteMountContext,
  createRouteTestRoot,
  loadRouteAppModules,
  resetRouteAppTestDom,
} from "../helpers/route-app-test-utils.js";

function installFullscreenMock() {
  let fullscreenElement = null;
  const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
  const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "exitFullscreen");

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });

  HTMLElement.prototype.requestFullscreen = vi.fn(function requestFullscreen() {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });

  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    }),
  });

  return () => {
    if (fullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", fullscreenDescriptor);
    } else {
      delete document.fullscreenElement;
    }

    if (originalRequestFullscreen) {
      HTMLElement.prototype.requestFullscreen = originalRequestFullscreen;
    } else {
      delete HTMLElement.prototype.requestFullscreen;
    }

    if (exitFullscreenDescriptor) {
      Object.defineProperty(document, "exitFullscreen", exitFullscreenDescriptor);
    } else {
      delete document.exitFullscreen;
    }
  };
}

describe("Code Rain app", () => {
  beforeEach(() => {
    resetRouteAppTestDom();
    window.location.hash = "#/code-rain?version=operator&effect=image&camera=true&url=https://example.com/nope.jpg&fallSpeed=0.8";
  });

  afterEach(() => {
    cleanupRouteAppTestDom();
  });

  it("mounts the isolated renderer iframe with sanitized visualizer params", async () => {
    const modules = await loadRouteAppModules("../../src/apps/code-rain/index.js");
    const manifest = modules.appRegistry.getApp("vatio.codeRain");
    const runtime = modules.createAppRuntime({ manifest, baseContext: {} });
    const root = createRouteTestRoot();

    expect(manifest.icon).toContain("#00ff41");
    expect(manifest.icon).toContain("<text");

    const mounted = await modules.mount(root, createRouteMountContext({
      runtime,
      manifest,
      path: "/code-rain",
      hash: window.location.hash,
    }));

    const frame = root.querySelector("[data-code-rain-frame]");
    const src = new URL(frame.getAttribute("src"), window.location.origin);

    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(frame.getAttribute("allow")).not.toContain("camera");
    expect(src.pathname).toBe("/vendor/rezmason-matrix/index.html");
    expect(src.searchParams.get("version")).toBe("operator");
    expect(src.searchParams.get("effect")).toBe("palette");
    expect(src.searchParams.get("fallSpeed")).toBe("0.80");
    expect(src.searchParams.has("camera")).toBe(false);
    expect(src.searchParams.has("url")).toBe(false);
    expect(root.querySelector("select")).toBeNull();
    expect(runtime.storage.getJson("state.v1", null)).toMatchObject({
      version: "operator",
      effect: "palette",
      fallSpeed: "0.80",
    });

    mounted.unmount();
    expect(frame.getAttribute("src")).toBe("about:blank");
  });

  it("lets users tune and share a local preset URL", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const modules = await loadRouteAppModules("../../src/apps/code-rain/index.js");
    const manifest = modules.appRegistry.getApp("vatio.codeRain");
    const runtime = modules.createAppRuntime({ manifest, baseContext: {} });
    const root = createRouteTestRoot();
    await modules.mount(root, createRouteMountContext({
      runtime,
      manifest,
      path: "/code-rain",
      hash: "#/code-rain",
    }));

    const initialSrc = new URL(root.querySelector("[data-code-rain-frame]").getAttribute("src"), window.location.origin);
    expect(initialSrc.searchParams.get("version")).toBe("3d");
    expect(initialSrc.searchParams.get("volumetric")).toBe("true");
    expect(root.querySelector("[data-code-rain-status]").textContent).toBe("Classic 3D · Palette");

    const app = root.querySelector("[data-code-rain-app]");
    const settingsButton = root.querySelector('[data-code-rain-action="settings"]');

    settingsButton.click();
    expect(app.classList.contains("code-rain-app--settings-open")).toBe(true);

    settingsButton.click();
    expect(app.classList.contains("code-rain-app--settings-open")).toBe(false);

    settingsButton.click();
    expect(app.classList.contains("code-rain-app--settings-open")).toBe(true);

    const outsideTouch = typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true })
      : new Event("pointerdown", { bubbles: true });
    document.body.dispatchEvent(outsideTouch);
    expect(app.classList.contains("code-rain-app--settings-open")).toBe(false);

    settingsButton.click();
    expect(app.classList.contains("code-rain-app--settings-open")).toBe(true);

    root.querySelector('[data-code-rain-choice="effect"][data-code-rain-value="mirror"]').click();
    const speed = root.querySelector('[data-code-rain-field="fallSpeed"]');
    speed.value = "1.25";
    speed.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector('[data-code-rain-action="share"]').click();

    expect(runtime.storage.getJson("state.v1", null)).toMatchObject({
      effect: "mirror",
      fallSpeed: "1.25",
      version: "3d",
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#/code-rain?"));
    expect(writeText.mock.calls[0][0]).toContain("fallSpeed=1.25");
    expect(writeText.mock.calls[0][0]).toContain("effect=mirror");
  });

  it("collapses the toolbar to the exit fullscreen action while fullscreen", async () => {
    const restoreFullscreen = installFullscreenMock();

    try {
      const modules = await loadRouteAppModules("../../src/apps/code-rain/index.js");
      const manifest = modules.appRegistry.getApp("vatio.codeRain");
      const runtime = modules.createAppRuntime({ manifest, baseContext: {} });
      const root = createRouteTestRoot();
      await modules.mount(root, createRouteMountContext({
        runtime,
        manifest,
        path: "/code-rain",
        hash: "#/code-rain",
      }));

      const app = root.querySelector("[data-code-rain-app]");
      const settingsButton = root.querySelector('[data-code-rain-action="settings"]');
      const fullscreenButton = root.querySelector('[data-code-rain-action="fullscreen"]');

      expect(root.querySelector(".code-rain-toolbar__title")).toBeNull();

      settingsButton.click();
      expect(app.classList.contains("code-rain-app--settings-open")).toBe(true);

      fullscreenButton.click();
      await Promise.resolve();

      expect(app.classList.contains("code-rain-app--settings-open")).toBe(false);
      expect(app.classList.contains("code-rain-app--fullscreen")).toBe(true);
      expect(fullscreenButton.getAttribute("aria-label")).toBe("Exit fullscreen");

      fullscreenButton.click();
      await Promise.resolve();

      expect(app.classList.contains("code-rain-app--fullscreen")).toBe(false);
      expect(fullscreenButton.getAttribute("aria-label")).toBe("Fullscreen");
    } finally {
      restoreFullscreen();
    }
  });
});
