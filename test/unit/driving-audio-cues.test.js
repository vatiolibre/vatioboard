import { describe, expect, it, vi } from "vitest";

import { createDrivingAudioCueController } from "../../src/shared/driving-audio-cues.js";

class CueAudioDouble extends EventTarget {
  static instances = [];

  constructor(src = "") {
    super();
    this.src = src;
    this.currentTime = 3;
    this.loop = true;
    this.muted = true;
    this.paused = true;
    this.playsInline = false;
    this.preload = "none";
    this.volume = 0;
    this.playCalls = 0;
    this.rejectPlayback = false;
    CueAudioDouble.instances.push(this);
  }

  pause() {
    this.paused = true;
  }

  play() {
    this.playCalls += 1;
    if (this.rejectPlayback) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
}

describe("driving audio cues", () => {
  it("preloads and plays each cue from the initiating call", async () => {
    CueAudioDouble.instances = [];
    const controller = createDrivingAudioCueController({
      alertsArmedUrl: "/audio/armed.m4a",
      recordingStartedUrl: "/audio/recording.m4a",
      AudioClass: CueAudioDouble,
    });

    expect(CueAudioDouble.instances).toHaveLength(2);
    expect(CueAudioDouble.instances.every((audio) => audio.preload === "auto")).toBe(true);
    expect(controller.playAlertsArmedCue()).toBe(true);
    expect(controller.playRecordingStartedCue()).toBe(true);
    expect(CueAudioDouble.instances[0]).toMatchObject({
      currentTime: 0,
      muted: false,
      playCalls: 1,
      volume: 1,
    });
    expect(CueAudioDouble.instances[1].playCalls).toBe(1);
    await Promise.resolve();
    expect(controller.getSnapshot()).toEqual({
      alertsArmedBlocked: false,
      recordingStartedBlocked: false,
    });
  });

  it("reports rejected playback and releases both elements on destroy", async () => {
    CueAudioDouble.instances = [];
    const onStateChange = vi.fn();
    const controller = createDrivingAudioCueController({
      alertsArmedUrl: "/audio/armed.m4a",
      recordingStartedUrl: "/audio/recording.m4a",
      AudioClass: CueAudioDouble,
      onStateChange,
    });
    CueAudioDouble.instances[0].rejectPlayback = true;

    controller.playAlertsArmedCue();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot().alertsArmedBlocked).toBe(true);
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      alertsArmedBlocked: true,
    }));

    controller.destroy();
    expect(CueAudioDouble.instances.every((audio) => audio.paused && audio.currentTime === 0)).toBe(true);
  });
});
