import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushTasks } from "../helpers/page-smoke.js";

const storageMocks = vi.hoisted(() => ({
  BOARD_CURRENT_DOCUMENT_KEY: "vatio_board_document_current_v1",
  BOARD_DRAWING_KEY: "vatio_board_drawing_v1",
  BOARD_PENDING_OPEN_DOCUMENT_KEY: "vatio_board_document_pending_open_v1",
  BOARD_PERSIST_CHUNK_SIZE: 100,
  BOARD_SCHEMA_VERSION: 1,
  clearCurrentBoardDocumentMeta: vi.fn(),
  consumePendingBoardDocumentOpen: vi.fn(() => null),
  createEmptyBoardDrawing: vi.fn(() => ({ version: 1, updatedAtMs: 0, commands: [], redoCommands: [] })),
  getBoardStorageCapability: vi.fn(() => ({ available: true, persistent: true, reason: "" })),
  hasBoardDrawingContent: vi.fn((document) => {
    return Boolean(document?.commands?.length || document?.redoCommands?.length);
  }),
  loadBoardDrawing: vi.fn(async () => ({ commands: [], redoCommands: [] })),
  loadCurrentBoardDocumentMeta: vi.fn(() => null),
  queuePendingBoardDocumentOpen: vi.fn(),
  saveBoardDrawing: vi.fn(async () => {}),
  saveCurrentBoardDocumentMeta: vi.fn(),
}));

vi.mock("../../src/board/storage.js", () => storageMocks);

function createRect({ left = 0, top = 0, width = 0, height = 0 } = {}) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this;
    },
  };
}

function numericStyleValue(value) {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function installBoardLayout({
  pageTop = 80,
  width = 640,
  viewportHeight = 680,
  visibleHeight = 600,
  documentHeight = pageTop + visibleHeight,
} = {}) {
  let scrollY = 0;
  let nextViewportHeight = viewportHeight;
  const visualViewport = new EventTarget();

  Object.defineProperties(visualViewport, {
    height: {
      configurable: true,
      get: () => nextViewportHeight,
    },
    width: {
      configurable: true,
      get: () => width,
    },
    offsetLeft: {
      configurable: true,
      get: () => 0,
    },
    offsetTop: {
      configurable: true,
      get: () => 0,
    },
  });

  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    get: () => nextViewportHeight,
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => scrollY,
  });
  Object.defineProperty(window, "pageYOffset", {
    configurable: true,
    get: () => scrollY,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => documentHeight,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    get: () => nextViewportHeight,
  });
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(document.body, "scrollHeight", {
    configurable: true,
    get: () => documentHeight,
  });

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect() {
    if (this.id === "pad") {
      const height = numericStyleValue(this.style.height) || visibleHeight;
      const rectWidth = numericStyleValue(this.style.width) || width;
      return createRect({ left: 0, top: pageTop - scrollY, width: rectWidth, height });
    }

    if (this.classList?.contains("canvas-frame")) {
      const height = numericStyleValue(this.style.height) || visibleHeight;
      return createRect({ left: 0, top: pageTop - scrollY, width, height });
    }

    return createRect({ left: 0, top: 0, width: 320, height: 180 });
  });

  return {
    setScrollY(value) {
      scrollY = value;
    },
    setViewportHeight(value) {
      nextViewportHeight = value;
    },
    visualViewport,
  };
}

function createPointerEvent(type, {
  x,
  y,
  pointerId = 77,
  pointerType = "mouse",
  button = 0,
} = {}) {
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId,
    pointerType,
    button,
  };

  if (typeof PointerEvent === "function") {
    return new PointerEvent(type, init);
  }

  const event = new Event(type, init);
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, {
      configurable: true,
      value,
    });
  }
  return event;
}

function dispatchPointer(target, type, options) {
  target.dispatchEvent(createPointerEvent(type, options));
}

async function mountBoard() {
  vi.resetModules();
  const { mount } = await import("../../src/app/views/BoardView.js");
  const root = document.getElementById("root");
  const mounted = await mount(root, {
    routeSignal: new AbortController().signal,
  });
  await flushTasks();

  return {
    mounted,
    root,
    canvas: root.querySelector("#pad"),
    frame: root.querySelector(".canvas-frame"),
  };
}

function latestSavedStroke() {
  const snapshot = storageMocks.saveBoardDrawing.mock.calls.at(-1)?.[0];
  return snapshot?.commands?.at(-1);
}

