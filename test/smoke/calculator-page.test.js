import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

describe("calculator.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("calculator.html");
  });

  it("boots the calculator demo and evaluates input", async () => {
    await import("../../src/calculator/calculator-demo.js");
    await flushTasks();

    expectPageSeo({
      title: "Embeddable Calculator Widget",
      hasDescription: false,
    });

    document.getElementById("openCalc").click();
    const panel = document.querySelector(".calc-panel");
    const input = panel.querySelector(".calc-expr");

    expect(panel.hidden).toBe(false);

    input.value = "2+2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushTasks();

    expect(document.getElementById("out").textContent).toBe("Result: 4");
  });
});
