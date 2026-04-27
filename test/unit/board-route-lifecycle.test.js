import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushTasks } from "../helpers/page-smoke.js";

describe("Board route lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    window.__vatioboardSpa = true;
    document.head.innerHTML = '<meta name="description" content="Board test">';
    document.body.innerHTML = '<main id="root"></main>';
  });

  it("mounts and unmounts through the SPA route contract without leaking route DOM", async () => {
    const { mount } = await import("../../src/app/views/BoardView.js");
    const root = document.getElementById("root");

    const first = await mount(root, {
      routeSignal: new AbortController().signal,
    });
    await flushTasks();

    expect(root.querySelector("#pad")).toBeTruthy();
    expect(document.body.classList.contains("board-page")).toBe(true);

    first.unmount();
    expect(root.children).toHaveLength(0);
    expect(document.body.classList.contains("board-page")).toBe(false);
    expect(document.body.classList.contains("board-is-drawing")).toBe(false);
    expect(document.documentElement.classList.contains("board-is-drawing")).toBe(false);

    const second = await mount(root, {
      routeSignal: new AbortController().signal,
    });
    await flushTasks();

    expect(root.querySelector("#pad")).toBeTruthy();
    second.unmount();
    expect(root.children).toHaveLength(0);
  }, 40000);
});
