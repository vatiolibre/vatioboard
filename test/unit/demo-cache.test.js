import { beforeEach, describe, expect, it, vi } from "vitest";

const playlistStore = vi.hoisted(() => ({
  getValue: vi.fn().mockResolvedValue(undefined),
  setValue: vi.fn().mockResolvedValue(true),
  deleteValue: vi.fn().mockResolvedValue(true),
}));

const demoTrackBaseStore = vi.hoisted(() => ({
  getValue: vi.fn().mockResolvedValue(undefined),
  setValue: vi.fn().mockResolvedValue(true),
  deleteValue: vi.fn().mockResolvedValue(true),
}));

const demoTrackStore = vi.hoisted(() => ({
  getValue: vi.fn().mockResolvedValue(undefined),
  setValue: vi.fn().mockResolvedValue(true),
  deleteValue: vi.fn().mockResolvedValue(true),
  streamResponse: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/indexed-storage.js", () => ({
  hasIndexedDbSupport: () => true,
  createIndexedJsonKeyValueStore: ({ dbName }) => (
    dbName === "vatioboard_demo_track_blobs" ? demoTrackBaseStore : playlistStore
  ),
}));

vi.mock("../../src/shared/chunked-blob-store.js", () => ({
  createChunkedBlobStore: (store) => (store === demoTrackBaseStore ? demoTrackStore : store),
}));

const DEMO_TRACK = {
  name: "demo:titan",
  title: "Titan",
  media_kind: "audio",
  original_filename: "sb_titan.mp3",
  src: "/audio/demo/sb_titan.mp3",
  duration: 123,
};

async function importCache() {
  return import("../../src/shared/demo-cache.js");
}

async function flushMicrotasks(n = 8) {
  for (let index = 0; index < n; index += 1) {
    await Promise.resolve();
  }
}

describe("demo-cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    Object.values(playlistStore).forEach((fn) => fn.mockReset());
    playlistStore.getValue.mockResolvedValue(undefined);
    playlistStore.setValue.mockResolvedValue(true);
    playlistStore.deleteValue.mockResolvedValue(true);

    Object.values(demoTrackBaseStore).forEach((fn) => fn.mockReset());
    demoTrackBaseStore.getValue.mockResolvedValue(undefined);
    demoTrackBaseStore.setValue.mockResolvedValue(true);
    demoTrackBaseStore.deleteValue.mockResolvedValue(true);

    Object.values(demoTrackStore).forEach((fn) => fn.mockReset());
    demoTrackStore.getValue.mockResolvedValue(undefined);
    demoTrackStore.setValue.mockResolvedValue(true);
    demoTrackStore.deleteValue.mockResolvedValue(true);
    demoTrackStore.streamResponse.mockResolvedValue(true);
  });

  it("caches a normalized demo playlist snapshot", async () => {
    const cache = await importCache();

    const ok = await cache.cacheDemoPlaylistSnapshot([DEMO_TRACK]);

    expect(ok).toBe(true);
    expect(playlistStore.setValue).toHaveBeenCalledOnce();
    const [key, value] = playlistStore.setValue.mock.calls[0];
    expect(key).toBe("__demo_playlist_v1__");
    expect(value.tracks).toEqual([
      expect.objectContaining({
        name: "demo:titan",
        src: "/audio/demo/sb_titan.mp3",
        _demo: true,
      }),
    ]);
    expect(typeof value.cached_at).toBe("number");
  });

  it("prefers the cached demo playlist over a network fetch", async () => {
    playlistStore.getValue.mockResolvedValueOnce({
      tracks: [DEMO_TRACK],
      cached_at: 1234,
    });

    const cache = await importCache();
    const fetchFn = vi.fn();
    const result = await cache.loadDemoPlaylist({ fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.source).toBe("cache");
    expect(result.cachedAt).toBe(1234);
    expect(result.tracks).toEqual([
      expect.objectContaining({ name: "demo:titan" }),
    ]);
  });

  it("fetches and caches the demo playlist when no snapshot exists", async () => {
    const cache = await importCache();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([DEMO_TRACK]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await cache.loadDemoPlaylist({ fetchFn });

    expect(fetchFn).toHaveBeenCalledWith("/audio/demo/playlist.json");
    expect(result.source).toBe("network");
    expect(result.tracks).toEqual([
      expect.objectContaining({ name: "demo:titan" }),
    ]);
    expect(playlistStore.setValue).toHaveBeenCalledOnce();
  });

  it("skips demo playlist refresh when the cached snapshot is still fresh", async () => {
    playlistStore.getValue.mockResolvedValueOnce({
      tracks: [DEMO_TRACK],
      cached_at: Date.now(),
    });

    const cache = await importCache();
    const fetchFn = vi.fn();
    const result = await cache.syncDemoPlaylist({ fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      refreshed: false,
      changed: false,
      source: "cache",
    }));
  });

  it("refreshes a stale demo playlist snapshot and reports changes", async () => {
    playlistStore.getValue.mockResolvedValueOnce({
      tracks: [DEMO_TRACK],
      cached_at: 0,
    });

    const cache = await importCache();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([
        DEMO_TRACK,
        {
          ...DEMO_TRACK,
          name: "demo:atlas",
          title: "Atlas",
          original_filename: "sb_atlas.mp3",
          src: "/audio/demo/sb_atlas.mp3",
        },
      ]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await cache.syncDemoPlaylist({
      fetchFn,
      maxAgeMs: 1,
    });

    expect(fetchFn).toHaveBeenCalledWith("/audio/demo/playlist.json");
    expect(result.refreshed).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.tracks).toHaveLength(2);
  });

  it("returns null for cached demo blobs when the src no longer matches", async () => {
    demoTrackStore.getValue.mockResolvedValueOnce({
      blob: new Blob(["audio"], { type: "audio/mp3" }),
      src: "/audio/demo/old.mp3",
      mime_type: "audio/mp3",
      blob_size: 5,
      cached_at: 123,
    });

    const cache = await importCache();
    const result = await cache.getCachedDemoTrackBlob("demo:titan", DEMO_TRACK);

    expect(result).toBeNull();
  });

  it("streams demo track downloads into the IndexedDB blob store", async () => {
    demoTrackStore.getValue.mockResolvedValueOnce(undefined);

    const cache = await importCache();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(new Blob(["audio"], { type: "audio/mp3" }), {
        status: 200,
        headers: {
          "content-type": "audio/mp3",
          "content-length": "5",
        },
      }),
    );
    const onCached = vi.fn();

    cache.triggerDemoTrackCache("demo:titan", DEMO_TRACK, { fetchFn, onCached });
    await flushMicrotasks();

    expect(fetchFn).toHaveBeenCalledWith("/audio/demo/sb_titan.mp3");
    expect(demoTrackStore.streamResponse).toHaveBeenCalledWith(
      "demo:titan",
      expect.any(Response),
      expect.objectContaining({
        src: "/audio/demo/sb_titan.mp3",
        mime_type: "audio/mp3",
        blob_size: 5,
      }),
    );
    expect(onCached).toHaveBeenCalledTimes(1);
  });
});
