import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushTasks } from "../helpers/page-smoke.js";

describe("Board route lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
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

  it("keeps the legacy ink color key canonical while mirroring to runtime settings", async () => {
    localStorage.setItem("vatio_board_ink_raw", "#123456");
    const { appRegistry, createAppRuntime } = await import("../../src/app-platform/index.js");
    const { mount } = await import("../../src/app/views/BoardView.js");
    const manifest = appRegistry.getApp("vatio.board");
    const runtime = createAppRuntime({ manifest, baseContext: {} });
    runtime.services.settings.set("inkRaw", "#abcdef");
    const root = document.getElementById("root");

    const mounted = await mount(root, {
      appRuntime: runtime,
      appManifest: manifest,
      routeSignal: new AbortController().signal,
    });
    await flushTasks();

    expect(localStorage.getItem("vatio_board_ink_raw")).toBe("#123456");
    expect(localStorage.getItem("vatioboard.app.vatio.board.settings.inkRaw")).toBe("#123456");

    mounted.unmount();
  }, 40000);

  it("seeds the legacy ink color key from runtime settings only when no legacy value exists", async () => {
    const { appRegistry, createAppRuntime } = await import("../../src/app-platform/index.js");
    const { mount } = await import("../../src/app/views/BoardView.js");
    const manifest = appRegistry.getApp("vatio.board");
    const runtime = createAppRuntime({ manifest, baseContext: {} });
    runtime.services.settings.set("inkRaw", "#abcdef");
    const root = document.getElementById("root");

    const mounted = await mount(root, {
      appRuntime: runtime,
      appManifest: manifest,
      routeSignal: new AbortController().signal,
    });
    await flushTasks();

    expect(localStorage.getItem("vatio_board_ink_raw")).toBe("#abcdef");
    expect(localStorage.getItem("vatioboard.app.vatio.board.settings.inkRaw")).toBe("#abcdef");

    mounted.unmount();
  }, 40000);
});
