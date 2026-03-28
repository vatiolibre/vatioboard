import { createIndexedJsonKeyValueStore } from "../shared/indexed-storage.js";
import { loadJson, removeStoredValue, saveJson } from "../shared/storage.js";

export const REPLAY_ACTIVE_KEY = "vatio_speed_replay_active_v1";
export const REPLAY_LIBRARY_KEY = "vatio_speed_replay_library_v1";
export const REPLAY_LAST_KEY = "vatio_speed_replay_last_v1";
export const REPLAY_SCHEMA_VERSION = 1;
export const MAX_REPLAY_SAMPLES = 1200;
export const MAX_STORED_REPLAYS = 12;
export const REPLAY_PERSIST_CHUNK_SIZE = 200;

const REPLAY_DB_NAME = "vatio-replay-storage";
const REPLAY_DB_VERSION = 1;
const REPLAY_DB_STORE = "replayRecords";
const REPLAY_STORAGE_KEYS = [
  REPLAY_ACTIVE_KEY,
  REPLAY_LAST_KEY,
  REPLAY_LIBRARY_KEY,
];
const REPLAY_CHUNK_KEY_PREFIX = "replayChunk:";

const replayStore = createIndexedJsonKeyValueStore({
  dbName: REPLAY_DB_NAME,
  dbVersion: REPLAY_DB_VERSION,
  storeName: REPLAY_DB_STORE,
});

let replayMigrationPromise = null;

export function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizePositiveInteger(value, fallback = 0) {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function getReplayChunkKey(sessionId, chunkIndex) {
  return `${REPLAY_CHUNK_KEY_PREFIX}${sessionId}:${String(chunkIndex)}`;
}

async function migrateLegacyReplayStorage() {
  if (!replayStore.hasSupport()) return;

  if (!replayMigrationPromise) {
    replayMigrationPromise = (async () => {
      const database = await replayStore.openDatabase();
      if (!database) return;

      for (const storageKey of REPLAY_STORAGE_KEYS) {
        const existingValue = await replayStore.getValue(storageKey);
        if (existingValue !== undefined) continue;

        const legacyValue = loadJson(storageKey, undefined);
        if (legacyValue === undefined) continue;

        const stored = await replayStore.setValue(storageKey, legacyValue);
        if (stored) {
          removeStoredValue(storageKey);
        }
      }
    })();
  }

  return replayMigrationPromise;
}

async function loadReplayValue(key, fallback) {
  await migrateLegacyReplayStorage();

  const indexedValue = await replayStore.getValue(key);
  if (indexedValue !== undefined) return indexedValue;

  return loadJson(key, fallback);
}

async function saveReplayValue(key, value) {
  await migrateLegacyReplayStorage();

  const stored = await replayStore.setValue(key, value);
  if (stored) {
    removeStoredValue(key);
    return;
  }

  saveJson(key, value);
}

async function removeReplayValue(key) {
  await migrateLegacyReplayStorage();
  await replayStore.deleteValue(key);
  removeStoredValue(key);
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

function sortAndDedupeReplaySamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return [];

  const sortedSamples = samples
    .map(normalizeReplaySample)
    .filter(Boolean)
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const dedupedSamples = [];

  for (let index = 0; index < sortedSamples.length; index += 1) {
    const sample = sortedSamples[index];
    const previous = dedupedSamples[dedupedSamples.length - 1];

    if (previous && previous.timestampMs === sample.timestampMs) {
      dedupedSamples[dedupedSamples.length - 1] = sample;
      continue;
    }

    dedupedSamples.push(sample);
  }

  return dedupedSamples;
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
    sampleCount: 0,
    chunkCount: 0,
    persistedSampleCount: 0,
    lastSample: null,
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
      : null,
  };
}

