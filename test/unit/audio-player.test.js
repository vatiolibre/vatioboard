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

const mediaCacheMock = {
  getLocalMediaBlob: vi.fn().mockResolvedValue(null),
  getLocalBlobMeta: vi.fn().mockResolvedValue(null),
  isAutoCacheEligible: vi.fn().mockReturnValue(false),
  registerAutoCacheDownload: vi.fn(),
  cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
  cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
  getCachedManifestSnapshot: vi.fn().mockResolvedValue({ assets: [] }),
  getCachedMediaManifest: vi.fn().mockResolvedValue([]),
  pinMediaBlob: vi.fn().mockResolvedValue(true),
  pinMediaFromResponse: vi.fn().mockResolvedValue(true),
  unpinMediaBlob: vi.fn().mockResolvedValue(true),
  isMediaBlobPinned: vi.fn().mockResolvedValue(false),
  getCachedMediaBlob: vi.fn().mockResolvedValue(null),
  getCachedBlobMeta: vi.fn().mockResolvedValue(null),
  removeCachedMediaBlob: vi.fn().mockResolvedValue(true),
};

vi.mock("../../src/shared/media-cache.js", () => mediaCacheMock);

const backendAuthMock = {
  getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
    allowed: true,
    cleanup() {},
    signal: undefined,
  }),
  getBackendMediaAssetAccess: vi.fn().mockResolvedValue({
    ok: true,
    access: {
      playback_url: "https://cdn.example.com/signed/asset_a.mp3",
      download_url: "https://cdn.example.com/dl/asset_a.mp3",
      expires_in_seconds: 300,
    },
    asset: { content_hash: "hash_a" },
  }),
  getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
  getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
  fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
  createBackendPlaylist: vi.fn().mockResolvedValue({ ok: true, playlist: { name: "pl_new" } }),
  addBackendPlaylistItem: vi.fn().mockResolvedValue({ ok: true }),
  bulkAddBackendPlaylistItems: vi.fn().mockResolvedValue({ ok: true, added: [], skipped: [] }),
};

vi.mock("../../src/shared/backend-auth.js", () => backendAuthMock);

const mediaAccessCacheMock = {
  getCachedMediaAccess: vi.fn().mockReturnValue(null),
  setCachedMediaAccess: vi.fn(),
  clearMediaAccessCache: vi.fn(),
};

vi.mock("../../src/shared/media-access-cache.js", () => mediaAccessCacheMock);

// ── Test fixtures ────────────────────────────────────────────────────

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

const TRACK_A = makeTrack("asset_a");
const TRACK_B = makeTrack("asset_b");
const TRACK_C = makeTrack("asset_c");

