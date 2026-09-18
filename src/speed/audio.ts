import {
  MEDIA_METADATA_MIN_UPDATE_INTERVAL_MS,
  MEDIA_SESSION_FALLBACK_ARTWORK,
  OVERSPEED_SOUND_URL,
  RUNTIME_ARTWORK_SIZE,
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
  getBackgroundKeepAliveAudio,
  isBackgroundAudioLeaseActive,
  releaseBackgroundAudioLease,
} from "../shared/audio-system.js";
import {
  clearMediaSessionClient,
  updateMediaSessionClient,
} from "../shared/media-session-adapter.js";
import { shouldPlayOverspeedSound } from "./alerts.js";
import { capitalizeText, escapeSvgText, getDistanceDisplay, truncateText } from "./render.js";

export const SPEED_BACKGROUND_AUDIO_LEASE = "speed-alerts";
// Compatibility export: recording keep-alive is now owned by DriveRecordingService.
export const SPEED_RECORDING_BACKGROUND_AUDIO_LEASE = "drive-recording";
const SPEED_MEDIA_SESSION_OWNER = "speed";
// Keep Speed below the audible player runtime so transport controls remain player-owned.
const SPEED_MEDIA_SESSION_PRIORITY = 5;

export function createSpeedAudioController({
  state,
  t,
  getAlertUiState,
  convertSpeed,
  getConfiguredTrapAlertDistanceLabel,
  getAlertLimitDisplayValue,
  getSubStatusText,
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

  function getRuntimeTripLabel() {
    const distance = getDistanceDisplay(state.totalDistanceM, state.distanceUnit);
    return `${capitalizeText(t("trip"))} ${distance.value} ${distance.unit}`;
  }

  function getRuntimeBackgroundAudioLabel() {
    return `${t("backgroundAudio")}: ${state.backgroundMode ? t("on") : t("off")}`;
  }

  function getRuntimeArtworkStatusBadgeText() {
    return state.statusKind === "accuracy" && state.lastFixAt > 0
      ? t("gpsLive")
      : state.statusText;
  }

  function getRuntimeArtworkAlertValue(alertState = getAlertUiState()) {
    if (alertState.trapActive) {
      return alertState.trapSpeedLabel
        ? `${alertState.trapDistanceLabel} / ${alertState.trapSpeedLabel}`
        : alertState.trapDistanceLabel;
    }

    if (alertState.manualEnabled) {
      return `${getAlertLimitDisplayValue()} ${UNIT_CONFIG[state.unit].label}`;
    }

    if (state.trapAlertEnabled && state.trapLoadPending) {
      return t("loadingTraps");
    }

    if (state.trapAlertEnabled && state.trapLoadError) {
      return t("trapUnavailable");
    }

    if (state.trapAlertEnabled) {
      return getConfiguredTrapAlertDistanceLabel();
    }

    return t("off");
  }

  function getRuntimeMediaTitle(alertState = getAlertUiState()) {
    if (state.lastFixAt <= 0) {
      return state.statusText;
    }

    const speedLabel = getRuntimeSpeedLabel();
    const criticalAlertText = getCriticalAlertText(alertState);
    return criticalAlertText ? `${speedLabel} · ${criticalAlertText}` : speedLabel;
  }

  function getRuntimeMediaArtist(alertState = getAlertUiState()) {
    if (state.lastFixAt <= 0) {
      return getRuntimeBackgroundAudioLabel();
    }

    if (alertState.over || alertState.trapActive) {
      return state.statusText;
    }

    return getSubStatusText(alertState);
  }

  function getRuntimeMediaAlbum() {
    if (state.lastFixAt <= 0) {
      return SPEED_APP_NAME;
    }

    return `${SPEED_APP_NAME} · ${getRuntimeTripLabel()}`;
  }

  function getRuntimePageTitle(alertState = getAlertUiState()) {
    const title = getRuntimeMediaTitle(alertState);
    return title ? `${title} | ${SPEED_APP_NAME}` : t("speedPageTitle");
  }

  function getRuntimeMediaPlaybackState() {
    if (
      isBackgroundAudioLeaseActive(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE)
      || isBackgroundAudioLeaseActive(SPEED_BACKGROUND_AUDIO_LEASE)
      || !overspeedAudio.paused
      || !trapAlertAudio.paused
    ) {
      return "playing";
    }

    if (
      state.backgroundMode
      || state.alertAudioControlActive
      || state.backgroundAudioArmPending
      || state.alertSoundPending
      || state.trapSoundPending
    ) {
      return "paused";
    }

    return "none";
  }

  function getRuntimeArtworkPalette(alertState = getAlertUiState()) {
    if (alertState.over) {
      return {
        bgStart: "#21080d",
        bgEnd: "#4a1017",
        accent: "#ff7b63",
        accentSoft: "#ffb39f",
        panel: "rgba(26, 10, 13, 0.78)",
        panelBorder: "rgba(255, 176, 158, 0.22)",
        text: "#fff4f1",
        muted: "#f8c8be",
        chip: "rgba(255, 123, 99, 0.16)",
        chipBorder: "rgba(255, 123, 99, 0.34)",
      };
    }

    if (alertState.trapActive) {
      return {
        bgStart: "#1c1406",
        bgEnd: "#4f3108",
        accent: "#f6c453",
        accentSoft: "#ffe29e",
        panel: "rgba(24, 18, 8, 0.78)",
        panelBorder: "rgba(246, 196, 83, 0.22)",
        text: "#fff9eb",
        muted: "#f5dfad",
        chip: "rgba(246, 196, 83, 0.14)",
        chipBorder: "rgba(246, 196, 83, 0.28)",
      };
    }

    return {
      bgStart: "#081421",
      bgEnd: "#163854",
      accent: "#63e6be",
      accentSoft: "#93c5fd",
      panel: "rgba(8, 19, 33, 0.72)",
      panelBorder: "rgba(147, 197, 253, 0.16)",
      text: "#f8fbff",
      muted: "#bfd5ea",
      chip: "rgba(99, 230, 190, 0.12)",
      chipBorder: "rgba(147, 197, 253, 0.24)",
    };
  }

  function buildRuntimeArtworkModel(alertState = getAlertUiState()) {
    const speedValue = String(Math.round(convertSpeed(state.currentSpeedMs, state.unit)));
    const criticalAlertText = getCriticalAlertText(alertState);
    const sectionLabel = criticalAlertText ? t("alerts") : getRuntimeArtworkStatusBadgeText();
    const primaryLine = criticalAlertText || getSubStatusText(alertState);
    const tripDistance = getDistanceDisplay(state.totalDistanceM, state.distanceUnit);

    return {
      speedValue,
      unitLabel: UNIT_CONFIG[state.unit].label,
      statusBadge: truncateText(getRuntimeArtworkStatusBadgeText(), 24),
      sectionLabel: truncateText(sectionLabel, 24),
      primaryLine: truncateText(primaryLine || state.statusText, 42),
      tripLabel: capitalizeText(t("trip")),
      tripValue: truncateText(`${tripDistance.value} ${tripDistance.unit}`, 16),
      alertLabel: t("alerts"),
      alertValue: truncateText(getRuntimeArtworkAlertValue(alertState), 22),
      backgroundLabel: t("backgroundCompact"),
      backgroundValue: truncateText(state.backgroundMode ? t("on") : t("off"), 12),
      palette: getRuntimeArtworkPalette(alertState),
    };
  }

  function createRuntimeArtworkDataUrl(alertState = getAlertUiState()) {
    const model = buildRuntimeArtworkModel(alertState);
    const {
      speedValue,
      unitLabel,
      statusBadge,
      sectionLabel,
      primaryLine,
      tripLabel,
      tripValue,
      alertLabel,
      alertValue,
      backgroundLabel,
      backgroundValue,
      palette,
    } = model;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${RUNTIME_ARTWORK_SIZE}" height="${RUNTIME_ARTWORK_SIZE}" viewBox="0 0 512 512" role="img" aria-label="${escapeSvgText(SPEED_APP_NAME)}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bgStart}" />
      <stop offset="100%" stop-color="${palette.bgEnd}" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.accent}" />
      <stop offset="100%" stop-color="${palette.accentSoft}" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="rgba(0,0,0,0.22)" />
    </filter>
  </defs>
  <rect width="512" height="512" rx="44" fill="url(#bg)" />
  <circle cx="420" cy="96" r="94" fill="${palette.accent}" opacity="0.12" />
  <circle cx="458" cy="66" r="54" fill="${palette.accentSoft}" opacity="0.12" />
  <rect x="28" y="28" width="456" height="456" rx="34" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />

  <text x="48" y="62" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" letter-spacing="2">VATIO SPEED</text>
  <g filter="url(#shadow)">
    <rect x="356" y="38" width="108" height="34" rx="17" fill="${palette.chip}" stroke="${palette.chipBorder}" />
  </g>
  <text x="410" y="60" text-anchor="middle" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700">${escapeSvgText(statusBadge)}</text>

  <text x="48" y="116" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" letter-spacing="2">${escapeSvgText(t("speed"))}</text>
  <text x="48" y="248" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="170" font-weight="700">${escapeSvgText(speedValue)}</text>
  <text x="344" y="248" fill="${palette.accentSoft}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700">${escapeSvgText(unitLabel)}</text>

  <g filter="url(#shadow)">
    <rect x="40" y="284" width="432" height="100" rx="28" fill="${palette.panel}" stroke="${palette.panelBorder}" />
  </g>
  <text x="64" y="318" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" letter-spacing="1.5">${escapeSvgText(sectionLabel)}</text>
  <text x="64" y="356" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700">${escapeSvgText(primaryLine)}</text>

  <g filter="url(#shadow)">
    <rect x="40" y="404" width="132" height="72" rx="22" fill="${palette.chip}" stroke="${palette.chipBorder}" />
    <rect x="190" y="404" width="132" height="72" rx="22" fill="${palette.chip}" stroke="${palette.chipBorder}" />
    <rect x="340" y="404" width="132" height="72" rx="22" fill="${palette.chip}" stroke="${palette.chipBorder}" />
  </g>

  <text x="58" y="430" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">${escapeSvgText(tripLabel)}</text>
  <text x="58" y="460" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeSvgText(tripValue)}</text>

  <text x="208" y="430" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">${escapeSvgText(alertLabel)}</text>
  <text x="208" y="460" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">${escapeSvgText(alertValue)}</text>

  <text x="358" y="430" fill="${palette.muted}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">${escapeSvgText(backgroundLabel)}</text>
  <text x="358" y="460" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeSvgText(backgroundValue)}</text>