function haversineDistanceM(left, right) {
  if (!left || !right) return 0;

  const earthRadiusM = 6371000;
  const lat1 = (left.latitude * Math.PI) / 180;
  const lat2 = (right.latitude * Math.PI) / 180;
  const deltaLat = ((right.latitude - left.latitude) * Math.PI) / 180;
  const deltaLon = ((right.longitude - left.longitude) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const calc = (
    sinLat * sinLat
    + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  );

  return earthRadiusM * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

function normalizeReplayDistances(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return [];

  const normalized = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = normalized[index - 1] ?? null;
    const fallbackDistanceM = previous
      ? previous.totalDistanceM + haversineDistanceM(previous, sample)
      : 0;
    const hasStoredDistance = isFiniteNumber(sample.totalDistanceM) && sample.totalDistanceM >= 0;
    const storedDistanceM = hasStoredDistance ? sample.totalDistanceM : null;
    const totalDistanceM = previous
      ? Math.max(
        previous.totalDistanceM,
        storedDistanceM !== null && storedDistanceM >= previous.totalDistanceM
          ? storedDistanceM
          : fallbackDistanceM,
      )
      : Math.max(0, storedDistanceM ?? 0);

    normalized.push({
      ...sample,
      totalDistanceM,
    });
  }

  return normalized;
}

function normalizeReplaySamplesArray(samples) {
  return normalizeReplayDistances(sortAndDedupeReplaySamples(samples));
}

function getReplaySortTimestamp(session) {
  if (!session) return 0;
  return session.endedAtMs ?? session.updatedAtMs ?? session.startedAtMs ?? 0;
}

function stripReplaySessionSamples(session) {
  const normalizedSession = normalizeReplaySession(session);
  if (!normalizedSession) return null;

  return normalizeReplaySession({
    ...normalizedSession,
    samples: [],
  });
}

function needsChunkMigration(session) {
  return Boolean(
    replayStore.hasSupport()
    && session
    && session.chunkCount === 0
    && session.sampleCount > 0
    && session.persistedSampleCount === session.sampleCount
    && Array.isArray(session.samples)
    && session.samples.length === session.sampleCount,
  );
}

function createEmbeddedReplaySession(session, samples) {
  const normalizedSamples = normalizeReplaySamplesArray(samples);
  return normalizeReplaySession({
    ...session,
    sampleCount: normalizedSamples.length,
    chunkCount: 0,
    persistedSampleCount: normalizedSamples.length,
    lastSample: normalizedSamples[normalizedSamples.length - 1] ?? session?.lastSample ?? null,
    samples: normalizedSamples,
  });
}

function getReplaySamplesToPersist(session) {
  if (!session || !Array.isArray(session.samples) || session.samples.length === 0) return [];

  const embeddedFullSession = session.chunkCount === 0
    && session.persistedSampleCount === session.sampleCount
    && session.samples.length === session.sampleCount
    && session.sampleCount > 0;

  if (embeddedFullSession) {
    return session.samples.slice();
  }

  const pendingCount = Math.max(0, session.sampleCount - session.persistedSampleCount);
  if (pendingCount === 0) return [];

  return session.samples.slice(-pendingCount);
}

async function saveReplaySampleChunks(sessionId, samples, startChunkIndex = 0) {
  let chunkIndex = startChunkIndex;

  for (let index = 0; index < samples.length; index += REPLAY_PERSIST_CHUNK_SIZE) {
    const chunk = samples.slice(index, index + REPLAY_PERSIST_CHUNK_SIZE);
    const stored = await replayStore.setValue(getReplayChunkKey(sessionId, chunkIndex), chunk);
    if (!stored) return chunkIndex - startChunkIndex;
    chunkIndex += 1;
  }

  return chunkIndex - startChunkIndex;
}

async function loadReplaySampleChunks(sessionId, chunkCount) {
  const samples = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunk = await replayStore.getValue(getReplayChunkKey(sessionId, chunkIndex));
    if (!Array.isArray(chunk) || chunk.length === 0) continue;
    samples.push(...chunk);
  }

  return normalizeReplaySamplesArray(samples);
}

