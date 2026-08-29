import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("acceleration shell layout", () => {
  it("uses the full short-landscape primary surface for a frameless gauge", () => {
    const accelCss = readStyle("src/styles/accel.less");

    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-main');
    expect(accelCss).toContain("padding-top: 4px;");
    expect(accelCss).toContain("grid-template-columns: minmax(0, 1fr) minmax(240px, 260px);");
    expect(accelCss).toContain("gap: 6px;");
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-primary-card::before');
    expect(accelCss).toContain("background: none;");
    expect(accelCss).toContain("box-shadow: none;");
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-primary-stage');
    expect(accelCss).toContain("inset: 2px;");
    expect(accelCss).toContain("--analog-speedometer-radius-ratio: 0.46;");
  });

  it("keeps test information as compact non-sizing overlays", () => {
    const accelCss = readStyle("src/styles/accel.less");

    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-sheet-trigger-floating');
    expect(accelCss).toContain("min-height: 48px;");
    expect(accelCss).toContain("width: min(230px, calc(100% - 8px));");
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-live-timer-wrap');
    expect(accelCss).toContain("bottom: 32px;");
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-progress-shell');
    expect(accelCss).toContain("height: 6px;");
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-feedback:empty');
  });

  it("flattens the side card and confines overflow to live partials", () => {
    const accelCss = readStyle("src/styles/accel.less");

    expect(accelCss).toContain("grid-template-rows: 56px minmax(0, 1fr);");
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-side-card::before');
    expect(accelCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-live-grid');
    expect(accelCss).toContain('html[data-vb-layout-profile="short-landscape"] .accel-live-partials');
    expect(accelCss).toContain("overflow-y: auto;");
  });

  it("preserves the shared regular-layout dial radius", () => {
    const analogCss = readStyle("src/styles/analog-speedometer.less");

    expect(analogCss).toContain("--analog-speedometer-radius-ratio: 0.42;");
  });

  it("turns short-landscape results into focused work-area views", () => {
    const accelCss = readStyle("src/styles/accel.less");
    const template = readStyle("src/app/views/templates/accel-template.ts");

    expect(accelCss).toContain("grid-template-rows: 52px minmax(0, 1fr);");
    expect(accelCss).toContain("width: var(--vb-work-area-width, 100vw);");
    expect(accelCss).toContain("height: var(--vb-work-area-height, 100dvh);");
    expect(accelCss).toContain('[data-accel-result-view="summary"]');
    expect(accelCss).toContain('[data-accel-result-view="map"]');
    expect(accelCss).toContain('[data-accel-result-view="details"]');
    expect(accelCss).toContain('[data-accel-result-view="history"]');
    expect(accelCss).toContain("grid-template-columns: minmax(0, 1fr) 240px;");
    expect(accelCss).toContain("grid-auto-rows: max-content;");
    expect(accelCss).toContain("scrollbar-gutter: stable;");
    expect(accelCss).toContain("grid-template-columns: minmax(0, 1fr) 76px;");
    expect(accelCss).toContain("grid-template-rows: 48px 48px minmax(0, 1fr);");
    expect(template).toContain('data-accel-result-chart-metric="speedMs"');
    expect(template).toContain('id="resultTechnicalDataToggle"');
  });
});
