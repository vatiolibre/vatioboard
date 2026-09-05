import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;
const APP_CONTROL_STORAGE_KEY = "vatioboard.os.appControl.v1";
const APP_LAUNCHER_LAYOUT_STORAGE_KEY = "vatioboard.os.appLauncherLayout.v1";

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

function enterArrangeMode(menu, appId = "vatio.board") {
  const context = openContext(menu, appId);
  context.querySelector("[data-launcher-context-action='arrange']").click();
}

function getLauncherTileIds(menu) {
  return Array.from(menu.list.querySelectorAll(".vb-app-launcher-page .vb-app-launcher-tile[data-app-id]"))
    .map((tile) => tile.getAttribute("data-app-id"));
}

function getLauncherLayoutOrder() {
  return JSON.parse(localStorage.getItem(APP_LAUNCHER_LAYOUT_STORAGE_KEY) || "null")?.order || [];
}

function seedAppControlRecord(apps) {
  localStorage.setItem(APP_CONTROL_STORAGE_KEY, JSON.stringify({
    version: 1,
    apps,
  }));
}

function mockElementRect(element, rect) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => {},
    ...rect,
  });
}

function stubElementFromPoint(element) {
  const original = document.elementFromPoint;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => element),
  });
  return () => {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: original,
    });
  };
}

function dragTileAfter(menu, sourceId, targetId) {
  const sourceTile = menu.list.querySelector(`.vb-app-launcher-grid [data-app-id='${sourceId}']`);
  const targetTile = menu.list.querySelector(`.vb-app-launcher-grid [data-app-id='${targetId}']`);
  const sourceButton = sourceTile.querySelector(".vb-app-launcher-tile-main");
  mockElementRect(sourceTile, {
    left: 100,
    top: 120,
    width: 112,
    height: 122,
  });
  mockElementRect(targetTile, {
    left: 236,
    top: 120,
    width: 112,
    height: 122,
  });
  const restoreElementFromPoint = stubElementFromPoint(targetTile);

  sourceButton.dispatchEvent(pointer("pointerdown", { clientX: 156, clientY: 180 }));
  window.dispatchEvent(pointer("pointermove", { clientX: 324, clientY: 180 }));
  window.dispatchEvent(pointer("pointerup", { clientX: 324, clientY: 180 }));

  restoreElementFromPoint();
}

