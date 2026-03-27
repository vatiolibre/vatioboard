import { loadJson, removeStoredValue, saveJson } from "../shared/storage.js";

export const REPLAY_ACTIVE_KEY = "vatio_speed_replay_active_v1";
export const REPLAY_LIBRARY_KEY = "vatio_speed_replay_library_v1";
export const REPLAY_LAST_KEY = "vatio_speed_replay_last_v1";
export const REPLAY_SCHEMA_VERSION = 1;
export const MAX_REPLAY_SAMPLES = 1200;
export const MAX_STORED_REPLAYS = 12;

export function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizeSpeedUnit(unit, fallback = "kmh") {
  return unit === "mph" ? "mph" : (unit === "kmh" ? "kmh" : fallback);
}

function normalizeDistanceUnit(unit, fallback = "m") {
  return unit === "ft" ? "ft" : (unit === "m" ? "m" : fallback);
}

function normalizeRecordingState(state, fallback = "recording") {
  if (state === "paused") return "paused";
  if (state === "stopped") return "stopped";
  if (state === "recording") return "recording";
  return fallback;
}

function normalizeReplayId(value, fallbackTimestamp = Date.now()) {
  if (typeof value === "string" && value) return value;
  return `replay-${Math.max(0, Math.round(fallbackTimestamp))}`;
}

export function createReplaySession(options = {}) {
  const startedAtMs = isFiniteNumber(options.startedAtMs) ? options.startedAtMs : null;
  const fallbackTimestamp = startedAtMs ?? Date.now();

  return {
    id: normalizeReplayId(options.id, fallbackTimestamp),
    version: REPLAY_SCHEMA_VERSION,
    source: "speed",
    unit: normalizeSpeedUnit(options.unit),
    distanceUnit: normalizeDistanceUnit(options.distanceUnit),
    recordingState: normalizeRecordingState(options.recordingState),
    startedAtMs,
    updatedAtMs: startedAtMs,
    endedAtMs: startedAtMs,
    maxSpeedMs: 0,
    totalDistanceM: 0,
    minAltitudeM: null,
    maxAltitudeM: null,
    samples: [],
  };
}

export function normalizeReplaySample(sample) {
  if (!sample || typeof sample !== "object") return null;
  if (!isFiniteNumber(sample.timestampMs)) return null;
  if (!isFiniteNumber(sample.latitude) || !isFiniteNumber(sample.longitude)) return null;

  return {
    timestampMs: sample.timestampMs,
    latitude: sample.latitude,
    longitude: sample.longitude,
    speedMs: isFiniteNumber(sample.speedMs) && sample.speedMs >= 0 ? sample.speedMs : 0,
    altitudeM: isFiniteNumber(sample.altitudeM) ? sample.altitudeM : null,
    accuracyM: isFiniteNumber(sample.accuracyM) ? sample.accuracyM : null,
    headingDeg: isFiniteNumber(sample.headingDeg) ? sample.headingDeg : null,
    totalDistanceM: isFiniteNumber(sample.totalDistanceM) && sample.totalDistanceM >= 0
      ? sample.totalDistanceM
      : 0,
  };
}

function getReplaySortTimestamp(session) {
  if (!session) return 0;
  return session.endedAtMs ?? session.updatedAtMs ?? session.startedAtMs ?? 0;
}

export function limitReplaySamples(samples, maxSamples = MAX_REPLAY_SAMPLES) {
  if (!Array.isArray(samples)) return [];
  if (samples.length <= maxSamples) return samples.slice();
  if (maxSamples <= 1) return [samples[samples.length - 1]];

  const limited = [samples[0]];
  const usableSlots = maxSamples - 2;
  let previousIndex = 0;

  for (let index = 1; index <= usableSlots; index += 1) {
    let sampleIndex = Math.round((index * (samples.length - 1)) / (usableSlots + 1));
    if (sampleIndex <= previousIndex) {
      sampleIndex = previousIndex + 1;
    }
    if (sampleIndex >= samples.length - 1) {
      sampleIndex = samples.length - 2;
    }
    limited.push(samples[sampleIndex]);
    previousIndex = sampleIndex;
  }

  limited.push(samples[samples.length - 1]);
  return limited;
}