</svg>`.trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function getRuntimeArtworkSignature(alertState = getAlertUiState()) {
    const model = buildRuntimeArtworkModel(alertState);
    return JSON.stringify([
      model.speedValue,
      model.unitLabel,
      model.statusBadge,
      model.sectionLabel,
      model.primaryLine,
      model.tripValue,
      model.alertValue,
      model.backgroundValue,
      model.palette.bgStart,
      model.palette.bgEnd,
      model.palette.accent,
    ]);
  }

  function getRuntimeMediaArtwork(alertState = getAlertUiState()) {
    const artworkSignature = getRuntimeArtworkSignature(alertState);

    if (state.runtimeArtworkSignature !== artworkSignature || !state.runtimeArtworkDataUrl) {
      state.runtimeArtworkDataUrl = createRuntimeArtworkDataUrl(alertState);
      state.runtimeArtworkSignature = artworkSignature;
    }

    return [
      {
        src: state.runtimeArtworkDataUrl,
        sizes: `${RUNTIME_ARTWORK_SIZE}x${RUNTIME_ARTWORK_SIZE}`,
        type: "image/svg+xml",
      },
      ...MEDIA_SESSION_FALLBACK_ARTWORK,
    ];
  }

  function syncRuntimePagePresentation() {
    const alertState = getAlertUiState();
    const nextPageTitle = getRuntimePageTitle(alertState);

    if (state.runtimePageTitle !== nextPageTitle) {
      document.title = nextPageTitle;
      state.runtimePageTitle = nextPageTitle;
    }

    const nextPlaybackState = getRuntimeMediaPlaybackState();
    if (state.runtimeMediaPlaybackState !== nextPlaybackState) {
      updateMediaSessionClient(SPEED_MEDIA_SESSION_OWNER, {
        active: true,
        priority: SPEED_MEDIA_SESSION_PRIORITY,
        playbackState: nextPlaybackState,
      });
      state.runtimeMediaPlaybackState = nextPlaybackState;
    }

    const artworkSignature = state.runtimeDynamicArtworkBlocked
      ? "fallback-artwork"
      : getRuntimeArtworkSignature(alertState);
    const metadataTitle = getRuntimeMediaTitle(alertState);
    const metadataArtist = getRuntimeMediaArtist(alertState);
    const metadataAlbum = getRuntimeMediaAlbum();
    const metadataSignature = JSON.stringify([
      metadataTitle,
      metadataArtist,
      metadataAlbum,
      artworkSignature,
    ]);
    const metadataUrgencySignature = JSON.stringify([
      state.statusKind,
      state.audioMuted,
      state.backgroundMode,
      state.lastFixAt > 0,
      alertState.source,
      alertState.over,
      alertState.trapActive,
    ]);
    const now = Date.now();

    if (state.runtimeMediaMetadataSignature === metadataSignature) {
      return;
    }

    if (
      state.runtimeMediaMetadataUpdatedAt > 0
      && (now - state.runtimeMediaMetadataUpdatedAt) < MEDIA_METADATA_MIN_UPDATE_INTERVAL_MS
      && state.runtimeMediaMetadataUrgencySignature === metadataUrgencySignature
    ) {
      return;
    }

    const metadataInit = {
      title: metadataTitle,
      artist: metadataArtist,
      album: metadataAlbum,
      artwork: state.runtimeDynamicArtworkBlocked
        ? MEDIA_SESSION_FALLBACK_ARTWORK
        : getRuntimeMediaArtwork(alertState),
      fallbackArtwork: MEDIA_SESSION_FALLBACK_ARTWORK,
    };

    updateMediaSessionClient(SPEED_MEDIA_SESSION_OWNER, {
      active: true,
      priority: SPEED_MEDIA_SESSION_PRIORITY,
      metadata: metadataInit,
    });
    state.runtimeMediaMetadataSignature = metadataSignature;
    state.runtimeMediaMetadataUrgencySignature = metadataUrgencySignature;
    state.runtimeMediaMetadataUpdatedAt = now;
  }

  function installMediaSessionActionHandlers(handlers) {
    updateMediaSessionClient(SPEED_MEDIA_SESSION_OWNER, {
      active: true,
      priority: SPEED_MEDIA_SESSION_PRIORITY,
      handlers: {
        play: () => {
          handlers.handleRecordingMediaSessionPlay?.({
            source: "media-session-play",
            fromUserGesture: true,
          });
        },
        pause: () => {
          handlers.handleSpeedMediaSessionPause?.({
            source: "media-session-pause",
            reason: "speed-media-session-pause-ignored-for-keep-alive",
          });
        },
        stop: () => {
          handlers.handleSpeedMediaSessionStop?.({
            source: "media-session-stop",
            reason: "speed-media-session-stop-ignored-for-keep-alive",
          });
        },
      },
    });
  }

  function wantsBackgroundAudio() {
    return (
      (state.backgroundMode || state.alertAudioControlActive) &&
      !state.backgroundAudioSuppressed
    );
  }

  function wantsRecordingKeepAliveAudio() {
    return state.recordingKeepAliveIntended && !state.recordingKeepAliveSuppressed;
  }

  function isMediaSessionSource(source = "") {
    return String(source).startsWith("media-session");
  }

  function isMediaSessionReason(reason = "") {
    return String(reason).includes("media-session");
  }

  function shouldIgnoreMediaSessionKeepAliveDisarm({ source = "", reason = "" } = {}) {
    return isMediaSessionSource(source) || isMediaSessionReason(reason);
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
    source = "",
    reason = "",
  } = {}) {
    if (shouldIgnoreMediaSessionKeepAliveDisarm({ source, reason })) {
      return false;
    }

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
    if (shouldIgnoreMediaSessionKeepAliveDisarm({ source, reason })) {
      return false;
    }

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

  function suppressBackgroundAudioRuntime({ source = "", reason = "" } = {}) {
    if (shouldIgnoreMediaSessionKeepAliveDisarm({ source, reason })) {
      return false;
    }

    state.backgroundAudioRevision += 1;
    state.backgroundAudioSuppressed = true;
    state.backgroundAudioArmed = false;
    state.backgroundAudioArmPending = false;
    state.alertAudioControlActive = false;
    clearTrapMuteTimeout();
    releaseBackgroundAudioLease(SPEED_BACKGROUND_AUDIO_LEASE);
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
      shouldContinue: () => !isStaleBackgroundAudioArm(backgroundAudioRevision),
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
      shouldContinue: () => !isStaleBackgroundAudioArm(backgroundAudioRevision),
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
        disarmBackgroundAlertAudio();
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
    source = "",
    reason = "",
  } = {}) {
    if (shouldIgnoreMediaSessionKeepAliveDisarm({ source, reason })) {
      return false;
    }

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

  function attachRuntimeAudioEventListeners() {
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
    cueController.destroy();
    releaseBackgroundAudioLease(SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
    releaseBackgroundAudioLease(SPEED_BACKGROUND_AUDIO_LEASE);
    clearMediaSessionClient(SPEED_MEDIA_SESSION_OWNER);
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
    installMediaSessionActionHandlers,
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
