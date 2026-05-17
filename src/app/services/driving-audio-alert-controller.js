import {
  OVERSPEED_SOUND_URL,
  TRAP_SOUND_URL,
} from "../../speed/constants.js";
import { shouldPlayOverspeedSound } from "../../speed/alerts.js";
import {
  activateAudioElement,
  primeAudioElement,
} from "../../shared/audio-channel-retainer.js";
import {
  acquireBackgroundAudioLease,
  isBackgroundAudioLeaseActive,
  releaseBackgroundAudioLease,
} from "../../shared/audio-system.js";

export const DRIVING_ALERT_BACKGROUND_AUDIO_LEASE = "speed-alerts";

function createAlertAudioState() {
  return {
    overspeedAudible: false,
    trapAudible: false,
    alertSoundBlocked: false,
    trapSoundBlocked: false,
    alertSoundPending: false,
    trapSoundPending: false,
    muted: false,
    primed: false,
    primePending: false,
    backgroundAudioArmed: false,
    backgroundAudioArmPending: false,
    lastTrapSoundedId: null,
    overspeedRequestId: 0,
    trapRequestId: 0,
  };
}

export function createDrivingAudioAlertController({
  AudioClass = globalThis.Audio,
  onStateChange = null,
} = {}) {
  const state = createAlertAudioState();
  const overspeedAudio = new AudioClass(OVERSPEED_SOUND_URL);
  overspeedAudio.loop = true;
  overspeedAudio.preload = "auto";
  overspeedAudio.playsInline = true;

  const trapAudio = new AudioClass(TRAP_SOUND_URL);
  trapAudio.loop = false;
  trapAudio.preload = "auto";
  trapAudio.playsInline = true;

  let primePromise = null;

  function emit() {
    try {
      onStateChange?.(getSnapshot());
    } catch {
      // Audio advisory state should not break driving alerts.
    }
  }

  function stopAudio(audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Best effort only.
    }
  }

  function stopOverspeed() {
    state.overspeedRequestId += 1;
    state.alertSoundPending = false;
    state.overspeedAudible = false;
    stopAudio(overspeedAudio);
  }

  function stopTrap({ resetLastTrap = false } = {}) {
    state.trapRequestId += 1;
    state.trapSoundPending = false;
    state.trapAudible = false;
    if (resetLastTrap) state.lastTrapSoundedId = null;
    stopAudio(trapAudio);
  }

  async function armBackgroundAudio() {
    if (state.backgroundAudioArmed || state.backgroundAudioArmPending) return state.backgroundAudioArmed;
    state.backgroundAudioArmPending = true;
    emit();
    try {
      state.backgroundAudioArmed = Boolean(await acquireBackgroundAudioLease(
        DRIVING_ALERT_BACKGROUND_AUDIO_LEASE,
        { shouldContinue: () => state.backgroundAudioArmed || state.backgroundAudioArmPending },
      ));
      return state.backgroundAudioArmed;
    } catch {
      state.backgroundAudioArmed = false;
      return false;
    } finally {
      state.backgroundAudioArmPending = false;
      emit();
    }
  }

  function disarmBackgroundAudio() {
    state.backgroundAudioArmed = false;
    state.backgroundAudioArmPending = false;
    releaseBackgroundAudioLease(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE);
    emit();
  }

  function playLoopingOverspeed({ fromUserGesture = false } = {}) {
    if (state.overspeedAudible && !overspeedAudio.paused) return;
    if (state.alertSoundPending) return;
    if (state.alertSoundBlocked && !fromUserGesture) return;

    overspeedAudio.loop = true;
    overspeedAudio.currentTime = 0;
    activateAudioElement(overspeedAudio);
    const requestId = ++state.overspeedRequestId;
    const playPromise = overspeedAudio.play();
    if (!playPromise || typeof playPromise.then !== "function") {
      state.alertSoundBlocked = false;
      state.overspeedAudible = true;
      emit();
      return;
    }

    state.alertSoundPending = true;
    emit();
    playPromise
      .then(() => {
        if (requestId !== state.overspeedRequestId) return;
        state.alertSoundPending = false;
        state.alertSoundBlocked = false;
        state.overspeedAudible = true;
        emit();
      })
      .catch(() => {
        if (requestId !== state.overspeedRequestId) return;
        state.alertSoundPending = false;
        state.alertSoundBlocked = true;
        state.overspeedAudible = false;
        stopAudio(overspeedAudio);
        emit();
      });
  }

  function playTrapOnce({ trapId, fromUserGesture = false } = {}) {
    if (!trapId) {
      stopTrap({ resetLastTrap: true });
      return;
    }
    if (trapId === state.lastTrapSoundedId) return;
    if (state.trapSoundPending) return;
    if (state.trapSoundBlocked && !fromUserGesture) return;

    trapAudio.loop = false;
    trapAudio.currentTime = 0;
    activateAudioElement(trapAudio);
    const requestId = ++state.trapRequestId;
    const playPromise = trapAudio.play();
    if (!playPromise || typeof playPromise.then !== "function") {
      state.trapSoundBlocked = false;
      state.trapAudible = true;
      state.lastTrapSoundedId = trapId;
      emit();
      return;
    }

    state.trapSoundPending = true;
    emit();
    playPromise
      .then(() => {
        if (requestId !== state.trapRequestId) return;
        state.trapSoundPending = false;
        state.trapSoundBlocked = false;
        state.trapAudible = true;
        state.lastTrapSoundedId = trapId;
        emit();
      })
      .catch(() => {
        if (requestId !== state.trapRequestId) return;
        state.trapSoundPending = false;
        state.trapSoundBlocked = true;
        state.trapAudible = false;
        stopAudio(trapAudio);
        emit();
      });
  }

  function sync({
    alertUiState,
    nearestTrapId = null,
    alertSoundEnabled = true,
    trapSoundEnabled = true,
    muted = false,
    audioIntended = false,
    fromUserGesture = false,
  } = {}) {
    state.muted = Boolean(muted);
    if (audioIntended && !state.muted) {
      void armBackgroundAudio();
    }

    if (shouldPlayOverspeedSound(alertUiState || {}, alertSoundEnabled, state.muted)) {
      playLoopingOverspeed({ fromUserGesture });
    } else {
      state.alertSoundBlocked = false;
      stopOverspeed();
    }

    if (!alertUiState?.trapActive) {
      state.trapSoundBlocked = false;
      stopTrap({ resetLastTrap: true });
    } else if (trapSoundEnabled && !state.muted) {
      playTrapOnce({ trapId: nearestTrapId, fromUserGesture });
    } else {
      state.trapSoundBlocked = false;
      stopTrap();
    }

    emit();
  }

  function primeAudioFromUserGesture({ keepAlive = true } = {}) {
    if (state.primed && (!keepAlive || isBackgroundAudioLeaseActive(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE))) {
      return Promise.resolve(true);
    }
    if (primePromise) return primePromise;

    state.primePending = true;
    emit();
    primePromise = (async () => {
      try {
        if (keepAlive) await armBackgroundAudio();
        const [overspeedPrimed, trapPrimed] = await Promise.all([
          primeAudioElement(overspeedAudio),
          primeAudioElement(trapAudio),
        ]);
        state.primed = Boolean(overspeedPrimed && trapPrimed);
        if (state.primed) {
          state.alertSoundBlocked = false;
          state.trapSoundBlocked = false;
        }
        return state.primed;
      } finally {
        state.primePending = false;
        primePromise = null;
        emit();
      }
    })();

    return primePromise;
  }

  function setMuted(muted) {
    state.muted = Boolean(muted);
    if (state.muted) {
      stopOverspeed();
      stopTrap();
    }
    emit();
  }

  function getSnapshot() {
    return {
      overspeedAudible: state.overspeedAudible,
      trapAudible: state.trapAudible,
      blocked: state.alertSoundBlocked || state.trapSoundBlocked,
      alertSoundBlocked: state.alertSoundBlocked,
      trapSoundBlocked: state.trapSoundBlocked,
      pending: state.alertSoundPending || state.trapSoundPending || state.primePending,
      muted: state.muted,
      primed: state.primed,
      backgroundAudioArmed:
        state.backgroundAudioArmed && isBackgroundAudioLeaseActive(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE),
      backgroundAudioArmPending: state.backgroundAudioArmPending,
    };
  }

  function destroy() {
    stopOverspeed();
    stopTrap({ resetLastTrap: true });
    disarmBackgroundAudio();
  }

  return {
    destroy,
    disarmBackgroundAudio,
    getSnapshot,
    primeAudioFromUserGesture,
    setMuted,
    sync,
  };
}