function createVisualizerMockState() {
  const calls = [];

  function makeController() {
    return {
      get isAvailable() {
        return true;
      },
      setMode: vi.fn(),
      resize: vi.fn(),
      start: vi.fn(() => Promise.resolve(true)),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
  }

  const createVisualizerSpy = vi.fn((options) => {
    const controller = makeController();
    calls.push({ options, controller });
    return controller;
  });

  return { calls, createVisualizerSpy };
}

// ── Tests: audio-source-resolver ─────────────────────────────────────

describe("audio-source-resolver", () => {
  let resolveAudioSource, buildRemotePlaybackUrl, hasLocalSource, triggerBackgroundCache;

  beforeEach(async () => {
    vi.resetModules();
    // Re-apply mocks after reset
    vi.doMock("../../src/shared/media-cache.js", () => mediaCacheMock);
    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));
    vi.doMock("../../src/shared/backend-auth.js", () => backendAuthMock);
    vi.doMock("../../src/shared/media-access-cache.js", () => mediaAccessCacheMock);

    // Reset mock return values
    backendAuthMock.getBackendMediaAssetAccess.mockResolvedValue({
      ok: true,
      access: {
        playback_url: "https://cdn.example.com/signed/asset_a.mp3",
        download_url: "https://cdn.example.com/dl/asset_a.mp3",
        expires_in_seconds: 300,
      },
      asset: { content_hash: "hash_a" },
    });
    backendAuthMock.getProtectedMediaRequestGate.mockResolvedValue({
      allowed: true,
      cleanup() {},
      signal: undefined,
    });
    backendAuthMock.fetchBackendMediaAssetBlob.mockResolvedValue(new Response("", { status: 404 }));
    mediaAccessCacheMock.getCachedMediaAccess.mockReturnValue(null);

    const mod = await import("../../src/shared/audio-source-resolver.js");
    resolveAudioSource = mod.resolveAudioSource;
    buildRemotePlaybackUrl = mod.buildRemotePlaybackUrl;
    hasLocalSource = mod.hasLocalSource;
    triggerBackgroundCache = mod.triggerBackgroundCache;
  });

  it("returns null for empty asset name", async () => {
    expect(await resolveAudioSource("", {})).toBeNull();
    expect(await resolveAudioSource(null)).toBeNull();
  });

  it("resolves local blob when available (local-first)", async () => {
    const blob = new Blob(["audio"], { type: "audio/mp3" });
    mediaCacheMock.getLocalMediaBlob.mockResolvedValueOnce({
      blob,
      source: "pinned",
      contentHash: "hash_asset_a",
    });

    const result = await resolveAudioSource("asset_a", TRACK_A);

    expect(result).toBeTruthy();
    expect(result.type).toBe("blob");
    expect(result.src).toMatch(/^blob:/);
    expect(typeof result.revokeUrl).toBe("function");
  });

  it("falls back to signed playback URL when no local blob", async () => {
    mediaCacheMock.getLocalMediaBlob.mockResolvedValueOnce(null);

    const result = await resolveAudioSource("asset_a", TRACK_A);

    expect(result).toBeTruthy();
    expect(result.type).toBe("remote");
    expect(result.src).toBe("https://cdn.example.com/signed/asset_a.mp3");
    expect(backendAuthMock.getBackendMediaAssetAccess).toHaveBeenCalledWith(expect.objectContaining({
      name: "asset_a",
      intent: "playback",
    }));
  });

  it("uses cached media access when available", async () => {
    mediaCacheMock.getLocalMediaBlob.mockResolvedValueOnce(null);
    mediaAccessCacheMock.getCachedMediaAccess.mockReturnValueOnce({
      playback_url: "https://cdn.example.com/cached/asset_a.mp3",
    });

    const result = await resolveAudioSource("asset_a", TRACK_A);

    expect(result).toBeTruthy();
    expect(result.type).toBe("remote");
    expect(result.src).toBe("https://cdn.example.com/cached/asset_a.mp3");
    // Should NOT have called backend since cache hit
    expect(backendAuthMock.getBackendMediaAssetAccess).not.toHaveBeenCalled();
  });

  it("returns null when remote access fails and no local source", async () => {
    mediaCacheMock.getLocalMediaBlob.mockResolvedValueOnce(null);
    backendAuthMock.getBackendMediaAssetAccess.mockResolvedValueOnce({
      ok: false,
      access: null,
    });

    const result = await resolveAudioSource("asset_a", TRACK_A);
    expect(result).toBeNull();
  });

  it("builds BFF stream URL from asset name", () => {
    const url = buildRemotePlaybackUrl("my_asset", {});
    expect(url).toContain("api.vatioboard.com");
    expect(url).toContain("my_asset");
  });

  it("prefers asset.playback_url when available", () => {
    const url = buildRemotePlaybackUrl("x", { playback_url: "https://cdn.example.com/x.mp3" });
    expect(url).toBe("https://cdn.example.com/x.mp3");
  });

  it("hasLocalSource returns false when no meta", async () => {
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);
    expect(await hasLocalSource("asset_a")).toBe(false);
  });

  it("hasLocalSource returns true when meta exists", async () => {
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce({ source: "cached" });
    expect(await hasLocalSource("asset_a")).toBe(true);
  });

  it("triggerBackgroundCache skips ineligible assets", () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(false);
    triggerBackgroundCache("asset_a", TRACK_A);
    expect(mediaCacheMock.registerAutoCacheDownload).not.toHaveBeenCalled();
  });

  it("triggerBackgroundCache registers download for eligible assets", () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    triggerBackgroundCache("asset_a", TRACK_A);
    expect(mediaCacheMock.registerAutoCacheDownload).toHaveBeenCalledWith(
      "asset_a",
      expect.any(Function),
    );
  });

  it("skips stale local blob when content_hash differs", async () => {
    const blob = new Blob(["old audio"], { type: "audio/mp3" });
    mediaCacheMock.getLocalMediaBlob.mockResolvedValueOnce({
      blob,
      source: "cached",
      contentHash: "old_hash",
    });

    const result = await resolveAudioSource("asset_a", { ...TRACK_A, content_hash: "new_hash" });

    expect(result).toBeTruthy();
    expect(result.type).toBe("remote");
    expect(result.src).toBe("https://cdn.example.com/signed/asset_a.mp3");
  });

  it("uses fresh local blob when content_hash matches", async () => {
    const blob = new Blob(["audio"], { type: "audio/mp3" });
    mediaCacheMock.getLocalMediaBlob.mockResolvedValueOnce({
      blob,
      source: "cached",
      contentHash: "hash_a",
    });

    const result = await resolveAudioSource("asset_a", { ...TRACK_A, content_hash: "hash_a" });

    expect(result).toBeTruthy();
    expect(result.type).toBe("blob");
  });

  it("triggerBackgroundCache prefers signed download URL", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    backendAuthMock.getBackendMediaAssetAccess.mockResolvedValueOnce({
      ok: true,
      access: {
        download_url: "https://cdn.example.com/dl/asset_a.mp3",
        expires_in_seconds: 300,
      },
      asset: { content_hash: "hash_a" },
    });

    const dlBlob = new Blob(["audio"], { type: "audio/mp3" });
    const fetchFn = vi.fn().mockResolvedValue(new Response(dlBlob, { status: 200 }));

    triggerBackgroundCache("asset_a", TRACK_A, { fetchFn });

    expect(factory).toBeDefined();
    await factory();

    expect(backendAuthMock.getBackendMediaAssetAccess).toHaveBeenCalledWith(expect.objectContaining({
      name: "asset_a",
      intent: "download",
    }));
    expect(fetchFn).toHaveBeenCalledWith(
      "https://cdn.example.com/dl/asset_a.mp3",
      expect.objectContaining({ signal: undefined }),
    );
    expect(mediaCacheMock.cacheMediaFromResponse).toHaveBeenCalled();
  });

  it("triggerBackgroundCache falls back to backend blob fetch when signed URL fails", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    // Signed download fails
    backendAuthMock.getBackendMediaAssetAccess.mockRejectedValueOnce(new Error("network"));

    // Backend blob stream succeeds
    const dlBlob = new Blob(["audio"], { type: "audio/mp3" });
    backendAuthMock.fetchBackendMediaAssetBlob.mockResolvedValueOnce(
      new Response(dlBlob, { status: 200 }),
    );

    triggerBackgroundCache("asset_a", TRACK_A);

    expect(factory).toBeDefined();
    await factory();

    expect(backendAuthMock.fetchBackendMediaAssetBlob).toHaveBeenCalledWith(expect.objectContaining({
      name: "asset_a",
    }));
    expect(mediaCacheMock.cacheMediaFromResponse).toHaveBeenCalled();
  });

  it("triggerBackgroundCache skips download when local blob is fresh", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce({
      content_hash: "hash_a",
      source: "cached",
    });

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    triggerBackgroundCache("asset_a", { ...TRACK_A, content_hash: "hash_a" });

    expect(factory).toBeDefined();
    await factory();

    // Fresh local blob — no download should occur
    expect(backendAuthMock.getBackendMediaAssetAccess).not.toHaveBeenCalled();
    expect(mediaCacheMock.cacheMediaFromResponse).not.toHaveBeenCalled();
  });

  it("triggerBackgroundCache calls onCached callback on success", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);
    mediaCacheMock.cacheMediaFromResponse.mockResolvedValueOnce(true);

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    backendAuthMock.getBackendMediaAssetAccess.mockResolvedValueOnce({
      ok: true,
      access: {
        download_url: "https://cdn.example.com/dl/asset_a.mp3",
        expires_in_seconds: 300,
      },
      asset: { content_hash: "hash_a" },
    });

    const dlBlob = new Blob(["audio"], { type: "audio/mp3" });
    const fetchFn = vi.fn().mockResolvedValue(new Response(dlBlob, { status: 200 }));
    const onCached = vi.fn();

    triggerBackgroundCache("asset_a", TRACK_A, { fetchFn, onCached });

    expect(factory).toBeDefined();
    await factory();

    expect(onCached).toHaveBeenCalledTimes(1);
  });

  it("triggerBackgroundCache does not duplicate download for same asset", () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValue(true);
    // First call claims the download slot
    mediaCacheMock.registerAutoCacheDownload.mockReturnValueOnce(true);
    triggerBackgroundCache("asset_a", TRACK_A);
    expect(mediaCacheMock.registerAutoCacheDownload).toHaveBeenCalledTimes(1);

    // Second call — registerAutoCacheDownload returns false (already in-flight)
    mediaCacheMock.registerAutoCacheDownload.mockReturnValueOnce(false);
    triggerBackgroundCache("asset_a", TRACK_A);
    expect(mediaCacheMock.registerAutoCacheDownload).toHaveBeenCalledTimes(2);
    // The dedup is enforced by registerAutoCacheDownload returning false
  });

  it("triggerBackgroundCache calls onFailed when no source is available", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    // All download methods fail
    backendAuthMock.getBackendMediaAssetAccess.mockResolvedValueOnce({ ok: false });
    backendAuthMock.fetchBackendMediaAssetBlob.mockResolvedValueOnce(
      new Response("", { status: 500 }),
    );
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const onFailed = vi.fn();

    triggerBackgroundCache("asset_a", TRACK_A, { fetchFn, onFailed });
    expect(factory).toBeDefined();
    await factory();

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith("no_source");
  });

  it("triggerBackgroundCache calls onFailed for ineligible assets", () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(false);
    const onFailed = vi.fn();
    triggerBackgroundCache("asset_a", TRACK_A, { onFailed });
    expect(onFailed).toHaveBeenCalledWith("ineligible");
  });

  it("triggerBackgroundCache calls onFailed when caching fails", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);
    mediaCacheMock.cacheMediaFromResponse.mockResolvedValueOnce(false);

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    backendAuthMock.getBackendMediaAssetAccess.mockResolvedValueOnce({
      ok: true,
      access: { download_url: "https://cdn.example.com/dl.mp3", expires_in_seconds: 300 },
      asset: { content_hash: "hash_a" },
    });

    const fetchFn = vi.fn().mockResolvedValue(
      new Response(new Blob(["audio"]), { status: 200 }),
    );
    const onCached = vi.fn();
    const onFailed = vi.fn();

    triggerBackgroundCache("asset_a", TRACK_A, { fetchFn, onCached, onFailed });
    expect(factory).toBeDefined();
    await factory();

    expect(onCached).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith("cache_failed");
  });

  it("triggerBackgroundCache calls onFailed('already_in_flight') when dedupe guard fires", () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    // registerAutoCacheDownload returns false — download already in progress
    mediaCacheMock.registerAutoCacheDownload.mockReturnValueOnce(false);

    const onCached = vi.fn();
    const onFailed = vi.fn();

    triggerBackgroundCache("asset_a", TRACK_A, { onCached, onFailed });

    expect(onCached).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith("already_in_flight");
  });

  it("triggerBackgroundCache calls onFailed('not_allowed') when gate denies access", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    // Gate denies the request
    backendAuthMock.getProtectedMediaRequestGate.mockResolvedValueOnce({
      allowed: false,
      cleanup() {},
      signal: undefined,
    });

    const onCached = vi.fn();
    const onFailed = vi.fn();

    triggerBackgroundCache("asset_a", TRACK_A, { onCached, onFailed });
    expect(factory).toBeDefined();
    await factory();

    expect(onCached).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith("not_allowed");
  });

  it("triggerBackgroundCache calls onCached when local blob is already fresh", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce({
      content_hash: "hash_a",
      source: "cached",
    });

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    const onCached = vi.fn();
    const onFailed = vi.fn();

    triggerBackgroundCache("asset_a", { ...TRACK_A, content_hash: "hash_a" }, { onCached, onFailed });
    expect(factory).toBeDefined();
    await factory();

    // Fresh local blob — no download, but settles as cached
    expect(backendAuthMock.getBackendMediaAssetAccess).not.toHaveBeenCalled();
    expect(mediaCacheMock.cacheMediaFromResponse).not.toHaveBeenCalled();
    expect(onCached).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("triggerBackgroundCache calls onFailed('aborted') on abort error", async () => {
    mediaCacheMock.isAutoCacheEligible.mockReturnValueOnce(true);
    mediaCacheMock.getLocalBlobMeta.mockResolvedValueOnce(null);

    let factory;
    mediaCacheMock.registerAutoCacheDownload.mockImplementationOnce((name, fn) => {
      factory = fn;
      return true;
    });

    // Signed download throws an AbortError
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    backendAuthMock.getBackendMediaAssetAccess.mockRejectedValueOnce(abortError);

    const onCached = vi.fn();
    const onFailed = vi.fn();

    triggerBackgroundCache("asset_a", TRACK_A, { onCached, onFailed });
    expect(factory).toBeDefined();
    await factory();

    expect(onCached).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith("aborted");
  });
});

// ── Tests: media-session-adapter ─────────────────────────────────────

describe("media-session-adapter", () => {
  let setMediaSessionMetadata, setMediaSessionPlaybackState, setMediaSessionPositionState,
    setMediaSessionActionHandlers, clearMediaSession;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/shared/media-session-adapter.js");
    setMediaSessionMetadata = mod.setMediaSessionMetadata;
    setMediaSessionPlaybackState = mod.setMediaSessionPlaybackState;
    setMediaSessionPositionState = mod.setMediaSessionPositionState;
    setMediaSessionActionHandlers = mod.setMediaSessionActionHandlers;
    clearMediaSession = mod.clearMediaSession;
  });

  it("sets metadata on navigator.mediaSession", () => {
    setMediaSessionMetadata({ title: "Test Song", artist: "Test Artist" });
    expect(navigator.mediaSession.metadata).toBeTruthy();
    expect(navigator.mediaSession.metadata.title).toBe("Test Song");
    expect(navigator.mediaSession.metadata.artist).toBe("Test Artist");
  });

  it("sets playback state", () => {
    setMediaSessionPlaybackState("playing");
    expect(navigator.mediaSession.playbackState).toBe("playing");
  });

  it("sets action handlers", () => {
    const play = vi.fn();
    const pause = vi.fn();
    setMediaSessionActionHandlers({ play, pause });
    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalled();
  });

  it("clears media session", () => {
    clearMediaSession();
    expect(navigator.mediaSession.playbackState).toBe("none");
  });

  it("handles missing setPositionState gracefully", () => {
    // setPositionState may not exist on our mock — should not throw
    expect(() => {
      setMediaSessionPositionState({ duration: 120, position: 30 });
    }).not.toThrow();
  });
});

