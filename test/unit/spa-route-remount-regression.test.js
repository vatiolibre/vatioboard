import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushTasks } from '../helpers/page-smoke.js';

const routeState = vi.hoisted(() => ({
  mounted: [],
  unmounted: [],
  contexts: [],
  staleWrites: [],
  shellManager: null,
  shellTaskbar: null,
  createPlayerWidget: vi.fn(() => ({
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    restoreVisibility: vi.fn(),
    destroy: vi.fn(),
  })),
  mount(name, routeContext) {
    const root = routeContext?.root;
    routeState.mounted.push(name);
    routeState.contexts.push({
      name,
      hasRoot: Boolean(root),
      hasCleanup: typeof routeContext?.cleanup?.add === 'function',
      hasSignal: Boolean(routeContext?.signal),
      hasContext: Boolean(routeContext?.context),
      pageName: routeContext?.pageName,
    });

    Promise.resolve().then(() => {
      if (routeContext?.signal?.aborted) return;
      root?.setAttribute?.('data-route-async-owner', name);
      routeState.staleWrites.push(name);
    });

    return {
      unmount() {
        routeState.unmounted.push(name);
      },
    };
  },
}));

vi.mock('../../src/player/player-widget.js', () => ({
  createPlayerWidget: routeState.createPlayerWidget,
}));

vi.mock('../../src/shared/backend-auth.js', () => ({
  BACKEND_AUTH_STATE_EVENT: 'vatioboard:backend-auth-state',
  getBackendSessionState: vi.fn(async () => ({
    ok: true,
    isGuest: false,
  })),
  initBackendAuthControllers: vi.fn(),
}));

vi.mock('../../src/shared/cloud-sync.js', () => ({
  CLOUD_SYNC_APPLIED_EVENT: 'vatioboard:cloud-sync-applied',
  CLOUD_SYNC_ENTITY_TYPES: {
    accelRun: 'accel_run',
    boardDrawing: 'board_drawing',
    replaySession: 'replay_session',
  },
  queueCloudSyncChange: vi.fn(async () => true),
  queueCloudSyncDeletion: vi.fn(async () => true),
  requestCloudSync: vi.fn(() => true),
  startCloudSyncLoop: vi.fn(),
}));

vi.mock('../../src/shared/single-tab.js', () => ({
  ensureSingleTabOwnership: vi.fn(() => Promise.resolve(true)),
  hasSingleTabOwnership: vi.fn(() => true),
  SINGLE_TAB_OWNERSHIP_EVENT: 'vatioboard:single-tab-ownership',
}));

vi.mock('../../src/board/board.js', () => ({
  mountBoardRoute: vi.fn((routeContext) => routeState.mount('board', routeContext)),
  unmountBoardRoute: vi.fn(),
}));

vi.mock('../../src/speed/speed.js', () => ({
  initPromise: Promise.resolve(),
  mountSpeedRoute: vi.fn((routeContext) => routeState.mount('speed', routeContext)),
  unmountSpeedRoute: vi.fn(),
}));

vi.mock('../../src/replay/replay.js', () => ({
  initPromise: Promise.resolve(),
  mountReplayRoute: vi.fn((routeContext) => routeState.mount('replay', routeContext)),
  unmountReplayRoute: vi.fn(),
}));

vi.mock('../../src/accel/accel.js', () => ({
  initPromise: Promise.resolve(),
  mountAccelRoute: vi.fn((routeContext) => routeState.mount('accel', routeContext)),
  unmountAccelRoute: vi.fn(),
}));

vi.mock('../../src/library/library.js', () => ({
  initPromise: Promise.resolve(),
  mountLibraryRoute: vi.fn((routeContext) => routeState.mount('library', routeContext)),
  unmountLibraryRoute: vi.fn(),
}));

async function settle(iterations = 12) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

const routeViews = {
  '#/board': () => import('../../src/app/views/BoardView.js'),
  '#/speed': () => import('../../src/app/views/SpeedView.js'),
  '#/replay': () => import('../../src/app/views/ReplayView.js'),
  '#/accel': () => import('../../src/app/views/AccelView.js'),
  '#/library': () => import('../../src/app/views/LibraryView.js'),
};

let activeView = null;
let activeRouteController = null;

async function bootRouteHarness() {
  document.head.innerHTML = '<meta name="description" content="Route test">';
  document.body.innerHTML = '<main id="app-view" aria-live="polite"></main><div id="app-persistent-layer"></div>';
  window.__vatioboardSpa = true;
  window.history.replaceState({}, '', 'https://vatioboard.com/#/board');

  const { initFloatingTools } = await import('../../src/shared/floating-tools.js');
  const { initSharedStartMenu } = await import('../../src/shared/start-menu.js');
  const { createShellWindowManager } = await import('../../src/shared/shell-window-manager.js');
  const { createShellTaskbar } = await import('../../src/shared/shell-taskbar.js');
  const persistentLayer = document.getElementById('app-persistent-layer');
  const floatingTools = initFloatingTools({ mount: persistentLayer });
  const startMenu = initSharedStartMenu({ floatingTools, mount: persistentLayer });
  routeState.shellManager = createShellWindowManager({
    root: persistentLayer,
    storeOptions: { storage: localStorage, migrateLegacy: false },
  });
  routeState.shellTaskbar = createShellTaskbar({
    shellManager: routeState.shellManager,
    root: persistentLayer,
    startMenu,
  });
}

