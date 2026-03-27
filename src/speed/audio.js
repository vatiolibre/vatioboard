import {
  BACKGROUND_KEEPALIVE_DURATION_SECONDS,
  BACKGROUND_KEEPALIVE_SAMPLE_RATE,
  MEDIA_METADATA_MIN_UPDATE_INTERVAL_MS,
  MEDIA_SESSION_FALLBACK_ARTWORK,
  OVERSPEED_SOUND_URL,
  RUNTIME_ARTWORK_SIZE,
  SPEED_APP_NAME,
  TRAP_SOUND_URL,
  UNIT_CONFIG,
} from "./constants.js";
import { shouldPlayOverspeedSound } from "./alerts.js";
import { capitalizeText, escapeSvgText, getDistanceDisplay, truncateText } from "./render.js";

export function writeAsciiString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function createSilentLoopAudioUrl() {
  const sampleCount = BACKGROUND_KEEPALIVE_SAMPLE_RATE * BACKGROUND_KEEPALIVE_DURATION_SECONDS;
  const buffer = new ArrayBuffer(44 + (sampleCount * 2));
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + (sampleCount * 2), true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, BACKGROUND_KEEPALIVE_SAMPLE_RATE, true);
  view.setUint32(28, BACKGROUND_KEEPALIVE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export function createSpeedAudioController({
  state,
  t,
  getAlertUiState,
  convertSpeed,
  getConfiguredTrapAlertDistanceLabel,
  getAlertLimitDisplayValue,
  getSubStatusText,
  getCriticalAlertText,
}) {
  const overspeedAudio = new Audio(OVERSPEED_SOUND_URL);
  overspeedAudio.loop = true;
  overspeedAudio.preload = "auto";
  overspeedAudio.playsInline = true;

  const trapAlertAudio = new Audio(TRAP_SOUND_URL);
  trapAlertAudio.loop = false;
  trapAlertAudio.preload = "auto";
  trapAlertAudio.playsInline = true;

  let backgroundKeepAliveAudioUrl = createSilentLoopAudioUrl();
  const backgroundKeepAliveAudio = new Audio(backgroundKeepAliveAudioUrl);
  backgroundKeepAliveAudio.loop = true;
  backgroundKeepAliveAudio.preload = "auto";
  backgroundKeepAliveAudio.playsInline = true;

  let audioPrimePromise = null;

  trapAlertAudio.addEventListener("ended", () => {
    state.trapSoundPending = false;
    state.trapAudible = false;
    state.trapSoundDeadlineAt = 0;
  });

  function supportsMediaSession() {
    return "mediaSession" in navigator;
  }

  function supportsMediaMetadata() {
    return supportsMediaSession() && typeof window.MediaMetadata === "function";
  }

  function getRuntimeSpeedLabel() {
    return `${Math.round(convertSpeed(state.currentSpeedMs, state.unit))} ${UNIT_CONFIG[state.unit].label}`;
  }

  function getRuntimeTripLabel() {
    const distance = getDistanceDisplay(state.totalDistanceM, state.distanceUnit);
    return `${capitalizeText(t("trip"))} ${distance.value} ${distance.unit}`;
  }

  function getRuntimeBackgroundAudioLabel() {
    return `${t("backgroundAudio")}: ${state.backgroundAudioEnabled ? t("on") : t("off")}`;
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
    if (!backgroundKeepAliveAudio.paused || !overspeedAudio.paused || !trapAlertAudio.paused) {
      return "playing";
    }

    if (
      state.backgroundAudioEnabled
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
      backgroundValue: truncateText(state.backgroundAudioEnabled ? t("on") : t("off"), 12),
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

    if (!supportsMediaSession()) {
      return;
    }

    const nextPlaybackState = getRuntimeMediaPlaybackState();
    if (state.runtimeMediaPlaybackState !== nextPlaybackState) {
      try {
        navigator.mediaSession.playbackState = nextPlaybackState;
      } catch {
        // Ignore partial media session implementations.
      }
      state.runtimeMediaPlaybackState = nextPlaybackState;
    }

    if (!supportsMediaMetadata()) {
      return;
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
      state.backgroundAudioEnabled,
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
    };

    try {
      navigator.mediaSession.metadata = new window.MediaMetadata(metadataInit);
    } catch {
      if (!state.runtimeDynamicArtworkBlocked) {
        state.runtimeDynamicArtworkBlocked = true;
        try {
          navigator.mediaSession.metadata = new window.MediaMetadata({
            ...metadataInit,
            artwork: MEDIA_SESSION_FALLBACK_ARTWORK,
          });
        } catch {
          // Ignore browsers that reject metadata construction.
        }
      }
    }
    state.runtimeMediaMetadataSignature = metadataSignature;
    state.runtimeMediaMetadataUrgencySignature = metadataUrgencySignature;
    state.runtimeMediaMetadataUpdatedAt = now;
  }

  function setMediaSessionActionHandler(action, handler) {
    if (!supportsMediaSession() || typeof navigator.mediaSession.setActionHandler !== "function") {
      return;
    }

    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Ignore unsupported actions.
    }
  }

  function installMediaSessionActionHandlers(handlers) {
    setMediaSessionActionHandler("play", () => {
      handlers.setBackgroundAudioEnabled(true, { fromUserGesture: true });
    });
    setMediaSessionActionHandler("pause", () => {
      handlers.setBackgroundAudioEnabled(false, { fromUserGesture: true });
    });
    setMediaSessionActionHandler("stop", () => {
      handlers.setBackgroundAudioEnabled(false, { fromUserGesture: true });
      handlers.setAudioMuted(true, { fromUserGesture: true });
    });
  }

  function silenceAudioElement(audio) {
    audio.muted = true;
    audio.volume = 0;
  }

  function activateAudioElement(audio) {
    audio.muted = false;
    audio.volume = 1;
  }

  function wantsBackgroundAudio() {
    return state.backgroundAudioEnabled && !state.audioMuted && !state.backgroundAudioSuppressed;
  }

  function canRecoverSuppressedBackgroundAudio() {
    return state.backgroundAudioSuppressed
      && state.backgroundAudioEnabled
      && !state.audioMuted
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
    void armBackgroundAlertAudio();
    return true;
  }

  function handleUserGestureAudioActivation() {
    if (maybeRecoverSuppressedBackgroundAudio({ fromUserGesture: true })) {
      return;
    }

    if (wantsBackgroundAudio()) {
      void armBackgroundAlertAudio();
    } else if (!state.audioMuted) {
      void primeAlertAudio();
    }
  }

  function suppressBackgroundAudioRuntime() {
    state.backgroundAudioRevision += 1;
    state.backgroundAudioSuppressed = true;
    state.backgroundAudioArmed = false;
    state.backgroundAudioArmPending = false;
    clearTrapMuteTimeout();
    stopBackgroundKeepAliveAudio();
  }

  function isStaleBackgroundAudioArm(revision) {
    return revision !== state.backgroundAudioRevision || !wantsBackgroundAudio();
  }

  function stopAudioElementPlayback(audio) {
    audio.pause();
    audio.currentTime = 0;
  }

  async function ensureBackgroundKeepAliveAudio(revision = state.backgroundAudioRevision) {
    backgroundKeepAliveAudio.loop = true;
    backgroundKeepAliveAudio.muted = false;
    backgroundKeepAliveAudio.volume = 1;

    if (!backgroundKeepAliveAudio.paused) {
      return !isStaleBackgroundAudioArm(revision);
    }

    backgroundKeepAliveAudio.currentTime = 0;
    const playPromise = backgroundKeepAliveAudio.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }

    if (isStaleBackgroundAudioArm(revision)) {
      if (!wantsBackgroundAudio()) {
        stopBackgroundKeepAliveAudio();
      }
      return false;
    }

    return true;
  }

  function stopBackgroundKeepAliveAudio() {
    backgroundKeepAliveAudio.pause();
    backgroundKeepAliveAudio.currentTime = 0;
  }

  function revokeBackgroundKeepAliveAudioUrl() {
    if (!backgroundKeepAliveAudioUrl) return;
    URL.revokeObjectURL(backgroundKeepAliveAudioUrl);
    backgroundKeepAliveAudioUrl = "";
  }

  async function ensureAudioElementLooping(audio, revision = state.backgroundAudioRevision) {
    audio.loop = true;

    if (!audio.paused) {
      return !isStaleBackgroundAudioArm(revision);
    }

    silenceAudioElement(audio);
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }

    if (isStaleBackgroundAudioArm(revision)) {
      if (!wantsBackgroundAudio()) {
        stopAudioElementPlayback(audio);
      }
      return false;
    }

    return true;
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
      void ensureAudioElementLooping(overspeedAudio, state.backgroundAudioRevision).catch(() => {});
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
      return;
    }

    state.alertSoundPending = true;
    playPromise
      .then(() => {
        if (overspeedSoundRequestId !== state.overspeedSoundRequestId) return;
        state.alertSoundPending = false;
        state.alertSoundBlocked = false;
        state.overspeedAudible = true;
      })
      .catch(() => {
        if (overspeedSoundRequestId !== state.overspeedSoundRequestId) return;
        state.alertSoundPending = false;
        state.alertSoundBlocked = true;
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
      void ensureAudioElementLooping(trapAlertAudio, state.backgroundAudioRevision).catch(() => {});
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

  async function primeAudioElement(audio) {
    if (!audio.paused) {
      return true;
    }

    const previousMuted = audio.muted;
    const previousVolume = audio.volume;
    const previousLoop = audio.loop;

    audio.muted = true;
    audio.volume = 0;
    audio.currentTime = 0;

    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        await playPromise;
      }
      audio.pause();
      audio.currentTime = 0;
      return true;
    } catch {
      audio.pause();
      audio.currentTime = 0;
      return false;
    } finally {
      audio.muted = previousMuted;
      audio.volume = previousVolume;
      audio.loop = previousLoop;
    }
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

        return state.audioPrimed;
      } finally {
        state.audioPrimePending = false;
        audioPrimePromise = null;
      }
    })();

    return audioPrimePromise;
  }

  async function armBackgroundAlertAudio() {
    if (!wantsBackgroundAudio()) return;
    if (
      state.backgroundAudioArmed
      && !state.backgroundAudioArmPending
      && !backgroundKeepAliveAudio.paused
      && !overspeedAudio.paused
      && !trapAlertAudio.paused
    ) {
      return;
    }
    if (state.backgroundAudioArmPending) return;

    const backgroundAudioRevision = state.backgroundAudioRevision;
    let shouldRetry = false;
    state.backgroundAudioArmPending = true;

    try {
      const audioPrimed = await primeAlertAudio();
      if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
        shouldRetry = wantsBackgroundAudio();
        return;
      }
      if (!audioPrimed) {
        return;
      }

      await ensureBackgroundKeepAliveAudio(backgroundAudioRevision);
      if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
        shouldRetry = wantsBackgroundAudio();
        return;
      }
      await Promise.all([
        overspeedAudio.paused
          ? ensureAudioElementLooping(overspeedAudio, backgroundAudioRevision)
          : Promise.resolve(true),
        trapAlertAudio.paused
          ? ensureAudioElementLooping(trapAlertAudio, backgroundAudioRevision)
          : Promise.resolve(true),
      ]);
      if (isStaleBackgroundAudioArm(backgroundAudioRevision)) {
        shouldRetry = wantsBackgroundAudio();
        return;
      }

      state.backgroundAudioArmed = true;
      state.alertSoundBlocked = false;
      state.trapSoundBlocked = false;
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
      if (shouldRetry && !state.backgroundAudioArmed && !state.backgroundAudioArmPending) {
        void armBackgroundAlertAudio();
      }
    }
  }

  function disarmBackgroundAlertAudio({ fromUserGesture = false } = {}) {
    state.backgroundAudioArmed = false;
    state.backgroundAudioArmPending = false;
    clearTrapMuteTimeout();
    stopBackgroundKeepAliveAudio();

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
        return;
      }
    } else {
      stopTrapSound();
    }
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
      if (state.backgroundAudioArmed) {
        scheduleTrapAudioMute();
      }
      return;
    }

    state.trapSoundPending = true;
    playPromise
      .then(() => {
        if (trapSoundRequestId !== state.trapSoundRequestId) return;
        state.trapSoundPending = false;
        state.trapSoundBlocked = false;
        state.trapAudible = true;
        state.lastTrapSoundedId = activeTrap.id;
        if (state.backgroundAudioArmed) {
          scheduleTrapAudioMute();
        }
      })
      .catch(() => {
        if (trapSoundRequestId !== state.trapSoundRequestId) return;
        state.trapSoundPending = false;
        state.trapSoundBlocked = true;
        stopTrapSound();
      });
  }

  function attachRuntimeAudioEventListeners() {
    for (const audio of [overspeedAudio, trapAlertAudio, backgroundKeepAliveAudio]) {
      audio.addEventListener("play", syncRuntimePagePresentation);
      audio.addEventListener("pause", syncRuntimePagePresentation);
      audio.addEventListener("ended", syncRuntimePagePresentation);
    }
  }

  function dispose() {
    stopBackgroundKeepAliveAudio();
    revokeBackgroundKeepAliveAudioUrl();
  }

  return {
    armBackgroundAlertAudio,
    attachRuntimeAudioEventListeners,
    disarmBackgroundAlertAudio,
    dispose,
    handleUserGestureAudioActivation,
    installMediaSessionActionHandlers,
    maybeRecoverSuppressedBackgroundAudio,
    primeAlertAudio,
    stopOverspeedSound,
    stopTrapSound,
    suppressBackgroundAudioRuntime,
    syncOverspeedSound,
    syncRuntimePagePresentation,
    syncTrapSound,
    wantsBackgroundAudio,
  };
}
