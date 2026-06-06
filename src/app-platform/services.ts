import type {
  AudioRuntime,
  AudioRuntimeState,
  DriveRecordingService,
  DrivingAlertService,
  DrivingAlertSnapshot,
  GpsConsumerOptions,
  GpsService,
  TtsService,
  TtsSnapshot,
} from "../types/services";
import type {
  VatioAppId,
  VatioAppLogger,
  VatioAppPermissionRuntime,
  VatioAppServiceId,
  VatioAppServices,
  VatioAppStorage,
  VatioSharedSettingsKey,
  VatioSharedSettingsService,
  VatioSharedSettingsSnapshot,
} from "./types";
import { createAppSettingsService } from "./settings.js";
import { sharedSettings } from "./shared-settings.js";

type RuntimeServiceContext = Record<string, unknown> | null | undefined;

function getContextService<T>(context: RuntimeServiceContext, key: string): T | null {
  return (context?.[key] as T | null | undefined) || null;
}

function warnDenied(
  logger: Pick<VatioAppLogger, "warn"> | null | undefined,
  serviceName: string,
  permission: string,
) {
  logger?.warn?.(`Service "${serviceName}" denied because permission "${permission}" is not granted.`);
}

function canUseService(
  permissions: VatioAppPermissionRuntime,
  logger: Pick<VatioAppLogger, "warn"> | null | undefined,
  serviceName: string,
  permission: Parameters<VatioAppPermissionRuntime["require"]>[0],
) {
  const allowed = permissions.require(permission);
  if (!allowed) warnDenied(logger, serviceName, permission);
  return allowed;
}

const DENIED_AUDIO_STATE: AudioRuntimeState = {
  queue: [],
  playedHistory: [],
  currentIndex: -1,
  paused: true,
  volume: 0,
  muted: true,
  repeat: "off",
  shuffle: false,
  backgroundMode: false,
  sourceType: null,
  currentTrack: null,
  loading: false,
  error: "permission-denied",
  remoteSessionActive: false,
  currentTime: 0,
  duration: 0,
  playing: false,
};

const DENIED_DRIVING_ALERT_SNAPSHOT: DrivingAlertSnapshot = {
  status: "permission-denied",
  started: false,
  currentSpeedMs: 0,
  latestPosition: null,
  alertUiState: null,
  audio: null,
  preferences: null,
};

const DENIED_TTS_SNAPSHOT: TtsSnapshot = {
  status: "error",
  progress: "Permission denied",
  ratio: null,
  muted: true,
  volume: 0,
  primed: false,
  loading: false,
  generating: false,
  speaking: false,
  queueLength: 0,
  loadedVoice: null,
  activeVoice: null,
  activeLang: null,
  provider: null,
  error: "permission-denied",
  currentSourceAppId: null,
};

function createGpsGateway(
  service: GpsService | null,
  permissions: VatioAppPermissionRuntime,
): GpsService | null {
  if (!service) return null;
  if (!permissions.has("gps.read")) return null;

  return {
    ...service,
    watchPosition(success, error, options) {
      const nextOptions = { ...(options || {}) };
      if (nextOptions.enableHighAccuracy && !permissions.require("gps.highAccuracy")) {
        nextOptions.enableHighAccuracy = false;
      }
      return service.watchPosition(success, error, nextOptions);
    },
    startConsumer(consumerId: string, options: GpsConsumerOptions = {}) {
      const nextOptions = { ...options };
      if (nextOptions.enableHighAccuracy && !permissions.require("gps.highAccuracy")) {
        nextOptions.enableHighAccuracy = false;
      }
      return service.startConsumer(consumerId, nextOptions);
    },
    requestHighAccuracy(reason?: string) {
      if (!permissions.require("gps.highAccuracy")) return () => {};
      return service.requestHighAccuracy(reason);
    },
    releaseHighAccuracy(reason?: string) {
      if (!permissions.require("gps.highAccuracy")) return;
      service.releaseHighAccuracy(reason);
    },
  };
}

