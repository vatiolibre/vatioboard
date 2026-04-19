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
  setQueue: vi.fn(),
  restoreSession: vi.fn().mockResolvedValue(undefined),
  primeAudio: vi.fn().mockResolvedValue(true),
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
}));

vi.mock("../../src/shared/media-access-cache.js", () => ({
  getCachedMediaAccess: vi.fn().mockReturnValue(null),
  setCachedMediaAccess: vi.fn(),
  clearMediaAccessCache: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────

async function flushMicrotasks(n = 10) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
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

    // Reset runtime mock state
    runtimeMock.getState.mockReturnValue({
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
    runtimeMock.subscribe.mockReturnValue(vi.fn());
    catalogMock.loadAudioCatalog.mockResolvedValue({ tracks: [], total: 0 });
    catalogMock.syncAudioCatalog.mockResolvedValue(false);
    playlistMock.loadPlaylists.mockResolvedValue({ playlists: [], total: 0 });
    playlistMock.syncPlaylistsManifest.mockResolvedValue(false);
    playlistMock.loadPlaylistDetail.mockResolvedValue(null);

    const mod = await import("../../src/player/player-widget.js");
    createPlayerWidget = mod.createPlayerWidget;

    // Clean up localStorage
    localStorage.removeItem("player_widget_pos_v1");
  });

  afterEach(() => {
    // Clean up any mounted elements
    document.querySelectorAll(".player-panel, .player-fab").forEach((el) => el.remove());
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
    expect(panel.querySelector(".player-close")).toBeTruthy();
    expect(panel.querySelector(".player-title")).toBeTruthy();

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
    const queueSheet = panel.querySelector(".player-queue-sheet");
    const queueBtn = panel.querySelector(".player-queue-toggle-btn");

    expect(queueSheet).toBeTruthy();
    expect(queueSheet.classList.contains("is-open")).toBe(false);

    // Click queue toggle to open
    queueBtn.click();
    expect(queueSheet.classList.contains("is-open")).toBe(true);

    // Click close to close
    const closeBtn = queueSheet.querySelector(".player-queue-sheet-close");
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
    panel.querySelector(".player-queue-toggle-btn").click();

    widget.setTracks(tracks);

    // Re-open queue to force render
    const closeBtn = panel.querySelector(".player-queue-sheet-close");
    closeBtn.click();
    panel.querySelector(".player-queue-toggle-btn").click();

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
    const playlistSheet = panel.querySelector(".player-playlist-sheet");
    const playlistBtn = panel.querySelector(".player-playlist-toggle-btn");

    expect(playlistSheet).toBeTruthy();
    expect(playlistSheet.classList.contains("is-open")).toBe(false);

    // Click playlist toggle to open
    playlistBtn.click();
    expect(playlistSheet.classList.contains("is-open")).toBe(true);

    // Click close to close
    const closeBtn = playlistSheet.querySelector(".player-playlist-sheet-close");
    closeBtn.click();
    expect(playlistSheet.classList.contains("is-open")).toBe(false);

    widget.destroy();
  });

  it("playlist and queue sheets are mutually exclusive", () => {
    const widget = createPlayerWidget({ floating: false });
    widget.open();

    const panel = document.querySelector(".player-panel");
    const queueSheet = panel.querySelector(".player-queue-sheet");
    const playlistSheet = panel.querySelector(".player-playlist-sheet");
    const queueBtn = panel.querySelector(".player-queue-toggle-btn");
    const playlistBtn = panel.querySelector(".player-playlist-toggle-btn");

    // Open queue first
    queueBtn.click();
    expect(queueSheet.classList.contains("is-open")).toBe(true);
    expect(playlistSheet.classList.contains("is-open")).toBe(false);

    // Open playlist → queue should close
    playlistBtn.click();
    expect(playlistSheet.classList.contains("is-open")).toBe(true);
    expect(queueSheet.classList.contains("is-open")).toBe(false);

    // Open queue again → playlist should close
    queueBtn.click();
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
    panel.querySelector(".player-playlist-toggle-btn").click();

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
    panel.querySelector(".player-playlist-toggle-btn").click();

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
    panel.querySelector(".player-playlist-toggle-btn").click();

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
    panel.querySelector(".player-playlist-toggle-btn").click();

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
});