async function deleteReplaySampleChunks(sessionId, chunkCount) {
  if (!replayStore.hasSupport()) return;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    await replayStore.deleteValue(getReplayChunkKey(sessionId, chunkIndex));
  }
}

async function persistReplaySessionData(session) {
  const normalizedSession = normalizeReplaySession(session) || createReplaySession();

  if (!replayStore.hasSupport()) {
    return createEmbeddedReplaySession(normalizedSession, normalizedSession.samples);
  }

  const samplesToPersist = getReplaySamplesToPersist(normalizedSession);
  let chunkCount = normalizedSession.chunkCount;

  if (samplesToPersist.length > 0) {
    chunkCount += await saveReplaySampleChunks(
      normalizedSession.id,
      samplesToPersist,
      normalizedSession.chunkCount,
    );
  }

  return normalizeReplaySession({
    ...normalizedSession,
    samples: [],
    chunkCount,
    persistedSampleCount: normalizedSession.sampleCount,
    lastSample: normalizedSession.lastSample,
  });
}

async function hydrateReplaySessionSamples(session) {
  const normalizedSession = normalizeReplaySession(session);
  if (!normalizedSession) return null;

  if (!replayStore.hasSupport()) {
    return createEmbeddedReplaySession(normalizedSession, normalizedSession.samples);
  }

  const chunkSamples = await loadReplaySampleChunks(
    normalizedSession.id,
    normalizedSession.chunkCount,
  );
  const mergedSamples = normalizeReplaySamplesArray([
    ...chunkSamples,
    ...normalizedSession.samples,
  ]);

  return normalizeReplaySession({
    ...normalizedSession,
    samples: mergedSamples,
    sampleCount: Math.max(normalizedSession.sampleCount, mergedSamples.length),
    persistedSampleCount: Math.max(normalizedSession.sampleCount, mergedSamples.length),
    lastSample: mergedSamples[mergedSamples.length - 1] ?? normalizedSession.lastSample,
  });
}

async function ensureChunkedReplaySession(session, storageKey = null) {
  const normalizedSession = normalizeReplaySession(session);
  if (!normalizedSession || !needsChunkMigration(normalizedSession)) {
    return normalizedSession;
  }

  const persistedSession = await persistReplaySessionData(normalizedSession);
  if (storageKey) {
    await saveReplayValue(storageKey, stripReplaySessionSamples(persistedSession));
  }
  return persistedSession;
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

  const normalizedSamples = normalizeReplaySamplesArray(session.samples);
  const hasExplicitPersistedSampleCount = isFiniteNumber(session.persistedSampleCount);
  const hasExplicitChunkCount = isFiniteNumber(session.chunkCount);
  const inferredEmbeddedFullSession = normalizedSamples.length > 0
    && !hasExplicitPersistedSampleCount
    && !hasExplicitChunkCount;
  const sampleCount = isFiniteNumber(session.sampleCount)
    ? Math.max(normalizePositiveInteger(session.sampleCount), normalizedSamples.length)
    : normalizedSamples.length;
  const persistedSampleCount = inferredEmbeddedFullSession
    ? sampleCount
    : Math.min(
      sampleCount,
      normalizePositiveInteger(
        session.persistedSampleCount,
        Math.max(0, sampleCount - normalizedSamples.length),
      ),
    );
  const chunkCount = inferredEmbeddedFullSession
    ? 0
    : normalizePositiveInteger(session.chunkCount, 0);
  const lastSample = normalizedSamples[normalizedSamples.length - 1]
    ?? normalizeReplaySample(session.lastSample);
  const altitudeValues = normalizedSamples
    .map((sample) => sample.altitudeM)
    .filter(isFiniteNumber);
  const maxSpeedMs = normalizedSamples.reduce(
    (maximum, sample) => Math.max(maximum, sample.speedMs),
    isFiniteNumber(session.maxSpeedMs) ? session.maxSpeedMs : 0,
  );

  return {
    id: normalizeReplayId(
      session.id,
      session.startedAtMs ?? lastSample?.timestampMs ?? Date.now(),
    ),
    version: REPLAY_SCHEMA_VERSION,
    source: "speed",
    unit: normalizeSpeedUnit(session.unit),
    distanceUnit: normalizeDistanceUnit(session.distanceUnit),
    recordingState: normalizeRecordingState(session.recordingState),
    startedAtMs: isFiniteNumber(session.startedAtMs)
      ? session.startedAtMs
      : (normalizedSamples[0] ? normalizedSamples[0].timestampMs : null),
    updatedAtMs: isFiniteNumber(session.updatedAtMs)
      ? session.updatedAtMs
      : (lastSample ? lastSample.timestampMs : null),
    endedAtMs: isFiniteNumber(session.endedAtMs)
      ? session.endedAtMs
      : (lastSample ? lastSample.timestampMs : null),
    maxSpeedMs,
    totalDistanceM: Math.max(
      isFiniteNumber(session.totalDistanceM) ? Math.max(0, session.totalDistanceM) : 0,
      lastSample ? lastSample.totalDistanceM : 0,
    ),
    minAltitudeM: isFiniteNumber(session.minAltitudeM)
      ? session.minAltitudeM
      : (altitudeValues.length ? Math.min(...altitudeValues) : null),
    maxAltitudeM: isFiniteNumber(session.maxAltitudeM)
      ? session.maxAltitudeM
      : (altitudeValues.length ? Math.max(...altitudeValues) : null),
    sampleCount,
    chunkCount,
    persistedSampleCount,
    lastSample,
    samples: normalizedSamples,
  };
}

