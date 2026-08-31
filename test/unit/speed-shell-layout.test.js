import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import speedTemplate from "../../src/app/views/templates/speed-template.js";
import { applyTranslations, setLang } from "../../src/i18n.js";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("speed shell layout", () => {
  it("removes the redundant globe kicker while preserving navigation and accessibility labels", () => {
    document.body.innerHTML = speedTemplate;

    const globeTab = document.querySelector('[data-vb-focused-view-target="globe"]');
    const globeCard = document.querySelector(".globe-card");

    expect(document.querySelector(".globe-card-kicker")).toBeNull();
    expect(globeTab?.getAttribute("data-i18n")).toBe("liveGlobe");
    expect(globeCard?.getAttribute("data-i18n-aria")).toBe("currentLocationGlobe");
    expect(document.querySelector("#globeStatus")).not.toBeNull();

    setLang("es");
    applyTranslations();
    expect(globeTab?.textContent).toBe("Globo en vivo");
    expect(globeCard?.getAttribute("aria-label")).toBe("Globo de ubicación actual");
    setLang("en");
  });

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
    expect(speedCss).toContain("white-space: nowrap;");
    expect(speedCss).not.toContain('.globe-card-kicker{');
    expect(speedCss).toContain("min-height: min(176px, 34dvh);");
    expect(speedCss).toContain('.speed-audio-banner,');
  });
});
