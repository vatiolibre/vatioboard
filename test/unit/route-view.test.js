import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRouteView } from "../../src/app/views/route-view.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

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

  it("clones fresh route DOM across remounts while reusing controller imports", async () => {
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
    firstButton.dataset.mutated = "true";
    firstButton.textContent = "Mutated";
    firstMount.unmount();

    const secondMount = await view.mount(root, {});
    const secondButton = root.querySelector("#stable-button");

    expect(secondButton).not.toBe(firstButton);
    expect(secondButton.dataset.mutated).toBeUndefined();
    expect(secondButton.textContent).toBe("Stable");
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(controller.mountRoute).toHaveBeenCalledTimes(2);

    secondMount.unmount();
  });

  it("can preserve stateful route DOM across remounts for singleton controllers", async () => {
    const root = document.getElementById("root");
    const controller = {
      mountRoute: vi.fn(),
      unmountRoute: vi.fn(),
    };
    const loadModule = vi.fn(() => Promise.resolve(controller));
    const view = createRouteView({
      pageName: "stateful",
      template: '<button id="stable-button" type="button">Stable</button>',
      meta: { bodyClass: "stateful-page" },
      loadModule,
      mountController: (module) => module.mountRoute(),
      unmountController: (module) => module.unmountRoute(),
      preserveDom: true,
    });

    const firstMount = await view.mount(root, {});
    const firstButton = root.querySelector("#stable-button");
    firstButton.dataset.bound = "true";
    firstButton.textContent = "Still wired";
    firstMount.unmount();

    expect(root.children).toHaveLength(0);
    expect(document.body.classList.contains("stateful-page")).toBe(false);

    const secondMount = await view.mount(root, {});
    const secondButton = root.querySelector("#stable-button");

    expect(secondButton).toBe(firstButton);
    expect(secondButton.dataset.bound).toBe("true");
    expect(secondButton.textContent).toBe("Still wired");
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(controller.mountRoute).toHaveBeenCalledTimes(2);
    expect(controller.unmountRoute).toHaveBeenCalledTimes(1);

    secondMount.unmount();
  });

  it("skips controller mount and clears inserted DOM when a route is aborted during import", async () => {
    const root = document.getElementById("root");
    const controller = {
      mountRoute: vi.fn(),
      unmountRoute: vi.fn(),
    };
    const loadModule = createDeferred();
    const routeController = new AbortController();
    const view = createRouteView({
      pageName: "slow",
      template: '<section id="slow-route">Slow route</section>',
      meta: { bodyClass: "slow-page" },
      loadModule: () => loadModule.promise,
      mountController: (module) => module.mountRoute(),
      unmountController: (module) => module.unmountRoute(),
    });

    const mountedPromise = view.mount(root, { routeSignal: routeController.signal });
    expect(root.querySelector("#slow-route")).toBeTruthy();
    expect(document.body.classList.contains("slow-page")).toBe(true);

    routeController.abort();
    loadModule.resolve(controller);
    const mounted = await mountedPromise;

    expect(controller.mountRoute).not.toHaveBeenCalled();
    expect(controller.unmountRoute).not.toHaveBeenCalled();
    expect(root.children).toHaveLength(0);
    expect(document.body.classList.contains("slow-page")).toBe(false);

    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("does not let stale async cleanup remove a newer route's DOM", async () => {
    const root = document.getElementById("root");
    const controller = {
      mountRoute: vi.fn(),
      unmountRoute: vi.fn(),
    };
    const loadModule = createDeferred();
    const routeController = new AbortController();
    const view = createRouteView({
      pageName: "slow",
      template: '<section id="slow-route">Slow route</section>',
      meta: { bodyClass: "slow-page" },
      loadModule: () => loadModule.promise,
      mountController: (module) => module.mountRoute(),
      unmountController: (module) => module.unmountRoute(),
    });

    const mountedPromise = view.mount(root, { routeSignal: routeController.signal });
    expect(root.querySelector("#slow-route")).toBeTruthy();

    const nextRoute = document.createElement("section");
    nextRoute.id = "next-route";
    nextRoute.textContent = "Next route";
    root.replaceChildren(nextRoute);

    routeController.abort();
    loadModule.resolve(controller);
    await mountedPromise;

    expect(root.querySelector("#next-route")?.textContent).toBe("Next route");
    expect(controller.mountRoute).not.toHaveBeenCalled();
    expect(controller.unmountRoute).not.toHaveBeenCalled();
  });

  it("runs controller result unmount and configured unmount once", async () => {
    const root = document.getElementById("root");
    const resultUnmount = vi.fn();
    const controller = {
      mountRoute: vi.fn(() => ({ unmount: resultUnmount })),
      unmountRoute: vi.fn(),
    };
    const view = createRouteView({
      pageName: "test",
      template: '<section id="route-panel">Route panel</section>',
      loadModule: () => Promise.resolve(controller),
      mountController: (module) => module.mountRoute(),
      unmountController: (module) => module.unmountRoute(),
    });

    const mounted = await view.mount(root, {});
    mounted.unmount();
    mounted.unmount();

    expect(resultUnmount).toHaveBeenCalledTimes(1);
    expect(controller.unmountRoute).toHaveBeenCalledTimes(1);
  });

  it("passes route context fields to mount and unmount controllers", async () => {
    const root = document.getElementById("root");
    const routeSignal = new AbortController().signal;
    const controller = {
      mountRoute: vi.fn(),
      unmountRoute: vi.fn(),
    };
    const view = createRouteView({
      pageName: "context-route",
      template: '<section id="route-panel">Route panel</section>',
      loadModule: () => Promise.resolve(controller),
      mountController: (module, routeContext) => module.mountRoute(routeContext),
      unmountController: (module, routeContext) => module.unmountRoute(routeContext),
    });

    const mounted = await view.mount(root, {
      routeSignal,
      route: { path: "/context" },
    });
    mounted.unmount();

    expect(controller.mountRoute).toHaveBeenCalledWith(expect.objectContaining({
      root,
      signal: routeSignal,
      pageName: "context-route",
      context: expect.objectContaining({
        route: { path: "/context" },
        routeSignal,
      }),
    }));
    expect(controller.mountRoute.mock.calls[0][0].cleanup).toEqual(expect.objectContaining({
      add: expect.any(Function),
      addEventListener: expect.any(Function),
      run: expect.any(Function),
    }));
    expect(controller.unmountRoute.mock.calls[0][0]).toBe(controller.mountRoute.mock.calls[0][0]);
  });

  it("cleans route DOM and metadata when controller mount fails", async () => {
    const root = document.getElementById("root");
    const controller = {
      unmountRoute: vi.fn(),
    };
    const view = createRouteView({
      pageName: "broken",
      template: '<section id="broken-route">Broken route</section>',
      meta: {
        title: "Broken Route",
        bodyClass: "broken-page",
        cleanupBodyClasses: ["broken-sheet-open"],
      },
      loadModule: () => Promise.resolve(controller),
      mountController: () => {
        document.body.classList.add("broken-sheet-open");
        throw new Error("mount failed");
      },
      unmountController: (module) => module.unmountRoute(),
    });

    await expect(view.mount(root, {})).rejects.toThrow("mount failed");

    expect(root.children).toHaveLength(0);
    expect(document.title).toBe("VatioBoard");
    expect(document.body.classList.contains("broken-page")).toBe(false);
    expect(document.body.classList.contains("broken-sheet-open")).toBe(false);
    expect(controller.unmountRoute).toHaveBeenCalledTimes(1);
  });
});