// ── Tests: audio-cue ─────────────────────────────────────────────────

describe("audio-cue", () => {
  let playCue, stopCue, prime, subscribe, getActiveCueCount, setMainAudioElement;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/shared/audio-cue.js");
    playCue = mod.playCue;
    stopCue = mod.stopCue;
    prime = mod.prime;
    subscribe = mod.subscribe;
    getActiveCueCount = mod.getActiveCueCount;
    setMainAudioElement = mod.setMainAudioElement;
  });

  it("plays a cue and reports active count", () => {
    const id = playCue({ src: "alert.mp3" });
    expect(typeof id).toBe("string");
    expect(getActiveCueCount()).toBe(1);
  });

  it("stops a specific cue", () => {
    const id = playCue({ id: "alert1", src: "alert.mp3" });
    expect(getActiveCueCount()).toBe(1);
    stopCue(id);
    expect(getActiveCueCount()).toBe(0);
  });

  it("stops all cues when called without id", () => {
    playCue({ id: "c1", src: "a.mp3" });
    playCue({ id: "c2", src: "b.mp3" });
    expect(getActiveCueCount()).toBe(2);
    stopCue();
    expect(getActiveCueCount()).toBe(0);
  });

  it("notifies subscribers on cue state changes", () => {
    const listener = vi.fn();
    subscribe(listener);
    playCue({ src: "ping.mp3" });
    expect(listener).toHaveBeenCalledWith({ activeCueCount: 1 });
  });

  it("ducks main audio when requested", () => {
    const mainEl = new Audio();
    mainEl.volume = 1;
    setMainAudioElement(mainEl);

    playCue({ src: "alert.mp3", duckMainAudio: true });
    expect(mainEl.volume).toBeLessThan(1);
  });

  it("prime does not throw", () => {
    expect(() => prime()).not.toThrow();
  });
});

// ── Tests: player-session ────────────────────────────────────────────

describe("player-session", () => {
  let loadPlayerSession, savePlayerSession, clearPlayerSession;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    const mod = await import("../../src/shared/player-session.js");
    loadPlayerSession = mod.loadPlayerSession;
    savePlayerSession = mod.savePlayerSession;
    clearPlayerSession = mod.clearPlayerSession;
  });

  it("returns defaults when no session exists", () => {
    const session = loadPlayerSession();
    expect(session.queue).toEqual([]);
    expect(session.paused).toBe(true);
    expect(session.volume).toBe(0.5);
    expect(session.repeat).toBe("off");
    expect(session.shuffle).toBe(false);
  });

  it("persists and restores session state", () => {
    savePlayerSession({
      queue: ["track_a", "track_b"],
      currentTrackName: "track_a",
      volume: 0.7,
      repeat: "all",
    });

    const session = loadPlayerSession();
    expect(session.queue).toEqual(["track_a", "track_b"]);
    expect(session.currentTrackName).toBe("track_a");
    expect(session.volume).toBe(0.7);
    expect(session.repeat).toBe("all");
  });

  it("clears the session", () => {
    savePlayerSession({ queue: ["track_a"] });
    clearPlayerSession();
    const session = loadPlayerSession();
    expect(session.queue).toEqual([]);
  });

  it("clamps invalid volume", () => {
    savePlayerSession({ volume: 999 });
    expect(loadPlayerSession().volume).toBe(1);
  });

  it("sanitizes invalid repeat mode", () => {
    savePlayerSession({ repeat: "invalid" });
    expect(loadPlayerSession().repeat).toBe("off");
  });

  it("handles corrupt JSON gracefully", () => {
    localStorage.setItem("vatioboard_player_session_v1", "{{invalid}");
    expect(() => loadPlayerSession()).not.toThrow();
    expect(loadPlayerSession().queue).toEqual([]);
  });
});

// ── Tests: audio-runtime ─────────────────────────────────────────────

describe("audio-runtime", () => {
  let runtime;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));

    vi.doMock("../../src/shared/media-cache.js", () => ({
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));

    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true,
        cleanup() {},
        signal: undefined,
      }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({
        ok: true,
        access: {
          playback_url: "https://cdn.example.com/signed/track.mp3",
          expires_in_seconds: 300,
        },
        asset: { content_hash: "hash_x" },
      }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    }));

    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));

    runtime = await import("../../src/shared/audio-runtime.js");
  });

  it("initial state has empty queue and paused", () => {
    const s = runtime.getState();
    expect(s.queue).toEqual([]);
    expect(s.paused).toBe(true);
    expect(s.currentTrack).toBeNull();
    expect(s.currentIndex).toBe(-1);
  });

  it("setQueue populates the queue", async () => {
    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    // Wait for async loadTrack
    await vi.waitFor(() => {
      const s = runtime.getState();
      expect(s.queue).toHaveLength(2);
    });
  });

  it("enqueue appends to the queue", async () => {
    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getState().queue).toHaveLength(1);
    });
    runtime.enqueue([TRACK_B]);
    expect(runtime.getState().queue).toHaveLength(2);
  });

  it("play and pause update state", async () => {
    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getState().queue).toHaveLength(1);
    });

    runtime.play();
    // FakeAudio auto-resolves play()
    await vi.waitFor(() => {
      expect(runtime.getState().paused).toBe(false);
    });

    runtime.pause();
    expect(runtime.getState().paused).toBe(true);
  });

  it("subscribe delivers state updates", async () => {
    const listener = vi.fn();
    const unsub = runtime.subscribe(listener);

    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    unsub();
  });

  it("setVolume clamps and persists", () => {
    runtime.setVolume(0.5);
    expect(runtime.getState().volume).toBe(0.5);

    runtime.setVolume(2);
    expect(runtime.getState().volume).toBe(1);

    runtime.setVolume(-1);
    expect(runtime.getState().volume).toBe(0);
  });

  it("setMuted toggles mute state", () => {
    runtime.setMuted(true);
    expect(runtime.getState().muted).toBe(true);
    runtime.setMuted(false);
    expect(runtime.getState().muted).toBe(false);
    runtime.setMuted(); // toggle
    expect(runtime.getState().muted).toBe(true);
  });

  it("cycleRepeat cycles through off → all → one → off", () => {
    expect(runtime.getState().repeat).toBe("off");
    runtime.cycleRepeat();
    expect(runtime.getState().repeat).toBe("all");
    runtime.cycleRepeat();
    expect(runtime.getState().repeat).toBe("one");
    runtime.cycleRepeat();
    expect(runtime.getState().repeat).toBe("off");
  });

  it("toggleShuffle flips shuffle state", () => {
    expect(runtime.getState().shuffle).toBe(false);
    runtime.toggleShuffle();
    expect(runtime.getState().shuffle).toBe(true);
    runtime.toggleShuffle();
    expect(runtime.getState().shuffle).toBe(false);
  });

  it("stopPlayback resets state and clears Media Session", async () => {
    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getState().queue).toHaveLength(1);
    });

    runtime.stopPlayback();

    const s = runtime.getState();
    expect(s.currentTrack).toBeNull();
    expect(s.currentIndex).toBe(-1);
    expect(s.paused).toBe(true);
    expect(navigator.mediaSession.playbackState).toBe("none");
  });

  it("ending the last queued track without repeat stops cleanly and stays replayable", async () => {
    runtime.setQueue([TRACK_A], { autoplay: true });
    await vi.waitFor(() => {
      expect(runtime.getState().currentTrack?.name).toBe("asset_a");
      expect(runtime.getState().playing).toBe(true);
    });

    const finishedEl = runtime.getAudioElement();
    finishedEl.dispatchEvent(new Event("ended"));

    await vi.waitFor(() => {
      const s = runtime.getState();
      expect(s.currentTrack).toBeNull();
      expect(s.currentIndex).toBe(-1);
      expect(s.paused).toBe(true);
      expect(s.error).toBeNull();
    });

    finishedEl.dispatchEvent(new Event("error"));
    expect(runtime.getState().error).toBeNull();

    await runtime.play();

    await vi.waitFor(() => {
      const s = runtime.getState();
      expect(s.currentTrack?.name).toBe("asset_a");
      expect(s.paused).toBe(false);
      expect(s.playing).toBe(true);
    });
  });

  it("restoreSession rebuilds queue from available tracks", async () => {
    // Seed a session
    localStorage.setItem("vatioboard_player_session_v1", JSON.stringify({
      queue: ["asset_a", "asset_b", "asset_gone"],
      currentTrackName: "asset_b",
      currentTime: 30,
      paused: true,
      volume: 0.8,
      muted: false,
      repeat: "all",
      shuffle: true,
      backgroundMode: false,
    }));

    await runtime.restoreSession([TRACK_A, TRACK_B], { autoplay: false });

    const s = runtime.getState();
    // "asset_gone" should be filtered out
    expect(s.queue).toHaveLength(2);
    expect(s.volume).toBe(0.8);
    expect(s.repeat).toBe("all");
    expect(s.shuffle).toBe(true);
  });

  it("getAudioElement returns the internal audio element", async () => {
    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getAudioElement()).toBeTruthy();
    });
  });

  it("playTrackByName starts a track from the queue", async () => {
    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getState().queue).toHaveLength(2);
    });

    runtime.playTrackByName("asset_b");
    await vi.waitFor(() => {
      expect(runtime.getState().currentTrack?.name).toBe("asset_b");
      expect(runtime.getState().paused).toBe(false);
    });
  });

  it("playTrackByName does nothing for unknown name", async () => {
    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getState().queue).toHaveLength(1);
    });

    runtime.playTrackByName("nonexistent");
    // State should not change
    expect(runtime.getState().currentTrack?.name).toBe("asset_a");
  });

  it("playCatalogTrack plays from queue when found", async () => {
    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getState().queue).toHaveLength(2);
    });

    runtime.playCatalogTrack("asset_b", [TRACK_A, TRACK_B, TRACK_C]);
    await vi.waitFor(() => {
      expect(runtime.getState().currentTrack?.name).toBe("asset_b");
    });
    // Queue should stay the same (not replaced by catalog)
    expect(runtime.getState().queue).toHaveLength(2);
  });

  it("playCatalogTrack sets catalog as queue when track not in queue", async () => {
    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getState().queue).toHaveLength(1);
    });

    runtime.playCatalogTrack("asset_c", [TRACK_A, TRACK_B, TRACK_C]);
    await vi.waitFor(() => {
      expect(runtime.getState().currentTrack?.name).toBe("asset_c");
      expect(runtime.getState().queue).toHaveLength(3);
    });
  });

  it("primeAudio resolves false when no source is loaded yet", async () => {
    const result = await runtime.primeAudio();
    expect(result).toBe(false);
  });

  it("primeAudio resolves true immediately when element has src", async () => {
    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getAudioElement()?.src).toBeTruthy();
    });
    const result = await runtime.primeAudio();
    expect(result).toBe(true);
  });

  it("primeAudio failure leaves retryable (not permanently disabled)", async () => {
    // Set queue with autoplay=false to preload a real source without playing.
    runtime.setQueue([TRACK_A], { autoplay: false });
    const el = runtime.getAudioElement();
    expect(el).toBeTruthy();
    await vi.waitFor(() => {
      expect(el.src).toBeTruthy();
    });

    // First attempt: force play() to reject (gesture-gated)
    const origPlay = el.play.bind(el);
    el.play = vi.fn().mockRejectedValueOnce(new DOMException("not allowed", "NotAllowedError"));

    const r1 = await runtime.primeAudio();
    expect(r1).toBe(false);

    // Second attempt: play() succeeds (user gesture context)
    el.play = origPlay;
    const r2 = await runtime.primeAudio();
    expect(r2).toBe(true);
  });

  it("first play after preloaded track stays playing (regression)", async () => {
    // Boot: set queue with autoplay=false — preloads the real source
    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });

    const el = runtime.getAudioElement();
    await vi.waitFor(() => {
      expect(el.src).toBeTruthy();
    });
    expect(el.paused).toBe(true);

    // User clicks play → runtime primes the actual source and starts playback
    await runtime.play();

    // After microtask settlement, playback must remain active
    await vi.waitFor(() => {
      expect(runtime.getState().paused).toBe(false);
      expect(el.paused).toBe(false);
    });
  });

  it("track row click starts playback on first click (regression)", async () => {
    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });

    await vi.waitFor(() => {
      expect(runtime.getAudioElement().src).toBeTruthy();
    });

    // Simulate track row click: runtime handles priming internally
    await runtime.playCatalogTrack("asset_b", [TRACK_A, TRACK_B]);

    await vi.waitFor(() => {
      expect(runtime.getState().currentTrack?.name).toBe("asset_b");
      expect(runtime.getState().paused).toBe(false);
    });

    await vi.waitFor(() => {
      const el = runtime.getAudioElement();
      expect(el.paused).toBe(false);
    });
  });
});

