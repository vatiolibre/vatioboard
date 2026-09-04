import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  downloadCloudSyncRecord: vi.fn(),
  getBackendSpeedRecordingDetail: vi.fn(),
  getDetail: vi.fn(),
  importReplaySession: vi.fn(),
  loadReplayRecords: vi.fn(),
  loadReplaySelection: vi.fn(),
  removeReplayRecording: vi.fn(),
}));

vi.mock('../../src/shared/backend-auth.js', () => ({
  getBackendSpeedRecordingDetail: mockState.getBackendSpeedRecordingDetail,
}));

vi.mock('../../src/shared/cloud-sync.js', () => ({
  CLOUD_SYNC_ENTITY_TYPES: {
    replaySession: 'replay_session',
  },
  downloadCloudSyncRecord: mockState.downloadCloudSyncRecord,
}));

vi.mock('../../src/shared/cloud-library-resources.js', () => ({
  CLOUD_LIBRARY_TAB_KEYS: {
    speed: 'speed',
  },
  cloudLibraryResources: {
    speed: {
      resource: {
        getDetail: mockState.getDetail,
      },
    },
  },
}));

vi.mock('../../src/replay/session.js', () => ({
  importReplaySession: mockState.importReplaySession,
  isReplayPayloadComplete: (session) => Array.isArray(session?.samples) && session.samples.length >= 2,
  loadReplayRecords: mockState.loadReplayRecords,
  loadReplaySelection: mockState.loadReplaySelection,
  removeReplayRecording: mockState.removeReplayRecording,
}));

describe('replay repository', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    Object.values(mockState).forEach((entry) => entry.mockReset());
    mockState.loadReplaySelection.mockResolvedValue({
      records: [],
      selectedRecordingId: null,
      source: null,
      session: null,
    });
  });

  it('serves a direct-open handoff immediately before persistence completes', async () => {
    mockState.importReplaySession.mockRejectedValue(new Error('storage failed'));
    mockState.getDetail.mockResolvedValue({
      record: { can_open: true },
      payload: {
        id: 'remote-replay-1',
        samples: [
          { timestampMs: 1000, latitude: 1, longitude: 1 },
          { timestampMs: 2000, latitude: 2, longitude: 2 },
        ],
      },
    });

    const { openReplayFromCloud, getReplaySelection } = await import(
      '../../src/shared/repositories/replay-repository.js'
    );

    await expect(openReplayFromCloud('SYNC-REPLAY-1')).resolves.toBe(
      '/replay?record=remote-replay-1&cloudRecord=SYNC-REPLAY-1'
    );

    await expect(getReplaySelection('remote-replay-1')).resolves.toMatchObject({
      selectedRecordingId: 'remote-replay-1',
      source: 'library',
      session: {
        id: 'remote-replay-1',
      },
    });
  });

  it('restores replay telemetry through cloud sync and persists it through storage', async () => {
    mockState.importReplaySession.mockResolvedValue({ id: 'replay-1' });
    mockState.downloadCloudSyncRecord.mockResolvedValue({
      ok: true,
      payload: {
        id: 'replay-1',
        samples: [
          { timestampMs: 1000, latitude: 1, longitude: 1 },
          { timestampMs: 2000, latitude: 2, longitude: 2 },
        ],
      },
    });

    const { ensureReplayTelemetry } = await import('../../src/shared/repositories/replay-repository.js');

    await expect(ensureReplayTelemetry('replay-1')).resolves.toMatchObject({
      restored: true,
      session: {
        id: 'replay-1',
      },
    });
    expect(mockState.importReplaySession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'replay-1' }),
      { saveLast: true }
    );
  });
});
