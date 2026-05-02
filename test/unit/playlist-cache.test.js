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

  // ── Full offline contract preservation ─────────────────────────

  it("preserves total_duration_seconds on playlist entries", async () => {
    const cache = await importCache();
    const playlists = [
      { name: "pl1", title: "Mix", item_count: 3, total_duration_seconds: 542.5 },
    ];

    await cache.cachePlaylistsManifestSnapshot({ playlists, token: "t1" });

    const [, value] = mockStore.setValue.mock.calls[0];
    expect(value.playlists[0].total_duration_seconds).toBe(542.5);
  });

  it("preserves item snapshot fields: album, genre, artwork_ref, content_hash", async () => {
    const cache = await importCache();
    const playlists = [
      {
        name: "pl1",
        title: "Full Meta",
        item_count: 1,
        total_duration_seconds: 200,
        items: [
          {
            media_asset_name: "ASSET-001",
            position: 1,
            snapshot_title: "Track One",
            snapshot_artist: "Artist A",
            snapshot_album: "Album X",
            snapshot_genre: "Rock",
            snapshot_duration: 200,
            snapshot_artwork_ref: "ASSET-001",
            snapshot_content_hash: "abc123hash",
          },
        ],
      },
    ];

    await cache.cachePlaylistsManifestSnapshot({ playlists, token: "t2" });

    const [, value] = mockStore.setValue.mock.calls[0];
    const item = value.playlists[0].items[0];
    expect(item.snapshot_album).toBe("Album X");
    expect(item.snapshot_genre).toBe("Rock");
    expect(item.snapshot_artwork_ref).toBe("ASSET-001");
    expect(item.snapshot_content_hash).toBe("abc123hash");
  });

  it("does not persist signed URLs in cached entries", async () => {
    const cache = await importCache();
    const playlists = [
      {
        name: "pl1",
        title: "No URLs",
        item_count: 1,
        total_duration_seconds: 100,
        artwork_url: "https://s3.example.com/signed?expires=123",
        playback_url: "https://s3.example.com/play?expires=456",
        items: [
          {
            media_asset_name: "ASSET-002",
            position: 1,
            snapshot_title: "Track",
            snapshot_artist: "",
            snapshot_album: "",
            snapshot_genre: "",
            snapshot_duration: 100,
            snapshot_artwork_ref: "ASSET-002",
            snapshot_content_hash: "hash2",
            playback_url: "https://s3.example.com/item-play?expires=789",
          },
        ],
      },
    ];

    await cache.cachePlaylistsManifestSnapshot({ playlists, token: "t3" });

    const [, value] = mockStore.setValue.mock.calls[0];
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("expires=");
    expect(serialized).not.toContain("playback_url");
    expect(serialized).not.toContain("artwork_url");
  });

  it("defaults missing optional fields gracefully", async () => {
    const cache = await importCache();
    const playlists = [
      {
        name: "pl1",
        title: "Minimal",
        items: [
          { media_asset_name: "ASSET-003" },
        ],
      },
    ];

    await cache.cachePlaylistsManifestSnapshot({ playlists, token: "t4" });

    const [, value] = mockStore.setValue.mock.calls[0];
    const pl = value.playlists[0];
    expect(pl.total_duration_seconds).toBe(0);
    expect(pl.item_count).toBe(0);
    const item = pl.items[0];
    expect(item.snapshot_album).toBe("");
    expect(item.snapshot_genre).toBe("");
    expect(item.snapshot_artwork_ref).toBe("");
    expect(item.snapshot_content_hash).toBe("");
    expect(item.snapshot_duration).toBeNull();
    expect(item.position).toBe(0);
  });

  // ── fanOutManifestDetails ──────────────────────────────────────

  it("fanOutManifestDetails caches each playlist with items as detail", async () => {
    const cache = await importCache();
    const playlists = [
      {
        name: "pl1",
        title: "A",
        item_count: 1,
        total_duration_seconds: 60,
        items: [
          {
            media_asset_name: "ASSET-010",
            position: 1,
            snapshot_title: "Song A",
            snapshot_artist: "Artist",
            snapshot_album: "Album",
            snapshot_genre: "Pop",
            snapshot_duration: 60,
            snapshot_artwork_ref: "ASSET-010",
            snapshot_content_hash: "hashA",
          },
        ],
      },
      { name: "pl2", title: "B", item_count: 0 }, // no items — should be skipped
    ];

    await cache.fanOutManifestDetails(playlists);

    // Only pl1 (has items) should have been cached
    expect(mockStore.setValue).toHaveBeenCalledOnce();
    const [key, value] = mockStore.setValue.mock.calls[0];
    expect(key).toContain("detail:pl1");
    expect(value.items[0].snapshot_artwork_ref).toBe("ASSET-010");
    expect(typeof value.cached_at).toBe("number");
  });
});
