import {
  OVERSPEED_SOUND_URL,
  SPEED_APP_NAME,
  START_RECORDING_SOUND_URL,
  TRAP_SOUND_URL,
  UNIT_CONFIG,
} from "./constants.js";
import {
  activateAudioElement,
  primeAudioElement,
  silenceAudioElement,
} from "../shared/audio-channel-retainer.js";
import { createDrivingAudioCueController } from "../shared/driving-audio-cues.js";
import {
  acquireBackgroundAudioLease,
  activateBackgroundAudioFromGesture,
  registerBackgroundAudioGestureHandler,
  getBackgroundKeepAliveAudio,
  isBackgroundAudioLeaseActive,
  releaseBackgroundAudioLease,
} from "../shared/audio-system.js";
import { shouldPlayOverspeedSound } from "./alerts.js";

export const SPEED_BACKGROUND_AUDIO_LEASE = "speed-alerts";
// Compatibility export: recording keep-alive is now owned by DriveRecordingService.
export const SPEED_RECORDING_BACKGROUND_AUDIO_LEASE = "drive-recording";

export function createSpeedAudioController({
  state,
  t,
  getAlertUiState,
  convertSpeed,
  getCriticalAlertText,
  onStateChange,
}) {
  const overspeedAudio = new Audio(OVERSPEED_SOUND_URL);
  overspeedAudio.loop = true;
  overspeedAudio.preload = "auto";
  overspeedAudio.playsInline = true;

  const trapAlertAudio = new Audio(TRAP_SOUND_URL);
  trapAlertAudio.loop = false;
  trapAlertAudio.preload = "auto";
  trapAlertAudio.playsInline = true;

  const cueController = createDrivingAudioCueController({
    alertsArmedUrl: TRAP_SOUND_URL,
    recordingStartedUrl: START_RECORDING_SOUND_URL,
  });

  const backgroundKeepAliveAudio = getBackgroundKeepAliveAudio();

  const unregisterGesture = registerBackgroundAudioGestureHandler(() => {
    if (!wantsBackgroundAudio()) return false;
    return startBackgroundAlertLoops(state.backgroundAudioRevision).then((results) => results.every(Boolean));
  });
  let audioPrimePromise = null;
  let recordingKeepAliveArmPromise = null;

  function notifyStateChange() {
    if (typeof onStateChange !== "function") return;
    try {
      onStateChange();
    } catch {
      // Audio state changes should not be blocked by advisory UI.
    }
  }

  trapAlertAudio.addEventListener("ended", () => {
    state.trapSoundPending = false;
    state.trapAudible = false;
    state.trapSoundDeadlineAt = 0;
  });

  function getRuntimeSpeedLabel() {
    return `${Math.round(convertSpeed(state.currentSpeedMs, state.unit))} ${UNIT_CONFIG[state.unit].label}`;
  }

  function getRuntimeTitle(alertState = getAlertUiState()) {
    if (state.lastFixAt <= 0) {
      return state.statusText;
    }

    const speedLabel = getRuntimeSpeedLabel();
    const criticalAlertText = getCriticalAlertText(alertState);
    return criticalAlertText ? `${speedLabel} · ${criticalAlertText}` : speedLabel;
  }

  function getRuntimePageTitle(alertState = getAlertUiState()) {
    const title = getRuntimeTitle(alertState);
    return title ? `${title} | ${SPEED_APP_NAME}` : t("speedPageTitle");
  }

  function syncRuntimePagePresentation() {
    const nextPageTitle = getRuntimePageTitle();
    if (state.runtimePageTitle !== nextPageTitle) {
      document.title = nextPageTitle;
      state.runtimePageTitle = nextPageTitle;
    }
  }

  function wantsBackgroundAudio() {
    return (
      state.backgroundMode || state.alertAudioControlActive
    );
  }

  function wantsRecordingKeepAliveAudio() {
    return state.recordingKeepAliveIntended && !state.recordingKeepAliveSuppressed;
  }

  function isStaleRecordingKeepAliveArm(revision) {
    return revision !== state.recordingKeepAliveRevision || !wantsRecordingKeepAliveAudio();
  }

  function isRecordingKeepAliveArmed() {
    return (
      state.recordingKeepAliveArmed
      && !state.recordingKeepAlivePending
      && isBackgroundAudioLeaseActive(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE)
    );
  }

  function isBackgroundAlertAudioArmed() {
    return (
      state.backgroundAudioArmed
      && !state.backgroundAudioArmPending
      && isBackgroundAudioLeaseActive(SPEED_BACKGROUND_AUDIO_LEASE)
    );
  }

  async function armRecordingKeepAliveAudio({ fromUserGesture = false } = {}) {
    if (!state.recordingKeepAliveIntended) {
      state.recordingKeepAliveIntended = true;
      state.recordingKeepAliveRevision = (state.recordingKeepAliveRevision || 0) + 1;
    }

    if (fromUserGesture) {
      state.recordingKeepAliveSuppressed = false;
      state.recordingKeepAliveBlocked = false;
    }

    if (isRecordingKeepAliveArmed()) {
      state.recordingKeepAliveSuppressed = false;
      state.recordingKeepAliveBlocked = false;
      notifyStateChange();
      return true;
    }

    if (state.recordingKeepAlivePending) {
      return recordingKeepAliveArmPromise ?? false;
    }

    const recordingKeepAliveRevision = state.recordingKeepAliveRevision;
    state.recordingKeepAlivePending = true;
    notifyStateChange();

    recordingKeepAliveArmPromise = acquireBackgroundAudioLease(
      SPEED_RECORDING_BACKGROUND_AUDIO_LEASE,
      {
        shouldContinue: () => !isStaleRecordingKeepAliveArm(recordingKeepAliveRevision),
      },
    ).then(Boolean, () => false);

    try {
      const armed = await recordingKeepAliveArmPromise;
      if (isStaleRecordingKeepAliveArm(recordingKeepAliveRevision)) {
        releaseBackgroundAudioLease(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
        return false;
      }

      state.recordingKeepAliveArmed =
        armed && isBackgroundAudioLeaseActive(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
      state.recordingKeepAliveSuppressed = !state.recordingKeepAliveArmed;
      state.recordingKeepAliveBlocked = !state.recordingKeepAliveArmed;
      if (!state.recordingKeepAliveArmed) {
        releaseBackgroundAudioLease(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
      }
      return state.recordingKeepAliveArmed;
    } finally {
      state.recordingKeepAlivePending = false;
      recordingKeepAliveArmPromise = null;
      notifyStateChange();
    }
  }

  function disarmRecordingKeepAliveAudio({
    retainIntent = false,
    suppressed = false,
    blocked = false,
    source: _source = "",
    reason: _reason = "",
  } = {}) {

    state.recordingKeepAliveRevision = (state.recordingKeepAliveRevision || 0) + 1;
    state.recordingKeepAliveIntended = retainIntent;
    state.recordingKeepAliveArmed = false;
    state.recordingKeepAlivePending = false;
    state.recordingKeepAliveSuppressed = Boolean(retainIntent && suppressed);
    state.recordingKeepAliveBlocked = Boolean(retainIntent && blocked);
    releaseBackgroundAudioLease(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
    notifyStateChange();
    return true;
  }

  function suppressRecordingKeepAliveAudio({ blocked = false, source = "", reason = "" } = {}) {

    return disarmRecordingKeepAliveAudio({
      retainIntent: state.recordingKeepAliveIntended,
      suppressed: state.recordingKeepAliveIntended,
      blocked,
      source,
      reason,
    });
  }

  function maybeRecoverRecordingKeepAliveAudio({ fromUserGesture = false } = {}) {
    if (!state.recordingKeepAliveIntended) {
      return false;
    }

    if (isRecordingKeepAliveArmed()) {
      state.recordingKeepAliveSuppressed = false;
      state.recordingKeepAliveBlocked = false;
      notifyStateChange();
      return true;
    }

    if (!fromUserGesture) {
      return false;
    }

    state.recordingKeepAliveSuppressed = false;
    state.recordingKeepAliveBlocked = false;
    void armRecordingKeepAliveAudio({ fromUserGesture });
    return true;
  }

  function canRecoverSuppressedBackgroundAudio() {
    return state.backgroundAudioSuppressed
      && (state.backgroundMode || state.alertAudioControlActive)
      && state.lastFixAt > 0;
  }

  function queueSuppressedBackgroundAudioRecoveryAfterPrime() {
    if (!audioPrimePromise) {
      return false;
    }

    audioPrimePromise
      .then((audioPrimed) => {
        if (!audioPrimed || !canRecoverSuppressedBackgroundAudio()) {
          return;
        }
        state.backgroundAudioSuppressed = false;
        notifyStateChange();
        void armBackgroundAlertAudio();
      })
      .catch(() => {});

    return true;
  }

  function maybeRecoverSuppressedBackgroundAudio({ fromUserGesture = false } = {}) {
    if (!canRecoverSuppressedBackgroundAudio()) {
      return false;
    }

    if (!fromUserGesture && !state.audioPrimed) {
      queueSuppressedBackgroundAudioRecoveryAfterPrime();
      return false;
    }

    state.backgroundAudioSuppressed = false;
    notifyStateChange();
    void armBackgroundAlertAudio({ fromUserGesture });
    return true;
  }

  function handleUserGestureAudioActivation() {
    void maybeRecoverRecordingKeepAliveAudio({ fromUserGesture: true });

    if (maybeRecoverSuppressedBackgroundAudio({ fromUserGesture: true })) {
      return;
    }

    if (wantsBackgroundAudio()) {
      void armBackgroundAlertAudio({ fromUserGesture: true });
    } else if (!state.audioMuted) {
      void primeAlertAudio();
    }
  }

  function suppressBackgroundAudioRuntime({ source: _source = "", reason: _reason = "" } = {}) {

    state.backgroundAudioRevision += 1;
    state.backgroundAudioSuppressed = true;
    state.backgroundAudioArmed = false;
    state.backgroundAudioArmPending = false;
    clearTrapMuteTimeout();
    // Suspension does not disable an enabled feature or release its retention intent.
    if (!wantsBackgroundAudio()) releaseBackgroundAudioLease(SPEED_BACKGROUND_AUDIO_LEASE);
    notifyStateChange();
    return true;
  }

  function playAlertAudioEnabledSound() {
    return cueController.playAlertsArmedCue();
  }

  function playStartRecordingSound() {
    return cueController.playRecordingStartedCue();
  }

  function stopAudioElementPlayback(audio) {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  async function ensureAudioElementLooping(audio, { shouldContinue = null } = {}) {
    if (!audio) return false;

    audio.loop = true;

    if (!audio.paused) {
      return typeof shouldContinue === "function" ? shouldContinue() : true;
    }

    silenceAudioElement(audio);
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }

    if (typeof shouldContinue === "function" && !shouldContinue()) {
      stopAudioElementPlayback(audio);
      return false;
    }

    return true;
  }

  function ensureBackgroundAlertLooping(audio, backgroundAudioRevision) {
    if (!audio || !audio.paused) {
      return Promise.resolve(
        !audio || !isStaleBackgroundAudioArm(backgroundAudioRevision)
      );
    }

    return ensureAudioElementLooping(audio, {
      shouldContinue: () => wantsBackgroundAudio(),
    }).then(Boolean, () => false);
  }

  function startBackgroundAlertLoops(backgroundAudioRevision) {
    return Promise.all([
      ensureBackgroundAlertLooping(overspeedAudio, backgroundAudioRevision),
      ensureBackgroundAlertLooping(trapAlertAudio, backgroundAudioRevision),
    ]);
  }

  function isStaleBackgroundAudioArm(revision) {
    return revision !== state.backgroundAudioRevision || !wantsBackgroundAudio();
  }

  function invalidateOverspeedSoundRequest() {
    state.overspeedSoundRequestId += 1;
    return state.overspeedSoundRequestId;
  }

  function invalidateTrapSoundRequest() {
    state.trapSoundRequestId += 1;
    return state.trapSoundRequestId;
  }

  function stopOverspeedSound() {
    invalidateOverspeedSoundRequest();
    state.alertSoundPending = false;
    state.overspeedAudible = false;
    overspeedAudio.pause();
    overspeedAudio.currentTime = 0;
  }

  function keepOverspeedAudioAlive() {
    invalidateOverspeedSoundRequest();
    state.alertSoundPending = false;
    state.overspeedAudible = false;
    overspeedAudio.loop = true;
    silenceAudioElement(overspeedAudio);
    if (!overspeedAudio.paused) {
      overspeedAudio.currentTime = 0;
      return;
    }

    if (state.backgroundAudioArmed) {
      void ensureAudioElementLooping(overspeedAudio, {
        shouldContinue: () => !isStaleBackgroundAudioArm(state.backgroundAudioRevision),
      }).catch(() => {});
    }
  }

  function syncOverspeedSound({ fromUserGesture = false } = {}) {
    const alertUiState = getAlertUiState();
    if (!shouldPlayOverspeedSound(alertUiState, state.alertSoundEnabled, state.audioMuted)) {
      state.alertSoundBlocked = false;
      if (state.backgroundAudioArmed) {
        keepOverspeedAudioAlive();
        return;
      }
      stopOverspeedSound();
      return;
    }

    if (state.overspeedAudible && !overspeedAudio.paused) {
      return;
    }

    if (state.alertSoundPending) {
      return;
    }

    if (state.alertSoundBlocked && !fromUserGesture) {
      return;
    }

    overspeedAudio.loop = true;
    overspeedAudio.currentTime = 0;
    activateAudioElement(overspeedAudio);
    const overspeedSoundRequestId = invalidateOverspeedSoundRequest();
    const playPromise = overspeedAudio.play();
    if (!playPromise || typeof playPromise.then !== "function") {
      state.alertSoundBlocked = false;
      state.overspeedAudible = true;
      notifyStateChange();
      return;
    }

    state.alertSoundPending = true;
    notifyStateChange();
    playPromise
      .then(() => {
        if (overspeedSoundRequestId !== state.overspeedSoundRequestId) return;
        state.alertSoundPending = false;
        state.alertSoundBlocked = false;
        state.overspeedAudible = true;
        notifyStateChange();
      })
      .catch(() => {
        if (overspeedSoundRequestId !== state.overspeedSoundRequestId) return;
        state.alertSoundPending = false;
        state.alertSoundBlocked = true;
        notifyStateChange();
        stopOverspeedSound();
      });
  }

  function clearTrapMuteTimeout() {
    if (state.trapMuteTimeoutId !== null) {
      window.clearTimeout(state.trapMuteTimeoutId);
      state.trapMuteTimeoutId = null;
    }
  }

  function getTrapSoundDurationMs() {
    return Number.isFinite(trapAlertAudio.duration) && trapAlertAudio.duration > 0
      ? Math.round(trapAlertAudio.duration * 1000)
      : 1800;
  }

  function stopTrapSound() {
    invalidateTrapSoundRequest();
    state.trapSoundPending = false;
    state.trapAudible = false;
    state.trapSoundDeadlineAt = 0;
    clearTrapMuteTimeout();
    trapAlertAudio.pause();
    trapAlertAudio.currentTime = 0;
  }

  function keepTrapAudioAlive() {
    invalidateTrapSoundRequest();
    clearTrapMuteTimeout();
    state.trapSoundPending = false;
    state.trapAudible = false;
    state.trapSoundDeadlineAt = 0;
    trapAlertAudio.loop = true;
    silenceAudioElement(trapAlertAudio);
    if (!trapAlertAudio.paused) {
      trapAlertAudio.currentTime = 0;
      return;
    }

    if (state.backgroundAudioArmed) {
      void ensureAudioElementLooping(trapAlertAudio, {
        shouldContinue: () => !isStaleBackgroundAudioArm(state.backgroundAudioRevision),
      }).catch(() => {});
    }
  }

  function getRemainingTrapSoundDurationMs() {
    if (Number.isFinite(trapAlertAudio.duration) && trapAlertAudio.duration > 0) {
      return Math.max(0, Math.round((trapAlertAudio.duration - trapAlertAudio.currentTime) * 1000));
    }

    return getTrapSoundDurationMs();
  }

  function shouldRecoverInterruptedTrapSound() {
    return state.trapSoundDeadlineAt > Date.now();
  }

  function scheduleTrapAudioMute(delayMs = getTrapSoundDurationMs()) {
    clearTrapMuteTimeout();
    state.trapMuteTimeoutId = window.setTimeout(() => {
      keepTrapAudioAlive();
    }, Math.max(0, delayMs));
  }

  function primeAlertAudio() {
    if (state.audioPrimed) {
      return Promise.resolve(true);
    }

    if (audioPrimePromise) {
      return audioPrimePromise;
    }

    state.audioPrimePending = true;
    audioPrimePromise = (async () => {
      try {
        const [overspeedPrimed, trapPrimed] = await Promise.all([
          primeAudioElement(overspeedAudio),
          primeAudioElement(trapAlertAudio),
        ]);

        state.audioPrimed = overspeedPrimed && trapPrimed;
        if (state.audioPrimed) {
          state.alertSoundBlocked = false;
          state.trapSoundBlocked = false;
        }
        notifyStateChange();

        return state.audioPrimed;
      } finally {
        state.audioPrimePending = false;
        audioPrimePromise = null;
        notifyStateChange();
      }
    })();

    return audioPrimePromise;
  }

  async function armBackgroundAlertAudio({ fromUserGesture = false } = {}) {
    if (!wantsBackgroundAudio()) return;
    if (fromUserGesture) void activateBackgroundAudioFromGesture();
    if (
      state.backgroundAudioArmed
      && !state.backgroundAudioArmPending
      && isBackgroundAudioLeaseActive(SPEED_BACKGROUND_AUDIO_LEASE)
      && !overspeedAudio.paused
      && !trapAlertAudio.paused
    ) {
      return;
    }
    if (state.backgroundAudioArmPending) return;

    const backgroundAudioRevision = state.backgroundAudioRevision;
    let shouldRetry = false;
    state.backgroundAudioArmPending = true;
    notifyStateChange();
    const keepAlivePromise = acquireBackgroundAudioLease(SPEED_BACKGROUND_AUDIO_LEASE, {
      shouldContinue: () => wantsBackgroundAudio(),
    }).then(Boolean, () => false);

    try {
      // Touch browsers can drop transient activation before a later replay, so
      // the gesture path starts the durable muted alert loops immediately.
      const alertLoopPromise = fromUserGesture
        ? startBackgroundAlertLoops(backgroundAudioRevision)
        : null;
      if (!fromUserGesture) {
        await primeAlertAudio();
      }
      if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
        shouldRetry = wantsBackgroundAudio();
        return;
      }

      const keepAliveStarted = await keepAlivePromise;
      if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
        shouldRetry = wantsBackgroundAudio();
        return;
      }
      if (!keepAliveStarted) return;

      state.backgroundAudioArmed = true;
      state.backgroundAudioSuppressed = false;
      notifyStateChange();

      const alertLoopsStarted = alertLoopPromise
        ? await alertLoopPromise
        : await startBackgroundAlertLoops(backgroundAudioRevision);
      if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
        shouldRetry = wantsBackgroundAudio();
        return;
      }

      state.audioPrimed = alertLoopsStarted.every(Boolean);
      state.alertSoundBlocked = !alertLoopsStarted[0];
      state.trapSoundBlocked = !alertLoopsStarted[1];
      notifyStateChange();
      if (trapAlertAudio.paused) {
        keepTrapAudioAlive();
      } else if (state.trapAudible || state.trapSoundPending) {
        scheduleTrapAudioMute(getRemainingTrapSoundDurationMs());
      }
    } catch {
      if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
        shouldRetry = wantsBackgroundAudio();
      } else {
        state.backgroundAudioArmed = false;
        state.backgroundAudioSuppressed = true;
        notifyStateChange();
      }
    } finally {
      state.backgroundAudioArmPending = false;
      notifyStateChange();
      if (shouldRetry && !state.backgroundAudioArmed && !state.backgroundAudioArmPending) {
        void armBackgroundAlertAudio();
      }
    }
  }

  function disarmBackgroundAlertAudio({
    fromUserGesture = false,
    source: _source = "",
    reason: _reason = "",
  } = {}) {

    state.backgroundAudioArmed = false;
    state.backgroundAudioArmPending = false;
    clearTrapMuteTimeout();
    releaseBackgroundAudioLease(SPEED_BACKGROUND_AUDIO_LEASE);
    notifyStateChange();

    if (shouldPlayOverspeedSound(getAlertUiState(), state.alertSoundEnabled, state.audioMuted)) {
      overspeedAudio.loop = true;
      activateAudioElement(overspeedAudio);
      if (overspeedAudio.paused) {
        invalidateOverspeedSoundRequest();
        state.alertSoundPending = false;
        state.overspeedAudible = false;
        syncOverspeedSound({ fromUserGesture });
      } else if (!state.alertSoundPending) {
        state.overspeedAudible = true;
      }
    } else {
      stopOverspeedSound();
    }

    const activeTrap = getAlertUiState().trapActive;
    if (activeTrap && state.trapSoundEnabled && (state.trapAudible || state.trapSoundPending || shouldRecoverInterruptedTrapSound())) {
      trapAlertAudio.loop = false;
      activateAudioElement(trapAlertAudio);
      if (trapAlertAudio.paused && shouldRecoverInterruptedTrapSound()) {
        invalidateTrapSoundRequest();
        state.trapSoundPending = false;
        state.trapAudible = false;
        state.lastTrapSoundedId = null;
        syncTrapSound({ fromUserGesture });
        return true;
      }
    } else {
      stopTrapSound();
    }

    return true;
  }

  function syncTrapSound({ fromUserGesture = false } = {}) {
    const alertUiState = getAlertUiState();
    const activeTrap = alertUiState.trapActive
      ? { id: state.nearestTrapId }
      : null;

    if (!activeTrap) {
      state.lastTrapSoundedId = null;
      state.trapSoundBlocked = false;
      if (state.backgroundAudioArmed) {
        keepTrapAudioAlive();
        return;
      }
      stopTrapSound();
      return;
    }

    if (!state.trapSoundEnabled || state.audioMuted) {
      state.trapSoundBlocked = false;
      if (state.backgroundAudioArmed) {
        keepTrapAudioAlive();
        return;
      }
      stopTrapSound();
      return;
    }

    if (activeTrap.id === state.lastTrapSoundedId) {
      if (state.trapSoundPending || !trapAlertAudio.paused) {
        return;
      }
      if (!shouldRecoverInterruptedTrapSound()) {
        return;
      }
      state.lastTrapSoundedId = null;
    }

    if (state.trapSoundPending) {
      return;
    }

    if (state.trapSoundBlocked && !fromUserGesture) {
      return;
    }

    clearTrapMuteTimeout();
    trapAlertAudio.loop = state.backgroundAudioArmed;
    trapAlertAudio.currentTime = 0;
    activateAudioElement(trapAlertAudio);
    state.trapSoundDeadlineAt = Date.now() + getTrapSoundDurationMs();
    const trapSoundRequestId = invalidateTrapSoundRequest();
    const playPromise = trapAlertAudio.play();
    if (!playPromise || typeof playPromise.then !== "function") {
      state.trapSoundBlocked = false;
      state.trapAudible = true;
      state.lastTrapSoundedId = activeTrap.id;
      notifyStateChange();
      if (state.backgroundAudioArmed) {
        scheduleTrapAudioMute();
      }
      return;
    }

    state.trapSoundPending = true;
    notifyStateChange();
    playPromise
      .then(() => {
        if (trapSoundRequestId !== state.trapSoundRequestId) return;
        state.trapSoundPending = false;
        state.trapSoundBlocked = false;
        state.trapAudible = true;
        state.lastTrapSoundedId = activeTrap.id;
        notifyStateChange();
        if (state.backgroundAudioArmed) {
          scheduleTrapAudioMute();
        }
      })
      .catch(() => {
        if (trapSoundRequestId !== state.trapSoundRequestId) return;
        state.trapSoundPending = false;
        state.trapSoundBlocked = true;
        notifyStateChange();
        stopTrapSound();
      });
  }

  let runtimeListenersAttached = false;
  function attachRuntimeAudioEventListeners() {
    if (runtimeListenersAttached) return;
    runtimeListenersAttached = true;
    for (const audio of [
      overspeedAudio,
      trapAlertAudio,
      backgroundKeepAliveAudio,
    ]) {
      audio.addEventListener("play", syncRuntimePagePresentation);
      audio.addEventListener("pause", syncRuntimePagePresentation);
      audio.addEventListener("ended", syncRuntimePagePresentation);
    }
  }

  function dispose() {
    unregisterGesture();
    if (runtimeListenersAttached) {
      for (const audio of [overspeedAudio, trapAlertAudio, backgroundKeepAliveAudio]) {
        for (const event of ["play", "pause", "ended"]) audio.removeEventListener(event, syncRuntimePagePresentation);
      }
      runtimeListenersAttached = false;
    }
    cueController.destroy();
    releaseBackgroundAudioLease(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
    releaseBackgroundAudioLease(SPEED_BACKGROUND_AUDIO_LEASE);
  }

  return {
    armBackgroundAlertAudio,
    armRecordingKeepAliveAudio,
    attachRuntimeAudioEventListeners,
    disarmBackgroundAlertAudio,
    disarmRecordingKeepAliveAudio,
    dispose,
    handleUserGestureAudioActivation,
    isBackgroundAlertAudioArmed,
    isRecordingKeepAliveArmed,
    maybeRecoverRecordingKeepAliveAudio,
    maybeRecoverSuppressedBackgroundAudio,
    playAlertAudioEnabledSound,
    playStartRecordingSound,
    primeAlertAudio,
    stopOverspeedSound,
    stopTrapSound,
    suppressBackgroundAudioRuntime,
    suppressRecordingKeepAliveAudio,
    syncOverspeedSound,
    syncRuntimePagePresentation,
    syncTrapSound,
    wantsBackgroundAudio,
  };
}
