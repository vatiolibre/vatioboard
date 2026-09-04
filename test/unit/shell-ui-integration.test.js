import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHELL_Z_INDEX } from "../../src/shared/shell-layers.js";

function makePanel(id = "panel") {
  const panel = document.createElement("section");
  panel.className = id;
  panel.hidden = true;
  panel.style.position = "fixed";
  panel.style.left = "20px";
  panel.style.top = "30px";
  panel.style.width = "320px";
  panel.style.height = "220px";
  const header = document.createElement("div");
  header.className = `${id}-header`;
  panel.append(header);
  document.body.append(panel);
  return { panel, header };
}

function mockRect(element, rect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: rect.left,
      y: rect.top,
      toJSON: () => {},
      ...rect,
    }),
  });
}

function mockStartMenuSize(list, { width = 320, height = 360 } = {}) {
  Object.defineProperty(list, "scrollWidth", { configurable: true, get: () => width });
  Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(list, "offsetWidth", { configurable: true, get: () => width });
  Object.defineProperty(list, "offsetHeight", { configurable: true, get: () => height });
  mockRect(list, {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
  });
}

async function loadShell() {
  vi.resetModules();
  const [manager, taskbar, drag, presets] = await Promise.all([
    import("../../src/shared/shell-window-manager.js"),
    import("../../src/shared/shell-taskbar.js"),
    import("../../src/calculator/widget/drag.js"),
    import("../../src/shared/shell-layout-presets.js"),
  ]);
  return { ...manager, ...taskbar, ...drag, ...presets };
}

async function loadAppShellWithMocks() {
  vi.resetModules();
  vi.doMock("../../src/player/player-widget.js", () => ({
    createPlayerWidget: vi.fn(() => ({ destroy: vi.fn() })),
  }));
  vi.doMock("../../src/shared/backend-auth.js", () => ({
    initBackendAuthControllers: vi.fn(),
  }));
  vi.doMock("../../src/shared/account-panel.js", () => ({
    initAccountPanel: vi.fn(() => ({ destroy: vi.fn(), open: vi.fn(), close: vi.fn(), toggle: vi.fn() })),
  }));
  vi.doMock("../../src/shared/cloud-sync.js", () => ({
    startCloudSyncLoop: vi.fn(),
  }));
  vi.doMock("../../src/shared/activity-indicator.js", () => ({
    initActivityIndicator: vi.fn(() => ({ destroy: vi.fn() })),
  }));
  vi.doMock("../../src/shared/floating-tools.js", () => ({
    initFloatingTools: vi.fn(({ shellManager }) => ({ shellManager })),
  }));
  vi.doMock("../../src/shared/start-menu.js", () => ({
    initSharedStartMenu: vi.fn(() => ({ destroy: vi.fn() })),
  }));
  vi.doMock("../../src/shared/single-tab.js", () => ({
    ensureSingleTabOwnership: vi.fn(),
  }));
  vi.doMock("../../src/app/runtime-context.js", () => ({
    createRuntimeContext: vi.fn(() => ({
      gpsService: { installGlobalShim: vi.fn() },
    })),
  }));
  vi.doMock("../../src/app/welcome-consent.js", () => ({
    showWelcomeConsentIfNeeded: vi.fn(() => Promise.resolve({
      accepted: true,
      acceptedAtMs: Date.now(),
      locationChoice: "enabled",
      version: 1,
    })),
  }));
  vi.doMock("../../src/app/routes.js", () => ({
    routes: [],
  }));
  vi.doMock("../../src/app/router.js", () => ({
    createHistoryRouter: vi.fn(() => ({ getRoute: vi.fn(), destroy: vi.fn() })),
    emitRouteVisible: vi.fn(),
    navigateToAppRoute: vi.fn(() => false),
  }));
  return import("../../src/app/app-shell.js");
}

