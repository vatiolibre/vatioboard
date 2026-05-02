import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BOARD_STORAGE_MODULE = '../../src/board/storage.js';
const ACCEL_STORAGE_MODULE = '../../src/accel/storage.js';
const REPLAY_SESSION_MODULE = '../../src/replay/session.js';
const BACKEND_AUTH_MODULE = '../../src/shared/backend-auth.js';
const SINGLE_TAB_MODULE = '../../src/shared/single-tab.js';
const INDEXED_STORAGE_MODULE = '../../src/shared/indexed-storage.js';
const CLOUD_SYNC_MODULE = '../../src/shared/cloud-sync.js';

const UNCHANGED_BOARD_RECORD = {
  entity_type: 'board_drawing',
  client_record_id: 'primary',
  name: 'c1nmtb2o53',
  server_version: 269,
  content_hash: 'h308098074',
  client_updated_at_ms: '1777249113451',
  deleted_at_ms: '',
};

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createMemoryStore(initialValues = {}) {
  const values = new Map(Object.entries(cloneJson(initialValues)));
  return {
    values,
    deleteValue: vi.fn(async (key) => {
      values.delete(key);
      return true;
    }),
    getValue: vi.fn(async (key) => cloneJson(values.get(key))),
    hasSupport: vi.fn(() => true),
    openDatabase: vi.fn(async () => ({})),
    setValue: vi.fn(async (key, value) => {
      values.set(key, cloneJson(value));
      return true;
    }),
  };
}

function mockCloudSyncDependencies({
  getBackendSessionStateImpl,
  pullImpl,
  pullRecords = [UNCHANGED_BOARD_RECORD],
  indexedStore = null,
} = {}) {
  const loadBoardDrawing = vi.fn(async () => ({
    commands: [],
    redoCommands: [],
    updatedAtMs: 0,
    version: 1,
  }));
  const saveBoardDrawing = vi.fn(async () => {});
  const pullSyncChangesFromBackend = vi.fn(
    pullImpl
      || (async () => ({
        ok: true,
        status: 200,
        records: pullRecords,
        hasMore: false,
        nextCursor: 'cursor-269',
      }))
  );
  const downloadSyncPayloadFromBackend = vi.fn(async () => ({
    ok: true,
    status: 200,
    payload: {
      commands: [{ type: 'clear' }],
      redoCommands: [],
      updatedAtMs: 1777249113451,
      version: 1,
    },
  }));

  vi.doMock(BOARD_STORAGE_MODULE, () => ({
    createEmptyBoardDrawing: vi.fn(() => ({
      commands: [],
      redoCommands: [],
      updatedAtMs: 0,
      version: 1,
    })),
    loadBoardDrawing,
    saveBoardDrawing,
  }));
  vi.doMock(ACCEL_STORAGE_MODULE, () => ({
    isAccelPayloadComplete: vi.fn(() => true),
    loadRuns: vi.fn(async () => []),
    saveRuns: vi.fn(async () => []),
  }));
  vi.doMock(REPLAY_SESSION_MODULE, () => ({
    MAX_STORED_REPLAYS: 12,
    isReplayPayloadComplete: vi.fn(() => true),
    loadReplayLibrary: vi.fn(async () => []),
    loadReplaySessionById: vi.fn(async () => null),
    removeReplayRecording: vi.fn(async () => []),
    saveReplayLibrary: vi.fn(async () => []),
  }));
  vi.doMock(BACKEND_AUTH_MODULE, () => ({
    BACKEND_AUTH_STATE_EVENT: 'vatioboard:backend-auth-state',
    downloadSyncPayloadFromBackend,
    getBackendFeatureAccessState: vi.fn(async () => ({
      ok: true,
      isGuest: false,
      cloudSyncCapability: {
        enabled: true,
        reason: '',
        csrfToken: 'csrf-token',
      },
    })),
    getBackendSessionState: vi.fn(getBackendSessionStateImpl || (async () => ({
      ok: true,
      isGuest: false,
    }))),
    getProtectedCloudSyncRequestGate: vi.fn(async () => ({
      allowed: true,
      cleanup: vi.fn(),
      signal: undefined,
    })),
    pullSyncChangesFromBackend,
    pushSyncChangesToBackend: vi.fn(async () => ({
      ok: true,
      status: 200,
      records: [],
    })),
  }));
  vi.doMock(SINGLE_TAB_MODULE, () => ({
    hasSingleTabOwnership: vi.fn(() => true),
    SINGLE_TAB_OWNERSHIP_EVENT: 'vatioboard:single-tab-ownership',
  }));
  if (indexedStore) {
    vi.doMock(INDEXED_STORAGE_MODULE, () => ({
      createIndexedJsonKeyValueStore: () => indexedStore,
    }));
  } else {
    vi.doUnmock(INDEXED_STORAGE_MODULE);
  }

  return {
    downloadSyncPayloadFromBackend,
    indexedStore,
    loadBoardDrawing,
    pullSyncChangesFromBackend,
    saveBoardDrawing,
  };
}

async function importCloudSyncModule() {
  return import(CLOUD_SYNC_MODULE);
}

