import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushTasks } from '../helpers/page-smoke.js';

const cloudSyncMocks = vi.hoisted(() => ({
  queueCloudSyncChange: vi.fn(async () => true),
  startCloudSyncLoop: vi.fn(),
  syncCloudRecords: vi.fn(async () => ({ ok: true })),
}));

const boardStorageMocks = vi.hoisted(() => ({
  clearCurrentBoardDocumentMeta: vi.fn(),
  loadBoardDrawing: vi.fn(async () => ({
    commands: [],
    redoCommands: [],
    updatedAtMs: 0,
  })),
  loadCurrentBoardDocumentMeta: vi.fn(() => null),
  saveBoardDrawing: vi.fn(async () => {}),
  saveCurrentBoardDocumentMeta: vi.fn(),
}));

vi.mock('../../src/shared/cloud-sync.js', () => ({
  CLOUD_SYNC_APPLIED_EVENT: 'vatioboard:cloud-sync-applied',
  CLOUD_SYNC_ENTITY_TYPES: {
    accelRun: 'accel_run',
    boardDrawing: 'board_drawing',
    replaySession: 'replay_session',
  },
  queueCloudSyncChange: cloudSyncMocks.queueCloudSyncChange,
  startCloudSyncLoop: cloudSyncMocks.startCloudSyncLoop,
  syncCloudRecords: cloudSyncMocks.syncCloudRecords,
}));

vi.mock('../../src/board/storage.js', () => boardStorageMocks);

vi.mock('../../src/shared/repositories/board-document-repository.js', () => ({
  consumeBoardDocumentOpen: vi.fn(async () => null),
  persistBoardDocumentSelection: vi.fn(),
}));

vi.mock('../../src/shared/backend-auth.js', async () => {
  const actual = await vi.importActual('../../src/shared/backend-auth.js');
  return {
    ...actual,
    initBackendAuthControllers: vi.fn(),
  };
});

async function settle(iterations = 10) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function createDeferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('Board cloud sync lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    document.head.innerHTML = '<meta name="description" content="Board test">';
    document.body.innerHTML = '<main id="root"></main><div id="persistent"></div>';
    window.__vatioboardSpa = true;
    delete window.__vatioboardFloatingTools;
    cloudSyncMocks.queueCloudSyncChange.mockClear();
    cloudSyncMocks.startCloudSyncLoop.mockClear();
    cloudSyncMocks.syncCloudRecords.mockClear();
    boardStorageMocks.clearCurrentBoardDocumentMeta.mockClear();
    boardStorageMocks.loadBoardDrawing.mockReset();
    boardStorageMocks.loadBoardDrawing.mockResolvedValue({
      commands: [],
      redoCommands: [],
      updatedAtMs: 0,
    });
    boardStorageMocks.loadCurrentBoardDocumentMeta.mockClear();
    boardStorageMocks.saveBoardDrawing.mockClear();
    boardStorageMocks.saveCurrentBoardDocumentMeta.mockClear();

    const { initFloatingTools } = await import('../../src/shared/floating-tools.js');
    initFloatingTools({ mount: document.getElementById('persistent') });
  }, 30000);

  it('mounts Board twice in SPA without raw sync or duplicate floating tools/listeners', async () => {
    const { mount } = await import('../../src/app/views/BoardView.js');
    const root = document.getElementById('root');

    const first = await mount(root, {
      routeSignal: new AbortController().signal,
    });
    await settle();

    expect(root.querySelector('#pad')).toBeTruthy();
    expect(document.querySelectorAll('.floating-dock')).toHaveLength(1);
    expect(cloudSyncMocks.startCloudSyncLoop).not.toHaveBeenCalled();
    expect(cloudSyncMocks.syncCloudRecords).not.toHaveBeenCalled();

    boardStorageMocks.loadBoardDrawing.mockClear();
    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'board_drawing',
        recordId: 'primary',
      },
    }));
    await settle();
    expect(boardStorageMocks.loadBoardDrawing).toHaveBeenCalledTimes(1);

    first.unmount();
    expect(root.children).toHaveLength(0);
    boardStorageMocks.loadBoardDrawing.mockClear();
    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'board_drawing',
        recordId: 'primary',
      },
    }));
    await settle();
    expect(boardStorageMocks.loadBoardDrawing).not.toHaveBeenCalled();

    const second = await mount(root, {
      routeSignal: new AbortController().signal,
    });
    await settle();
    expect(root.querySelector('#pad')).toBeTruthy();
    expect(document.querySelectorAll('.floating-dock')).toHaveLength(1);

    boardStorageMocks.loadBoardDrawing.mockClear();
    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'board_drawing',
        recordId: 'primary',
      },
    }));
    await settle();
    expect(boardStorageMocks.loadBoardDrawing).toHaveBeenCalledTimes(1);

    second.unmount();
  }, 40000);

  it('ignores a pending board hydrate after route unmount', async () => {
    const pendingLoad = createDeferred();
    boardStorageMocks.loadBoardDrawing.mockImplementationOnce(() => pendingLoad.promise);

    const { mount } = await import('../../src/app/views/BoardView.js');
    const root = document.getElementById('root');
    const routeController = new AbortController();
    const mounted = await mount(root, {
      routeSignal: routeController.signal,
    });

    routeController.abort();
    mounted.unmount();
    pendingLoad.resolve({
      commands: [{ type: 'clear' }],
      redoCommands: [],
      updatedAtMs: Date.now(),
    });
    await settle();

    expect(root.children).toHaveLength(0);
    expect(document.body.classList.contains('board-page')).toBe(false);
    expect(cloudSyncMocks.syncCloudRecords).not.toHaveBeenCalled();
  }, 40000);
});
