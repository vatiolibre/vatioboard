import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo } from "../helpers/page-smoke.js";

describe("player.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage("player.html");
  });

  it("boots the player demo page with correct SEO", async () => {
    expectPageSeo({
      title: "VatioBoard Audio Player",
      hasDescription: false,
    });
  });

  it("has the demo button", () => {
    const btn = document.getElementById("openPlayer");
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("has the demo page layout", () => {
    expect(document.querySelector(".player-demo")).toBeTruthy();
    expect(document.querySelector(".player-demo h1")).toBeTruthy();
  });
});
