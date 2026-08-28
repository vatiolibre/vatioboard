import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function getBlock(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Missing CSS block for ${selector}`).toBeTruthy();
  return match[1];
}

function expectScrollY(block) {
  expect(block).toContain("overflow-y: auto;");
  expect(block).toContain("overscroll-behavior: contain;");
  expect(block).toContain("-webkit-overflow-scrolling: touch;");
  expect(block).toContain("touch-action: pan-y;");
}

describe("touch scroll policy", () => {
  it("mirrors route body classes onto html so html-scoped touch policies activate", () => {
    const routeView = readStyle("src/app/views/route-view.ts");

    expect(routeView).toContain("document.documentElement.classList.add(...classNames);");
    expect(routeView).toContain("document.documentElement.classList.remove(...cleanupClassNames);");
  });

  it("keeps the Apps manager page scrollable after board styles have loaded", () => {
    const css = readStyle("src/apps/app-manager/app-manager.less");

    const pageBlock = getBlock(css, "html.apps-page,\nbody.apps-page");
    expect(pageBlock).toContain("overflow-y: hidden;");
    expect(pageBlock).toContain("-webkit-overflow-scrolling: touch;");
    expect(pageBlock).toContain("touch-action: pan-y pinch-zoom;");
    expect(getBlock(css, "html.apps-page #app,\nbody.apps-page #app")).toContain("overflow: hidden;");
    const appViewBlock = getBlock(css, "html.apps-page #app-view,\nbody.apps-page #app-view");
    expect(appViewBlock).toContain("overflow-y: auto;");
    expect(appViewBlock).toContain("overscroll-behavior: contain;");
    expect(appViewBlock).toContain("-webkit-overflow-scrolling: touch;");
    expect(appViewBlock).toContain("touch-action: pan-y pinch-zoom;");
    expect(css).toContain(".vb-app-manager,\n.vb-app-manager * {\n  touch-action: auto;");
    expect(css).toContain("body.apps-page .vb-floating-drag-handle");
    expect(css).toContain("body.apps-page .vb-shell-taskbar");
    expect(css).toContain("touch-action: none;");
  });

  it("bounds the Energy panel and makes multi-trip panes touch-scrollable", () => {
    const css = readStyle("src/styles/energy.less");

    const panelBlock = getBlock(css, ".energy-panel");
    expect(panelBlock).toContain("display: flex;");
    expect(panelBlock).toContain("height: min(570px, calc(100dvh - 92px");
    expect(panelBlock).toContain("max-height: calc(100dvh - 92px");

    expectScrollY(getBlock(css, ".energy-body"));
    expectScrollY(getBlock(css, ".energy-settings-body"));
    expectScrollY(getBlock(css, ".energy-multi-sidebar"));
    expectScrollY(getBlock(css, ".energy-trips-container"));
    expect(getBlock(css, ".energy-multi-view")).toContain("min-height: 0;");
  });

  it("lets Replay and Accel graph sheets scroll vertically while preserving horizontal scrub intent", () => {
    const replayCss = readStyle("src/styles/replay.less");
    const replayTs = readStyle("src/replay/replay.ts");
    const accelCss = readStyle("src/styles/accel.less");
    const accelTs = readStyle("src/accel/accel.ts");

    expectScrollY(getBlock(replayCss, ".replay-graph-sheet-grid"));
    expect(getBlock(replayCss, ".replay-graph-sheet")).toContain("z-index: var(--vb-z-modal, 2000);");
    expect(getBlock(replayCss, ".replay-graph-sheet,\n.replay-graph-sheet *")).toContain("touch-action: auto;");
    expect(getBlock(replayCss, ".replay-graph-sheet-canvas-wrap")).toContain("touch-action: pan-y;");
    expect(getBlock(replayCss, ".replay-expanded-graph-canvas")).toContain("touch-action: pan-y;");
    expect(replayTs).toContain("GRAPH_SCRUB_INTENT_THRESHOLD_PX");
    expect(replayTs).toContain("function shouldScrubImmediatelyFromPointer");
    expect(replayTs).toContain("!event?.pointerType || event.pointerType === 'mouse'");
    expect(replayTs).toContain("dy >= GRAPH_SCRUB_INTENT_THRESHOLD_PX && dy > dx");
    expect(replayTs).toContain("if (dx < GRAPH_SCRUB_INTENT_THRESHOLD_PX || dx <= dy) return;");

    expectScrollY(getBlock(accelCss, ".accel-replay-chart-sheet-grid"));
    expect(getBlock(accelCss, ".accel-replay-chart-sheet")).toContain("z-index: var(--vb-z-modal, 2000);");
    expect(getBlock(accelCss, ".accel-replay-chart-sheet,\n.accel-replay-chart-sheet *")).toContain("touch-action: auto;");
    expect(getBlock(accelCss, ".accel-replay-chart-canvas-wrap")).toContain("touch-action: pan-y;");
    expect(getBlock(accelCss, "body.accel-page .accel-replay-chart-canvas")).toContain("touch-action: pan-y;");
    expect(accelTs).toContain("ACCEL_CHART_SCRUB_INTENT_THRESHOLD_PX");
    expect(accelTs).toContain("function shouldScrubImmediatelyFromPointer");
    expect(accelTs).toContain("!event?.pointerType || event.pointerType === 'mouse'");
    expect(accelTs).toContain("dy >= ACCEL_CHART_SCRUB_INTENT_THRESHOLD_PX && dy > dx");
    expect(accelTs).toContain("if (dx < ACCEL_CHART_SCRUB_INTENT_THRESHOLD_PX || dx <= dy) return;");
  });

  it("makes secondary scrollable panels explicit touch-scroll islands", () => {
    expectScrollY(getBlock(readStyle("src/apps/code-rain/code-rain.less"), ".code-rain-panel__body"));
    expectScrollY(getBlock(readStyle("src/apps/tts/tts.less"), ".tts-body"));
    expectScrollY(getBlock(readStyle("src/apps/tts/tts.less"), ".tts-segments--voices"));
    expectScrollY(getBlock(readStyle("src/styles/speed-alert-panel.less"), ".speed-alert-window-body"));
    expectScrollY(getBlock(readStyle("src/styles/speed.less"), ".speed-alert-panel"));
    expectScrollY(getBlock(readStyle("src/styles/camera-map.less"), ".camera-map-approach-panel"));
    expectScrollY(getBlock(readStyle("src/styles/camera-map.less"), ".camera-map-layer-menu"));
    expectScrollY(getBlock(readStyle("src/styles/account-panel.less"), ".vb-account-panel-body"));
    expectScrollY(getBlock(readStyle("src/styles/calculator.less"), ".calc-history-list"));
    expectScrollY(getBlock(readStyle("src/styles/calculator.less"), ".calc-settings-body"));
  });

  it("resets SPA ancestors on other scrollable routes without changing Board", () => {
    const libraryCss = readStyle("src/styles/library.less");
    const replayCss = readStyle("src/styles/replay.less");
    const accelCss = readStyle("src/styles/accel.less");
    const codeRainCss = readStyle("src/apps/code-rain/code-rain.less");

    expect(libraryCss).toContain("html.library-page #app,\nhtml.library-page #app-view,\nbody.library-page #app,\nbody.library-page #app-view");
    expect(libraryCss).toContain("touch-action: pan-y pinch-zoom;");
    expect(replayCss).toContain('#app-view[data-vb-route="replay"] .replay-app');
    expect(replayCss).toContain("touch-action: auto;");
    expect(accelCss).toContain("body.accel-page #app,\nbody.accel-page #app-view,\nbody.accel-page .accel-app");
    expect(accelCss).toContain("touch-action: auto;");
    expect(codeRainCss).toContain("body.code-rain-page #app,\nbody.code-rain-page #app-view,\nbody.code-rain-page .code-rain-app");
    expect(codeRainCss).toContain("touch-action: auto;");
  });
});
