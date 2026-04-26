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
    expect(document.querySelector(".floating-dock")).toBeTruthy();
    expect(window.__vatioboardFloatingTools).toBeTruthy();
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

  it("binds route menu buttons to one shared start menu in the SPA", async () => {
    await bootSpa();

    const { initToolsMenu } = await import("../../src/shared/tools-menu.js");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tools-menu-btn";
    const localList = document.createElement("div");
    localList.id = "mockToolsMenuList";
    localList.className = "tools-menu-list";
    localList.hidden = true;
    document.body.append(button, localList);

    const menu = initToolsMenu({ button, list: localList });
    button.click();

    const sharedList = document.getElementById("appStartMenuList");
    expect(sharedList).toBeTruthy();
    expect(sharedList.hidden).toBe(false);
    expect(localList.hidden).toBe(true);
    expect(sharedList.querySelector("[data-start-route]")?.dataset.startRoute).toBe("/");
    expect(sharedList.querySelector("[data-start-route='/board']")).toBeTruthy();
    expect(sharedList.querySelector("[data-start-route='/replay']")).toBeTruthy();
    expect(sharedList.querySelector("[data-backend-auth]")).toBeTruthy();
    expect(sharedList.querySelector("[data-player-toggle]")).toBeTruthy();

    const children = Array.from(sharedList.children);
    const brand = sharedList.querySelector(".app-start-menu-brand");
    const authForm = sharedList.querySelector("[data-backend-auth]");
    const firstRoute = sharedList.querySelector("[data-start-route]");
    const playerButton = sharedList.querySelector("[data-player-toggle]");
    expect(children.indexOf(authForm)).toBe(children.indexOf(brand) + 1);
    expect(children.indexOf(authForm)).toBeLessThan(children.indexOf(firstRoute));
    expect(children.indexOf(playerButton)).toBeGreaterThan(children.indexOf(authForm));
    expect(authForm.querySelector(".backend-auth-logout-button svg")).toBeTruthy();
    expect(authForm.querySelector("[data-backend-auth-signup]")?.getAttribute("target")).toBe("_blank");
    expect(authForm.querySelector("[data-backend-auth-forgot]")?.getAttribute("target")).toBe("_blank");
    expect(authForm.querySelector("[data-backend-auth-signup]")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(authForm.querySelector("[data-backend-auth-forgot]")?.getAttribute("rel")).toBe("noopener noreferrer");

    menu.close();
    expect(sharedList.hidden).toBe(true);
  });

  it("opens the shared start menu navigation without a local GPS Lab item", async () => {
    await bootSpa();

    const sharedList = document.getElementById("appStartMenuList");
    expect(sharedList.textContent).not.toContain("GPS Lab");
    expect(sharedList.querySelector("[data-start-route='/library']")).toBeTruthy();
  });

  it("keeps calculator and energy panels in the persistent layer across routes", async () => {
    await bootSpa();

    const persistentLayer = document.getElementById("app-persistent-layer");
    const calcButton = persistentLayer.querySelector(".dock-btn-calc");
    const calcPanel = persistentLayer.querySelector(".calc-panel");
    const energyPanel = persistentLayer.querySelector(".energy-panel");

    expect(calcPanel.hidden).toBe(true);
    expect(energyPanel.hidden).toBe(true);

    calcButton.click();
    window.__vatioboardFloatingTools.openEnergy();

    expect(calcPanel.hidden).toBe(false);
    expect(energyPanel.hidden).toBe(false);
    expect(localStorage.getItem("vatioboard.calc_panel.visible_v1")).toBe("open");
    expect(localStorage.getItem("vatioboard.energy_panel.visible_v1")).toBe("open");

    window.location.hash = "#/library";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    for (let index = 0; index < 8; index += 1) {
      await flushTasks();
    }

    expect(document.querySelector("[data-mock-view='library']")).toBeTruthy();
    expect(persistentLayer.querySelector(".calc-panel")).toBe(calcPanel);
    expect(persistentLayer.querySelector(".energy-panel")).toBe(energyPanel);
    expect(calcPanel.hidden).toBe(false);
    expect(energyPanel.hidden).toBe(false);
  });

  it("restores persisted calculator and energy visibility on boot", async () => {
    localStorage.setItem("vatioboard.calc_panel.visible_v1", "open");
    localStorage.setItem("vatioboard.energy_panel.visible_v1", "open");

    await bootSpa();

    expect(document.querySelector(".calc-panel")?.hidden).toBe(false);
    expect(document.querySelector(".energy-panel")?.hidden).toBe(false);
  });
});
