import * as audioRuntime from "../shared/audio-runtime.js";
import { createGpsService } from "./services/gps-service.js";

export function createRuntimeContext() {
  const gpsService = createGpsService();

  return {
    audioRuntime,
    gpsService,
  };
}
