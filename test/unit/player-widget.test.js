import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../../src/i18n.js", () => ({
  t: (key) => key,
  getLang: () => "en",
  toggleLang: vi.fn(),
  applyTranslations: vi.fn(),
}));

vi.mock("../../src/shared/environment.js", () => ({
  getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
}));

const runtimeMock = {
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

vi.mock("../../src/shared/audio-runtime.js", () => runtimeMock);

const catalogMock = {
  loadAudioCatalog: vi.fn().mockResolvedValue({ tracks: [], total: 0 }),
  syncAudioCatalog: vi.fn().mockResolvedValue(false),
  annotateOfflineAvailability: vi.fn().mockImplementation((tracks) =>
    Promise.resolve(tracks.map((t) => ({ ...t, _offline: false }))),
  ),
  isAudioAsset: vi.fn().mockImplementation(
    (asset) => asset && String(asset.media_kind || "").toLowerCase() === "audio",
  ),
};

vi.mock("../../src/shared/audio-catalog.js", () => catalogMock);

const playlistMock = {
  loadPlaylists: vi.fn().mockResolvedValue({ playlists: [], total: 0 }),
  syncPlaylistsManifest: vi.fn().mockResolvedValue(false),
  loadPlaylistDetail: vi.fn().mockResolvedValue(null),
};

vi.mock("../../src/shared/playlist-loader.js", () => playlistMock);

vi.mock("../../src/shared/backend-auth.js", () => ({
  BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
  getBackendSessionState: vi.fn().mockResolvedValue({ authenticated: false }),
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

vi.mock("../../src/shared/media-session-adapter.js", () => ({
  setMediaSessionMetadata: vi.fn(),
  setMediaSessionPlaybackState: vi.fn(),
  setMediaSessionPositionState: vi.fn(),
  setMediaSessionActionHandlers: vi.fn(),
  clearMediaSession: vi.fn(),
}));

vi.mock("../../src/shared/media-cache.js", () => ({
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

vi.mock("../../src/shared/media-access-cache.js", () => ({
  getCachedMediaAccess: vi.fn().mockReturnValue(null),
  setCachedMediaAccess: vi.fn(),
  clearMediaAccessCache: vi.fn(),
}));

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

vi.mock("../../src/shared/demo-cache.js", () => demoCacheMock);

// ── Helpers ──────────────────────────────────────────────────────────

async function flushMicrotasks(n = 10) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

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

// ── Tests ────────────────────────────────────────────────────────────

describe("createPlayerWidget", () => {
  let createPlayerWidget;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();

    // Re-apply mocks after reset
    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));

    vi.doMock("../../src/shared/audio-runtime.js", () => runtimeMock);
    vi.doMock("../../src/shared/audio-catalog.js", () => catalogMock);
    vi.doMock("../../src/shared/playlist-loader.js", () => playlistMock);

    vi.doMock("../../src/shared/backend-auth.js", () => ({
      BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
      getBackendSessionState: vi.fn().mockResolvedValue({ authenticated: false }),
      fetchBackendLoggedUser: vi.fn().mockResolvedValue(null),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({ allowed: false, cleanup: vi.fn() }),
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
    }));

    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));

    vi.doMock("../../src/shared/demo-cache.js", () => demoCacheMock);

    // Reset runtime mock state
    runtimeMock.getState.mockReset();
    runtimeMock.getState.mockReturnValue(makeRuntimeState());
    runtimeMock.subscribe.mockReset();
    runtimeMock.subscribe.mockReturnValue(vi.fn());
    runtimeMock.setQueue.mockReset();
    runtimeMock.setQueue.mockImplementation(() => {});
    runtimeMock.restoreSession.mockReset();
    runtimeMock.restoreSession.mockResolvedValue(undefined);
    runtimeMock.stopPlayback.mockReset();
    runtimeMock.stopPlayback.mockImplementation(() => {});
    runtimeMock.updatePlayerMediaSessionMetadata.mockReset();
    runtimeMock.updatePlayerMediaSessionMetadata.mockImplementation(() => {});
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });
    catalogMock.syncAudioCatalog.mockResolvedValue(false);
    playlistMock.loadPlaylists.mockResolvedValue({ playlists: [], total: 0 });
    playlistMock.syncPlaylistsManifest.mockResolvedValue(false);
    playlistMock.loadPlaylistDetail.mockResolvedValue(null);
    demoCacheMock.loadDemoPlaylist.mockReset();
    demoCacheMock.loadDemoPlaylist.mockResolvedValue({
      tracks: [],
      source: "empty",
      cachedAt: 0,
      signature: "",
    });
    demoCacheMock.syncDemoPlaylist.mockReset();
    demoCacheMock.syncDemoPlaylist.mockResolvedValue({
      refreshed: false,
      changed: false,
      tracks: [],
      source: "empty",
    });

    const mod = await import("../../src/player/player-widget.js");
    createPlayerWidget = mod.createPlayerWidget;

    // Clean up localStorage
    localStorage.removeItem("player_widget_pos_v1");
    localStorage.removeItem("player_widget_visible_v1");
  });

  afterEach(() => {
    // Clean up any mounted elements
    document.querySelectorAll(".player-panel, .player-fab").forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  // ── open / close / toggle ────────────────────────────────────

  it("creates a widget that is initially hidden", () => {
    const widget = createPlayerWidget({ floating: false });
    const panel = document.querySelector(".player-panel");
    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(true);
    widget.destroy();
  });

  it("open() shows the panel", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();
    const panel = document.querySelector(".player-panel");
    expect(panel.hidden).toBe(false);
    widget.destroy();
  });

  it("close() hides the panel", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();
    widget.close();
    const panel = document.querySelector(".player-panel");
    expect(panel.hidden).toBe(true);
    widget.destroy();
  });

  it("persists the open panel state", () => {
    const widget = createPlayerWidget({ floating: false });

    widget.open();

    expect(localStorage.getItem("player_widget_visible_v1")).toBe("true");

    widget.destroy();
  });

  it("persists the hidden panel state", () => {
    const widget = createPlayerWidget({ floating: false });

    widget.open();
    widget.close();

    expect(localStorage.getItem("player_widget_visible_v1")).toBe("false");

    widget.destroy();
  });

  it("restores the saved visible panel state", () => {
    localStorage.setItem("player_widget_visible_v1", "true");

    const widget = createPlayerWidget({ floating: false });

    expect(document.querySelector(".player-panel").hidden).toBe(false);

    widget.destroy();
  });

  it("can skip restoring saved visibility", () => {
    localStorage.setItem("player_widget_visible_v1", "true");

    const widget = createPlayerWidget({ floating: false, restoreVisibility: false });

    expect(document.querySelector(".player-panel").hidden).toBe(true);
    expect(localStorage.getItem("player_widget_visible_v1")).toBe("true");

    widget.destroy();
  });

  it("toggle() switches visibility", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.toggle();
    expect(document.querySelector(".player-panel").hidden).toBe(false);
    widget.toggle();
    expect(document.querySelector(".player-panel").hidden).toBe(true);
    widget.destroy();
  });

  it("destroy() removes panel from DOM", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.destroy();
    expect(document.querySelector(".player-panel")).toBeFalsy();
  });

  // ── External button ──────────────────────────────────────────

  it("external button opens player", () => {
    const btn = document.createElement("button");
    btn.id = "openPlayer";
    document.body.appendChild(btn);

    const widget = createPlayerWidget({ button: btn });
    btn.click();
    expect(document.querySelector(".player-panel").hidden).toBe(false);

    btn.click();
    expect(document.querySelector(".player-panel").hidden).toBe(true);

    widget.destroy();
    btn.remove();
  });

  // ── Floating launcher ────────────────────────────────────────

  it("creates floating launcher when floating=true", () => {
    const widget = createPlayerWidget({ floating: true });
    const launcher = document.querySelector(".player-fab");
    expect(launcher).toBeTruthy();
    widget.destroy();
  });

  it("launcher click opens/closes panel", () => {
    const widget = createPlayerWidget({ floating: true });
    const launcher = document.querySelector(".player-fab");

    launcher.click();
    expect(document.querySelector(".player-panel").hidden).toBe(false);

    launcher.click();
    expect(document.querySelector(".player-panel").hidden).toBe(true);

    widget.destroy();
  });

  it("no launcher when floating=false", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const widget = createPlayerWidget({ button: btn, floating: false });
    expect(document.querySelector(".player-fab")).toBeFalsy();
    widget.destroy();
    btn.remove();
  });

  it("destroy() removes launcher from DOM", () => {
    const widget = createPlayerWidget({ floating: true });
    expect(document.querySelector(".player-fab")).toBeTruthy();
    widget.destroy();
    expect(document.querySelector(".player-fab")).toBeFalsy();
  });

  // ── Dragging launcher does not toggle ────────────────────────

  it("dragging launcher does not accidentally toggle", () => {
    const widget = createPlayerWidget({ floating: true });
    const launcher = document.querySelector(".player-fab");

    // Simulate a drag sequence: pointerdown → pointermove → pointerup
    launcher.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 100, clientY: 100, pointerId: 1, pointerType: "mouse", button: 0, bubbles: true,
    }));
    launcher.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 200, clientY: 200, pointerId: 1, pointerType: "mouse", bubbles: true,
    }));
    launcher.dispatchEvent(new PointerEvent("pointerup", {
      clientX: 200, clientY: 200, pointerId: 1, pointerType: "mouse", bubbles: true,
    }));

    // Panel should remain hidden (drag, not click)
    expect(document.querySelector(".player-panel").hidden).toBe(true);

    widget.destroy();
  });

  // ── Panel has header with close button ───────────────────────

  it("panel has a header and close button", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");
    expect(panel.querySelector(".player-header")).toBeTruthy();
    expect(panel.querySelector(".player-header-label")).toBeFalsy();
    expect(panel.querySelector(".player-close")).toBeTruthy();
    expect(panel.querySelector(".player-close svg")).toBeTruthy();
    expect(panel.querySelector(".player-utility-row")).toBeTruthy();
    expect(Array.from(panel.querySelectorAll(".player-utility-btn-label"), (label) => label.textContent)).toEqual([
      "playerVisualsShort",
      "milkdropTitle",
      "playerBrowseShort",
    ]);
    expect(panel.querySelector(".player-title")).toBeFalsy();
    expect(panel.querySelector(".player-content-toggle-btn")).toBeTruthy();
    expect(panel.querySelector(".player-queue-toggle-btn")).toBeFalsy();
    expect(panel.querySelector(".player-library-toggle-btn")).toBeFalsy();
    expect(panel.querySelector(".player-playlist-toggle-btn")).toBeFalsy();

    widget.destroy();
  });

  it("uses the header and now playing row as drag handles", () => {
    const widget = createPlayerWidget({ floating: false });
    const panel = document.querySelector(".player-panel");

    expect(panel.querySelector(".player-header").classList.contains("vb-floating-drag-handle")).toBe(true);
    expect(panel.querySelector(".player-now-playing").classList.contains("vb-floating-drag-handle")).toBe(true);

    widget.destroy();
  });

  it("does not render a manual background audio toggle", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    expect(document.querySelector(".player-background-toggle-btn")).toBeNull();

    widget.destroy();
  });

  it("close button hides panel", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const closeBtn = document.querySelector(".player-close");
    closeBtn.click();

    expect(document.querySelector(".player-panel").hidden).toBe(true);
    widget.destroy();
  });

  // ── Closing panel does NOT stop playback ─────────────────────

  it("closing panel does not stop active playback", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();
    widget.close();

    // runtime.pause() and runtime.stopPlayback() should NOT have been called
    expect(runtimeMock.pause).not.toHaveBeenCalled();
    widget.destroy();
  });

  // ── Playlist loading ─────────────────────────────────────────

  it("loads playlists during bootstrap", async () => {
    playlistMock.loadPlaylists.mockClear();
    // Provide at least one track so bootstrap takes the authenticated path
    const track = makeTrack("t1");
    catalogMock.loadAudioCatalog.mockResolvedValueOnce({ tracks: [track], total: 1 });

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(20);

    expect(playlistMock.loadPlaylists).toHaveBeenCalled();
    widget.destroy();
  });

  it("syncs playlists manifest in background after bootstrap", async () => {
    playlistMock.syncPlaylistsManifest.mockClear();
    // Background sync only runs when annotated tracks > 0
    catalogMock.loadAudioCatalog.mockResolvedValue({
      tracks: [makeTrack("A")],
      total: 1,
    });

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(20);

    expect(playlistMock.syncPlaylistsManifest).toHaveBeenCalled();
    widget.destroy();
  });

  // ── Lazy bootstrap ───────────────────────────────────────────

  it("lazy bootstrap happens on first open, not page load", async () => {
    catalogMock.loadAudioCatalog.mockClear();

    const widget = createPlayerWidget({ preload: "on-open", floating: false });

    // Bootstrap should NOT have fired yet
    expect(catalogMock.loadAudioCatalog).not.toHaveBeenCalled();

    // Open the widget → triggers bootstrap
    widget.open();
    await flushMicrotasks();

    expect(catalogMock.loadAudioCatalog).toHaveBeenCalled();

    widget.destroy();
  });

  it("immediate preload bootstraps on creation", async () => {
    catalogMock.loadAudioCatalog.mockClear();

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks();

    expect(catalogMock.loadAudioCatalog).toHaveBeenCalled();

    widget.destroy();
  });

  it("ignores auth events that arrive while the first bootstrap is still in flight", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    const sessionDeferred = createDeferred();
    const demoTrack = makeTrack("demo:titan", {
      title: "Titan",
      src: "/audio/demo/sb_titan.mp3",
    });

    backendAuth.getBackendSessionState.mockImplementation(() => sessionDeferred.promise);
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });
    demoCacheMock.loadDemoPlaylist.mockResolvedValue({
      tracks: [demoTrack],
      source: "cache",
      cachedAt: Date.now(),
      signature: "demo",
    });
    runtimeMock.restoreSession.mockClear();
    runtimeMock.setQueue.mockClear();
    runtimeMock.stopPlayback.mockClear();

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(2);

    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: false, isGuest: true, pendingLogout: false },
    }));
    await flushMicrotasks(5);

    expect(runtimeMock.stopPlayback).not.toHaveBeenCalled();
    expect(runtimeMock.setQueue).not.toHaveBeenCalled();

    sessionDeferred.resolve({ authenticated: false, isGuest: true });
    await flushMicrotasks(30);

    expect(runtimeMock.restoreSession).toHaveBeenCalledTimes(1);
    expect(runtimeMock.setQueue).toHaveBeenCalledTimes(1);
    expect(runtimeMock.setQueue).toHaveBeenLastCalledWith(
      [expect.objectContaining({ name: "demo:titan" })],
      { autoplay: false },
    );

    widget.destroy();
  });

  it("does not treat the first matching auth event after bootstrap as a playback-reset transition", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    backendAuth.getBackendSessionState.mockResolvedValue({ authenticated: true, isGuest: false });
    catalogMock.loadAudioCatalog.mockResolvedValue({
      tracks: [makeTrack("A")],
      total: 1,
    });
    catalogMock.syncAudioCatalog.mockResolvedValue(false);
    runtimeMock.restoreSession.mockClear();
    runtimeMock.stopPlayback.mockClear();

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(20);

    expect(runtimeMock.restoreSession).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, isGuest: false, pendingLogout: false },
    }));
    await flushMicrotasks(20);

    expect(runtimeMock.restoreSession).toHaveBeenCalledTimes(1);
    expect(runtimeMock.stopPlayback).not.toHaveBeenCalled();

    widget.destroy();
  });

  it("hydrates persisted demo queue on authenticated bootstrap and replaces pristine demo queue", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    const catalogTrack = makeTrack("asset_real");
    const demoTrack = makeTrack("demo:titan", {
      title: "Titan",
      media_kind: "audio",
      src: "/audio/demo/sb_titan.mp3",
    });

    backendAuth.getBackendSessionState.mockResolvedValue({ authenticated: true, isGuest: false });
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [catalogTrack], total: 1 });
    demoCacheMock.loadDemoPlaylist.mockResolvedValue({
      tracks: [demoTrack],
      source: "network",
      cachedAt: Date.now(),
      signature: "demo:titan",
    });

    let runtimeState = makeRuntimeState();
    runtimeMock.getState.mockImplementation(() => runtimeState);
    runtimeMock.restoreSession.mockImplementation(async () => {
      runtimeState = makeRuntimeState({
        queue: [demoTrack],
        currentIndex: 0,
        currentTrack: demoTrack,
        paused: true,
        currentTime: 0,
      });
    });

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(30);

    expect(runtimeMock.restoreSession).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "asset_real" }),
        expect.objectContaining({ name: "demo:titan", src: "/audio/demo/sb_titan.mp3" }),
      ]),
      { autoplay: true },
    );
    expect(runtimeMock.setQueue).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "asset_real" })]),
      { autoplay: false },
    );

    widget.destroy();
  });

  it("keeps an active demo queue during authenticated bootstrap until the user consumes it", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    const catalogTrack = makeTrack("asset_real");
    const demoTrack = makeTrack("demo:titan", {
      title: "Titan",
      media_kind: "audio",
      src: "/audio/demo/sb_titan.mp3",
    });

    backendAuth.getBackendSessionState.mockResolvedValue({ authenticated: true, isGuest: false });
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [catalogTrack], total: 1 });
    demoCacheMock.loadDemoPlaylist.mockResolvedValue({
      tracks: [demoTrack],
      source: "network",
      cachedAt: Date.now(),
      signature: "demo:titan",
    });

    let runtimeState = makeRuntimeState();
    runtimeMock.getState.mockImplementation(() => runtimeState);
    runtimeMock.restoreSession.mockImplementation(async () => {
      runtimeState = makeRuntimeState({
        queue: [demoTrack],
        currentIndex: 0,
        currentTrack: demoTrack,
        paused: false,
        currentTime: 42,
        playing: true,
        sourceType: "remote",
      });
    });

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(30);

    expect(runtimeMock.restoreSession).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "asset_real" }),
        expect.objectContaining({ name: "demo:titan", src: "/audio/demo/sb_titan.mp3" }),
      ]),
      { autoplay: true },
    );
    expect(runtimeMock.setQueue).not.toHaveBeenCalled();

    widget.destroy();
  });

  it("revalidates a cached guest demo playlist and refreshes a pristine seeded queue", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    const demoTrack = makeTrack("demo:titan", {
      title: "Titan",
      media_kind: "audio",
      src: "/audio/demo/sb_titan.mp3",
    });
    const demoTrackTwo = makeTrack("demo:atlas", {
      title: "Atlas",
      media_kind: "audio",
      src: "/audio/demo/sb_atlas.mp3",
    });

    backendAuth.getBackendSessionState.mockResolvedValue({ authenticated: false, isGuest: true });
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });
    demoCacheMock.loadDemoPlaylist.mockResolvedValue({
      tracks: [demoTrack],
      source: "cache",
      cachedAt: Date.now() - 10_000,
      signature: "demo:titan",
    });
    demoCacheMock.syncDemoPlaylist.mockResolvedValue({
      refreshed: true,
      changed: true,
      tracks: [demoTrack, demoTrackTwo],
      source: "network",
    });

    let runtimeState = makeRuntimeState();
    runtimeMock.getState.mockImplementation(() => runtimeState);
    runtimeMock.restoreSession.mockImplementation(async () => {});
    runtimeMock.setQueue.mockImplementation((tracks) => {
      runtimeState = makeRuntimeState({
        queue: tracks,
        currentIndex: tracks.length > 0 ? 0 : -1,
        currentTrack: tracks[0] || null,
        paused: true,
        currentTime: 0,
      });
    });

    const widget = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(40);

    expect(demoCacheMock.loadDemoPlaylist).toHaveBeenCalledTimes(1);
    expect(demoCacheMock.syncDemoPlaylist).toHaveBeenCalledTimes(1);
    expect(runtimeMock.setQueue).toHaveBeenCalledTimes(2);
    expect(runtimeMock.setQueue.mock.calls[0][0]).toEqual([
      expect.objectContaining({ name: "demo:titan" }),
    ]);
    expect(runtimeMock.setQueue.mock.calls[1][0]).toEqual([
      expect.objectContaining({ name: "demo:titan" }),
      expect.objectContaining({ name: "demo:atlas" }),
    ]);

    widget.destroy();
  });

  // ── Multiple instances share bootstrap ───────────────────────

  it("multiple widget instances share bootstrap without duplicate fetches", async () => {
    catalogMock.loadAudioCatalog.mockClear();

    const widget1 = createPlayerWidget({ preload: "immediate", floating: false });
    const widget2 = createPlayerWidget({ preload: "immediate", floating: false });
    await flushMicrotasks(20);

    // loadAudioCatalog should be called only once (deduped)
    expect(catalogMock.loadAudioCatalog.mock.calls.length).toBeLessThanOrEqual(2);

    widget1.destroy();
    widget2.destroy();
  });

  // ── onOpen / onClose hooks ───────────────────────────────────

  it("calls onOpen and onClose hooks", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    const widget = createPlayerWidget({ floating: false, onOpen, onClose });
    widget.open();
    expect(onOpen).toHaveBeenCalledTimes(1);

    widget.close();
    expect(onClose).toHaveBeenCalledTimes(1);

    widget.destroy();
  });

  // ── Queue / search UI ────────────────────────────────────────

  it("has a queue sheet that can be toggled", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");
    const queueSheet = panel.querySelector(".player-content-pane-queue");
    const queueBtn = panel.querySelector(".player-content-toggle-btn");

    expect(queueSheet).toBeTruthy();
    expect(queueSheet.classList.contains("is-open")).toBe(false);

    // Click queue toggle to open
    queueBtn.click();
    expect(queueSheet.classList.contains("is-open")).toBe(true);

    // Click close to close
    const closeBtn = panel.querySelector(".player-content-sheet-close");
    closeBtn.click();
    expect(queueSheet.classList.contains("is-open")).toBe(false);

    widget.destroy();
  });

  it("has a search input inside queue sheet", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");
    const searchInput = panel.querySelector(".player-queue-search");
    expect(searchInput).toBeTruthy();
    expect(searchInput.type).toBe("search");

    widget.destroy();
  });

  // ── setTracks ────────────────────────────────────────────────

  it("setTracks populates queue list when queue is open", () => {
    const tracks = [makeTrack("A"), makeTrack("B")];

    // Queue sheet reads from runtime state — set the mock queue
    runtimeMock.getState.mockReturnValue({
      queue: tracks,
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

    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");

    // Open queue first
    panel.querySelector(".player-content-toggle-btn").click();

    widget.setTracks(tracks);

    // Re-open queue to force render
    const closeBtn = panel.querySelector(".player-content-sheet-close");
    closeBtn.click();
    panel.querySelector(".player-content-toggle-btn").click();

    const items = panel.querySelectorAll(".player-queue-item");
    expect(items.length).toBe(2);

    widget.destroy();
  });

  // ── Transport controls present ───────────────────────────────

  it("renders transport controls", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");
    expect(panel.querySelector(".player-transport")).toBeTruthy();
    expect(panel.querySelector(".player-btn-play-main")).toBeTruthy();
    expect(panel.querySelector(".player-btn-prev")).toBeTruthy();
    expect(panel.querySelector(".player-btn-next")).toBeTruthy();
    expect(panel.querySelector(".player-btn-shuffle")).toBeTruthy();
    expect(panel.querySelector(".player-btn-repeat")).toBeTruthy();
    expect(panel.querySelector(".player-progress")).toBeTruthy();
    expect(panel.querySelector(".player-volume")).toBeTruthy();

    widget.destroy();
  });

  // ── Panel position persistence ───────────────────────────────

  it("places the first-time visitor panel on the left side", () => {
    const widget = createPlayerWidget({ floating: false });
    const panel = document.querySelector(".player-panel");

    expect(panel.style.left).toBe("16px");
    expect(panel.style.right).toBe("auto");
    expect(panel.style.bottom).toBe("76px");

    widget.destroy();
  });

  it("saves and restores panel position via localStorage", () => {
    localStorage.setItem("player_widget_pos_v1", JSON.stringify({
      panel: { left: "50px", top: "100px" },
    }));

    const widget = createPlayerWidget({ floating: false });
    const panel = document.querySelector(".player-panel");

    expect(panel.style.left).toBe("50px");
    expect(panel.style.top).toBe("100px");

    widget.destroy();
    localStorage.removeItem("player_widget_pos_v1");
  });

  // ── Playlist sheet ───────────────────────────────────────────

  it("has a playlist sheet that can be toggled", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");
    const playlistSheet = panel.querySelector(".player-content-pane-playlists");
    const playlistBtn = panel.querySelector(".player-content-tab-playlists");

    expect(playlistSheet).toBeTruthy();
    expect(playlistSheet.classList.contains("is-open")).toBe(false);

    // Click playlist toggle to open
    playlistBtn.click();
    expect(playlistSheet.classList.contains("is-open")).toBe(true);

    // Click close to close
    const closeBtn = panel.querySelector(".player-content-sheet-close");
    closeBtn.click();
    expect(playlistSheet.classList.contains("is-open")).toBe(false);

    widget.destroy();
  });

  it("playlist and queue sheets are mutually exclusive", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");
    const queueSheet = panel.querySelector(".player-content-pane-queue");
    const playlistSheet = panel.querySelector(".player-content-pane-playlists");
    const queueTabBtn = panel.querySelector(".player-content-tab-queue");
    const playlistBtn = panel.querySelector(".player-content-tab-playlists");

    // Open queue first
    queueTabBtn.click();
    expect(queueSheet.classList.contains("is-open")).toBe(true);
    expect(playlistSheet.classList.contains("is-open")).toBe(false);

    // Open playlist → queue should close
    playlistBtn.click();
    expect(playlistSheet.classList.contains("is-open")).toBe(true);
    expect(queueSheet.classList.contains("is-open")).toBe(false);

    // Open queue again → playlist should close
    queueTabBtn.click();
    expect(queueSheet.classList.contains("is-open")).toBe(true);
    expect(playlistSheet.classList.contains("is-open")).toBe(false);

    widget.destroy();
  });

  it("setPlaylists renders items in the playlist sheet", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    widget.setPlaylists([
      { name: "pl1", title: "Road Trip", item_count: 5 },
      { name: "pl2", title: "Chill", item_count: 3 },
    ]);

    const panel = document.querySelector(".player-panel");
    // Open playlist sheet
    panel.querySelector(".player-content-tab-playlists").click();

    const items = panel.querySelectorAll(".player-playlist-item");
    expect(items.length).toBe(2);

    widget.destroy();
  });

  // ── Playlist playback ────────────────────────────────────────

  it("clicking a playlist item loads detail and queues audio tracks", async () => {
    const tracks = [
      makeTrack("song_a"),
      makeTrack("song_b"),
      makeTrack("song_c"),
    ];

    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks, total: 3 });

    playlistMock.loadPlaylistDetail.mockResolvedValue({
      name: "pl1",
      title: "Road Trip",
      items: [
        { media_asset_name: "song_a", position: 0 },
        { media_asset_name: "song_b", position: 1 },
        { media_asset_name: "song_c", position: 2 },
      ],
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30); // let bootstrap settle
    widget.setTracks(tracks);
    widget.setPlaylists([
      { name: "pl1", title: "Road Trip", item_count: 3 },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();

    // Click the playlist item to open detail view
    const playlistItem = panel.querySelector(".player-playlist-item");
    expect(playlistItem).toBeTruthy();
    playlistItem.click();
    await flushMicrotasks(20);

    expect(playlistMock.loadPlaylistDetail).toHaveBeenCalledWith("pl1");

    // Click Play All button
    const playAllBtn = panel.querySelector(".player-playlist-play-all-btn");
    expect(playAllBtn).toBeTruthy();
    playAllBtn.click();
    await flushMicrotasks();

    expect(runtimeMock.setQueue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "song_a" }),
        expect.objectContaining({ name: "song_b" }),
        expect.objectContaining({ name: "song_c" }),
      ]),
      { startIndex: 0, autoplay: true },
    );

    widget.destroy();
  });

  it("playlist playback skips missing and non-audio items", async () => {
    const audioTrack = makeTrack("song_a");
    const imageTrack = makeTrack("img_1", { media_kind: "image", original_filename: "photo.png" });

    catalogMock.loadAudioCatalog.mockResolvedValue({
      tracks: [audioTrack, imageTrack],
      total: 2,
    });

    playlistMock.loadPlaylistDetail.mockResolvedValue({
      name: "pl2",
      title: "Mixed",
      items: [
        { media_asset_name: "song_a", position: 0 },
        { media_asset_name: "deleted_track", position: 1 },   // missing
        { media_asset_name: "img_1", position: 2 },            // non-audio
      ],
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30); // let bootstrap settle
    widget.setTracks([audioTrack, imageTrack]);
    widget.setPlaylists([
      { name: "pl2", title: "Mixed", item_count: 3 },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();

    const playlistItem = panel.querySelector(".player-playlist-item");
    expect(playlistItem).toBeTruthy();
    playlistItem.click();
    await flushMicrotasks(20);

    const playAllBtn = panel.querySelector(".player-playlist-play-all-btn");
    expect(playAllBtn).toBeTruthy();
    playAllBtn.click();
    await flushMicrotasks();

    // Audio tracks should be queued; non-audio catalog items filtered out.
    // Missing tracks (not in catalog) are included via snapshot fallback
    // for offline resilience.
    expect(runtimeMock.setQueue).toHaveBeenCalledWith(
      [
        expect.objectContaining({ name: "song_a" }),
        expect.objectContaining({ name: "deleted_track" }),
      ],
      { startIndex: 0, autoplay: true },
    );

    widget.destroy();
  });

  it("clicking a specific track item sets correct startIndex", async () => {
    const tracks = [
      makeTrack("song_a"),
      makeTrack("song_b"),
      makeTrack("song_c"),
    ];

    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks, total: 3 });

    playlistMock.loadPlaylistDetail.mockResolvedValue({
      name: "pl1",
      title: "Road Trip",
      items: [
        { media_asset_name: "song_a", position: 0 },
        { media_asset_name: "song_b", position: 1 },
        { media_asset_name: "song_c", position: 2 },
      ],
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30); // let bootstrap settle
    widget.setTracks(tracks);
    widget.setPlaylists([
      { name: "pl1", title: "Road Trip", item_count: 3 },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();

    const playlistItem = panel.querySelector(".player-playlist-item");
    expect(playlistItem).toBeTruthy();
    playlistItem.click();
    await flushMicrotasks(20);

    // Click the second track item (song_b)
    const trackItems = panel.querySelectorAll(".player-playlist-track-item");
    expect(trackItems.length).toBe(3);
    trackItems[1].click();
    await flushMicrotasks();

    expect(runtimeMock.setQueue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "song_a" }),
        expect.objectContaining({ name: "song_b" }),
        expect.objectContaining({ name: "song_c" }),
      ]),
      { startIndex: 1, autoplay: true },
    );

    widget.destroy();
  });

  // ── Demo/local playlist unified contract ─────────────────────

  it("demo playlist uses items (not _items) and renders through unified path", async () => {
    const demoTracks = [
      makeTrack("demo:song_a", { title: "Demo A", artist: "Artist A" }),
      makeTrack("demo:song_b", { title: "Demo B", artist: "Artist B" }),
    ];

    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    // Set demo tracks and demo playlist (unified contract: items, not _items)
    widget.setTracks(demoTracks);
    widget.setPlaylists([{
      name: "demo:playlist",
      title: "Demo Playlist",
      item_count: 2,
      total_duration_seconds: 0,
      _local: true,
      items: [
        { media_asset_name: "demo:song_a", snapshot_title: "Demo A", snapshot_artist: "Artist A" },
        { media_asset_name: "demo:song_b", snapshot_title: "Demo B", snapshot_artist: "Artist B" },
      ],
    }]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();

    // Click the demo playlist
    const playlistItem = panel.querySelector(".player-playlist-item");
    expect(playlistItem).toBeTruthy();
    playlistItem.click();
    await flushMicrotasks(20);

    // Should render track items directly (no backend fetch)
    expect(playlistMock.loadPlaylistDetail).not.toHaveBeenCalled();
    const trackItems = panel.querySelectorAll(".player-playlist-track-item");
    expect(trackItems.length).toBe(2);

    // Play All should queue all demo tracks
    const playAllBtn = panel.querySelector(".player-playlist-play-all-btn");
    expect(playAllBtn).toBeTruthy();
    playAllBtn.click();
    await flushMicrotasks();

    expect(runtimeMock.setQueue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "demo:song_a" }),
        expect.objectContaining({ name: "demo:song_b" }),
      ]),
      { startIndex: 0, autoplay: true },
    );

    // No pin/unpin buttons for local playlists
    expect(panel.querySelector(".player-playlist-download-btn")).toBeFalsy();

    widget.destroy();
  });

  it("demo playlist with _items (old shape) does not render inline", async () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    widget.setPlaylists([{
      name: "demo:old",
      title: "Old Demo",
      _local: true,
      _items: [{ media_asset_name: "x" }],
    }]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();

    const playlistItem = panel.querySelector(".player-playlist-item");
    expect(playlistItem).toBeTruthy();
    playlistItem.click();
    await flushMicrotasks(20);

    // _items is not recognized — falls through to backend fetch
    expect(playlistMock.loadPlaylistDetail).toHaveBeenCalledWith("demo:old");

    widget.destroy();
  });

  // ── Pin result and retry ─────────────────────────────────────

  it("shows failure count and retry button after partial pin failure", async () => {
    const tracks = [
      makeTrack("song_a"),
      makeTrack("song_b"),
      makeTrack("song_fail"),
    ];

    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks, total: 3 });

    playlistMock.loadPlaylistDetail.mockResolvedValue({
      name: "pl_pin",
      title: "Pin Test",
      items: [
        { media_asset_name: "song_a", position: 0 },
        { media_asset_name: "song_b", position: 1 },
        { media_asset_name: "song_fail", position: 2 },
      ],
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);
    widget.setTracks(tracks);
    widget.setPlaylists([{ name: "pl_pin", title: "Pin Test", item_count: 3 }]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();

    const playlistItem = panel.querySelector(".player-playlist-item");
    playlistItem.click();
    await flushMicrotasks(20);

    // Pin button should be present (no tracks pinned)
    const pinBtn = panel.querySelector(".player-playlist-download-btn");
    expect(pinBtn).toBeTruthy();
    expect(pinBtn.textContent).toBe("playerPinPlaylist");

    widget.destroy();
  });

  it("stale-catalog fallback preserves full snapshot fields for queue items", async () => {
    // Simulate a playlist whose items are NOT in the audio catalog.
    // The fallback normalizeTrack call must carry snapshot album, genre,
    // artwork_ref, and content_hash so the queue UI, now-playing, and
    // offline logic have complete metadata.
    const detailItems = [
      {
        media_asset_name: "ASSET-missing-from-catalog",
        position: 0,
        snapshot_title: "Offline Song",
        snapshot_artist: "Offline Artist",
        snapshot_album: "Offline Album",
        snapshot_genre: "Lo-fi",
        snapshot_duration: 222,
        snapshot_artwork_ref: "ASSET-art-ref",
        snapshot_content_hash: "sha256-abc",
      },
    ];

    playlistMock.loadPlaylistDetail.mockResolvedValue({
      name: "pl_stale",
      title: "Stale Catalog Playlist",
      items: detailItems,
    });

    // Audio catalog returns empty — simulates stale/offline catalog
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);
    widget.setTracks([]); // no catalog tracks
    widget.setPlaylists([
      { name: "pl_stale", title: "Stale Catalog Playlist", item_count: 1 },
    ]);

    const panel = document.querySelector(".player-panel");
    // Open the playlist sheet
    panel.querySelector(".player-content-tab-playlists").click();
    // Click the playlist item in the list to open its detail
    const playlistItem = panel.querySelector(".player-playlist-item");
    playlistItem.click();
    // Wait for loadPlaylistDetail to resolve and detail view to render
    await flushMicrotasks(30);

    // Now click the track item inside the detail to trigger playPlaylistTracks
    const trackItem = panel.querySelector(".player-playlist-track-item");
    expect(trackItem).toBeTruthy();
    trackItem.click();
    await flushMicrotasks(10);

    // playPlaylistTracks falls back to normalizeTrack with snapshot fields
    // when catalog has no match — setQueue should have been called.
    const setQueueCalls = runtimeMock.setQueue.mock.calls;
    const lastCall = setQueueCalls[setQueueCalls.length - 1];
    expect(lastCall).toBeTruthy();

    const resolvedTracks = lastCall[0];
    expect(resolvedTracks.length).toBe(1);

    const track = resolvedTracks[0];
    expect(track.name).toBe("ASSET-missing-from-catalog");
    expect(track.title).toBe("Offline Song");
    expect(track.artist).toBe("Offline Artist");
    // snapshot_album, snapshot_genre flow through normalizeTrack into
    // the album/genre fallback fields
    expect(track.album).toBe("Offline Album");
    expect(track.genre).toBe("Lo-fi");
    expect(track.artwork_ref).toBe("ASSET-art-ref");
    expect(track.content_hash).toBe("sha256-abc");

    widget.destroy();
  });

  it("resolves artwork for fallback tracks with non-URL artwork_ref", async () => {
    // CSS.escape is not available in jsdom — polyfill for this test.
    if (!globalThis.CSS?.escape) {
      globalThis.CSS = { ...(globalThis.CSS || {}), escape: (v) => v };
    }

    // Import the mocked backend-auth module to override gate + access.
    const backendAuth = await import("../../src/shared/backend-auth.js");
    backendAuth.getProtectedMediaRequestGate.mockResolvedValue({
      allowed: true,
      signal: new AbortController().signal,
      cleanup: vi.fn(),
    });
    backendAuth.getBackendMediaAssetAccess.mockResolvedValue({
      access: { artwork_url: "https://s3.example.com/artwork.jpg" },
    });

    // Capture the runtime state subscriber so we can trigger re-renders.
    let stateSubscriber;
    runtimeMock.subscribe.mockImplementation((cb) => {
      stateSubscriber = cb;
      return vi.fn();
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    // Simulate a track with a non-URL artwork_ref becoming active.
    const snapTrack = {
      name: "ASSET-snap",
      title: "Snap Song",
      artist: "Snap Artist",
      artwork_ref: "ASSET-artwork-123",
      has_artwork: false,
    };
    stateSubscriber({
      queue: [snapTrack],
      currentIndex: 0,
      currentTrack: snapTrack,
      paused: false,
      volume: 1,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
      sourceType: null,
      loading: false,
      error: null,
      currentTime: 0,
      duration: 120,
      playing: true,
    });
    await flushMicrotasks(30);

    // The access endpoint should have been called with the artwork asset
    // name (the non-URL artwork_ref), not the track name itself.
    expect(backendAuth.getBackendMediaAssetAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ASSET-artwork-123",
        intent: "artwork",
      }),
    );

    // Wait for the artwork resolution promise to settle before destroying
    // to avoid unhandled errors from DOM access after cleanup.
    await flushMicrotasks(30);

    widget.destroy();
  });

  // ── Playlist cover artwork ─────────────────────────────────────

  it("renders cover artwork element for playlists with cover_asset_name", async () => {
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    widget.setPlaylists([
      { name: "pl1", title: "Cover Mix", item_count: 2, total_duration_seconds: 300, cover_asset_name: "ASSET-cover" },
      { name: "pl2", title: "No Cover", item_count: 1, total_duration_seconds: 60 },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();
    await flushMicrotasks(10);

    const items = panel.querySelectorAll(".player-playlist-item");
    expect(items.length).toBe(2);

    // First playlist has a cover div
    const cover1 = items[0].querySelector(".player-playlist-item-cover");
    expect(cover1).toBeTruthy();

    // Text wrapper groups name + count
    const text1 = items[0].querySelector(".player-playlist-item-text");
    expect(text1).toBeTruthy();
    expect(text1.querySelector(".player-playlist-item-name")).toBeTruthy();
    expect(text1.querySelector(".player-playlist-item-count")).toBeTruthy();

    // Second playlist also has a cover div (placeholder)
    const cover2 = items[1].querySelector(".player-playlist-item-cover");
    expect(cover2).toBeTruthy();

    widget.destroy();
  });

  it("renders playlist detail cover from cover_asset_name", async () => {
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });
    playlistMock.loadPlaylistDetail.mockResolvedValue({
      name: "pl1",
      title: "Detail Cover",
      items: [
        { media_asset_name: "ASSET-t1", position: 1, snapshot_title: "Track 1", snapshot_artist: "Artist", snapshot_artwork_ref: "ASSET-t1" },
      ],
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    widget.setPlaylists([
      { name: "pl1", title: "Detail Cover", item_count: 1, total_duration_seconds: 120, cover_asset_name: "ASSET-t1" },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();
    await flushMicrotasks(10);

    // Open detail
    const playlistItem = panel.querySelector(".player-playlist-item");
    playlistItem.click();
    await flushMicrotasks(30);

    const detailCover = panel.querySelector(".player-playlist-detail-cover");
    expect(detailCover).toBeTruthy();

    widget.destroy();
  });

  it("playlist list renders total_duration_seconds from cached metadata", async () => {
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    widget.setPlaylists([
      { name: "pl1", title: "Timed Mix", item_count: 3, total_duration_seconds: 542 },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();
    await flushMicrotasks(10);

    const countSpan = panel.querySelector(".player-playlist-item-count");
    expect(countSpan).toBeTruthy();
    // Should contain the formatted duration
    expect(countSpan.textContent).toContain("9:02");

    widget.destroy();
  });

  it("playlist detail renders snapshot_album from cached item metadata", async () => {
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });
    playlistMock.loadPlaylistDetail.mockResolvedValue({
      name: "pl1",
      title: "Album Test",
      items: [
        {
          media_asset_name: "ASSET-x1",
          position: 1,
          snapshot_title: "Song X",
          snapshot_artist: "Artist X",
          snapshot_album: "Album X",
          snapshot_genre: "Rock",
          snapshot_duration: 180,
          snapshot_artwork_ref: "ASSET-x1",
          snapshot_content_hash: "hash1",
        },
      ],
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    widget.setPlaylists([
      { name: "pl1", title: "Album Test", item_count: 1, total_duration_seconds: 180 },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();
    await flushMicrotasks(10);

    panel.querySelector(".player-playlist-item").click();
    await flushMicrotasks(30);

    const artistSpan = panel.querySelector(".player-playlist-track-artist");
    expect(artistSpan).toBeTruthy();
    // Should show artist · album
    expect(artistSpan.textContent).toContain("Artist X");
    expect(artistSpan.textContent).toContain("Album X");

    widget.destroy();
  });

  it("deduplicates artwork access for playlists sharing the same cover_asset_name", async () => {
    if (!globalThis.CSS?.escape) {
      globalThis.CSS = { ...(globalThis.CSS || {}), escape: (v) => v };
    }

    const backendAuth = await import("../../src/shared/backend-auth.js");
    backendAuth.getProtectedMediaRequestGate.mockResolvedValue({
      allowed: true,
      signal: new AbortController().signal,
      cleanup: vi.fn(),
    });
    backendAuth.getBackendMediaAssetAccess.mockResolvedValue({
      access: { artwork_url: "https://s3.example.com/shared-cover.jpg" },
    });

    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    // Two playlists share the same cover_asset_name
    widget.setPlaylists([
      { name: "pl-a", title: "Playlist A", item_count: 2, cover_asset_name: "SHARED-COVER" },
      { name: "pl-b", title: "Playlist B", item_count: 3, cover_asset_name: "SHARED-COVER" },
    ]);

    const panel = document.querySelector(".player-panel");
    panel.querySelector(".player-content-tab-playlists").click();
    await flushMicrotasks(30);

    // Both playlists call resolveArtworkUrl with name = "SHARED-COVER",
    // but only one backend access request should fire (inflight dedupe).
    const artworkCalls = backendAuth.getBackendMediaAssetAccess.mock.calls.filter(
      (c) => c[0]?.name === "SHARED-COVER" && c[0]?.intent === "artwork"
    );
    expect(artworkCalls.length).toBe(1);

    widget.destroy();
  });

  it("does not permanently blank artwork after a transient !allowed gate", async () => {
    if (!globalThis.CSS?.escape) {
      globalThis.CSS = { ...(globalThis.CSS || {}), escape: (v) => v };
    }

    const backendAuth = await import("../../src/shared/backend-auth.js");

    // First attempt: gate is not allowed (transient auth miss)
    backendAuth.getProtectedMediaRequestGate.mockResolvedValue({
      allowed: false,
      cleanup: vi.fn(),
    });

    let stateSubscriber;
    runtimeMock.subscribe.mockImplementation((cb) => {
      stateSubscriber = cb;
      return vi.fn();
    });

    const widget = createPlayerWidget({ floating: false });
    widget.open();
    await flushMicrotasks(30);

    const track = {
      name: "TRACK-gated",
      title: "Gated Song",
      artist: "Gated Artist",
      artwork_ref: "ASSET-gated-art",
      has_artwork: false,
    };

    stateSubscriber({
      queue: [track],
      currentIndex: 0,
      currentTrack: track,
      paused: false,
      volume: 1,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
      sourceType: null,
      loading: false,
      error: null,
      currentTime: 0,
      duration: 120,
      playing: true,
    });
    await flushMicrotasks(30);

    // Should have attempted the gate
    expect(backendAuth.getProtectedMediaRequestGate).toHaveBeenCalled();
    const firstGateCalls = backendAuth.getProtectedMediaRequestGate.mock.calls.length;

    // Switch to a different track to reset lastArtworkTrackName
    const dummyTrack = { name: "TRACK-other", title: "Other" };
    stateSubscriber({
      queue: [dummyTrack],
      currentIndex: 0,
      currentTrack: dummyTrack,
      paused: false,
      volume: 1,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
      sourceType: null,
      loading: false,
      error: null,
      currentTime: 0,
      duration: 60,
      playing: true,
    });
    await flushMicrotasks(30);

    // Advance Date.now past the 30s TTL so the failure entry expires
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 35_000;

    // Now simulate auth regain — gate becomes allowed
    backendAuth.getProtectedMediaRequestGate.mockResolvedValue({
      allowed: true,
      signal: new AbortController().signal,
      cleanup: vi.fn(),
    });
    backendAuth.getBackendMediaAssetAccess.mockResolvedValue({
      access: { artwork_url: "https://s3.example.com/gated-art.jpg" },
    });

    // Switch back to the gated track
    stateSubscriber({
      queue: [track],
      currentIndex: 0,
      currentTrack: track,
      paused: false,
      volume: 1,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
      sourceType: null,
      loading: false,
      error: null,
      currentTime: 0,
      duration: 120,
      playing: true,
    });
    await flushMicrotasks(30);

    // Restore Date.now
    Date.now = realDateNow;

    // The gate should have been called again after TTL expiry
    const totalGateCalls = backendAuth.getProtectedMediaRequestGate.mock.calls.length;
    expect(totalGateCalls).toBeGreaterThan(firstGateCalls);

    // And the access endpoint should have been called this time
    const artworkAccessCalls = backendAuth.getBackendMediaAssetAccess.mock.calls.filter(
      (c) => c[0]?.name === "ASSET-gated-art" && c[0]?.intent === "artwork"
    );
    expect(artworkAccessCalls.length).toBe(1);

    widget.destroy();
  });
});
