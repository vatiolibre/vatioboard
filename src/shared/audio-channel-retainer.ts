interface SilentLoopAudioOptions {
  sampleRate?: number;
  durationSeconds?: number;
}

interface PrimeAudioElementOptions {
  getResumeTime?: ((audio: HTMLAudioElement) => number) | null;
  beforePlay?: ((audio: HTMLAudioElement, resumeTime: number) => void) | null;
  restorePlayback?: ((audio: HTMLAudioElement, resumeTime: number) => void) | null;
}

interface AudioChannelRetainerOptions {
  keepAliveSampleRate?: number;
  keepAliveDurationSeconds?: number;
}

export interface AudioChannelRetainer {
  activateAudioElement(audio: HTMLAudioElement | null | undefined, volume?: number): void;
  dispose(): void;
  ensureAudioElementLooping(
    audio: HTMLAudioElement | null | undefined,
    options?: { shouldContinue?: (() => boolean) | null },
  ): Promise<boolean>;
  ensureKeepAlivePlaying(options?: { shouldContinue?: (() => boolean) | null }): Promise<boolean>;
  getKeepAliveAudio(): HTMLAudioElement;
  isKeepAliveActive(): boolean;
  silenceAudioElement(audio: HTMLAudioElement | null | undefined): void;
  stopAudioElementPlayback(audio: HTMLAudioElement | null | undefined): void;
  stopKeepAlive(): void;
}

function writeAsciiString(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof (value as { then?: unknown }).then === "function");
}

export function createSilentLoopAudioUrl({
  sampleRate = 44100,
  durationSeconds = 2,
}: SilentLoopAudioOptions = {}): string {
  const sampleCount = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + (sampleCount * 2));
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + (sampleCount * 2), true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export function silenceAudioElement(audio: HTMLAudioElement | null | undefined): void {
  if (!audio) return;
  audio.muted = true;
  audio.volume = 0;
}

export function resetAudioElementPlaybackRate(audio: HTMLAudioElement | null | undefined): void {
  if (!audio) return;

  try { audio.defaultPlaybackRate = 1; } catch { /* ignore */ }
  try { audio.playbackRate = 1; } catch { /* ignore */ }
  try { audio.preservesPitch = true; } catch { /* ignore */ }
  try { audio.webkitPreservesPitch = true; } catch { /* ignore */ }
  try { audio.mozPreservesPitch = true; } catch { /* ignore */ }
}

export function activateAudioElement(audio: HTMLAudioElement | null | undefined, volume = 1): void {
  if (!audio) return;
  resetAudioElementPlaybackRate(audio);
  audio.muted = false;
  audio.volume = volume;
}

export async function primeAudioElement(
  audio: HTMLAudioElement | null | undefined,
  {
    getResumeTime = null,
    beforePlay = null,
    restorePlayback = null,
  }: PrimeAudioElementOptions = {},
): Promise<boolean> {
  if (!audio) return false;
  resetAudioElementPlaybackRate(audio);
  if (!audio.paused) return true;

  const previousMuted = audio.muted;
  const previousVolume = audio.volume;
  const previousLoop = audio.loop;
  const resumeTime = typeof getResumeTime === "function" ? getResumeTime(audio) : 0;

  audio.muted = true;
  audio.volume = 0;
  audio.currentTime = 0;

  if (typeof beforePlay === "function") {
    beforePlay(audio, resumeTime);
  }

  try {
    const playPromise = audio.play();
    if (isPromiseLike(playPromise)) {
      await playPromise;
    }
    audio.pause();
    if (typeof restorePlayback === "function") {
      restorePlayback(audio, resumeTime);
    } else {
      audio.currentTime = 0;
    }
    return true;
  } catch {
    audio.pause();
    if (typeof restorePlayback === "function") {
      restorePlayback(audio, resumeTime);
    } else {
      audio.currentTime = 0;
    }
    return false;
  } finally {
    audio.muted = previousMuted;
    audio.volume = previousVolume;
    audio.loop = previousLoop;
  }
}

export function createAudioChannelRetainer({
  keepAliveSampleRate = 44100,
  keepAliveDurationSeconds = 2,
}: AudioChannelRetainerOptions = {}): AudioChannelRetainer {
  let keepAliveAudioUrl = createSilentLoopAudioUrl({
    sampleRate: keepAliveSampleRate,
    durationSeconds: keepAliveDurationSeconds,
  });

  const keepAliveAudio = new Audio(keepAliveAudioUrl);
  keepAliveAudio.loop = true;
  keepAliveAudio.preload = "auto";
  keepAliveAudio.playsInline = true;
  resetAudioElementPlaybackRate(keepAliveAudio);

  function stopAudioElementPlayback(audio: HTMLAudioElement | null | undefined): void {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  async function ensureKeepAlivePlaying({
    shouldContinue = null,
  }: { shouldContinue?: (() => boolean) | null } = {}): Promise<boolean> {
    resetAudioElementPlaybackRate(keepAliveAudio);
    keepAliveAudio.loop = true;
    keepAliveAudio.muted = false;
    keepAliveAudio.volume = 1;

    if (!keepAliveAudio.paused) {
      return typeof shouldContinue === "function" ? shouldContinue() : true;
    }

    keepAliveAudio.currentTime = 0;
    const playPromise = keepAliveAudio.play();
    if (isPromiseLike(playPromise)) {
      await playPromise;
    }

    if (typeof shouldContinue === "function" && !shouldContinue()) {
      stopKeepAlive();
      return false;
    }

    return true;
  }

  async function ensureAudioElementLooping(
    audio: HTMLAudioElement | null | undefined,
    { shouldContinue = null }: { shouldContinue?: (() => boolean) | null } = {},
  ): Promise<boolean> {
    if (!audio) return false;

    resetAudioElementPlaybackRate(audio);
    audio.loop = true;

    if (!audio.paused) {
      return typeof shouldContinue === "function" ? shouldContinue() : true;
    }

    silenceAudioElement(audio);
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (isPromiseLike(playPromise)) {
      await playPromise;
    }

    if (typeof shouldContinue === "function" && !shouldContinue()) {
      stopAudioElementPlayback(audio);
      return false;
    }

    return true;
  }

  function stopKeepAlive(): void {
    keepAliveAudio.pause();
    keepAliveAudio.currentTime = 0;
  }

  function revokeKeepAliveAudioUrl(): void {
    if (!keepAliveAudioUrl) return;
    URL.revokeObjectURL(keepAliveAudioUrl);
    keepAliveAudioUrl = "";
  }

  function dispose(): void {
    stopKeepAlive();
    revokeKeepAliveAudioUrl();
  }

  return {
    activateAudioElement,
    dispose,
    ensureAudioElementLooping,
    ensureKeepAlivePlaying,
    getKeepAliveAudio() {
      return keepAliveAudio;
    },
    isKeepAliveActive() {
      return !keepAliveAudio.paused;
    },
    silenceAudioElement,
    stopAudioElementPlayback,
    stopKeepAlive,
  };
}
