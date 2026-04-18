import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockStore = vi.hoisted(() => ({
  getValue: vi.fn().mockResolvedValue(undefined),
  setValue: vi.fn().mockResolvedValue(true),
  deleteValue: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/indexed-storage.js", () => ({
  hasIndexedDbSupport: () => true,
  createIndexedJsonKeyValueStore: () => mockStore,
}));

// ── Helpers ──────────────────────────────────────────────────────────

async function importCache() {
  const mod = await import("../../src/shared/playlist-cache.js");
  const mediaCache = await import("../../src/shared/media-cache.js");
  mediaCache.setMediaCacheUser("test@example.com");
  return mod;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("playlist-cache", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    Object.values(mockStore).forEach((fn) => fn.mockReset());
    mockStore.getValue.mockResolvedValue(undefined);
    mockStore.setValue.mockResolvedValue(true);
    mockStore.deleteValue.mockResolvedValue(true);
  });

  // ── cachePlaylistsManifestSnapshot ─────────────────────────────

  it("caches playlists manifest snapshot", async () => {
    const cache = await importCache();
    const playlists = [
      { name: "pl1", title: "My Playlist", item_count: 3 },
      { name: "pl2", title: "Chill Mix", item_count: 5, cover_asset_name: "cover1" },
    ];

    await cache.cachePlaylistsManifestSnapshot({ playlists, token: "abc123" });

    expect(mockStore.setValue).toHaveBeenCalledOnce();
    const [key, value] = mockStore.setValue.mock.calls[0];
    expect(key).toContain("__playlists_manifest__");
    expect(value.playlists).toHaveLength(2);
    expect(value.playlists[0].name).toBe("pl1");
    expect(value.playlists[1].cover_asset_name).toBe("cover1");
    expect(value.token).toBe("abc123");
    expect(typeof value.cached_at).toBe("number");
  });

  it("returns null when no manifest is cached", async () => {
    const cache = await importCache();
    const snapshot = await cache.getCachedPlaylistsManifestSnapshot();
    expect(snapshot).toBeNull();
  });

  it("returns cached manifest snapshot when present", async () => {
    mockStore.getValue.mockResolvedValueOnce({
      playlists: [{ name: "pl1", title: "Test" }],
      token: "tok1",
    });

    const cache = await importCache();
    const snapshot = await cache.getCachedPlaylistsManifestSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot.playlists).toHaveLength(1);
    expect(snapshot.token).toBe("tok1");
  });

  // ── getCachedPlaylistsList ──────────────────────────────────────

  it("getCachedPlaylistsList returns playlists array", async () => {
    mockStore.getValue.mockResolvedValueOnce({
      playlists: [{ name: "pl1" }],
      token: null,
    });

    const cache = await importCache();
    const list = await cache.getCachedPlaylistsList();
    expect(list).toHaveLength(1);
  });

  it("getCachedPlaylistsList returns null when empty", async () => {
    const cache = await importCache();
    const list = await cache.getCachedPlaylistsList();
    expect(list).toBeNull();
  });

  // ── getCachedPlaylistsToken ─────────────────────────────────────

  it("getCachedPlaylistsToken returns token", async () => {
    mockStore.getValue.mockResolvedValueOnce({
      playlists: [{ name: "pl1" }],
      token: "fresh_token",
    });

    const cache = await importCache();
    const token = await cache.getCachedPlaylistsToken();
    expect(token).toBe("fresh_token");
  });

  // ── cachePlaylistDetail ─────────────────────────────────────────

  it("caches individual playlist detail", async () => {
    const cache = await importCache();
    const detail = { name: "pl1", title: "My Playlist", items: [{ media_asset_name: "a1", position: 1 }] };

    await cache.cachePlaylistDetail("pl1", detail);

    expect(mockStore.setValue).toHaveBeenCalledOnce();
    const [key, value] = mockStore.setValue.mock.calls[0];
    expect(key).toContain("detail:pl1");
    expect(value.items).toHaveLength(1);
    expect(typeof value.cached_at).toBe("number");
  });

  it("getCachedPlaylistDetail returns cached detail", async () => {
    mockStore.getValue.mockResolvedValueOnce({
      name: "pl1",
      title: "My Playlist",
      items: [],
      cached_at: Date.now(),
    });

    const cache = await importCache();
    const detail = await cache.getCachedPlaylistDetail("pl1");
    expect(detail).not.toBeNull();
    expect(detail.name).toBe("pl1");
  });

  it("getCachedPlaylistDetail returns null when not cached", async () => {
    const cache = await importCache();
    const detail = await cache.getCachedPlaylistDetail("nonexistent");
    expect(detail).toBeNull();
  });

  // ── No cache user ──────────────────────────────────────────────

  it("returns null/false when no cache user is set", async () => {
    const cache = await importCache();
    const mediaCache = await import("../../src/shared/media-cache.js");
    mediaCache.setMediaCacheUser(null);

    const snapshot = await cache.getCachedPlaylistsManifestSnapshot();
    expect(snapshot).toBeNull();

    const result = await cache.cachePlaylistsManifestSnapshot({ playlists: [], token: null });
    expect(result).toBeFalsy();
  });
});