function createDriveRecordingGateway(
  service: DriveRecordingService | null,
  permissions: VatioAppPermissionRuntime,
): DriveRecordingService | null {
  if (!service) return null;
  if (!permissions.has("driveRecording.read") && !permissions.has("driveRecording.write")) {
    return null;
  }

  return {
    ...service,
    getSnapshot() {
      if (!permissions.require("driveRecording.read")) return service.getSnapshot();
      return service.getSnapshot();
    },
    getCurrentSession() {
      if (!permissions.require("driveRecording.read")) return null;
      return service.getCurrentSession();
    },
    subscribe(listener) {
      if (!permissions.require("driveRecording.read")) return () => {};
      return service.subscribe(listener);
    },
    startRecording(options) {
      if (!permissions.require("driveRecording.write")) return service.getSnapshot();
      return service.startRecording(options);
    },
    pauseRecording() {
      if (!permissions.require("driveRecording.write")) return service.getSnapshot();
      return service.pauseRecording();
    },
    resumeRecording() {
      if (!permissions.require("driveRecording.write")) return service.getSnapshot();
      return service.resumeRecording();
    },
    async stopRecording() {
      if (!permissions.require("driveRecording.write")) return service.getSnapshot();
      return service.stopRecording();
    },
    persistNow() {
      if (!permissions.require("driveRecording.write")) return Promise.resolve(null);
      return service.persistNow();
    },
  };
}

function createDrivingAlertsGateway(
  service: DrivingAlertService | null,
  permissions: VatioAppPermissionRuntime,
  logger?: VatioAppLogger | null,
): DrivingAlertService | null {
  if (!service) return null;
  if (!permissions.has("alerts.speed")) return null;
  const canUseAlerts = () => canUseService(permissions, logger, "drivingAlerts", "alerts.speed");
  const deniedSnapshot = () => ({ ...DENIED_DRIVING_ALERT_SNAPSHOT });

  return {
    ...service,
    start(options) {
      if (!canUseAlerts()) return deniedSnapshot();
      return service.start(options);
    },
    stop(options) {
      if (!canUseAlerts()) return deniedSnapshot();
      return service.stop(options);
    },
    subscribe(listener) {
      if (!canUseAlerts()) return () => {};
      return service.subscribe(listener);
    },
    getSnapshot() {
      if (!canUseAlerts()) return deniedSnapshot();
      return service.getSnapshot();
    },
    primeAudioFromUserGesture: service.primeAudioFromUserGesture
      ? async () => {
          if (!canUseAlerts()) return false;
          return service.primeAudioFromUserGesture?.() ?? false;
        }
      : undefined,
    setAlertSoundEnabled: service.setAlertSoundEnabled
      ? (value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setAlertSoundEnabled?.(value, options) ?? deniedSnapshot();
        }
      : undefined,
    setManualAlertEnabled: service.setManualAlertEnabled
      ? (value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setManualAlertEnabled?.(value, options) ?? deniedSnapshot();
        }
      : undefined,
    setManualAlertLimitMs: service.setManualAlertLimitMs
      ? (value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setManualAlertLimitMs?.(value, options) ?? deniedSnapshot();
        }
      : undefined,
    setMuted: service.setMuted
      ? (value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setMuted?.(value, options) ?? deniedSnapshot();
        }
      : undefined,
    setPreference: service.setPreference
      ? (key, value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setPreference?.(key, value, options) ?? deniedSnapshot();
        }
      : undefined,
    setTrapAlertDistanceM: service.setTrapAlertDistanceM
      ? (value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setTrapAlertDistanceM?.(value, options) ?? deniedSnapshot();
        }
      : undefined,
    setTrapAlertEnabled: service.setTrapAlertEnabled
      ? (value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setTrapAlertEnabled?.(value, options) ?? deniedSnapshot();
        }
      : undefined,
    setTrapSoundEnabled: service.setTrapSoundEnabled
      ? (value, options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setTrapSoundEnabled?.(value, options) ?? deniedSnapshot();
        }
      : undefined,
    setUnits: service.setUnits
      ? (options) => {
          if (!canUseAlerts()) return deniedSnapshot();
          return service.setUnits?.(options) ?? deniedSnapshot();
        }
      : undefined,
    destroy() {
      if (!canUseAlerts()) return;
      service.destroy();
    },
  };
}