describe('cloud sync idempotence', () => {
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
    vi.doUnmock(BOARD_STORAGE_MODULE);
    vi.doUnmock(ACCEL_STORAGE_MODULE);
    vi.doUnmock(REPLAY_SESSION_MODULE);
    vi.doUnmock(BACKEND_AUTH_MODULE);
    vi.doUnmock(SINGLE_TAB_MODULE);
    vi.doUnmock(INDEXED_STORAGE_MODULE);
    localStorage.clear();
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

  it('downloads an unseen board payload once and skips unchanged repeats', async () => {
    const mocks = mockCloudSyncDependencies();
    const appliedEvents = [];
    window.addEventListener('vatioboard:cloud-sync-applied', (event) => {
      appliedEvents.push(event.detail);
    });

    const { syncCloudRecords } = await importCloudSyncModule();

    await syncCloudRecords();
    await syncCloudRecords();
    await syncCloudRecords();

    expect(mocks.downloadSyncPayloadFromBackend).toHaveBeenCalledTimes(1);
    expect(mocks.downloadSyncPayloadFromBackend).toHaveBeenCalledWith(expect.objectContaining({
      name: 'c1nmtb2o53',
    }));
    expect(mocks.saveBoardDrawing).toHaveBeenCalledTimes(1);
    expect(appliedEvents).toHaveLength(1);
    expect(appliedEvents[0]).toMatchObject({
      entityType: 'board_drawing',
      recordId: 'primary',
      deleted: false,
    });
  });

  it('pauses instead of looping when the backend repeats an unchanged cursor page', async () => {
    const mocks = mockCloudSyncDependencies({
      pullImpl: async ({ cursor }) => ({
        ok: true,
        status: 200,
        records: [UNCHANGED_BOARD_RECORD],
        hasMore: true,
        nextCursor: cursor || '',
      }),
    });

    const { getCloudSyncStatus, syncCloudRecords } = await importCloudSyncModule();

    await expect(syncCloudRecords()).resolves.toEqual({
      ok: false,
      skipped: true,
      reason: 'pull_cursor_stalled',
    });
    expect(mocks.pullSyncChangesFromBackend).toHaveBeenCalledTimes(1);
    expect(mocks.downloadSyncPayloadFromBackend).toHaveBeenCalledTimes(1);
    expect(getCloudSyncStatus()).toMatchObject({
      state: 'paused',
      reason: 'pull_cursor_stalled',
    });
  });

  it('observes scheduled background sync failures without unhandled rejections', async () => {
    const unhandled = [];
    const handleUnhandled = (reason) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', handleUnhandled);

    const sessionError = new TypeError('Failed to fetch');
    const getBackendSessionStateImpl = vi.fn(async () => {
      throw sessionError;
    });
    mockCloudSyncDependencies({ getBackendSessionStateImpl });

    try {
      const { getCloudSyncStatus, startCloudSyncLoop, stopCloudSyncLoop } = await importCloudSyncModule();
      startCloudSyncLoop({ immediate: true });

      for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
      }

      expect(getBackendSessionStateImpl).toHaveBeenCalledTimes(1);
      expect(getCloudSyncStatus()).toMatchObject({
        state: 'syncing',
        reason: 'scheduled',
        lastFailureMessage: 'Failed to fetch',
      });
      expect(unhandled).toHaveLength(0);
      stopCloudSyncLoop();
    } finally {
      process.off('unhandledRejection', handleUnhandled);
    }
  });

  it('uses IndexedDB cursor when fallback localStorage is stale', async () => {
    const indexedStore = createMemoryStore({
      state: {
        cursor: 'indexed-cursor',
        bootstrapVersion: 2,
        records: {},
      },
    });
    localStorage.setItem(
      'vatioboard.cloud_sync.state',
      JSON.stringify({
        cursor: 'stale-fallback-cursor',
        bootstrapVersion: 2,
        records: {},
      })
    );
    const mocks = mockCloudSyncDependencies({
      indexedStore,
      pullRecords: [],
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: { open: vi.fn() },
    });

    const { syncCloudRecords } = await importCloudSyncModule();
    await syncCloudRecords();

    expect(mocks.pullSyncChangesFromBackend).toHaveBeenCalledWith(expect.objectContaining({
      cursor: 'indexed-cursor',
      limit: 100,
    }));
    expect(localStorage.getItem('vatioboard.cloud_sync.state')).toBeNull();
  });

  it('migrates newer fallback records into IndexedDB once', async () => {
    const indexedStore = createMemoryStore({
      state: {
        cursor: 'indexed-cursor',
        bootstrapVersion: 2,
        records: {
          'board_drawing:primary': {
            ...UNCHANGED_BOARD_RECORD,
            server_version: 268,
            content_hash: 'old-hash',
          },
        },
      },
    });
    localStorage.setItem(
      'vatioboard.cloud_sync.state',
      JSON.stringify({
        cursor: 'fallback-cursor',
        bootstrapVersion: 3,
        records: {
          'board_drawing:primary': UNCHANGED_BOARD_RECORD,
        },
      })
    );
    mockCloudSyncDependencies({
      indexedStore,
      pullRecords: [],
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: { open: vi.fn() },
    });

    const { syncCloudRecords } = await importCloudSyncModule();
    await syncCloudRecords();

    const storedState = indexedStore.values.get('state');
    expect(storedState.cursor).toBe('cursor-269');
    expect(storedState.bootstrapVersion).toBe(3);
    expect(storedState.records['board_drawing:primary']).toMatchObject({
      name: 'c1nmtb2o53',
      serverVersion: 269,
      contentHash: 'h308098074',
    });
    expect(localStorage.getItem('vatioboard.cloud_sync.state')).toBeNull();
  });

  it('ignores corrupted fallback state and continues syncing', async () => {
    localStorage.setItem('vatioboard.cloud_sync.state', '{not-json');
    const mocks = mockCloudSyncDependencies({
      pullRecords: [],
    });

    const { syncCloudRecords } = await importCloudSyncModule();

    await expect(syncCloudRecords()).resolves.toEqual({ ok: true });
    expect(mocks.pullSyncChangesFromBackend).toHaveBeenCalledTimes(1);
    expect(mocks.downloadSyncPayloadFromBackend).not.toHaveBeenCalled();
  });
});
