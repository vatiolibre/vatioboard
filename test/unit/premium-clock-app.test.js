import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createShellWindowManager } from "../../src/shared/shell-window-manager.js";
import {
  PREMIUM_CLOCK_WINDOW_ID,
  createPremiumClockApp,
  premiumClockAppManifest,
} from "../../src/apps/premium-clock/index.js";

describe("Premium Clock app", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  function mockAudio() {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const AudioMock = vi.fn(function AudioMock(src) {
      this.src = src;
      this.loop = false;
      this.muted = false;
      this.preload = "";
      this.volume = 1;
      this.currentTime = 0;
      this.play = play;
      this.pause = pause;
    });
    vi.stubGlobal("Audio", AudioMock);
    return { AudioMock, pause, play };
  }

  it("declares a fixed non-maximizable tool window", () => {
    expect(premiumClockAppManifest).toMatchObject({
      id: "vatio.premiumClock",
      kind: "tool-app",
      surfaces: expect.arrayContaining(["shell-window", "start-menu", "taskbar", "launcher"]),
      permissions: expect.arrayContaining(["shell.window", "storage.app"]),
      services: expect.arrayContaining(["shell", "storage"]),
    });
    expect(premiumClockAppManifest.window).toMatchObject({
      shellWindowId: PREMIUM_CLOCK_WINDOW_ID,
      mode: "floating",
      capabilities: {
        resizable: false,
        maximizable: false,
        snap: false,
        preserveIntrinsicWidth: true,
      },
    });
    expect(premiumClockAppManifest.metadata.sourceReference.reuse).toContain("no third-party code");
  });

  it("registers, opens, minimizes, and closes through the shell manager", () => {
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const app = createPremiumClockApp({ shellManager: manager });
    const panel = document.querySelector(".premium-clock-panel");

    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(true);
    expect(manager.getWindow(PREMIUM_CLOCK_WINDOW_ID)).toMatchObject({
      id: PREMIUM_CLOCK_WINDOW_ID,
      title: "Premium Clock",
      capabilities: {
        resizable: false,
        maximizable: false,
        snap: false,
      },
    });

    app.open();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".premium-clock-details").hidden).toBe(true);
    expect(manager.getWindow(PREMIUM_CLOCK_WINDOW_ID).state).toBe("open");

    panel.querySelector("[aria-label='Minimize clock']").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    panel.querySelector("[aria-label='Minimize clock']").click();
    expect(panel.hidden).toBe(true);
    expect(manager.getWindow(PREMIUM_CLOCK_WINDOW_ID).state).toBe("minimized");

    app.open();
    panel.querySelector("[aria-label='Close clock']").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    panel.querySelector("[aria-label='Close clock']").click();
    expect(panel.hidden).toBe(true);
    expect(manager.getWindow(PREMIUM_CLOCK_WINDOW_ID).state).toBe("closed");

    app.destroy();
    expect(manager.getWindow(PREMIUM_CLOCK_WINDOW_ID)).toBeNull();
    manager.destroy();
  });

  it("renders analog hand angles from local time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 10, 15, 30, 0));

    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const app = createPremiumClockApp({ shellManager: manager });
    const panel = document.querySelector(".premium-clock-panel");

    app.open();

    expect(panel.style.getPropertyValue("--premium-clock-second")).toBe("180deg");
    expect(panel.style.getPropertyValue("--premium-clock-minute")).toBe("93deg");
    expect(panel.style.getPropertyValue("--premium-clock-hour")).toBe("307.75deg");
    expect(panel.querySelector("[data-premium-clock-digital]").textContent).toBe("10:15:30");

    app.destroy();
    manager.destroy();
  });

  it("supports timer, stopwatch, alarms, and world clock modes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 10, 15, 30, 0));

    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const app = createPremiumClockApp({ shellManager: manager });
    const panel = document.querySelector(".premium-clock-panel");

    app.open();

    panel.querySelector("[data-premium-clock-mode-button='timer']").click();
    expect(panel.dataset.premiumClockMode).toBe("timer");
    expect(panel.querySelector(".premium-clock-details").hidden).toBe(false);
    expect(panel.querySelector("[data-premium-clock-timer-duration]").textContent).toBe("05:00");
    panel.querySelector("[data-premium-clock-timer-toggle]").click();
    vi.advanceTimersByTime(1250);
    expect(panel.querySelector("[data-premium-clock-digital]").textContent).toBe("00:04:58");

    panel.querySelector("[data-premium-clock-mode-button='stopwatch']").click();
    panel.querySelector("[data-premium-clock-stopwatch-toggle]").click();
    vi.advanceTimersByTime(2250);
    expect(panel.querySelector("[data-premium-clock-digital]").textContent).toMatch(/^00:00:02\./);

    panel.querySelector("[data-premium-clock-mode-button='alarms']").click();
    panel.querySelector("[data-premium-clock-alarm-add]").click();
    expect(panel.querySelector("[data-premium-clock-alarm-list]").textContent).toContain("07:30");

    panel.querySelector("[data-premium-clock-mode-button='world']").click();
    expect(panel.dataset.premiumClockMode).toBe("world");
    expect(panel.querySelector("[data-premium-clock-world-list]").textContent).toContain("London");

    panel.querySelector("[data-premium-clock-mode-button='clock']").click();
    expect(panel.querySelector(".premium-clock-details").hidden).toBe(true);

    app.destroy();
    manager.destroy();
  });

  it("plays the alarm sound for timers and lets the user stop it", async () => {
    const audio = mockAudio();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 10, 15, 30, 0));

    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const app = createPremiumClockApp({ shellManager: manager });
    const panel = document.querySelector(".premium-clock-panel");

    app.open();
    panel.querySelector("[data-premium-clock-mode-button='timer']").click();
    panel.querySelector("[data-premium-clock-timer-toggle]").click();
    vi.advanceTimersByTime(5 * 60 * 1000);
    await Promise.resolve();

    expect(audio.AudioMock).toHaveBeenCalledWith("/audio/alarm-clock.m4a");
    expect(audio.play).toHaveBeenCalled();
    expect(panel.querySelector("[data-premium-clock-notice-message]").textContent).toBe("Timer complete");
    expect(panel.querySelector("[data-premium-clock-alert-stop]").hidden).toBe(false);
    expect(panel.querySelector("[data-premium-clock-alert-snooze]").hidden).toBe(true);

    panel.querySelector("[data-premium-clock-alert-stop]").click();
    expect(panel.querySelector("[data-premium-clock-notice]").hidden).toBe(true);
    expect(audio.pause).toHaveBeenCalled();

    app.destroy();
    manager.destroy();
  });

  it("plays alarm alerts and supports snooze", async () => {
    const audio = mockAudio();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 7, 29, 59, 0));

    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const app = createPremiumClockApp({ shellManager: manager });
    const panel = document.querySelector(".premium-clock-panel");

    app.open();
    panel.querySelector("[data-premium-clock-mode-button='alarms']").click();
    panel.querySelector("[data-premium-clock-alarm-add]").click();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(panel.querySelector("[data-premium-clock-notice-message]").textContent).toBe("Alarm 07:30");
    expect(panel.querySelector("[data-premium-clock-alert-snooze]").hidden).toBe(false);
    expect(audio.play).toHaveBeenCalled();

    panel.querySelector("[data-premium-clock-alert-snooze]").click();
    expect(panel.querySelector("[data-premium-clock-notice]").hidden).toBe(true);
    expect(audio.pause).toHaveBeenCalled();

    vi.advanceTimersByTime(9 * 60 * 1000);
    await Promise.resolve();
    expect(panel.querySelector("[data-premium-clock-notice-message]").textContent).toBe("Alarm 07:30");

    app.destroy();
    manager.destroy();
  });

  it("uses browser text-to-speech when the clock is touched", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 10, 15, 30, 0));
    const speak = vi.fn();
    const cancel = vi.fn();
    class UtteranceMock {
      constructor(text) {
        this.text = text;
      }
    }
    vi.stubGlobal("speechSynthesis", { cancel, speak });
    vi.stubGlobal("SpeechSynthesisUtterance", UtteranceMock);

    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const app = createPremiumClockApp({ shellManager: manager });
    const panel = document.querySelector(".premium-clock-panel");

    app.open();
    panel.querySelector(".premium-clock-drag-zone").dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    }));
    panel.querySelector(".premium-clock-drag-zone").dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    }));

    expect(cancel).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toContain("The time is");
    expect(speak.mock.calls[0][0].text).toContain("Today is");

    app.destroy();
    manager.destroy();
  });
});
