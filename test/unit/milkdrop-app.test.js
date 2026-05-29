import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioElement = document.createElement("audio");
const defaultAudioState = {
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
};

const audioRuntimeMock = {
  getAudioElement: vi.fn(() => audioElement),
  getState: vi.fn(() => ({ ...defaultAudioState })),
  subscribe: vi.fn(() => vi.fn()),
  setMediaSessionEnabled: vi.fn(),
  play: vi.fn().mockResolvedValue(true),
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
  playTrackByName: vi.fn().mockResolvedValue(undefined),
  playNext: vi.fn(),
  setQueue: vi.fn(),
  restoreSession: vi.fn().mockResolvedValue(undefined),
  primeAudio: vi.fn().mockResolvedValue(true),
  stopPlayback: vi.fn(),
  updatePlayerMediaSessionMetadata: vi.fn(),
};

const visualizerMock = {
  connectAudio: vi.fn(),
  loadPreset: vi.fn(),
  setRendererSize: vi.fn(),
  render: vi.fn(),
};
const createVisualizerMock = vi.fn(() => visualizerMock);
const acquireGraphMock = vi.fn(async () => ({
  audioContext: {
    state: "running",
    destination: {},
    createAnalyser: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 256,
      frequencyBinCount: 128,
    })),
    resume: vi.fn(async () => "running"),
  },
  sourceNode: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));
const releaseGraphMock = vi.fn();

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

async function flushMicrotasks(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function installMilkdropMocks() {
  vi.doMock("../../src/i18n.js", () => ({
    t: (key) => key,
    getLang: () => "en",
    toggleLang: vi.fn(),
    applyTranslations: vi.fn(),
  }));

  vi.doMock("../../src/shared/audio-runtime.js", () => audioRuntimeMock);
  vi.doMock("../../src/shared/audio-graph-registry.js", () => ({
    acquireGraph: acquireGraphMock,
    releaseGraph: releaseGraphMock,
    primeAudioContext: vi.fn(),
  }));
  vi.doMock("../../src/shared/audio-visualizer.js", () => ({
    isVisualizerSafeSource: vi.fn(() => true),
  }));

  vi.doMock("butterchurn", () => ({
    default: {
      createVisualizer: createVisualizerMock,
    },
  }));
  vi.doMock("butterchurn-presets", () => ({
    default: {
      getPresets: () => ({
        "Preset A": { name: "Preset A" },
        "Preset B": { name: "Preset B" },
      }),
    },
  }));

  vi.doMock("../../src/shared/environment.js", () => ({
    getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
  }));
  vi.doMock("../../src/shared/audio-catalog.js", () => catalogMock);
  vi.doMock("../../src/shared/playlist-loader.js", () => playlistMock);
  vi.doMock("../../src/shared/demo-cache.js", () => demoCacheMock);
  vi.doMock("../../src/shared/backend-auth.js", () => ({
    BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
    getBackendSessionState: vi.fn().mockResolvedValue({ authenticated: false, isGuest: true }),
    fetchBackendLoggedUser: vi.fn().mockResolvedValue(null),
    getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false }),
    getProtectedMediaRequestGate: vi.fn().mockResolvedValue({ allowed: false, cleanup: vi.fn() }),
    createBackendPlaylist: vi.fn().mockResolvedValue({ ok: false }),
    bulkAddBackendPlaylistItems: vi.fn().mockResolvedValue({ ok: false }),
    fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
  }));
  vi.doMock("../../src/shared/media-cache.js", () => ({
    setMediaCacheUser: vi.fn(),
    getMediaCacheUser: vi.fn().mockReturnValue(null),
    restorePersistedMediaCacheUser: vi.fn().mockReturnValue(null),
    clearPersistedMediaCacheUser: vi.fn(),
    pinMediaBlob: vi.fn().mockResolvedValue(true),
    pinMediaFromResponse: vi.fn().mockResolvedValue(true),
    unpinMediaBlob: vi.fn().mockResolvedValue(true),
    isMediaBlobPinned: vi.fn().mockResolvedValue(false),
    getCachedMediaBlob: vi.fn().mockResolvedValue(null),
    getCachedBlobMeta: vi.fn().mockResolvedValue(null),
    removeCachedMediaBlob: vi.fn().mockResolvedValue(undefined),
  }));
}

