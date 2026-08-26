import { activateAudioElement } from "./audio-channel-retainer.js";

type CueAudioElement = HTMLAudioElement & { playsInline?: boolean };
type CueAudioConstructor = new (src?: string) => CueAudioElement;

export interface DrivingAudioCueSnapshot {
  alertsArmedBlocked: boolean;
  recordingStartedBlocked: boolean;
}

export interface DrivingAudioCueController {
  destroy(): void;
  getSnapshot(): DrivingAudioCueSnapshot;
  playAlertsArmedCue(): boolean;
  playRecordingStartedCue(): boolean;
}

interface DrivingAudioCueControllerOptions {
  alertsArmedUrl: string;
  recordingStartedUrl: string;
  AudioClass?: CueAudioConstructor;
  onStateChange?: ((snapshot: DrivingAudioCueSnapshot) => void) | null;
}

function prepareCue(audio: CueAudioElement): void {
  audio.loop = false;
  audio.preload = "auto";
  audio.playsInline = true;
}

export function createDrivingAudioCueController({
  alertsArmedUrl,
  recordingStartedUrl,
  AudioClass = globalThis.Audio as CueAudioConstructor,
  onStateChange = null,
}: DrivingAudioCueControllerOptions): DrivingAudioCueController {
  const alertsArmedAudio = new AudioClass(alertsArmedUrl);
  const recordingStartedAudio = new AudioClass(recordingStartedUrl);
  prepareCue(alertsArmedAudio);
  prepareCue(recordingStartedAudio);

  const state: DrivingAudioCueSnapshot = {
    alertsArmedBlocked: false,
    recordingStartedBlocked: false,
  };
  let destroyed = false;

  function getSnapshot(): DrivingAudioCueSnapshot {
    return { ...state };
  }

  function emit(): void {
    if (destroyed) return;
    try {
      onStateChange?.(getSnapshot());
    } catch {
      // Cue status is advisory and must not interrupt a driving control.
    }
  }

  function playCue(
    audio: CueAudioElement,
    blockedKey: keyof DrivingAudioCueSnapshot,
  ): boolean {
    if (destroyed) return false;
    try {
      audio.pause();
      audio.currentTime = 0;
      activateAudioElement(audio);
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        void playPromise.then(() => {
          state[blockedKey] = false;
          emit();
        }).catch(() => {
          state[blockedKey] = true;
          emit();
        });
      } else {
        state[blockedKey] = false;
        emit();
      }
      return true;
    } catch {
      state[blockedKey] = true;
      emit();
      return false;
    }
  }

  function stopCue(audio: CueAudioElement): void {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Best-effort cleanup only.
    }
  }

  return {
    destroy() {
      destroyed = true;
      stopCue(alertsArmedAudio);
      stopCue(recordingStartedAudio);
    },
    getSnapshot,
    playAlertsArmedCue() {
      return playCue(alertsArmedAudio, "alertsArmedBlocked");
    },
    playRecordingStartedCue() {
      return playCue(recordingStartedAudio, "recordingStartedBlocked");
    },
  };
}