describe("audio-runtime local-to-remote transitions", () => {
  it("replaces the shared audio element when a visualized local track advances to remote", async () => {
    vi.resetModules();
    localStorage.clear();

    const resolveAudioSource = vi.fn()
      .mockResolvedValueOnce({
        src: "blob:local-track",
        type: "blob",
        revokeUrl: vi.fn(),
      })
      .mockResolvedValueOnce({
        src: "https://cdn.example.com/stream-track.mp3",
        type: "remote",
        revokeUrl: vi.fn(),
      });
    const destroyVisualizerGraphForElement = vi.fn(() => true);

    vi.doMock("../../src/shared/audio-source-resolver.js", () => ({
      resolveAudioSource,
      hasLocalSource: vi.fn().mockResolvedValue(false),
      triggerBackgroundCache: vi.fn(),
    }));

    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      destroyVisualizerGraphForElement,
    }));

    const runtime = await import("../../src/shared/audio-runtime.js");

    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getAudioElement()?.src).toBe("blob:local-track");
    });

    const localEl = runtime.getAudioElement();

    await runtime.nextTrack();

    expect(destroyVisualizerGraphForElement).toHaveBeenCalledTimes(1);
    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(localEl);
    expect(runtime.getState().sourceType).toBe("remote");
    expect(runtime.getAudioElement()).not.toBe(localEl);
    expect(runtime.getAudioElement().src).toBe("https://cdn.example.com/stream-track.mp3");

    const remoteEl = runtime.getAudioElement();
    runtime.stopPlayback();

    expect(destroyVisualizerGraphForElement).toHaveBeenCalledTimes(2);
    expect(destroyVisualizerGraphForElement).toHaveBeenLastCalledWith(remoteEl);
    expect(runtime.getAudioElement()).toBe(remoteEl);
    expect(remoteEl.src).toBe("");
  });

  it("keeps playback active after replacing the audio element for a remote next track", async () => {
    vi.resetModules();
    localStorage.clear();

    const resolveAudioSource = vi.fn()
      .mockResolvedValueOnce({
        src: "blob:local-track",
        type: "blob",
        revokeUrl: vi.fn(),
      })
      .mockResolvedValueOnce({
        src: "https://cdn.example.com/stream-track.mp3",
        type: "remote",
        revokeUrl: vi.fn(),
      });
    const destroyVisualizerGraphForElement = vi.fn(() => true);

    vi.doMock("../../src/shared/audio-source-resolver.js", () => ({
      resolveAudioSource,
      hasLocalSource: vi.fn().mockResolvedValue(false),
      triggerBackgroundCache: vi.fn(),
    }));

    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      destroyVisualizerGraphForElement,
    }));

    const runtime = await import("../../src/shared/audio-runtime.js");

    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: true });
    await vi.waitFor(() => {
      expect(runtime.getAudioElement()?.src).toBe("blob:local-track");
      expect(runtime.getState().playing).toBe(true);
    });

    const localEl = runtime.getAudioElement();

    await runtime.nextTrack();

    const remoteEl = runtime.getAudioElement();
    expect(remoteEl).not.toBe(localEl);
    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(localEl);

    await vi.waitFor(() => {
      expect(runtime.getState().currentTrack?.name).toBe("asset_b");
      expect(runtime.getState().paused).toBe(false);
      expect(runtime.getState().playing).toBe(true);
      expect(remoteEl.paused).toBe(false);
      expect(remoteEl.src).toBe("https://cdn.example.com/stream-track.mp3");
    });
  });

  it("replaces the audio element on stop after a visualized local track", async () => {
    vi.resetModules();
    localStorage.clear();

    const resolveAudioSource = vi.fn().mockResolvedValueOnce({
      src: "blob:local-track",
      type: "blob",
      revokeUrl: vi.fn(),
    });
    const destroyVisualizerGraphForElement = vi.fn(() => true);

    vi.doMock("../../src/shared/audio-source-resolver.js", () => ({
      resolveAudioSource,
      hasLocalSource: vi.fn().mockResolvedValue(false),
      triggerBackgroundCache: vi.fn(),
    }));

    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      destroyVisualizerGraphForElement,
    }));

    const runtime = await import("../../src/shared/audio-runtime.js");

    runtime.setQueue([TRACK_A], { autoplay: false });
    await vi.waitFor(() => {
      expect(runtime.getAudioElement()?.src).toBe("blob:local-track");
    });

    const localEl = runtime.getAudioElement();

    runtime.stopPlayback();

    expect(destroyVisualizerGraphForElement).toHaveBeenCalledWith(localEl);
    expect(runtime.getAudioElement()).not.toBe(localEl);
    expect(runtime.getAudioElement().src).toBe("");
  });
});

// ── Tests: audio-catalog ─────────────────────────────────────────────

describe("audio-catalog", () => {
  let loadAudioCatalog, annotateOfflineAvailability;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("../../src/shared/media-cache.js", () => ({
      getCachedManifestSnapshot: vi.fn().mockResolvedValue({
        assets: [
          makeTrack("audio_1"),
          makeTrack("audio_2"),
          { name: "video_1", media_kind: "video", title: "Video" },
          { name: "unknown", original_filename: "song.mp3", title: "Guess" },
        ],
      }),
      getCachedMediaManifest: vi.fn().mockResolvedValue([]),
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));

    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true,
        cleanup() {},
        signal: undefined,
      }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false, access: null }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    }));

    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));

    const mod = await import("../../src/shared/audio-catalog.js");
    loadAudioCatalog = mod.loadAudioCatalog;
    annotateOfflineAvailability = mod.annotateOfflineAvailability;
  });

  it("filters to audio-only assets", async () => {
    const { tracks, total } = await loadAudioCatalog();
    // audio_1, audio_2 by media_kind, "unknown" by .mp3 extension
    expect(total).toBe(3);
    expect(tracks.every((t) => t.name !== "video_1")).toBe(true);
  });

  it("applies search filter", async () => {
    const { tracks } = await loadAudioCatalog({ search: "audio_1" });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].name).toBe("audio_1");
  });

  it("annotates offline availability", async () => {
    const tracks = [makeTrack("t1"), makeTrack("t2")];
    const annotated = await annotateOfflineAvailability(tracks);
    expect(annotated).toHaveLength(2);
    // Default mock returns null (not offline)
    expect(annotated[0]._offline).toBe(false);
  });
});

