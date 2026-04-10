import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockBackend = vi.hoisted(() => ({
  listBackendMediaAssets: vi.fn(),
  getBackendMediaAssetDetail: vi.fn(),
  listBackendSpeedRecordings: vi.fn(),
  getBackendSpeedRecordingDetail: vi.fn(),
  listBackendAccelRuns: vi.fn(),
  getBackendAccelRunDetail: vi.fn(),
  listBackendBoardDocuments: vi.fn(),
  getBackendBoardDocumentDetail: vi.fn(),
}));

const mockCache = vi.hoisted(() => ({
  cacheMediaManifest: vi.fn(),
  cacheMediaMetadata: vi.fn(),
  getCachedMediaManifest: vi.fn(),
  getCachedMediaMetadata: vi.fn(),
}));

const mockCloudLib = vi.hoisted(() => ({
  createCloudLibraryResource: vi.fn(),
}));

vi.mock("../../src/shared/backend-auth.js", () => mockBackend);
vi.mock("../../src/shared/media-cache.js", () => mockCache);
vi.mock("../../src/shared/cloud-library.js", () => mockCloudLib);

// ── Helpers ──────────────────────────────────────────────────────────

/** Capture the listLoader / detailLoader passed to createCloudLibraryResource. */
function getMediaResourceArgs() {
  const calls = mockCloudLib.createCloudLibraryResource.mock.calls;
  const mediaCall = calls.find((c) => c[0]?.resourceKey === "media_asset");
  if (!mediaCall) throw new Error("media_asset resource not registered");
  return mediaCall[0];
}

// ── Tests ────────────────────────────────────────────────────────────

