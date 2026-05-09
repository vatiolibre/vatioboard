import { beforeEach, describe, expect, it, vi } from "vitest";
import { createShellTaskbar } from "../../src/shared/shell-taskbar.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";

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

function pointer(type, init) {
  return new PointerEvent(type, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    bubbles: true,
    ...init,
  });
}

describe("shell-taskbar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("does not render registered closed windows before first open", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    expect(taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeNull();
    expect(taskbar.getElement().hidden).toBe(true);

    taskbar.destroy();
    manager.destroy();
  });

  it("adds a floating FAB to the taskbar the first time a window opens", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    manager.openWindow("calculator");

    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    expect(item).toBeTruthy();
    expect(item.classList.contains("vb-shell-taskbar-fab")).toBe(true);
    expect(item.classList.contains("dock-btn")).toBe(true);
    expect(item.getAttribute("data-vb-shell-taskbar-docked")).toBe("true");
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
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("calculator");

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

  it("lets a taskbar FAB detach and move as a floating FAB", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("calculator");

    const item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 600,
      right: 152,
      bottom: 652,
      width: 52,
      height: 52,
      x: 100,
      y: 600,
      toJSON: () => {},
    });

    item.dispatchEvent(pointer("pointerdown", { clientX: 110, clientY: 610 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 160, clientY: 560 }));
    window.dispatchEvent(pointer("pointerup", { clientX: 160, clientY: 560 }));

    const detached = document.querySelector("[data-vb-shell-taskbar-item='calculator']");
    expect(detached.getAttribute("data-vb-shell-taskbar-docked")).toBe("false");
    expect(detached.classList.contains("is-detached")).toBe(true);
    expect(detached.style.position).toBe("fixed");
    expect(detached.parentElement).toBe(document.body);

    taskbar.destroy();
    manager.destroy();
  });

  it("lets a detached FAB return to the taskbar by dropping it on the tray", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("calculator");
    vi.spyOn(taskbar.getElement(), "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 690,
      right: 360,
      bottom: 760,
      width: 360,
      height: 70,
      x: 0,
      y: 690,
      toJSON: () => {},
    });

    let item = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 600,
      right: 152,
      bottom: 652,
      width: 52,
      height: 52,
      x: 100,
      y: 600,
      toJSON: () => {},
    });
    item.dispatchEvent(pointer("pointerdown", { clientX: 110, clientY: 610 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 180, clientY: 550 }));
    window.dispatchEvent(pointer("pointerup", { clientX: 180, clientY: 550 }));

    item = document.querySelector("[data-vb-shell-taskbar-item='calculator']");
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue({
      left: 170,
      top: 540,
      right: 222,
      bottom: 592,
      width: 52,
      height: 52,
      x: 170,
      y: 540,
      toJSON: () => {},
    });
    item.dispatchEvent(pointer("pointerdown", { clientX: 180, clientY: 550 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 30, clientY: 720 }));
    window.dispatchEvent(pointer("pointerup", { clientX: 30, clientY: 720 }));

    const docked = taskbar.getElement().querySelector("[data-vb-shell-taskbar-item='calculator']");
    expect(docked).toBeTruthy();
    expect(docked.getAttribute("data-vb-shell-taskbar-docked")).toBe("true");
    expect(docked.style.position).toBe("");

    taskbar.destroy();
    manager.destroy();
  });

  it("moves the taskbar tray from empty tray space and persists the position", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
    const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
    manager.openWindow("calculator");

    const rectSpy = vi.spyOn(taskbar.getElement(), "getBoundingClientRect").mockReturnValue({
      left: 120,
      top: 690,
      right: 240,
      bottom: 760,
      width: 120,
      height: 70,
      x: 120,
      y: 690,
      toJSON: () => {},
    });

    taskbar.getElement().dispatchEvent(pointer("pointerdown", { clientX: 225, clientY: 724 }));
    taskbar.getElement().dispatchEvent(pointer("pointermove", { clientX: 260, clientY: 650 }));
    taskbar.getElement().dispatchEvent(pointer("pointermove", { clientX: 300, clientY: 610 }));
    taskbar.getElement().dispatchEvent(pointer("pointermove", { clientX: 325, clientY: 584 }));
    taskbar.getElement().dispatchEvent(pointer("pointerup", { clientX: 325, clientY: 584 }));

    expect(rectSpy.mock.calls.length).toBeLessThan(3);
    expect(taskbar.getElement().getAttribute("data-vb-shell-taskbar-floating")).toBe("true");
    expect(taskbar.getElement().style.position).toBe("fixed");
    expect(taskbar.getElement().style.left).toBe("220px");
    expect(taskbar.getElement().style.top).toBe("550px");
    expect(JSON.parse(localStorage.getItem("vatioboard.shell.taskbar_fabs.v1")).taskbar)
      .toMatchObject({ detached: true, left: 220, top: 550 });

    taskbar.destroy();
    const nextTaskbar = createShellTaskbar({ shellManager: manager, root: document.body });

    expect(nextTaskbar.getElement().style.position).toBe("fixed");
    expect(nextTaskbar.getElement().style.left).toBe("220px");
    expect(nextTaskbar.getElement().style.top).toBe("550px");

    nextTaskbar.destroy();
    manager.destroy();
  });

  it("uses compositor transform while dragging the taskbar tray", () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => {
      callback(performance.now());
      return 1;
    };
    globalThis.cancelAnimationFrame = () => {};

    const manager = makeManager();
    const taskbarCleanup = [];

    try {
      manager.registerWindow({ id: "calculator", title: "Calculator", element: makePanel() });
      const taskbar = createShellTaskbar({ shellManager: manager, root: document.body });
      taskbarCleanup.push(() => taskbar.destroy());
      manager.openWindow("calculator");

      vi.spyOn(taskbar.getElement(), "getBoundingClientRect").mockReturnValue({
        left: 120,
        top: 690,
        right: 240,
        bottom: 760,
        width: 120,
        height: 70,
        x: 120,
        y: 690,
        toJSON: () => {},
      });

      taskbar.getElement().dispatchEvent(pointer("pointerdown", {
        pointerType: "touch",
        clientX: 225,
        clientY: 724,
      }));
      taskbar.getElement().dispatchEvent(pointer("pointermove", {
        pointerType: "touch",
        clientX: 265,
        clientY: 684,
      }));

      expect(taskbar.getElement().style.left).toBe("120px");
      expect(taskbar.getElement().style.top).toBe("690px");
      expect(taskbar.getElement().style.transform).toContain("translate3d");
      expect(taskbar.getElement().style.willChange).toBe("transform");

      taskbar.getElement().dispatchEvent(pointer("pointerup", {
        pointerType: "touch",
        clientX: 265,
        clientY: 684,
      }));

      expect(taskbar.getElement().style.transform).toBe("none");
      expect(taskbar.getElement().style.left).toBe("160px");
      expect(taskbar.getElement().style.top).toBe("650px");
    } finally {
      for (const cleanup of taskbarCleanup) cleanup();
      manager.destroy();
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
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
});
