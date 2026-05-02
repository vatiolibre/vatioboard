import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("confirm dialog stacking policy", () => {
  it("places confirm backdrops on the shared modal layer above floating tools", () => {
    const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
    const confirmCss = readProjectFile("src/shared/ui/confirm-dialog.less");
    const playerCss = readProjectFile("src/styles/player.less");
    const calculatorCss = readProjectFile("src/styles/calculator.less");
    const dockCss = readProjectFile("src/styles/dock.less");
    const energyCss = readProjectFile("src/styles/energy.less");

    expect(confirmCss).toContain("z-index: var(--vb-z-modal, 2000)");
    expect(playerCss).toContain("z-index: var(--vb-z-floating, 1000)");
    expect(calculatorCss).toContain("z-index: var(--vb-z-floating, 1000)");
    expect(dockCss).toContain("z-index: var(--vb-z-floating, 1000)");
    expect(energyCss).toContain("z-index: var(--vb-z-floating-secondary, 990)");
  });
});