describe("media resource cache wiring", () => {
  let listLoader;
  let detailLoader;

  beforeEach(async () => {
    vi.resetModules();
    Object.values(mockBackend).forEach((fn) => fn.mockReset());
    Object.values(mockCache).forEach((fn) => fn.mockReset());
    // Default cache mocks to resolved values so .catch() chains never fail
    mockCache.cacheMediaManifest.mockResolvedValue(true);
    mockCache.cacheMediaMetadata.mockResolvedValue(true);
    mockCache.getCachedMediaManifest.mockResolvedValue(null);
    mockCache.getCachedMediaMetadata.mockResolvedValue(undefined);
    mockCloudLib.createCloudLibraryResource.mockReset();
    mockCloudLib.createCloudLibraryResource.mockReturnValue({});

    // Dynamic import triggers module-level registration
    await import("../../src/shared/cloud-library-resources.js");

    const args = getMediaResourceArgs();
    listLoader = args.listLoader;
    detailLoader = args.detailLoader;
  });

  // ── listLoader ───────────────────────────────────────────────────

  it("caches the manifest on successful list", async () => {
    const assets = [{ name: "a1" }, { name: "a2" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets,
      total_count: 2,
      has_more: false,
    });
    mockCache.cacheMediaManifest.mockResolvedValue(true);

    const result = await listLoader({ search: "" });

    expect(result.assets).toEqual(assets);
    expect(mockCache.cacheMediaManifest).toHaveBeenCalledWith(assets);
  });

  it("returns cached manifest when the backend fails", async () => {
    const cached = [{ name: "offline-1" }];
    mockBackend.listBackendMediaAssets.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);

    const result = await listLoader({});

    expect(result).toEqual({
      assets: cached,
      total_count: 1,
      has_more: false,
      _offline: true,
    });
  });

  it("re-throws when backend fails and cache is empty", async () => {
    mockBackend.listBackendMediaAssets.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaManifest.mockResolvedValue(null);

    await expect(listLoader({})).rejects.toThrow("offline");
  });

  it("caches an empty manifest to replace stale data", async () => {
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [],
      total_count: 0,
      has_more: false,
    });

    await listLoader({});

    expect(mockCache.cacheMediaManifest).toHaveBeenCalledWith([]);
  });

  // ── detailLoader ─────────────────────────────────────────────────

  it("caches metadata on successful detail fetch", async () => {
    const asset = { name: "a1", title: "Photo" };
    mockBackend.getBackendMediaAssetDetail.mockResolvedValue({ asset });
    mockCache.cacheMediaMetadata.mockResolvedValue(true);

    const result = await detailLoader("a1");

    expect(result.asset).toEqual(asset);
    expect(mockCache.cacheMediaMetadata).toHaveBeenCalledWith("a1", asset);
  });

  it("does not cache when asset is missing from response", async () => {
    mockBackend.getBackendMediaAssetDetail.mockResolvedValue({ asset: null });

    await detailLoader("a1");

    expect(mockCache.cacheMediaMetadata).not.toHaveBeenCalled();
  });

  // ── detailLoader offline fallback ────────────────────────────────

  it("returns cached metadata when backend detail fetch fails", async () => {
    const cached = { name: "a1", title: "Cached Photo", file_url: "/files/photo.jpg" };
    mockBackend.getBackendMediaAssetDetail.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaMetadata.mockResolvedValue(cached);

    const result = await detailLoader("a1");

    expect(result).toEqual({ asset: { ...cached, _offline: true } });
    expect(mockCache.getCachedMediaMetadata).toHaveBeenCalledWith("a1");
  });

  it("re-throws when backend detail fails and cache is empty", async () => {
    mockBackend.getBackendMediaAssetDetail.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaMetadata.mockResolvedValue(null);

    await expect(detailLoader("a1")).rejects.toThrow("offline");
  });

  // ── Offline sorting with raw timestamps ──────────────────────────

  it("sorts offline cached assets by raw timestamp, not label strings", async () => {
    // Labels are fully-localized and NOT lexicographically sortable.
    // Raw modified_at ISO strings provide correct chronological order.
    const cached = [
      {
        name: "a1", title: "Charlie",
        modified_at: "2026-04-01T10:00:00Z",
        modified_at_label: "1 de abril de 2026",
      },
      {
        name: "a2", title: "Alpha",
        modified_at: "2026-04-03T12:00:00Z",
        modified_at_label: "3 de abril de 2026",
      },
      {
        name: "a3", title: "Bravo",
        modified_at: "2026-04-02T08:00:00Z",
        modified_at_label: "2 de abril de 2026",
      },
    ];
    mockBackend.listBackendMediaAssets.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);

    // newest — descending by modified_at
    const newest = await listLoader({ sort: "newest" });
    expect(newest.assets.map((a) => a.name)).toEqual(["a2", "a3", "a1"]);

    // oldest — ascending by modified_at
    const oldest = await listLoader({ sort: "oldest" });
    expect(oldest.assets.map((a) => a.name)).toEqual(["a1", "a3", "a2"]);
  });

  it("uses pre-computed sort_timestamp from cached manifest", async () => {
    // sort_timestamp is computed at cache time by cacheMediaManifest so
    // getSortableTimestamp never needs to parse display labels at runtime.
    const cached = [
      { name: "a1", title: "X", sort_timestamp: Date.parse("2026-04-01T10:00:00Z") },
      { name: "a2", title: "Y", sort_timestamp: Date.parse("2026-04-03T12:00:00Z") },
    ];
    mockBackend.listBackendMediaAssets.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);

    const newest = await listLoader({ sort: "newest" });
    expect(newest.assets.map((a) => a.name)).toEqual(["a2", "a1"]);
  });

  it("falls back to created_at when modified_at is absent", async () => {
    const cached = [
      { name: "a1", title: "Old", created_at: "2026-04-01T08:00:00Z" },
      { name: "a2", title: "Mix", modified_at: "2026-04-02T10:00:00Z" },
      { name: "a3", title: "New", created_at: "2026-04-03T12:00:00Z" },
    ];
    mockBackend.listBackendMediaAssets.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);

    const newest = await listLoader({ sort: "newest" });
    expect(newest.assets.map((a) => a.name)).toEqual(["a3", "a2", "a1"]);

    const oldest = await listLoader({ sort: "oldest" });
    expect(oldest.assets.map((a) => a.name)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("cloudLibraryResources shape", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockCloudLib.createCloudLibraryResource.mockReset();
    mockCloudLib.createCloudLibraryResource.mockReturnValue({});
  });

  it("exports all four tab keys", async () => {
    const { CLOUD_LIBRARY_TAB_KEYS } = await import(
      "../../src/shared/cloud-library-resources.js"
    );
    expect(Object.keys(CLOUD_LIBRARY_TAB_KEYS).sort()).toEqual([
      "accel",
      "boardDocuments",
      "media",
      "speed",
    ]);
  });

  it("media tab uses media_assets capability", async () => {
    const { cloudLibraryResources, CLOUD_LIBRARY_TAB_KEYS } = await import(
      "../../src/shared/cloud-library-resources.js"
    );
    const media = cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.media];
    expect(media.capabilityKey).toBe("media_assets");
  });

  it("getCloudLibraryResource falls back to speed", async () => {
    const { getCloudLibraryResource, CLOUD_LIBRARY_TAB_KEYS, cloudLibraryResources } =
      await import("../../src/shared/cloud-library-resources.js");
    expect(getCloudLibraryResource("nonexistent")).toBe(
      cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.speed],
    );
  });
});
