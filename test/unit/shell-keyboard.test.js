import { beforeEach, describe, expect, it } from "vitest";
import { installShellKeyboardShortcuts } from "../../src/shared/shell-keyboard.js";
import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";

function makePanel() {
  const panel = document.createElement("section");
  panel.hidden = true;
  document.body.append(panel);
  return panel;
}

function makeManager() {
  return createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
}

function send(target, init) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("shell-keyboard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("cycles next active window", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    manager.registerWindow({ id: "player", element: makePanel() });
    manager.openWindow("calculator");
    manager.openWindow("player");
    const keyboard = installShellKeyboardShortcuts({ shellManager: manager });

    send(window, { altKey: true, code: "Backquote", key: "`" });

    expect(manager.getActiveWindow().id).toBe("calculator");
    keyboard.uninstall();
    manager.destroy();
  });

  it("cycles previous active window", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    manager.registerWindow({ id: "energy", element: makePanel() });
    manager.registerWindow({ id: "player", element: makePanel() });
    manager.openWindow("calculator");
    manager.openWindow("energy");
    manager.openWindow("player");
    const keyboard = installShellKeyboardShortcuts({ shellManager: manager });

    send(window, { altKey: true, shiftKey: true, code: "Backquote", key: "`" });

    expect(manager.getActiveWindow().id).toBe("calculator");
    keyboard.uninstall();
    manager.destroy();
  });

  it("skips closed windows", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    manager.registerWindow({ id: "closed", element: makePanel() });
    manager.registerWindow({ id: "player", element: makePanel() });
    manager.openWindow("calculator");
    manager.openWindow("closed");
    manager.openWindow("player");
    manager.closeWindow("closed");
    const keyboard = installShellKeyboardShortcuts({ shellManager: manager });

    send(window, { altKey: true, code: "Backquote", key: "`" });

    expect(manager.getActiveWindow().id).toBe("calculator");
    keyboard.uninstall();
    manager.destroy();
  });

  it("ignores shortcuts inside inputs, textareas, and contenteditable", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    manager.registerWindow({ id: "player", element: makePanel() });
    manager.openWindow("calculator");
    manager.openWindow("player");
    const input = document.createElement("input");
    document.body.append(input);
    const keyboard = installShellKeyboardShortcuts({ shellManager: manager });

    send(input, { altKey: true, code: "Backquote", key: "`" });

    expect(manager.getActiveWindow().id).toBe("player");
    keyboard.uninstall();
    manager.destroy();
  });

  it("minimizes active window with configured shortcut", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "player", element: makePanel() });
    manager.openWindow("player");
    const keyboard = installShellKeyboardShortcuts({ shellManager: manager });

    send(window, { ctrlKey: true, altKey: true, key: "m" });

    expect(manager.getWindow("player").state).toBe("minimized");
    keyboard.uninstall();
    manager.destroy();
  });

  it("cleanup removes listeners", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    manager.registerWindow({ id: "player", element: makePanel() });
    manager.openWindow("calculator");
    manager.openWindow("player");
    const keyboard = installShellKeyboardShortcuts({ shellManager: manager });

    keyboard.uninstall();
    send(window, { altKey: true, code: "Backquote", key: "`" });

    expect(manager.getActiveWindow().id).toBe("player");
    manager.destroy();
  });
});

