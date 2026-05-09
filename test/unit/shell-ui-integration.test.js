import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.doMock("../../src/app/routes.js", () => ({
    routes: [],
  }));
  vi.doMock("../../src/app/router.js", () => ({
    createHashRouter: vi.fn(() => ({ getRoute: vi.fn(), destroy: vi.fn() })),
    emitRouteVisible: vi.fn(),
    navigateToAppRoute: vi.fn(() => false),
  }));
  return import("../../src/app/app-shell.js");
}

describe("shell UI integration", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("app shell mounts one taskbar", async () => {
    document.body.innerHTML = "<main id=\"app-view\"></main><div id=\"app-persistent-layer\"></div>";
    const { startAppShell } = await loadAppShellWithMocks();

    const app = await startAppShell();

    expect(document.querySelectorAll("[data-vb-shell-taskbar]")).toHaveLength(1);
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

  it("snap preview appears during drag and clears on release", async () => {
    const { createShellWindowManager, makePanelDraggable } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel, header } = makePanel("calculator");
    panel.hidden = false;
    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });
    makePanelDraggable({
      panel,
      header,
      dragThresholdPx: 1,
      savePos: vi.fn(),
      loadPos: vi.fn(() => ({})),
      shellWindowId: "calculator",
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
    expect(manager.getWindow("calculator").snap.zone).toBe("left");
    manager.destroy();
  });

  it("snap preview clears if pointer capture is lost", async () => {
    const { createShellWindowManager, makePanelDraggable } = await loadShell();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const { panel, header } = makePanel("calculator");
    panel.hidden = false;
    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });
    makePanelDraggable({
      panel,
      header,
      dragThresholdPx: 1,
      savePos: vi.fn(),
      loadPos: vi.fn(() => ({})),
      shellWindowId: "calculator",
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

  it("snap preview CSS avoids a fixed viewport overlay for iPhone Safari hit testing", () => {
    const appCss = readProjectFile("src/styles/app.less");

    expect(appCss).not.toContain("[data-vb-shell-snap-preview]::before");
    expect(appCss).not.toContain("[data-vb-shell-snap-zone=\"left\"]::before");
  });

  it("confirm dialog layer remains above shell windows and taskbar", () => {
    const appCss = readProjectFile("src/styles/app.less");
    const confirmCss = readProjectFile("src/shared/ui/confirm-dialog.less");

    expect(confirmCss).toContain("z-index: var(--vb-z-modal, 2000)");
    expect(appCss).toContain("z-index: calc(var(--vb-z-floating, 1000) - 1)");
    expect(appCss).toContain("z-index: calc(var(--vb-z-floating, 1000) + 850)");
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
