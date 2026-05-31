import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioRuntimeMock = {
  getAudioElement: vi.fn(() => document.createElement("audio")),
  getState: vi.fn(() => ({
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
  })),
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

function makeTrack(name, overrides = {}) {
  return {
    name,
    title: `Track ${name}`,
    original_filename: `${name}.mp3`,
    media_kind: "audio",
    folder_path: "/music",
    content_hash: `hash_${name}`,
    blob_size: 1024,
    ...overrides,
  };
}

async function flushMicrotasks(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function installPlayerMocks() {
  vi.doMock("../../src/i18n.js", () => ({
    t: (key) => key,
    getLang: () => "en",
    toggleLang: vi.fn(),
    applyTranslations: vi.fn(),
  }));

  vi.doMock("../../src/shared/environment.js", () => ({
    getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
  }));

  vi.doMock("../../src/shared/audio-runtime.js", () => audioRuntimeMock);
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
}

async function loadModules() {
  vi.resetModules();
  installPlayerMocks();
  const [
    appPlatform,
    shell,
    playerApp,
    playerWidget,
    playerShell,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/shared/shell-window-manager.js"),
    import("../../src/apps/player/index.js"),
    import("../../src/player/player-widget.js"),
    import("../../src/player/player-shell.js"),
  ]);
  return {
    ...appPlatform,
    createShellWindowManager: shell.createShellWindowManager,
    createPlayerApp: playerApp.createPlayerApp,
    PLAYER_APP_ID: playerApp.PLAYER_APP_ID,
    PLAYER_VISUALIZER_VISIBLE_SETTING_KEY: playerApp.PLAYER_VISUALIZER_VISIBLE_SETTING_KEY,
    createPlayerWidget: playerWidget.createPlayerWidget,
    VISUALIZER_MODE_STORAGE_KEY: playerShell.VISUALIZER_MODE_STORAGE_KEY,
    VISUALIZER_VISIBLE_STORAGE_KEY: playerShell.VISUALIZER_VISIBLE_STORAGE_KEY,
  };
}

async function loadPlatformModules() {
  vi.resetModules();
  installPlayerMocks();
  const [
    appPlatform,
    shell,
  ] = await Promise.all([
    import("../../src/app-platform/index.js"),
    import("../../src/shared/shell-window-manager.js"),
  ]);
  return {
    ...appPlatform,
    createShellWindowManager: shell.createShellWindowManager,
  };
}

function createShellHarness(modules) {
  const shellManager = modules.createShellWindowManager({
    root: document.body,
    storeOptions: { storage: localStorage, migrateLegacy: false },
  });
  const shellAppRuntimeManager = modules.createShellAppRuntimeManager({
    shellManager,
    baseContext: { audioRuntime: audioRuntimeMock },
  });
  const launcher = modules.createAppLauncher({
    shellManager,
    shellAppRuntimeManager,
  });
  shellAppRuntimeManager.setLauncher(launcher);
  return { shellManager, shellAppRuntimeManager, launcher };
}

describe("Player OS app module", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    audioRuntimeMock.getState.mockClear();
    audioRuntimeMock.getState.mockReturnValue({
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
    });
    audioRuntimeMock.subscribe.mockClear();
    audioRuntimeMock.subscribe.mockReturnValue(vi.fn());
    audioRuntimeMock.setMediaSessionEnabled.mockClear();
    audioRuntimeMock.play.mockClear();
    audioRuntimeMock.pause.mockClear();
    audioRuntimeMock.setQueue.mockClear();
    audioRuntimeMock.restoreSession.mockClear();
    audioRuntimeMock.restoreSession.mockResolvedValue(undefined);
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
  });

  afterEach(() => {
    document.querySelectorAll(".player-panel").forEach((element) => element.remove());
    vi.unstubAllGlobals();
  });

  it("opens vatio.player through the manifest-backed launcher and creates a runtime", async () => {
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      preload: "on-open",
      shellManager,
      shellAppRuntimeManager,
    });

    expect(player.runtime?.appId).toBe(modules.PLAYER_APP_ID);
    expect(shellAppRuntimeManager.getRuntime(modules.PLAYER_APP_ID)).toBe(player.runtime);
    expect(audioRuntimeMock.setMediaSessionEnabled).toHaveBeenCalledWith(true);
    expect(launcher.openApp(modules.PLAYER_APP_ID)).toBe(true);

    expect(shellManager.getWindow("player")?.state).toBe("open");
    expect(document.querySelector(".player-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime(modules.PLAYER_APP_ID)?.lifecycle.getState()).toBe("active");

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("cold-launches vatio.player from its manifest entry when no player panel is registered", async () => {
    const modules = await loadPlatformModules();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);

    expect(shellManager.getWindow("player")).toBeNull();
    expect(launcher.openApp("vatio.player")).toBe(true);
    await vi.dynamicImportSettled();
    await flushMicrotasks(30);

    expect(shellManager.getWindow("player")?.state).toBe("open");
    expect(document.querySelectorAll(".player-panel")).toHaveLength(1);
    expect(document.querySelector(".player-panel")?.hidden).toBe(false);
    expect(shellAppRuntimeManager.getRuntime("vatio.player")?.lifecycle.getState()).toBe("active");
    expect(audioRuntimeMock.setMediaSessionEnabled).toHaveBeenCalledWith(true);

    shellManager.unregisterWindow("player");
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps shell taskbar minimize, restore, and close behavior intact", async () => {
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(modules.PLAYER_APP_ID);

    shellManager.minimizeWindow("player");
    expect(shellManager.getWindow("player")?.state).toBe("minimized");
    expect(document.querySelector(".player-panel")?.hidden).toBe(true);

    shellManager.restoreWindow("player");
    expect(shellManager.getWindow("player")?.state).toBe("open");
    expect(document.querySelector(".player-panel")?.hidden).toBe(false);

    shellManager.closeWindow("player");
    expect(shellManager.getWindow("player")?.state).toBe("closed");
    expect(document.querySelector(".player-panel")?.hidden).toBe(true);

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("does not stop playback when the Player panel is minimized or closed", async () => {
    const modules = await loadModules();
    audioRuntimeMock.getState.mockReturnValue({
      queue: [makeTrack("PLAYING")],
      currentIndex: 0,
      currentTrack: makeTrack("PLAYING"),
      paused: false,
      volume: 1,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: true,
      sourceType: "remote",
      loading: false,
      error: null,
      currentTime: 12,
      duration: 180,
      playing: true,
    });
    audioRuntimeMock.stopPlayback.mockClear();
    audioRuntimeMock.pause.mockClear();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(modules.PLAYER_APP_ID);

    shellManager.minimizeWindow("player");
    shellManager.closeWindow("player");

    expect(document.querySelector(".player-panel")?.hidden).toBe(true);
    expect(audioRuntimeMock.stopPlayback).not.toHaveBeenCalled();
    expect(audioRuntimeMock.pause).not.toHaveBeenCalled();

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("preserves Media Session/audio runtime behavior from the player controls", async () => {
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });
    launcher.openApp(modules.PLAYER_APP_ID);

    document.querySelector(".player-btn-play-main").click();

    expect(audioRuntimeMock.play).toHaveBeenCalledTimes(1);

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps queue/session restore and offline annotation paths during bootstrap", async () => {
    const track = makeTrack("AUDIO-1", { _offline: true });
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [track], total: 1 });
    const modules = await loadModules();
    const { shellManager, shellAppRuntimeManager } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      preload: "immediate",
      shellManager,
      shellAppRuntimeManager,
    });

    await flushMicrotasks(30);

    expect(catalogMock.annotateOfflineAvailability).toHaveBeenCalledWith([track]);
    expect(audioRuntimeMock.restoreSession).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "AUDIO-1" })]),
      { autoplay: true },
    );
    expect(audioRuntimeMock.setQueue).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "AUDIO-1" })]),
      { autoplay: false },
    );

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("mirrors visualizer preferences through runtime settings while preserving legacy keys", async () => {
    const modules = await loadModules();
    localStorage.setItem(
      `vatioboard.app.${modules.PLAYER_APP_ID}.settings.${modules.PLAYER_VISUALIZER_VISIBLE_SETTING_KEY}`,
      "false",
    );
    const { shellManager, shellAppRuntimeManager, launcher } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(localStorage.getItem(modules.VISUALIZER_VISIBLE_STORAGE_KEY)).toBe("false");
    launcher.openApp(modules.PLAYER_APP_ID);
    document.querySelector(".player-visualizer-toggle-btn").click();

    expect(localStorage.getItem(modules.VISUALIZER_VISIBLE_STORAGE_KEY)).toBe("true");
    expect(
      localStorage.getItem(`vatioboard.app.${modules.PLAYER_APP_ID}.settings.${modules.PLAYER_VISUALIZER_VISIBLE_SETTING_KEY}`),
    ).toBe("true");

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("lets legacy visualizer preferences win over stale runtime mirrors", async () => {
    const modules = await loadModules();
    localStorage.setItem(modules.VISUALIZER_VISIBLE_STORAGE_KEY, "true");
    localStorage.setItem(
      `vatioboard.app.${modules.PLAYER_APP_ID}.settings.${modules.PLAYER_VISUALIZER_VISIBLE_SETTING_KEY}`,
      "false",
    );
    const { shellManager, shellAppRuntimeManager } = createShellHarness(modules);
    const player = modules.createPlayerApp({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
      shellAppRuntimeManager,
    });

    expect(
      localStorage.getItem(`vatioboard.app.${modules.PLAYER_APP_ID}.settings.${modules.PLAYER_VISUALIZER_VISIBLE_SETTING_KEY}`),
    ).toBe("true");

    player.destroy();
    shellAppRuntimeManager.destroy();
    shellManager.destroy();
  });

  it("keeps direct Player widget callers working without a runtime", async () => {
    const modules = await loadModules();
    const shellManager = modules.createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const widget = modules.createPlayerWidget({
      mount: document.body,
      restoreVisibility: false,
      shellManager,
    });

    expect(() => shellManager.openWindow("player")).not.toThrow();
    expect(shellManager.getWindow("player")?.state).toBe("open");
    expect(document.querySelector(".player-panel")?.hidden).toBe(false);

    widget.destroy();
    shellManager.destroy();
  });
});
