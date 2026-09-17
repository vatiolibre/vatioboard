import { afterEach, expect, it, vi } from "vitest";
import { readAudioCompatibilityOptions } from "../../src/shared/audio-compatibility.js";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.resetModules();
});

it("defaults the harness to compatibility and keeps the main app opt-in", () => {
  const harness = readAudioCompatibilityOptions(new URL("https://example.com/tesla-background-audio.html"));
  expect(harness).toEqual({ enabled: true, attachedElement: true, silentDuringPlayback: false,
    primeOtherConsumers: false, mediaSessionWrites: false, audioSessionHints: false });
  expect(readAudioCompatibilityOptions(new URL("https://example.com/")).enabled).toBe(false);
  expect(readAudioCompatibilityOptions(new URL("https://example.com/?audioCompatibility=1&audioSilence=1&audioAttach=0")))
    .toMatchObject({ enabled: true, attachedElement: false, silentDuringPlayback: true, mediaSessionWrites: false });
});

it("blocks platform writes from every owner, even if the Player re-enables its client", async () => {
  vi.resetModules();
  window.history.replaceState(null, "", "/?audioCompatibility=1");
  const session = navigator.mediaSession;
  const metadata = vi.fn();
  const playback = vi.fn();
  Object.defineProperty(session, "metadata", { configurable: true, get: () => null, set: metadata });
  Object.defineProperty(session, "playbackState", { configurable: true, get: () => "none", set: playback });
  session.setActionHandler.mockClear();
  session.setPositionState = vi.fn();
  const adapter = await import("../../src/shared/media-session-adapter.js");
  for (const owner of ["player-runtime", "background-retention", "recording", "speed"]) {
    adapter.updateMediaSessionClient(owner, { active: true, priority: 10, playbackState: "playing",
      metadata: { title: "Radio" }, handlers: { play() {} }, positionState: { duration: 60, position: 1, playbackRate: 1 } });
    adapter.clearMediaSessionClient(owner);
  }
  expect(metadata).not.toHaveBeenCalled();
  expect(playback).not.toHaveBeenCalled();
  expect(session.setActionHandler).not.toHaveBeenCalled();
  expect(session.setPositionState).not.toHaveBeenCalled();
});
