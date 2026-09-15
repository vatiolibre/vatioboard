import { afterEach, beforeEach, expect, it, vi } from "vitest";

let controller;
let system;
beforeEach(async () => {
  vi.resetModules();
  system = await import("../../src/shared/audio-system.js");
});
afterEach(() => {
  controller?.destroy();
  system.disposeAudioSystemForTests();
  vi.restoreAllMocks();
});

it("starts both alert elements before pending keep-alive playback settles", async () => {
  const { createDrivingAudioAlertController } = await import("../../src/app/services/driving-audio-alert-controller.js");
  const elements = [];
  class AlertAudio extends Audio {
    constructor(src) { super(src); elements.push(this); }
  }
  controller = createDrivingAudioAlertController({ AudioClass: AlertAudio });
  const alertPlay = elements.map((element) => vi.spyOn(element, "play"));
  const keepAlive = system.getBackgroundKeepAliveAudio();
  let finish;
  vi.spyOn(keepAlive, "play").mockImplementation(() => {
    keepAlive.paused = false;
    return new Promise((resolve) => { finish = resolve; });
  });
  const pending = controller.primeAudioFromUserGesture();
  expect(alertPlay.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  controller.sync({ audioIntended: true });
  finish();
  expect(await pending).toBe(true);
  await system.activateBackgroundAudioFromGesture();
  expect(alertPlay.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  controller.sync({ audioIntended: true, muted: true });
  expect(system.hasBackgroundAudioLease("speed-alerts")).toBe(true);
  controller.sync({ audioIntended: false });
  expect(system.hasBackgroundAudioLease("speed-alerts")).toBe(false);
});

it("retains alert intent after rejection without retrying on every telemetry sync", async () => {
  const { createDrivingAudioAlertController } = await import("../../src/app/services/driving-audio-alert-controller.js");
  controller = createDrivingAudioAlertController();
  const play = vi.spyOn(system.getBackgroundKeepAliveAudio(), "play")
    .mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
  controller.sync({ audioIntended: true });
  await vi.waitFor(() => expect(system.getBackgroundAudioState().status).toBe("blocked"));
  for (let i = 0; i < 20; i++) controller.sync({ audioIntended: true });
  expect(play).toHaveBeenCalledTimes(1);
  expect(system.hasBackgroundAudioLease("speed-alerts")).toBe(true);
  play.mockRestore();
  await system.rearmBackgroundAudio();
  expect(controller.getSnapshot().backgroundAudioArmed).toBe(true);
});
