import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockBackend = vi.hoisted(() => ({
  getProtectedMediaRequestGate: vi.fn(),
  listBackendMediaAssets: vi.fn(),
  getBackendMediaAssetDetail: vi.fn(),
  getBackendManifestVersion: vi.fn(),
  getBackendMediaManifest: vi.fn(),
  listBackendSpeedRecordings: vi.fn(),
  getBackendSpeedRecordingDetail: vi.fn(),
  listBackendAccelRuns: vi.fn(),
  getBackendAccelRunDetail: vi.fn(),
  listBackendBoardDocuments: vi.fn(),
  getBackendBoardDocumentDetail: vi.fn(),
}));

const mockCache = vi.hoisted(() => ({
  cacheManifestSnapshot: vi.fn(),
  getCachedManifestSnapshot: vi.fn(),
  cacheMediaManifest: vi.fn(),
  cacheMediaMetadata: vi.fn(),
  getCachedMediaManifest: vi.fn(),
  getCachedMediaMetadata: vi.fn(),
  getCachedManifestToken: vi.fn(),
  cacheManifestToken: vi.fn(),
}));

const mockCloudLib = vi.hoisted(() => ({
  createCloudLibraryResource: vi.fn(),
}));

vi.mock("../../src/shared/backend-auth.js", () => mockBackend);
vi.mock("../../src/shared/media-cache.js", () => mockCache);
vi.mock("../../src/shared/cloud-library.js", () => mockCloudLib);

// ── Helpers ──────────────────────────────────────────────────────────

/** Flush microtask queue so fire-and-forget promises settle.
 * setTimeout is mocked to a no-op in test-env, so we chain
 * resolved promises instead. */
