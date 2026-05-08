import { afterEach, describe, expect, it, vi } from "vitest";

function makeRuntimeState(overrides = {}) {
  return {
    queue: [],
    currentIndex: -1,
    currentTrack: null,
    paused: true,
    volume: 1,
    muted: false,
    repeat: "off",
    shuffle: false,
    backgroundMode: false,
    sourceType: null,
    loading: false,
    error: null,
    currentTime: 0,
    duration: 0,
    playing: false,
    ...overrides,
  };
}

const runtimeMock = {
  getAudioElement: vi.fn(() => document.createElement("audio")),
  getState: vi.fn(() => makeRuntimeState()),
  subscribe: vi.fn(() => vi.fn()),
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  nextTrack: vi.fn().mockResolvedValue(undefined),
  previousTrack: vi.fn().mockResolvedValue(undefined),
  seekTo: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  toggleShuffle: vi.fn(),
  cycleRepeat: vi.fn(),
  playCatalogTrack: vi.fn().mockResolvedValue(undefined),
  playLibraryTrackNow: vi.fn().mockResolvedValue(undefined),
  setQueue: vi.fn(),
  restoreSession: vi.fn().mockResolvedValue(undefined),
  primeAudio: vi.fn().mockResolvedValue(true),
  stopPlayback: vi.fn(),
  updatePlayerMediaSessionMetadata: vi.fn(),
};

const catalogMock = {
  loadAudioCatalog: vi.fn().mockResolvedValue({ tracks: [], total: 0 }),
  syncAudioCatalog: vi.fn().mockResolvedValue(false),
  annotateOfflineAvailability: vi.fn((tracks) => Promise.resolve(tracks || [])),
  isAudioAsset: vi.fn(() => true),
};

const playlistMock = {
  loadPlaylists: vi.fn().mockResolvedValue({ playlists: [], total: 0 }),
  syncPlaylistsManifest: vi.fn().mockResolvedValue(false),
  loadPlaylistDetail: vi.fn().mockResolvedValue(null),
};

const demoCacheMock = {
  loadDemoPlaylist: vi.fn().mockResolvedValue({
    tracks: [],
    source: "empty",
    cachedAt: 0,
    signature: "",
  }),
  syncDemoPlaylist: vi.fn().mockResolvedValue({
    refreshed: false,
    changed: false,
    tracks: [],
    source: "empty",
  }),
};

async function flushMicrotasks(n = 10) {
  for (let index = 0; index < n; index += 1) {
    await Promise.resolve();
  }
}

function installMocks() {
  vi.doMock("../../src/i18n.js", () => ({
    t: (key) => key,
    getLang: () => "en",
    toggleLang: vi.fn(),
    applyTranslations: vi.fn(),
  }));

  vi.doMock("../../src/shared/environment.js", () => ({
    getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
  }));

  vi.doMock("../../src/shared/audio-runtime.js", () => runtimeMock);
  vi.doMock("../../src/shared/audio-catalog.js", () => catalogMock);
  vi.doMock("../../src/shared/playlist-loader.js", () => playlistMock);
  vi.doMock("../../src/shared/demo-cache.js", () => demoCacheMock);

  vi.doMock("../../src/shared/backend-auth.js", () => ({
    BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
    getBackendSessionState: vi.fn().mockResolvedValue({ authenticated: false, isGuest: true }),
    fetchBackendLoggedUser: vi.fn().mockResolvedValue(null),
    getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false }),
    getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
    getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
    getProtectedMediaRequestGate: vi.fn().mockResolvedValue({ allowed: false, cleanup: vi.fn() }),
    createBackendPlaylist: vi.fn().mockResolvedValue({ ok: false }),
    bulkAddBackendPlaylistItems: vi.fn().mockResolvedValue({ ok: false }),
    fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    getBackendPlaylistsManifest: vi.fn().mockResolvedValue({ ok: false, playlists: [] }),
    getBackendPlaylistsManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
    getBackendPlaylistDetail: vi.fn().mockResolvedValue({ ok: false }),
  }));

  vi.doMock("../../src/shared/media-cache.js", () => ({
    setMediaCacheUser: vi.fn(),
    getMediaCacheUser: vi.fn().mockReturnValue(null),
    restorePersistedMediaCacheUser: vi.fn().mockReturnValue(null),
    clearPersistedMediaCacheUser: vi.fn(),
    getCachedManifestSnapshot: vi.fn().mockResolvedValue(null),
    getCachedMediaManifest: vi.fn().mockResolvedValue(null),
    cacheManifestSnapshot: vi.fn().mockResolvedValue(true),
    getLocalMediaBlob: vi.fn().mockResolvedValue(null),
    getLocalBlobMeta: vi.fn().mockResolvedValue(null),
    isAutoCacheEligible: vi.fn().mockReturnValue(false),
    registerAutoCacheDownload: vi.fn(),
    cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
    pinMediaBlob: vi.fn().mockResolvedValue(true),
    pinMediaFromResponse: vi.fn().mockResolvedValue(true),
    unpinMediaBlob: vi.fn().mockResolvedValue(true),
    isMediaBlobPinned: vi.fn().mockResolvedValue(false),
    getCachedMediaBlob: vi.fn().mockResolvedValue(null),
    getCachedBlobMeta: vi.fn().mockResolvedValue(null),
    removeCachedMediaBlob: vi.fn().mockResolvedValue(undefined),
  }));

  vi.doMock("../../src/shared/media-access-cache.js", () => ({
    getCachedMediaAccess: vi.fn().mockReturnValue(null),
    setCachedMediaAccess: vi.fn(),
    clearMediaAccessCache: vi.fn(),
  }));

  vi.doMock("../../src/shared/audio-graph-registry.js", () => ({
    primeAudioContext: vi.fn(),
    acquireGraph: vi.fn().mockResolvedValue(null),
    releaseGraph: vi.fn(),
  }));

  vi.doMock("../../src/shared/audio-visualizer.js", () => ({
    isVisualizerSafeSource: vi.fn(() => true),
  }));

  vi.doMock("butterchurn", () => ({
    default: {
      createVisualizer: vi.fn(() => ({
        connectAudio: vi.fn(),
        loadPreset: vi.fn(),
        setRendererSize: vi.fn(),
        render: vi.fn(),
      })),
    },
  }));

  vi.doMock("butterchurn-presets", () => ({
    default: {
      getPresets: () => ({
        "Preset A": { name: "Preset A" },
      }),
    },
  }));
}

