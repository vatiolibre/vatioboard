import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAudioChannelRetainer,
  primeAudioElement,
  createSilentLoopAudioUrl,
  resetAudioElementPlaybackRate,
} from "../../src/shared/audio-channel-retainer.js";

let activeRetainer = null;

afterEach(() => {
  activeRetainer?.dispose();
  activeRetainer = null;
});

describe("audio-channel-retainer", () => {
  it("generates the default silent keep-alive loop at a normal music sample rate", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    let createdBlob = null;

    URL.createObjectURL = vi.fn((blob) => {
      createdBlob = blob;
      return "blob:retainer-silent-loop";
    });

    try {
      expect(createSilentLoopAudioUrl()).toBe("blob:retainer-silent-loop");
      const wav = new DataView(await createdBlob.arrayBuffer());

      expect(wav.getUint32(24, true)).toBe(44100);
      expect(wav.getUint32(28, true)).toBe(44100 * 2);
      expect(wav.getUint16(20, true)).toBe(1);
      expect(wav.getUint16(34, true)).toBe(16);
      expect(wav.getUint32(40, true)).toBe(wav.byteLength - 44);
      expect(new Uint8Array(wav.buffer, 44).every((sample) => sample === 0)).toBe(true);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it("resets media elements to normal playback speed and pitch", () => {
    const audio = new Audio();
    audio.defaultPlaybackRate = 0.75;
    audio.playbackRate = 0.75;
    audio.preservesPitch = false;
    audio.webkitPreservesPitch = false;
    audio.mozPreservesPitch = false;

    resetAudioElementPlaybackRate(audio);

    expect(audio.defaultPlaybackRate).toBe(1);
    expect(audio.playbackRate).toBe(1);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(audio.mozPreservesPitch).toBe(true);
  });

  it("normalizes the shared keep-alive element before arming it", async () => {
    activeRetainer = createAudioChannelRetainer();
    const keepAliveAudio = activeRetainer.getKeepAliveAudio();
    keepAliveAudio.defaultPlaybackRate = 0.5;
    keepAliveAudio.playbackRate = 0.5;

    await activeRetainer.ensureKeepAlivePlaying({
      shouldContinue: () => true,
    });

    expect(keepAliveAudio.defaultPlaybackRate).toBe(1);
    expect(keepAliveAudio.playbackRate).toBe(1);
    expect(keepAliveAudio.paused).toBe(false);
    expect(keepAliveAudio.loop).toBe(true);
    expect(keepAliveAudio.muted).toBe(false);
    expect(keepAliveAudio.volume).toBe(1);
  });
});

it("stale priming completion cannot pause, rewind, or mute a newer playback operation", async () => {
  const audio = new Audio();
  let resolvePlay;
  audio.play = vi.fn(() => new Promise((resolve) => { resolvePlay = resolve; }));
  let current = true;
  const priming = primeAudioElement(audio, { isCurrent: () => current });
  current = false;
  audio.paused = false;
  audio.currentTime = 25;
  audio.muted = false;
  audio.volume = 0.8;
  const pause = vi.spyOn(audio, "pause");
  resolvePlay();
  expect(await priming).toBe(false);
  expect(pause).not.toHaveBeenCalled();
  expect(audio.currentTime).toBe(25);
  expect(audio.muted).toBe(false);
  expect(audio.volume).toBe(0.8);
});