function createAudioGateway(
  service: AudioRuntime | null,
  permissions: VatioAppPermissionRuntime,
  logger?: VatioAppLogger | null,
): AudioRuntime | null {
  if (!service) return null;
  if (!permissions.has("audio.playback")) return null;
  const canUseAudio = () => canUseService(permissions, logger, "audio", "audio.playback");

  return {
    ...service,
    getState() {
      if (!canUseAudio()) return { ...DENIED_AUDIO_STATE };
      return service.getState();
    },
    subscribe(listener) {
      if (!canUseAudio()) return () => {};
      return service.subscribe(listener);
    },
    setMediaSessionEnabled(enabled) {
      if (!canUseAudio()) return;
      service.setMediaSessionEnabled(enabled);
    },
    async primeAudio() {
      if (!canUseAudio()) return false;
      return service.primeAudio();
    },
    play(options) {
      if (!canUseAudio()) return false;
      return service.play(options);
    },
    pause(options) {
      if (!canUseAudio()) return;
      service.pause(options);
    },
    stopPlayback(options) {
      if (!canUseAudio()) return;
      service.stopPlayback(options);
    },
  };
}

function createTtsGateway(
  service: TtsService | null,
  permissions: VatioAppPermissionRuntime,
  logger?: VatioAppLogger | null,
  appId?: VatioAppId,
): TtsService | null {
  if (!service) return null;
  if (!permissions.has("tts.speak")) return null;
  const canUseTts = () => canUseService(permissions, logger, "tts", "tts.speak");
  const sourceAppId = appId || "unknown";

  return {
    ...service,
    getSnapshot() {
      if (!canUseTts()) return { ...DENIED_TTS_SNAPSHOT };
      return service.getSnapshot();
    },
    subscribe(listener) {
      if (!canUseTts()) return () => {};
      return service.subscribe(listener);
    },
    listVoices(lang) {
      if (!canUseTts()) return [];
      return service.listVoices(lang);
    },
    getDefaultVoice(lang) {
      if (!canUseTts()) return "";
      return service.getDefaultVoice(lang);
    },
    async primeFromUserGesture(options) {
      if (!canUseTts()) return false;
      return service.primeFromUserGesture(options);
    },
    async loadVoice(request = {}) {
      if (!canUseTts()) throw new Error("TTS permission denied.");
      return service.loadVoice({ ...request, sourceAppId });
    },
    async preloadVoice(request = {}) {
      if (!canUseTts()) throw new Error("TTS permission denied.");
      return service.preloadVoice({ ...request, sourceAppId });
    },
    async speak(request) {
      if (!canUseTts()) throw new Error("TTS permission denied.");
      return service.speak({ ...request, sourceAppId });
    },
    stop(options = {}) {
      if (!canUseTts()) return;
      service.stop({ ...options, sourceAppId });
    },
    cancel(options = {}) {
      if (!canUseTts()) return;
      service.cancel({ ...options, sourceAppId });
    },
    setMuted(value) {
      if (!canUseTts()) return { ...DENIED_TTS_SNAPSHOT };
      return service.setMuted(value);
    },
    setVolume(value) {
      if (!canUseTts()) return { ...DENIED_TTS_SNAPSHOT };
      return service.setVolume(value);
    },
  };
}

function createAuthGateway(
  permissions: VatioAppPermissionRuntime,
  logger?: VatioAppLogger | null,
) {
  if (!permissions.has("auth.session") || !permissions.has("network.backend")) return null;
  const canUseAuth = () =>
    canUseService(permissions, logger, "auth", "auth.session")
    && canUseService(permissions, logger, "auth", "network.backend");

  return {
    async getSessionState(options?: Record<string, unknown>) {
      if (!canUseAuth()) return null;
      try {
        const auth = await import("../shared/backend-auth.js");
        return typeof auth.getBackendSessionState === "function"
          ? auth.getBackendSessionState(options)
          : null;
      } catch (error) {
        logger?.warn("Backend auth session service is unavailable.", error);
        return null;
      }
    },
    async getFeatureAccessState(options?: Record<string, unknown>) {
      if (!canUseAuth()) return null;
      try {
        const auth = await import("../shared/backend-auth.js");
        return typeof auth.getBackendFeatureAccessState === "function"
          ? auth.getBackendFeatureAccessState(options)
          : null;
      } catch (error) {
        logger?.warn("Backend feature access service is unavailable.", error);
        return null;
      }
    },
  };
}

