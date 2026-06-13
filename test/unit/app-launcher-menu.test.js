import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

async function loadLauncher() {
  vi.resetModules();
  vi.doMock("../../src/player/integrate-player-widget.js", () => ({
    integratePlayerWidget: vi.fn(),
  }));
  vi.doMock("../../src/app/router.js", () => ({
    ROUTE_VISIBLE_EVENT: "vatioboard:route-visible",
    navigateToAppRoute: vi.fn(() => true),
  }));

  const [startMenu, appPlatform, router] = await Promise.all([
    import("../../src/shared/start-menu.js"),
    import("../../src/app-platform/index.js"),
    import("../../src/app/router.js"),
  ]);
  return { ...startMenu, ...appPlatform, router };
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
    globalThis.requestAnimationFrame = (callback) => {
      callback(performance.now());
      return 1;
    };
    globalThis.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
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
    expect(menu.list.querySelector("[data-launcher-search-open]")).toBeTruthy();
    expect(menu.list.querySelector("[data-launcher-search-panel]").hidden).toBe(true);
    expect(document.activeElement).not.toBe(menu.list.querySelector(".vb-app-launcher-search-input"));
    const boardTile = menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board']");
    expect(boardTile).toBeTruthy();
    expect(boardTile.style.getPropertyValue("--vb-app-icon-accent")).toBe("#2563eb");
    expect(menu.list.querySelector("[data-start-route='/board']")).toBeTruthy();
    expect(menu.list.querySelector("[data-start-action='calculator']")).toBeTruthy();
  });

  it("reveals and focuses the top search panel only after tapping the search pill", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const searchPanel = menu.list.querySelector("[data-launcher-search-panel]");
    const searchButton = menu.list.querySelector("[data-launcher-search-open]");

    expect(searchPanel.hidden).toBe(true);
    expect(searchPanel.parentElement).toBe(menu.list);
    expect(searchButton.hidden).toBe(false);
    expect(document.activeElement).not.toBe(search);

    searchButton.click();

    expect(searchPanel.hidden).toBe(false);
    expect(searchButton.hidden).toBe(true);
    expect(document.activeElement).toBe(search);
  });

  it("filters visible app tiles through launcher search", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const searchButton = menu.list.querySelector("[data-launcher-search-open]");

    searchButton.click();
    search.value = "math";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const tiles = Array.from(menu.list.querySelectorAll(".vb-app-launcher-grid > [data-app-id]"));
    expect(tiles.map((tile) => tile.getAttribute("data-app-id"))).toEqual(["vatio.calculator"]);
  });

  it("opens a filtered app tile even when drag capture retargets the click to the grid", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const openCalculator = vi.fn();
    const menu = openLauncher(initSharedStartMenu, {
      floatingTools: { openCalculator },
    });
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const searchButton = menu.list.querySelector("[data-launcher-search-open]");
    const appButton = () => menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.calculator'] .vb-app-launcher-tile-main");

    searchButton.click();
    search.value = "calculator";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const grid = menu.list.querySelector(".vb-app-launcher-grid");

    appButton().dispatchEvent(pointer("pointerdown", { clientX: 90, clientY: 330 }));
    window.dispatchEvent(pointer("pointerup", { clientX: 90, clientY: 330 }));
    grid.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 90,
      clientY: 330,
    }));

    expect(openCalculator).toHaveBeenCalledTimes(1);
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

    menu.list.style.width = "260px";
    menu.list.style.height = "360px";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const grid = menu.list.querySelector(".vb-app-launcher-grid");
    const track = menu.list.querySelector("[data-vb-app-launcher-page-track]");

    expect(menu.list.querySelector(".vb-app-launcher-page-status").textContent).toContain("Page 1 of");

    grid.querySelector(".vb-app-launcher-tile-main").dispatchEvent(pointer("pointerdown", { clientX: 300, clientY: 320 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 240, clientY: 322 }));
    expect(track.getAttribute("data-vb-app-launcher-page-transition")).toBe("false");
    expect(track.style.transform).toContain("translate3d");
    window.dispatchEvent(pointer("pointerup", { clientX: 210, clientY: 322 }));

    expect(menu.list.querySelector(".vb-app-launcher-page-status").textContent).toContain("Page 2 of");
    expect(track.getAttribute("data-vb-app-launcher-page-transition")).toBe("true");
    expect(menu.list.querySelector(".vb-app-launcher-page-dot[data-page='1']").getAttribute("aria-current")).toBe("page");
  });

  it("moves page cards from page dots and keeps inactive page buttons out of focus", async () => {
    const { initSharedStartMenu, router } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");

    menu.list.style.width = "260px";
    menu.list.style.height = "360px";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const track = menu.list.querySelector("[data-vb-app-launcher-page-track]");
    const firstPage = menu.list.querySelector(".vb-app-launcher-page[data-page='0']");
    const firstPageButton = firstPage.querySelector("[data-app-id='vatio.board'] .vb-app-launcher-tile-main");
    const secondDot = menu.list.querySelector(".vb-app-launcher-page-dot[data-page='1']");

    secondDot.click();

    expect(menu.list.hidden).toBe(false);
    expect(menu.list.querySelector(".vb-app-launcher-page-status").textContent).toContain("Page 2 of");
    expect(track.style.transform).toContain("translate3d");
    expect(firstPage.getAttribute("aria-hidden")).toBe("true");
    expect(firstPage.getAttribute("data-vb-app-launcher-page-active")).toBe("false");
    expect(firstPageButton.getAttribute("tabindex")).toBe("-1");

    router.navigateToAppRoute.mockClear();
    firstPageButton.click();
    expect(router.navigateToAppRoute).not.toHaveBeenCalled();
  });

  it("keeps filtered tile clicks working after page-track rendering", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const openCalculator = vi.fn();
    const menu = openLauncher(initSharedStartMenu, {
      floatingTools: { openCalculator },
    });
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const searchButton = menu.list.querySelector("[data-launcher-search-open]");

    searchButton.click();
    search.value = "calculator";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    menu.list.querySelector(".vb-app-launcher-page[data-vb-app-launcher-page-active='true'] [data-app-id='vatio.calculator'] .vb-app-launcher-tile-main").click();

    expect(openCalculator).toHaveBeenCalledTimes(1);
  });

  it("emits taskbar favorite drag events when a tile is dragged vertically", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    appControl.setFavorite("vatio.board", false);
    const menu = openLauncher(initSharedStartMenu);
    const events = [];
    const handler = (event) => events.push(event.detail);
    window.addEventListener("vatio:taskbar-favorite-drag", handler);

    const tile = menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board']");
    const button = tile.querySelector(".vb-app-launcher-tile-main");
    vi.spyOn(tile, "getBoundingClientRect").mockReturnValue({
      left: 120,
      top: 160,
      right: 240,
      bottom: 282,
      width: 120,
      height: 122,
      x: 120,
      y: 160,
      toJSON: () => {},
    });

    button.dispatchEvent(pointer("pointerdown", { clientX: 180, clientY: 220 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 184, clientY: 272 }));

    expect(document.querySelector("[data-vb-app-launcher-drag-ghost='vatio.board']")).toBeTruthy();

    window.dispatchEvent(pointer("pointerup", { clientX: 184, clientY: 330 }));

    window.removeEventListener("vatio:taskbar-favorite-drag", handler);
    expect(events.map((event) => event.phase)).toEqual(["start", "move", "end"]);
    expect(events[0].appId).toBe("vatio.board");
    expect(document.querySelector("[data-vb-app-launcher-drag-ghost='vatio.board']")).toBeNull();
    expect(menu.list.querySelector(".vb-app-launcher-page-status").textContent).toContain("Page 1 of");
  });
});
