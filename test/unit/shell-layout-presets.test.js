import { beforeEach, describe, expect, it } from "vitest";
import {
  SHELL_NAMED_LAYOUTS_STORAGE_KEY,
  deleteNamedLayout,
  exportNamedLayout,
  importNamedLayout,
  listNamedLayouts,
  loadNamedLayout,
  renameNamedLayout,
  saveNamedLayout,
} from "../../src/shared/shell-layout-presets.js";
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

describe("shell-layout-presets", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("saves named layout", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    manager.openWindow("calculator");

    const saved = saveNamedLayout("Driving", { shellManager: manager });

    expect(saved.name).toBe("Driving");
    expect(saved.layout.windows.calculator.state).toBe("open");
    manager.destroy();
  });

  it("loads named layout", () => {
    const manager = makeManager();
    const panel = makePanel();
    manager.registerWindow({ id: "calculator", element: panel });
    manager.openWindow("calculator");
    manager.updateWindowBounds("calculator", { left: 111, top: 90, width: 320, height: 220 });
    saveNamedLayout("Driving", { shellManager: manager });
    manager.closeWindow("calculator");

    expect(loadNamedLayout("Driving", { shellManager: manager })).toBe(true);

    expect(panel.hidden).toBe(false);
    expect(panel.style.left).toBe("111px");
    manager.destroy();
  });

  it("lists layouts", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    saveNamedLayout("B", { shellManager: manager });
    saveNamedLayout("A", { shellManager: manager });

    expect(listNamedLayouts().map((entry) => entry.name)).toEqual(["A", "B"]);
    manager.destroy();
  });

  it("renames layout", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    saveNamedLayout("Old", { shellManager: manager });

    expect(renameNamedLayout("Old", "New")).toBe(true);

    expect(listNamedLayouts().map((entry) => entry.name)).toEqual(["New"]);
    manager.destroy();
  });

  it("deletes layout", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    saveNamedLayout("Driving", { shellManager: manager });

    expect(deleteNamedLayout("Driving")).toBe(true);

    expect(listNamedLayouts()).toEqual([]);
    manager.destroy();
  });

  it("rejects invalid names", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });

    expect(saveNamedLayout("", { shellManager: manager })).toBeNull();
    expect(saveNamedLayout("bad/name", { shellManager: manager })).toBeNull();
    manager.destroy();
  });

  it("safely ignores corrupt storage", () => {
    localStorage.setItem(SHELL_NAMED_LAYOUTS_STORAGE_KEY, "{bad");

    expect(listNamedLayouts()).toEqual([]);
    expect(localStorage.getItem(SHELL_NAMED_LAYOUTS_STORAGE_KEY)).toBeNull();
  });

  it("skips missing windows when loading", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    localStorage.setItem(SHELL_NAMED_LAYOUTS_STORAGE_KEY, JSON.stringify({
      version: 1,
      layouts: {
        Driving: {
          name: "Driving",
          createdAt: 1,
          updatedAt: 1,
          layout: {
            version: 1,
            activeWindowId: "missing",
            windows: {
              missing: { state: "open", bounds: { left: 5, top: 6 } },
              calculator: { state: "open", bounds: { left: 7, top: 8 } },
            },
          },
        },
      },
    }));

    expect(loadNamedLayout("Driving", { shellManager: manager })).toBe(true);
    expect(manager.getWindow("missing")).toBeNull();
    expect(manager.getWindow("calculator").state).toBe("open");
    manager.destroy();
  });

  it("exports and imports layouts", () => {
    const manager = makeManager();
    manager.registerWindow({ id: "calculator", element: makePanel() });
    saveNamedLayout("Driving", { shellManager: manager });

    const payload = exportNamedLayout("Driving");
    deleteNamedLayout("Driving");
    const imported = importNamedLayout(payload);

    expect(imported.name).toBe("Driving");
    expect(listNamedLayouts()).toHaveLength(1);
    manager.destroy();
  });
});

