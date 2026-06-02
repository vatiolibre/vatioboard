import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `Missing CSS block for ${selector}`).toBeTruthy();
  return match[1];
}

describe("calculator layout", () => {
  it("keeps header controls out of the history row and preserves keypad geometry", () => {
    const calculatorCss = readProjectFile("src/styles/calculator.less");
    const header = cssBlock(calculatorCss, ".calc-header");
    const headerMain = cssBlock(calculatorCss, ".calc-header-main");
    const headerControls = cssBlock(calculatorCss, ".calc-minimize,\n.calc-close");
    const display = cssBlock(calculatorCss, ".calc-display");
    const history = cssBlock(calculatorCss, ".calc-history-text");

    expect(header).toContain("min-height: 46px");
    expect(header).toContain("padding: 8px 90px 8px 10px");
    expect(header).toContain("box-sizing: border-box");
    expect(headerMain).toContain("position: absolute");
    expect(headerMain).toContain("inset: 0");
    expect(headerMain).toContain("pointer-events: none");
    expect(headerControls).toContain("top: 6px");
    expect(headerControls).toContain("width: 34px");
    expect(headerControls).toContain("height: 34px");
    expect(display).toContain("padding: 6px 12px 8px");
    expect(history).toContain("height: 26px");
    expect(history).toContain("min-height: 26px");
    expect(history).toContain("padding: 0 4px 8px");
    expect(history).toContain("white-space: nowrap");
  });

  it("does not start a calculator panel drag from the minimize button", () => {
    const dragSource = readProjectFile("src/calculator/widget/drag.ts");

    expect(dragSource).toContain(".calc-minimize, .calc-close, .calc-settings-btn");
  });
});
