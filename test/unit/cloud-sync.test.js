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
  pullRecords = [],
  pushImpl = null,
  pullImpl = null,
} = {}) {
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
  const loadRuns = vi.fn(async () => []);
  const saveRuns = vi.fn(async () => {});
  const loadReplayLibrary = vi.fn(async () => replayLibrary);
  const loadReplaySessionById = vi.fn(async (recordingId) => replaySessionsById[recordingId] ?? null);
  const removeReplayRecording = vi.fn(async () => []);
  const saveReplayLibrary = vi.fn(async (library) => library);
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
  const fetchBackendFeatureAccess = vi.fn(async () => ({
    ok: true,
    isGuest: false,
    cloudSyncCapability: {
      enabled: true,
      reason: '',
      csrfToken: 'csrf-token',
    },
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
    loadRuns,
    saveRuns,
  }));
  vi.doMock(REPLAY_SESSION_MODULE, () => ({
    MAX_STORED_REPLAYS: 12,
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
    hasSingleTabOwnership,
    loadBoardDrawing,
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
    await flushAsyncWork(20);
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
    await flushAsyncWork(20);
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

  it('does not queue or run cloud sync while signed out', async () => {
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
    })).resolves.toBe(false);

    await expect(syncCloudRecords()).resolves.toEqual({
      ok: false,
      skipped: true,
      reason: 'auth',
    });
    expect(mocks.fetchBackendSession).not.toHaveBeenCalled();
    expect(mocks.pushSyncChangesToBackend).not.toHaveBeenCalled();
  });
});