function createCloudSyncGateway(
  permissions: VatioAppPermissionRuntime,
  logger?: VatioAppLogger | null,
) {
  if (!permissions.has("cloud.sync") || !permissions.has("network.backend")) return null;
  const canUseCloudSync = () =>
    canUseService(permissions, logger, "cloudSync", "cloud.sync")
    && canUseService(permissions, logger, "cloudSync", "network.backend");

  return {
    async getStatus() {
      if (!canUseCloudSync()) return null;
      try {
        const cloudSync = await import("../shared/cloud-sync.js");
        return typeof cloudSync.getCloudSyncStatus === "function"
          ? cloudSync.getCloudSyncStatus()
          : null;
      } catch (error) {
        logger?.warn("Cloud sync status service is unavailable.", error);
        return null;
      }
    },
    async request(options?: Record<string, unknown>) {
      if (!canUseCloudSync()) return null;
      try {
        const cloudSync = await import("../shared/cloud-sync.js");
        return typeof cloudSync.requestCloudSync === "function"
          ? cloudSync.requestCloudSync(options)
          : null;
      } catch (error) {
        logger?.warn("Cloud sync request service is unavailable.", error);
        return null;
      }
    },
  };
}

function createSharedSettingsGateway(
  service: VatioSharedSettingsService,
  permissions: VatioAppPermissionRuntime,
  logger?: VatioAppLogger | null,
): VatioSharedSettingsService | null {
  if (!permissions.has("settings.read") && !permissions.has("settings.write")) return null;
  const canRead = () => canUseService(permissions, logger, "sharedSettings", "settings.read");
  const canWrite = () => canUseService(permissions, logger, "sharedSettings", "settings.write");

  return {
    getAll() {
      if (!canRead()) return {};
      return service.getAll();
    },
    get<K extends VatioSharedSettingsKey>(key: K): VatioSharedSettingsSnapshot[K] | null {
      if (!canRead()) return null;
      return service.get(key);
    },
    set<K extends VatioSharedSettingsKey>(key: K, value: VatioSharedSettingsSnapshot[K]) {
      if (!canWrite()) return false;
      return service.set(key, value);
    },
    reset(key?: VatioSharedSettingsKey) {
      if (!canWrite()) return false;
      return service.reset(key);
    },
    subscribe(listener) {
      if (!canRead()) return () => {};
      return service.subscribe(listener);
    },
  };
}

export function createAppServiceGateway({
  appId,
  baseContext,
  appStorage,
  permissions,
  declaredServices = [],
  logger,
}: {
  appId?: VatioAppId;
  baseContext?: RuntimeServiceContext;
  appStorage: VatioAppStorage;
  permissions: VatioAppPermissionRuntime;
  declaredServices?: readonly VatioAppServiceId[];
  logger?: VatioAppLogger | null;
}): VatioAppServices {
  const gpsService = getContextService<GpsService>(baseContext, "gpsService");
  const audioRuntime = getContextService<AudioRuntime>(baseContext, "audioRuntime");
  const driveRecordingService = getContextService<DriveRecordingService>(baseContext, "driveRecordingService");
  const drivingAlertService = getContextService<DrivingAlertService>(baseContext, "drivingAlertService");
  const ttsService = getContextService<TtsService>(baseContext, "ttsService");
  const declaredServiceSet = new Set(declaredServices);
  const hasService = (service: VatioAppServiceId) => declaredServiceSet.has(service);

  return {
    gps: hasService("gps") ? createGpsGateway(gpsService, permissions) : null,
    audio: hasService("audio") ? createAudioGateway(audioRuntime, permissions, logger) : null,
    driveRecording: hasService("driveRecording") ? createDriveRecordingGateway(driveRecordingService, permissions) : null,
    drivingAlerts: hasService("drivingAlerts") ? createDrivingAlertsGateway(drivingAlertService, permissions, logger) : null,
    tts: hasService("tts") ? createTtsGateway(ttsService, permissions, logger, appId) : null,
    auth: hasService("auth") ? createAuthGateway(permissions, logger) : null,
    cloudSync: hasService("cloudSync") ? createCloudSyncGateway(permissions, logger) : null,
    settings: hasService("settings") && (permissions.has("settings.read") || permissions.has("settings.write"))
      ? createAppSettingsService({ storage: appStorage, permissions })
      : null,
    sharedSettings: hasService("settings") && (permissions.has("settings.read") || permissions.has("settings.write"))
      ? createSharedSettingsGateway(sharedSettings, permissions, logger)
      : null,
  };
}
