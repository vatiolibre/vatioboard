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
    const panel = cssBlock(calculatorCss, ".calc-panel");
    const header = cssBlock(calculatorCss, ".calc-header");
    const headerMain = cssBlock(calculatorCss, ".calc-header-main");
    const headerControls = cssBlock(calculatorCss, ".calc-minimize,\n.calc-close");
    const display = cssBlock(calculatorCss, ".calc-display");
    const history = cssBlock(calculatorCss, ".calc-history-text");

    expect(panel).toContain("min-height: min(548px, calc(100dvh - 32px))");
    expect(panel).toContain("--vb-shell-visible-bottom-inset: 34px");
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

  it("provides a work-area-bounded unified short landscape keypad", () => {
    const calculatorCss = readProjectFile("src/styles/calculator.less");
    const calculatorWidget = readProjectFile("src/calculator/calculator-widget.ts");
    const landscape = cssBlock(calculatorCss, '.calc-panel[data-vb-shell-layout-mode="short-landscape"]');
    const landscapeDisplay = cssBlock(
      calculatorCss,
      '.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-history-text,\n.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-expr',
    );
    const utilityButton = cssBlock(
      calculatorCss,
      '.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-utility-btn',
    );
    const utilityLabel = cssBlock(
      calculatorCss,
      '.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-utility-btn-label',
    );
    const utilityIcon = cssBlock(
      calculatorCss,
      '.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-utility-btn svg',
    );
    const utilityRail = cssBlock(
      calculatorCss,
      '.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-utility-row',
    );
    const secondaryRail = cssBlock(
      calculatorCss,
      '.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-secondary-keys',
    );
    const keypad = cssBlock(calculatorCss, '.calc-panel[data-vb-shell-layout-mode="short-landscape"] .calc-keys');

    expect(landscape).toContain("grid-template-columns: 72px minmax(0, 1fr) 72px");
    expect(landscape).toContain("width: min(520px, var(--vb-work-area-width");
    expect(landscape).toContain("height: min(440px, var(--vb-work-area-height");
    expect(calculatorWidget).toContain("const width = Math.min(520, metrics.workArea.width)");
    expect(calculatorWidget).toContain("const height = Math.min(440, metrics.workArea.height)");
    expect(landscapeDisplay).toContain("text-align: center");
    expect(utilityRail).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(utilityRail).toContain("grid-auto-rows: 56px");
    expect(utilityRail).toContain("align-content: center");
    expect(secondaryRail).toContain("grid-column: 3");
    expect(secondaryRail).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(secondaryRail).toContain("grid-auto-rows: 56px");
    expect(secondaryRail).toContain("align-content: center");
    expect(utilityButton).toContain("min-width: var(--vb-touch-target-min, 44px)");
    expect(utilityButton).toContain("min-height: var(--vb-touch-target-min, 44px)");
    expect(utilityLabel).toContain("display: none");
    expect(utilityIcon).toContain("width: 22px");
    expect(utilityIcon).toContain("height: 22px");
    expect(keypad).toContain("grid-template-rows: repeat(5, minmax(44px, 1fr))");
    expect(keypad).toContain("grid-column: 2");
    expect(keypad).toContain("border-left: 0");
  });

  it("does not start a calculator panel drag from the minimize button", () => {
    const dragSource = readProjectFile("src/calculator/widget/drag.ts");

    expect(dragSource).toContain(".calc-minimize, .calc-close, .calc-settings-btn");
  });
});