describe("board drawing boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(storageMocks).forEach((mock) => mock?.mockClear?.());
    window.__vatioboardSpa = true;
    document.documentElement.style.removeProperty("--board-viewport-height");
    document.head.innerHTML = '<meta name="description" content="Board boundary test">';
    document.body.innerHTML = '<main id="root"></main>';
  });

  it("sizes the drawable canvas to the available visible viewport instead of the document height", async () => {
    installBoardLayout({
      pageTop: 80,
      width: 640,
      viewportHeight: 680,
      visibleHeight: 600,
      documentHeight: 1200,
    });

    const { canvas, frame, mounted } = await mountBoard();

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(600);
    expect(canvas.style.height).toBe("600px");
    expect(frame.style.height).toBe("600px");
    expect(document.documentElement.style.getPropertyValue("--board-viewport-height")).toBe("680px");

    mounted.unmount();
    expect(document.documentElement.style.getPropertyValue("--board-viewport-height")).toBe("");
  });

  it.each(["mouse", "touch", "pen"])("starts and continues %s drawing at the visible bottom edge", async (pointerType) => {
    installBoardLayout({
      pageTop: 80,
      width: 640,
      viewportHeight: 680,
      visibleHeight: 600,
      documentHeight: 1200,
    });

    const { frame, mounted } = await mountBoard();
    storageMocks.saveBoardDrawing.mockClear();

    dispatchPointer(frame, "pointerdown", {
      x: 120,
      y: 678,
      pointerType,
    });
    dispatchPointer(frame, "pointermove", {
      x: 160,
      y: 680,
      pointerType,
    });
    dispatchPointer(frame, "pointerup", {
      x: 160,
      y: 680,
      pointerType,
    });

    const stroke = latestSavedStroke();
    expect(stroke?.points).toEqual([
      { x: 120, y: 598 },
      { x: 160, y: 600 },
    ]);

    mounted.unmount();
  });

  it("resizes from visualViewport changes used by iPhone Safari browser chrome", async () => {
    const layout = installBoardLayout({
      pageTop: 80,
      width: 640,
      viewportHeight: 700,
      visibleHeight: 620,
      documentHeight: 1200,
    });

    const { canvas, frame, mounted } = await mountBoard();

    expect(canvas.height).toBe(620);
    layout.setViewportHeight(620);
    layout.visualViewport.dispatchEvent(new Event("resize"));

    expect(canvas.height).toBe(540);
    expect(canvas.style.height).toBe("540px");
    expect(frame.style.height).toBe("540px");
    expect(document.documentElement.style.getPropertyValue("--board-viewport-height")).toBe("620px");

    mounted.unmount();
  });

  it("maps drawing coordinates correctly after the page is scrolled", async () => {
    const layout = installBoardLayout({
      pageTop: 80,
      width: 640,
      viewportHeight: 680,
      visibleHeight: 600,
      documentHeight: 1200,
    });

    const { frame, mounted } = await mountBoard();
    storageMocks.saveBoardDrawing.mockClear();
    layout.setScrollY(420);

    dispatchPointer(frame, "pointerdown", {
      x: 200,
      y: 100,
      pointerType: "pen",
    });
    dispatchPointer(frame, "pointermove", {
      x: 220,
      y: 180,
      pointerType: "pen",
    });
    dispatchPointer(frame, "pointerup", {
      x: 220,
      y: 180,
      pointerType: "pen",
    });

    const stroke = latestSavedStroke();
    expect(stroke?.points).toEqual([
      { x: 200, y: 440 },
      { x: 220, y: 520 },
    ]);

    mounted.unmount();
  });

  it("keeps top, left, and right edge drawing coordinates unchanged", async () => {
    installBoardLayout({
      pageTop: 80,
      width: 640,
      viewportHeight: 680,
      visibleHeight: 600,
      documentHeight: 680,
    });

    const { frame, mounted } = await mountBoard();
    storageMocks.saveBoardDrawing.mockClear();

    dispatchPointer(frame, "pointerdown", {
      x: 0,
      y: 80,
      pointerType: "mouse",
    });
    dispatchPointer(frame, "pointermove", {
      x: 640,
      y: 80,
      pointerType: "mouse",
    });
    dispatchPointer(frame, "pointerup", {
      x: 640,
      y: 80,
      pointerType: "mouse",
    });

    const stroke = latestSavedStroke();
    expect(stroke?.points).toEqual([
      { x: 0, y: 0 },
      { x: 640, y: 0 },
    ]);

    mounted.unmount();
  });
});
