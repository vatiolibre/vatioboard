import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("speed shell layout", () => {
  it("sizes the short-landscape speed dial from available block space", () => {
    const speedCss = readStyle("src/styles/speed.less");

    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .speed-stage');
    expect(speedCss).toContain("grid-template-columns: minmax(0, 1fr) minmax(210px, 260px)");
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .gauge-stage-inner');
    expect(speedCss).toContain("inset: 2px;");
    expect(speedCss).toContain("calc(100cqh - 4px)");
    expect(speedCss).toContain("--analog-speedometer-radius-ratio: 0.46;");
    expect(speedCss).toContain("height: 100%;");
    expect(speedCss).toContain("aspect-ratio: 1 / 1;");
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .gauge-card::before');
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .gauge-card.is-alert-over');
    expect(speedCss).toContain("background: none;");
    expect(speedCss).toContain("box-shadow: none;");
    expect(speedCss).not.toContain(".speed-view-switch");
    expect(speedCss).not.toContain("data-primary-view");
    expect(speedCss).not.toContain("--speed-primary-stage-top-padding");
  });

  it("compacts short-landscape metrics and reserves space for the live globe", () => {
    const speedCss = readStyle("src/styles/speed.less");

    expect(speedCss).toContain("grid-template-rows: auto minmax(min(176px, 34dvh), 1fr);");
    expect(speedCss).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(speedCss).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(speedCss).toContain("min-height: 56px;");
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .metric-label');
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .metric-unit');
    expect(speedCss).toContain('.metric-card:has(#nearestTrapUnit) .metric-label');
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .metric-card strong');
    expect(speedCss).toContain("grid-column: 1 / -1;");
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .globe-card-header');
    expect(speedCss).toContain("min-height: min(176px, 34dvh);");
    expect(speedCss).toContain('html[data-vb-layout-profile="short-landscape"] .speed-audio-banner');
  });
});
