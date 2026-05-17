import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("player content sheet scroll policy", () => {
  it("keeps queue, library, and playlist panes touch-scrollable inside host pages", () => {
    const playerCss = readFileSync(resolve(process.cwd(), "src/styles/player.less"), "utf8");

    expect(playerCss).toContain(".player-content-pane-stack");
    expect(playerCss).toContain("overscroll-behavior: contain;");
    expect(playerCss).toContain(".player-content-sheet.is-open");
    expect(playerCss).toContain("--player-content-sheet-open-height");
    expect(playerCss).toContain(".player-panel.is-content-open .player-utility-row");
    expect(playerCss).toContain("display: none;");
    expect(playerCss).toContain(".player-content-pane");
    expect(playerCss).toContain("overflow-y: auto;");
    expect(playerCss).toContain("-webkit-overflow-scrolling: touch;");
    expect(playerCss).toContain("touch-action: pan-y;");
  });
});
