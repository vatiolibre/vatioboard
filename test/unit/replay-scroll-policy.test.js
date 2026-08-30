import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("replay scroll policy", () => {
  it("keeps Replay viewport-bound while overriding imported board clipping", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).toContain('@import "./board.less";');
    expect(replayCss).toContain('#app-view[data-vb-route="replay"]');
    expect(replayCss).toContain("height: 100%;");
    expect(replayCss).toContain("overflow: hidden;");
    expect(replayCss).toContain("overscroll-behavior: none;");

    expect(replayCss).toContain('#app-view[data-vb-route="replay"] .replay-app');
    expect(replayCss).toContain("height: 100dvh;");
    expect(replayCss).toContain("min-height: 0;");
    expect(replayCss).toContain("flex: 1 1 auto;");
    expect(replayCss).toContain("overflow: hidden;");
    expect(replayCss).toContain("overscroll-behavior: contain;");
  });

  it("keeps the desktop replay shell bounded and scrolls only panel lists", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).toContain(".replay-shell{\n    width: 100%;\n    flex: 1 1 auto;");
    expect(replayCss).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(replayCss).toContain(".replay-stage{\n    display: grid;");
    expect(replayCss).toContain("align-items: stretch;");
    expect(replayCss).toContain(".replay-map-card{\n    display: grid;");
    expect(replayCss).toContain("grid-template-rows: minmax(0, 1fr) auto minmax(0, clamp(132px, 20vh, 230px));");
    expect(replayCss).toContain(".replay-details-card{\n    min-height: 0;");
    expect(replayCss).toContain(".replay-recordings-list{\n    position: relative;");
    expect(replayCss).toContain(".replay-highlights-list{\n    position: relative;");
    expect(replayCss).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(replayCss).toContain("overflow-y: auto;");
    expect(replayCss).toContain("overscroll-behavior: contain;");
    expect(replayCss).toContain("-webkit-overflow-scrolling: touch;");
    expect(replayCss).toContain("touch-action: pan-y;");
  });

  it("uses a universal map-first surface with overlay panels", () => {
    const replayCss = readStyle("src/styles/replay.less");
    const replayTemplate = readStyle("src/app/views/templates/replay-template.ts");

    expect(replayCss).toContain('html{\n    .replay-main{');
    expect(replayCss).toContain(".replay-graphs-card{\n        display: none;");
    expect(replayCss).toContain(".replay-map{\n        position: absolute;\n        inset: 0;");
    expect(replayCss).toContain('.replay-recordings-section[data-panel-open="true"]');
    expect(replayCss).toContain('.replay-side-panel[data-panel-open="true"]');
    expect(replayCss).toContain(".replay-map-transport-actions{");
    expect(replayTemplate).toContain('data-replay-open-panel="recordings"');
    expect(replayTemplate).toContain('data-replay-open-panel="charts"');
    expect(replayTemplate).toContain('data-replay-open-panel="details"');
  });

  it("uses one compact details card and removes replay copy rows", () => {
    const replayTemplate = readStyle("src/app/views/templates/replay-template.ts");
    const i18n = readStyle("src/i18n.ts");

    expect(replayTemplate).toContain('class="replay-card replay-details-card"');
    expect(replayTemplate).toContain('class="replay-summary-grid"');
    expect(replayTemplate).toContain('id="replayHighlightsList"');
    expect(replayTemplate).not.toContain("replay-card-copy");
    expect(replayTemplate).not.toContain("replayRecordingsLead");
    expect(replayTemplate).not.toContain("replaySummaryLead");
    expect(replayTemplate).not.toContain("replayHighlightsLead");
    expect(i18n).not.toContain("replayRecordingsLead");
    expect(i18n).not.toContain("replaySummaryLead");
    expect(i18n).not.toContain("replayHighlightsLead");
  });

  it("matches floating panel close affordances on the expanded graph sheet", () => {
    const replayCss = readStyle("src/styles/replay.less");
    const replayTemplate = readStyle("src/app/views/templates/replay-template.ts");

    expect(replayTemplate).toContain('class="replay-graph-sheet-grip"');
    expect(replayTemplate).toContain('class="replay-graph-sheet-close"');
    expect(replayTemplate).toContain('<span class="btn-icon" aria-hidden="true"></span>');
    expect(replayCss).toContain(".replay-graph-sheet-grip{\n    width: 40px;");
    expect(replayCss).toContain(".replay-graph-sheet-close{\n    appearance: none;");
    expect(replayCss).toContain("border-radius: 999px;");
    expect(replayCss).toContain("backdrop-filter: blur(12px);");
  });

  it("scopes Replay touch policy away from persistent shell surfaces", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).not.toContain("body.replay-page *");
    expect(replayCss).not.toContain("body.replay-page button");
    expect(replayCss).not.toContain("body.replay-page .vb-floating-drag-handle");
    expect(replayCss).not.toContain("body.replay-page .vb-shell-taskbar");
    expect(replayCss).not.toContain("body.replay-page .milkdrop-resize-handle");
    expect(replayCss).toContain('#app-view[data-vb-route="replay"]');
  });
});
