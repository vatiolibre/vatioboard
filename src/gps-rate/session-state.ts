export type GpsRatePermissionState = "unknown" | "granted" | "prompt" | "denied" | "unsupported";

export interface GpsRateStatusMessage {
  key: string;
  params: Record<string, unknown> | null;
  rawText: string | null;
}

export interface GpsRateActionNotice {
  key: string | null;
  params: Record<string, unknown> | null;
  rawText: string | null;
}

export interface GpsRateNominatimState {
  baseUrl: string;
  activeApi: string;
  searchQuery: string;
  reverseLat: string;
  reverseLon: string;
  lookupIds: string;
  detailsPlaceId: string;
  isLoading: boolean;
  requestState: GpsRateStatusMessage;
  requestUrl: string;
  requestSourceKey: string | null;
  lastEndpointKey: string | null;
  responseText: string;
}

export interface GpsRateState {
  permissionState: GpsRatePermissionState;
  permissionStatus: PermissionStatus | null;
  isRunning: boolean;
  watchId: number | null;
  runStartedPerfMs: number | null;
  accumulatedRunDurationMs: number;
  samples: unknown[];
  hiddenCount: number;
  hiddenNow: boolean;
  keepAwakeRequested: boolean;
  wakeLockSentinel: unknown;
  wakeLockSupported: boolean;
  notes: string;
  lastSavedSummary: unknown;
  status: GpsRateStatusMessage;
  actionNotice: GpsRateActionNotice | null;
  actionNoticeTimerId: number | null;
  uiTimerId: number | null;
  currentSummary: unknown;
  nominatim: GpsRateNominatimState;
}

export interface GpsRateStateOptions {
  hiddenNow?: unknown;
  wakeLockSupported?: unknown;
  keepAwakeRequested?: unknown;
  notes?: unknown;
  lastSavedSummary?: unknown;
  nominatimBaseUrl?: unknown;
  nominatimActiveApi?: unknown;
}

export function createGpsRateState({
  hiddenNow,
  wakeLockSupported,
  keepAwakeRequested,
  notes,
  lastSavedSummary,
  nominatimBaseUrl,
  nominatimActiveApi,
}: GpsRateStateOptions): GpsRateState {
  return {
    permissionState: "unknown",
    permissionStatus: null,
    isRunning: false,
    watchId: null,
    runStartedPerfMs: null,
    accumulatedRunDurationMs: 0,
    samples: [],
    hiddenCount: 0,
    hiddenNow: Boolean(hiddenNow),
    keepAwakeRequested: Boolean(keepAwakeRequested),
    wakeLockSentinel: null,
    wakeLockSupported: Boolean(wakeLockSupported),
    notes: typeof notes === "string" ? notes : "",
    lastSavedSummary,
    status: { key: "gpsRateIdle", params: null, rawText: null },
    actionNotice: null,
    actionNoticeTimerId: null,
    uiTimerId: null,
    currentSummary: null,
    nominatim: {
      baseUrl: typeof nominatimBaseUrl === "string" && nominatimBaseUrl ? nominatimBaseUrl : "https://nominatim.openstreetmap.org",
      activeApi: typeof nominatimActiveApi === "string" && nominatimActiveApi ? nominatimActiveApi : "search",
      searchQuery: "",
      reverseLat: "",
      reverseLon: "",
      lookupIds: "",
      detailsPlaceId: "",
      isLoading: false,
      requestState: { key: "gpsRateNominatimIdle", params: null, rawText: null },
      requestUrl: "",
      requestSourceKey: null,
      lastEndpointKey: null,
      responseText: "",
    },
  };
}

export function getElapsedActiveMs(
  state: Pick<GpsRateState, "accumulatedRunDurationMs" | "isRunning" | "runStartedPerfMs">,
  perfNow: number,
): number {
  let elapsedMs = state.accumulatedRunDurationMs;
  if (state.isRunning && Number.isFinite(state.runStartedPerfMs) && Number.isFinite(perfNow)) {
    elapsedMs += perfNow - state.runStartedPerfMs;
  }
  return Math.max(0, elapsedMs);
}

export function hasSessionActivity(
  state: Pick<GpsRateState, "isRunning" | "accumulatedRunDurationMs" | "samples">,
): boolean {
  return state.isRunning || state.accumulatedRunDurationMs > 0 || state.samples.length > 0;
}

export function setStatus(
  state: Pick<GpsRateState, "status">,
  key: string,
  params: Record<string, unknown> | null = null,
): void {
  state.status = { key, params, rawText: null };
}

export function setRawStatus(state: Pick<GpsRateState, "status">, text: string): void {
  state.status = { key: "gpsRateError", params: null, rawText: text };
}