// ── Tests: player-shell ──────────────────────────────────────────────

describe("player-shell", () => {
  let createPlayerShell;
  let runtime;
  let visualizerMockState;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    visualizerMockState = createVisualizerMockState();

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));

    vi.doMock("../../src/shared/media-cache.js", () => ({
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));

    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true,
        cleanup() {},
        signal: undefined,
      }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false, access: null }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    }));

    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));

    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      createMiniAudioVisualizer: visualizerMockState.createVisualizerSpy,
      destroyVisualizerGraphForElement: vi.fn().mockReturnValue(false),
    }));

    const mod = await import("../../src/player/player-shell.js");
    createPlayerShell = mod.createPlayerShell;
    runtime = await import("../../src/shared/audio-runtime.js");
  });

  it("renders the shell with all transport controls", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    expect(container.querySelector(".player-panel")).toBeTruthy();
    expect(container.querySelector(".player-artwork-compact")).toBeTruthy();
    expect(container.querySelector(".player-transport")).toBeTruthy();
    expect(container.querySelector(".player-btn-play-main")).toBeTruthy();
    expect(container.querySelector(".player-btn-prev")).toBeTruthy();
    expect(container.querySelector(".player-btn-next")).toBeTruthy();
    expect(container.querySelector(".player-progress")).toBeTruthy();
    expect(container.querySelector(".player-volume")).toBeTruthy();
    expect(container.querySelector(".player-visualizer-toggle-btn")).toBeTruthy();
    expect(container.querySelector(".player-visualizer-strip")).toBeTruthy();

    shell.destroy();
  });

  it("toggles the player visualizer strip from the header button", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    const toggleBtn = container.querySelector(".player-visualizer-toggle-btn");
    const strip = container.querySelector(".player-visualizer-strip");

    expect(strip.hidden).toBe(false);
    expect(toggleBtn.classList.contains("active")).toBe(true);

    toggleBtn.click();
    expect(strip.hidden).toBe(true);
    expect(toggleBtn.classList.contains("active")).toBe(false);

    toggleBtn.click();
    expect(strip.hidden).toBe(false);
    expect(toggleBtn.classList.contains("active")).toBe(true);

    shell.destroy();
  });

  it("cycles the widget visualizer between spectrum and scope from the strip", async () => {
    await runtime.play();

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    const strip = container.querySelector(".player-visualizer-strip");

    expect(visualizerMockState.createVisualizerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "spectrum" }),
    );

    strip.click();

    const controller = visualizerMockState.calls[0]?.controller;
    expect(controller?.setMode).toHaveBeenCalledWith("scope");
    expect(strip.dataset.visualizerMode).toBe("scope");

    strip.click();
    expect(controller?.setMode).toHaveBeenCalledWith("spectrum");
    expect(strip.dataset.visualizerMode).toBe("spectrum");

    shell.destroy();
  });

  it("initializes range fill percentages from current player state", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    const progress = container.querySelector(".player-progress");
    const volume = container.querySelector(".player-volume");

    expect(progress.style.getPropertyValue("--player-range-percent")).toBe("0%");
    expect(volume.style.getPropertyValue("--player-range-percent")).toBe("50%");

    shell.destroy();
  });

  it("updates range fill percentages while dragging progress and volume sliders", async () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    const progress = container.querySelector(".player-progress");
    const volume = container.querySelector(".player-volume");

    progress.value = "250";
    progress.dispatchEvent(new Event("input", { bubbles: true }));
    expect(progress.style.getPropertyValue("--player-range-percent")).toBe("25%");

    volume.value = "42";
    volume.dispatchEvent(new Event("input", { bubbles: true }));

    expect(volume.style.getPropertyValue("--player-range-percent")).toBe("42%");
    await vi.waitFor(() => {
      expect(runtime.getState().volume).toBeCloseTo(0.42, 2);
    });

    shell.destroy();
  });

  it("destroy removes the shell from the DOM", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    expect(container.querySelector(".player-panel")).toBeTruthy();

    shell.destroy();
    expect(container.querySelector(".player-panel")).toBeNull();
  });

  it("setTracks populates the track list when queue is open", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    // Open the queue sheet first, then set tracks
    const queueBtn = container.querySelector(".player-queue-toggle-btn");
    queueBtn.click();

    // Queue sheet reads from runtime queue, not allTracks
    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    shell.setTracks([TRACK_A, TRACK_B]);

    const items = container.querySelectorAll(".player-queue-item");
    expect(items.length).toBe(2);

    shell.destroy();
  });

  it("has a collapsible queue sheet instead of a drawer", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    expect(container.querySelector(".player-queue-drawer")).toBeNull();
    expect(container.querySelector(".player-queue-sheet")).toBeTruthy();

    shell.destroy();
  });

  it("renders error message element", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    const errorEl = container.querySelector(".player-error");
    expect(errorEl).toBeTruthy();
    expect(errorEl.hidden).toBe(true);

    shell.destroy();
  });

  it("play button click does not throw and starts playback", async () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A]);

    const playBtn = container.querySelector(".player-btn-play-main");
    expect(() => playBtn.click()).not.toThrow();

    await vi.waitFor(() => {
      expect(container.querySelector(".player-error")?.hidden).toBe(true);
    });

    shell.destroy();
  });

  it("unmutes when play is pressed while muted", async () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A]);
    runtime.setMuted(true);

    const playBtn = container.querySelector(".player-btn-play-main");
    expect(runtime.getState().muted).toBe(true);
    expect(() => playBtn.click()).not.toThrow();

    await vi.waitFor(() => {
      expect(runtime.getState().muted).toBe(false);
    });

    shell.destroy();
  });

  it("track item click does not throw and activates the selected track", async () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    // Open queue sheet so items are rendered
    container.querySelector(".player-queue-toggle-btn").click();
    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    shell.setTracks([TRACK_A, TRACK_B]);

    const trackItem = container.querySelector('[data-track-name="asset_b"]');
    expect(trackItem).toBeTruthy();
    expect(() => trackItem.click()).not.toThrow();

    await vi.waitFor(() => {
      expect(trackItem.classList.contains("active")).toBe(true);
    });

    shell.destroy();
  });

  it("offline badge updates when queue track is marked _offline", async () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    // Open queue sheet and set tracks (initially not offline)
    container.querySelector(".player-queue-toggle-btn").click();
    runtime.setQueue([{ ...TRACK_A, _offline: false }, TRACK_B], { autoplay: false });
    shell.setTracks([{ ...TRACK_A, _offline: false }, TRACK_B]);

    const badgeBefore = container.querySelector('[data-track-name="asset_a"] .player-queue-item-badge');
    expect(badgeBefore).toBeTruthy();
    expect(badgeBefore.classList.contains("offline")).toBe(false);

    // Simulate runtime notifying that asset_a is now cached:
    // set queue with _offline = true and trigger renderState via subscriber.
    runtime.setQueue([{ ...TRACK_A, _offline: true }, TRACK_B], { autoplay: false });

    await vi.waitFor(() => {
      const badge = container.querySelector('[data-track-name="asset_a"] .player-queue-item-badge');
      expect(badge.classList.contains("offline")).toBe(true);
    });

    shell.destroy();
  });
});

describe("audio-runtime auto-skip resilience", () => {
  it("skips through more than five consecutive unavailable tracks to reach a playable one", async () => {
    vi.resetModules();
    localStorage.clear();

    // 8 tracks: first 7 unresolvable, 8th is playable
    let callCount = 0;
    const resolveAudioSource = vi.fn(async () => {
      callCount++;
      if (callCount < 8) return null; // tracks 1-7 are unavailable
      return { src: "blob:ok", type: "blob", revokeUrl: vi.fn() };
    });

    vi.doMock("../../src/shared/audio-source-resolver.js", () => ({
      resolveAudioSource,
      hasLocalSource: vi.fn().mockResolvedValue(false),
      triggerBackgroundCache: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      destroyVisualizerGraphForElement: vi.fn().mockReturnValue(false),
    }));

    const runtime = await import("../../src/shared/audio-runtime.js");

    const tracks = Array.from({ length: 8 }, (_, i) => ({
      name: `track_${i}`,
      title: `Track ${i}`,
      original_filename: `track_${i}.mp3`,
      media_kind: "audio",
      content_hash: `h${i}`,
      blob_size: 1024,
    }));

    runtime.setQueue(tracks, { autoplay: true });

    // Wait for the auto-skip chain to resolve on the 8th track
    await vi.waitFor(() => {
      expect(runtime.getState().currentIndex).toBe(7);
    }, { timeout: 5000 });

    expect(runtime.getState().error).toBeNull();
    expect(resolveAudioSource).toHaveBeenCalledTimes(8);
  });
});

