import { afterEach, expect, it, vi } from "vitest";
let controller, system;
afterEach(() => {
  controller?.destroy();
  system?.disposeAudioSystemForTests();
});
it("uses main's alert activation and keeps recording independent", async () => {
  vi.resetModules();
  system = await import("../../src/shared/audio-system.js");
  const { createDrivingAudioAlertController } =
    await import("../../src/app/services/driving-audio-alert-controller.js");
  controller = createDrivingAudioAlertController();
  expect(await controller.primeAudioFromUserGesture()).toBe(true);
  controller.sync({ audioIntended: true });
  await system.acquireBackgroundAudioLease("drive-recording");
  expect(system.hasBackgroundAudioLease("speed-alerts")).toBe(true);
  controller.destroy();
  controller = null;
  expect(system.hasBackgroundAudioLease("drive-recording")).toBe(true);
  expect(system.getBackgroundKeepAliveAudio().paused).toBe(false);
});
