import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRouteView } from "../../src/app/views/route-view.js";

describe("createRouteView", () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="description" content="Original description">';
    document.title = "VatioBoard";
    document.body.className = "";
    document.body.innerHTML = '<main id="root"></main>';
    window.history.replaceState({}, "", "https://vatioboard.com/");
  });

  it("mounts route DOM, applies metadata, and cleans up idempotently", async () => {
    const root = document.getElementById("root");
    const controller = {
      mountRoute: vi.fn(),
      unmountRoute: vi.fn(),
    };
    const view = createRouteView({
      pageName: "test",
      template: '<section id="route-panel">Route panel</section>',
      meta: {
        title: "Route Title",
        description: "Route description",
        canonicalPath: "/route",
        bodyClass: "route-page",
        cleanupBodyClasses: ["route-sheet-open"],
      },
      loadModule: () => Promise.resolve(controller),
      mountController: (module) => module.mountRoute(),
      unmountController: (module) => module.unmountRoute(),
    });

    const mounted = await view.mount(root, { route: { path: "/route" } });
    document.body.classList.add("route-sheet-open");

    expect(root.querySelector("#route-panel")?.textContent).toBe("Route panel");
    expect(document.title).toBe("Route Title");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Route description",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://vatioboard.com/route",
    );
    expect(document.body.classList.contains("route-page")).toBe(true);
    expect(controller.mountRoute).toHaveBeenCalledTimes(1);

    mounted.unmount();
    mounted.unmount();

    expect(root.children).toHaveLength(0);
    expect(document.body.classList.contains("route-page")).toBe(false);
    expect(document.body.classList.contains("route-sheet-open")).toBe(false);
    expect(document.title).toBe("VatioBoard");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Original description",
    );
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(controller.unmountRoute).toHaveBeenCalledTimes(1);
  });

  it("reuses route DOM and controller imports across remounts", async () => {
    const root = document.getElementById("root");
    const controller = {
      mountRoute: vi.fn(),
      unmountRoute: vi.fn(),
    };
    const loadModule = vi.fn(() => Promise.resolve(controller));
    const view = createRouteView({
      pageName: "test",
      template: '<button id="stable-button" type="button">Stable</button>',
      meta: { bodyClass: "stable-page" },
      loadModule,
      mountController: (module) => module.mountRoute(),
      unmountController: (module) => module.unmountRoute(),
    });

    const firstMount = await view.mount(root, {});
    const firstButton = root.querySelector("#stable-button");
    firstMount.unmount();

    const secondMount = await view.mount(root, {});

    expect(root.querySelector("#stable-button")).toBe(firstButton);
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(controller.mountRoute).toHaveBeenCalledTimes(2);

    secondMount.unmount();
  });
});