async function loadModules() {
  vi.resetModules();
  installMocks();
  const [
    shell,
    calculator,
    energy,
    player,
    milkdrop,
    floatingTools,
  ] = await Promise.all([
    import("../../src/shared/shell-window-manager.js"),
    import("../../src/calculator/calculator-widget.js"),
    import("../../src/energy/energy-calculator-widget.js"),
    import("../../src/player/player-widget.js"),
    import("../../src/player/milkdrop-panel.js"),
    import("../../src/shared/floating-tools.js"),
  ]);
  return {
    createShellWindowManager: shell.createShellWindowManager,
    createCalculatorWidget: calculator.createCalculatorWidget,
    createEnergyCalculatorWidget: energy.createEnergyCalculatorWidget,
    createPlayerWidget: player.createPlayerWidget,
    createMilkdropPanel: milkdrop.createMilkdropPanel,
    initFloatingTools: floatingTools.initFloatingTools,
  };
}

describe("shell window integration", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete window.__vatioboardFloatingTools;
    vi.restoreAllMocks();
  });

  it("calculator, energy, player, and milkdrop register as shell windows", async () => {
    const {
      createShellWindowManager,
      createCalculatorWidget,
      createEnergyCalculatorWidget,
      createPlayerWidget,
      createMilkdropPanel,
    } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });

    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false, shellManager: manager });
    const energy = createEnergyCalculatorWidget({ restoreVisibility: false, shellManager: manager });
    const player = createPlayerWidget({ floating: false, restoreVisibility: false, shellManager: manager });
    const milkdrop = createMilkdropPanel({ restoreVisibility: false, shellManager: manager });

    expect(manager.listWindows().map((record) => record.id).sort()).toEqual([
      "calculator",
      "energy",
      "milkdrop",
      "player",
    ]);

    milkdrop.destroy();
    player.destroy();
    energy.destroy();
    calc.destroy();
    manager.destroy();
  });

  it("last opened shell window is active/topmost", async () => {
    const { createShellWindowManager, createCalculatorWidget, createPlayerWidget } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false, shellManager: manager });
    const player = createPlayerWidget({ floating: false, restoreVisibility: false, shellManager: manager });

    manager.openWindow("calculator");
    manager.openWindow("player");

    expect(manager.getActiveWindow().id).toBe("player");
    expect(Number(document.querySelector(".player-panel").style.zIndex))
      .toBeGreaterThan(Number(document.querySelector(".calc-panel").style.zIndex));

    player.destroy();
    calc.destroy();
    manager.destroy();
  });

  it("touching inactive shell window activates it", async () => {
    const { createShellWindowManager, createCalculatorWidget, createPlayerWidget } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false, shellManager: manager });
    const player = createPlayerWidget({ floating: false, restoreVisibility: false, shellManager: manager });

    manager.openWindow("calculator");
    manager.openWindow("player");
    document.querySelector(".calc-panel").dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(manager.getActiveWindow().id).toBe("calculator");

    player.destroy();
    calc.destroy();
    manager.destroy();
  });

  it("minimizing player hides it while runtime state remains alive", async () => {
    const { createShellWindowManager, createPlayerWidget } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const player = createPlayerWidget({ floating: false, restoreVisibility: false, shellManager: manager });

    manager.openWindow("player");
    manager.minimizeWindow("player");

    expect(document.querySelector(".player-panel").hidden).toBe(true);
    expect(runtimeMock.pause).not.toHaveBeenCalled();
    expect(runtimeMock.stopPlayback).not.toHaveBeenCalled();

    player.destroy();
    manager.destroy();
  });

  it("restoring player does not duplicate lazy audio bootstrap", async () => {
    const { createShellWindowManager, createPlayerWidget } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const player = createPlayerWidget({
      floating: false,
      restoreVisibility: false,
      preload: "on-open",
      shellManager: manager,
    });

    catalogMock.loadAudioCatalog.mockClear();
    manager.openWindow("player");
    await flushMicrotasks(20);
    manager.minimizeWindow("player");
    manager.restoreWindow("player");
    await flushMicrotasks(20);

    expect(catalogMock.loadAudioCatalog).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".player-panel").hidden).toBe(false);

    player.destroy();
    manager.destroy();
  });

  it("Milkdrop open, resize, and snap persist in shell layout", async () => {
    const { createShellWindowManager, createMilkdropPanel } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const milkdrop = createMilkdropPanel({ restoreVisibility: false, shellManager: manager });

    await manager.openWindow("milkdrop");
    manager.updateWindowBounds("milkdrop", { left: 88, top: 90, width: 520, height: 390 });
    manager.snapWindow("milkdrop", "right", { viewport: { width: 1000, height: 700 }, flush: true });

    const saved = JSON.parse(localStorage.getItem("vatioboard.shell.layout.v1")).windows.milkdrop;
    expect(saved.snap).toMatchObject({ zone: "right" });
    expect(saved.bounds).toMatchObject({ left: 500, top: 16, width: 484, height: 668 });

    milkdrop.destroy();
    manager.destroy();
  });

  it("route remount does not duplicate persistent shell windows", async () => {
    const { createShellWindowManager, initFloatingTools } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    initFloatingTools({ mount, shellManager: manager });
    initFloatingTools({ mount, shellManager: manager });

    expect(document.querySelectorAll(".floating-dock")).toHaveLength(1);
    expect(manager.listWindows().filter((record) => ["calculator", "energy"].includes(record.id))).toHaveLength(2);
    manager.destroy();
  });

  it("persistent shell layout restores after simulated app reload", async () => {
    const { createShellWindowManager, createCalculatorWidget } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false, shellManager: manager });
    manager.openWindow("calculator");
    manager.updateWindowBounds("calculator", { left: 123, top: 77, width: 320, height: 240 }, { flush: true });
    calc.destroy();
    manager.destroy();

    const modules = await loadModules();
    const nextManager = modules.createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const nextCalc = modules.createCalculatorWidget({ floating: false, restoreVisibility: false, shellManager: nextManager });
    nextManager.restoreShellLayout();

    const panel = document.querySelector(".calc-panel");
    expect(panel.hidden).toBe(false);
    expect(panel.style.left).toBe("123px");
    expect(panel.style.top).toBe("77px");

    nextCalc.destroy();
    nextManager.destroy();
  });

  it("dock button toggles calculator via shell manager", async () => {
    const { createShellWindowManager, initFloatingTools } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const tools = initFloatingTools({ mount: document.body, shellManager: manager });

    tools.calcBtn.click();

    expect(manager.getWindow("calculator").state).toBe("open");
    expect(document.querySelector(".calc-panel").hidden).toBe(false);
    manager.destroy();
  });

  it("confirm dialog layer remains above shell windows", async () => {
    const { createShellWindowManager, createCalculatorWidget } = await loadModules();
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false, shellManager: manager });

    for (let index = 0; index < 1200; index += 1) {
      manager.openWindow("calculator");
    }

    expect(Number(document.querySelector(".calc-panel").style.zIndex)).toBeLessThan(2000);

    calc.destroy();
    manager.destroy();
  });
});

