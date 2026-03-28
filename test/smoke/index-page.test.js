import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

vi.mock("@jaames/iro", () => ({
  default: {
    ColorPicker: class {
      constructor() {
        this.color = { hexString: "#111111" };
      }

      on() {}
      off() {}
    },
  },
}));

describe("index.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("index.html");
  });

  it("boots the board page and mounts its widgets", async () => {
    await import("../../src/board/board.js");
    await flushTasks();

    expectPageSeo({
      title: "Vatio Board – Free Drawing Board + Calculator (Tesla-Friendly)",
      canonical: "https://vatioboard.com/",
    });
    expect(document.documentElement.lang).toBe("en");
    expect(document.getElementById("pen").getAttribute("aria-label")).toBe("Pen");
    expect(document.querySelector("#pen .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("erase").getAttribute("aria-label")).toBe("Eraser");
    expect(document.querySelector("#erase .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("clear").getAttribute("aria-label")).toBe("Clear");
    expect(document.querySelector("#clear .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("save").getAttribute("aria-label")).toBe("Save PNG");
    expect(document.querySelector("#save .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("toolsMenuBtn").getAttribute("aria-label")).toBe("Tools");
    expect(document.querySelector("#toolsMenuBtn .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("toolsMenuList").hidden).toBe(false);
    expect(document.getElementById("toolsMenuBtn").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".calc-panel")).toBeTruthy();
    expect(document.querySelector(".energy-panel")).toBeTruthy();
    expect(document.querySelector(".floating-dock")).toBeTruthy();

    document.getElementById("openCalc").click();
    expect(document.querySelector(".calc-panel").hidden).toBe(false);
  });
});