export function hasReplaySamples(session, minSamples = 1) {
  if (!session) return false;

  const sampleCount = isFiniteNumber(session.sampleCount)
    ? normalizePositiveInteger(session.sampleCount)
    : (Array.isArray(session.samples) ? session.samples.length : 0);

  return sampleCount >= minSamples;
}

export function appendReplaySample(session, sample, options = {}) {
  const normalizedSample = normalizeReplaySample(sample);
  if (!normalizedSample) {
    return session;
  }

  const currentSession = normalizeReplaySession(session) || createReplaySession(options);
  const bufferedSamples = Array.isArray(currentSession.samples)
    ? currentSession.samples.slice()
    : [];
  const lastSample = currentSession.lastSample;

  if (lastSample && normalizedSample.timestampMs < lastSample.timestampMs) {
    return currentSession;
  }

  if (lastSample && normalizedSample.timestampMs === lastSample.timestampMs) {
    if (bufferedSamples.length === 0) {
      return normalizeReplaySession({
        ...currentSession,
        unit: normalizeSpeedUnit(options.unit, currentSession.unit),
        distanceUnit: normalizeDistanceUnit(options.distanceUnit, currentSession.distanceUnit),
        recordingState: normalizeRecordingState(
          options.recordingState,
          currentSession.recordingState,
        ),
      });
    }

    bufferedSamples[bufferedSamples.length - 1] = normalizedSample;

    const dedupedBufferedSamples = normalizeReplaySamplesArray(bufferedSamples);
    return normalizeReplaySession({
      ...currentSession,
      unit: normalizeSpeedUnit(options.unit, currentSession.unit),
      distanceUnit: normalizeDistanceUnit(options.distanceUnit, currentSession.distanceUnit),
      recordingState: normalizeRecordingState(
        options.recordingState,
        currentSession.recordingState,
      ),
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
      lastSample: normalizedSample,
      samples: dedupedBufferedSamples,
    });
  }

  bufferedSamples.push(normalizedSample);

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
    sampleCount: currentSession.sampleCount + 1,
    lastSample: normalizedSample,
    samples: bufferedSamples,
  });
}