async function navigateHash(hash) {
  activeRouteController?.abort();
  activeView?.unmount?.();
  activeView = null;
  activeRouteController = new AbortController();
  window.location.hash = hash;
  const loaded = await routeViews[hash]();
  activeView = await loaded.mount(currentRouteRoot(), {
    route: { path: hash.replace(/^#/, '') },
    routeSignal: activeRouteController.signal,
    navigate: vi.fn(),
    emitRouteVisible: vi.fn(),
  });
  await settle();
}

function currentRouteRoot() {
  return document.getElementById('app-view');
}

const routeSelectors = {
  board: '#pad',
  speed: '#speedValue',
  replay: '#replayShell',
  accel: '#armRun',
  library: '#libraryList',
};

const routeBodyClasses = {
  board: 'board-page',
  speed: 'speed-page',
  replay: 'replay-page',
  accel: 'accel-page',
  library: 'library-page',
};

async function expectRouteUsable(name) {
  const root = currentRouteRoot();
  expect(root.children.length).toBeGreaterThan(0);
  expect(root.querySelector(routeSelectors[name])).toBeTruthy();
  expect(document.body.classList.contains(routeBodyClasses[name])).toBe(true);

  expect(root.querySelector('#speedToolsMenuBtn, #replayToolsMenuBtn, #accelToolsMenuBtn, #libraryToolsMenuBtn, #toolsMenuBtn')).toBeNull();
  const startButton = document.querySelector('[data-vb-shell-start-button]');
  expect(startButton).toBeTruthy();
  expect(startButton.getAttribute('aria-controls')).toBe('appStartMenuList');
  window.__vatioboardStartMenu.setOpen(true, startButton);
  await flushTasks();
  expect(document.getElementById('appStartMenuList')?.hidden).toBe(false);
  expect(document.querySelector("[data-start-route='/board']")).toBeTruthy();
}

describe('SPA route remount regression coverage', () => {
  beforeEach(() => {
    window.__vatioboardRouter?.destroy?.();
    delete window.__vatioboardRouter;
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardPlayerWidget;
    delete window.__vatioboardStartMenu;
    routeState.shellTaskbar?.destroy?.();
    routeState.shellManager?.destroy?.();
    routeState.shellTaskbar = null;
    routeState.shellManager = null;
    routeState.mounted = [];
    routeState.unmounted = [];
    routeState.contexts = [];
    routeState.staleWrites = [];
    routeState.createPlayerWidget.mockClear();
    vi.resetModules();
    localStorage.clear();
    activeView = null;
    activeRouteController = null;
  });

  it.each([
    ['#/board', '#/speed', 'speed'],
    ['#/board', '#/replay', 'replay'],
    ['#/board', '#/accel', 'accel'],
    ['#/board', '#/library', 'library'],
    ['#/board', '#/speed', 'speed', '#/board', 'board', '#/speed', 'speed'],
    ['#/board', '#/replay', 'replay', '#/board', 'board', '#/replay', 'replay'],
    ['#/board', '#/accel', 'accel', '#/board', 'board', '#/accel', 'accel'],
    ['#/board', '#/library', 'library', '#/board', 'board', '#/library', 'library'],
  ])('keeps route DOM usable through %s -> %s remount cycle', async (...sequence) => {
    await bootRouteHarness();
    await navigateHash(sequence[0]);
    await expectRouteUsable('board');

    for (let index = 1; index < sequence.length; index += 2) {
      const hash = sequence[index];
      const expectedRoute = sequence[index + 1];
      await navigateHash(hash);
      await expectRouteUsable(expectedRoute);
    }

    const finalRoute = sequence.at(-1);
    const previousRouteNames = ['board', 'speed', 'replay', 'accel', 'library'].filter(
      (name) => name !== finalRoute
    );
    for (const previousRoute of previousRouteNames) {
      expect(currentRouteRoot().querySelector(routeSelectors[previousRoute])).toBeNull();
      expect(document.body.classList.contains(routeBodyClasses[previousRoute])).toBe(false);
    }

    expect(document.querySelectorAll('.floating-dock')).toHaveLength(0);
    expect(document.querySelectorAll('.calc-panel')).toHaveLength(1);
    expect(document.querySelectorAll('.energy-panel')).toHaveLength(1);
    expect(routeState.contexts.every((context) => (
      context.hasRoot
      && context.hasCleanup
      && context.hasSignal
      && context.hasContext
      && context.pageName
    ))).toBe(true);
    expect(currentRouteRoot().dataset.routeAsyncOwner).toBe(finalRoute);
  }, 40000);
});
