import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BOARD_STORAGE_MODULE = '../../src/board/storage.js';
const ACCEL_STORAGE_MODULE = '../../src/accel/storage.js';
const REPLAY_SESSION_MODULE = '../../src/replay/session.js';
const BACKEND_AUTH_MODULE = '../../src/shared/backend-auth.js';
const SINGLE_TAB_MODULE = '../../src/shared/single-tab.js';
const CLOUD_SYNC_MODULE = '../../src/shared/cloud-sync.js';

function createServerRecord(change, index = 0) {
  return {
    name: `sync-${index}-${change.client_record_id}`,
    entity_type: change.entity_type,
    client_record_id: change.client_record_id,
    device_id: change.device_id,
    record_title: change.record_title || '',
    content_hash: change.content_hash || `hash-${index}`,
    client_updated_at_ms: String(change.updated_at_ms || ''),
    deleted_at_ms: String(change.deleted_at_ms || ''),
    server_version: 1,
    payload_size: JSON.stringify(change.payload ?? null).length,
    modified: `2026-04-03 00:00:${String(index).padStart(2, '0')}.000000`,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function flushAsyncWork(turns = 4) {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

async function importCloudSyncModule() {
  return import(CLOUD_SYNC_MODULE);
}

function mockCloudSyncDependencies({
  replayLibrary = [],
  replaySessionsById = {},
  runs = [],
  pullRecords = [],
  cloudSyncCapability = {
    enabled: true,
    reason: '',
    csrfToken: 'csrf-token',
  },
  pushImpl = null,
  pullImpl = null,
} = {}) {
  let currentReplayLibrary = cloneJson(replayLibrary);
  let currentRuns = cloneJson(runs);
  const createEmptyBoardDrawing = vi.fn(() => ({
    commands: [],
    redoCommands: [],
    updatedAtMs: 0,
    version: 1,
  }));
  const loadBoardDrawing = vi.fn(async () => ({
    commands: [],
    redoCommands: [],
    updatedAtMs: 0,
    version: 1,
  }));
  const saveBoardDrawing = vi.fn(async () => {});
  const loadRuns = vi.fn(async () => cloneJson(currentRuns));
  const saveRuns = vi.fn(async (nextRuns) => {
    currentRuns = cloneJson(nextRuns ?? []);
    return cloneJson(currentRuns);
  });
  const loadReplayLibrary = vi.fn(async () => cloneJson(currentReplayLibrary));
  const loadReplaySessionById = vi.fn(async (recordingId) => {
    if (Object.prototype.hasOwnProperty.call(replaySessionsById, recordingId)) {
      return cloneJson(replaySessionsById[recordingId]);
    }
    return cloneJson(
      currentReplayLibrary.find((entry) => entry.id === recordingId) ?? null
    );
  });
  const removeReplayRecording = vi.fn(async (recordingId) => {
    currentReplayLibrary = currentReplayLibrary.filter((entry) => entry.id !== recordingId);
    return cloneJson(currentReplayLibrary);
  });
  const saveReplayLibrary = vi.fn(async (library) => {
    currentReplayLibrary = cloneJson(library ?? []);
    return cloneJson(currentReplayLibrary);
  });
  const isAccelPayloadComplete = vi.fn((payload) => Boolean(
    Array.isArray(payload?.sampleLog) && payload.sampleLog.length >= 2
    || Array.isArray(payload?.speedTrace) && payload.speedTrace.length >= 2
  ));
  const isReplayPayloadComplete = vi.fn((payload) => Boolean(
    Array.isArray(payload?.samples) && payload.samples.length >= 2
  ));
  const pushSyncChangesToBackend = vi.fn(
    pushImpl
      || (async ({ changes }) => ({
        ok: true,
        status: 200,
        records: changes.map((change, index) => createServerRecord(change, index)),
      }))
  );
  const pullSyncChangesFromBackend = vi.fn(
    pullImpl
      || (async () => ({
        ok: true,
        status: 200,
        records: pullRecords,
        hasMore: false,
        nextCursor: '',
      }))
  );
  const fetchBackendSession = vi.fn(async () => ({
    ok: true,
    isGuest: false,
  }));
  const getBackendSessionState = vi.fn(async (options = {}) => fetchBackendSession(options));
  const fetchBackendFeatureAccess = vi.fn(async () => ({
    ok: true,
    isGuest: false,
    cloudSyncCapability,
  }));
  const getBackendFeatureAccessState = vi.fn(async (options = {}) =>
    fetchBackendFeatureAccess(options)
  );
  const getProtectedCloudSyncRequestGate = vi.fn(async () => ({
    allowed: true,
    cleanup: vi.fn(),
    signal: undefined,
  }));
  const downloadSyncPayloadFromBackend = vi.fn(async () => ({
    ok: true,
    status: 200,
    payload: null,
  }));
  const hasSingleTabOwnership = vi.fn(() => true);

  vi.doMock(BOARD_STORAGE_MODULE, () => ({
    createEmptyBoardDrawing,
    loadBoardDrawing,
    saveBoardDrawing,
  }));
  vi.doMock(ACCEL_STORAGE_MODULE, () => ({
    isAccelPayloadComplete,
    loadRuns,
    saveRuns,
  }));
  vi.doMock(REPLAY_SESSION_MODULE, () => ({
    MAX_STORED_REPLAYS: 12,
    isReplayPayloadComplete,
    loadReplayLibrary,
    loadReplaySessionById,
    removeReplayRecording,
    saveReplayLibrary,
  }));
  vi.doMock(BACKEND_AUTH_MODULE, () => ({
    BACKEND_AUTH_STATE_EVENT: 'vatioboard:backend-auth-state',
    downloadSyncPayloadFromBackend,
    fetchBackendFeatureAccess,
    fetchBackendSession,
    getBackendFeatureAccessState,
    getBackendSessionState,
    getProtectedCloudSyncRequestGate,
    pullSyncChangesFromBackend,
    pushSyncChangesToBackend,
  }));
  vi.doMock(SINGLE_TAB_MODULE, () => ({
    hasSingleTabOwnership,
    SINGLE_TAB_OWNERSHIP_EVENT: 'vatioboard:single-tab-ownership',
  }));

  return {
    createEmptyBoardDrawing,
    downloadSyncPayloadFromBackend,
    fetchBackendFeatureAccess,
    fetchBackendSession,
    getBackendFeatureAccessState,
    getBackendSessionState,
    getProtectedCloudSyncRequestGate,
    hasSingleTabOwnership,
    loadBoardDrawing,
    isAccelPayloadComplete,
    isReplayPayloadComplete,
    loadReplayLibrary,
    loadReplaySessionById,
    loadRuns,
    pullSyncChangesFromBackend,
    pushSyncChangesToBackend,
    removeReplayRecording,
    saveBoardDrawing,
    saveReplayLibrary,
    saveRuns,
  };
}

function unmockCloudSyncDependencies() {
  vi.doUnmock(BOARD_STORAGE_MODULE);
  vi.doUnmock(ACCEL_STORAGE_MODULE);
  vi.doUnmock(REPLAY_SESSION_MODULE);
  vi.doUnmock(BACKEND_AUTH_MODULE);
  vi.doUnmock(SINGLE_TAB_MODULE);
}

describe('cloud sync', () => {
  const originalIndexedDb = globalThis.indexedDB;
  const originalLocks = navigator.locks;

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    localStorage.clear();
    unmockCloudSyncDependencies();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: originalLocks,
    });
  });

  it('bootstraps replay sync with hydrated replay payloads', async () => {
    const strippedReplay = {
      id: 'replay-1',
      updatedAtMs: 2000,
      endedAtMs: 2000,
      startedAtMs: 1000,
      sampleCount: 3,
      persistedSampleCount: 3,
      chunkCount: 1,
      samples: [],
      startPlace: { label: 'Library shell' },
    };
    const hydratedReplay = {
      ...strippedReplay,
      startPlace: { label: 'Hydrated replay' },
      samples: [
        { timestampMs: 1000, latitude: 1, longitude: 1, totalDistanceM: 0 },
        { timestampMs: 2000, latitude: 2, longitude: 2, totalDistanceM: 100 },
        { timestampMs: 3000, latitude: 3, longitude: 3, totalDistanceM: 200 },
      ],
    };
    const mocks = mockCloudSyncDependencies({
      replayLibrary: [strippedReplay],
      replaySessionsById: {
        'replay-1': hydratedReplay,
      },
    });

    const { syncCloudRecords } = await importCloudSyncModule();

    await syncCloudRecords();

    expect(mocks.pushSyncChangesToBackend).toHaveBeenCalledTimes(1);
    const pushedReplay = mocks.pushSyncChangesToBackend.mock.calls[0][0].changes[0];
    expect(pushedReplay.client_record_id).toBe('replay-1');
    expect(pushedReplay.record_title).toBe('Hydrated replay');
    expect(pushedReplay.payload.samples).toEqual(hydratedReplay.samples);
    expect(mocks.loadReplaySessionById).toHaveBeenCalledWith('replay-1');
  });

  it('pushes full replay telemetry when a just-archived replay is queued inline', async () => {
    const strippedReplay = {
      id: 'replay-1',
      updatedAtMs: 3000,
      endedAtMs: 3000,
      startedAtMs: 1000,
      sampleCount: 3,
      persistedSampleCount: 3,
      chunkCount: 1,
      samples: [],
      startPlace: { label: 'Library shell' },
    };
    const archivedReplay = {
      ...strippedReplay,
      startPlace: { label: 'Archived replay' },
      samples: [
        { timestampMs: 1000, latitude: 1, longitude: 1, totalDistanceM: 0, speedMs: 0 },
        { timestampMs: 2000, latitude: 2, longitude: 2, totalDistanceM: 100, speedMs: 12 },
        { timestampMs: 3000, latitude: 3, longitude: 3, totalDistanceM: 220, speedMs: 18 },
      ],
    };
    const mocks = mockCloudSyncDependencies({
      replayLibrary: [strippedReplay],
      replaySessionsById: {
        'replay-1': strippedReplay,
      },
    });
    const { CLOUD_SYNC_ENTITY_TYPES, queueCloudSyncChange, syncCloudRecords } =
      await importCloudSyncModule();

    await queueCloudSyncChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.replaySession,
      recordId: archivedReplay.id,
      recordTitle: archivedReplay.startPlace.label,
      updatedAtMs: archivedReplay.updatedAtMs,
      payload: archivedReplay,
    });
    await syncCloudRecords();

    expect(mocks.pushSyncChangesToBackend).toHaveBeenCalledTimes(1);
    expect(mocks.loadReplaySessionById).not.toHaveBeenCalled();
    const pushedReplay = mocks.pushSyncChangesToBackend.mock.calls[0][0].changes[0];
    expect(pushedReplay.client_record_id).toBe('replay-1');
    expect(pushedReplay.payload.samples).toEqual(archivedReplay.samples);
    expect(pushedReplay.record_title).toBe('Archived replay');
  });

  it('restores full replay telemetry from downloaded sync payloads on a fresh browser', async () => {
    const fullReplayPayload = {
      id: 'replay-remote-1',
      updatedAtMs: 3000,
      endedAtMs: 3000,
      startedAtMs: 1000,
      sampleCount: 3,
      persistedSampleCount: 3,
      chunkCount: 0,
      startPlace: { label: 'Remote replay' },
      samples: [
        { timestampMs: 1000, latitude: 1, longitude: 1, totalDistanceM: 0, speedMs: 0 },
        { timestampMs: 2000, latitude: 1.5, longitude: 1.5, totalDistanceM: 120, speedMs: 14 },
        { timestampMs: 3000, latitude: 2, longitude: 2, totalDistanceM: 260, speedMs: 21 },
      ],
    };
    const remoteReplayRecord = createServerRecord({
      entity_type: 'replay_session',
      client_record_id: 'replay-remote-1',
      device_id: 'device-b',
      updated_at_ms: 3000,
      payload: {
        id: 'replay-remote-1',
        sampleCount: 3,
      },
    });
    const mocks = mockCloudSyncDependencies({
      pullRecords: [remoteReplayRecord],
    });
    mocks.downloadSyncPayloadFromBackend.mockResolvedValue({
      ok: true,
      status: 200,
      payload: fullReplayPayload,
    });

    const { syncCloudRecords } = await importCloudSyncModule();
    await syncCloudRecords();

    const replayLibrary = await mocks.loadReplayLibrary();
    expect(replayLibrary).toHaveLength(1);
    expect(replayLibrary[0]).toEqual(fullReplayPayload);
    expect(mocks.saveReplayLibrary).toHaveBeenCalledWith([fullReplayPayload]);
  });

  it('can re-download and re-apply a replay payload by record id when a page needs telemetry recovery', async () => {
    const fullReplayPayload = {
      id: 'replay-remote-restore',
      updatedAtMs: 3200,
      endedAtMs: 3200,
      startedAtMs: 1000,
      sampleCount: 3,
      persistedSampleCount: 3,
      chunkCount: 0,
      startPlace: { label: 'Recovered replay' },
      samples: [
        { timestampMs: 1000, latitude: 1, longitude: 1, totalDistanceM: 0, speedMs: 0 },
        { timestampMs: 2100, latitude: 1.4, longitude: 1.4, totalDistanceM: 140, speedMs: 16 },
        { timestampMs: 3200, latitude: 2, longitude: 2, totalDistanceM: 280, speedMs: 24 },
      ],
    };
    const remoteReplayRecord = createServerRecord({
      entity_type: 'replay_session',
      client_record_id: 'replay-remote-restore',
      device_id: 'device-b',
      updated_at_ms: 3200,
      payload: {
        id: 'replay-remote-restore',
        sampleCount: 3,
      },
    });
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'replay_session:replay-remote-restore': remoteReplayRecord,
      },
    }));

    const mocks = mockCloudSyncDependencies();
    mocks.downloadSyncPayloadFromBackend.mockResolvedValue({
      ok: true,
      status: 200,
      payload: fullReplayPayload,
    });

    const { restoreCloudSyncRecord } = await importCloudSyncModule();
    const restoreResult = await restoreCloudSyncRecord({
      entityType: 'replay_session',
      recordId: 'replay-remote-restore',
    });

    expect(restoreResult).toMatchObject({
      ok: true,
      meta: expect.objectContaining({
        name: remoteReplayRecord.name,
        clientRecordId: 'replay-remote-restore',
      }),
      payload: fullReplayPayload,
    });
    expect(mocks.downloadSyncPayloadFromBackend).toHaveBeenCalledWith({
      name: remoteReplayRecord.name,
      signal: undefined,
    });
    expect(mocks.saveReplayLibrary).toHaveBeenCalledWith([fullReplayPayload]);
  });

  it('can re-download and re-apply an accel payload by record id when a page needs telemetry recovery', async () => {
    const fullAccelPayload = {
      id: 'run-remote-restore',
      savedAtMs: 4200,
      elapsedMs: 4200,
      presetId: '0-60',
      presetSignature: '0-60',
      comparisonSignature: '0-60',
      presetKind: 'speed',
      displayUnit: 'mph',
      distanceDisplay: 'ft',
      finishSpeedMs: 26.8,
      qualityGrade: 'good',
      qualityScore: 92,
      speedTrace: [
        { elapsedMs: 0, speedMs: 0, distanceM: 0 },
        { elapsedMs: 4200, speedMs: 26.8, distanceM: 120 },
      ],
      sampleLog: [
        { elapsedFromStartMs: 1200, speedMs: 12, distanceFromStartM: 18, latitude: 1, longitude: 1 },
        { elapsedFromStartMs: 4200, speedMs: 26.8, distanceFromStartM: 120, latitude: 1.2, longitude: 1.2 },
      ],
      partials: [],
    };
    const remoteAccelRecord = createServerRecord({
      entity_type: 'accel_run',
      client_record_id: 'run-remote-restore',
      device_id: 'device-b',
      updated_at_ms: 4200,
      payload: {
        id: 'run-remote-restore',
        elapsedMs: 4200,
      },
    });
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'accel_run:run-remote-restore': remoteAccelRecord,
      },
    }));

    const mocks = mockCloudSyncDependencies();
    mocks.downloadSyncPayloadFromBackend.mockResolvedValue({
      ok: true,
      status: 200,
      payload: fullAccelPayload,
    });

    const { restoreCloudSyncRecord } = await importCloudSyncModule();
    const restoreResult = await restoreCloudSyncRecord({
      entityType: 'accel_run',
      recordId: 'run-remote-restore',
    });

    expect(restoreResult).toMatchObject({
      ok: true,
      meta: expect.objectContaining({
        name: remoteAccelRecord.name,
        clientRecordId: 'run-remote-restore',
      }),
      payload: fullAccelPayload,
    });
    expect(mocks.downloadSyncPayloadFromBackend).toHaveBeenCalledWith({
      name: remoteAccelRecord.name,
      signal: undefined,
    });
    expect(mocks.saveRuns).toHaveBeenCalledWith([fullAccelPayload]);
  });

  it('does not let a summary-only remote replay payload replace richer local telemetry', async () => {
    const localReplay = {
      id: 'replay-1',
      updatedAtMs: 2000,
      endedAtMs: 2000,
      startedAtMs: 1000,
      sampleCount: 2,
      persistedSampleCount: 2,
      chunkCount: 0,
      startPlace: { label: 'Local replay' },
      samples: [
        { timestampMs: 1000, latitude: 1, longitude: 1, totalDistanceM: 0 },
        { timestampMs: 2000, latitude: 2, longitude: 2, totalDistanceM: 100 },
      ],
    };
    const remoteReplayRecord = createServerRecord({
      entity_type: 'replay_session',
      client_record_id: 'replay-1',
      device_id: 'device-b',
      updated_at_ms: 3000,
      payload: {
        id: 'replay-1',
        sampleCount: 24,
      },
    });
    const mocks = mockCloudSyncDependencies({
      replayLibrary: [localReplay],
      replaySessionsById: {
        'replay-1': localReplay,
      },
      pullRecords: [remoteReplayRecord],
    });
    mocks.downloadSyncPayloadFromBackend.mockResolvedValue({
      ok: true,
      status: 200,
      payload: {
        id: 'replay-1',
        sampleCount: 24,
        startedAtMs: 1000,
        endedAtMs: 3000,
      },
    });

    const { syncCloudRecords } = await importCloudSyncModule();
    await syncCloudRecords();

    const replayLibrary = await mocks.loadReplayLibrary();
    expect(replayLibrary).toEqual([localReplay]);
    expect(mocks.saveReplayLibrary).not.toHaveBeenCalled();
  });

  it('does not let a summary-only remote accel payload replace richer local telemetry', async () => {
    const localRun = {
      id: 'run-1',
      savedAtMs: 2000,
      elapsedMs: 4200,
      presetId: '0-60',
      presetSignature: '0-60',
      comparisonSignature: '0-60',
      presetKind: 'speed',
      displayUnit: 'mph',
      distanceDisplay: 'ft',
      finishSpeedMs: 26.8,
      qualityGrade: 'good',
      qualityScore: 90,
      speedTrace: [
        { elapsedMs: 0, speedMs: 0, distanceM: 0 },
        { elapsedMs: 4200, speedMs: 26.8, distanceM: 120 },
      ],
      sampleLog: [],
      partials: [],
    };
    const remoteAccelRecord = createServerRecord({
      entity_type: 'accel_run',
      client_record_id: 'run-1',
      device_id: 'device-b',
      updated_at_ms: 3000,
      payload: {
        id: 'run-1',
        elapsedMs: 4200,
      },
    });
    const mocks = mockCloudSyncDependencies({
      runs: [localRun],
      pullRecords: [remoteAccelRecord],
    });
    mocks.downloadSyncPayloadFromBackend.mockResolvedValue({
      ok: true,
      status: 200,
      payload: {
        id: 'run-1',
        savedAtMs: 3000,
        elapsedMs: 4200,
        presetId: '0-60',
      },
    });

    const { syncCloudRecords } = await importCloudSyncModule();
    await syncCloudRecords();

    const storedRuns = await mocks.loadRuns();
    expect(storedRuns).toEqual([localRun]);
    expect(mocks.saveRuns).not.toHaveBeenCalled();
  });

  it('preserves distinct outbox changes queued concurrently', async () => {
    const mocks = mockCloudSyncDependencies();
    const { CLOUD_SYNC_ENTITY_TYPES, queueCloudSyncChange, syncCloudRecords } =
      await importCloudSyncModule();

    await Promise.all([
      queueCloudSyncChange({
        entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
        recordId: 'run-1',
        recordTitle: 'Run 1',
        updatedAtMs: 1000,
        contentHash: 'hash-run-1',
        payload: {
          id: 'run-1',
          savedAtMs: 1000,
        },
      }),
      queueCloudSyncChange({
        entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
        recordId: 'run-2',
        recordTitle: 'Run 2',
        updatedAtMs: 2000,
        contentHash: 'hash-run-2',
        payload: {
          id: 'run-2',
          savedAtMs: 2000,
        },
      }),
    ]);

    await syncCloudRecords();

    expect(mocks.pushSyncChangesToBackend).toHaveBeenCalledTimes(1);
    expect(mocks.pushSyncChangesToBackend.mock.calls[0][0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_record_id: 'run-1',
          updated_at_ms: 1000,
          content_hash: 'hash-run-1',
        }),
        expect.objectContaining({
          client_record_id: 'run-2',
          updated_at_ms: 2000,
          content_hash: 'hash-run-2',
        }),
      ])
    );
  });

  it('preserves replacement outbox changes queued while a sync is already in flight', async () => {
    let resolveFirstPush = null;
    let pushCallCount = 0;
    const pushImpl = vi.fn(({ changes }) => {
      pushCallCount += 1;
      const response = {
        ok: true,
        status: 200,
        records: changes.map((change, index) => createServerRecord(change, (pushCallCount - 1) * 10 + index)),
      };

      if (pushCallCount === 1) {
        return new Promise((resolve) => {
          resolveFirstPush = () => resolve(response);
        });
      }

      return Promise.resolve(response);
    });
    const mocks = mockCloudSyncDependencies({
      pushImpl,
    });

    const { CLOUD_SYNC_ENTITY_TYPES, queueCloudSyncChange, syncCloudRecords } = await importCloudSyncModule();

    await queueCloudSyncChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
      recordId: 'run-1',
      recordTitle: 'Run 1',
      updatedAtMs: 1000,
      contentHash: 'hash-a',
      payload: {
        id: 'run-1',
        savedAtMs: 1000,
      },
    });

    void syncCloudRecords();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await flushAsyncWork();
      if (mocks.pushSyncChangesToBackend.mock.calls.length === 1) {
        break;
      }
    }
    expect(mocks.pushSyncChangesToBackend).toHaveBeenCalledTimes(1);

    await queueCloudSyncChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
      recordId: 'run-1',
      recordTitle: 'Run 1',
      updatedAtMs: 2000,
      contentHash: 'hash-b',
      payload: {
        id: 'run-1',
        savedAtMs: 2000,
      },
    });

    resolveFirstPush?.();
    let pushedPayloads = [];
    let sawReplacementPush = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await flushAsyncWork();
      pushedPayloads = mocks.pushSyncChangesToBackend.mock.calls.flatMap(
        ([request]) => request.changes
      );
      sawReplacementPush = pushedPayloads.some(
        (change) => change.client_record_id === 'run-1' && change.updated_at_ms === 2000
      );
      if (sawReplacementPush) {
        break;
      }
    }

    expect(sawReplacementPush).toBe(true);
    expect(pushedPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_record_id: 'run-1',
          updated_at_ms: 1000,
          content_hash: 'hash-a',
        }),
        expect.objectContaining({
          client_record_id: 'run-1',
          updated_at_ms: 2000,
          content_hash: 'hash-b',
        }),
      ])
    );
  });

  it('waits for the active sync when syncCloudRecords is called concurrently', async () => {
    let resolvePull = null;
    const pullImpl = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePull = () =>
            resolve({
              ok: true,
              status: 200,
              records: [],
              hasMore: false,
              nextCursor: '',
            });
        })
    );
    const mocks = mockCloudSyncDependencies({
      pullImpl,
    });

    const { syncCloudRecords } = await importCloudSyncModule();

    const firstSyncPromise = syncCloudRecords();
    await flushAsyncWork(20);

    let secondSyncResolved = false;
    const secondSyncPromise = syncCloudRecords().then((result) => {
      secondSyncResolved = true;
      return result;
    });

    await flushAsyncWork(20);
    expect(secondSyncResolved).toBe(false);
    expect(mocks.pullSyncChangesFromBackend).toHaveBeenCalledTimes(1);

    resolvePull?.();

    await firstSyncPromise;
    await secondSyncPromise;
    expect(secondSyncResolved).toBe(true);
  });

  it('uses the browser Locks API for sync when available', async () => {
    const request = vi.fn((_lockName, _options, callback) => callback({ name: 'cloud-sync' }));
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: { request },
    });
    mockCloudSyncDependencies();

    const { syncCloudRecords } = await importCloudSyncModule();

    await syncCloudRecords();

    expect(request).toHaveBeenCalledWith(
      'vatioboard:cloud-sync',
      { ifAvailable: true },
      expect.any(Function)
    );
  });

  it('skips sync when another tab already holds the sync lock', async () => {
    const request = vi.fn((_lockName, _options, callback) => callback(null));
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: { request },
    });
    const mocks = mockCloudSyncDependencies();

    const { syncCloudRecords } = await importCloudSyncModule();

    await expect(syncCloudRecords()).resolves.toEqual({
      ok: false,
      skipped: true,
      reason: 'lease',
    });
    expect(mocks.fetchBackendSession).not.toHaveBeenCalled();
    expect(mocks.pullSyncChangesFromBackend).not.toHaveBeenCalled();
    expect(mocks.pushSyncChangesToBackend).not.toHaveBeenCalled();
  });

  it('skips protected sync endpoints when cloud_sync is disabled', async () => {
    const mocks = mockCloudSyncDependencies({
      cloudSyncCapability: {
        enabled: false,
        reason: 'subscription required',
        csrfToken: '',
      },
    });

    const { CLOUD_SYNC_ENTITY_TYPES, queueCloudSyncChange, syncCloudRecords } =
      await importCloudSyncModule();

    await queueCloudSyncChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
      recordId: 'run-disabled',
      recordTitle: 'Run disabled',
      updatedAtMs: 1000,
      contentHash: 'hash-disabled',
      payload: {
        id: 'run-disabled',
        savedAtMs: 1000,
      },
    });

    await expect(syncCloudRecords()).resolves.toEqual({
      ok: true,
      skipped: true,
      reason: 'subscription required',
    });
    expect(mocks.getBackendFeatureAccessState).toHaveBeenCalledTimes(1);
    expect(mocks.pullSyncChangesFromBackend).not.toHaveBeenCalled();
    expect(mocks.pushSyncChangesToBackend).not.toHaveBeenCalled();
    expect(mocks.downloadSyncPayloadFromBackend).not.toHaveBeenCalled();
  });

  it('does not download a cloud sync payload when the cloud_sync gate is blocked', async () => {
    const remoteReplayRecord = createServerRecord({
      entity_type: 'replay_session',
      client_record_id: 'replay-disabled-restore',
      device_id: 'device-b',
      updated_at_ms: 3200,
      payload: {
        id: 'replay-disabled-restore',
      },
    });
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'replay_session:replay-disabled-restore': remoteReplayRecord,
      },
    }));
    const mocks = mockCloudSyncDependencies();
    mocks.getProtectedCloudSyncRequestGate.mockResolvedValue({
      allowed: false,
      blockedByFeature: true,
      cleanup: vi.fn(),
      featureKey: 'cloud_sync',
      reason: 'subscription required',
      signal: undefined,
      status: 403,
    });

    const { downloadCloudSyncRecord } = await importCloudSyncModule();

    await expect(downloadCloudSyncRecord({
      entityType: 'replay_session',
      recordId: 'replay-disabled-restore',
    })).resolves.toMatchObject({
      ok: false,
      blockedByFeature: true,
      reason: 'subscription required',
      status: 403,
    });
    expect(mocks.downloadSyncPayloadFromBackend).not.toHaveBeenCalled();
  });

  it('treats a 403 payload download as cloud_sync disabled without retrying aggressively', async () => {
    const remoteReplayRecord = createServerRecord({
      entity_type: 'replay_session',
      client_record_id: 'replay-403-restore',
      device_id: 'device-b',
      updated_at_ms: 3200,
      payload: {
        id: 'replay-403-restore',
      },
    });
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'replay_session:replay-403-restore': remoteReplayRecord,
      },
    }));
    const mocks = mockCloudSyncDependencies();
    mocks.downloadSyncPayloadFromBackend.mockResolvedValue({
      ok: false,
      status: 403,
      blockedByFeature: true,
      reason: 'subscription required',
      payload: null,
    });

    const { CLOUD_SYNC_STATUS_STATES, downloadCloudSyncRecord, getCloudSyncStatus, isCloudSyncScheduled } =
      await importCloudSyncModule();

    const result = await downloadCloudSyncRecord({
      entityType: 'replay_session',
      recordId: 'replay-403-restore',
    });

    expect(result).toMatchObject({
      ok: false,
      blockedByFeature: true,
      reason: 'subscription required',
      status: 403,
    });
    expect(getCloudSyncStatus()).toMatchObject({
      state: CLOUD_SYNC_STATUS_STATES.localOnly,
      reason: 'subscription required',
    });
    expect(isCloudSyncScheduled()).toBe(false);
  });

  it('schedules sync when the document becomes visible again', async () => {
    const mocks = mockCloudSyncDependencies();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    const { startCloudSyncLoop } = await importCloudSyncModule();

    startCloudSyncLoop({ immediate: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushAsyncWork(20);

    expect(mocks.fetchBackendSession).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight sync when logout starts', async () => {
    let pushAborted = false;
    const pushImpl = vi.fn(({ signal }) => new Promise((_resolve, reject) => {
      const abortError = Object.assign(new Error('Aborted'), {
        name: 'AbortError',
      });

      if (signal?.aborted) {
        pushAborted = true;
        reject(abortError);
        return;
      }

      signal?.addEventListener(
        'abort',
        () => {
          pushAborted = true;
          reject(abortError);
        },
        { once: true }
      );
    }));
    const mocks = mockCloudSyncDependencies({
      pushImpl,
    });

    const { CLOUD_SYNC_ENTITY_TYPES, queueCloudSyncChange, startCloudSyncLoop, syncCloudRecords } =
      await importCloudSyncModule();

    startCloudSyncLoop({ immediate: false });
    await queueCloudSyncChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
      recordId: 'run-logout',
      recordTitle: 'Run logout',
      updatedAtMs: 1000,
      contentHash: 'hash-logout',
      payload: {
        id: 'run-logout',
        savedAtMs: 1000,
      },
    });

    const syncPromise = syncCloudRecords();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await flushAsyncWork();
      if (mocks.pushSyncChangesToBackend.mock.calls.length === 1) {
        break;
      }
    }
    expect(mocks.pushSyncChangesToBackend).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent('vatioboard:backend-auth-state', {
      detail: {
        authenticated: true,
        busy: true,
        isGuest: false,
        pendingLogout: true,
        user: 'driver@example.com',
      },
    }));

    await expect(syncPromise).resolves.toEqual({
      ok: false,
      skipped: true,
      reason: 'aborted',
    });
    expect(pushAborted).toBe(true);
    await flushAsyncWork(20);
    expect(mocks.fetchBackendSession).toHaveBeenCalledTimes(1);
  });

  it('queues while signed out and waits to sync until auth is restored', async () => {
    const mocks = mockCloudSyncDependencies();
    const { CLOUD_SYNC_ENTITY_TYPES, queueCloudSyncChange, startCloudSyncLoop, syncCloudRecords } =
      await importCloudSyncModule();

    startCloudSyncLoop({ immediate: false });
    window.dispatchEvent(new CustomEvent('vatioboard:backend-auth-state', {
      detail: {
        authenticated: false,
        busy: false,
        isGuest: true,
        pendingLogout: false,
        user: null,
      },
    }));

    await expect(queueCloudSyncChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
      recordId: 'run-signed-out',
      recordTitle: 'Run signed out',
      updatedAtMs: 2000,
      contentHash: 'hash-signed-out',
      payload: {
        id: 'run-signed-out',
        savedAtMs: 2000,
      },
    })).resolves.toBe(true);

    await expect(syncCloudRecords()).resolves.toEqual({
      ok: false,
      skipped: true,
      reason: 'auth',
    });
    expect(mocks.fetchBackendSession).not.toHaveBeenCalled();
    expect(mocks.pushSyncChangesToBackend).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent('vatioboard:backend-auth-state', {
      detail: {
        authenticated: true,
        busy: false,
        isGuest: false,
        pendingLogout: false,
        user: 'driver@example.com',
      },
    }));
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await flushAsyncWork();
      if (mocks.pushSyncChangesToBackend.mock.calls.length === 1) {
        break;
      }
    }

    expect(mocks.fetchBackendSession).toHaveBeenCalledTimes(1);
    expect(mocks.pushSyncChangesToBackend).toHaveBeenCalledTimes(1);
  });
});
