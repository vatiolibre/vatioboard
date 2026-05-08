import { beforeEach, describe, expect, it } from "vitest";
import {
  SHELL_LAYOUT_STORAGE_KEY,
  readShellLayout,
  writeShellLayout,
} from "../../src/shared/shell-layout-store.js";

describe("shell-layout-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads empty layout as default", () => {
    expect(readShellLayout({ migrateLegacy: false })).toEqual({
      version: 1,
      activeWindowId: null,
      windows: {},
    });
  });

  it("writes and reads v1 layout", () => {
    const layout = {
      version: 1,
      activeWindowId: "calculator",
      windows: {
        calculator: {
          state: "open",
          previousState: "closed",
          bounds: { left: 24, top: 40, width: 320, height: 260 },
          restoreBounds: null,
          zIndex: 1010,
          minimized: false,
          snap: null,
          updatedAt: 1,
        },
      },
    };

    expect(writeShellLayout(layout)).toBe(true);
    expect(readShellLayout()).toMatchObject(layout);
  });

  it("ignores corrupt JSON", () => {
    localStorage.setItem(SHELL_LAYOUT_STORAGE_KEY, "{not-json");

    expect(readShellLayout()).toEqual({
      version: 1,
      activeWindowId: null,
      windows: {},
    });
    expect(localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it("handles unavailable storage as best effort", () => {
    const storage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(readShellLayout({ storage })).toEqual({
      version: 1,
      activeWindowId: null,
      windows: {},
    });
    expect(writeShellLayout({ version: 1, activeWindowId: null, windows: {} }, { storage })).toBe(false);
  });

  it("ignores malformed window records", () => {
    localStorage.setItem(SHELL_LAYOUT_STORAGE_KEY, JSON.stringify({
      version: 1,
      activeWindowId: "bad",
      windows: {
        bad: { state: "floating-away", bounds: { left: 1, top: 2 } },
        good: { state: "closed", bounds: { left: 4, top: 5 }, zIndex: 1001 },
      },
    }));

    const layout = readShellLayout();

    expect(layout.activeWindowId).toBeNull();
    expect(layout.windows.bad).toBeUndefined();
    expect(layout.windows.good).toMatchObject({
      state: "closed",
      bounds: { left: 4, top: 5 },
    });
  });

  it("migrates known legacy calculator position and visibility", () => {
    localStorage.setItem("embeddable_calc_pos_v1", JSON.stringify({
      panel: { left: "80px", top: "44px" },
    }));
    localStorage.setItem("vatioboard.calc_panel.visible_v1", "open");

    const layout = readShellLayout();

    expect(layout.activeWindowId).toBe("calculator");
    expect(layout.windows.calculator).toMatchObject({
      state: "open",
      bounds: { left: 80, top: 44 },
    });
  });

  it("migrates known legacy energy position and visibility", () => {
    localStorage.setItem("energy_calc_pos_v1", JSON.stringify({
      panel: { left: "160px", top: "70px" },
    }));
    localStorage.setItem("vatioboard.energy_panel.visible_v1", "closed");

    const layout = readShellLayout();

    expect(layout.windows.energy).toMatchObject({
      state: "closed",
      bounds: { left: 160, top: 70 },
    });
  });

  it("preserves valid unknown future fields when possible", () => {
    localStorage.setItem(SHELL_LAYOUT_STORAGE_KEY, JSON.stringify({
      version: 2,
      activeWindowId: "future",
      shellPersonality: "dream",
      windows: {
        future: {
          state: "open",
          bounds: { left: 9, top: 10 },
          zIndex: 1015,
          minimized: false,
          snap: null,
          updatedAt: 3,
          customFutureField: { saved: true },
        },
      },
    }));

    const layout = readShellLayout();

    expect(layout.shellPersonality).toBe("dream");
    expect(layout.windows.future.customFutureField).toEqual({ saved: true });
    expect(layout.version).toBe(1);
  });
});
