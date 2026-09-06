import * as audioRuntime from "../shared/audio-runtime.js";
import { createDriveRecordingService } from "./services/drive-recording-service.js";
import { createDrivingAlertService } from "./services/driving-alert-service.js";
import { createDrivingTelemetryService } from "./services/driving-telemetry-service.js";
import { createGpsService } from "./services/gps-service.js";
import { createTtsService } from "./services/tts-service.js";
import { createRecoveryCoordinator } from "../shared/recovery-coordinator.js";
import { sharedSettings } from "../app-platform/shared-settings.js";
import { createPlaceResolver } from "../shared/place-resolver.js";
import type {
  AudioRuntime,
  DriveRecordingService,
  DrivingAlertService,
  DrivingTelemetryService,
  GpsService,
  TtsService,
} from "../types/services";
import type { RuntimeContext } from "../types/route";

const buildDriveRecordingService = createDriveRecordingService as (options: {
  gpsStore: GpsService;
  telemetryService: DrivingTelemetryService;
  unitStore: unknown;
  placeResolver: unknown;
}) => DriveRecordingService;
const buildDrivingAlertService = createDrivingAlertService as unknown as (options: {
  gpsService: GpsService;
  telemetryService: DrivingTelemetryService;
  sharedSettings: unknown;
}) => DrivingAlertService;

export function createRuntimeContext(): RuntimeContext {
  const gpsService = createGpsService() as GpsService;
  const drivingTelemetryService = createDrivingTelemetryService({ gpsService });
  const placeResolver = createPlaceResolver({
    getLanguage: () => sharedSettings.get("language") || "en",
  });
  const driveRecordingService = buildDriveRecordingService({
    gpsStore: gpsService,
    telemetryService: drivingTelemetryService,
    unitStore: sharedSettings,
    placeResolver,
  });
  const drivingAlertService = buildDrivingAlertService({
    gpsService,
    telemetryService: drivingTelemetryService,
    sharedSettings,
  });
  const ttsService = createTtsService() as TtsService;
  const recoveryCoordinator = createRecoveryCoordinator();

  return {
    audioRuntime: audioRuntime as unknown as AudioRuntime,
    driveRecordingService,
    drivingTelemetryService,
    drivingAlertService,
    gpsService,
    recoveryCoordinator,
    ttsService,
  };
}
