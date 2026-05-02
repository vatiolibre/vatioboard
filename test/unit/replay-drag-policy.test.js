import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("replay floating drag policy", () => {
  it("keeps replay touch resets scoped away from persistent floating tools", () => {
    const replayCss = readFileSync(resolve(process.cwd(), "src/styles/replay.less"), "utf8");

    expect(replayCss).toContain(".replay-app,\n.replay-app *");
    expect(replayCss).not.toContain("body.replay-page *");
    expect(replayCss).not.toContain("body.replay-page button");
    expect(replayCss).toContain("body.replay-page .vb-floating-drag-handle");
    expect(replayCss).toContain("body.replay-page .floating-dock");
    expect(replayCss).toContain("body.replay-page .milkdrop-resize-handle");
  });
});
