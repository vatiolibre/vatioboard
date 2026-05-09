import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("library floating drag policy", () => {
  it("keeps library touch resets scoped away from persistent floating tools", () => {
    const libraryCss = readFileSync(resolve(process.cwd(), "src/styles/library.less"), "utf8");

    expect(libraryCss).toContain(".library-app,\n.library-app *");
    expect(libraryCss).not.toContain("body.library-page *");
    expect(libraryCss).not.toContain("body.library-page button");
    expect(libraryCss).toContain("body.library-page .vb-floating-drag-handle");
    expect(libraryCss).toContain("body.library-page .vb-shell-taskbar");
    expect(libraryCss).toContain("body.library-page .milkdrop-resize-handle");
  });
});