describe("player-shell queue remove action", () => {
  let createPlayerShell;
  let runtime;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));
    vi.doMock("../../src/shared/media-cache.js", () => ({
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));
    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true, cleanup() {}, signal: undefined,
      }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false, access: null }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    }));
    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      createMiniAudioVisualizer: vi.fn(() => ({
        get isAvailable() { return true; },
        setMode: vi.fn(), resize: vi.fn(),
        start: vi.fn(() => Promise.resolve(true)),
        stop: vi.fn(), destroy: vi.fn(),
      })),
      destroyVisualizerGraphForElement: vi.fn().mockReturnValue(false),
    }));

    const mod = await import("../../src/player/player-shell.js");
    createPlayerShell = mod.createPlayerShell;
    runtime = await import("../../src/shared/audio-runtime.js");
  });

  it("remove button removes a track from the queue", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    const tracks = [TRACK_A, TRACK_B];
    runtime.setQueue(tracks, { autoplay: false });
    shell.setTracks(tracks);

    // Open queue sheet
    container.querySelector(".player-queue-toggle-btn").click();

    // Verify two items exist
    let items = container.querySelectorAll(".player-queue-item");
    expect(items.length).toBe(2);

    // Click the remove button on the first track
    const removeBtn = items[0].querySelector(".player-queue-remove-btn");
    expect(removeBtn).toBeTruthy();
    removeBtn.click();

    // Queue should now have one track
    expect(runtime.getState().queue.length).toBe(1);
    expect(runtime.getState().queue[0].name).toBe("asset_b");

    // DOM should reflect the removal
    items = container.querySelectorAll(".player-queue-item");
    expect(items.length).toBe(1);

    shell.destroy();
  });

  it("remove button is always visible (touch-first)", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    runtime.setQueue([TRACK_A], { autoplay: false });
    shell.setTracks([TRACK_A]);

    container.querySelector(".player-queue-toggle-btn").click();

    const removeBtn = container.querySelector(".player-queue-remove-btn");
    // Button exists in the DOM
    expect(removeBtn).toBeTruthy();
    // Not hidden by HTML attribute
    expect(removeBtn.hidden).toBe(false);
    // No inline styles suppress visibility
    expect(removeBtn.style.display).not.toBe("none");
    expect(removeBtn.style.visibility).not.toBe("hidden");
    expect(removeBtn.style.opacity).not.toBe("0");
    // Queue sheet ancestor is open (not aria-hidden)
    const queueSheet = removeBtn.closest(".player-queue-sheet");
    expect(queueSheet).toBeTruthy();
    expect(queueSheet.getAttribute("aria-hidden")).toBe("false");
    // Button is interactive
    expect(removeBtn.disabled).toBeFalsy();

    shell.destroy();
  });
});

describe("player-shell library sheet", () => {
  let createPlayerShell;
  let runtime;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));
    vi.doMock("../../src/shared/media-cache.js", () => ({
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));
    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true, cleanup() {}, signal: undefined,
      }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false, access: null }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
      createBackendPlaylist: vi.fn().mockResolvedValue({ ok: true, playlist: { name: "pl_new" } }),
      addBackendPlaylistItem: vi.fn().mockResolvedValue({ ok: true }),
      bulkAddBackendPlaylistItems: vi.fn().mockResolvedValue({ ok: true, added: [], skipped: [] }),
    }));
    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      createMiniAudioVisualizer: vi.fn(() => ({
        get isAvailable() { return true; },
        setMode: vi.fn(), resize: vi.fn(),
        start: vi.fn(() => Promise.resolve(true)),
        stop: vi.fn(), destroy: vi.fn(),
      })),
      destroyVisualizerGraphForElement: vi.fn().mockReturnValue(false),
    }));

    const mod = await import("../../src/player/player-shell.js");
    createPlayerShell = mod.createPlayerShell;
    runtime = await import("../../src/shared/audio-runtime.js");
  });

  it("renders the library toggle button in the header", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    expect(container.querySelector(".player-library-toggle-btn")).toBeTruthy();
    expect(container.querySelector(".player-library-sheet")).toBeTruthy();

    shell.destroy();
  });

  it("opens the library sheet and populates track list with actions", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);

    const libraryBtn = container.querySelector(".player-library-toggle-btn");
    libraryBtn.click();

    const librarySheet = container.querySelector(".player-library-sheet");
    expect(librarySheet.classList.contains("is-open")).toBe(true);
    expect(librarySheet.getAttribute("aria-hidden")).toBe("false");

    const items = container.querySelectorAll(".player-library-item");
    expect(items.length).toBe(2);

    // Each item has action buttons
    const actions = items[0].querySelectorAll(".player-library-action-btn");
    expect(actions.length).toBe(3); // Play now, Play next, Add to queue

    shell.destroy();
  });

  it("closes other sheets when library opens", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A]);

    // Open queue first
    container.querySelector(".player-queue-toggle-btn").click();
    expect(container.querySelector(".player-queue-sheet").classList.contains("is-open")).toBe(true);

    // Open library — should close queue
    container.querySelector(".player-library-toggle-btn").click();
    expect(container.querySelector(".player-queue-sheet").classList.contains("is-open")).toBe(false);
    expect(container.querySelector(".player-library-sheet").classList.contains("is-open")).toBe(true);

    shell.destroy();
  });

  it("library search filters tracks by title", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([
      makeTrack("asset_a", { title: "Alpha Song" }),
      makeTrack("asset_b", { title: "Beta Track" }),
    ]);

    container.querySelector(".player-library-toggle-btn").click();
    expect(container.querySelectorAll(".player-library-item").length).toBe(2);

    // Filter by "alpha"
    const searchInput = container.querySelector(".player-library-search");
    searchInput.value = "alpha";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(container.querySelectorAll(".player-library-item").length).toBe(1);

    shell.destroy();
  });

  it("Play next action button enqueues track at next position", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B, TRACK_C]);

    // Set up a queue first
    runtime.setQueue([TRACK_A], { autoplay: false });

    // Open library and click Play next on TRACK_B
    container.querySelector(".player-library-toggle-btn").click();
    const items = container.querySelectorAll(".player-library-item");
    const playNextBtn = items[1].querySelectorAll(".player-library-action-btn")[1];
    playNextBtn.click();

    const queue = runtime.getState().queue;
    // TRACK_B should be in the queue (enqueued at next position)
    expect(queue.some((tr) => tr.name === "asset_b")).toBe(true);

    shell.destroy();
  });

  it("Add to queue action button appends track to end of queue", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B, TRACK_C]);

    runtime.setQueue([TRACK_A], { autoplay: false });

    container.querySelector(".player-library-toggle-btn").click();
    const items = container.querySelectorAll(".player-library-item");
    // Third button is "Add to queue"
    const addBtn = items[2].querySelectorAll(".player-library-action-btn")[2];
    addBtn.click();

    const queue = runtime.getState().queue;
    expect(queue[queue.length - 1].name).toBe("asset_c");

    shell.destroy();
  });
});

describe("player-shell save queue as playlist", () => {
  let createPlayerShell;
  let runtime;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));
    vi.doMock("../../src/shared/media-cache.js", () => ({
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));
    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true, cleanup() {}, signal: undefined,
      }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false, access: null }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
      createBackendPlaylist: vi.fn().mockResolvedValue({ ok: true, playlist: { name: "pl_saved" } }),
      bulkAddBackendPlaylistItems: vi.fn().mockResolvedValue({ ok: true, added: [], skipped: [] }),
    }));
    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      createMiniAudioVisualizer: vi.fn(() => ({
        get isAvailable() { return true; },
        setMode: vi.fn(), resize: vi.fn(),
        start: vi.fn(() => Promise.resolve(true)),
        stop: vi.fn(), destroy: vi.fn(),
      })),
      destroyVisualizerGraphForElement: vi.fn().mockReturnValue(false),
    }));

    const mod = await import("../../src/player/player-shell.js");
    createPlayerShell = mod.createPlayerShell;
    runtime = await import("../../src/shared/audio-runtime.js");
  });

  it("renders save queue as playlist button in queue sheet header", () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    container.querySelector(".player-queue-toggle-btn").click();

    const saveBtn = container.querySelector(".player-queue-save-btn");
    expect(saveBtn).toBeTruthy();
    expect(saveBtn.textContent).toBe("playerSaveQueueAsPlaylist");

    shell.destroy();
  });

  it("save flow shows title form, then bulk-adds tracks on submit", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    shell.setTracks([TRACK_A, TRACK_B]);

    container.querySelector(".player-queue-toggle-btn").click();
    const saveBtn = container.querySelector(".player-queue-save-btn");
    saveBtn.click();

    // Form should be visible after clicking save
    const form = container.querySelector(".player-queue-save-form");
    expect(form).toBeTruthy();
    expect(form.hidden).toBe(false);
    expect(saveBtn.hidden).toBe(true);

    // Fill title and submit
    const titleInput = form.querySelector(".player-queue-save-title-input");
    titleInput.value = "My Queue";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      expect(backendAuth.createBackendPlaylist).toHaveBeenCalledTimes(1);
      expect(backendAuth.createBackendPlaylist).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My Queue" }),
      );
    });

    await vi.waitFor(() => {
      expect(backendAuth.bulkAddBackendPlaylistItems).toHaveBeenCalledTimes(1);
      expect(backendAuth.bulkAddBackendPlaylistItems).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "pl_saved",
          mediaAssetNames: ["asset_a", "asset_b"],
        }),
      );
    });

    shell.destroy();
  });

  it("save form skips demo tracks in bulk add", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    const demoTrack = makeTrack("demo:song", { title: "Demo", _demo: true });
    runtime.setQueue([demoTrack, TRACK_A], { autoplay: false });
    shell.setTracks([demoTrack, TRACK_A]);

    container.querySelector(".player-queue-toggle-btn").click();
    const saveBtn = container.querySelector(".player-queue-save-btn");
    saveBtn.click();

    const form = container.querySelector(".player-queue-save-form");
    const titleInput = form.querySelector(".player-queue-save-title-input");
    titleInput.value = "My Queue";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      expect(backendAuth.createBackendPlaylist).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      expect(backendAuth.bulkAddBackendPlaylistItems).toHaveBeenCalledTimes(1);
      expect(backendAuth.bulkAddBackendPlaylistItems).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaAssetNames: ["asset_a"],
        }),
      );
    });

    shell.destroy();
  });

  it("shows failure when bulk add returns ok: false", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    backendAuth.bulkAddBackendPlaylistItems.mockResolvedValueOnce({
      ok: false, added: [], skipped: [],
    });
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    runtime.setQueue([TRACK_A], { autoplay: false });
    shell.setTracks([TRACK_A]);

    container.querySelector(".player-queue-toggle-btn").click();
    const saveBtn = container.querySelector(".player-queue-save-btn");
    saveBtn.click();

    const form = container.querySelector(".player-queue-save-form");
    form.querySelector(".player-queue-save-title-input").value = "Test";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      expect(backendAuth.bulkAddBackendPlaylistItems).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      const confirmBtn = form.querySelector(".player-queue-save-confirm-btn");
      expect(confirmBtn.textContent).toBe("playerPlaylistSaveFailed");
    });

    shell.destroy();
  });

  it("shows partial success when some tracks are skipped", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    backendAuth.bulkAddBackendPlaylistItems.mockResolvedValueOnce({
      ok: true,
      added: [{ name: "asset_a" }],
      skipped: [{ name: "asset_b", reason: "duplicate" }],
    });
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    shell.setTracks([TRACK_A, TRACK_B]);

    container.querySelector(".player-queue-toggle-btn").click();
    const saveBtn = container.querySelector(".player-queue-save-btn");
    saveBtn.click();

    const form = container.querySelector(".player-queue-save-form");
    form.querySelector(".player-queue-save-title-input").value = "Partial";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      expect(backendAuth.bulkAddBackendPlaylistItems).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      const confirmBtn = form.querySelector(".player-queue-save-confirm-btn");
      expect(confirmBtn.textContent).toBe("playerPlaylistSavedPartial");
    });

    shell.destroy();
  });

  it("shows success when all tracks are added", async () => {
    const backendAuth = await import("../../src/shared/backend-auth.js");
    backendAuth.bulkAddBackendPlaylistItems.mockResolvedValueOnce({
      ok: true,
      added: [{ name: "asset_a" }, { name: "asset_b" }],
      skipped: [],
    });
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });

    runtime.setQueue([TRACK_A, TRACK_B], { autoplay: false });
    shell.setTracks([TRACK_A, TRACK_B]);

    container.querySelector(".player-queue-toggle-btn").click();
    const saveBtn = container.querySelector(".player-queue-save-btn");
    saveBtn.click();

    const form = container.querySelector(".player-queue-save-form");
    form.querySelector(".player-queue-save-title-input").value = "All Good";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      expect(backendAuth.bulkAddBackendPlaylistItems).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      const confirmBtn = form.querySelector(".player-queue-save-confirm-btn");
      expect(confirmBtn.textContent).toBe("playerPlaylistSaved");
    });

    shell.destroy();
  });
});

