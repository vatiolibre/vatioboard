import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addToHistory,
  clearHistory,
  loadHistory,
  loadSettings,
  loadState,
  saveSettings,
  saveState,
} from "../../src/calculator/storage.js";

const STATE_KEY = "embeddable_calc_state_v1";
const HISTORY_KEY = "embeddable_calc_history_v1";
const SETTINGS_KEY = "embeddable_calc_settings_v1";

describe("calculator storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads calculator state", () => {
    const state = {
      expr: "3*3",
      lastResult: "9",
      lastExpr: "3*3",
      status: "3*3",
    };

    saveState(state);

    expect(loadState()).toEqual(state);
  });

  it("handles malformed stored state and history safely", () => {
    localStorage.setItem(STATE_KEY, "{broken");
    localStorage.setItem(HISTORY_KEY, "{broken");

    expect(loadState()).toBeNull();
    expect(loadHistory()).toEqual([]);
  });

  it("deduplicates the latest history entry and caps the history length", () => {
    addToHistory("1+1", "2");
    addToHistory("1+1", "2");

    for (let index = 2; index <= 9; index += 1) {
      addToHistory(`${index}+${index}`, String(index * 2));
    }

    const history = loadHistory();

    expect(history).toHaveLength(7);
    expect(history[0]).toEqual({ expr: "9+9", result: "18" });
    expect(history[history.length - 1]).toEqual({ expr: "3+3", result: "6" });

    clearHistory();
    expect(loadHistory()).toEqual([]);
  });

  it("normalizes stored settings with defaults", () => {
    saveSettings({ decimals: 4, thousandSeparator: "." });
    expect(loadSettings()).toEqual({ decimals: 4, thousandSeparator: "." });

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ decimals: "bad" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
