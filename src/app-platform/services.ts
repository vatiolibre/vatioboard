import type {
  AudioRuntime,
  DriveRecordingService,
  DrivingAlertService,
  GpsConsumerOptions,
  GpsService,
} from "../types/services";
import type {
  VatioAppLogger,
  VatioAppPermissionRuntime,
  VatioAppServices,
  VatioAppStorage,
} from "./types";
import { createAppSettingsService } from "./settings.js";

type RuntimeServiceContext = Record<string, unknown> | null | undefined;

function getContextService<T>(context: RuntimeServiceContext, key: string): T | null {
  return (context?.[key] as T | null | undefined) || null;
}

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
): DrivingAlertService | null {
  if (!service) return null;
  if (!permissions.has("alerts.speed")) return null;
  return service;
}

function createAudioGateway(
  service: AudioRuntime | null,
  permissions: VatioAppPermissionRuntime,
): AudioRuntime | null {
  if (!service) return null;
  if (!permissions.has("audio.playback")) return null;
  return service;
}

export function createAppServiceGateway({
  baseContext,
  appStorage,
  permissions,
  logger,
}: {
  baseContext?: RuntimeServiceContext;
  appStorage: VatioAppStorage;
  permissions: VatioAppPermissionRuntime;
  logger?: VatioAppLogger | null;
}): VatioAppServices {
  const gpsService = getContextService<GpsService>(baseContext, "gpsService");
  const audioRuntime = getContextService<AudioRuntime>(baseContext, "audioRuntime");
  const driveRecordingService = getContextService<DriveRecordingService>(baseContext, "driveRecordingService");
  const drivingAlertService = getContextService<DrivingAlertService>(baseContext, "drivingAlertService");

  return {
    gps: createGpsGateway(gpsService, permissions),
    audio: createAudioGateway(audioRuntime, permissions),
    driveRecording: createDriveRecordingGateway(driveRecordingService, permissions),
    drivingAlerts: createDrivingAlertsGateway(drivingAlertService, permissions),
    auth: permissions.has("auth.session")
      ? {
          async getSessionState(options) {
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
          async getFeatureAccessState(options) {
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
        }
      : null,
    cloudSync: permissions.has("cloud.sync")
      ? {
          async getStatus() {
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
          async request(options) {
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
        }
      : null,
    settings: permissions.has("settings.read") || permissions.has("settings.write")
      ? createAppSettingsService({ storage: appStorage, permissions })
      : null,
  };
}