async function loadStartMenuWithMocks() {
  vi.resetModules();
  vi.doUnmock("../../src/shared/start-menu.js");
  vi.doUnmock("../../src/shared/shell-window-manager.js");
  vi.doMock("../../src/shared/backend-auth.js", () => ({
    initBackendAuthControllers: vi.fn(),
  }));
  vi.doMock("../../src/player/integrate-player-widget.js", () => ({
    integratePlayerWidget: vi.fn(),
  }));
  vi.doMock("../../src/app/router.js", () => ({
    ROUTE_VISIBLE_EVENT: "vatioboard:route-visible",
    navigateToAppRoute: vi.fn(() => true),
  }));
  const [startMenu, manager] = await Promise.all([
    import("../../src/shared/start-menu.js"),
    import("../../src/shared/shell-window-manager.js"),
  ]);
  return { ...startMenu, ...manager };
}

function dispatchTouchControl(target) {
  target.dispatchEvent(new PointerEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    button: 0,
    clientX: 60,
    clientY: 60,
    bubbles: true,
    cancelable: true,
  }));
  target.dispatchEvent(new PointerEvent("pointerup", {
    pointerId: 7,
    pointerType: "touch",
    button: 0,
    clientX: 60,
    clientY: 60,
    bubbles: true,
    cancelable: true,
  }));
  target.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  }));
}