export function normalizeReplaySession(session) {
  if (!session || typeof session !== "object") return null;

  const samples = Array.isArray(session.samples)
    ? session.samples
      .map(normalizeReplaySample)
      .filter(Boolean)
      .sort((left, right) => left.timestampMs - right.timestampMs)
    : [];
  const dedupedSamples = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = dedupedSamples[dedupedSamples.length - 1];

    if (previous && previous.timestampMs === sample.timestampMs) {
      dedupedSamples[dedupedSamples.length - 1] = sample;
      continue;
    }

    dedupedSamples.push(sample);
  }

  const firstSample = dedupedSamples[0] ?? null;
  const lastSample = dedupedSamples[dedupedSamples.length - 1] ?? null;
  const altitudeValues = dedupedSamples
    .map((sample) => sample.altitudeM)
    .filter(isFiniteNumber);
  const maxSpeedMs = dedupedSamples.reduce(
    (maximum, sample) => Math.max(maximum, sample.speedMs),
    0,
  );

  return {
    id: normalizeReplayId(
      session.id,
      session.startedAtMs ?? firstSample?.timestampMs ?? Date.now(),
    ),
    version: REPLAY_SCHEMA_VERSION,
    source: "speed",
    unit: normalizeSpeedUnit(session.unit),
    distanceUnit: normalizeDistanceUnit(session.distanceUnit),
    recordingState: normalizeRecordingState(session.recordingState),
    startedAtMs: isFiniteNumber(session.startedAtMs)
      ? session.startedAtMs
      : (firstSample ? firstSample.timestampMs : null),
    updatedAtMs: isFiniteNumber(session.updatedAtMs)
      ? session.updatedAtMs
      : (lastSample ? lastSample.timestampMs : null),
    endedAtMs: isFiniteNumber(session.endedAtMs)
      ? session.endedAtMs
      : (lastSample ? lastSample.timestampMs : null),
    maxSpeedMs: isFiniteNumber(session.maxSpeedMs) ? session.maxSpeedMs : maxSpeedMs,
    totalDistanceM: isFiniteNumber(session.totalDistanceM)
      ? Math.max(0, session.totalDistanceM)
      : (lastSample ? lastSample.totalDistanceM : 0),
    minAltitudeM: isFiniteNumber(session.minAltitudeM)
      ? session.minAltitudeM
      : (altitudeValues.length ? Math.min(...altitudeValues) : null),
    maxAltitudeM: isFiniteNumber(session.maxAltitudeM)
      ? session.maxAltitudeM
      : (altitudeValues.length ? Math.max(...altitudeValues) : null),
    samples: limitReplaySamples(dedupedSamples),
  };
}

export function hasReplaySamples(session, minSamples = 1) {
  return Boolean(session && Array.isArray(session.samples) && session.samples.length >= minSamples);
}

export function appendReplaySample(session, sample, options = {}) {
  const normalizedSample = normalizeReplaySample(sample);
  if (!normalizedSample) {
    return session;
  }

  const currentSession = normalizeReplaySession(session) || createReplaySession(options);
  const nextSamples = currentSession.samples.slice();
  const lastSample = nextSamples[nextSamples.length - 1] ?? null;

  if (lastSample && normalizedSample.timestampMs < lastSample.timestampMs) {
    return currentSession;
  }

  if (lastSample && normalizedSample.timestampMs === lastSample.timestampMs) {
    nextSamples[nextSamples.length - 1] = normalizedSample;
  } else {
    nextSamples.push(normalizedSample);
  }

  return normalizeReplaySession({
    ...currentSession,
    unit: normalizeSpeedUnit(options.unit, currentSession.unit),
    distanceUnit: normalizeDistanceUnit(options.distanceUnit, currentSession.distanceUnit),
    recordingState: normalizeRecordingState(
      options.recordingState,
      currentSession.recordingState,
    ),
    startedAtMs: currentSession.startedAtMs ?? normalizedSample.timestampMs,
    updatedAtMs: normalizedSample.timestampMs,
    endedAtMs: normalizedSample.timestampMs,
    maxSpeedMs: Math.max(currentSession.maxSpeedMs, normalizedSample.speedMs),
    totalDistanceM: normalizedSample.totalDistanceM,
    minAltitudeM: isFiniteNumber(normalizedSample.altitudeM)
      ? (isFiniteNumber(currentSession.minAltitudeM)
        ? Math.min(currentSession.minAltitudeM, normalizedSample.altitudeM)
        : normalizedSample.altitudeM)
      : currentSession.minAltitudeM,
    maxAltitudeM: isFiniteNumber(normalizedSample.altitudeM)
      ? (isFiniteNumber(currentSession.maxAltitudeM)
        ? Math.max(currentSession.maxAltitudeM, normalizedSample.altitudeM)
        : normalizedSample.altitudeM)
      : currentSession.maxAltitudeM,
    samples: limitReplaySamples(nextSamples, options.maxSamples ?? MAX_REPLAY_SAMPLES),
  });
}

