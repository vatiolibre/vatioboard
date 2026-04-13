/**
 * Cue / alert audio channel.
 *
 * Provides a separate audio path for short sound effects (speed alerts,
 * accel finish sounds, UI feedback) that do NOT interfere with the main
 * music/track playback element.
 *
 * Design:
 *  - Each cue plays on its own short-lived Audio element.
 *  - Multiple cues can overlap (e.g. an alert while a finish chime is fading).
 *  - Optional ducking: temporarily lowers main audio volume when a cue plays.
 *  - Priming: call prime() after a user gesture to unlock audio on iOS/Tesla.
 *
 * Future: speed/audio.js overspeed and trap sounds can migrate here.
 */

const activeCues = new Map();
const listeners = new Set();
let mainAudioElement = null;
let duckLevel = 1; // 1 = no duck, 0.2 = heavy duck

/**
 * Set the main audio element that ducking will affect.
 * @param {HTMLAudioElement|null} el
 */
export function setMainAudioElement(el) {
  mainAudioElement = el;
}

/**
 * Prime the audio context after a user gesture.
 * Creates and immediately plays a silent buffer to unlock iOS/Tesla audio.
 */
export function prime() {
  try {
    const a = new Audio();
    a.volume = 0;
    a.play().then(() => a.pause()).catch(() => {});
  } catch { /* ignore */ }
}

/**
 * Play a cue sound effect.
 *
 * @param {{ id?: string, src: string, volume?: number, loop?: boolean, duckMainAudio?: boolean }} opts
 * @returns {string} The cue id (generated if not provided)
 */
export function playCue({ id, src, volume = 1, loop = false, duckMainAudio = false }) {
  const cueId = id || `cue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Stop any existing cue with same id
  stopCue(cueId);

  const audio = new Audio(src);
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.loop = loop;
  audio.preload = "auto";
  audio.playsInline = true;

  const cue = { id: cueId, audio, duckMainAudio };
  activeCues.set(cueId, cue);

  if (duckMainAudio) applyDuck();
  notify();

  const cleanup = () => {
    if (activeCues.has(cueId)) {
      activeCues.delete(cueId);
      releaseDuck();
      notify();
    }
  };

  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });

  audio.play().catch(() => {
    cleanup();
  });

  return cueId;
}

/**
 * Stop a specific cue, or all cues if no id is provided.
 * @param {string} [id]
 */
export function stopCue(id) {
  if (id) {
    const cue = activeCues.get(id);
    if (cue) {
      cue.audio.pause();
      cue.audio.src = "";
      cue.audio.load();
      activeCues.delete(id);
    }
  } else {
    for (const [cueId, cue] of activeCues) {
      cue.audio.pause();
      cue.audio.src = "";
      cue.audio.load();
      activeCues.delete(cueId);
    }
  }
  releaseDuck();
  notify();
}

/**
 * Subscribe to cue state changes.
 * @param {Function} listener - Called with { activeCueCount: number }
 * @returns {Function} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get the count of currently playing cues.
 */
export function getActiveCueCount() {
  return activeCues.size;
}

// ── Ducking ──────────────────────────────────────────────────────────

const DUCK_VOLUME = 0.25;
const DUCK_RESTORE_DELAY_MS = 300;
let duckRestoreTimer = null;
let preDuckVolume = 1;

function applyDuck() {
  if (!mainAudioElement) return;
  if (duckLevel < 1) return; // already ducked

  preDuckVolume = mainAudioElement.volume;
  duckLevel = DUCK_VOLUME;
  mainAudioElement.volume = Math.max(0, preDuckVolume * DUCK_VOLUME);
}

function releaseDuck() {
  // Only release if no more ducking cues are active
  const hasDuckingCues = [...activeCues.values()].some((c) => c.duckMainAudio);
  if (hasDuckingCues) return;
  if (duckLevel >= 1) return; // not ducked

  if (duckRestoreTimer) clearTimeout(duckRestoreTimer);
  duckRestoreTimer = setTimeout(() => {
    if (mainAudioElement) {
      mainAudioElement.volume = preDuckVolume;
    }
    duckLevel = 1;
    duckRestoreTimer = null;
  }, DUCK_RESTORE_DELAY_MS);
}

function notify() {
  const state = { activeCueCount: activeCues.size };
  for (const listener of listeners) {
    try { listener(state); } catch { /* ignore */ }
  }
}
