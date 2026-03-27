import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadBoolean,
  loadJson,
  loadNumber,
  loadText,
  removeStoredValue,
  saveBoolean,
  saveJson,
  saveNumber,
  saveText,
} from "../../src/shared/storage.js";

describe("shared storage helper", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads and saves text values with defaults", () => {
    expect(loadText("missing", "fallback")).toBe("fallback");

    saveText("text-key", "value");

    expect(loadText("text-key", "fallback")).toBe("value");
  });

  it("loads and saves booleans as string values", () => {
    expect(loadBoolean("missing-true", true)).toBe(true);
    expect(loadBoolean("missing-false", false)).toBe(false);

    saveBoolean("flag", false);
    expect(localStorage.getItem("flag")).toBe("false");
    expect(loadBoolean("flag", true)).toBe(false);
  });

  it("loads and saves validated numbers", () => {
    saveNumber("distance", 42.5);
    expect(localStorage.getItem("distance")).toBe("42.5");
    expect(loadNumber("distance", 0)).toBe(42.5);

    localStorage.setItem("distance", "0");
    expect(loadNumber("distance", 10, { validate: (value) => value > 0 })).toBe(10);
    expect(loadNumber("bad-number", 7)).toBe(7);
  });

  it("loads and saves JSON values safely", () => {
    const value = { nested: true, count: 2 };
    saveJson("json-key", value);
    expect(loadJson("json-key", null)).toEqual(value);

    localStorage.setItem("json-key", "{broken");
    expect(loadJson("json-key", { fallback: true })).toEqual({ fallback: true });
  });

  it("removes values and survives storage errors", () => {
    saveText("cleanup", "x");
    removeStoredValue("cleanup");
    expect(localStorage.getItem("cleanup")).toBeNull();

    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadText("blocked", "fallback")).toBe("fallback");
    getItem.mockRestore();
  });
});
