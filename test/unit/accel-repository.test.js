import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  downloadCloudSyncRecord: vi.fn(),
  getDetail: vi.fn(),
  importRun: vi.fn(),
  loadRuns: vi.fn(),
  saveRuns: vi.fn(),
}));

vi.mock('../../src/shared/cloud-sync.js', () => ({
  CLOUD_SYNC_ENTITY_TYPES: {
    accelRun: 'accel_run',
  },
  downloadCloudSyncRecord: mockState.downloadCloudSyncRecord,
}));

vi.mock('../../src/shared/cloud-library-resources.js', () => ({
  CLOUD_LIBRARY_TAB_KEYS: {
    accel: 'accel',
  },
  cloudLibraryResources: {
    accel: {
      resource: {
        getDetail: mockState.getDetail,
      },
    },
  },
}));

vi.mock('../../src/accel/storage.js', () => ({
  importRun: mockState.importRun,
  isAccelPayloadComplete: (run) => Boolean(
    Array.isArray(run?.sampleLog) && run.sampleLog.length >= 2
    || Array.isArray(run?.speedTrace) && run.speedTrace.length >= 2
  ),
  loadRuns: mockState.loadRuns,
  saveRuns: mockState.saveRuns,
}));

describe('accel repository', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    Object.values(mockState).forEach((entry) => entry.mockReset());
    mockState.loadRuns.mockResolvedValue([]);
  });

  it('uses the direct-open handoff to select a full accel payload immediately', async () => {
    mockState.importRun.mockRejectedValue(new Error('storage failed'));
    mockState.getDetail.mockResolvedValue({
      record: { can_open: true },
      payload: {
        id: 'run-1',
        sampleLog: [
          { elapsedFromStartMs: 0, speedMs: 0 },
          { elapsedFromStartMs: 4200, speedMs: 26.8 },
        ],
      },
    });

    const { getAccelSelection, openAccelFromCloud } = await import(
      '../../src/shared/repositories/accel-repository.js'
    );

    await expect(openAccelFromCloud('SYNC-ACCEL-1')).resolves.toBe('/accel?run=run-1');
    await expect(getAccelSelection('run-1')).resolves.toMatchObject({
      selectedResultId: 'run-1',
      run: {
        id: 'run-1',
      },
    });
  });

  it('restores accel telemetry through cloud sync and persists it through storage', async () => {
    mockState.importRun.mockResolvedValue({ id: 'run-1' });
    mockState.downloadCloudSyncRecord.mockResolvedValue({
      ok: true,
      payload: {
        id: 'run-1',
        sampleLog: [
          { elapsedFromStartMs: 0, speedMs: 0 },
          { elapsedFromStartMs: 4200, speedMs: 26.8 },
        ],
      },
    });

    const { ensureAccelTelemetry } = await import('../../src/shared/repositories/accel-repository.js');

    await expect(ensureAccelTelemetry('run-1')).resolves.toMatchObject({
      restored: true,
      run: {
        id: 'run-1',
      },
    });
    expect(mockState.importRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1' }), {});
  });
});
