import { beforeEach, describe, expect, it } from "vitest";
import { CalcCore } from "../../src/calculator/calc-core.js";
import { setLang } from "../../src/i18n.js";

const STATE_KEY = "embeddable_calc_state_v1";
const HISTORY_KEY = "embeddable_calc_history_v1";

describe("CalcCore", () => {
  beforeEach(() => {
    localStorage.clear();
    window.__lang = "en";
    setLang("en");
  });

  it("evaluates normalized arithmetic and persists the result", async () => {
    const core = new CalcCore();

    core.setExpr("2×3");
    const result = await core.evaluate();

    expect(result).toEqual({ ok: true, result: "6" });
    expect(core.expr).toBe("6");
    expect(core.lastExpr).toBe("2×3");
    expect(JSON.parse(localStorage.getItem(STATE_KEY))).toMatchObject({
      expr: "6",
      lastExpr: "2×3",
      lastResult: "6",
      status: "2*3",
    });
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY))).toEqual([
      { expr: "2×3", result: "6" },
    ]);
  });

  it("normalizes binary floating-point artifacts before persisting results", async () => {
    const core = new CalcCore();

    core.setExpr("40-31.37");
    expect(await core.evaluate()).toEqual({ ok: true, result: "8.63" });
    expect(core.expr).toBe("8.63");
    expect(core.lastResult).toBe("8.63");
    expect(JSON.parse(localStorage.getItem(STATE_KEY))).toMatchObject({
      expr: "8.63",
      lastResult: "8.63",
    });
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY))[0]).toEqual({
      expr: "40-31.37",
      result: "8.63",
    });
  });

  it.each([
    ["0.1+0.2", 8, "0.3"],
    ["1.005", 2, "1.01"],
    ["1/3", 0, "0"],
    ["1/3", 2, "0.33"],
    ["1/3", 8, "0.33333333"],
    ["1/3", 10, "0.3333333333"],
    ["-0.0000000001", 8, "0"],
    ["sqrt(2)", 8, "1.41421356"],
    ["100+10%", 8, "110"],
  ])("normalizes %s at %i decimal places", async (expression, decimals, expected) => {
    const core = new CalcCore();
    core.setExpr(expression);

    expect(await core.evaluate(decimals)).toEqual({ ok: true, result: expected });
  });

  it("clamps result precision and uses the normalized result for chaining", async () => {
    const core = new CalcCore();

    core.setExpr("1/3");
    expect(await core.evaluate(99)).toEqual({ ok: true, result: "0.3333333333" });
    core.append("+1");
    expect(await core.evaluate(2)).toEqual({ ok: true, result: "1.33" });
  });

  it("preserves established non-finite and non-real result strings", async () => {
    const core = new CalcCore();

    core.setExpr("1/0");
    expect(await core.evaluate(2)).toEqual({ ok: true, result: "Infinity" });

    core.setExpr("sqrt(-1)");
    expect(await core.evaluate(2)).toEqual({ ok: true, result: "i" });
  });

  it("applies unary and binary percent rules", async () => {
    const core = new CalcCore();

    core.setExpr("100+10%");
    expect(await core.evaluate()).toEqual({ ok: true, result: "110" });

    core.setExpr("50%10");
    expect(await core.evaluate()).toEqual({ ok: true, result: "5" });
  });

  it("blocks unsupported characters", async () => {
    const core = new CalcCore();

    core.setExpr("2+foo");
    const result = await core.evaluate();

    expect(result).toEqual({
      ok: false,
      error: "Blocked: unsupported characters",
    });
    expect(core.status).toBe("Blocked: unsupported characters");
  });

  it("toggles back to the last expression when re-evaluating a displayed result", async () => {
    const core = new CalcCore();

    core.setExpr("2+2");
    await core.evaluate();

    const toggled = await core.evaluate();

    expect(toggled).toEqual({ ok: true, result: "2+2", toggled: true });
    expect(core.expr).toBe("2+2");
    expect(core.status).toBe("");
  });

  it("updates trailing numbers with sign and power helpers", () => {
    const core = new CalcCore();

    core.setExpr("10");
    core.toggleSign();
    expect(core.expr).toBe("-10");

    core.toggleSign();
    expect(core.expr).toBe("10");

    core.sqrtTrailingNumber();
    expect(core.expr).toBe("sqrt(10)");

    core.setExpr("8");
    core.squareTrailingNumber();
    expect(core.expr).toBe("(8)^2");

    core.setExpr("(");
    expect(core.smartParen()).toBe(")");
    core.setExpr("");
    expect(core.smartParen()).toBe("(");
  });
});
