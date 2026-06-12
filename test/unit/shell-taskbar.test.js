import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appControl } from "../../src/app-platform/index.js";
import { createShellTaskbar } from "../../src/shared/shell-taskbar.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";

const TASKBAR_STATE_KEY = "vatioboard.shell.taskbar_fabs.v1";
const TASKBAR_AVOID_BOTTOM_VAR = "--vb-shell-taskbar-avoid-bottom";
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;
const originalVisualViewport = globalThis.visualViewport;
const originalInnerWidth = globalThis.innerWidth;
const originalInnerHeight = globalThis.innerHeight;

function makeManager() {
  return createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
}

function makePanel(title = "Panel") {
  const panel = document.createElement("section");
  panel.hidden = true;
  panel.setAttribute("aria-label", title);
  document.body.appendChild(panel);
  return panel;
}

function rect({ left, top, width = 52, height = 52 }) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => {},
  };
}

function touchEvent(type, { identifier = 7, clientX, clientY, target = null } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touch = { identifier, clientX, clientY, pageX: clientX, pageY: clientY, target };
  Object.defineProperty(event, "changedTouches", {
    configurable: true,
    value: [touch],
  });
  Object.defineProperty(event, "touches", {
    configurable: true,
    value: type === "touchend" || type === "touchcancel" ? [] : [touch],
  });
  event.preventDefault = vi.fn();
  return event;
}

