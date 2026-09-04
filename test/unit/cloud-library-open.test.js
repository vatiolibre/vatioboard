import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  openAccelFromCloud: vi.fn(),
  openBoardDocumentFromCloud: vi.fn(),
  openReplayFromCloud: vi.fn(),
}));

vi.mock('../../src/shared/repositories/replay-repository.js', () => ({
  openReplayFromCloud: mockState.openReplayFromCloud,
}));

vi.mock('../../src/shared/repositories/accel-repository.js', () => ({
  openAccelFromCloud: mockState.openAccelFromCloud,
}));

vi.mock('../../src/shared/repositories/board-document-repository.js', () => ({
  openBoardDocumentFromCloud: mockState.openBoardDocumentFromCloud,
}));

describe("cloud library open helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mockState).forEach((entry) => entry.mockReset());
  });

  it('delegates replay opens to the replay repository', async () => {
    mockState.openReplayFromCloud.mockResolvedValue(
      '/replay?record=local-replay-1&cloudRecord=SYNC-REPLAY-1'
    );

    const { openCloudReplaySession } = await import('../../src/shared/cloud-library-open.js');
    await expect(openCloudReplaySession('SYNC-REPLAY-1')).resolves.toBe(
      '/replay?record=local-replay-1&cloudRecord=SYNC-REPLAY-1'
    );

    expect(mockState.openReplayFromCloud).toHaveBeenCalledWith('SYNC-REPLAY-1');
  });

  it('passes replay open errors through unchanged', async () => {
    mockState.openReplayFromCloud.mockRejectedValue(Object.assign(new Error('bad replay'), {
      libraryStatusKey: 'cloudLibraryTelemetryUnavailable',
    }));

    const { openCloudReplaySession } = await import('../../src/shared/cloud-library-open.js');
    await expect(openCloudReplaySession('SYNC-REPLAY-1')).rejects.toMatchObject({
      libraryStatusKey: 'cloudLibraryTelemetryUnavailable',
    });
  });

  it('delegates accel opens to the accel repository', async () => {
    mockState.openAccelFromCloud.mockResolvedValue('/accel?run=local-run-1');

    const { openCloudAccelRun } = await import('../../src/shared/cloud-library-open.js');
    await expect(openCloudAccelRun('SYNC-ACCEL-1')).resolves.toBe('/accel?run=local-run-1');

    expect(mockState.openAccelFromCloud).toHaveBeenCalledWith('SYNC-ACCEL-1');
  });

  it('passes accel open errors through unchanged', async () => {
    mockState.openAccelFromCloud.mockRejectedValue(Object.assign(new Error('bad accel'), {
      libraryStatusKey: 'cloudLibraryTelemetryUnavailable',
    }));

    const { openCloudAccelRun } = await import('../../src/shared/cloud-library-open.js');
    await expect(openCloudAccelRun('SYNC-ACCEL-1')).rejects.toMatchObject({
      libraryStatusKey: 'cloudLibraryTelemetryUnavailable',
    });
  });

  it('delegates board document opens to the board document repository', async () => {
    mockState.openBoardDocumentFromCloud.mockResolvedValue('/');

    const { openCloudBoardDocument } = await import('../../src/shared/cloud-library-open.js');
    await expect(openCloudBoardDocument('BOARD-DOC-1')).resolves.toBe('/');

    expect(mockState.openBoardDocumentFromCloud).toHaveBeenCalledWith('BOARD-DOC-1');
  });

});
