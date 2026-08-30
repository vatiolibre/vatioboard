import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("speed shell layout", () => {
  it("sizes the universal frameless speed dial from available block space", () => {
    const speedCss = readStyle("src/styles/speed.less");

    expect(speedCss).toContain('.speed-stage{');
    expect(speedCss).toContain("grid-template-columns: minmax(0, 1fr) minmax(210px, 260px)");
    expect(speedCss).toContain('.gauge-stage-inner{');
    expect(speedCss).toContain("inset: 2px;");
    expect(speedCss).toContain("calc(100cqh - 4px)");
    expect(speedCss).toContain("--analog-speedometer-radius-ratio: 0.46;");
    expect(speedCss).toContain("height: 100%;");
    expect(speedCss).toContain("aspect-ratio: 1 / 1;");
    expect(speedCss).toContain('.gauge-card::before');
    expect(speedCss).toContain('.gauge-card.is-alert-over');
    expect(speedCss).toContain("background: none;");
    expect(speedCss).toContain("box-shadow: none;");
    expect(speedCss).not.toContain(".speed-view-switch");
    expect(speedCss).not.toContain("data-primary-view");
    expect(speedCss).not.toContain("--speed-primary-stage-top-padding");
  });

  it("keeps the universal alert trigger copy vertically contained", () => {
    const speedCss = readStyle("src/styles/speed.less");

    expect(speedCss).toContain('--speed-floating-control-height: 44px;');
    expect(speedCss).toContain('.speed-alert-trigger{');
    expect(speedCss).toContain('padding: 5px 12px;');
    expect(speedCss).toContain('.speed-alert-trigger-copy{');
    expect(speedCss).toContain('align-content: center;');
    expect(speedCss).toContain('gap: 1px;');
    expect(speedCss).toContain('.speed-alert-trigger-label{');
    expect(speedCss).toContain('.speed-alert-trigger-value{');
    expect(speedCss).toContain('line-height: 1.1;');
    expect(speedCss).toContain('.speed-alert-trigger-hint{');
    expect(speedCss).toContain('+ var(--speed-floating-control-height)');
  });

  it("compacts universal metrics and reserves space for the live globe", () => {
    const speedCss = readStyle("src/styles/speed.less");

    expect(speedCss).toContain("grid-template-rows: auto minmax(min(176px, 34dvh), 1fr);");
    expect(speedCss).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(speedCss).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(speedCss).toContain("min-height: 56px;");
    expect(speedCss).toContain('.metric-label{');
    expect(speedCss).toContain('.metric-unit{');
    expect(speedCss).toContain('.metric-card:has(#nearestTrapUnit) .metric-label');
    expect(speedCss).toContain('.metric-card strong{');
    expect(speedCss).toContain("grid-column: 1 / -1;");
    expect(speedCss).toContain('.globe-card-header{');
    expect(speedCss).toContain("min-height: min(176px, 34dvh);");
    expect(speedCss).toContain('.speed-audio-banner,');
  });
});
