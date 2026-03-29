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
    expect(document.getElementById("undo").getAttribute("aria-label")).toBe("Undo");
    expect(document.querySelector("#undo .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("redo").getAttribute("aria-label")).toBe("Redo");
    expect(document.querySelector("#redo .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("undo").disabled).toBe(true);
    expect(document.getElementById("redo").disabled).toBe(true);
    expect(document.getElementById("clear").getAttribute("aria-label")).toBe("Clear");
    expect(document.querySelector("#clear .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("save").getAttribute("aria-label")).toBe("Save PNG");
    expect(document.querySelector("#save .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("toolsMenuBtn").getAttribute("aria-label")).toBe("Pages");
    expect(document.querySelector("#toolsMenuBtn .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("toolsMenuList").hidden).toBe(false);
    expect(document.getElementById("toolsMenuBtn").getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("sizeVal")).toBeNull();
    expect(document.getElementById("sizePreview")).toBeTruthy();
    expect(document.getElementById("colorChip")).toBeNull();
    expect(document.querySelector(".size-label #swatches")).toBeTruthy();
    expect(document.getElementById("sizePreview").style.getPropertyValue("--board-size-preview")).toBe("6px");
    expect(document.querySelector(".calc-panel")).toBeTruthy();
    expect(document.querySelector(".energy-panel")).toBeTruthy();
    expect(document.querySelector(".floating-dock")).toBeTruthy();
    expect(document.querySelector(".canvas-frame .board-canvas-meta")).toBeTruthy();
    expect(document.querySelector("header .board-canvas-meta")).toBeNull();

    document.getElementById("size").value = "12";
    document.getElementById("size").dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("sizePreview").style.getPropertyValue("--board-size-preview")).toBe("12px");

    document.getElementById("sizePreview").click();
    expect(document.getElementById("colorPopup").hidden).toBe(false);

    const canvas = document.getElementById("pad");
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 12, clientY: 12 });
    const pointerMove = new MouseEvent("pointermove", { bubbles: true, clientX: 42, clientY: 32 });
    const pointerUp = new MouseEvent("pointerup", { bubbles: true, clientX: 42, clientY: 32 });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });
    Object.defineProperty(pointerMove, "pointerId", { value: 1 });
    Object.defineProperty(pointerUp, "pointerId", { value: 1 });

    canvas.dispatchEvent(pointerDown);
    canvas.dispatchEvent(pointerMove);
    canvas.dispatchEvent(pointerUp);

    expect(document.getElementById("undo").disabled).toBe(false);
    expect(document.getElementById("redo").disabled).toBe(true);

    document.getElementById("undo").click();
    expect(document.getElementById("status").textContent).toBe("Undo");
    expect(document.getElementById("undo").disabled).toBe(true);
    expect(document.getElementById("redo").disabled).toBe(false);

    document.getElementById("redo").click();
    expect(document.getElementById("status").textContent).toBe("Redo");
    expect(document.getElementById("undo").disabled).toBe(false);
    expect(document.getElementById("redo").disabled).toBe(true);

    document.getElementById("openCalc").click();
    expect(document.querySelector(".calc-panel").hidden).toBe(false);
  });
});
