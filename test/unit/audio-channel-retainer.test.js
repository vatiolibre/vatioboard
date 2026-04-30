import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAudioChannelRetainer,
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
  });
});