async function loadModules() {
  vi.resetModules();
  installMilkdropMocks();
  const [
    appPlatform,
    shell,
    milkdropApp,
    milkdropPanel,
    playerApp,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/shared/shell-window-manager.js"),
    import("../../src/apps/milkdrop/index.js"),
    import("../../src/player/milkdrop-panel.js"),
    import("../../src/apps/player/index.js"),
  ]);
  return {
    ...appPlatform,
    createShellWindowManager: shell.createShellWindowManager,
    createMilkdropApp: milkdropApp.createMilkdropApp,
    MILKDROP_APP_ID: milkdropApp.MILKDROP_APP_ID,
    MILKDROP_VISIBILITY_SETTING_KEY: milkdropApp.MILKDROP_VISIBILITY_SETTING_KEY,
    createMilkdropPanel: milkdropPanel.createMilkdropPanel,
    MILKDROP_PANEL_VISIBILITY_KEY: (await import("../../src/player/milkdrop-panel-prefs.js")).MILKDROP_PANEL_VISIBILITY_KEY,
    createPlayerApp: playerApp.createPlayerApp,
    PLAYER_APP_ID: playerApp.PLAYER_APP_ID,
  };
}

function createShellHarness(modules, baseContext = { audioRuntime: audioRuntimeMock }) {
  const shellManager = modules.createShellWindowManager({
    root: document.body,
    storeOptions: { storage: localStorage, migrateLegacy: false },
  });
  const shellAppRuntimeManager = modules.createShellAppRuntimeManager({
    shellManager,
    baseContext,
  });
  const launcher = modules.createAppLauncher({
    shellManager,
    shellAppRuntimeManager,
  });
  shellAppRuntimeManager.setLauncher(launcher);
  return { shellManager, shellAppRuntimeManager, launcher };
}

