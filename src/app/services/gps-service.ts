import {
  deriveHeadingFromPositions,
  normalizeHeading,
} from "../../shared/geo-heading.js";
import type {
  GpsConsumerOptions,
  GpsService,
  GpsSnapshot,
  NormalizedGpsPosition,
} from "../../types/services";

interface GpsServiceOptions {
  geolocation?: Geolocation | null;
}

interface GpsSubscriber {
  success: PositionCallback;
  error?: PositionErrorCallback | null;
  options: PositionOptions;
}

type GpsCoordsLike = {
  latitude?: unknown;
  longitude?: unknown;
  accuracy?: unknown;
  altitude?: unknown;
  altitudeAccuracy?: unknown;
  heading?: unknown;
  speed?: unknown;
};
type GpsPositionLike = {
  timestamp?: unknown;
  coords?: GpsCoordsLike | null;
};
type GpsStoredSnapshot = Partial<Omit<GpsSnapshot, "lastPosition">> & {
  lastPosition?: GeolocationPosition | GpsPositionLike | null;
};

const STORAGE_KEY = "vatioboard.gps_service.snapshot.v1";
const POSITION_STALE_MS = 10000;
const GPS_TIMESTAMP_MAX_SKEW_MS = 60000;
const MIN_VALID_WALL_CLOCK_MS = 946684800000;
const HIGH_ACCURACY_WATCH_TIMEOUT_MS = 20000;
const DEFAULT_WATCH_TIMEOUT_MS = 15000;
const MIN_DERIVED_HEADING_SPEED_MS = 1.5;
const GPS_DEBUG_STORAGE_KEY = "vatioboard.debug.gps";

function saveSnapshot(snapshot: GpsStoredSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      status: snapshot.status,
      lastPosition: snapshot.lastPosition,
      normalized: snapshot.normalized,
      lastError: snapshot.lastError,
      lastCallbackAtMs: snapshot.lastCallbackAtMs,
    }));
  } catch {
    // Best-effort resume hint only.
  }
}

function readSnapshot(): GpsStoredSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed as GpsStoredSnapshot : null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value) {
  return getFiniteNumber(value) !== null;
}

function getFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isGpsDebugEnabled() {
  try {
    return localStorage.getItem(GPS_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function debugGps(label: string, payload: Record<string, unknown> = {}) {
  if (!isGpsDebugEnabled() || typeof console === "undefined" || typeof console.debug !== "function") return;
  console.debug(`[vatioboard:gps] ${label}`, payload);
}

function clonePosition(position: GeolocationPosition | GpsPositionLike | null | undefined) {
  if (!position?.coords) return position;

  return {
    timestamp: isFiniteNumber(position.timestamp) ? Number(position.timestamp) : null,
    coords: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude,
      altitudeAccuracy: position.coords.altitudeAccuracy,
      heading: position.coords.heading,
      speed: position.coords.speed,
    },
  };
}

export function createGpsService({ geolocation = navigator.geolocation }: GpsServiceOptions = {}): GpsService {
  const subscribers = new Map<number, GpsSubscriber>();
  const consumers = new Map<string, { options: GpsConsumerOptions }>();
  const listeners = new Set<(snapshot: GpsSnapshot) => void>();
  const positionListeners = new Set<(position: NormalizedGpsPosition) => void>();
  const originalWatchPosition = geolocation?.watchPosition;
  const originalClearWatch = geolocation?.clearWatch;
  const nativeWatchPosition = originalWatchPosition?.bind(geolocation);
  const nativeClearWatch = originalClearWatch?.bind(geolocation);
  let nextId = 1;
  let nativeWatchId = null;
  let nativeWatchHighAccuracy = false;
  const savedSnapshot = readSnapshot();
  let snapshot: GpsSnapshot = {
    status: (savedSnapshot?.status as GpsSnapshot["status"]) || (geolocation ? "idle" : "unsupported"),
    normalized: null,
    lastError: null,
    lastCallbackAtMs: 0,
    subscriberCount: 0,
    nativeWatchActive: false,
    consumers: [],
    ...savedSnapshot,
    lastPosition: (savedSnapshot?.lastPosition as GeolocationPosition | null) ?? null,
  };
  let previousNormalized = snapshot.normalized || null;
  let lastHeadingDeg = normalizeHeading(snapshot.normalized?.headingDeg);
  let lastHeadingAtMs = Number(snapshot.normalized?.receivedAtMs || 0);
  let nextSampleSequence = Math.max(1, Number(snapshot.normalized?.sampleSequence || 0) + 1);

  function getConsumers() {
    return Array.from(consumers.keys());
  }

  function hasHighAccuracyConsumer() {
    if (subscribers.size > 0) {
      for (const subscriber of subscribers.values()) {
        if (subscriber.options?.enableHighAccuracy !== false) return true;
      }
    }
    for (const consumer of consumers.values()) {
      if (consumer.options?.enableHighAccuracy !== false) return true;
    }
    return false;
  }

  function normalizePosition(position: GeolocationPosition | GpsPositionLike | null | undefined, now = Date.now()): NormalizedGpsPosition | null {
    const coords = position?.coords || {};
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      return null;
    }

    const rawTimestampMs = getFiniteNumber(position.timestamp);
    const timestampSkewMs = rawTimestampMs === null ? Infinity : Math.abs(now - rawTimestampMs);
    const rawTimestampLooksPlausible = rawTimestampMs !== null
      && rawTimestampMs > MIN_VALID_WALL_CLOCK_MS
      && timestampSkewMs < GPS_TIMESTAMP_MAX_SKEW_MS;
    const timestampMs = rawTimestampLooksPlausible ? rawTimestampMs : now;
    const speedMs = Number.isFinite(Number(coords.speed)) && Number(coords.speed) >= 0
      ? Number(coords.speed)
      : null;
    const gpsHeading = normalizeHeading(coords.heading);
    const derivedHeading = gpsHeading === null
      && (speedMs ?? 0) >= MIN_DERIVED_HEADING_SPEED_MS
      ? deriveHeadingFromPositions(previousNormalized, { latitude, longitude, timestampMs })
      : null;
    const nextHeading = gpsHeading ?? derivedHeading;
    if (nextHeading !== null) {
      lastHeadingDeg = nextHeading;
      lastHeadingAtMs = now;
    }
    const headingFresh = lastHeadingDeg !== null && now - lastHeadingAtMs <= 5000;
    return {
      sampleSequence: nextSampleSequence++,
      latitude,
      longitude,
      accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
      altitudeM: Number.isFinite(Number(coords.altitude)) ? Number(coords.altitude) : null,
      altitudeAccuracyM: Number.isFinite(Number(coords.altitudeAccuracy)) ? Number(coords.altitudeAccuracy) : null,
      speedMs,
      heading: headingFresh ? lastHeadingDeg : null,
      headingDeg: headingFresh ? lastHeadingDeg : null,
      fixTimestampMs: rawTimestampMs,
      timestampMs,
      receivedAtMs: now,
      lastCallbackAtMs: now,
      freshnessTimestampMs: now,
      timestampSkewMs: Number.isFinite(timestampSkewMs) ? timestampSkewMs : null,
      timestampSource: rawTimestampLooksPlausible ? "browser" : "received",
      stale: false,
    };
  }

  function emit() {
    const detail = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(detail);
      } catch {
        // Subscriber isolation.
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vatioboard:gps-status", { detail }));
    }
  }

  function persistAndEmit(nextSnapshot: Partial<GpsSnapshot>) {
    snapshot = {
      ...snapshot,
      ...nextSnapshot,
    };
    saveSnapshot(snapshot);
    emit();
  }

  function handlePosition(position) {
    const now = Date.now();
    const cloned = clonePosition(position);
    const normalized = normalizePosition(cloned, now);
    if (normalized) previousNormalized = normalized;
    persistAndEmit({
      status: "active",
      lastPosition: cloned as GeolocationPosition,
      normalized,
      lastError: null,
      lastCallbackAtMs: now,
    });
    if (normalized && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vatioboard:gps-position", {
        detail: normalized,
      }));
    }
    if (normalized) {
      for (const listener of positionListeners) {
        try {
          listener(normalized);
        } catch {
          // Position listener isolation.
        }
      }
    }
    debugGps("position", {
      rawTimestampMs: getFiniteNumber(position?.timestamp),
      receivedAtMs: now,
      timestampMs: normalized?.timestampMs ?? null,
      timestampSkewMs: normalized?.timestampSkewMs ?? null,
      timestampSource: normalized?.timestampSource ?? null,
      stale: normalized?.stale ?? null,
      heading: normalized?.headingDeg ?? null,
      speed: normalized?.speedMs ?? null,
      consumers: getConsumers(),
      nativeWatchActive: nativeWatchId !== null,
    });

    for (const subscriber of subscribers.values()) {
      try {
        subscriber.success(position);
      } catch {
        // Match native geolocation behavior: one callback should not break others.
      }
    }
  }

  function handleError(error) {
    const lastError = {
      code: error?.code ?? 0,
      message: error?.message || "Geolocation failed.",
      receivedAtMs: Date.now(),
    };
    persistAndEmit({
      status: snapshot.normalized ? "degraded" : "error",
      lastError,
    });
    debugGps("error", {
      ...lastError,
      consumers: getConsumers(),
      nativeWatchActive: nativeWatchId !== null,
      hasLastPosition: Boolean(snapshot.normalized),
    });

    for (const subscriber of subscribers.values()) {
      try {
        subscriber.error?.(error);
      } catch {
        // Subscriber isolation.
      }
    }
  }

  function ensureNativeWatch() {
    if (nativeWatchId !== null || !nativeWatchPosition) return;
    persistAndEmit({ status: "starting" });
    nativeWatchHighAccuracy = hasHighAccuracyConsumer();
    nativeWatchId = nativeWatchPosition(handlePosition, handleError, {
      enableHighAccuracy: nativeWatchHighAccuracy,
      maximumAge: 0,
      timeout: nativeWatchHighAccuracy ? HIGH_ACCURACY_WATCH_TIMEOUT_MS : DEFAULT_WATCH_TIMEOUT_MS,
    });
    debugGps("watch-start", {
      enableHighAccuracy: nativeWatchHighAccuracy,
      timeout: nativeWatchHighAccuracy ? HIGH_ACCURACY_WATCH_TIMEOUT_MS : DEFAULT_WATCH_TIMEOUT_MS,
      consumers: getConsumers(),
      nativeWatchActive: true,
    });
  }

  function stopNativeWatchIfIdle() {
    if (subscribers.size > 0 || consumers.size > 0 || nativeWatchId === null || !nativeClearWatch) return;
    nativeClearWatch(nativeWatchId);
    nativeWatchId = null;
    nativeWatchHighAccuracy = false;
    persistAndEmit({ status: "idle" });
    debugGps("watch-stop", {
      consumers: getConsumers(),
      nativeWatchActive: false,
    });
  }

  function restartNativeWatchIfAccuracyChanged() {
    if (nativeWatchId === null || !nativeClearWatch || !nativeWatchPosition) return;
    const nextHighAccuracy = hasHighAccuracyConsumer();
    if (nextHighAccuracy === nativeWatchHighAccuracy) return;
    nativeClearWatch(nativeWatchId);
    nativeWatchId = null;
    ensureNativeWatch();
  }

  function getLastCallbackAtMs() {
    const callbackAtMs = getFiniteNumber(snapshot.lastCallbackAtMs);
    if (callbackAtMs !== null) return callbackAtMs;
    const receivedAtMs = getFiniteNumber(snapshot.normalized?.receivedAtMs);
    if (receivedAtMs !== null) return receivedAtMs;
    return getFiniteNumber(snapshot.normalized?.timestampMs);
  }

  function getDynamicNormalized(now = Date.now()) {
    if (!snapshot.normalized) return null;
    const lastCallbackAtMs = getLastCallbackAtMs();
    const freshnessTimestampMs = lastCallbackAtMs
      ?? getFiniteNumber(snapshot.normalized.freshnessTimestampMs)
      ?? getFiniteNumber(snapshot.normalized.receivedAtMs)
      ?? getFiniteNumber(snapshot.normalized.timestampMs);
    const stale = freshnessTimestampMs === null || now - freshnessTimestampMs > POSITION_STALE_MS;
    return {
      ...snapshot.normalized,
      lastCallbackAtMs,
      freshnessTimestampMs,
      stale,
    };
  }

  function watchPosition(success: PositionCallback, error?: PositionErrorCallback | null, options: PositionOptions = {}) {
    if (typeof success !== "function") {
      throw new TypeError("watchPosition success callback is required.");
    }

    if (!nativeWatchPosition) {
      const unsupportedError = {
        code: 2,
        message: "Geolocation is unavailable.",
      };
      if (typeof error === "function") {
        setTimeout(() => error(unsupportedError as GeolocationPositionError), 0);
      }
      return nextId++;
    }

    const id = nextId++;
    subscribers.set(id, {
      success,
      error,
      options,
    });
    if (nativeWatchId === null) ensureNativeWatch();
    else restartNativeWatchIfAccuracyChanged();
    return id;
  }

  function clearWatch(id: number) {
    subscribers.delete(id);
    stopNativeWatchIfIdle();
    restartNativeWatchIfAccuracyChanged();
  }

  function startConsumer(consumerId: string, options: GpsConsumerOptions = {}) {
    if (!consumerId) return () => {};
    consumers.set(String(consumerId), {
      options: {
        enableHighAccuracy: options.enableHighAccuracy !== false,
        reason: options.reason || "",
      },
    });
    if (nativeWatchId === null) ensureNativeWatch();
    else restartNativeWatchIfAccuracyChanged();
    emit();
    return () => stopConsumer(consumerId);
  }

  function stopConsumer(consumerId: string) {
    consumers.delete(String(consumerId));
    stopNativeWatchIfIdle();
    restartNativeWatchIfAccuracyChanged();
    emit();
  }

  function requestHighAccuracy(reason = "high-accuracy") {
    return startConsumer(`high-accuracy:${reason}`, { enableHighAccuracy: true, reason });
  }

  function releaseHighAccuracy(reason = "high-accuracy") {
    stopConsumer(`high-accuracy:${reason}`);
  }

  function subscribe(listener: (snapshot: GpsSnapshot) => void) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(getSnapshot());
    return () => {
      listeners.delete(listener);
    };
  }

  function subscribePositions(listener: (position: NormalizedGpsPosition) => void) {
    if (typeof listener !== "function") return () => {};
    positionListeners.add(listener);
    return () => positionListeners.delete(listener);
  }

  function getSnapshot() {
    const now = Date.now();
    const normalized = getDynamicNormalized(now);
    return {
      ...snapshot,
      normalized,
      subscriberCount: subscribers.size,
      nativeWatchActive: nativeWatchId !== null,
      consumers: getConsumers(),
    };
  }

  function getCurrentPosition() {
    return getSnapshot().normalized;
  }

  function destroy() {
    subscribers.clear();
    consumers.clear();
    if (nativeWatchId !== null && nativeClearWatch) {
      nativeClearWatch(nativeWatchId);
    }
    nativeWatchId = null;
    nativeWatchHighAccuracy = false;
    listeners.clear();
    positionListeners.clear();
    persistAndEmit({ status: geolocation ? "idle" : "unsupported" });
    if (geolocation?.__vatioboardGpsServiceShim && geolocation.watchPosition === watchPosition) {
      try {
        geolocation.watchPosition = originalWatchPosition;
        geolocation.clearWatch = originalClearWatch;
        delete geolocation.__vatioboardGpsServiceShim;
      } catch {
        // If the browser refuses restoration, the app can still continue until page unload.
      }
    }
  }

  function installGlobalShim() {
    if (!geolocation || geolocation.__vatioboardGpsServiceShim) return false;

    try {
      geolocation.watchPosition = watchPosition;
      geolocation.clearWatch = clearWatch;
      Object.defineProperty(geolocation, "__vatioboardGpsServiceShim", {
        value: true,
        configurable: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    watchPosition,
    clearWatch,
    startConsumer,
    stopConsumer,
    subscribe,
    subscribePositions,
    getSnapshot,
    getCurrentPosition,
    requestHighAccuracy,
    releaseHighAccuracy,
    installGlobalShim,
    destroy,
  };
}