export function finalizeReplaySession(session, endedAtMs = null) {
  const normalizedSession = normalizeReplaySession(session);
  if (!normalizedSession) return null;

  return normalizeReplaySession({
    ...normalizedSession,
    recordingState: "stopped",
    updatedAtMs: isFiniteNumber(endedAtMs)
      ? endedAtMs
      : (normalizedSession.updatedAtMs ?? normalizedSession.endedAtMs),
    endedAtMs: isFiniteNumber(endedAtMs)
      ? endedAtMs
      : normalizedSession.endedAtMs,
  });
}

export async function loadActiveReplaySession(options = {}) {
  const session = await ensureChunkedReplaySession(
    await loadReplayValue(REPLAY_ACTIVE_KEY, null),
    REPLAY_ACTIVE_KEY,
  );
  if (!session) return null;

  if (!options.includeSamples || !replayStore.hasSupport()) {
    return replayStore.hasSupport() ? stripReplaySessionSamples(session) : session;
  }

  return hydrateReplaySessionSamples(session);
}

export async function saveActiveReplaySession(session) {
  const normalizedSession = normalizeReplaySession(session) || createReplaySession();

  if (!replayStore.hasSupport()) {
    const embeddedSession = createEmbeddedReplaySession(normalizedSession, normalizedSession.samples);
    await saveReplayValue(REPLAY_ACTIVE_KEY, embeddedSession);
    return embeddedSession;
  }

  const persistedSession = await persistReplaySessionData(normalizedSession);
  await saveReplayValue(REPLAY_ACTIVE_KEY, stripReplaySessionSamples(persistedSession));
  return persistedSession;
}

export async function clearActiveReplaySession() {
  await removeReplayValue(REPLAY_ACTIVE_KEY);
}

export async function loadLastReplaySession(options = {}) {
  const session = await ensureChunkedReplaySession(
    await loadReplayValue(REPLAY_LAST_KEY, null),
    REPLAY_LAST_KEY,
  );
  if (!session) return null;

  if (!options.includeSamples || !replayStore.hasSupport()) {
    return replayStore.hasSupport() ? stripReplaySessionSamples(session) : session;
  }

  return hydrateReplaySessionSamples(session);
}

export async function saveLastReplaySession(session) {
  const normalizedSession = normalizeReplaySession(session);
  if (!normalizedSession) return null;

  if (!replayStore.hasSupport()) {
    const embeddedSession = createEmbeddedReplaySession(normalizedSession, normalizedSession.samples);
    await saveReplayValue(REPLAY_LAST_KEY, embeddedSession);
    return embeddedSession;
  }

  const persistedSession = await persistReplaySessionData(normalizedSession);
  await saveReplayValue(REPLAY_LAST_KEY, stripReplaySessionSamples(persistedSession));
  return persistedSession;
}

export async function loadReplayLibrary() {
  const rawLibrary = await loadReplayValue(REPLAY_LIBRARY_KEY, []);
  const normalizedLibrary = [];
  let libraryChanged = false;

  if (Array.isArray(rawLibrary)) {
    for (const entry of rawLibrary) {
      const normalizedEntry = await ensureChunkedReplaySession(entry);
      if (!normalizedEntry) continue;
      if (needsChunkMigration(normalizeReplaySession(entry))) libraryChanged = true;
      normalizedLibrary.push(normalizedEntry);
    }
  }
  const lastSession = await loadLastReplaySession();

  if (lastSession && !normalizedLibrary.some((session) => session.id === lastSession.id)) {
    normalizedLibrary.unshift(lastSession);
  }

  normalizedLibrary.sort((left, right) => getReplaySortTimestamp(right) - getReplaySortTimestamp(left));

  if (!replayStore.hasSupport()) {
    return normalizedLibrary.slice(0, MAX_STORED_REPLAYS);
  }

  const strippedLibrary = normalizedLibrary
    .map(stripReplaySessionSamples)
    .filter(Boolean)
    .slice(0, MAX_STORED_REPLAYS);

  if (libraryChanged) {
    await saveReplayValue(REPLAY_LIBRARY_KEY, strippedLibrary);
  }

  return strippedLibrary;
}