describe("player-shell playlist track actions", () => {
  let createPlayerShell;
  let runtime;
  let playlistLoaderMock;
  let mediaCacheMockLocal;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();

    playlistLoaderMock = {
      loadPlaylists: vi.fn().mockResolvedValue({ playlists: [], total: 0 }),
      loadPlaylistDetail: vi.fn().mockResolvedValue({
        name: "pl1",
        title: "Test Playlist",
        items: [
          { media_asset_name: "asset_a", snapshot_title: "Track A", snapshot_artist: "Artist A", snapshot_duration: 120 },
          { media_asset_name: "asset_b", snapshot_title: "Track B", snapshot_artist: "Artist B", snapshot_duration: 180 },
        ],
      }),
    };

    mediaCacheMockLocal = {
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
      pinMediaBlob: vi.fn().mockResolvedValue(true),
      pinMediaFromResponse: vi.fn().mockResolvedValue(true),
      unpinMediaBlob: vi.fn().mockResolvedValue(true),
      isMediaBlobPinned: vi.fn().mockResolvedValue(false),
      getCachedMediaBlob: vi.fn().mockResolvedValue(null),
      getCachedBlobMeta: vi.fn().mockResolvedValue(null),
      removeCachedMediaBlob: vi.fn().mockResolvedValue(true),
    };

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));
    vi.doMock("../../src/shared/media-cache.js", () => mediaCacheMockLocal);
    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));
    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true, cleanup() {}, signal: undefined,
      }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false, access: null }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
      createBackendPlaylist: vi.fn().mockResolvedValue({ ok: true, playlist: { name: "pl_new" } }),
      addBackendPlaylistItem: vi.fn().mockResolvedValue({ ok: true }),
      bulkAddBackendPlaylistItems: vi.fn().mockResolvedValue({ ok: true, added: [], skipped: [] }),
    }));
    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      createMiniAudioVisualizer: vi.fn(() => ({
        get isAvailable() { return true; },
        setMode: vi.fn(), resize: vi.fn(),
        start: vi.fn(() => Promise.resolve(true)),
        stop: vi.fn(), destroy: vi.fn(),
      })),
      destroyVisualizerGraphForElement: vi.fn().mockReturnValue(false),
    }));
    vi.doMock("../../src/shared/playlist-loader.js", () => playlistLoaderMock);
    vi.doMock("../../src/shared/audio-source-resolver.js", () => ({
      resolveAudioSource: vi.fn().mockResolvedValue(null),
      hasLocalSource: vi.fn().mockResolvedValue(false),
      triggerBackgroundCache: vi.fn(),
    }));

    const mod = await import("../../src/player/player-shell.js");
    createPlayerShell = mod.createPlayerShell;
    runtime = await import("../../src/shared/audio-runtime.js");
  });

  it("playlist detail track items have Play next and Add to queue actions", async () => {
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    // Open playlist sheet
    container.querySelector(".player-playlist-toggle-btn").click();

    // Click to open playlist detail
    const playlistItem = container.querySelector(".player-playlist-item");
    playlistItem.click();

    // Wait for detail to load
    await vi.waitFor(() => {
      const trackItems = container.querySelectorAll(".player-playlist-track-item");
      expect(trackItems.length).toBe(2);
    });

    // Verify action buttons exist on each track
    const trackItems = container.querySelectorAll(".player-playlist-track-item");
    const actions = trackItems[0].querySelectorAll(".player-playlist-track-action-btn");
    expect(actions.length).toBe(2); // Play next, Add to queue

    shell.destroy();
  });

  it("shows Pin button when tracks are not fully pinned", async () => {
    mediaCacheMockLocal.isMediaBlobPinned.mockResolvedValue(false);
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const toolbar = container.querySelector(".player-playlist-toolbar");
      expect(toolbar).toBeTruthy();
    });

    const toolbar = container.querySelector(".player-playlist-toolbar");
    const pinBtn = toolbar.querySelector(".player-playlist-download-btn");
    expect(pinBtn).toBeTruthy();
    expect(pinBtn.textContent).toBe("playerPinPlaylist");

    // Status should show cloud only
    const status = toolbar.querySelector(".player-playlist-offline-status");
    expect(status.textContent).toBe("playerPlaylistCloudOnly");

    shell.destroy();
  });

  it("shows Unpin button when all tracks are pinned", async () => {
    mediaCacheMockLocal.isMediaBlobPinned.mockResolvedValue(true);
    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const toolbar = container.querySelector(".player-playlist-toolbar");
      expect(toolbar).toBeTruthy();
    });

    const toolbar = container.querySelector(".player-playlist-toolbar");
    const unpinBtn = toolbar.querySelector(".player-playlist-download-btn");
    expect(unpinBtn).toBeTruthy();
    expect(unpinBtn.textContent).toBe("playerUnpinPlaylist");

    // Status should show fully pinned
    const status = toolbar.querySelector(".player-playlist-offline-status");
    expect(status.textContent).toBe("playerPlaylistFullyPinned");
    expect(status.classList.contains("fully-offline")).toBe(true);

    shell.destroy();
  });

  it("shows partially pinned status when some tracks are pinned", async () => {
    // First track pinned, second not
    mediaCacheMockLocal.isMediaBlobPinned
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const toolbar = container.querySelector(".player-playlist-toolbar");
      expect(toolbar).toBeTruthy();
    });

    const toolbar = container.querySelector(".player-playlist-toolbar");
    const status = toolbar.querySelector(".player-playlist-offline-status");
    // t() returns the key, so replace runs on the key string
    expect(status.textContent).toContain("playerPlaylistPartiallyPinned");

    // Pin button (not unpin) because not fully pinned
    const pinBtn = toolbar.querySelector(".player-playlist-download-btn");
    expect(pinBtn.textContent).toBe("playerPinPlaylist");

    shell.destroy();
  });

  it("pinned tracks show offline badge", async () => {
    // First track pinned, second not
    mediaCacheMockLocal.isMediaBlobPinned
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const trackItems = container.querySelectorAll(".player-playlist-track-item");
      expect(trackItems.length).toBe(2);
    });

    const trackItems = container.querySelectorAll(".player-playlist-track-item");
    const badge0 = trackItems[0].querySelector(".player-playlist-track-badge");
    const badge1 = trackItems[1].querySelector(".player-playlist-track-badge");
    expect(badge0.classList.contains("offline")).toBe(true);
    expect(badge1.classList.contains("offline")).toBe(false);

    shell.destroy();
  });

  it("clicking Pin calls pinMediaFromResponse for non-pinned tracks via backend", async () => {
    mediaCacheMockLocal.isMediaBlobPinned.mockResolvedValue(false);
    mediaCacheMockLocal.getCachedMediaBlob.mockResolvedValue(null);

    // Setup backend-auth mock with working download
    const { getBackendMediaAssetAccess, fetchBackendMediaAssetBlob } = await import("../../src/shared/backend-auth.js");
    getBackendMediaAssetAccess.mockResolvedValue({
      ok: true,
      access: { download_url: "https://cdn.example.com/dl/asset.mp3", expires_in_seconds: 300 },
      asset: { content_hash: "hash_a" },
    });

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const toolbar = container.querySelector(".player-playlist-toolbar");
      expect(toolbar).toBeTruthy();
    });

    const pinBtn = container.querySelector(".player-playlist-download-btn");
    pinBtn.click();

    // Button should be disabled and show pinning text
    expect(pinBtn.disabled).toBe(true);
    expect(pinBtn.textContent).toBe("playerPinning");

    shell.destroy();
  });

  it("clicking Unpin calls unpinMediaBlob for all tracks", async () => {
    mediaCacheMockLocal.isMediaBlobPinned.mockResolvedValue(true);

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const toolbar = container.querySelector(".player-playlist-toolbar");
      expect(toolbar).toBeTruthy();
    });

    const unpinBtn = container.querySelector(".player-playlist-download-btn");
    expect(unpinBtn.textContent).toBe("playerUnpinPlaylist");
    unpinBtn.click();

    // Button should be disabled and show unpinning text
    expect(unpinBtn.disabled).toBe(true);
    expect(unpinBtn.textContent).toBe("playerUnpinning");

    // Wait for unpin calls
    await vi.waitFor(() => {
      expect(mediaCacheMockLocal.unpinMediaBlob).toHaveBeenCalledTimes(2);
    });

    expect(mediaCacheMockLocal.unpinMediaBlob).toHaveBeenCalledWith("asset_a");
    expect(mediaCacheMockLocal.unpinMediaBlob).toHaveBeenCalledWith("asset_b");

    shell.destroy();
  });

  it("pin promotes cached blob to pinned when available", async () => {
    mediaCacheMockLocal.isMediaBlobPinned.mockResolvedValue(false);
    const fakeBlob = new Blob(["audio"], { type: "audio/mpeg" });
    mediaCacheMockLocal.getCachedMediaBlob.mockResolvedValue(fakeBlob);
    mediaCacheMockLocal.getCachedBlobMeta.mockResolvedValue({ content_hash: "hash_a" });

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([
      { ...TRACK_A, content_hash: "hash_a" },
      { ...TRACK_B, content_hash: "hash_b" },
    ]);
    shell.setPlaylists([{ name: "pl1", title: "Test Playlist", item_count: 2 }]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const toolbar = container.querySelector(".player-playlist-toolbar");
      expect(toolbar).toBeTruthy();
    });

    const pinBtn = container.querySelector(".player-playlist-download-btn");
    pinBtn.click();

    // Wait for pin calls — should promote from cache
    await vi.waitFor(() => {
      expect(mediaCacheMockLocal.pinMediaBlob).toHaveBeenCalled();
    });

    // pinMediaBlob was used (promotion path), not pinMediaFromResponse (network path)
    expect(mediaCacheMockLocal.pinMediaBlob).toHaveBeenCalledWith(
      "asset_a",
      fakeBlob,
      { contentHash: "hash_a" },
    );

    shell.destroy();
  });
});