describe("Milkdrop OS app module", () => {
  let originalGetContext;
  let originalResizeObserver;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    audioElement.removeAttribute("src");
    audioRuntimeMock.getAudioElement.mockClear();
    audioRuntimeMock.getAudioElement.mockReturnValue(audioElement);
    audioRuntimeMock.getState.mockClear();
    audioRuntimeMock.getState.mockReturnValue({ ...defaultAudioState });
    audioRuntimeMock.subscribe.mockClear();
    audioRuntimeMock.subscribe.mockReturnValue(vi.fn());
    audioRuntimeMock.setMediaSessionEnabled.mockClear();
    createVisualizerMock.mockClear();
    visualizerMock.connectAudio.mockClear();
    visualizerMock.loadPreset.mockClear();
    visualizerMock.setRendererSize.mockClear();
    visualizerMock.render.mockClear();
    acquireGraphMock.mockClear();
    releaseGraphMock.mockClear();
    catalogMock.loadAudioCatalog.mockClear();
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });
    catalogMock.syncAudioCatalog.mockClear();
    catalogMock.syncAudioCatalog.mockResolvedValue(false);
    catalogMock.annotateOfflineAvailability.mockClear();
    catalogMock.annotateOfflineAvailability.mockImplementation((tracks) => Promise.resolve(tracks || []));
    playlistMock.loadPlaylists.mockClear();
    playlistMock.loadPlaylists.mockResolvedValue({ playlists: [], total: 0 });
    playlistMock.syncPlaylistsManifest.mockClear();
    playlistMock.syncPlaylistsManifest.mockResolvedValue(false);
    demoCacheMock.loadDemoPlaylist.mockClear();
    demoCacheMock.loadDemoPlaylist.mockResolvedValue({
      tracks: [],
      source: "empty",
      cachedAt: 0,
      signature: "",
    });
    demoCacheMock.syncDemoPlaylist.mockClear();
    demoCacheMock.syncDemoPlaylist.mockResolvedValue({
      refreshed: false,
      changed: false,
      tracks: [],
      source: "empty",
    });

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalResizeObserver = window.ResizeObserver;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    HTMLCanvasElement.prototype.getContext = vi.fn(function getContext(type) {
      if (type === "webgl2" || type === "webgl") return { canvas: this };
      return originalGetContext.call(this, type);
    });
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    window.requestAnimationFrame = vi.fn(() => 1);
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("opens vatio.milkdrop through the manifest-backed launcher and creates a runtime", async () => {
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const milkdrop = modules.createMilkdropApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(milkdrop.runtime?.appId).toBe(modules.MILKDROP_APP_ID);
    expect(shellAppRuntimeManager.getRuntime(modules.MILKDROP_APP_ID)).toBe(milkdrop.runtime);
    expect(audioRuntimeMock.getState).toHaveBeenCalled();
    expect(launcher.openApp(modules.MILKDROP_APP_ID)).toBe(true);

    expect(shellManager.getWindow("milkdrop")?.state).toBe("open");
    expect(document.querySelector(".milkdrop-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(modules.MILKDROP_APP_ID)?.lifecycle.getState()).toBe("active");

    milkdrop.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps shell taskbar minimize, restore, and close behavior intact", async () => {
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const milkdrop = modules.createMilkdropApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(modules.MILKDROP_APP_ID);

    shellManager.minimizeWindow("milkdrop");
    expect(shellManager.getWindow("milkdrop")?.state).toBe("minimized");
    expect(document.querySelector(".milkdrop-panel")?.hidden).toBe(true);

    shellManager.restoreWindow("milkdrop");
    expect(shellManager.getWindow("milkdrop")?.state).toBe("open");
    expect(document.querySelector(".milkdrop-panel")?.hidden).toBe(false);

    shellManager.closeWindow("milkdrop");
    expect(shellManager.getWindow("milkdrop")?.state).toBe("closed");
    expect(document.querySelector(".milkdrop-panel")?.hidden).toBe(true);

    milkdrop.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("mirrors Milkdrop visibility through runtime settings while preserving the legacy key", async () => {
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager } = createShellHarness(modules);
    const milkdrop = modules.createMilkdropApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    await milkdrop.open();
    expect(localStorage.getItem(modules.MILKDROP_PANEL_VISIBILITY_KEY)).toBe("true");
    expect(
      localStorage.getItem(`vatioboard.app.${modules.MILKDROP_APP_ID}.settings.${modules.MILKDROP_VISIBILITY_SETTING_KEY}`),
    ).toBe("true");

    milkdrop.close();
    expect(localStorage.getItem(modules.MILKDROP_PANEL_VISIBILITY_KEY)).toBe("false");
    expect(
      localStorage.getItem(`vatioboard.app.${modules.MILKDROP_APP_ID}.settings.${modules.MILKDROP_VISIBILITY_SETTING_KEY}`),
    ).toBe("false");

    milkdrop.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("lets the legacy visibility key win over stale runtime mirrors", async () => {
    const modules = await loadModules();
    localStorage.setItem(modules.MILKDROP_PANEL_VISIBILITY_KEY, "false");
    localStorage.setItem(
      `vatioboard.app.${modules.MILKDROP_APP_ID}.settings.${modules.MILKDROP_VISIBILITY_SETTING_KEY}`,
      "true",
    );
    const { shellManager, shellAppRuntimeManager } = createShellHarness(modules);
    const milkdrop = modules.createMilkdropApp({
      mount: document.body,
      restoreVisibility: true,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(milkdrop.isOpen()).toBe(false);
    expect(
      localStorage.getItem(`vatioboard.app.${modules.MILKDROP_APP_ID}.settings.${modules.MILKDROP_VISIBILITY_SETTING_KEY}`),
    ).toBe("false");

    milkdrop.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("seeds the legacy visibility key from runtime settings when no legacy value exists", async () => {
    const modules = await loadModules();
    localStorage.setItem(
      `vatioboard.app.${modules.MILKDROP_APP_ID}.settings.${modules.MILKDROP_VISIBILITY_SETTING_KEY}`,
      "true",
    );
    const { shellManager, shellAppRuntimeManager } = createShellHarness(modules);
    const milkdrop = modules.createMilkdropApp({
      mount: document.body,
      restoreVisibility: true,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(localStorage.getItem(modules.MILKDROP_PANEL_VISIBILITY_KEY)).toBe("true");
    expect(milkdrop.isOpen()).toBe(true);

    milkdrop.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps Player-to-Milkdrop launch behavior and creates the Milkdrop runtime", async () => {
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      preload: "on-open",
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(modules.PLAYER_APP_ID);

    document.querySelector(".player-milkdrop-toggle-btn").click();
    await vi.dynamicImportSettled();
    await flushMicrotasks(20);

    expect(shellManager.getWindow("milkdrop")?.state).toBe("open");
    expect(document.querySelector(".milkdrop-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(modules.MILKDROP_APP_ID)?.appId).toBe(modules.MILKDROP_APP_ID);

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("preserves preset loading and the shared audio graph path", async () => {
    const modules = await loadModules();
    audioElement.src = "blob:https://vatioboard.local/audio";
    audioRuntimeMock.getState.mockReturnValue({
      ...defaultAudioState,
      currentTrack: { name: "demo-track", title: "Demo" },
      sourceType: "blob",
      playing: true,
      paused: false,
    });
    const { shellManager, shellAppRuntimeManager } = createShellHarness(modules);
    const milkdrop = modules.createMilkdropApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    await milkdrop.open();
    await flushMicrotasks(20);

    expect(acquireGraphMock).toHaveBeenCalledWith(audioElement);
    expect(createVisualizerMock).toHaveBeenCalled();
    expect(visualizerMock.connectAudio).toHaveBeenCalled();
    expect(visualizerMock.loadPreset).toHaveBeenCalled();
    expect(localStorage.getItem("milkdrop_preset_name_v1")).toMatch(/^Preset /);

    milkdrop.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps direct Milkdrop panel callers working without a runtime", async () => {
    const modules = await loadModules();
    const { shellManager } = createShellHarness(modules, {});
    const panel = modules.createMilkdropPanel({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
    });

    await panel.open();
    expect(shellManager.getWindow("milkdrop")?.state).toBe("open");
    expect(document.querySelector(".milkdrop-panel")?.hidden).toBe(false);

    panel.destroy();
    shellManager.destroy();
  });
});
