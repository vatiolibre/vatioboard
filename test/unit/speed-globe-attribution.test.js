import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyle(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("speed globe attribution control", () => {
  it("removes the native summary marker and centers the compact info glyph", () => {
    const speedCss = readStyle("src/styles/speed.less");

    expect(speedCss).toContain(".speed-globe .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button{");
    expect(speedCss).toContain("appearance: none;");
    expect(speedCss).toContain("-webkit-appearance: none;");
    expect(speedCss).toContain("list-style: none;");
    expect(speedCss).toContain("font-size: 0;");
    expect(speedCss).toContain("line-height: 0;");
    expect(speedCss).toContain(".speed-globe .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button::-webkit-details-marker");
    expect(speedCss).toContain(".speed-globe .maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button::marker");
    expect(speedCss).toContain("top: 50%;\n    left: 50%;");
    expect(speedCss).toContain("transform: translate(-50%, -50%);");
  });
});
