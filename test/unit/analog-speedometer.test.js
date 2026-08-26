import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalogSpeedometer } from "../../src/shared/analog-speedometer.js";

const originalDevicePixelRatio = window.devicePixelRatio;

function rect(width, height) {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => {},
  };
}

function setClientSize(element, width, height) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, writable: true, value: width },
    clientHeight: { configurable: true, writable: true, value: height },
  });
}

function setRect(element, width, height) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => rect(width, height)),
  });
}

function createFixture() {
  const stageElement = document.createElement("div");
  const stageInnerElement = document.createElement("div");
  const dialCanvas = document.createElement("canvas");
  const needleCanvas = document.createElement("canvas");
  stageInnerElement.append(dialCanvas, needleCanvas);
  stageElement.append(stageInnerElement);
  document.body.append(stageElement);
  return { stageElement, stageInnerElement, dialCanvas, needleCanvas };
}

describe("analog speedometer sizing", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalDevicePixelRatio,
    });
  });

  it("falls back to bounding rectangles when jsdom client dimensions are zero", () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.53 });
    const fixture = createFixture();
    setClientSize(fixture.stageElement, 0, 0);
    setClientSize(fixture.dialCanvas, 0, 0);
    setRect(fixture.stageElement, 360, 260);
    setRect(fixture.dialCanvas, 280, 280);

    const speedometer = createAnalogSpeedometer(fixture);

    expect(fixture.stageInnerElement.style.getPropertyValue("--analog-speedometer-size")).toBe("260px");
    expect(fixture.dialCanvas.width).toBe(Math.floor(280 * 1.53));
    expect(fixture.dialCanvas.height).toBe(Math.floor(280 * 1.53));
    expect(fixture.needleCanvas.width).toBe(Math.floor(280 * 1.53));
    speedometer.destroy();
  });

  it("prefers transform-safe client dimensions over bounding rectangles", () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.96 });
    const fixture = createFixture();
    setClientSize(fixture.stageElement, 300, 260);
    setClientSize(fixture.dialCanvas, 240, 240);
    setRect(fixture.stageElement, 600, 520);
    setRect(fixture.dialCanvas, 480, 480);

    const speedometer = createAnalogSpeedometer(fixture);

    expect(fixture.stageInnerElement.style.getPropertyValue("--analog-speedometer-size")).toBe("260px");
    expect(fixture.dialCanvas.width).toBe(Math.floor(240 * 1.96));
    expect(fixture.dialCanvas.height).toBe(Math.floor(240 * 1.96));
    speedometer.destroy();
  });

  it("uses the default dial radius unless a contained larger radius is configured", () => {
    const defaultFixture = createFixture();
    setClientSize(defaultFixture.stageElement, 200, 200);
    setClientSize(defaultFixture.dialCanvas, 200, 200);
    const defaultContext = defaultFixture.dialCanvas.getContext("2d");

    const defaultSpeedometer = createAnalogSpeedometer(defaultFixture);
    expect(defaultContext.arc.mock.calls[0][2]).toBeCloseTo(84, 5);
    defaultSpeedometer.destroy();

    const expandedFixture = createFixture();
    setClientSize(expandedFixture.stageElement, 200, 200);
    setClientSize(expandedFixture.dialCanvas, 200, 200);
    expandedFixture.stageElement.style.setProperty("--analog-speedometer-radius-ratio", "0.46");
    const expandedContext = expandedFixture.dialCanvas.getContext("2d");

    const expandedSpeedometer = createAnalogSpeedometer(expandedFixture);
    expect(expandedContext.arc.mock.calls[0][2]).toBeCloseTo(92, 5);
    expect(expandedContext.arc.mock.calls[0][2] * 2).toBeLessThanOrEqual(200);
    expandedSpeedometer.destroy();
  });

  it("coalesces real resize events and cancels pending work on destroy", () => {
    const fixture = createFixture();
    setClientSize(fixture.stageElement, 280, 280);
    setClientSize(fixture.dialCanvas, 240, 240);
    const callbacks = new Map();
    let nextFrame = 1;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrame;
      nextFrame += 1;
      callbacks.set(id, callback);
      return id;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      callbacks.delete(id);
    });

    const speedometer = createAnalogSpeedometer(fixture);
    expect(requestFrame).not.toHaveBeenCalled();

    fixture.dialCanvas.clientWidth = 220;
    fixture.dialCanvas.clientHeight = 220;
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(requestFrame).toHaveBeenCalledTimes(1);

    callbacks.get(1)(performance.now());
    callbacks.delete(1);
    expect(fixture.dialCanvas.width).toBe(220);

    window.dispatchEvent(new Event("resize"));
    expect(requestFrame).toHaveBeenCalledTimes(2);
    speedometer.destroy();

    expect(cancelFrame).toHaveBeenCalledWith(2);
    expect(callbacks.has(2)).toBe(false);
  });
});
