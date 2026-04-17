import { beforeEach, describe, expect, it, vi } from "vitest";

describe("media-cache local blob tier", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  async function importCache() {
    const mod = await import("../../src/shared/media-cache.js");
    mod.setMediaCacheUser("test@vatiolibre.com");
    return mod;
  }

  // ── Auto-cache eligibility ───────────────────────────────────────

  describe("isAutoCacheEligible", () => {
    it("returns true for audio within size threshold", async () => {
      const { isAutoCacheEligible } = await importCache();
      expect(isAutoCacheEligible({ media_kind: "audio", blob_size: 5_000_000 })).toBe(true);
    });

    it("returns true for image within size threshold", async () => {
      const { isAutoCacheEligible } = await importCache();
      expect(isAutoCacheEligible({ media_kind: "image", blob_size: 2_000_000 })).toBe(true);
    });

    it("returns false for video", async () => {
      const { isAutoCacheEligible } = await importCache();
      expect(isAutoCacheEligible({ media_kind: "video", blob_size: 5_000_000 })).toBe(false);
    });

    it("returns false for audio exceeding size threshold", async () => {
      const { isAutoCacheEligible, AUTO_CACHE_MAX_BYTES } = await importCache();
      expect(isAutoCacheEligible({ media_kind: "audio", blob_size: AUTO_CACHE_MAX_BYTES + 1 })).toBe(false);
    });

    it("allows audio with unknown size", async () => {
      const { isAutoCacheEligible } = await importCache();
      expect(isAutoCacheEligible({ media_kind: "audio" })).toBe(true);
    });

    it("returns false for null/undefined items", async () => {
      const { isAutoCacheEligible } = await importCache();
      expect(isAutoCacheEligible(null)).toBe(false);
      expect(isAutoCacheEligible(undefined)).toBe(false);
    });
  });

  // ── In-flight dedup ──────────────────────────────────────────────

  describe("registerAutoCacheDownload / isAutoCacheInFlight", () => {
    it("registers and detects in-flight downloads", async () => {
      const { registerAutoCacheDownload, isAutoCacheInFlight } = await importCache();
      let resolve;
      const factory = () => new Promise((r) => { resolve = r; });
      expect(registerAutoCacheDownload("ASSET-1", factory)).toBe(true);
      expect(isAutoCacheInFlight("ASSET-1")).toBe(true);
      resolve();
      // Give microtask a tick for cleanup
      await Promise.resolve();
      await Promise.resolve();
      expect(isAutoCacheInFlight("ASSET-1")).toBe(false);
    });

    it("rejects duplicate registrations for the same asset", async () => {
      const { registerAutoCacheDownload } = await importCache();
      let resolve;
      const factory = () => new Promise((r) => { resolve = r; });
      expect(registerAutoCacheDownload("ASSET-2", factory)).toBe(true);
      // Second call with a different factory should be rejected.
      const secondFactory = vi.fn(() => Promise.resolve());
      expect(registerAutoCacheDownload("ASSET-2", secondFactory)).toBe(false);
      // The second factory must NOT have been invoked.
      expect(secondFactory).not.toHaveBeenCalled();
      resolve();
    });

    it("cleans up on rejection", async () => {
      const { registerAutoCacheDownload, isAutoCacheInFlight } = await importCache();
      let reject;
      const factory = () => new Promise((_, r) => { reject = r; });
      registerAutoCacheDownload("ASSET-3", factory);
      expect(isAutoCacheInFlight("ASSET-3")).toBe(true);
      reject(new Error("test"));
      await Promise.resolve();
      await Promise.resolve();
      expect(isAutoCacheInFlight("ASSET-3")).toBe(false);
    });

    it("still accepts a raw promise for backward compatibility", async () => {
      const { registerAutoCacheDownload, isAutoCacheInFlight } = await importCache();
      let resolve;
      const p = new Promise((r) => { resolve = r; });
      expect(registerAutoCacheDownload("ASSET-4", p)).toBe(true);
      expect(isAutoCacheInFlight("ASSET-4")).toBe(true);
      resolve();
      await p;
      await Promise.resolve();
      expect(isAutoCacheInFlight("ASSET-4")).toBe(false);
    });
  });

  // ── deriveLocalAvailability ──────────────────────────────────────

  describe("deriveLocalAvailability", () => {
    it("returns cloud-only for unknown item", async () => {
      const { deriveLocalAvailability } = await importCache();
      expect(deriveLocalAvailability({ name: "X" })).toBe("cloud-only");
    });

    it("returns available-offline for pinned item", async () => {
      const { deriveLocalAvailability } = await importCache();
      const pinnedNames = new Set(["ASSET-1"]);
      expect(deriveLocalAvailability({ name: "ASSET-1" }, { pinnedNames })).toBe("available-offline");
    });

    it("returns outdated-local for stale pinned item", async () => {
      const { deriveLocalAvailability } = await importCache();
      const pinnedNames = new Set(["ASSET-1"]);
      const stalePinnedNames = new Set(["ASSET-1"]);
      expect(deriveLocalAvailability({ name: "ASSET-1" }, { pinnedNames, stalePinnedNames })).toBe("outdated-local");
    });

    it("returns caching-locally when download is in flight", async () => {
      const { deriveLocalAvailability, registerAutoCacheDownload } = await importCache();
      let resolve;
      const factory = () => new Promise((r) => { resolve = r; });
      registerAutoCacheDownload("ASSET-4", factory);
      expect(deriveLocalAvailability({ name: "ASSET-4" })).toBe("caching-locally");
      resolve();
    });

    it("returns cloud-only for null item", async () => {
      const { deriveLocalAvailability } = await importCache();
      expect(deriveLocalAvailability(null)).toBe("cloud-only");
    });
  });

  // ── Policy constants ─────────────────────────────────────────────

  describe("policy constants", () => {
    it("exposes AUTO_CACHE_MAX_BYTES as 50 MB", async () => {
      const { AUTO_CACHE_MAX_BYTES } = await importCache();
      expect(AUTO_CACHE_MAX_BYTES).toBe(50 * 1024 * 1024);
    });

    it("includes audio and image in eligible kinds", async () => {
      const { AUTO_CACHE_ELIGIBLE_KINDS } = await importCache();
      expect(AUTO_CACHE_ELIGIBLE_KINDS).toContain("audio");
      expect(AUTO_CACHE_ELIGIBLE_KINDS).toContain("image");
      expect(AUTO_CACHE_ELIGIBLE_KINDS).not.toContain("video");
    });
  });

  // ── Race-safe duplicate prevention (Fix 1) ──────────────────────

  describe("race-safe duplicate prevention", () => {
    it("only invokes the winning factory when two registrations race", async () => {
      const { registerAutoCacheDownload, isAutoCacheInFlight } = await importCache();
      const firstFactory = vi.fn(() => new Promise(() => {}));
      const secondFactory = vi.fn(() => Promise.resolve());

      const first = registerAutoCacheDownload("RACE-1", firstFactory);
      const second = registerAutoCacheDownload("RACE-1", secondFactory);

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(firstFactory).toHaveBeenCalledTimes(1);
      expect(secondFactory).not.toHaveBeenCalled();
      expect(isAutoCacheInFlight("RACE-1")).toBe(true);
    });
  });

  // ── Blob/meta consistency (Fix 4) ───────────────────────────────
  // jsdom's IndexedDB cannot structured-clone Blob objects, so we use
  // vi.doMock to control the stores and verify rollback logic directly.

  describe("cacheMediaBlob consistency", () => {
    function createMockStores() {
      const mockSetValue = vi.fn().mockResolvedValue(true);
      const mockGetValue = vi.fn().mockResolvedValue(undefined);
      const mockDeleteValue = vi.fn().mockResolvedValue(true);
      return {
        mockSetValue,
        mockGetValue,
        mockDeleteValue,
        install() {
          vi.doMock("../../src/shared/indexed-storage.js", () => ({
            hasIndexedDbSupport: () => true,
            createIndexedJsonKeyValueStore: () => ({
              getValue: mockGetValue,
              setValue: mockSetValue,
              deleteValue: mockDeleteValue,
            }),
          }));
          // Bypass the chunked wrapper so the mock stores are called
          // directly — this test is about media-cache rollback logic.
          vi.doMock("../../src/shared/chunked-blob-store.js", () => ({
            createChunkedBlobStore: (store) => store,
          }));
        },
      };
    }

    it("returns true only when both blob and meta persist successfully", async () => {
      const stores = createMockStores();
      stores.install();
      const { cacheMediaBlob, setMediaCacheUser } = await import("../../src/shared/media-cache.js");
      setMediaCacheUser("test@vatiolibre.com");

      const blob = new Blob(["hello"], { type: "text/plain" });
      const ok = await cacheMediaBlob("CONSIST-1", blob, {
        contentHash: "abc",
        blobSize: 5,
        mediaKind: "audio",
      });
      expect(ok).toBe(true);
      // Both stores received a write (blob + meta).
      expect(stores.mockSetValue).toHaveBeenCalledTimes(2);
      // No rollback deletes should have fired.
      expect(stores.mockDeleteValue).not.toHaveBeenCalled();
    });

    it("rolls back blob when meta write fails", async () => {
      const stores = createMockStores();
      // First setValue (blob) succeeds, second (meta) fails.
      stores.mockSetValue
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      stores.install();
      const { cacheMediaBlob, setMediaCacheUser } = await import("../../src/shared/media-cache.js");
      setMediaCacheUser("test@vatiolibre.com");

      const blob = new Blob(["hello"], { type: "text/plain" });
      const ok = await cacheMediaBlob("CONSIST-2", blob, {
        contentHash: "xyz",
        blobSize: 5,
        mediaKind: "audio",
      });
      expect(ok).toBe(false);
      // Blob should have been rolled back via deleteValue.
      expect(stores.mockDeleteValue).toHaveBeenCalled();
    });

    it("rolls back meta when blob write throws", async () => {
      const stores = createMockStores();
      stores.mockSetValue.mockRejectedValueOnce(new Error("IDB write error"));
      stores.install();
      const { cacheMediaBlob, setMediaCacheUser } = await import("../../src/shared/media-cache.js");
      setMediaCacheUser("test@vatiolibre.com");

      const blob = new Blob(["data"], { type: "text/plain" });
      const ok = await cacheMediaBlob("CONSIST-3", blob, { contentHash: "z" });
      expect(ok).toBe(false);
    });

    it("does not leave orphaned meta when blob write fails", async () => {
      // Passing a non-Blob fails the instanceof check before any store call.
      const { cacheMediaBlob, getCachedBlobMeta } = await importCache();
      const ok = await cacheMediaBlob("CONSIST-4", "not-a-blob", {
        contentHash: "xyz",
      });
      expect(ok).toBe(false);
      const meta = await getCachedBlobMeta("CONSIST-4");
      expect(meta).toBeFalsy();
    });
  });
});