function runWindowTimeouts() {
  const timeoutMock = window.setTimeout;
  const calls = Array.isArray(timeoutMock?.mock?.calls) ? [...timeoutMock.mock.calls] : [];
  timeoutMock?.mockClear?.();
  for (const [callback] of calls) {
    if (typeof callback === "function") callback();
  }
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

  it("keeps manifest order even when apps have launch history, pinned, and favorite state", async () => {
    seedAppControlRecord({
      "vatio.board": {
        lastOpenedAt: "2026-01-01T12:00:00.000Z",
      },
      "vatio.calculator": {
        favorite: true,
        lastOpenedAt: "2026-02-01T12:00:00.000Z",
        pinned: true,
      },
    });
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const ids = getLauncherTileIds(menu);

    expect(ids.slice(0, 8)).toEqual([
      "vatio.speed",
      "vatio.map",
      "vatio.waze",
      "vatio.board",
      "vatio.deliveryChecklist",
      "vatio.qrScanner",
      "vatio.replay",
      "vatio.accel",
    ]);
    expect(ids.indexOf("vatio.board")).toBeLessThan(ids.indexOf("vatio.calculator"));
  });

  it("preserves relative manifest order in filtered search results", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const initialOrder = getLauncherTileIds(menu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const searchButton = menu.list.querySelector("[data-launcher-search-open]");

    searchButton.click();
    search.value = "tool";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const filteredOrder = getLauncherTileIds(menu);
    expect(filteredOrder.length).toBeGreaterThan(1);
    expect(filteredOrder).toEqual(initialOrder.filter((appId) => filteredOrder.includes(appId)));
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
    const initialOrder = getLauncherTileIds(menu);

    const context = openContext(menu, "vatio.board");
    expect(context.hidden).toBe(false);
    context.querySelector("[data-launcher-context-action='favorite']").click();

    expect(appControl.isFavorite("vatio.board")).toBe(true);
    expect(getLauncherTileIds(menu)).toEqual(initialOrder);
    expect(menu.list.querySelector(".vb-app-launcher-favorites")).toBeNull();
    expect(menu.list.querySelector("[data-launcher-view]")).toBeNull();
  });

  it("enters arrange mode from the tile context menu and clears launcher search", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const searchButton = menu.list.querySelector("[data-launcher-search-open]");

    searchButton.click();
    search.value = "board";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getLauncherTileIds(menu)[0]).toBe("vatio.board");

    enterArrangeMode(menu, "vatio.board");

    expect(menu.list.getAttribute("data-vb-app-launcher-reorder")).toBe("true");
    expect(menu.list.querySelector("[data-vb-app-launcher-arrange-controls]").hidden).toBe(false);
    expect(menu.list.querySelector("[data-launcher-search-panel]").hidden).toBe(true);
    expect(searchButton.hidden).toBe(true);
    expect(search.value).toBe("");
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.map",
      "vatio.waze",
    ]);
  });

  it("reorders launcher apps in arrange mode and persists the custom order", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);

    enterArrangeMode(menu);
    dragTileAfter(menu, "vatio.map", "vatio.waze");

    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.waze",
      "vatio.map",
    ]);
    expect(getLauncherLayoutOrder().slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.waze",
      "vatio.map",
    ]);

    menu.list.querySelector("[data-launcher-arrange-done]").click();
    expect(menu.list.getAttribute("data-vb-app-launcher-reorder")).toBe("false");
    menu.setOpen(false);
    menu.setOpen(true);
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.waze",
      "vatio.map",
    ]);

    runWindowTimeouts();
    appControl.recordLaunch("vatio.calculator");
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.waze",
      "vatio.map",
    ]);
  });

  it("resets a custom launcher order from arrange mode", async () => {
    const { initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);

    enterArrangeMode(menu);
    dragTileAfter(menu, "vatio.map", "vatio.waze");
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.waze",
      "vatio.map",
    ]);

    menu.list.querySelector("[data-launcher-arrange-reset]").click();

    expect(localStorage.getItem(APP_LAUNCHER_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(menu.list.getAttribute("data-vb-app-launcher-reorder")).toBe("true");
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.map",
      "vatio.waze",
    ]);
  });

  it("preserves custom placement when an app is hidden and restored", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");

    enterArrangeMode(menu);
    dragTileAfter(menu, "vatio.map", "vatio.waze");
    menu.list.querySelector("[data-launcher-arrange-done]").click();

    openContext(menu, "vatio.board")
      .querySelector("[data-launcher-context-action='hide']")
      .click();

    expect(appControl.isHiddenFromStartMenu("vatio.board")).toBe(true);
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual(["vatio.speed", "vatio.waze", "vatio.map"]);

    search.value = "board";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    openContext(menu, "vatio.board")
      .querySelector("[data-launcher-context-action='restore']")
      .click();

    expect(appControl.isHiddenFromStartMenu("vatio.board")).toBe(false);
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.waze",
      "vatio.map",
    ]);
  });

  it("does not emit taskbar favorite drag events while arranging apps", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    appControl.setFavorite("vatio.board", false);
    const menu = openLauncher(initSharedStartMenu);
    const events = [];
    const handler = (event) => events.push(event.detail);
    window.addEventListener("vatio:taskbar-favorite-drag", handler);

    enterArrangeMode(menu);
    dragTileAfter(menu, "vatio.map", "vatio.waze");

    window.removeEventListener("vatio:taskbar-favorite-drag", handler);
    expect(events).toEqual([]);
    expect(getLauncherTileIds(menu).slice(0, 3)).toEqual([
      "vatio.speed",
      "vatio.waze",
      "vatio.map",
    ]);
  });

  it("hides removable apps and restores hidden search results from the context sheet", async () => {
    const { appControl, initSharedStartMenu } = await loadLauncher();
    const menu = openLauncher(initSharedStartMenu);
    const search = menu.list.querySelector(".vb-app-launcher-search-input");
    const initialOrder = getLauncherTileIds(menu);

    openContext(menu, "vatio.board")
      .querySelector("[data-launcher-context-action='hide']")
      .click();

    expect(appControl.isHiddenFromStartMenu("vatio.board")).toBe(true);
    expect(menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board']")).toBeNull();
    expect(getLauncherTileIds(menu)).toEqual(initialOrder.filter((appId) => appId !== "vatio.board"));

    search.value = "board";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board'][data-hidden='true']")).toBeTruthy();

    openContext(menu, "vatio.board")
      .querySelector("[data-launcher-context-action='restore']")
      .click();

    expect(appControl.isHiddenFromStartMenu("vatio.board")).toBe(false);
    expect(menu.list.querySelector(".vb-app-launcher-grid [data-app-id='vatio.board']")).toBeTruthy();

    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getLauncherTileIds(menu)).toEqual(initialOrder);
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
    const firstPageButton = firstPage.querySelector("[data-app-id='vatio.speed'] .vb-app-launcher-tile-main");
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
    const initialOrder = getLauncherTileIds(menu);
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
    expect(getLauncherTileIds(menu)).toEqual(initialOrder);
    expect(menu.list.querySelector(".vb-app-launcher-page-status").textContent).toContain("Page 1 of");
  });
});
