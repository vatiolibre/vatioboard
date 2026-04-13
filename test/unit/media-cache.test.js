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
      const p = new Promise((r) => { resolve = r; });
      expect(registerAutoCacheDownload("ASSET-1", p)).toBe(true);
      expect(isAutoCacheInFlight("ASSET-1")).toBe(true);
      resolve();
      await p;
      // Give microtask a tick for cleanup
      await Promise.resolve();
      expect(isAutoCacheInFlight("ASSET-1")).toBe(false);
    });

    it("rejects duplicate registrations for the same asset", async () => {
      const { registerAutoCacheDownload } = await importCache();
      let resolve;
      const p = new Promise((r) => { resolve = r; });
      expect(registerAutoCacheDownload("ASSET-2", p)).toBe(true);
      expect(registerAutoCacheDownload("ASSET-2", Promise.resolve())).toBe(false);
      resolve();
      await p;
    });

    it("cleans up on rejection", async () => {
      const { registerAutoCacheDownload, isAutoCacheInFlight } = await importCache();
      let reject;
      const p = new Promise((_, r) => { reject = r; });
      registerAutoCacheDownload("ASSET-3", p);
      expect(isAutoCacheInFlight("ASSET-3")).toBe(true);
      reject(new Error("test"));
      await p.catch(() => {});
      await Promise.resolve();
      expect(isAutoCacheInFlight("ASSET-3")).toBe(false);
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
      const p = new Promise((r) => { resolve = r; });
      registerAutoCacheDownload("ASSET-4", p);
      expect(deriveLocalAvailability({ name: "ASSET-4" })).toBe("caching-locally");
      resolve();
      await p;
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
});
