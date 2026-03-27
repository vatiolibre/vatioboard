import { afterEach, beforeEach, vi } from "vitest";

function createCanvasGradient() {
  return {
    addColorStop: vi.fn(),
  };
}

function createCanvasContext(canvas) {
  const base = {
    canvas,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalCompositeOperation: "source-over",
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    clip: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    ellipse: vi.fn(),
    measureText: vi.fn(() => ({ width: 16 })),
    createLinearGradient: vi.fn(() => createCanvasGradient()),
    createRadialGradient: vi.fn(() => createCanvasGradient()),
  };

  return new Proxy(base, {
    get(target, prop) {
      if (!(prop in target) && typeof prop === "string") {
        target[prop] = vi.fn();
      }
      return target[prop];
    },
  });
}

class FakeAudio extends EventTarget {
  constructor(src = "") {
    super();
    this.src = src;
    this.loop = false;
    this.preload = "auto";
    this.playsInline = true;
    this.currentTime = 0;
    this.duration = 0.5;
    this.paused = true;
  }

  play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  load() {}
}

class FakeMediaMetadata {
  constructor(init = {}) {
    Object.assign(this, init);
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function createPermissionStatus(state = "granted") {
  return {
    state,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function createGeolocationMock() {
  const mock = {
    success: null,
    error: null,
    options: null,
    watchPosition: vi.fn((success, error, options) => {
      mock.success = success;
      mock.error = error;
      mock.options = options;
      return 1;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn((success) => {
      if (typeof success === "function") success();
    }),
    emitSuccess(position) {
      if (typeof mock.success === "function") mock.success(position);
    },
    emitError(error) {
      if (typeof mock.error === "function") mock.error(error);
    },
  };

  return mock;
}

beforeEach(() => {
  const canvasContexts = new WeakMap();
  const geolocation = createGeolocationMock();
  const mediaSession = {
    metadata: null,
    playbackState: "none",
    setActionHandler: vi.fn(),
  };

  Object.defineProperty(window, "__lang", {
    value: "en",
    writable: true,
    configurable: true,
  });

  Object.defineProperty(document, "hidden", {
    value: false,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  Object.defineProperty(window.navigator, "permissions", {
    configurable: true,
    value: {
      query: vi.fn(async () => createPermissionStatus()),
    },
  });

  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => {}),
    },
  });

  Object.defineProperty(window.navigator, "wakeLock", {
    configurable: true,
    value: {
      request: vi.fn(async () => ({
        released: false,
        addEventListener: vi.fn(),
        release: vi.fn(async () => {}),
      })),
    },
  });

  Object.defineProperty(window.navigator, "mediaSession", {
    configurable: true,
    value: mediaSession,
  });

  Object.defineProperty(window, "MediaMetadata", {
    configurable: true,
    writable: true,
    value: FakeMediaMetadata,
  });

  Object.defineProperty(window, "Audio", {
    configurable: true,
    writable: true,
    value: FakeAudio,
  });

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });

  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: vi.fn(() => 1),
  });

  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "setInterval", {
    configurable: true,
    writable: true,
    value: vi.fn(() => 1),
  });

  Object.defineProperty(window, "clearInterval", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "setTimeout", {
    configurable: true,
    writable: true,
    value: vi.fn(() => 1),
  });

  Object.defineProperty(window, "clearTimeout", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");

      if (url.endsWith(".json")) {
        return new Response(JSON.stringify({ traps: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith(".kdbush")) {
        return new Response("", { status: 404 });
      }

      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  });

  Object.defineProperty(window.URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:test-url"),
  });

  Object.defineProperty(window.URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: vi.fn(() => true),
  });

  Object.defineProperty(window, "alert", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: vi.fn(() => true),
  });

  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: vi.fn(function getBoundingClientRect() {
      const width = Number(this.getAttribute?.("width")) || 320;
      const height = Number(this.getAttribute?.("height")) || (this.tagName === "CANVAS" ? 320 : 180);
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON() {
          return this;
        },
      };
    }),
  });

  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: vi.fn(function getContext() {
      if (!canvasContexts.has(this)) {
        canvasContexts.set(this, createCanvasContext(this));
      }
      return canvasContexts.get(this);
    }),
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "data:image/png;base64,AAAA"),
  });

  localStorage.clear();
  sessionStorage.clear();
  document.open();
  document.write("<!doctype html><html lang=\"en\"><head></head><body></body></html>");
  document.close();

  globalThis.__browserMocks = {
    geolocation,
    mediaSession,
  };
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.open();
  document.write("<!doctype html><html lang=\"en\"><head></head><body></body></html>");
  document.close();
});
