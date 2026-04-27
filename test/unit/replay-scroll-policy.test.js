import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("replay scroll policy", () => {
  it("keeps Replay vertically scrollable while overriding imported board clipping", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).toContain('@import "./board.less";');
    expect(replayCss).toContain("html.replay-page,\nbody.replay-page");
    expect(replayCss).toContain("overflow-y: auto;");
    expect(replayCss).toContain("overscroll-behavior-y: auto;");
    expect(replayCss).toContain("-webkit-overflow-scrolling: touch;");
    expect(replayCss).toContain("touch-action: pan-y pinch-zoom;");

    expect(replayCss).toContain("body.replay-page #app,\nbody.replay-page #app-view,\nbody.replay-page .replay-app");
    expect(replayCss).toContain("overflow: visible;");
    expect(replayCss).toContain("height: auto;");
    expect(replayCss).toContain("flex: 1 0 auto;");
    expect(replayCss).toContain("min-height: auto;");
    expect(replayCss).toContain("touch-action: pan-y;");
  });

  it("uses an internal Replay scroller on narrow screens like Speed", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).toContain("@media (max-width: 799.98px)");
    expect(replayCss).toContain("html.replay-page,\n    body.replay-page");
    expect(replayCss).toContain("overflow: hidden;");
    expect(replayCss).toContain(
      "body.replay-page #app,\n    body.replay-page #app-view,\n    body.replay-page .replay-app"
    );
    expect(replayCss).toContain("height: 100dvh;");
    expect(replayCss).toContain(".replay-main{\n        flex: 1 1 auto;");
    expect(replayCss).toContain("overflow-y: auto;");
    expect(replayCss).toContain("overscroll-behavior: contain;");
    expect(replayCss).toContain("-webkit-overflow-scrolling: touch;");
    expect(replayCss).toContain("touch-action: pan-y;");
  });

  it("does not use broad Replay touch-action resets and keeps floating drag protected", () => {
    const replayCss = readStyle("src/styles/replay.less");

    expect(replayCss).not.toContain("body.replay-page *");
    expect(replayCss).not.toContain("body.replay-page button");
    expect(replayCss).toContain("body.replay-page .vb-floating-drag-handle");
    expect(replayCss).toContain("body.replay-page .floating-dock");
    expect(replayCss).toContain("body.replay-page .milkdrop-resize-handle");
    expect(replayCss).toContain("touch-action: none;");
  });
});