describe("shell UI integration", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.__vatioboardStartMenu;
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 768 });
    vi.restoreAllMocks();
  });

  it("app shell mounts one taskbar", async () => {
    document.body.innerHTML = "<main id=\"app-view\"></main><div id=\"app-persistent-layer\"></div>";
    const { startAppShell } = await loadAppShellWithMocks();

    const app = await startAppShell();
    const accountPanelModule = await import("../../src/shared/account-panel.js");
    const accountPanelOptions = accountPanelModule.initAccountPanel.mock.calls[0]?.[0] || {};

    expect(document.querySelectorAll("[data-vb-shell-taskbar]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-vb-shell-start-button]")).toHaveLength(1);
    expect(document.querySelector("[data-vb-shell-taskbar]").hidden).toBe(false);
    expect(accountPanelOptions.authRequestGate).toBeInstanceOf(Promise);
    expect(accountPanelOptions.gatedAuthRequestFocus).toBe(false);
    app.router.destroy();
  });

  it("router destroy removes taskbar and keyboard listeners", async () => {
    document.body.innerHTML = "<main id=\"app-view\"></main><div id=\"app-persistent-layer\"></div>";
    const { startAppShell } = await loadAppShellWithMocks();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const app = await startAppShell();
    app.router.destroy();

    expect(document.querySelectorAll("[data-vb-shell-taskbar]")).toHaveLength(0);
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("calculator minimize and restore through taskbar works", async () => {
    const { createShellWindowManager, createShellTaskbar } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel } = makePanel("calculator");
    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("calculator");
    taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']").click();
    expect(manager.getWindow("calculator").state).toBe("minimized");

    taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']").click();
    expect(manager.getWindow("calculator").state).toBe("open");

    taskbar.destroy();
    manager.destroy();
  });

  it("energy minimize and restore through taskbar works", async () => {
    const { createShellWindowManager, createShellTaskbar } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel } = makePanel("energy");
    manager.registerWindow({ id: "energy", title: "Energy", element: panel });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("energy");
    manager.minimizeWindow("energy");
    taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='energy']").click();

    expect(manager.getWindow("energy").state).toBe("open");
    taskbar.destroy();
    manager.destroy();
  });

  it("player minimize does not stop runtime through shell taskbar", async () => {
    const { createShellWindowManager, createShellTaskbar } = await loadShell();
    const pause = vi.fn();
    const stopPlayback = vi.fn();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel } = makePanel("player");
    manager.registerWindow({
      id: "player",
      title: "Player",
      element: panel,
      lifecycle: { minimize: () => { panel.hidden = true; } },
    });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("player");
    taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='player']").click();

    expect(pause).not.toHaveBeenCalled();
    expect(stopPlayback).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(true);
    taskbar.destroy();
    manager.destroy();
  });

  it("Milkdrop snap through the shell manager persists layout", async () => {
    const { createShellWindowManager } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel } = makePanel("milkdrop");
    manager.registerWindow({ id: "milkdrop", title: "Milkdrop", element: panel });

    manager.openWindow("milkdrop");
    manager.snapWindow("milkdrop", "right");
    manager.persistShellLayout({ flush: true });

    const saved = JSON.parse(localStorage.getItem("vatioboard.shell.layout.v1")).windows.milkdrop;
    expect(saved.snap.zone).toBe("right");
    manager.destroy();
  });

  it("does not inject generic shell controls into panel headers", async () => {
    const { createShellWindowManager, createShellTaskbar } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel, header } = makePanel("calculator");
    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("calculator");

    expect(header.querySelector("[data-vb-shell-window-controls]")).toBeNull();
    expect(panel.querySelector("[data-vb-shell-window-control]")).toBeNull();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeTruthy();
    taskbar.destroy();
    manager.destroy();
  });

  it("calculator controls receive touch clicks with the taskbar present", async () => {
    const { createShellWindowManager, createShellTaskbar } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel } = makePanel("calc-panel");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calc-btn";
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    panel.append(button);
    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("calculator");
    dispatchTouchControl(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    taskbar.destroy();
    manager.destroy();
  });

  it("the first touch on an inactive panel child activates it and still clicks the child", async () => {
    const { createShellWindowManager, createShellTaskbar } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel: calcPanel } = makePanel("calc-panel");
    const { panel: playerPanel } = makePanel("player-panel");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calc-btn";
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    calcPanel.append(button);
    manager.registerWindow({ id: "calculator", title: "Calculator", element: calcPanel });
    manager.registerWindow({ id: "player", title: "Player", element: playerPanel });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("calculator");
    manager.openWindow("player");
    expect(manager.getActiveWindow().id).toBe("player");

    dispatchTouchControl(button);

    expect(manager.getActiveWindow().id).toBe("calculator");
    expect(onClick).toHaveBeenCalledTimes(1);
    taskbar.destroy();
    manager.destroy();
  });

  it("player controls receive touch clicks with the taskbar present", async () => {
    const { createShellWindowManager, createShellTaskbar } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel } = makePanel("player-panel");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-btn-play-main";
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    panel.append(button);
    manager.registerWindow({ id: "player", title: "Player", element: panel });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("player");
    dispatchTouchControl(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    taskbar.destroy();
    manager.destroy();
  });

  it("snap preview appears during drag and clears on release", async () => {
    const { createShellWindowManager, makePanelDraggable } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel, header } = makePanel("milkdrop");
    panel.hidden = false;
    manager.registerWindow({
      id: "milkdrop",
      title: "Milkdrop",
      element: panel,
      capabilities: { maximizable: true, snap: true },
    });
    makePanelDraggable({
      panel,
      header,
      dragThresholdPx: 1,
      savePos: vi.fn(),
      loadPos: vi.fn(() => ({})),
      shellWindowId: "milkdrop",
      shellManager: manager,
      enableSnapPreview: true,
    });

    header.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      bubbles: true,
    }));
    header.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 2,
      clientY: 200,
      pointerId: 1,
      pointerType: "mouse",
      bubbles: true,
    }));
    expect(panel.getAttribute("data-vb-shell-snap-preview")).toBe("left");

    header.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 2,
      clientY: 200,
      pointerId: 1,
      pointerType: "mouse",
      bubbles: true,
    }));

    expect(panel.hasAttribute("data-vb-shell-snap-preview")).toBe(false);
    expect(manager.getWindow("milkdrop").snap.zone).toBe("left");
    manager.destroy();
  });

  it("snap preview clears if pointer capture is lost", async () => {
    const { createShellWindowManager, makePanelDraggable } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel, header } = makePanel("milkdrop");
    panel.hidden = false;
    manager.registerWindow({
      id: "milkdrop",
      title: "Milkdrop",
      element: panel,
      capabilities: { maximizable: true, snap: true },
    });
    makePanelDraggable({
      panel,
      header,
      dragThresholdPx: 1,
      savePos: vi.fn(),
      loadPos: vi.fn(() => ({})),
      shellWindowId: "milkdrop",
      shellManager: manager,
      enableSnapPreview: true,
    });

    header.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      bubbles: true,
    }));
    header.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 2,
      clientY: 200,
      pointerId: 1,
      pointerType: "touch",
      bubbles: true,
    }));
    expect(panel.getAttribute("data-vb-shell-snap-preview")).toBe("left");

    header.dispatchEvent(new PointerEvent("lostpointercapture", {
      pointerId: 1,
      pointerType: "touch",
      bubbles: true,
    }));

    expect(panel.hasAttribute("data-vb-shell-snap-preview")).toBe(false);
    manager.destroy();
  });

  it("fixed-width shell tools dragged to the top do not maximize or widen", async () => {
    const { createShellWindowManager, makePanelDraggable } = await loadShell();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const tools = [
      ["calculator", 320],
      ["energy", 640],
      ["player", 340],
    ];

    for (const [index, [id, width]] of tools.entries()) {
      const pointerId = 10 + index;
      const { panel, header } = makePanel(id);
      panel.hidden = false;
      panel.style.width = `${width}px`;
      mockRect(panel, { left: 20, top: 30, right: 20 + width, bottom: 250, width, height: 220 });
      manager.registerWindow({
        id,
        title: id,
        element: panel,
        capabilities: {
          resizable: false,
          maximizable: false,
          snap: false,
          preserveIntrinsicWidth: true,
          maxWidth: width,
        },
      });
      makePanelDraggable({
        panel,
        header,
        dragThresholdPx: 1,
        savePos: vi.fn(),
        loadPos: vi.fn(() => ({})),
        shellWindowId: id,
        shellManager: manager,
        enableSnapPreview: true,
      });

      header.dispatchEvent(new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId,
        pointerType: "mouse",
        button: 0,
        bubbles: true,
      }));
      header.dispatchEvent(new PointerEvent("pointermove", {
        clientX: 480,
        clientY: 2,
        pointerId,
        pointerType: "mouse",
        bubbles: true,
      }));
      expect(panel.hasAttribute("data-vb-shell-snap-preview")).toBe(false);
      header.dispatchEvent(new PointerEvent("pointerup", {
        clientX: 480,
        clientY: 2,
        pointerId,
        pointerType: "mouse",
        bubbles: true,
      }));

      expect(manager.getWindow(id).snap).toBeNull();
      expect(panel.style.width).toBe(`${width}px`);
    }

    manager.destroy();
  });

  it("camera map dragged to the top can use the top snap region", async () => {
    const { createShellWindowManager, makePanelDraggable } = await loadShell();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel, header } = makePanel("camera-map");
    panel.hidden = false;
    panel.style.width = "420px";
    mockRect(panel, { left: 20, top: 30, right: 440, bottom: 250, width: 420, height: 220 });
    manager.registerWindow({
      id: "camera-map",
      title: "Camera Map",
      element: panel,
      capabilities: {
        resizable: true,
        maximizable: true,
        fullscreen: true,
        snap: true,
        snapZones: ["top", "left", "right", "center"],
      },
    });
    makePanelDraggable({
      panel,
      header,
      dragThresholdPx: 1,
      savePos: vi.fn(),
      loadPos: vi.fn(() => ({})),
      shellWindowId: "camera-map",
      shellManager: manager,
      enableSnapPreview: true,
    });

    header.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 41,
      pointerType: "mouse",
      button: 0,
      bubbles: true,
    }));
    header.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 480,
      clientY: 2,
      pointerId: 41,
      pointerType: "mouse",
      bubbles: true,
    }));
    expect(panel.getAttribute("data-vb-shell-snap-preview")).toBe("top");
    header.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 480,
      clientY: 2,
      pointerId: 41,
      pointerType: "mouse",
      bubbles: true,
    }));

    expect(manager.getWindow("camera-map").snap.zone).toBe("top");
    expect(Number.parseInt(panel.style.width, 10)).toBeGreaterThan(420);
    manager.destroy();
  });

  it("start menu stays above active normal windows and still toggles shell tools", async () => {
    const { initSharedStartMenu, createShellWindowManager } = await loadStartMenuWithMocks();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel: first } = makePanel("first-window");
    const { panel: second } = makePanel("second-window");
    manager.registerWindow({ id: "first", element: first });
    manager.registerWindow({ id: "second", element: second });
    manager.openWindow("first");
    manager.openWindow("second");
    manager.activateWindow("first");
    manager.activateWindow("second");

    const toggleSpeedAlerts = vi.fn();
    const menu = initSharedStartMenu({
      floatingTools: { toggleSpeedAlerts },
      mount: document.body,
    });
    const trigger = document.createElement("button");
    document.body.append(trigger);
    menu.bindTrigger(trigger);
    trigger.click();

    expect(menu.list.hidden).toBe(false);
    expect(Number(menu.list.style.zIndex)).toBeGreaterThan(Number(second.style.zIndex));
    expect(Number(menu.list.style.zIndex)).toBeGreaterThan(1950);

    menu.list.querySelector("[data-start-action='speed-alerts']").click();
    expect(toggleSpeedAlerts).toHaveBeenCalledTimes(1);
    expect(menu.list.hidden).toBe(true);
    manager.destroy();
  });

  it("start menu launcher expands inside the available work area", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });
    const { initSharedStartMenu } = await loadStartMenuWithMocks();
    const menu = initSharedStartMenu({ floatingTools: {}, mount: document.body });
    mockStartMenuSize(menu.list, { width: 320, height: 360 });
    const trigger = document.createElement("button");
    mockRect(trigger, { left: 200, top: 80, right: 280, bottom: 120, width: 80, height: 40 });
    document.body.append(trigger);
    menu.bindTrigger(trigger);

    trigger.click();

    expect(menu.list.hidden).toBe(false);
    expect(menu.list.classList.contains("vb-app-launcher")).toBe(true);
    expect(Number.parseInt(menu.list.style.top, 10)).toBeGreaterThanOrEqual(8);
    expect(Number.parseInt(menu.list.style.left, 10)).toBeGreaterThanOrEqual(8);
    expect(Number.parseInt(menu.list.style.height, 10)).toBeLessThanOrEqual(784);
    expect(Number.parseInt(menu.list.style.width, 10)).toBeGreaterThan(700);
  });

  it("start menu launcher uses the safe work area when below space is tight", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 500 });
    const { initSharedStartMenu } = await loadStartMenuWithMocks();
    const menu = initSharedStartMenu({ floatingTools: {}, mount: document.body });
    mockStartMenuSize(menu.list, { width: 320, height: 300 });
    const trigger = document.createElement("button");
    mockRect(trigger, { left: 200, top: 430, right: 280, bottom: 466, width: 80, height: 36 });
    document.body.append(trigger);
    menu.bindTrigger(trigger);

    trigger.click();

    expect(Number.parseInt(menu.list.style.top, 10)).toBeGreaterThanOrEqual(8);
    expect(Number.parseInt(menu.list.style.height, 10)).toBeLessThanOrEqual(484);
    expect(Number.parseInt(menu.list.style.top, 10) + Number.parseInt(menu.list.style.height, 10)).toBeLessThanOrEqual(492);
  });

  it("start menu launcher shrinks to the available work area on short viewports", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 260 });
    const { initSharedStartMenu } = await loadStartMenuWithMocks();
    const menu = initSharedStartMenu({ floatingTools: {}, mount: document.body });
    mockStartMenuSize(menu.list, { width: 320, height: 500 });
    const trigger = document.createElement("button");
    mockRect(trigger, { left: 200, top: 100, right: 280, bottom: 132, width: 80, height: 32 });
    document.body.append(trigger);
    menu.bindTrigger(trigger);

    trigger.click();

    expect(Number.parseInt(menu.list.style.height, 10)).toBeGreaterThan(0);
    expect(Number.parseInt(menu.list.style.height, 10)).toBeLessThan(500);
    expect(menu.list.style.maxHeight).toBe(menu.list.style.height);
  });

  it("start menu launcher recomputes available height while open on resize", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 260 });
    const { initSharedStartMenu } = await loadStartMenuWithMocks();
    const menu = initSharedStartMenu({ floatingTools: {}, mount: document.body });
    mockStartMenuSize(menu.list, { width: 320, height: 500 });
    const trigger = document.createElement("button");
    mockRect(trigger, { left: 200, top: 100, right: 280, bottom: 132, width: 80, height: 32 });
    document.body.append(trigger);
    menu.bindTrigger(trigger);
    trigger.click();
    const firstHeight = Number.parseInt(menu.list.style.height, 10);

    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 420 });
    window.dispatchEvent(new Event("resize"));

    expect(Number.parseInt(menu.list.style.height, 10)).toBeGreaterThan(firstHeight);
    expect(menu.list.style.maxHeight).toBe(menu.list.style.height);
  });

  it("dragging a normal shell window clamps below the toolbar work area", async () => {
    const { createShellWindowManager, makePanelDraggable } = await loadShell();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-vb-shell-toolbar", "");
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1024, bottom: 64, width: 1024, height: 64, x: 0, y: 0, toJSON: () => {},
    });
    document.body.append(toolbar);
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel, header } = makePanel("drag-clamp");
    panel.hidden = false;
    panel.style.top = "96px";
    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });
    makePanelDraggable({
      panel,
      header,
      dragThresholdPx: 1,
      savePos: vi.fn(),
      loadPos: vi.fn(() => ({})),
      shellWindowId: "calculator",
      shellManager: manager,
      enableSnapPreview: false,
    });

    header.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      bubbles: true,
    }));
    header.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 100,
      clientY: -300,
      pointerId: 1,
      pointerType: "mouse",
      bubbles: true,
    }));
    header.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 100,
      clientY: -300,
      pointerId: 1,
      pointerType: "mouse",
      bubbles: true,
    }));

    expect(Number.parseInt(panel.style.top, 10)).toBeGreaterThanOrEqual(72);
    manager.destroy();
  });

  it("snap preview CSS avoids a fixed viewport overlay for iPhone Safari hit testing", () => {
    const appCss = readProjectFile("src/styles/app.less");

    expect(appCss).not.toContain("[data-vb-shell-snap-preview]::before");
    expect(appCss).not.toContain("[data-vb-shell-snap-zone=\"left\"]::before");
    expect(getCssBlock(appCss, "[data-vb-shell-snap-preview]")).not.toContain("position: fixed");
    expect(getCssBlock(appCss, "[data-vb-shell-snap-preview]")).not.toContain("inset: 0");
  });

  it("shell CSS keeps panel controls touchable under board and taskbar styles", () => {
    const appCss = readProjectFile("src/styles/app.less");
    const taskbarBlock = getCssBlock(appCss, ".vb-shell-taskbar");
    const trayBlock = getCssBlock(appCss, ".vb-shell-taskbar-tray");
    const startButtonBlock = getCssBlock(appCss, ".vb-shell-taskbar-start");
    const handleBlock = getCssBlock(appCss, ".vb-shell-taskbar-drag-handle");
    const itemBlock = getCssBlock(appCss, ".vb-shell-taskbar-item");
    const dragLayerBlock = getCssBlock(appCss, ".vb-shell-drag-layer");
    const dragGhostBlock = getCssBlock(appCss, ".vb-shell-drag-ghost");

    expect(getCssBlock(appCss, "[data-vb-shell-window] *")).toContain("touch-action: auto");
    expect(appCss).not.toMatch(/\[data-vb-shell-window\]\s+\*\s*\{[^}]*touch-action:\s*none/s);
    expect(taskbarBlock).toContain("touch-action: none");
    expect(taskbarBlock).toContain("--vb-shell-taskbar-start-width: 52px");
    expect(taskbarBlock).toContain("gap: var(--vb-shell-taskbar-gap)");
    expect(taskbarBlock).not.toContain("contain: layout paint");
    expect(taskbarBlock).not.toContain("overflow-x: auto");
    expect(taskbarBlock).not.toContain("-webkit-overflow-scrolling");
    expect(taskbarBlock).toContain("width: fit-content");
    expect(appCss).toContain("--vb-touch-target-min: 44px");
    expect(taskbarBlock).toContain("--vb-shell-taskbar-handle-width: var(--vb-touch-target-min)");
    expect(trayBlock).toContain("display: flex");
    expect(trayBlock).toContain("justify-content: flex-start");
    expect(trayBlock).toContain("flex-wrap: nowrap");
    expect(trayBlock).toContain("width: auto");
    expect(trayBlock).toContain("--vb-shell-taskbar-tray-glow-buffer: 8px");
    expect(trayBlock).toContain("--vb-shell-taskbar-tray-content-max-width: max(");
    expect(trayBlock).toContain("max-width: calc(var(--vb-shell-taskbar-tray-content-max-width) + (var(--vb-shell-taskbar-tray-glow-buffer) * 2))");
    expect(trayBlock).toContain("var(--vb-shell-taskbar-start-width)");
    expect(trayBlock).toContain("var(--vb-shell-taskbar-gap)");
    expect(trayBlock).toContain("overflow-x: auto");
    expect(trayBlock).toContain("overflow-y: hidden");
    expect(trayBlock).toContain("overscroll-behavior: contain");
    expect(trayBlock).toContain("scroll-padding-inline: var(--vb-shell-taskbar-tray-glow-buffer)");
    expect(trayBlock).toContain("scrollbar-width: none");
    expect(trayBlock).toContain("touch-action: pan-x");
    expect(trayBlock).toContain("-webkit-overflow-scrolling: touch");
    expect(trayBlock).toContain("padding: var(--vb-shell-taskbar-tray-glow-buffer)");
    expect(trayBlock).toContain("margin: calc(var(--vb-shell-taskbar-tray-glow-buffer) * -1)");
    expect(getCssBlock(appCss, ".vb-shell-taskbar.is-dragging .vb-shell-taskbar-tray")).toContain("overflow: visible");
    expect(appCss).toContain("--vb-shell-taskbar-safe-left: max(4px, var(--vb-safe-area-left))");
    expect(appCss).toContain("--vb-shell-taskbar-safe-right: max(4px, var(--vb-safe-area-right))");
    expect(handleBlock).toContain("flex: 0 0 var(--vb-shell-taskbar-handle-width)");
    expect(handleBlock).toContain("min-width: var(--vb-shell-taskbar-handle-width)");
    expect(handleBlock).toContain("margin: 0");
    expect(handleBlock).toContain("touch-action: none");
    expect(handleBlock).toContain("-webkit-user-drag: none");
    expect(startButtonBlock).toContain("width: var(--vb-shell-taskbar-start-width)");
    expect(startButtonBlock).toContain("min-height: 52px");
    expect(startButtonBlock).toContain("touch-action: manipulation");
    expect(startButtonBlock).toContain("-webkit-user-drag: none");
    expect(itemBlock).toContain("touch-action: none");
    expect(itemBlock).toContain("-webkit-user-drag: none");
    expect(dragLayerBlock).toContain("position: fixed");
    expect(dragLayerBlock).toContain("inset: 0");
    expect(dragLayerBlock).toContain("pointer-events: none");
    expect(dragLayerBlock).toContain("touch-action: none");
    expect(dragGhostBlock).toContain("position: fixed");
    expect(dragGhostBlock).toContain("pointer-events: none");
    expect(dragGhostBlock).toContain("touch-action: none");
  });

  it("keeps taskbar and detached FABs above normal app windows", () => {
    const appCss = readProjectFile("src/styles/app.less");
    const boardCss = readProjectFile("src/styles/board.less");

    expect(appCss).toContain("--vb-z-shell-window-max: 1890");
    expect(appCss).toContain("--vb-z-shell-taskbar: 1950");
    expect(appCss).toContain("--vb-z-activity: 1955");
    expect(appCss).toContain("--vb-z-shell-start-menu: 1960");
    expect(appCss).toContain("--vb-z-shell-fullscreen: 1980");
    expect(appCss).toContain("--vb-z-popover: 1990");
    expect(SHELL_Z_INDEX.windowMax).toBeLessThan(SHELL_Z_INDEX.taskbar);
    expect(SHELL_Z_INDEX.taskbar).toBeLessThan(SHELL_Z_INDEX.activity);
    expect(SHELL_Z_INDEX.activity).toBeLessThan(SHELL_Z_INDEX.startMenu);
    expect(SHELL_Z_INDEX.startMenu).toBeLessThan(SHELL_Z_INDEX.fullscreen);
    expect(SHELL_Z_INDEX.fullscreen).toBeLessThan(SHELL_Z_INDEX.modal);
    expect(SHELL_Z_INDEX.windowMax).toBeLessThan(SHELL_Z_INDEX.popover);
    expect(SHELL_Z_INDEX.popover).toBeLessThan(SHELL_Z_INDEX.modal);
    expect(getCssBlock(appCss, ".vb-shell-taskbar")).toContain("z-index: var(--vb-z-shell-taskbar, 1950)");
    expect(getCssBlock(appCss, ".vb-shell-taskbar.is-detached")).toContain("z-index: var(--vb-z-shell-taskbar, 1950)");
    expect(getCssBlock(appCss, ".vb-shell-taskbar-item.is-detached")).toContain("z-index: var(--vb-z-shell-taskbar, 1950)");
    expect(getCssBlock(appCss, ".vb-shell-taskbar.is-dragging")).toContain("z-index: var(--vb-z-shell-taskbar, 1950)");
    expect(getCssBlock(appCss, ".vb-shell-taskbar-item.is-dragging")).toContain("z-index: var(--vb-z-shell-taskbar, 1950)");
    expect(appCss).not.toContain('[data-vb-shell-window-active="true"][data-vb-shell-window-fullscreen="false"]');
    expect(appCss).not.toContain("z-index: calc(var(--vb-z-shell-start-menu, 1960) - 1) !important");
    expect(getCssBlock(appCss, ".app-start-menu-list")).toContain("z-index: var(--vb-z-shell-start-menu, 1960)");
    expect(getCssBlock(boardCss, ".color-popup")).toContain("z-index: var(--vb-z-shell-window-max, 1890)");
    expect(boardCss).not.toContain("z-index: 9999");
  });

  it("keeps the Start menu layer above the activity indicator layer", () => {
    const appCss = readProjectFile("src/styles/app.less");
    const activityCss = readProjectFile("src/styles/activity-indicator.less");
    const startMenuBlock = getCssBlock(appCss, ".app-start-menu-list");
    const indicatorBlock = getCssBlock(activityCss, ".activity-indicator");
    const startMenu = document.createElement("div");
    const indicator = document.createElement("div");

    expect(startMenuBlock).toContain("z-index: var(--vb-z-shell-start-menu, 1960)");
    expect(indicatorBlock).toContain("z-index: var(--vb-z-activity, 1955)");
    expect(SHELL_Z_INDEX.startMenu).toBeGreaterThan(SHELL_Z_INDEX.activity);

    startMenu.className = "app-start-menu-list";
    startMenu.style.zIndex = String(SHELL_Z_INDEX.startMenu);
    indicator.className = "activity-indicator";
    indicator.style.zIndex = String(SHELL_Z_INDEX.activity);
    document.body.append(indicator, startMenu);

    expect(Number(getComputedStyle(startMenu).zIndex)).toBeGreaterThan(Number(getComputedStyle(indicator).zIndex));
  });

  it("confirm dialog layer remains above shell windows, taskbar, start menu, and fullscreen", () => {
    const appCss = readProjectFile("src/styles/app.less");
    const confirmCss = readProjectFile("src/shared/ui/confirm-dialog.less");

    expect(confirmCss).toContain("z-index: var(--vb-z-modal, 2000)");
    expect(appCss).toContain("--vb-z-shell-fullscreen: 1980");
    expect(appCss).toContain("--vb-z-activity: 1955");
    expect(appCss).toContain("--vb-z-shell-start-menu: 1960");
    expect(appCss).toContain("--vb-z-shell-taskbar: 1950");
  });

  it("shell layout restores locally after simulated reload", async () => {
    const { createShellWindowManager } = await loadShell();
    const first = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    first.registerWindow({ id: "calculator", element: makePanel("calculator").panel });
    first.openWindow("calculator");
    first.updateWindowBounds("calculator", { left: 222, top: 111, width: 320, height: 220 }, { flush: true });
    first.destroy();

    const second = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel } = makePanel("calculator-next");
    second.registerWindow({ id: "calculator", element: panel });
    second.restoreShellLayout();

    expect(panel.hidden).toBe(false);
    expect(panel.style.left).toBe("222px");
    second.destroy();
  });

  it("named layout load updates shell windows without network calls", async () => {
    const { createShellWindowManager, saveNamedLayout, loadNamedLayout } = await loadShell();
    const fetchSpy = vi.spyOn(window, "fetch");
    fetchSpy.mockClear();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    manager.registerWindow({ id: "calculator", element: makePanel("calculator").panel });
    manager.openWindow("calculator");
    saveNamedLayout("Driving", { shellManager: manager });
    manager.closeWindow("calculator");

    loadNamedLayout("Driving", { shellManager: manager });

    expect(manager.getWindow("calculator").state).toBe("open");
    expect(fetchSpy).not.toHaveBeenCalled();
    manager.destroy();
  });
});

function readProjectFile(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function getCssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{[^}]*\\}`, "s"))?.[0] || "";
}
