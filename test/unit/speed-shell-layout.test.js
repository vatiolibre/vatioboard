import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("speed shell layout", () => {
  it("keeps the desktop speed shell inside short iPad landscape viewports", () => {
    const speedCss = readStyle("src/styles/speed.less");

    expect(speedCss).toContain("@media (min-width: 800px) and (max-height: 860px)");
    expect(speedCss).toContain(".speed-shell{\n        height: 100%;\n        min-height: 0;");
    expect(speedCss).toContain(".speed-stage{\n        height: 100%;\n        min-height: 0;");
    expect(speedCss).toContain("width: min(100%, 660px, calc(100svh - 120px));");
    expect(speedCss).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(speedCss).toContain(".metric-card{\n        min-height: 74px;");
    expect(speedCss).toContain(".speed-globe{\n        height: 100%;\n        min-height: 0;");
  });
});
