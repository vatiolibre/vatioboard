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
  setMediaSessionEnabled: vi.fn(),
};

vi.mock("../../src/shared/audio-runtime.js", () => runtimeMock);

const catalogMock = {
  loadAudioCatalog: vi.fn().mockResolvedValue({ tracks: [], total: 0 }),
  syncAudioCatalog: vi.fn().mockResolvedValue(false),
  annotateOfflineAvailability: vi.fn().mockImplementation((tracks) =>
    Promise.resolve(tracks.map((t) => ({ ...t, _offline: false }))),
  ),
};

vi.mock("../../src/shared/audio-catalog.js", () => catalogMock);

vi.mock("../../src/shared/backend-auth.js", () => ({
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

vi.mock("../../src/shared/player-session.js", () => ({
  loadPlayerSession: vi.fn().mockReturnValue(null),
  savePlayerSession: vi.fn(),
}));

vi.mock("../../src/shared/audio-source-resolver.js", () => ({
  resolveAudioSource: vi.fn().mockResolvedValue({ src: "blob://test", revoke: vi.fn(), type: "local" }),
  hasLocalSource: vi.fn().mockReturnValue(false),
  triggerBackgroundCache: vi.fn(),
}));

vi.mock("../../src/shared/audio-cue.js", () => ({
  setMainAudioElement: vi.fn(),
  playAudioCue: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ──────────────────────────────────────────────────────────

async function flushMicrotasks(n = 10) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("integratePlayerWidget", () => {
  let integratePlayerWidget;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-runtime.js", () => runtimeMock);
    vi.doMock("../../src/shared/audio-catalog.js", () => catalogMock);
    vi.doMock("../../src/shared/backend-auth.js", () => ({
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
    vi.doMock("../../src/shared/player-session.js", () => ({
      loadPlayerSession: vi.fn().mockReturnValue(null),
      savePlayerSession: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-source-resolver.js", () => ({
      resolveAudioSource: vi.fn().mockResolvedValue({ src: "blob://test", revoke: vi.fn(), type: "local" }),
      hasLocalSource: vi.fn().mockReturnValue(false),
      triggerBackgroundCache: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-cue.js", () => ({
      setMainAudioElement: vi.fn(),
      playAudioCue: vi.fn().mockResolvedValue(undefined),
    }));

    runtimeMock.subscribe.mockReturnValue(vi.fn());
    runtimeMock.setMediaSessionEnabled.mockClear();

    const mod = await import("../../src/player/integrate-player-widget.js");
    integratePlayerWidget = mod.integratePlayerWidget;
  });

  afterEach(() => {
    document.querySelectorAll(".player-panel, .player-fab").forEach((el) => el.remove());
  });

  it("injects a player button into the tools menu list", () => {
    const list = document.createElement("ul");
    const menu = { close: vi.fn() };

    const { widget, button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    expect(button).toBeTruthy();
    expect(button.dataset.playerToggle).toBe("true");
    expect(button.querySelector(".btn-icon svg")).toBeTruthy();
    expect(button.textContent).toContain("player");
    expect(list.querySelector("[data-player-toggle]")).toBe(button);
    expect(widget).toBeTruthy();
  });

  it("clicking the button toggles the widget and closes the menu", () => {
    const list = document.createElement("ul");
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    button.click();

    expect(menu.close).toHaveBeenCalledTimes(1);
    // Panel should be visible after toggle
    const panel = document.querySelector(".player-panel");
    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(false);
  });

  it("disables media session when mediaSession: false", () => {
    const list = document.createElement("ul");
    const menu = { close: vi.fn() };

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu, mediaSession: false });

    expect(runtimeMock.setMediaSessionEnabled).toHaveBeenCalledWith(false);
  });

  it("does not disable media session by default", () => {
    const list = document.createElement("ul");
    const menu = { close: vi.fn() };

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    expect(runtimeMock.setMediaSessionEnabled).not.toHaveBeenCalled();
  });

  it("works without a toolsMenuList (no button injected)", () => {
    const menu = { close: vi.fn() };

    const { widget, button } = integratePlayerWidget({ toolsMenu: menu });

    expect(button).toBeNull();
    expect(widget).toBeTruthy();
  });
});
