const ENABLE_KEY = "vatioboard.debug.background";
const STORAGE_KEY = "vatioboard.debug.background.events.v1";
const MAX_EVENTS = 250;
let memoryEnabled = false;
let memoryEvents: BackgroundDiagnosticEntry[] = [];

const ALLOWED_FIELDS = new Set([
  "audioAttached", "silentDuringPlayback", "primeOtherConsumers", "mediaSessionWrites", "audioSessionHints", "primaryConnected",
  "action", "hidden", "heartbeat", "wallTime", "performanceTime", "wallDelta", "performanceDelta",
  "leaseCount", "primaryCurrentTime", "keepAliveCurrentTime", "keepAliveDuration",
  "keepAliveLoop", "keepAliveMuted", "keepAliveVolume", "keepAlivePlaybackRate", "keepAliveEnded",
  "primaryTimeupdates", "keepAliveTimeupdates",
  "visibility",
  "lifecycle",
  "isLive",
  "paused",
  "ended",
  "readyState",
  "networkState",
  "mediaErrorCode",
  "transport",
  "connectionState",
  "backgroundStatus",
  "audioContextState",
  "gpsConsumerCount",
  "gpsErrorCode",
  "nativeWatchActive",
  "fixAgeMs",
  "reason",
  "recoveryRequired",
  "phase",
  "candidateAutomatic",
  "playerLeaseActive",
  "keepAlivePaused",
  "keepAliveIdentity",
  "retainedLeaseIds",
  "primaryElementId",
  "analysisElementId",
  "nativeElementId",
  "primaryDuration",
  "durationClass",
  "primaryHasGraph",
  "mediaSessionPlaybackState",
  "mediaSessionMetadataPresent",
  "audioSessionType",
  "audioSessionState",
  "artworkStatus",
  "fromUserGesture",
  "elementReused",
  "requestedOutputMode",
  "graphPreparation",
  "automaticNativeRestoration",
  "corsMode",
  "analysisEligible",
  "activeRole",
  "outgoingRole",
  "handoffPhase",
  "analysisGraphPreserved",
  "analysisContextState",
  "graphClosedDuringHandoff",
  "graphPreserved",
  "expectedPauseCause",
  "interruptionClassification",
  "previousAudioSessionState",
  "mediaEvent",
  "radioFailureClass",
  "startupAttemptId",
  "sourceResetCount",
  "relayEnvironment",
  "relayHealth",
  "relayVersion",
  "probeOutcome",
  "probeStage",
  "latencyBucket",
]);

export interface BackgroundDiagnosticEntry {
  at: number;
  event: string;
  detail: Record<string, string | number | boolean | null>;
}

function readEnabledPreference() {
  try {
    return sessionStorage.getItem(ENABLE_KEY) === "1";
  } catch {
    return memoryEnabled;
  }
}

function enableFromLocation() {
  try {
    const params = new URL(window.location.href).searchParams;
    const requested = params.get("debugAudio") ?? params.get("debugBackground");
    if (requested === "1") {
      memoryEnabled = true;
      sessionStorage.setItem(ENABLE_KEY, "1");
    }
    if (requested === "0") {
      memoryEnabled = false;
      sessionStorage.removeItem(ENABLE_KEY);
    }
  } catch {
    // Diagnostics are optional and must never affect playback.
  }
}

export function isBackgroundDiagnosticsEnabled() {
  enableFromLocation();
  return readEnabledPreference();
}

function sanitizeDetail(detail: Record<string, unknown> = {}) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = typeof value === "string"
        ? value.slice(0, 240)
        : value as number | boolean | null;
    }
  }
  return safe;
}

export function getBackgroundDiagnostics(): BackgroundDiagnosticEntry[] {
  if (!isBackgroundDiagnosticsEnabled()) return [];
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) as BackgroundDiagnosticEntry[] : [];
  } catch {
    return memoryEvents.slice();
  }
}

export function recordBackgroundDiagnostic(event: string, detail: Record<string, unknown> = {}) {
  if (!isBackgroundDiagnosticsEnabled()) return;
  const entries = getBackgroundDiagnostics();
  entries.push({
    at: Date.now(),
    event: String(event || "unknown").slice(0, 80),
    detail: sanitizeDetail(detail),
  });
  memoryEvents = entries.slice(-MAX_EVENTS);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memoryEvents));
  } catch {
    // Diagnostics are best effort.
  }
}

export function serializeBackgroundDiagnostics() {
  return JSON.stringify({
    version: 1,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    events: getBackgroundDiagnostics(),
  }, null, 2);
}

export async function copyBackgroundDiagnostics() {
  const text = serializeBackgroundDiagnostics();
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadBackgroundDiagnostics() {
  const url = URL.createObjectURL(new Blob([serializeBackgroundDiagnostics()], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `vatioboard-background-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
