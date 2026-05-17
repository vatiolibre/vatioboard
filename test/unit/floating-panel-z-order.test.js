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
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
}

function zIndexOf(selector) {
  const panel = document.querySelector(selector);
  return Number.parseInt(panel?.style.zIndex || "0", 10);
}

function installWidgetMocks() {
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

async function loadWidgets() {
  vi.resetModules();
  installWidgetMocks();
  const [calculator, energy, player] = await Promise.all([
    import("../../src/calculator/calculator-widget.js"),
    import("../../src/energy/energy-calculator-widget.js"),
    import("../../src/player/player-widget.js"),
  ]);
  return {
    createCalculatorWidget: calculator.createCalculatorWidget,
    createEnergyCalculatorWidget: energy.createEnergyCalculatorWidget,
    createPlayerWidget: player.createPlayerWidget,
  };
}

describe("floating widget z-order", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opening calculator then player makes player topmost", async () => {
    const { createCalculatorWidget, createPlayerWidget } = await loadWidgets();
    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false });
    const player = createPlayerWidget({ floating: false, restoreVisibility: false });

    calc.open();
    player.open();
    await flushMicrotasks(20);

    expect(zIndexOf(".player-panel")).toBeGreaterThan(zIndexOf(".calc-panel"));

    player.destroy();
    calc.destroy();
  });

  it("opening player then calculator makes calculator topmost", async () => {
    const { createCalculatorWidget, createPlayerWidget } = await loadWidgets();
    const player = createPlayerWidget({ floating: false, restoreVisibility: false });
    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false });

    player.open();
    calc.open();
    await flushMicrotasks(20);

    expect(zIndexOf(".calc-panel")).toBeGreaterThan(zIndexOf(".player-panel"));

    player.destroy();
    calc.destroy();
  });

  it("touching the calculator after the player is open makes calculator topmost", async () => {
    const { createCalculatorWidget, createPlayerWidget } = await loadWidgets();
    const calc = createCalculatorWidget({ floating: false, restoreVisibility: false });
    const player = createPlayerWidget({ floating: false, restoreVisibility: false });

    calc.open();
    player.open();
    await flushMicrotasks(20);

    document.querySelector(".calc-panel").dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(zIndexOf(".calc-panel")).toBeGreaterThan(zIndexOf(".player-panel"));

    player.destroy();
    calc.destroy();
  });

  it("opening energy from calculator makes energy topmost", async () => {
    const { createCalculatorWidget, createEnergyCalculatorWidget } = await loadWidgets();
    const energy = createEnergyCalculatorWidget({ restoreVisibility: false });
    const calc = createCalculatorWidget({
      floating: false,
      restoreVisibility: false,
      onOpenEnergy: () => energy.toggle(),
    });

    calc.open();
    document.querySelector(".calc-energy-btn").click();

    expect(zIndexOf(".energy-panel")).toBeGreaterThan(zIndexOf(".calc-panel"));

    energy.destroy();
    calc.destroy();
  });

  it("opening Milkdrop from player makes Milkdrop topmost until the player is touched", async () => {
    const { createPlayerWidget } = await loadWidgets();
    const player = createPlayerWidget({ floating: false, restoreVisibility: false });

    player.open();
    document.querySelector(".player-milkdrop-toggle-btn").click();
    await vi.dynamicImportSettled();
    await flushMicrotasks(20);

    expect(document.querySelector(".milkdrop-panel")?.hidden).toBe(false);
    expect(zIndexOf(".milkdrop-panel")).toBeGreaterThan(zIndexOf(".player-panel"));

    document.querySelector(".player-panel").dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(zIndexOf(".player-panel")).toBeGreaterThan(zIndexOf(".milkdrop-panel"));

    player.destroy();
  });

  it("normal floating panels stay below taskbar and start menu layers", async () => {
    vi.resetModules();
    const [{ createShellWindowManager }, { SHELL_Z_INDEX }] = await Promise.all([
      import("../../src/shared/shell-window-manager.js"),
      import("../../src/shared/shell-layers.js"),
    ]);
    const manager = createShellWindowManager({ storeOptions: { storage: localStorage, migrateLegacy: false } });
    const panel = document.createElement("section");
    panel.hidden = false;
    document.body.append(panel);
    manager.registerWindow({ id: "calculator", element: panel });

    for (let index = 0; index < 1200; index += 1) {
      manager.activateWindow("calculator");
    }

    expect(Number(panel.style.zIndex)).toBeLessThan(SHELL_Z_INDEX.taskbar);
    expect(SHELL_Z_INDEX.taskbar).toBeLessThan(SHELL_Z_INDEX.startMenu);
    manager.destroy();
  });
});
