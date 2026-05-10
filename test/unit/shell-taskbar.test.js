import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShellTaskbar } from "../../src/shared/shell-taskbar.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";

const TASKBAR_STATE_KEY = "vatioboard.shell.taskbar_fabs.v1";
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

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
  });

  it("does not render registered closed windows before first open", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-tray]")).toBeTruthy();
    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-drag-handle]")).toBeTruthy();
    expect(taskbar.getElement().hidden).toBe(true);

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
    expect(item.getAttribute("data-vb-shell-taskbar-docked")).toBe("true");
    expect(item.draggable).toBe(false);
    expect(item.getAttribute("draggable")).toBe("false");
    expect(item.ondragstart()).toBe(false);
    expect(taskbar.getElement().hidden).toBe(false);

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
    expect(JSON.parse(localStorage.getItem(TASKBAR_STATE_KEY)).taskbar)
      .toMatchObject({ detached: true, left: 420, top: 380 });

    taskbar.destroy();
    manager.destroy();
  });

  it("does not start whole-taskbar drag from the tray or item buttons", () => {
    const { manager, taskbar } = setupCalculatorTaskbar();
    const element = taskbar.getElement();
    const item = element.querySelector("[data-vb-shell-taskbar-item='calculator']");
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

    taskbar.destroy();
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
    expect(taskbar.getElement().hidden).toBe(true);
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
    const source = readFileSync(resolve(process.cwd(), "src/shared/shell-taskbar.js"), "utf8");

    expect(packageJson).not.toContain("\"interactjs\"");
    expect(source).not.toContain("interactjs");
    expect(source).not.toContain("interact(");
  });
});
