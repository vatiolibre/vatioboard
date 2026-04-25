import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

const routeState = vi.hoisted(() => ({
  mounted: [],
  unmounted: [],
  createPlayerWidget: vi.fn(() => ({
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    restoreVisibility: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("../../src/app/routes.js", () => ({
  routes: ["/", "/library", "/accel"].map((path) => {
    const name = path === "/" ? "speed" : path.slice(1);
    return {
      path,
      aliases: path === "/" ? ["/speed"] : [],
      load: () => Promise.resolve({
        mount(root) {
          routeState.mounted.push(name);
          const view = document.createElement("section");
          view.dataset.mockView = name;
          view.textContent = name;
          root.replaceChildren(view);
          return {
            unmount() {
              routeState.unmounted.push(name);
              root.replaceChildren();
            },
          };
        },
      }),
    };
  }),
}));

vi.mock("../../src/player/player-widget.js", () => ({
  createPlayerWidget: routeState.createPlayerWidget,
}));

vi.mock("../../src/shared/backend-auth.js", () => ({
  initBackendAuthControllers: vi.fn(),
}));

vi.mock("../../src/shared/cloud-sync.js", () => ({
  startCloudSyncLoop: vi.fn(),
}));

vi.mock("../../src/shared/single-tab.js", () => ({
  ensureSingleTabOwnership: vi.fn(() => Promise.resolve(true)),
}));

async function bootSpa() {
  await bootHtmlPage("index.html");
  await import("../../src/app/main.js");
  for (let index = 0; index < 8; index += 1) {
    await flushTasks();
  }
}

describe("index.html SPA shell", () => {
  beforeEach(() => {
    vi.resetModules();
    routeState.mounted = [];
    routeState.unmounted = [];
    routeState.createPlayerWidget.mockClear();
    localStorage.clear();
  });

  it("boots the hash-routed app with Speed as the default route", async () => {
    await bootSpa();

    expectPageSeo({
      title: "VatioBoard",
      canonical: "https://vatioboard.com/",
    });
    expect(window.location.hash).toBe("#/");
    expect(document.getElementById("app-view")).toBeTruthy();
    expect(document.getElementById("app-persistent-layer")).toBeTruthy();
    expect(document.querySelector("[data-mock-view='speed']")).toBeTruthy();
    expect(routeState.createPlayerWidget).toHaveBeenCalledWith(
      expect.objectContaining({
        floating: true,
        preload: "immediate",
        persistVisibility: true,
        restoreVisibility: true,
      }),
    );
  });

  it("switches hash routes without reloading the document", async () => {
    await bootSpa();
    const originalBody = document.body;

    window.location.hash = "#/library?tab=media";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    for (let index = 0; index < 8; index += 1) {
      await flushTasks();
    }

    expect(document.body).toBe(originalBody);
    expect(document.querySelector("[data-mock-view='library']")).toBeTruthy();
    expect(routeState.unmounted).toContain("speed");

    window.location.hash = "#/accel";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    for (let index = 0; index < 8; index += 1) {
      await flushTasks();
    }

    expect(document.querySelector("[data-mock-view='accel']")).toBeTruthy();
    expect(routeState.unmounted).toContain("library");
  });
});
