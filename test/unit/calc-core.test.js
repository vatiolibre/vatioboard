import { beforeEach, describe, expect, it, vi } from "vitest";

const STATE_KEY = "embeddable_calc_state_v1";
const HISTORY_KEY = "embeddable_calc_history_v1";

describe("CalcCore", () => {
  let CalcCore;

  beforeEach(async () => {
    localStorage.clear();
    window.__lang = "en";
    vi.resetModules();
    ({ CalcCore } = await import("../../src/calculator/calc-core.js"));
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
