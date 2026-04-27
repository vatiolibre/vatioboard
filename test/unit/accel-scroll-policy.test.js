import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("accel scroll policy", () => {
  it("keeps Accel vertically scrollable while overriding imported board clipping", () => {
    const accelCss = readStyle("src/styles/accel.less");

    expect(accelCss).toContain('@import "./board.less";');
    expect(accelCss).toContain("html.accel-page,\nbody.accel-page");
    expect(accelCss).toContain("overflow-y: auto;");
    expect(accelCss).toContain("overscroll-behavior-y: auto;");
    expect(accelCss).toContain("-webkit-overflow-scrolling: touch;");
    expect(accelCss).toContain("touch-action: pan-y pinch-zoom;");

    expect(accelCss).toContain("body.accel-page #app,\nbody.accel-page #app-view,\nbody.accel-page .accel-app");
    expect(accelCss).toContain("overflow: visible;");
    expect(accelCss).toContain("height: auto;");
    expect(accelCss).toContain("flex: 1 0 auto;");
    expect(accelCss).toContain("min-height: auto;");
    expect(accelCss).toContain("touch-action: pan-y;");
  });

  it("uses an internal Accel scroller on narrow screens like Speed", () => {
    const accelCss = readStyle("src/styles/accel.less");

    expect(accelCss).toContain("@media (max-width: 799.98px)");
    expect(accelCss).toContain("html.accel-page,\n    body.accel-page");
    expect(accelCss).toContain("overflow: hidden;");
    expect(accelCss).toContain(
      "body.accel-page #app,\n    body.accel-page #app-view,\n    body.accel-page .accel-app"
    );
    expect(accelCss).toContain("height: 100dvh;");
    expect(accelCss).toContain(".accel-main{\n        flex: 1 1 auto;");
    expect(accelCss).toContain("overflow-y: auto;");
    expect(accelCss).toContain("overscroll-behavior: contain;");
    expect(accelCss).toContain("-webkit-overflow-scrolling: touch;");
    expect(accelCss).toContain("touch-action: pan-y;");
  });

  it("does not use broad Accel touch-action resets and keeps floating drag protected", () => {
    const accelCss = readStyle("src/styles/accel.less");

    expect(accelCss).not.toContain("body.accel-page *");
    expect(accelCss).not.toContain("body.accel-page button");
    expect(accelCss).toContain("body.accel-page .vb-floating-drag-handle");
    expect(accelCss).toContain("body.accel-page .floating-dock");
    expect(accelCss).toContain("body.accel-page .milkdrop-resize-handle");
    expect(accelCss).toContain("touch-action: none;");
  });

  it("keeps Board intentionally non-scrollable and full-screen", () => {
    const boardCss = readStyle("src/styles/board.less");

    expect(boardCss).toContain("body.board-page{");
    expect(boardCss).toContain("overflow: hidden;");
    expect(boardCss).toContain("body.board-page #app,\nbody.board-page #app-view,\nbody.board-page .app");
    expect(boardCss).toContain("height: var(--board-viewport-height, 100svh);");
    expect(boardCss).toContain("min-height: 0;");
  });

  it("leaves Speed, Replay, and Library scroll policies intact", () => {
    const speedCss = readStyle("src/styles/speed.less");
    const replayCss = readStyle("src/styles/replay.less");
    const libraryCss = readStyle("src/styles/library.less");

    expect(speedCss).toContain(".speed-main{\n        overflow-y: auto;");
    expect(speedCss).toContain("overscroll-behavior: contain;");
    expect(speedCss).toContain("touch-action: pan-y;");

    expect(replayCss).toContain("html.replay-page,\nbody.replay-page");
    expect(replayCss).toContain("overflow-y: auto;");
    expect(replayCss).toContain("touch-action: pan-y pinch-zoom;");

    expect(libraryCss).toContain("html.library-page,\nbody.library-page");
    expect(libraryCss).toContain("overflow-y: auto;");
    expect(libraryCss).toContain("touch-action: pan-y pinch-zoom;");
  });
});
