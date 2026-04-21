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
  stopPlayback: vi.fn(),
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

function emitAuthState(detail) {
  window.dispatchEvent(
    new CustomEvent("vatioboard:backend-auth-state", { detail })
  );
}

function makeToolsMenuList(authState = "guest") {
  const list = document.createElement("div");
  list.className = "tools-menu-list";
  const form = document.createElement("form");
  form.setAttribute("data-backend-auth", "");
  form.dataset.authState = authState;
  list.append(form);
  return list;
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
    runtimeMock.stopPlayback.mockClear();

    const mod = await import("../../src/player/integrate-player-widget.js");
    integratePlayerWidget = mod.integratePlayerWidget;
  });

  afterEach(() => {
    document.querySelectorAll(".player-panel, .player-fab").forEach((el) => el.remove());
    localStorage.removeItem("player_widget_visible_v1");
  });

  // ── Launcher formatting ──────────────────────────────────────

  it("injects a btn-with-icon button before the backend-auth form", () => {
    const list = makeToolsMenuList();
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    expect(button).toBeTruthy();
    expect(button.className).toBe("btn-with-icon");
    expect(button.parentElement).toBe(list);
    expect(button.dataset.playerToggle).toBe("true");
    expect(button.querySelector(".btn-icon[aria-hidden='true'] svg")).toBeTruthy();
    expect(button.querySelector("[data-i18n='audioPlayer']")).toBeTruthy();
    expect(button.querySelector("[data-i18n='audioPlayer']").textContent).toBe("audioPlayer");
    // Should be inserted before the auth form
    const form = list.querySelector("[data-backend-auth]");
    expect(button.nextElementSibling).toBe(form);
  });

  it("does not wrap the button in a <li>", () => {
    const list = makeToolsMenuList();
    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() } });
    expect(button.parentElement.tagName).not.toBe("LI");
  });

  // ── Auth gating: guest state ─────────────────────────────────

  it("hides the launcher and FAB when auth state is guest", () => {
    const list = makeToolsMenuList("guest");
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    expect(button.hidden).toBe(true);
    const fab = document.querySelector(".player-fab");
    expect(fab).toBeTruthy();
    expect(fab.hidden).toBe(true);
    expect(runtimeMock.stopPlayback).not.toHaveBeenCalled();
  });

  it("does not stop playback for an initial unknown auth state during page refresh", () => {
    const list = makeToolsMenuList();
    const form = list.querySelector("[data-backend-auth]");
    delete form.dataset.authState;

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() } });

    expect(document.querySelector(".player-fab").hidden).toBe(true);
    expect(runtimeMock.stopPlayback).not.toHaveBeenCalled();
  });

  it("does not stop playback when a guest auth event confirms the initial signed-out state", () => {
    const list = makeToolsMenuList("guest");
    integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() } });

    emitAuthState({ authenticated: false, isGuest: true, pendingLogout: false });

    expect(runtimeMock.stopPlayback).not.toHaveBeenCalled();
  });

  // ── Auth gating: authenticated state ─────────────────────────

  it("shows the launcher and FAB when initial auth state is authenticated", () => {
    const list = makeToolsMenuList("authenticated");
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    expect(button.hidden).toBe(false);
    const fab = document.querySelector(".player-fab");
    expect(fab.hidden).toBe(false);
  });

  it("restores visible panel state when initial auth state is authenticated", () => {
    localStorage.setItem("player_widget_visible_v1", "true");
    const list = makeToolsMenuList("authenticated");

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() } });

    expect(document.querySelector(".player-panel").hidden).toBe(false);
  });

  it("does not restore visible panel state before auth is known", () => {
    localStorage.setItem("player_widget_visible_v1", "true");
    const list = makeToolsMenuList();
    const form = list.querySelector("[data-backend-auth]");
    delete form.dataset.authState;

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() } });

    expect(document.querySelector(".player-panel").hidden).toBe(true);
    expect(localStorage.getItem("player_widget_visible_v1")).toBe("true");
    expect(runtimeMock.stopPlayback).not.toHaveBeenCalled();
  });

  it("restores visible panel state when auth becomes authenticated", () => {
    localStorage.setItem("player_widget_visible_v1", "true");
    const list = makeToolsMenuList();
    const form = list.querySelector("[data-backend-auth]");
    delete form.dataset.authState;

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() } });

    expect(document.querySelector(".player-panel").hidden).toBe(true);

    emitAuthState({ authenticated: true, isGuest: false, pendingLogout: false });

    expect(document.querySelector(".player-panel").hidden).toBe(false);
  });

  // ── Auth transitions ─────────────────────────────────────────

  it("shows launcher and FAB when auth transitions from guest to authenticated", () => {
    const list = makeToolsMenuList("guest");
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    expect(button.hidden).toBe(true);

    emitAuthState({ authenticated: true, isGuest: false, pendingLogout: false });

    expect(button.hidden).toBe(false);
    expect(document.querySelector(".player-fab").hidden).toBe(false);
  });

  it("hides launcher, FAB and stops playback on logout", () => {
    const list = makeToolsMenuList("authenticated");
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });
    expect(button.hidden).toBe(false);

    emitAuthState({ authenticated: false, isGuest: true, pendingLogout: false });

    expect(button.hidden).toBe(true);
    expect(document.querySelector(".player-fab").hidden).toBe(true);
    expect(runtimeMock.stopPlayback).toHaveBeenCalled();
  });

  it("hides launcher on pending logout", () => {
    const list = makeToolsMenuList("authenticated");
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    emitAuthState({ authenticated: true, isGuest: false, pendingLogout: true });

    expect(button.hidden).toBe(true);
    expect(runtimeMock.stopPlayback).toHaveBeenCalled();
  });

  // ── FAB presence ─────────────────────────────────────────────

  it("creates a floating FAB via the widget", () => {
    const list = makeToolsMenuList("authenticated");
    const menu = { close: vi.fn() };

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    const fab = document.querySelector(".player-fab");
    expect(fab).toBeTruthy();
  });

  // ── Media Session ────────────────────────────────────────────

  it("calls setMediaSessionEnabled(true) by default", () => {
    const list = makeToolsMenuList();
    integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() } });
    expect(runtimeMock.setMediaSessionEnabled).toHaveBeenCalledWith(true);
  });

  it("calls setMediaSessionEnabled(false) when mediaSession: false", () => {
    const list = makeToolsMenuList();
    integratePlayerWidget({ toolsMenuList: list, toolsMenu: { close: vi.fn() }, mediaSession: false });
    expect(runtimeMock.setMediaSessionEnabled).toHaveBeenCalledWith(false);
  });

  it("Media Session false then true does not leak across integrations", () => {
    const list1 = makeToolsMenuList();
    integratePlayerWidget({ toolsMenuList: list1, toolsMenu: { close: vi.fn() }, mediaSession: false });
    expect(runtimeMock.setMediaSessionEnabled).toHaveBeenCalledWith(false);

    runtimeMock.setMediaSessionEnabled.mockClear();

    const list2 = makeToolsMenuList();
    integratePlayerWidget({ toolsMenuList: list2, toolsMenu: { close: vi.fn() }, mediaSession: true });
    expect(runtimeMock.setMediaSessionEnabled).toHaveBeenCalledWith(true);
  });

  // ── Duplicate injection guard ────────────────────────────────

  it("does not inject a second button if called twice on the same list", () => {
    const list = makeToolsMenuList();
    const menu = { close: vi.fn() };

    integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });
    integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    expect(list.querySelectorAll("[data-player-toggle]")).toHaveLength(1);
  });

  // ── Menu close on open ───────────────────────────────────────

  it("closes the tools menu when the player opens via the launcher", () => {
    const list = makeToolsMenuList("authenticated");
    const menu = { close: vi.fn() };

    const { button } = integratePlayerWidget({ toolsMenuList: list, toolsMenu: menu });

    button.click();

    expect(menu.close).toHaveBeenCalled();
  });
});