function pointer(type, init) {
  return new PointerEvent(type, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

function setupCalculatorTaskbar() {
  const manager = makeManager();
  manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
  const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
  manager.openWindow("calculator");
  return { manager, taskbar };
}

describe("shell-taskbar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.className = "";
    document.documentElement.style.removeProperty(TASKBAR_AVOID_BOTTOM_VAR);
    localStorage.clear();
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
    Object.defineProperty(globalThis, "visualViewport", {
      configurable: true,
      value: originalVisualViewport,
    });
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(globalThis, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
  });

  it("renders a Start button immediately without registered open windows", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-tray]")).toBeTruthy();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-drag-handle]")).toBeTruthy();
    expect(taskbar.getElement().querySelector("[data-vb-shell-start-button]")).toBeTruthy();
    expect(taskbar.getElement().querySelector("[data-vb-shell-account-button]")).toBeTruthy();
    expect(taskbar.getElement().hidden).toBe(false);
    expect(taskbar.getElement().getAttribute("data-vb-shell-taskbar-empty")).toBe("true");
    expect(taskbar.getElement().children[0]).toBe(taskbar.getStartButton());

    taskbar.destroy();
    manager.destroy();
  });

  it("binds the Start button to the provided shared Start menu API", () => {
    const manager = makeManager();
    const bindTrigger = vi.fn((button) => {
      button.setAttribute("aria-controls", "appStartMenuList");
      button.setAttribute("aria-expanded", "false");
    });
    const startMenu = {
      bindTrigger,
      close: vi.fn(),
      list: document.createElement("div"),
      setOpen: vi.fn(),
    };

    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body, startMenu });
    const startButton = taskbar.getStartButton();

    expect(bindTrigger).toHaveBeenCalledWith(startButton);
    expect(startButton).toBe(taskbar.getElement().querySelector("[data-vb-shell-start-button]"));
    expect(startButton.getAttribute("aria-label")).toBe("Start menu");
    expect(startButton.getAttribute("aria-haspopup")).toBe("true");
    expect(startButton.getAttribute("aria-controls")).toBe("appStartMenuList");
    expect(startButton.getAttribute("aria-expanded")).toBe("false");
    expect(startButton.style.getPropertyValue("--vb-app-icon-accent")).toBe("#16a34a");
    expect(startButton.draggable).toBe(false);

    taskbar.destroy();
    manager.destroy();
  });

  it("opens the account panel from the taskbar account button and reflects auth state", () => {
    const manager = makeManager();
    const accountPanel = { open: vi.fn() };
    const startMenu = { bindTrigger: vi.fn(), close: vi.fn() };
    const taskbar = createShellTaskbar({
      shellManager: manager,
      root: document.body,
      startMenu,
      accountPanel,
    });
    const accountButton = taskbar.getElement().querySelector("[data-vb-shell-account-button]");

    accountButton.click();

    expect(accountPanel.open).toHaveBeenCalledWith(expect.objectContaining({
      focus: true,
      source: "taskbar-account",
    }));
    expect(startMenu.close).toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: {
        authenticated: true,
        busy: false,
        isGuest: false,
        pendingLogout: false,
        user: "driver@example.com",
      },
    }));

    expect(accountButton.dataset.authState).toBe("authenticated");
    expect(accountButton.getAttribute("aria-label")).toContain("driver@example.com");

    taskbar.destroy();
    manager.destroy();
  });

  it("renders favorite apps after Start and before the drag handle", () => {
    const manager = makeManager();
    const appLauncher = { openApp: vi.fn(() => true) };
    const startMenu = { bindTrigger: vi.fn(), close: vi.fn() };
    const taskbar = createShellTaskbar({
      shellManager: manager,
      root: document.body,
      startMenu,
      appLauncher,
    });
    const favorites = taskbar.getElement().querySelector("[data-vb-shell-taskbar-favorites]");
    const handle = taskbar.getElement().querySelector("[data-vb-shell-taskbar-drag-handle]");
    const startButton = taskbar.getStartButton();

    expect(favorites).toBeTruthy();
    expect(favorites.hidden).toBe(true);

    appControl.setFavorite("vatio.board", true);
    const favoriteButton = favorites.querySelector("[data-vb-shell-taskbar-favorite-app='vatio.board']");
    const children = Array.from(taskbar.getElement().children);

    expect(favoriteButton).toBeTruthy();
    expect(favoriteButton.style.getPropertyValue("--vb-app-icon-accent")).toBe("#2563eb");
    expect(favorites.hidden).toBe(false);
    expect(children.indexOf(startButton)).toBeLessThan(children.indexOf(favorites));
    expect(children.indexOf(favorites)).toBeLessThan(children.indexOf(handle));
    expect(children[children.length - 1]).toBe(handle);

    favoriteButton.click();
    expect(appLauncher.openApp).toHaveBeenCalledWith(
      "vatio.board",
      expect.objectContaining({ focus: true }),
    );
    expect(startMenu.close).toHaveBeenCalled();

    appControl.setFavorite("vatio.board", false);
    expect(favorites.querySelector("[data-vb-shell-taskbar-favorite-app='vatio.board']")).toBeNull();
    expect(favorites.hidden).toBe(true);

    taskbar.destroy();
    manager.destroy();
  });

  it("uses one favorite taskbar control for a running favorite shell-window app", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const appLauncher = {
      openApp: vi.fn(() => {
        manager.openWindow("calculator");
        return true;
      }),
    };
    const startMenu = { bindTrigger: vi.fn(), close: vi.fn() };
    const taskbar = createShellTaskbar({
      shellManager: manager,
      root: document.body,
      startMenu,
      appLauncher,
    });

    appControl.setFavorite("vatio.calculator", true);

    let favoriteButton = taskbar.getElement().querySelector("[data-vb-shell-taskbar-favorite-app='vatio.calculator']");
    expect(favoriteButton).toBeTruthy();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    expect(favoriteButton.getAttribute("data-vb-shell-taskbar-running")).toBe("false");

    favoriteButton.click();

    expect(appLauncher.openApp).toHaveBeenCalledWith(
      "vatio.calculator",
      expect.objectContaining({ focus: true, source: "taskbar-favorite" }),
    );
    favoriteButton = taskbar.getElement().querySelector("[data-vb-shell-taskbar-favorite-app='vatio.calculator']");
    expect(favoriteButton.getAttribute("data-vb-shell-taskbar-running")).toBe("true");
    expect(favoriteButton.getAttribute("data-vb-shell-taskbar-state")).toBe("open");
    expect(favoriteButton.getAttribute("data-vb-shell-taskbar-active")).toBe("true");
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();

    favoriteButton.click();
    favoriteButton = taskbar.getElement().querySelector("[data-vb-shell-taskbar-favorite-app='vatio.calculator']");
    expect(manager.getWindow("calculator").state).toBe("minimized");
    expect(favoriteButton.getAttribute("data-vb-shell-taskbar-state")).toBe("minimized");
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();

    favoriteButton.click();
    favoriteButton = taskbar.getElement().querySelector("[data-vb-shell-taskbar-favorite-app='vatio.calculator']");
    expect(manager.getWindow("calculator").state).toBe("open");
    expect(favoriteButton.getAttribute("data-vb-shell-taskbar-state")).toBe("open");
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();

    appControl.setFavorite("vatio.calculator", false);

    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-favorite-app='vatio.calculator']")).toBeNull();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeTruthy();

    taskbar.destroy();
    manager.destroy();
  });

  it("adds a floating FAB to the taskbar tray the first time a window opens", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();

    const tray = taskbar.getElement().querySelector("[data-vb-shell-taskbar-tray]");
    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    expect(item).toBeTruthy();
    expect(item.parentElement).toBe(tray);
    expect(item.classList.contains("vb-shell-taskbar-fab")).toBe(true);
    expect(item.classList.contains("dock-btn")).toBe(true);
    expect(item.style.getPropertyValue("--vb-app-icon-accent")).toBe("#2563eb");
    expect(item.getAttribute("data-vb-shell-taskbar-docked")).toBe("true");
    expect(item.draggable).toBe(false);
    expect(item.getAttribute("draggable")).toBe("false");
    expect(item.ondragstart()).toBe(false);
    expect(taskbar.getElement().hidden).toBe(false);

    taskbar.destroy();
    manager.destroy();
  });

  it("keeps account visible while collapsing crowded mobile taskbar apps into overflow", () => {
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    Object.defineProperty(globalThis, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844,
    });
    const manager = makeManager();
    const ids = ["alpha", "bravo", "charlie", "delta", "echo"];
    for (const id of ids) {
      manager.registerWindow({ id, title: id, element: makePanel(id) });
    }
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    for (const id of ids) manager.openWindow(id);

    const element = taskbar.getElement();
    const tray = element.querySelector("[data-vb-shell-taskbar-tray]");
    const overflowButton = element.querySelector("[data-vb-shell-taskbar-overflow]");
    const accountButton = element.querySelector("[data-vb-shell-account-button]");
    const appCss = readFileSync(resolve(process.cwd(), "src/styles/app.less"), "utf8");

    expect(element.getAttribute("data-vb-shell-taskbar-mobile-overflow")).toBe("true");
    expect(tray.querySelectorAll("[data-vb-shell-taskbar-item]")).toHaveLength(2);
    expect(overflowButton.hidden).toBe(false);
    expect(overflowButton.textContent).toContain("+3");
    expect(accountButton).toBeTruthy();
    expect(accountButton.hidden).toBe(false);
    expect(appCss).not.toMatch(/data-vb-shell-taskbar-mobile-overflow="true"][^{]*\.vb-shell-taskbar-account\s*{\s*display:\s*none;/);

    overflowButton.click();

    const overflowPanel = document.querySelector("[data-vb-shell-taskbar-overflow-panel]");
    expect(overflowPanel.hidden).toBe(false);
    expect(overflowPanel.querySelectorAll("[data-vb-shell-taskbar-overflow-item]")).toHaveLength(5);

    overflowPanel.querySelector("[data-vb-shell-taskbar-overflow-item='alpha']").click();

    expect(manager.getActiveWindow().id).toBe("alpha");
    expect(overflowPanel.hidden).toBe(true);

    taskbar.destroy();
    expect(document.querySelector("[data-vb-shell-taskbar-overflow-panel]")).toBeNull();
    manager.destroy();
  });

  it("uses one visible app slot on very narrow iPhone layouts so account still fits", () => {
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      writable: true,
      value: 320,
    });
    Object.defineProperty(globalThis, "innerHeight", {
      configurable: true,
      writable: true,
      value: 568,
    });
    const manager = makeManager();
    const ids = ["alpha", "bravo", "charlie", "delta", "echo"];
    for (const id of ids) {
      manager.registerWindow({ id, title: id, element: makePanel(id) });
    }
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    for (const id of ids) manager.openWindow(id);

    const element = taskbar.getElement();
    const tray = element.querySelector("[data-vb-shell-taskbar-tray]");
    const overflowButton = element.querySelector("[data-vb-shell-taskbar-overflow]");
    const accountButton = element.querySelector("[data-vb-shell-account-button]");

    expect(element.getAttribute("data-vb-shell-taskbar-mobile-overflow")).toBe("true");
    expect(tray.querySelectorAll("[data-vb-shell-taskbar-item]")).toHaveLength(1);
    expect(overflowButton.textContent).toContain("+4");
    expect(accountButton).toBeTruthy();
    expect(accountButton.hidden).toBe(false);

    taskbar.destroy();
    manager.destroy();
  });

  it("keeps all docked taskbar apps visible on wider screens", () => {
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1024,
    });
    const manager = makeManager();
    const ids = ["alpha", "bravo", "charlie", "delta", "echo"];
    for (const id of ids) {
      manager.registerWindow({ id, title: id, element: makePanel(id) });
    }
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    for (const id of ids) manager.openWindow(id);

    const element = taskbar.getElement();
    const tray = element.querySelector("[data-vb-shell-taskbar-tray]");
    const overflowButton = element.querySelector("[data-vb-shell-taskbar-overflow]");

    expect(element.getAttribute("data-vb-shell-taskbar-mobile-overflow")).toBe("false");
    expect(tray.querySelectorAll("[data-vb-shell-taskbar-item]")).toHaveLength(5);
    expect(overflowButton.hidden).toBe(true);

    taskbar.destroy();
    manager.destroy();
  });

  it("removes a normal tray item when its window is closed", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();

    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeTruthy();

    manager.closeWindow("calculator");

    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    expect(taskbar.getElement().getAttribute("data-vb-shell-taskbar-empty")).toBe("true");
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).knownWindowIds).not.toContain("calculator");

    taskbar.destroy();
    manager.destroy();
  });

  it("prunes remembered closed windows from older taskbar state", () => {
    localStorage.setItem(TASKBAR_STATE_KEY, JSON.stringify({
      version: 1,
      knownWindowIds: ["calculator"],
      positions: { calculator: { detached: true, left: 120, top: 160 } },
      taskbar: null,
    }));
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    const stored = JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY));
    expect(stored.knownWindowIds).not.toContain("calculator");
    expect(stored.positions.calculator).toBeUndefined();

    taskbar.destroy();
    manager.destroy();
  });

  it("keeps taskbar and detached FAB layers above normal shell windows", () => {
    const appCss = readFileSync(resolve(process.cwd(), "src/styles/app.less"), "utf8");
    const manager = makeManager();
    const panel = makePanel();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: panel });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("calculator");

    expect(Number(panel.style.zIndex)).toBeLessThan(1950);
    expect(appCss).toContain(".vb-shell-taskbar");
    expect(appCss).toContain("z-index: var(--vb-z-shell-taskbar, 1950)");
    expect(appCss).toContain("--vb-shell-taskbar-avoid-bottom: 0px");
    expect(appCss).toContain("left: max(10px, var(--vb-safe-area-left))");
    expect(appCss).toContain("--vb-shell-taskbar-tray-glow-buffer: 8px");
    expect(appCss).toContain("background: transparent");
    expect(appCss).toContain("0 2px 8px color-mix(in srgb, var(--vb-app-icon-accent) 18%");
    expect(appCss).toContain(".vb-shell-taskbar-item.is-detached");
    expect(appCss).toContain("z-index: var(--vb-z-shell-taskbar, 1950)");

    taskbar.destroy();
    manager.destroy();
  });

  it("updates when a window is minimized and restored", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "player", title: "Player", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("player");
    manager.minimizeWindow("player");
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='player']")
      .getAttribute("data-vb-shell-taskbar-state")).toBe("minimized");

    manager.restoreWindow("player");
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='player']")
      .getAttribute("data-vb-shell-taskbar-state")).toBe("open");

    taskbar.destroy();
    manager.destroy();
  });

  it("clicking a minimized item restores the window", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "energy", title: "Energy", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("energy");
    manager.minimizeWindow("energy");

    taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='energy']").click();

    expect(manager.getWindow("energy").state).toBe("open");
    taskbar.destroy();
    manager.destroy();
  });

  it("clicking an inactive open item activates it", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    manager.registerWindow({ id: "player", title: "Player", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("calculator");
    manager.openWindow("player");

    taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']").click();

    expect(manager.getActiveWindow().id).toBe("calculator");
    taskbar.destroy();
    manager.destroy();
  });

  it("clicking an active item minimizes when allowed", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();

    taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']").click();

    expect(manager.getWindow("calculator").state).toBe("minimized");
    taskbar.destroy();
    manager.destroy();
  });

  it("does not bootstrap lazy player by rendering taskbar", () => {
    const manager = makeManager();
    const open = vi.fn();
    manager.registerWindow({
      id: "player",
      kind: "media",
      title: "Player",
      element: makePanel(),
      lazy: true,
      lifecycle: { open },
    });

    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    expect(open).not.toHaveBeenCalled();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='player']")).toBeNull();
    taskbar.destroy();
    manager.destroy();
  });

  it("moves the taskbar from the dedicated handle using document-level touch events", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const element = taskbar.getElement();
    const handle = element.querySelector("[data-vb-shell-taskbar-drag-handle]");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect({
      left: 120,
      top: 620,
      width: 120,
      height: 70,
    }));

    handle.dispatchEvent(touchEvent("touchstart", { target: handle, clientX: 225, clientY: 650 }));
    document.dispatchEvent(touchEvent("touchmove", { target: handle, clientX: 228, clientY: 652 }));

    expect(element.classList.contains("is-dragging")).toBe(false);
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).taskbar).toBeNull();

    document.dispatchEvent(touchEvent("touchmove", { target: handle, clientX: 525, clientY: 410 }));

    expect(element.classList.contains("is-dragging")).toBe(true);
    expect(element.style.transform).toContain("translate3d(300px, -240px, 0)");

    document.dispatchEvent(touchEvent("touchend", { target: handle, clientX: 525, clientY: 410 }));

    expect(element.classList.contains("is-dragging")).toBe(false);
    expect(document.documentElement.classList.contains("vb-floating-drag-active")).toBe(false);
    expect(element.style.position).toBe("fixed");
    expect(element.style.left).toBe("420px");
    expect(element.style.top).toBe("380px");
    expect(document.documentElement.style.getPropertyValue(TASKBAR_AVOID_BOTTOM_VAR)).toBe("0px");
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).taskbar)
      .toMatchObject({ detached: true, left: 420, top: 380 });

    taskbar.destroy();
    manager.destroy();
  });

  it("does not start whole-taskbar drag from the tray, Start button, or item buttons", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const element = taskbar.getElement();
    const item = element.querySelector("[data-vb-shell-taskbar-item='calculator']");
    const startButton = element.querySelector("[data-vb-shell-start-button]");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect({
      left: 120,
      top: 620,
      width: 120,
      height: 70,
    }));

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 225, clientY: 650 }));
    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 525, clientY: 410 }));

    expect(element.classList.contains("is-dragging")).toBe(false);
    expect(element.style.transform).not.toContain("translate3d(300px, -240px, 0)");

    startButton.dispatchEvent(touchEvent("touchstart", { target: startButton, clientX: 225, clientY: 650 }));
    document.dispatchEvent(touchEvent("touchmove", { target: startButton, clientX: 525, clientY: 410 }));

    expect(element.classList.contains("is-dragging")).toBe(false);
    expect(element.style.transform).not.toContain("translate3d(300px, -240px, 0)");

    taskbar.destroy();
    manager.destroy();
  });

  it("clamps a detached taskbar back into view on resize", () => {
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      width: { configurable: true, writable: true, value: 1024 },
      height: { configurable: true, writable: true, value: 768 },
      offsetLeft: { configurable: true, writable: true, value: 0 },
      offsetTop: { configurable: true, writable: true, value: 0 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(globalThis, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(globalThis, "innerWidth", { configurable: true, writable: true, value: 1024 });
    Object.defineProperty(globalThis, "innerHeight", { configurable: true, writable: true, value: 768 });
    localStorage.setItem(TASKBAR_STATE_KEY, JSON.stringify({
      version: 1,
      knownWindowIds: [],
      positions: {},
      taskbar: { detached: true, left: 900, top: 700 },
    }));
    const manager = makeManager();
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    const element = taskbar.getElement();

    expect(element.classList.contains("is-detached")).toBe(true);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect({
      left: 696,
      top: 696,
      width: 64,
      height: 64,
    }));

    viewport.width = 320;
    viewport.height = 240;
    globalThis.innerWidth = 320;
    globalThis.innerHeight = 240;
    viewport.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    taskbar.render();

    expect(element.style.left).toBe("248px");
    expect(element.style.top).toBe("168px");
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).taskbar)
      .toMatchObject({ detached: true, left: 248, top: 168 });

    taskbar.destroy();
    manager.destroy();
  });

  it("publishes the docked bottom taskbar inset for route-level layout", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const element = taskbar.getElement();
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect({
      left: 0,
      top: 690,
      width: 360,
      height: 70,
    }));

    taskbar.render();

    expect(document.documentElement.style.getPropertyValue(TASKBAR_AVOID_BOTTOM_VAR)).toBe("78px");

    taskbar.destroy();
    expect(document.documentElement.style.getPropertyValue(TASKBAR_AVOID_BOTTOM_VAR)).toBe("");
    manager.destroy();
  });

  it("moves the taskbar from the handle with mouse pointer events", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const element = taskbar.getElement();
    const handle = element.querySelector("[data-vb-shell-taskbar-drag-handle]");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect({
      left: 120,
      top: 620,
      width: 120,
      height: 70,
    }));

    handle.dispatchEvent(pointer("pointerdown", { clientX: 225, clientY: 650 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 525, clientY: 410 }));
    expect(element.style.transform).toContain("translate3d(300px, -240px, 0)");
    window.dispatchEvent(pointer("pointerup", { clientX: 525, clientY: 410 }));

    expect(element.style.left).toBe("420px");
    expect(element.style.top).toBe("380px");

    taskbar.destroy();
    manager.destroy();
  });

  it("redocks a detached taskbar when dropped in the lower-left dock zone", () => {
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      width: { configurable: true, writable: true, value: 1024 },
      height: { configurable: true, writable: true, value: 768 },
      offsetLeft: { configurable: true, writable: true, value: 0 },
      offsetTop: { configurable: true, writable: true, value: 0 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(globalThis, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(globalThis, "innerWidth", { configurable: true, writable: true, value: 1024 });
    Object.defineProperty(globalThis, "innerHeight", { configurable: true, writable: true, value: 768 });
    localStorage.setItem(TASKBAR_STATE_KEY, JSON.stringify({
      version: 1,
      knownWindowIds: [],
      positions: {},
      taskbar: { detached: true, left: 320, top: 260 },
    }));
    const manager = makeManager();
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    const element = taskbar.getElement();
    const handle = element.querySelector("[data-vb-shell-taskbar-drag-handle]");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect({
      left: 320,
      top: 260,
      width: 180,
      height: 70,
    }));

    handle.dispatchEvent(pointer("pointerdown", { clientX: 480, clientY: 295 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 28, clientY: 720 }));
    window.dispatchEvent(pointer("pointerup", { clientX: 28, clientY: 720 }));

    expect(element.classList.contains("is-detached")).toBe(false);
    expect(element.getAttribute("data-vb-shell-taskbar-floating")).toBe("false");
    expect(element.style.position).toBe("");
    expect(element.style.left).toBe("");
    expect(element.style.top).toBe("");
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).taskbar).toBeNull();

    taskbar.destroy();
    manager.destroy();
  });

  it("drags a docked FAB outside the taskbar with a fixed ghost and persists it", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(rect({ left: 100, top: 600 }));

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 110, clientY: 610 }));
    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 310, clientY: 420 }));

    const ghost = document.querySelector("[data-vb-shell-drag-ghost='calculator']");
    expect(document.querySelector("[data-vb-shell-drag-layer]")).toBeTruthy();
    expect(ghost).toBeTruthy();
    expect(ghost.style.transform).toContain("translate3d(200px, -190px, 0)");
    expect(item.classList.contains("is-drag-source")).toBe(true);

    document.dispatchEvent(touchEvent("touchend", { target: item, clientX: 310, clientY: 420 }));

    const detached = document.querySelector("[data-vb-shell-taskbar-item='calculator']");
    expect(document.querySelector("[data-vb-shell-drag-layer]")).toBeNull();
    expect(detached.getAttribute("data-vb-shell-taskbar-docked")).toBe("false");
    expect(detached.classList.contains("is-detached")).toBe(true);
    expect(detached.style.position).toBe("fixed");
    expect(detached.style.left).toBe("300px");
    expect(detached.style.top).toBe("410px");
    expect(detached.parentElement).toBe(document.body);
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).positions.calculator)
      .toMatchObject({ detached: true, left: 300, top: 410 });

    taskbar.destroy();
    manager.destroy();
  });

  it("lets a detached FAB return to the taskbar by touch-dropping near the tray", () => {
    localStorage.setItem(TASKBAR_STATE_KEY, JSON.stringify({
      version: 1,
      knownWindowIds: ["calculator"],
      positions: { calculator: { detached: true, left: 210, top: 210 } },
      taskbar: null,
    }));
    const { manager, taskbar } = setupCalculatorTaskbar();
    vi.spyOn(taskbar.getElement(), "getBoundingClientRect").mockReturnValue(rect({
      left: 0,
      top: 690,
      width: 360,
      height: 70,
    }));
    const item = document.querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(rect({ left: 210, top: 210 }));

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 220, clientY: 220 }));
    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 30, clientY: 720 }));
    document.dispatchEvent(touchEvent("touchend", { target: item, clientX: 30, clientY: 720 }));

    const docked = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    expect(docked).toBeTruthy();
    expect(docked.parentElement).toBe(taskbar.getElement().querySelector("[data-vb-shell-taskbar-tray]"));
    expect(docked.getAttribute("data-vb-shell-taskbar-docked")).toBe("true");
    expect(docked.style.position).toBe("");
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).positions.calculator).toBeUndefined();

    taskbar.destroy();
    manager.destroy();
  });

  it("keeps trash behavior when a FAB ghost is dropped into the trash target", () => {
    const manager = makeManager();
    const panel = makePanel();
    const close = vi.fn();
    manager.registerWindow({
      id: "calculator",
      title: "Calculator",
      element: panel,
      lifecycle: { close },
    });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("calculator");

    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(rect({ left: 100, top: 600 }));

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 110, clientY: 610 }));
    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 180, clientY: 550 }));

    const trash = document.querySelector("[data-vb-shell-taskbar-trash]");
    expect(trash).toBeTruthy();
    vi.spyOn(trash, "getBoundingClientRect").mockReturnValue(rect({
      left: 240,
      top: 520,
      width: 120,
      height: 70,
    }));

    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 300, clientY: 550 }));
    expect(trash.getAttribute("data-vb-shell-taskbar-trash-active")).toBe("true");

    document.dispatchEvent(touchEvent("touchend", { target: item, clientX: 300, clientY: 550 }));

    expect(document.querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    expect(taskbar.getElement().hidden).toBe(false);
    expect(taskbar.getElement().querySelector("[data-vb-shell-start-button]")).toBeTruthy();
    expect(trash.isConnected).toBe(false);
    expect(manager.getWindow("calculator").state).toBe("closed");
    expect(panel.hidden).toBe(true);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ taskbarTrash: true }));

    taskbar.destroy();
    manager.destroy();
  });

  it("asks player windows to stop playback when their FAB is dropped into trash", () => {
    const manager = makeManager();
    const close = vi.fn();
    manager.registerWindow({
      id: "player",
      kind: "media",
      title: "Player",
      element: makePanel("Player"),
      lifecycle: { close },
    });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("player");

    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='player']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(rect({ left: 100, top: 600 }));

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 110, clientY: 610 }));
    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 180, clientY: 550 }));

    const trash = document.querySelector("[data-vb-shell-taskbar-trash]");
    vi.spyOn(trash, "getBoundingClientRect").mockReturnValue(rect({
      left: 240,
      top: 520,
      width: 120,
      height: 70,
    }));

    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 300, clientY: 550 }));
    document.dispatchEvent(touchEvent("touchend", { target: item, clientX: 300, clientY: 550 }));

    expect(manager.getWindow("player").state).toBe("closed");
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      taskbarTrash: true,
      stopPlayback: true,
    }));

    taskbar.destroy();
    manager.destroy();
  });

  it("touch tap without crossing threshold still allows normal click behavior", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 110, clientY: 610 }));
    document.dispatchEvent(touchEvent("touchend", { target: item, clientX: 110, clientY: 610 }));
    item.click();

    expect(manager.getWindow("calculator").state).toBe("minimized");

    taskbar.destroy();
    manager.destroy();
  });

  it("suppresses the click immediately following a real drag", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(rect({ left: 100, top: 600 }));

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 110, clientY: 610 }));
    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 310, clientY: 420 }));
    document.dispatchEvent(touchEvent("touchend", { target: item, clientX: 310, clientY: 420 }));

    document.querySelector("[data-vb-shell-taskbar-item='calculator']").click();

    expect(manager.getWindow("calculator").state).toBe("open");

    taskbar.destroy();
    manager.destroy();
  });

  it("destroy during an active FAB touch drag removes listeners, ghost, layer, and classes", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(rect({ left: 100, top: 600 }));

    item.dispatchEvent(touchEvent("touchstart", { target: item, clientX: 110, clientY: 610 }));
    document.dispatchEvent(touchEvent("touchmove", { target: item, clientX: 310, clientY: 420 }));

    expect(document.querySelector("[data-vb-shell-drag-layer]")).toBeTruthy();
    expect(document.documentElement.classList.contains("vb-floating-drag-active")).toBe(true);

    taskbar.destroy();

    expect(document.querySelector("[data-vb-shell-drag-layer]")).toBeNull();
    expect(document.querySelector("[data-vb-shell-taskbar-trash]")).toBeNull();
    expect(document.documentElement.classList.contains("vb-floating-drag-active")).toBe(false);
    manager.destroy();
  });

  it("cleanup removes subscriptions and DOM", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    const element = taskbar.getElement();

    taskbar.destroy();
    manager.openWindow("calculator");

    expect(element.isConnected).toBe(false);
    expect(document.querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    manager.destroy();
  });

  it("does not depend on interact.js", () => {
    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    const source = readFileSync(resolve(process.cwd(), "src/shared/shell-taskbar.ts"), "utf8");

    expect(packageJson).not.toContain("\"interactjs\"");
    expect(source).not.toContain("interactjs");
    expect(source).not.toContain("interact(");
  });
});
