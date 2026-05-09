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
    expect(replayCss).toContain("html.replay-page,\nbody.replay-page");
    expect(replayCss).toContain("height: 100%;");
    expect(replayCss).toContain("overflow: hidden;");
    expect(replayCss).toContain("overscroll-behavior: none;");

    expect(replayCss).toContain("body.replay-page #app,\nbody.replay-page #app-view,\nbody.replay-page .replay-app");
    expect(replayCss).toContain("height: 100dvh;");
    expect(replayCss).toContain("min-height: 0;");
    expect(replayCss).toContain("flex: 1 1 auto;");
    expect(replayCss).toContain("overflow: hidden;");
    expect(replayCss).toContain("overscroll-behavior: contain;");
  });

  it("keeps the replay shell bounded and scrolls only panel lists", () => {
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

  it("keeps Tesla and mobile breakpoints compact instead of stacking graph rows", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).toContain("@media (max-width: 1080px)");
    expect(replayCss).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(270px, 0.82fr);"
    );
    expect(replayCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(replayCss).not.toContain(".replay-graphs-grid{\n        grid-template-columns: 1fr;");
    expect(replayCss).toContain("height: clamp(66px, 9vh, 104px) !important;");
    expect(replayCss).toContain("@media (max-height: 720px)");
    expect(replayCss).toContain("height: clamp(48px, 8vh, 84px) !important;");
  });

  it("uses one compact details card and removes replay copy rows", () => {
    const replayTemplate = readStyle("src/app/views/templates/replay-template.js");
    const i18n = readStyle("src/i18n.js");

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
    const replayTemplate = readStyle("src/app/views/templates/replay-template.js");

    expect(replayTemplate).toContain('class="replay-graph-sheet-grip"');
    expect(replayTemplate).toContain('class="replay-graph-sheet-close"');
    expect(replayTemplate).toContain('<span class="btn-icon" aria-hidden="true"></span>');
    expect(replayCss).toContain(".replay-graph-sheet-grip{\n    width: 40px;");
    expect(replayCss).toContain(".replay-graph-sheet-close{\n    appearance: none;");
    expect(replayCss).toContain("border-radius: 999px;");
    expect(replayCss).toContain("backdrop-filter: blur(12px);");
  });

  it("does not use broad Replay touch-action resets and keeps floating drag protected", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).not.toContain("body.replay-page *");
    expect(replayCss).not.toContain("body.replay-page button");
    expect(replayCss).toContain("body.replay-page .vb-floating-drag-handle");
    expect(replayCss).toContain("body.replay-page .vb-shell-taskbar");
    expect(replayCss).toContain("body.replay-page .milkdrop-resize-handle");
    expect(replayCss).toContain("touch-action: none;");
  });
});
