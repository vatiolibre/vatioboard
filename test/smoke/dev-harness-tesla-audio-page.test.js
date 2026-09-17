import { afterEach, expect, it, vi } from "vitest";
import { bootHtmlPage } from "../helpers/page-smoke.js";

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("starts shared playback from one tap and stops only its own leases", async () => {
  await bootHtmlPage("tesla-background-audio.html");
  window.history.replaceState(null, "", "/tesla-background-audio.html?audioCompatibility=0");
  vi.useFakeTimers();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  // Import without automatic mounting so the test owns cleanup.
  const root = document.getElementById("tesla-audio-test");
  root.removeAttribute("id");
  const { mountTeslaAudioTest } = await import("../../src/player/tesla-background-audio.js");
  const runtime = await import("../../src/shared/audio-runtime.js");
  const system = await import("../../src/shared/audio-system.js");
  const unmount = mountTeslaAudioTest(root);
  const click = (label) => [...root.querySelectorAll("button")].find((button) => button.textContent === label).click();
  click("START TESLA BACKGROUND TEST");
  const primary = runtime.getAudioElement();
  expect(primary.paused).toBe(false);
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(false);
  expect(navigator.mediaSession.metadata.title).toBe("Tesla test 1");
  const timerCount = vi.getTimerCount();
  click("START TESLA BACKGROUND TEST");
  expect(vi.getTimerCount()).toBe(timerCount);
  click("Pause real track");
  expect(primary.paused).toBe(true);
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(false);
  // More than one complete fixture cycle must not exhaust the Player queue.
  for (let i = 0; i < 6; i++) {
    click("Next");
    await Promise.resolve();
    expect(runtime.getState().queue).toHaveLength(2);
    expect(system.hasBackgroundAudioLease("player-runtime")).toBe(true);
  }
  await system.acquireBackgroundAudioLease("drive-recording");
  click("STOP TEST");
  expect(system.getBackgroundAudioState().activeLeaseIds).toEqual(["drive-recording"]);
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(false);
  expect(runtime.getAudioElement()).toBe(primary);
  unmount();
  system.releaseBackgroundAudioLease("drive-recording");
});
