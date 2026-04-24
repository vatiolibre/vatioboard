import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initToolsMenu } from "../../src/shared/tools-menu.js";

describe("tools menu stacking", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("raises the nearest header only while the menu is open", () => {
    const header = document.createElement("header");
    const shell = document.createElement("div");
    shell.className = "tools-menu";

    const button = document.createElement("button");
    button.type = "button";
    const list = document.createElement("div");
    list.hidden = true;

    shell.append(button, list);
    header.append(shell);
    document.body.append(header);

    const menu = initToolsMenu({ button, list });

    expect(header.classList.contains("tools-menu-layer-open")).toBe(false);

    menu.setOpen(true);
    expect(header.classList.contains("tools-menu-layer-open")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);

    menu.setOpen(false);
    expect(header.classList.contains("tools-menu-layer-open")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
  });

  it("keeps the header raised until outside click closes the open menu", () => {
    const header = document.createElement("header");
    const shell = document.createElement("div");
    shell.className = "tools-menu";

    const button = document.createElement("button");
    button.type = "button";
    const list = document.createElement("div");
    list.hidden = true;
    list.append(document.createElement("button"));

    shell.append(button, list);
    header.append(shell);
    document.body.append(header);

    initToolsMenu({ button, list });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(header.classList.contains("tools-menu-layer-open")).toBe(true);

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(header.classList.contains("tools-menu-layer-open")).toBe(false);
    expect(list.hidden).toBe(true);
  });

  it("defines a shared menu layer above floating player tools", () => {
    const boardCss = readFileSync(resolve(process.cwd(), "src/styles/board.less"), "utf8");

    expect(boardCss).toContain("header.tools-menu-layer-open");
    expect(boardCss).toContain("z-index: calc(var(--vb-z-floating, 1000) + 5)");
    expect(boardCss).toContain(".tools-menu-list");
    expect(boardCss).toContain("z-index: calc(var(--vb-z-floating, 1000) + 6)");
  });
});