export async function saveReplayLibrary(recordings) {
  const previousLibrary = await loadReplayLibrary();
  const normalizedRecordings = Array.isArray(recordings)
    ? recordings
      .map(normalizeReplaySession)
      .filter(Boolean)
      .sort((left, right) => getReplaySortTimestamp(right) - getReplaySortTimestamp(left))
      .slice(0, MAX_STORED_REPLAYS)
    : [];

  if (!replayStore.hasSupport()) {
    const embeddedRecordings = normalizedRecordings
      .map((recording) => createEmbeddedReplaySession(recording, recording.samples))
      .filter(Boolean);
    await saveReplayValue(REPLAY_LIBRARY_KEY, embeddedRecordings);
    return embeddedRecordings;
  }

  const persistedRecordings = [];
  for (const recording of normalizedRecordings) {
    const persistedRecording = await persistReplaySessionData(recording);
    persistedRecordings.push(stripReplaySessionSamples(persistedRecording));
  }

  await saveReplayValue(REPLAY_LIBRARY_KEY, persistedRecordings);

  const keptIds = new Set(persistedRecordings.map((recording) => recording.id));
  for (const previousRecording of previousLibrary) {
    if (keptIds.has(previousRecording.id)) continue;
    await deleteReplaySampleChunks(previousRecording.id, previousRecording.chunkCount ?? 0);
  }

  return persistedRecordings;
}

export async function archiveReplaySession(
  session,
  options = {},
) {
  const normalizedSession = finalizeReplaySession(session, options.endedAtMs ?? null);
  if (!hasReplaySamples(normalizedSession, options.minSamples ?? 2)) {
    return loadReplayLibrary();
  }

  const nextRecordings = (await loadReplayLibrary()).filter((entry) => entry.id !== normalizedSession.id);
  nextRecordings.unshift(normalizedSession);
  await saveLastReplaySession(normalizedSession);
  await saveReplayLibrary(nextRecordings.slice(0, options.maxRecordings ?? MAX_STORED_REPLAYS));
  return loadReplayLibrary();
}

export async function removeReplayRecording(recordingId) {
  if (typeof recordingId !== "string" || !recordingId) {
    return loadReplayLibrary();
  }

  const lastSession = await loadLastReplaySession();
  if (lastSession?.id === recordingId) {
    await removeReplayValue(REPLAY_LAST_KEY);
  }

  const nextRecordings = (await loadReplayLibrary()).filter((entry) => entry.id !== recordingId);
  await saveReplayLibrary(nextRecordings);
  return loadReplayLibrary();
}

export async function loadReplayRecords() {
  const activeSession = await loadActiveReplaySession();
  const recordings = [];

  if (hasReplaySamples(activeSession, 1)) {
    recordings.push({
      id: activeSession.id,
      source: "active",
      session: activeSession,
    });
  }

  for (const session of await loadReplayLibrary()) {
    recordings.push({
      id: session.id,
      source: "library",
      session,
    });
  }

  return recordings;
}

async function loadReplayRecordSession(record) {
  if (!record) return null;
  if (record.source === "active") {
    return loadActiveReplaySession({ includeSamples: true });
  }

  if (!replayStore.hasSupport()) {
    return normalizeReplaySession(record.session);
  }

  return hydrateReplaySessionSamples(record.session);
}

export async function loadReplaySelection(selectedId = null) {
  const records = await loadReplayRecords();

  if (selectedId) {
    const selectedRecord = records.find((record) => record.id === selectedId);
    if (selectedRecord) {
      return {
        source: selectedRecord.source,
        session: await loadReplayRecordSession(selectedRecord),
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
    session: preferredRecord ? await loadReplayRecordSession(preferredRecord) : null,
    records,
  };
}
