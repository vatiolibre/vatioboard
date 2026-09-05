import {
  IconGpsLab,
  IconMuted,
  IconPause,
  IconSettings,
  IconVolume,
} from "../icons.js";
import { markWelcomeLocationChoice, shouldDeferWelcomeLocationRequest } from "../app/welcome-consent.js";
import {
  createDrivingAudioCueController,
  type DrivingAudioCueController,
} from "./driving-audio-cues.js";
import { createTripStatsModel, type TripStatsModel } from "./trip-stats.js";
import { START_RECORDING_SOUND_URL, TRAP_SOUND_URL } from "../speed/constants.js";
import type {
  DriveRecordingService,
  DriveRecordingSnapshot,
  DrivingAlertService,
  DrivingAlertSnapshot,
  GpsService,
  GpsSnapshot,
  NormalizedGpsPosition,
} from "../types/services";

type Translate = (key: string, fallback?: string) => string;

export interface DrivingHudContext {
  nearestCameraDistanceM?: number | null;
  cameraState?: string | null;
}

export interface DrivingHudOptions {
  mount: HTMLElement;
  consumerId: string;
  recordingSource: string;
  drivingAlerts?: DrivingAlertService | null;
  driveRecording?: DriveRecordingService | null;
  gps?: GpsService | null;
  translate?: Translate;
  getContext?: () => DrivingHudContext | null;
  onPosition?: (position: NormalizedGpsPosition | null) => void;
  onLocationRequest?: () => void;
  onRecenter?: () => void;
  onOpenAlertSettings?: () => void;
  audioCueController?: DrivingAudioCueController | null;
}

function speedValue(speedMs: number, unit: string): number {
  return Math.round(speedMs * (unit === "mph" ? 2.2369362920544 : 3.6));
}

