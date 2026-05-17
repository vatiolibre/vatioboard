import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHELL_LAYOUT_STORAGE_KEY } from "../../src/shared/shell-layout-store.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import { getShellWorkArea } from "../../src/shared/shell-work-area.js";

function createPanel(className = "test-panel") {
  const panel = document.createElement("section");
  panel.className = className;
  panel.hidden = true;
  panel.style.position = "fixed";
  panel.style.left = "20px";
  panel.style.top = "30px";
  panel.style.width = "300px";
  panel.style.height = "220px";
  document.body.appendChild(panel);
  return panel;
}

function createManager() {
  return createShellWindowManager({
    storeOptions: { storage: localStorage, migrateLegacy: false },
  });
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

function readStoredWindow(id) {
  return JSON.parse(localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)).windows[id];
}

describe("shell-window-manager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("registers and unregisters windows", () => {
    const manager = createManager();
    const panel = createPanel();

    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });

    expect(manager.getWindow("calculator")).toMatchObject({ id: "calculator", title: "Calculator" });
    expect(panel.getAttribute("data-vb-shell-window")).toBe("calculator");

    manager.unregisterWindow("calculator");

    expect(manager.getWindow("calculator")).toBeNull();
    expect(panel.hasAttribute("data-vb-shell-window")).toBe(false);
    manager.destroy();
  });

  it("activateWindow updates active state and z-index", () => {
    const manager = createManager();
    const first = createPanel("first");
    const second = createPanel("second");
    first.hidden = false;
    second.hidden = false;
    manager.registerWindow({ id: "first", element: first });
    manager.registerWindow({ id: "second", element: second });

    manager.activateWindow("first");
    manager.activateWindow("second");

    expect(Number(second.style.zIndex)).toBeGreaterThan(Number(first.style.zIndex));
    expect(second.getAttribute("data-vb-shell-window-active")).toBe("true");
    expect(first.getAttribute("data-vb-shell-window-active")).toBe("false");
    manager.destroy();
  });

  it("openWindow shows and activates", () => {
    const manager = createManager();
    const panel = createPanel();
    const open = vi.fn(() => {
      panel.hidden = false;
    });
    manager.registerWindow({ id: "player", element: panel, lifecycle: { open } });

    const record = manager.openWindow("player");

    expect(open).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(false);
    expect(record.active).toBe(true);
    manager.destroy();
  });

  it("closeWindow hides and persists closed state", () => {
    const manager = createManager();
    const panel = createPanel();
    panel.hidden = false;
    manager.registerWindow({ id: "energy", element: panel });

    manager.closeWindow("energy", { flush: true });

    expect(panel.hidden).toBe(true);
    expect(readStoredWindow("energy").state).toBe("closed");
    manager.destroy();
  });

  it("minimizeWindow hides but does not call destructive close lifecycle", () => {
    const manager = createManager();
    const panel = createPanel();
    panel.hidden = false;
    const close = vi.fn();
    const minimize = vi.fn(() => {
      panel.hidden = true;
    });
    manager.registerWindow({ id: "player", element: panel, lifecycle: { close, minimize } });

    manager.minimizeWindow("player");

    expect(panel.hidden).toBe(true);
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(manager.getWindow("player")).toMatchObject({ state: "minimized", minimized: true });
    manager.destroy();
  });

  it("restoreWindow restores minimized window and activates it", () => {
    const manager = createManager();
    const panel = createPanel();
    panel.hidden = false;
    manager.registerWindow({ id: "calculator", element: panel });
    manager.minimizeWindow("calculator");

    manager.restoreWindow("calculator");

    expect(panel.hidden).toBe(false);
    expect(manager.getActiveWindow().id).toBe("calculator");
    expect(manager.getWindow("calculator").state).toBe("open");
    manager.destroy();
  });

  it("updateWindowBounds persists layout", () => {
    const manager = createManager();
    const panel = createPanel();
    manager.registerWindow({ id: "milkdrop", element: panel });

    manager.updateWindowBounds("milkdrop", { left: 70, top: 80, width: 500, height: 360 }, { flush: true });

    expect(panel.style.left).toBe("70px");
    expect(readStoredWindow("milkdrop").bounds).toEqual({ left: 70, top: 80, width: 500, height: 360 });
    manager.destroy();
  });

  it("duplicate registration updates record without duplicate listeners", () => {
    const manager = createManager();
    const panel = createPanel();
    panel.hidden = false;
    let activated = 0;
    manager.subscribe(({ event }) => {
      if (event === "activated") activated += 1;
    });

    manager.registerWindow({ id: "calculator", title: "Old", element: panel });
    manager.registerWindow({ id: "calculator", title: "New", element: panel });

    panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(manager.getWindow("calculator").title).toBe("New");
    expect(activated).toBe(1);
    manager.destroy();
  });

  it("unknown window operations are safe no-ops", () => {
    const manager = createManager();

    expect(manager.openWindow("missing")).toBeNull();
    expect(manager.closeWindow("missing")).toBeNull();
    expect(manager.minimizeWindow("missing")).toBeNull();
    expect(manager.restoreWindow("missing")).toBeNull();
    expect(manager.updateWindowBounds("missing", { left: 1, top: 2 })).toBeNull();
    manager.destroy();
  });

  it("modal z-index ceiling is never crossed", () => {
    const manager = createManager();
    const panels = Array.from({ length: 4 }, (_, index) => {
      const panel = createPanel(`panel-${index}`);
      panel.hidden = false;
      manager.registerWindow({ id: `panel-${index}`, element: panel });
      return panel;
    });

    for (let index = 0; index < 1200; index += 1) {
      manager.activateWindow(`panel-${index % panels.length}`);
    }

    expect(Math.max(...panels.map((panel) => Number(panel.style.zIndex)))).toBeLessThan(1950);
    manager.destroy();
  });

  it("normal windows open below measured route toolbar and above the taskbar recovery area", () => {
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-vb-shell-toolbar", "");
    mockRect(toolbar, { left: 0, top: 0, right: 1024, bottom: 64, width: 1024, height: 64 });
    document.body.append(toolbar);
    const taskbar = document.createElement("nav");
    taskbar.setAttribute("data-vb-shell-taskbar", "");
    taskbar.setAttribute("data-vb-shell-taskbar-position", "bottom");
    mockRect(taskbar, { left: 300, top: 700, right: 724, bottom: 758, width: 424, height: 58 });
    document.body.append(taskbar);
    expect(toolbar.getBoundingClientRect().bottom).toBe(64);
    expect(document.querySelectorAll("[data-vb-shell-toolbar]")).toHaveLength(1);
    expect(getShellWorkArea().top).toBe(80);

    const manager = createManager();
    const panel = createPanel();
    manager.registerWindow({ id: "camera-map", element: panel, bounds: { left: 20, top: 0, width: 900, height: 700 } });
    manager.openWindow("camera-map");

    expect(Number.parseInt(panel.style.top, 10)).toBeGreaterThanOrEqual(80);
    expect(Number.parseInt(panel.style.height, 10)).toBeLessThanOrEqual(604);
    manager.destroy();
  });

  it("restore normalizes stale persisted bounds under the toolbar", () => {
    localStorage.setItem(SHELL_LAYOUT_STORAGE_KEY, JSON.stringify({
      version: 1,
      activeWindowId: "calculator",
      windows: {
        calculator: {
          state: "open",
          previousState: "closed",
          bounds: { left: 8, top: 8, width: 320, height: 220 },
          restoreBounds: { left: 8, top: 8, width: 320, height: 220 },
          zIndex: 1000,
          minimized: false,
          snap: null,
        },
      },
    }));
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-vb-shell-toolbar", "");
    mockRect(toolbar, { left: 0, top: 0, right: 1024, bottom: 72, width: 1024, height: 72 });
    document.body.append(toolbar);

    const manager = createManager();
    const panel = createPanel();
    manager.registerWindow({ id: "calculator", element: panel });
    manager.restoreShellLayout();

    expect(Number.parseInt(panel.style.top, 10)).toBeGreaterThanOrEqual(88);
    manager.destroy();
  });

  it("fullscreen windows bypass normal chrome reservations and restore clamped normal bounds", () => {
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-vb-shell-toolbar", "");
    mockRect(toolbar, { left: 0, top: 0, right: 1024, bottom: 72, width: 1024, height: 72 });
    document.body.append(toolbar);
    const manager = createManager();
    const panel = createPanel();
    manager.registerWindow({
      id: "milkdrop",
      element: panel,
      capabilities: { fullscreen: true },
      bounds: { left: 24, top: 96, width: 480, height: 360 },
    });

    manager.fullscreenWindow("milkdrop");

    expect(manager.getWindow("milkdrop").state).toBe("fullscreen");
    expect(panel.getAttribute("data-vb-shell-window-fullscreen")).toBe("true");
    expect(panel.style.top).toBe("0px");
    expect(panel.style.height).toBe("768px");
    expect(Number(panel.style.zIndex)).toBe(1980);

    manager.exitFullscreenWindow("milkdrop");

    expect(manager.getWindow("milkdrop").state).toBe("open");
    expect(panel.getAttribute("data-vb-shell-window-fullscreen")).toBe("false");
    expect(Number.parseInt(panel.style.top, 10)).toBeGreaterThanOrEqual(88);
    expect(Number(panel.style.zIndex)).toBeLessThan(1950);
    manager.destroy();
  });

  it("persists shell preferences and applies root attributes", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const manager = createShellWindowManager({
      root,
      storeOptions: { storage: localStorage, migrateLegacy: false },
      preferenceStorage: localStorage,
    });

    manager.setShellPreference("taskbarPosition", "left");
    manager.setShellPreference("windowDensity", "compact");

    expect(manager.getShellPreference("taskbarPosition")).toBe("left");
    expect(root.getAttribute("data-vb-shell-taskbar-position")).toBe("left");
    expect(root.getAttribute("data-vb-shell-density")).toBe("compact");
    manager.destroy();
  });
});
