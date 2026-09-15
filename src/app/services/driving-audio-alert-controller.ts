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
  activateBackgroundAudioFromGesture,
  registerBackgroundAudioGestureHandler,
  subscribeBackgroundAudioState,
  isBackgroundAudioLeaseActive,
  releaseBackgroundAudioLease,
} from "../../shared/audio-system.js";

export const DRIVING_ALERT_BACKGROUND_AUDIO_LEASE = "speed-alerts";

type AlertAudioElement = HTMLAudioElement & { playsInline?: boolean };
type AlertAudioConstructor = new (src?: string) => AlertAudioElement;
// TODO(ts-migration): alert state snapshots are consumed by JS speed UI modules.
type LegacyAudioAlertRecord = Record<string, any>;

interface DrivingAudioAlertControllerOptions {
  AudioClass?: AlertAudioConstructor;
  onStateChange?: ((snapshot: LegacyAudioAlertRecord) => void) | null;
}

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
  AudioClass = globalThis.Audio as AlertAudioConstructor,
  onStateChange = null,
}: DrivingAudioAlertControllerOptions = {}) {
  const state = createAlertAudioState();
  const overspeedAudio = new AudioClass(OVERSPEED_SOUND_URL);
  overspeedAudio.loop = true;
  overspeedAudio.preload = "auto";
  overspeedAudio.playsInline = true;

  const trapAudio = new AudioClass(TRAP_SOUND_URL);
  trapAudio.loop = false;
  trapAudio.preload = "auto";
  trapAudio.playsInline = true;

  let primePromise: Promise<boolean> | null = null;
  let backgroundIntended = false;
  let backgroundRevision = 0;
  let destroyed = false;
  const unregisterGesture = registerBackgroundAudioGestureHandler(() => {
    if (!backgroundIntended) return false;
    return primeAlerts();
  });

  let alertsPrimePromise: Promise<boolean> | null = null;
  function primeAlerts() {
    if (state.primed && !state.alertSoundBlocked && !state.trapSoundBlocked) return Promise.resolve(true);
    if (alertsPrimePromise) return alertsPrimePromise;
    state.primePending = true;
    const overspeedRevision = state.overspeedRequestId;
    const trapRevision = state.trapRequestId;
    alertsPrimePromise = Promise.all([
      primeAudioElement(overspeedAudio, { isCurrent: () => overspeedRevision === state.overspeedRequestId }),
      primeAudioElement(trapAudio, { isCurrent: () => trapRevision === state.trapRequestId }),
    ]).then((results) => {
      if (destroyed) return false;
      state.primed = results.every(Boolean);
      if (state.primed) {
        state.alertSoundBlocked = false;
        state.trapSoundBlocked = false;
      }
      return state.primed;
    }).finally(() => {
      alertsPrimePromise = null;
      state.primePending = false;
      if (!destroyed) emit();
    });
    return alertsPrimePromise;
  }

  function emit() {
    try {
      onStateChange?.(getSnapshot());
    } catch {
      // Audio advisory state should not break driving alerts.
    }
  }

  function stopAudio(audio: AlertAudioElement) {
    try {
      audio.pause();
      audio.currentTime = 0;
      activateAudioElement(audio);
    } catch {
      // Best effort only.
    }
  }

  function stopOverspeed() {
    // Quiet telemetry updates must not cancel a gesture prime that is already silent.
    if (!destroyed && state.primePending && !state.overspeedAudible && !state.alertSoundPending) return;
    state.overspeedRequestId += 1;
    state.alertSoundPending = false;
    state.overspeedAudible = false;
    stopAudio(overspeedAudio);
  }

  function stopTrap({ resetLastTrap = false }: LegacyAudioAlertRecord = {}) {
    if (!destroyed && state.primePending && !state.trapAudible && !state.trapSoundPending) return;
    state.trapRequestId += 1;
    state.trapSoundPending = false;
    state.trapAudible = false;
    if (resetLastTrap) state.lastTrapSoundedId = null;
    stopAudio(trapAudio);
  }

  async function armBackgroundAudio() {
    backgroundIntended = true;
    if (isBackgroundAudioLeaseActive(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE)) {
      state.backgroundAudioArmed = true;
      return true;
    }
    if (state.backgroundAudioArmPending) return state.backgroundAudioArmed;
    const revision = backgroundRevision;
    state.backgroundAudioArmPending = true;
    emit();
    try {
      const armed = Boolean(await acquireBackgroundAudioLease(
        DRIVING_ALERT_BACKGROUND_AUDIO_LEASE,
        { shouldContinue: () => backgroundIntended },
      ));
      if (revision === backgroundRevision) {
        state.backgroundAudioArmed = backgroundIntended && isBackgroundAudioLeaseActive(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE);
      }
      return armed || state.backgroundAudioArmed;
    } catch {
      state.backgroundAudioArmed = false;
      return false;
    } finally {
      if (revision === backgroundRevision) state.backgroundAudioArmPending = false;
      emit();
    }
  }

  function disarmBackgroundAudio() {
    backgroundIntended = false;
    backgroundRevision += 1;
    state.backgroundAudioArmed = false;
    state.backgroundAudioArmPending = false;
    releaseBackgroundAudioLease(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE);
    emit();
  }

  function playLoopingOverspeed({ fromUserGesture = false }: LegacyAudioAlertRecord = {}) {
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

  function playTrapOnce({ trapId, fromUserGesture = false }: LegacyAudioAlertRecord = {}) {
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
  }: LegacyAudioAlertRecord = {}) {
    state.muted = Boolean(muted);
    if (audioIntended) {
      void armBackgroundAudio();
      if (fromUserGesture) void activateBackgroundAudioFromGesture();
    } else if (backgroundIntended) {
      disarmBackgroundAudio();
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

  function primeAudioFromUserGesture({ keepAlive = true }: LegacyAudioAlertRecord = {}) {
    if (state.primed && (!keepAlive || isBackgroundAudioLeaseActive(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE))) {
      return Promise.resolve(true);
    }
    if (primePromise) return primePromise;

    state.primePending = true;
    emit();
    primePromise = (async () => {
      try {
        const retention = keepAlive ? armBackgroundAudio() : Promise.resolve(false);
        const alerts = primeAlerts();
        const activation = activateBackgroundAudioFromGesture();
        const [alertsPrimed] = await Promise.all([alerts, retention, activation]);
        state.primed = alertsPrimed;
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

  function setMuted(muted: unknown) {
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
        backgroundIntended && isBackgroundAudioLeaseActive(DRIVING_ALERT_BACKGROUND_AUDIO_LEASE),
      backgroundAudioArmPending: state.backgroundAudioArmPending,
    };
  }

  function destroy() {
    destroyed = true;
    unregisterGesture();
    unsubscribeBackground();
    stopOverspeed();
    stopTrap({ resetLastTrap: true });
    disarmBackgroundAudio();
  }

  const unsubscribeBackground = subscribeBackgroundAudioState(() => {
    if (backgroundIntended && !destroyed) emit();
  });

  return {
    destroy,
    disarmBackgroundAudio,
    getSnapshot,
    primeAudioFromUserGesture,
    setMuted,
    sync,
  };
}