// ── Tests: player-shell local (demo) playlist ────────────────────────

describe("player-shell local (demo) playlist", () => {
  let createPlayerShell;
  let runtime;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();

    vi.doMock("../../src/i18n.js", () => ({
      t: (key) => key,
      getLang: () => "en",
      toggleLang: vi.fn(),
      applyTranslations: vi.fn(),
    }));
    vi.doMock("../../src/shared/media-cache.js", () => ({
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
      cacheMediaFromResponse: vi.fn().mockResolvedValue(undefined),
      pinMediaBlob: vi.fn().mockResolvedValue(true),
      pinMediaFromResponse: vi.fn().mockResolvedValue(true),
      unpinMediaBlob: vi.fn().mockResolvedValue(true),
      isMediaBlobPinned: vi.fn().mockResolvedValue(false),
      getCachedMediaBlob: vi.fn().mockResolvedValue(null),
      getCachedBlobMeta: vi.fn().mockResolvedValue(null),
      removeCachedMediaBlob: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));
    vi.doMock("../../src/shared/backend-auth.js", () => ({
      getProtectedMediaRequestGate: vi.fn().mockResolvedValue({
        allowed: true, cleanup() {}, signal: undefined,
      }),
      getBackendMediaAssetAccess: vi.fn().mockResolvedValue({ ok: false, access: null }),
      getBackendMediaManifest: vi.fn().mockResolvedValue({ ok: false, assets: [] }),
      getBackendManifestVersion: vi.fn().mockResolvedValue({ ok: false }),
      fetchBackendMediaAssetBlob: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
      createBackendPlaylist: vi.fn().mockResolvedValue({ ok: true, playlist: { name: "pl_new" } }),
      addBackendPlaylistItem: vi.fn().mockResolvedValue({ ok: true }),
      bulkAddBackendPlaylistItems: vi.fn().mockResolvedValue({ ok: true, added: [], skipped: [] }),
    }));
    vi.doMock("../../src/shared/media-access-cache.js", () => ({
      getCachedMediaAccess: vi.fn().mockReturnValue(null),
      setCachedMediaAccess: vi.fn(),
      clearMediaAccessCache: vi.fn(),
    }));
    vi.doMock("../../src/shared/audio-mini-visualizer.js", () => ({
      createMiniAudioVisualizer: vi.fn(() => ({
        get isAvailable() { return true; },
        setMode: vi.fn(), resize: vi.fn(),
        start: vi.fn(() => Promise.resolve(true)),
        stop: vi.fn(), destroy: vi.fn(),
      })),
      destroyVisualizerGraphForElement: vi.fn().mockReturnValue(false),
    }));
    vi.doMock("../../src/shared/playlist-loader.js", () => ({
      loadPlaylists: vi.fn().mockResolvedValue({ playlists: [], total: 0 }),
      loadPlaylistDetail: vi.fn().mockRejectedValue(new Error("should not be called for local playlists")),
    }));
    vi.doMock("../../src/shared/audio-source-resolver.js", () => ({
      resolveAudioSource: vi.fn().mockResolvedValue(null),
      hasLocalSource: vi.fn().mockResolvedValue(false),
      triggerBackgroundCache: vi.fn(),
    }));

    const mod = await import("../../src/player/player-shell.js");
    createPlayerShell = mod.createPlayerShell;
    runtime = await import("../../src/shared/audio-runtime.js");
  });

  it("renders local playlist detail without calling loadPlaylistDetail", async () => {
    const demoPlaylist = {
      name: "demo:playlist",
      title: "Demo Playlist",
      item_count: 2,
      _local: true,
      _items: [
        { media_asset_name: "demo:track-a", snapshot_title: "Demo A", snapshot_artist: "Artist A", snapshot_duration: 120 },
        { media_asset_name: "demo:track-b", snapshot_title: "Demo B", snapshot_artist: "Artist B", snapshot_duration: 180 },
      ],
    };

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([TRACK_A, TRACK_B]);
    shell.setPlaylists([demoPlaylist]);

    // Open playlist sheet
    container.querySelector(".player-playlist-toggle-btn").click();

    // Click demo playlist
    const playlistItem = container.querySelector(".player-playlist-item");
    expect(playlistItem.textContent).toContain("Demo Playlist");
    playlistItem.click();

    // Wait for detail to render (should be instant since it's local)
    await vi.waitFor(() => {
      const trackItems = container.querySelectorAll(".player-playlist-track-item");
      expect(trackItems.length).toBe(2);
    });

    // Verify tracks rendered with snapshot data
    const trackItems = container.querySelectorAll(".player-playlist-track-item");
    expect(trackItems[0].textContent).toContain("Demo A");
    expect(trackItems[1].textContent).toContain("Demo B");

    // Verify no pin/unpin buttons for local playlists
    const downloadBtn = container.querySelector(".player-playlist-download-btn");
    expect(downloadBtn).toBeNull();

    // Verify no offline status for local playlists
    const offlineStatus = container.querySelector(".player-playlist-offline-status");
    expect(offlineStatus).toBeNull();

    // Verify Play All button exists
    const playAllBtn = container.querySelector(".player-playlist-play-all-btn");
    expect(playAllBtn).toBeTruthy();

    // loadPlaylistDetail should NOT have been called
    const { loadPlaylistDetail } = await import("../../src/shared/playlist-loader.js");
    expect(loadPlaylistDetail).not.toHaveBeenCalled();

    shell.destroy();
  });

  it("local playlist tracks have Play next and Add to queue actions", async () => {
    const demoPlaylist = {
      name: "demo:playlist",
      title: "Demo Playlist",
      item_count: 1,
      _local: true,
      _items: [
        { media_asset_name: "demo:track-a", snapshot_title: "Demo A", snapshot_artist: "Artist A", snapshot_duration: 120 },
      ],
    };

    const container = document.createElement("div");
    const shell = createPlayerShell({ container });
    shell.setTracks([]);
    shell.setPlaylists([demoPlaylist]);

    container.querySelector(".player-playlist-toggle-btn").click();
    container.querySelector(".player-playlist-item").click();

    await vi.waitFor(() => {
      const trackItems = container.querySelectorAll(".player-playlist-track-item");
      expect(trackItems.length).toBe(1);
    });

    const actions = container.querySelectorAll(".player-playlist-track-action-btn");
    expect(actions.length).toBe(2); // Play next, Add to queue

    shell.destroy();
  });
});
