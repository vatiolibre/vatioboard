import * as audioRuntime from "../shared/audio-runtime.js";
import { createDriveRecordingService } from "./services/drive-recording-service.js";
import { createDrivingAlertService } from "./services/driving-alert-service.js";
import { createGpsService } from "./services/gps-service.js";
import type {
  AudioRuntime,
  DriveRecordingService,
  DrivingAlertService,
  GpsService,
} from "../types/services";
import type { RuntimeContext } from "../types/route";

const buildDriveRecordingService = createDriveRecordingService as (options: {
  gpsStore: GpsService;
}) => DriveRecordingService;
const buildDrivingAlertService = createDrivingAlertService as unknown as (options: {
  gpsService: GpsService;
}) => DrivingAlertService;

export function createRuntimeContext(): RuntimeContext {
  const gpsService = createGpsService() as GpsService;
  const driveRecordingService = buildDriveRecordingService({ gpsStore: gpsService });
  const drivingAlertService = buildDrivingAlertService({ gpsService });

  return {
    audioRuntime: audioRuntime as unknown as AudioRuntime,
    driveRecordingService,
    drivingAlertService,
    gpsService,
  };
}
