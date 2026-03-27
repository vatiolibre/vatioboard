import { describe, expect, it } from "vitest";
import {
  isIncomplete,
  mapCursorPosition,
  toDisplay,
  toRaw,
} from "../../src/calculator/widget/number-format.js";

const DOT_GROUPING = { thousandSeparator: "." };

describe("number-format", () => {
  it("formats plain numbers for display", () => {
    expect(toDisplay("12345.67", DOT_GROUPING)).toBe("12.345,67");
    expect(toDisplay("-1234", DOT_GROUPING)).toBe("-1.234");
  });

  it("formats and normalizes expressions token by token", () => {
    expect(toDisplay("1234.5+sqrt(2500)-0.25", DOT_GROUPING)).toBe("1.234,5+sqrt(2.500)-0,25");
    expect(toRaw("1.234,5+sqrt(2.500)-0,25", DOT_GROUPING)).toBe("1234.5+sqrt(2500)-0.25");
  });

  it("keeps unsupported numeric strings unchanged", () => {
    expect(toDisplay("1e3", DOT_GROUPING)).toBe("1e3");
  });

  it("maps cursor positions after inserting separators", () => {
    expect(mapCursorPosition("1000", "1.000", 4)).toBe(5);
    expect(mapCursorPosition("1234,5", "1.234,5", 2)).toBe(3);
  });

  it("treats trailing separators and operators as incomplete input", () => {
    expect(isIncomplete("12,", DOT_GROUPING)).toBe(true);
    expect(isIncomplete("12+", DOT_GROUPING)).toBe(true);
    expect(isIncomplete("12", DOT_GROUPING)).toBe(false);
  });
});
