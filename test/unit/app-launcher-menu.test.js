import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadLauncher() {
  vi.resetModules();
  vi.doMock("../../src/player/integrate-player-widget.js", () => ({
    integratePlayerWidget: vi.fn(),
  }));
  vi.doMock("../../src/app/router.js", () => ({
    ROUTE_VISIBLE_EVENT: "vatioboard:route-visible",
    navigateToAppRoute: vi.fn(() => true),
  }));

  const [startMenu, appPlatform] = await Promise.all([
    import("../../src/shared/start-menu.js"),
    import("../../src/app-platform/index.js"),
  ]);
  return { ...startMenu, ...appPlatform };
}

function openLauncher(initSharedStartMenu, options = {}) {
  const menu = initSharedStartMenu({
    floatingTools: {},
    mount: document.body,
    ...options,
  });
  menu.setOpen(true);
  return menu;
}

function pointer(type, options = {}) {
  return new PointerEvent(type, {
    pointerId: 7,
    pointerType: "mouse",
    button: 0,
    clientX: 200,
    clientY: 200,
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

function openContext(menu, appId) {
  const button = menu.list.querySelector(`.vb-app-launcher-grid [data-app-id='${appId}'] .vb-app-launcher-tile-main`);
  button.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 220,
    clientY: 220,
  }));
  return menu.list.querySelector("[data-launcher-context]");
}

describe("app launcher start menu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.__vatioboardStartMenu;
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 768 });
    vi.restoreAllMocks();
  });

  it("renders the modern launcher while preserving legacy start-menu selectors", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);

    expect(menu.list.id).toBe("appStartMenuList");
    expect(menu.list.classList.contains("vb-app-launcher")).toBe(true);
    expect(menu.list.querySelector(".app-start-menu-brand")).toBeTruthy();
    expect(menu.list.querySelector("[data-lang-toggle]")).toBeTruthy();
    expect(menu.list.querySelector("[data-backend-auth]")).toBeNull();
    expect(menu.list.querySelector(".vb-app-launcher-rail")).toBeNull();
    expect(menu.list.querySelector("[aria-label='Edit launcher']")).toBeNull();
    expect(menu.list.querySelector("[aria-label='Manage apps']")).toBeNull();
    expect(menu.list.querySelector(".vb-app-launcher-page-button")).toBeNull();
    expect(menu.list.querySelector(".vb-app-launcher-manage")).toBeNull();
    expect(menu.list.querySelector(".vb-app-launcher-search-input")).toBeTruthy();
    expect(menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board']")).toBeTruthy();
    expect(menu.list.querySelector("[data-start-route='/board']")).toBeTruthy();
    expect(menu.list.querySelector("[data-start-action='calculator']")).toBeTruthy();
  });

  it("filters visible app tiles through launcher search", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");

    search.value = "math";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const tiles = Array.from(menu.list.querySelectorAll(".vb-app-launcher-grid > [data-app-id]"));
    expect(tiles.map((tile) => tile.getAttribute("data-app-id"))).toEqual(["vatio.calculator"]);
  });

  it("favorites apps from a long-press context sheet without adding an internal favorites rail", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);

    const context = openContext(menu, "vatio.board");
    expect(context.hidden).toBe(false);
    context.querySelector("[data-launcher-context-action='favorite']").click();

    expect(appControl.isFavorite("vatio.board")).toBe(true);
    expect(menu.list.querySelector(".vb-app-launcher-favorites")).toBeNull();
    expect(menu.list.querySelector("[data-launcher-view]")).toBeNull();
  });

  it("hides removable apps and restores hidden search results from the context sheet", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");

    openContext(menu, "vatio.board")
      .querySelector("[data-launcher-context-action='hide']")
      .click();

    expect(appControl.isHiddenFromStartMenu("vatio.board")).toBe(true);
    expect(menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board']")).toBeNull();

    search.value = "board";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board'][data-hidden='true']")).toBeTruthy();

    openContext(menu, "vatio.board")
      .querySelector("[data-launcher-context-action='restore']")
      .click();

    expect(appControl.isHiddenFromStartMenu("vatio.board")).toBe(false);
    expect(menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board']")).toBeTruthy();
  });

  it("keeps protected apps from being hidden", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);

    const context = openContext(menu, "vatio.speed");
    const removeSpeed = context.querySelector("[data-launcher-context-action='hide']");

    expect(removeSpeed.disabled).toBe(true);
    removeSpeed.click();
    expect(appControl.isHiddenFromStartMenu("vatio.speed")).toBe(false);
  });

  it("changes launcher pages with a horizontal pointer swipe", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const grid = menu.list.querySelector(".vb-app-launcher-grid");

    menu.list.style.width = "260px";
    menu.list.style.height = "360px";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    expect(menu.list.querySelector(".vb-app-launcher-page-status").textContent).toContain("Page 1 of");

    grid.querySelector(".vb-app-launcher-tile-main").dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 320 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 240, clientY: 322 }));
    window.dispatchEvent(pointer("pointerup", { clientX: 210, clientY: 322 }));

    expect(menu.list.querySelector(".vb-app-launcher-page-status").textContent).toContain("Page 2 of");
  });
});