export function createDrivingHud(options: DrivingHudOptions) {
  const translate = options.translate || ((key: string, fallback?: string) => fallback || key);
  const alerts = options.drivingAlerts || null;
  const recording = options.driveRecording || null;
  const gps = options.gps || null;
  const state: {
    destroyed: boolean;
    sourceStarted: boolean;
    alert: DrivingAlertSnapshot | null;
    recording: DriveRecordingSnapshot | null;
    gps: GpsSnapshot | null;
    cue: Record<string, unknown>;
    audioPending: boolean;
  } = {
    destroyed: false,
    sourceStarted: false,
    alert: alerts?.getSnapshot?.() || null,
    recording: recording?.getSnapshot?.() || null,
    gps: gps?.getSnapshot?.() || null,
    cue: {},
    audioPending: false,
  };

  options.mount.innerHTML = `
    <section class="driving-hud" aria-label="${translate("drivingHud", "Driving status")}">
      <div class="driving-status-pill">
        <div class="driving-status-heading">
          <span data-i18n="liveSpeed">${translate("liveSpeed", "Live speed")}</span>
          <span class="driving-camera-state" data-driving-camera-state hidden></span>
        </div>
        <div class="driving-speed-reading"><strong data-driving-speed>0</strong><span data-driving-speed-unit>km/h</span></div>
        <div class="driving-limit-row"><span data-driving-limit-label>${translate("alerts", "Alerts")}</span><strong data-driving-limit>${translate("off", "Off")}</strong></div>
        <div class="driving-camera-row" data-driving-camera-row hidden><span data-i18n="cameraMapNearestCamera">${translate("cameraMapNearestCamera", "Nearest camera")}</span><strong data-driving-camera-distance></strong></div>
        <div class="driving-trip-stats" data-driving-trip-stats aria-label="${translate("tripStats", "Trip stats")}">
          <span><small>${translate("max", "Max")}</small><strong data-driving-stat="maxSpeed"></strong></span>
          <span><small>${translate("average", "Average")}</small><strong data-driving-stat="averageSpeed"></strong></span>
          <span><small>${translate("distance", "Distance")}</small><strong data-driving-stat="distance"></strong></span>
          <span><small>${translate("duration", "Duration")}</small><strong data-driving-stat="duration"></strong></span>
          <span><small>${translate("altitude", "Altitude")}</small><strong data-driving-stat="altitude"></strong></span>
          <span><small>${translate("maxAlt", "Max Alt")}</small><strong data-driving-stat="maxAltitude"></strong></span>
          <span><small>${translate("minAlt", "Min Alt")}</small><strong data-driving-stat="minAltitude"></strong></span>
        </div>
        <button type="button" class="driving-keep-alive" data-driving-keep-alive hidden>${translate("rearmKeepAliveAudio", "Rearm keep-alive audio")}</button>
      </div>
      <div class="driving-actions" role="toolbar" aria-label="${translate("drivingControls", "Driving controls")}">
        <button type="button" data-driving-action="audio" aria-pressed="true"><span class="driving-icon-on" aria-hidden="true">${IconVolume}</span><span class="driving-icon-off" aria-hidden="true">${IconMuted}</span></button>
        <button type="button" data-driving-action="alerts" aria-label="${translate("configureAlerts", "Configure alerts")}"><span aria-hidden="true">${IconSettings}</span></button>
        <button type="button" data-driving-action="record" aria-pressed="false"><span class="driving-icon-record" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="currentColor"/></svg></span><span class="driving-icon-pause" aria-hidden="true">${IconPause}</span></button>
        <button type="button" data-driving-action="stop" hidden aria-label="${translate("stopRecording", "Stop recording")}"><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg></span></button>
        <button type="button" data-driving-action="location" aria-label="${translate("enableLocation", "Enable location")}"><span aria-hidden="true">${IconGpsLab}</span></button>
        <button type="button" data-driving-action="recenter" aria-label="${translate("cameraMapRecenter", "Center on my location")}"><span aria-hidden="true">${IconGpsLab}</span></button>
      </div>
    </section>`;

  const root = options.mount.querySelector<HTMLElement>(".driving-hud")!;
  const action = (name: string) => root.querySelector<HTMLButtonElement>(`[data-driving-action="${name}"]`)!;
  const audioButton = action("audio");
  const alertButton = action("alerts");
  const recordButton = action("record");
  const stopButton = action("stop");
  const locationButton = action("location");
  const recenterButton = action("recenter");
  const ownsCueController = !options.audioCueController;
  const cueController = options.audioCueController || createDrivingAudioCueController({
    alertsArmedUrl: TRAP_SOUND_URL,
    recordingStartedUrl: START_RECORDING_SOUND_URL,
    onStateChange(snapshot) {
      state.cue = snapshot as unknown as Record<string, unknown>;
      render();
    },
  });
  state.cue = cueController.getSnapshot() as unknown as Record<string, unknown>;

  let releaseConsumer: (() => void) | null = null;
  let unsubscribeSource: (() => void) | null = null;
  let unsubscribeRecording: (() => void) | null = null;
  let statsTimerId: number | null = null;

  function renderMetric(name: keyof TripStatsModel, model: TripStatsModel) {
    const target = root.querySelector<HTMLElement>(`[data-driving-stat="${name}"]`);
    if (!target) return;
    const metric = model[name];
    target.textContent = metric.unit ? `${metric.value} ${metric.unit}` : metric.value;
  }

  function getPosition(): NormalizedGpsPosition | null {
    return state.alert?.latestPosition || state.gps?.normalized || null;
  }

  function startSource(fromUserGesture = false) {
    if (state.sourceStarted || state.destroyed) return;
    if (shouldDeferWelcomeLocationRequest() && !fromUserGesture && state.alert?.started !== true) {
      render();
      return;
    }
    state.sourceStarted = true;
    if (alerts) {
      const reason = fromUserGesture
        ? `${options.recordingSource}-route-user`
        : `${options.recordingSource}-route`;
      const existingSnapshot = alerts.getSnapshot?.() || state.alert;
      releaseConsumer = alerts.acquireConsumer?.(options.consumerId, {
        fromUserGesture,
        reason,
      }) || null;
      state.alert = alerts.acquireConsumer
        ? alerts.getSnapshot()
        : existingSnapshot?.started === true
          ? existingSnapshot
          : alerts.start({ fromUserGesture, reason });
      options.onPosition?.(state.alert?.latestPosition || null);
      unsubscribeSource = alerts.subscribe((snapshot) => {
        if (state.destroyed) return;
        state.alert = snapshot;
        options.onPosition?.(snapshot.latestPosition || null);
        render();
      });
    } else if (gps) {
      releaseConsumer = gps.startConsumer(options.consumerId, {
        enableHighAccuracy: true,
        reason: `${options.recordingSource}-route`,
      });
      unsubscribeSource = gps.subscribe((snapshot) => {
        if (state.destroyed) return;
        state.gps = snapshot;
        options.onPosition?.(snapshot.normalized || null);
        render();
      });
      options.onPosition?.(state.gps?.normalized || null);
    }
    render();
  }

  function render() {
    if (state.destroyed) return;
    const alertPrefs = (state.alert?.preferences || {}) as Record<string, unknown>;
    const alertUi = (state.alert?.alertUiState || {}) as Record<string, unknown>;
    const alertAudio = (state.alert?.audio || {}) as Record<string, unknown>;
    const unit = alertPrefs.unit === "mph" ? "mph" : "kmh";
    const distanceUnit = alertPrefs.distanceUnit === "mi" ? "mi" : "m";
    const muted = alertPrefs.audioMuted === true || alertAudio.muted === true;
    const manualAudioEnabled = alertPrefs.alertEnabled === true
      && Number(alertPrefs.alertLimitMs) > 0
      && alertPrefs.alertSoundEnabled === true;
    const trapAudioEnabled = alertPrefs.trapAlertEnabled === true && alertPrefs.trapSoundEnabled === true;
    const audioFeatureEnabled = manualAudioEnabled || trapAudioEnabled;
    const audioBlocked = alertAudio.blocked === true || state.cue.alertsArmedBlocked === true;
    const audioArming = state.audioPending
      || alertAudio.pending === true
      || alertAudio.backgroundAudioArmPending === true;
    const audioArmed = !muted
      && audioFeatureEnabled
      && alertAudio.primed === true
      && alertAudio.backgroundAudioArmed === true;
    const audioState = muted
      ? "muted"
      : audioBlocked
        ? "blocked"
        : audioArming
          ? "arming"
          : audioArmed
            ? "armed"
            : audioFeatureEnabled
              ? "unarmed"
              : "ready";
    const position = getPosition();
    const speed = Number(state.alert?.currentSpeedMs ?? position?.speedMs ?? 0);
    root.querySelector<HTMLElement>("[data-driving-speed]")!.textContent = String(speedValue(Number.isFinite(speed) ? speed : 0, unit));
    root.querySelector<HTMLElement>("[data-driving-speed-unit]")!.textContent = unit === "mph" ? "mph" : "km/h";
    const enabled = alertUi.enabled === true;
    root.querySelector<HTMLElement>("[data-driving-limit-label]")!.textContent = enabled
      ? translate("speedLimit", "Limit")
      : translate("alerts", "Alerts");
    root.querySelector<HTMLElement>("[data-driving-limit]")!.textContent = enabled && Number.isFinite(Number(alertUi.limitDisplayValue))
      ? `${alertUi.limitDisplayValue} ${unit === "mph" ? "mph" : "km/h"}`
      : translate("off", "Off");
    root.querySelector(".driving-status-pill")?.classList.toggle("is-alert-over", alertUi.over === true);
    root.querySelector(".driving-status-pill")?.classList.toggle("is-alert-near", alertUi.near === true || alertUi.trapActive === true);

    const context = options.getContext?.() || null;
    const cameraRow = root.querySelector<HTMLElement>("[data-driving-camera-row]")!;
    const rawCameraDistance = context?.nearestCameraDistanceM;
    const cameraDistance = rawCameraDistance === null || rawCameraDistance === undefined
      ? Number.NaN
      : Number(rawCameraDistance);
    cameraRow.hidden = !Number.isFinite(cameraDistance);
    if (!cameraRow.hidden) {
      const nearestCamera = createTripStatsModel({
        nearestCameraDistanceM: cameraDistance,
        distanceUnit: distanceUnit === "mi" ? "mi" : "m",
      }).nearestCamera;
      root.querySelector<HTMLElement>("[data-driving-camera-distance]")!.textContent = `${nearestCamera.value} ${nearestCamera.unit}`.trim();
    }
    const stats = createTripStatsModel({
      currentSpeedMs: speed,
      maxSpeedMs: state.recording?.maxSpeedMs,
      averageSpeedMs: state.recording?.averageSpeedMs,
      totalDistanceM: state.recording?.totalDistanceM,
      durationMs: state.recording?.durationMs,
      startedAtMs: state.recording?.startedAtMs,
      currentAltitudeM: state.recording?.currentAltitudeM ?? position?.altitudeM,
      maxAltitudeM: state.recording?.maxAltitudeM,
      minAltitudeM: state.recording?.minAltitudeM,
      nearestCameraDistanceM: cameraDistance,
      speedUnit: unit,
      distanceUnit: distanceUnit === "mi" ? "mi" : "m",
    });
    for (const name of ["maxSpeed", "averageSpeed", "distance", "duration", "altitude", "maxAltitude", "minAltitude"] as const) {
      renderMetric(name, stats);
    }

    audioButton.classList.toggle("is-muted", muted);
    audioButton.classList.toggle("is-blocked", audioBlocked);
    audioButton.classList.toggle("is-audio-blocked", audioBlocked);
    audioButton.classList.toggle("is-audio-arming", audioArming);
    audioButton.classList.toggle("is-audio-armed", audioArmed);
    audioButton.dataset.audioState = audioState;
    audioButton.setAttribute("aria-pressed", String(!muted));
    audioButton.setAttribute("aria-label", muted
      ? translate("unmuteAlertAudio", "Unmute alert audio")
      : audioBlocked
        ? translate("activitySpeedAlertsTapToRearm", "Tap to rearm")
        : audioArming
          ? translate("activitySpeedAlertsArming", "Arming alerts")
          : audioArmed || !audioFeatureEnabled
            ? translate("muteAlertAudio", "Mute alert audio")
            : translate("enableDrivingAlerts", "Enable driving alerts"));
    const recordingState = state.recording?.state || "idle";
    const recordingActive = recordingState === "recording";
    const hasRecording = recordingActive || recordingState === "paused" || recordingState === "finalizing";
    recordButton.dataset.recordingState = recordingState;
    recordButton.setAttribute("aria-pressed", String(recordingActive));
    recordButton.setAttribute("aria-label", recordingActive
      ? translate("pauseRecording", "Pause recording")
      : recordingState === "paused"
        ? translate("resumeRecording", "Resume recording")
        : translate("startRecording", "Start recording"));
    recordButton.disabled = !recording || recordingState === "finalizing";
    stopButton.hidden = !hasRecording;
    stopButton.disabled = !recording || recordingState === "finalizing";
    const keepAliveButton = root.querySelector<HTMLButtonElement>("[data-driving-keep-alive]")!;
    const keepAliveNeedsGesture = recordingActive && Boolean(
      state.recording?.keepAliveSuppressed
      || state.recording?.keepAliveBlocked
      || (state.recording?.keepAliveIntended && !state.recording?.keepAliveArmed && !state.recording?.keepAlivePending)
    );
    keepAliveButton.hidden = !keepAliveNeedsGesture;
    locationButton.hidden = state.sourceStarted && Boolean(position);
    recenterButton.hidden = !position;
  }

  async function primeAudio(playConfirmation = false) {
    if (!alerts?.primeAudioFromUserGesture || state.audioPending) return;
    state.audioPending = true;
    if (playConfirmation) cueController.playAlertsArmedCue();
    try {
      await alerts.primeAudioFromUserGesture();
      state.alert = alerts.getSnapshot();
    } finally {
      state.audioPending = false;
      render();
    }
  }

  function handleAudio() {
    if (!alerts?.setMuted) return;
    const preferences = (state.alert?.preferences || {}) as Record<string, unknown>;
    const muted = preferences.audioMuted === true;
    const alertAudio = (state.alert?.audio || {}) as Record<string, unknown>;
    const audioFeatureEnabled = (
      preferences.alertEnabled === true
      && Number(preferences.alertLimitMs) > 0
      && preferences.alertSoundEnabled === true
    ) || (preferences.trapAlertEnabled === true && preferences.trapSoundEnabled === true);
    const armed = alertAudio.primed === true && alertAudio.backgroundAudioArmed === true;
    if (!muted && audioFeatureEnabled && !armed) {
      void primeAudio(true);
      return;
    }
    state.alert = alerts.setMuted(!muted, { fromUserGesture: true, startIfNeeded: false });
    if (muted) void primeAudio(true);
    render();
  }

  function handleRecord() {
    if (!recording) return;
    const previous = state.recording?.state || "idle";
    state.recording = previous === "recording"
      ? recording.pauseRecording()
      : previous === "paused"
        ? recording.resumeRecording()
      : recording.startRecording({ source: options.recordingSource, fromUserGesture: true });
    if (previous === "idle" && state.recording.state === "recording") cueController.playRecordingStartedCue();
    render();
  }

  async function handleStop() {
    if (!recording || stopButton.disabled) return;
    stopButton.disabled = true;
    try {
      state.recording = await recording.stopRecording();
    } finally {
      render();
    }
  }

  function handleLocation() {
    markWelcomeLocationChoice("enabled");
    state.sourceStarted = false;
    startSource(true);
    options.onLocationRequest?.();
    void primeAudio();
  }

  audioButton.addEventListener("click", handleAudio);
  alertButton.addEventListener("click", () => {
    void primeAudio(true);
    options.onOpenAlertSettings?.();
  });
  recordButton.addEventListener("click", handleRecord);
  stopButton.addEventListener("click", () => void handleStop());
  root.querySelector<HTMLButtonElement>("[data-driving-keep-alive]")!.addEventListener("click", () => {
    void recording?.rearmKeepAlive?.({ fromUserGesture: true, reason: `${options.recordingSource}-hud-rearm` });
  });
  locationButton.addEventListener("click", handleLocation);
  recenterButton.addEventListener("click", () => {
    void primeAudio();
    options.onRecenter?.();
  });
  unsubscribeRecording = recording?.subscribe((snapshot) => {
    if (state.destroyed) return;
    state.recording = snapshot;
    render();
  }) || null;

  startSource();
  statsTimerId = window.setInterval(() => {
    if (state.recording?.state === "recording") render();
  }, 1000);
  render();

  return {
    render,
    startSource,
    getPosition,
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      unsubscribeSource?.();
      unsubscribeRecording?.();
      releaseConsumer?.();
      if (statsTimerId !== null) window.clearInterval(statsTimerId);
      if (ownsCueController) cueController.destroy();
      options.mount.replaceChildren();
    },
  };
}