async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

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
    mockCache.cacheManifestSnapshot.mockResolvedValue(true);
    mockCache.getCachedManifestSnapshot.mockResolvedValue(null);
    mockCache.cacheMediaManifest.mockResolvedValue(true);
    mockCache.cacheMediaMetadata.mockResolvedValue(true);
    mockCache.getCachedMediaManifest.mockResolvedValue(null);
    mockCache.getCachedMediaMetadata.mockResolvedValue(undefined);
    mockCache.getCachedManifestToken.mockResolvedValue(null);
    mockCache.cacheManifestToken.mockResolvedValue(true);
    mockBackend.getProtectedMediaRequestGate.mockResolvedValue({
      allowed: true,
      cleanup() {},
      signal: undefined,
    });
    mockBackend.getBackendManifestVersion.mockResolvedValue({ ok: true, manifestToken: null, totalCount: 0 });
    mockBackend.getBackendMediaManifest.mockResolvedValue({ ok: true, assets: [], totalCount: 0, manifestToken: null });
    mockCloudLib.createCloudLibraryResource.mockReset();
    mockCloudLib.createCloudLibraryResource.mockReturnValue({});

    // Dynamic import triggers module-level registration
    await import("../../src/shared/cloud-library-resources.js");

    const args = getMediaResourceArgs();
    listLoader = args.listLoader;
    detailLoader = args.detailLoader;
  });

  // ── listLoader ───────────────────────────────────────────────────

  it("browse path does not cache manifest on list", async () => {
    const assets = [{ name: "a1" }, { name: "a2" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets,
      total_count: 2,
      has_more: false,
    });

    const result = await listLoader({ search: "" });

    expect(result.assets).toEqual(assets);
    // Browse path must NOT write to the manifest cache
    expect(mockCache.cacheMediaManifest).not.toHaveBeenCalled();
  });

  it("returns cached manifest when the backend fails", async () => {
    const cached = [{ name: "offline-1" }];
    mockBackend.listBackendMediaAssets.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);

    // force=true bypasses the cache-first path and hits the network,
    // then falls back to the IndexedDB cache on failure.
    const result = await listLoader({}, { force: true });

    expect(result).toEqual({
      assets: cached,
      total_count: 1,
      has_more: false,
      next_offset: 1,
      _offline: true,
    });
  });

  it("re-throws when backend fails and cache is empty", async () => {
    mockBackend.listBackendMediaAssets.mockRejectedValue(new Error("offline"));
    mockCache.getCachedMediaManifest.mockResolvedValue(null);

    await expect(listLoader({}, { force: true })).rejects.toThrow("offline");
  });

  it("returns cached manifest immediately on non-forced requests", async () => {
    const cached = [{ name: "cached-1", title: "Cached" }];
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);

    const result = await listLoader({});

    expect(result).toEqual({
      assets: cached,
      total_count: 1,
      has_more: false,
      next_offset: 1,
      _cached: true,
    });
    // Should NOT have called the backend
    expect(mockBackend.listBackendMediaAssets).not.toHaveBeenCalled();
  });

  it("bypasses cache on forced requests and calls backend", async () => {
    const cached = [{ name: "cached-1" }];
    const fresh = [{ name: "fresh-1" }];
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: fresh,
      total_count: 1,
      has_more: false,
    });

    const result = await listLoader({}, { force: true });

    expect(result.assets).toEqual(fresh);
    expect(mockBackend.listBackendMediaAssets).toHaveBeenCalled();
  });

  it("does not cache even empty results from browse path", async () => {
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [],
      total_count: 0,
      has_more: false,
    });

    await listLoader({});

    expect(mockCache.cacheMediaManifest).not.toHaveBeenCalled();
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

  // ── Manifest cache poisoning guards ──────────────────────────────

  it("does not overwrite canonical manifest with page 2 results", async () => {
    const page2 = [{ name: "page2-1" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: page2,
      total_count: 2,
      has_more: false,
    });

    // Simulate a paginated request (offset > 0)
    await listLoader({ offset: 10 });

    expect(mockCache.cacheMediaManifest).not.toHaveBeenCalled();
  });

  it("does not overwrite canonical manifest with search results", async () => {
    const searchResults = [{ name: "search-1" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: searchResults,
      total_count: 1,
      has_more: false,
    });

    await listLoader({ search: "photo" });

    expect(mockCache.cacheMediaManifest).not.toHaveBeenCalled();
  });

  it("offline/default load after search still sees the full canonical manifest", async () => {
    const fullManifest = [{ name: "a1" }, { name: "a2" }, { name: "a3" }];

    // Searched response does not cache
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [{ name: "a1" }],
      total_count: 1,
      has_more: false,
    });
    await listLoader({ search: "a1" });
    expect(mockCache.cacheMediaManifest).not.toHaveBeenCalled();

    // Non-forced default request returns page 1 of the cached full manifest
    mockCache.getCachedMediaManifest.mockResolvedValue(fullManifest);
    const result = await listLoader({});
    expect(result.assets).toEqual(fullManifest);
    expect(result.total_count).toBe(3);
    expect(result._cached).toBe(true);
  });

  it("skips manifest-token freshness check for non-canonical queries", async () => {
    const fresh = [{ name: "search-1" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: fresh,
      total_count: 1,
      has_more: false,
    });

    // force=true but with a search filter — token check should be skipped
    await listLoader({ search: "photo" }, { force: true });

    expect(mockBackend.getBackendManifestVersion).not.toHaveBeenCalled();
    expect(mockBackend.listBackendMediaAssets).toHaveBeenCalled();
  });

  it("forced canonical request triggers background manifest sync", async () => {
    const fresh = [{ name: "fresh-1" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: fresh,
      total_count: 1,
      has_more: false,
      manifestToken: "browse-token",
    });
    // Sync should use the browse token and skip the version endpoint
    mockCache.getCachedManifestSnapshot.mockResolvedValue(null);
    mockBackend.getBackendMediaManifest.mockResolvedValue({
      ok: true,
      assets: fresh,
      totalCount: 1,
      manifestToken: "browse-token",
    });

    const result = await listLoader({}, { force: true });
    await flushMicrotasks();

    // listLoader always calls the paginated list endpoint
    expect(mockBackend.listBackendMediaAssets).toHaveBeenCalled();
    expect(result.assets).toEqual(fresh);
    // Version endpoint should NOT have been called — browse token was used
    expect(mockBackend.getBackendManifestVersion).not.toHaveBeenCalled();
    // Full manifest should have been fetched and cached atomically
    expect(mockBackend.getBackendMediaManifest).toHaveBeenCalled();
    expect(mockCache.cacheManifestSnapshot).toHaveBeenCalledWith({
      assets: fresh,
      token: "browse-token",
    });
  });

  it("forced non-canonical request does not trigger manifest sync", async () => {
    const searchResults = [{ name: "s1" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: searchResults,
      total_count: 1,
      has_more: false,
    });

    await listLoader({ search: "photo" }, { force: true });
    await flushMicrotasks();

    expect(mockBackend.listBackendMediaAssets).toHaveBeenCalled();
    // Background sync must NOT fire for non-canonical requests
    expect(mockBackend.getBackendManifestVersion).not.toHaveBeenCalled();
    expect(mockBackend.getBackendMediaManifest).not.toHaveBeenCalled();
  });

  it("background sync skips full fetch when tokens match", async () => {
    const fresh = [{ name: "a1" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: fresh,
      total_count: 1,
      has_more: false,
      manifestToken: "same-token",
    });
    // Tokens match and manifest exists — sync should skip
    mockCache.getCachedManifestSnapshot.mockResolvedValue({ assets: [{ name: "a1" }], token: "same-token" });

    await listLoader({}, { force: true });
    await flushMicrotasks();

    // Browse token was used, no version endpoint call needed
    expect(mockBackend.getBackendManifestVersion).not.toHaveBeenCalled();
    // Full manifest fetch should be skipped — tokens match
    expect(mockBackend.getBackendMediaManifest).not.toHaveBeenCalled();
  });

  it("background sync fetches full manifest on token mismatch", async () => {
    const fresh = [{ name: "a1" }];
    const fullManifest = [{ name: "a1" }, { name: "a2" }, { name: "a3" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: fresh,
      total_count: 3,
      has_more: true,
      manifestToken: "new-token",
    });
    // Token mismatch — sync should fetch the full manifest
    mockCache.getCachedManifestSnapshot.mockResolvedValue({ assets: [{ name: "stale" }], token: "old-token" });
    mockBackend.getBackendMediaManifest.mockResolvedValue({
      ok: true,
      assets: fullManifest,
      totalCount: 3,
      manifestToken: "new-token",
    });

    await listLoader({}, { force: true });
    await flushMicrotasks();

    // Browse token used, no version call
    expect(mockBackend.getBackendManifestVersion).not.toHaveBeenCalled();
    // Should have fetched the full manifest
    expect(mockBackend.getBackendMediaManifest).toHaveBeenCalled();
    // Should have cached it atomically
    expect(mockCache.cacheManifestSnapshot).toHaveBeenCalledWith({
      assets: fullManifest,
      token: "new-token",
    });
  });

  // ── Regression: paginated cache-first browse ─────────────────────

  it("cached browse respects page size and offset, does not dump whole library", async () => {
    // Build a manifest larger than one page (default page size is 24)
    const cached = Array.from({ length: 50 }, (_, i) => ({
      name: `asset-${String(i).padStart(3, "0")}`,
      title: `Asset ${i}`,
      sort_timestamp: 50 - i,
    }));
    mockCache.getCachedMediaManifest.mockResolvedValue(cached);

    // Page 1 (default: limit=24, offset=0)
    const page1 = await listLoader({ limit: 24 });
    expect(page1.assets).toHaveLength(24);
    expect(page1.total_count).toBe(50);
    expect(page1.has_more).toBe(true);
    expect(page1.next_offset).toBe(24);
    expect(page1._cached).toBe(true);

    // Page 2
    const page2 = await listLoader({ limit: 24, offset: 24 });
    expect(page2.assets).toHaveLength(24);
    expect(page2.total_count).toBe(50);
    expect(page2.has_more).toBe(true);
    expect(page2.next_offset).toBe(48);

    // Page 3 (partial)
    const page3 = await listLoader({ limit: 24, offset: 48 });
    expect(page3.assets).toHaveLength(2);
    expect(page3.has_more).toBe(false);
    expect(page3.next_offset).toBe(50);

    // Backend was never called
    expect(mockBackend.listBackendMediaAssets).not.toHaveBeenCalled();
  });

  // ── Regression: first online browse seeds canonical manifest ─────

  it("first successful online load with no cache triggers background canonical sync", async () => {
    // No cached manifest — simulates cold visit
    mockCache.getCachedMediaManifest.mockResolvedValue(null);
    mockCache.getCachedManifestSnapshot.mockResolvedValue(null);
    const page1 = [{ name: "a1" }, { name: "a2" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: page1,
      total_count: 2,
      has_more: false,
      manifestToken: "token-cold",
    });
    mockBackend.getBackendMediaManifest.mockResolvedValue({
      ok: true,
      assets: page1,
      totalCount: 2,
      manifestToken: "token-cold",
    });

    // Non-forced canonical request (force=false, no search, offset=0)
    await listLoader({});
    await flushMicrotasks();

    // Sync should have been triggered in the background
    expect(mockBackend.getBackendMediaManifest).toHaveBeenCalled();
    expect(mockCache.cacheManifestSnapshot).toHaveBeenCalledWith({
      assets: page1,
      token: "token-cold",
    });
    // Version endpoint should NOT have been called (browse token used)
    expect(mockBackend.getBackendManifestVersion).not.toHaveBeenCalled();
  });

  // ── Regression: truncated manifest does not commit token ─────────

  it("truncated manifest caches assets but not the token", async () => {
    mockCache.getCachedManifestSnapshot.mockResolvedValue(null);
    const page1 = [{ name: "a1" }];
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: page1,
      total_count: 6000,
      has_more: true,
      manifestToken: "token-trunc",
    });
    mockBackend.getBackendMediaManifest.mockResolvedValue({
      ok: true,
      assets: Array.from({ length: 5000 }, (_, i) => ({ name: `a${i}` })),
      totalCount: 6000,
      manifestToken: "token-trunc",
      isTruncated: true,
    });

    await listLoader({}, { force: true });
    await flushMicrotasks();

    // Assets cached with null token — truncated manifest is never considered fresh
    expect(mockCache.cacheManifestSnapshot).toHaveBeenCalledWith({
      assets: expect.any(Array),
      token: null,
    });
  });

  // ── Regression: no duplicate version call ────────────────────────

  it("canonical forced refresh does not call get_my_media_manifest_version when browse has token", async () => {
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [{ name: "a1" }],
      total_count: 1,
      has_more: false,
      manifestToken: "browse-tok",
    });
    mockCache.getCachedManifestSnapshot.mockResolvedValue({ assets: [{ name: "a1" }], token: "browse-tok" });

    await listLoader({}, { force: true });
    await flushMicrotasks();

    // Version endpoint must NOT be called — browseToken was passed through
    expect(mockBackend.getBackendManifestVersion).not.toHaveBeenCalled();
  });

  it("falls back to version endpoint when browse response has no token", async () => {
    // Non-canonical (search) response has no token; simulate a cold
    // canonical browse where the backend somehow omits the token.
    mockCache.getCachedMediaManifest.mockResolvedValue(null);
    mockCache.getCachedManifestSnapshot.mockResolvedValue(null);
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [{ name: "a1" }],
      total_count: 1,
      has_more: false,
      manifestToken: null,
    });
    mockBackend.getBackendManifestVersion.mockResolvedValue({
      ok: true,
      manifestToken: "version-tok",
      totalCount: 1,
    });
    mockBackend.getBackendMediaManifest.mockResolvedValue({
      ok: true,
      assets: [{ name: "a1" }],
      totalCount: 1,
      manifestToken: "version-tok",
    });

    await listLoader({});
    await flushMicrotasks();

    // Should have fallen back to the version endpoint
    expect(mockBackend.getBackendManifestVersion).toHaveBeenCalled();
  });

  // ── Atomic manifest snapshot hardening ───────────────────────────

  it("manifest write failure causes sync to silently fail, no orphaned token possible", async () => {
    mockCache.getCachedManifestSnapshot.mockResolvedValue(null);
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [{ name: "a1" }],
      total_count: 1,
      has_more: false,
      manifestToken: "tok",
    });
    mockBackend.getBackendMediaManifest.mockResolvedValue({
      ok: true,
      assets: [{ name: "a1" }],
      totalCount: 1,
      manifestToken: "tok",
    });
    // Simulate IndexedDB write failure
    mockCache.cacheManifestSnapshot.mockRejectedValue(new Error("IndexedDB write failed"));

    await listLoader({}, { force: true });
    await flushMicrotasks();

    // Atomic write was attempted with both assets AND token
    expect(mockCache.cacheManifestSnapshot).toHaveBeenCalledWith({
      assets: [{ name: "a1" }],
      token: "tok",
    });
    // No separate token write — orphaned token is impossible
    expect(mockCache.cacheManifestToken).not.toHaveBeenCalled();
  });

  it("freshness check requires manifest snapshot, not just token", async () => {
    // No cached snapshot — sync must proceed even if remote token is set
    mockCache.getCachedManifestSnapshot.mockResolvedValue(null);
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [{ name: "a1" }],
      total_count: 1,
      has_more: false,
      manifestToken: "remote-tok",
    });
    mockBackend.getBackendMediaManifest.mockResolvedValue({
      ok: true,
      assets: [{ name: "a1" }],
      totalCount: 1,
      manifestToken: "remote-tok",
    });

    await listLoader({}, { force: true });
    await flushMicrotasks();

    // Sync proceeded because snapshot was null (no manifest to match token against)
    expect(mockBackend.getBackendMediaManifest).toHaveBeenCalled();
    expect(mockCache.cacheManifestSnapshot).toHaveBeenCalled();
  });

  it("freshness check passes only when snapshot has both matching token and assets", async () => {
    mockBackend.listBackendMediaAssets.mockResolvedValue({
      assets: [{ name: "a1" }],
      total_count: 1,
      has_more: false,
      manifestToken: "tok-match",
    });
    // Snapshot has matching token AND assets — should skip
    mockCache.getCachedManifestSnapshot.mockResolvedValue({
      assets: [{ name: "a1" }],
      token: "tok-match",
    });

    await listLoader({}, { force: true });
    await flushMicrotasks();

    // Full manifest fetch should be skipped — snapshot is complete and fresh
    expect(mockBackend.getBackendMediaManifest).not.toHaveBeenCalled();
    expect(mockCache.cacheManifestSnapshot).not.toHaveBeenCalled();
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
