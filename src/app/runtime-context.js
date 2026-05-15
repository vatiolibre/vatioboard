import * as audioRuntime from "../shared/audio-runtime.js";
import { createDriveRecordingService } from "./services/drive-recording-service.js";
import { createDrivingAlertService } from "./services/driving-alert-service.js";
import { createGpsService } from "./services/gps-service.js";

export function createRuntimeContext() {
  const gpsService = createGpsService();
  const driveRecordingService = createDriveRecordingService({ gpsStore: gpsService });
  const drivingAlertService = createDrivingAlertService({ gpsService });

  return {
    audioRuntime,
    driveRecordingService,
    drivingAlertService,
    gpsService,
  };
}