export function finalizeReplaySession(session, endedAtMs = null) {
  const normalizedSession = normalizeReplaySession(session);
  if (!normalizedSession) return null;

  return {
    ...normalizedSession,
    recordingState: "stopped",
    updatedAtMs: isFiniteNumber(endedAtMs)
      ? endedAtMs
      : (normalizedSession.updatedAtMs ?? normalizedSession.endedAtMs),
    endedAtMs: isFiniteNumber(endedAtMs)
      ? endedAtMs
      : normalizedSession.endedAtMs,
  };
}

export function loadActiveReplaySession() {
  return normalizeReplaySession(loadJson(REPLAY_ACTIVE_KEY, null));
}

export function saveActiveReplaySession(session) {
  const normalizedSession = normalizeReplaySession(session) || createReplaySession();
  saveJson(REPLAY_ACTIVE_KEY, normalizedSession);
}

export function clearActiveReplaySession() {
  removeStoredValue(REPLAY_ACTIVE_KEY);
}

export function loadLastReplaySession() {
  return normalizeReplaySession(loadJson(REPLAY_LAST_KEY, null));
}

export function saveLastReplaySession(session) {
  const normalizedSession = normalizeReplaySession(session);
  if (!normalizedSession) return;
  saveJson(REPLAY_LAST_KEY, normalizedSession);
}

export function loadReplayLibrary() {
  const rawLibrary = loadJson(REPLAY_LIBRARY_KEY, []);
  const normalizedLibrary = Array.isArray(rawLibrary)
    ? rawLibrary.map(normalizeReplaySession).filter(Boolean)
    : [];
  const legacySession = loadLastReplaySession();

  if (legacySession && !normalizedLibrary.some((session) => session.id === legacySession.id)) {
    normalizedLibrary.unshift(legacySession);
  }

  normalizedLibrary.sort((left, right) => getReplaySortTimestamp(right) - getReplaySortTimestamp(left));
  return normalizedLibrary.slice(0, MAX_STORED_REPLAYS);
}

export function saveReplayLibrary(recordings) {
  const normalizedRecordings = Array.isArray(recordings)
    ? recordings
      .map(normalizeReplaySession)
      .filter(Boolean)
      .sort((left, right) => getReplaySortTimestamp(right) - getReplaySortTimestamp(left))
      .slice(0, MAX_STORED_REPLAYS)
    : [];
  saveJson(REPLAY_LIBRARY_KEY, normalizedRecordings);
}

export function archiveReplaySession(
  session,
  options = {},
) {
  const normalizedSession = finalizeReplaySession(session, options.endedAtMs ?? null);
  if (!hasReplaySamples(normalizedSession, options.minSamples ?? 2)) {
    return loadReplayLibrary();
  }

  const nextRecordings = loadReplayLibrary().filter((entry) => entry.id !== normalizedSession.id);
  nextRecordings.unshift(normalizedSession);
  saveReplayLibrary(nextRecordings.slice(0, options.maxRecordings ?? MAX_STORED_REPLAYS));
  return loadReplayLibrary();
}

export function removeReplayRecording(recordingId) {
  if (typeof recordingId !== "string" || !recordingId) {
    return loadReplayLibrary();
  }

  const legacySession = loadLastReplaySession();
  if (legacySession?.id === recordingId) {
    removeStoredValue(REPLAY_LAST_KEY);
  }

  const nextRecordings = loadReplayLibrary().filter((entry) => entry.id !== recordingId);
  saveReplayLibrary(nextRecordings);
  return loadReplayLibrary();
}

export function loadReplayRecords() {
  const activeSession = loadActiveReplaySession();
  const recordings = [];

  if (hasReplaySamples(activeSession, 1)) {
    recordings.push({
      id: activeSession.id,
      source: "active",
      session: activeSession,
    });
  }

  for (const session of loadReplayLibrary()) {
    recordings.push({
      id: session.id,
      source: "library",
      session,
    });
  }

  return recordings;
}

export function loadReplaySelection(selectedId = null) {
  const records = loadReplayRecords();

  if (selectedId) {
    const selectedRecord = records.find((record) => record.id === selectedId);
    if (selectedRecord) {
      return {
        source: selectedRecord.source,
        session: selectedRecord.session,
        records,
      };
    }
  }

  const preferredRecord = records.find((record) => record.source === "active" && hasReplaySamples(record.session, 2))
    ?? records.find((record) => record.source === "library")
    ?? records[0]
    ?? null;

  return {
    source: preferredRecord?.source ?? null,
    session: preferredRecord?.session ?? null,
    records,
  };
}
