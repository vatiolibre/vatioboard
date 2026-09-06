import type {
  DrivingTelemetrySample,
  DrivingTelemetryService,
  DrivingTelemetrySnapshot,
  DrivingTelemetryStatus,
  GpsService,
  GpsSnapshot,
  NormalizedGpsPosition,
} from "../../types/services";
import {
  createDrivingTelemetryReducerState,
  reduceDrivingTelemetryPosition,
  type DrivingTelemetryReducerState,
} from "./driving-telemetry-reducer.js";

interface DrivingTelemetryServiceOptions {
  gpsService: GpsService;
  now?: () => number;
  createTripId?: () => string;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

function defaultTripId() {
  return globalThis.crypto?.randomUUID?.() || `trip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mapGpsStatus(snapshot: GpsSnapshot, started: boolean): DrivingTelemetryStatus {
  if (snapshot.normalized?.stale) return "stale";
  if (snapshot.status === "error" || snapshot.status === "unsupported") return "error";
  if (snapshot.status === "degraded") return "degraded";
  if (snapshot.status === "active") return "active";
  if (started || snapshot.status === "starting") return "starting";
  return "idle";
}

export function createDrivingTelemetryService({
  gpsService,
  now = () => Date.now(),
  createTripId = defaultTripId,
  setIntervalFn = globalThis.setInterval.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval.bind(globalThis),
}: DrivingTelemetryServiceOptions): DrivingTelemetryService {
  const listeners = new Set<(snapshot: DrivingTelemetrySnapshot) => void>();
  const sampleListeners = new Set<(sample: DrivingTelemetrySample) => void>();
  let reducerState: DrivingTelemetryReducerState = createDrivingTelemetryReducerState(createTripId());
  let status: DrivingTelemetryStatus = "idle";
  let started = false;
  let destroyed = false;
  let releaseGpsConsumer: (() => void) | null = null;
  let unsubscribePositions: (() => void) | null = null;
  let unsubscribeGps: (() => void) | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;

  function getSnapshot(): DrivingTelemetrySnapshot {
    const elapsedMs = reducerState.startedAtMs === null
      ? 0
      : Math.max(0, now() - reducerState.startedAtMs);
    return {
      status,
      tripId: reducerState.tripId,
      startedAtMs: reducerState.startedAtMs,
      elapsedMs,
      currentSpeedMs: reducerState.currentSpeedMs,
      maxSpeedMs: reducerState.maxSpeedMs,
      averageSpeedMs: elapsedMs > 0 ? reducerState.totalDistanceM / (elapsedMs / 1000) : 0,
      totalDistanceM: reducerState.totalDistanceM,
      currentAltitudeM: reducerState.currentAltitudeM,
      minAltitudeM: reducerState.minAltitudeM,
      maxAltitudeM: reducerState.maxAltitudeM,
      headingDeg: reducerState.headingDeg,
      accuracyM: reducerState.accuracyM,
      lastPosition: reducerState.lastPosition,
      sampleCount: reducerState.sampleCount,
      lastGpsSampleSequence: reducerState.lastGpsSampleSequence,
      lastFixAtMs: reducerState.lastFixAtMs,
    };
  }

  function emit() {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* Listener isolation. */ }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vatioboard:driving-telemetry", { detail: snapshot }));
    }
  }

  function ensureHeartbeat() {
    if (heartbeatId !== null) return;
    heartbeatId = setIntervalFn(() => {
      if (reducerState.startedAtMs === null) return;
      status = mapGpsStatus(gpsService.getSnapshot(), started);
      emit();
    }, 1000);
  }

  function handleGpsSnapshot(snapshot: GpsSnapshot) {
    const nextStatus = mapGpsStatus(snapshot, started);
    if (nextStatus === status) return;
    status = nextStatus;
    emit();
  }

  function handlePosition(position: NormalizedGpsPosition) {
    const reduction = reduceDrivingTelemetryPosition(reducerState, position);
    if (!reduction.sample) return;
    reducerState = reduction.state;
    status = position.stale ? "stale" : "active";
    ensureHeartbeat();
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* Listener isolation. */ }
    }
    for (const listener of sampleListeners) {
      try { listener(reduction.sample); } catch { /* Listener isolation. */ }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vatioboard:driving-telemetry", { detail: snapshot }));
    }
  }

  function start(options: { reason?: string } = {}) {
    if (destroyed || started) return getSnapshot();
    started = true;
    status = "starting";
    unsubscribePositions = gpsService.subscribePositions(handlePosition);
    unsubscribeGps = gpsService.subscribe(handleGpsSnapshot);
    releaseGpsConsumer = gpsService.startConsumer("driving-telemetry", {
      enableHighAccuracy: true,
      reason: options.reason || "driving-telemetry",
    });
    emit();
    return getSnapshot();
  }

  function resetTrip() {
    reducerState = createDrivingTelemetryReducerState(createTripId());
    emit();
    return getSnapshot();
  }

  function subscribe(listener: (snapshot: DrivingTelemetrySnapshot) => void) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  }

  function subscribeSamples(listener: (sample: DrivingTelemetrySample) => void) {
    if (typeof listener !== "function") return () => {};
    sampleListeners.add(listener);
    return () => sampleListeners.delete(listener);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    unsubscribePositions?.();
    unsubscribeGps?.();
    releaseGpsConsumer?.();
    unsubscribePositions = null;
    unsubscribeGps = null;
    releaseGpsConsumer = null;
    if (heartbeatId !== null) clearIntervalFn(heartbeatId);
    heartbeatId = null;
    listeners.clear();
    sampleListeners.clear();
    status = "idle";
  }

  return { start, resetTrip, getSnapshot, subscribe, subscribeSamples, destroy };
}
