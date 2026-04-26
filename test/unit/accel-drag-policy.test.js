import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("accel floating drag policy", () => {
  it("keeps accel touch resets scoped away from persistent floating tools", () => {
    const accelCss = readFileSync(resolve(process.cwd(), "src/styles/accel.less"), "utf8");

    expect(accelCss).toContain(".accel-app,\n.accel-app *");
    expect(accelCss).not.toContain("body.accel-page *");
    expect(accelCss).not.toContain("body.accel-page button");
    expect(accelCss).toContain("body.accel-page .vb-floating-drag-handle");
    expect(accelCss).toContain("body.accel-page .floating-dock");
    expect(accelCss).toContain("body.accel-page .milkdrop-resize-handle");
  });
});
